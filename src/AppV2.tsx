import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Session } from '@supabase/supabase-js';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Home,
  LogOut,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';
import { supabase } from './lib/supabase';

type Status = 'open' | 'due' | 'late' | 'interest_paid' | 'paid';
type Tab = 'home' | 'clients' | 'loans' | 'cash';
type Flash = { type: 'success' | 'error'; text: string } | null;
type PaymentKind = 'interest' | 'full' | 'partial';

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
};
type Store = { openingCash: number; cashAccountId: string | null; clients: Client[]; loans: Loan[]; payments: Payment[] };
type NewLoanInput = { clientId?: string; name?: string; phone?: string; principal: number; receivable: number; dueDate: string };
type PaymentInput = { type: PaymentKind; amount?: number; newDueDate?: string; renewInterest?: boolean };

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const EMPTY_STORE: Store = { openingCash: 0, cashAccountId: null, clients: [], loans: [], payments: [] };

function localTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateFromKey(value: string) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function daysUntil(value: string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  return Math.round((dateFromKey(value).getTime() - today.getTime()) / 86400000);
}

function openBalance(loan: Loan) {
  return Math.max(loan.outstandingPrincipal + loan.currentInterestDue, 0);
}

function getStatus(loan: Loan): Status {
  if (loan.dbStatus === 'paid' || openBalance(loan) <= 0) return 'paid';
  const delta = daysUntil(loan.dueDate);
  if (delta < 0) return 'late';
  if (delta === 0) return 'due';
  if (loan.dbStatus === 'interest_paid') return 'interest_paid';
  return 'open';
}

function statusLabel(status: Status) {
  return {
    open: 'Em aberto',
    due: 'Vence hoje',
    late: 'Atrasado',
    interest_paid: 'Juros pagos',
    paid: 'Quitado',
  }[status];
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'E';
}

function safePhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) return `55${digits}`;
  return digits;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function reminderPhrase(loan: Loan) {
  const delta = daysUntil(loan.dueDate);
  if (delta < 0) return `está atrasado há ${Math.abs(delta)} dia${Math.abs(delta) === 1 ? '' : 's'}`;
  if (delta === 0) return 'vence hoje';
  if (delta === 1) return 'vence amanhã';
  return `vence em ${delta} dias`;
}

async function showSystemNotification(loan: Loan, client: Client) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
  const today = localTodayKey();
  const key = `emprestei-notified:${today}:${loan.id}`;
  if (localStorage.getItem(key)) return;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(`Emprestei · ${client.name}`, {
    body: `${reminderPhrase(loan)}. ${BRL.format(openBalance(loan))} em aberto.`,
    icon: '/emprestei-icon.svg',
    tag: `emprestei-${loan.id}-${today}`,
    data: { url: `/?loan=${loan.id}` },
  });
  localStorage.setItem(key, '1');
}

