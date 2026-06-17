import { useEffect, useState } from 'react';
import { find, insertOne, updateOne, Collections } from '../../lib/api';
import type { User, Branch } from '../../lib/types';
import { Plus, Edit2, Trash2, UserCheck, Search, Shield, X, Check } from 'lucide-react';

type Form = { fullName: string; email: string; phone: string; password: string; role: 'admin' | 'staff'; branchId: string };
const BLANK: Form = { fullName: '', email: '', phone: '', password: '', role: 'staff', branchId: '' };

export default function StaffManagementPage() {
  const [staff, setStaff]       = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<User | null>(null);
  const [form, setForm]         = useState<Form>(BLANK);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const [s, b] = await Promise.all([
      find(Collections.USERS, {}, { sort: { createdAt: -1 } }),
      find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }),
    ]);
    setStaff(s as User[]);
    setBranches(b as Branch[]);
    setLoading(false);
  }

  function f(field: keyof Form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));
  }

  function openNew() {
    setEditing(null);
    setForm(BLANK);
    setShowForm(true);
    setError('');
  }

  function openEdit(u: User) {
    setEditing(u);
    setForm({
      fullName: u.fullName,
      email: u.email,
      phone: u.phone || '',
      password: '',
      role: u.role,
      branchId: u.branchId || '',
    });
    setShowForm(true);
    setError('');
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim()) { setError('Full name is required'); return; }
    if (!form.email.trim()) { setError('Email is required'); return; }
    if (!editing && !form.password) { setError('Password is required for new users'); return; }

    setSaving(true);
    setError('');
    try {
      const payload: any = {
        fullName: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        role: form.role,
        branchId: form.branchId || null,
        updatedAt: new Date().toISOString(),
      };

      if (editing) {
        if (form.password) payload.password = form.password;
        await updateOne(Collections.USERS, { _id: { $oid: editing._id } }, { $set: payload });
      } else {
        payload.password = form.password;
        payload.isActive = true;
        payload.createdAt = new Date().toISOString();
        await insertOne(Collections.USERS, payload);
      }
      await fetchAll();
      setShowForm(false);
      setEditing(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save user');
    }
    setSaving(false);
  }

  async function toggleActive(u: User) {
    await updateOne(Collections.USERS, { _id: { $oid: u._id } }, { $set: { isActive: !u.isActive } });
    setStaff(prev => prev.map(x => x._id === u._id ? { ...x, isActive: !u.isActive } : x));
  }

  const filtered = staff.filter(s =>
    s.fullName?.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase())
  );

  const roleColor = (r: string) =>
    r === 'admin' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Staff Management</h1>
          <p className="text-slate-500 text-sm mt-1">Create and manage user accounts</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
          <Plus className="w-4 h-4" />Add User
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">{editing ? 'Edit User' : 'Create New User'}</h3>
              <button onClick={() => { setShowForm(false); setEditing(null); }}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name *</label>
                <input type="text" value={form.fullName} onChange={f('fullName')} required
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
                <input type="email" value={form.email} onChange={f('email')} required
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                <input type="tel" value={form.phone} onChange={f('phone')}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Password {editing ? '(leave blank to keep current)' : '* (min 8 characters)'}
                </label>
                <input type="password" value={form.password} onChange={f('password')} required={!editing} minLength={8}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                  <select value={form.role} onChange={f('role')}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Branch</label>
                  <select value={form.branchId} onChange={f('branchId')}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                    <option value="">No branch</option>
                    {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
                  {saving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                  {editing ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400"><Shield className="w-12 h-12 mx-auto mb-3 opacity-40" /><p>No users found</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200">
                  <th className="pb-3 font-medium text-slate-600">Name</th>
                  <th className="pb-3 font-medium text-slate-600">Email</th>
                  <th className="pb-3 font-medium text-slate-600">Phone</th>
                  <th className="pb-3 font-medium text-slate-600">Role</th>
                  <th className="pb-3 font-medium text-slate-600">Branch</th>
                  <th className="pb-3 font-medium text-slate-600">Status</th>
                  <th className="pb-3 font-medium text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(s => (
                  <tr key={s._id} className="hover:bg-slate-50">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center text-xs font-bold text-amber-700">
                          {(s.fullName || 'U').charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-slate-800">{s.fullName || 'Unnamed'}</span>
                      </div>
                    </td>
                    <td className="py-3 text-slate-500 text-xs">{s.email}</td>
                    <td className="py-3 text-slate-500">{s.phone || '-'}</td>
                    <td className="py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${roleColor(s.role)}`}>
                        {s.role}
                      </span>
                    </td>
                    <td className="py-3 text-slate-500">{branches.find(b => b._id === s.branchId)?.name || '-'}</td>
                    <td className="py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${s.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {s.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => openEdit(s)} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => toggleActive(s)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                          {s.isActive ? <Trash2 className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
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
    </div>
  );
}
