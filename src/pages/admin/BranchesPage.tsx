import { useEffect, useState } from 'react';
import { find, insertOne, updateOne, deleteOne, Collections } from '../../lib/api';
import type { Branch } from '../../lib/types';
import { Plus, Edit2, Trash2, GitBranch, X, Check } from 'lucide-react';

type Form = { name: string; location: string; description: string };
const BLANK: Form = { name: '', location: '', description: '' };

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<Branch | null>(null);
  const [form, setForm]         = useState<Form>(BLANK);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const data = await find(Collections.BRANCHES, {}, { sort: { name: 1 } });
    setBranches(data as Branch[]);
    setLoading(false);
  }

  function f(field: keyof Form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));
  }

  function openNew() { setEditing(null); setForm(BLANK); setShowForm(true); setError(''); }
  function openEdit(b: Branch) { setEditing(b); setForm({ name: b.name, location: b.location || '', description: b.description || '' }); setShowForm(true); setError(''); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Branch name required'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, updatedAt: new Date().toISOString() };
      if (editing) {
        await updateOne(Collections.BRANCHES, { _id: { $oid: editing._id } }, { $set: payload });
      } else {
        await insertOne(Collections.BRANCHES, { ...payload, isActive: true, createdAt: new Date().toISOString() });
      }
      await fetchAll();
      setShowForm(false); setEditing(null);
    } catch (err: any) { setError(err.message || 'Save failed'); }
    setSaving(false);
  }

  async function handleDelete(b: Branch) {
    if (!confirm(`Delete branch "${b.name}"?`)) return;
    await deleteOne(Collections.BRANCHES, { _id: { $oid: b._id } });
    setBranches(prev => prev.filter(x => x._id !== b._id));
  }

  async function toggleActive(b: Branch) {
    await updateOne(Collections.BRANCHES, { _id: { $oid: b._id } }, { $set: { isActive: !b.isActive } });
    setBranches(prev => prev.map(x => x._id === b._id ? { ...x, isActive: !b.isActive } : x));
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Branches</h1>
          <p className="text-slate-500 text-sm mt-1">Manage store locations</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
          <Plus className="w-4 h-4" />New Branch
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">{editing ? 'Edit Branch' : 'New Branch'}</h3>
              <button onClick={() => { setShowForm(false); setEditing(null); }}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Branch Name *</label>
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
                  {editing ? 'Save Changes' : 'Create Branch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        {loading ? (
          <div className="p-6 space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />)}</div>
        ) : branches.length === 0 ? (
          <div className="text-center py-12 text-slate-400"><GitBranch className="w-12 h-12 mx-auto mb-3 opacity-40" /><p>No branches yet</p></div>
        ) : (
          <div className="divide-y divide-slate-100">
            {branches.map(b => (
              <div key={b._id} className="flex items-center justify-between p-5 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                    <GitBranch className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">{b.name}</p>
                    <p className="text-sm text-slate-500">{b.location || 'No location'}</p>
                    {b.description && <p className="text-xs text-slate-400 mt-0.5">{b.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleActive(b)}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium cursor-pointer transition-colors ${b.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                    {b.isActive ? 'Active' : 'Inactive'}
                  </button>
                  <button onClick={() => openEdit(b)} className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => handleDelete(b)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
