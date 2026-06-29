import { useEffect, useState, useMemo } from 'react';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { find, insertOne, updateOne, deleteOne, Collections } from '../../lib/api';
import type { Warehouse, Product, WarehouseStock } from '../../lib/types';
import { SkeletonCard } from '../../components/Skeleton';
import {
  Plus, Edit2, Trash2, X, Check, Package,
  ChevronDown, ChevronUp, Search, Download,
  RefreshCw, AlertTriangle, TrendingUp, XCircle, CheckCircle,
  Warehouse as WIcon, MapPin, Filter, ArrowUpDown,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type WarehouseForm = { name: string; location: string; description: string };
const BLANK_FORM: WarehouseForm = { name: '', location: '', description: '' };

interface StockItem extends WarehouseStock { product: Product }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₦${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

function stockLevel(qty: number): { label: string; cls: string; bar: string } {
  if (qty <= 0)  return { label: 'Out of Stock', cls: 'bg-red-100 text-red-700',    bar: 'bg-red-500'    };
  if (qty <= 5)  return { label: 'Critical',     cls: 'bg-red-100 text-red-700',    bar: 'bg-red-400'    };
  if (qty <= 20) return { label: 'Low',          cls: 'bg-amber-100 text-amber-700', bar: 'bg-amber-400' };
  if (qty <= 50) return { label: 'Moderate',     cls: 'bg-blue-100 text-blue-700',  bar: 'bg-blue-400'   };
  return               { label: 'Good',          cls: 'bg-green-100 text-green-700', bar: 'bg-green-400' };
}

function exportStockCSV(warehouseName: string, items: StockItem[]) {
  const header = ['Product', 'Unit', 'Quantity', 'Unit Price', 'Stock Value', 'Level'];
  const rows = items.map(s => [
    s.product?.name ?? '',
    s.product?.unit ?? '',
    s.quantity,
    s.product?.unitPrice ?? 0,
    (s.quantity * (s.product?.unitPrice ?? 0)).toFixed(2),
    stockLevel(Number(s.quantity)).label,
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${warehouseName.replace(/\s+/g, '-').toLowerCase()}-stock-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WarehousesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [warehouses, setWarehouses]     = useState<Warehouse[]>([]);
  const [products, setProducts]         = useState<Product[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [refreshing, setRefreshing]     = useState(false);

  // Warehouse form
  const [showForm, setShowForm]         = useState(false);
  const [editing, setEditing]           = useState<Warehouse | null>(null);
  const [form, setForm]                 = useState<WarehouseForm>(BLANK_FORM);
  const [saving, setSaving]             = useState(false);
  const [formError, setFormError]       = useState('');

  // Stock per warehouse
  const [expanded, setExpanded]         = useState<string | null>(null);
  const [stock, setStock]               = useState<Record<string, StockItem[]>>({});
  const [loadingStock, setLoadingStock] = useState<string | null>(null);
  const [stockSearch, setStockSearch]   = useState<Record<string, string>>({});

  // Stock form
  const [showStockForm, setShowStockForm] = useState<string | null>(null);
  const [stockForm, setStockForm]         = useState({ product_id: '', quantity: 0 });
  const [savingStock, setSavingStock]     = useState(false);

  // Stock search enhancements
  const [stockFilter, setStockFilter]           = useState<Record<string, string>>({});
  const [stockSort, setStockSort]               = useState<Record<string, string>>({});
  const [globalMaterialSearch, setGlobalMaterialSearch] = useState('');
  const [fetchingAllStock, setFetchingAllStock] = useState(false);

  // ── Fetch ─────────────────────────────────────────────────────────────────────
  async function fetchAll(quiet = false) {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const [ws, ps] = await Promise.all([
        find(Collections.WAREHOUSES, {}, { sort: { name: 1 } }),
        find(Collections.PRODUCTS, { isActive: true }, { sort: { name: 1 } }),
      ]);
      setWarehouses(ws as Warehouse[]);
      setProducts(ps as Product[]);
    } catch {
      toast.error('Failed to load warehouses');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function fetchStock(warehouseId: string) {
    setLoadingStock(warehouseId);
    try {
      const data = await find(Collections.WAREHOUSE_STOCK, { warehouseId });
      setStock(prev => ({
        ...prev,
        [warehouseId]: (data as any[]).map(s => ({
          _id:         s.product_id,
          warehouseId: s.warehouse_id,
          productId:   s.product_id,
          quantity:    parseFloat(s.quantity),
          updatedAt:   s.updated_at,
          product: s.product ? {
            _id:       s.product.id,
            id:        s.product.id,
            name:      s.product.name,
            unit:      s.product.unit,
            unitPrice: parseFloat(s.product.unit_price ?? s.product.current_price ?? 0),
            isActive:  true,
            sku:       s.product.sku,
            createdAt: '',
            updatedAt: '',
          } as Product : undefined,
        })).filter(s => s.product) as StockItem[],
      }));
    } catch {
      toast.error('Failed to load stock');
    } finally {
      setLoadingStock(null);
    }
  }

  async function ensureAllStockFetched() {
    const unfetched = warehouses.filter(w => !stock[w._id] && loadingStock !== w._id);
    if (unfetched.length === 0) return;
    setFetchingAllStock(true);
    try {
      await Promise.all(unfetched.map(w => fetchStock(w._id)));
    } finally {
      setFetchingAllStock(false);
    }
  }

  useEffect(() => { fetchAll(); }, []);

  // ── Expand / collapse ─────────────────────────────────────────────────────────
  function toggleExpand(id: string) {
    if (expanded === id) {
      setExpanded(null);
    } else {
      setExpanded(id);
      if (!stock[id]) fetchStock(id);
    }
  }

  // ── Warehouse CRUD ────────────────────────────────────────────────────────────
  function openCreate() {
    setEditing(null);
    setForm(BLANK_FORM);
    setFormError('');
    setShowForm(true);
  }

  function openEdit(w: Warehouse) {
    setEditing(w);
    setForm({ name: w.name, location: w.location || '', description: w.description || '' });
    setFormError('');
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    setSaving(true); setFormError('');
    try {
      const payload = { ...form, updatedAt: new Date().toISOString() };
      if (editing) {
        await updateOne(Collections.WAREHOUSES, { _id: { $oid: editing._id } }, { $set: payload });
        toast.success(`Warehouse "${form.name}" updated`);
      } else {
        await insertOne(Collections.WAREHOUSES, { ...payload, isActive: true, createdAt: new Date().toISOString() });
        toast.success(`Warehouse "${form.name}" created`);
      }
      await fetchAll(true);
      setShowForm(false);
      setEditing(null);
    } catch (err: any) {
      setFormError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(w: Warehouse) {
    if (!await confirm({ title: 'Delete Warehouse', message: `Delete warehouse "${w.name}"? This cannot be undone.`, confirmText: 'Delete', danger: true })) return;
    try {
      await deleteOne(Collections.WAREHOUSES, { _id: { $oid: w._id } });
      setWarehouses(prev => prev.filter(x => x._id !== w._id));
      toast.info(`Deleted "${w.name}"`);
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
    }
  }

  // ── Stock CRUD ────────────────────────────────────────────────────────────────
  async function handleSaveStock(e: React.FormEvent, warehouseId: string) {
    e.preventDefault();
    if (!stockForm.product_id) return;
    setSavingStock(true);
    try {
      await updateOne(
        Collections.WAREHOUSE_STOCK,
        { warehouseId, productId: stockForm.product_id },
        { $set: { warehouseId, productId: stockForm.product_id, quantity: stockForm.quantity, updatedAt: new Date().toISOString() } },
        true
      );
      await fetchStock(warehouseId);
      setShowStockForm(null);
      setStockForm({ product_id: '', quantity: 0 });
      toast.success('Stock updated');
    } catch (err: any) {
      toast.error(err.message || 'Stock save failed');
    } finally {
      setSavingStock(false);
    }
  }

  async function handleDeleteStock(productId: string, warehouseId: string, productName: string) {
    if (!await confirm({ title: 'Remove Stock', message: `Remove "${productName}" from this warehouse's stock?`, confirmText: 'Remove', danger: true })) return;
    try {
      await deleteOne(Collections.WAREHOUSE_STOCK, { warehouseId, productId });
      setStock(prev => ({
        ...prev,
        [warehouseId]: (prev[warehouseId] || []).filter(s => s.productId !== productId),
      }));
      toast.info(`Removed "${productName}" from stock`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove stock item');
    }
  }

  // ── Derived: global stats ─────────────────────────────────────────────────────
  const globalStats = useMemo(() => {
    let totalItems = 0, totalValue = 0, lowStockCount = 0;
    for (const items of Object.values(stock)) {
      for (const s of items) {
        totalItems++;
        totalValue += Number(s.quantity) * (s.product?.unitPrice ?? 0);
        if (Number(s.quantity) <= 20) lowStockCount++;
      }
    }
    return { totalItems, totalValue, lowStockCount };
  }, [stock]);

  // ── Per-warehouse stock summary ───────────────────────────────────────────────
  function warehouseStats(warehouseId: string) {
    const items = stock[warehouseId] ?? [];
    const totalQty   = items.reduce((s, i) => s + Number(i.quantity), 0);
    const totalValue = items.reduce((s, i) => s + Number(i.quantity) * (i.product?.unitPrice ?? 0), 0);
    const lowCount   = items.filter(i => Number(i.quantity) <= 20).length;
    return { count: items.length, totalQty, totalValue, lowCount };
  }

  // ── Filtered warehouses ───────────────────────────────────────────────────────
  const filteredWarehouses = useMemo(() => {
    let result = warehouses;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(w =>
        w.name.toLowerCase().includes(q) ||
        (w.location ?? '').toLowerCase().includes(q) ||
        (w.description ?? '').toLowerCase().includes(q)
      );
    }
    if (globalMaterialSearch.trim()) {
      const q = globalMaterialSearch.toLowerCase();
      result = result.filter(w => {
        const items = stock[w._id] ?? [];
        return items.some(s =>
          s.product?.name.toLowerCase().includes(q) ||
          (s.product?.sku ?? '').toLowerCase().includes(q) ||
          (s.product?.unit ?? '').toLowerCase().includes(q)
        );
      });
    }
    return result;
  }, [warehouses, search, globalMaterialSearch, stock]);

  // ── Filtered stock for a warehouse ───────────────────────────────────────────
  function filteredStock(warehouseId: string): StockItem[] {
    const items = stock[warehouseId] ?? [];
    // Global search takes priority over per-warehouse search
    const searchTerm = globalMaterialSearch.trim() || (stockSearch[warehouseId] ?? '');
    const q = searchTerm.toLowerCase().trim();
    const filter = stockFilter[warehouseId] ?? 'all';
    const sort   = stockSort[warehouseId]   ?? 'name';

    let result = items;

    if (q) {
      result = result.filter(s =>
        s.product?.name.toLowerCase().includes(q) ||
        (s.product?.sku  ?? '').toLowerCase().includes(q) ||
        (s.product?.unit ?? '').toLowerCase().includes(q)
      );
    }

    if (filter !== 'all') {
      result = result.filter(s => {
        const qty = Number(s.quantity);
        switch (filter) {
          case 'out':      return qty <= 0;
          case 'critical': return qty > 0  && qty <= 5;
          case 'low':      return qty > 5  && qty <= 20;
          case 'moderate': return qty > 20 && qty <= 50;
          case 'good':     return qty > 50;
          default:         return true;
        }
      });
    }

    return [...result].sort((a, b) => {
      switch (sort) {
        case 'qty-asc':   return Number(a.quantity) - Number(b.quantity);
        case 'qty-desc':  return Number(b.quantity) - Number(a.quantity);
        case 'value-desc': {
          const av = Number(a.quantity) * (a.product?.unitPrice ?? 0);
          const bv = Number(b.quantity) * (b.product?.unitPrice ?? 0);
          return bv - av;
        }
        default: return (a.product?.name ?? '').localeCompare(b.product?.name ?? '');
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <WIcon className="w-6 h-6 text-blue-500" />
            Warehouses
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage warehouses and inventory stock levels</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchAll(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New Warehouse
          </button>
        </div>
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <WIcon className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{warehouses.length}</p>
            <p className="text-xs text-slate-500">Warehouses</p>
          </div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
            <Package className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{globalStats.totalItems}</p>
            <p className="text-xs text-slate-500">Stock Lines</p>
          </div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-lg font-bold text-slate-800 leading-tight">{fmt(globalStats.totalValue)}</p>
            <p className="text-xs text-slate-500">Stock Value</p>
          </div>
        </div>
        <div className={`border rounded-xl p-4 flex items-center gap-3 shadow-sm ${
          globalStats.lowStockCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            globalStats.lowStockCount > 0 ? 'bg-amber-200' : 'bg-slate-100'
          }`}>
            <AlertTriangle className={`w-5 h-5 ${globalStats.lowStockCount > 0 ? 'text-amber-600' : 'text-slate-400'}`} />
          </div>
          <div>
            <p className={`text-2xl font-bold ${globalStats.lowStockCount > 0 ? 'text-amber-700' : 'text-slate-800'}`}>
              {globalStats.lowStockCount}
            </p>
            <p className={`text-xs ${globalStats.lowStockCount > 0 ? 'text-amber-600' : 'text-slate-500'}`}>Low / Critical</p>
          </div>
        </div>
      </div>

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {/* Warehouse search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search warehouses by name, location…"
            className="w-full pl-9 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Global material search */}
        <div className="relative">
          <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={globalMaterialSearch}
            onChange={e => {
              setGlobalMaterialSearch(e.target.value);
              if (e.target.value.trim()) ensureAllStockFetched();
            }}
            placeholder="Find material across all warehouses (name, SKU, unit)…"
            className={`w-full pl-9 pr-9 py-2.5 border rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 shadow-sm transition-colors ${
              globalMaterialSearch
                ? 'border-blue-300 bg-blue-50/40 focus:ring-blue-400'
                : 'bg-white border-slate-200 focus:ring-blue-400'
            }`}
          />
          {fetchingAllStock && !globalMaterialSearch && (
            <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 animate-spin pointer-events-none" />
          )}
          {globalMaterialSearch ? (
            <button onClick={() => setGlobalMaterialSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          ) : fetchingAllStock ? (
            <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 animate-spin pointer-events-none" />
          ) : null}
        </div>

        {/* Active global search badge */}
        {globalMaterialSearch.trim() && (
          <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
            <Package className="w-3.5 h-3.5 shrink-0" />
            {fetchingAllStock
              ? 'Searching all warehouses…'
              : `Found in ${filteredWarehouses.length} warehouse${filteredWarehouses.length !== 1 ? 's' : ''}`}
            <span className="font-semibold">"{globalMaterialSearch}"</span>
            <button
              onClick={() => setGlobalMaterialSearch('')}
              className="ml-auto text-blue-500 hover:text-blue-700 font-medium"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* ── Warehouse list ──────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filteredWarehouses.length === 0 ? (
        <div className="bg-white rounded-xl p-14 text-center text-slate-400 shadow-sm border border-slate-100">
          <WIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-semibold text-slate-500">{search ? 'No warehouses match your search' : 'No warehouses yet'}</p>
          {!search && <p className="text-sm mt-1">Click "New Warehouse" to get started.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredWarehouses.map(w => {
            const ws      = warehouseStats(w._id);
            const isLoading = loadingStock === w._id;
            const items   = filteredStock(w._id);
            // Auto-expand when global material search matches items in this warehouse
            const isOpen  = expanded === w._id || (!!globalMaterialSearch.trim() && items.length > 0);

            return (
              <div key={w._id} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">

                {/* ── Warehouse header row ──────────────────────────────── */}
                <div className="flex items-center gap-4 p-5">
                  <div className="w-11 h-11 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                    <WIcon className="w-5 h-5 text-blue-600" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-800">{w.name}</p>
                      {ws.lowCount > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />{ws.lowCount} low
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {w.location && (
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />{w.location}
                        </span>
                      )}
                      {stock[w._id] && (
                        <>
                          <span className="text-xs text-slate-400">{ws.count} product{ws.count !== 1 ? 's' : ''}</span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs font-medium text-green-700">{fmt(ws.totalValue)}</span>
                        </>
                      )}
                    </div>
                    {w.description && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-md">{w.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => openEdit(w)}
                      className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                      title="Edit warehouse"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(w)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete warehouse"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => toggleExpand(w._id)}
                      className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors ${
                        isOpen
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                      }`}
                    >
                      <Package className="w-4 h-4" />
                      Stock
                      {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* ── Stock panel ───────────────────────────────────────── */}
                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50/50">
                    <div className="p-4 space-y-4">

                      {/* Stock panel toolbar */}
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                          {/* Per-warehouse search — hidden when global search is active */}
                          {!globalMaterialSearch.trim() && (
                            <div className="relative flex-1 min-w-0 max-w-xs">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                              <input
                                type="text"
                                value={stockSearch[w._id] ?? ''}
                                onChange={e => setStockSearch(prev => ({ ...prev, [w._id]: e.target.value }))}
                                placeholder="Search by name, SKU, unit…"
                                className="w-full pl-8 pr-7 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                              />
                              {stockSearch[w._id] && (
                                <button
                                  onClick={() => setStockSearch(prev => ({ ...prev, [w._id]: '' }))}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )}

                          {/* Filter by stock level */}
                          <div className="flex items-center gap-1 text-xs text-slate-500 border border-slate-200 rounded-lg bg-white px-2 py-1.5">
                            <Filter className="w-3 h-3 shrink-0" />
                            <select
                              value={stockFilter[w._id] ?? 'all'}
                              onChange={e => setStockFilter(prev => ({ ...prev, [w._id]: e.target.value }))}
                              className="bg-transparent text-xs text-slate-700 focus:outline-none cursor-pointer"
                            >
                              <option value="all">All levels</option>
                              <option value="out">Out of Stock</option>
                              <option value="critical">Critical (≤5)</option>
                              <option value="low">Low (6-20)</option>
                              <option value="moderate">Moderate (21-50)</option>
                              <option value="good">Good (&gt;50)</option>
                            </select>
                          </div>

                          {/* Sort */}
                          <div className="flex items-center gap-1 text-xs text-slate-500 border border-slate-200 rounded-lg bg-white px-2 py-1.5">
                            <ArrowUpDown className="w-3 h-3 shrink-0" />
                            <select
                              value={stockSort[w._id] ?? 'name'}
                              onChange={e => setStockSort(prev => ({ ...prev, [w._id]: e.target.value }))}
                              className="bg-transparent text-xs text-slate-700 focus:outline-none cursor-pointer"
                            >
                              <option value="name">Name A–Z</option>
                              <option value="qty-asc">Qty ↑ Low first</option>
                              <option value="qty-desc">Qty ↓ High first</option>
                              <option value="value-desc">Value ↓ High first</option>
                            </select>
                          </div>

                          {/* Result count */}
                          {(stockSearch[w._id] || globalMaterialSearch || (stockFilter[w._id] && stockFilter[w._id] !== 'all')) && (
                            <span className="text-xs text-slate-500 font-medium whitespace-nowrap">
                              {items.length} / {(stock[w._id] ?? []).length} items
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 self-end shrink-0">
                          {stock[w._id]?.length > 0 && (
                            <button
                              onClick={() => exportStockCSV(w.name, stock[w._id])}
                              className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-lg transition-colors"
                            >
                              <Download className="w-3.5 h-3.5" /> Export
                            </button>
                          )}
                          <button
                            onClick={() => fetchStock(w._id)}
                            className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-lg transition-colors"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Reload
                          </button>
                          <button
                            onClick={() => {
                              setShowStockForm(showStockForm === w._id ? null : w._id);
                              setStockForm({ product_id: '', quantity: 0 });
                            }}
                            className="flex items-center gap-1 text-xs px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add / Update Stock
                          </button>
                        </div>
                      </div>

                      {/* Stock add/edit form */}
                      {showStockForm === w._id && (
                        <form
                          onSubmit={e => handleSaveStock(e, w._id)}
                          className="flex gap-2.5 p-4 bg-amber-50 border border-amber-200 rounded-xl flex-wrap items-end"
                        >
                          <div className="flex-1 min-w-48">
                            <label className="block text-xs font-medium text-amber-800 mb-1">Product</label>
                            <select
                              value={stockForm.product_id}
                              onChange={e => setStockForm(f => ({ ...f, product_id: e.target.value }))}
                              required
                              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                            >
                              <option value="">Select product…</option>
                              {products.map(p => (
                                <option key={p._id} value={p._id}>{p.name} ({p.unit})</option>
                              ))}
                            </select>
                          </div>
                          <div className="w-36">
                            <label className="block text-xs font-medium text-amber-800 mb-1">Quantity</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={stockForm.quantity}
                              onChange={e => setStockForm(f => ({ ...f, quantity: Number(e.target.value) }))}
                              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                              placeholder="0"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setShowStockForm(null)}
                              className="px-3 py-2 border border-slate-200 bg-white rounded-lg text-slate-600 text-sm hover:bg-slate-50 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={savingStock}
                              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm transition-colors"
                            >
                              {savingStock
                                ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                : <Check className="w-3.5 h-3.5" />}
                              Save
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Stock table */}
                      {isLoading ? (
                        <div className="space-y-2">
                          {[...Array(3)].map((_, i) => (
                            <div key={i} className="h-10 bg-slate-200 rounded-lg animate-pulse" />
                          ))}
                        </div>
                      ) : (stock[w._id] ?? []).length === 0 ? (
                        <div className="text-center py-8 text-slate-400">
                          <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">No stock items yet. Click "Add / Update Stock" to begin.</p>
                        </div>
                      ) : items.length === 0 ? (
                        <div className="text-center py-6 text-slate-400 text-sm">
                          No items match "{stockSearch[w._id]}"
                        </div>
                      ) : (
                        <>
                          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-slate-50 text-left">
                                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Product</th>
                                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Qty</th>
                                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right hidden sm:table-cell">Unit Price</th>
                                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right hidden sm:table-cell">Stock Value</th>
                                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Level</th>
                                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-500"></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {items.map(item => {
                                  const qty   = Number(item.quantity);
                                  const level = stockLevel(qty);
                                  const value = qty * (item.product?.unitPrice ?? 0);
                                  return (
                                    <tr key={item._id} className="hover:bg-slate-50/60 transition-colors">
                                      <td className="px-4 py-3 font-medium text-slate-800">
                                        {item.product?.name}
                                        <span className="ml-1.5 text-xs text-slate-400">{item.product?.unit}</span>
                                      </td>
                                      <td className="px-4 py-3 text-right">
                                        <span className={`font-bold ${
                                          qty <= 0  ? 'text-red-600' :
                                          qty <= 5  ? 'text-red-500' :
                                          qty <= 20 ? 'text-amber-600' :
                                                      'text-green-700'
                                        }`}>
                                          {qty.toLocaleString()}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3 text-right text-slate-500 hidden sm:table-cell">
                                        {fmt(item.product?.unitPrice ?? 0)}
                                      </td>
                                      <td className="px-4 py-3 text-right font-semibold text-slate-700 hidden sm:table-cell">
                                        {fmt(value)}
                                      </td>
                                      <td className="px-4 py-3">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${level.cls}`}>
                                          {level.label}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="flex items-center gap-2 justify-end">
                                          <button
                                            onClick={() => {
                                              setShowStockForm(w._id);
                                              setStockForm({ product_id: item.productId, quantity: qty });
                                            }}
                                            className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                                            title="Edit quantity"
                                          >
                                            <Edit2 className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            onClick={() => handleDeleteStock(item.productId, w._id, item.product?.name ?? '')}
                                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                            title="Remove from stock"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              {/* Footer totals */}
                              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                                <tr>
                                  <td className="px-4 py-2.5 text-xs font-semibold text-slate-600">
                                    {items.length} item{items.length !== 1 ? 's' : ''}
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-xs font-bold text-slate-700">
                                    {items.reduce((s, i) => s + Number(i.quantity), 0).toLocaleString()}
                                  </td>
                                  <td className="hidden sm:table-cell" />
                                  <td className="px-4 py-2.5 text-right text-xs font-bold text-green-700 hidden sm:table-cell">
                                    {fmt(items.reduce((s, i) => s + Number(i.quantity) * (i.product?.unitPrice ?? 0), 0))}
                                  </td>
                                  <td colSpan={2} />
                                </tr>
                              </tfoot>
                            </table>
                          </div>

                          {/* Low stock alert */}
                          {ws.lowCount > 0 && (
                            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                              <AlertTriangle className="w-4 h-4 shrink-0" />
                              <span>
                                <strong>{ws.lowCount}</strong> item{ws.lowCount !== 1 ? 's are' : ' is'} running low or out of stock.
                                Consider restocking soon.
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Warehouse form modal ────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">
                {editing ? 'Edit Warehouse' : 'New Warehouse'}
              </h3>
              <button
                onClick={() => { setShowForm(false); setEditing(null); }}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                <XCircle className="w-4 h-4 shrink-0" />{formError}
              </div>
            )}

            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  required
                  placeholder="e.g. Main Warehouse"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={e => setForm(p => ({ ...p, location: e.target.value }))}
                  placeholder="e.g. Lagos, Nigeria"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={2}
                  placeholder="Optional notes about this warehouse…"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setEditing(null); }}
                  className="flex-1 py-2.5 border border-slate-200 rounded-xl text-slate-600 font-medium text-sm hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl font-medium text-sm transition-colors"
                >
                  {saving
                    ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Check className="w-4 h-4" />}
                  {editing ? 'Save Changes' : 'Create Warehouse'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}