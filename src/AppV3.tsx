import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Session } from '@supabase/supabase-js';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  History,
  Home,
  LogOut,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  UserRoundCheck,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';
import { supabase } from './lib/supabase';

type Status = 'open' | 'due' | 'late' | 'interest_paid' | 'paid';
type Tab = 'home' | 'clients' | 'calendar' | 'loans' | 'cash';
type Flash = { type: 'success' | 'error'; text: string } | null;
type PaymentKind = 'interest' | 'full';

type Client = { id: string; name: string; phone: string; note?: string };
type Loan = {
  id: string;
  clientId: string;
  principal: number;
  receivable: number;
  interestAmount: number;
  outstandingPrincipal: number;
  currentInterestDue: number;
  dueDate: string;
  createdAt: string;
  dbStatus: string;
  cycleNumber: number;
  lastPaymentType?: string | null;
};
type Payment = {
  id: string;
  loanId: string;
  amount: number;
  paidAt: string;
  paymentType: string;
  appliedToInterest: number;
  appliedToPrincipal: number;
  cycleNumber: number;
  renewedDueDate?: string | null;
  dueDateSnapshot?: string | null;
  wasLate: boolean;
};
type Store = { openingCash: number; cashAccountId: string | null; clients: Client[]; loans: Loan[]; payments: Payment[] };
type NewLoanInput = { clientId?: string; name?: string; phone?: string; principal: number; receivable: number; dueDate: string };
type PaymentInput = { type: PaymentKind; newDueDate?: string };
type RiskInfo = { score: number; label: string; tone: 'good' | 'watch' | 'risk'; detail: string };

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const FULL_DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
const MONTH = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const EMPTY_STORE: Store = { openingCash: 0, cashAccountId: null, clients: [], loans: [], payments: [] };

function localTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function dateFromKey(value: string) { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d, 12); }
function daysUntil(value: string) {
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Math.round((dateFromKey(value).getTime() - today.getTime()) / 86400000);
}
function openBalance(loan: Loan) { return Math.max(loan.outstandingPrincipal + loan.currentInterestDue, 0); }
function getStatus(loan: Loan): Status {
  if (loan.dbStatus === 'paid' || openBalance(loan) <= 0) return 'paid';
  const delta = daysUntil(loan.dueDate);
  if (delta < 0) return 'late';
  if (delta === 0) return 'due';
  if (loan.dbStatus === 'interest_paid') return 'interest_paid';
  return 'open';
}
function statusLabel(status: Status) { return { open: 'Em aberto', due: 'Vence hoje', late: 'Atrasado', interest_paid: 'Juros pagos', paid: 'Quitado' }[status]; }
function initials(name: string) { return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'E'; }
function safePhone(phone: string) { const digits = phone.replace(/\D/g, ''); return (digits.length === 10 || digits.length === 11) && !digits.startsWith('55') ? `55${digits}` : digits; }
function greeting() { const hour = new Date().getHours(); return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'; }
function reminderPhrase(loan: Loan) {
  const delta = daysUntil(loan.dueDate);
  if (delta < 0) return `está atrasado há ${Math.abs(delta)} dia${Math.abs(delta) === 1 ? '' : 's'}`;
  if (delta === 0) return 'vence hoje';
  if (delta === 1) return 'vence amanhã';
  return `vence em ${delta} dias`;
}
function paymentDate(value: string) { return new Date(value); }
function clamp(value: number, min: number, max: number) { return Math.min(Math.max(value, min), max); }

async function showSystemNotification(loan: Loan, client: Client) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
  const today = localTodayKey(); const key = `emprestei-notified:${today}:${loan.id}`;
  if (localStorage.getItem(key)) return;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(`Emprestei · ${client.name}`, {
    body: `${reminderPhrase(loan)}. ${BRL.format(openBalance(loan))} em aberto.`,
    icon: '/emprestei-icon.svg', tag: `emprestei-${loan.id}-${today}`, data: { url: `/?loan=${loan.id}` },
  });
  localStorage.setItem(key, '1');
}

