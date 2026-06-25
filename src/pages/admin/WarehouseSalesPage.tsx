import { useEffect, useState, useRef, useCallback } from 'react';
import { getAuthToken } from '../../lib/api';
import type { Warehouse, WarehouseSale, WarehouseSaleItem } from '../../lib/types';
import {
  ShoppingCart, Printer, FileText, Truck, Trash2, Plus, Minus,
  Search, X, Package, Building2, User, Phone, MapPin, CreditCard,
  DollarSign, ArrowLeftRight, Clock, CheckCircle, ChevronDown,
  RefreshCw, Eye, Upload, Settings, ExternalLink, Edit2,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

const SETTINGS_KEY = 'allmaaj_invoice_settings';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StockItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  unit: string;
  warehouseId: string;
  warehouseName: string;
}

interface CartItem {
  key: string;           // unique key per line
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  unit: string;
  availableQty: number;
  sourceWarehouseId: string | null;
  sourceWarehouseName: string | null;
  isExternal: boolean;
  externalSource: string;
}

interface CompanySettings {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  logoDataUrl: string;
  signatureDataUrl: string;
}

type PayMethod = 'cash' | 'pos' | 'transfer' | 'credit';
type DocType   = 'invoice' | 'waybill';

const DEFAULT_SETTINGS: CompanySettings = {
  name: 'Allmaaj & Co. Nig. Ltd.',
  tagline: 'Quality Products & Services',
  address: '',
  phone: '',
  email: '',
  logoDataUrl: '',
  signatureDataUrl: '',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

const PM_LABELS: Record<PayMethod, string> = {
  cash: 'Cash', pos: 'POS', transfer: 'Transfer', credit: 'Credit',
};

function loadSettings(): CompanySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
}

