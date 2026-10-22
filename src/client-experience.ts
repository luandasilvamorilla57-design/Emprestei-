import { supabase } from './lib/supabase';

type ClientRecord = { id: string; name: string; whatsapp: string | null; owner_id?: string };
type LoanRecord = {
  id: string;
  client_id: string;
  principal: number | string;
  total_receivable: number | string;
  outstanding_principal: number | string | null;
  current_interest_due: number | string | null;
  due_date: string;
  status: string;
};
type PaymentRecord = { loan_id: string; was_late: boolean | null };
type DueTone = 'far' | 'near' | 'soon' | 'today' | 'late' | 'clear';
type DueInfo = { tone: DueTone; label: string; detail: string; delta: number | null };
type RiskInfo = { label: string; tone: 'new' | 'good' | 'watch' | 'risk'; detail: string };

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const SHORT_DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

let ownerId = '';
let clients: ClientRecord[] = [];
let loans: LoanRecord[] = [];
let payments: PaymentRecord[] = [];
let decorateTimer = 0;
let observer: MutationObserver | null = null;

function dateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function daysUntil(value: string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Math.round((dateFromKey(value).getTime() - today.getTime()) / 86400000);
}

function principalOf(loan: LoanRecord) {
  return Number(loan.outstanding_principal ?? loan.principal ?? 0);
}

function interestOf(loan: LoanRecord) {
  const principal = principalOf(loan);
  const total = Number(loan.total_receivable ?? 0);
  return Number(loan.current_interest_due ?? Math.max(total - principal, 0));
}

function totalOf(loan: LoanRecord) {
  return Math.max(principalOf(loan) + interestOf(loan), 0);
}

function isLoanActive(loan: LoanRecord) {
  return loan.status !== 'paid' && loan.status !== 'cancelled' && totalOf(loan) > 0;
}

function activeLoanFor(clientId: string) {
  return loans
    .filter((loan) => loan.client_id === clientId && isLoanActive(loan))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
}

function dueInfoFor(clientId: string): DueInfo {
  const loan = activeLoanFor(clientId);
  if (!loan) return { tone: 'clear', label: 'Sem pendências', detail: 'Nenhum vencimento em aberto', delta: null };
  const delta = daysUntil(loan.due_date);
  if (delta < 0) {
    const days = Math.abs(delta);
    return { tone: 'late', label: 'Atrasado', detail: `Vencido há ${days} dia${days === 1 ? '' : 's'}`, delta };
  }
  if (delta === 0) return { tone: 'today', label: 'Vence hoje', detail: 'Vencimento hoje', delta };
  if (delta <= 3) return { tone: 'soon', label: 'Quase vencendo', detail: delta === 1 ? 'Vence amanhã' : `Faltam ${delta} dias`, delta };
  if (delta <= 7) return { tone: 'near', label: 'Perto do vencimento', detail: `Faltam ${delta} dias`, delta };
  return { tone: 'far', label: 'Longe do vencimento', detail: `Faltam ${delta} dias`, delta };
}

function riskFor(clientId: string): RiskInfo {
  const clientLoans = loans.filter((loan) => loan.client_id === clientId);
  const loanIds = new Set(clientLoans.map((loan) => loan.id));
  const history = payments.filter((payment) => loanIds.has(payment.loan_id));
  const activeLate = clientLoans.some((loan) => isLoanActive(loan) && daysUntil(loan.due_date) < 0);
  const latePayments = history.filter((payment) => Boolean(payment.was_late)).length;

  if (activeLate) return { label: 'Atrasado', tone: 'risk', detail: 'Possui vencimento em atraso agora' };
  if (history.length < 2) return { label: 'Novo cliente', tone: 'new', detail: 'Histórico ainda em formação' };
  if (latePayments === 0) return { label: 'Bom pagador', tone: 'good', detail: `${history.length} pagamentos sem atraso registrado` };
  return { label: 'Atenção', tone: 'watch', detail: `${latePayments} pagamento${latePayments === 1 ? '' : 's'} feito${latePayments === 1 ? '' : 's'} após o vencimento` };
}

function digitsOnly(value: string | null | undefined) {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeWhatsapp(value: string) {
  const digits = digitsOnly(value);
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) return `55${digits}`;
  return digits;
}

