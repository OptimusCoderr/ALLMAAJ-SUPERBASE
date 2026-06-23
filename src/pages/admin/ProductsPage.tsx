import { useEffect, useState, useMemo } from 'react';
import { useToast } from '../../context/ToastContext';
import { find, insertOne, updateOne, Collections } from '../../lib/api';
import type { Product, Branch } from '../../lib/types';
import {
  Plus, Edit2, Trash2, Package, X, Check, Search,
  Download, RefreshCw,
  Tag, ToggleLeft, ToggleRight, LayoutGrid, LayoutList,
  TrendingUp, ShoppingBag, Archive, Scissors,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type ProductForm = {
  name: string; sku: string; description: string;
  unitPrice: string; unit: string; category: string;
  isCuttable: boolean; unitLengthInches: string;
};

const BLANK: ProductForm = {
  name: '', sku: '', description: '', unitPrice: '', unit: 'piece', category: '',
  isCuttable: false, unitLengthInches: '',
};

const UNITS = ['piece', 'kg', 'litre', 'box', 'carton', 'bag', 'roll', 'pair', 'set', 'dozen', 'pack', 'bottle', 'tin', 'sachet'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  `₦${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

function exportCSV(products: Product[]) {
  const header = ['Name', 'SKU', 'Category', 'Unit Price', 'Unit', 'Status', 'Description'];
  const rows = products.map(p => [
    p.name, p.sku ?? '', p.category ?? '',
    p.unitPrice, p.unit,
    p.isActive ? 'Active' : 'Inactive',
    p.description ?? '',
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `products-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProductsPage() {
  const toast = useToast();
  const [products, setProducts]   = useState<Product[]>([]);
  const [branches, setBranches]   = useState<Branch[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch]       = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [view, setView]           = useState<'table' | 'grid'>('table');

  // Product form
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState<Product | null>(null);
  const [form, setForm]           = useState<ProductForm>(BLANK);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState('');

  // Branch stock modal
  const [showStock, setShowStock]     = useState<Product | null>(null);
  const [stockBranch, setStockBranch] = useState('');
  const [stockQty, setStockQty]       = useState(0);
  const [savingStock, setSavingStock] = useState(false);

  // ── Data fetching ─────────────────────────────────────────────────────────────
  async function fetchAll(quiet = false) {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const [prods, brs] = await Promise.all([
        find(Collections.PRODUCTS, {}, { sort: { name: 1 } }),
        find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }),
      ]);
      setProducts(prods as Product[]);
      setBranches(brs as Branch[]);
    } catch {
      toast.error('Failed to load products');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { fetchAll(); }, []);

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active    = products.filter(p => p.isActive).length;
    const inactive  = products.length - active;
    const avgPrice  = active > 0
      ? products.filter(p => p.isActive).reduce((s, p) => s + p.unitPrice, 0) / active
      : 0;
    const categories = new Set(products.map(p => p.category).filter(Boolean)).size;
    return { total: products.length, active, inactive, avgPrice, categories };
  }, [products]);

  // ── Categories list ───────────────────────────────────────────────────────────
  const categories = useMemo(() =>
    ['all', ...Array.from(new Set(products.map(p => p.category).filter((c): c is string => Boolean(c)))).sort()],
  [products]);

  // ── Filtered list ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let out = products;
    if (statusFilter !== 'all') out = out.filter(p => statusFilter === 'active' ? p.isActive : !p.isActive);
    if (catFilter !== 'all')    out = out.filter(p => p.category === catFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? '').toLowerCase().includes(q) ||
        (p.category ?? '').toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [products, search, catFilter, statusFilter]);

  // ── Form helpers ──────────────────────────────────────────────────────────────
  function openNew() {
    setEditing(null); setForm(BLANK); setFormError(''); setShowForm(true);
  }
  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name, sku: p.sku ?? '', description: p.description ?? '',
      unitPrice: String(p.unitPrice), unit: p.unit, category: p.category ?? '',
      isCuttable: p.isCuttable ?? false,
      unitLengthInches: p.unitLengthInches != null ? String(p.unitLengthInches) : '',
    });
    setFormError(''); setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim())     { setFormError('Product name is required'); return; }
    if (!form.unitPrice.trim()) { setFormError('Unit price is required'); return; }
    setSaving(true); setFormError('');
    if (form.isCuttable && (!form.unitLengthInches || parseFloat(form.unitLengthInches) <= 0)) {
      setFormError('Unit length in inches is required for cuttable products'); setSaving(false); return;
    }
    const payload = {
      name: form.name.trim(), sku: form.sku.trim(),
      description: form.description.trim(), unitPrice: parseFloat(form.unitPrice) || 0,
      unit: form.unit, category: form.category.trim(), updatedAt: new Date().toISOString(),
      isCuttable: form.isCuttable,
      unitLengthInches: form.isCuttable ? (parseFloat(form.unitLengthInches) || null) : null,
    };
    try {
      if (editing) {
        await updateOne(Collections.PRODUCTS, { _id: { $oid: editing._id } }, { $set: payload });
        toast.success(`"${payload.name}" updated`);
      } else {
        await insertOne(Collections.PRODUCTS, { ...payload, isActive: true, createdAt: new Date().toISOString() });
        toast.success(`"${payload.name}" created`);
      }
      await fetchAll(true);
      setShowForm(false); setEditing(null);
    } catch (err: any) {
      setFormError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(p: Product) {
    const next = !p.isActive;
    try {
      await updateOne(Collections.PRODUCTS, { _id: { $oid: p._id } }, { $set: { isActive: next } });
      setProducts(prev => prev.map(x => x._id === p._id ? { ...x, isActive: next } : x));
      toast[next ? 'success' : 'info'](`"${p.name}" ${next ? 'activated' : 'deactivated'}`);
    } catch (err: any) {
      toast.error(err.message || 'Update failed');
    }
  }

  async function handleAssignStock(e: React.FormEvent) {
    e.preventDefault();
    if (!showStock || !stockBranch) return;
    setSavingStock(true);
    try {
      await updateOne(
        Collections.BRANCH_STOCK,
        { branchId: stockBranch, productId: showStock._id },
        { $set: { branchId: stockBranch, productId: showStock._id, quantity: stockQty, updatedAt: new Date().toISOString() } },
        true
      );
      const branch = branches.find(b => b._id === stockBranch);
      toast.success(`Stock assigned to ${branch?.name ?? 'branch'}`);
      setShowStock(null); setStockBranch(''); setStockQty(0);
    } catch (err: any) {
      toast.error(err.message || 'Stock assign failed');
    } finally {
      setSavingStock(false);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Package className="w-6 h-6 text-amber-500" />
            Products
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage your product catalogue and branch stock</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCSV(filtered)}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 text-sm px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-lg transition-colors disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Export
          </button>
          <button
            onClick={() => fetchAll(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New Product
          </button>
        </div>
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.total}</p>
            <p className="text-xs text-slate-500">Total Products</p>
          </div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
            <CheckCircle className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.active}</p>
            <p className="text-xs text-slate-500">Active</p>
          </div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
            <Tag className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.categories}</p>
            <p className="text-xs text-slate-500">Categories</p>
          </div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-lg font-bold text-slate-800 leading-tight">{fmt(stats.avgPrice)}</p>
            <p className="text-xs text-slate-500">Avg. Price</p>
          </div>
        </div>
      </div>

      {/* ── Filters bar ────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, SKU, category, description…"
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Status filter */}
          <div className="flex gap-1.5">
            {(['all', 'active', 'inactive'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                  statusFilter === s
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 shrink-0">
            <button
              onClick={() => setView('table')}
              className={`p-1.5 rounded-md transition-colors ${view === 'table' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400 hover:text-slate-600'}`}
              title="Table view"
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              onClick={() => setView('grid')}
              className={`p-1.5 rounded-md transition-colors ${view === 'grid' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400 hover:text-slate-600'}`}
              title="Grid view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Category chips */}
        {categories.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            {categories.map(c => (
              <button
                key={c}
                onClick={() => setCatFilter(c)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors capitalize ${
                  catFilter === c
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {c === 'all' ? 'All Categories' : c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Results count ───────────────────────────────────────────────────── */}
      {!loading && (
        <p className="text-xs text-slate-400 px-1">
          Showing <strong className="text-slate-600">{filtered.length}</strong> of {products.length} products
          {(search || catFilter !== 'all' || statusFilter !== 'all') && ' (filtered)'}
        </p>
      )}

      {/* ── Product list / grid ─────────────────────────────────────────────── */}
      {loading ? (
        <div className={view === 'grid'
          ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
          : 'space-y-2'
        }>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-14 text-center text-slate-400">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-semibold text-slate-500">No products found</p>
          <p className="text-sm mt-1">
            {search ? `No results for "${search}".` : 'Try adjusting the filters.'}
          </p>
        </div>
      ) : view === 'grid' ? (
        /* ── Grid view ──────────────────────────────────────────────────────── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(p => (
            <div
              key={p._id}
              className={`bg-white rounded-xl border shadow-sm p-4 flex flex-col gap-3 transition-all hover:shadow-md ${
                p.isActive ? 'border-slate-100' : 'border-slate-200 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{p.name}</p>
                  {p.sku && (
                    <p className="text-xs font-mono text-slate-400 mt-0.5">{p.sku}</p>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                  p.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {p.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>

              {p.category && (
                <span className="self-start text-xs px-2.5 py-0.5 bg-purple-50 text-purple-700 rounded-full font-medium">
                  {p.category}
                </span>
              )}

              {p.description && (
                <p className="text-xs text-slate-400 line-clamp-2">{p.description}</p>
              )}

              <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-100">
                <div>
                  <p className="font-bold text-slate-800">{fmt(p.unitPrice)}</p>
                  <p className="text-xs text-slate-400">per {p.unit}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setShowStock(p); setStockBranch(''); setStockQty(0); }}
                    className="text-xs px-2.5 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                  >
                    Stock
                  </button>
                  <button
                    onClick={() => openEdit(p)}
                    className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleToggleActive(p)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      p.isActive
                        ? 'text-green-500 hover:text-slate-400 hover:bg-slate-50'
                        : 'text-slate-300 hover:text-green-500 hover:bg-green-50'
                    }`}
                    title={p.isActive ? 'Deactivate' : 'Activate'}
                  >
                    {p.isActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ── Table view ─────────────────────────────────────────────────────── */
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left border-b border-slate-100">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Product</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">SKU</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Category</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Unit Price</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Unit</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(p => (
                  <tr key={p._id} className={`hover:bg-slate-50/70 transition-colors ${!p.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{p.name}</p>
                      {p.description && (
                        <p className="text-xs text-slate-400 truncate max-w-[200px]">{p.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{p.sku || '—'}</td>
                    <td className="px-4 py-3">
                      {p.category
                        ? <span className="text-xs px-2.5 py-0.5 bg-purple-50 text-purple-700 rounded-full font-medium">{p.category}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800">{fmt(p.unitPrice)}</td>
                    <td className="px-4 py-3 text-slate-500 capitalize">{p.unit}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        p.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {p.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => { setShowStock(p); setStockBranch(''); setStockQty(0); }}
                          className="text-xs px-2.5 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                        >
                          Stock
                        </button>
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(p)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            p.isActive
                              ? 'text-green-500 hover:text-slate-400 hover:bg-slate-50'
                              : 'text-slate-300 hover:text-green-500 hover:bg-green-50'
                          }`}
                          title={p.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {p.isActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleToggleActive(p)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title={p.isActive ? 'Deactivate product' : 'Activate product'}
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                  <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-slate-500">
                    {filtered.length} product{filtered.length !== 1 ? 's' : ''}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold text-slate-700">
                    Avg: {fmt(filtered.length > 0 ? filtered.reduce((s, p) => s + p.unitPrice, 0) / filtered.length : 0)}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Product form modal ──────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] sm:max-w-lg max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">
                {editing ? 'Edit Product' : 'New Product'}
              </h3>
              <button
                onClick={() => { setShowForm(false); setEditing(null); }}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center gap-2">
                <XCircle className="w-4 h-4 shrink-0" />{formError}
              </div>
            )}

            <form onSubmit={handleSave} className="overflow-y-auto flex-1 p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Product Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  required
                  placeholder="e.g. Indomie Chicken Noodles"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">SKU</label>
                  <input
                    type="text"
                    value={form.sku}
                    onChange={e => setForm(p => ({ ...p, sku: e.target.value }))}
                    placeholder="Optional"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Category</label>
                  <input
                    type="text"
                    value={form.category}
                    onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                    placeholder="e.g. Food"
                    list="category-suggestions"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <datalist id="category-suggestions">
                    {categories.filter(c => c !== 'all').map(c => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Unit Price (₦) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.unitPrice}
                    onChange={e => setForm(p => ({ ...p, unitPrice: e.target.value }))}
                    required
                    placeholder="0.00"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Unit</label>
                  <select
                    value={form.unit}
                    onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={2}
                  placeholder="Optional product description…"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                />
              </div>

              {/* Cuttable toggle */}
              <div className="p-3 border border-slate-200 rounded-xl space-y-3">
                <button
                  type="button"
                  onClick={() => setForm(p => ({ ...p, isCuttable: !p.isCuttable, unitLengthInches: '' }))}
                  className="w-full flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2">
                    <Scissors className="w-4 h-4 text-slate-500" />
                    <div className="text-left">
                      <p className="text-sm font-medium text-slate-700">Cuttable Product</p>
                      <p className="text-xs text-slate-400">Can be cut into smaller pieces and sold</p>
                    </div>
                  </div>
                  {form.isCuttable
                    ? <ToggleRight className="w-6 h-6 text-amber-500 flex-shrink-0" />
                    : <ToggleLeft className="w-6 h-6 text-slate-300 flex-shrink-0" />}
                </button>
                {form.isCuttable && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                      Full Unit Length (inches) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="8.6"
                      step="0.1"
                      value={form.unitLengthInches}
                      onChange={e => setForm(p => ({ ...p, unitLengthInches: e.target.value }))}
                      placeholder="e.g. 43 for a 3ft 7in stone"
                      className="w-full px-3 py-2.5 border border-amber-300 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 bg-amber-50/30"
                    />
                    <p className="text-xs text-slate-400 mt-1">
                      Minimum cut will be 8.5". This is the length of one full piece in stock.
                    </p>
                  </div>
                )}
              </div>

              {/* Price preview */}
              {form.unitPrice && (
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800">
                  Price preview: <strong>{fmt(parseFloat(form.unitPrice) || 0)}</strong> per {form.unit || 'unit'}
                </div>
              )}

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
                  {editing ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Assign branch stock modal ───────────────────────────────────────── */}
      {showStock && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] sm:max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">Assign Branch Stock</h3>
              <button
                onClick={() => setShowStock(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5">
              <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-100 rounded-xl mb-5">
                <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                  <Package className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-800 text-sm">{showStock.name}</p>
                  <p className="text-xs text-amber-700">{fmt(showStock.unitPrice)} / {showStock.unit}</p>
                </div>
              </div>

              <form onSubmit={handleAssignStock} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Branch <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={stockBranch}
                    onChange={e => setStockBranch(e.target.value)}
                    required
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">Select branch…</option>
                    {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Quantity</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={stockQty}
                    onChange={e => setStockQty(Number(e.target.value))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="0"
                  />
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowStock(null)}
                    className="flex-1 py-2.5 border border-slate-200 rounded-xl text-slate-600 font-medium text-sm hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingStock}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl font-medium text-sm transition-colors"
                  >
                    {savingStock
                      ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <Check className="w-4 h-4" />}
                    Assign Stock
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}