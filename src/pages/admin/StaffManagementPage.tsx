import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { find, insertOne, updateOne, deleteOne, Collections } from '../../lib/api';
import { SkeletonRow } from '../../components/Skeleton';
import Pagination from '../../components/Pagination';
import type { User, Branch } from '../../lib/types';
import {
  Plus, Edit2, X, Check, Search, Shield, RefreshCw,
  Download, Users, UserCheck, UserX, Building2,XCircle, CheckCircle, AlertTriangle,
  Eye, EyeOff,
  ToggleLeft, ToggleRight, Phone, Mail, KeyRound, Trash2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type UserForm = {
  fullName: string; email: string; phone: string;
  password: string; role: 'admin' | 'staff' | 'manager'; branchId: string;
};
const BLANK: UserForm = { fullName: '', email: '', phone: '', password: '', role: 'staff', branchId: '' };

type RoleFilter   = 'all' | 'admin' | 'staff' | 'manager';
type StatusFilter = 'all' | 'active' | 'inactive';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
}

const AVATAR_COLORS = [
  'bg-amber-100 text-amber-700',
  'bg-blue-100 text-blue-700',
  'bg-green-100 text-green-700',
  'bg-purple-100 text-purple-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
];

function avatarColor(id: string) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n += id.charCodeAt(i);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

