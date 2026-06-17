import { useEffect, useState } from 'react';
import { find, insertOne, updateOne, deleteOne, Collections } from '../../lib/api';
import type { Warehouse, Product, WarehouseStock } from '../../lib/types';
import { Plus, Edit2, Trash2, Warehouse as WIcon, X, Check, Package, ChevronDown, ChevronUp } from 'lucide-react';

type Form = { name: string; location: string; description: string };
const BLANK: Form = { name: '', location: '', description: '' };

interface StockWithProduct extends WarehouseStock { product: Product }

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts]     = useState<Product[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [editing, setEditing]       = useState<Warehouse | null>(null);
  const [form, setForm]             = useState<Form>(BLANK);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [stock, setStock]           = useState<Record<string, StockWithProduct[]>>({});
  const [showStockForm, setShowStockForm] = useState<string | null>(null);
  const [stockForm, setStockForm]   = useState({ product_id: '', quantity: 0 });
  const [savingStock, setSavingStock] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const [ws, ps] = await Promise.all([
      find(Collections.WAREHOUSES, {}, { sort: { name: 1 } }),
      find(Collections.PRODUCTS, { isActive: true }, { sort: { name: 1 } }),
    ]);
    setWarehouses(ws as Warehouse[]);
    setProducts(ps as Product[]);
    setLoading(false);
  }

  // AFTER:
  async function fetchStock(warehouseId: string) {
    const stockData = await find(Collections.WAREHOUSE_STOCK, { warehouseId });
    setStock(prev => ({
      ...prev,
      [warehouseId]: (stockData as any[]).map(s => ({
        _id:         s.product_id,
        warehouseId: s.warehouse_id,
        productId:   s.product_id,
        quantity:    s.quantity,
        updatedAt:   s.updated_at,
        product: s.product ? {
          _id:       s.product.id,
          id:        s.product.id,
          name:      s.product.name,
          unit:      s.product.unit,
          unitPrice: parseFloat(s.product.unit_price ?? s.product.current_price ?? 0),
        } : undefined,
      })).filter(s => s.product),
    }));
  }

  function toggleExpand(id: string) {
    setExpanded(expanded === id ? null : id);
    if (expanded !== id && !stock[id]) fetchStock(id);
  }

  function f(field: keyof Form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name required'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, updatedAt: new Date().toISOString() };
      if (editing) {
        await updateOne(Collections.WAREHOUSES, { _id: { $oid: editing._id } }, { $set: payload });
      } else {
        await insertOne(Collections.WAREHOUSES, { ...payload, isActive: true, createdAt: new Date().toISOString() });
      }
      await fetchAll();
      setShowForm(false); setEditing(null);
    } catch (err: any) { setError(err.message || 'Save failed'); }
    setSaving(false);
  }

  async function handleDelete(w: Warehouse) {
    if (!confirm(`Delete warehouse "${w.name}"?`)) return;
    await deleteOne(Collections.WAREHOUSES, { _id: { $oid: w._id } });
    setWarehouses(prev => prev.filter(x => x._id !== w._id));
  }

  async function handleSaveStock(e: React.FormEvent, warehouseId: string) {
    e.preventDefault();
    if (!stockForm.product_id) return;
    setSavingStock(true);
    await updateOne(
      Collections.WAREHOUSE_STOCK,
      { warehouseId, productId: stockForm.product_id },
      { $set: { warehouseId, productId: stockForm.product_id, quantity: stockForm.quantity, updatedAt: new Date().toISOString() } },
      true
    );
    await fetchStock(warehouseId);
    setShowStockForm(null);
    setStockForm({ product_id: '', quantity: 0 });
    setSavingStock(false);
  }

  async function deleteStock(productId: string, warehouseId: string, productName: string) {
    if (!confirm(`Remove "${productName}" from stock? This cannot be undone.`)) return;
    try {
      await deleteOne(Collections.WAREHOUSE_STOCK, { warehouseId, productId });
      setStock(prev => ({ ...prev, [warehouseId]: (prev[warehouseId] || []).filter(s => s.productId !== productId) }));
    } catch (err: any) {
      alert(err.message || 'Failed to delete stock item');
    }
  }

  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Warehouses</h1>
          <p className="text-slate-500 text-sm mt-1">Manage warehouses and stock</p>
        </div>
        <button onClick={() => { setEditing(null); setForm(BLANK); setShowForm(true); setError(''); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
          <Plus className="w-4 h-4" />New Warehouse
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">{editing ? 'Edit Warehouse' : 'New Warehouse'}</h3>
              <button onClick={() => { setShowForm(false); setEditing(null); }}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
                <input type="text" value={form.name} onChange={f('name')} required
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Location</label>
                <input type="text" value={form.location} onChange={f('location')}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea value={form.description} onChange={f('description')} rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
                  {saving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                  {editing ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[...Array(2)].map((_, i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      ) : warehouses.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center text-slate-400 shadow-sm border border-slate-100">
          <WIcon className="w-12 h-12 mx-auto mb-3 opacity-40" /><p>No warehouses yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {warehouses.map(w => (
            <div key={w._id} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="flex items-center justify-between p-5">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                    <WIcon className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">{w.name}</p>
                    <p className="text-sm text-slate-500">{w.location || 'No location'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setEditing(w); setForm({ name: w.name, location: w.location || '', description: w.description || '' }); setShowForm(true); setError(''); }}
                    className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(w)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                  <button onClick={() => toggleExpand(w._id)}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors">
                    <Package className="w-4 h-4" />Stock
                    {expanded === w._id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              {expanded === w._id && (
                <div className="border-t border-slate-100 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium text-slate-700">Stock Items</h4>
                    <button onClick={() => { setShowStockForm(showStockForm === w._id ? null : w._id); setStockForm({ product_id: '', quantity: 0 }); }}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors">
                      <Plus className="w-3 h-3" />Add / Update Stock
                    </button>
                  </div>

                  {showStockForm === w._id && (
                    <form onSubmit={e => handleSaveStock(e, w._id)} className="flex gap-3 mb-4 p-4 bg-amber-50 rounded-lg flex-wrap">
                      <select value={stockForm.product_id} onChange={e => setStockForm(f => ({ ...f, product_id: e.target.value }))} required
                        className="flex-1 min-w-40 px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
                        <option value="">Select product...</option>
                        {products.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                      </select>
                      <input type="number" min="0" step="0.01" value={stockForm.quantity} onChange={e => setStockForm(f => ({ ...f, quantity: Number(e.target.value) }))}
                        className="w-32 px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="Quantity" />
                      <button type="submit" disabled={savingStock} className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm transition-colors">
                        {savingStock ? <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5" />}Save
                      </button>
                    </form>
                  )}

                  {(stock[w._id] || []).length === 0 ? (
                    <p className="text-slate-400 text-sm text-center py-4">No stock items yet</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left border-b border-slate-100">
                            <th className="pb-2 font-medium text-slate-600">Product</th>
                            <th className="pb-2 font-medium text-slate-600 text-right">Quantity</th>
                            <th className="pb-2 font-medium text-slate-600 text-right">Price</th>
                            <th className="pb-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {(stock[w._id] || []).map(item => (
                            <tr key={item._id} className="hover:bg-slate-50">
                              <td className="py-2.5 font-medium text-slate-800">{item.product?.name}</td>
                              <td className={`py-2.5 text-right font-semibold ${Number(item.quantity) <= 5 ? 'text-red-600' : Number(item.quantity) <= 20 ? 'text-amber-600' : 'text-green-600'}`}>
                                {Number(item.quantity).toLocaleString()} {item.product?.unit}
                              </td>
                              <td className="py-2.5 text-right text-slate-500">{fmt(item.product?.unitPrice || 0)}</td>
                              <td className="py-2.5">
                                <div className="flex items-center gap-2 justify-end">
                                  <button
                                    onClick={() => {
                                      setShowStockForm(w._id);
                                      setStockForm({ product_id: item.productId, quantity: Number(item.quantity) });
                                    }}
                                    className="text-slate-300 hover:text-amber-500 transition-colors">
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => deleteStock(item.productId, w._id, item.product?.name || 'this item')} className="text-slate-300 hover:text-red-500 transition-colors">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
