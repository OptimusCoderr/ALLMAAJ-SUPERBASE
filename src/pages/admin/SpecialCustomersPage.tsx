import React, { useEffect, useState, useCallback } from 'react';
import { Star, Plus, Pencil, Trash2, X, Check, Search, Phone, Mail, MapPin, FileText } from 'lucide-react';
import { find, insertOne, updateOne, deleteOne, Collections } from '../../lib/api';
import type { SpecialCustomer } from '../../lib/types';

const emptyForm = { name: '', phone: '', email: '', address: '', notes: '' };

export default function SpecialCustomersPage() {
  const [customers, setCustomers] = useState<SpecialCustomer[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState<string | null>(null);
  const [form, setForm]           = useState({ ...emptyForm });
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await find(Collections.SPECIAL_CUSTOMERS, { isActive: true });
      setCustomers(data as SpecialCustomer[]);
    } catch {
      setError('Failed to load special customers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setError('');
    setShowForm(true);
  };

  const openEdit = (c: SpecialCustomer) => {
    setEditId(c._id);
    setForm({
      name: c.name,
      phone: c.phone || '',
      email: c.email || '',
      address: c.address || '',
      notes: c.notes || '',
    });
    setError('');
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditId(null); setError(''); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      if (editId) {
        await updateOne(Collections.SPECIAL_CUSTOMERS, { _id: editId }, {
          name:    form.name.trim(),
          phone:   form.phone.trim() || null,
          email:   form.email.trim() || null,
          address: form.address.trim() || null,
          notes:   form.notes.trim() || null,
        });
      } else {
        await insertOne(Collections.SPECIAL_CUSTOMERS, {
          name:    form.name.trim(),
          phone:   form.phone.trim() || null,
          email:   form.email.trim() || null,
          address: form.address.trim() || null,
          notes:   form.notes.trim() || null,
        });
      }
      closeForm();
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteOne(Collections.SPECIAL_CUSTOMERS, { _id: id });
      setDeleteConfirm(null);
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to delete');
    }
  };

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Star className="w-6 h-6 text-amber-500" />
            Special Customers
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Manage your VIP/named customers. Staff can select these when recording sales.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add Customer
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search by name, phone or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
        />
      </div>

      {/* Error banner */}
      {error && !showForm && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <X className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError('')} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Customer list */}
      {loading ? (
        <div className="text-center py-16 text-slate-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          {search ? 'No customers match your search.' : 'No special customers yet. Add one above.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(c => (
            <div key={c._id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3 relative">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-9 h-9 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 font-bold text-base flex-shrink-0">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <h3 className="font-semibold text-slate-800 text-sm truncate">{c.name}</h3>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(c)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => setDeleteConfirm(c._id)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-500 hover:text-red-600 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-slate-500">
                {c.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{c.phone}</span>
                  </div>
                )}
                {c.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{c.email}</span>
                  </div>
                )}
                {c.address && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="line-clamp-1">{c.address}</span>
                  </div>
                )}
                {c.notes && (
                  <div className="flex items-start gap-2">
                    <FileText className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{c.notes}</span>
                  </div>
                )}
              </div>

              {/* Delete confirm overlay */}
              {deleteConfirm === c._id && (
                <div className="absolute inset-0 bg-white/95 rounded-2xl flex flex-col items-center justify-center gap-3 p-4">
                  <p className="text-sm font-medium text-slate-700 text-center">Delete <span className="text-red-600">{c.name}</span>?</p>
                  <div className="flex gap-2">
                    <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
                      Cancel
                    </button>
                    <button onClick={() => handleDelete(c._id)} className="px-3 py-1.5 text-xs bg-red-500 hover:bg-red-600 text-white rounded-lg">
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-[95vw] sm:max-w-md p-4 sm:p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">
                {editId ? 'Edit Customer' : 'Add Special Customer'}
              </h2>
              <button onClick={closeForm} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Alhaji Bello"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                  maxLength={150}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="08012345678"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                    maxLength={30}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                    Email
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="customer@example.com"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                    maxLength={254}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                  Address
                </label>
                <input
                  type="text"
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                  placeholder="Street, City"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                  maxLength={500}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
                  Notes
                </label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Any special details…"
                  rows={3}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50 resize-none"
                  maxLength={1000}
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeForm}
                  className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
                >
                  <Check className="w-4 h-4" />
                  {saving ? 'Saving…' : editId ? 'Update' : 'Add Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
