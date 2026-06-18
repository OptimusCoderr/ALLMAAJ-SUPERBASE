import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { find, insertOne, updateOne, Collections } from '../lib/api';
import type { Product, Branch, BranchStock, Expense, Debtor } from '../lib/types';
import {
  Plus, Trash2, ShoppingCart, CheckCircle, UserPlus, Receipt,
  Pencil, Lock, Send, AlertTriangle, X,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CartItem { product: Product; quantity: number; unitPrice: number }
type Tab           = 'sale' | 'debtor' | 'expense';
type PaymentMethod = 'cash' | 'pos' | 'part' | 'unpaid';

interface EditSaleState {
  sale: any;
  cart: CartItem[];
  pm: PaymentMethod;
  customerName: string; customerPhone: string;
  amountPaid: number;   notes: string;
  addProduct: string;   addQty: number; addPrice: number;
  loading: boolean;     error: string;
}
interface EditExpenseState {
  expense: Expense;
  desc: string; amount: string; category: string; notes: string;
  loading: boolean; error: string;
}
interface EditDebtorState {
  debtor: Debtor;
  name: string; phone: string; amount: string; notes: string;
  loading: boolean; error: string;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

const PM_COLORS: Record<string, string> = {
  cash:   'bg-green-100 text-green-700',
  pos:    'bg-blue-100 text-blue-700',
  part:   'bg-orange-100 text-orange-700',
  unpaid: 'bg-red-100 text-red-700',
};
const PM_LABELS: Record<string, string> = {
  cash: 'Cash', pos: 'POS', part: 'Part Payment', unpaid: 'Unpaid',
};
const EXPENSE_CATS = ['transport', 'utilities', 'supplies', 'maintenance', 'other'] as const;
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

function fmt(n: number) {
  return `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}
function getToken() {
  return sessionStorage.getItem('bt_session') || localStorage.getItem('bt_session') || '';
}
function isToday(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr), now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth()    === now.getMonth()    &&
         d.getDate()     === now.getDate();
}
function safeItems(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return []; } }
  return [];
}
function pmButtonStyle(m: PaymentMethod, current: PaymentMethod) {
  const on = current === m;
  const c: Record<PaymentMethod, string> = {
    cash:   on ? 'bg-green-500 text-white border-green-500'   : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
    pos:    on ? 'bg-blue-500 text-white border-blue-500'     : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
    part:   on ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
    unpaid: on ? 'bg-red-500 text-white border-red-500'       : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
  };
  return `flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${c[m]}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SalesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [tab, setTab]                 = useState<Tab>('sale');
  const [products, setProducts]       = useState<Product[]>([]);
  const [branches, setBranches]       = useState<Branch[]>([]);
  const [branchStock, setBranchStock] = useState<BranchStock[]>([]);
  const [todaySales, setTodaySales]       = useState<any[]>([]);
  const [todayExpenses, setTodayExpenses] = useState<Expense[]>([]);
  const [todayDebtors, setTodayDebtors]   = useState<Debtor[]>([]);
  const [rightTab, setRightTab] = useState<'sales' | 'expenses' | 'debtors'>('sales');

  // Sale form
  const [selectedBranch, setSelectedBranch]   = useState(user?.branchId || '');
  const [paymentMethod, setPaymentMethod]     = useState<PaymentMethod>('cash');
  const [customerName, setCustomerName]       = useState('');
  const [customerPhone, setCustomerPhone]     = useState('');
  const [amountPaid, setAmountPaid]           = useState(0);
  const [notes, setNotes]                     = useState('');
  const [saleDate, setSaleDate]               = useState(new Date().toISOString().split('T')[0]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [qty, setQty]     = useState(1);
  const [price, setPrice] = useState(0);
  const [cart, setCart]   = useState<CartItem[]>([]);

  // Debtor form
  const [debtorName, setDebtorName]     = useState('');
  const [debtorPhone, setDebtorPhone]   = useState('');
  const [debtorAmount, setDebtorAmount] = useState('');
  const [debtorNotes, setDebtorNotes]   = useState('');

  // Expense form
  const [expenseDesc, setExpenseDesc]         = useState('');
  const [expenseAmount, setExpenseAmount]     = useState('');
  const [expenseCategory, setExpenseCategory] = useState<typeof EXPENSE_CATS[number]>('other');
  const [expenseNotes, setExpenseNotes]       = useState('');

  // Shared form feedback
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError]     = useState('');

  // Edit modals — consolidated (replaces 24 individual useState calls)
  const [editSale, setEditSale]       = useState<EditSaleState | null>(null);
  const [editExpense, setEditExpense] = useState<EditExpenseState | null>(null);
  const [editDebtor, setEditDebtor]   = useState<EditDebtorState | null>(null);

  // Daily report
  const [reportLoading, setReportLoading] = useState(false);
  const [reportMsg, setReportMsg]         = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { fetchData(); }, [user]);
  useEffect(() => { if (selectedBranch) fetchStock(selectedBranch); }, [selectedBranch]);

  function switchTab(t: Tab) {
    setTab(t);
    setError('');
    setSuccess('');
  }

  async function fetchData() {
    const [prods, brs] = await Promise.all([
      find(Collections.PRODUCTS, { isActive: true }, { sort: { name: 1 } }),
      find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }),
    ]);
    setProducts(prods as Product[]);
    setBranches(brs as Branch[]);
    const branch = user?.branchId || (brs[0]?._id ?? '');
    if (branch) {
      setSelectedBranch(branch);
      fetchTodayData(branch);
    }
  }

  async function fetchStock(branchId: string) {
    const data = await find(Collections.BRANCH_STOCK, { branchId });
    setBranchStock(data as BranchStock[]);
  }

  async function fetchTodayData(branchId: string) {
    const today = new Date().toISOString().split('T')[0];
    const start = `${today}T00:00:00.000Z`;
    const end   = `${today}T23:59:59.999Z`;
    const [salesData, expensesData, debtorsData] = await Promise.all([
      find(Collections.SALES,    { branchId, saleDate:    { $gte: start } }, { sort: { createdAt: -1 }, limit: 100 }),
      find(Collections.EXPENSES, { branchId, expenseDate: { $gte: start, $lte: end } }),
      find(Collections.DEBTORS,  { branchId, isCleared: false }),
    ]);
    setTodaySales((salesData as any[]).filter(s => !s.reportId));
    setTodayExpenses(expensesData as Expense[]);
    setTodayDebtors(debtorsData as Debtor[]);
  }

  function getStock(productId: string) {
    return branchStock.find(s => s.productId === productId)?.quantity ?? 0;
  }

  // ── Cart ──────────────────────────────────────────────────────────────────

  function addToCart() {
    const product = products.find(p => p._id === selectedProduct);
    if (!product) return;
    const alreadyInCart = cart.find(c => c.product._id === selectedProduct)?.quantity ?? 0;
    const available = getStock(selectedProduct);
    if (alreadyInCart + qty > available) {
      setError(`Not enough stock for "${product.name}". Available: ${available - alreadyInCart}`);
      return;
    }
    const idx = cart.findIndex(c => c.product._id === selectedProduct);
    if (idx >= 0) {
      setCart(cart.map((c, i) => i === idx ? { ...c, quantity: c.quantity + qty } : c));
    } else {
      setCart([...cart, { product, quantity: qty, unitPrice: price || product.unitPrice }]);
    }
    setSelectedProduct('');
    setQty(1);
    setPrice(0);
    setError('');
  }

  function updateItem(idx: number, field: 'quantity' | 'unitPrice', value: number) {
    setCart(cart.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  }

  const total   = cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
  const hasDebt = paymentMethod === 'unpaid' || paymentMethod === 'part';
  const paid    = paymentMethod === 'unpaid' ? 0 : paymentMethod === 'part' ? amountPaid : total;
  const balance = total - paid;

  // ── Sale submit ────────────────────────────────────────────────────────────

  async function handleSale(e: React.FormEvent) {
    e.preventDefault();
    if (!cart.length)    { setError('Add at least one item'); return; }
    if (!selectedBranch) { setError('Select a branch'); return; }
    if (hasDebt) {
      if (!customerName.trim())  { setError('Customer name is required for part/unpaid sales'); return; }
      if (!customerPhone.trim()) { setError('Customer phone is required for part/unpaid sales'); return; }
    }
    if (paymentMethod === 'part' && (amountPaid <= 0 || amountPaid >= total)) {
      setError('Amount paid must be greater than 0 and less than the total'); return;
    }
    setLoading(true); setError('');
    try {
      const newSaleId = await insertOne(Collections.SALES, {
        branchId: selectedBranch, staffId: user!.id, staffName: user!.fullName,
        customerName: customerName.trim(), customerPhone: customerPhone.trim(),
        paymentMethod, totalAmount: total, amountPaid: paid, balanceDue: balance,
        notes: notes.trim(),
        items: cart.map(c => ({
          productId: c.product._id, productName: c.product.name,
          quantity: c.quantity, unitPrice: c.unitPrice, subtotal: c.quantity * c.unitPrice,
        })),
        saleDate: new Date(`${saleDate}T12:00:00.000Z`).toISOString(),
      });
      if (hasDebt && balance > 0) {
        const itemsSummary = cart.map(c => `${c.product.name} x${c.quantity}`).join(', ');
        await insertOne(Collections.DEBTORS, {
          name: customerName.trim(), phone: customerPhone.trim(),
          amountOwed: balance, totalAmount: total, amountPaid: paid,
          branchId: selectedBranch, createdBy: user!.id, createdByName: user!.fullName,
          isCleared: false, saleId: newSaleId,
          notes: `Sale: ${itemsSummary}${notes.trim() ? ` | ${notes.trim()}` : ''}`,
        });
      }
      const debtMsg = hasDebt && balance > 0 ? ` Debtor of ${fmt(balance)} auto-recorded.` : '';
      setSuccess(`Sale recorded!${debtMsg}`);
      setCart([]);
      setCustomerName(''); setCustomerPhone(''); setNotes('');
      setAmountPaid(0); setPaymentMethod('cash');
      fetchTodayData(selectedBranch);
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to record sale');
    }
    setLoading(false);
  }

  // ── Debtor submit ──────────────────────────────────────────────────────────

  async function handleDebtor(e: React.FormEvent) {
    e.preventDefault();
    if (!debtorName.trim())                             { setError('Debtor name is required'); return; }
    if (!debtorPhone.trim())                            { setError('Phone number is required'); return; }
    if (!debtorAmount || parseFloat(debtorAmount) <= 0) { setError('Amount owed is required'); return; }
    setLoading(true); setError('');
    try {
      await insertOne(Collections.DEBTORS, {
        name: debtorName.trim(), phone: debtorPhone.trim(),
        amountOwed: parseFloat(debtorAmount), branchId: selectedBranch,
        createdBy: user!.id, createdByName: user!.fullName,
        isCleared: false, notes: debtorNotes.trim(),
      });
      setSuccess('Debtor recorded!');
      setDebtorName(''); setDebtorPhone(''); setDebtorAmount(''); setDebtorNotes('');
      fetchTodayData(selectedBranch);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to record debtor');
    }
    setLoading(false);
  }

  // ── Expense submit ─────────────────────────────────────────────────────────

  async function handleExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!expenseDesc.trim())                              { setError('Description is required'); return; }
    if (!expenseAmount || parseFloat(expenseAmount) <= 0) { setError('Amount is required'); return; }
    setLoading(true); setError('');
    try {
      await insertOne(Collections.EXPENSES, {
        branchId: selectedBranch, description: expenseDesc.trim(),
        amount: parseFloat(expenseAmount), category: expenseCategory,
        recordedBy: user!.id, recordedByName: user!.fullName,
        expenseDate: new Date().toISOString(), notes: expenseNotes.trim(),
      });
      setSuccess('Expense recorded!');
      setExpenseDesc(''); setExpenseAmount(''); setExpenseNotes('');
      fetchTodayData(selectedBranch);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to record expense');
    }
    setLoading(false);
  }

  // ── Daily report ───────────────────────────────────────────────────────────

  async function handleSubmitDailyReport() {
    if (!selectedBranch) { setReportMsg({ ok: false, text: 'No branch selected' }); return; }
    setReportLoading(true); setReportMsg(null);
    try {
      const today = new Date().toISOString().split('T')[0];
      const start = `${today}T00:00:00.000Z`;
      const end   = `${today}T23:59:59.999Z`;
      const [expensesData, debtorsData] = await Promise.all([
        find(Collections.EXPENSES, { branchId: selectedBranch, expenseDate: { $gte: start, $lte: end } }),
        find(Collections.DEBTORS,  { branchId: selectedBranch, isCleared: false }),
      ]);
      const totalCashSales    = todaySales.filter(s => s.paymentMethod === 'cash').reduce((a, s) => a + Number(s.totalAmount), 0);
      const totalPosSales     = todaySales.filter(s => s.paymentMethod === 'pos').reduce((a, s) => a + Number(s.totalAmount), 0);
      const totalPartSales    = todaySales.filter(s => s.paymentMethod === 'part').reduce((a, s) => a + Number(s.totalAmount), 0);
      const totalUnpaidSales  = todaySales.filter(s => s.paymentMethod === 'unpaid').reduce((a, s) => a + Number(s.totalAmount), 0);
      const totalExpenses     = (expensesData as Expense[]).reduce((a, e) => a + Number(e.amount), 0);
      const netIncome         = totalCashSales + totalPosSales + totalPartSales - totalExpenses;
      const debtorCount       = (debtorsData as Debtor[]).length;
      const totalDebtorAmount = (debtorsData as Debtor[]).reduce((a, d) => a + Number(d.amountOwed), 0);

      const res = await fetch(`${BASE}/api/reports/daily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          branchId: selectedBranch, reportDate: today,
          totalCashSales, totalPosSales, totalUnpaidSales, totalPartSales,
          totalExpenses, netIncome, debtorCount, totalDebtorAmount,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      setReportMsg({ ok: true, text: 'Daily report submitted! Awaiting admin review.' });
      setTodaySales([]);
      setTimeout(() => setReportMsg(null), 6000);
    } catch (err: any) {
      setReportMsg({ ok: false, text: err.message || 'Failed to submit report' });
      setTimeout(() => setReportMsg(null), 6000);
    }
    setReportLoading(false);
  }

  // ── Edit Sale ─────────────────────────────────────────────────────────────

  function openEditSale(sale: any) {
    const rebuilt: CartItem[] = safeItems(sale.items).map((item: any) => {
      const productId = item.product_id || item.productId;
      const found = products.find(p => p._id === productId);
      const fallback: Product = {
        _id: productId, name: item.productName || item.product_name || productId,
        unitPrice: item.unit_price ?? item.unitPrice ?? 0, unit: '', isActive: true,
      } as unknown as Product;
      return { product: found || fallback, quantity: item.quantity, unitPrice: item.unit_price ?? item.unitPrice ?? 0 };
    });
    setEditSale({
      sale, cart: rebuilt, pm: sale.paymentMethod as PaymentMethod,
      customerName: sale.customerName || '', customerPhone: sale.customerPhone || '',
      amountPaid: sale.amountPaid ?? 0, notes: sale.notes || '',
      addProduct: '', addQty: 1, addPrice: 0,
      loading: false, error: '',
    });
  }

  function addToEditCart() {
    if (!editSale?.addProduct) return;
    const product = products.find(p => p._id === editSale.addProduct);
    if (!product) return;
    const idx = editSale.cart.findIndex(c => c.product._id === editSale.addProduct);
    const newCart = idx >= 0
      ? editSale.cart.map((c, i) => i === idx ? { ...c, quantity: c.quantity + editSale.addQty } : c)
      : [...editSale.cart, { product, quantity: editSale.addQty, unitPrice: editSale.addPrice || product.unitPrice }];
    setEditSale({ ...editSale, cart: newCart, addProduct: '', addQty: 1, addPrice: 0 });
  }

  async function handleSaveEdit() {
    if (!editSale) return;
    if (!editSale.cart.length) { setEditSale({ ...editSale, error: 'Add at least one item' }); return; }
    const eHasDebt = editSale.pm === 'unpaid' || editSale.pm === 'part';
    if (eHasDebt && !editSale.customerName.trim()) { setEditSale({ ...editSale, error: 'Customer name required' }); return; }
    if (eHasDebt && !editSale.customerPhone.trim()) { setEditSale({ ...editSale, error: 'Customer phone required' }); return; }
    const eTotal   = editSale.cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
    const ePaid    = editSale.pm === 'unpaid' ? 0 : editSale.pm === 'part' ? editSale.amountPaid : eTotal;
    const eBalance = eTotal - ePaid;
    if (editSale.pm === 'part' && (editSale.amountPaid <= 0 || editSale.amountPaid >= eTotal)) {
      setEditSale({ ...editSale, error: 'Amount paid must be > 0 and < total' }); return;
    }
    setEditSale({ ...editSale, loading: true, error: '' });
    try {
      const saleId = editSale.sale._id || editSale.sale.id;
      const res = await fetch(`${BASE}/api/sales/${saleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          paymentMethod: editSale.pm,
          customerName: editSale.customerName.trim(), customerPhone: editSale.customerPhone.trim(),
          amountPaid: ePaid, balanceDue: eBalance, notes: editSale.notes.trim(),
          items: editSale.cart.map(c => ({
            productId: c.product._id, productName: c.product.name,
            quantity: c.quantity, unitPrice: c.unitPrice, subtotal: c.quantity * c.unitPrice,
          })),
          totalAmount: eTotal,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      setSuccess('Sale updated successfully!');
      setEditSale(null);
      fetchTodayData(selectedBranch);
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setEditSale(prev => prev ? { ...prev, loading: false, error: err.message || 'Failed to update' } : null);
    }
  }

  async function handleDeleteSale(id: string) {
    if (!window.confirm('Delete this sale? This cannot be undone.')) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`${BASE}/api/sales/${id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      setSuccess('Sale deleted.');
      fetchTodayData(selectedBranch);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete sale');
    }
    setLoading(false);
  }

  function canEditOrDelete(sale: any) {
    return isToday(sale.saleDate) && (isAdmin || sale.staffId === user?.id);
  }

  // ── Edit Expense ──────────────────────────────────────────────────────────

  function openEditExpense(e: Expense) {
    setEditExpense({
      expense: e, desc: e.description || '', amount: String(e.amount),
      category: e.category || 'other', notes: (e as any).notes || '',
      loading: false, error: '',
    });
  }

  async function handleSaveEditExpense() {
    if (!editExpense) return;
    if (!editExpense.desc.trim())                                   { setEditExpense({ ...editExpense, error: 'Description required' }); return; }
    if (!editExpense.amount || parseFloat(editExpense.amount) <= 0) { setEditExpense({ ...editExpense, error: 'Amount required' }); return; }
    setEditExpense({ ...editExpense, loading: true, error: '' });
    try {
      await updateOne(
        Collections.EXPENSES,
        { _id: { $oid: (editExpense.expense as any)._id } },
        { $set: {
          description: editExpense.desc.trim(), amount: parseFloat(editExpense.amount),
          category: editExpense.category, notes: editExpense.notes.trim(),
          updatedAt: new Date().toISOString(),
        }},
      );
      setSuccess('Expense updated!');
      setEditExpense(null);
      fetchTodayData(selectedBranch);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setEditExpense(prev => prev ? { ...prev, loading: false, error: err.message || 'Failed' } : null);
    }
  }

  async function handleDeleteExpense(e: Expense) {
    if (!window.confirm(`Delete expense "${e.description}"?`)) return;
    try {
      const res = await fetch(`${BASE}/api/expenses/${(e as any)._id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      setSuccess('Expense deleted.');
      fetchTodayData(selectedBranch);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete expense');
    }
  }

  // ── Edit Debtor ───────────────────────────────────────────────────────────

  function openEditDebtor(d: Debtor) {
    setEditDebtor({
      debtor: d, name: d.name || '', phone: d.phone || '',
      amount: String(d.amountOwed), notes: d.notes || '',
      loading: false, error: '',
    });
  }

  async function handleSaveEditDebtor() {
    if (!editDebtor) return;
    if (!editDebtor.name.trim())                                   { setEditDebtor({ ...editDebtor, error: 'Name required' }); return; }
    if (!editDebtor.phone.trim())                                  { setEditDebtor({ ...editDebtor, error: 'Phone required' }); return; }
    if (!editDebtor.amount || parseFloat(editDebtor.amount) <= 0) { setEditDebtor({ ...editDebtor, error: 'Amount owed required' }); return; }
    setEditDebtor({ ...editDebtor, loading: true, error: '' });
    try {
      await updateOne(
        Collections.DEBTORS,
        { _id: { $oid: (editDebtor.debtor as any)._id } },
        { $set: {
          name: editDebtor.name.trim(), phone: editDebtor.phone.trim(),
          amountOwed: parseFloat(editDebtor.amount), notes: editDebtor.notes.trim(),
          updatedAt: new Date().toISOString(),
        }},
      );
      setSuccess('Debtor updated!');
      setEditDebtor(null);
      fetchTodayData(selectedBranch);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setEditDebtor(prev => prev ? { ...prev, loading: false, error: err.message || 'Failed' } : null);
    }
  }

  async function handleDeleteDebtor(d: Debtor) {
    if (!window.confirm(`Delete debtor record for "${d.name}"?`)) return;
    try {
      const res = await fetch(`${BASE}/api/reports/debtors/${(d as any)._id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      setSuccess('Debtor deleted.');
      fetchTodayData(selectedBranch);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete debtor');
    }
  }

  // ── Derived totals ────────────────────────────────────────────────────────

  const totalTodaySales    = todaySales.reduce((s, x) => s + Number(x.totalAmount), 0);
  const totalTodayCash     = todaySales.filter(s => s.paymentMethod === 'cash').reduce((s, x) => s + Number(x.totalAmount), 0);
  const totalTodayPos      = todaySales.filter(s => s.paymentMethod === 'pos').reduce((s, x) => s + Number(x.totalAmount), 0);
  const totalTodayExpenses = todayExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalTodayDebt     = todayDebtors.reduce((s, d) => s + Number(d.amountOwed), 0);

  // Edit sale derived values
  const eTotal   = editSale?.cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0) ?? 0;
  const eHasDebt = editSale?.pm === 'unpaid' || editSale?.pm === 'part';

  const tabStyle = (t: Tab) =>
    `flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      tab === t ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Record Transactions</h1>
        <p className="text-slate-500 text-sm mt-1">
          Staff: <span className="font-medium text-slate-700">{user?.fullName}</span>
        </p>
      </div>

      {success && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-green-700">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />{success}
        </div>
      )}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-start justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError('')} className="flex-shrink-0 text-red-400 hover:text-red-600 mt-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={() => switchTab('sale')}    className={tabStyle('sale')}>   <ShoppingCart className="w-4 h-4" />Sale</button>
        <button onClick={() => switchTab('debtor')}  className={tabStyle('debtor')}> <UserPlus className="w-4 h-4" />Debtor</button>
        <button onClick={() => switchTab('expense')} className={tabStyle('expense')}><Receipt className="w-4 h-4" />Expense</button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ── Left panel ──────────────────────────────────────────────────── */}
        <div className="xl:col-span-2">

          {/* SALE FORM */}
          {tab === 'sale' && (
            <form onSubmit={handleSale} className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Branch</label>
                  {isAdmin ? (
                    <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                      {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                    </select>
                  ) : (
                    <div className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 bg-slate-50 text-sm">
                      {branches.find(b => b._id === selectedBranch)?.name || 'Your Branch'}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sale Date</label>
                  <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['cash', 'pos', 'part', 'unpaid'] as PaymentMethod[]).map(m => (
                      <button key={m} type="button" onClick={() => { setPaymentMethod(m); setAmountPaid(0); }}
                        className={pmButtonStyle(m, paymentMethod)}>
                        {PM_LABELS[m]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Customer Name {hasDebt && <span className="text-red-500">*</span>}
                  </label>
                  <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)}
                    placeholder={hasDebt ? 'Required for debt tracking' : 'Optional'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Customer Phone {hasDebt && <span className="text-red-500">*</span>}
                  </label>
                  <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                    placeholder={hasDebt ? 'Required for debt tracking' : 'Optional'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-5">
                <h4 className="font-medium text-slate-800 mb-3">Add Products</h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
                  <div className="sm:col-span-1">
                    <select value={selectedProduct} onChange={e => {
                      setSelectedProduct(e.target.value);
                      const p = products.find(p => p._id === e.target.value);
                      if (p) setPrice(p.unitPrice);
                    }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                      <option value="">Select product...</option>
                      {products.map(p => {
                        const stock = getStock(p._id);
                        return (
                          <option key={p._id} value={p._id} disabled={stock === 0}>
                            {p.name} — {stock === 0 ? 'OUT OF STOCK' : `${stock} in stock`}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <input type="number" min="0.01" step="0.01" value={qty}
                    onChange={e => setQty(Number(e.target.value))}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addToCart())}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="Qty" />
                  <input type="number" min="0" step="0.01" value={price}
                    onChange={e => setPrice(Number(e.target.value))}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addToCart())}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="Price override" />
                  <button type="button" onClick={addToCart} disabled={!selectedProduct}
                    className="flex items-center justify-center gap-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white rounded-lg text-sm font-medium transition-colors">
                    <Plus className="w-4 h-4" />Add
                  </button>
                </div>
              </div>

              {cart.length > 0 && (
                <div className="border-t border-slate-100 pt-5 space-y-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-slate-700">{cart.length} item{cart.length !== 1 ? 's' : ''} in cart</span>
                    <button type="button" onClick={() => setCart([])}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors">
                      Clear cart
                    </button>
                  </div>
                  <div className="space-y-2">
                    {cart.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                        <div className="flex-1 font-medium text-slate-800 text-sm">{item.product.name}</div>
                        <input type="number" min="0.01" step="0.01" value={item.quantity}
                          onChange={e => updateItem(idx, 'quantity', Number(e.target.value))}
                          className="w-20 px-2 py-1 border border-slate-200 rounded text-sm text-right text-slate-800" />
                        <span className="text-xs text-slate-400">{(item.product as any).unit}</span>
                        <input type="number" min="0" step="0.01" value={item.unitPrice}
                          onChange={e => updateItem(idx, 'unitPrice', Number(e.target.value))}
                          className="w-24 px-2 py-1 border border-slate-200 rounded text-sm text-right text-slate-800" />
                        <span className="font-semibold text-slate-600 text-sm w-24 text-right">
                          {fmt(item.quantity * item.unitPrice)}
                        </span>
                        <button type="button" onClick={() => setCart(cart.filter((_, i) => i !== idx))}
                          className="text-slate-300 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {paymentMethod === 'part' && (
                    <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-orange-800 mb-1">Amount Paid by Customer (₦) *</label>
                        <input type="number" min="0.01" step="0.01" value={amountPaid || ''}
                          onChange={e => setAmountPaid(Number(e.target.value))}
                          placeholder="Enter amount customer is paying now"
                          className="w-full px-3 py-2.5 border border-orange-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-400" />
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-orange-700">Total Bill:</span>
                        <span className="font-semibold text-slate-800">{fmt(total)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-orange-700">Amount Paid:</span>
                        <span className="font-semibold text-green-700">{fmt(amountPaid)}</span>
                      </div>
                      <div className="flex justify-between text-sm border-t border-orange-200 pt-2">
                        <span className="font-semibold text-orange-800">Balance Owed:</span>
                        <span className="font-bold text-red-600">{fmt(Math.max(0, total - amountPaid))}</span>
                      </div>
                      <p className="text-xs text-orange-600">This balance will be automatically added to Debtors.</p>
                    </div>
                  )}

                  {paymentMethod === 'unpaid' && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-semibold text-red-800">Full Amount Owed:</span>
                        <span className="font-bold text-red-600">{fmt(total)}</span>
                      </div>
                      <p className="text-xs text-red-600">The full amount will be automatically added to Debtors.</p>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none text-sm"
                      placeholder="Add notes..." />
                  </div>

                  <div className="space-y-1 pt-2 border-t border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">Total</span>
                      <span className="text-xl font-bold text-amber-600">{fmt(total)}</span>
                    </div>
                    {paymentMethod === 'part' && amountPaid > 0 && (
                      <>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500">Paid Now</span>
                          <span className="text-green-600 font-medium">{fmt(amountPaid)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500">Remaining Debt</span>
                          <span className="text-red-600 font-medium">{fmt(Math.max(0, balance))}</span>
                        </div>
                      </>
                    )}
                    {paymentMethod === 'unpaid' && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">Added to Debtors</span>
                        <span className="text-red-600 font-medium">{fmt(total)}</span>
                      </div>
                    )}
                  </div>

                  <button type="submit" disabled={loading}
                    className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2">
                    {loading && <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {hasDebt ? 'Submit Sale & Record Debt' : 'Submit Sale'}
                  </button>
                </div>
              )}
            </form>
          )}

          {/* DEBTOR FORM */}
          {tab === 'debtor' && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-amber-500" />
                Record Debtor (Customer with Unpaid Balance)
              </h3>
              <form onSubmit={handleDebtor} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Debtor Name *</label>
                    <input type="text" value={debtorName} onChange={e => setDebtorName(e.target.value)} required
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number *</label>
                    <input type="tel" value={debtorPhone} onChange={e => setDebtorPhone(e.target.value)} required
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Amount Owed (₦) *</label>
                    <input type="number" min="0.01" step="0.01" value={debtorAmount}
                      onChange={e => setDebtorAmount(e.target.value)} required
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Branch</label>
                    {isAdmin ? (
                      <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                        {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                      </select>
                    ) : (
                      <div className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 bg-slate-50 text-sm">
                        {branches.find(b => b._id === selectedBranch)?.name || 'Your Branch'}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                  <textarea value={debtorNotes} onChange={e => setDebtorNotes(e.target.value)} rows={2}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2">
                  {loading && <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  Record Debtor
                </button>
              </form>
            </div>
          )}

          {/* EXPENSE FORM */}
          {tab === 'expense' && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-amber-500" />
                Record Expense
              </h3>
              <form onSubmit={handleExpense} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
                  <input type="text" value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} required
                    placeholder="e.g., Transport, Airtime, Supplies"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₦) *</label>
                    <input type="number" min="0.01" step="0.01" value={expenseAmount}
                      onChange={e => setExpenseAmount(e.target.value)} required
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                    <select value={expenseCategory} onChange={e => setExpenseCategory(e.target.value as any)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                      {EXPENSE_CATS.map(c => (
                        <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                  <textarea value={expenseNotes} onChange={e => setExpenseNotes(e.target.value)} rows={2}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2">
                  {loading && <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  Record Expense
                </button>
              </form>
            </div>
          )}
        </div>

        {/* ── Right panel ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 h-fit overflow-hidden">
          <div className="p-4 bg-amber-50 border-b border-amber-100">
            <div className="flex items-start gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 font-medium leading-snug">
                Sales lock at midnight — submit your report before 12:00 AM
              </p>
            </div>
            <button onClick={handleSubmitDailyReport} disabled={reportLoading}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white text-sm font-semibold rounded-lg transition-colors">
              {reportLoading
                ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Send className="w-4 h-4" />}
              {reportLoading ? 'Submitting...' : 'Submit Daily Report'}
            </button>
            {reportMsg && (
              <p className={`text-xs font-medium mt-1 text-center ${reportMsg.ok ? 'text-green-700' : 'text-red-600'}`}>
                {reportMsg.text}
              </p>
            )}
          </div>

          {todaySales.length > 0 && (
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-slate-400">Total</p>
                <p className="text-xs font-bold text-amber-600">{fmt(totalTodaySales)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Cash</p>
                <p className="text-xs font-bold text-green-600">{fmt(totalTodayCash)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">POS</p>
                <p className="text-xs font-bold text-blue-600">{fmt(totalTodayPos)}</p>
              </div>
            </div>
          )}

          <div className="p-4">
            <div className="flex gap-1 mb-4">
              {([
                { key: 'sales',    label: `Sales (${todaySales.length})` },
                { key: 'expenses', label: `Expenses (${todayExpenses.length})` },
                { key: 'debtors',  label: `Active Debtors (${todayDebtors.length})` },
              ] as const).map(t => (
                <button key={t.key} onClick={() => setRightTab(t.key)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    rightTab === t.key ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* SALES LIST */}
            {rightTab === 'sales' && (
              todaySales.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">No sales today yet</p>
              ) : (
                <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1">
                  {todaySales.map(s => {
                    const locked   = !isToday(s.saleDate);
                    const editable = canEditOrDelete(s);
                    const items    = safeItems(s.items);
                    return (
                      <div key={s._id || s.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-slate-800 text-sm">{fmt(s.totalAmount)}</span>
                          <div className="flex items-center gap-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${PM_COLORS[s.paymentMethod] ?? 'bg-slate-100 text-slate-600'}`}>
                              {PM_LABELS[s.paymentMethod] ?? s.paymentMethod}
                            </span>
                            {locked && (
                              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 font-medium">
                                <Lock className="w-3 h-3" />Locked
                              </span>
                            )}
                          </div>
                        </div>
                        {(s.paymentMethod === 'part' || s.paymentMethod === 'unpaid') && s.balanceDue > 0 && (
                          <p className="text-xs text-red-500 font-medium mb-1">Owes: {fmt(s.balanceDue)}</p>
                        )}
                        {s.customerName && (
                          <p className="text-xs text-slate-600 mb-0.5">
                            {s.customerName}{s.customerPhone ? ` · ${s.customerPhone}` : ''}
                          </p>
                        )}
                        {items.length > 0 && (
                          <p className="text-xs text-slate-400 mb-1 truncate">
                            {items.map((it: any) =>
                              `${it.productName || it.product_name || it.product_id} x${it.quantity}`
                            ).join(', ')}
                          </p>
                        )}
                        <p className="text-xs text-slate-400 mb-2">By: {s.staffName}</p>
                        {editable && (
                          <div className="flex gap-2">
                            <button onClick={() => openEditSale(s)}
                              className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-md font-medium transition-colors">
                              <Pencil className="w-3 h-3" />Edit
                            </button>
                            <button onClick={() => handleDeleteSale(s._id || s.id)}
                              className="flex items-center gap-1 px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-md font-medium transition-colors">
                              <Trash2 className="w-3 h-3" />Delete
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="pt-2 border-t border-slate-100 flex justify-between text-sm">
                    <span className="text-slate-500 font-medium">Total Sales</span>
                    <span className="font-bold text-amber-600">{fmt(totalTodaySales)}</span>
                  </div>
                </div>
              )
            )}

            {/* EXPENSES LIST */}
            {rightTab === 'expenses' && (
              todayExpenses.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">No expenses recorded today</p>
              ) : (
                <div className="space-y-2 max-h-[550px] overflow-y-auto pr-1">
                  {todayExpenses.map((e, i) => (
                    <div key={(e as any)._id || i} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{e.description}</p>
                          <p className="text-xs text-slate-400 mt-0.5 capitalize">{e.category}</p>
                          {e.recordedByName && <p className="text-xs text-slate-400">By: {e.recordedByName}</p>}
                        </div>
                        <span className="text-sm font-bold text-red-600 flex-shrink-0">{fmt(Number(e.amount))}</span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openEditExpense(e)}
                          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-md font-medium transition-colors">
                          <Pencil className="w-3 h-3" />Edit
                        </button>
                        <button onClick={() => handleDeleteExpense(e)}
                          className="flex items-center gap-1 px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-md font-medium transition-colors">
                          <Trash2 className="w-3 h-3" />Delete
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-slate-100 flex justify-between text-sm">
                    <span className="text-slate-500 font-medium">Total Expenses</span>
                    <span className="font-bold text-red-600">{fmt(totalTodayExpenses)}</span>
                  </div>
                </div>
              )
            )}

            {/* DEBTORS LIST */}
            {rightTab === 'debtors' && (
              todayDebtors.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">No active debtors for this branch</p>
              ) : (
                <div className="space-y-2 max-h-[550px] overflow-y-auto pr-1">
                  {todayDebtors.map((d, i) => (
                    <div key={(d as any)._id || i} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{d.name}</p>
                          <p className="text-xs text-blue-600">{d.phone}</p>
                          {d.createdByName && <p className="text-xs text-slate-400">By: {d.createdByName}</p>}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-red-600">{fmt(Number(d.amountOwed))}</p>
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                            {d.paymentMethod === 'part' ? 'Part' : 'Unpaid'}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openEditDebtor(d)}
                          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-md font-medium transition-colors">
                          <Pencil className="w-3 h-3" />Edit
                        </button>
                        <button onClick={() => handleDeleteDebtor(d)}
                          className="flex items-center gap-1 px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-md font-medium transition-colors">
                          <Trash2 className="w-3 h-3" />Delete
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-slate-100 flex justify-between text-sm">
                    <span className="text-slate-500 font-medium">Total Owed</span>
                    <span className="font-bold text-red-600">{fmt(totalTodayDebt)}</span>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* ── Edit Sale Modal ──────────────────────────────────────────────────── */}
      {editSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Edit Sale</h2>
                <p className="text-xs text-slate-500 mt-0.5">Changes will sync linked debtor balances automatically.</p>
              </div>
              <button onClick={() => setEditSale(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              {editSale.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{editSale.error}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Payment Method</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['cash', 'pos', 'part', 'unpaid'] as PaymentMethod[]).map(m => (
                    <button key={m} type="button"
                      onClick={() => setEditSale({ ...editSale, pm: m, amountPaid: 0 })}
                      className={pmButtonStyle(m, editSale.pm)}>
                      {PM_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Customer Name {eHasDebt && <span className="text-red-500">*</span>}
                  </label>
                  <input type="text" value={editSale.customerName}
                    onChange={e => setEditSale({ ...editSale, customerName: e.target.value })}
                    placeholder={eHasDebt ? 'Required for debt tracking' : 'Optional'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Customer Phone {eHasDebt && <span className="text-red-500">*</span>}
                  </label>
                  <input type="tel" value={editSale.customerPhone}
                    onChange={e => setEditSale({ ...editSale, customerPhone: e.target.value })}
                    placeholder={eHasDebt ? 'Required for debt tracking' : 'Optional'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
              </div>
              <div className="border-t border-slate-100 pt-4">
                <h4 className="font-medium text-slate-800 mb-3 text-sm">Products</h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
                  <div className="sm:col-span-1">
                    <select value={editSale.addProduct}
                      onChange={e => {
                        const p = products.find(p => p._id === e.target.value);
                        setEditSale({ ...editSale, addProduct: e.target.value, addPrice: p?.unitPrice ?? 0 });
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                      <option value="">Select...</option>
                      {products.map(p => {
                        const stock = getStock(p._id);
                        return (
                          <option key={p._id} value={p._id} disabled={stock === 0}>
                            {p.name} — {stock === 0 ? 'OUT OF STOCK' : `${stock} in stock`}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <input type="number" min="0.01" step="0.01" value={editSale.addQty}
                    onChange={e => setEditSale({ ...editSale, addQty: Number(e.target.value) })}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="Qty" />
                  <input type="number" min="0" step="0.01" value={editSale.addPrice}
                    onChange={e => setEditSale({ ...editSale, addPrice: Number(e.target.value) })}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="Price" />
                  <button type="button" onClick={addToEditCart} disabled={!editSale.addProduct}
                    className="flex items-center justify-center gap-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white rounded-lg text-sm font-medium transition-colors">
                    <Plus className="w-4 h-4" />Add
                  </button>
                </div>
                <div className="space-y-2">
                  {editSale.cart.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                      <div className="flex-1 font-medium text-slate-800 text-sm">{item.product.name}</div>
                      <input type="number" min="0.01" step="0.01" value={item.quantity}
                        onChange={e => setEditSale({
                          ...editSale,
                          cart: editSale.cart.map((c, i) => i === idx ? { ...c, quantity: Number(e.target.value) } : c),
                        })}
                        className="w-20 px-2 py-1 border border-slate-200 rounded text-sm text-right text-slate-800" />
                      <input type="number" min="0" step="0.01" value={item.unitPrice}
                        onChange={e => setEditSale({
                          ...editSale,
                          cart: editSale.cart.map((c, i) => i === idx ? { ...c, unitPrice: Number(e.target.value) } : c),
                        })}
                        className="w-24 px-2 py-1 border border-slate-200 rounded text-sm text-right text-slate-800" />
                      <span className="font-semibold text-slate-600 text-sm w-24 text-right">
                        {fmt(item.quantity * item.unitPrice)}
                      </span>
                      <button type="button"
                        onClick={() => setEditSale({ ...editSale, cart: editSale.cart.filter((_, i) => i !== idx) })}
                        className="text-slate-300 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {editSale.cart.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-3">No items. Add a product above.</p>
                  )}
                </div>
              </div>
              {editSale.pm === 'part' && (
                <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg space-y-2">
                  <label className="block text-sm font-medium text-orange-800">Amount Paid by Customer (₦) *</label>
                  <input type="number" min="0.01" step="0.01" value={editSale.amountPaid || ''}
                    onChange={e => setEditSale({ ...editSale, amountPaid: Number(e.target.value) })}
                    className="w-full px-3 py-2.5 border border-orange-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-orange-700">Balance Owed:</span>
                    <span className="font-bold text-red-600">{fmt(Math.max(0, eTotal - editSale.amountPaid))}</span>
                  </div>
                </div>
              )}
              {editSale.pm === 'unpaid' && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex justify-between text-sm">
                  <span className="font-semibold text-red-800">Full Amount Owed:</span>
                  <span className="font-bold text-red-600">{fmt(eTotal)}</span>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                <textarea value={editSale.notes} onChange={e => setEditSale({ ...editSale, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none text-sm" />
              </div>
              <div className="p-3 bg-slate-50 rounded-lg flex items-center justify-between">
                <span className="font-semibold text-slate-700">New Total</span>
                <span className="text-xl font-bold text-amber-600">{fmt(eTotal)}</span>
              </div>
            </div>
            <div className="flex gap-3 p-6 border-t border-slate-100">
              <button onClick={() => setEditSale(null)} disabled={editSale.loading}
                className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium text-sm hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveEdit} disabled={editSale.loading || editSale.cart.length === 0}
                className="flex-1 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                {editSale.loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Expense Modal ───────────────────────────────────────────────── */}
      {editExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Edit Expense</h2>
              <button onClick={() => setEditExpense(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {editExpense.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{editExpense.error}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description *</label>
                <input type="text" value={editExpense.desc}
                  onChange={e => setEditExpense({ ...editExpense, desc: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₦) *</label>
                  <input type="number" min="0.01" step="0.01" value={editExpense.amount}
                    onChange={e => setEditExpense({ ...editExpense, amount: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                  <select value={editExpense.category}
                    onChange={e => setEditExpense({ ...editExpense, category: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                    {EXPENSE_CATS.map(c => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                <textarea value={editExpense.notes} onChange={e => setEditExpense({ ...editExpense, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none text-sm" />
              </div>
            </div>
            <div className="flex gap-3 p-6 border-t border-slate-100">
              <button onClick={() => setEditExpense(null)} disabled={editExpense.loading}
                className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium text-sm hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveEditExpense} disabled={editExpense.loading}
                className="flex-1 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                {editExpense.loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Debtor Modal ────────────────────────────────────────────────── */}
      {editDebtor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Edit Debtor</h2>
              <button onClick={() => setEditDebtor(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {editDebtor.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{editDebtor.error}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
                  <input type="text" value={editDebtor.name}
                    onChange={e => setEditDebtor({ ...editDebtor, name: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Phone *</label>
                  <input type="tel" value={editDebtor.phone}
                    onChange={e => setEditDebtor({ ...editDebtor, phone: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount Owed (₦) *</label>
                <input type="number" min="0.01" step="0.01" value={editDebtor.amount}
                  onChange={e => setEditDebtor({ ...editDebtor, amount: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                <textarea value={editDebtor.notes} onChange={e => setEditDebtor({ ...editDebtor, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none text-sm" />
              </div>
            </div>
            <div className="flex gap-3 p-6 border-t border-slate-100">
              <button onClick={() => setEditDebtor(null)} disabled={editDebtor.loading}
                className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium text-sm hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveEditDebtor} disabled={editDebtor.loading}
                className="flex-1 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                {editDebtor.loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}