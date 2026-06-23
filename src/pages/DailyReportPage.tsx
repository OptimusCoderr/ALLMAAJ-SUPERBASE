import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { find, Collections } from '../lib/api';
import type { Branch, Sale, DailyReport, Expense, Debtor } from '../lib/types';
import {
  FileText, CheckCircle, Clock, XCircle, Send,
  TrendingUp, TrendingDown, HandCoins, AlertTriangle, X,
} from 'lucide-react';

// ── Pure helpers ─────────────────────────────────────────────────────────────

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

function getToken(): string {
  return sessionStorage.getItem('bt_session') || localStorage.getItem('bt_session') || '';
}

const fmt = (n: number) =>
  `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

const PM_COLORS: Record<string, string> = {
  cash:   'bg-green-100 text-green-700',
  pos:    'bg-blue-100 text-blue-700',
  part:   'bg-orange-100 text-orange-700',
  unpaid: 'bg-red-100 text-red-700',
};
const PM_LABELS: Record<string, string> = {
  cash: 'Cash', pos: 'POS', part: 'Part', unpaid: 'Unpaid',
};

const statusColor = (s: string) =>
  s === 'approved' ? 'bg-green-100 text-green-700' :
  s === 'rejected' ? 'bg-red-100 text-red-700'    :
  'bg-amber-100 text-amber-700';

const statusIcon = (s: string) =>
  s === 'approved' ? <CheckCircle className="w-3.5 h-3.5" /> :
  s === 'rejected' ? <XCircle     className="w-3.5 h-3.5" /> :
  <Clock className="w-3.5 h-3.5" />;

function isFutureDate(dateStr: string): boolean {
  const today = new Date().toISOString().split('T')[0];
  return dateStr > today;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DailyReportPage() {
  const { user } = useAuth();
  const confirm  = useConfirm();
  const [branches, setBranches]             = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState(user?.branchId || '');
  const [reportDate, setReportDate]         = useState(new Date().toISOString().split('T')[0]);
  const [sales, setSales]                   = useState<Sale[]>([]);
  const [expenses, setExpenses]             = useState<Expense[]>([]);
  const [debtors, setDebtors]               = useState<Debtor[]>([]);
  const [existingReport, setExistingReport] = useState<DailyReport | null>(null);
  const [notes, setNotes]                   = useState('');
  const [loading, setLoading]               = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [success, setSuccess]               = useState('');
  const [error, setError]                   = useState('');
  const [pastReports, setPastReports]       = useState<DailyReport[]>([]);

  useEffect(() => {
    find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }).then(data => {
      const brs = data as Branch[];
      setBranches(brs);
      if (!user?.branchId && brs[0]) setSelectedBranch(brs[0]._id);
    });
  }, []);

  useEffect(() => {
    if (selectedBranch && reportDate) fetchData();
  }, [selectedBranch, reportDate]);

  async function fetchData() {
    setLoading(true);
    setError('');
    const start = `${reportDate}T00:00:00.000Z`;
    const end   = `${reportDate}T23:59:59.999Z`;

    try {
      const [salesData, expensesData, debtorsData, reportsData] = await Promise.all([
        find(Collections.SALES,         { branchId: selectedBranch, saleDate:    { $gte: start, $lte: end } }),
        find(Collections.EXPENSES,      { branchId: selectedBranch, expenseDate: { $gte: start, $lte: end } }),
        find(Collections.DEBTORS,       { branchId: selectedBranch, isCleared: false }),
        // Fetch without date filter — match client-side to avoid backend ::date cast issue
        find(Collections.DAILY_REPORTS, { branchId: selectedBranch }, { limit: 30 }),
      ]);

      const reports = (reportsData as DailyReport[]).sort((a, b) =>
        (b.reportDate ?? '').localeCompare(a.reportDate ?? '')
      );

      setSales(salesData as Sale[]);
      setExpenses(expensesData as Expense[]);
      setDebtors(debtorsData as Debtor[]);
      setPastReports(reports);
      setExistingReport(reports.find(r => r.reportDate?.split('T')[0] === reportDate) ?? null);
    } catch (err: any) {
      setError(err.message || 'Failed to load report data');
    }
    setLoading(false);
  }

  // ── Computed totals ───────────────────────────────────────────────────────

  const cashSales   = sales.filter(s => s.paymentMethod === 'cash');
  const posSales    = sales.filter(s => s.paymentMethod === 'pos');
  const partSales   = sales.filter(s => s.paymentMethod === 'part');
  const unpaidSales = sales.filter(s => s.paymentMethod === 'unpaid');

  const totalCashSales   = cashSales.reduce((a, s)   => a + Number(s.totalAmount), 0);
  const totalPosSales    = posSales.reduce((a, s)    => a + Number(s.totalAmount), 0);
  const totalPartSales   = partSales.reduce((a, s)   => a + Number(s.totalAmount), 0);
  const totalUnpaidSales = unpaidSales.reduce((a, s) => a + Number(s.totalAmount), 0);
  const totalSales       = totalCashSales + totalPosSales + totalPartSales + totalUnpaidSales;
  const totalExpenses    = expenses.reduce((a, e) => a + Number(e.amount), 0);
  const netIncome        = totalCashSales + totalPosSales + totalPartSales - totalExpenses;
  const debtorCount      = debtors.length;
  const totalDebtorAmount = debtors.reduce((a, d) => a + Number(d.amountOwed), 0);

  const canSubmit   = !existingReport || existingReport.status !== 'approved';
  const isApproved  = existingReport?.status === 'approved';
  const isRejected  = existingReport?.status === 'rejected';
  const isPending   = existingReport?.status === 'pending';
  const isResubmit  = !!existingReport && !isApproved;
  const futureDate  = isFutureDate(reportDate);
  const hasData     = sales.length > 0 || expenses.length > 0 || debtors.length > 0;

  async function submitReport() {
    if (!selectedBranch) { setError('Select a branch'); return; }
    if (futureDate)       { setError('Cannot submit a report for a future date'); return; }
    if (isResubmit && !await confirm({
      title: 'Replace Existing Report',
      message: `A ${existingReport?.status} report already exists for this date. Resubmitting will replace it. Continue?`,
      confirmText: 'Resubmit',
    })) return;

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/reports/daily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          branchId: selectedBranch,
          reportDate,
          totalCashSales,
          totalPosSales,
          totalUnpaidSales,
          totalPartSales,
          totalExpenses,
          netIncome,
          debtorCount,
          totalDebtorAmount,
          notes: notes.trim(),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }

      setSuccess('Daily report submitted successfully! Awaiting admin review.');
      setNotes('');
      fetchData();
      setTimeout(() => setSuccess(''), 6000);
    } catch (err: any) {
      setError(err.message || 'Failed to submit report');
    }
    setSubmitting(false);
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Daily Sales Report</h1>
        <p className="text-slate-500 text-sm mt-1">Submit end-of-day summary for admin review</p>
      </div>

      {/* Banners */}
      {success && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-green-700">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />
          <span className="flex-1">{success}</span>
          <button onClick={() => setSuccess('')}><X className="w-4 h-4 opacity-60 hover:opacity-100" /></button>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')}><X className="w-4 h-4 opacity-60 hover:opacity-100" /></button>
        </div>
      )}
      {futureDate && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          You're viewing a future date. No data will be shown and submission is disabled.
        </div>
      )}

      {isRejected && existingReport && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
          <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Report Rejected by {existingReport.reviewedByName}</p>
            {existingReport.reviewNotes && (
              <p className="text-sm mt-1 italic">"{existingReport.reviewNotes}"</p>
            )}
            <p className="text-sm mt-1">Please make corrections and resubmit.</p>
          </div>
        </div>
      )}

      {isPending && existingReport?.reviewedBy && existingReport.reviewNotes && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Sent back for correction by {existingReport.reviewedByName}</p>
            <p className="text-sm mt-1 italic">"{existingReport.reviewNotes}"</p>
            <p className="text-sm mt-1">Please review and resubmit.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="xl:col-span-2 space-y-5">

          {/* Branch + date selector */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Branch</label>
                {user?.role === 'admin' ? (
                  <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500">
                    <option value="">Select branch...</option>
                    {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                  </select>
                ) : (
                  <div className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 bg-slate-50 text-sm">
                    {branches.find(b => b._id === selectedBranch)?.name || 'Your Branch'}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Report Date</label>
                <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
            </div>
          </div>

          {/* Loading skeleton */}
          {loading && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          )}

          {/* Report summary */}
          {!loading && selectedBranch && (
            <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-amber-500" />
                  Report Summary
                  <span className="text-slate-400 text-sm font-normal">— {reportDate}</span>
                </h3>
                {existingReport && (
                  <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium capitalize ${statusColor(existingReport.status)}`}>
                    {statusIcon(existingReport.status)}{existingReport.status}
                    {existingReport.reviewedByName && (
                      <span className="opacity-70">· {existingReport.reviewedByName}</span>
                    )}
                  </span>
                )}
              </div>

              {/* Payment breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Cash',   amount: totalCashSales,   count: cashSales.length,   cls: 'bg-green-50 text-green-700'  },
                  { label: 'POS',    amount: totalPosSales,    count: posSales.length,    cls: 'bg-blue-50 text-blue-700'    },
                  { label: 'Part',   amount: totalPartSales,   count: partSales.length,   cls: 'bg-orange-50 text-orange-700'},
                  { label: 'Unpaid', amount: totalUnpaidSales, count: unpaidSales.length, cls: 'bg-red-50 text-red-700'      },
                ].map(c => (
                  <div key={c.label} className={`text-center p-3 rounded-lg ${c.cls}`}>
                    <p className="text-xs font-medium">{c.label}</p>
                    <p className="font-bold">{fmt(c.amount)}</p>
                    <p className="text-xs opacity-70">{c.count} txn{c.count !== 1 ? 's' : ''}</p>
                  </div>
                ))}
              </div>

              {/* Totals strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div className="p-3 bg-amber-50 rounded-lg text-center">
                  <p className="text-xs font-medium text-amber-700">Total Sales</p>
                  <p className="font-bold text-amber-700">{fmt(totalSales)}</p>
                  <p className="text-xs text-amber-500">{sales.length} transactions</p>
                </div>
                <div className="p-3 bg-red-50 rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <TrendingDown className="w-3 h-3 text-red-500" />
                    <p className="text-xs font-medium text-red-700">Expenses</p>
                  </div>
                  <p className="font-bold text-red-700">{fmt(totalExpenses)}</p>
                  <p className="text-xs text-red-400">{expenses.length} item{expenses.length !== 1 ? 's' : ''}</p>
                </div>
                <div className={`p-3 rounded-lg text-center ${netIncome >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <TrendingUp className={`w-3 h-3 ${netIncome >= 0 ? 'text-emerald-500' : 'text-rose-500'}`} />
                    <p className={`text-xs font-medium ${netIncome >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Net Income</p>
                  </div>
                  <p className={`font-bold ${netIncome >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(netIncome)}</p>
                </div>
                <div className="p-3 bg-amber-50 rounded-lg text-center">
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <HandCoins className="w-3 h-3 text-amber-500" />
                    <p className="text-xs font-medium text-amber-700">Active Debtors</p>
                  </div>
                  <p className="font-bold text-amber-700">{debtorCount}</p>
                  <p className="text-xs text-amber-500">{fmt(totalDebtorAmount)}</p>
                </div>
              </div>

              {/* Sales list */}
              {sales.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Sales ({sales.length})</h4>
                  <div className="max-h-40 overflow-y-auto space-y-1.5">
                    {sales.map(s => (
                      <div key={s._id || s.id} className="flex items-center justify-between p-2 bg-slate-50 rounded text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-slate-800">{fmt(s.totalAmount)}</span>
                          <span className="text-slate-400 truncate">
                            by {s.staffName}{s.customerName ? ` · ${s.customerName}` : ''}
                          </span>
                        </div>
                        <span className={`flex-shrink-0 px-2 py-0.5 rounded-full font-medium capitalize ml-2 ${PM_COLORS[s.paymentMethod] ?? 'bg-slate-100 text-slate-600'}`}>
                          {PM_LABELS[s.paymentMethod] ?? s.paymentMethod}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Expenses list */}
              {expenses.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Expenses ({expenses.length})</h4>
                  <div className="max-h-32 overflow-y-auto space-y-1.5">
                    {expenses.map(e => (
                      <div key={e._id || (e as any).id} className="flex items-center justify-between p-2 bg-red-50 rounded text-xs">
                        <div className="min-w-0">
                          <span className="font-medium text-slate-800">{e.description}</span>
                          <span className="text-slate-400 ml-2 capitalize">{e.category}</span>
                        </div>
                        <span className="font-semibold text-red-700 flex-shrink-0 ml-2">{fmt(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Debtors list */}
              {debtors.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Active Debtors ({debtors.length})</h4>
                  <div className="max-h-32 overflow-y-auto space-y-1.5">
                    {debtors.map(d => (
                      <div key={d._id || (d as any).id} className="flex items-center justify-between p-2 bg-amber-50 rounded text-xs">
                        <div>
                          <span className="font-medium text-slate-800">{d.name}</span>
                          <span className="text-slate-400 ml-2">{d.phone}</span>
                        </div>
                        <span className="font-semibold text-amber-700">{fmt(d.amountOwed)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!hasData && !futureDate && (
                <div className="py-6 text-center text-slate-400 text-sm">
                  No sales, expenses, or debtors recorded for this date yet.
                </div>
              )}

              {/* Notes + submit */}
              {!isApproved && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Notes for admin (optional)</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none text-sm"
                    placeholder="Any notes for the admin..." />
                </div>
              )}

              {isApproved ? (
                <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg text-green-700 text-sm">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  Approved by {existingReport.reviewedByName}
                  {existingReport.reviewedAt && (
                    <span className="text-green-500 text-xs ml-auto">
                      {new Date(existingReport.reviewedAt).toLocaleDateString('en-NG')}
                    </span>
                  )}
                </div>
              ) : (
                <button
                  onClick={submitReport}
                  disabled={submitting || !selectedBranch || futureDate}
                  className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white disabled:text-slate-400 font-semibold py-3 rounded-lg transition-colors"
                >
                  {submitting
                    ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Send className="w-4 h-4" />}
                  {isResubmit ? 'Resubmit Report' : 'Submit Daily Report'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Recent reports sidebar */}
        <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-slate-100 h-fit">
          <h3 className="font-semibold text-slate-800 mb-4">Recent Reports</h3>
          {pastReports.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">No reports yet</p>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {pastReports.map(r => {
                const dateStr = typeof r.reportDate === 'string' ? r.reportDate.split('T')[0] : r.reportDate;
                const isSelected = dateStr === reportDate;
                return (
                  <button
                    key={r._id || (r as any).id}
                    onClick={() => setReportDate(dateStr)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      isSelected
                        ? 'bg-amber-50 border-amber-300'
                        : 'bg-slate-50 border-slate-100 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-semibold ${isSelected ? 'text-amber-700' : 'text-slate-800'}`}>
                        {dateStr}
                      </span>
                      <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColor(r.status)}`}>
                        {statusIcon(r.status)}{r.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Sales:</span>
                      <span className="font-semibold text-amber-600">{fmt(r.totalSales)}</span>
                    </div>
                    {(r.totalExpenses ?? 0) > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">Expenses:</span>
                        <span className="font-semibold text-red-500">{fmt(r.totalExpenses)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Net:</span>
                      <span className={`font-semibold ${(r.netIncome ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {fmt(r.netIncome ?? 0)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">By: {r.submittedByName}</p>
                    {r.reviewNotes && (
                      <p className="text-xs text-slate-500 italic mt-1 truncate">"{r.reviewNotes}"</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}