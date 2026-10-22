import { supabase } from './lib/supabase';

type ClientRow = { id: string; name: string; whatsapp: string | null };
type LoanRow = {
  id: string; client_id: string; principal: number | string; total_receivable: number | string;
  interest_amount: number | string | null; outstanding_principal: number | string | null;
  current_interest_due: number | string | null; due_date: string; loan_date: string;
  status: string; cycle_number: number | string | null; created_at: string;
};
type PaymentRow = {
  id: string; loan_id: string; amount: number | string; paid_at: string; payment_type: string;
  applied_to_interest: number | string | null; applied_to_principal: number | string | null;
  cycle_number: number | string | null; renewed_due_date: string | null; due_date_snapshot: string | null;
};
type Receipt = {
  id: string; kind: 'loan' | 'interest' | 'full'; clientId: string; clientName: string; whatsapp: string | null;
  loanId: string; date: string; title: string; number: string; amount: number; principal: number; interest: number;
  total: number; dueDate?: string | null; cycle?: number; renewedDueDate?: string | null;
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
let clients: ClientRow[] = [];
let loans: LoanRow[] = [];
let payments: PaymentRow[] = [];
let receipts: Receipt[] = [];
let timer = 0;
const seenToasts = new WeakSet<Element>();

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] ?? char));
}
function money(value: unknown) { return Number(value ?? 0); }
function dateFromKey(value?: string | null) {
  if (!value) return null;
  if (value.includes('T')) return new Date(value);
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
function fmtDate(value?: string | null) { const d = dateFromKey(value); return d ? DATE.format(d) : '—'; }
function phone(value: string | null) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return (digits.length === 10 || digits.length === 11) && !digits.startsWith('55') ? `55${digits}` : digits;
}
function receiptNo(prefix: string, id: string) { return `${prefix}-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`; }

function rebuildReceipts() {
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  const loanMap = new Map(loans.map((loan) => [loan.id, loan]));
  const list: Receipt[] = [];

  for (const loan of loans) {
    const client = clientMap.get(loan.client_id); if (!client) continue;
    const principal = money(loan.principal);
    const interest = money(loan.interest_amount ?? Math.max(money(loan.total_receivable) - principal, 0));
    list.push({
      id: `loan:${loan.id}`, kind: 'loan', clientId: client.id, clientName: client.name, whatsapp: client.whatsapp,
      loanId: loan.id, date: loan.created_at || loan.loan_date, title: 'Comprovante de empréstimo', number: receiptNo('EMP', loan.id),
      amount: principal, principal, interest, total: money(loan.total_receivable), dueDate: loan.due_date, cycle: 1,
    });
  }

  for (const payment of payments) {
    const loan = loanMap.get(payment.loan_id); if (!loan) continue;
    const client = clientMap.get(loan.client_id); if (!client) continue;
    const isInterest = payment.payment_type === 'interest';
    const principal = money(payment.applied_to_principal ?? (isInterest ? 0 : loan.principal));
    const interest = money(payment.applied_to_interest ?? (isInterest ? payment.amount : loan.interest_amount));
    list.push({
      id: `payment:${payment.id}`, kind: isInterest ? 'interest' : 'full', clientId: client.id, clientName: client.name,
      whatsapp: client.whatsapp, loanId: loan.id, date: payment.paid_at,
      title: isInterest ? 'Comprovante de pagamento de juros' : 'Comprovante de quitação', number: receiptNo(isInterest ? 'JUR' : 'QUI', payment.id),
      amount: money(payment.amount), principal, interest, total: money(payment.amount), dueDate: payment.due_date_snapshot,
      cycle: Number(payment.cycle_number ?? 1), renewedDueDate: payment.renewed_due_date,
    });
  }
  receipts = list.sort((a, b) => b.date.localeCompare(a.date));
}

async function refreshData() {
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return;
  const owner = auth.session.user.id;
  const [c, l, p] = await Promise.all([
    supabase.from('clients').select('id,name,whatsapp').eq('owner_id', owner),
    supabase.from('loans').select('id,client_id,principal,total_receivable,interest_amount,outstanding_principal,current_interest_due,due_date,loan_date,status,cycle_number,created_at').eq('owner_id', owner),
    supabase.from('payments').select('id,loan_id,amount,paid_at,payment_type,applied_to_interest,applied_to_principal,cycle_number,renewed_due_date,due_date_snapshot').eq('owner_id', owner),
  ]);
  if (!c.error) clients = (c.data ?? []) as ClientRow[];
  if (!l.error) loans = (l.data ?? []) as LoanRow[];
  if (!p.error) payments = (p.data ?? []) as PaymentRow[];
  rebuildReceipts();
  decorateClientReceipts();
}

