import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { find, updateOne, Collections } from '../../lib/api';
import type { Debtor, Branch } from '../../lib/types';
import { UserCheck, Search, CheckCircle, RotateCcw, Phone, User, Clock, AlertTriangle, TrendingDown } from 'lucide-react';

function timeOwing(createdAt: string): { label: string; days: number } {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  if (days === 0) return { label: 'Today',    days };
  if (days === 1) return { label: '1 day',    days };
  if (days < 7)   return { label: `${days} days`, days };
  if (days < 30)  return { label: `${Math.floor(days / 7)}w ${days % 7}d`, days };
  if (days < 365) return { label: `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''}`, days };
  return { label: `${Math.floor(days / 365)} yr+`, days };
}

function urgencyStyle(days: number): string {
  if (days > 30) return 'bg-red-100 text-red-700 border-red-200';
  if (days > 7)  return 'bg-orange-100 text-orange-700 border-orange-200';
  return 'bg-amber-100 text-amber-700 border-amber-200';
}

export default function DebtorsPage() {
  const { user } = useAuth();
  const [debtors, setDebtors]       = useState<Debtor[]>([]);
  const [branches, setBranches]     = useState<Branch[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'cleared'>('active');
  const [clearing, setClearing]     = useState<string | null>(null);

  useEffect(() => {
    find(Collections.BRANCHES, { isActive: true }).then(b => setBranches(b as Branch[]));
  }, []);

  useEffect(() => { fetchDebtors(); }, [branchFilter]);

  async function fetchDebtors() {
    setLoading(true);
    const filter: Record<string, any> = {};
    if (branchFilter) filter.branchId = branchFilter;
    const d = await find(Collections.DEBTORS, filter);
    setDebtors(d as Debtor[]);
    setLoading(false);
  }

  async function clearDebtor(d: Debtor) {
    if (!confirm(`Mark "${d.name}" as cleared? They owed ${fmt(d.amountOwed)}.`)) return;
    setClearing(d._id);
    await updateOne(Collections.DEBTORS, { _id: d._id }, { isCleared: true });
    await fetchDebtors();
    setClearing(null);
  }

  async function reactivateDebtor(d: Debtor) {
    if (!confirm(`Reactivate debtor "${d.name}"?`)) return;
    setClearing(d._id);
    await updateOne(Collections.DEBTORS, { _id: d._id }, { isCleared: false });
    await fetchDebtors();
    setClearing(null);
  }

  const filtered = debtors.filter(d => {
    if (branchFilter && d.branchId !== branchFilter) return false;
    if (statusFilter === 'active'  && d.isCleared)  return false;
    if (statusFilter === 'cleared' && !d.isCleared) return false;
    if (search) {
      const q = search.toLowerCase();
      return d.name.toLowerCase().includes(q) || d.phone.includes(search);
    }
    return true;
  });

  const activeDebtors  = debtors.filter(d => !d.isCleared);
  const totalActive    = activeDebtors.reduce((s, d) => s + d.amountOwed, 0);
  const overdueCount   = activeDebtors.filter(d => timeOwing(d.createdAt).days > 30).length;
  const totalCleared   = debtors.filter(d => d.isCleared).reduce((s, d) => s + d.amountOwed, 0);

  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Debtors</h1>
        <p className="text-slate-500 text-sm mt-1">Manage customers with unpaid balances</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-slate-500 text-sm">Active Debtors</p>
          <p className="font-bold text-slate-800 text-2xl mt-1">{activeDebtors.length}</p>
          <p className="text-sm font-medium mt-1 text-red-600">{fmt(totalActive)}</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-slate-500 text-sm">Overdue (&gt;30 days)</p>
          <p className="font-bold text-red-600 text-2xl mt-1">{overdueCount}</p>
          <p className="text-sm font-medium mt-1 text-slate-400">needs urgent follow-up</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-slate-500 text-sm">Cleared Debtors</p>
          <p className="font-bold text-green-600 text-2xl mt-1">{debtors.filter(d => d.isCleared).length}</p>
          <p className="text-sm font-medium mt-1 text-green-600">{fmt(totalCleared)} recovered</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-slate-500 text-sm">Total Outstanding</p>
          <p className="font-bold text-slate-800 text-2xl mt-1">{fmt(totalActive)}</p>
          <p className="text-sm font-medium mt-1 text-slate-400">across {activeDebtors.length} customers</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
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
          <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <UserCheck className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>No debtors found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(d => {
              const { label: owing, days } = timeOwing(d.createdAt);
              const isOverdue = days > 30;
              return (
                <div key={d._id}
                  className={`flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl border transition-colors ${
                    d.isCleared
                      ? 'bg-slate-50 border-slate-200 opacity-70'
                      : isOverdue
                        ? 'bg-red-50 border-red-100'
                        : 'bg-white border-slate-200'
                  }`}>

                  {/* Avatar + Name */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      d.isCleared ? 'bg-green-100' : isOverdue ? 'bg-red-100' : 'bg-amber-100'
                    }`}>
                      <User className={`w-5 h-5 ${d.isCleared ? 'text-green-600' : isOverdue ? 'text-red-600' : 'text-amber-600'}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{d.name}</p>
                      <a href={`tel:${d.phone}`}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                        <Phone className="w-3 h-3" />{d.phone}
                      </a>
                      {d.notes && (
                        <p className="text-xs text-slate-400 truncate mt-0.5">{d.notes}</p>
                      )}
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="text-right sm:text-center min-w-[100px]">
                    <p className={`text-lg font-bold ${d.isCleared ? 'text-slate-400 line-through' : 'text-red-600'}`}>
                      {fmt(d.amountOwed)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {branches.find(b => b._id === d.branchId)?.name || 'Unknown branch'}
                    </p>
                  </div>

                  {/* Time Owing */}
                  {!d.isCleared ? (
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold ${urgencyStyle(days)}`}>
                      {isOverdue
                        ? <AlertTriangle className="w-3.5 h-3.5" />
                        : <Clock className="w-3.5 h-3.5" />}
                      Owing {owing}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-100 border border-green-200 text-xs font-semibold text-green-700">
                      <CheckCircle className="w-3.5 h-3.5" />
                      Cleared{d.clearedAt ? ` ${timeOwing(d.clearedAt).label} ago` : ''}
                    </div>
                  )}

                  {/* Recorded by + Date */}
                  <div className="text-xs text-slate-400 min-w-[90px] text-right hidden sm:block">
                    <p>by {d.createdByName}</p>
                    <p>{new Date(d.createdAt).toLocaleDateString('en-NG')}</p>
                  </div>

                  {/* Action */}
                  <div className="flex-shrink-0">
                    {d.isCleared ? (
                      <button onClick={() => reactivateDebtor(d)} disabled={clearing === d._id}
                        className="flex items-center gap-1.5 text-xs px-3 py-2 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-lg transition-colors font-medium border border-amber-200">
                        {clearing === d._id
                          ? <span className="w-3 h-3 border border-amber-600 border-t-transparent rounded-full animate-spin" />
                          : <RotateCcw className="w-3.5 h-3.5" />}
                        Reactivate
                      </button>
                    ) : (
                      <button onClick={() => clearDebtor(d)} disabled={clearing === d._id}
                        className="flex items-center gap-1.5 text-xs px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors font-medium disabled:opacity-50">
                        {clearing === d._id
                          ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : <CheckCircle className="w-3.5 h-3.5" />}
                        Mark Cleared
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {filtered.length > 0 && (
          <p className="text-xs text-slate-400 text-right mt-3">
            Showing {filtered.length} of {debtors.length} debtors
          </p>
        )}
      </div>
    </div>
  );
}