import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Session } from '@supabase/supabase-js';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
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

type Status = 'open' | 'due' | 'late' | 'paid';
type Tab = 'home' | 'clients' | 'loans' | 'cash';
type Flash = { type: 'success' | 'error'; text: string } | null;

type Client = {
  id: string;
  name: string;
  phone: string;
  note?: string;
};

type Loan = {
  id: string;
  clientId: string;
  principal: number;
  receivable: number;
  dueDate: string;
  createdAt: string;
  paidAmount: number;
  dbStatus: string;
};

type Payment = {
  id: string;
  loanId: string;
  amount: number;
  paidAt: string;
};

type Store = {
  openingCash: number;
  cashAccountId: string | null;
  clients: Client[];
  loans: Loan[];
  payments: Payment[];
};

type NewLoanInput = {
  clientId?: string;
  name?: string;
  phone?: string;
  principal: number;
  receivable: number;
  dueDate: string;
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const EMPTY_STORE: Store = { openingCash: 0, cashAccountId: null, clients: [], loans: [], payments: [] };

function getStatus(loan: Loan): Status {
  if (loan.dbStatus === 'paid' || loan.paidAmount >= loan.receivable) return 'paid';
  const todayKey = new Date().toISOString().slice(0, 10);
  if (loan.dueDate < todayKey) return 'late';
  if (loan.dueDate === todayKey) return 'due';
  return 'open';
}

function statusLabel(status: Status) {
  return { open: 'Em aberto', due: 'Vence hoje', late: 'Atrasado', paid: 'Pago' }[status];
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

export default function App() {
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!session) {
      setStore(EMPTY_STORE);
      setLoadedOnce(false);
      return;
    }
    void loadData(session);
  }, [authReady, session?.user.id]);

  function showFlash(type: 'success' | 'error', text: string) {
    setFlash({ type, text });
    window.setTimeout(() => setFlash(null), 3200);
  }

  async function loadData(activeSession = session) {
    if (!activeSession) return;
    setSyncing(true);
    try {
      const displayName = activeSession.user.user_metadata?.display_name || activeSession.user.email?.split('@')[0] || 'Usuário';
      const profileResult = await supabase.from('profiles').upsert({ id: activeSession.user.id, display_name: displayName });
      if (profileResult.error) throw profileResult.error;

      const [clientsResult, loansResult, paymentsResult, cashResult] = await Promise.all([
        supabase.from('clients').select('id,name,whatsapp,notes,created_at').order('created_at', { ascending: false }),
        supabase.from('loans').select('id,client_id,principal,total_receivable,due_date,loan_date,status,created_at').order('created_at', { ascending: false }),
        supabase.from('payments').select('id,loan_id,amount,paid_at').order('paid_at', { ascending: false }),
        supabase.from('cash_accounts').select('id,opening_balance').order('created_at', { ascending: true }).limit(1).maybeSingle(),
      ]);

      if (clientsResult.error) throw clientsResult.error;
      if (loansResult.error) throw loansResult.error;
      if (paymentsResult.error) throw paymentsResult.error;
      if (cashResult.error) throw cashResult.error;

      let cashAccount = cashResult.data;
      if (!cashAccount) {
        const createdCash = await supabase
          .from('cash_accounts')
          .insert({ owner_id: activeSession.user.id, name: 'Caixa principal', opening_balance: 0 })
          .select('id,opening_balance')
          .single();
        if (createdCash.error) throw createdCash.error;
        cashAccount = createdCash.data;
      }

      const payments: Payment[] = (paymentsResult.data ?? []).map((payment) => ({
        id: payment.id,
        loanId: payment.loan_id,
        amount: Number(payment.amount),
        paidAt: payment.paid_at,
      }));

      const paidByLoan = new Map<string, number>();
      for (const payment of payments) {
        paidByLoan.set(payment.loanId, (paidByLoan.get(payment.loanId) ?? 0) + payment.amount);
      }

      setStore({
        openingCash: Number(cashAccount.opening_balance),
        cashAccountId: cashAccount.id,
        clients: (clientsResult.data ?? []).map((client) => ({
          id: client.id,
          name: client.name,
          phone: client.whatsapp,
          note: client.notes ?? undefined,
        })),
        loans: (loansResult.data ?? []).map((loan) => ({
          id: loan.id,
          clientId: loan.client_id,
          principal: Number(loan.principal),
          receivable: Number(loan.total_receivable),
          dueDate: loan.due_date,
          createdAt: loan.loan_date,
          paidAmount: paidByLoan.get(loan.id) ?? 0,
          dbStatus: loan.status,
        })),
        payments,
      });
      setLoadedOnce(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível sincronizar os dados.';
      showFlash('error', message);
    } finally {
      setSyncing(false);
    }
  }

  const metrics = useMemo(() => {
    const activeLoans = store.loans.filter((loan) => loan.dbStatus !== 'cancelled' && getStatus(loan) !== 'paid');
    const issuedPrincipal = store.loans
      .filter((loan) => loan.dbStatus !== 'cancelled')
      .reduce((sum, loan) => sum + loan.principal, 0);
    const principalOut = activeLoans.reduce((sum, loan) => sum + loan.principal, 0);
    const received = store.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const toReceive = activeLoans.reduce((sum, loan) => sum + Math.max(loan.receivable - loan.paidAmount, 0), 0);
    const expectedProfit = activeLoans.reduce((sum, loan) => sum + Math.max(loan.receivable - loan.principal, 0), 0);
    const availableCash = store.openingCash - issuedPrincipal + received;
    const overdue = activeLoans.filter((loan) => getStatus(loan) === 'late').length;
    return { principalOut, received, toReceive, expectedProfit, availableCash, overdue };
  }, [store]);

  const upcoming = useMemo(
    () => [...store.loans]
      .filter((loan) => loan.dbStatus !== 'cancelled' && getStatus(loan) !== 'paid')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 4),
    [store.loans],
  );

  const filteredClients = store.clients.filter((client) =>
    `${client.name} ${client.phone}`.toLowerCase().includes(search.toLowerCase()),
  );

  function getClient(clientId: string) {
    return store.clients.find((client) => client.id === clientId);
  }

  function openWhatsapp(client: Client, loan?: Loan) {
    const amount = loan ? BRL.format(Math.max(loan.receivable - loan.paidAmount, 0)) : '';
    const message = loan
      ? `Olá, ${client.name.split(' ')[0]}! Passando para lembrar do valor de ${amount}, com vencimento em ${new Date(`${loan.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}. Qualquer dúvida, me chama por aqui.`
      : `Olá, ${client.name.split(' ')[0]}! Tudo bem?`;
    window.open(`https://wa.me/${safePhone(client.phone)}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  }

  async function createLoan(data: NewLoanInput) {
    if (!session) return;
    setSyncing(true);
    try {
      let clientId = data.clientId;
      if (!clientId) {
        const newClient = await supabase
          .from('clients')
          .insert({
            owner_id: session.user.id,
            name: data.name?.trim(),
            whatsapp: safePhone(data.phone ?? ''),
          })
          .select('id')
          .single();
        if (newClient.error) throw newClient.error;
        clientId = newClient.data.id;
      }

      const loanResult = await supabase.from('loans').insert({
        owner_id: session.user.id,
        client_id: clientId,
        principal: data.principal,
        total_receivable: data.receivable,
        due_date: data.dueDate,
        loan_date: new Date().toISOString().slice(0, 10),
        status: 'open',
      });
      if (loanResult.error) throw loanResult.error;

      setShowNewLoan(false);
      await loadData(session);
      showFlash('success', 'Empréstimo cadastrado com sucesso.');
    } catch (error) {
      showFlash('error', error instanceof Error ? error.message : 'Erro ao cadastrar o empréstimo.');
    } finally {
      setSyncing(false);
    }
  }

  async function registerPayment(loan: Loan, amount: number) {
    if (!session) return;
    const remaining = Math.max(loan.receivable - loan.paidAmount, 0);
    if (amount <= 0 || amount > remaining) {
      showFlash('error', 'Informe um pagamento válido, sem ultrapassar o saldo em aberto.');
      return;
    }

    setSyncing(true);
    try {
      const paymentResult = await supabase.from('payments').insert({
        owner_id: session.user.id,
        loan_id: loan.id,
        amount,
      });
      if (paymentResult.error) throw paymentResult.error;

      if (loan.paidAmount + amount >= loan.receivable) {
        const statusResult = await supabase.from('loans').update({ status: 'paid' }).eq('id', loan.id);
        if (statusResult.error) throw statusResult.error;
      }

      setPaymentLoan(null);
      await loadData(session);
      showFlash('success', amount >= remaining ? 'Empréstimo quitado e caixa atualizado.' : 'Pagamento registrado no caixa.');
    } catch (error) {
      showFlash('error', error instanceof Error ? error.message : 'Erro ao registrar pagamento.');
    } finally {
      setSyncing(false);
    }
  }

  async function updateOpeningCash(amount: number) {
    if (!session || !store.cashAccountId || amount < 0) return;
    setSyncing(true);
    try {
      const result = await supabase.from('cash_accounts').update({ opening_balance: amount }).eq('id', store.cashAccountId);
      if (result.error) throw result.error;
      setShowCashEditor(false);
      await loadData(session);
      showFlash('success', 'Caixa inicial atualizado.');
    } catch (error) {
      showFlash('error', error instanceof Error ? error.message : 'Erro ao atualizar o caixa.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleSignIn(email: string, password: string) {
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    showFlash('success', 'Bem-vindo ao Emprestei.');
  }

  async function handleSignUp(name: string, email: string, password: string) {
    const result = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name } },
    });
    if (result.error) throw result.error;
    if (!result.data.session) {
      showFlash('success', 'Conta criada. Confira seu e-mail para confirmar o acesso.');
    } else {
      showFlash('success', 'Conta criada. Seu painel está pronto.');
    }
  }

  if (!authReady) return <LoadingScreen text="Preparando seu painel" />;
  if (!session) return <AuthScreen onSignIn={handleSignIn} onSignUp={handleSignUp} />;
  if (!loadedOnce) return <LoadingScreen text="Sincronizando seus dados" />;

  const displayName = session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'Você';

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <AnimatePresence>
        {flash && (
          <motion.div className={`toast ${flash.type}`} initial={{ opacity: 0, y: -14, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: -12, x: '-50%' }}>
            {flash.type === 'success' ? <Check size={18} /> : <X size={18} />}
            {flash.text}
          </motion.div>
        )}
      </AnimatePresence>

      <main className="app-content">
        <AnimatePresence mode="wait">
          {tab === 'home' && (
            <motion.section key="home" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <header className="topbar">
                <div><p className="eyebrow">Visão geral</p><h1>{greeting()}, {displayName.split(' ')[0]} 👋</h1></div>
                <button className="profile-pill" onClick={() => void supabase.auth.signOut()} title="Sair da conta">
                  <span className="sync-dot" />
                  <span>{syncing ? 'Sincronizando' : 'Online'}</span>
                  <LogOut size={17} />
                </button>
              </header>

              <section className="hero-card">
                <div className="hero-topline"><span>Caixa disponível</span><WalletCards size={20} /></div>
                <strong>{BRL.format(metrics.availableCash)}</strong>
                <div className="hero-foot">
                  <span><TrendingUp size={16} /> {BRL.format(metrics.expectedProfit)} de lucro previsto</span>
                  <button onClick={() => setShowNewLoan(true)}><Plus size={18} /> Novo empréstimo</button>
                </div>
              </section>

              <div className="metrics-grid">
                <Metric icon={<Banknote />} label="Emprestado" value={BRL.format(metrics.principalOut)} hint="Capital na rua" />
                <Metric icon={<ArrowDownLeft />} label="A receber" value={BRL.format(metrics.toReceive)} hint="Saldo futuro" />
                <Metric icon={<ArrowUpRight />} label="Recebido" value={BRL.format(metrics.received)} hint="Retorno ao caixa" />
                <Metric icon={<Clock3 />} label="Atrasados" value={`${metrics.overdue}`} hint="Precisam de atenção" danger={metrics.overdue > 0} />
              </div>

              <section className="section-card">
                <div className="section-heading">
                  <div><p className="eyebrow">Agenda financeira</p><h2>Próximos recebimentos</h2></div>
                  <CalendarDays size={20} />
                </div>
                <div className="loan-list">
                  {upcoming.length === 0 && <EmptyState title="Nenhum recebimento pendente" text="Quando você cadastrar um empréstimo, os próximos vencimentos aparecem aqui." />}
                  {upcoming.map((loan) => {
                    const client = getClient(loan.clientId);
                    if (!client) return null;
                    return <LoanRow key={loan.id} loan={loan} client={client} onWhatsapp={openWhatsapp} onPayment={setPaymentLoan} />;
                  })}
                </div>
              </section>
            </motion.section>
          )}

          {tab === 'clients' && (
            <motion.section key="clients" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <PageHeader eyebrow="Relacionamentos" title="Clientes" action={() => setShowNewLoan(true)} />
              <div className="search-box"><Search size={18} /><input placeholder="Buscar cliente ou WhatsApp" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
              <div className="client-grid">
                {filteredClients.length === 0 && <EmptyState title="Nenhum cliente encontrado" text="Cadastre um novo empréstimo para adicionar seu primeiro cliente." />}
                {filteredClients.map((client) => {
                  const loans = store.loans.filter((loan) => loan.clientId === client.id && loan.dbStatus !== 'cancelled');
                  const balance = loans.reduce((sum, loan) => sum + Math.max(loan.receivable - loan.paidAmount, 0), 0);
                  return (
                    <motion.article whileTap={{ scale: 0.985 }} className="client-card" key={client.id}>
                      <div className="avatar">{initials(client.name)}</div>
                      <div className="client-main"><strong>{client.name}</strong><span>{client.phone}</span><small>{loans.length} empréstimo(s) · {BRL.format(balance)} pendente</small></div>
                      <button className="icon-btn whatsapp" onClick={() => openWhatsapp(client)} aria-label="Abrir WhatsApp"><MessageCircle size={19} /></button>
                    </motion.article>
                  );
                })}
              </div>
            </motion.section>
          )}

          {tab === 'loans' && (
            <motion.section key="loans" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <PageHeader eyebrow="Carteira" title="Empréstimos" action={() => setShowNewLoan(true)} />
              <div className="loan-list expanded">
                {store.loans.length === 0 && <EmptyState title="Sua carteira está vazia" text="Use o botão + para cadastrar o primeiro empréstimo." />}
                {store.loans.filter((loan) => loan.dbStatus !== 'cancelled').map((loan) => {
                  const client = getClient(loan.clientId);
                  if (!client) return null;
                  return <LoanRow key={loan.id} loan={loan} client={client} onWhatsapp={openWhatsapp} onPayment={setPaymentLoan} />;
                })}
              </div>
            </motion.section>
          )}

          {tab === 'cash' && (
            <motion.section key="cash" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <PageHeader eyebrow="Financeiro" title="Meu caixa" />
              <section className="cash-panel">
                <div className="cash-ring"><CircleDollarSign size={34} /></div>
                <span>Saldo livre para emprestar</span>
                <strong>{BRL.format(metrics.availableCash)}</strong>
                <p>Seu caixa considera o valor inicial, todos os empréstimos liberados e todos os pagamentos registrados.</p>
                <div className="cash-actions"><button className="secondary-action" onClick={() => setShowCashEditor(true)}><Pencil size={17} /> Ajustar caixa inicial</button></div>
              </section>
              <div className="metrics-grid">
                <Metric icon={<WalletCards />} label="Caixa inicial" value={BRL.format(store.openingCash)} hint="Capital configurado" />
                <Metric icon={<Banknote />} label="Na rua" value={BRL.format(metrics.principalOut)} hint="Principal em aberto" />
                <Metric icon={<ArrowDownLeft />} label="Retornou" value={BRL.format(metrics.received)} hint="Pagamentos" />
                <Metric icon={<TrendingUp />} label="Margem prevista" value={BRL.format(metrics.expectedProfit)} hint="Lucro dos abertos" />
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <nav className="bottom-nav">
        <NavButton active={tab === 'home'} onClick={() => setTab('home')} icon={<Home />} label="Início" />
        <NavButton active={tab === 'clients'} onClick={() => setTab('clients')} icon={<UsersRound />} label="Clientes" />
        <button className="nav-main-action" onClick={() => setShowNewLoan(true)} aria-label="Novo empréstimo"><Plus size={25} /></button>
        <NavButton active={tab === 'loans'} onClick={() => setTab('loans')} icon={<Banknote />} label="Empréstimos" />
        <NavButton active={tab === 'cash'} onClick={() => setTab('cash')} icon={<WalletCards />} label="Caixa" />
      </nav>

      <AnimatePresence>
        {showNewLoan && <NewLoanModal clients={store.clients} busy={syncing} onClose={() => setShowNewLoan(false)} onSubmit={createLoan} />}
        {paymentLoan && <PaymentModal loan={paymentLoan} client={getClient(paymentLoan.clientId)} busy={syncing} onClose={() => setPaymentLoan(null)} onSubmit={(amount) => registerPayment(paymentLoan, amount)} />}
        {showCashEditor && <CashModal current={store.openingCash} busy={syncing} onClose={() => setShowCashEditor(false)} onSubmit={updateOpeningCash} />}
      </AnimatePresence>
    </div>
  );
}

