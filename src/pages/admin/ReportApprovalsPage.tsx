import { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { find, updateOne, deleteOne, Collections } from '../../lib/api';
import type { DailyReport, Branch, Sale } from '../../lib/types';
import { SkeletonRow } from '../../components/Skeleton';
import {
  CheckCircle, XCircle, Clock, Eye, X, Trash2,
  Search, Download, RefreshCw, ChevronDown, ChevronUp,
  TrendingUp, AlertCircle, BarChart2, FileText,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Status = 'all' | 'pending' | 'approved' | 'rejected';
type ModalTab = 'overview' | 'transactions' | 'review';

const statusColor = (s: string) =>
  s === 'approved' ? 'bg-green-100 text-green-700' :
  s === 'rejected' ? 'bg-red-100 text-red-700'    :
  'bg-amber-100 text-amber-700';

const statusDot = (s: string) =>
  s === 'approved' ? 'bg-green-500' :
  s === 'rejected' ? 'bg-red-500'  :
  'bg-amber-500';

const statusIcon = (s: string, cls = 'w-4 h-4') =>
  s === 'approved' ? <CheckCircle className={cls} /> :
  s === 'rejected' ? <XCircle className={cls} />    :
  <Clock className={cls} />;

const pmBadge = (pm: string) =>
  pm === 'cash'   ? 'bg-green-100 text-green-700'   :
  pm === 'pos'    ? 'bg-blue-100 text-blue-700'     :
  pm === 'part'   ? 'bg-orange-100 text-orange-700' :
                    'bg-red-100 text-red-700';

const fmt = (n: number) =>
  `₦${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

const fmtDate = (d?: string) => d ? d.split('T')[0] : '—';

function calcTotals(sales: Sale[]) {
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
}

function exportCSV(reports: (DailyReport & { branch?: Branch })[]) {
  const header = ['Date', 'Branch', 'Submitted By', 'Status', 'Total Sales', 'Cash', 'POS', 'Unpaid', 'Expenses', 'Net Income', 'Debtors', 'Reviewed By', 'Reviewed At', 'Notes'];
  const rows = reports.map(r => [
    fmtDate(r.reportDate),
    r.branch?.name ?? r.branchId,
    r.submittedByName,
    r.status,
    r.totalSales,
    r.totalCashSales,
    r.totalPosSales,
    r.totalUnpaidSales,
    r.totalExpenses,
    r.netIncome,
    r.debtorCount,
    r.reviewedByName ?? '',
    r.reviewedAt ? fmtDate(r.reviewedAt) : '',
    r.reviewNotes ?? '',
  ]);
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `report-approvals-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Toast ───────────────────────────────────────────────────────────────────

interface Toast { id: number; message: string; type: 'success' | 'error' | 'info' }

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium pointer-events-auto transition-all
            ${t.type === 'success' ? 'bg-green-600 text-white' :
              t.type === 'error'   ? 'bg-red-600 text-white'   :
                                     'bg-slate-800 text-white'}`}
        >
          {t.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> :
           t.type === 'error'   ? <XCircle className="w-4 h-4 shrink-0" />    :
                                  <AlertCircle className="w-4 h-4 shrink-0" />}
          {t.message}
          <button onClick={() => onRemove(t.id)} className="ml-1 opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReportApprovalsPage() {
  useAuth();

  const [reports, setReports]           = useState<(DailyReport & { branch?: Branch })[]>([]);
  const [loading, setLoading]           = useState(true);
  const [filter, setFilter]             = useState<Status>('pending');
  const [search, setSearch]             = useState('');
  const [dateFrom, setDateFrom]         = useState('');
  const [dateTo, setDateTo]             = useState('');
  const [showFilters, setShowFilters]   = useState(false);
  const [sortField, setSortField]       = useState<'reportDate' | 'totalSales'>('reportDate');
  const [sortAsc, setSortAsc]           = useState(false);
  const [toasts, setToasts]             = useState<Toast[]>([]);
  const [toastId, setToastId]           = useState(0);

  // Modal state
  const [viewReport, setViewReport]     = useState<(DailyReport & { branch?: Branch }) | null>(null);
  const [modalTab, setModalTab]         = useState<ModalTab>('overview');
  const [reviewNotes, setReviewNotes]   = useState('');
  const [saving, setSaving]             = useState(false);
  const [deleting, setDeleting]         = useState<string | null>(null);
  const [reportSales, setReportSales]   = useState<Sale[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);
  const [reReview, setReReview]         = useState(false);

  // ── Toast helper ────────────────────────────────────────────────────────────
  const toast = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = toastId + 1;
    setToastId(id);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, [toastId]);

  const removeToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const q: Record<string, any> = {};
      if (filter !== 'all') q.status = filter;
      const [reps, branches] = await Promise.all([
        find(Collections.DAILY_REPORTS, q, { sort: { reportDate: -1 } }),
        find(Collections.BRANCHES, {}),
      ]);
      const branchMap = Object.fromEntries((branches as Branch[]).map(b => [b._id, b]));
      setReports((reps as DailyReport[]).map(r => ({ ...r, branch: branchMap[r.branchId] })));
    } catch {
      toast('Failed to load reports', 'error');
    } finally {
      setLoading(false);
    }
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchReports(); }, [fetchReports]);

  // ── Derived: counts per status ───────────────────────────────────────────────
  const allCounts = useMemo(() => {
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const r of reports) {
      if (r.status === 'pending')  counts.pending++;
      if (r.status === 'approved') counts.approved++;
      if (r.status === 'rejected') counts.rejected++;
    }
    return counts;
  }, [reports]);

  // ── Derived: filtered + sorted list ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let out = reports;
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(r =>
        r.branch?.name?.toLowerCase().includes(q) ||
        r.submittedByName?.toLowerCase().includes(q) ||
        r.reviewedByName?.toLowerCase().includes(q)
      );
    }
    if (dateFrom) out = out.filter(r => fmtDate(r.reportDate) >= dateFrom);
    if (dateTo)   out = out.filter(r => fmtDate(r.reportDate) <= dateTo);
    out = [...out].sort((a, b) => {
      const av = sortField === 'totalSales' ? a.totalSales : a.reportDate ?? '';
      const bv = sortField === 'totalSales' ? b.totalSales : b.reportDate ?? '';
      return sortAsc ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
    });
    return out;
  }, [reports, search, dateFrom, dateTo, sortField, sortAsc]);

  // ── Summary stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalRevenue  = reports.reduce((s, r) => s + (r.totalSales    ?? 0), 0);
    const totalExpenses = reports.reduce((s, r) => s + (r.totalExpenses ?? 0), 0);
    return { totalRevenue, totalExpenses, ...allCounts };
  }, [reports, allCounts]);

  // ── Open modal ───────────────────────────────────────────────────────────────
  async function openReport(r: typeof reports[number]) {
    setViewReport(r);
    setReviewNotes(r.reviewNotes || '');
    setModalTab('overview');
    setReReview(false);
    setReportSales([]);
    setLoadingSales(true);
    try {
      const data = await find(Collections.SALES, { reportId: r._id });
      setReportSales(data as Sale[]);
    } catch {
      // non-fatal
    } finally {
      setLoadingSales(false);
    }
  }

  // ── Review ───────────────────────────────────────────────────────────────────
  async function handleReview(status: 'approved' | 'rejected' | 'pending') {
    if (!viewReport) return;
    setSaving(true);
    try {
      await updateOne(Collections.DAILY_REPORTS, { _id: viewReport._id }, {
        status,
        reviewNotes: reviewNotes.trim(),
      });
      const label = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Sent back';
      toast(`${label} report for ${viewReport.branch?.name}`, 'success');
      await fetchReports();
      setViewReport(null);
    } catch (e: any) {
      toast(e?.message || 'Action failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  async function handleDelete(r: typeof reports[number], fromModal = false) {
    if (!confirm(
      `Delete the report for ${r.branch?.name ?? 'this branch'} on ${fmtDate(r.reportDate)}?\n\nThis permanently removes the submission. The linked sales will NOT be deleted but will become unsubmitted.`
    )) return;
    setDeleting(r._id);
    try {
      await deleteOne(Collections.DAILY_REPORTS, { _id: r._id });
      setReports(prev => prev.filter(x => x._id !== r._id));
      if (fromModal) setViewReport(null);
      toast(`Deleted report for ${r.branch?.name}`, 'info');
    } catch (e: any) {
      toast(e?.message || 'Delete failed', 'error');
    } finally {
      setDeleting(null);
    }
  }

  // ── Sort toggle ──────────────────────────────────────────────────────────────
  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortAsc(a => !a);
    else { setSortField(field); setSortAsc(false); }
  }

  const SortIcon = ({ field }: { field: typeof sortField }) =>
    sortField !== field ? null :
    sortAsc ? <ChevronUp className="w-3.5 h-3.5 ml-0.5 inline" /> :
              <ChevronDown className="w-3.5 h-3.5 ml-0.5 inline" />;

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-6 h-6 text-amber-500" />
            Report Approvals
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">Review and approve daily sales reports submitted by staff</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCSV(filtered)}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 text-sm px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-lg transition-colors disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button
            onClick={fetchReports}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.pending}</p>
            <p className="text-xs text-slate-500">Pending</p>
          </div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
            <CheckCircle className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.approved}</p>
            <p className="text-xs text-slate-500">Approved</p>
          </div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
            <XCircle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{stats.rejected}</p>
            <p className="text-xs text-slate-500">Rejected</p>
          </div>
        </div>
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-lg font-bold text-slate-800 leading-tight">{fmt(stats.totalRevenue)}</p>
            <p className="text-xs text-slate-500">Total Revenue</p>
          </div>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-100 rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Status tabs */}
          <div className="flex gap-1.5 flex-wrap">
            {(['all', 'pending', 'approved', 'rejected'] as const).map(f => {
              const count = f === 'all'
                ? stats.pending + stats.approved + stats.rejected
                : stats[f];
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                    filter === f
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f !== 'all' && <span className={`w-2 h-2 rounded-full ${filter === f ? 'bg-white/70' : statusDot(f)}`} />}
                  {f}
                  {!loading && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                      filter === f ? 'bg-white/20 text-white' : 'bg-white text-slate-600'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="flex-1 relative min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search branch or staff name…"
              className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <button
            onClick={() => setShowFilters(f => !f)}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 border rounded-lg transition-colors ${
              showFilters || dateFrom || dateTo
                ? 'border-amber-500 text-amber-600 bg-amber-50'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <BarChart2 className="w-4 h-4" />
            Filters
            {(dateFrom || dateTo) && <span className="w-2 h-2 rounded-full bg-amber-500" />}
          </button>
        </div>

        {/* Advanced filters */}
        {showFilters && (
          <div className="flex flex-wrap gap-3 pt-1 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium whitespace-nowrap">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium whitespace-nowrap">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="text-xs text-red-500 hover:text-red-700 underline"
              >
                Clear dates
              </button>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <label className="text-xs text-slate-500 font-medium">Sort by</label>
              <button
                onClick={() => toggleSort('reportDate')}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                  sortField === 'reportDate' ? 'border-amber-500 text-amber-600 bg-amber-50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Date <SortIcon field="reportDate" />
              </button>
              <button
                onClick={() => toggleSort('totalSales')}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                  sortField === 'totalSales' ? 'border-amber-500 text-amber-600 bg-amber-50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Sales <SortIcon field="totalSales" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Report list ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={5} />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState filter={filter} search={search} />
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map(r => (
              <ReportRow
                key={r._id}
                report={r}
                deleting={deleting === r._id}
                onOpen={() => openReport(r)}
                onDelete={() => handleDelete(r)}
              />
            ))}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400 bg-slate-50">
            Showing {filtered.length} of {reports.length} report{reports.length !== 1 ? 's' : ''}
            {(search || dateFrom || dateTo) && ' (filtered)'}
          </div>
        )}
      </div>

      {/* ── Review Modal ────────────────────────────────────────────────────── */}
      {viewReport && (
        <ReviewModal
          report={viewReport}
          tab={modalTab}
          setTab={setModalTab}
          sales={reportSales}
          loadingSales={loadingSales}
          reviewNotes={reviewNotes}
          setReviewNotes={setReviewNotes}
          saving={saving}
          deleting={deleting === viewReport._id}
          reReview={reReview}
          setReReview={setReReview}
          onClose={() => setViewReport(null)}
          onReview={handleReview}
          onDelete={() => handleDelete(viewReport, true)}
        />
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

// ─── Report Row ───────────────────────────────────────────────────────────────

function ReportRow({
  report: r,
  deleting,
  onOpen,
  onDelete,
}: {
  report: DailyReport & { branch?: Branch };
  deleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50/70 transition-colors">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${statusColor(r.status)}`}>
        {statusIcon(r.status)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-800 truncate">{r.branch?.name ?? '—'}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColor(r.status)}`}>
            {r.status}
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">
          {fmtDate(r.reportDate)} · {r.submittedByName}
          {r.reviewedByName && (
            <span className="ml-1 text-slate-300">· Reviewed by {r.reviewedByName}</span>
          )}
        </p>
      </div>

      <div className="text-right hidden sm:block shrink-0">
        <p className="font-bold text-slate-800 text-sm">{fmt(r.totalSales)}</p>
        <p className="text-xs text-slate-400">
          Exp: {fmt(r.totalExpenses)}
          {r.debtorCount > 0 && <span className="ml-1 text-red-400">· {r.debtorCount} debtor{r.debtorCount !== 1 ? 's' : ''}</span>}
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onOpen}
          className="flex items-center gap-1 text-xs px-3 py-1.5 bg-slate-100 hover:bg-amber-50 hover:text-amber-700 text-slate-700 rounded-lg transition-colors"
        >
          <Eye className="w-3.5 h-3.5" /> Review
        </button>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          title="Delete report"
        >
          {deleting
            ? <span className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin inline-block" />
            : <Trash2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ filter, search }: { filter: Status; search: string }) {
  const messages: Record<Status, { icon: React.ReactNode; title: string; sub: string }> = {
    all:      { icon: <FileText className="w-12 h-12" />,    title: 'No reports yet',    sub: 'Reports submitted by staff will appear here.' },
    pending:  { icon: <Clock className="w-12 h-12" />,       title: 'All caught up!',    sub: 'No pending reports waiting for review.' },
    approved: { icon: <CheckCircle className="w-12 h-12" />, title: 'None approved yet', sub: 'Approved reports will appear here.' },
    rejected: { icon: <XCircle className="w-12 h-12" />,     title: 'No rejections',     sub: 'Rejected reports will appear here.' },
  };
  const { icon, title, sub } = search
    ? { icon: <Search className="w-12 h-12" />, title: 'No results', sub: `No reports match "${search}".` }
    : messages[filter];

  return (
    <div className="text-center py-14 text-slate-400">
      <div className="inline-flex opacity-30 mb-3">{icon}</div>
      <p className="font-semibold text-slate-500">{title}</p>
      <p className="text-sm mt-1">{sub}</p>
    </div>
  );
}

