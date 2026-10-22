import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
  MessageCircle,
  Plus,
  Search,
  TrendingUp,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';

type Status = 'open' | 'due' | 'late' | 'paid';
type Tab = 'home' | 'clients' | 'loans' | 'cash';

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
};

type Store = {
  openingCash: number;
  clients: Client[];
  loans: Loan[];
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const STORAGE_KEY = 'emprestei-v1-store';

const seed: Store = {
  openingCash: 5000,
  clients: [
    { id: 'c1', name: 'Carlos Henrique', phone: '5511999999999', note: 'Cliente recorrente' },
    { id: 'c2', name: 'Mariana Lopes', phone: '5511988888888' },
    { id: 'c3', name: 'João Silva', phone: '5511977777777' },
  ],
  loans: [
    { id: 'l1', clientId: 'c1', principal: 700, receivable: 920, dueDate: '2026-10-22', createdAt: '2026-10-10', paidAmount: 0 },
    { id: 'l2', clientId: 'c2', principal: 450, receivable: 600, dueDate: '2026-10-28', createdAt: '2026-10-15', paidAmount: 0 },
    { id: 'l3', clientId: 'c3', principal: 300, receivable: 420, dueDate: '2026-10-18', createdAt: '2026-10-05', paidAmount: 120 },
  ],
};

function loadStore(): Store {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : seed;
  } catch {
    return seed;
  }
}

function getStatus(loan: Loan): Status {
  if (loan.paidAmount >= loan.receivable) return 'paid';
  const todayKey = new Date().toISOString().slice(0, 10);
  if (loan.dueDate < todayKey) return 'late';
  if (loan.dueDate === todayKey) return 'due';
  return 'open';
}