export default function AppV2() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [store, setStore] = useState<Store>(EMPTY_STORE);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  const [showNewLoan, setShowNewLoan] = useState(false);
  const [paymentLoan, setPaymentLoan] = useState<Loan | null>(null);
  const [showCashEditor, setShowCashEditor] = useState(false);
  const [search, setSearch] = useState('');
  const [flash, setFlash] = useState<Flash>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); setAuthReady(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!session) { setStore(EMPTY_STORE); setLoadedOnce(false); return; }
    void loadData(session);
  }, [authReady, session?.user.id]);

  useEffect(() => {
    if (!loadedOnce || notificationPermission !== 'granted') return;
    const candidates = store.loans.filter((loan) => {
      const status = getStatus(loan);
      return status !== 'paid' && loan.dbStatus !== 'cancelled' && daysUntil(loan.dueDate) <= 1;
    });
    for (const loan of candidates) {
      const client = store.clients.find((item) => item.id === loan.clientId);
      if (client) void showSystemNotification(loan, client);
    }
  }, [loadedOnce, notificationPermission, store.loans, store.clients]);

  function showFlash(type: 'success' | 'error', text: string) {
    setFlash({ type, text });
    window.setTimeout(() => setFlash(null), 3400);
  }

  async function requestNotifications() {
    if (!('Notification' in window)) return showFlash('error', 'Este navegador não oferece notificações.');
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === 'granted') showFlash('success', 'Avisos no celular ativados.');
    else showFlash('error', 'Permissão de notificações não foi concedida.');
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
        supabase.from('payments').select('id,loan_id,amount,paid_at,payment_type,applied_to_interest,applied_to_principal').eq('owner_id', userId).order('paid_at', { ascending: false }),
        supabase.from('cash_accounts').select('id,opening_balance').eq('owner_id', userId).order('created_at', { ascending: true }).limit(1).maybeSingle(),
      ]);
      if (clientsResult.error) throw clientsResult.error;
      if (loansResult.error) throw loansResult.error;
      if (paymentsResult.error) throw paymentsResult.error;
      if (cashResult.error) throw cashResult.error;

      let cashAccount = cashResult.data;
      if (!cashAccount) {
        const created = await supabase.from('cash_accounts').insert({ owner_id: userId, name: 'Caixa principal', opening_balance: 0 }).select('id,opening_balance').single();
        if (created.error) throw created.error;
        cashAccount = created.data;
      }

      setStore({
        openingCash: Number(cashAccount.opening_balance),
        cashAccountId: cashAccount.id,
        clients: (clientsResult.data ?? []).map((client) => ({ id: client.id, name: client.name, phone: client.whatsapp, note: client.notes ?? undefined })),
        loans: (loansResult.data ?? []).map((loan) => ({
          id: loan.id,
          clientId: loan.client_id,
          principal: Number(loan.principal),
          receivable: Number(loan.total_receivable),
          interestAmount: Number(loan.interest_amount ?? Math.max(Number(loan.total_receivable) - Number(loan.principal), 0)),
          outstandingPrincipal: Number(loan.outstanding_principal ?? loan.principal),
          currentInterestDue: Number(loan.current_interest_due ?? Math.max(Number(loan.total_receivable) - Number(loan.principal), 0)),
          dueDate: loan.due_date,
          createdAt: loan.loan_date,
          dbStatus: loan.status,
          cycleNumber: Number(loan.cycle_number ?? 1),
          lastPaymentType: loan.last_payment_type,
        })),
        payments: (paymentsResult.data ?? []).map((payment) => ({
          id: payment.id,
          loanId: payment.loan_id,
          amount: Number(payment.amount),
          paidAt: payment.paid_at,
          paymentType: payment.payment_type ?? 'partial',
          appliedToInterest: Number(payment.applied_to_interest ?? 0),
          appliedToPrincipal: Number(payment.applied_to_principal ?? 0),
        })),
      });
      setLoadedOnce(true);
    } catch (error) {
      showFlash('error', error instanceof Error ? error.message : 'Não foi possível sincronizar os dados.');
    } finally { setSyncing(false); }
  }

  const metrics = useMemo(() => {
    const active = store.loans.filter((loan) => loan.dbStatus !== 'cancelled' && getStatus(loan) !== 'paid');
    const issuedPrincipal = store.loans.filter((loan) => loan.dbStatus !== 'cancelled').reduce((sum, loan) => sum + loan.principal, 0);
    const principalOut = active.reduce((sum, loan) => sum + loan.outstandingPrincipal, 0);
    const received = store.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const interestReceived = store.payments.reduce((sum, payment) => sum + payment.appliedToInterest, 0);
    const toReceive = active.reduce((sum, loan) => sum + openBalance(loan), 0);
    const expectedProfit = active.reduce((sum, loan) => sum + loan.currentInterestDue, 0);
    const availableCash = store.openingCash - issuedPrincipal + received;
    const overdue = active.filter((loan) => getStatus(loan) === 'late').length;
    const dueToday = active.filter((loan) => getStatus(loan) === 'due').length;
    return { principalOut, received, interestReceived, toReceive, expectedProfit, availableCash, overdue, dueToday };
  }, [store]);

  const reminders = useMemo(() => [...store.loans]
    .filter((loan) => loan.dbStatus !== 'cancelled' && getStatus(loan) !== 'paid' && daysUntil(loan.dueDate) <= 2)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [store.loans]);

  const upcoming = useMemo(() => [...store.loans]
    .filter((loan) => loan.dbStatus !== 'cancelled' && getStatus(loan) !== 'paid')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5), [store.loans]);

  const filteredClients = store.clients.filter((client) => `${client.name} ${client.phone}`.toLowerCase().includes(search.toLowerCase()));
  const getClient = (clientId: string) => store.clients.find((client) => client.id === clientId);

  function openWhatsapp(client: Client, loan?: Loan) {
    let message = `Olá, ${client.name.split(' ')[0]}! Tudo bem?`;
    if (loan) {
      const total = openBalance(loan);
      const interest = loan.currentInterestDue;
      const principal = loan.outstandingPrincipal;
      message = `Olá, ${client.name.split(' ')[0]}! Passando para lembrar que seu empréstimo ${reminderPhrase(loan)}. O valor para quitar é ${BRL.format(total)}, sendo ${BRL.format(principal)} de principal e ${BRL.format(interest)} de juros. Você pretende pagar somente os juros (${BRL.format(interest)}) para renovar ou quitar o valor total (${BRL.format(total)})? Me avise por aqui, por favor.`;
    }
    window.open(`https://wa.me/${safePhone(client.phone)}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  }

  async function createLoan(data: NewLoanInput) {
    if (!session) return;
    setSyncing(true);
    try {
      let clientId = data.clientId;
      if (!clientId) {
        const created = await supabase.from('clients').insert({ owner_id: session.user.id, name: data.name?.trim(), whatsapp: safePhone(data.phone ?? '') }).select('id').single();
        if (created.error) throw created.error;
        clientId = created.data.id;
      }
      const interest = Math.max(data.receivable - data.principal, 0);
      const result = await supabase.from('loans').insert({
        owner_id: session.user.id,
        client_id: clientId,
        principal: data.principal,
        total_receivable: data.receivable,
        interest_amount: interest,
        outstanding_principal: data.principal,
        current_interest_due: interest,
        due_date: data.dueDate,
        loan_date: localTodayKey(),
        status: 'open',
        cycle_number: 1,
      });
      if (result.error) throw result.error;
      setShowNewLoan(false);
      await loadData(session);
      showFlash('success', 'Empréstimo cadastrado com sucesso.');
    } catch (error) { showFlash('error', error instanceof Error ? error.message : 'Erro ao cadastrar o empréstimo.'); }
    finally { setSyncing(false); }
  }

  async function registerPayment(loan: Loan, input: PaymentInput) {
    if (!session) return;
    setSyncing(true);
    try {
      const { error } = await supabase.rpc('record_loan_payment', {
        p_loan_id: loan.id,
        p_payment_type: input.type,
        p_amount: input.type === 'partial' ? input.amount ?? null : null,
        p_new_due_date: input.type === 'interest' ? input.newDueDate ?? null : null,
        p_renew_interest: input.type === 'interest' ? input.renewInterest !== false : true,
      });
      if (error) throw error;
      setPaymentLoan(null);
      await loadData(session);
      const text = input.type === 'full' ? 'Empréstimo quitado. Caixa atualizado.' : input.type === 'interest' ? 'Juros registrados. Empréstimo segue pendente.' : 'Pagamento parcial registrado.';
      showFlash('success', text);
    } catch (error) { showFlash('error', error instanceof Error ? error.message : 'Erro ao registrar pagamento.'); }
    finally { setSyncing(false); }
  }

  async function updateOpeningCash(amount: number) {
    if (!session || !store.cashAccountId || amount < 0) return;
    setSyncing(true);
    try {
      const result = await supabase.from('cash_accounts').update({ opening_balance: amount }).eq('id', store.cashAccountId).eq('owner_id', session.user.id);
      if (result.error) throw result.error;
      setShowCashEditor(false);
      await loadData(session);
      showFlash('success', 'Caixa inicial atualizado.');
    } catch (error) { showFlash('error', error instanceof Error ? error.message : 'Erro ao atualizar o caixa.'); }
    finally { setSyncing(false); }
  }

  async function handleSignIn(email: string, password: string) {
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    showFlash('success', 'Bem-vindo ao Emprestei.');
  }

  async function handleSignUp(name: string, email: string, password: string) {
    const result = await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } });
    if (result.error) throw result.error;
    showFlash('success', result.data.session ? 'Conta criada. Seu painel está pronto.' : 'Conta criada. Faça login para continuar.');
  }

  if (!authReady) return <LoadingScreen text="Preparando seu painel" />;
  if (!session) return <AuthScreen onSignIn={handleSignIn} onSignUp={handleSignUp} />;
  if (!loadedOnce) return <LoadingScreen text="Sincronizando seus dados" />;

  const displayName = session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'Você';

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <AnimatePresence>{flash && <motion.div className={`toast ${flash.type}`} initial={{ opacity: 0, y: -14, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: -12, x: '-50%' }}>{flash.type === 'success' ? <Check size={18} /> : <X size={18} />}{flash.text}</motion.div>}</AnimatePresence>

      <main className="app-content">
        <AnimatePresence mode="wait">
          {tab === 'home' && <motion.section key="home" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <header className="topbar">
              <div><p className="eyebrow">Visão geral</p><h1>{greeting()}, {displayName.split(' ')[0]} 👋</h1><p className="welcome-subtitle">Que tal continuar fazendo seu dinheiro render hoje?</p></div>
              <button className="profile-pill" onClick={() => void supabase.auth.signOut()} title="Sair da conta"><span className="sync-dot" /><span>{syncing ? 'Sincronizando' : 'Online'}</span><LogOut size={17} /></button>
            </header>

            <section className="hero-card">
              <div className="hero-topline"><span>Caixa disponível</span><WalletCards size={22} /></div>
              <strong>{BRL.format(metrics.availableCash)}</strong>
              <div className="hero-foot"><span><TrendingUp size={17} /> {BRL.format(metrics.expectedProfit)} de lucro previsto</span><button onClick={() => setShowNewLoan(true)}><Plus size={19} /> Novo empréstimo</button></div>
            </section>

            <div className="metrics-grid">
              <Metric icon={<Banknote />} label="Emprestado" value={BRL.format(metrics.principalOut)} hint="Capital na rua" tone="blue" />
              <Metric icon={<ArrowDownLeft />} label="A receber" value={BRL.format(metrics.toReceive)} hint="Saldo futuro" tone="blue" />
              <Metric icon={<ArrowUpRight />} label="Recebido" value={BRL.format(metrics.received)} hint={`${BRL.format(metrics.interestReceived)} em juros`} tone="green" />
              <Metric icon={<Clock3 />} label="Atrasados" value={`${metrics.overdue}`} hint={metrics.dueToday ? `${metrics.dueToday} vence hoje` : 'Precisam de atenção'} tone={metrics.overdue > 0 ? 'red' : 'neutral'} />
            </div>

            <section className="alert-center">
              <div className="section-heading alert-heading">
                <div><p className="eyebrow">Central de avisos</p><h2>Vencimentos e cobranças</h2></div>
                <BellRing size={21} />
              </div>
              {notificationPermission === 'default' && <button className="notification-optin" onClick={requestNotifications}><Bell size={18} /><span><strong>Ativar avisos no celular</strong><small>Receba alertas quando um cliente estiver vencendo.</small></span><ChevronRight size={18} /></button>}
              {reminders.length === 0 ? <EmptyState title="Tudo em dia por aqui" text="Quando um cliente estiver perto do vencimento, o aviso aparecerá nesta área." /> : <div className="reminder-list">{reminders.map((loan) => { const client = getClient(loan.clientId); return client ? <ReminderCard key={loan.id} loan={loan} client={client} onWhatsapp={openWhatsapp} onPayment={setPaymentLoan} /> : null; })}</div>}
            </section>

            <section className="section-card">
              <div className="section-heading"><div><p className="eyebrow">Agenda financeira</p><h2>Próximos recebimentos</h2></div><CalendarDays size={20} /></div>
              <div className="loan-list">{upcoming.length === 0 && <EmptyState title="Nenhum recebimento pendente" text="Quando você cadastrar um empréstimo, os próximos vencimentos aparecem aqui." />}{upcoming.map((loan) => { const client = getClient(loan.clientId); return client ? <LoanRow key={loan.id} loan={loan} client={client} onWhatsapp={openWhatsapp} onPayment={setPaymentLoan} /> : null; })}</div>
            </section>
          </motion.section>}

          {tab === 'clients' && <motion.section key="clients" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            <PageHeader eyebrow="Relacionamentos" title="Clientes" action={() => setShowNewLoan(true)} />
            <div className="search-box"><Search size={18} /><input placeholder="Buscar cliente ou WhatsApp" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div className="client-grid">{filteredClients.length === 0 && <EmptyState title="Nenhum cliente encontrado" text="Cadastre um novo empréstimo para adicionar seu primeiro cliente." />}{filteredClients.map((client) => { const loans = store.loans.filter((loan) => loan.clientId === client.id && loan.dbStatus !== 'cancelled'); const balance = loans.reduce((sum, loan) => sum + openBalance(loan), 0); return <motion.article whileTap={{ scale: .985 }} className="client-card" key={client.id}><div className="avatar">{initials(client.name)}</div><div className="client-main"><strong>{client.name}</strong><span>{client.phone}</span><small>{loans.length} empréstimo(s) · {BRL.format(balance)} pendente</small></div><button className="icon-btn whatsapp" onClick={() => openWhatsapp(client)}><MessageCircle size={19} /></button></motion.article>; })}</div>
          </motion.section>}

          {tab === 'loans' && <motion.section key="loans" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            <PageHeader eyebrow="Carteira" title="Empréstimos" action={() => setShowNewLoan(true)} />
            <div className="loan-list expanded">{store.loans.length === 0 && <EmptyState title="Sua carteira está vazia" text="Use o botão + para cadastrar o primeiro empréstimo." />}{store.loans.filter((loan) => loan.dbStatus !== 'cancelled').map((loan) => { const client = getClient(loan.clientId); return client ? <LoanRow key={loan.id} loan={loan} client={client} onWhatsapp={openWhatsapp} onPayment={setPaymentLoan} /> : null; })}</div>
          </motion.section>}

          {tab === 'cash' && <motion.section key="cash" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            <PageHeader eyebrow="Financeiro" title="Meu caixa" />
            <section className="cash-panel"><div className="cash-ring"><CircleDollarSign size={34} /></div><span>Saldo livre para emprestar</span><strong>{BRL.format(metrics.availableCash)}</strong><p>Seu caixa considera o capital inicial, empréstimos liberados e tudo que já voltou em juros ou principal.</p><div className="cash-actions"><button className="secondary-action" onClick={() => setShowCashEditor(true)}><Pencil size={17} /> Ajustar caixa inicial</button></div></section>
            <div className="metrics-grid"><Metric icon={<WalletCards />} label="Caixa inicial" value={BRL.format(store.openingCash)} hint="Capital configurado" /><Metric icon={<Banknote />} label="Na rua" value={BRL.format(metrics.principalOut)} hint="Principal pendente" /><Metric icon={<ArrowDownLeft />} label="Retornou" value={BRL.format(metrics.received)} hint="Pagamentos" tone="green" /><Metric icon={<TrendingUp />} label="Juros recebidos" value={BRL.format(metrics.interestReceived)} hint="Lucro realizado" tone="green" /></div>
          </motion.section>}
        </AnimatePresence>
      </main>

      <nav className="bottom-nav"><NavButton active={tab === 'home'} onClick={() => setTab('home')} icon={<Home />} label="Início" /><NavButton active={tab === 'clients'} onClick={() => setTab('clients')} icon={<UsersRound />} label="Clientes" /><button className="nav-main-action" onClick={() => setShowNewLoan(true)}><Plus size={25} /></button><NavButton active={tab === 'loans'} onClick={() => setTab('loans')} icon={<Banknote />} label="Empréstimos" /><NavButton active={tab === 'cash'} onClick={() => setTab('cash')} icon={<WalletCards />} label="Caixa" /></nav>

      <AnimatePresence>{showNewLoan && <NewLoanModal clients={store.clients} busy={syncing} onClose={() => setShowNewLoan(false)} onSubmit={createLoan} />}{paymentLoan && <PaymentModal loan={paymentLoan} client={getClient(paymentLoan.clientId)} busy={syncing} onClose={() => setPaymentLoan(null)} onSubmit={(input) => registerPayment(paymentLoan, input)} />}{showCashEditor && <CashModal current={store.openingCash} busy={syncing} onClose={() => setShowCashEditor(false)} onSubmit={updateOpeningCash} />}</AnimatePresence>
    </div>
  );
}

function Metric({ icon, label, value, hint, tone = 'neutral' }: { icon: ReactNode; label: string; value: string; hint: string; tone?: 'neutral' | 'blue' | 'green' | 'red' }) {
  return <motion.article whileHover={{ y: -2 }} className={`metric-card metric-${tone}`}><div className="metric-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{hint}</small></motion.article>;
}

function PageHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: () => void }) { return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>{action && <button className="round-add" onClick={action}><Plus size={20} /></button>}</header>; }
function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) { return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>; }

function ReminderCard({ loan, client, onWhatsapp, onPayment }: { loan: Loan; client: Client; onWhatsapp: (client: Client, loan: Loan) => void; onPayment: (loan: Loan) => void }) {
  const status = getStatus(loan);
  return <article className={`reminder-card reminder-${status}`}><div className="reminder-icon">{status === 'late' ? <AlertTriangle /> : <Clock3 />}</div><div className="reminder-copy"><strong>{client.name}</strong><span>{reminderPhrase(loan)} · {BRL.format(openBalance(loan))}</span><small>Juros {BRL.format(loan.currentInterestDue)} · Principal {BRL.format(loan.outstandingPrincipal)}</small></div><div className="reminder-actions"><button className="remind-whatsapp" onClick={() => onWhatsapp(client, loan)}><MessageCircle size={16} /> Lembrar</button><button className="remind-pay" onClick={() => onPayment(loan)}><Check size={16} /> Receber</button></div></article>;
}

function LoanRow({ loan, client, onWhatsapp, onPayment }: { loan: Loan; client: Client; onWhatsapp: (client: Client, loan: Loan) => void; onPayment: (loan: Loan) => void }) {
  const status = getStatus(loan);
  return <motion.article layout className={`loan-row loan-${status}`}><div className="avatar small">{initials(client.name)}</div><div className="loan-info"><div className="loan-title"><strong>{client.name}</strong><span className={`status ${status}`}>{statusLabel(status)}</span></div><div className="loan-meta"><span>{DATE.format(dateFromKey(loan.dueDate))}</span><span>•</span><span>Ciclo {loan.cycleNumber}</span><span>•</span><span>Juros {BRL.format(loan.currentInterestDue)}</span></div></div><div className="loan-value"><strong>{BRL.format(openBalance(loan))}</strong><span>{status === 'paid' ? 'quitado' : 'em aberto'}</span></div><div className="row-actions">{status !== 'paid' && <button className="mini-btn whatsapp" onClick={() => onWhatsapp(client, loan)} title="Lembrar no WhatsApp"><MessageCircle size={17} /></button>}{status !== 'paid' && <button className="mini-btn paid" onClick={() => onPayment(loan)} title="Registrar recebimento"><Check size={17} /></button>}{status === 'paid' && <div className="paid-seal"><Check size={17} /></div>}<ChevronRight size={18} className="chevron" /></div></motion.article>;
}

function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><Sparkles size={23} /><strong>{title}</strong><span>{text}</span></div>; }

function NewLoanModal({ clients, busy, onClose, onSubmit }: { clients: Client[]; busy: boolean; onClose: () => void; onSubmit: (data: NewLoanInput) => Promise<void> }) {
  const [mode, setMode] = useState<'existing' | 'new'>(clients.length > 0 ? 'existing' : 'new');
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [principal, setPrincipal] = useState(''); const [receivable, setReceivable] = useState(''); const [dueDate, setDueDate] = useState(''); const [error, setError] = useState('');
  const principalNumber = Number(principal || 0); const receivableNumber = Number(receivable || 0); const profit = receivableNumber - principalNumber; const markup = principalNumber > 0 ? profit / principalNumber * 100 : 0;
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); if (mode === 'existing' && !clientId) return setError('Selecione um cliente.'); if (mode === 'new' && (!name.trim() || !phone.trim())) return setError('Preencha nome e WhatsApp do cliente.'); if (!principalNumber || !receivableNumber || !dueDate) return setError('Preencha os valores e a data de vencimento.'); if (receivableNumber < principalNumber) return setError('O valor a receber não pode ser menor que o valor emprestado.'); await onSubmit({ clientId: mode === 'existing' ? clientId : undefined, name: mode === 'new' ? name : undefined, phone: mode === 'new' ? phone : undefined, principal: principalNumber, receivable: receivableNumber, dueDate }); }
  return <Modal onClose={onClose} eyebrow="Nova operação" title="Novo empréstimo"><form onSubmit={submit}>{clients.length > 0 && <div className="segmented"><button type="button" className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>Cliente existente</button><button type="button" className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>Novo cliente</button></div>}{mode === 'existing' ? <label>Cliente<select value={clientId} onChange={(e) => setClientId(e.target.value)}>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.phone}</option>)}</select></label> : <><label>Nome do cliente<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João da Silva" /></label><label>WhatsApp<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" /></label></>}<div className="form-grid"><label>Valor emprestado<input value={principal} onChange={(e) => setPrincipal(e.target.value.replace(',', '.'))} placeholder="1000" inputMode="decimal" /></label><label>Valor a receber<input value={receivable} onChange={(e) => setReceivable(e.target.value.replace(',', '.'))} placeholder="1350" inputMode="decimal" /></label></div><label>Vencimento<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label><div className="profit-preview"><TrendingUp size={19} /><div><span>Juros combinados</span><strong>{BRL.format(Math.max(profit, 0))} {principalNumber > 0 && `· ${Math.max(markup, 0).toFixed(0)}%`}</strong></div></div>{error && <div className="form-error">{error}</div>}<button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><Plus size={19} /> {busy ? 'Salvando...' : 'Criar empréstimo'}</button></form></Modal>;
}

function PaymentModal({ loan, client, busy, onClose, onSubmit }: { loan: Loan; client?: Client; busy: boolean; onClose: () => void; onSubmit: (input: PaymentInput) => Promise<void> }) {
  const [type, setType] = useState<PaymentKind>('full');
  const [amount, setAmount] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [renewInterest, setRenewInterest] = useState(true);
  const [error, setError] = useState('');
  const total = openBalance(loan);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (type === 'interest') { if (loan.currentInterestDue <= 0) return setError('Este empréstimo não tem juros pendentes neste ciclo.'); if (!newDueDate) return setError('Informe o próximo vencimento.'); if (newDueDate <= localTodayKey()) return setError('Escolha uma data futura.'); await onSubmit({ type, newDueDate, renewInterest }); return; }
    if (type === 'partial') { const numeric = Number(amount.replace(',', '.')); if (!numeric || numeric <= 0) return setError('Informe um valor válido.'); if (numeric >= total) return setError('Para quitar tudo, use a opção “Valor total”.'); await onSubmit({ type, amount: numeric }); return; }
    await onSubmit({ type: 'full' });
  }
  return <Modal onClose={onClose} eyebrow="Recebimento" title="Registrar pagamento"><form onSubmit={submit}><div className="payment-summary"><div><span>Cliente</span><strong>{client?.name ?? 'Cliente'}</strong></div><div><span>Total em aberto</span><strong>{BRL.format(total)}</strong></div></div><div className="payment-type-grid"><button type="button" className={type === 'full' ? 'active full' : ''} onClick={() => setType('full')}><Check size={18} /><strong>Valor total</strong><span>{BRL.format(total)}</span></button><button type="button" className={type === 'interest' ? 'active interest' : ''} onClick={() => setType('interest')}><TrendingUp size={18} /><strong>Só os juros</strong><span>{BRL.format(loan.currentInterestDue)}</span></button><button type="button" className={type === 'partial' ? 'active partial' : ''} onClick={() => setType('partial')}><CircleDollarSign size={18} /><strong>Outro valor</strong><span>Pagamento parcial</span></button></div>{type === 'full' && <div className="payment-explainer success"><Check size={18} /><div><strong>Quitar empréstimo</strong><span>Entra {BRL.format(total)} no caixa e o empréstimo fica verde como quitado.</span></div></div>}{type === 'interest' && <><div className="payment-explainer warning"><TrendingUp size={18} /><div><strong>Registrar só os juros</strong><span>Entram {BRL.format(loan.currentInterestDue)} no caixa. O principal de {BRL.format(loan.outstandingPrincipal)} continua emprestado.</span></div></div><label>Próximo vencimento<input type="date" value={newDueDate} min={localTodayKey()} onChange={(e) => setNewDueDate(e.target.value)} /></label><label className="toggle-line"><input type="checkbox" checked={renewInterest} onChange={(e) => setRenewInterest(e.target.checked)} /><span><strong>Renovar os mesmos juros no próximo ciclo</strong><small>{renewInterest ? `O próximo ciclo volta a cobrar ${BRL.format(loan.interestAmount)} de juros.` : 'O próximo ciclo ficará somente com o principal pendente.'}</small></span></label></>}{type === 'partial' && <><label>Valor recebido<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Ex.: 500" /></label><p className="inline-note">O sistema abate primeiro os juros pendentes e depois reduz o principal.</p></>}{error && <div className="form-error">{error}</div>}<button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><Check size={19} /> {busy ? 'Registrando...' : type === 'full' ? 'Confirmar quitação' : type === 'interest' ? 'Confirmar juros pagos' : 'Confirmar pagamento parcial'}</button></form></Modal>;
}

function CashModal({ current, busy, onClose, onSubmit }: { current: number; busy: boolean; onClose: () => void; onSubmit: (amount: number) => Promise<void> }) {
  const [amount, setAmount] = useState(String(current.toFixed(2))); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); const numeric = Number(amount.replace(',', '.')); if (Number.isNaN(numeric) || numeric < 0) return setError('Informe um valor de caixa válido.'); await onSubmit(numeric); }
  return <Modal onClose={onClose} eyebrow="Capital" title="Caixa inicial"><form onSubmit={submit}><label>Quanto você tem disponível como capital?<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label><p className="inline-note">Pagamentos de juros e principal entram automaticamente no caixa.</p>{error && <div className="form-error">{error}</div>}<button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><WalletCards size={19} /> {busy ? 'Salvando...' : 'Salvar caixa'}</button></form></Modal>;
}

function Modal({ onClose, eyebrow, title, children }: { onClose: () => void; eyebrow: string; title: string; children: ReactNode }) { return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}><motion.div className="modal-card" initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} onMouseDown={(e) => e.stopPropagation()}><div className="modal-handle" /><div className="modal-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button className="icon-btn" onClick={onClose}><X size={20} /></button></div>{children}</motion.div></motion.div>; }

function AuthScreen({ onSignIn, onSignUp }: { onSignIn: (email: string, password: string) => Promise<void>; onSignUp: (name: string, email: string, password: string) => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login'); const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); if (!email.trim() || password.length < 6) return setError('Informe um e-mail válido e senha com pelo menos 6 caracteres.'); if (mode === 'signup' && !name.trim()) return setError('Informe seu nome.'); setBusy(true); try { if (mode === 'login') await onSignIn(email.trim(), password); else await onSignUp(name.trim(), email.trim(), password); } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível concluir o acesso.'); } finally { setBusy(false); } }
  return <div className="auth-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><motion.section className="auth-card" initial={{ opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }}><div className="auth-logo-row"><div className="auth-logo">E</div><div><strong>Emprestei</strong><span>Seu dinheiro sob controle</span></div></div><p className="eyebrow">Fintech pessoal</p><h1>{mode === 'login' ? 'Acesse seu painel' : 'Crie sua conta'}</h1><p className="auth-subtitle">Clientes, vencimentos, caixa e recebimentos em uma experiência rápida e segura.</p><form className="auth-form" onSubmit={submit}>{mode === 'signup' && <label>Seu nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como quer ser chamado" /></label>}<label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" /></label><label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" /></label>{error && <div className="auth-error">{error}</div>}<button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><ShieldCheck size={19} /> {busy ? 'Processando...' : mode === 'login' ? 'Entrar no Emprestei' : 'Criar minha conta'}</button></form><div className="auth-switch">{mode === 'login' ? 'Primeiro acesso?' : 'Já possui conta?'} <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>{mode === 'login' ? 'Criar conta' : 'Entrar'}</button></div></motion.section></div>;
}

function LoadingScreen({ text }: { text: string }) { return <div className="loading-screen"><div className="loading-card"><div className="spinner" /><strong>Emprestei</strong><span>{text}...</span></div></div>; }