export default function AppV3() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [store, setStore] = useState<Store>(EMPTY_STORE);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  const [showNewLoan, setShowNewLoan] = useState(false);
  const [paymentLoan, setPaymentLoan] = useState<Loan | null>(null);
  const [showCashEditor, setShowCashEditor] = useState(false);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [activeLoanId, setActiveLoanId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [flash, setFlash] = useState<Flash>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthReady(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!session) { setStore(EMPTY_STORE); setLoadedOnce(false); return; }
    void loadData(session);
  }, [authReady, session?.user.id]);

  useEffect(() => {
    if (!loadedOnce || notificationPermission !== 'granted') return;
    const candidates = store.loans.filter((loan) => getStatus(loan) !== 'paid' && loan.dbStatus !== 'cancelled' && daysUntil(loan.dueDate) <= 1);
    for (const loan of candidates) { const client = store.clients.find((item) => item.id === loan.clientId); if (client) void showSystemNotification(loan, client); }
  }, [loadedOnce, notificationPermission, store.loans, store.clients]);

  function showFlash(type: 'success' | 'error', text: string) { setFlash({ type, text }); window.setTimeout(() => setFlash(null), 3400); }

  async function requestNotifications() {
    if (!('Notification' in window)) return showFlash('error', 'Este navegador não oferece notificações.');
    const permission = await Notification.requestPermission(); setNotificationPermission(permission);
    showFlash(permission === 'granted' ? 'success' : 'error', permission === 'granted' ? 'Avisos no celular ativados.' : 'Permissão de notificações não foi concedida.');
  }

  async function loadData(activeSession = session) {
    if (!activeSession) return;
    setSyncing(true);
    try {
      const userId = activeSession.user.id;
      const displayName = activeSession.user.user_metadata?.display_name || activeSession.user.email?.split('@')[0] || 'Usuário';
      const profileResult = await supabase.from('profiles').upsert({ id: userId, display_name: displayName });
      if (profileResult.error) throw profileResult.error;
      const [clientsResult, loansResult, paymentsResult, cashResult] = await Promise.all([
        supabase.from('clients').select('id,name,whatsapp,notes,created_at').eq('owner_id', userId).order('created_at', { ascending: false }),
        supabase.from('loans').select('id,client_id,principal,total_receivable,interest_amount,outstanding_principal,current_interest_due,due_date,loan_date,status,cycle_number,last_payment_type,created_at').eq('owner_id', userId).order('created_at', { ascending: false }),
        supabase.from('payments').select('id,loan_id,amount,paid_at,payment_type,applied_to_interest,applied_to_principal,cycle_number,renewed_due_date,due_date_snapshot,was_late').eq('owner_id', userId).order('paid_at', { ascending: false }),
        supabase.from('cash_accounts').select('id,opening_balance').eq('owner_id', userId).order('created_at', { ascending: true }).limit(1).maybeSingle(),
      ]);
      if (clientsResult.error) throw clientsResult.error; if (loansResult.error) throw loansResult.error; if (paymentsResult.error) throw paymentsResult.error; if (cashResult.error) throw cashResult.error;
      let cashAccount = cashResult.data;
      if (!cashAccount) {
        const created = await supabase.from('cash_accounts').insert({ owner_id: userId, name: 'Caixa principal', opening_balance: 0 }).select('id,opening_balance').single();
        if (created.error) throw created.error; cashAccount = created.data;
      }
      setStore({
        openingCash: Number(cashAccount.opening_balance), cashAccountId: cashAccount.id,
        clients: (clientsResult.data ?? []).map((c) => ({ id: c.id, name: c.name, phone: c.whatsapp, note: c.notes ?? undefined })),
        loans: (loansResult.data ?? []).map((l) => ({
          id: l.id, clientId: l.client_id, principal: Number(l.principal), receivable: Number(l.total_receivable),
          interestAmount: Number(l.interest_amount ?? Math.max(Number(l.total_receivable) - Number(l.principal), 0)),
          outstandingPrincipal: Number(l.outstanding_principal ?? l.principal), currentInterestDue: Number(l.current_interest_due ?? Math.max(Number(l.total_receivable) - Number(l.principal), 0)),
          dueDate: l.due_date, createdAt: l.loan_date, dbStatus: l.status, cycleNumber: Number(l.cycle_number ?? 1), lastPaymentType: l.last_payment_type,
        })),
        payments: (paymentsResult.data ?? []).map((p) => ({
          id: p.id, loanId: p.loan_id, amount: Number(p.amount), paidAt: p.paid_at, paymentType: p.payment_type,
          appliedToInterest: Number(p.applied_to_interest ?? 0), appliedToPrincipal: Number(p.applied_to_principal ?? 0), cycleNumber: Number(p.cycle_number ?? 1),
          renewedDueDate: p.renewed_due_date, dueDateSnapshot: p.due_date_snapshot, wasLate: Boolean(p.was_late),
        })),
      });
      setLoadedOnce(true);
    } catch (error) { showFlash('error', error instanceof Error ? error.message : 'Não foi possível sincronizar os dados.'); }
    finally { setSyncing(false); }
  }

  const metrics = useMemo(() => {
    const active = store.loans.filter((l) => l.dbStatus !== 'cancelled' && getStatus(l) !== 'paid');
    const issuedPrincipal = store.loans.filter((l) => l.dbStatus !== 'cancelled').reduce((s, l) => s + l.principal, 0);
    const principalOut = active.reduce((s, l) => s + l.outstandingPrincipal, 0);
    const received = store.payments.reduce((s, p) => s + p.amount, 0);
    const interestReceived = store.payments.reduce((s, p) => s + p.appliedToInterest, 0);
    const toReceive = active.reduce((s, l) => s + openBalance(l), 0);
    const expectedProfit = active.reduce((s, l) => s + l.currentInterestDue, 0);
    const availableCash = store.openingCash - issuedPrincipal + received;
    const overdue = active.filter((l) => getStatus(l) === 'late').length;
    const dueToday = active.filter((l) => getStatus(l) === 'due').length;
    return { active, principalOut, received, interestReceived, toReceive, expectedProfit, availableCash, overdue, dueToday };
  }, [store]);

  const reminders = useMemo(() => [...store.loans].filter((l) => l.dbStatus !== 'cancelled' && getStatus(l) !== 'paid' && daysUntil(l.dueDate) <= 2).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [store.loans]);
  const upcoming = useMemo(() => [...store.loans].filter((l) => l.dbStatus !== 'cancelled' && getStatus(l) !== 'paid').sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5), [store.loans]);
  const filteredClients = store.clients.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(search.toLowerCase()));
  const getClient = (id: string) => store.clients.find((c) => c.id === id);
  const getLoanPayments = (loanId: string) => store.payments.filter((p) => p.loanId === loanId);

  function riskForClient(clientId: string): RiskInfo {
    const loanIds = new Set(store.loans.filter((l) => l.clientId === clientId).map((l) => l.id));
    const payments = store.payments.filter((p) => loanIds.has(p.loanId));
    const activeLate = store.loans.filter((l) => l.clientId === clientId && getStatus(l) === 'late').length;
    const latePayments = payments.filter((p) => p.wasLate).length;
    const onTime = payments.length - latePayments;
    const score = clamp(82 + Math.min(onTime * 3, 12) - latePayments * 16 - activeLate * 25, 15, 99);
    if (activeLate > 0 || score < 60) return { score, label: 'Atenção', tone: 'risk', detail: activeLate > 0 ? `${activeLate} empréstimo(s) atrasado(s) agora` : `${latePayments} pagamento(s) após o vencimento` };
    if (payments.length >= 2 && latePayments === 0 && score >= 85) return { score, label: 'Bom pagador', tone: 'good', detail: `${payments.length} pagamento(s) sem atraso registrado` };
    return { score, label: 'Em observação', tone: 'watch', detail: payments.length ? `${onTime} em dia · ${latePayments} com atraso` : 'Ainda sem histórico suficiente' };
  }

  function openWhatsapp(client: Client, loan?: Loan) {
    let message = `Olá, ${client.name.split(' ')[0]}! Tudo bem?`;
    if (loan) message = `Olá, ${client.name.split(' ')[0]}! Passando para lembrar que seu empréstimo ${reminderPhrase(loan)}. O valor para quitar é ${BRL.format(openBalance(loan))}, sendo ${BRL.format(loan.outstandingPrincipal)} de principal e ${BRL.format(loan.currentInterestDue)} de juros. Você pretende pagar somente os juros (${BRL.format(loan.currentInterestDue)}) para renovar ou quitar o valor total (${BRL.format(openBalance(loan))})? Me avise por aqui, por favor.`;
    window.open(`https://wa.me/${safePhone(client.phone)}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  }

  async function createLoan(data: NewLoanInput) {
    if (!session) return; setSyncing(true);
    try {
      let clientId = data.clientId;
      if (!clientId) {
        const created = await supabase.from('clients').insert({ owner_id: session.user.id, name: data.name?.trim(), whatsapp: safePhone(data.phone ?? '') }).select('id').single();
        if (created.error) throw created.error; clientId = created.data.id;
      }
      const interest = Math.max(data.receivable - data.principal, 0);
      const result = await supabase.from('loans').insert({ owner_id: session.user.id, client_id: clientId, principal: data.principal, total_receivable: data.receivable, interest_amount: interest, outstanding_principal: data.principal, current_interest_due: interest, due_date: data.dueDate, loan_date: localTodayKey(), status: 'open', cycle_number: 1 });
      if (result.error) throw result.error;
      setShowNewLoan(false); await loadData(session); showFlash('success', 'Empréstimo cadastrado com sucesso.');
    } catch (error) { showFlash('error', error instanceof Error ? error.message : 'Erro ao cadastrar o empréstimo.'); }
    finally { setSyncing(false); }
  }

  async function registerPayment(loan: Loan, input: PaymentInput) {
    if (!session) return; setSyncing(true);
    try {
      const { error } = await supabase.rpc('record_loan_payment', { p_loan_id: loan.id, p_payment_type: input.type, p_amount: null, p_new_due_date: input.type === 'interest' ? input.newDueDate ?? null : null, p_renew_interest: true });
      if (error) throw error;
      setPaymentLoan(null); await loadData(session);
      showFlash('success', input.type === 'full' ? 'Empréstimo quitado. Caixa atualizado.' : 'Juros recebidos. Novo ciclo iniciado com o mesmo valor total.');
    } catch (error) { showFlash('error', error instanceof Error ? error.message : 'Erro ao registrar pagamento.'); }
    finally { setSyncing(false); }
  }

  async function updateOpeningCash(amount: number) {
    if (!session || !store.cashAccountId || amount < 0) return; setSyncing(true);
    try {
      const result = await supabase.from('cash_accounts').update({ opening_balance: amount }).eq('id', store.cashAccountId).eq('owner_id', session.user.id);
      if (result.error) throw result.error; setShowCashEditor(false); await loadData(session); showFlash('success', 'Caixa inicial atualizado.');
    } catch (error) { showFlash('error', error instanceof Error ? error.message : 'Erro ao atualizar o caixa.'); }
    finally { setSyncing(false); }
  }

  async function handleSignIn(email: string, password: string) { const result = await supabase.auth.signInWithPassword({ email, password }); if (result.error) throw result.error; showFlash('success', 'Bem-vindo ao Emprestei.'); }
  async function handleSignUp(name: string, email: string, password: string) { const result = await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } }); if (result.error) throw result.error; showFlash('success', result.data.session ? 'Conta criada. Seu painel está pronto.' : 'Conta criada. Faça login para continuar.'); }

  if (!authReady) return <LoadingScreen text="Preparando seu painel" />;
  if (!session) return <AuthScreen onSignIn={handleSignIn} onSignUp={handleSignUp} />;
  if (!loadedOnce) return <LoadingScreen text="Sincronizando seus dados" />;

  const displayName = session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'Você';
  const activeClient = activeClientId ? getClient(activeClientId) : undefined;
  const activeLoan = activeLoanId ? store.loans.find((l) => l.id === activeLoanId) : undefined;

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <AnimatePresence>{flash && <motion.div className={`toast ${flash.type}`} initial={{ opacity: 0, y: -14, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: -12, x: '-50%' }}>{flash.type === 'success' ? <Check size={18} /> : <X size={18} />}{flash.text}</motion.div>}</AnimatePresence>

      <main className="app-content">
        <AnimatePresence mode="wait">
          {tab === 'home' && <motion.section key="home" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <header className="topbar"><div><p className="eyebrow">Visão geral</p><h1>{greeting()}, {displayName.split(' ')[0]} 👋</h1><p className="welcome-subtitle">Controle, previsibilidade e lucro em um só lugar.</p></div><button className="profile-pill" onClick={() => void supabase.auth.signOut()} title="Sair"><span className="sync-dot" /><span>{syncing ? 'Sincronizando' : 'Online'}</span><LogOut size={17} /></button></header>
            <section className="hero-card"><div className="hero-topline"><span>Caixa disponível</span><WalletCards size={22} /></div><strong>{BRL.format(metrics.availableCash)}</strong><div className="hero-foot"><span><TrendingUp size={17} /> {BRL.format(metrics.expectedProfit)} de juros previstos</span><button onClick={() => setShowNewLoan(true)}><Plus size={19} /> Novo empréstimo</button></div></section>
            <div className="metrics-grid"><Metric icon={<Banknote />} label="Emprestado" value={BRL.format(metrics.principalOut)} hint="Capital na rua" tone="blue" /><Metric icon={<ArrowDownLeft />} label="A receber" value={BRL.format(metrics.toReceive)} hint="Total dos ciclos atuais" tone="blue" /><Metric icon={<ArrowUpRight />} label="Juros recebidos" value={BRL.format(metrics.interestReceived)} hint="Lucro realizado" tone="green" /><Metric icon={<Clock3 />} label="Atrasados" value={`${metrics.overdue}`} hint={metrics.dueToday ? `${metrics.dueToday} vence hoje` : 'Precisam de atenção'} tone={metrics.overdue > 0 ? 'red' : 'neutral'} /></div>
            <ProfitInsights store={store} metrics={metrics} />
            <section className="alert-center"><div className="section-heading alert-heading"><div><p className="eyebrow">Central de avisos</p><h2>Vencimentos e cobranças</h2></div><BellRing size={21} /></div>{notificationPermission === 'default' && <button className="notification-optin" onClick={requestNotifications}><Bell size={18} /><span><strong>Ativar avisos no celular</strong><small>Receba alertas quando um cliente estiver vencendo.</small></span><ChevronRight size={18} /></button>}{reminders.length === 0 ? <EmptyState title="Tudo em dia por aqui" text="Quando um cliente estiver perto do vencimento, o aviso aparecerá nesta área." /> : <div className="reminder-list">{reminders.map((loan) => { const client = getClient(loan.clientId); return client ? <ReminderCard key={loan.id} loan={loan} client={client} onWhatsapp={openWhatsapp} onPayment={setPaymentLoan} onClient={() => { setActiveClientId(client.id); setTab('clients'); }} /> : null; })}</div>}</section>
            <section className="section-card"><div className="section-heading"><div><p className="eyebrow">Agenda financeira</p><h2>Próximos recebimentos</h2></div><button className="section-icon-button" onClick={() => setTab('calendar')}><CalendarDays size={20} /></button></div><div className="loan-list">{upcoming.length === 0 && <EmptyState title="Nenhum recebimento pendente" text="Quando você cadastrar um empréstimo, os próximos vencimentos aparecem aqui." />}{upcoming.map((loan) => { const client = getClient(loan.clientId); return client ? <LoanRow key={loan.id} loan={loan} client={client} onWhatsapp={openWhatsapp} onPayment={setPaymentLoan} onDetails={() => setActiveLoanId(loan.id)} /> : null; })}</div></section>
          </motion.section>}

          {tab === 'clients' && <motion.section key="clients" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            {activeClient ? <ClientDetail client={activeClient} store={store} risk={riskForClient(activeClient.id)} onBack={() => setActiveClientId(null)} onWhatsapp={() => openWhatsapp(activeClient)} onLoan={(id) => setActiveLoanId(id)} onPayment={setPaymentLoan} /> : <><PageHeader eyebrow="Relacionamentos" title="Clientes" action={() => setShowNewLoan(true)} /><div className="search-box"><Search size={18} /><input placeholder="Buscar cliente ou WhatsApp" value={search} onChange={(e) => setSearch(e.target.value)} /></div><div className="client-grid">{filteredClients.length === 0 && <EmptyState title="Nenhum cliente encontrado" text="Cadastre um novo empréstimo para adicionar seu primeiro cliente." />}{filteredClients.map((client) => { const loans = store.loans.filter((l) => l.clientId === client.id && l.dbStatus !== 'cancelled'); const balance = loans.reduce((s, l) => s + (getStatus(l) === 'paid' ? 0 : openBalance(l)), 0); const risk = riskForClient(client.id); return <motion.article whileTap={{ scale: .985 }} className="client-card client-card-rich" key={client.id} onClick={() => setActiveClientId(client.id)}><div className="avatar">{initials(client.name)}</div><div className="client-main"><div className="client-name-line"><strong>{client.name}</strong><RiskBadge risk={risk} compact /></div><span>{client.phone}</span><small>{loans.length} empréstimo(s) · {BRL.format(balance)} pendente</small></div><ChevronRight size={19} /></motion.article>; })}</div></>}
          </motion.section>}

          {tab === 'calendar' && <motion.section key="calendar" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}><FinancialCalendar store={store} getClient={getClient} onPayment={setPaymentLoan} onWhatsapp={openWhatsapp} onLoan={(id) => setActiveLoanId(id)} /></motion.section>}

          {tab === 'loans' && <motion.section key="loans" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}><PageHeader eyebrow="Carteira" title="Empréstimos" action={() => setShowNewLoan(true)} /><div className="loan-list expanded">{store.loans.length === 0 && <EmptyState title="Sua carteira está vazia" text="Use o botão + para cadastrar o primeiro empréstimo." />}{store.loans.filter((l) => l.dbStatus !== 'cancelled').map((loan) => { const client = getClient(loan.clientId); return client ? <LoanRow key={loan.id} loan={loan} client={client} onWhatsapp={openWhatsapp} onPayment={setPaymentLoan} onDetails={() => setActiveLoanId(loan.id)} /> : null; })}</div></motion.section>}

          {tab === 'cash' && <motion.section key="cash" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}><PageHeader eyebrow="Financeiro" title="Meu caixa" /><section className="cash-panel"><div className="cash-ring"><CircleDollarSign size={34} /></div><span>Saldo livre para emprestar</span><strong>{BRL.format(metrics.availableCash)}</strong><p>Seu caixa considera o capital inicial, empréstimos liberados e tudo que já voltou em juros ou principal.</p><div className="cash-actions"><button className="secondary-action" onClick={() => setShowCashEditor(true)}><Pencil size={17} /> Ajustar caixa inicial</button></div></section><div className="metrics-grid"><Metric icon={<WalletCards />} label="Caixa inicial" value={BRL.format(store.openingCash)} hint="Capital configurado" /><Metric icon={<Banknote />} label="Na rua" value={BRL.format(metrics.principalOut)} hint="Principal pendente" /><Metric icon={<ArrowDownLeft />} label="Retornou" value={BRL.format(metrics.received)} hint="Tudo que entrou" tone="green" /><Metric icon={<TrendingUp />} label="Juros recebidos" value={BRL.format(metrics.interestReceived)} hint="Lucro realizado" tone="green" /></div></motion.section>}
        </AnimatePresence>
      </main>

      <nav className="bottom-nav bottom-nav-six"><NavButton active={tab === 'home'} onClick={() => { setTab('home'); setActiveClientId(null); }} icon={<Home />} label="Início" /><NavButton active={tab === 'clients'} onClick={() => { setTab('clients'); setActiveClientId(null); }} icon={<UsersRound />} label="Clientes" /><button className="nav-main-action" onClick={() => setShowNewLoan(true)}><Plus size={25} /></button><NavButton active={tab === 'calendar'} onClick={() => setTab('calendar')} icon={<CalendarDays />} label="Agenda" /><NavButton active={tab === 'loans'} onClick={() => setTab('loans')} icon={<Banknote />} label="Carteira" /><NavButton active={tab === 'cash'} onClick={() => setTab('cash')} icon={<WalletCards />} label="Caixa" /></nav>

      <AnimatePresence>
        {showNewLoan && <NewLoanModal clients={store.clients} busy={syncing} onClose={() => setShowNewLoan(false)} onSubmit={createLoan} />}
        {paymentLoan && <PaymentModal loan={paymentLoan} client={getClient(paymentLoan.clientId)} busy={syncing} onClose={() => setPaymentLoan(null)} onSubmit={(input) => registerPayment(paymentLoan, input)} />}
        {showCashEditor && <CashModal current={store.openingCash} busy={syncing} onClose={() => setShowCashEditor(false)} onSubmit={updateOpeningCash} />}
        {activeLoan && <LoanDetailModal loan={activeLoan} client={getClient(activeLoan.clientId)} payments={getLoanPayments(activeLoan.id)} onClose={() => setActiveLoanId(null)} onPayment={() => { setActiveLoanId(null); setPaymentLoan(activeLoan); }} onWhatsapp={() => { const c = getClient(activeLoan.clientId); if (c) openWhatsapp(c, activeLoan); }} />}
      </AnimatePresence>
    </div>
  );
}

function Metric({ icon, label, value, hint, tone = 'neutral' }: { icon: ReactNode; label: string; value: string; hint: string; tone?: 'neutral' | 'blue' | 'green' | 'red' }) { return <motion.article whileHover={{ y: -2 }} className={`metric-card metric-${tone}`}><div className="metric-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{hint}</small></motion.article>; }
function PageHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: () => void }) { return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>{action && <button className="round-add" onClick={action}><Plus size={20} /></button>}</header>; }
function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) { return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><Sparkles size={23} /><strong>{title}</strong><span>{text}</span></div>; }

function RiskBadge({ risk, compact = false }: { risk: RiskInfo; compact?: boolean }) { return <span className={`risk-badge risk-${risk.tone} ${compact ? 'compact' : ''}`}>{risk.tone === 'good' ? <UserRoundCheck size={compact ? 13 : 17} /> : risk.tone === 'risk' ? <ShieldAlert size={compact ? 13 : 17} /> : <Star size={compact ? 13 : 17} />}<span>{risk.label}</span>{!compact && <strong>{risk.score}</strong>}</span>; }

function ReminderCard({ loan, client, onWhatsapp, onPayment, onClient }: { loan: Loan; client: Client; onWhatsapp: (c: Client, l: Loan) => void; onPayment: (l: Loan) => void; onClient: () => void }) {
  const status = getStatus(loan);
  return <article className={`reminder-card reminder-${status}`}><button className="reminder-person" onClick={onClient}><div className="reminder-icon">{status === 'late' ? <AlertTriangle /> : <Clock3 />}</div><div className="reminder-copy"><strong>{client.name}</strong><span>{reminderPhrase(loan)} · {BRL.format(openBalance(loan))}</span><small>Juros {BRL.format(loan.currentInterestDue)} · Principal {BRL.format(loan.outstandingPrincipal)}</small></div></button><div className="reminder-actions"><button className="remind-whatsapp" onClick={() => onWhatsapp(client, loan)}><MessageCircle size={16} /> Lembrar</button><button className="remind-pay" onClick={() => onPayment(loan)}><Check size={16} /> Receber</button></div></article>;
}

function LoanRow({ loan, client, onWhatsapp, onPayment, onDetails }: { loan: Loan; client: Client; onWhatsapp: (c: Client, l: Loan) => void; onPayment: (l: Loan) => void; onDetails: () => void }) {
  const status = getStatus(loan);
  return <motion.article layout className={`loan-row loan-${status}`}><button className="loan-row-main" onClick={onDetails}><div className="avatar small">{initials(client.name)}</div><div className="loan-info"><div className="loan-title"><strong>{client.name}</strong><span className={`status ${status}`}>{statusLabel(status)}</span></div><div className="loan-meta"><span>{DATE.format(dateFromKey(loan.dueDate))}</span><span>•</span><span>Ciclo {loan.cycleNumber}</span><span>•</span><span>Juros {BRL.format(loan.currentInterestDue)}</span></div></div><div className="loan-value"><strong>{BRL.format(openBalance(loan))}</strong><span>{status === 'paid' ? 'quitado' : 'em aberto'}</span></div></button><div className="row-actions">{status !== 'paid' && <button className="mini-btn whatsapp" onClick={() => onWhatsapp(client, loan)}><MessageCircle size={17} /></button>}{status !== 'paid' && <button className="mini-btn paid" onClick={() => onPayment(loan)}><Check size={17} /></button>}<ChevronRight size={18} className="chevron" /></div></motion.article>;
}

function ProfitInsights({ store, metrics }: { store: Store; metrics: { interestReceived: number; principalOut: number; expectedProfit: number } }) {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, idx) => { const d = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1); return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(d).replace('.', '') }; });
  const data = months.map((m) => ({ ...m, value: store.payments.filter((p) => p.paidAt.slice(0, 7) === m.key).reduce((s, p) => s + p.appliedToInterest, 0) }));
  const max = Math.max(...data.map((d) => d.value), 1); const current = data[data.length - 1]?.value ?? 0; const previous = data[data.length - 2]?.value ?? 0;
  const variation = previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0;
  return <section className="profit-suite"><div className="section-heading"><div><p className="eyebrow">Performance</p><h2>Lucro e capital</h2></div><BarChart3 size={21} /></div><div className="profit-kpis"><div><span>Juros neste mês</span><strong>{BRL.format(current)}</strong><small className={variation >= 0 ? 'positive' : 'negative'}>{variation >= 0 ? '+' : ''}{variation.toFixed(0)}% vs. mês anterior</small></div><div><span>Juros acumulados</span><strong>{BRL.format(metrics.interestReceived)}</strong><small>Lucro realizado</small></div><div><span>Capital ativo</span><strong>{BRL.format(metrics.principalOut)}</strong><small>{BRL.format(metrics.expectedProfit)} de juros no ciclo</small></div></div><div className="profit-bars">{data.map((item) => <div className="profit-bar-col" key={item.key}><div className="profit-bar-value">{item.value > 0 ? BRL.format(item.value) : ''}</div><div className="profit-bar-track"><motion.div className="profit-bar-fill" initial={{ height: 0 }} animate={{ height: `${Math.max((item.value / max) * 100, item.value > 0 ? 8 : 2)}%` }} /></div><span>{item.label}</span></div>)}</div></section>;
}

function ClientDetail({ client, store, risk, onBack, onWhatsapp, onLoan, onPayment }: { client: Client; store: Store; risk: RiskInfo; onBack: () => void; onWhatsapp: () => void; onLoan: (id: string) => void; onPayment: (loan: Loan) => void }) {
  const loans = store.loans.filter((l) => l.clientId === client.id && l.dbStatus !== 'cancelled');
  const loanIds = new Set(loans.map((l) => l.id)); const payments = store.payments.filter((p) => loanIds.has(p.loanId));
  const active = loans.filter((l) => getStatus(l) !== 'paid'); const principal = active.reduce((s, l) => s + l.outstandingPrincipal, 0); const due = active.reduce((s, l) => s + openBalance(l), 0); const interestEarned = payments.reduce((s, p) => s + p.appliedToInterest, 0); const interestCycles = payments.filter((p) => p.paymentType === 'interest').length;
  return <div className="client-detail"><header className="detail-header"><button className="detail-back" onClick={onBack}><ArrowLeft size={20} /></button><div className="avatar detail-avatar">{initials(client.name)}</div><div className="detail-person"><p className="eyebrow">Perfil do cliente</p><h1>{client.name}</h1><span>{client.phone}</span></div><button className="icon-btn whatsapp" onClick={onWhatsapp}><MessageCircle size={20} /></button></header><section className="risk-panel"><div><span className="risk-kicker">Histórico interno</span><RiskBadge risk={risk} /></div><div className="risk-score"><strong>{risk.score}</strong><span>/ 100</span></div><p>{risk.detail}. Esta classificação considera apenas o histórico registrado dentro do Emprestei.</p></section><div className="client-stats"><div><span>Principal na rua</span><strong>{BRL.format(principal)}</strong></div><div><span>Total do ciclo</span><strong>{BRL.format(due)}</strong></div><div><span>Juros já gerados</span><strong>{BRL.format(interestEarned)}</strong></div><div><span>Renovações</span><strong>{interestCycles}</strong></div></div><section className="detail-section"><div className="section-heading"><div><p className="eyebrow">Carteira</p><h2>Empréstimos do cliente</h2></div><History size={20} /></div><div className="client-loan-stack">{loans.length === 0 ? <EmptyState title="Sem empréstimos" text="Nenhuma operação encontrada para este cliente." /> : loans.map((loan) => <article className={`client-loan-card loan-${getStatus(loan)}`} key={loan.id}><button onClick={() => onLoan(loan.id)}><div><span className={`status ${getStatus(loan)}`}>{statusLabel(getStatus(loan))}</span><strong>{BRL.format(openBalance(loan))}</strong><small>Principal {BRL.format(loan.outstandingPrincipal)} · Juros {BRL.format(loan.currentInterestDue)}</small></div><div><span>Ciclo {loan.cycleNumber}</span><small>Vence {DATE.format(dateFromKey(loan.dueDate))}</small><span className="text-link">Ver extrato →</span></div></button>{getStatus(loan) !== 'paid' && <button className="client-receive" onClick={() => onPayment(loan)}><Check size={16} /> Receber</button>}</article>)}</div></section><section className="detail-section"><div className="section-heading"><div><p className="eyebrow">Movimentações</p><h2>Últimos recebimentos</h2></div><CircleDollarSign size={20} /></div><div className="mini-statement">{payments.length === 0 ? <EmptyState title="Sem recebimentos" text="O histórico aparecerá aqui após o primeiro pagamento." /> : payments.slice().sort((a, b) => b.paidAt.localeCompare(a.paidAt)).slice(0, 8).map((p) => <div className="statement-row" key={p.id}><div className={`statement-dot ${p.paymentType}`} /><div><strong>{p.paymentType === 'interest' ? `Juros do ciclo ${p.cycleNumber}` : 'Quitação total'}</strong><span>{FULL_DATE.format(paymentDate(p.paidAt))}{p.wasLate ? ' · após vencimento' : ' · em dia'}</span></div><strong>{BRL.format(p.amount)}</strong></div>)}</div></section></div>;
}

function LoanDetailModal({ loan, client, payments, onClose, onPayment, onWhatsapp }: { loan: Loan; client?: Client; payments: Payment[]; onClose: () => void; onPayment: () => void; onWhatsapp: () => void }) {
  const status = getStatus(loan); const ordered = [...payments].sort((a, b) => a.paidAt.localeCompare(b.paidAt));
  return <Modal onClose={onClose} eyebrow="Extrato do empréstimo" title={client?.name ?? 'Empréstimo'} wide><div className={`loan-detail-hero loan-${status}`}><div><span className={`status ${status}`}>{statusLabel(status)}</span><strong>{BRL.format(openBalance(loan))}</strong><small>Principal {BRL.format(loan.outstandingPrincipal)} · Juros do ciclo {BRL.format(loan.currentInterestDue)}</small></div><div><span>Ciclo atual</span><strong>{loan.cycleNumber}</strong><small>Vence {FULL_DATE.format(dateFromKey(loan.dueDate))}</small></div></div><div className="timeline"><div className="timeline-item created"><div className="timeline-dot"><Banknote size={15} /></div><div><span>{FULL_DATE.format(dateFromKey(loan.createdAt))}</span><strong>Empréstimo liberado</strong><p>{BRL.format(loan.principal)} entregues · juros combinados de {BRL.format(loan.interestAmount)}.</p></div></div>{ordered.map((p) => <div className={`timeline-item ${p.paymentType}`} key={p.id}><div className="timeline-dot">{p.paymentType === 'full' ? <Check size={15} /> : <TrendingUp size={15} />}</div><div><span>{FULL_DATE.format(paymentDate(p.paidAt))}</span><strong>{p.paymentType === 'full' ? 'Quitação total' : `Juros do ciclo ${p.cycleNumber} recebidos`}</strong><p>{BRL.format(p.amount)} recebidos{p.wasLate ? ' após o vencimento' : ' em dia'}.{p.paymentType === 'interest' && p.renewedDueDate ? ` Renovado para ${FULL_DATE.format(dateFromKey(p.renewedDueDate))}.` : ''}</p></div></div>)}</div>{status !== 'paid' && <div className="detail-actions"><button className="secondary-action" onClick={onWhatsapp}><MessageCircle size={17} /> Lembrar no WhatsApp</button><button className="primary-action" onClick={onPayment}><Check size={18} /> Registrar recebimento</button></div>}</Modal>;
}

function FinancialCalendar({ store, getClient, onPayment, onWhatsapp, onLoan }: { store: Store; getClient: (id: string) => Client | undefined; onPayment: (l: Loan) => void; onWhatsapp: (c: Client, l: Loan) => void; onLoan: (id: string) => void }) {
  const now = new Date(); const [cursor, setCursor] = useState(new Date(now.getFullYear(), now.getMonth(), 1)); const [selected, setSelected] = useState(localTodayKey());
  const year = cursor.getFullYear(); const month = cursor.getMonth(); const count = new Date(year, month + 1, 0).getDate(); const offset = new Date(year, month, 1).getDay();
  const dayKey = (day: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const selectedLoans = store.loans.filter((l) => l.dueDate === selected && l.dbStatus !== 'cancelled');
  const monthLoans = store.loans.filter((l) => l.dueDate.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`) && l.dbStatus !== 'cancelled');
  const monthTotal = monthLoans.filter((l) => getStatus(l) !== 'paid').reduce((s, l) => s + openBalance(l), 0);
  function tone(loans: Loan[], key: string) { if (!loans.length) return ''; if (loans.every((l) => getStatus(l) === 'paid')) return 'cal-paid'; if (loans.some((l) => l.dbStatus === 'interest_paid' && getStatus(l) !== 'late' && getStatus(l) !== 'due')) return 'cal-interest'; if (key < localTodayKey() && loans.some((l) => getStatus(l) !== 'paid')) return 'cal-late'; if (key === localTodayKey() && loans.some((l) => getStatus(l) !== 'paid')) return 'cal-today'; return 'cal-open'; }
  return <div className="calendar-screen"><PageHeader eyebrow="Agenda financeira" title="Calendário" /><section className="calendar-summary"><div><span>Previsto neste mês</span><strong>{BRL.format(monthTotal)}</strong></div><div><span>Vencimentos</span><strong>{monthLoans.filter((l) => getStatus(l) !== 'paid').length}</strong></div><div><span>Atrasados agora</span><strong>{store.loans.filter((l) => getStatus(l) === 'late').length}</strong></div></section><section className="calendar-card"><div className="calendar-toolbar"><button onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={20} /></button><strong>{MONTH.format(cursor)}</strong><button onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight size={20} /></button></div><div className="calendar-week"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div><div className="calendar-grid">{Array.from({ length: offset }).map((_, i) => <div className="calendar-empty" key={`e${i}`} />)}{Array.from({ length: count }, (_, i) => i + 1).map((day) => { const key = dayKey(day); const loans = store.loans.filter((l) => l.dueDate === key && l.dbStatus !== 'cancelled'); const amount = loans.filter((l) => getStatus(l) !== 'paid').reduce((s, l) => s + openBalance(l), 0); return <button key={key} className={`calendar-day ${tone(loans, key)} ${selected === key ? 'selected' : ''}`} onClick={() => setSelected(key)}><span>{day}</span>{loans.length > 0 && <><i>{loans.length}</i><small>{amount > 0 ? BRL.format(amount).replace('R$', '').trim() : 'Pago'}</small></>}</button>; })}</div><div className="calendar-legend"><span><i className="dot open" />A vencer</span><span><i className="dot today" />Hoje</span><span><i className="dot interest" />Juros pagos</span><span><i className="dot late" />Atrasado</span><span><i className="dot paid" />Quitado</span></div></section><section className="section-card"><div className="section-heading"><div><p className="eyebrow">Dia selecionado</p><h2>{FULL_DATE.format(dateFromKey(selected))}</h2></div><CalendarDays size={20} /></div><div className="loan-list">{selectedLoans.length === 0 ? <EmptyState title="Sem vencimentos" text="Não há cobrança marcada para esse dia." /> : selectedLoans.map((loan) => { const client = getClient(loan.clientId); return client ? <LoanRow key={loan.id} loan={loan} client={client} onWhatsapp={onWhatsapp} onPayment={onPayment} onDetails={() => onLoan(loan.id)} /> : null; })}</div></section></div>;
}