function hasWhatsapp(value: string | null | undefined) {
  return /^55\d{10,11}$/.test(normalizeWhatsapp(String(value ?? '')));
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || 'tudo bem';
}

function buildHumanMessage(client: ClientRecord, loan?: LoanRecord) {
  const name = firstName(client.name);
  if (!loan) return `Oi, ${name}! Tudo bem? Passando só para falar com você. Quando puder, me chama por aqui 🙂`;

  const delta = daysUntil(loan.due_date);
  const interest = BRL.format(interestOf(loan));
  const total = BRL.format(totalOf(loan));
  const date = SHORT_DATE.format(dateFromKey(loan.due_date));

  if (delta < 0) {
    const days = Math.abs(delta);
    return `Oi, ${name}! Tudo bem? Vi que o vencimento do seu empréstimo passou há ${days} dia${days === 1 ? '' : 's'}. Queria combinar com você como prefere regularizar. Os juros deste ciclo são ${interest} e, para quitar tudo, o valor é ${total}. Me avisa por aqui, por favor.`;
  }
  if (delta === 0) {
    return `Oi, ${name}! Tudo bem? Só passando para te lembrar que seu empréstimo vence hoje 🙂 Os juros deste ciclo são ${interest} e, se preferir encerrar o empréstimo, a quitação total fica em ${total}. Me avisa se vai pagar os juros e renovar ou quitar tudo, combinado?`;
  }
  if (delta === 1) {
    return `Oi, ${name}! Tudo bem? Passando só para te lembrar que seu empréstimo vence amanhã. Os juros deste ciclo são ${interest} e a quitação total fica em ${total}. Me avisa se vai pagar os juros e renovar ou se prefere quitar tudo, combinado?`;
  }
  if (delta <= 3) {
    return `Oi, ${name}! Tudo bem? Seu vencimento está chegando — faltam ${delta} dias. Os juros deste ciclo são ${interest} e, para quitar tudo, o valor é ${total}. Quando puder, me avisa se vai pagar os juros e renovar ou fazer a quitação total.`;
  }
  if (delta <= 7) {
    return `Oi, ${name}! Tudo bem? Passando com antecedência para te lembrar que seu próximo vencimento é dia ${date}. Os juros deste ciclo são ${interest} e a quitação total fica em ${total}. Mais perto da data a gente combina certinho 🙂`;
  }
  return `Oi, ${name}! Tudo bem? Só deixando o lembrete com antecedência: seu próximo vencimento é dia ${date}. Os juros deste ciclo são ${interest} e a quitação total fica em ${total}. Qualquer coisa me chama por aqui.`;
}

function findClientByName(name: string) {
  const normalized = name.trim().toLocaleLowerCase('pt-BR');
  return clients.find((client) => client.name.trim().toLocaleLowerCase('pt-BR') === normalized);
}

function findClientFromCard(card: Element) {
  const name = card.querySelector('.client-name-line strong')?.textContent?.trim() ?? '';
  const phone = digitsOnly(card.querySelector('.client-main > span')?.textContent ?? '');
  if (phone) {
    const exact = clients.find((client) => digitsOnly(client.whatsapp) === phone || normalizeWhatsapp(String(client.whatsapp ?? '')) === normalizeWhatsapp(phone));
    if (exact) return exact;
  }
  return findClientByName(name);
}

function updateRiskBadge(root: Element, client: ClientRecord) {
  const risk = riskFor(client.id);
  const badge = root.querySelector<HTMLElement>('.risk-badge');
  if (!badge) return;
  badge.classList.remove('risk-good', 'risk-watch', 'risk-risk', 'risk-new');
  badge.classList.add(`risk-${risk.tone}`);
  const label = badge.querySelector<HTMLElement>('span');
  if (label) label.textContent = risk.label;
  const score = badge.querySelector<HTMLElement>('strong');
  if (score && risk.tone === 'new') score.textContent = '';
}

function makeDuePill(info: DueInfo) {
  const pill = document.createElement('span');
  pill.className = `client-due-pill due-${info.tone}`;
  pill.innerHTML = `<span class="client-due-dot"></span><strong>${info.label}</strong><small>${info.detail}</small>`;
  return pill;
}

