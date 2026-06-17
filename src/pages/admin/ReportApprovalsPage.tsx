import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { find, updateOne, deleteOne, Collections } from '../../lib/api';
import type { DailyReport, Branch, Sale } from '../../lib/types';
import { CheckCircle, XCircle, Clock, Eye, X, Trash2 } from 'lucide-react';

const statusColor = (s: string) =>
  s === 'approved' ? 'bg-green-100 text-green-700' :
  s === 'rejected' ? 'bg-red-100 text-red-700'    :
  'bg-amber-100 text-amber-700';

const statusIcon = (s: string) =>
  s === 'approved' ? <CheckCircle className="w-4 h-4" /> :
  s === 'rejected' ? <XCircle className="w-4 h-4" />    :
  <Clock className="w-4 h-4" />;

const pmBadge = (pm: string) =>
  pm === 'cash'   ? 'bg-green-100 text-green-700'   :
  pm === 'pos'    ? 'bg-blue-100 text-blue-700'     :
  pm === 'part'   ? 'bg-orange-100 text-orange-700' :
                    'bg-red-100 text-red-700';

export default function ReportApprovalsPage() {
  const { user } = useAuth();
  const [reports, setReports]       = useState<(DailyReport & { branch?: Branch })[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [viewReport, setViewReport] = useState<(DailyReport & { branch?: Branch }) | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [saving, setSaving]         = useState(false);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [reportSales, setReportSales] = useState<Sale[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);

  useEffect(() => { fetchReports(); }, [filter]);

  async function fetchReports() {
    setLoading(true);
    const q: Record<string, any> = {};
    if (filter !== 'all') q.status = filter;
    const [reps, branches] = await Promise.all([
      find(Collections.DAILY_REPORTS, q, { sort: { reportDate: -1 } }),
      find(Collections.BRANCHES, {}),
    ]);
    const branchMap = Object.fromEntries((branches as Branch[]).map(b => [b._id, b]));
    setReports((reps as DailyReport[]).map(r => ({ ...r, branch: branchMap[r.branchId] })));
    setLoading(false);
  }

  async function openReport(r: typeof reports[number]) {
    setViewReport(r);
    setReviewNotes(r.reviewNotes || '');
    setReportSales([]);
    setLoadingSales(true);
    try {
      // Fetch sales by reportId — accurate, uses sales.report_id foreign key
      const data = await find(Collections.SALES, { reportId: r._id });
      setReportSales(data as Sale[]);
    } finally {
      setLoadingSales(false);
    }
  }

  async function handleReview(status: 'approved' | 'rejected' | 'pending') {
    if (!viewReport) return;
    setSaving(true);
    await updateOne(Collections.DAILY_REPORTS, { _id: viewReport._id }, {
      status,
      reviewNotes: reviewNotes.trim(),
    });
    await fetchReports();
    setViewReport(null);
    setSaving(false);
  }

  async function handleDelete(r: typeof reports[number]) {
    if (!confirm(`Delete the report for ${r.branch?.name ?? 'this branch'} on ${r.reportDate?.split('T')[0]}?\n\nThis will permanently remove the submission. The sales themselves will NOT be deleted but will become unsubmitted again.`)) return;
    setDeleting(r._id);
    try {
      await deleteOne(Collections.DAILY_REPORTS, { _id: r._id });
      setReports(prev => prev.filter(x => x._id !== r._id));
      if (viewReport?._id === r._id) setViewReport(null);
    } finally {
      setDeleting(null);
    }
  }

  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  // Recalculate actual totals from fetched sales for accuracy
  const calcTotals = (sales: Sale[]) => {
    let cash = 0, pos = 0, unpaid = 0, part = 0, collected = 0, outstanding = 0;
    for (const s of sales) {
      if (s.paymentMethod === 'cash')   cash    += s.totalAmount;
      if (s.paymentMethod === 'pos')    pos     += s.totalAmount;
      if (s.paymentMethod === 'unpaid') unpaid  += s.totalAmount;
      if (s.paymentMethod === 'part')   part    += s.totalAmount;
      collected   += s.amountPaid  ?? (s.paymentMethod === 'unpaid' ? 0 : s.totalAmount);
      outstanding += s.balanceDue  ?? 0;
    }
    return { cash, pos, unpaid, part, collected, outstanding, grand: cash + pos + unpaid + part };
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Report Approvals</h1>
        <p className="text-slate-500 text-sm mt-1">Review and approve daily sales reports</p>
      </div>

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      {viewReport && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">

            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-100 p-5 flex items-center justify-between rounded-t-2xl">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Daily Report</h3>
                <p className="text-sm text-slate-500">
                  {viewReport.branch?.name} · {viewReport.reportDate?.split('T')[0]}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDelete(viewReport)}
                  disabled={deleting === viewReport._id}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                >
                  {deleting === viewReport._id
                    ? <span className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                    : <Trash2 className="w-4 h-4" />}
                  Delete
                </button>
                <button onClick={() => setViewReport(null)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Summary cards — from actual sales if loaded, fallback to report totals */}
              {(() => {
                const t = reportSales.length > 0 ? calcTotals(reportSales) : null;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Cash',    value: t ? t.cash    : viewReport.totalCashSales,   cls: 'bg-green-50 text-green-700' },
                      { label: 'POS',     value: t ? t.pos     : viewReport.totalPosSales,    cls: 'bg-blue-50 text-blue-700'  },
                      { label: 'Unpaid',  value: t ? t.unpaid  : viewReport.totalUnpaidSales, cls: 'bg-red-50 text-red-700'   },
                      { label: 'Part Pay',value: t ? t.part    : 0,                           cls: 'bg-orange-50 text-orange-700' },
                    ].map(c => (
                      <div key={c.label} className={`text-center p-3 rounded-xl ${c.cls}`}>
                        <p className="text-xs font-medium">{c.label}</p>
                        <p className="font-bold text-sm">{fmt(c.value)}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-red-50 rounded-xl text-center">
                  <p className="text-xs font-medium text-red-700">Expenses</p>
                  <p className="font-bold text-red-700">{fmt(viewReport.totalExpenses)}</p>
                </div>
                <div className="p-3 bg-slate-100 rounded-xl text-center">
                  <p className="text-xs font-medium text-slate-700">Net Income</p>
                  <p className={`font-bold ${viewReport.netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {fmt(viewReport.netIncome)}
                  </p>
                </div>
                <div className="p-3 bg-amber-50 rounded-xl text-center">
                  <p className="text-xs font-medium text-amber-700">Debtors</p>
                  <p className="font-bold text-amber-700">{viewReport.debtorCount}</p>
                </div>
              </div>

              <p className="text-sm text-slate-500">
                Submitted by: <span className="font-medium text-slate-700">{viewReport.submittedByName}</span>
              </p>
              {viewReport.notes && (
                <p className="text-sm text-slate-500">Notes: <span className="text-slate-700">{viewReport.notes}</span></p>
              )}

              {/* Transactions table */}
              {loadingSales ? (
                <div className="text-center py-6 text-slate-400 text-sm">Loading transactions…</div>
              ) : reportSales.length > 0 ? (
                <div>
                  <h4 className="font-medium text-slate-700 mb-2 text-sm">
                    Transactions ({reportSales.length})
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-left">
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap">Customer</th>
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Payment</th>
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Items Sold</th>
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right">Total</th>
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right">Paid</th>
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right">Balance</th>
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reportSales.map(s => {
                          const balance = s.balanceDue ?? 0;
                          const paid    = s.amountPaid ?? (s.paymentMethod === 'unpaid' ? 0 : s.totalAmount);
                          const items   = Array.isArray(s.items) ? s.items : [];
                          const itemStr = items
                            .map((it: any) => `${it.product_name ?? it.productName ?? ''}×${it.quantity}`)
                            .filter(Boolean)
                            .join(', ');
                          return (
                            <tr key={s._id} className={balance > 0 ? 'bg-red-50/40' : ''}>
                              <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                                {s.customerName || <span className="text-slate-400">—</span>}
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${pmBadge(s.paymentMethod)}`}>
                                  {s.paymentMethod === 'part' ? 'Part Pay' : s.paymentMethod}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-slate-500 max-w-[200px] truncate">
                                {itemStr || '—'}
                              </td>
                              <td className="px-3 py-2.5 font-medium text-slate-800 text-right whitespace-nowrap">
                                {fmt(s.totalAmount)}
                              </td>
                              <td className="px-3 py-2.5 text-green-700 text-right whitespace-nowrap">
                                {fmt(paid)}
                              </td>
                              <td className={`px-3 py-2.5 font-medium text-right whitespace-nowrap ${balance > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                                {balance > 0 ? fmt(balance) : '—'}
                              </td>
                              <td className="px-3 py-2.5">
                                {balance > 0
                                  ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Outstanding</span>
                                  : <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Completed</span>
                                }
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {/* Totals footer */}
                      {(() => {
                        const t = calcTotals(reportSales);
                        return (
                          <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                            <tr>
                              <td colSpan={3} className="px-3 py-2.5 text-xs font-semibold text-slate-600">
                                Total ({reportSales.length} transactions)
                              </td>
                              <td className="px-3 py-2.5 font-bold text-slate-800 text-right">{fmt(t.grand)}</td>
                              <td className="px-3 py-2.5 font-bold text-green-700 text-right">{fmt(t.collected)}</td>
                              <td className="px-3 py-2.5 font-bold text-red-600 text-right">{t.outstanding > 0 ? fmt(t.outstanding) : '—'}</td>
                              <td />
                            </tr>
                          </tfoot>
                        );
                      })()}
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">No transactions linked to this report.</p>
              )}

              {/* Review actions */}
              {viewReport.status === 'pending' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Review Notes (optional)
                  </label>
                  <textarea
                    value={reviewNotes}
                    onChange={e => setReviewNotes(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none text-sm"
                    placeholder="Notes for the staff member…"
                  />
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleReview('rejected')}
                      disabled={saving}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium text-sm transition-colors"
                    >
                      <XCircle className="w-4 h-4" />Reject
                    </button>
                    <button
                      onClick={() => handleReview('pending')}
                      disabled={saving}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors"
                    >
                      <Clock className="w-4 h-4" />Send Back
                    </button>
                    <button
                      onClick={() => handleReview('approved')}
                      disabled={saving}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium text-sm transition-colors"
                    >
                      {saving
                        ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <CheckCircle className="w-4 h-4" />}
                      Approve
                    </button>
                  </div>
                </div>
              )}

              {viewReport.status !== 'pending' && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                  viewReport.status === 'approved' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}>
                  {statusIcon(viewReport.status)}
                  <span className="capitalize font-medium">{viewReport.status}</span>
                  {viewReport.reviewNotes && (
                    <span className="italic ml-1">— "{viewReport.reviewNotes}"</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              filter === f
                ? 'bg-amber-500 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Report list */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>No reports found</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {reports.map(r => (
              <div key={r._id} className="flex items-center justify-between p-5 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${statusColor(r.status)}`}>
                    {statusIcon(r.status)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-800">{r.branch?.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColor(r.status)}`}>
                        {r.status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">
                      {r.reportDate?.split('T')[0]} · {r.submittedByName}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right hidden sm:block mr-2">
                    <p className="font-bold text-slate-800">{fmt(r.totalSales)}</p>
                    <p className="text-xs text-slate-400">
                      Exp: {fmt(r.totalExpenses)} · Debtors: {r.debtorCount}
                    </p>
                  </div>
                  <button
                    onClick={() => openReport(r)}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                  >
                    <Eye className="w-4 h-4" />Review
                  </button>
                  <button
                    onClick={() => handleDelete(r)}
                    disabled={deleting === r._id}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors"
                  >
                    {deleting === r._id
                      ? <span className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                      : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}