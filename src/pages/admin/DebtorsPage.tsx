import { useEffect, useState } from 'react';
import { find, updateOne, getAuthToken, Collections } from '../../lib/api';
import type { Debtor, Branch } from '../../lib/types';
import { UserCheck, Search, CheckCircle, XCircle, Phone, User, Clock, Trash2, Pencil, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { SkeletonCard } from '../../components/Skeleton';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

interface EditDebtorState {
  debtor: Debtor;
  name: string;
  phone: string;
  amount: string;
  notes: string;
  loading: boolean;
  error: string;
}

function timeOwing(createdAt: string): { label: string; days: number } {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  if (days === 0) return { label: 'Today', days };
  if (days === 1) return { label: '1 day', days };
  if (days < 7)   return { label: `${days} days`, days };
  if (days < 30)  return { label: `${Math.floor(days / 7)}w ${days % 7}d`, days };
  if (days < 365) return { label: `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''}`, days };
  return { label: `${Math.floor(days / 365)} yr+`, days };
}

function urgencyStyle(days: number): string {
  if (days >= 30) return 'text-red-700 bg-red-100';
  if (days >= 7)  return 'text-orange-700 bg-orange-100';
  if (days >= 1)  return 'text-amber-700 bg-amber-100';
  return 'text-slate-600 bg-slate-100';
}

function parseProducts(notes: string | undefined): string {
  if (!notes) return '';
  const match = notes.match(/^Sale:\s*(.+?)(\s*\|.*)?$/);
  return match ? match[1].trim() : '';
}

export default function DebtorsPage() {
  const { user } = useAuth();
  const toast    = useToast();
  const confirm  = useConfirm();
  const [debtors, setDebtors]       = useState<Debtor[]>([]);
  const [branches, setBranches]     = useState<Branch[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'cleared'>('active');
  const [clearing, setClearing]     = useState<string | null>(null);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [editDebtor, setEditDebtor] = useState<EditDebtorState | null>(null);

  useEffect(() => {
    find(Collections.BRANCHES, {}, { sort: { name: 1 } }).then(b => setBranches(b as Branch[]));
  }, []);

  useEffect(() => { fetchDebtors(); }, [branchFilter]);

  async function fetchDebtors() {
    setLoading(true);
    try {
      const filter: Record<string, any> = {};
      if (branchFilter) filter.branchId = branchFilter;
      const d = await find(Collections.DEBTORS, filter);
      setDebtors(d as Debtor[]);
    } catch (err) {
      console.error('Failed to load debtors:', err);
      setDebtors([]);
    } finally {
      setLoading(false);
    }
  }

  async function clearDebtor(d: Debtor) {
    if (!await confirm({ title: 'Clear Debt', message: `Mark "${d.name}" as cleared? They owed ₦${d.amountOwed.toLocaleString()}.`, confirmText: 'Clear Debt' })) return;
    setClearing(d._id);
    await updateOne(Collections.DEBTORS, { _id: { $oid: d._id } }, {
      $set: {
        isCleared: true,
        clearedBy: user!.id,
        clearedByName: user!.fullName,
        clearedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    setDebtors(prev => prev.map(x => x._id === d._id
      ? { ...x, isCleared: true, clearedBy: user!.id, clearedByName: user!.fullName, clearedAt: new Date().toISOString() }
      : x));
    setClearing(null);
  }

  async function deleteDebtor(d: Debtor) {
    if (!await confirm({ title: 'Delete Debtor', message: `Permanently delete "${d.name}"? This cannot be undone.`, confirmText: 'Delete', danger: true })) return;
    setDeleting(d._id);
    try {
      const res = await fetch(`${BASE}/api/reports/debtors/${d._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      setDebtors(prev => prev.filter(x => x._id !== d._id));
      toast.success('Debtor deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete debtor');
    }
    setDeleting(null);
  }

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
        { _id: { $oid: editDebtor.debtor._id } },
        { $set: {
          name: editDebtor.name.trim(), phone: editDebtor.phone.trim(),
          amountOwed: parseFloat(editDebtor.amount), notes: editDebtor.notes.trim(),
          updatedAt: new Date().toISOString(),
        }},
      );
      setDebtors(prev => prev.map(x => x._id === editDebtor.debtor._id
        ? { ...x, name: editDebtor.name.trim(), phone: editDebtor.phone.trim(), amountOwed: parseFloat(editDebtor.amount), notes: editDebtor.notes.trim() }
        : x));
      setEditDebtor(null);
    } catch (err: any) {
      setEditDebtor(prev => prev ? { ...prev, loading: false, error: err.message || 'Failed to save' } : null);
    }
  }

  async function reactivateDebtor(d: Debtor) {
    if (!await confirm({ title: 'Reactivate Debtor', message: `Reactivate "${d.name}" as an active debtor?`, confirmText: 'Reactivate' })) return;
    setClearing(d._id);
    await updateOne(Collections.DEBTORS, { _id: { $oid: d._id } }, {
      $set: { isCleared: false, clearedBy: null, clearedByName: null, clearedAt: null, updatedAt: new Date().toISOString() },
    });
    setDebtors(prev => prev.map(x => x._id === d._id
      ? { ...x, isCleared: false, clearedBy: undefined, clearedByName: undefined, clearedAt: undefined }
      : x));
    setClearing(null);
  }

  const filtered = debtors.filter(d => {
    if (statusFilter === 'active'  && d.isCleared)  return false;
    if (statusFilter === 'cleared' && !d.isCleared) return false;
    if (search) {
      const q = search.toLowerCase();
      return d.name.toLowerCase().includes(q) || d.phone.includes(search);
    }
    return true;
  });

  const totalActive  = debtors.filter(d => !d.isCleared).reduce((s, d) => s + d.amountOwed, 0);
  const totalCleared = debtors.filter(d => d.isCleared).reduce((s, d) => s + d.amountOwed, 0);
  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Debtors</h1>
        <p className="text-slate-500 text-sm mt-1">Manage customers with unpaid balances</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-slate-500 text-sm">Active Debtors</p>
          <p className="font-bold text-slate-800 text-xl mt-1">{debtors.filter(d => !d.isCleared).length}</p>
          <p className="text-sm font-medium mt-1 text-red-600">{fmt(totalActive)}</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-blue-100 bg-blue-50/30">
          <p className="text-slate-500 text-sm">Cleared Debtors</p>
          <p className="font-bold text-slate-800 text-xl mt-1">{debtors.filter(d => d.isCleared).length}</p>
          <p className="text-sm font-medium mt-1 text-blue-600">{fmt(totalCleared)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or phone..."
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <select
            value={branchFilter}
            onChange={e => setBranchFilter(e.target.value)}
            className="px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="">All Branches</option>
            {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
          <div className="flex gap-2">
            {(['active', 'cleared', 'all'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                  statusFilter === s ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >{s}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Cards */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <UserCheck className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No debtors found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(d => {
            const { label: timeLabel, days } = timeOwing(d.createdAt);
            const products = parseProducts(d.notes);
            const isPartPayment = d.paymentMethod === 'part';

            return (
              <div
                key={d._id}
                className={`bg-white rounded-xl p-4 shadow-sm border ${d.isCleared ? 'border-blue-200 bg-blue-50/30' : 'border-slate-100'}`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: avatar + info */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-800">{d.name}</span>
                        {/* Payment type badge */}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          isPartPayment
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {isPartPayment ? 'Part Payment' : 'Unpaid'}
                        </span>
                        {/* Status badge */}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          d.isCleared ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {d.isCleared ? 'Cleared' : 'Active'}
                        </span>
                      </div>

                      {/* Phone */}
                      <a
                        href={`tel:${d.phone}`}
                        className="flex items-center gap-1 text-sm text-blue-600 hover:underline mt-0.5"
                      >
                        <Phone className="w-3 h-3" />{d.phone}
                      </a>

                      {/* Products */}
                      {products && (
                        <p className="text-xs text-slate-500 mt-1 truncate max-w-xs">
                          <span className="font-medium text-slate-600">Items:</span> {products}
                        </p>
                      )}

                      {/* Recorded by */}
                      {d.createdByName && (
                        <p className="text-xs text-slate-400 mt-0.5">Recorded by {d.createdByName}</p>
                      )}
                      {d.isCleared && d.clearedByName && (
                        <p className="text-xs text-blue-600 mt-0.5">Cleared by {d.clearedByName}</p>
                      )}
                    </div>
                  </div>

                  {/* Right: amount + time + action */}
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <div className="text-right">
                      <p className={`font-bold text-lg ${d.isCleared ? 'text-blue-600' : 'text-red-600'}`}>{fmt(d.amountOwed)}</p>
                      {isPartPayment && d.totalSaleAmount != null && d.totalSaleAmount > 0 && (
                        <p className="text-xs text-slate-400">of {fmt(d.totalSaleAmount)} total</p>
                      )}
                      {d.isCleared && d.clearedAt && (
                        <p className="text-xs text-blue-400 mt-0.5">{new Date(d.clearedAt).toLocaleDateString('en-NG')}</p>
                      )}
                    </div>

                    {/* Time owing */}
                    {!d.isCleared && (
                      <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${urgencyStyle(days)}`}>
                        <Clock className="w-3 h-3" />{timeLabel}
                      </span>
                    )}

                    {/* Action buttons */}
                    <div className="flex flex-col gap-1.5 items-end">
                      <button
                        onClick={() => openEditDebtor(d)}
                        disabled={deleting === d._id || clearing === d._id}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      {d.isCleared ? (
                        <button
                          onClick={() => reactivateDebtor(d)}
                          disabled={clearing === d._id || deleting === d._id}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {clearing === d._id
                            ? <span className="w-3 h-3 border border-amber-600 border-t-transparent rounded-full animate-spin" />
                            : <XCircle className="w-3.5 h-3.5" />}
                          Reactivate
                        </button>
                      ) : (
                        <button
                          onClick={() => clearDebtor(d)}
                          disabled={clearing === d._id || deleting === d._id}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-50 text-green-600 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {clearing === d._id
                            ? <span className="w-3 h-3 border border-green-600 border-t-transparent rounded-full animate-spin" />
                            : <CheckCircle className="w-3.5 h-3.5" />}
                          Clear Debt
                        </button>
                      )}
                      <button
                        onClick={() => deleteDebtor(d)}
                        disabled={deleting === d._id || clearing === d._id}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {deleting === d._id
                          ? <span className="w-3 h-3 border border-red-600 border-t-transparent rounded-full animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Edit Debtor Modal ── */}
      {editDebtor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Edit Debtor</h2>
              <button onClick={() => setEditDebtor(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {editDebtor.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{editDebtor.error}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Name *</label>
                  <input
                    type="text"
                    value={editDebtor.name}
                    onChange={e => setEditDebtor({ ...editDebtor, name: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Phone *</label>
                  <input
                    type="tel"
                    value={editDebtor.phone}
                    onChange={e => setEditDebtor({ ...editDebtor, phone: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Amount Owed (₦) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={editDebtor.amount}
                  onChange={e => setEditDebtor({ ...editDebtor, amount: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Notes (optional)</label>
                <textarea
                  value={editDebtor.notes}
                  onChange={e => setEditDebtor({ ...editDebtor, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-slate-50"
                />
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t border-slate-100">
              <button
                onClick={() => setEditDebtor(null)}
                disabled={editDebtor.loading}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEditDebtor}
                disabled={editDebtor.loading}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
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