function saveSettings(s: CompanySettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Invoice Print/PDF Component ────────────────────────────────────────────────

function InvoiceDocument({ sale, settings }: { sale: WarehouseSale; settings: CompanySettings }) {
  const isWaybill = sale.docType === 'waybill';
  const date = new Date((sale.saleDate ?? '').split('T')[0] + 'T12:00:00').toLocaleDateString('en-NG', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div
      id="invoice-doc"
      style={{
        fontFamily: 'Arial, sans-serif',
        fontSize: 13,
        color: '#1e293b',
        background: '#fff',
        padding: 32,
        width: 680,
        boxSizing: 'border-box',
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, paddingBottom: 16, borderBottom: '3px solid #d97706' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {settings.logoDataUrl && (
            <img
              src={settings.logoDataUrl}
              alt="logo"
              style={{ width: 64, height: 64, objectFit: 'contain', borderRadius: 8, border: '1px solid #e2e8f0' }}
            />
          )}
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#1e293b', letterSpacing: -0.5 }}>
              {settings.name}
            </div>
            {settings.tagline && (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{settings.tagline}</div>
            )}
            {settings.address && (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{settings.address}</div>
            )}
            {(settings.phone || settings.email) && (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                {[settings.phone, settings.email].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#d97706', letterSpacing: 2, textTransform: 'uppercase' }}>
            {isWaybill ? 'Waybill' : 'Invoice'}
          </div>
          <div style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#475569', marginTop: 4 }}>
            #{sale.invoiceNumber}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{date}</div>
          {sale.warehouseName && (
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>From: {sale.warehouseName}</div>
          )}
        </div>
      </div>

      {/* ── Bill To / Ship To ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px', borderLeft: '3px solid #d97706' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 6 }}>
            {isWaybill ? 'Deliver To' : 'Bill To'}
          </div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{sale.customerName}</div>
          {sale.customerPhone   && <div style={{ color: '#475569', fontSize: 12, marginTop: 3 }}>{sale.customerPhone}</div>}
          {sale.customerAddress && <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>{sale.customerAddress}</div>}
        </div>
        <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px' }}>
          {isWaybill ? (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 6 }}>
                Dispatched From
              </div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{sale.warehouseName || settings.name}</div>
              <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>{settings.address}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 6 }}>
                Payment Info
              </div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{PM_LABELS[sale.paymentMethod]}</div>
              {sale.balanceDue > 0.01 && (
                <div style={{ color: '#dc2626', fontSize: 12, fontWeight: 600, marginTop: 4 }}>
                  Balance due: {fmt(sale.balanceDue)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Items Table ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
        <thead>
          <tr style={{ background: '#1e293b', color: '#fff' }}>
            <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 0.8 }}>DESCRIPTION</th>
            <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, width: 60 }}>QTY</th>
            <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11, fontWeight: 700, width: 60 }}>UNIT</th>
            {!isWaybill && (
              <>
                <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, width: 110 }}>UNIT PRICE</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, width: 110 }}>TOTAL</th>
              </>
            )}
            {isWaybill && (
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700 }}>SOURCE</th>
            )}
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
              <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 500, borderBottom: '1px solid #e2e8f0' }}>
                {item.productName}
                {item.isExternal && (
                  <span style={{ marginLeft: 6, fontSize: 10, background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>
                    EXT
                  </span>
                )}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: 12, borderBottom: '1px solid #e2e8f0' }}>{item.quantity}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>{item.unit}</td>
              {!isWaybill && (
                <>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, borderBottom: '1px solid #e2e8f0' }}>{fmt(item.unitPrice)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>{fmt(item.subtotal)}</td>
                </>
              )}
              {isWaybill && (
                <td style={{ padding: '8px 10px', fontSize: 11, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                  {item.isExternal ? (item.externalSource || 'External') : (item.sourceWarehouseName || 'Warehouse')}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {!isWaybill && (
          <tfoot>
            <tr style={{ background: '#f1f5f9' }}>
              <td colSpan={3} style={{ padding: '10px', textAlign: 'right', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#475569', textTransform: 'uppercase' }}>Grand Total</td>
              <td colSpan={2} style={{ padding: '10px', textAlign: 'right', fontSize: 16, fontWeight: 800, color: '#d97706' }}>{fmt(sale.totalAmount)}</td>
            </tr>
            {sale.amountPaid > 0 && sale.amountPaid < sale.totalAmount && (
              <tr>
                <td colSpan={3} style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, color: '#64748b' }}>Amount Paid</td>
                <td colSpan={2} style={{ padding: '6px 10px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#16a34a' }}>{fmt(sale.amountPaid)}</td>
              </tr>
            )}
            {sale.balanceDue > 0.01 && (
              <tr>
                <td colSpan={3} style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#dc2626' }}>Balance Due</td>
                <td colSpan={2} style={{ padding: '6px 10px', textAlign: 'right', fontSize: 13, fontWeight: 800, color: '#dc2626' }}>{fmt(sale.balanceDue)}</td>
              </tr>
            )}
          </tfoot>
        )}
      </table>

      {sale.notes && (
        <div style={{ marginBottom: 20, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 11, color: '#78350f' }}>
          <strong>Notes:</strong> {sale.notes}
        </div>
      )}

      {/* ── Signatures ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, marginTop: 32, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
        <div>
          {settings.signatureDataUrl ? (
            <img
              src={settings.signatureDataUrl}
              alt="Authorized signature"
              style={{ height: 56, objectFit: 'contain', display: 'block', marginBottom: 4 }}
            />
          ) : (
            <div style={{ height: 56, borderBottom: '1.5px solid #94a3b8' }} />
          )}
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Authorized Signature</div>
          <div style={{ fontSize: 11, fontWeight: 600, marginTop: 1 }}>{sale.createdByName}</div>
        </div>
        <div>
          <div style={{ height: 56, borderBottom: '1.5px solid #94a3b8' }} />
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
            {isWaybill ? "Receiver's Signature" : "Customer's Signature"}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{sale.customerName}</div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ marginTop: 24, paddingTop: 12, borderTop: '1px solid #e2e8f0', textAlign: 'center', fontSize: 10, color: '#94a3b8' }}>
        Thank you for your business — {settings.name}
        {settings.phone && ` · ${settings.phone}`}
        {settings.email && ` · ${settings.email}`}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WarehouseSalesPage() {
  const toast = useToast();

  // ── Settings
  const [settings, setSettings]         = useState<CompanySettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<CompanySettings>(loadSettings);

  // ── Warehouses & stock
  const [warehouses, setWarehouses]                   = useState<Warehouse[]>([]);
  const [allStock, setAllStock]                       = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading]               = useState(false);
  const [pickerWarehouse, setPickerWarehouse]         = useState('');   // which warehouse tab in picker
  const [primaryWarehouse, setPrimaryWarehouse]       = useState('');   // invoice "issued from"

  // ── Cart
  const [cart, setCart]           = useState<CartItem[]>([]);
  const [productSearch, setProductSearch] = useState('');

  // ── External item form
  const [showExtForm, setShowExtForm]   = useState(false);
  const [extName, setExtName]           = useState('');
  const [extSource, setExtSource]       = useState('');
  const [extQty, setExtQty]             = useState<number>(1);
  const [extPrice, setExtPrice]         = useState<number>(0);
  const [extUnit, setExtUnit]           = useState('pcs');

  // ── Sale form
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

  // ── History
  const [tab, setTab]                         = useState<'new' | 'history'>('new');
  const [history, setHistory]                 = useState<WarehouseSale[]>([]);
  const [historyLoading, setHistoryLoading]   = useState(false);
  const [historyWarehouse, setHistoryWarehouse] = useState('');

  // ── Invoice viewer
  const [viewSale, setViewSale] = useState<WarehouseSale | null>(null);
  const invoiceRef = useRef<HTMLDivElement>(null);

  // ── Edit modal
  const [editSale, setEditSale]           = useState<WarehouseSale | null>(null);
  const [editCart, setEditCart]           = useState<CartItem[]>([]);
  const [editCustomerName, setEditCustomerName]     = useState('');
  const [editCustomerPhone, setEditCustomerPhone]   = useState('');
  const [editCustomerAddress, setEditCustomerAddress] = useState('');
  const [editPayMethod, setEditPayMethod]           = useState<PayMethod>('cash');
  const [editAmountPaid, setEditAmountPaid]         = useState(0);
  const [editDocType, setEditDocType]               = useState<DocType>('invoice');
  const [editNotes, setEditNotes]                   = useState('');
  const [editSaleDate, setEditSaleDate]             = useState('');
  const [editError, setEditError]                   = useState('');
  const [editSubmitting, setEditSubmitting]         = useState(false);
  const [editShowExtForm, setEditShowExtForm]       = useState(false);
  const [editExtName, setEditExtName]               = useState('');
  const [editExtSource, setEditExtSource]           = useState('');
  const [editExtQty, setEditExtQty]                 = useState(1);
  const [editExtPrice, setEditExtPrice]             = useState(0);
  const [editExtUnit, setEditExtUnit]               = useState('pcs');

  const total   = cart.reduce((s, i) => s + i.subtotal, 0);
  const balance = payMethod === 'credit' ? Math.max(0, total - amountPaid) : 0;

  // ── Load warehouses ─────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`${BASE}/api/warehouses`, { headers: { Authorization: `Bearer ${getAuthToken()}` } })
      .then(r => r.json())
      .then(j => setWarehouses(j.data ?? []))
      .catch(() => {});
  }, []);

  // ── Load stock from all warehouses ──────────────────────────────────────────

  const loadAllStock = useCallback(async () => {
    if (warehouses.length === 0) return;
    setStockLoading(true);
    try {
      const results = await Promise.all(
        warehouses.map(w =>
          fetch(`${BASE}/api/warehouses/${w._id}/stock`, { headers: { Authorization: `Bearer ${getAuthToken()}` } })
            .then(r => r.json())
            .then((j: any) => ({ warehouseId: w._id, warehouseName: w.name, rows: j.data ?? [] }))
            .catch(() => ({ warehouseId: w._id, warehouseName: w.name, rows: [] }))
        )
      );
      const combined: StockItem[] = [];
      for (const { warehouseId, warehouseName, rows } of results) {
        for (const r of rows) {
          if (parseFloat(r.quantity) > 0) {
            combined.push({
              productId:     r.product_id   ?? r.productId,
              productName:   r.product?.name ?? r.productName ?? 'Unknown',
              quantity:      parseFloat(r.quantity),
              unitPrice:     parseFloat(r.product?.unit_price ?? r.unitPrice ?? 0),
              unit:          r.product?.unit ?? 'pcs',
              warehouseId,
              warehouseName,
            });
          }
        }
      }
      setAllStock(combined);
    } catch { setAllStock([]); }
    setStockLoading(false);
  }, [warehouses]);

  useEffect(() => { loadAllStock(); }, [loadAllStock]);

  // ── Filtered stock for picker ───────────────────────────────────────────────

  const filteredStock = allStock.filter(s => {
    const matchWh = !pickerWarehouse || s.warehouseId === pickerWarehouse;
    const matchQ  = !productSearch || s.productName.toLowerCase().includes(productSearch.toLowerCase());
    return matchWh && matchQ;
  });

  // ── Cart operations ─────────────────────────────────────────────────────────

  function addStockItem(item: StockItem) {
    const key = `${item.productId}::${item.warehouseId}`;
    const existing = cart.find(c => c.key === key);
    if (existing) {
      const newQty = existing.quantity + 1;
      if (newQty > item.quantity) { toast.error(`Only ${item.quantity} available`); return; }
      setCart(prev => prev.map(c => c.key === key
        ? { ...c, quantity: newQty, subtotal: Math.round(newQty * c.unitPrice * 100) / 100 }
        : c));
    } else {
      setCart(prev => [...prev, {
        key, productId: item.productId, productName: item.productName,
        quantity: 1, unitPrice: item.unitPrice,
        subtotal: item.unitPrice,
        unit: item.unit, availableQty: item.quantity,
        sourceWarehouseId: item.warehouseId, sourceWarehouseName: item.warehouseName,
        isExternal: false, externalSource: '',
      }]);
    }
    setProductSearch('');
  }

  function addExternalItem() {
    if (!extName.trim() || extQty <= 0 || extPrice <= 0) {
      toast.error('Fill in name, quantity and price'); return;
    }
    const key = `ext::${Date.now()}`;
    setCart(prev => [...prev, {
      key, productId: null, productName: extName.trim(),
      quantity: extQty, unitPrice: extPrice,
      subtotal: Math.round(extQty * extPrice * 100) / 100,
      unit: extUnit, availableQty: Infinity,
      sourceWarehouseId: null, sourceWarehouseName: null,
      isExternal: true, externalSource: extSource.trim(),
    }]);
    setExtName(''); setExtSource(''); setExtQty(1); setExtPrice(0); setExtUnit('pcs');
    setShowExtForm(false);
  }

  function updateCartQty(key: string, qty: number) {
    const item = cart.find(c => c.key === key);
    if (!item) return;
    if (qty <= 0) { removeFromCart(key); return; }
    if (!item.isExternal && qty > item.availableQty) { toast.error(`Only ${item.availableQty} available`); return; }
    const q = Math.max(0.01, qty);
    setCart(prev => prev.map(c => c.key === key
      ? { ...c, quantity: q, subtotal: Math.round(q * c.unitPrice * 100) / 100 }
      : c));
  }

  function updateCartPrice(key: string, price: number) {
    setCart(prev => prev.map(c => c.key === key
      ? { ...c, unitPrice: price, subtotal: Math.round(c.quantity * price * 100) / 100 }
      : c));
  }

  function removeFromCart(key: string) {
    setCart(prev => prev.filter(c => c.key !== key));
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setFormError('');
    if (!customerName.trim())  { setFormError('Customer name is required'); return; }
    if (cart.length === 0)     { setFormError('Add at least one item'); return; }
    if (total <= 0)            { setFormError('Total must be greater than zero'); return; }
    if (payMethod === 'credit' && amountPaid > total + 0.01)
      { setFormError('Amount paid cannot exceed total'); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/warehouse-sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({
          warehouseId: primaryWarehouse || null,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || null,
          customerAddress: customerAddress.trim() || null,
          paymentMethod: payMethod,
          amountPaid: payMethod === 'credit' ? amountPaid : total,
          docType, notes: notes.trim() || null, saleDate,
          items: cart.map(c => ({
            productId:         c.productId,
            productName:       c.productName,
            quantity:          c.quantity,
            unitPrice:         c.unitPrice,
            subtotal:          c.subtotal,
            unit:              c.unit,
            sourceWarehouseId: c.sourceWarehouseId,
            isExternal:        c.isExternal,
            externalSource:    c.externalSource || null,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);

      const created: WarehouseSale = json.data;
      toast.success(`${docType === 'waybill' ? 'Waybill' : 'Invoice'} #${created.invoiceNumber} created`);

      // Reset form
      setCart([]); setCustomerName(''); setCustomerPhone('');
      setCustomerAddress(''); setNotes(''); setAmountPaid(0);
      setPayMethod('cash'); setSaleDate(new Date().toISOString().split('T')[0]);
      loadAllStock();
      setViewSale(created);
    } catch (err: any) {
      setFormError(err.message || 'Failed to create sale');
    }
    setSubmitting(false);
  }

  // ── History ─────────────────────────────────────────────────────────────────

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

  async function viewDetail(id: string) {
    try {
      const res  = await fetch(`${BASE}/api/warehouse-sales/${id}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      const json = await res.json();
      setViewSale(json.data);
    } catch { toast.error('Failed to load sale'); }
  }

  // ── Edit ────────────────────────────────────────────────────────────────────

  function openEdit(sale: WarehouseSale) {
    setEditSale(sale);
    setEditCart(sale.items.map(item => ({
      key: item.id ?? `${item.productId}::${item.sourceWarehouseId}::${Math.random()}`,
      productId: item.productId ?? null,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      unit: item.unit,
      availableQty: Infinity,
      sourceWarehouseId: item.sourceWarehouseId ?? null,
      sourceWarehouseName: (item as any).sourceWarehouseName ?? null,
      isExternal: item.isExternal ?? false,
      externalSource: item.externalSource ?? '',
    })));
    setEditCustomerName(sale.customerName);
    setEditCustomerPhone(sale.customerPhone ?? '');
    setEditCustomerAddress(sale.customerAddress ?? '');
    setEditPayMethod(sale.paymentMethod);
    setEditAmountPaid(sale.amountPaid);
    setEditDocType(sale.docType);
    setEditNotes(sale.notes ?? '');
    setEditSaleDate((sale.saleDate ?? '').split('T')[0]);
    setEditError('');
    setEditShowExtForm(false);
  }

  function updateEditQty(key: string, qty: number) {
    if (qty <= 0) { setEditCart(p => p.filter(c => c.key !== key)); return; }
    setEditCart(p => p.map(c => c.key === key
      ? { ...c, quantity: qty, subtotal: Math.round(qty * c.unitPrice * 100) / 100 }
      : c));
  }

  function updateEditPrice(key: string, price: number) {
    setEditCart(p => p.map(c => c.key === key
      ? { ...c, unitPrice: price, subtotal: Math.round(c.quantity * price * 100) / 100 }
      : c));
  }

  function addEditExternalItem() {
    if (!editExtName.trim() || editExtQty <= 0 || editExtPrice <= 0) {
      setEditError('Fill in name, quantity and price for the external item'); return;
    }
    setEditCart(p => [...p, {
      key: `ext::${Date.now()}`,
      productId: null, productName: editExtName.trim(),
      quantity: editExtQty, unitPrice: editExtPrice,
      subtotal: Math.round(editExtQty * editExtPrice * 100) / 100,
      unit: editExtUnit, availableQty: Infinity,
      sourceWarehouseId: null, sourceWarehouseName: null,
      isExternal: true, externalSource: editExtSource.trim(),
    }]);
    setEditExtName(''); setEditExtSource(''); setEditExtQty(1); setEditExtPrice(0); setEditExtUnit('pcs');
    setEditShowExtForm(false);
  }

  async function handleUpdate() {
    setEditError('');
    if (!editCustomerName.trim()) { setEditError('Customer name is required'); return; }
    if (editCart.length === 0)   { setEditError('At least one item is required'); return; }
    const editTotal = editCart.reduce((s, i) => s + i.subtotal, 0);
    if (editTotal <= 0)          { setEditError('Total must be greater than zero'); return; }

    setEditSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/warehouse-sales/${editSale!._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({
          warehouseId: editSale!.warehouseId || null,
          customerName: editCustomerName.trim(),
          customerPhone: editCustomerPhone.trim() || null,
          customerAddress: editCustomerAddress.trim() || null,
          paymentMethod: editPayMethod,
          amountPaid: editPayMethod === 'credit' ? editAmountPaid : editTotal,
          docType: editDocType,
          notes: editNotes.trim() || null,
          saleDate: editSaleDate,
          items: editCart.map(c => ({
            productId: c.productId, productName: c.productName,
            quantity: c.quantity, unitPrice: c.unitPrice, subtotal: c.subtotal,
            unit: c.unit, sourceWarehouseId: c.sourceWarehouseId,
            isExternal: c.isExternal, externalSource: c.externalSource || null,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);

      const updated: WarehouseSale = json.data;
      toast.success(`${updated.docType === 'waybill' ? 'Waybill' : 'Invoice'} #${updated.invoiceNumber} updated`);
      setEditSale(null);
      setViewSale(updated);
      setHistory(prev => prev.map(s => s._id === updated._id ? updated : s));
      loadAllStock();
    } catch (err: any) {
      setEditError(err.message || 'Failed to update sale');
    }
    setEditSubmitting(false);
  }

  // ── Print ───────────────────────────────────────────────────────────────────

  function handlePrint() {
    if (!invoiceRef.current) return;
    const win = window.open('', '_blank', 'width=850,height=700');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head>
      <title>${viewSale?.docType === 'waybill' ? 'Waybill' : 'Invoice'} #${viewSale?.invoiceNumber}</title>
      <style>* { margin:0; padding:0; box-sizing:border-box; } body { background:#fff; } @media print { body { margin:0; } }</style>
      </head><body>${invoiceRef.current.innerHTML}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 300);
  }

  // ── Settings save ───────────────────────────────────────────────────────────

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>, field: 'logoDataUrl' | 'signatureDataUrl') {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await fileToDataUrl(file);
    setSettingsDraft(prev => ({ ...prev, [field]: url }));
  }

  function saveSettingsAndClose() {
    saveSettings(settingsDraft);
    setSettings(settingsDraft);
    setShowSettings(false);
    toast.success('Company settings saved');
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Warehouse Sales</h1>
          <p className="text-slate-400 text-sm mt-0.5">Sell from any warehouse — generate invoices & waybills</p>
        </div>
        <button onClick={() => { setSettingsDraft(settings); setShowSettings(true); }}
          className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 shadow-sm font-medium">
          <Settings className="w-4 h-4" />Company Settings
        </button>
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

      {/* ══ NEW SALE ══ */}
      {tab === 'new' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

          {/* ── Left: form ── */}
          <div className="lg:col-span-3 space-y-4">

            {/* Issuing warehouse (for invoice header) */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
                <Building2 className="w-3.5 h-3.5 inline mr-1" />Issuing Warehouse (Invoice "From")
              </label>
              <select value={primaryWarehouse} onChange={e => setPrimaryWarehouse(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50">
                <option value="">— None / Multi-source —</option>
                {warehouses.map(w => <option key={w._id} value={w._id}>{w.name}</option>)}
              </select>
            </div>

            {/* Customer */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide flex items-center gap-1">
                <User className="w-3.5 h-3.5" />Customer Details
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Name *</label>
                  <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)}
                    placeholder="Customer name"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Phone</label>
                  <input type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
                    placeholder="08012345678"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-slate-500 mb-1">Delivery Address</label>
                  <input type="text" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)}
                    placeholder="Delivery address (optional)"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
              </div>
            </div>

            {/* Payment + doc type */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Payment Method</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['cash','pos','transfer','credit'] as PayMethod[]).map(m => (
                      <button key={m} onClick={() => setPayMethod(m)}
                        className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                          payMethod === m
                            ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}>
                        {m === 'cash' && <DollarSign className="w-3.5 h-3.5" />}
                        {m === 'pos'  && <CreditCard className="w-3.5 h-3.5" />}
                        {m === 'transfer' && <ArrowLeftRight className="w-3.5 h-3.5" />}
                        {m === 'credit' && <Clock className="w-3.5 h-3.5" />}
                        {PM_LABELS[m]}
                      </button>
                    ))}
                  </div>
                  {payMethod === 'credit' && (
                    <div className="mt-2">
                      <label className="block text-xs text-slate-500 mb-1">Amount Paid (₦)</label>
                      <input type="number" min="0" step="0.01" value={amountPaid || ''}
                        onChange={e => setAmountPaid(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                      {balance > 0 && <p className="text-xs text-red-600 mt-1 font-medium">Balance: {fmt(balance)}</p>}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Document Type</p>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <button onClick={() => setDocType('invoice')}
                      className={`flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-semibold border transition-colors ${
                        docType === 'invoice' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}>
                      <FileText className="w-5 h-5" />Invoice
                    </button>
                    <button onClick={() => setDocType('waybill')}
                      className={`flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-semibold border transition-colors ${
                        docType === 'waybill' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}>
                      <Truck className="w-5 h-5" />Waybill
                    </button>
                  </div>
                  <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs text-slate-500 mb-1">Notes</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Any additional notes…"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
              </div>
            </div>

            {/* Product picker — multi-warehouse */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
                  <Package className="w-3.5 h-3.5" />Add Products
                </p>
                <div className="flex gap-2">
                  <button onClick={loadAllStock} disabled={stockLoading}
                    className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                    <RefreshCw className={`w-3 h-3 ${stockLoading ? 'animate-spin' : ''}`} />Refresh
                  </button>
                  <button onClick={() => setShowExtForm(v => !v)}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg font-semibold">
                    <ExternalLink className="w-3.5 h-3.5" />External Item
                  </button>
                </div>
              </div>

              {/* External item form */}
              {showExtForm && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                  <p className="text-xs font-semibold text-amber-800">Add External / Custom Item</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <input type="text" value={extName} onChange={e => setExtName(e.target.value)}
                        placeholder="Product / item name *"
                        className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                    </div>
                    <input type="text" value={extSource} onChange={e => setExtSource(e.target.value)}
                      placeholder="Source (e.g. Supplier X)"
                      className="px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                    <input type="text" value={extUnit} onChange={e => setExtUnit(e.target.value)}
                      placeholder="Unit (pcs, m, kg…)"
                      className="px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                    <input type="number" min="0.01" step="0.01" value={extQty || ''} onChange={e => setExtQty(parseFloat(e.target.value) || 0)}
                      placeholder="Qty *"
                      className="px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                    <input type="number" min="0" step="0.01" value={extPrice || ''} onChange={e => setExtPrice(parseFloat(e.target.value) || 0)}
                      placeholder="Unit price ₦ *"
                      className="px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={addExternalItem}
                      className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold">
                      Add to Cart
                    </button>
                    <button onClick={() => setShowExtForm(false)}
                      className="px-4 py-2 bg-white border border-amber-200 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-50">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Warehouse tabs */}
              <div className="flex gap-1 flex-wrap mb-2">
                <button onClick={() => setPickerWarehouse('')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    !pickerWarehouse ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  All
                </button>
                {warehouses.map(w => (
                  <button key={w._id} onClick={() => setPickerWarehouse(w._id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors truncate max-w-[120px] ${
                      pickerWarehouse === w._id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}>
                    {w.name}
                  </button>
                ))}
              </div>

              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input type="text" value={productSearch} onChange={e => setProductSearch(e.target.value)}
                  placeholder="Search products…"
                  className="w-full pl-8 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
              </div>

              {stockLoading ? (
                <p className="text-xs text-slate-400 text-center py-4">Loading stock…</p>
              ) : filteredStock.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">
                  {allStock.length === 0 ? 'No stock in any warehouse' : 'No matching products'}
                </p>
              ) : (
                <div className="max-h-52 overflow-y-auto space-y-1 pr-0.5">
                  {filteredStock.map((s, idx) => {
                    const key = `${s.productId}::${s.warehouseId}`;
                    const inCart = cart.some(c => c.key === key);
                    return (
                      <div key={`${s.productId}-${s.warehouseId}-${idx}`}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-slate-50 transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{s.productName}</p>
                          <p className="text-xs text-slate-500 flex items-center gap-1.5 flex-wrap">
                            <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-medium">{s.warehouseName}</span>
                            Stock: {s.quantity} {s.unit} · {fmt(s.unitPrice)}/{s.unit}
                          </p>
                        </div>
                        <button onClick={() => addStockItem(s)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors flex-shrink-0 ${
                            inCart
                              ? 'bg-green-50 text-green-700 hover:bg-green-100'
                              : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                          }`}>
                          {inCart ? <><CheckCircle className="w-3.5 h-3.5" />Added</> : <><Plus className="w-3.5 h-3.5" />Add</>}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Cart ── */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 sticky top-4">
              <div className="flex items-center justify-between p-4 border-b border-slate-100">
                <p className="font-bold text-slate-800 flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-amber-500" />Cart ({cart.length})
                </p>
                {cart.length > 0 && (
                  <button onClick={() => setCart([])} className="text-xs text-red-500 hover:text-red-700">Clear</button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No items yet</p>
                </div>
              ) : (
                <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
                  {cart.map(item => (
                    <div key={item.key} className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 leading-tight truncate">{item.productName}</p>
                          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                            {item.isExternal ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                                EXT{item.externalSource ? ` · ${item.externalSource}` : ''}
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 font-medium">
                                {item.sourceWarehouseName}
                              </span>
                            )}
                          </div>
                        </div>
                        <button onClick={() => removeFromCart(item.key)}
                          className="text-slate-300 hover:text-red-500 flex-shrink-0 mt-0.5">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white">
                          <button onClick={() => updateCartQty(item.key, item.quantity - (item.key.startsWith('ext') ? 1 : 1))}
                            className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600">
                            <Minus className="w-3 h-3" />
                          </button>
                          <input type="number" min="0.01" step="0.01" value={item.quantity}
                            onChange={e => updateCartQty(item.key, parseFloat(e.target.value) || 0)}
                            className="w-14 text-center text-sm py-1.5 focus:outline-none bg-white font-medium" />
                          <button onClick={() => updateCartQty(item.key, item.quantity + 1)}
                            className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600">
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="flex-1 relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₦</span>
                          <input type="number" min="0" step="0.01" value={item.unitPrice}
                            onChange={e => updateCartPrice(item.key, parseFloat(e.target.value) || 0)}
                            className="w-full pl-5 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white font-medium" />
                        </div>
                        <span className="text-xs font-bold text-amber-700 flex-shrink-0 min-w-[60px] text-right">{fmt(item.subtotal)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="p-4 border-t border-slate-100 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-slate-600">Total</span>
                  <span className="text-xl font-extrabold text-amber-600">{fmt(total)}</span>
                </div>
                {balance > 0 && (
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

      {/* ══ HISTORY ══ */}
      {tab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col sm:flex-row gap-3">
            <select value={historyWarehouse} onChange={e => setHistoryWarehouse(e.target.value)}
              className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
              <option value="">All Warehouses</option>
              {warehouses.map(w => <option key={w._id} value={w._id}>{w.name}</option>)}
            </select>
            <button onClick={loadHistory} disabled={historyLoading}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-sm font-medium flex items-center gap-2">
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
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="font-mono font-bold text-slate-700 text-sm">#{s.invoiceNumber}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.docType === 'waybill' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {s.docType === 'waybill' ? 'Waybill' : 'Invoice'}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">
                        {PM_LABELS[s.paymentMethod]}
                      </span>
                    </div>
                    <p className="font-semibold text-slate-800">{s.customerName}</p>
                    <p className="text-xs text-slate-400">
                      {new Date((s.saleDate ?? '').split('T')[0] + 'T12:00:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {s.warehouseName && ` · ${s.warehouseName}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-lg text-slate-800">{fmt(s.totalAmount)}</p>
                    {s.balanceDue > 0.01 && <p className="text-xs text-red-500 font-medium">Owes {fmt(s.balanceDue)}</p>}
                    <button onClick={() => viewDetail(s._id)}
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

      {/* ══ Invoice / Waybill Viewer ══ */}
      {viewSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                {viewSale.docType === 'waybill'
                  ? <Truck className="w-5 h-5 text-green-600" />
                  : <FileText className="w-5 h-5 text-blue-600" />}
                <div>
                  <p className="font-bold text-slate-800">
                    {viewSale.docType === 'waybill' ? 'Waybill' : 'Invoice'} #{viewSale.invoiceNumber}
                  </p>
                  <p className="text-xs text-slate-400">{viewSale.customerName} · {fmt(viewSale.totalAmount)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit(viewSale)}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-bold transition-colors">
                  <Edit2 className="w-4 h-4" />Edit
                </button>
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
            <div className="overflow-y-auto p-4 flex-1 bg-slate-100">
              <div className="flex justify-center">
                <div ref={invoiceRef} className="bg-white shadow-sm rounded-lg overflow-hidden">
                  <InvoiceDocument sale={viewSale} settings={settings} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ Edit Modal ══ */}
      {editSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-100 flex-shrink-0">
              <div>
                <p className="font-bold text-slate-800">Edit {editDocType === 'waybill' ? 'Waybill' : 'Invoice'} #{editSale.invoiceNumber}</p>
                <p className="text-xs text-slate-400">Changes will restore and re-deduct stock automatically</p>
              </div>
              <button onClick={() => setEditSale(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4 space-y-4">
              {/* Customer */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Customer Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Name *</label>
                    <input type="text" value={editCustomerName} onChange={e => setEditCustomerName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Phone</label>
                    <input type="tel" value={editCustomerPhone} onChange={e => setEditCustomerPhone(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-slate-500 mb-1">Address</label>
                    <input type="text" value={editCustomerAddress} onChange={e => setEditCustomerAddress(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                  </div>
                </div>
              </div>

              {/* Payment + doc type + date */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Payment & Document</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['cash','pos','transfer','credit'] as PayMethod[]).map(m => (
                    <button key={m} onClick={() => setEditPayMethod(m)}
                      className={`py-2 rounded-xl text-xs font-semibold border transition-colors ${
                        editPayMethod === m ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}>
                      {PM_LABELS[m]}
                    </button>
                  ))}
                </div>
                {editPayMethod === 'credit' && (
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Amount Paid (₦)</label>
                    <input type="number" min="0" step="0.01" value={editAmountPaid || ''}
                      onChange={e => setEditAmountPaid(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Document Type</label>
                    <div className="flex gap-2">
                      {(['invoice','waybill'] as DocType[]).map(d => (
                        <button key={d} onClick={() => setEditDocType(d)}
                          className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-colors capitalize ${
                            editDocType === d
                              ? d === 'invoice' ? 'bg-blue-500 text-white border-blue-500' : 'bg-green-600 text-white border-green-600'
                              : 'bg-white text-slate-600 border-slate-200'
                          }`}>
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Sale Date</label>
                    <input type="date" value={editSaleDate} onChange={e => setEditSaleDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Notes</label>
                  <input type="text" value={editNotes} onChange={e => setEditNotes(e.target.value)}
                    placeholder="Additional notes…"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                </div>
              </div>

              {/* Items */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Items ({editCart.length})</p>
                  <button onClick={() => setEditShowExtForm(v => !v)}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg font-semibold">
                    <Plus className="w-3.5 h-3.5" />Add External Item
                  </button>
                </div>

                {editShowExtForm && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                    <p className="text-xs font-semibold text-amber-800">New External / Custom Item</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2">
                        <input type="text" value={editExtName} onChange={e => setEditExtName(e.target.value)}
                          placeholder="Item name *"
                          className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                      </div>
                      <input type="text" value={editExtSource} onChange={e => setEditExtSource(e.target.value)}
                        placeholder="Source (optional)"
                        className="px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                      <input type="text" value={editExtUnit} onChange={e => setEditExtUnit(e.target.value)}
                        placeholder="Unit (pcs, kg…)"
                        className="px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                      <input type="number" min="0.01" step="0.01" value={editExtQty || ''} onChange={e => setEditExtQty(parseFloat(e.target.value) || 0)}
                        placeholder="Qty *"
                        className="px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                      <input type="number" min="0" step="0.01" value={editExtPrice || ''} onChange={e => setEditExtPrice(parseFloat(e.target.value) || 0)}
                        placeholder="Unit price ₦ *"
                        className="px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addEditExternalItem}
                        className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold">Add to Cart</button>
                      <button onClick={() => setEditShowExtForm(false)}
                        className="px-4 py-2 bg-white border border-amber-200 text-amber-700 rounded-lg text-xs font-medium">Cancel</button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {editCart.map(item => (
                    <div key={item.key} className="p-3 bg-white rounded-xl border border-slate-200">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{item.productName}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            {item.isExternal ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                                EXT{item.externalSource ? ` · ${item.externalSource}` : ''}
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                                {item.sourceWarehouseName ?? 'Warehouse'}
                              </span>
                            )}
                          </div>
                        </div>
                        <button onClick={() => setEditCart(p => p.filter(c => c.key !== item.key))}
                          className="text-slate-300 hover:text-red-500 flex-shrink-0">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                          <button onClick={() => updateEditQty(item.key, item.quantity - 1)}
                            className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600">
                            <Minus className="w-3 h-3" />
                          </button>
                          <input type="number" min="0.01" step="0.01" value={item.quantity}
                            onChange={e => updateEditQty(item.key, parseFloat(e.target.value) || 0)}
                            className="w-14 text-center text-sm py-1.5 focus:outline-none bg-slate-50 font-medium" />
                          <button onClick={() => updateEditQty(item.key, item.quantity + 1)}
                            className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600">
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="flex-1 relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₦</span>
                          <input type="number" min="0" step="0.01" value={item.unitPrice}
                            onChange={e => updateEditPrice(item.key, parseFloat(e.target.value) || 0)}
                            className="w-full pl-5 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white font-medium" />
                        </div>
                        <span className="text-xs font-bold text-amber-700 min-w-[72px] text-right flex-shrink-0">{fmt(item.subtotal)}</span>
                      </div>
                    </div>
                  ))}
                  {editCart.length === 0 && (
                    <p className="text-center text-sm text-slate-400 py-4">No items — all removed</p>
                  )}
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                  <span className="text-sm font-semibold text-slate-600">Total</span>
                  <span className="text-lg font-extrabold text-amber-600">
                    {fmt(editCart.reduce((s, i) => s + i.subtotal, 0))}
                  </span>
                </div>
              </div>

              {editError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{editError}</p>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 p-4 border-t border-slate-100 flex-shrink-0">
              <button onClick={() => setEditSale(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleUpdate} disabled={editSubmitting}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-bold text-sm shadow-sm flex items-center justify-center gap-2">
                {editSubmitting
                  ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : null}
                {editSubmitting ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Company Settings Modal ══ */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Company Settings</h2>
              <button onClick={() => setShowSettings(false)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Company Name</label>
                <input type="text" value={settingsDraft.name}
                  onChange={e => setSettingsDraft(p => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Tagline</label>
                <input type="text" value={settingsDraft.tagline}
                  onChange={e => setSettingsDraft(p => ({ ...p, tagline: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Address</label>
                <input type="text" value={settingsDraft.address}
                  onChange={e => setSettingsDraft(p => ({ ...p, address: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Phone</label>
                  <input type="text" value={settingsDraft.phone}
                    onChange={e => setSettingsDraft(p => ({ ...p, phone: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Email</label>
                  <input type="text" value={settingsDraft.email}
                    onChange={e => setSettingsDraft(p => ({ ...p, email: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50" />
                </div>
              </div>

              {/* Logo upload */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Company Logo (JPEG/PNG)</label>
                <div className="flex items-center gap-3">
                  {settingsDraft.logoDataUrl && (
                    <img src={settingsDraft.logoDataUrl} alt="logo" className="w-16 h-16 object-contain rounded-lg border border-slate-200" />
                  )}
                  <label className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm text-slate-600 font-medium cursor-pointer transition-colors">
                    <Upload className="w-4 h-4" />Upload Logo
                    <input type="file" accept="image/jpeg,image/png,image/jpg" className="hidden"
                      onChange={e => handleLogoUpload(e, 'logoDataUrl')} />
                  </label>
                  {settingsDraft.logoDataUrl && (
                    <button onClick={() => setSettingsDraft(p => ({ ...p, logoDataUrl: '' }))}
                      className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                  )}
                </div>
              </div>

              {/* Signature upload */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Authorized Signature (JPEG/PNG)</label>
                <div className="flex items-center gap-3">
                  {settingsDraft.signatureDataUrl && (
                    <img src={settingsDraft.signatureDataUrl} alt="signature" className="h-14 object-contain rounded-lg border border-slate-200 bg-white" />
                  )}
                  <label className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm text-slate-600 font-medium cursor-pointer transition-colors">
                    <Upload className="w-4 h-4" />Upload Signature
                    <input type="file" accept="image/jpeg,image/png,image/jpg" className="hidden"
                      onChange={e => handleLogoUpload(e, 'signatureDataUrl')} />
                  </label>
                  {settingsDraft.signatureDataUrl && (
                    <button onClick={() => setSettingsDraft(p => ({ ...p, signatureDataUrl: '' }))}
                      className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                  )}
                </div>
              </div>

              <p className="text-xs text-slate-400">Settings are saved in your browser (localStorage).</p>
            </div>
            <div className="flex gap-3 p-5 border-t border-slate-100">
              <button onClick={() => setShowSettings(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={saveSettingsAndClose}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm shadow-sm">
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