function makeSendButton(client: ClientRecord, loan?: LoanRecord, compact = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `client-send-alert${compact ? ' compact' : ''}`;
  button.innerHTML = `<span class="whatsapp-glyph">◔</span><span>Enviar aviso</span>`;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void sendAlert(client, loan);
  });
  return button;
}

function decorateClientCards() {
  document.querySelectorAll<HTMLElement>('.client-card-rich').forEach((card) => {
    const client = findClientFromCard(card);
    if (!client) return;

    updateRiskBadge(card, client);
    const phoneLine = card.querySelector<HTMLElement>('.client-main > span');
    if (phoneLine && !hasWhatsapp(client.whatsapp)) phoneLine.textContent = 'WhatsApp não cadastrado';

    let actions = card.querySelector<HTMLElement>('.client-smart-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'client-smart-actions';
      card.appendChild(actions);
    }
    actions.replaceChildren(makeDuePill(dueInfoFor(client.id)), makeSendButton(client, activeLoanFor(client.id), true));
  });
}

function decorateClientDetail() {
  const detail = document.querySelector<HTMLElement>('.client-detail');
  if (!detail) return;
  const name = detail.querySelector('.detail-person h1')?.textContent?.trim() ?? '';
  const client = findClientByName(name);
  if (!client) return;

  updateRiskBadge(detail, client);
  const risk = riskFor(client.id);
  const riskScore = detail.querySelector<HTMLElement>('.risk-score strong');
  const riskCopy = detail.querySelector<HTMLElement>('.risk-panel p');
  if (riskScore && risk.tone === 'new') riskScore.textContent = '—';
  if (riskCopy) riskCopy.textContent = `${risk.detail}. A classificação usa somente o histórico registrado no Emprestei.`;

  const phoneLine = detail.querySelector<HTMLElement>('.detail-person > span');
  if (phoneLine && !hasWhatsapp(client.whatsapp)) phoneLine.textContent = 'WhatsApp não cadastrado';

  detail.querySelector<HTMLElement>('.detail-header .icon-btn.whatsapp')?.classList.add('legacy-whatsapp-hidden');

  let panel = detail.querySelector<HTMLElement>('.client-notice-panel');
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'client-notice-panel';
    detail.querySelector('.detail-header')?.insertAdjacentElement('afterend', panel);
  }

  const due = dueInfoFor(client.id);
  const loan = activeLoanFor(client.id);
  const copy = document.createElement('div');
  copy.className = 'client-notice-copy';
  copy.appendChild(makeDuePill(due));
  const helper = document.createElement('p');
  helper.textContent = loan ? `Próximo vencimento: ${SHORT_DATE.format(dateFromKey(loan.due_date))} · ${BRL.format(totalOf(loan))} no ciclo atual.` : 'Este cliente não possui cobrança pendente agora.';
  copy.appendChild(helper);
  panel.replaceChildren(copy, makeSendButton(client, loan));
}

function decorateReminderButtons() {
  document.querySelectorAll<HTMLElement>('.remind-whatsapp').forEach((button) => {
    button.classList.add('send-alert-explicit');
    button.innerHTML = '<span class="whatsapp-glyph">◔</span> Enviar aviso';
  });
}

function decorateAll() {
  observer?.disconnect();
  try {
    decorateClientCards();
    decorateClientDetail();
    decorateReminderButtons();
  } finally {
    if (document.body && observer) observer.observe(document.body, { childList: true, subtree: true });
  }
}

function scheduleDecorate() {
  window.clearTimeout(decorateTimer);
  decorateTimer = window.setTimeout(decorateAll, 40);
}

function clientFromExistingWhatsappButton(target: Element) {
  const reminder = target.closest('.reminder-card');
  if (reminder) return findClientByName(reminder.querySelector('.reminder-copy strong')?.textContent ?? '');
  const loanRow = target.closest('.loan-row');
  if (loanRow) return findClientByName(loanRow.querySelector('.loan-title strong')?.textContent ?? '');
  const detail = target.closest('.client-detail');
  if (detail) return findClientByName(detail.querySelector('.detail-person h1')?.textContent ?? '');
  const modal = target.closest('.modal-card');
  if (modal) return findClientByName(modal.querySelector('.modal-header h2')?.textContent ?? '');
  return undefined;
}

