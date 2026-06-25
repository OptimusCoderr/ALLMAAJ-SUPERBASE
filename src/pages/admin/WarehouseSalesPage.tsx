import { useEffect, useState, useRef } from 'react';
import { getAuthToken } from '../../lib/api';
import type { Warehouse, WarehouseSale, WarehouseSaleItem, Product } from '../../lib/types';
import {
  ShoppingCart, Printer, FileText, Truck, Trash2, Plus, Minus,
  Search, X, Package, Building2, User, Phone, MapPin, CreditCard,
  DollarSign, ArrowLeftRight, Clock, CheckCircle, ChevronRight,
  RefreshCw, Eye,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StockItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  isCuttable?: boolean;
}

interface CartItem extends WarehouseSaleItem {
  availableQty: number;
}

type PayMethod = 'cash' | 'pos' | 'transfer' | 'credit';
type DocType   = 'invoice' | 'waybill';

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

const PM_LABELS: Record<PayMethod, string> = {
  cash: 'Cash', pos: 'POS', transfer: 'Transfer', credit: 'Credit',
};

function pmIcon(m: PayMethod) {
  if (m === 'cash')     return <DollarSign className="w-4 h-4" />;
  if (m === 'pos')      return <CreditCard className="w-4 h-4" />;
  if (m === 'transfer') return <ArrowLeftRight className="w-4 h-4" />;
  return <Clock className="w-4 h-4" />;
}

// ── Invoice/Waybill print component ───────────────────────────────────────────