function clientInDetail() {
  const name = document.querySelector('.client-detail .detail-person h1')?.textContent?.trim();
  if (!name) return undefined;
  return clients.find((client) => client.name.trim().toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
}

function receiptLabel(receipt: Receipt) {
  if (receipt.kind === 'loan') return `Empréstimo · vence ${fmtDate(receipt.dueDate)}`;
  if (receipt.kind === 'interest') return `Juros · ciclo ${receipt.cycle ?? 1}${receipt.renewedDueDate ? ` · renovado para ${fmtDate(receipt.renewedDueDate)}` : ''}`;
  return 'Quitação total · empréstimo encerrado';
}

function decorateClientReceipts() {
  const detail = document.querySelector<HTMLElement>('.client-detail'); if (!detail) return;
  const client = clientInDetail(); if (!client) return;
  const list = receipts.filter((receipt) => receipt.clientId === client.id);
  const signature = list.map((item) => item.id).join('|');
  let section = detail.querySelector<HTMLElement>('.receipts-section');
  if (!section) {
    section = document.createElement('section'); section.className = 'receipts-section';
    detail.appendChild(section);
  }
  if (section.dataset.signature === signature) return;
  section.dataset.signature = signature;
  section.innerHTML = `<div class="receipts-head"><div class="receipts-head-copy"><p class="receipts-kicker">Documentos de controle</p><h2>Comprovantes</h2></div><div class="receipts-head-badge">${list.length}</div></div><div class="receipts-list">${list.length ? list.map((r) => `<button class="receipt-row" type="button" data-receipt="${esc(r.id)}"><span class="receipt-icon ${r.kind}">${r.kind === 'loan' ? 'E' : r.kind === 'interest' ? 'J' : '✓'}</span><span class="receipt-copy"><strong>${esc(r.title)}</strong><span>${esc(receiptLabel(r))} · ${esc(fmtDate(r.date))}</span></span><span class="receipt-amount"><strong>${esc(BRL.format(r.amount))}</strong><span>Ver</span></span></button>`).join('') : '<div class="receipt-empty">Os comprovantes de empréstimos e pagamentos aparecerão aqui automaticamente.</div>'}</div>`;
  section.querySelectorAll<HTMLElement>('[data-receipt]').forEach((button) => button.addEventListener('click', () => {
    const receipt = receipts.find((item) => item.id === button.dataset.receipt); if (receipt) openReceipt(receipt);
  }));
}

function field(label: string, value: string, wide = false) { return `<div class="receipt-field${wide ? ' wide' : ''}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
function bodyFields(receipt: Receipt) {
  if (receipt.kind === 'loan') return `${field('Data do empréstimo', fmtDate(receipt.date))}${field('Vencimento', fmtDate(receipt.dueDate))}${field('Valor emprestado', BRL.format(receipt.principal))}${field('Juros combinados', BRL.format(receipt.interest))}${field('Total do ciclo', BRL.format(receipt.total), true)}`;
  if (receipt.kind === 'interest') return `${field('Data do pagamento', fmtDate(receipt.date))}${field('Ciclo', String(receipt.cycle ?? 1))}${field('Juros recebidos', BRL.format(receipt.interest))}${field('Principal permanece', BRL.format(money(loans.find((l) => l.id === receipt.loanId)?.principal)))}${field('Próximo vencimento', fmtDate(receipt.renewedDueDate), true)}`;
  return `${field('Data da quitação', fmtDate(receipt.date))}${field('Ciclo', String(receipt.cycle ?? 1))}${field('Principal recebido', BRL.format(receipt.principal))}${field('Juros recebidos', BRL.format(receipt.interest))}${field('Situação', 'Empréstimo quitado', true)}`;
}

function receiptText(receipt: Receipt) {
  const lines = [`*Emprestei · ${receipt.title}*`, `Cliente: ${receipt.clientName}`, `Data: ${fmtDate(receipt.date)}`, `Comprovante: ${receipt.number}`];
  if (receipt.kind === 'loan') lines.push(`Valor emprestado: ${BRL.format(receipt.principal)}`, `Juros combinados: ${BRL.format(receipt.interest)}`, `Total do ciclo: ${BRL.format(receipt.total)}`, `Vencimento: ${fmtDate(receipt.dueDate)}`);
  if (receipt.kind === 'interest') lines.push(`Juros pagos: ${BRL.format(receipt.amount)}`, `Ciclo: ${receipt.cycle ?? 1}`, `Próximo vencimento: ${fmtDate(receipt.renewedDueDate)}`, 'O principal continua integralmente em aberto.');
  if (receipt.kind === 'full') lines.push(`Valor recebido: ${BRL.format(receipt.amount)}`, `Principal: ${BRL.format(receipt.principal)}`, `Juros: ${BRL.format(receipt.interest)}`, 'Situação: quitado.');
  lines.push('', '_Comprovante de controle interno, sem valor fiscal._'); return lines.join('\n');
}

function openReceipt(receipt: Receipt) {
  document.querySelector('.receipt-backdrop')?.remove();
  const backdrop = document.createElement('div'); backdrop.className = 'receipt-backdrop';
  backdrop.innerHTML = `<div class="receipt-modal" role="dialog" aria-modal="true"><div class="receipt-modal-top"><span>Comprovante digital</span><button type="button" aria-label="Fechar">×</button></div><div class="receipt-paper"><div class="receipt-brand"><div class="receipt-brand-mark">E</div><div class="receipt-brand-copy"><strong>Emprestei</strong><span>CONTROLE DE EMPRÉSTIMOS</span></div></div><div class="receipt-paper-body"><div class="receipt-type-line"><div><span>Documento</span><strong>${esc(receipt.title)}</strong></div><div class="receipt-number">${esc(receipt.number)}</div></div><div class="receipt-client"><span>Cliente</span><strong>${esc(receipt.clientName)}</strong></div><div class="receipt-grid">${bodyFields(receipt)}</div><div class="receipt-highlight"><span>${receipt.kind === 'loan' ? 'Valor entregue' : 'Valor recebido'}</span><strong>${esc(BRL.format(receipt.amount))}</strong></div><p class="receipt-disclaimer">Este comprovante é apenas para controle entre as partes e organização dentro do Emprestei. Não possui valor fiscal, bancário ou tributário.</p></div></div><div class="receipt-modal-actions"><button type="button" class="receipt-secondary">WhatsApp</button><button type="button" class="receipt-primary">Compartilhar comprovante</button></div></div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelector('.receipt-modal-top button')?.addEventListener('click', close);
  backdrop.querySelector('.receipt-secondary')?.addEventListener('click', () => shareToWhatsapp(receipt));
  backdrop.querySelector('.receipt-primary')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement; button.disabled = true; button.textContent = 'Preparando...';
    try { await shareReceiptImage(receipt); } finally { button.disabled = false; button.textContent = 'Compartilhar comprovante'; }
  });
}