// ─── Review Modal ─────────────────────────────────────────────────────────────

function ReviewModal({
  report: r,
  tab,
  setTab,
  sales,
  loadingSales,
  reviewNotes,
  setReviewNotes,
  saving,
  deleting,
  reReview,
  setReReview,
  onClose,
  onReview,
  onDelete,
}: {
  report: DailyReport & { branch?: Branch };
  tab: ModalTab;
  setTab: (t: ModalTab) => void;
  sales: Sale[];
  loadingSales: boolean;
  reviewNotes: string;
  setReviewNotes: (v: string) => void;
  saving: boolean;
  deleting: boolean;
  reReview: boolean;
  setReReview: (v: boolean) => void;
  onClose: () => void;
  onReview: (status: 'approved' | 'rejected' | 'pending') => void;
  onDelete: () => void;
}) {
  const t = sales.length > 0 ? calcTotals(sales) : null;
  const canReview = r.status === 'pending' || reReview;

  const tabs: { id: ModalTab; label: string; badge?: string }[] = [
    { id: 'overview',     label: 'Overview' },
    { id: 'transactions', label: 'Transactions', badge: loadingSales ? '…' : String(sales.length) },
    { id: 'review',       label: r.status === 'pending' ? 'Review' : 'Decision' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-3xl max-h-[95vh] flex flex-col">

        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 pt-5 pb-0 rounded-t-2xl">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-slate-800">{r.branch?.name ?? '—'}</h3>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold capitalize ${statusColor(r.status)}`}>
                  {r.status}
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-0.5">
                {fmtDate(r.reportDate)} · Submitted by {r.submittedByName}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={onDelete}
                disabled={deleting}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors"
              >
                {deleting
                  ? <span className="w-3.5 h-3.5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                  : <Trash2 className="w-3.5 h-3.5" />}
                Delete
              </button>
              <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-0.5">
            {tabs.map(tb => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === tb.id
                    ? 'border-amber-500 text-amber-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tb.label}
                {tb.badge !== undefined && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    tab === tb.id ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {tb.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">

          {/* ── Overview tab ─────────────────────────────────────────────── */}
          {tab === 'overview' && (
            <>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Sales Breakdown</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { label: 'Cash',     value: t ? t.cash    : r.totalCashSales,   cls: 'bg-green-50 text-green-700 border-green-100'     },
                    { label: 'POS',      value: t ? t.pos     : r.totalPosSales,    cls: 'bg-blue-50 text-blue-700 border-blue-100'       },
                    { label: 'Unpaid',   value: t ? t.unpaid  : r.totalUnpaidSales, cls: 'bg-red-50 text-red-700 border-red-100'         },
                    { label: 'Part Pay', value: t ? t.part    : 0,                  cls: 'bg-orange-50 text-orange-700 border-orange-100' },
                  ].map(c => (
                    <div key={c.label} className={`text-center p-3 rounded-xl border ${c.cls}`}>
                      <p className="text-xs font-medium">{c.label}</p>
                      <p className="font-bold text-sm mt-0.5">{fmt(c.value)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Financial Summary</p>
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
                    <p className="text-xs font-medium text-slate-500">Total Sales</p>
                    <p className="font-bold text-slate-800 mt-0.5">{fmt(r.totalSales)}</p>
                  </div>
                  <div className="p-3 bg-red-50 rounded-xl border border-red-100 text-center">
                    <p className="text-xs font-medium text-red-600">Expenses</p>
                    <p className="font-bold text-red-700 mt-0.5">{fmt(r.totalExpenses)}</p>
                  </div>
                  <div className={`p-3 rounded-xl border text-center ${r.netIncome >= 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                    <p className={`text-xs font-medium ${r.netIncome >= 0 ? 'text-green-600' : 'text-red-600'}`}>Net Income</p>
                    <p className={`font-bold mt-0.5 ${r.netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(r.netIncome)}</p>
                  </div>
                </div>
              </div>

              {r.debtorCount > 0 && (
                <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">{r.debtorCount} Debtor{r.debtorCount !== 1 ? 's' : ''}</p>
                    <p className="text-xs text-amber-600">Outstanding debt: {fmt(r.totalDebtorAmount)}</p>
                  </div>
                </div>
              )}

              {r.notes && (
                <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Staff Notes</p>
                  <p className="text-sm text-slate-700">{r.notes}</p>
                </div>
              )}

              {r.status !== 'pending' && (
                <div className={`p-3 rounded-xl border flex items-start gap-2.5 ${
                  r.status === 'approved' ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'
                }`}>
                  {statusIcon(r.status, 'w-5 h-5 mt-0.5 shrink-0')}
                  <div className="flex-1">
                    <p className={`text-sm font-semibold capitalize ${r.status === 'approved' ? 'text-green-700' : 'text-red-700'}`}>
                      {r.status} {r.reviewedAt && `on ${fmtDate(r.reviewedAt)}`}
                    </p>
                    {r.reviewedByName && (
                      <p className={`text-xs mt-0.5 ${r.status === 'approved' ? 'text-green-600' : 'text-red-600'}`}>
                        by {r.reviewedByName}
                      </p>
                    )}
                    {r.reviewNotes && (
                      <p className={`text-sm mt-1 italic ${r.status === 'approved' ? 'text-green-700' : 'text-red-700'}`}>
                        "{r.reviewNotes}"
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Transactions tab ──────────────────────────────────────────── */}
          {tab === 'transactions' && (
            <>
              {loadingSales ? (
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : sales.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No transactions linked to this report.</p>
                </div>
              ) : (
                <>
                  {t && (
                    <div className="grid grid-cols-3 gap-2.5">
                      <div className="p-2.5 bg-slate-50 rounded-xl text-center border border-slate-100">
                        <p className="text-xs text-slate-500">Grand Total</p>
                        <p className="font-bold text-slate-800 text-sm">{fmt(t.grand)}</p>
                      </div>
                      <div className="p-2.5 bg-green-50 rounded-xl text-center border border-green-100">
                        <p className="text-xs text-green-600">Collected</p>
                        <p className="font-bold text-green-700 text-sm">{fmt(t.collected)}</p>
                      </div>
                      <div className="p-2.5 bg-red-50 rounded-xl text-center border border-red-100">
                        <p className="text-xs text-red-600">Outstanding</p>
                        <p className="font-bold text-red-700 text-sm">{t.outstanding > 0 ? fmt(t.outstanding) : '—'}</p>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-left">
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Customer</th>
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Payment</th>
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Items</th>
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right">Total</th>
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right">Paid</th>
                          <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sales.map(s => {
                          const balance = s.balanceDue ?? 0;
                          const paid    = s.amountPaid ?? (s.paymentMethod === 'unpaid' ? 0 : s.totalAmount);
                          const items   = Array.isArray(s.items) ? s.items : [];
                          const itemStr = items
                            .map((it: any) => {
                              const name = it.product_name ?? it.productName ?? '';
                              const cutInches = it.cutLengthInches ?? it.cut_length_inches;
                              return cutInches ? `${name} (${cutInches}" cut)` : `${name}×${it.quantity}`;
                            })
                            .filter(Boolean).join(', ');
                          return (
                            <tr key={s._id} className={`${balance > 0 ? 'bg-red-50/30' : ''} hover:bg-slate-50/50`}>
                              <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                                {s.customerName || <span className="text-slate-400">—</span>}
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${pmBadge(s.paymentMethod)}`}>
                                  {s.paymentMethod === 'part' ? 'Part Pay' : s.paymentMethod}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-slate-500 max-w-[180px] truncate text-xs">
                                {itemStr || '—'}
                              </td>
                              <td className="px-3 py-2.5 font-semibold text-slate-800 text-right whitespace-nowrap">{fmt(s.totalAmount)}</td>
                              <td className="px-3 py-2.5 text-green-700 text-right whitespace-nowrap">{fmt(paid)}</td>
                              <td className={`px-3 py-2.5 font-medium text-right whitespace-nowrap ${balance > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                                {balance > 0 ? fmt(balance) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {t && (
                        <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                          <tr>
                            <td colSpan={3} className="px-3 py-2.5 text-xs font-semibold text-slate-600">
                              {sales.length} transaction{sales.length !== 1 ? 's' : ''}
                            </td>
                            <td className="px-3 py-2.5 font-bold text-slate-800 text-right">{fmt(t.grand)}</td>
                            <td className="px-3 py-2.5 font-bold text-green-700 text-right">{fmt(t.collected)}</td>
                            <td className="px-3 py-2.5 font-bold text-red-600 text-right">{t.outstanding > 0 ? fmt(t.outstanding) : '—'}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Review tab ───────────────────────────────────────────────── */}
          {tab === 'review' && (
            <>
              {r.status !== 'pending' && !reReview && (
                <div className="space-y-4">
                  <div className={`p-4 rounded-xl border flex items-start gap-3 ${
                    r.status === 'approved' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                  }`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      r.status === 'approved' ? 'bg-green-500' : 'bg-red-500'
                    }`}>
                      {statusIcon(r.status, 'w-5 h-5 text-white')}
                    </div>
                    <div>
                      <p className={`font-semibold capitalize ${r.status === 'approved' ? 'text-green-800' : 'text-red-800'}`}>
                        Report {r.status}
                      </p>
                      {r.reviewedByName && (
                        <p className={`text-sm mt-0.5 ${r.status === 'approved' ? 'text-green-600' : 'text-red-600'}`}>
                          by {r.reviewedByName} {r.reviewedAt && `· ${fmtDate(r.reviewedAt)}`}
                        </p>
                      )}
                      {r.reviewNotes && (
                        <p className={`text-sm mt-2 p-2 rounded-lg ${r.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          "{r.reviewNotes}"
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setReReview(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-slate-300 text-slate-500 hover:border-amber-400 hover:text-amber-600 rounded-xl text-sm font-medium transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" /> Change Decision
                  </button>
                </div>
              )}

              {canReview && (
                <div className="space-y-4">
                  {reReview && (
                    <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      You are changing an existing decision. The previous status was <strong>{r.status}</strong>.
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Review Notes <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <textarea
                      value={reviewNotes}
                      onChange={e => setReviewNotes(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none text-sm"
                      placeholder="Add notes for the staff member…"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => onReview('rejected')}
                      disabled={saving}
                      className="flex items-center justify-center gap-2 py-3 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-xl font-medium text-sm transition-colors"
                    >
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                    <button
                      onClick={() => onReview('pending')}
                      disabled={saving}
                      className="flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl font-medium text-sm transition-colors"
                    >
                      <Clock className="w-4 h-4" /> Send Back
                    </button>
                    <button
                      onClick={() => onReview('approved')}
                      disabled={saving}
                      className="flex items-center justify-center gap-2 py-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white rounded-xl font-medium text-sm transition-colors"
                    >
                      {saving
                        ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <CheckCircle className="w-4 h-4" />}
                      Approve
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}