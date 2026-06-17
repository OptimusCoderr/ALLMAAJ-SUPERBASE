import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { find, insertOne, updateOne, Collections } from '../lib/api';
import type { Branch, Sale, DailyReport, Expense, Debtor } from '../lib/types';
import { FileText, CheckCircle, Clock, XCircle, Send, TrendingUp, TrendingDown, HandCoins } from 'lucide-react';

const statusColor = (s: string) =>
  s === 'approved' ? 'bg-green-100 text-green-700' :
  s === 'rejected' ? 'bg-red-100 text-red-700' :
  'bg-amber-100 text-amber-700';

const statusIcon = (s: string) =>
  s === 'approved' ? <CheckCircle className="w-4 h-4" /> :
  s === 'rejected' ? <XCircle className="w-4 h-4" /> :
  <Clock className="w-4 h-4" />;

export default function DailyReportPage() {
  const { user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState(user?.branchId || '');
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [existingReport, setExistingReport] = useState<DailyReport | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [pastReports, setPastReports] = useState<DailyReport[]>([]);

  useEffect(() => {
    find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }).then(data => {
      setBranches(data as Branch[]);
    });
  }, []);

  useEffect(() => {
    if (selectedBranch && reportDate) fetchData();
  }, [selectedBranch, reportDate]);

  useEffect(() => {
    if (selectedBranch) fetchPast();
  }, [selectedBranch]);

  async function fetchData() {
    setLoading(true);
    const start = `${reportDate}T00:00:00.000Z`;
    const end = `${reportDate}T23:59:59.999Z`;

    const [salesData, expensesData, debtorsData, reportData] = await Promise.all([
      find(Collections.SALES, { branchId: selectedBranch, saleDate: { $gte: start, $lte: end } }),
      find(Collections.EXPENSES, { branchId: selectedBranch, expenseDate: { $gte: start, $lte: end } }),
      find(Collections.DEBTORS, { branchId: selectedBranch, createdAt: { $gte: start, $lte: end } }),
      find(Collections.DAILY_REPORTS, { branchId: selectedBranch, reportDate: { $gte: start, $lte: end } }, { limit: 1 }),
    ]);

    setSales(salesData as Sale[]);
    setExpenses(expensesData as Expense[]);
    setDebtors(debtorsData as Debtor[]);
    setExistingReport((reportData[0] as DailyReport) ?? null);
    setLoading(false);
  }

  async function fetchPast() {
    const data = await find(Collections.DAILY_REPORTS, { branchId: selectedBranch }, { sort: { reportDate: -1 }, limit: 10 });
    setPastReports(data as DailyReport[]);
  }

  const totalCashSales = sales.filter(s => s.paymentMethod === 'cash').reduce((a, s) => a + Number(s.totalAmount), 0);
  const totalPosSales = sales.filter(s => s.paymentMethod === 'pos').reduce((a, s) => a + Number(s.totalAmount), 0);
  const totalUnpaidSales = sales.filter(s => s.paymentMethod === 'unpaid').reduce((a, s) => a + Number(s.totalAmount), 0);
  const totalSales = totalCashSales + totalPosSales + totalUnpaidSales;

  const totalExpenses = expenses.reduce((a, e) => a + Number(e.amount), 0);
  const netIncome = totalSales - totalExpenses;

  const debtorCount = debtors.filter(d => !d.isCleared).length;
  const totalDebtorAmount = debtors.filter(d => !d.isCleared).reduce((a, d) => a + Number(d.amountOwed), 0);

  async function submitReport() {
    if (!selectedBranch) { setError('Select a branch'); return; }
    if (!sales.length && !expenses.length && !debtors.length) {
      setError('No transactions to report today'); return;
    }
    setSubmitting(true);
    setError('');
    const dateISO = `${reportDate}T12:00:00.000Z`;
    try {
      const payload = {
        branchId: selectedBranch,
        submittedBy: user!.id,
        submittedByName: user!.fullName,
        reportDate: dateISO,
        totalCashSales,
        totalPosSales,
        totalUnpaidSales,
        totalSales,
        totalExpenses,
        netIncome,
        debtorCount,
        totalDebtorAmount,
        notes: notes.trim(),
        status: 'pending',
        saleIds: sales.map(s => s._id),
        expenseIds: expenses.map(e => e._id),
        debtorIds: debtors.map(d => d._id),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (existingReport) {
        await updateOne(Collections.DAILY_REPORTS, { _id: { $oid: existingReport._id } }, {
          $set: { ...payload, updatedAt: new Date().toISOString() },
        });
      } else {
        await insertOne(Collections.DAILY_REPORTS, payload);
      }
      setSuccess('Daily report submitted successfully!');
      fetchData();
      fetchPast();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to submit report');
    }
    setSubmitting(false);
  }

  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Daily Sales Report</h1>
        <p className="text-slate-500 text-sm mt-1">Submit end-of-day summary for admin review</p>
      </div>

      {success && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-green-700">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />{success}
        </div>
      )}
      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-5">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Branch</label>
                <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
                  disabled={user?.role !== 'admin'}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-slate-50">
                  <option value="">Select branch...</option>
                  {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Report Date</label>
                <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
            </div>
          </div>

          {!loading && selectedBranch && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-amber-500" />Report Summary
                </h3>
                {existingReport && (
                  <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium capitalize ${statusColor(existingReport.status)}`}>
                    {statusIcon(existingReport.status)}{existingReport.status}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                {[
                  { label: 'Cash Sales', value: totalCashSales, cls: 'bg-green-50 text-green-700' },
                  { label: 'POS Sales', value: totalPosSales, cls: 'bg-blue-50 text-blue-700' },
                  { label: 'Unpaid', value: totalUnpaidSales, cls: 'bg-red-50 text-red-700' },
                  { label: 'Total Sales', value: totalSales, cls: 'bg-amber-50 text-amber-700' },
                ].map(c => (
                  <div key={c.label} className={`text-center p-3 rounded-lg ${c.cls}`}>
                    <p className="text-xs font-medium">{c.label}</p>
                    <p className="font-bold text-lg">{fmt(c.value)}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="p-4 bg-red-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingDown className="w-4 h-4 text-red-500" />
                    <p className="text-xs font-medium text-red-700">Expenses</p>
                  </div>
                  <p className="font-bold text-red-700 text-lg">{fmt(totalExpenses)}</p>
                  <p className="text-xs text-red-500">{expenses.length} expense(s)</p>
                </div>
                <div className="p-4 bg-slate-100 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-4 h-4 text-slate-500" />
                    <p className="text-xs font-medium text-slate-700">Net Income</p>
                  </div>
                  <p className={`font-bold text-lg ${netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {fmt(netIncome)}
                  </p>
                </div>
                <div className="p-4 bg-amber-50 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <HandCoins className="w-4 h-4 text-amber-500" />
                    <p className="text-xs font-medium text-amber-700">Debtors Today</p>
                  </div>
                  <p className="font-bold text-amber-700 text-lg">{debtorCount}</p>
                  <p className="text-xs text-amber-500">{fmt(totalDebtorAmount)} owed</p>
                </div>
              </div>

              {sales.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Sales ({sales.length})</h4>
                  <div className="max-h-32 overflow-y-auto space-y-1.5">
                    {sales.map(s => (
                      <div key={s._id} className="flex items-center justify-between p-2 bg-slate-50 rounded text-xs">
                        <div>
                          <span className="font-medium text-slate-800">{fmt(s.totalAmount)}</span>
                          <span className="text-slate-400 ml-2">by {s.staffName}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full font-medium capitalize ${
                          s.paymentMethod === 'cash' ? 'bg-green-100 text-green-700' :
                          s.paymentMethod === 'pos' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                        }`}>{s.paymentMethod}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {expenses.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Expenses ({expenses.length})</h4>
                  <div className="max-h-32 overflow-y-auto space-y-1.5">
                    {expenses.map(e => (
                      <div key={e._id} className="flex items-center justify-between p-2 bg-red-50 rounded text-xs">
                        <span className="font-medium text-slate-800">{e.description}</span>
                        <span className="font-semibold text-red-700">{fmt(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {debtors.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-slate-700 mb-2">Debtors Today ({debtors.length})</h4>
                  <div className="max-h-32 overflow-y-auto space-y-1.5">
                    {debtors.map(d => (
                      <div key={d._id} className="flex items-center justify-between p-2 bg-amber-50 rounded text-xs">
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

              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none" />
              </div>

              {existingReport?.status === 'approved' ? (
                <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg text-green-700 text-sm">
                  <CheckCircle className="w-4 h-4" />Report approved by admin ({existingReport.reviewedByName}).
                </div>
              ) : existingReport?.status === 'rejected' ? (
                <div className="flex items-center gap-2 p-3 bg-red-50 rounded-lg text-red-700 text-sm">
                  <XCircle className="w-4 h-4" />Rejected by {existingReport.reviewedByName}.
                  {existingReport.reviewNotes && <span className="italic ml-1">"{existingReport.reviewNotes}"</span>}
                </div>
              ) : (
                <button onClick={submitReport} disabled={submitting || (!sales.length && !expenses.length && !debtors.length)}
                  className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white disabled:text-slate-400 font-semibold py-3 rounded-lg transition-colors">
                  {submitting ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
                  {existingReport ? 'Resubmit Report' : 'Submit Daily Report'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 h-fit">
          <h3 className="font-semibold text-slate-800 mb-4">Recent Reports</h3>
          {pastReports.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">No reports yet</p>
          ) : (
            <div className="space-y-3">
              {pastReports.map(r => (
                <div key={r._id} className="p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-slate-800">{r.reportDate?.split('T')[0]}</span>
                    <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColor(r.status)}`}>
                      {statusIcon(r.status)}{r.status}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-amber-600">{fmt(r.totalSales)}</p>
                  <p className="text-xs text-slate-400">By: {r.submittedByName}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
