import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { find, insertOne, Collections } from '../lib/api';
import type { Product, Branch, BranchStock } from '../lib/types';
import {
  Plus, Trash2, ShoppingCart, CheckCircle, UserPlus, Receipt,
  Pencil, Lock, Send, AlertTriangle, X,
} from 'lucide-react';

interface CartItem { product: Product; quantity: number; unitPrice: number }
type Tab = 'sale' | 'debtor' | 'expense';
type PaymentMethod = 'cash' | 'pos' | 'part' | 'unpaid';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = (window as any).__authToken as string | undefined;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body?.message || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json?.data ?? json;
}

const pmColors: Record<string, string> = {
  cash: 'bg-green-100 text-green-700',
  pos:  'bg-blue-100 text-blue-700',
  part: 'bg-orange-100 text-orange-700',
  unpaid: 'bg-red-100 text-red-700',
};
const pmLabels: Record<string, string> = {
  cash: 'Cash', pos: 'POS', part: 'Part Payment', unpaid: 'Unpaid',
};

function isToday(dateStr: string) {
  const d = new Date(dateStr);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export default function SalesPage() {
  const { user } = useAuth();
  const navigate  = useNavigate();

  const [tab, setTab]             = useState<Tab>('sale');
  const [products, setProducts]   = useState<Product[]>([]);
  const [branches, setBranches]   = useState<Branch[]>([]);
  const [branchStock, setBranchStock] = useState<BranchStock[]>([]);
  const [todaySales, setTodaySales]   = useState<any[]>([]);

  // ── Add-sale form state ─────────────────────────────────────────────────────
  const [selectedBranch, setSelectedBranch] = useState(user?.branchId || '');
  const [paymentMethod, setPaymentMethod]   = useState<PaymentMethod>('cash');
  const [customerName, setCustomerName]     = useState('');
  const [customerPhone, setCustomerPhone]   = useState('');
  const [amountPaid, setAmountPaid]         = useState<number>(0);
  const [notes, setNotes]                   = useState('');
  const [saleDate, setSaleDate]             = useState(new Date().toISOString().split('T')[0]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [qty, setQty]     = useState(1);
  const [price, setPrice] = useState(0);
  const [cart, setCart]   = useState<CartItem[]>([]);

  // ── Debtor form ─────────────────────────────────────────────────────────────
  const [debtorName, setDebtorName]     = useState('');
  const [debtorPhone, setDebtorPhone]   = useState('');
  const [debtorAmount, setDebtorAmount] = useState('');
  const [debtorNotes, setDebtorNotes]   = useState('');

  // ── Expense form ────────────────────────────────────────────────────────────
  const [expenseDesc, setExpenseDesc]         = useState('');
  const [expenseAmount, setExpenseAmount]     = useState('');
  const [expenseCategory, setExpenseCategory] = useState('other');
  const [expenseNotes, setExpenseNotes]       = useState('');

  // ── Edit modal state ────────────────────────────────────────────────────────
  const [editSale, setEditSale]               = useState<any | null>(null);
  const [editCart, setEditCart]               = useState<CartItem[]>([]);
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>('cash');
  const [editCustomerName, setEditCustomerName]   = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [editAmountPaid, setEditAmountPaid]       = useState<number>(0);
  const [editNotes, setEditNotes]                 = useState('');
  const [editProduct, setEditProduct]             = useState('');
  const [editQty, setEditQty]                     = useState(1);
  const [editPrice, setEditPrice]                 = useState(0);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [success, setSuccess]   = useState('');
  const [error, setError]       = useState('');

  // Store auth token on window so apiFetch can access it
  useEffect(() => {
    const stored = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
    if (stored) (window as any).__authToken = stored;
  }, []);

  useEffect(() => { fetchData(); }, [user]);
  useEffect(() => { if (selectedBranch) fetchStock(selectedBranch); }, [selectedBranch]);

  async function fetchData() {
    const [prods, brs] = await Promise.all([
      find(Collections.PRODUCTS, { isActive: true }, { sort: { name: 1 } }),
      find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }),
    ]);
    setProducts(prods as Product[]);
    setBranches(brs as Branch[]);
    const branch = user?.branchId || (brs[0]?._id ?? '');
    if (branch) { setSelectedBranch(branch); fetchTodaySales(branch); }
  }

  async function fetchStock(branchId: string) {
    const data = await find(Collections.BRANCH_STOCK, { branchId });
    setBranchStock(data as BranchStock[]);
  }

  const fetchTodaySales = useCallback(async (branchId: string) => {
    const today = new Date().toISOString().split('T')[0];
    const data  = await find(
      Collections.SALES,
      { branchId, saleDate: { $gte: `${today}T00:00:00.000Z`, $lte: `${today}T23:59:59.999Z` } },
      { sort: { createdAt: -1 }, limit: 100 },
    );
    setTodaySales(data as any[]);
  }, []);

  function getStock(productId: string) {
    return branchStock.find(s => s.productId === productId)?.quantity ?? 0;
  }

  // ── Add-sale helpers ────────────────────────────────────────────────────────
  function addToCart() {
    const product = products.find(p => p._id === selectedProduct);
    if (!product) return;
    const idx = cart.findIndex(c => c.product._id === selectedProduct);
    if (idx >= 0) {
      setCart(cart.map((c, i) => i === idx ? { ...c, quantity: c.quantity + qty } : c));
    } else {
      setCart([...cart, { product, quantity: qty, unitPrice: price || product.unitPrice }]);
    }
    setSelectedProduct(''); setQty(1); setPrice(0);
  }

  function updateItem(idx: number, field: 'quantity' | 'unitPrice', value: number) {
    setCart(cart.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  }

  const total   = cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
  const hasDebt = paymentMethod === 'unpaid' || paymentMethod === 'part';
  const paid    = paymentMethod === 'unpaid' ? 0 : paymentMethod === 'part' ? amountPaid : total;
  const balance = total - paid;

  async function handleSale(e: React.FormEvent) {
    e.preventDefault();
    if (!cart.length) { setError('Add at least one item'); return; }
    if (!selectedBranch) { setError('Select a branch'); return; }
    if (hasDebt && !customerName.trim()) { setError('Customer name required for part/unpaid'); return; }
    if (hasDebt && !customerPhone.trim()) { setError('Customer phone required for part/unpaid'); return; }
    if (paymentMethod === 'part' && (amountPaid <= 0 || amountPaid >= total)) {
      setError('Amount paid must be > 0 and < total'); return;
    }
    setLoading(true); setError('');
    try {
      await insertOne(Collections.SALES, {
        branchId: selectedBranch,
        staffId: user!.id,
        staffName: user!.fullName,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        paymentMethod,
        totalAmount: total,
        amountPaid: paid,
        balanceDue: balance,
        notes: notes.trim(),
        items: cart.map(c => ({
          productId: c.product._id,
          productName: c.product.name,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
          subtotal: c.quantity * c.unitPrice,
        })),
        saleDate: new Date(`${saleDate}T12:00:00.000Z`).toISOString(),
      });

      if (hasDebt && balance > 0) {
        const itemsSummary = cart.map(c => `${c.product.name} x${c.quantity}`).join(', ');
        await insertOne(Collections.DEBTORS, {
          name: customerName.trim(),
          phone: customerPhone.trim(),
          amountOwed: balance,
          branchId: selectedBranch,
          createdBy: user!.id,
          createdByName: user!.fullName,
          isCleared: false,
          notes: `Sale: ${itemsSummary}${notes.trim() ? ` | ${notes.trim()}` : ''}`,
        });
      }

      const debtMsg = hasDebt && balance > 0 ? ` Debtor of ${fmt(balance)} recorded.` : '';
      setSuccess(`Sale recorded!${debtMsg}`);
      setCart([]); setCustomerName(''); setCustomerPhone('');
      setNotes(''); setAmountPaid(0); setPaymentMethod('cash');
      fetchTodaySales(selectedBranch);
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) { setError(err.message || 'Failed to record sale'); }
    setLoading(false);
  }

  async function handleDebtor(e: React.FormEvent) {
    e.preventDefault();
    if (!debtorName.trim()) { setError('Debtor name is required'); return; }
    if (!debtorPhone.trim()) { setError('Phone number is required'); return; }
    if (!debtorAmount || parseFloat(debtorAmount) <= 0) { setError('Amount owed is required'); return; }
    setLoading(true); setError('');
    try {
      await insertOne(Collections.DEBTORS, {
        name: debtorName.trim(),
        phone: debtorPhone.trim(),
        amountOwed: parseFloat(debtorAmount),
        branchId: selectedBranch,
        createdBy: user!.id,
        createdByName: user!.fullName,
        isCleared: false,
        notes: debtorNotes.trim(),
      });
      setSuccess('Debtor recorded!');
      setDebtorName(''); setDebtorPhone(''); setDebtorAmount(''); setDebtorNotes('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) { setError(err.message || 'Failed to record debtor'); }
    setLoading(false);
  }

  async function handleExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!expenseDesc.trim()) { setError('Description is required'); return; }
    if (!expenseAmount || parseFloat(expenseAmount) <= 0) { setError('Amount is required'); return; }
    setLoading(true); setError('');
    try {
      await insertOne(Collections.EXPENSES, {
        branchId: selectedBranch,
        description: expenseDesc.trim(),
        amount: parseFloat(expenseAmount),
        category: expenseCategory,
        recordedBy: user!.id,
        recordedByName: user!.fullName,
        expenseDate: new Date().toISOString(),
        notes: expenseNotes.trim(),
      });
      setSuccess('Expense recorded!');
      setExpenseDesc(''); setExpenseAmount(''); setExpenseNotes('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) { setError(err.message || 'Failed to record expense'); }
    setLoading(false);
  }

  // ── Edit modal helpers ──────────────────────────────────────────────────────
  function openEditSale(sale: any) {
    setEditSale(sale);
    setEditPaymentMethod(sale.paymentMethod as PaymentMethod);
    setEditCustomerName(sale.customerName || '');
    setEditCustomerPhone(sale.customerPhone || '');
    setEditAmountPaid(sale.amountPaid || 0);
    setEditNotes(sale.notes || '');
    setEditProduct(''); setEditQty(1); setEditPrice(0);

    // Rebuild cart from saved items
    const rebuilt: CartItem[] = (sale.items || []).map((item: any) => {
      const product = products.find(p => p._id === (item.product_id || item.productId));
      if (!product) return null;
      return { product, quantity: Number(item.quantity), unitPrice: Number(item.unit_price ?? item.unitPrice) };
    }).filter(Boolean) as CartItem[];
    setEditCart(rebuilt);
  }

  function addToEditCart() {
    const product = products.find(p => p._id === editProduct);
    if (!product) return;
    const idx = editCart.findIndex(c => c.product._id === editProduct);
    if (idx >= 0) {
      setEditCart(editCart.map((c, i) => i === idx ? { ...c, quantity: c.quantity + editQty } : c));
    } else {
      setEditCart([...editCart, { product, quantity: editQty, unitPrice: editPrice || product.unitPrice }]);
    }
    setEditProduct(''); setEditQty(1); setEditPrice(0);
  }

  function updateEditItem(idx: number, field: 'quantity' | 'unitPrice', value: number) {
    setEditCart(editCart.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  }

  const editTotal   = editCart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
  const editHasDebt = editPaymentMethod === 'unpaid' || editPaymentMethod === 'part';
  const editPaid    = editPaymentMethod === 'unpaid' ? 0 : editPaymentMethod === 'part' ? editAmountPaid : editTotal;
  const editBalance = editTotal - editPaid;

  async function handleSaveEdit() {
    if (!editCart.length) { setError('Cart cannot be empty'); return; }
    if (editHasDebt && !editCustomerName.trim()) { setError('Customer name required for part/unpaid'); return; }
    if (editHasDebt && !editCustomerPhone.trim()) { setError('Customer phone required for part/unpaid'); return; }
    if (editPaymentMethod === 'part' && (editAmountPaid <= 0 || editAmountPaid >= editTotal)) {
      setError('Amount paid must be > 0 and < total'); return;
    }
    setSaving(true); setError('');
    try {
      const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken') || (window as any).__authToken;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${BASE_URL}/api/sales/${editSale.id ?? editSale._id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          paymentMethod: editPaymentMethod,
          customerName: editCustomerName.trim(),
          customerPhone: editCustomerPhone.trim(),
          amountPaid: editPaid,
          notes: editNotes.trim(),
          items: editCart.map(c => ({
            productId: c.product._id,
            productName: c.product.name,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
            subtotal: c.quantity * c.unitPrice,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to update sale');

      setSuccess('Sale updated successfully!');
      setEditSale(null);
      fetchTodaySales(selectedBranch);
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) { setError(err.message || 'Failed to update sale'); }
    setSaving(false);
  }

  async function handleDeleteSale(saleId: string) {
    if (!confirm('Delete this sale? This cannot be undone.')) return;
    setDeleting(saleId); setError('');
    try {
      const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken') || (window as any).__authToken;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${BASE_URL}/api/sales/${saleId}`, { method: 'DELETE', headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Failed to delete sale');

      setSuccess('Sale deleted.');
      fetchTodaySales(selectedBranch);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) { setError(err.message || 'Failed to delete sale'); }
    setDeleting(null);
  }

  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  const tabStyle = (t: Tab) =>
    `flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      tab === t ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`;

  const pmBtn = (m: PaymentMethod, current: PaymentMethod, setter: (v: PaymentMethod) => void) => {
    const active = current === m;
    const colors: Record<PaymentMethod, string> = {
      cash:   active ? 'bg-green-500 text-white border-green-500'   : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
      pos:    active ? 'bg-blue-500 text-white border-blue-500'     : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
      part:   active ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
      unpaid: active ? 'bg-red-500 text-white border-red-500'       : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
    };
    return (
      <button key={m} type="button" onClick={() => setter(m)}
        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${colors[m]}`}>
        {pmLabels[m]}
      </button>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Record Transactions</h1>
          <p className="text-slate-500 text-sm mt-1">Staff: <span className="font-medium text-slate-700">{user?.fullName}</span></p>
        </div>
        <button onClick={() => navigate('/daily-report')}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm">
          <Send className="w-4 h-4" /> Submit Daily Report
        </button>
      </div>

      {/* Midnight warning banner */}
      <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500" />
        <span>Sales and corrections are open <strong>today only</strong>. All records lock at <strong>12:00 AM</strong>. Submit your daily report before midnight.</span>
      </div>

      {success && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-green-700">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />{success}
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <span>{error}</span>
          <button onClick={() => setError('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <button onClick={() => setTab('sale')} className={tabStyle('sale')}><ShoppingCart className="w-4 h-4" />Sale</button>
        <button onClick={() => setTab('debtor')} className={tabStyle('debtor')}><UserPlus className="w-4 h-4" />Debtor</button>
        <button onClick={() => setTab('expense')} className={tabStyle('expense')}><Receipt className="w-4 h-4" />Expense</button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* ── Left: forms ── */}
        <div className="xl:col-span-2">
          {/* ── SALE FORM ── */}
          {tab === 'sale' && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Branch</label>
                  <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
                    disabled={user?.role !== 'admin'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-slate-50">
                    {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sale Date</label>
                  <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['cash', 'pos', 'part', 'unpaid'] as PaymentMethod[]).map(m =>
                      pmBtn(m, paymentMethod, (v) => { setPaymentMethod(v); setAmountPaid(0); })
                    )}
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
                      {products.map(p => <option key={p._id} value={p._id}>{p.name} ({getStock(p._id)})</option>)}
                    </select>
                  </div>
                  <input type="number" min="0.01" step="0.01" value={qty} onChange={e => setQty(Number(e.target.value))}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="Qty" />
                  <input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(Number(e.target.value))}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="Price" />
                  <button type="button" onClick={addToCart} disabled={!selectedProduct}
                    className="flex items-center justify-center gap-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white rounded-lg text-sm font-medium transition-colors">
                    <Plus className="w-4 h-4" />Add
                  </button>
                </div>
              </div>

              {cart.length > 0 && (
                <div className="border-t border-slate-100 pt-5 space-y-3">
                  <div className="space-y-2">
                    {cart.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                        <div className="flex-1 font-medium text-slate-800 text-sm">{item.product.name}</div>
                        <input type="number" min="0.01" step="0.01" value={item.quantity}
                          onChange={e => updateItem(idx, 'quantity', Number(e.target.value))}
                          className="w-20 px-2 py-1 border border-slate-200 rounded text-sm text-right text-slate-800" />
                        <span className="text-xs text-slate-400">{item.product.unit}</span>
                        <input type="number" min="0" step="0.01" value={item.unitPrice}
                          onChange={e => updateItem(idx, 'unitPrice', Number(e.target.value))}
                          className="w-24 px-2 py-1 border border-slate-200 rounded text-sm text-right text-slate-800" />
                        <span className="font-semibold text-slate-600 text-sm w-24 text-right">{fmt(item.quantity * item.unitPrice)}</span>
                        <button onClick={() => setCart(cart.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {paymentMethod === 'part' && (
                    <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-orange-800 mb-1">Amount Paid Now (₦) *</label>
                        <input type="number" min="0.01" step="0.01" value={amountPaid || ''}
                          onChange={e => setAmountPaid(Number(e.target.value))}
                          placeholder="Enter amount customer is paying now"
                          className="w-full px-3 py-2.5 border border-orange-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-400" />
                      </div>
                      <div className="flex justify-between text-sm border-t border-orange-200 pt-2">
                        <span className="font-semibold text-orange-800">Balance Owed:</span>
                        <span className="font-bold text-red-600">{fmt(Math.max(0, total - amountPaid))}</span>
                      </div>
                      <p className="text-xs text-orange-600">This balance will be auto-added to Debtors.</p>
                    </div>
                  )}

                  {paymentMethod === 'unpaid' && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-semibold text-red-800">Full Amount Owed:</span>
                        <span className="font-bold text-red-600">{fmt(total)}</span>
                      </div>
                      <p className="text-xs text-red-600">The full amount will be auto-added to Debtors.</p>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none text-sm" placeholder="Add notes..." />
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
                  </div>

                  <button onClick={handleSale} disabled={loading}
                    className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2">
                    {loading && <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {hasDebt ? 'Submit Sale & Record Debt' : 'Submit Sale'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── DEBTOR FORM ── */}
          {tab === 'debtor' && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-amber-500" />Record Debtor
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
                    <input type="number" min="0.01" step="0.01" value={debtorAmount} onChange={e => setDebtorAmount(e.target.value)} required
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Branch</label>
                    <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} disabled={user?.role !== 'admin'}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-slate-50">
                      {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                    </select>
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

          {/* ── EXPENSE FORM ── */}
          {tab === 'expense' && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-amber-500" />Record Expense
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
                    <input type="number" min="0.01" step="0.01" value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)} required
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                    <select value={expenseCategory} onChange={e => setExpenseCategory(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                      <option value="transport">Transport</option>
                      <option value="utilities">Utilities</option>
                      <option value="supplies">Supplies</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="other">Other</option>
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

        {/* ── Right: Today's Sales ── */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 h-fit">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Today's Sales</h3>
            <span className="text-xs text-slate-400">{todaySales.length} sale{todaySales.length !== 1 ? 's' : ''}</span>
          </div>

          {todaySales.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6">No sales recorded today</p>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {todaySales.map(s => {
                const locked   = !isToday(s.saleDate);
                const canEdit  = !locked && (user?.role === 'admin' || s.staffId === user?.id);

                return (
                  <div key={s.id ?? s._id} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-slate-800 text-sm">{fmt(s.totalAmount)}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${pmColors[s.paymentMethod] ?? 'bg-slate-100 text-slate-600'}`}>
                          {pmLabels[s.paymentMethod] ?? s.paymentMethod}
                        </span>
                        {locked && (
                          <span className="flex items-center gap-0.5 text-xs text-slate-400">
                            <Lock className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                    </div>

                    {(s.paymentMethod === 'part' || s.paymentMethod === 'unpaid') && s.balanceDue > 0 && (
                      <p className="text-xs text-red-500 font-medium">Owes: {fmt(s.balanceDue)}</p>
                    )}
                    {s.customerName && <p className="text-xs text-slate-600">{s.customerName} {s.customerPhone ? `· ${s.customerPhone}` : ''}</p>}
                    <p className="text-xs text-slate-400 mt-0.5">By: {s.staffName}</p>

                    {s.items && s.items.length > 0 && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {s.items.map((i: any) => `${i.quantity}x`).join(', ')} item{s.items.length !== 1 ? 's' : ''}
                      </p>
                    )}

                    {canEdit && (
                      <div className="flex gap-2 mt-2 pt-2 border-t border-slate-200">
                        <button onClick={() => openEditSale(s)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors">
                          <Pencil className="w-3 h-3" />Edit
                        </button>
                        <button onClick={() => handleDeleteSale(s.id ?? s._id)} disabled={deleting === (s.id ?? s._id)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors disabled:opacity-50">
                          <Trash2 className="w-3 h-3" />
                          {deleting === (s.id ?? s._id) ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    )}
                    {locked && (
                      <p className="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200 flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Locked — past day
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex justify-between text-sm font-semibold text-slate-800">
              <span>Today's Total</span>
              <span className="text-amber-600">{fmt(todaySales.reduce((s, x) => s + Number(x.totalAmount), 0))}</span>
            </div>
            <button onClick={() => navigate('/daily-report')}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-medium transition-colors">
              <Send className="w-4 h-4" />Submit Daily Report
            </button>
          </div>
        </div>
      </div>

      {/* ── EDIT MODAL ── */}
      {editSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Edit Sale</h2>
              <button onClick={() => setEditSale(null)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
              )}

              {/* Payment method */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Payment Method</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['cash', 'pos', 'part', 'unpaid'] as PaymentMethod[]).map(m =>
                    pmBtn(m, editPaymentMethod, (v) => { setEditPaymentMethod(v); setEditAmountPaid(0); })
                  )}
                </div>
              </div>

              {/* Customer */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Customer Name {editHasDebt && <span className="text-red-500">*</span>}
                  </label>
                  <input type="text" value={editCustomerName} onChange={e => setEditCustomerName(e.target.value)}
                    placeholder={editHasDebt ? 'Required' : 'Optional'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Customer Phone {editHasDebt && <span className="text-red-500">*</span>}
                  </label>
                  <input type="tel" value={editCustomerPhone} onChange={e => setEditCustomerPhone(e.target.value)}
                    placeholder={editHasDebt ? 'Required' : 'Optional'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
              </div>

              {/* Part payment amount */}
              {editPaymentMethod === 'part' && (
                <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                  <label className="block text-sm font-medium text-orange-800 mb-1">Amount Paid Now (₦) *</label>
                  <input type="number" min="0.01" step="0.01" value={editAmountPaid || ''}
                    onChange={e => setEditAmountPaid(Number(e.target.value))}
                    className="w-full px-3 py-2.5 border border-orange-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  <div className="flex justify-between text-sm mt-2 font-semibold text-orange-800">
                    <span>Balance Owed:</span>
                    <span className="text-red-600">{fmt(Math.max(0, editTotal - editAmountPaid))}</span>
                  </div>
                </div>
              )}

              {/* Items */}
              <div className="border-t border-slate-100 pt-4">
                <h4 className="font-medium text-slate-800 mb-3">Items</h4>

                <div className="space-y-2 mb-3">
                  {editCart.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 py-1.5 border-b border-slate-100">
                      <div className="flex-1 text-sm font-medium text-slate-800 truncate">{item.product.name}</div>
                      <input type="number" min="0.01" step="0.01" value={item.quantity}
                        onChange={e => updateEditItem(idx, 'quantity', Number(e.target.value))}
                        className="w-18 px-2 py-1 border border-slate-200 rounded text-sm text-right text-slate-800" />
                      <span className="text-xs text-slate-400">{item.product.unit}</span>
                      <input type="number" min="0" step="0.01" value={item.unitPrice}
                        onChange={e => updateEditItem(idx, 'unitPrice', Number(e.target.value))}
                        className="w-24 px-2 py-1 border border-slate-200 rounded text-sm text-right text-slate-800" />
                      <span className="text-sm font-semibold text-slate-600 w-24 text-right">{fmt(item.quantity * item.unitPrice)}</span>
                      <button onClick={() => setEditCart(editCart.filter((_, i) => i !== idx))}
                        className="text-slate-300 hover:text-red-500 flex-shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add product to edit cart */}
                <div className="grid grid-cols-4 gap-2">
                  <select value={editProduct} onChange={e => {
                    setEditProduct(e.target.value);
                    const p = products.find(p => p._id === e.target.value);
                    if (p) setEditPrice(p.unitPrice);
                  }} className="col-span-1 px-2 py-1.5 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                    <option value="">Add product...</option>
                    {products.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </select>
                  <input type="number" min="0.01" step="0.01" value={editQty}
                    onChange={e => setEditQty(Number(e.target.value))}
                    className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-800" placeholder="Qty" />
                  <input type="number" min="0" step="0.01" value={editPrice}
                    onChange={e => setEditPrice(Number(e.target.value))}
                    className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-800" placeholder="Price" />
                  <button type="button" onClick={addToEditCart} disabled={!editProduct}
                    className="flex items-center justify-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white rounded-lg text-sm font-medium transition-colors">
                    <Plus className="w-3 h-3" />Add
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none text-sm" />
              </div>

              {/* Total summary */}
              <div className="p-4 bg-slate-50 rounded-lg space-y-1">
                <div className="flex justify-between font-bold text-slate-800">
                  <span>New Total</span>
                  <span className="text-amber-600 text-lg">{fmt(editTotal)}</span>
                </div>
                {editPaymentMethod === 'part' && (
                  <>
                    <div className="flex justify-between text-sm text-slate-600">
                      <span>Amount Paid</span><span className="text-green-600 font-medium">{fmt(editPaid)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-slate-600">
                      <span>Balance Owed</span><span className="text-red-600 font-medium">{fmt(Math.max(0, editBalance))}</span>
                    </div>
                  </>
                )}
                {editPaymentMethod === 'unpaid' && (
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Added to Debtors</span><span className="text-red-600 font-medium">{fmt(editTotal)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 p-6 border-t border-slate-100">
              <button onClick={() => setEditSale(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveEdit} disabled={saving || !editCart.length}
                className="flex-1 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}