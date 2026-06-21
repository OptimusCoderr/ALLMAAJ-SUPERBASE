import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { find, Collections, getAuthToken } from '../lib/api';
import type { Branch, Product } from '../lib/types';
import {
  Search, Package, Plus, X, Check, Clock, CheckCircle, XCircle,
  RefreshCw, TrendingDown, AlertTriangle, DollarSign, ArrowUpDown,
  Pencil, Trash2,
} from 'lucide-react';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

function authFetch(path: string, token: string, options: RequestInit = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers as any) },
  }).then(async r => {
    const j = await r.json();
    if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`);
    return j?.data ?? j;
  });
}

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface StockItem { productId: string; product: any; quantity: number; updatedAt: string; }
interface StockRequest {
  id: string; branch_id: string; branch_name: string; product_id: string;
  product_name: string; product_unit: string; quantity: number;
  requested_by_name: string; status: string; notes: string | null; created_at: string;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'approved' || status === 'accepted') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
        <CheckCircle className="w-3.5 h-3.5" /> Approved
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
        <XCircle className="w-3.5 h-3.5" /> Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
      <Clock className="w-3.5 h-3.5" /> Pending
    </span>
  );
}

export default function BranchStockPage() {
  const { user } = useAuth();
  const token = getAuthToken() ?? '';
  const isAdmin = user?.role?.toLowerCase() === 'admin';

  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState(user?.branchId || '');
  const [stock, setStock] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);

  // Sort & filter state for stock table
  const [sortBy, setSortBy] = useState<'name' | 'quantity' | 'price' | 'updated'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showLowOnly, setShowLowOnly] = useState(false);

  // Toast notification
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Admin: all pending requests
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsBranchFilter, setRequestsBranchFilter] = useState('');

  // Staff: their own requests (all statuses)
  const [myRequests, setMyRequests] = useState<StockRequest[]>([]);
  const [myRequestsLoading, setMyRequestsLoading] = useState(false);

  const [tab, setTab] = useState<'stock' | 'requests' | 'my-requests'>('stock');

  // Staff request form
  const [showReqForm, setShowReqForm] = useState(false);
  const [reqForm, setReqForm] = useState({ productId: '', quantity: 1, notes: '' });
  const [reqSaving, setReqSaving] = useState(false);
  const [reqError, setReqError] = useState('');

  // Admin direct add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ productId: '', quantity: 1, sourceType: 'warehouse', warehouseId: '' });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');

  // Admin approve modal
  const [approving, setApproving] = useState<StockRequest | null>(null);
  const [approveForm, setApproveForm] = useState({ sourceType: 'warehouse', warehouseId: '' });
  const [approveSaving, setApproveSaving] = useState(false);
  const [approveError, setApproveError] = useState('');

  // Admin edit stock modal
  const [editingStock, setEditingStock] = useState<StockItem | null>(null);
  const [editForm, setEditForm] = useState({ quantity: 0 });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }).then(data => {
      setBranches(data as Branch[]);
      if (!selectedBranch && isAdmin && data[0]) setSelectedBranch((data[0] as Branch)._id);
    });
    find(Collections.PRODUCTS, { isActive: true }).then(d => setProducts(d as Product[]));
  }, []);

  useEffect(() => {
    if (!user) return;
    if (isAdmin) {
      find(Collections.WAREHOUSES, {}).then(d => setWarehouses(d));
      fetchRequests();
    } else {
      fetchMyRequests();
    }
  }, [user?.role]);

  useEffect(() => { if (selectedBranch) fetchStock(); }, [selectedBranch]);

  async function fetchStock() {
    setLoading(true);
    try {
      const data = await authFetch(`/api/branches/${selectedBranch}/stock`, token);
      const rows = Array.isArray(data) ? data : [];
      setStock(rows.map((s: any) => ({
        productId: s.product_id,
        quantity:  Number(s.quantity),
        updatedAt: s.updated_at,
        product: s.product ? {
          _id: s.product.id, id: s.product.id,
          name: s.product.name, unit: s.product.unit,
          category: s.product.category,
          unitPrice: parseFloat(s.product.unit_price ?? s.product.current_price ?? 0),
        } : undefined,
      })).filter((s: any) => s.product));
    } catch {}
    setLoading(false);
  }

  async function fetchRequests() {
    setRequestsLoading(true);
    try {
      const data = await authFetch('/api/branches/stock-requests?status=pending', token);
      setRequests(Array.isArray(data) ? data : []);
    } catch {}
    setRequestsLoading(false);
  }

  async function fetchMyRequests() {
    setMyRequestsLoading(true);
    try {
      const data = await authFetch('/api/branches/stock-requests/mine', token);
      setMyRequests(Array.isArray(data) ? data : []);
    } catch {}
    setMyRequestsLoading(false);
  }

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!reqForm.productId) { setReqError('Select a product'); return; }
    setReqSaving(true); setReqError('');
    try {
      await authFetch('/api/branches/stock-requests', token, {
        method: 'POST',
        body: JSON.stringify({ branchId: selectedBranch, productId: reqForm.productId, quantity: reqForm.quantity, notes: reqForm.notes }),
      });
      setShowReqForm(false);
      setReqForm({ productId: '', quantity: 1, notes: '' });
      fetchMyRequests();
      setTab('my-requests');
      showToast('Stock request submitted successfully');
    } catch (err: any) { setReqError(err.message || 'Failed to submit'); }
    setReqSaving(false);
  }

  async function submitDirectAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.productId) { setAddError('Select a product'); return; }
    if (addForm.sourceType === 'warehouse' && !addForm.warehouseId) { setAddError('Select a warehouse'); return; }
    setAddSaving(true); setAddError('');
    try {
      await authFetch(`/api/branches/${selectedBranch}/stock/add`, token, {
        method: 'POST',
        body: JSON.stringify(addForm),
      });
      setShowAddForm(false);
      setAddForm({ productId: '', quantity: 1, sourceType: 'warehouse', warehouseId: '' });
      fetchStock();
      showToast('Stock added successfully');
    } catch (err: any) { setAddError(err.message || 'Failed to add stock'); }
    setAddSaving(false);
  }

  async function approveRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!approving) return;
    if (approveForm.sourceType === 'warehouse' && !approveForm.warehouseId) { setApproveError('Select a warehouse'); return; }
    setApproveSaving(true); setApproveError('');
    try {
      await authFetch(`/api/branches/stock-requests/${approving.id}/approve`, token, {
        method: 'PATCH',
        body: JSON.stringify({ sourceType: approveForm.sourceType, warehouseId: approveForm.warehouseId || null }),
      });
      const productName = approving.product_name;
      setApproving(null);
      fetchRequests();
      if (approving.branch_id === selectedBranch) fetchStock();
      showToast(`Approved request for ${productName}`);
    } catch (err: any) { setApproveError(err.message || 'Failed to approve'); }
    setApproveSaving(false);
  }

  async function rejectRequest(req: StockRequest) {
    if (!confirm(`Reject stock request for "${req.product_name}" at ${req.branch_name}?`)) return;
    try {
      await authFetch(`/api/branches/stock-requests/${req.id}/reject`, token, { method: 'PATCH' });
      fetchRequests();
      showToast(`Rejected request for ${req.product_name}`, 'error');
    } catch (err: any) { alert(err.message || 'Failed to reject'); }
  }

  async function submitEditStock(e: React.FormEvent) {
    e.preventDefault();
    if (!editingStock) return;
    setEditSaving(true); setEditError('');
    try {
      await authFetch(`/api/branches/${selectedBranch}/stock/${editingStock.productId}`, token, {
        method: 'PUT',
        body: JSON.stringify({ quantity: editForm.quantity }),
      });
      setEditingStock(null);
      fetchStock();
      showToast('Stock quantity updated');
    } catch (err: any) { setEditError(err.message || 'Failed to update stock'); }
    setEditSaving(false);
  }

  async function deleteStockItem(item: StockItem) {
    if (!confirm(`Remove "${item.product?.name}" from ${branchName} stock? This cannot be undone.`)) return;
    try {
      await authFetch(`/api/branches/${selectedBranch}/stock/${item.productId}`, token, { method: 'DELETE' });
      fetchStock();
      showToast(`Removed ${item.product?.name} from stock`, 'error');
    } catch (err: any) { alert(err.message || 'Failed to remove stock item'); }
  }

  function toggleSort(col: typeof sortBy) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }

  const filtered = useMemo(() => {
    let items = stock.filter(s =>
      s.product?.name?.toLowerCase().includes(search.toLowerCase()) ||
      (s.product?.category || '').toLowerCase().includes(search.toLowerCase())
    );
    if (showLowOnly) items = items.filter(s => s.quantity <= 20);
    return [...items].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name')     cmp = (a.product?.name || '').localeCompare(b.product?.name || '');
      else if (sortBy === 'quantity') cmp = a.quantity - b.quantity;
      else if (sortBy === 'price')    cmp = (a.product?.unitPrice || 0) - (b.product?.unitPrice || 0);
      else if (sortBy === 'updated')  cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [stock, search, showLowOnly, sortBy, sortDir]);

  const branchName = branches.find(b => b._id === selectedBranch)?.name || '';
  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  const pendingMyRequests = myRequests.filter(r => r.status === 'pending').length;

  // Summary stats for current branch
  const critical  = stock.filter(s => s.quantity <= 5).length;
  const low       = stock.filter(s => s.quantity > 5 && s.quantity <= 20).length;
  const totalValue = stock.reduce((sum, s) => sum + s.quantity * (s.product?.unitPrice || 0), 0);

  // Admin requests filtered by branch
  const filteredRequests = requestsBranchFilter
    ? requests.filter(r => r.branch_id === requestsBranchFilter)
    : requests;

  const requestBranches = useMemo(() => {
    const map = new Map<string, string>();
    requests.forEach(r => map.set(r.branch_id, r.branch_name));
    return Array.from(map.entries());
  }, [requests]);

  function SortIcon({ col }: { col: typeof sortBy }) {
    return <ArrowUpDown className={`w-3 h-3 inline ml-1 ${sortBy === col ? 'text-amber-500' : 'text-slate-300'}`} />;
  }

  return (
    <div className="p-6 space-y-6">

      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium animate-in fade-in slide-in-from-top-2 ${toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Branch Stock</h1>
          <p className="text-slate-500 text-sm mt-1">Current inventory at each branch</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button onClick={() => { setShowAddForm(true); setAddError(''); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium text-sm transition-colors">
              <Plus className="w-4 h-4" />Add Stock
            </button>
          )}
          <button onClick={() => { setShowReqForm(true); setReqError(''); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
            <Plus className="w-4 h-4" />{isAdmin ? 'Add Request' : 'Request Stock'}
          </button>
        </div>
      </div>

      {/* Summary Stats — shown once stock is loaded */}
      {stock.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Products</p>
              <p className="text-xl font-bold text-slate-800">{stock.length}</p>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Critical (≤5)</p>
              <p className={`text-xl font-bold ${critical > 0 ? 'text-red-600' : 'text-slate-800'}`}>{critical}</p>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
              <TrendingDown className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Low Stock (6–20)</p>
              <p className={`text-xl font-bold ${low > 0 ? 'text-amber-600' : 'text-slate-800'}`}>{low}</p>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
              <DollarSign className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Value</p>
              <p className="text-base font-bold text-slate-800 leading-tight">{fmt(totalValue)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200">
        <button onClick={() => setTab('stock')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'stock' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          Stock
        </button>

        {isAdmin && (
          <button onClick={() => { setTab('requests'); fetchRequests(); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${tab === 'requests' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            Pending Requests
            {requests.length > 0 && (
              <span className="bg-amber-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                {requests.length}
              </span>
            )}
          </button>
        )}

        {!isAdmin && (
          <button onClick={() => { setTab('my-requests'); fetchMyRequests(); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${tab === 'my-requests' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            My Requests
            {pendingMyRequests > 0 && (
              <span className="bg-amber-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                {pendingMyRequests}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Stock Tab */}
      {tab === 'stock' && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            {isAdmin ? (
              <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
                className="px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
              </select>
            ) : (
              <div className="px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 bg-slate-50 text-sm">
                {branches.find(b => b._id === selectedBranch)?.name || 'Your Branch'}
              </div>
            )}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search products or category..."
                className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            {/* Low stock filter toggle */}
            <button onClick={() => setShowLowOnly(v => !v)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${showLowOnly ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-200 text-slate-600 hover:border-amber-300 hover:text-amber-600'}`}>
              <AlertTriangle className="w-4 h-4" />Low Stock
            </button>
          </div>

          {branchName && (
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="font-semibold text-slate-700 flex items-center gap-2">
                <Package className="w-5 h-5 text-amber-500" />
                {branchName} — {filtered.length} product{filtered.length !== 1 ? 's' : ''}
              </h3>
              {/* Stock level legend */}
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Critical ≤5</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />Low ≤20</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />OK &gt;20</span>
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>{search || showLowOnly ? 'No products match your filters' : 'No stock records found'}</p>
              {(search || showLowOnly) && (
                <button onClick={() => { setSearch(''); setShowLowOnly(false); }}
                  className="mt-2 text-amber-500 text-sm hover:underline">
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-slate-200">
                    <th className="pb-3 font-medium text-slate-600 cursor-pointer select-none hover:text-slate-800" onClick={() => toggleSort('name')}>
                      Product<SortIcon col="name" />
                    </th>
                    <th className="pb-3 font-medium text-slate-600">Category</th>
                    <th className="pb-3 font-medium text-slate-600">Unit</th>
                    <th className="pb-3 font-medium text-slate-600 text-right cursor-pointer select-none hover:text-slate-800" onClick={() => toggleSort('quantity')}>
                      Quantity<SortIcon col="quantity" />
                    </th>
                    <th className="pb-3 font-medium text-slate-600 text-right cursor-pointer select-none hover:text-slate-800" onClick={() => toggleSort('price')}>
                      Price<SortIcon col="price" />
                    </th>
                    <th className="pb-3 font-medium text-slate-600 cursor-pointer select-none hover:text-slate-800" onClick={() => toggleSort('updated')}>
                      Updated<SortIcon col="updated" />
                    </th>
                    {isAdmin && <th className="pb-3 font-medium text-slate-600 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(item => (
                    <tr key={item.productId} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 font-medium text-slate-800">{item.product?.name}</td>
                      <td className="py-3 text-slate-500">{item.product?.category || '-'}</td>
                      <td className="py-3 text-slate-500">{item.product?.unit}</td>
                      <td className="py-3 text-right">
                        <span className={`inline-flex items-center justify-center min-w-[2.5rem] px-2 py-0.5 rounded-full text-xs font-bold ${
                          item.quantity <= 5  ? 'bg-red-100 text-red-700' :
                          item.quantity <= 20 ? 'bg-amber-100 text-amber-700' :
                                               'bg-green-100 text-green-700'
                        }`}>
                          {item.quantity.toLocaleString()}
                        </span>
                      </td>
                      <td className="py-3 text-right text-slate-600">{fmt(item.product?.unitPrice || 0)}</td>
                      <td className="py-3 text-slate-400 text-xs" title={new Date(item.updatedAt).toLocaleString()}>
                        {relativeTime(item.updatedAt)}
                      </td>
                      {isAdmin && (
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setEditingStock(item); setEditForm({ quantity: item.quantity }); setEditError(''); }}
                              title="Edit quantity"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => deleteStockItem(item)}
                              title="Remove from stock"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Admin: Pending Requests Tab */}
      {tab === 'requests' && isAdmin && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <h3 className="font-semibold text-slate-700">Pending Stock Requests</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {filteredRequests.length} request{filteredRequests.length !== 1 ? 's' : ''}
                {requestBranches.length > 1 ? ` from ${requestBranches.length} branches` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Branch filter — only shows when there are multiple branches in the request list */}
              {requestBranches.length > 1 && (
                <select value={requestsBranchFilter} onChange={e => setRequestsBranchFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500">
                  <option value="">All branches</option>
                  {requestBranches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              )}
              <button onClick={fetchRequests} disabled={requestsLoading}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
                <RefreshCw className={`w-4 h-4 ${requestsLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>

          {requestsLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>{requestsBranchFilter ? 'No pending requests for this branch' : 'No pending requests'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRequests.map(req => (
                <div key={req.id} className="border border-slate-200 border-l-4 border-l-amber-400 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold text-slate-800">{req.product_name}</span>
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{req.quantity} {req.product_unit}</span>
                      <StatusBadge status={req.status} />
                    </div>
                    <p className="text-sm text-slate-500">Branch: <span className="font-medium text-slate-700">{req.branch_name}</span></p>
                    <p className="text-sm text-slate-500">
                      By <span className="font-medium text-slate-700">{req.requested_by_name}</span>
                      {' · '}
                      <span title={new Date(req.created_at).toLocaleString()}>{relativeTime(req.created_at)}</span>
                    </p>
                    {req.notes && <p className="text-xs text-slate-400 mt-1 italic">"{req.notes}"</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => { setApproving(req); setApproveForm({ sourceType: 'warehouse', warehouseId: '' }); setApproveError(''); }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors">
                      <CheckCircle className="w-4 h-4" />Approve
                    </button>
                    <button onClick={() => rejectRequest(req)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-sm font-medium transition-colors">
                      <XCircle className="w-4 h-4" />Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Staff: My Requests Tab */}
      {tab === 'my-requests' && !isAdmin && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-slate-700">My Stock Requests</h3>
              <p className="text-xs text-slate-400 mt-0.5">{myRequests.length} total · {pendingMyRequests} pending</p>
            </div>
            <button onClick={fetchMyRequests} disabled={myRequestsLoading}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
              <RefreshCw className={`w-4 h-4 ${myRequestsLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          {myRequestsLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
          ) : myRequests.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>No requests yet. Use "Request Stock" to submit one.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {myRequests.map(req => (
                <div key={req.id} className={`border rounded-xl p-4 border-l-4 ${
                  req.status === 'approved' || req.status === 'accepted'
                    ? 'border-slate-100 border-l-green-400'
                    : req.status === 'rejected'
                    ? 'border-red-50 border-l-red-400'
                    : 'border-slate-200 border-l-amber-400'
                }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold text-slate-800">{req.product_name}</span>
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{req.quantity} {req.product_unit}</span>
                      </div>
                      <p className="text-xs text-slate-400" title={new Date(req.created_at).toLocaleString()}>
                        {relativeTime(req.created_at)}
                      </p>
                      {req.notes && <p className="text-xs text-slate-500 mt-1 italic">"{req.notes}"</p>}
                    </div>
                    <StatusBadge status={req.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Staff Request Modal */}
      {showReqForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">Request Stock</h3>
              <button onClick={() => setShowReqForm(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            {reqError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{reqError}</div>}
            <form onSubmit={submitRequest} className="space-y-4">
              {isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Branch</label>
                  <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                    {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Product *</label>
                <select value={reqForm.productId} onChange={e => setReqForm(f => ({ ...f, productId: e.target.value }))} required
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                  <option value="">Select product...</option>
                  {products.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Quantity *</label>
                <input type="number" min="0.01" step="0.01" value={reqForm.quantity}
                  onChange={e => setReqForm(f => ({ ...f, quantity: Number(e.target.value) }))} required
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea value={reqForm.notes} onChange={e => setReqForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                  placeholder="Optional — reason for request, urgency, etc."
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowReqForm(false)}
                  className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
                <button type="submit" disabled={reqSaving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
                  {reqSaving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Direct Add Modal */}
      {showAddForm && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">Add Stock to Branch</h3>
              <button onClick={() => setShowAddForm(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
              Adding directly to: <span className="font-semibold">{branchName}</span>
            </div>
            {addError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{addError}</div>}
            <form onSubmit={submitDirectAdd} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Branch</label>
                <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                  {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Product *</label>
                <select value={addForm.productId} onChange={e => setAddForm(f => ({ ...f, productId: e.target.value }))} required
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                  <option value="">Select product...</option>
                  {products.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Quantity *</label>
                <input type="number" min="0.01" step="0.01" value={addForm.quantity}
                  onChange={e => setAddForm(f => ({ ...f, quantity: Number(e.target.value) }))} required
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Source *</label>
                <select value={addForm.sourceType} onChange={e => setAddForm(f => ({ ...f, sourceType: e.target.value, warehouseId: '' }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                  <option value="warehouse">From Warehouse</option>
                  <option value="others">Others (External)</option>
                </select>
              </div>
              {addForm.sourceType === 'warehouse' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Warehouse *</label>
                  <select value={addForm.warehouseId} onChange={e => setAddForm(f => ({ ...f, warehouseId: e.target.value }))} required
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                    <option value="">Select warehouse...</option>
                    {warehouses.map((w: any) => <option key={w._id} value={w._id}>{w.name}</option>)}
                  </select>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAddForm(false)}
                  className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
                <button type="submit" disabled={addSaving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium text-sm transition-colors">
                  {addSaving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                  Add Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Edit Stock Modal */}
      {editingStock && isAdmin && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">Edit Stock Quantity</h3>
              <button onClick={() => setEditingStock(null)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm text-slate-700">
              <p className="font-medium">{editingStock.product?.name}</p>
              <p className="text-slate-500 text-xs mt-0.5">
                Current quantity: <span className="font-semibold">{editingStock.quantity.toLocaleString()} {editingStock.product?.unit}</span>
              </p>
              <p className="text-slate-400 text-xs mt-0.5">Branch: {branchName}</p>
            </div>
            {editError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{editError}</div>}
            <form onSubmit={submitEditStock} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Quantity *</label>
                <input
                  type="number" min="0" step="0.01"
                  value={editForm.quantity}
                  onChange={e => setEditForm({ quantity: Number(e.target.value) })}
                  required autoFocus
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <p className="text-xs text-slate-400 mt-1">This sets the exact quantity (does not add to existing).</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditingStock(null)}
                  className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
                <button type="submit" disabled={editSaving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
                  {editSaving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Approve Modal */}
      {approving && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">Approve Stock Request</h3>
              <button onClick={() => setApproving(null)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm text-slate-700">
              <p><span className="font-medium">{approving.product_name}</span> × {approving.quantity} {approving.product_unit}</p>
              <p className="text-slate-500 text-xs mt-1">For {approving.branch_name} · Requested by {approving.requested_by_name}</p>
            </div>
            {approveError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{approveError}</div>}
            <form onSubmit={approveRequest} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Stock Source *</label>
                <select value={approveForm.sourceType} onChange={e => setApproveForm(f => ({ ...f, sourceType: e.target.value, warehouseId: '' }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                  <option value="warehouse">From Warehouse</option>
                  <option value="others">Others (External)</option>
                </select>
              </div>
              {approveForm.sourceType === 'warehouse' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Warehouse *</label>
                  <select value={approveForm.warehouseId} onChange={e => setApproveForm(f => ({ ...f, warehouseId: e.target.value }))} required
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                    <option value="">Select warehouse...</option>
                    {warehouses.map((w: any) => <option key={w._id} value={w._id}>{w.name}</option>)}
                  </select>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setApproving(null)}
                  className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
                <button type="submit" disabled={approveSaving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium text-sm transition-colors">
                  {approveSaving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Approve & Add Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