function NewLoanModal({ clients, busy, onClose, onSubmit }: { clients: Client[]; busy: boolean; onClose: () => void; onSubmit: (data: NewLoanInput) => Promise<void> }) {
  const [mode, setMode] = useState<'existing' | 'new'>(clients.length > 0 ? 'existing' : 'new'); const [clientId, setClientId] = useState(clients[0]?.id ?? ''); const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [principal, setPrincipal] = useState(''); const [receivable, setReceivable] = useState(''); const [dueDate, setDueDate] = useState(''); const [error, setError] = useState('');
  const principalNumber = Number(principal || 0); const receivableNumber = Number(receivable || 0); const profit = receivableNumber - principalNumber; const markup = principalNumber > 0 ? profit / principalNumber * 100 : 0;
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); if (mode === 'existing' && !clientId) return setError('Selecione um cliente.'); if (mode === 'new' && (!name.trim() || !phone.trim())) return setError('Preencha nome e WhatsApp do cliente.'); if (!principalNumber || !receivableNumber || !dueDate) return setError('Preencha os valores e a data de vencimento.'); if (receivableNumber < principalNumber) return setError('O valor a receber não pode ser menor que o valor emprestado.'); await onSubmit({ clientId: mode === 'existing' ? clientId : undefined, name: mode === 'new' ? name : undefined, phone: mode === 'new' ? phone : undefined, principal: principalNumber, receivable: receivableNumber, dueDate }); }
  return <Modal onClose={onClose} eyebrow="Nova operação" title="Novo empréstimo"><form onSubmit={submit}>{clients.length > 0 && <div className="segmented"><button type="button" className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>Cliente existente</button><button type="button" className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>Novo cliente</button></div>}{mode === 'existing' ? <label>Cliente<select value={clientId} onChange={(e) => setClientId(e.target.value)}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</select></label> : <><label>Nome do cliente<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João da Silva" /></label><label>WhatsApp<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" /></label></>}<div className="form-grid"><label>Valor emprestado<input value={principal} onChange={(e) => setPrincipal(e.target.value.replace(',', '.'))} placeholder="1000" inputMode="decimal" /></label><label>Valor a receber<input value={receivable} onChange={(e) => setReceivable(e.target.value.replace(',', '.'))} placeholder="1350" inputMode="decimal" /></label></div><label>Vencimento<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label><div className="profit-preview"><TrendingUp size={19} /><div><span>Juros combinados por ciclo</span><strong>{BRL.format(Math.max(profit, 0))} {principalNumber > 0 && `· ${Math.max(markup, 0).toFixed(0)}%`}</strong></div></div>{error && <div className="form-error">{error}</div>}<button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><Plus size={19} /> {busy ? 'Salvando...' : 'Criar empréstimo'}</button></form></Modal>;
}

