import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { find, updateOne, Collections } from '../../lib/api';
import type { DailyReport, Branch, Sale } from '../../lib/types';
import { CheckCircle, XCircle, Clock, Eye, X } from 'lucide-react';

const statusColor = (s: string) =>
  s === 'approved' ? 'bg-green-100 text-green-700' :
  s === 'rejected' ? 'bg-red-100 text-red-700'    :
  'bg-amber-100 text-amber-700';

const statusIcon = (s: string) =>
  s === 'approved' ? <CheckCircle className="w-4 h-4" /> :
  s === 'rejected' ? <XCircle className="w-4 h-4" />    :
  <Clock className="w-4 h-4" />;

export default function ReportApprovalsPage() {
  const { user } = useAuth();
  const [reports, setReports]     = useState<(DailyReport & { branch?: Branch })[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [viewReport, setViewReport] = useState<(DailyReport & { branch?: Branch }) | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [saving, setSaving]       = useState(false);
  const [reportSales, setReportSales] = useState<Sale[]>([]);

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

    // ── BUG FIX #4 ────────────────────────────────────────────────────────────
    // Previously this called find(SALES, { _id: { $in: r.saleIds.map(...) } })
    // which api.ts silently dropped (no $in support), always returning [].
    //
    // Now: api.ts recognises _id.$in and serialises it as ?ids=id1,id2,id3
    // which the backend sales route handles natively in a single query.
    if (r.saleIds?.length) {
      const sales = await find(Collections.SALES, {
        _id: { $in: r.saleIds },   // plain string ids — api.ts maps these to ?ids=
      });
      setReportSales(sales as Sale[]);
    } else {
      setReportSales([]);
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

  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Report Approvals</h1>
        <p className="text-slate-500 text-sm mt-1">Review and approve daily sales reports</p>
      </div>

      {viewReport && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 p-5 flex items-center justify-between rounded-t-2xl">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Daily Report</h3>
                <p className="text-sm text-slate-500">
                  {viewReport.branch?.name} · {viewReport.reportDate?.split('T')[0]}
                </p>
              </div>
              <button onClick={() => setViewReport(null)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Cash',   value: viewReport.totalCashSales,   cls: 'bg-green-50 text-green-700' },
                  { label: 'POS',    value: viewReport.totalPosSales,    cls: 'bg-blue-50 text-blue-700'  },
                  { label: 'Unpaid', value: viewReport.totalUnpaidSales, cls: 'bg-red-50 text-red-700'   },
                  { label: 'Total',  value: viewReport.totalSales,       cls: 'bg-amber-50 text-amber-700'},
                ].map(c => (
                  <div key={c.label} className={`text-center p-3 rounded-xl ${c.cls}`}>
                    <p className="text-xs font-medium">{c.label}</p>
                    <p className="font-bold">{fmt(c.value)}</p>
                  </div>
                ))}
              </div>

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

              {/* Sales list — now populated correctly via ?ids= fix */}
              {reportSales.length > 0 && (
                <div>
                  <h4 className="font-medium text-slate-700 mb-2 text-sm">
                    Transactions ({reportSales.length})
                  </h4>
                  <div className="max-h-40 overflow-y-auto space-y-1.5">
                    {reportSales.map(s => (
                      <div key={s._id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg text-sm">
                        <div>
                          <span className="font-medium text-slate-800">{fmt(s.totalAmount)}</span>
                          <span className="text-slate-400 ml-2">by {s.staffName}</span>
                          {s.customerName && (
                            <span className="text-slate-500 ml-2">{s.customerName}</span>
                          )}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${
                          s.paymentMethod === 'cash'   ? 'bg-green-100 text-green-700' :
                          s.paymentMethod === 'pos'    ? 'bg-blue-100 text-blue-700'  :
                                                         'bg-red-100 text-red-700'
                        }`}>{s.paymentMethod}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                    placeholder="Notes for the staff member..."
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
                <div className="flex items-center gap-4">
                  <div className="text-right hidden sm:block">
                    <p className="font-bold text-slate-800">{fmt(r.totalSales)}</p>
                    <p className="text-xs text-slate-400">
                      Exp: {fmt(r.totalExpenses)} | Debtors: {r.debtorCount}
                    </p>
                  </div>
                  <button
                    onClick={() => openReport(r)}
                    className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                  >
                    <Eye className="w-4 h-4" />Review
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