function exportCSV(users: User[], branches: Branch[]) {
  const branchMap = Object.fromEntries(branches.map(b => [b._id, b.name]));
  const header = ['Name', 'Email', 'Phone', 'Role', 'Branch', 'Status', 'Created'];
  const rows = users.map(u => [
    u.fullName,
    u.email,
    u.phone ?? '',
    u.role,
    branchMap[u.branchId ?? ''] ?? '',
    u.isActive ? 'Active' : 'Inactive',
    u.createdAt?.split('T')[0] ?? '',
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `staff-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function StaffManagementPage() {
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [staff, setStaff]           = useState<User[]>([]);
  const [branches, setBranches]     = useState<Branch[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch]             = useState('');
  const [roleFilter, setRoleFilter]     = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [branchFilter, setBranchFilter] = useState('all');

  // Form
  const [showForm, setShowForm]         = useState(false);
  const [editing, setEditing]           = useState<User | null>(null);
  const [form, setForm]                 = useState<UserForm>(BLANK);
  const [saving, setSaving]             = useState(false);
  const [formError, setFormError]       = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  async function fetchAll(quiet = false) {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const [s, b] = await Promise.all([
        find(Collections.USERS,    {}, { sort: { createdAt: -1 } }),
        find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }),
      ]);
      setStaff(s as User[]);
      setBranches(b as Branch[]);
    } catch {
      toast.error('Failed to load staff');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { fetchAll(); }, []);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:      staff.length,
    active:     staff.filter(u => u.isActive).length,
    inactive:   staff.filter(u => !u.isActive).length,
    admins:     staff.filter(u => u.role === 'admin').length,
    managers:   staff.filter(u => u.role === 'manager').length,
    staffOnly:  staff.filter(u => u.role === 'staff').length,
    unassigned: staff.filter(u => u.isActive && !u.branchId).length,
  }), [staff]);

  // ── Pagination ────────────────────────────────────────────────────────────
  const [page, setPage]   = useState(1);
  const [limit, setLimit] = useState(25);

  // ── Filtered ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let out = staff;
    if (statusFilter !== 'all') out = out.filter(u => statusFilter === 'active' ? u.isActive : !u.isActive);
    if (roleFilter !== 'all')   out = out.filter(u => u.role === roleFilter);
    if (branchFilter !== 'all') out = out.filter(u =>
      branchFilter === 'none' ? !u.branchId : u.branchId === branchFilter
    );
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(u =>
        u.fullName?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        (u.phone ?? '').includes(q)
      );
    }
    return out;
  }, [staff, search, roleFilter, statusFilter, branchFilter]);

  const paginated   = useMemo(() => { return filtered.slice((page - 1) * limit, page * limit); }, [filtered, page, limit]);
  const totalPages  = Math.max(1, Math.ceil(filtered.length / limit));

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, roleFilter, statusFilter, branchFilter]);

  // ── Branch lookup ─────────────────────────────────────────────────────────
  const branchMap = useMemo(() =>
    Object.fromEntries(branches.map(b => [b._id, b.name])),
  [branches]);

  // ── Form helpers ──────────────────────────────────────────────────────────
  function openNew() {
    setEditing(null); setForm(BLANK); setFormError('');
    setShowPassword(false); setShowForm(true);
  }
  function openEdit(u: User) {
    setEditing(u);
    setForm({ fullName: u.fullName, email: u.email, phone: u.phone ?? '',
              password: '', role: u.role, branchId: u.branchId ?? '' });
    setFormError(''); setShowPassword(false); setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim()) { setFormError('Full name is required'); return; }
    if (!form.email.trim())    { setFormError('Email is required'); return; }
    if (!editing && !form.password) { setFormError('Password is required for new users'); return; }
    if (form.password && form.password.length < 8) { setFormError('Password must be at least 8 characters'); return; }

    setSaving(true); setFormError('');
    try {
      const payload: any = {
        fullName:  form.fullName.trim(),
        email:     form.email.trim().toLowerCase(),
        phone:     form.phone.trim(),
        role:      form.role,
        branchId:  form.branchId || null,
        updatedAt: new Date().toISOString(),
      };
      if (editing) {
        if (form.password) payload.password = form.password;
        await updateOne(Collections.USERS, { _id: editing._id }, { $set: payload });
        toast.success(`"${payload.fullName}" updated`);
      } else {
        payload.password  = form.password;
        payload.isActive  = true;
        payload.createdAt = new Date().toISOString();
        await insertOne(Collections.USERS, payload);
        toast.success(`"${payload.fullName}" created`);
      }
      await fetchAll(true);
      setShowForm(false); setEditing(null);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(u: User) {
    const next = !u.isActive;
    try {
      await updateOne(Collections.USERS, { _id: u._id }, { $set: { isActive: next } });
      setStaff(prev => prev.map(x => x._id === u._id ? { ...x, isActive: next } : x));
      toast[next ? 'success' : 'info'](`"${u.fullName}" ${next ? 'activated' : 'deactivated'}`);
    } catch (err: any) {
      toast.error(err.message || 'Update failed');
    }
  }

  async function handleDelete(u: User) {
    if (u._id === currentUser?.id) {
      toast.error('You cannot delete your own account');
      return;
    }
    if (!await confirm({
      title: 'Delete Staff Member',
      message: `Delete "${u.fullName}"? This is permanent. If this user has sales or records linked to them, the delete will be blocked — deactivate them instead.`,
      confirmText: 'Delete',
      danger: true,
    })) return;
    try {
      await deleteOne(Collections.USERS, { _id: u._id });
      setStaff(prev => prev.filter(x => x._id !== u._id));
      toast.success(`"${u.fullName}" deleted`);
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-6 h-6 text-amber-500" />
            Staff Management
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">Create and manage user accounts and roles</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCSV(filtered, branches)}
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
            <Plus className="w-4 h-4" /> Add User
          </button>
        </div>
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.total}</p>
            <p className="text-xs text-slate-500">Total Users</p>
          </div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
            <UserCheck className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.active}</p>
            <p className="text-xs text-slate-500">Active</p>
          </div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.admins}</p>
            <p className="text-xs text-slate-500">Admins</p>
          </div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.managers}</p>
            <p className="text-xs text-slate-500">Managers</p>
          </div>
        </div>
        <div className={`border rounded-xl p-4 flex items-center gap-3 shadow-sm ${
          stats.unassigned > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            stats.unassigned > 0 ? 'bg-amber-200' : 'bg-slate-100'
          }`}>
            <Building2 className={`w-5 h-5 ${stats.unassigned > 0 ? 'text-amber-700' : 'text-slate-400'}`} />
          </div>
          <div>
            <p className={`text-2xl font-bold ${stats.unassigned > 0 ? 'text-amber-700' : 'text-slate-800'}`}>
              {stats.unassigned}
            </p>
            <p className={`text-xs ${stats.unassigned > 0 ? 'text-amber-600' : 'text-slate-500'}`}>Unassigned</p>
          </div>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email or phone…"
              className="w-full pl-9 pr-9 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Role filter */}
          <div className="flex gap-1.5 shrink-0">
            {(['all', 'admin', 'manager', 'staff'] as const).map(r => (
              <button
                key={r}
                onClick={() => setRoleFilter(r)}
                className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                  roleFilter === r
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {r === 'all' ? 'All Roles' : r}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <div className="flex gap-1.5 shrink-0">
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
        </div>

        {/* Branch filter */}
        {branches.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {[
              { id: 'all',  label: 'All Branches' },
              { id: 'none', label: 'No Branch' },
              ...branches.map(b => ({ id: b._id, label: b.name })),
            ].map(opt => (
              <button
                key={opt.id}
                onClick={() => setBranchFilter(opt.id)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  branchFilter === opt.id
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results count */}
      {!loading && (
        <p className="text-xs text-slate-400 px-1">
          Showing <strong className="text-slate-600">{filtered.length}</strong> of {staff.length} users
          {(search || roleFilter !== 'all' || statusFilter !== 'all' || branchFilter !== 'all') && ' (filtered)'}
        </p>
      )}

      {/* ── Staff table ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={5} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-14 text-slate-400">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-semibold text-slate-500">
              {search ? `No results for "${search}"` : 'No users found'}
            </p>
            <p className="text-sm mt-1">Try adjusting your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left border-b border-slate-100">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">User</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 hidden md:table-cell">Contact</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Role</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Branch</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 hidden lg:table-cell">Joined</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginated.map(u => (
                  <tr key={u._id} className={`hover:bg-slate-50/70 transition-colors ${!u.isActive ? 'opacity-55' : ''}`}>

                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${avatarColor(u._id)}`}>
                          {initials(u.fullName || 'U')}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 truncate">{u.fullName || 'Unnamed'}</p>
                          <p className="text-xs text-slate-400 truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>

                    {/* Contact (desktop) */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      {u.phone
                        ? <span className="flex items-center gap-1 text-slate-500 text-xs"><Phone className="w-3 h-3" />{u.phone}</span>
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>

                    {/* Role */}
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold capitalize ${
                        u.role === 'admin'   ? 'bg-red-100 text-red-700'
                        : u.role === 'manager' ? 'bg-purple-100 text-purple-700'
                        :                        'bg-blue-100 text-blue-700'
                      }`}>
                        {u.role === 'admin' ? '⚡ Admin' : u.role === 'manager' ? 'Manager' : 'Staff'}
                      </span>
                    </td>

                    {/* Branch */}
                    <td className="px-4 py-3">
                      {u.branchId && branchMap[u.branchId]
                        ? <span className="flex items-center gap-1 text-slate-600 text-xs font-medium">
                            <Building2 className="w-3 h-3 text-slate-400" />
                            {branchMap[u.branchId]}
                          </span>
                        : <span className={`text-xs px-2 py-0.5 rounded-full ${
                            u.isActive && u.role !== 'admin'
                              ? 'bg-amber-100 text-amber-700'
                              : 'text-slate-300'
                          }`}>
                            {u.isActive && u.role !== 'admin' ? 'Unassigned' : '—'}
                          </span>}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        u.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    {/* Joined */}
                    <td className="px-4 py-3 text-xs text-slate-400 hidden lg:table-cell">
                      {u.createdAt?.split('T')[0] ?? '—'}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openEdit(u)}
                          className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                          title="Edit user"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(u)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            u.isActive
                              ? 'text-green-500 hover:text-slate-400 hover:bg-slate-100'
                              : 'text-slate-300 hover:text-green-500 hover:bg-green-50'
                          }`}
                          title={u.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {u.isActive
                            ? <ToggleRight className="w-4 h-4" />
                            : <ToggleLeft className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={u._id === currentUser?.id}
                          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          title={u._id === currentUser?.id ? 'Cannot delete your own account' : 'Delete user'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                  <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-slate-500">
                    {filtered.length} user{filtered.length !== 1 ? 's' : ''}
                    {' · '}
                    {filtered.filter(u => u.isActive).length} active
                  </td>
                  <td colSpan={4} className="px-4 py-2.5 text-xs text-slate-400 text-right">
                    {filtered.filter(u => u.role === 'admin').length} admin{filtered.filter(u => u.role === 'admin').length !== 1 ? 's' : ''}
                    {' · '}
                    {filtered.filter(u => u.role === 'manager').length} manager{filtered.filter(u => u.role === 'manager').length !== 1 ? 's' : ''}
                    {' · '}
                    {filtered.filter(u => u.role === 'staff').length} staff
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {!loading && filtered.length > limit && (
          <div className="px-4 pb-3 border-t border-slate-100">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={filtered.length}
              limit={limit}
              onPageChange={p => setPage(p)}
              onLimitChange={l => { setLimit(l); setPage(1); }}
            />
          </div>
        )}
      </div>

      {/* ── User form modal ─────────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[95vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-800">
                  {editing ? 'Edit User' : 'Create New User'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {editing ? 'Update account details' : 'Add a new staff or admin account'}
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

            <form onSubmit={handleSave} className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Full name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.fullName}
                  onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))}
                  required
                  autoFocus
                  placeholder="e.g. Emeka Okafor"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Email <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    required
                    placeholder="email@example.com"
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* Phone */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Phone</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder="e.g. 08012345678"
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Password{' '}
                  {editing
                    ? <span className="text-slate-400 font-normal">(leave blank to keep current)</span>
                    : <span className="text-red-500">*</span>}
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    required={!editing}
                    minLength={8}
                    placeholder={editing ? '••••••••' : 'Min 8 characters'}
                    className="w-full pl-9 pr-10 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {form.password && form.password.length > 0 && form.password.length < 8 && (
                  <p className="text-xs text-red-500 mt-1">Password must be at least 8 characters</p>
                )}
              </div>

              {/* Role & Branch */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Role</label>
                  <select
                    value={form.role}
                    onChange={e => setForm(p => ({ ...p, role: e.target.value as 'admin' | 'manager' | 'staff' }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="staff">Staff</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Branch</label>
                  <select
                    value={form.branchId}
                    onChange={e => setForm(p => ({ ...p, branchId: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    <option value="">No branch</option>
                    {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Role info box */}
              <div className={`p-3 rounded-xl text-xs border ${
                form.role === 'admin'   ? 'bg-red-50 border-red-100 text-red-700'
                : form.role === 'manager' ? 'bg-purple-50 border-purple-100 text-purple-700'
                :                           'bg-blue-50 border-blue-100 text-blue-700'
              }`}>
                {form.role === 'admin'
                  ? '⚡ Admins have full access: manage staff, approve reports, view all branches.'
                  : form.role === 'manager'
                  ? '🛡️ Managers can approve/reject daily reports and view sales reports/debtors, in addition to staff abilities.'
                  : '👤 Staff can record sales, submit daily reports, and manage their branch stock.'}
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
                  {editing ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}