function PaymentModal({ loan, client, busy, onClose, onSubmit }: { loan: Loan; client?: Client; busy: boolean; onClose: () => void; onSubmit: (input: PaymentInput) => Promise<void> }) {
  const [type, setType] = useState<PaymentKind>('full'); const [newDueDate, setNewDueDate] = useState(''); const [error, setError] = useState(''); const total = openBalance(loan);
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); if (type === 'interest') { if (!newDueDate) return setError('Informe o próximo vencimento.'); if (newDueDate <= localTodayKey()) return setError('Escolha uma data futura.'); await onSubmit({ type, newDueDate }); return; } await onSubmit({ type: 'full' }); }
  return <Modal onClose={onClose} eyebrow="Recebimento" title="Registrar pagamento"><form onSubmit={submit}><div className="payment-summary"><div><span>Cliente</span><strong>{client?.name ?? 'Cliente'}</strong></div><div><span>Total do ciclo</span><strong>{BRL.format(total)}</strong></div></div><div className="payment-type-grid payment-two"><button type="button" className={type === 'full' ? 'active full' : ''} onClick={() => setType('full')}><Check size={18} /><strong>Quitação total</strong><span>{BRL.format(total)}</span></button><button type="button" className={type === 'interest' ? 'active interest' : ''} onClick={() => setType('interest')}><TrendingUp size={18} /><strong>Só os juros</strong><span>{BRL.format(loan.currentInterestDue)}</span></button></div>{type === 'full' ? <div className="payment-explainer success"><Check size={18} /><div><strong>Encerrar a dívida</strong><span>Entra {BRL.format(total)} no caixa e o empréstimo fica quitado.</span></div></div> : <><div className="payment-explainer warning"><TrendingUp size={18} /><div><strong>Renovar por mais um ciclo</strong><span>Entram {BRL.format(loan.currentInterestDue)} de juros. O principal de {BRL.format(loan.outstandingPrincipal)} continua emprestado e no próximo vencimento o total volta a ser {BRL.format(loan.outstandingPrincipal + loan.interestAmount)}.</span></div></div><label>Próximo vencimento<input type="date" value={newDueDate} min={localTodayKey()} onChange={(e) => setNewDueDate(e.target.value)} /></label></>}{error && <div className="form-error">{error}</div>}<button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><Check size={19} /> {busy ? 'Registrando...' : type === 'full' ? 'Confirmar quitação' : 'Confirmar juros e renovar'}</button></form></Modal>;
}

