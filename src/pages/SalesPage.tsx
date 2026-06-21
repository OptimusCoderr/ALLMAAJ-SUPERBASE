import { useEffect, useState, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { find, insertOne, updateOne, Collections } from '../lib/api';
import type { Product, Branch, BranchStock, Expense, Debtor, SpecialCustomer } from '../lib/types';
import {
  Plus, Trash2, ShoppingCart, CheckCircle, UserPlus, Receipt,
  Pencil, Lock, Send, AlertTriangle, X, Wrench, FileText, Search,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CartItem { product: Product; quantity: number; unitPrice: number }
interface ServiceCartItem { serviceName: string; serviceNotes: string; quantity: number; unitPrice: number }
type Tab           = 'sale' | 'debtor' | 'expense';
type PaymentMethod = 'cash' | 'pos' | 'part' | 'unpaid';

const SERVICE_SUGGESTIONS = ['Monogramming', 'Large Format Printing', 'Sublimation', 'Graphics Design'];

interface EditSaleState {
  sale: any;
  cart: CartItem[];
  serviceCart: ServiceCartItem[];
  pm: PaymentMethod;
  customerName: string; customerPhone: string;
  amountPaid: number;   notes: string;
  addProduct: string;   addQty: number; addPrice: number;
  addService: string;   addServiceNotes: string; addServiceQty: number; addServicePrice: number;
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
  const [productSearch, setProductSearch]             = useState('');
  const [productCategory, setProductCategory]         = useState('all');
  const [productSuggestions, setProductSuggestions]   = useState<Product[]>([]);
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const productInputRef = useRef<HTMLInputElement>(null);

  // Service form
  const [serviceCart, setServiceCart]         = useState<ServiceCartItem[]>([]);
  const [selectedService, setSelectedService] = useState('');
  const [serviceNotes, setServiceNotes]       = useState('');
  const [serviceQty, setServiceQty]           = useState(1);
  const [servicePrice, setServicePrice]       = useState(0);

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

  // Special customers
  const [specialCustomers, setSpecialCustomers]         = useState<SpecialCustomer[]>([]);
  const [customerSuggestions, setCustomerSuggestions]   = useState<SpecialCustomer[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const customerInputRef = useRef<HTMLInputElement>(null);

  // Shared form feedback
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError]     = useState('');

  // Edit modals
  const [editSale, setEditSale]       = useState<EditSaleState | null>(null);
  const [editExpense, setEditExpense] = useState<EditExpenseState | null>(null);
  const [editDebtor, setEditDebtor]   = useState<EditDebtorState | null>(null);

  // Daily report
  const [reportLoading, setReportLoading]     = useState(false);
  const [reportMsg, setReportMsg]             = useState<{ ok: boolean; text: string } | null>(null);
  const [reportConfirmOpen, setReportConfirmOpen] = useState(false);

  // Derived: unique category pills from product list
  const productCategories = useMemo(() =>
    ['all', ...Array.from(new Set(products.map(p => p.category).filter((c): c is string => Boolean(c)))).sort()],
    [products]);

  useEffect(() => { fetchData(); }, [user]);
  useEffect(() => { if (selectedBranch) fetchStock(selectedBranch); }, [selectedBranch]);

  // ── Product search autocomplete ───────────────────────────────────────────

  function getProductSuggestions(search: string, category: string): Product[] {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    const base = category !== 'all' ? products.filter(p => p.category === category) : products;
    return base.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.sku ?? '').toLowerCase().includes(q) ||
      (p.category ?? '').toLowerCase().includes(q)
    );
  }

  function handleProductSearchChange(value: string) {
    setProductSearch(value);
    setSelectedProduct('');
    setPrice(0);
    if (!value.trim()) {
      setProductSuggestions([]);
      setShowProductDropdown(false);
      return;
    }
    const matches = getProductSuggestions(value, productCategory);
    setProductSuggestions(matches);
    setShowProductDropdown(true);
  }

  function handleProductCategoryChange(cat: string) {
    setProductCategory(cat);
    setSelectedProduct('');
    setProductSearch('');
    setProductSuggestions([]);
    setShowProductDropdown(false);
  }

  function selectProductSuggestion(p: Product) {
    setSelectedProduct(p._id);
    setProductSearch(p.name);
    setPrice(p.unitPrice);
    setProductSuggestions([]);
    setShowProductDropdown(false);
  }

  function switchTab(t: Tab) {
    setTab(t);
    setError('');
    setSuccess('');
  }

  async function fetchData() {
    const [prods, brs, specials] = await Promise.all([
      find(Collections.PRODUCTS, { isActive: true }, { sort: { name: 1 } }),
      find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }),
      find(Collections.SPECIAL_CUSTOMERS, { isActive: true }),
    ]);
    setProducts(prods as Product[]);
    setBranches(brs as Branch[]);
    setSpecialCustomers(specials as SpecialCustomer[]);
    const branch = user?.branchId || (brs[0]?._id ?? '');
    if (branch) {
      setSelectedBranch(branch);
      fetchTodayData(branch);
    }
  }

  function handleCustomerNameChange(value: string) {
    setCustomerName(value);
    if (value.trim().length === 0) {
      setCustomerSuggestions([]);
      setShowCustomerDropdown(false);
      return;
    }
    const q = value.toLowerCase();
    const matches = specialCustomers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.phone || '').includes(q)
    );
    setCustomerSuggestions(matches);
    setShowCustomerDropdown(matches.length > 0);
  }

  function selectSpecialCustomer(c: SpecialCustomer) {
    setCustomerName(c.name);
    setCustomerPhone(c.phone || '');
    setShowCustomerDropdown(false);
    setCustomerSuggestions([]);
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
    setProductSearch('');
    setQty(1);
    setPrice(0);
    setError('');
  }

  function updateItem(idx: number, field: 'quantity' | 'unitPrice', value: number) {
    setCart(cart.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  }

  function addToServiceCart() {
    if (!selectedService.trim()) return;
    setServiceCart([...serviceCart, {
      serviceName: selectedService.trim(), serviceNotes: serviceNotes.trim(),
      quantity: serviceQty, unitPrice: servicePrice,
    }]);
    setSelectedService('');
    setServiceNotes('');
    setServiceQty(1);
    setServicePrice(0);
  }

  function updateServiceItem(idx: number, field: 'quantity' | 'unitPrice', value: number) {
    setServiceCart(serviceCart.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  }

  const productTotal = cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
  const serviceTotal = serviceCart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
  const total        = productTotal + serviceTotal;
  const hasDebt = paymentMethod === 'unpaid' || paymentMethod === 'part';
  const paid    = paymentMethod === 'unpaid' ? 0 : paymentMethod === 'part' ? amountPaid : total;
  const balance = total - paid;

  // ── Sale submit ────────────────────────────────────────────────────────────

  async function handleSale(e: React.FormEvent) {
    e.preventDefault();
    if (!cart.length && !serviceCart.length) { setError('Add at least one product or service'); return; }
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
        items: [
          ...cart.map(c => ({
            productId: c.product._id, productName: c.product.name,
            quantity: c.quantity, unitPrice: c.unitPrice, subtotal: c.quantity * c.unitPrice,
          })),
          ...serviceCart.map(s => ({
            productId: null, productName: s.serviceName, itemType: 'service',
            serviceNotes: s.serviceNotes,
            quantity: s.quantity, unitPrice: s.unitPrice, subtotal: s.quantity * s.unitPrice,
          })),
        ],
        saleDate: new Date(`${saleDate}T12:00:00.000Z`).toISOString(),
      });
      if (hasDebt && balance > 0) {
        const itemsSummary = [
          ...cart.map(c => `${c.product.name} x${c.quantity}`),
          ...serviceCart.map(s => `${s.serviceName} x${s.quantity}`),
        ].join(', ');
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
      setServiceCart([]);
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
    setReportConfirmOpen(false);
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

  // ── Report summary (for confirm modal) ────────────────────────────────────
  const rsCash     = todaySales.filter(s => s.paymentMethod === 'cash').reduce((a, s) => a + Number(s.totalAmount), 0);
  const rsPos      = todaySales.filter(s => s.paymentMethod === 'pos').reduce((a, s) => a + Number(s.totalAmount), 0);
  const rsPart     = todaySales.filter(s => s.paymentMethod === 'part').reduce((a, s) => a + Number(s.totalAmount), 0);
  const rsUnpaid   = todaySales.filter(s => s.paymentMethod === 'unpaid').reduce((a, s) => a + Number(s.totalAmount), 0);
  const rsExpenses = todayExpenses.reduce((a, e) => a + Number(e.amount), 0);
  const reportSummary = {
    cash: rsCash, pos: rsPos, part: rsPart, unpaid: rsUnpaid,
    expenses: rsExpenses,
    debtors:  todayDebtors.length,
    debtAmt:  todayDebtors.reduce((a, d) => a + Number(d.amountOwed), 0),
    net:      rsCash + rsPos + rsPart - rsExpenses,
  };

  // ── Edit Sale ─────────────────────────────────────────────────────────────

  function openEditSale(sale: any) {
    const allItems = safeItems(sale.items);
    const rebuilt: CartItem[] = allItems
      .filter((item: any) => item.itemType !== 'service' && (item.product_id || item.productId))
      .map((item: any) => {
        const productId = item.product_id || item.productId;
        const found = products.find(p => p._id === productId);
        const fallback: Product = {
          _id: productId, name: item.productName || item.product_name || productId,
          unitPrice: item.unit_price ?? item.unitPrice ?? 0, unit: '', isActive: true,
        } as unknown as Product;
        return { product: found || fallback, quantity: item.quantity, unitPrice: item.unit_price ?? item.unitPrice ?? 0 };
      });
    const rebuiltServices: ServiceCartItem[] = allItems
      .filter((item: any) => item.itemType === 'service')
      .map((item: any) => ({
        serviceName: item.productName || item.product_name || '',
        serviceNotes: item.serviceNotes || '',
        quantity: item.quantity,
        unitPrice: item.unit_price ?? item.unitPrice ?? 0,
      }));
    setEditSale({
      sale, cart: rebuilt, serviceCart: rebuiltServices,
      pm: sale.paymentMethod as PaymentMethod,
      customerName: sale.customerName || '', customerPhone: sale.customerPhone || '',
      amountPaid: sale.amountPaid ?? 0, notes: sale.notes || '',
      addProduct: '', addQty: 1, addPrice: 0,
      addService: '', addServiceNotes: '', addServiceQty: 1, addServicePrice: 0,
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
    if (!editSale.cart.length && !editSale.serviceCart.length) { setEditSale({ ...editSale, error: 'Add at least one product or service' }); return; }
    const eHasDebt = editSale.pm === 'unpaid' || editSale.pm === 'part';
    if (eHasDebt && !editSale.customerName.trim()) { setEditSale({ ...editSale, error: 'Customer name required' }); return; }
    if (eHasDebt && !editSale.customerPhone.trim()) { setEditSale({ ...editSale, error: 'Customer phone required' }); return; }
    const eTotal   = editSale.cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0)
                   + editSale.serviceCart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
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
          items: [
            ...editSale.cart.map(c => ({
              productId: c.product._id, productName: c.product.name,
              quantity: c.quantity, unitPrice: c.unitPrice, subtotal: c.quantity * c.unitPrice,
            })),
            ...editSale.serviceCart.map(s => ({
              productId: null, productName: s.serviceName, itemType: 'service',
              serviceNotes: s.serviceNotes,
              quantity: s.quantity, unitPrice: s.unitPrice, subtotal: s.quantity * s.unitPrice,
            })),
          ],
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
  const eTotal   = (editSale?.cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0) ?? 0)
                 + (editSale?.serviceCart.reduce((s, c) => s + c.quantity * c.unitPrice, 0) ?? 0);
  const eHasDebt = editSale?.pm === 'unpaid' || editSale?.pm === 'part';

  const tabStyle = (t: Tab) =>
    `flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
      tab === t
        ? 'bg-amber-500 text-white shadow-sm'
        : 'bg-white text-slate-600 border border-slate-200 hover:border-amber-300 hover:text-amber-600'
    }`;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Record Transactions</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {user?.fullName} &middot; {branches.find(b => b._id === selectedBranch)?.name || 'Branch'}
          </p>
        </div>
      </div>

      {/* Feedback banners */}
      {success && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-green-700 font-medium">
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

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => switchTab('sale')}    className={tabStyle('sale')}>   <ShoppingCart className="w-4 h-4" />New Sale</button>
        <button onClick={() => switchTab('debtor')}  className={tabStyle('debtor')}> <UserPlus className="w-4 h-4" />Add Debtor</button>
        <button onClick={() => switchTab('expense')} className={tabStyle('expense')}><Receipt className="w-4 h-4" />Add Expense</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">

        {/* ── Left panel ──────────────────────────────────────────────────── */}
        <div className="xl:col-span-2">

          {/* SALE FORM */}
          {tab === 'sale' && (
            <form onSubmit={handleSale} className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-100">

              {/* Section: Branch / Date / Payment */}
              <div className="p-4 sm:p-6 space-y-4">
                <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide">Sale Details</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Branch</label>
                    {isAdmin ? (
                      <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50">
                        {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                      </select>
                    ) : (
                      <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-700 bg-slate-50 text-sm font-medium">
                        {branches.find(b => b._id === selectedBranch)?.name || 'Your Branch'}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Sale Date</label>
                    <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                  </div>
                </div>

                {/* Payment method */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Payment Method</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(['cash', 'pos', 'part', 'unpaid'] as PaymentMethod[]).map(m => (
                      <button key={m} type="button" onClick={() => { setPaymentMethod(m); setAmountPaid(0); }}
                        className={pmButtonStyle(m, paymentMethod)}>
                        {PM_LABELS[m]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Customer fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="relative">
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                      Customer Name {hasDebt && <span className="text-red-500 normal-case font-medium">*required</span>}
                    </label>
                    <input
                      ref={customerInputRef}
                      type="text"
                      value={customerName}
                      onChange={e => handleCustomerNameChange(e.target.value)}
                      onFocus={() => { if (customerSuggestions.length > 0) setShowCustomerDropdown(true); }}
                      onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 150)}
                      placeholder={hasDebt ? 'Required for debt tracking' : 'Type to search special customers…'}
                      className={`w-full px-3 py-2.5 border rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 bg-slate-50 ${
                        hasDebt ? 'border-orange-300 focus:ring-orange-400' : 'border-slate-200 focus:ring-amber-400'
                      }`}
                    />
                    {showCustomerDropdown && (
                      <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                        {customerSuggestions.map(c => (
                          <button
                            key={c._id}
                            type="button"
                            onMouseDown={() => selectSpecialCustomer(c)}
                            className="w-full text-left px-3 py-2.5 hover:bg-amber-50 flex items-center gap-3 border-b border-slate-100 last:border-0"
                          >
                            <div className="w-7 h-7 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 font-bold text-xs flex-shrink-0">
                              {c.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                              {c.phone && <p className="text-xs text-slate-500">{c.phone}</p>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                      Customer Phone {hasDebt && <span className="text-red-500 normal-case font-medium">*required</span>}
                    </label>
                    <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                      placeholder={hasDebt ? 'Required for debt tracking' : 'Optional'}
                      className={`w-full px-3 py-2.5 border rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 bg-slate-50 ${
                        hasDebt ? 'border-orange-300 focus:ring-orange-400' : 'border-slate-200 focus:ring-amber-400'
                      }`} />
                  </div>
                </div>
              </div>

              {/* Section: Add Products */}
              <div className="p-4 sm:p-6 space-y-3">
                <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-amber-500" />Products
                </h3>

                {/* Category filter pills */}
                {productCategories.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {productCategories.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => handleProductCategoryChange(cat)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                          productCategory === cat
                            ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                            : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 hover:border-amber-300'
                        }`}
                      >
                        {cat === 'all' ? 'All Categories' : cat}
                      </button>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  {/* Autocomplete product search */}
                  <div className="sm:col-span-2 relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      <input
                        ref={productInputRef}
                        type="text"
                        value={productSearch}
                        onChange={e => handleProductSearchChange(e.target.value)}
                        onFocus={() => { if (productSuggestions.length > 0) setShowProductDropdown(true); }}
                        onBlur={() => setTimeout(() => setShowProductDropdown(false), 150)}
                        placeholder="Type to search products…"
                        className={`w-full pl-9 pr-9 py-2.5 border rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50 ${
                          selectedProduct ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200'
                        }`}
                      />
                      {productSearch && (
                        <button
                          type="button"
                          onClick={() => {
                            setProductSearch('');
                            setSelectedProduct('');
                            setPrice(0);
                            setProductSuggestions([]);
                            setShowProductDropdown(false);
                            productInputRef.current?.focus();
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* Suggestions dropdown */}
                    {showProductDropdown && productSuggestions.length > 0 && (
                      <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                        {productSuggestions.map(p => {
                          const stock = getStock(p._id);
                          return (
                            <button
                              key={p._id}
                              type="button"
                              disabled={stock === 0}
                              onMouseDown={() => selectProductSuggestion(p)}
                              className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 border-b border-slate-100 last:border-0 transition-colors ${
                                stock === 0
                                  ? 'opacity-40 cursor-not-allowed bg-slate-50'
                                  : 'hover:bg-amber-50 cursor-pointer'
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                                {p.category && <p className="text-xs text-amber-600 font-medium">{p.category}</p>}
                                {p.sku && <p className="text-xs text-slate-400">SKU: {p.sku}</p>}
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="text-sm font-semibold text-slate-700">
                                  ₦{Number(p.unitPrice).toLocaleString('en-NG')}
                                </p>
                                <p className={`text-xs font-medium ${stock === 0 ? 'text-red-400' : 'text-green-600'}`}>
                                  {stock === 0 ? 'Out of stock' : `${stock} left`}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* No results message */}
                    {showProductDropdown && productSearch.trim() && productSuggestions.length === 0 && (
                      <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3 text-center text-sm text-slate-400">
                        No products found for &ldquo;{productSearch}&rdquo;
                      </div>
                    )}
                  </div>

                  <input type="number" min="0.01" step="0.01" value={qty}
                    onChange={e => setQty(Number(e.target.value))}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addToCart())}
                    className="px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" placeholder="Qty" />
                  <div className="flex gap-2">
                    <input type="number" min="0" step="0.01" value={price}
                      onChange={e => setPrice(Number(e.target.value))}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addToCart())}
                      className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" placeholder="Price (₦)" />
                    <button type="button" onClick={addToCart} disabled={!selectedProduct}
                      className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Section: Add Services */}
              <div className="p-4 sm:p-6 space-y-3">
                <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-purple-500" />Services
                </h3>

                {/* Pill suggestions */}
                <div className="flex flex-wrap gap-2">
                  {SERVICE_SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSelectedService(selectedService === s ? '' : s)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                        selectedService === s
                          ? 'bg-purple-500 text-white border-purple-500 shadow-sm'
                          : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100 hover:border-purple-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {/* Custom service name + controls */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      value={selectedService}
                      onChange={e => setSelectedService(e.target.value)}
                      placeholder="Or type a custom service name…"
                      className="w-full px-3 py-2.5 border border-purple-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-purple-50/30 placeholder:text-slate-400"
                    />
                  </div>
                  <input type="number" min="1" step="1" value={serviceQty}
                    onChange={e => setServiceQty(Number(e.target.value))}
                    className="px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-slate-50" placeholder="Qty" />
                  <div className="flex gap-2">
                    <input type="number" min="0" step="0.01" value={servicePrice}
                      onChange={e => setServicePrice(Number(e.target.value))}
                      className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-slate-50" placeholder="Price (₦)" />
                    <button type="button" onClick={addToServiceCart} disabled={!selectedService.trim()}
                      className="px-4 py-2.5 bg-purple-500 hover:bg-purple-600 disabled:bg-slate-200 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <textarea
                  value={serviceNotes}
                  onChange={e => setServiceNotes(e.target.value)}
                  rows={2}
                  placeholder="Service notes / description (optional)"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none bg-slate-50"
                />
              </div>

              {/* Cart + Submit */}
              {(cart.length > 0 || serviceCart.length > 0) && (
                <div className="p-4 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-700 text-sm uppercase tracking-wide">
                      Cart · {cart.length + serviceCart.length} item{(cart.length + serviceCart.length) !== 1 ? 's' : ''}
                    </h3>
                    <button type="button" onClick={() => { setCart([]); setServiceCart([]); }}
                      className="text-xs text-red-400 hover:text-red-600 font-medium transition-colors">
                      Clear all
                    </button>
                  </div>

                  <div className="space-y-1">
                    {cart.map((item, idx) => (
                      <div key={`p-${idx}`} className="flex items-center gap-3 py-2.5 px-3 bg-slate-50 rounded-xl">
                        <div className="flex-1 font-medium text-slate-800 text-sm truncate">{item.product.name}</div>
                        <span className="text-xs text-slate-400 hidden sm:block">{(item.product as any).unit}</span>
                        <input type="number" min="0.01" step="0.01" value={item.quantity}
                          onChange={e => updateItem(idx, 'quantity', Number(e.target.value))}
                          className="w-16 px-2 py-1 border border-slate-200 rounded-lg text-sm text-right text-slate-800 bg-white" />
                        <span className="text-slate-300 text-xs">×</span>
                        <input type="number" min="0" step="0.01" value={item.unitPrice}
                          onChange={e => updateItem(idx, 'unitPrice', Number(e.target.value))}
                          className="w-24 px-2 py-1 border border-slate-200 rounded-lg text-sm text-right text-slate-800 bg-white" />
                        <span className="font-bold text-slate-700 text-sm w-24 text-right">
                          {fmt(item.quantity * item.unitPrice)}
                        </span>
                        <button type="button" onClick={() => setCart(cart.filter((_, i) => i !== idx))}
                          className="text-slate-300 hover:text-red-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {serviceCart.map((item, idx) => (
                      <div key={`s-${idx}`} className="py-2.5 px-3 bg-purple-50/60 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Wrench className="w-3 h-3 text-purple-500 flex-shrink-0" />
                              <span className="font-medium text-slate-800 text-sm truncate">{item.serviceName}</span>
                            </div>
                            {item.serviceNotes && (
                              <p className="text-xs text-slate-400 mt-0.5 pl-4 truncate">{item.serviceNotes}</p>
                            )}
                          </div>
                          <input type="number" min="1" step="1" value={item.quantity}
                            onChange={e => updateServiceItem(idx, 'quantity', Number(e.target.value))}
                            className="w-16 px-2 py-1 border border-purple-200 rounded-lg text-sm text-right text-slate-800 bg-white" />
                          <span className="text-slate-300 text-xs">×</span>
                          <input type="number" min="0" step="0.01" value={item.unitPrice}
                            onChange={e => updateServiceItem(idx, 'unitPrice', Number(e.target.value))}
                            className="w-24 px-2 py-1 border border-purple-200 rounded-lg text-sm text-right text-slate-800 bg-white" />
                          <span className="font-bold text-purple-700 text-sm w-24 text-right">
                            {fmt(item.quantity * item.unitPrice)}
                          </span>
                          <button type="button" onClick={() => setServiceCart(serviceCart.filter((_, i) => i !== idx))}
                            className="text-slate-300 hover:text-red-500 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {paymentMethod === 'part' && (
                    <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl space-y-3">
                      <div>
                        <label className="block text-sm font-semibold text-orange-800 mb-1">Amount Paid by Customer (₦) *</label>
                        <input type="number" min="0.01" step="0.01" value={amountPaid || ''}
                          onChange={e => setAmountPaid(Number(e.target.value))}
                          placeholder="Enter amount customer is paying now"
                          className="w-full px-3 py-2.5 border border-orange-300 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white text-sm" />
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div className="bg-white rounded-lg p-2 text-center">
                          <p className="text-xs text-slate-400">Total Bill</p>
                          <p className="font-bold text-slate-800">{fmt(total)}</p>
                        </div>
                        <div className="bg-green-50 rounded-lg p-2 text-center">
                          <p className="text-xs text-slate-400">Paid Now</p>
                          <p className="font-bold text-green-700">{fmt(amountPaid)}</p>
                        </div>
                        <div className="bg-red-50 rounded-lg p-2 text-center">
                          <p className="text-xs text-slate-400">Balance Owed</p>
                          <p className="font-bold text-red-600">{fmt(Math.max(0, total - amountPaid))}</p>
                        </div>
                      </div>
                      <p className="text-xs text-orange-600">Balance will be auto-added to Debtors.</p>
                    </div>
                  )}

                  {paymentMethod === 'unpaid' && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex justify-between items-center text-sm">
                      <span className="font-semibold text-red-800">Full Amount Owed — auto-added to Debtors</span>
                      <span className="font-bold text-red-600 text-base">{fmt(total)}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Notes (optional)</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none text-sm bg-slate-50"
                      placeholder="Add notes…" />
                  </div>

                  {/* Total + submit */}
                  <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700">Order Total</span>
                      <span className="text-2xl font-bold text-amber-600">{fmt(total)}</span>
                    </div>
                    {paymentMethod === 'part' && amountPaid > 0 && (
                      <>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500">Paid Now</span>
                          <span className="text-green-600 font-semibold">{fmt(amountPaid)}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500">Remaining Debt</span>
                          <span className="text-red-600 font-semibold">{fmt(Math.max(0, balance))}</span>
                        </div>
                      </>
                    )}
                    {paymentMethod === 'unpaid' && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">Added to Debtors</span>
                        <span className="text-red-600 font-semibold">{fmt(total)}</span>
                      </div>
                    )}
                  </div>

                  <button type="submit" disabled={loading}
                    className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 text-base shadow-sm">
                    {loading && <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {hasDebt ? 'Submit Sale & Record Debt' : 'Submit Sale'}
                  </button>
                </div>
              )}

              {!cart.length && !serviceCart.length && (
                <div className="p-8 text-center">
                  <ShoppingCart className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">Add products or services above to begin a sale.</p>
                </div>
              )}
            </form>
          )}

          {/* DEBTOR FORM */}
          {tab === 'debtor' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-6">
              <h3 className="font-bold text-slate-800 mb-5 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-amber-500" />
                Record Debtor
              </h3>
              <form onSubmit={handleDebtor} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Debtor Name *</label>
                    <input type="text" value={debtorName} onChange={e => setDebtorName(e.target.value)} required
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Phone Number *</label>
                    <input type="tel" value={debtorPhone} onChange={e => setDebtorPhone(e.target.value)} required
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Amount Owed (₦) *</label>
                    <input type="number" min="0.01" step="0.01" value={debtorAmount}
                      onChange={e => setDebtorAmount(e.target.value)} required
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Branch</label>
                    {isAdmin ? (
                      <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50">
                        {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                      </select>
                    ) : (
                      <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-700 bg-slate-50 text-sm font-medium">
                        {branches.find(b => b._id === selectedBranch)?.name || 'Your Branch'}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Notes (optional)</label>
                  <textarea value={debtorNotes} onChange={e => setDebtorNotes(e.target.value)} rows={2}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-slate-50" />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm">
                  {loading && <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  Record Debtor
                </button>
              </form>
            </div>
          )}

          {/* EXPENSE FORM */}
          {tab === 'expense' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-6">
              <h3 className="font-bold text-slate-800 mb-5 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-amber-500" />
                Record Expense
              </h3>
              <form onSubmit={handleExpense} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Description *</label>
                  <input type="text" value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} required
                    placeholder="e.g., Transport, Airtime, Supplies"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Amount (₦) *</label>
                    <input type="number" min="0.01" step="0.01" value={expenseAmount}
                      onChange={e => setExpenseAmount(e.target.value)} required
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Category</label>
                    <select value={expenseCategory} onChange={e => setExpenseCategory(e.target.value as any)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50">
                      {EXPENSE_CATS.map(c => (
                        <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Notes (optional)</label>
                  <textarea value={expenseNotes} onChange={e => setExpenseNotes(e.target.value)} rows={2}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-slate-50" />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm">
                  {loading && <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  Record Expense
                </button>
              </form>
            </div>
          )}
        </div>

        {/* ── Right panel ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 h-fit overflow-hidden">

          {/* Submit daily report */}
          <div className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 border-b border-amber-100">
            <div className="flex items-start gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 font-medium leading-snug">
                Sales lock at midnight — submit your report before 12:00 AM
              </p>
            </div>
            <button
              onClick={() => setReportConfirmOpen(true)}
              disabled={reportLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white text-sm font-bold rounded-xl transition-colors shadow-sm">
              {reportLoading
                ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Send className="w-4 h-4" />}
              {reportLoading ? 'Submitting…' : 'Submit Daily Report'}
            </button>
            {reportMsg && (
              <p className={`text-xs font-medium mt-2 text-center ${reportMsg.ok ? 'text-green-700' : 'text-red-600'}`}>
                {reportMsg.text}
              </p>
            )}
          </div>

          {/* Quick stats */}
          {todaySales.length > 0 && (
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Total</p>
                <p className="text-xs font-bold text-amber-600">{fmt(totalTodaySales)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Cash</p>
                <p className="text-xs font-bold text-green-600">{fmt(totalTodayCash)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">POS</p>
                <p className="text-xs font-bold text-blue-600">{fmt(totalTodayPos)}</p>
              </div>
            </div>
          )}

          {/* Sub-tabs */}
          <div className="p-3 border-b border-slate-100">
            <div className="flex gap-1">
              {([
                { key: 'sales',    label: `Sales (${todaySales.length})` },
                { key: 'expenses', label: `Expenses (${todayExpenses.length})` },
                { key: 'debtors',  label: `Debtors (${todayDebtors.length})` },
              ] as const).map(t => (
                <button key={t.key} onClick={() => setRightTab(t.key)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    rightTab === t.key ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3">

            {/* SALES LIST */}
            {rightTab === 'sales' && (
              todaySales.length === 0 ? (
                <div className="text-center py-8">
                  <ShoppingCart className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm">No sales recorded today</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[550px] overflow-y-auto pr-0.5">
                  {todaySales.map(s => {
                    const locked   = !isToday(s.saleDate);
                    const editable = canEditOrDelete(s);
                    const items    = safeItems(s.items);
                    return (
                      <div key={s._id || s.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-slate-800 text-sm">{fmt(s.totalAmount)}</span>
                          <div className="flex items-center gap-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${PM_COLORS[s.paymentMethod] ?? 'bg-slate-100 text-slate-600'}`}>
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
                          <p className="text-xs text-red-500 font-semibold mb-1">Owes: {fmt(s.balanceDue)}</p>
                        )}
                        {s.customerName && (
                          <p className="text-xs text-slate-600 mb-0.5 font-medium">
                            {s.customerName}{s.customerPhone ? ` · ${s.customerPhone}` : ''}
                          </p>
                        )}
                        {items.length > 0 && (
                          <p className="text-xs text-slate-400 mb-1 truncate">
                            {items.map((it: any) =>
                              `${it.productName || it.product_name || it.product_id} ×${it.quantity}`
                            ).join(', ')}
                          </p>
                        )}
                        <p className="text-xs text-slate-400 mb-2">By: {s.staffName}</p>
                        {editable && (
                          <div className="flex gap-1.5">
                            <button onClick={() => openEditSale(s)}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg font-semibold transition-colors">
                              <Pencil className="w-3 h-3" />Edit
                            </button>
                            <button onClick={() => handleDeleteSale(s._id || s.id)}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-semibold transition-colors">
                              <Trash2 className="w-3 h-3" />Delete
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="pt-2 border-t border-slate-100 flex justify-between text-sm font-semibold">
                    <span className="text-slate-500">Total</span>
                    <span className="text-amber-600">{fmt(totalTodaySales)}</span>
                  </div>
                </div>
              )
            )}

            {/* EXPENSES LIST */}
            {rightTab === 'expenses' && (
              todayExpenses.length === 0 ? (
                <div className="text-center py-8">
                  <Receipt className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm">No expenses recorded today</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[550px] overflow-y-auto pr-0.5">
                  {todayExpenses.map((e, i) => (
                    <div key={(e as any)._id || i} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{e.description}</p>
                          <p className="text-xs text-slate-400 mt-0.5 capitalize">{e.category}</p>
                          {e.recordedByName && <p className="text-xs text-slate-400">By: {e.recordedByName}</p>}
                        </div>
                        <span className="text-sm font-bold text-red-600 flex-shrink-0">{fmt(Number(e.amount))}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => openEditExpense(e)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg font-semibold transition-colors">
                          <Pencil className="w-3 h-3" />Edit
                        </button>
                        <button onClick={() => handleDeleteExpense(e)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-semibold transition-colors">
                          <Trash2 className="w-3 h-3" />Delete
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-slate-100 flex justify-between text-sm font-semibold">
                    <span className="text-slate-500">Total Expenses</span>
                    <span className="text-red-600">{fmt(totalTodayExpenses)}</span>
                  </div>
                </div>
              )
            )}

            {/* DEBTORS LIST */}
            {rightTab === 'debtors' && (
              todayDebtors.length === 0 ? (
                <div className="text-center py-8">
                  <UserPlus className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm">No active debtors for this branch</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[550px] overflow-y-auto pr-0.5">
                  {todayDebtors.map((d, i) => (
                    <div key={(d as any)._id || i} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{d.name}</p>
                          <p className="text-xs text-blue-600 font-medium">{d.phone}</p>
                          {d.createdByName && <p className="text-xs text-slate-400">By: {d.createdByName}</p>}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-bold text-red-600">{fmt(Number(d.amountOwed))}</p>
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                            Owes
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => openEditDebtor(d)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg font-semibold transition-colors">
                          <Pencil className="w-3 h-3" />Edit
                        </button>
                        <button onClick={() => handleDeleteDebtor(d)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-semibold transition-colors">
                          <Trash2 className="w-3 h-3" />Delete
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-slate-100 flex justify-between text-sm font-semibold">
                    <span className="text-slate-500">Total Owed</span>
                    <span className="text-red-600">{fmt(totalTodayDebt)}</span>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* ── Daily Report Confirmation Modal ────────────────────────────────────── */}
      {reportConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] sm:max-w-md">
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                  <FileText className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Submit Daily Report</h2>
                  <p className="text-xs text-slate-400">Review today's summary before submitting</p>
                </div>
              </div>
              <button onClick={() => setReportConfirmOpen(false)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Sales Breakdown</p>
              <div className="space-y-2">
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-sm text-slate-600 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Cash Sales
                  </span>
                  <span className="font-semibold text-slate-800">{fmt(reportSummary.cash)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-sm text-slate-600 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />POS Sales
                  </span>
                  <span className="font-semibold text-slate-800">{fmt(reportSummary.pos)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-sm text-slate-600 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />Part Payment
                  </span>
                  <span className="font-semibold text-slate-800">{fmt(reportSummary.part)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-sm text-slate-600 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Unpaid Sales
                  </span>
                  <span className="font-semibold text-slate-800">{fmt(reportSummary.unpaid)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-sm text-slate-600 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />Total Expenses
                  </span>
                  <span className="font-semibold text-red-600">− {fmt(reportSummary.expenses)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-sm text-slate-600">Active Debtors</span>
                  <span className="font-semibold text-slate-800">
                    {reportSummary.debtors} · {fmt(reportSummary.debtAmt)}
                  </span>
                </div>
              </div>

              <div className="mt-2 p-4 bg-amber-50 border border-amber-200 rounded-xl flex justify-between items-center">
                <span className="font-bold text-amber-800">Net Income</span>
                <span className={`text-xl font-extrabold ${reportSummary.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fmt(reportSummary.net)}
                </span>
              </div>

              <p className="text-xs text-slate-400 text-center">
                Submitting will lock today's sales and send this report for admin review.
              </p>
            </div>

            <div className="flex gap-3 p-4 sm:p-6 border-t border-slate-100">
              <button onClick={() => setReportConfirmOpen(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSubmitDailyReport}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-sm">
                <Send className="w-4 h-4" />Confirm & Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Sale Modal ──────────────────────────────────────────────────── */}
      {editSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Edit Sale</h2>
                <p className="text-xs text-slate-400 mt-0.5">Changes will sync linked debtor balances automatically.</p>
              </div>
              <button onClick={() => setEditSale(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 sm:p-6 space-y-5">
              {editSale.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{editSale.error}</div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Payment Method</label>
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
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                    Customer Name {eHasDebt && <span className="text-red-500">*</span>}
                  </label>
                  <input type="text" value={editSale.customerName}
                    onChange={e => setEditSale({ ...editSale, customerName: e.target.value })}
                    placeholder={eHasDebt ? 'Required' : 'Optional'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                    Customer Phone {eHasDebt && <span className="text-red-500">*</span>}
                  </label>
                  <input type="tel" value={editSale.customerPhone}
                    onChange={e => setEditSale({ ...editSale, customerPhone: e.target.value })}
                    placeholder={eHasDebt ? 'Required' : 'Optional'}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
              </div>

              {/* Edit: Products */}
              <div className="border-t border-slate-100 pt-4">
                <h4 className="font-semibold text-slate-700 mb-3 text-sm uppercase tracking-wide flex items-center gap-2">
                  <ShoppingCart className="w-3.5 h-3.5 text-amber-500" />Products
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
                  <div className="sm:col-span-2">
                    <select value={editSale.addProduct}
                      onChange={e => {
                        const p = products.find(p => p._id === e.target.value);
                        setEditSale({ ...editSale, addProduct: e.target.value, addPrice: p?.unitPrice ?? 0 });
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50">
                      <option value="">Select product…</option>
                      {products.map(p => {
                        const stock = getStock(p._id);
                        return (
                          <option key={p._id} value={p._id} disabled={stock === 0}>
                            {p.name} {stock === 0 ? '(OUT)' : `· ${stock} left`}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <input type="number" min="0.01" step="0.01" value={editSale.addQty}
                    onChange={e => setEditSale({ ...editSale, addQty: Number(e.target.value) })}
                    className="px-3 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" placeholder="Qty" />
                  <div className="flex gap-2">
                    <input type="number" min="0" step="0.01" value={editSale.addPrice}
                      onChange={e => setEditSale({ ...editSale, addPrice: Number(e.target.value) })}
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" placeholder="Price" />
                    <button type="button" onClick={addToEditCart} disabled={!editSale.addProduct}
                      className="px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white rounded-xl text-sm font-semibold transition-colors">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  {editSale.cart.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 py-2.5 px-3 bg-slate-50 rounded-xl">
                      <div className="flex-1 font-medium text-slate-800 text-sm truncate">{item.product.name}</div>
                      <input type="number" min="0.01" step="0.01" value={item.quantity}
                        onChange={e => setEditSale({
                          ...editSale,
                          cart: editSale.cart.map((c, i) => i === idx ? { ...c, quantity: Number(e.target.value) } : c),
                        })}
                        className="w-16 px-2 py-1 border border-slate-200 rounded-lg text-sm text-right text-slate-800 bg-white" />
                      <input type="number" min="0" step="0.01" value={item.unitPrice}
                        onChange={e => setEditSale({
                          ...editSale,
                          cart: editSale.cart.map((c, i) => i === idx ? { ...c, unitPrice: Number(e.target.value) } : c),
                        })}
                        className="w-24 px-2 py-1 border border-slate-200 rounded-lg text-sm text-right text-slate-800 bg-white" />
                      <span className="font-bold text-slate-700 text-sm w-24 text-right">
                        {fmt(item.quantity * item.unitPrice)}
                      </span>
                      <button type="button"
                        onClick={() => setEditSale({ ...editSale, cart: editSale.cart.filter((_, i) => i !== idx) })}
                        className="text-slate-300 hover:text-red-500 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {editSale.cart.length === 0 && editSale.serviceCart.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-3">No items. Add a product or service.</p>
                  )}
                </div>
              </div>

              {/* Edit: Services */}
              <div className="border-t border-slate-100 pt-4">
                <h4 className="font-semibold text-slate-700 mb-3 text-sm uppercase tracking-wide flex items-center gap-2">
                  <Wrench className="w-3.5 h-3.5 text-purple-500" />Services
                </h4>

                <div className="flex flex-wrap gap-2 mb-3">
                  {SERVICE_SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setEditSale({ ...editSale, addService: editSale.addService === s ? '' : s })}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                        editSale.addService === s
                          ? 'bg-purple-500 text-white border-purple-500'
                          : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-2">
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      value={editSale.addService}
                      onChange={e => setEditSale({ ...editSale, addService: e.target.value })}
                      placeholder="Or type a custom service name…"
                      className="w-full px-3 py-2 border border-purple-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-purple-50/30"
                    />
                  </div>
                  <input type="number" min="1" step="1" value={editSale.addServiceQty}
                    onChange={e => setEditSale({ ...editSale, addServiceQty: Number(e.target.value) })}
                    className="px-3 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-slate-50" placeholder="Qty" />
                  <div className="flex gap-2">
                    <input type="number" min="0" step="0.01" value={editSale.addServicePrice}
                      onChange={e => setEditSale({ ...editSale, addServicePrice: Number(e.target.value) })}
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-slate-50" placeholder="Price" />
                    <button type="button"
                      disabled={!editSale.addService.trim()}
                      onClick={() => {
                        if (!editSale.addService.trim()) return;
                        setEditSale({
                          ...editSale,
                          serviceCart: [...editSale.serviceCart, {
                            serviceName: editSale.addService.trim(),
                            serviceNotes: editSale.addServiceNotes.trim(),
                            quantity: editSale.addServiceQty,
                            unitPrice: editSale.addServicePrice,
                          }],
                          addService: '', addServiceNotes: '', addServiceQty: 1, addServicePrice: 0,
                        });
                      }}
                      className="px-3 py-2 bg-purple-500 hover:bg-purple-600 disabled:bg-slate-200 text-white rounded-xl text-sm font-semibold transition-colors">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <textarea
                  value={editSale.addServiceNotes}
                  onChange={e => setEditSale({ ...editSale, addServiceNotes: e.target.value })}
                  rows={2}
                  placeholder="Service notes (optional)"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none bg-slate-50 mb-2"
                />
                <div className="space-y-1">
                  {editSale.serviceCart.map((item, idx) => (
                    <div key={idx} className="py-2.5 px-3 bg-purple-50/60 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Wrench className="w-3 h-3 text-purple-500 flex-shrink-0" />
                            <span className="font-medium text-slate-800 text-sm truncate">{item.serviceName}</span>
                          </div>
                          {item.serviceNotes && (
                            <p className="text-xs text-slate-400 mt-0.5 pl-4 truncate">{item.serviceNotes}</p>
                          )}
                        </div>
                        <input type="number" min="1" step="1" value={item.quantity}
                          onChange={e => setEditSale({
                            ...editSale,
                            serviceCart: editSale.serviceCart.map((s, i) => i === idx ? { ...s, quantity: Number(e.target.value) } : s),
                          })}
                          className="w-16 px-2 py-1 border border-purple-200 rounded-lg text-sm text-right text-slate-800 bg-white" />
                        <input type="number" min="0" step="0.01" value={item.unitPrice}
                          onChange={e => setEditSale({
                            ...editSale,
                            serviceCart: editSale.serviceCart.map((s, i) => i === idx ? { ...s, unitPrice: Number(e.target.value) } : s),
                          })}
                          className="w-24 px-2 py-1 border border-purple-200 rounded-lg text-sm text-right text-slate-800 bg-white" />
                        <span className="font-bold text-purple-700 text-sm w-24 text-right">
                          {fmt(item.quantity * item.unitPrice)}
                        </span>
                        <button type="button"
                          onClick={() => setEditSale({ ...editSale, serviceCart: editSale.serviceCart.filter((_, i) => i !== idx) })}
                          className="text-slate-300 hover:text-red-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {editSale.pm === 'part' && (
                <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl space-y-2">
                  <label className="block text-sm font-semibold text-orange-800">Amount Paid by Customer (₦) *</label>
                  <input type="number" min="0.01" step="0.01" value={editSale.amountPaid || ''}
                    onChange={e => setEditSale({ ...editSale, amountPaid: Number(e.target.value) })}
                    className="w-full px-3 py-2.5 border border-orange-300 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white text-sm" />
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-orange-700">Balance Owed:</span>
                    <span className="font-bold text-red-600">{fmt(Math.max(0, eTotal - editSale.amountPaid))}</span>
                  </div>
                </div>
              )}
              {editSale.pm === 'unpaid' && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex justify-between text-sm">
                  <span className="font-semibold text-red-800">Full Amount Owed:</span>
                  <span className="font-bold text-red-600">{fmt(eTotal)}</span>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Notes (optional)</label>
                <textarea value={editSale.notes} onChange={e => setEditSale({ ...editSale, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none text-sm bg-slate-50" />
              </div>
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
                <span className="font-semibold text-amber-800">New Total</span>
                <span className="text-xl font-extrabold text-amber-600">{fmt(eTotal)}</span>
              </div>
            </div>
            <div className="flex gap-3 p-4 sm:p-6 border-t border-slate-100">
              <button onClick={() => setEditSale(null)} disabled={editSale.loading}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveEdit} disabled={editSale.loading || (editSale.cart.length === 0 && editSale.serviceCart.length === 0)}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-sm">
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] sm:max-w-md">
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Edit Expense</h2>
              <button 
                onClick={() => setEditExpense(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 sm:p-6 space-y-4">
              {editExpense.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                  {editExpense.error}
                </div>
              )}
              
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                  Description *
                </label>
                <input 
                  type="text" 
                  value={editExpense.desc}
                  onChange={e => setEditExpense({ ...editExpense, desc: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" 
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                    Amount (₦) *
                  </label>
                  <input 
                    type="number" 
                    min="0.01" 
                    step="0.01" 
                    value={editExpense.amount}
                    onChange={e => setEditExpense({ ...editExpense, amount: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" 
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                    Category
                  </label>
                  <select 
                    value={editExpense.category}
                    onChange={e => setEditExpense({ ...editExpense, category: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                  >
                    {EXPENSE_CATS.map(c => (
                      <option key={c} value={c}>
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                  Notes (optional)
                </label>
                <textarea 
                  value={editExpense.notes} 
                  onChange={e => setEditExpense({ ...editExpense, notes: e.target.value })} 
                  rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-slate-50" 
                />
              </div>
            </div>
            
            <div className="flex gap-3 p-4 sm:p-6 border-t border-slate-100">
              <button
                onClick={() => setEditExpense(null)} 
                disabled={editExpense.loading}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveEditExpense} 
                disabled={editExpense.loading} 
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                {editExpense.loading && (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Debtor Modal ────────────────────────────────────────────────── */}
      {editDebtor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] sm:max-w-md">
            <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Edit Debtor</h2>
              <button onClick={() => setEditDebtor(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              {editDebtor.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{editDebtor.error}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Name *</label>
                  <input type="text" value={editDebtor.name}
                    onChange={e => setEditDebtor({ ...editDebtor, name: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Phone *</label>
                  <input type="tel" value={editDebtor.phone}
                    onChange={e => setEditDebtor({ ...editDebtor, phone: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Amount Owed (₦) *</label>
                <input type="number" min="0.01" step="0.01" value={editDebtor.amount}
                  onChange={e => setEditDebtor({ ...editDebtor, amount: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Notes (optional)</label>
                <textarea value={editDebtor.notes} onChange={e => setEditDebtor({ ...editDebtor, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-slate-50" />
              </div>
            </div>
            <div className="flex gap-3 p-4 sm:p-6 border-t border-slate-100">
              <button onClick={() => setEditDebtor(null)} disabled={editDebtor.loading}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveEditDebtor} disabled={editDebtor.loading}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-sm">
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