function InvoiceDoc({ sale, companyName }: { sale: WarehouseSale; companyName: string }) {
  const isWaybill = sale.docType === 'waybill';
  const date = new Date(sale.saleDate).toLocaleDateString('en-NG', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="font-sans text-slate-800 text-sm" style={{ maxWidth: 680, margin: '0 auto' }}>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-slate-800">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">{companyName}</h1>
          <p className="text-slate-500 text-xs mt-0.5">{sale.warehouseName}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-extrabold text-amber-600 uppercase tracking-widest">
            {isWaybill ? 'Waybill' : 'Invoice'}
          </p>
          <p className="text-xs font-mono font-bold text-slate-700 mt-1">#{sale.invoiceNumber}</p>
          <p className="text-xs text-slate-500 mt-0.5">{date}</p>
        </div>
      </div>

      {/* Bill to / Ship to */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">
            {isWaybill ? 'Ship To' : 'Bill To'}
          </p>
          <p className="font-semibold">{sale.customerName}</p>
          {sale.customerPhone   && <p className="text-slate-600">{sale.customerPhone}</p>}
          {sale.customerAddress && <p className="text-slate-600 text-xs mt-0.5">{sale.customerAddress}</p>}
        </div>
        {isWaybill && (
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Dispatched From</p>
            <p className="font-semibold">{sale.warehouseName}</p>
            <p className="text-slate-600 text-xs mt-0.5">{companyName}</p>
          </div>
        )}
        {!isWaybill && (
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1">Payment</p>
            <p className="font-semibold capitalize">{PM_LABELS[sale.paymentMethod]}</p>
            {sale.balanceDue > 0 && (
              <p className="text-red-600 text-xs font-medium mt-0.5">Balance due: {fmt(sale.balanceDue)}</p>
            )}
          </div>
        )}
      </div>

      {/* Items table */}
      <table className="w-full border-collapse mb-6">
        <thead>
          <tr className="bg-slate-100">
            <th className="text-left p-2 text-xs font-bold uppercase tracking-wider border border-slate-200">Description</th>
            <th className="text-center p-2 text-xs font-bold uppercase tracking-wider border border-slate-200">Qty</th>
            <th className="text-center p-2 text-xs font-bold uppercase tracking-wider border border-slate-200">Unit</th>
            {!isWaybill && <>
              <th className="text-right p-2 text-xs font-bold uppercase tracking-wider border border-slate-200">Unit Price</th>
              <th className="text-right p-2 text-xs font-bold uppercase tracking-wider border border-slate-200">Total</th>
            </>}
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
              <td className="p-2 border border-slate-200 font-medium">{item.productName}</td>
              <td className="p-2 border border-slate-200 text-center">{item.quantity}</td>
              <td className="p-2 border border-slate-200 text-center text-slate-500">{item.unit}</td>
              {!isWaybill && <>
                <td className="p-2 border border-slate-200 text-right">{fmt(item.unitPrice)}</td>
                <td className="p-2 border border-slate-200 text-right font-semibold">{fmt(item.subtotal)}</td>
              </>}
            </tr>
          ))}
        </tbody>
        {!isWaybill && (
          <tfoot>
            <tr className="bg-slate-100 font-bold">
              <td colSpan={3} className="p-2 border border-slate-200 text-right uppercase text-xs tracking-wider">Grand Total</td>
              <td colSpan={2} className="p-2 border border-slate-200 text-right text-base">{fmt(sale.totalAmount)}</td>
            </tr>
            {sale.amountPaid > 0 && sale.amountPaid < sale.totalAmount && (
              <tr>
                <td colSpan={3} className="p-2 border border-slate-200 text-right text-xs text-slate-500">Amount Paid</td>
                <td colSpan={2} className="p-2 border border-slate-200 text-right text-green-700">{fmt(sale.amountPaid)}</td>
              </tr>
            )}
            {sale.balanceDue > 0 && (
              <tr className="text-red-700">
                <td colSpan={3} className="p-2 border border-slate-200 text-right text-xs font-bold">Balance Due</td>
                <td colSpan={2} className="p-2 border border-slate-200 text-right font-bold">{fmt(sale.balanceDue)}</td>
              </tr>
            )}
          </tfoot>
        )}
      </table>

      {sale.notes && (
        <div className="mb-6 p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600">
          <span className="font-semibold">Notes: </span>{sale.notes}
        </div>
      )}

      {/* Signatures */}
      <div className="grid grid-cols-2 gap-8 mt-8 pt-4 border-t border-slate-200">
        <div>
          <div className="border-b border-slate-400 mb-1 pb-6" />
          <p className="text-xs text-slate-500">Prepared by</p>
          <p className="text-xs font-medium mt-0.5">{sale.createdByName}</p>
        </div>
        <div>
          <div className="border-b border-slate-400 mb-1 pb-6" />
          <p className="text-xs text-slate-500">
            {isWaybill ? "Received by (Customer's signature)" : "Customer's signature"}
          </p>
        </div>
      </div>

      <p className="text-center text-xs text-slate-400 mt-6">
        Thank you for your business. · {companyName}
      </p>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WarehouseSalesPage() {
  const toast   = useToast();
  const { user } = useAuth();

  // ── Warehouse list
  const [warehouses, setWarehouses]     = useState<Warehouse[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [warehouseStock, setWarehouseStock]       = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading]           = useState(false);

  // ── Cart
  const [cart, setCart]       = useState<CartItem[]>([]);
  const [productSearch, setProductSearch] = useState('');

  // ── Customer / sale form
  const [customerName, setCustomerName]       = useState('');
  const [customerPhone, setCustomerPhone]     = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [payMethod, setPayMethod]             = useState<PayMethod>('cash');
  const [amountPaid, setAmountPaid]           = useState<number>(0);
  const [docType, setDocType]                 = useState<DocType>('invoice');
  const [notes, setNotes]                     = useState('');
  const [saleDate, setSaleDate]               = useState(new Date().toISOString().split('T')[0]);

  // ── Submission
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError]   = useState('');

  // ── History tab
  const [tab, setTab]               = useState<'new' | 'history'>('new');
  const [history, setHistory]       = useState<WarehouseSale[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyWarehouse, setHistoryWarehouse] = useState('');

  // ── Invoice viewer
  const [viewSale, setViewSale] = useState<WarehouseSale | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const total    = cart.reduce((s, i) => s + i.subtotal, 0);
  const balance  = total - (payMethod === 'credit' ? amountPaid : total);
  const isPart   = payMethod === 'credit' && amountPaid < total;

  const companyName = 'ALLMAAJ INVENTORY';

  // ── Load warehouses ─────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${BASE}/api/warehouses`, { headers: { Authorization: `Bearer ${getAuthToken()}` } })
      .then(r => r.json()).then(j => setWarehouses(j.data ?? [])).catch(() => {});
  }, []);

  // ── Load warehouse stock ────────────────────────────────────────────────────

  async function loadStock(warehouseId: string) {
    if (!warehouseId) { setWarehouseStock([]); return; }
    setStockLoading(true);
    try {
      const res  = await fetch(`${BASE}/api/warehouses/${warehouseId}/stock`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      const json = await res.json();
      const rows = (json.data ?? []) as any[];
      setWarehouseStock(rows.map(r => ({
        productId:   r.product_id   ?? r.productId,
        productName: r.product?.name ?? r.productName ?? 'Unknown',
        quantity:    parseFloat(r.quantity),
        unitPrice:   parseFloat(r.product?.unit_price ?? r.unitPrice ?? 0),
        unit:        r.product?.unit ?? 'pcs',
        isCuttable:  r.product?.is_cuttable ?? false,
      })));
    } catch {
      setWarehouseStock([]);
    }
    setStockLoading(false);
  }

  useEffect(() => {
    setCart([]);
    loadStock(selectedWarehouse);
  }, [selectedWarehouse]);

  // ── Cart operations ─────────────────────────────────────────────────────────

  function addToCart(item: StockItem) {
    const existing = cart.find(c => c.productId === item.productId);
    if (existing) {
      const newQty = existing.quantity + 1;
      if (newQty > item.quantity) { toast.error(`Only ${item.quantity} units available`); return; }
      setCart(prev => prev.map(c => c.productId === item.productId
        ? { ...c, quantity: newQty, subtotal: newQty * c.unitPrice }
        : c));
    } else {
      if (item.quantity < 1) { toast.error('No stock available'); return; }
      setCart(prev => [...prev, {
        productId: item.productId, productName: item.productName,
        quantity: 1, unitPrice: item.unitPrice, subtotal: item.unitPrice,
        unit: item.unit, availableQty: item.quantity,
      }]);
    }
    setProductSearch('');
  }

  function updateCartQty(productId: string, qty: number) {
    const item = cart.find(c => c.productId === productId);
    if (!item) return;
    if (qty <= 0) { removeFromCart(productId); return; }
    if (qty > item.availableQty) { toast.error(`Only ${item.availableQty} available`); return; }
    setCart(prev => prev.map(c => c.productId === productId
      ? { ...c, quantity: qty, subtotal: qty * c.unitPrice }
      : c));
  }

  function updateCartPrice(productId: string, price: number) {
    setCart(prev => prev.map(c => c.productId === productId
      ? { ...c, unitPrice: price, subtotal: c.quantity * price }
      : c));
  }

  function removeFromCart(productId: string) {
    setCart(prev => prev.filter(c => c.productId !== productId));
  }

  // ── Submit sale ─────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setFormError('');
    if (!selectedWarehouse)      { setFormError('Select a warehouse'); return; }
    if (!customerName.trim())    { setFormError('Customer name is required'); return; }
    if (cart.length === 0)       { setFormError('Add at least one item to the cart'); return; }
    if (total <= 0)              { setFormError('Total must be greater than zero'); return; }
    if (payMethod === 'credit' && amountPaid > total)
      { setFormError('Amount paid cannot exceed total'); return; }

    setSubmitting(true);
    try {
      const res  = await fetch(`${BASE}/api/warehouse-sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({
          warehouseId: selectedWarehouse,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || null,
          customerAddress: customerAddress.trim() || null,
          paymentMethod: payMethod,
          amountPaid: payMethod === 'credit' ? amountPaid : total,
          docType,
          notes: notes.trim() || null,
          saleDate,
          items: cart.map(c => ({
            productId: c.productId, productName: c.productName,
            quantity: c.quantity, unitPrice: c.unitPrice,
            subtotal: c.subtotal, unit: c.unit,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);

      const created: WarehouseSale = json.data;
      toast.success(`${docType === 'waybill' ? 'Waybill' : 'Invoice'} #${created.invoiceNumber} created`);

      // Reset form
      setCart([]);
      setCustomerName(''); setCustomerPhone(''); setCustomerAddress('');
      setNotes(''); setAmountPaid(0); setPayMethod('cash');
      setSaleDate(new Date().toISOString().split('T')[0]);
      loadStock(selectedWarehouse);

      // Show the invoice immediately
      setViewSale(created);
    } catch (err: any) {
      setFormError(err.message || 'Failed to create sale');
    }
    setSubmitting(false);
  }

  // ── Load history ────────────────────────────────────────────────────────────

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      if (historyWarehouse) params.set('warehouseId', historyWarehouse);
      const res  = await fetch(`${BASE}/api/warehouse-sales?${params}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      const json = await res.json();
      setHistory(json.data ?? []);
    } catch { setHistory([]); }
    setHistoryLoading(false);
  }

  useEffect(() => { if (tab === 'history') loadHistory(); }, [tab, historyWarehouse]);

  // ── Load single sale with items ─────────────────────────────────────────────

  async function viewSaleDetail(id: string) {
    try {
      const res  = await fetch(`${BASE}/api/warehouse-sales/${id}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      const json = await res.json();
      setViewSale(json.data);
    } catch {
      toast.error('Failed to load sale');
    }
  }

  // ── Print ──────────────────────────────────────────────────────────────────

  function handlePrint() {
    const content = printRef.current?.innerHTML;
    if (!content) return;
    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html><html><head>
      <title>${viewSale?.docType === 'waybill' ? 'Waybill' : 'Invoice'} #${viewSale?.invoiceNumber}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 12px; color: #1e293b; padding: 24px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 6px 8px; border: 1px solid #e2e8f0; }
        thead tr { background: #f1f5f9; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .text-xs { font-size: 10px; }
        .font-bold { font-weight: bold; }
        .font-extrabold { font-weight: 800; }
        .text-amber-600 { color: #d97706; }
        .text-red-600, .text-red-700 { color: #dc2626; }
        .text-green-700 { color: #15803d; }
        .text-slate-400, .text-slate-500 { color: #94a3b8; }
        .text-slate-600 { color: #475569; }
        .border-b-2 { border-bottom: 2px solid #1e293b; padding-bottom: 16px; }
        .border-b { border-bottom: 1px solid #e2e8f0; }
        .border-t { border-top: 1px solid #e2e8f0; }
        .grid { display: grid; }
        .grid-cols-2 { grid-template-columns: 1fr 1fr; }
        .gap-6 { gap: 24px; }
        .gap-8 { gap: 32px; }
        .mb-6 { margin-bottom: 24px; }
        .mb-1 { margin-bottom: 4px; }
        .mt-8 { margin-top: 32px; }
        .mt-6 { margin-top: 24px; }
        .mt-1 { margin-top: 4px; }
        .pt-4 { padding-top: 16px; }
        .pb-6 { padding-bottom: 24px; }
        .p-2 { padding: 8px; }
        .p-3 { padding: 12px; }
        .flex { display: flex; }
        .items-start { align-items: flex-start; }
        .justify-between { justify-content: space-between; }
        .tracking-widest { letter-spacing: 0.1em; }
        .tracking-wider { letter-spacing: 0.05em; }
        .uppercase { text-transform: uppercase; }
        .capitalize { text-transform: capitalize; }
        .rounded { border-radius: 4px; }
        .text-center { text-align: center; }
        .text-2xl { font-size: 20px; }
        .text-xl { font-size: 18px; }
        .text-base { font-size: 14px; }
        .text-sm { font-size: 12px; }
        @media print { body { padding: 0; } }
      </style>
      </head><body>${content}</body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 300);
  }

  // ── Filtered stock for product picker ──────────────────────────────────────

  const filteredStock = warehouseStock.filter(s =>
    s.quantity > 0 &&
    (!productSearch || s.productName.toLowerCase().includes(productSearch.toLowerCase()))
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Warehouse Sales</h1>
          <p className="text-slate-400 text-sm mt-0.5">Sell directly from warehouse stock and generate invoices/waybills</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(['new', 'history'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
              tab === t
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-amber-300 hover:text-amber-600'
            }`}>
            {t === 'new' ? <><ShoppingCart className="w-4 h-4" />New Sale</> : <><FileText className="w-4 h-4" />History</>}
          </button>
        ))}
      </div>

      {/* ══ NEW SALE TAB ══ */}
      {tab === 'new' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

          {/* ── Left: Form ── */}
          <div className="lg:col-span-3 space-y-4">

            {/* Warehouse selector */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
                <Building2 className="w-3.5 h-3.5 inline mr-1" />Warehouse *
              </label>
              <select
                value={selectedWarehouse}
                onChange={e => setSelectedWarehouse(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
              >
                <option value="">— Select warehouse —</option>
                {warehouses.map(w => <option key={w._id} value={w._id}>{w.name}</option>)}
              </select>
            </div>

            {/* Customer info */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide flex items-center gap-1">
                <User className="w-3.5 h-3.5" />Customer Details
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Name *</label>
                  <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)}
                    placeholder="Customer name"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Phone</label>
                  <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                    placeholder="08012345678"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-slate-500 mb-1">Delivery Address</label>
                  <input type="text" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)}
                    placeholder="Delivery address (optional)"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
              </div>
            </div>

            {/* Payment + Doc type */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Payment Method</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['cash','pos','transfer','credit'] as PayMethod[]).map(m => (
                      <button key={m} onClick={() => setPayMethod(m)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                          payMethod === m
                            ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}>
                        {pmIcon(m)}{PM_LABELS[m]}
                      </button>
                    ))}
                  </div>
                  {payMethod === 'credit' && (
                    <div className="mt-2">
                      <label className="block text-xs text-slate-500 mb-1">Amount Paid (₦)</label>
                      <input type="number" min="0" step="0.01" value={amountPaid || ''}
                        onChange={e => setAmountPaid(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                      {isPart && <p className="text-xs text-orange-600 mt-1 font-medium">Balance: {fmt(balance)}</p>}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Document Type</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setDocType('invoice')}
                      className={`flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-semibold border transition-colors ${
                        docType === 'invoice'
                          ? 'bg-blue-500 text-white border-blue-500'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}>
                      <FileText className="w-5 h-5" />Invoice
                    </button>
                    <button onClick={() => setDocType('waybill')}
                      className={`flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-semibold border transition-colors ${
                        docType === 'waybill'
                          ? 'bg-green-600 text-white border-green-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}>
                      <Truck className="w-5 h-5" />Waybill
                    </button>
                  </div>
                  <div className="mt-2">
                    <label className="block text-xs text-slate-500 mb-1">Sale Date</label>
                    <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs text-slate-500 mb-1">Notes (optional)</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Any additional notes..."
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
              </div>
            </div>

            {/* Product picker */}
            {selectedWarehouse && (
              <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide flex items-center gap-1">
                  <Package className="w-3.5 h-3.5" />Add Products
                </p>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input type="text" value={productSearch} onChange={e => setProductSearch(e.target.value)}
                    placeholder="Search products in warehouse..."
                    className="w-full pl-8 pr-4 py-2 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
                {stockLoading ? (
                  <p className="text-xs text-slate-400 text-center py-4">Loading stock…</p>
                ) : filteredStock.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">
                    {warehouseStock.length === 0 ? 'No stock in this warehouse' : 'No matching products'}
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1 pr-0.5">
                    {filteredStock.map(s => {
                      const inCart = cart.find(c => c.productId === s.productId);
                      return (
                        <div key={s.productId}
                          className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-slate-50 transition-colors">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{s.productName}</p>
                            <p className="text-xs text-slate-500">
                              Stock: {s.quantity} {s.unit} · {fmt(s.unitPrice)}/{s.unit}
                            </p>
                          </div>
                          <button onClick={() => addToCart(s)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg text-xs font-semibold transition-colors flex-shrink-0">
                            {inCart ? <><CheckCircle className="w-3.5 h-3.5" />Added</> : <><Plus className="w-3.5 h-3.5" />Add</>}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Right: Cart ── */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 sticky top-4">
              <div className="flex items-center justify-between p-4 border-b border-slate-100">
                <p className="font-bold text-slate-800 flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-amber-500" />Cart
                </p>
                {cart.length > 0 && (
                  <button onClick={() => setCart([])} className="text-xs text-red-500 hover:text-red-700">Clear all</button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No items added yet</p>
                </div>
              ) : (
                <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
                  {cart.map(item => (
                    <div key={item.productId} className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="text-sm font-semibold text-slate-800 flex-1 leading-tight">{item.productName}</p>
                        <button onClick={() => removeFromCart(item.productId!)}
                          className="text-slate-400 hover:text-red-500 flex-shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Qty control */}
                        <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                          <button onClick={() => updateCartQty(item.productId!, item.quantity - 1)}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors">
                            <Minus className="w-3 h-3" />
                          </button>
                          <input type="number" min="0.01" step="0.01" value={item.quantity}
                            onChange={e => updateCartQty(item.productId!, parseFloat(e.target.value) || 0)}
                            className="w-14 text-center text-sm py-1 border-0 focus:outline-none bg-white font-medium" />
                          <button onClick={() => updateCartQty(item.productId!, item.quantity + 1)}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors">
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        {/* Unit price */}
                        <div className="flex-1 relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₦</span>
                          <input type="number" min="0" step="0.01" value={item.unitPrice}
                            onChange={e => updateCartPrice(item.productId!, parseFloat(e.target.value) || 0)}
                            className="w-full pl-5 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white font-medium" />
                        </div>
                        <span className="text-xs font-bold text-amber-700 flex-shrink-0">{fmt(item.subtotal)}</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">Avail: {item.availableQty} {item.unit}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Total + submit */}
              <div className="p-4 border-t border-slate-100 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-slate-600">Total</span>
                  <span className="text-xl font-extrabold text-amber-600">{fmt(total)}</span>
                </div>
                {isPart && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Balance (credit)</span>
                    <span className="text-red-600 font-bold">{fmt(balance)}</span>
                  </div>
                )}
                {formError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{formError}</p>
                )}
                <button onClick={handleSubmit} disabled={submitting || cart.length === 0}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm">
                  {submitting
                    ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : docType === 'waybill' ? <Truck className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                  {submitting ? 'Processing…' : `Create ${docType === 'waybill' ? 'Waybill' : 'Invoice'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ HISTORY TAB ══ */}
      {tab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col sm:flex-row gap-3">
            <select value={historyWarehouse} onChange={e => setHistoryWarehouse(e.target.value)}
              className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
              <option value="">All Warehouses</option>
              {warehouses.map(w => <option key={w._id} value={w._id}>{w.name}</option>)}
            </select>
            <button onClick={loadHistory} disabled={historyLoading}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors">
              <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />Refresh
            </button>
          </div>

          {historyLoading ? (
            <div className="text-center py-12 text-slate-400">Loading…</div>
          ) : history.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>No warehouse sales yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map(s => (
                <div key={s._id} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-slate-700 text-sm">#{s.invoiceNumber}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        s.docType === 'waybill' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {s.docType === 'waybill' ? 'Waybill' : 'Invoice'}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        s.paymentMethod === 'credit' ? 'bg-orange-100 text-orange-700'
                        : s.paymentMethod === 'pos' ? 'bg-blue-100 text-blue-700'
                        : s.paymentMethod === 'transfer' ? 'bg-purple-100 text-purple-700'
                        : 'bg-green-100 text-green-700'
                      }`}>
                        {PM_LABELS[s.paymentMethod]}
                      </span>
                    </div>
                    <p className="font-semibold text-slate-800 mt-0.5">{s.customerName}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(s.saleDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {s.warehouseName && ` · ${s.warehouseName}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-lg text-slate-800">{fmt(s.totalAmount)}</p>
                    {s.balanceDue > 0 && (
                      <p className="text-xs text-red-500 font-medium">Owes {fmt(s.balanceDue)}</p>
                    )}
                    <button onClick={() => viewSaleDetail(s._id)}
                      className="mt-1 flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium ml-auto">
                      <Eye className="w-3.5 h-3.5" />View
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ Invoice/Waybill Viewer Modal ══ */}
      {viewSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                {viewSale.docType === 'waybill'
                  ? <Truck className="w-5 h-5 text-green-600" />
                  : <FileText className="w-5 h-5 text-blue-600" />}
                <div>
                  <p className="font-bold text-slate-800">
                    {viewSale.docType === 'waybill' ? 'Waybill' : 'Invoice'} #{viewSale.invoiceNumber}
                  </p>
                  <p className="text-xs text-slate-400">{viewSale.customerName}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handlePrint}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold transition-colors shadow-sm">
                  <Printer className="w-4 h-4" />Print
                </button>
                <button onClick={() => setViewSale(null)}
                  className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-6 flex-1">
              <div ref={printRef}>
                <InvoiceDoc sale={viewSale} companyName={companyName} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