function CashModal({ current, busy, onClose, onSubmit }: { current: number; busy: boolean; onClose: () => void; onSubmit: (amount: number) => Promise<void> }) {
  const [amount, setAmount] = useState(String(current.toFixed(2))); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); const numeric = Number(amount.replace(',', '.')); if (Number.isNaN(numeric) || numeric < 0) return setError('Informe um valor de caixa válido.'); await onSubmit(numeric); }
  return <Modal onClose={onClose} eyebrow="Capital" title="Caixa inicial"><form onSubmit={submit}><label>Quanto você tem disponível como capital?<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label><p className="inline-note">Pagamentos de juros e quitações entram automaticamente no caixa.</p>{error && <div className="form-error">{error}</div>}<button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><WalletCards size={19} /> {busy ? 'Salvando...' : 'Salvar caixa'}</button></form></Modal>;
}

function Modal({ onClose, eyebrow, title, children, wide = false }: { onClose: () => void; eyebrow: string; title: string; children: ReactNode; wide?: boolean }) { return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}><motion.div className={`modal-card ${wide ? 'modal-wide' : ''}`} initial={{ y: 50, opacity: 0, scale: .98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 50, opacity: 0 }} onMouseDown={(e) => e.stopPropagation()}><div className="modal-handle" /><div className="modal-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button className="icon-btn" onClick={onClose}><X size={20} /></button></div>{children}</motion.div></motion.div>; }