function Metric({ icon, label, value, hint, danger }: { icon: ReactNode; label: string; value: string; hint: string; danger?: boolean }) {
  return (
    <motion.article whileHover={{ y: -2 }} className={`metric-card ${danger ? 'danger' : ''}`}>
      <div className="metric-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{hint}</small>
    </motion.article>
  );
}

function PageHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: () => void }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>{action && <button className="round-add" onClick={action}><Plus size={20} /></button>}</header>;
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function LoanRow({ loan, client, onWhatsapp, onPayment }: { loan: Loan; client: Client; onWhatsapp: (client: Client, loan: Loan) => void; onPayment: (loan: Loan) => void }) {
  const status = getStatus(loan);
  const remaining = Math.max(loan.receivable - loan.paidAmount, 0);
  return (
    <motion.article layout className="loan-row">
      <div className="avatar small">{initials(client.name)}</div>
      <div className="loan-info">
        <div className="loan-title"><strong>{client.name}</strong><span className={`status ${status}`}>{statusLabel(status)}</span></div>
        <div className="loan-meta"><span>{DATE.format(new Date(`${loan.dueDate}T12:00:00`))}</span><span>•</span><span>Emprestado {BRL.format(loan.principal)}</span></div>
      </div>
      <div className="loan-value"><strong>{BRL.format(remaining)}</strong><span>{status === 'paid' ? 'quitado' : 'a receber'}</span></div>
      <div className="row-actions">
        {status !== 'paid' && <button className="mini-btn whatsapp" onClick={() => onWhatsapp(client, loan)} title="Cobrar no WhatsApp"><MessageCircle size={17} /></button>}
        {status !== 'paid' && <button className="mini-btn paid" onClick={() => onPayment(loan)} title="Registrar pagamento"><Check size={17} /></button>}
        {status === 'paid' && <div className="paid-seal"><Check size={17} /></div>}
        <ChevronRight size={18} className="chevron" />
      </div>
    </motion.article>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><Sparkles size={23} /><strong>{title}</strong><span>{text}</span></div>;
}

function NewLoanModal({ clients, busy, onClose, onSubmit }: { clients: Client[]; busy: boolean; onClose: () => void; onSubmit: (data: NewLoanInput) => Promise<void> }) {
  const [mode, setMode] = useState<'existing' | 'new'>(clients.length > 0 ? 'existing' : 'new');
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [principal, setPrincipal] = useState('');
  const [receivable, setReceivable] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');

  const principalNumber = Number(principal || 0);
  const receivableNumber = Number(receivable || 0);
  const profit = receivableNumber - principalNumber;
  const markup = principalNumber > 0 ? (profit / principalNumber) * 100 : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (mode === 'existing' && !clientId) return setError('Selecione um cliente.');
    if (mode === 'new' && (!name.trim() || !phone.trim())) return setError('Preencha nome e WhatsApp do cliente.');
    if (!principalNumber || !receivableNumber || !dueDate) return setError('Preencha os valores e a data de vencimento.');
    if (receivableNumber < principalNumber) return setError('O valor a receber não pode ser menor que o valor emprestado.');

    await onSubmit({
      clientId: mode === 'existing' ? clientId : undefined,
      name: mode === 'new' ? name : undefined,
      phone: mode === 'new' ? phone : undefined,
      principal: principalNumber,
      receivable: receivableNumber,
      dueDate,
    });
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="modal-card" initial={{ y: 50, opacity: 0, scale: .98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 50, opacity: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 30 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header"><div><p className="eyebrow">Nova operação</p><h2>Novo empréstimo</h2></div><button className="icon-btn" onClick={onClose}><X size={20} /></button></div>
        <form onSubmit={submit}>
          {clients.length > 0 && (
            <div className="segmented">
              <button type="button" className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>Cliente existente</button>
              <button type="button" className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>Novo cliente</button>
            </div>
          )}

          {mode === 'existing' ? (
            <label>Cliente<select value={clientId} onChange={(e) => setClientId(e.target.value)}>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.phone}</option>)}</select></label>
          ) : (
            <>
              <label>Nome do cliente<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João da Silva" /></label>
              <label>WhatsApp<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" /></label>
            </>
          )}

          <div className="form-grid">
            <label>Valor emprestado<input value={principal} onChange={(e) => setPrincipal(e.target.value.replace(',', '.'))} placeholder="200" inputMode="decimal" /></label>
            <label>Valor a receber<input value={receivable} onChange={(e) => setReceivable(e.target.value.replace(',', '.'))} placeholder="300" inputMode="decimal" /></label>
          </div>
          <label>Vencimento<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
          <div className="profit-preview"><TrendingUp size={19} /><div><span>Lucro previsto</span><strong>{BRL.format(Math.max(profit, 0))} {principalNumber > 0 && `· ${Math.max(markup, 0).toFixed(0)}%`}</strong></div></div>
          {error && <div className="form-error">{error}</div>}
          <button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><Plus size={19} /> {busy ? 'Salvando...' : 'Criar empréstimo'}</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function PaymentModal({ loan, client, busy, onClose, onSubmit }: { loan: Loan; client?: Client; busy: boolean; onClose: () => void; onSubmit: (amount: number) => Promise<void> }) {
  const remaining = Math.max(loan.receivable - loan.paidAmount, 0);
  const [amount, setAmount] = useState(String(remaining.toFixed(2)));
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const numeric = Number(amount.replace(',', '.'));
    if (!numeric || numeric <= 0) return setError('Informe um valor válido.');
    if (numeric > remaining) return setError('O pagamento não pode ultrapassar o saldo em aberto.');
    await onSubmit(numeric);
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="modal-card" initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header"><div><p className="eyebrow">Recebimento</p><h2>Registrar pagamento</h2></div><button className="icon-btn" onClick={onClose}><X size={20} /></button></div>
        <form onSubmit={submit}>
          <div className="payment-summary">
            <div><span>Cliente</span><strong>{client?.name ?? 'Cliente'}</strong></div>
            <div><span>Saldo em aberto</span><strong>{BRL.format(remaining)}</strong></div>
          </div>
          <label>Valor recebido<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
          <p className="inline-note">Você pode registrar pagamento parcial ou quitar tudo de uma vez. O caixa é atualizado automaticamente.</p>
          {error && <div className="form-error">{error}</div>}
          <button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><Check size={19} /> {busy ? 'Registrando...' : 'Confirmar recebimento'}</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function CashModal({ current, busy, onClose, onSubmit }: { current: number; busy: boolean; onClose: () => void; onSubmit: (amount: number) => Promise<void> }) {
  const [amount, setAmount] = useState(String(current.toFixed(2)));
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const numeric = Number(amount.replace(',', '.'));
    if (Number.isNaN(numeric) || numeric < 0) return setError('Informe um valor de caixa válido.');
    await onSubmit(numeric);
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="modal-card" initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header"><div><p className="eyebrow">Capital</p><h2>Caixa inicial</h2></div><button className="icon-btn" onClick={onClose}><X size={20} /></button></div>
        <form onSubmit={submit}>
          <label>Quanto você tem disponível como capital?<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
          <p className="inline-note">Exemplo: se você começa com R$ 2.000, empresta R$ 200 e recebe R$ 300, o caixa passa a mostrar R$ 2.100.</p>
          {error && <div className="form-error">{error}</div>}
          <button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><WalletCards size={19} /> {busy ? 'Salvando...' : 'Salvar caixa'}</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function AuthScreen({ onSignIn, onSignUp }: { onSignIn: (email: string, password: string) => Promise<void>; onSignUp: (name: string, email: string, password: string) => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNote('');
    if (!email.trim() || password.length < 6) return setError('Informe um e-mail válido e uma senha com pelo menos 6 caracteres.');
    if (mode === 'signup' && !name.trim()) return setError('Informe seu nome.');

    setBusy(true);
    try {
      if (mode === 'login') {
        await onSignIn(email.trim(), password);
      } else {
        await onSignUp(name.trim(), email.trim(), password);
        setNote('Se a confirmação de e-mail estiver ativa, abra o link enviado para entrar.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir o acesso.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <motion.section className="auth-card" initial={{ opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
        <div className="auth-logo-row"><div className="auth-logo">E</div><div><strong>Emprestei</strong><span>Seu dinheiro sob controle</span></div></div>
        <p className="eyebrow">Fintech pessoal</p>
        <h1>{mode === 'login' ? 'Acesse seu painel' : 'Crie sua conta'}</h1>
        <p className="auth-subtitle">Clientes, vencimentos, caixa e recebimentos em uma experiência rápida e segura.</p>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'signup' && <label>Seu nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como quer ser chamado" autoComplete="name" /></label>}
          <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" autoComplete="email" /></label>
          <label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
          {error && <div className="auth-error">{error}</div>}
          {note && <div className="auth-note">{note}</div>}
          <button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><ShieldCheck size={19} /> {busy ? 'Processando...' : mode === 'login' ? 'Entrar no Emprestei' : 'Criar minha conta'}</button>
        </form>
        <div className="auth-switch">{mode === 'login' ? 'Primeiro acesso?' : 'Já possui conta?'} <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setNote(''); }}>{mode === 'login' ? 'Criar conta' : 'Entrar'}</button></div>
      </motion.section>
    </div>
  );
}

function LoadingScreen({ text }: { text: string }) {
  return <div className="loading-screen"><div className="loading-card"><div className="spinner" /><strong>Emprestei</strong><span>{text}...</span></div></div>;
}
