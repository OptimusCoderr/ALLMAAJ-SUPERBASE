import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { find, updateOne, Collections } from '../../lib/api';
import type { Debtor, Branch } from '../../lib/types';
import { UserCheck, Search, CheckCircle, XCircle, Phone, User } from 'lucide-react';

export default function DebtorsPage() {
  const { user } = useAuth();
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'cleared'>('active');
  const [clearing, setClearing] = useState<string | null>(null);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    const [d, b] = await Promise.all([
      find(Collections.DEPTORS, {}, { sort: { createdAt: -1 } }),
      find(Collections.BRANCHES, {}, { sort: { name: 1 } }),
    ]);
    setDebtors(d as Debtor[]);
    setBranches(b as Branch[]);
    setLoading(false);
  }

  async function clearDebtor(d: Debtor) {
    if (!confirm(`Mark debtor "${d.name}" as cleared? They owed ₦${d.amountOwed.toLocaleString()}.`)) return;
    setClearing(d._id);
    await updateOne(Collections.DEPTORS, { _id: { $oid: d._id } }, {
      $set: {
        isCleared: true,
        clearedBy: user!.id,
        clearedByName: user!.fullName,
        clearedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    setDebtors(prev => prev.map(x => x._id === d._id ? {
      ...x,
      isCleared: true,
      clearedBy: user!.id,
      clearedByName: user!.fullName,
      clearedAt: new Date().toISOString(),
    } : x));
    setClearing(null);
  }

  async function reactivateDebtor(d: Debtor) {
    if (!confirm(`Reactivate debtor "${d.name}"?`)) return;
    setClearing(d._id);
    await updateOne(Collections.DEPTORS, { _id: { $oid: d._id } }, {
      $set: { isCleared: false, clearedBy: null, clearedByName: null, clearedAt: null, updatedAt: new Date().toISOString() },
    });
    setDebtors(prev => prev.map(x => x._id === d._id ? { ...x, isCleared: false, clearedBy: undefined, clearedByName: undefined, clearedAt: undefined } : x));
    setClearing(null);
  }

  const filtered = debtors.filter(d => {
    if (branchFilter && d.branchId !== branchFilter) return false;
    if (statusFilter === 'active' && d.isCleared) return false;
    if (statusFilter === 'cleared' && !d.isCleared) return false;
    if (search) {
      const q = search.toLowerCase();
      return d.name.toLowerCase().includes(q) || d.phone.includes(search);
    }
    return true;
  });

  const totalActive = debtors.filter(d => !d.isCleared).reduce((s, d) => s + d.amountOwed, 0);
  const totalCleared = debtors.filter(d => d.isCleared).reduce((s, d) => s + d.amountOwed, 0);

  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Debtors</h1>
        <p className="text-slate-500 text-sm mt-1">Manage customers with unpaid balances</p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Active Debtors', value: debtors.filter(d => !d.isCleared).length, sub: fmt(totalActive), cls: 'text-red-700 bg-red-100' },
          { label: 'Cleared Debtors', value: debtors.filter(d => d.isCleared).length, sub: fmt(totalCleared), cls: 'text-green-700 bg-green-100' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <p className="text-slate-500 text-sm">{c.label}</p>
            <p className="font-bold text-slate-800 text-xl mt-1">{c.value}</p>
            <p className={`text-sm font-medium mt-1 ${c.cls.replace('bg-', 'text-').replace('-100', '-600')}`}>{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or phone..."
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
            className="px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
            <option value="">All Branches</option>
            {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
          <div className="flex gap-2">
            {(['active', 'cleared', 'all'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                  statusFilter === s ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}>{s}</button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400"><UserCheck className="w-12 h-12 mx-auto mb-3 opacity-40" /><p>No debtors found</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200">
                  <th className="pb-3 font-medium text-slate-600">Name</th>
                  <th className="pb-3 font-medium text-slate-600">Phone</th>
                  <th className="pb-3 font-medium text-slate-600">Branch</th>
                  <th className="pb-3 font-medium text-slate-600">Amount Owed</th>
                  <th className="pb-3 font-medium text-slate-600">Recorded By</th>
                  <th className="pb-3 font-medium text-slate-600">Date</th>
                  <th className="pb-3 font-medium text-slate-600">Status</th>
                  <th className="pb-3 font-medium text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(d => (
                  <tr key={d._id} className="hover:bg-slate-50">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
                          <User className="w-4 h-4 text-amber-600" />
                        </div>
                        <span className="font-medium text-slate-800">{d.name}</span>
                      </div>
                    </td>
                    <td className="py-3">
                      <a href={`tel:${d.phone}`} className="text-blue-600 hover:underline flex items-center gap-1">
                        <Phone className="w-3 h-3" />{d.phone}
                      </a>
                    </td>
                    <td className="py-3 text-slate-500">{branches.find(b => b._id === d.branchId)?.name || '-'}</td>
                    <td className="py-3 font-semibold text-red-600">{fmt(d.amountOwed)}</td>
                    <td className="py-3 text-slate-500">{d.createdByName}</td>
                    <td className="py-3 text-slate-400 text-xs">{new Date(d.createdAt).toLocaleDateString()}</td>
                    <td className="py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${d.isCleared ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {d.isCleared ? 'Cleared' : 'Active'}
                      </span>
                      {d.isCleared && d.clearedByName && (
                        <p className="text-xs text-slate-400 mt-0.5">by {d.clearedByName}</p>
                      )}
                    </td>
                    <td className="py-3">
                      {d.isCleared ? (
                        <button onClick={() => reactivateDebtor(d)} disabled={clearing === d._id}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-lg transition-colors">
                          {clearing === d._id ? <span className="w-3 h-3 border border-amber-600 border-t-transparent rounded-full animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                          Reactivate
                        </button>
                      ) : (
                        <button onClick={() => clearDebtor(d)} disabled={clearing === d._id}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-50 text-green-600 hover:bg-green-100 rounded-lg transition-colors">
                          {clearing === d._id ? <span className="w-3 h-3 border border-green-600 border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                          Clear
                        </button>
                      )}
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