function shareToWhatsapp(receipt: Receipt) {
  const number = phone(receipt.whatsapp);
  if (!/^55\d{10,11}$/.test(number)) { showMiniToast('Cadastre o WhatsApp do cliente para enviar direto.'); return; }
  window.open(`https://wa.me/${number}?text=${encodeURIComponent(receiptText(receipt))}`, '_blank', 'noopener,noreferrer');
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(' '); let line = ''; let currentY = y;
  for (const word of words) { const test = line ? `${line} ${word}` : word; if (ctx.measureText(test).width > maxWidth && line) { ctx.fillText(line, x, currentY); line = word; currentY += lineHeight; } else line = test; }
  if (line) ctx.fillText(line, x, currentY); return currentY + lineHeight;
}

async function receiptImage(receipt: Receipt) {
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas indisponível');
  ctx.fillStyle = '#f2f7f5'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(70, 60, 940, 1230, 48); ctx.fill();
  const gradient = ctx.createLinearGradient(70, 60, 1010, 330); gradient.addColorStop(0, '#12a66a'); gradient.addColorStop(1, '#08754d');
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.roundRect(70, 60, 940, 270, [48,48,0,0]); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.roundRect(120, 115, 110, 110, 30); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '900 58px Arial'; ctx.fillText('E', 158, 190); ctx.font = '900 48px Arial'; ctx.fillText('Emprestei', 270, 165); ctx.font = '700 18px Arial'; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText('COMPROVANTE DE CONTROLE', 272, 202);
  ctx.fillStyle = '#0b1925'; ctx.font = '800 34px Arial'; let y = 395; y = wrap(ctx, receipt.title, 125, y, 820, 43);
  ctx.font = '700 19px Arial'; ctx.fillStyle = '#718597'; ctx.fillText(receipt.number, 125, y + 2); y += 62;
  const rows: [string,string][] = [['Cliente', receipt.clientName], ['Data', fmtDate(receipt.date)]];
  if (receipt.kind === 'loan') rows.push(['Valor emprestado', BRL.format(receipt.principal)], ['Juros combinados', BRL.format(receipt.interest)], ['Total do ciclo', BRL.format(receipt.total)], ['Vencimento', fmtDate(receipt.dueDate)]);
  else if (receipt.kind === 'interest') rows.push(['Pagamento', BRL.format(receipt.amount)], ['Tipo', 'Somente juros'], ['Ciclo', String(receipt.cycle ?? 1)], ['Próximo vencimento', fmtDate(receipt.renewedDueDate)], ['Principal', 'Permanece em aberto']);
  else rows.push(['Valor recebido', BRL.format(receipt.amount)], ['Principal', BRL.format(receipt.principal)], ['Juros', BRL.format(receipt.interest)], ['Situação', 'Quitado']);
  for (const [label, value] of rows) { ctx.fillStyle = '#8193a2'; ctx.font = '700 17px Arial'; ctx.fillText(label.toUpperCase(), 125, y); ctx.fillStyle = '#101f2d'; ctx.font = '800 27px Arial'; y = wrap(ctx, value, 125, y + 34, 820, 34) + 24; }
  ctx.fillStyle = '#e6f9ef'; ctx.beginPath(); ctx.roundRect(120, 1050, 840, 120, 28); ctx.fill(); ctx.fillStyle = '#25855e'; ctx.font = '700 17px Arial'; ctx.fillText(receipt.kind === 'loan' ? 'VALOR ENTREGUE' : 'VALOR RECEBIDO', 150, 1092); ctx.fillStyle = '#08794d'; ctx.font = '900 42px Arial'; ctx.fillText(BRL.format(receipt.amount), 150, 1145);
  ctx.fillStyle = '#8293a0'; ctx.font = '500 16px Arial'; ctx.textAlign = 'center'; wrap(ctx, 'Comprovante de controle interno. Sem valor fiscal, bancário ou tributário.', 540, 1225, 760, 24); ctx.textAlign = 'left';
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Falha ao gerar imagem')), 'image/png', .95));
}