function statusLabel(status: Status) {
  return { open: 'Em aberto', due: 'Vence hoje', late: 'Atrasado', paid: 'Pago' }[status];
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function safePhone(phone: string) {
  return phone.replace(/\D/g, '');
}

export default function App() {
  const [store, setStore] = useState<Store>(loadStore);
  const [tab, setTab] = useState<Tab>('home');
  const [showNewLoan, setShowNewLoan] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [store]);

  const metrics = useMemo(() => {
    const principalOut = store.loans.reduce((sum, loan) => getStatus(loan) === 'paid' ? sum : sum + loan.principal, 0);
    const received = store.loans.reduce((sum, loan) => sum + loan.paidAmount, 0);
    const toReceive = store.loans.reduce((sum, loan) => sum + Math.max(loan.receivable - loan.paidAmount, 0), 0);
    const expectedProfit = store.loans.reduce((sum, loan) => sum + Math.max(loan.receivable - loan.principal, 0), 0);
    const availableCash = store.openingCash - store.loans.reduce((sum, loan) => sum + loan.principal, 0) + received;
    const overdue = store.loans.filter((loan) => getStatus(loan) === 'late').length;
    return { principalOut, received, toReceive, expectedProfit, availableCash, overdue };
  }, [store]);

  const upcoming = useMemo(
    () => [...store.loans].filter((loan) => getStatus(loan) !== 'paid').sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 4),
    [store.loans],
  );

  const filteredClients = store.clients.filter((client) =>
    `${client.name} ${client.phone}`.toLowerCase().includes(search.toLowerCase()),
  );

  function getClient(clientId: string) {
    return store.clients.find((client) => client.id === clientId)!;
  }

  function openWhatsapp(client: Client, loan?: Loan) {
    const amount = loan ? BRL.format(Math.max(loan.receivable - loan.paidAmount, 0)) : '';
    const message = loan
      ? `Olá, ${client.name.split(' ')[0]}! Passando para lembrar do valor de ${amount}, com vencimento em ${new Date(`${loan.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}. Qualquer dúvida, me chama por aqui.`
      : `Olá, ${client.name.split(' ')[0]}! Tudo bem?`;
    window.open(`https://wa.me/${safePhone(client.phone)}?text=${encodeURIComponent(message)}`, '_blank');
  }

  function registerPayment(loanId: string) {
    setStore((current) => ({
      ...current,
      loans: current.loans.map((loan) => loan.id === loanId ? { ...loan, paidAmount: loan.receivable } : loan),
    }));
  }

  function createLoan(data: { name: string; phone: string; principal: number; receivable: number; dueDate: string }) {
    const clientId = crypto.randomUUID();
    const loanId = crypto.randomUUID();
    setStore((current) => ({
      ...current,
      clients: [...current.clients, { id: clientId, name: data.name, phone: safePhone(data.phone) }],
      loans: [...current.loans, {
        id: loanId,
        clientId,
        principal: data.principal,
        receivable: data.receivable,
        dueDate: data.dueDate,
        createdAt: new Date().toISOString().slice(0, 10),
        paidAmount: 0,
      }],
    }));
    setShowNewLoan(false);
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <main className="app-content">
        <AnimatePresence mode="wait">
          {tab === 'home' && (
            <motion.section key="home" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <header className="topbar">
                <div><p className="eyebrow">Visão geral</p><h1>Boa tarde 👋</h1></div>
                <div className="brand-mark">E</div>
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
                  {upcoming.map((loan) => {
                    const client = getClient(loan.clientId);
                    return <LoanRow key={loan.id} loan={loan} client={client} onWhatsapp={openWhatsapp} onPaid={registerPayment} />;
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
                {filteredClients.map((client) => {
                  const loans = store.loans.filter((loan) => loan.clientId === client.id);
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
                {[...store.loans].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((loan) => (
                  <LoanRow key={loan.id} loan={loan} client={getClient(loan.clientId)} onWhatsapp={openWhatsapp} onPaid={registerPayment} />
                ))}
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
              </section>
              <div className="metrics-grid">
                <Metric icon={<WalletCards />} label="Caixa inicial" value={BRL.format(store.openingCash)} hint="Base configurada" />
                <Metric icon={<Banknote />} label="Na rua" value={BRL.format(metrics.principalOut)} hint="Principal em aberto" />
                <Metric icon={<ArrowDownLeft />} label="Retornou" value={BRL.format(metrics.received)} hint="Pagamentos" />
                <Metric icon={<TrendingUp />} label="Margem prevista" value={BRL.format(metrics.expectedProfit)} hint="Receita bruta esperada" />
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

      <AnimatePresence>{showNewLoan && <NewLoanModal onClose={() => setShowNewLoan(false)} onSubmit={createLoan} />}</AnimatePresence>
    </div>
  );
}

function Metric({ icon, label, value, hint, danger }: { icon: React.ReactNode; label: string; value: string; hint: string; danger?: boolean }) {
  return (
    <motion.article whileHover={{ y: -2 }} className={`metric-card ${danger ? 'danger' : ''}`}>
      <div className="metric-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{hint}</small>
    </motion.article>
  );
}

function PageHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: () => void }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>{action && <button className="round-add" onClick={action}><Plus size={20} /></button>}</header>;
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function LoanRow({ loan, client, onWhatsapp, onPaid }: { loan: Loan; client: Client; onWhatsapp: (client: Client, loan: Loan) => void; onPaid: (id: string) => void }) {
  const status = getStatus(loan);
  const remaining = Math.max(loan.receivable - loan.paidAmount, 0);
  return (
    <motion.article layout className="loan-row">
      <div className="avatar small">{initials(client.name)}</div>
      <div className="loan-info">
        <div className="loan-title"><strong>{client.name}</strong><span className={`status ${status}`}>{statusLabel(status)}</span></div>
        <div className="loan-meta"><span>{DATE.format(new Date(`${loan.dueDate}T12:00:00`))}</span><span>•</span><span>Emprestado {BRL.format(loan.principal)}</span></div>
      </div>
      <div className="loan-value"><strong>{BRL.format(remaining)}</strong><span>a receber</span></div>
      <div className="row-actions">
        {status !== 'paid' && <button className="mini-btn whatsapp" onClick={() => onWhatsapp(client, loan)}><MessageCircle size={17} /></button>}
        {status !== 'paid' && <button className="mini-btn paid" onClick={() => onPaid(loan.id)}><Check size={17} /></button>}
        {status === 'paid' && <div className="paid-seal"><Check size={17} /></div>}
        <ChevronRight size={18} className="chevron" />
      </div>
    </motion.article>
  );
}

function NewLoanModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: { name: string; phone: string; principal: number; receivable: number; dueDate: string }) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [principal, setPrincipal] = useState('');
  const [receivable, setReceivable] = useState('');
  const [dueDate, setDueDate] = useState('');
  const profit = Math.max(Number(receivable || 0) - Number(principal || 0), 0);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name || !phone || !principal || !receivable || !dueDate) return;
    onSubmit({ name, phone, principal: Number(principal), receivable: Number(receivable), dueDate });
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="modal-card" initial={{ y: 50, opacity: 0, scale: .98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 50, opacity: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 30 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header"><div><p className="eyebrow">Nova operação</p><h2>Novo empréstimo</h2></div><button className="icon-btn" onClick={onClose}><X size={20} /></button></div>
        <form onSubmit={submit}>
          <label>Nome do cliente<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João da Silva" /></label>
          <label>WhatsApp<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" /></label>
          <div className="form-grid">
            <label>Valor emprestado<input value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="200" inputMode="decimal" /></label>
            <label>Valor a receber<input value={receivable} onChange={(e) => setReceivable(e.target.value)} placeholder="300" inputMode="decimal" /></label>
          </div>
          <label>Vencimento<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
          <div className="profit-preview"><TrendingUp size={19} /><div><span>Lucro previsto</span><strong>{BRL.format(profit)}</strong></div></div>
          <button className="primary-action" type="submit"><Plus size={19} /> Criar empréstimo</button>
        </form>
      </motion.div>
    </motion.div>
  );
}
