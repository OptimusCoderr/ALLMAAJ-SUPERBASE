import { useEffect, useState, useMemo } from 'react';
import { find, insertOne, updateOne, deleteOne, Collections } from '../../lib/api';
import type { Branch, User } from '../../lib/types';
import {
  Plus, Edit2, Trash2, X, Check, Search, Download,
  RefreshCw, MapPin, CheckCircle, XCircle, AlertCircle,
  ToggleLeft, ToggleRight, Building2, Users, AlertTriangle,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type BranchForm = { name: string; location: string; description: string };
const BLANK: BranchForm = { name: '', location: '', description: '' };
type StatusFilter = 'all' | 'active' | 'inactive';
interface Toast { id: number; message: string; type: 'success' | 'error' | 'info' }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function exportCSV(branches: Branch[]) {
  const header = ['Name', 'Location', 'Description', 'Status', 'Created'];
  const rows = branches.map(b => [
    b.name,
    b.location ?? '',
    b.description ?? '',
    b.isActive ? 'Active' : 'Inactive',
    b.createdAt ? b.createdAt.split('T')[0] : '',
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `branches-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium pointer-events-auto
            ${t.type === 'success' ? 'bg-green-600 text-white' :
              t.type === 'error'   ? 'bg-red-600 text-white'   :
                                     'bg-slate-800 text-white'}`}
        >
          {t.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> :
           t.type === 'error'   ? <XCircle className="w-4 h-4 shrink-0" />    :
                                  <AlertCircle className="w-4 h-4 shrink-0" />}
          {t.message}
          <button onClick={() => onRemove(t.id)} className="ml-1 opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BranchesPage() {
  const [branches, setBranches]     = useState<Branch[]>([]);
  const [staffMap, setStaffMap]     = useState<Record<string, number>>({});
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Form
  const [showForm, setShowForm]     = useState(false);
  const [editing, setEditing]       = useState<Branch | null>(null);
  const [form, setForm]             = useState<BranchForm>(BLANK);
  const [saving, setSaving]         = useState(false);
  const [formError, setFormError]   = useState('');

  // Delete
  const [deleting, setDeleting]     = useState<string | null>(null);

  // Toasts
  const [toasts, setToasts]         = useState<Toast[]>([]);
  const [toastId, setToastId]       = useState(0);

  // ── Toast helper ─────────────────────────────────────────────────────────────
  function toast(message: string, type: Toast['type'] = 'success') {
    const id = toastId + 1;
    setToastId(id);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────────
  async function fetchAll(quiet = false) {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const [brs, users] = await Promise.all([
        find(Collections.BRANCHES, {}, { sort: { name: 1 } }),
        find(Collections.USERS, {}, {}),
      ]);
      setBranches(brs as Branch[]);

      // Build staff count per branch
      const map: Record<string, number> = {};
      for (const u of users as User[]) {
        if (u.branchId) map[u.branchId] = (map[u.branchId] ?? 0) + 1;
      }
      setStaffMap(map);
    } catch {
      toast('Failed to load branches', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { fetchAll(); }, []);

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:    branches.length,
    active:   branches.filter(b => b.isActive).length,
    inactive: branches.filter(b => !b.isActive).length,
    staffed:  branches.filter(b => (staffMap[b._id] ?? 0) > 0).length,
  }), [branches, staffMap]);

  // ── Filtered list ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let out = branches;
    if (statusFilter === 'active')   out = out.filter(b => b.isActive);
    if (statusFilter === 'inactive') out = out.filter(b => !b.isActive);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(b =>
        b.name.toLowerCase().includes(q) ||
        (b.location ?? '').toLowerCase().includes(q) ||
        (b.description ?? '').toLowerCase().includes(q)
      );
    }
    return out;
  }, [branches, statusFilter, search]);

  // ── Form helpers ──────────────────────────────────────────────────────────────
  function openNew() {
    setEditing(null); setForm(BLANK); setFormError(''); setShowForm(true);
  }
  function openEdit(b: Branch) {
    setEditing(b);
    setForm({ name: b.name, location: b.location ?? '', description: b.description ?? '' });
    setFormError(''); setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Branch name is required'); return; }
    setSaving(true); setFormError('');
    try {
      const payload = { ...form, updatedAt: new Date().toISOString() };
      if (editing) {
        await updateOne(Collections.BRANCHES, { _id: { $oid: editing._id } }, { $set: payload });
        toast(`"${form.name}" updated`);
      } else {
        await insertOne(Collections.BRANCHES, { ...payload, isActive: true, createdAt: new Date().toISOString() });
        toast(`Branch "${form.name}" created`);
      }
      await fetchAll(true);
      setShowForm(false); setEditing(null);
    } catch (err: any) {
      setFormError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(b: Branch) {
    const staffCount = staffMap[b._id] ?? 0;
    const warning = staffCount > 0
      ? `\n\n⚠️ This branch has ${staffCount} staff member${staffCount !== 1 ? 's' : ''} assigned.`
      : '';
    if (!confirm(`Delete branch "${b.name}"? This cannot be undone.${warning}`)) return;
    setDeleting(b._id);
    try {
      await deleteOne(Collections.BRANCHES, { _id: { $oid: b._id } });
      setBranches(prev => prev.filter(x => x._id !== b._id));
      toast(`Deleted "${b.name}"`, 'info');
    } catch (err: any) {
      toast(err.message || 'Delete failed', 'error');
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggleActive(b: Branch) {
    const next = !b.isActive;
    try {
      await updateOne(Collections.BRANCHES, { _id: { $oid: b._id } }, { $set: { isActive: next } });
      setBranches(prev => prev.map(x => x._id === b._id ? { ...x, isActive: next } : x));
      toast(`"${b.name}" ${next ? 'activated' : 'deactivated'}`, next ? 'success' : 'info');
    } catch (err: any) {
      toast(err.message || 'Update failed', 'error');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-amber-500" />
            Branches
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage your store locations and branch details</p>
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
            <Plus className="w-4 h-4" /> New Branch
          </button>
        </div>
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <Building2 className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.total}</p>
            <p className="text-xs text-slate-500">Total Branches</p>
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
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
            <XCircle className="w-5 h-5 text-slate-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.inactive}</p>
            <p className="text-xs text-slate-500">Inactive</p>
          </div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.staffed}</p>
            <p className="text-xs text-slate-500">Staffed</p>
          </div>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search branches by name or location…"
            className="w-full pl-9 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-sm"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Status filter */}
        <div className="flex gap-1.5 shrink-0">
          {(['all', 'active', 'inactive'] as const).map(s => {
            const count = s === 'all' ? stats.total : stats[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium capitalize transition-colors ${
                  statusFilter === s
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {s}
                {!loading && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                    statusFilter === s ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Branch list ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-[72px] bg-slate-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-14 text-slate-400">
            <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-semibold text-slate-500">
              {search ? `No branches match "${search}"` : 'No branches yet'}
            </p>
            <p className="text-sm mt-1">
              {!search && 'Click "New Branch" to add your first location.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map(b => {
              const staffCount = staffMap[b._id] ?? 0;
              const isDeleting = deleting === b._id;

              return (
                <div
                  key={b._id}
                  className={`flex items-center gap-4 px-5 py-4 hover:bg-slate-50/70 transition-colors ${
                    !b.isActive ? 'opacity-60' : ''
                  }`}
                >
                  {/* Icon */}
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    b.isActive ? 'bg-amber-100' : 'bg-slate-100'
                  }`}>
                    <Building2 className={`w-5 h-5 ${b.isActive ? 'text-amber-600' : 'text-slate-400'}`} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-800">{b.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        b.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {b.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {b.location && (
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />{b.location}
                        </span>
                      )}
                      {staffCount > 0 && (
                        <span className="text-xs text-blue-500 flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {staffCount} staff
                        </span>
                      )}
                      {staffCount === 0 && b.isActive && (
                        <span className="text-xs text-amber-500 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          No staff assigned
                        </span>
                      )}
                    </div>
                    {b.description && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-md">{b.description}</p>
                    )}
                  </div>

                  {/* Created date (desktop) */}
                  {b.createdAt && (
                    <div className="text-right hidden md:block shrink-0">
                      <p className="text-xs text-slate-400">Created</p>
                      <p className="text-xs text-slate-500 font-medium">{b.createdAt.split('T')[0]}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleToggleActive(b)}
                      className={`p-2 rounded-lg transition-colors ${
                        b.isActive
                          ? 'text-green-500 hover:text-slate-400 hover:bg-slate-100'
                          : 'text-slate-300 hover:text-green-500 hover:bg-green-50'
                      }`}
                      title={b.isActive ? 'Deactivate branch' : 'Activate branch'}
                    >
                      {b.isActive
                        ? <ToggleRight className="w-5 h-5" />
                        : <ToggleLeft className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={() => openEdit(b)}
                      className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                      title="Edit branch"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(b)}
                      disabled={isDeleting}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete branch"
                    >
                      {isDeleting
                        ? <span className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin inline-block" />
                        : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer count */}
        {!loading && filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-400">
            Showing {filtered.length} of {branches.length} branch{branches.length !== 1 ? 'es' : ''}
            {(search || statusFilter !== 'all') && ' (filtered)'}
          </div>
        )}
      </div>

      {/* ── Branch form modal ───────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] sm:max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-800">
                  {editing ? 'Edit Branch' : 'New Branch'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {editing ? 'Update branch details' : 'Add a new store location'}
                </p>
              </div>
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

            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Branch Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  required
                  autoFocus
                  placeholder="e.g. Ikeja Branch"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Location</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    value={form.location}
                    onChange={e => setForm(p => ({ ...p, location: e.target.value }))}
                    placeholder="e.g. 12 Allen Avenue, Ikeja"
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  rows={2}
                  placeholder="Optional notes about this branch…"
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
                  {editing ? 'Save Changes' : 'Create Branch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onRemove={id => setToasts(prev => prev.filter(t => t.id !== id))} />
    </div>
  );
}