async function shareReceiptImage(receipt: Receipt) {
  const blob = await receiptImage(receipt); const file = new File([blob], `${receipt.number}.png`, { type: 'image/png' });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) { await navigator.share({ title: receipt.title, text: receiptText(receipt), files: [file] }); return; }
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${receipt.number}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); showMiniToast('Imagem salva. Você pode anexar no WhatsApp.');
}

function showMiniToast(text: string) {
  document.querySelector('.receipt-toast')?.remove(); const toast = document.createElement('div'); toast.className = 'receipt-toast'; toast.textContent = text; document.body.appendChild(toast); setTimeout(() => toast.remove(), 2600);
}

async function handleSuccessToast(element: Element) {
  if (seenToasts.has(element)) return; seenToasts.add(element);
  const text = element.textContent ?? '';
  if (!text.includes('Empréstimo cadastrado') && !text.includes('Empréstimo quitado') && !text.includes('Juros recebidos')) return;
  await new Promise((resolve) => setTimeout(resolve, 300)); await refreshData();
  let receipt: Receipt | undefined;
  if (text.includes('Empréstimo cadastrado')) receipt = receipts.find((item) => item.kind === 'loan');
  else receipt = receipts.find((item) => item.kind !== 'loan');
  if (receipt) setTimeout(() => openReceipt(receipt!), 180);
}

function inspectNode(node: Node) {
  if (!(node instanceof Element)) return;
  if (node.matches('.toast.success')) void handleSuccessToast(node);
  node.querySelectorAll('.toast.success').forEach((toast) => void handleSuccessToast(toast));
}
function scheduleDecorate() { clearTimeout(timer); timer = window.setTimeout(decorateClientReceipts, 60); }
const observer = new MutationObserver((mutations) => { for (const mutation of mutations) for (const node of mutation.addedNodes) inspectNode(node); scheduleDecorate(); });
if (document.body) observer.observe(document.body, { childList: true, subtree: true });
void refreshData();
supabase.auth.onAuthStateChange(() => setTimeout(() => void refreshData(), 80));
