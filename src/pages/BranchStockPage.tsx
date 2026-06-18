import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { find, Collections, getAuthToken } from '../lib/api';
import type { Branch, Product } from '../lib/types';
import { Search, Package, Plus, X, Check, Clock, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

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

  const [branches, setBranches]             = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState(user?.branchId || '');
  const [stock, setStock]                   = useState<StockItem[]>([]);
  const [loading, setLoading]               = useState(false);
  const [search, setSearch]                 = useState('');
  const [products, setProducts]             = useState<Product[]>([]);
  const [warehouses, setWarehouses]         = useState<any[]>([]);

  // Admin: all pending requests
  const [requests, setRequests]             = useState<StockRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  // Staff: their own requests (all statuses)
  const [myRequests, setMyRequests]         = useState<StockRequest[]>([]);
  const [myRequestsLoading, setMyRequestsLoading] = useState(false);

  const [tab, setTab] = useState<'stock' | 'requests' | 'my-requests'>('stock');

  // Staff request form
  const [showReqForm, setShowReqForm]       = useState(false);
  const [reqForm, setReqForm]               = useState({ productId: '', quantity: 1, notes: '' });
  const [reqSaving, setReqSaving]           = useState(false);
  const [reqError, setReqError]             = useState('');

  // Admin direct add form
  const [showAddForm, setShowAddForm]       = useState(false);
  const [addForm, setAddForm]               = useState({ productId: '', quantity: 1, sourceType: 'warehouse', warehouseId: '' });
  const [addSaving, setAddSaving]           = useState(false);
  const [addError, setAddError]             = useState('');

  // Admin approve modal
  const [approving, setApproving]           = useState<StockRequest | null>(null);
  const [approveForm, setApproveForm]       = useState({ sourceType: 'warehouse', warehouseId: '' });
  const [approveSaving, setApproveSaving]   = useState(false);
  const [approveError, setApproveError]     = useState('');

  // Runs once — load branches and products (these don't depend on role)
  {/* NEW */}
  useEffect(() => {
    find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }).then(data => {
      setBranches(data as Branch[]);
      if (!selectedBranch && isAdmin && data[0]) setSelectedBranch((data[0] as Branch)._id);
    });
  find(Collections.PRODUCTS, { isActive: true }).then(d => setProducts(d as Product[]));
  }, []);

// Runs when user/role is available — load role-specific data
  useEffect(() => {
  if (!user) return; // wait until auth resolves
  if (isAdmin) {
    find(Collections.WAREHOUSES, {}).then(d => setWarehouses(d));
    fetchRequests();
  } else {
    fetchMyRequests();
  }
  }, [user?.role]); // re-runs if role changes (e.g. after login)

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
      // Fetch ALL pending requests across all branches
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
      // Refresh my requests so staff can see the new pending entry
      fetchMyRequests();
      // Switch to the my-requests tab so they see the status immediately
      setTab('my-requests');
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
      setApproving(null);
      fetchRequests();
      if (approving.branch_id === selectedBranch) fetchStock();
    } catch (err: any) { setApproveError(err.message || 'Failed to approve'); }
    setApproveSaving(false);
  }

  async function rejectRequest(req: StockRequest) {
    if (!confirm(`Reject stock request for "${req.product_name}" at ${req.branch_name}?`)) return;
    try {
      await authFetch(`/api/branches/stock-requests/${req.id}/reject`, token, { method: 'PATCH' });
      fetchRequests();
    } catch (err: any) { alert(err.message || 'Failed to reject'); }
  }

  const filtered = stock.filter(s =>
    s.product?.name?.toLowerCase().includes(search.toLowerCase()) ||
    (s.product?.category || '').toLowerCase().includes(search.toLowerCase())
  );
  const branchName = branches.find(b => b._id === selectedBranch)?.name || '';
  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  const pendingMyRequests = myRequests.filter(r => r.status === 'pending').length;

  return (
    <div className="p-6 space-y-6">

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

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200">
        <button onClick={() => setTab('stock')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'stock' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          Stock
        </button>

        {/* Admin sees pending requests tab */}
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

        {/* Staff sees their own requests tab */}
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
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            {/* NEW */}
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
                placeholder="Search products..."
                className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
          </div>

          {branchName && (
            <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Package className="w-5 h-5 text-amber-500" />{branchName} — {filtered.length} products
            </h3>
          )}

          {loading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400"><Package className="w-12 h-12 mx-auto mb-3 opacity-40" /><p>No stock records found</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-slate-200">
                    <th className="pb-3 font-medium text-slate-600">Product</th>
                    <th className="pb-3 font-medium text-slate-600">Category</th>
                    <th className="pb-3 font-medium text-slate-600">Unit</th>
                    <th className="pb-3 font-medium text-slate-600 text-right">Quantity</th>
                    <th className="pb-3 font-medium text-slate-600 text-right">Price</th>
                    <th className="pb-3 font-medium text-slate-600">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(item => (
                    <tr key={item.productId} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 font-medium text-slate-800">{item.product?.name}</td>
                      <td className="py-3 text-slate-500">{item.product?.category || '-'}</td>
                      <td className="py-3 text-slate-500">{item.product?.unit}</td>
                      <td className={`py-3 text-right font-semibold ${item.quantity <= 5 ? 'text-red-600' : item.quantity <= 20 ? 'text-amber-600' : 'text-green-600'}`}>
                        {item.quantity.toLocaleString()}
                      </td>
                      <td className="py-3 text-right text-slate-600">{fmt(item.product?.unitPrice || 0)}</td>
                      <td className="py-3 text-slate-400 text-xs">{new Date(item.updatedAt).toLocaleDateString()}</td>
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
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-700">Pending Stock Requests</h3>
            <button onClick={fetchRequests} disabled={requestsLoading}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
              <RefreshCw className={`w-4 h-4 ${requestsLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          {requestsLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
          ) : requests.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>No pending requests</p>
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map(req => (
                <div key={req.id} className="border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-800">{req.product_name}</span>
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{req.quantity} {req.product_unit}</span>
                      <StatusBadge status={req.status} />
                    </div>
                    <p className="text-sm text-slate-500">Branch: <span className="font-medium text-slate-700">{req.branch_name}</span></p>
                    <p className="text-sm text-slate-500">Requested by: <span className="font-medium text-slate-700">{req.requested_by_name}</span> · {new Date(req.created_at).toLocaleDateString()}</p>
                    {req.notes && <p className="text-xs text-slate-400 mt-1">Note: {req.notes}</p>}
                  </div>
                  <div className="flex gap-2">
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
            <h3 className="font-semibold text-slate-700">My Stock Requests</h3>
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
                <div key={req.id} className="border border-slate-200 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold text-slate-800">{req.product_name}</span>
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{req.quantity} {req.product_unit}</span>
                      </div>
                      <p className="text-xs text-slate-400">{new Date(req.created_at).toLocaleString()}</p>
                      {req.notes && <p className="text-xs text-slate-500 mt-1">Note: {req.notes}</p>}
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
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowReqForm(false)} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
                <button type="submit" disabled={reqSaving} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
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
                <button type="button" onClick={() => setShowAddForm(false)} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
                <button type="submit" disabled={addSaving} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium text-sm transition-colors">
                  {addSaving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                  Add Stock
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
                <button type="button" onClick={() => setApproving(null)} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
                <button type="submit" disabled={approveSaving} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium text-sm transition-colors">
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