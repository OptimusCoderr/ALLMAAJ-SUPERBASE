import { useEffect, useState } from 'react';
import { find, Collections } from '../../lib/api';
import type { Sale, Branch } from '../../lib/types';
import { TrendingUp } from 'lucide-react';

export default function SalesReportsPage() {
  const [branches, setBranches]   = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [period, setPeriod]       = useState<'today' | 'week' | 'month' | 'custom'>('week');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');
  const [sales, setSales]         = useState<Sale[]>([]);
  const [branchMap, setBranchMap] = useState<Record<string, string>>({});
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }).then(data => {
      setBranches(data as Branch[]);
      setBranchMap(Object.fromEntries((data as Branch[]).map(b => [b._id, b.name])));
    });
  }, []);

  useEffect(() => { fetchSales(); }, [selectedBranch, period, startDate, endDate]);

  function getRange() {
    const today = new Date().toISOString().split('T')[0];
    if (period === 'today') return { start: today, end: today };
    if (period === 'week')  return { start: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0], end: today };
    if (period === 'month') return { start: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0], end: today };
    return { start: startDate, end: endDate };
  }

  async function fetchSales() {
    const { start, end } = getRange();
    if (!start || !end) return;
    setLoading(true);
    const filter: Record<string, any> = {
      saleDate: { $gte: `${start}T00:00:00.000Z`, $lte: `${end}T23:59:59.999Z` },
    };
    if (selectedBranch) filter.branchId = selectedBranch;
    const data = await find(Collections.SALES, filter, { sort: { saleDate: -1 } });
    setSales(data as Sale[]);
    setLoading(false);
  }

  const totalCash   = sales.filter(s => s.paymentMethod === 'cash').reduce((a, s) => a + Number(s.totalAmount), 0);
  const totalPos    = sales.filter(s => s.paymentMethod === 'pos').reduce((a, s) => a + Number(s.totalAmount), 0);
  const totalUnpaid = sales.filter(s => s.paymentMethod === 'unpaid').reduce((a, s) => a + Number(s.totalAmount), 0);
  const grandTotal  = totalCash + totalPos + totalUnpaid;

  const byBranch = sales.reduce<Record<string, { name: string; total: number; count: number }>>((acc, s) => {
    if (!acc[s.branchId]) acc[s.branchId] = { name: branchMap[s.branchId] || s.branchId, total: 0, count: 0 };
    acc[s.branchId].total += Number(s.totalAmount);
    acc[s.branchId].count++;
    return acc;
  }, {});

  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Sales Reports</h1>
        <p className="text-slate-500 text-sm mt-1">Analytics across all branches</p>
      </div>

      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <div className="flex flex-wrap gap-3">
          <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
            className="px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500">
            <option value="">All Branches</option>
            {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
          <div className="flex gap-2">
            {(['today', 'week', 'month', 'custom'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${period === p ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {p === 'today' ? 'Today' : p === 'week' ? 'Last 7 Days' : p === 'month' ? 'Last 30 Days' : 'Custom'}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Total Sales', value: fmt(grandTotal), bg: 'bg-amber-500' },
          { label: 'Cash', value: fmt(totalCash), bg: 'bg-green-500' },
          { label: 'POS', value: fmt(totalPos), bg: 'bg-blue-500' },
          { label: 'Unpaid/Credit', value: fmt(totalUnpaid), bg: 'bg-red-500' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <p className="text-slate-500 text-sm">{c.label}</p>
            <p className="font-bold text-slate-800 text-xl mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      {Object.keys(byBranch).length > 1 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-amber-500" />By Branch</h3>
          <div className="space-y-3">
            {Object.entries(byBranch).map(([id, b]) => (
              <div key={id} className="flex items-center gap-4">
                <div className="w-28 text-sm font-medium text-slate-700 truncate">{b.name}</div>
                <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: `${grandTotal > 0 ? (b.total / grandTotal) * 100 : 0}%` }} />
                </div>
                <div className="text-right text-sm">
                  <p className="font-bold text-slate-800">{fmt(b.total)}</p>
                  <p className="text-xs text-slate-400">{b.count} sales</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="p-5 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Transactions ({sales.length})</h3>
        </div>
        {loading ? (
          <div className="p-6 space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}</div>
        ) : sales.length === 0 ? (
          <div className="text-center py-12 text-slate-400"><TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-40" /><p>No sales in this period</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium text-slate-600">Date</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Branch</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Customer</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Payment</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Notes</th>
                  <th className="px-4 py-3 font-medium text-slate-600 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.map(s => (
                  <tr key={s._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-600">{s.saleDate?.split('T')[0]}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{branchMap[s.branchId] || '-'}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {s.customerName || '-'}
                      {s.customerPhone && <span className="block text-xs text-slate-400">{s.customerPhone}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${
                        s.paymentMethod === 'cash' ? 'bg-green-100 text-green-700' :
                        s.paymentMethod === 'pos' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                      }`}>{s.paymentMethod}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs max-w-32 truncate">{s.notes || '-'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(s.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-amber-50 border-t-2 border-amber-200">
                  <td colSpan={5} className="px-4 py-3 font-bold text-slate-800">Total</td>
                  <td className="px-4 py-3 text-right font-bold text-amber-600 text-base">{fmt(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
