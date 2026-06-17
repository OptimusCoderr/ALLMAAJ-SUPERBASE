import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { find, insertOne, Collections } from '../lib/api';
import type { Product, Branch, BranchStock } from '../lib/types';
import { Plus, Trash2, ShoppingCart, CheckCircle, UserPlus, Receipt } from 'lucide-react';

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

export default function SalesPage() {
  const { user } = useAuth();
  const [tab, setTab]       = useState<Tab>('sale');
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchStock, setBranchStock] = useState<BranchStock[]>([]);
  const [recentSales, setRecentSales] = useState<any[]>([]);

  // Sale form
  const [selectedBranch, setSelectedBranch] = useState(user?.branchId || '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [customerName, setCustomerName]   = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [amountPaid, setAmountPaid]       = useState<number>(0);
  const [notes, setNotes]                 = useState('');
  const [saleDate, setSaleDate]           = useState(new Date().toISOString().split('T')[0]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [qty, setQty]               = useState(1);
  const [price, setPrice]           = useState(0);
  const [cart, setCart]             = useState<CartItem[]>([]);
  const [loading, setLoading]       = useState(false);
  const [success, setSuccess]       = useState('');
  const [error, setError]           = useState('');

  // Debtor form
  const [debtorName, setDebtorName]   = useState('');
  const [debtorPhone, setDebtorPhone] = useState('');
  const [debtorAmount, setDebtorAmount] = useState('');
  const [debtorNotes, setDebtorNotes] = useState('');

  // Expense form
  const [expenseDesc, setExpenseDesc]         = useState('');
  const [expenseAmount, setExpenseAmount]     = useState('');
  const [expenseCategory, setExpenseCategory] = useState('other');
  const [expenseNotes, setExpenseNotes]       = useState('');

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
    if (branch) { setSelectedBranch(branch); fetchRecent(branch); }
  }

  async function fetchStock(branchId: string) {
    const data = await find(Collections.BRANCH_STOCK, { branchId });
    setBranchStock(data as BranchStock[]);
  }

  async function fetchRecent(branchId: string) {
    const today = new Date().toISOString().split('T')[0];
    const data = await find(Collections.SALES, { branchId, saleDate: { $gte: `${today}T00:00:00.000Z` } }, { sort: { createdAt: -1 }, limit: 5 });
    setRecentSales(data as any[]);
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
    if (!cart.length) { setError('Add at least one item'); return; }
    if (!selectedBranch) { setError('Select a branch'); return; }

    // Customer name + phone required when there is a debt
    if (hasDebt) {
      if (!customerName.trim()) { setError('Customer name is required for part/unpaid sales'); return; }
      if (!customerPhone.trim()) { setError('Customer phone is required for part/unpaid sales'); return; }
    }
    if (paymentMethod === 'part' && (amountPaid <= 0 || amountPaid >= total)) {
      setError('Amount paid must be greater than 0 and less than the total'); return;
    }

    setLoading(true);
    setError('');
    try {
      // 1. Record the sale
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // 2. Auto-create debtor if there is an outstanding balance
      if (hasDebt && balance > 0) {
        const itemsSummary = cart.map(c => `${c.product.name} x${c.quantity}`).join(', ');
        await insertOne(Collections.DEBTORS, {
          name: customerName.trim(),
          phone: customerPhone.trim(),
          amountOwed: balance,
          totalAmount: total,
          amountPaid: paid,
          branchId: selectedBranch,
          createdBy: user!.id,
          createdByName: user!.fullName,
          isCleared: false,
          notes: `Sale: ${itemsSummary}${notes.trim() ? ` | ${notes.trim()}` : ''}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      const debtMsg = hasDebt && balance > 0
        ? ` Debtor of ${fmt(balance)} auto-recorded.`
        : '';
      setSuccess(`Sale recorded!${debtMsg}`);
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setNotes('');
      setAmountPaid(0);
      setPaymentMethod('cash');
      fetchRecent(selectedBranch);
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to record sale');
    }
    setLoading(false);
  }

  async function handleDebtor(e: React.FormEvent) {
    e.preventDefault();
    if (!debtorName.trim()) { setError('Debtor name is required'); return; }
    if (!debtorPhone.trim()) { setError('Phone number is required'); return; }
    if (!debtorAmount || parseFloat(debtorAmount) <= 0) { setError('Amount owed is required'); return; }
    setLoading(true);
    setError('');
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
    if (!expenseDesc.trim()) { setError('Description is required'); return; }
    if (!expenseAmount || parseFloat(expenseAmount) <= 0) { setError('Amount is required'); return; }
    setLoading(true);
    setError('');
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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

  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  const tabStyle = (t: Tab) =>
    `flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      tab === t ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`;

  const pmButtonStyle = (m: PaymentMethod) => {
    const active = paymentMethod === m;
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
        <p className="text-slate-500 text-sm mt-1">Staff: <span className="font-medium text-slate-700">{user?.fullName}</span></p>
      </div>

      {success && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-green-700">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />{success}
        </div>
      )}
      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

      <div className="flex gap-2">
        <button onClick={() => setTab('sale')} className={tabStyle('sale')}><ShoppingCart className="w-4 h-4" />Sale</button>
        <button onClick={() => setTab('debtor')} className={tabStyle('debtor')}><UserPlus className="w-4 h-4" />Debtor</button>
        <button onClick={() => setTab('expense')} className={tabStyle('expense')}><Receipt className="w-4 h-4" />Expense</button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
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

                {/* Payment Method — 4 options */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['cash', 'pos', 'part', 'unpaid'] as PaymentMethod[]).map(m => (
                      <button key={m} type="button" onClick={() => { setPaymentMethod(m); setAmountPaid(0); }}
                        className={pmButtonStyle(m)}>
                        {pmLabels[m]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Customer details — always shown but required for part/unpaid */}
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

                  {/* Part payment: show amount paid input + live balance */}
                  {paymentMethod === 'part' && (
                    <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-orange-800 mb-1">Amount Paid by Customer (₦) *</label>
                        <input
                          type="number" min="0.01" step="0.01"
                          value={amountPaid || ''}
                          onChange={e => setAmountPaid(Number(e.target.value))}
                          placeholder="Enter amount customer is paying now"
                          className="w-full px-3 py-2.5 border border-orange-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-400"
                        />
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

                  {/* Unpaid: show full amount going to debtors */}
                  {paymentMethod === 'unpaid' && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-semibold text-red-800">Full Amount Owed:</span>
                        <span className="font-bold text-red-600">{fmt(total)}</span>
                      </div>
                      <p className="text-xs text-red-600">The full amount will be automatically added to Debtors.</p>
                    </div>
                  )}

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none text-sm" placeholder="Add notes..." />
                  </div>

                  {/* Summary row */}
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
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="e.g., Transport, Airtime, Supplies" />
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

        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 h-fit">
          <h3 className="font-semibold text-slate-800 mb-4">Today's Sales</h3>
          {recentSales.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">No sales today yet</p>
          ) : (
            <div className="space-y-3">
              {recentSales.map(s => (
                <div key={s.id ?? s._id} className="p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-slate-800 text-sm">{fmt(s.totalAmount)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${pmColors[s.paymentMethod] ?? 'bg-slate-100 text-slate-600'}`}>
                      {pmLabels[s.paymentMethod] ?? s.paymentMethod}
                    </span>
                  </div>
                  {(s.paymentMethod === 'part' || s.paymentMethod === 'unpaid') && s.balanceDue > 0 && (
                    <p className="text-xs text-red-500 font-medium">Owes: {fmt(s.balanceDue)}</p>
                  )}
                  <p className="text-xs text-slate-400">By: {s.staffName}</p>
                  {s.customerName && <p className="text-xs text-slate-500">{s.customerName}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}