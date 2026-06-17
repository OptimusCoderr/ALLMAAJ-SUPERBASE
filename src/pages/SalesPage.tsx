import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { find, insertOne, Collections } from '../lib/api';
import type { Product, Branch, BranchStock } from '../lib/types';
import { Plus, Trash2, ShoppingCart, CheckCircle, UserPlus, Receipt, Pencil, Lock, Send, AlertTriangle, X } from 'lucide-react';

interface CartItem { product: Product; quantity: number; unitPrice: number }

type Tab = 'sale' | 'debtor' | 'expense';
type PaymentMethod = 'cash' | 'pos' | 'part' | 'unpaid';

const pmColors: Record<string, string> = {
  cash:   'bg-green-100 text-green-700',
  pos:    'bg-blue-100 text-blue-700',
  part:   'bg-orange-100 text-orange-700',
  unpaid: 'bg-red-100 text-red-700',
};

const pmLabels: Record<string, string> = {
  cash: 'Cash', pos: 'POS', part: 'Part Payment', unpaid: 'Unpaid',
};

function isToday(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth()    === now.getMonth()    &&
    d.getDate()     === now.getDate()
  );
}

function safeItems(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

function getToken(): string {
  return (
    sessionStorage.getItem('authToken') ||
    localStorage.getItem('authToken') ||
    (window as any).__authToken ||
    ''
  );
}

export default function SalesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab]           = useState<Tab>('sale');
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchStock, setBranchStock] = useState<BranchStock[]>([]);
  const [todaySales, setTodaySales]   = useState<any[]>([]);

  // Sale form
  const [selectedBranch, setSelectedBranch]   = useState(user?.branchId || '');
  const [paymentMethod, setPaymentMethod]     = useState<PaymentMethod>('cash');
  const [customerName, setCustomerName]       = useState('');
  const [customerPhone, setCustomerPhone]     = useState('');
  const [amountPaid, setAmountPaid]           = useState<number>(0);
  const [notes, setNotes]                     = useState('');
  const [saleDate, setSaleDate]               = useState(new Date().toISOString().split('T')[0]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [qty, setQty]     = useState(1);
  const [price, setPrice] = useState(0);
  const [cart, setCart]   = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError]     = useState('');

  // Debtor form
  const [debtorName, setDebtorName]     = useState('');
  const [debtorPhone, setDebtorPhone]   = useState('');
  const [debtorAmount, setDebtorAmount] = useState('');
  const [debtorNotes, setDebtorNotes]   = useState('');

  // Expense form
  const [expenseDesc, setExpenseDesc]         = useState('');
  const [expenseAmount, setExpenseAmount]     = useState('');
  const [expenseCategory, setExpenseCategory] = useState('other');
  const [expenseNotes, setExpenseNotes]       = useState('');

  // Edit modal
  const [editSale, setEditSale]                       = useState<any | null>(null);
  const [editCart, setEditCart]                       = useState<CartItem[]>([]);
  const [editPaymentMethod, setEditPaymentMethod]     = useState<PaymentMethod>('cash');
  const [editCustomerName, setEditCustomerName]       = useState('');
  const [editCustomerPhone, setEditCustomerPhone]     = useState('');
  const [editAmountPaid, setEditAmountPaid]           = useState<number>(0);
  const [editNotes, setEditNotes]                     = useState('');
  const [editSelectedProduct, setEditSelectedProduct] = useState('');
  const [editQty, setEditQty]       = useState(1);
  const [editPrice, setEditPrice]   = useState(0);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError]     = useState('');

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
    if (branch) {
      setSelectedBranch(branch);
      fetchTodaySales(branch);
    }
  }

  async function fetchStock(branchId: string) {
    const data = await find(Collections.BRANCH_STOCK, { branchId });
    setBranchStock(data as BranchStock[]);
  }

  async function fetchTodaySales(branchId: string) {
    const today = new Date().toISOString().split('T')[0];
    const data = await find(
      Collections.SALES,
      { branchId, saleDate: { $gte: `${today}T00:00:00.000Z` } },
      { sort: { createdAt: -1 }, limit: 100 }
    );
    setTodaySales(data as any[]);
  }

  function getStock(productId: string) {
    return branchStock.find(s => s.productId === productId)?.quantity ?? 0;
  }

  function addToCart() {
    const product = products.find(p => p._id === selectedProduct);
    if (!product) return;
    const idx = cart.findIndex(c => c.product._id === selectedProduct);
    if (idx >= 0) {
      setCart(cart.map((c, i) => i === idx ? { ...c, quantity: c.quantity + qty } : c));
    } else {
      setCart([...cart, { product, quantity: qty, unitPrice: price || product.unitPrice }]);
    }
    setSelectedProduct('');
    setQty(1);
    setPrice(0);
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
    if (!cart.length)    { setError('Add at least one item'); return; }
    if (!selectedBranch) { setError('Select a branch'); return; }
    if (hasDebt) {
      if (!customerName.trim())  { setError('Customer name is required for part/unpaid sales'); return; }
      if (!customerPhone.trim()) { setError('Customer phone is required for part/unpaid sales'); return; }
    }
    if (paymentMethod === 'part' && (amountPaid <= 0 || amountPaid >= total)) {
      setError('Amount paid must be greater than 0 and less than the total'); return;
    }

    setLoading(true);
    setError('');
    try {
      await insertOne(Collections.SALES, {
        branchId:      selectedBranch,
        staffId:       user!.id,
        staffName:     user!.fullName,
        customerName:  customerName.trim(),
        customerPhone: customerPhone.trim(),
        paymentMethod,
        totalAmount:   total,
        amountPaid:    paid,
        balanceDue:    balance,
        notes:         notes.trim(),
        items: cart.map(c => ({
          productId:   c.product._id,
          productName: c.product.name,
          quantity:    c.quantity,
          unitPrice:   c.unitPrice,
          subtotal:    c.quantity * c.unitPrice,
        })),
        saleDate: new Date(`${saleDate}T12:00:00.000Z`).toISOString(),
      });

      if (hasDebt && balance > 0) {
        const itemsSummary = cart.map(c => `${c.product.name} x${c.quantity}`).join(', ');
        await insertOne(Collections.DEBTORS, {
          name:          customerName.trim(),
          phone:         customerPhone.trim(),
          amountOwed:    balance,
          totalAmount:   total,
          amountPaid:    paid,
          branchId:      selectedBranch,
          createdBy:     user!.id,
          createdByName: user!.fullName,
          isCleared:     false,
          notes: `Sale: ${itemsSummary}${notes.trim() ? ` | ${notes.trim()}` : ''}`,
        });
      }

      const debtMsg = hasDebt && balance > 0 ? ` Debtor of ${fmt(balance)} auto-recorded.` : '';
      setSuccess(`Sale recorded!${debtMsg}`);
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setNotes('');
      setAmountPaid(0);
      setPaymentMethod('cash');
      fetchTodaySales(selectedBranch);
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to record sale');
    }
    setLoading(false);
  }

  async function handleDebtor(e: React.FormEvent) {
    e.preventDefault();
    if (!debtorName.trim())                             { setError('Debtor name is required'); return; }
    if (!debtorPhone.trim())                            { setError('Phone number is required'); return; }
    if (!debtorAmount || parseFloat(debtorAmount) <= 0) { setError('Amount owed is required'); return; }
    setLoading(true);
    setError('');
    try {
      await insertOne(Collections.DEBTORS, {
        name:          debtorName.trim(),
        phone:         debtorPhone.trim(),
        amountOwed:    parseFloat(debtorAmount),
        branchId:      selectedBranch,
        createdBy:     user!.id,
        createdByName: user!.fullName,
        isCleared:     false,
        notes:         debtorNotes.trim(),
      });
      setSuccess('Debtor recorded!');
      setDebtorName('');
      setDebtorPhone('');
      setDebtorAmount('');
      setDebtorNotes('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to record debtor');
    }
    setLoading(false);
  }

  async function handleExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!expenseDesc.trim())                              { setError('Description is required'); return; }
    if (!expenseAmount || parseFloat(expenseAmount) <= 0) { setError('Amount is required'); return; }
    setLoading(true);
    setError('');
    try {
      await insertOne(Collections.EXPENSES, {
        branchId:       selectedBranch,
        description:    expenseDesc.trim(),
        amount:         parseFloat(expenseAmount),
        category:       expenseCategory,
        recordedBy:     user!.id,
        recordedByName: user!.fullName,
        expenseDate:    new Date().toISOString(),
        notes:          expenseNotes.trim(),
      });
      setSuccess('Expense recorded!');
      setExpenseDesc('');
      setExpenseAmount('');
      setExpenseNotes('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to record expense');
    }
    setLoading(false);
  }

  // ── Edit helpers ──────────────────────────────────────────────────────────────

  function openEditSale(sale: any) {
    setEditSale(sale);
    setEditPaymentMethod(sale.paymentMethod as PaymentMethod);
    setEditCustomerName(sale.customerName || '');
    setEditCustomerPhone(sale.customerPhone || '');
    setEditAmountPaid(sale.amountPaid ?? 0);
    setEditNotes(sale.notes || '');
    setEditError('');

    const rawItems = safeItems(sale.items);
    const rebuilt: CartItem[] = rawItems.map((item: any) => {
      const productId = item.product_id || item.productId;
      const found = products.find(p => p._id === productId);
      const fallback: Product = {
        _id:      productId,
        name:     item.productName || item.product_name || productId,
        unitPrice: item.unit_price ?? item.unitPrice ?? 0,
        unit:     '',
        isActive: true,
      } as unknown as Product;
      return {
        product:   found || fallback,
        quantity:  item.quantity,
        unitPrice: item.unit_price ?? item.unitPrice ?? 0,
      };
    });
    setEditCart(rebuilt);
    setEditSelectedProduct('');
    setEditQty(1);
    setEditPrice(0);
  }

  function closeEditSale() {
    setEditSale(null);
    setEditCart([]);
    setEditError('');
  }

  function addToEditCart() {
    const product = products.find(p => p._id === editSelectedProduct);
    if (!product) return;
    const idx = editCart.findIndex(c => c.product._id === editSelectedProduct);
    if (idx >= 0) {
      setEditCart(editCart.map((c, i) => i === idx ? { ...c, quantity: c.quantity + editQty } : c));
    } else {
      setEditCart([...editCart, { product, quantity: editQty, unitPrice: editPrice || product.unitPrice }]);
    }
    setEditSelectedProduct('');
    setEditQty(1);
    setEditPrice(0);
  }

  function updateEditItem(idx: number, field: 'quantity' | 'unitPrice', value: number) {
    setEditCart(editCart.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  }

  const editTotal   = editCart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
  const editHasDebt = editPaymentMethod === 'unpaid' || editPaymentMethod === 'part';
  const editPaid    = editPaymentMethod === 'unpaid' ? 0 : editPaymentMethod === 'part' ? editAmountPaid : editTotal;
  const editBalance = editTotal - editPaid;

  async function handleSaveEdit() {
    if (!editSale) return;
    if (!editCart.length) { setEditError('Add at least one item'); return; }
    if (editHasDebt) {
      if (!editCustomerName.trim())  { setEditError('Customer name is required for part/unpaid sales'); return; }
      if (!editCustomerPhone.trim()) { setEditError('Customer phone is required for part/unpaid sales'); return; }
    }
    if (editPaymentMethod === 'part' && (editAmountPaid <= 0 || editAmountPaid >= editTotal)) {
      setEditError('Amount paid must be greater than 0 and less than the total'); return;
    }

    setEditLoading(true);
    setEditError('');
    try {
      const saleId = editSale._id || editSale.id;
      const res = await fetch(`${BASE}/api/sales/${saleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          paymentMethod:  editPaymentMethod,
          customerName:   editCustomerName.trim(),
          customerPhone:  editCustomerPhone.trim(),
          amountPaid:     editPaid,
          balanceDue:     editBalance,
          notes:          editNotes.trim(),
          items: editCart.map(c => ({
            productId:   c.product._id,
            productName: c.product.name,
            quantity:    c.quantity,
            unitPrice:   c.unitPrice,
            subtotal:    c.quantity * c.unitPrice,
          })),
          totalAmount: editTotal,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      setSuccess('Sale updated successfully!');
      closeEditSale();
      fetchTodaySales(selectedBranch);
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setEditError(err.message || 'Failed to update sale');
    }
    setEditLoading(false);
  }

  async function handleDeleteSale(id: string) {
    if (!window.confirm('Are you sure you want to delete this sale? This cannot be undone.')) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/sales/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      setSuccess('Sale deleted.');
      fetchTodaySales(selectedBranch);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete sale');
    }
    setLoading(false);
  }

  function canEditOrDelete(sale: any): boolean {
    if (!isToday(sale.saleDate)) return false;
    if (user?.role === 'admin') return true;
    return sale.staffId === user?.id;
  }

  const fmt = (n: number) =>
    `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  const tabStyle = (t: Tab) =>
    `flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      tab === t ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`;

  const pmButtonStyle = (m: PaymentMethod, current: PaymentMethod) => {
    const active = current === m;
    const colors: Record<PaymentMethod, string> = {
      cash:   active ? 'bg-green-500 text-white border-green-500'   : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
      pos:    active ? 'bg-blue-500 text-white border-blue-500'     : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
      part:   active ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
      unpaid: active ? 'bg-red-500 text-white border-red-500'       : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
    };
    return `flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${colors[m]}`;
  };

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
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
      )}

      <div className="flex gap-2">
        <button onClick={() => setTab('sale')}    className={tabStyle('sale')}>   <ShoppingCart className="w-4 h-4" />Sale</button>
        <button onClick={() => setTab('debtor')}  className={tabStyle('debtor')}> <UserPlus className="w-4 h-4" />Debtor</button>
        <button onClick={() => setTab('expense')} className={tabStyle('expense')}><Receipt className="w-4 h-4" />Expense</button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* ── Left panel ─────────────────────────────────────────────────────── */}
        <div className="xl:col-span-2">

          {/* SALE FORM */}
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
                    {(['cash', 'pos', 'part', 'unpaid'] as PaymentMethod[]).map(m => (
                      <button key={m} type="button" onClick={() => { setPaymentMethod(m); setAmountPaid(0); }}
                        className={pmButtonStyle(m, paymentMethod)}>
                        {pmLabels[m]}
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
                      <option value="">Select...</option>
                      {products.map(p => <option key={p._id} value={p._id}>{p.name} ({getStock(p._id)})</option>)}
                    </select>
                  </div>
                  <input type="number" min="0.01" step="0.01" value={qty}
                    onChange={e => setQty(Number(e.target.value))}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="Qty" />
                  <input type="number" min="0" step="0.01" value={price}
                    onChange={e => setPrice(Number(e.target.value))}
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
                        <span className="text-xs text-slate-400">{(item.product as any).unit}</span>
                        <input type="number" min="0" step="0.01" value={item.unitPrice}
                          onChange={e => updateItem(idx, 'unitPrice', Number(e.target.value))}
                          className="w-24 px-2 py-1 border border-slate-200 rounded text-sm text-right text-slate-800" />
                        <span className="font-semibold text-slate-600 text-sm w-24 text-right">
                          {fmt(item.quantity * item.unitPrice)}
                        </span>
                        <button onClick={() => setCart(cart.filter((_, i) => i !== idx))}
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

                  <button onClick={handleSale} disabled={loading}
                    className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2">
                    {loading && <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {hasDebt ? 'Submit Sale & Record Debt' : 'Submit Sale'}
                  </button>
                </div>
              )}
            </div>
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
                    <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
                      disabled={user?.role !== 'admin'}
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

        {/* ── Right panel: Today's Sales ────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 h-fit overflow-hidden">
          <div className="p-4 bg-amber-50 border-b border-amber-100">
            <div className="flex items-start gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 font-medium leading-snug">
                Sales lock at midnight — submit your report before 12:00 AM
              </p>
            </div>
            <button onClick={() => navigate('/daily-report')}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors">
              <Send className="w-4 h-4" />Submit Daily Report
            </button>
          </div>

          <div className="p-4">
            <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-amber-500" />
              Today's Sales
              {todaySales.length > 0 && (
                <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                  {todaySales.length}
                </span>
              )}
            </h3>

            {todaySales.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">No sales today yet</p>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {todaySales.map(s => {
                  const locked   = !isToday(s.saleDate);
                  const editable = canEditOrDelete(s);
                  const items    = safeItems(s.items);
                  return (
                    <div key={s._id || s.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-slate-800 text-sm">{fmt(s.totalAmount)}</span>
                        <div className="flex items-center gap-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${pmColors[s.paymentMethod] ?? 'bg-slate-100 text-slate-600'}`}>
                            {pmLabels[s.paymentMethod] ?? s.paymentMethod}
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
              </div>
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
              <button onClick={closeEditSale}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {editError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{editError}</div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Payment Method</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['cash', 'pos', 'part', 'unpaid'] as PaymentMethod[]).map(m => (
                    <button key={m} type="button"
                      onClick={() => { setEditPaymentMethod(m); setEditAmountPaid(0); }}
                      className={pmButtonStyle(m, editPaymentMethod)}>
                      {pmLabels[m]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Customer Name {editHasDebt && <span className="text-red-500">*</span>}
                  </label>
                  <input type="text" value={editCustomerName} onChange={e => setEditCustomerName(e.target.value)}
                    placeholder={editHasDebt ? 'Required for debt tracking' : 'Optional'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Customer Phone {editHasDebt && <span className="text-red-500">*</span>}
                  </label>
                  <input type="tel" value={editCustomerPhone} onChange={e => setEditCustomerPhone(e.target.value)}
                    placeholder={editHasDebt ? 'Required for debt tracking' : 'Optional'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h4 className="font-medium text-slate-800 mb-3 text-sm">Products</h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
                  <div className="sm:col-span-1">
                    <select value={editSelectedProduct} onChange={e => {
                      setEditSelectedProduct(e.target.value);
                      const p = products.find(p => p._id === e.target.value);
                      if (p) setEditPrice(p.unitPrice);
                    }} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                      <option value="">Select...</option>
                      {products.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                    </select>
                  </div>
                  <input type="number" min="0.01" step="0.01" value={editQty}
                    onChange={e => setEditQty(Number(e.target.value))}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="Qty" />
                  <input type="number" min="0" step="0.01" value={editPrice}
                    onChange={e => setEditPrice(Number(e.target.value))}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="Price" />
                  <button type="button" onClick={addToEditCart} disabled={!editSelectedProduct}
                    className="flex items-center justify-center gap-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white rounded-lg text-sm font-medium transition-colors">
                    <Plus className="w-4 h-4" />Add
                  </button>
                </div>

                <div className="space-y-2">
                  {editCart.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                      <div className="flex-1 font-medium text-slate-800 text-sm">{item.product.name}</div>
                      <input type="number" min="0.01" step="0.01" value={item.quantity}
                        onChange={e => updateEditItem(idx, 'quantity', Number(e.target.value))}
                        className="w-20 px-2 py-1 border border-slate-200 rounded text-sm text-right text-slate-800" />
                      <input type="number" min="0" step="0.01" value={item.unitPrice}
                        onChange={e => updateEditItem(idx, 'unitPrice', Number(e.target.value))}
                        className="w-24 px-2 py-1 border border-slate-200 rounded text-sm text-right text-slate-800" />
                      <span className="font-semibold text-slate-600 text-sm w-24 text-right">
                        {fmt(item.quantity * item.unitPrice)}
                      </span>
                      <button onClick={() => setEditCart(editCart.filter((_, i) => i !== idx))}
                        className="text-slate-300 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {editCart.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-3">No items. Add a product above.</p>
                  )}
                </div>
              </div>

              {editPaymentMethod === 'part' && (
                <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg space-y-2">
                  <label className="block text-sm font-medium text-orange-800">Amount Paid by Customer (₦) *</label>
                  <input type="number" min="0.01" step="0.01" value={editAmountPaid || ''}
                    onChange={e => setEditAmountPaid(Number(e.target.value))}
                    placeholder="Enter amount customer is paying now"
                    className="w-full px-3 py-2.5 border border-orange-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-400" />
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-orange-700">Balance Owed:</span>
                    <span className="font-bold text-red-600">{fmt(Math.max(0, editTotal - editAmountPaid))}</span>
                  </div>
                </div>
              )}

              {editPaymentMethod === 'unpaid' && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex justify-between text-sm">
                    <span className="font-semibold text-red-800">Full Amount Owed:</span>
                    <span className="font-bold text-red-600">{fmt(editTotal)}</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none text-sm"
                  placeholder="Add notes..." />
              </div>

              <div className="p-3 bg-slate-50 rounded-lg flex items-center justify-between">
                <span className="font-semibold text-slate-700">New Total</span>
                <span className="text-xl font-bold text-amber-600">{fmt(editTotal)}</span>
              </div>
            </div>

            <div className="flex gap-3 p-6 border-t border-slate-100">
              <button onClick={closeEditSale} disabled={editLoading}
                className="flex-1 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-medium text-sm hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveEdit} disabled={editLoading || editCart.length === 0}
                className="flex-1 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                {editLoading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}