async function sendAlert(client: ClientRecord, loan = activeLoanFor(client.id)) {
  if (!hasWhatsapp(client.whatsapp)) {
    openWhatsappCapture(client, loan);
    return;
  }
  const number = normalizeWhatsapp(String(client.whatsapp ?? ''));
  const message = buildHumanMessage(client, loan);
  window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
}

function openWhatsappCapture(client: ClientRecord, loan?: LoanRecord) {
  document.querySelector('.client-whatsapp-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'client-whatsapp-backdrop';
  backdrop.innerHTML = `
    <div class="client-whatsapp-modal" role="dialog" aria-modal="true" aria-label="Adicionar WhatsApp">
      <div class="client-whatsapp-icon">◔</div>
      <p class="client-whatsapp-kicker">Contato do cliente</p>
      <h3>Adicionar WhatsApp</h3>
      <p class="client-whatsapp-text"><strong>${client.name}</strong> ainda não possui um WhatsApp válido cadastrado. Adicione o número para salvar e enviar o aviso agora.</p>
      <label>WhatsApp do cliente<input class="client-whatsapp-input" inputmode="tel" autocomplete="tel" placeholder="(11) 99999-9999" /></label>
      <div class="client-whatsapp-error" aria-live="polite"></div>
      <div class="client-whatsapp-actions"><button type="button" class="client-whatsapp-cancel">Cancelar</button><button type="button" class="client-whatsapp-save">Salvar e enviar aviso</button></div>
    </div>`;
  document.body.appendChild(backdrop);

  const input = backdrop.querySelector<HTMLInputElement>('.client-whatsapp-input')!;
  const error = backdrop.querySelector<HTMLElement>('.client-whatsapp-error')!;
  const close = () => backdrop.remove();
  backdrop.querySelector('.client-whatsapp-cancel')?.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelector('.client-whatsapp-save')?.addEventListener('click', async () => {
    const normalized = normalizeWhatsapp(input.value);
    if (!/^55\d{10,11}$/.test(normalized)) {
      error.textContent = 'Digite um WhatsApp válido com DDD.';
      input.focus();
      return;
    }
    const saveButton = backdrop.querySelector<HTMLButtonElement>('.client-whatsapp-save')!;
    saveButton.disabled = true;
    saveButton.textContent = 'Salvando...';
    const { error: updateError } = await supabase.from('clients').update({ whatsapp: normalized }).eq('id', client.id).eq('owner_id', ownerId);
    if (updateError) {
      error.textContent = 'Não foi possível salvar o número. Tente novamente.';
      saveButton.disabled = false;
      saveButton.textContent = 'Salvar e enviar aviso';
      return;
    }
    client.whatsapp = normalized;
    close();
    scheduleDecorate();
    await sendAlert(client, loan);
  });
  window.setTimeout(() => input.focus(), 60);
}

async function refreshData() {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return;
  ownerId = session.user.id;
  const [clientResult, loanResult, paymentResult] = await Promise.all([
    supabase.from('clients').select('id,name,whatsapp,owner_id').eq('owner_id', ownerId),
    supabase.from('loans').select('id,client_id,principal,total_receivable,outstanding_principal,current_interest_due,due_date,status').eq('owner_id', ownerId),
    supabase.from('payments').select('loan_id,was_late').eq('owner_id', ownerId),
  ]);
  if (!clientResult.error) clients = (clientResult.data ?? []) as ClientRecord[];
  if (!loanResult.error) loans = (loanResult.data ?? []) as LoanRecord[];
  if (!paymentResult.error) payments = (paymentResult.data ?? []) as PaymentRecord[];
  scheduleDecorate();
}

function interceptLegacyWhatsapp(event: MouseEvent) {
  const element = event.target instanceof Element ? event.target : null;
  if (!element) return;
  const target = element.closest('.remind-whatsapp, .mini-btn.whatsapp, .detail-header .icon-btn.whatsapp, .detail-actions .secondary-action');
  if (!target || target.classList.contains('client-send-alert')) return;
  const client = clientFromExistingWhatsappButton(target);
  if (!client) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  void sendAlert(client, activeLoanFor(client.id));
}

observer = new MutationObserver(scheduleDecorate);
if (document.body) observer.observe(document.body, { childList: true, subtree: true });
document.addEventListener('click', interceptLegacyWhatsapp, true);
void refreshData();
supabase.auth.onAuthStateChange(() => { window.setTimeout(() => void refreshData(), 40); });
