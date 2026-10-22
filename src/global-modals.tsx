import { FormEvent, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check, Plus, TrendingUp, WalletCards, X } from 'lucide-react';

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
type NewLoanInput = { clientId?: string; name?: string; phone?: string; principal: number; receivable: number; dueDate: string };
type PaymentInput = { type: 'interest' | 'full'; newDueDate?: string };

type NewLoanProps = { clients: Client[]; busy: boolean; onClose: () => void; onSubmit: (data: NewLoanInput) => Promise<void> };
type PaymentProps = { loan: Loan; client?: Client; busy: boolean; onClose: () => void; onSubmit: (input: PaymentInput) => Promise<void> };
type CashProps = { current: number; busy: boolean; onClose: () => void; onSubmit: (amount: number) => Promise<void> };

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function localTodayKey() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
function openBalance(loan: Loan) { return Math.max(loan.outstandingPrincipal + loan.currentInterestDue, 0); }

function Modal({ onClose, eyebrow, title, children }: { onClose: () => void; eyebrow: string; title: string; children: ReactNode }) {
  return <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
    <motion.div className="modal-card" initial={{ y: 50, opacity: 0, scale: .98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 50, opacity: 0 }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-handle" />
      <div className="modal-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button className="icon-btn" onClick={onClose}><X size={20} /></button></div>
      {children}
    </motion.div>
  </motion.div>;
}

function NewLoanModalImpl({ clients, busy, onClose, onSubmit }: NewLoanProps) {
  const [mode, setMode] = useState<'existing' | 'new'>(clients.length > 0 ? 'existing' : 'new');
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [principal, setPrincipal] = useState(''); const [receivable, setReceivable] = useState(''); const [dueDate, setDueDate] = useState(''); const [error, setError] = useState('');
  const principalNumber = Number(principal || 0); const receivableNumber = Number(receivable || 0); const profit = receivableNumber - principalNumber; const markup = principalNumber > 0 ? profit / principalNumber * 100 : 0;
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (mode === 'existing' && !clientId) return setError('Selecione um cliente.');
    if (mode === 'new' && !name.trim()) return setError('Informe o nome do cliente.');
    if (!principalNumber || !receivableNumber || !dueDate) return setError('Preencha os valores e a data de vencimento.');
    if (receivableNumber < principalNumber) return setError('O valor a receber não pode ser menor que o valor emprestado.');
    await onSubmit({ clientId: mode === 'existing' ? clientId : undefined, name: mode === 'new' ? name : undefined, phone: mode === 'new' ? phone : undefined, principal: principalNumber, receivable: receivableNumber, dueDate });
  }
  return <Modal onClose={onClose} eyebrow="Nova operação" title="Novo empréstimo"><form onSubmit={submit}>
    {clients.length > 0 && <div className="segmented"><button type="button" className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>Cliente existente</button><button type="button" className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>Novo cliente</button></div>}
    {mode === 'existing' ? <label>Cliente<select value={clientId} onChange={(e) => setClientId(e.target.value)}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone || 'sem WhatsApp'}</option>)}</select></label> : <><label>Nome do cliente<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: João da Silva" /></label><label>WhatsApp <span style={{opacity:.65,fontWeight:700}}>(opcional)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" /><small className="inline-note">Você pode deixar em branco. O Emprestei pedirá o número quando você tocar em “Enviar aviso”.</small></label></>}
    <div className="form-grid"><label>Valor emprestado<input value={principal} onChange={(e) => setPrincipal(e.target.value.replace(',', '.'))} placeholder="1000" inputMode="decimal" /></label><label>Valor a receber<input value={receivable} onChange={(e) => setReceivable(e.target.value.replace(',', '.'))} placeholder="1350" inputMode="decimal" /></label></div>
    <label>Vencimento<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
    <div className="profit-preview"><TrendingUp size={19} /><div><span>Juros combinados por ciclo</span><strong>{BRL.format(Math.max(profit, 0))} {principalNumber > 0 && `· ${Math.max(markup, 0).toFixed(0)}%`}</strong></div></div>
    {error && <div className="form-error">{error}</div>}
    <button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><Plus size={19} /> {busy ? 'Salvando...' : 'Criar empréstimo'}</button>
  </form></Modal>;
}

