import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { find, Collections, resetAllSalesData } from '../lib/api';
import type { Sale, DailyReport, Debtor } from '../lib/types';
import {
  TrendingUp, TrendingDown, Clock, CheckCircle, DollarSign,
  CreditCard, Package, HandCoins, XCircle, ArrowUpDown, RefreshCw, Trash2,
} from 'lucide-react';

interface Stats {
  todaySales: number;
  todayCash: number;
  todayPos: number;
  todayExpenses: number;
  todayNet: number;
  totalTransactions: number;
  unpaidCount: number;
  unpaidAmount: number;
  pendingReports: number;
  approvedReports: number;
  rejectedReports: number;
  activeDebtors: number;
  totalDebtorAmount: number;
  clearedDebtors: number;
  totalClearedAmount: number;
}

const EMPTY: Stats = {
  todaySales: 0, todayCash: 0, todayPos: 0, todayExpenses: 0, todayNet: 0,
  totalTransactions: 0, unpaidCount: 0, unpaidAmount: 0,
  pendingReports: 0, approvedReports: 0, rejectedReports: 0,
  activeDebtors: 0, totalDebtorAmount: 0, clearedDebtors: 0, totalClearedAmount: 0,
};

const ROLE_BADGE: Record<string, string> = {
  admin:   'bg-red-100 text-red-700',
  manager: 'bg-blue-100 text-blue-700',
  staff:   'bg-green-100 text-green-700',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Reset modal state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetDate, setResetDate] = useState('');
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => { fetchStats(); }, [user]);

  async function fetchStats(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const today       = new Date().toISOString().split('T')[0];
    const start       = `${today}T00:00:00.000Z`;
    const end         = `${today}T23:59:59.999Z`;
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    const saleFilter:    Record<string, any> = { saleDate:    { $gte: start, $lte: end } };
    const expenseFilter: Record<string, any> = { expenseDate: { $gte: start, $lte: end } };
    const reportFilter:  Record<string, any> = { reportDate:  { $gte: `${sevenDaysAgo}T00:00:00.000Z` } };
    const debtorFilter:  Record<string, any> = {};

    if (user?.role !== 'admin' && user?.branchId) {
      saleFilter.branchId    = user.branchId;
      expenseFilter.branchId = user.branchId;
      reportFilter.branchId  = user.branchId;
      debtorFilter.branchId  = user.branchId;
    }

    const [sales, expenses, reports, debtors] = await Promise.all([
      find(Collections.SALES,         saleFilter),
      find(Collections.EXPENSES,      expenseFilter),
      find(Collections.DAILY_REPORTS, reportFilter),
      find(Collections.DEBTORS,       debtorFilter),
    ]);

    const s = sales   as Sale[];
    const r = reports as DailyReport[];
    const d = debtors as Debtor[];

    const todaySales    = s.reduce((acc, x) => acc + Number(x.totalAmount), 0);
    const todayExpenses = (expenses as any[]).reduce((acc, x) => acc + Number(x.amount), 0);

    setStats({
      todaySales,
      todayCash:          s.filter(x => x.paymentMethod === 'cash').reduce((acc, x) => acc + Number(x.totalAmount), 0),
      todayPos:           s.filter(x => x.paymentMethod === 'pos').reduce((acc, x) => acc + Number(x.totalAmount), 0),
      todayExpenses,
      todayNet:           todaySales - todayExpenses,
      totalTransactions:  s.length,
      unpaidCount:        s.filter(x => x.paymentMethod === 'unpaid' || x.paymentMethod === 'part').length,
      unpaidAmount:       s.filter(x => x.paymentMethod === 'unpaid' || x.paymentMethod === 'part')
                           .reduce((acc, x) => acc + Number(x.balanceDue ?? 0), 0),
      pendingReports:     r.filter(x => x.status === 'pending').length,
      approvedReports:    r.filter(x => x.status === 'approved').length,
      rejectedReports:    r.filter(x => x.status === 'rejected').length,
      activeDebtors:      d.filter(x => !x.isCleared).length,
      totalDebtorAmount:  d.filter(x => !x.isCleared).reduce((acc, x) => acc + Number(x.amountOwed), 0),
      clearedDebtors:     d.filter(x => x.isCleared).length,
      totalClearedAmount: d.filter(x => x.isCleared).reduce((acc, x) => acc + Number(x.amountOwed), 0),
    });

    if (isRefresh) setRefreshing(false);
    else setLoading(false);
  }

  function openResetModal() {
    setResetDate(new Date().toISOString().split('T')[0]);
    setResetConfirmText('');
    setResetError(null);
    setShowResetModal(true);
  }

  function closeResetModal() {
    setShowResetModal(false);
    setResetConfirmText('');
    setResetError(null);
  }

  async function handleReset() {
    if (resetConfirmText !== 'RESET' || !resetDate) return;
    setResetting(true);
    setResetError(null);
    try {
      await resetAllSalesData(resetDate);
      closeResetModal();
      fetchStats(true);
    } catch (err: any) {
      setResetError(err?.message ?? 'Reset failed. Please try again.');
    } finally {
      setResetting(false);
    }
  }

  const fmt = (n: number) =>
    `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-800">
              Welcome back, {user?.fullName?.split(' ')[0] || 'there'}
            </h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${ROLE_BADGE[user?.role ?? ''] ?? 'bg-slate-100 text-slate-600'}`}>
              {user?.role}
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            {new Date().toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {user?.role === 'admin' && (
            <button
              onClick={openResetModal}
              className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 px-3 py-1.5 rounded-lg border border-red-200 hover:border-red-400 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Reset Data
            </button>
          )}
          <button
            onClick={() => fetchStats(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Reset Confirmation Modal (admin only) ── */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">

            {/* Modal header */}
            <div className="flex items-center gap-3">
              <div className="bg-red-100 p-2.5 rounded-full shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800 text-lg">Reset Sales Data</h2>
                <p className="text-xs text-red-500 font-medium">This action cannot be undone</p>
              </div>
            </div>

            {/* Description */}
            <p className="text-slate-600 text-sm leading-relaxed">
              This will permanently delete <strong>all sales, expenses, debtors, and the daily report</strong> for the selected date across every branch. User accounts and products will not be affected.
            </p>

            {/* Date picker */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Select date to reset
              </label>
              <input
                type="date"
                value={resetDate}
                max={today}
                onChange={e => setResetDate(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-red-400"
              />
            </div>

            {/* Confirm prompt */}
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              Type <span className="font-mono font-bold">RESET</span> to confirm:
            </div>

            <input
              type="text"
              value={resetConfirmText}
              onChange={e => setResetConfirmText(e.target.value)}
              placeholder="Type RESET to confirm"
              autoFocus
              className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-red-400"
            />

            {/* Error */}
            {resetError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
                {resetError}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={closeResetModal}
                disabled={resetting}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={resetConfirmText !== 'RESET' || !resetDate || resetting}
                className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {resetting
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Resetting…</>
                  : <><Trash2 className="w-4 h-4" /> Reset Data</>
                }
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Top stat cards ── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-6 animate-pulse h-28 border border-slate-100" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          {[
            { label: "Today's Sales",    value: fmt(stats.todaySales),    icon: <TrendingUp className="w-5 h-5" />,  bg: 'bg-amber-500' },
            { label: 'Cash Sales',       value: fmt(stats.todayCash),     icon: <DollarSign className="w-5 h-5" />,  bg: 'bg-green-500' },
            { label: 'POS Sales',        value: fmt(stats.todayPos),      icon: <CreditCard className="w-5 h-5" />,  bg: 'bg-blue-500'  },
            { label: "Today's Expenses", value: fmt(stats.todayExpenses), icon: <Package    className="w-5 h-5" />,  bg: 'bg-red-500'   },
            {
              label: 'Net Income',
              value: fmt(stats.todayNet),
              icon:  stats.todayNet >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />,
              bg:    stats.todayNet >= 0 ? 'bg-emerald-500' : 'bg-rose-600',
            },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-slate-500 text-xs truncate">{c.label}</p>
                  <p className="text-lg font-bold text-slate-800 mt-1 truncate">{c.value}</p>
                </div>
                <div className={`${c.bg} p-2 rounded-lg text-white shrink-0`}>{c.icon}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Summary strip ── */}
      {!loading && (
        <div className="bg-white rounded-xl px-5 py-4 shadow-sm border border-slate-100 flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-slate-400" />
            <span className="text-slate-500 text-sm">Transactions today:</span>
            <span className="font-semibold text-slate-800">{stats.totalTransactions}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" />
            <span className="text-slate-500 text-sm">Unpaid / Part-paid:</span>
            <span className="font-semibold text-amber-600">{stats.unpaidCount}</span>
            {stats.unpaidAmount > 0 && (
              <span className="text-xs text-amber-400">({fmt(stats.unpaidAmount)} outstanding)</span>
            )}
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <span className="text-slate-500 text-sm">Net income:</span>
            <span className={`font-bold text-base ${stats.todayNet >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {fmt(stats.todayNet)}
            </span>
          </div>
        </div>
      )}

      {/* ── Bottom cards ── */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-6 animate-pulse h-52 border border-slate-100" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Report Status */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="font-semibold text-slate-800 mb-4">Report Status (Last 7 Days)</h3>
            <div className="space-y-4">
              {(() => {
                const total = stats.pendingReports + stats.approvedReports + stats.rejectedReports || 1;
                return [
                  { label: 'Pending',  count: stats.pendingReports,  icon: <Clock       className="w-4 h-4 text-amber-500" />, color: 'text-amber-600', bar: 'bg-amber-400' },
                  { label: 'Approved', count: stats.approvedReports, icon: <CheckCircle className="w-4 h-4 text-green-500" />, color: 'text-green-600', bar: 'bg-green-400' },
                  { label: 'Rejected', count: stats.rejectedReports, icon: <XCircle     className="w-4 h-4 text-red-500"   />, color: 'text-red-600',   bar: 'bg-red-400'   },
                ].map(row => (
                  <div key={row.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        {row.icon}
                        <span className="text-slate-600 text-sm">{row.label}</span>
                      </div>
                      <span className={`font-semibold ${row.color}`}>{row.count}</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${row.bar} rounded-full transition-all duration-500`}
                        style={{ width: `${Math.round((row.count / total) * 100)}%` }}
                      />
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* Debtors Overview */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <HandCoins className="w-5 h-5 text-amber-500" />
              Debtors Overview
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 text-sm">Active Debtors</span>
                <span className="font-semibold text-amber-600">{stats.activeDebtors}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 text-sm">Total Amount Owed</span>
                <span className="font-semibold text-red-600">{fmt(stats.totalDebtorAmount)}</span>
              </div>
              <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                <span className="text-slate-600 text-sm">Cleared Debtors</span>
                <span className="font-semibold text-blue-600">{stats.clearedDebtors}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 text-sm">Total Cleared Amount</span>
                <span className="font-semibold text-blue-600">{fmt(stats.totalClearedAmount)}</span>
              </div>
              {(stats.activeDebtors + stats.clearedDebtors) > 0 && (
                <div className="border-t border-slate-100 pt-3">
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-400 rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.round((stats.clearedDebtors / (stats.activeDebtors + stats.clearedDebtors)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {Math.round((stats.clearedDebtors / (stats.activeDebtors + stats.clearedDebtors)) * 100)}% of all debtors cleared
                  </p>
                </div>
              )}
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