function AuthScreen({ onSignIn, onSignUp }: { onSignIn: (e: string, p: string) => Promise<void>; onSignUp: (n: string, e: string, p: string) => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login'); const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); if (!email.trim() || password.length < 6) return setError('Informe um e-mail válido e uma senha com pelo menos 6 caracteres.'); if (mode === 'signup' && !name.trim()) return setError('Informe seu nome.'); setBusy(true); try { if (mode === 'login') await onSignIn(email.trim(), password); else await onSignUp(name.trim(), email.trim(), password); } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível concluir o acesso.'); } finally { setBusy(false); } }
  return <div className="auth-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><motion.section className="auth-card" initial={{ opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }}><div className="auth-logo-row"><div className="auth-logo">E</div><div><strong>Emprestei</strong><span>Seu dinheiro sob controle</span></div></div><p className="eyebrow">Fintech pessoal</p><h1>{mode === 'login' ? 'Acesse seu painel' : 'Crie sua conta'}</h1><p className="auth-subtitle">Clientes, vencimentos, caixa e recebimentos em uma experiência rápida e segura.</p><form className="auth-form" onSubmit={submit}>{mode === 'signup' && <label>Seu nome<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>}<label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label><label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>{error && <div className="auth-error">{error}</div>}<button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><ShieldCheck size={19} /> {busy ? 'Processando...' : mode === 'login' ? 'Entrar no Emprestei' : 'Criar minha conta'}</button></form><div className="auth-switch">{mode === 'login' ? 'Primeiro acesso?' : 'Já possui conta?'} <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>{mode === 'login' ? 'Criar conta' : 'Entrar'}</button></div></motion.section></div>;
}
function LoadingScreen({ text }: { text: string }) { return <div className="loading-screen"><div className="loading-card"><div className="spinner" /><strong>Emprestei</strong><span>{text}...</span></div></div>; }