function PaymentModalImpl({ loan, client, busy, onClose, onSubmit }: PaymentProps) {
  const [type, setType] = useState<'interest' | 'full'>('full'); const [newDueDate, setNewDueDate] = useState(''); const [error, setError] = useState(''); const total = openBalance(loan);
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); if (type === 'interest') { if (!newDueDate) return setError('Informe o próximo vencimento.'); if (newDueDate <= localTodayKey()) return setError('Escolha uma data futura.'); await onSubmit({ type, newDueDate }); return; } await onSubmit({ type: 'full' }); }
  return <Modal onClose={onClose} eyebrow="Recebimento" title="Registrar pagamento"><form onSubmit={submit}>
    <div className="payment-summary"><div><span>Cliente</span><strong>{client?.name ?? 'Cliente'}</strong></div><div><span>Total do ciclo</span><strong>{BRL.format(total)}</strong></div></div>
    <div className="payment-type-grid payment-two"><button type="button" className={type === 'full' ? 'active full' : ''} onClick={() => setType('full')}><Check size={18} /><strong>Quitação total</strong><span>{BRL.format(total)}</span></button><button type="button" className={type === 'interest' ? 'active interest' : ''} onClick={() => setType('interest')}><TrendingUp size={18} /><strong>Só os juros</strong><span>{BRL.format(loan.currentInterestDue)}</span></button></div>
    {type === 'full' ? <div className="payment-explainer success"><Check size={18} /><div><strong>Encerrar a dívida</strong><span>Entra {BRL.format(total)} no caixa e o empréstimo fica quitado.</span></div></div> : <><div className="payment-explainer warning"><TrendingUp size={18} /><div><strong>Renovar por mais um ciclo</strong><span>Entram {BRL.format(loan.currentInterestDue)} de juros. O principal de {BRL.format(loan.outstandingPrincipal)} continua emprestado e no próximo vencimento o total volta a ser {BRL.format(loan.outstandingPrincipal + loan.interestAmount)}.</span></div></div><label>Próximo vencimento<input type="date" value={newDueDate} min={localTodayKey()} onChange={(e) => setNewDueDate(e.target.value)} /></label></>}
    {error && <div className="form-error">{error}</div>}
    <button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><Check size={19} /> {busy ? 'Registrando...' : type === 'full' ? 'Confirmar quitação' : 'Confirmar juros e renovar'}</button>
  </form></Modal>;
}

function CashModalImpl({ current, busy, onClose, onSubmit }: CashProps) {
  const [amount, setAmount] = useState(String(current.toFixed(2))); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); const numeric = Number(amount.replace(',', '.')); if (Number.isNaN(numeric) || numeric < 0) return setError('Informe um valor de caixa válido.'); await onSubmit(numeric); }
  return <Modal onClose={onClose} eyebrow="Capital" title="Caixa inicial"><form onSubmit={submit}><label>Quanto você tem disponível como capital?<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label><p className="inline-note">Pagamentos de juros e quitações entram automaticamente no caixa.</p>{error && <div className="form-error">{error}</div>}<button className={`primary-action ${busy ? 'button-busy' : ''}`} type="submit"><WalletCards size={19} /> {busy ? 'Salvando...' : 'Salvar caixa'}</button></form></Modal>;
}

declare global {
  var NewLoanModal: (props: NewLoanProps) => ReactNode;
  var PaymentModal: (props: PaymentProps) => ReactNode;
  var CashModal: (props: CashProps) => ReactNode;
}

globalThis.NewLoanModal = NewLoanModalImpl;
globalThis.PaymentModal = PaymentModalImpl;
globalThis.CashModal = CashModalImpl;

export {};
