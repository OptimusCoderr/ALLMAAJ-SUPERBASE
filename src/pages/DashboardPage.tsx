import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { find, Collections } from '../lib/api';
import type { Sale, DailyReport, Debtor } from '../lib/types';
import { TrendingUp, Clock, CheckCircle, DollarSign, CreditCard, Package, HandCoins } from 'lucide-react';

interface Stats {
  todaySales: number;
  todayCash: number;
  todayPos: number;
  todayExpenses: number;
  pendingReports: number;
  activeDebtors: number;
  totalDebtorAmount: number;
}

const EMPTY: Stats = {
  todaySales: 0, todayCash: 0, todayPos: 0, todayExpenses: 0,
  pendingReports: 0, activeDebtors: 0, totalDebtorAmount: 0,
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchStats(); }, [user]);

  async function fetchStats() {
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const start = `${today}T00:00:00.000Z`;
    const end = `${today}T23:59:59.999Z`;
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    const saleFilter: Record<string, any> = { saleDate: { $gte: start, $lte: end } };
    const expenseFilter: Record<string, any> = { expenseDate: { $gte: start, $lte: end } };

    if (user?.role !== 'admin' && user?.branchId) {
      saleFilter.branchId = user.branchId;
      expenseFilter.branchId = user.branchId;
    }

    const [sales, expenses, reports, debtors] = await Promise.all([
      find(Collections.SALES, saleFilter),
      find(Collections.EXPENSES, expenseFilter),
      find(Collections.DAILY_REPORTS, { reportDate: { $gte: `${sevenDaysAgo}T00:00:00.000Z` } }),
      find(Collections.DEPTORS, user?.role === 'admin' ? {} : { branchId: user?.branchId }),
    ]);

    setStats({
      todaySales:      (sales as Sale[]).reduce((s, x) => s + Number(x.totalAmount), 0),
      todayCash:       (sales as Sale[]).filter(s => s.paymentMethod === 'cash').reduce((s, x) => s + Number(x.totalAmount), 0),
      todayPos:        (sales as Sale[]).filter(s => s.paymentMethod === 'pos').reduce((s, x) => s + Number(x.totalAmount), 0),
      todayExpenses:   (expenses as any[]).reduce((s, x) => s + Number(x.amount), 0),
      pendingReports:  (reports as DailyReport[]).filter(r => r.status === 'pending').length,
      activeDebtors:   (debtors as Debtor[]).filter(d => !d.isCleared).length,
      totalDebtorAmount: (debtors as Debtor[]).filter(d => !d.isCleared).reduce((s, d) => s + Number(d.amountOwed), 0),
    });
    setLoading(false);
  }

  const fmt = (n: number) =>
    `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const roleBadgeColor: Record<string, string> = {
    admin: 'bg-red-100 text-red-700',
    staff: 'bg-green-100 text-green-700',
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">
          Welcome back, {user?.fullName?.split(' ')[0] || 'there'}
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          {new Date().toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-xl p-6 animate-pulse h-28" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: "Today's Total Sales", value: fmt(stats.todaySales), icon: <TrendingUp className="w-6 h-6" />, bg: 'bg-amber-500' },
            { label: 'Cash Sales',          value: fmt(stats.todayCash),  icon: <DollarSign className="w-6 h-6" />,  bg: 'bg-green-500' },
            { label: 'POS Sales',           value: fmt(stats.todayPos),   icon: <CreditCard className="w-6 h-6" />,  bg: 'bg-blue-500' },
            { label: 'Today\'s Expenses',  value: fmt(stats.todayExpenses), icon: <Package className="w-6 h-6" />, bg: 'bg-red-500' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-slate-500 text-sm">{c.label}</p>
                  <p className="text-xl font-bold text-slate-800 mt-1">{c.value}</p>
                </div>
                <div className={`${c.bg} p-2.5 rounded-lg text-white`}>{c.icon}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="font-semibold text-slate-800 mb-4">Report Status (Last 7 Days)</h3>
          <div className="space-y-3">
            {[
              { label: 'Pending',  count: stats.pendingReports, icon: <Clock className="w-4 h-4 text-amber-500" />,   color: 'text-amber-600' },
              { label: 'Approved', count: 0, icon: <CheckCircle className="w-4 h-4 text-green-500" />, color: 'text-green-600' },
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">{r.icon}<span className="text-slate-600 text-sm">{r.label}</span></div>
                <span className={`font-semibold ${r.color}`}>{r.count}</span>
              </div>
            ))}
          </div>
        </div>

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
            <div className="flex items-center justify-between">
              <span className="text-slate-600 text-sm">Your Role</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${roleBadgeColor[user?.role || 'staff']}`}>
                {user?.role}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
