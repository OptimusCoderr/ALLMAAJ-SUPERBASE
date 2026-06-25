import { useEffect, useState } from 'react';
import { find, insertOne, updateOne, Collections } from '../../lib/api';
import type { Product, Branch } from '../../lib/types';
import { Plus, Edit2, Trash2, Package, X, Check, Search } from 'lucide-react';

type Form = { name: string; sku: string; description: string; unitPrice: string; unit: string; category: string; isCuttable: boolean; inchesPerPiece: string };
const BLANK: Form = { name: '', sku: '', description: '', unitPrice: '', unit: 'piece', category: '', isCuttable: false, inchesPerPiece: '' };

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<Form>(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showStock, setShowStock] = useState<Product | null>(null);
  const [stockBranch, setStockBranch] = useState('');
  const [stockQty, setStockQty] = useState(0);
  const [savingStock, setSavingStock] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const [prods, brs] = await Promise.all([
      find(Collections.PRODUCTS, {}, { sort: { name: 1 } }),
      find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }),
    ]);
    setProducts(prods as Product[]);
    setBranches(brs as Branch[]);
    setLoading(false);
  }

  function f(field: keyof Form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));
  }

  function openNew() { setEditing(null); setForm(BLANK); setShowForm(true); setError(''); }
  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name, sku: p.sku || '', description: p.description || '',
      unitPrice: String(p.unitPrice), unit: p.unit, category: p.category || '',
      isCuttable: p.isCuttable ?? false,
      inchesPerPiece: p.inchesPerPiece != null ? String(p.inchesPerPiece) : '',
    });
    setShowForm(true); setError('');
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Product name required'); return; }
    setSaving(true); setError('');
    const unitPrice = parseFloat(form.unitPrice) || 0;
    const inchesPerPiece = form.isCuttable && form.inchesPerPiece ? parseFloat(form.inchesPerPiece) : null;
    const payload = {
      name: form.name.trim(), sku: form.sku.trim(), description: form.description.trim(),
      unitPrice, unit: form.unit, category: form.category.trim(),
      isCuttable: form.isCuttable, inchesPerPiece,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (editing) {
        await updateOne(Collections.PRODUCTS, { _id: { $oid: editing._id } }, { $set: payload });
      } else {
        await insertOne(Collections.PRODUCTS, { ...payload, isActive: true, createdAt: new Date().toISOString() });
      }
      await fetchAll();
      setShowForm(false); setEditing(null);
    } catch (err: any) { setError(err.message || 'Save failed'); }
    setSaving(false);
  }

  async function handleDelete(p: Product) {
    if (!confirm(`Deactivate product "${p.name}"?`)) return;
    await updateOne(Collections.PRODUCTS, { _id: { $oid: p._id } }, { $set: { isActive: false } });
    setProducts(prev => prev.map(x => x._id === p._id ? { ...x, isActive: false } : x));
  }

  async function handleAssignStock(e: React.FormEvent) {
    e.preventDefault();
    if (!showStock || !stockBranch) return;
    setSavingStock(true);
    await updateOne(
      Collections.BRANCH_STOCK,
      { branchId: stockBranch, productId: showStock._id },
      { $set: { branchId: stockBranch, productId: showStock._id, quantity: stockQty, updatedAt: new Date().toISOString() } },
      true
    );
    setShowStock(null); setStockBranch(''); setStockQty(0);
    setSavingStock(false);
  }

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.sku || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.category || '').toLowerCase().includes(search.toLowerCase())
  );

  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Products</h1>
          <p className="text-slate-500 text-sm mt-1">Manage product catalog</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
          <Plus className="w-4 h-4" />New Product
        </button>
      </div>

      {showStock && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">Assign Branch Stock</h3>
              <button onClick={() => setShowStock(null)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              Product: <span className="font-semibold">{showStock.name}</span> | Price:{' '}
              <span className="font-semibold text-amber-600">{fmt(showStock.unitPrice)}</span>
            </p>
            <form onSubmit={handleAssignStock} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Branch</label>
                <select value={stockBranch} onChange={e => setStockBranch(e.target.value)} required
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                  <option value="">Select branch...</option>
                  {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Quantity</label>
                <input type="number" min="0" step="0.01" value={stockQty} onChange={e => setStockQty(Number(e.target.value))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowStock(null)} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
                <button type="submit" disabled={savingStock} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
                  {savingStock ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                  Assign
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">{editing ? 'Edit Product' : 'New Product'}</h3>
              <button onClick={() => { setShowForm(false); setEditing(null); }}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Product Name *</label>
                  <input type="text" value={form.name} onChange={f('name')} required
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">SKU</label>
                  <input type="text" value={form.sku} onChange={f('sku')}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="Optional" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                  <input type="text" value={form.category} onChange={f('category')}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Unit Price (N) *</label>
                  <input type="number" min="0" step="0.01" value={form.unitPrice} onChange={f('unitPrice')} required
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Unit</label>
                  <select value={form.unit} onChange={f('unit')}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                    {['piece','kg','litre','box','carton','bag','roll','pair','set','dozen'].map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input type="checkbox" checked={form.isCuttable}
                      onChange={e => setForm(prev => ({ ...prev, isCuttable: e.target.checked, inchesPerPiece: e.target.checked ? prev.inchesPerPiece : '' }))}
                      className="w-4 h-4 rounded accent-amber-500" />
                    <span className="text-sm font-medium text-slate-700">Cuttable material (can be sold by inches or pieces)</span>
                  </label>
                </div>
                {form.isCuttable && (
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">Inches per piece *</label>
                    <input type="number" min="0.0001" step="0.0001" value={form.inchesPerPiece} onChange={f('inchesPerPiece')} required={form.isCuttable}
                      placeholder="e.g. 12 (12 inches = 1 piece)"
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
                    <p className="text-xs text-slate-400 mt-1">Stock entered in inches will be divided by this value to get pieces</p>
                  </div>
                )}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                  <textarea value={form.description} onChange={f('description')} rows={2}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
                  {saving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                  {editing ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, SKU or category..."
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400"><Package className="w-12 h-12 mx-auto mb-3 opacity-40" /><p>No products found</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium text-slate-600">Product</th>
                  <th className="px-4 py-3 font-medium text-slate-600">SKU</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Category</th>
                  <th className="px-4 py-3 font-medium text-slate-600 text-right">Price</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Unit</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Cuttable</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Status</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(p => (
                  <tr key={p._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{p.sku || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">{p.category || '-'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(p.unitPrice)}</td>
                    <td className="px-4 py-3 text-slate-500">{p.unit}</td>
                    <td className="px-4 py-3">
                      {p.isCuttable ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                          ✂ {p.inchesPerPiece}"
                        </span>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {p.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => { setShowStock(p); setStockBranch(''); setStockQty(0); }}
                          className="text-xs px-2 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded transition-colors">Stock</button>
                        <button onClick={() => openEdit(p)} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleDelete(p)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
