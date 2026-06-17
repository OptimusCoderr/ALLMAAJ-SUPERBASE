import { useEffect, useState } from 'react';
import { find, Collections } from '../../lib/api';
import type { Sale, Branch, Debtor, Expense } from '../../lib/types';
import { TrendingUp, Download, AlertCircle, CheckCircle2, Receipt } from 'lucide-react';

function safeItems(items: any): any[] {
  if (Array.isArray(items)) return items;
  try { return JSON.parse(items); } catch { return []; }
}

export default function SalesReportsPage() {
  const [branches, setBranches]   = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [period, setPeriod]       = useState<'today' | 'week' | 'month' | 'custom'>('week');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');
  const [sales, setSales]           = useState<Sale[]>([]);
  const [expenses, setExpenses]     = useState<Expense[]>([]);
  const [debtors, setDebtors]       = useState<Debtor[]>([]);
  const [clearedDebtors, setClearedDebtors] = useState<Debtor[]>([]);
  const [branchMap, setBranchMap]   = useState<Record<string, string>>({});
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }).then(data => {
      setBranches(data as Branch[]);
      setBranchMap(Object.fromEntries((data as Branch[]).map(b => [b._id, b.name])));
    });
  }, []);

  useEffect(() => { fetchData(); }, [selectedBranch, period, startDate, endDate]);

  function getRange() {
    const today = new Date().toISOString().split('T')[0];
    if (period === 'today') return { start: today, end: today };
    if (period === 'week')  return { start: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0], end: today };
    if (period === 'month') return { start: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0], end: today };
    return { start: startDate, end: endDate };
  }

  async function fetchData() {
    const { start, end } = getRange();
    if (!start || !end) return;
    setLoading(true);

    const salesFilter: Record<string, any> = {
      saleDate: { $gte: `${start}T00:00:00.000Z`, $lte: `${end}T23:59:59.999Z` },
    };
    const expenseFilter: Record<string, any> = {
      expenseDate: { $gte: `${start}T00:00:00.000Z`, $lte: `${end}T23:59:59.999Z` },
    };
    if (selectedBranch) {
      salesFilter.branchId   = selectedBranch;
      expenseFilter.branchId = selectedBranch;
    }

    const activeDebtorFilter: Record<string, any>  = { isCleared: false };
    const clearedDebtorFilter: Record<string, any> = { isCleared: true };
    if (selectedBranch) {
      activeDebtorFilter.branchId  = selectedBranch;
      clearedDebtorFilter.branchId = selectedBranch;
    }

    const [salesData, expenseData, activeDebtorData, clearedDebtorData] = await Promise.all([
      find(Collections.SALES,    salesFilter,          { sort: { saleDate: -1 } }),
      find(Collections.EXPENSES, expenseFilter,        { sort: { expenseDate: -1 } }),
      find(Collections.DEBTORS,  activeDebtorFilter),
      find(Collections.DEBTORS,  clearedDebtorFilter),
    ]);

    setSales(salesData as Sale[]);
    setExpenses(expenseData as Expense[]);

    const periodSaleIds = new Set((salesData as Sale[]).map(s => s._id));
    setDebtors(
      (activeDebtorData as Debtor[]).filter(d => !d.saleId || !periodSaleIds.has(d.saleId))
    );
    setClearedDebtors(clearedDebtorData as Debtor[]);

    setLoading(false);
  }

  function downloadCSV() {
    const { start, end } = getRange();

    // Sales rows
    const salesHeaders = [
      'Date', 'Branch', 'Staff', 'Customer', 'Phone',
      'Payment', 'Item', 'Qty', 'Unit Price (₦)', 'Subtotal (₦)',
      'Sale Total (₦)', 'Paid (₦)', 'Balance Due (₦)',
    ];
    const salesRows = sales.flatMap(s => {
      const items   = safeItems(s.items);
      const paid    = Number(s.amountPaid  ?? (s.paymentMethod === 'unpaid' ? 0 : s.totalAmount));
      const balance = Number(s.balanceDue  ?? 0);
      if (items.length === 0) {
        return [[
          s.saleDate?.split('T')[0] ?? '',
          branchMap[s.branchId] || s.branchId,
          (s as any).staffName || '',
          s.customerName || '',
          s.customerPhone || '',
          s.paymentMethod,
          '', '', '', '',
          Number(s.totalAmount).toFixed(2),
          paid.toFixed(2),
          balance.toFixed(2),
        ]];
      }
      return items.map((item: any, idx: number) => [
        idx === 0 ? (s.saleDate?.split('T')[0] ?? '') : '',
        idx === 0 ? (branchMap[s.branchId] || s.branchId) : '',
        idx === 0 ? ((s as any).staffName || '') : '',
        idx === 0 ? (s.customerName || '') : '',
        idx === 0 ? (s.customerPhone || '') : '',
        idx === 0 ? s.paymentMethod : '',
        item.product_name || item.productName || 'Unknown',
        String(item.quantity),
        Number(item.unit_price ?? item.unitPrice ?? 0).toFixed(2),
        Number(item.subtotal ?? 0).toFixed(2),
        idx === 0 ? Number(s.totalAmount).toFixed(2) : '',
        idx === 0 ? paid.toFixed(2) : '',
        idx === 0 ? balance.toFixed(2) : '',
      ]);
    });

    // Expense rows
    const expenseHeaders = [
      'Date', 'Branch', 'Description', 'Category', 'Amount (₦)', 'Recorded By', 'Notes',
    ];
    const expenseRows = expenses.map(e => [
      e.expenseDate?.split('T')[0] ?? '',
      branchMap[(e as any).branchId] || (e as any).branchId || '',
      e.description,
      e.category || '',
      Number(e.amount).toFixed(2),
      e.recordedByName || '',
      (e as any).notes || '',
    ]);

    // Active carry-over debtor rows
    const debtorHeaders = [
      'Date', 'Branch', 'Customer Name', 'Phone',
      'Type', 'Sale Total (₦)', 'Amount Owed (₦)', 'Recorded By',
    ];
    const debtorRows = debtors.map(d => [
      d.createdAt?.split('T')[0] ?? '',
      branchMap[d.branchId] || d.branchId,
      d.name, d.phone,
      d.paymentMethod === 'part' ? 'Part Payment' : 'Unpaid',
      d.totalSaleAmount != null ? Number(d.totalSaleAmount).toFixed(2) : '',
      Number(d.amountOwed).toFixed(2),
      d.createdByName || '',
    ]);

    // Cleared debtor rows
    const clearedHeaders = [
      'Date Recorded', 'Date Cleared', 'Branch', 'Customer Name', 'Phone',
      'Type', 'Sale Total (₦)', 'Amount Cleared (₦)', 'Recorded By', 'Cleared By',
    ];
    const clearedRows = clearedDebtors.map(d => [
      d.createdAt?.split('T')[0] ?? '',
      d.clearedAt?.split('T')[0] ?? '',
      branchMap[d.branchId] || d.branchId,
      d.name, d.phone,
      d.paymentMethod === 'part' ? 'Part Payment' : 'Unpaid',
      d.totalSaleAmount != null ? Number(d.totalSaleAmount).toFixed(2) : '',
      Number(d.amountOwed).toFixed(2),
      d.createdByName || '',
      d.clearedByName || '',
    ]);

    const escape = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
    const toLine = (row: string[]) => row.map(escape).join(',');

    const csv = [
      `SALES REPORT: ${start} to ${end}`,
      '',
      toLine(salesHeaders),
      ...salesRows.map(r => toLine(r.map(String))),
      '',
      'EXPENSES',
      toLine(expenseHeaders),
      ...expenseRows.map(r => toLine(r.map(String))),
      `,,TOTAL EXPENSES,,,${totalExpenses.toFixed(2)}`,
      '',
      'OUTSTANDING DEBTS (carry-over)',
      toLine(debtorHeaders),
      ...debtorRows.map(r => toLine(r.map(String))),
      '',
      'CLEARED DEBTS',
      toLine(clearedHeaders),
      ...clearedRows.map(r => toLine(r.map(String))),
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `sales-report-${start}-to-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalCash      = sales.filter(s => s.paymentMethod === 'cash').reduce((a, s) => a + Number(s.totalAmount), 0);
  const totalPos       = sales.filter(s => s.paymentMethod === 'pos').reduce((a, s) => a + Number(s.totalAmount), 0);
  const totalPaid      = sales.reduce((a, s) => a + Number(s.amountPaid ?? (s.paymentMethod === 'unpaid' ? 0 : s.totalAmount)), 0);
  const totalBalance   = sales.reduce((a, s) => a + Number(s.balanceDue ?? 0), 0);
  const grandTotal     = sales.reduce((a, s) => a + Number(s.totalAmount), 0);
  const totalExpenses  = expenses.reduce((a, e) => a + Number(e.amount), 0);
  const netIncome      = grandTotal - totalExpenses;
  const totalOwed      = debtors.reduce((a, d) => a + Number(d.amountOwed), 0);
  const totalCleared   = clearedDebtors.reduce((a, d) => a + Number(d.amountOwed), 0);
  const clearedSaleIds = new Set(clearedDebtors.map(d => d.saleId).filter(Boolean));

  const expenseByCategory = expenses.reduce<Record<string, number>>((acc, e) => {
    const cat = e.category || 'other';
    acc[cat] = (acc[cat] || 0) + Number(e.amount);
    return acc;
  }, {});

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

      {/* Filters */}
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
                className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                  period === p ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}>
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

      {/* Summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'Grand Total',     value: fmt(grandTotal),    sub: null,                               subColor: '' },
          { label: 'Cash',            value: fmt(totalCash),     sub: null,                               subColor: '' },
          { label: 'POS',             value: fmt(totalPos),      sub: null,                               subColor: '' },
          { label: 'Total Collected', value: fmt(totalPaid),     sub: `${fmt(totalBalance)} outstanding`, subColor: 'text-red-500' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <p className="text-slate-500 text-sm">{c.label}</p>
            <p className="font-bold text-slate-800 text-xl mt-1">{c.value}</p>
            {c.sub && <p className={`text-xs mt-0.5 ${c.subColor}`}>{c.sub}</p>}
          </div>
        ))}
      </div>

      {/* Expenses + Net Income row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-orange-100">
          <div className="flex items-center gap-2 mb-1">
            <Receipt className="w-4 h-4 text-orange-500" />
            <p className="text-slate-500 text-sm">Total Expenses</p>
          </div>
          <p className="font-bold text-slate-800 text-xl">{fmt(totalExpenses)}</p>
          <p className="text-xs text-orange-600 mt-1">{expenses.length} expense{expenses.length !== 1 ? 's' : ''} recorded</p>
        </div>
        <div className={`bg-white rounded-xl p-5 shadow-sm border ${netIncome >= 0 ? 'border-green-100' : 'border-red-100'}`}>
          <p className="text-slate-500 text-sm">Net Income</p>
          <p className={`font-bold text-xl mt-1 ${netIncome >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(netIncome)}</p>
          <p className="text-xs text-slate-400 mt-1">Sales − Expenses</p>
        </div>
      </div>

      {/* Debt summary row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-red-100">
          <p className="text-slate-500 text-sm">Outstanding Carry-over Debts</p>
          <p className="font-bold text-slate-800 text-xl mt-1">{debtors.length}</p>
          <p className="text-sm font-medium mt-1 text-red-600">{fmt(totalOwed)} still owed</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-blue-100 bg-blue-50/30">
          <p className="text-slate-500 text-sm">Cleared Debts</p>
          <p className="font-bold text-slate-800 text-xl mt-1">{clearedDebtors.length}</p>
          <p className="text-sm font-medium mt-1 text-blue-600">{fmt(totalCleared)} recovered</p>
        </div>
      </div>

      {/* By Branch */}
      {Object.keys(byBranch).length > 1 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-amber-500" />By Branch
          </h3>
          <div className="space-y-3">
            {Object.entries(byBranch).map(([id, b]) => (
              <div key={id} className="flex items-center gap-4">
                <div className="w-28 text-sm font-medium text-slate-700 truncate">{b.name}</div>
                <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full"
                    style={{ width: `${grandTotal > 0 ? (b.total / grandTotal) * 100 : 0}%` }} />
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

      {/* Transactions table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Transactions ({sales.length})</h3>
          {(sales.length > 0 || expenses.length > 0 || debtors.length > 0 || clearedDebtors.length > 0) && (
            <button
              onClick={downloadCSV}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              Download CSV
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-6 space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}
          </div>
        ) : sales.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>No sales in this period</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium text-slate-600 whitespace-nowrap">Date</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Branch</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Customer</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Payment</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Status</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Items Sold</th>
                  <th className="px-4 py-3 font-medium text-slate-600 text-right whitespace-nowrap">Total</th>
                  <th className="px-4 py-3 font-medium text-slate-600 text-right whitespace-nowrap">Paid</th>
                  <th className="px-4 py-3 font-medium text-slate-600 text-right whitespace-nowrap">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sales.map(s => {
                  const items     = safeItems(s.items);
                  const paid      = Number(s.amountPaid ?? (s.paymentMethod === 'unpaid' ? 0 : s.totalAmount));
                  const balance   = Number(s.balanceDue ?? 0);
                  const isCleared = balance > 0 && clearedSaleIds.has(s._id);
                  const hasDebt   = balance > 0 && !isCleared;
                  return (
                    <tr key={s._id} className={`hover:bg-slate-50 transition-colors ${isCleared ? 'bg-blue-50/20' : hasDebt ? 'bg-red-50/30' : ''}`}>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{s.saleDate?.split('T')[0]}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{branchMap[s.branchId] || '-'}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {s.customerName || '-'}
                        {s.customerPhone && <span className="block text-xs text-slate-400">{s.customerPhone}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${
                          s.paymentMethod === 'cash'   ? 'bg-green-100 text-green-700'   :
                          s.paymentMethod === 'pos'    ? 'bg-blue-100 text-blue-700'     :
                          s.paymentMethod === 'part'   ? 'bg-orange-100 text-orange-700' :
                                                         'bg-red-100 text-red-700'
                        }`}>{s.paymentMethod}</span>
                      </td>
                      <td className="px-4 py-3">
                        {isCleared ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium bg-blue-100 text-blue-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />Cleared
                          </span>
                        ) : balance > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />Outstanding
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />Completed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {items.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <ul className="space-y-1">
                            {items.map((item: any, i: number) => (
                              <li key={i} className="flex items-center gap-1.5">
                                <span className="font-medium text-slate-700">
                                  {item.product_name || item.productName || 'Unknown'}
                                </span>
                                <span className="text-slate-400">×</span>
                                <span className="font-bold text-amber-600">{item.quantity}</span>
                                <span className="text-slate-400 text-[10px]">
                                  @ {fmt(item.unit_price ?? item.unitPrice ?? 0)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800 whitespace-nowrap">{fmt(s.totalAmount)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="font-medium text-green-700">{fmt(paid)}</span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isCleared
                          ? <span className="font-bold text-blue-600">{fmt(balance)}</span>
                          : balance > 0
                            ? <span className="font-bold text-red-600">{fmt(balance)}</span>
                            : <span className="text-slate-400 text-xs">—</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-amber-50 border-t-2 border-amber-200">
                  <td colSpan={6} className="px-4 py-3 font-bold text-slate-800">Total</td>
                  <td className="px-4 py-3 text-right font-bold text-amber-600 text-base">{fmt(grandTotal)}</td>
                  <td className="px-4 py-3 text-right font-bold text-green-700">{fmt(totalPaid)}</td>
                  <td className="px-4 py-3 text-right font-bold text-red-600">{totalBalance > 0 ? fmt(totalBalance) : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Expenses table */}
      <div className="bg-white rounded-xl shadow-sm border border-orange-100">
        <div className="p-5 border-b border-orange-100 flex items-center gap-3">
          <Receipt className="w-5 h-5 text-orange-500" />
          <h3 className="font-semibold text-slate-800">Expenses ({expenses.length})</h3>
          {expenses.length > 0 && (
            <span className="ml-auto text-sm font-bold text-orange-600">{fmt(totalExpenses)}</span>
          )}
        </div>

        {loading ? (
          <div className="p-6 space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}
          </div>
        ) : expenses.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">
            No expenses recorded in this period
          </div>
        ) : (
          <>
            {/* Category breakdown */}
            {Object.keys(expenseByCategory).length > 1 && (
              <div className="px-5 py-4 border-b border-orange-50 flex flex-wrap gap-2">
                {Object.entries(expenseByCategory)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, amt]) => (
                    <span key={cat} className="text-xs px-3 py-1 bg-orange-50 text-orange-700 rounded-full font-medium capitalize">
                      {cat}: {fmt(amt)}
                    </span>
                  ))}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-orange-100 bg-orange-50/40">
                    <th className="px-4 py-3 font-medium text-slate-600 whitespace-nowrap">Date</th>
                    <th className="px-4 py-3 font-medium text-slate-600">Branch</th>
                    <th className="px-4 py-3 font-medium text-slate-600">Description</th>
                    <th className="px-4 py-3 font-medium text-slate-600">Category</th>
                    <th className="px-4 py-3 font-medium text-slate-600">Recorded By</th>
                    <th className="px-4 py-3 font-medium text-slate-600">Notes</th>
                    <th className="px-4 py-3 font-medium text-slate-600 text-right whitespace-nowrap">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-orange-50">
                  {expenses.map((e, i) => (
                    <tr key={(e as any)._id || i} className="hover:bg-orange-50/20 transition-colors">
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                        {e.expenseDate?.split('T')[0] ?? '—'}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {branchMap[(e as any).branchId] || '-'}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">{e.description}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-orange-100 text-orange-700 capitalize">
                          {e.category || 'other'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{e.recordedByName || '-'}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{(e as any).notes || '—'}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="font-bold text-orange-600">{fmt(Number(e.amount))}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-orange-100 border-t-2 border-orange-200">
                    <td colSpan={6} className="px-4 py-3 font-bold text-slate-800">Total Expenses</td>
                    <td className="px-4 py-3 text-right font-bold text-orange-600 text-base">{fmt(totalExpenses)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Cleared Debts */}
      <div className="bg-white rounded-xl shadow-sm border border-blue-100">
        <div className="p-5 border-b border-blue-100 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-blue-500" />
          <h3 className="font-semibold text-slate-800">Cleared Debts ({clearedDebtors.length})</h3>
          {clearedDebtors.length > 0 && (
            <span className="ml-auto text-sm font-bold text-blue-600">{fmt(totalCleared)} recovered</span>
          )}
        </div>

        {loading ? (
          <div className="p-6 space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}
          </div>
        ) : clearedDebtors.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">No cleared debts on record</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-blue-100 bg-blue-50/40">
                  <th className="px-4 py-3 font-medium text-slate-600 whitespace-nowrap">Date Recorded</th>
                  <th className="px-4 py-3 font-medium text-slate-600 whitespace-nowrap">Date Cleared</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Branch</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Customer</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Phone</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Type</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Cleared By</th>
                  <th className="px-4 py-3 font-medium text-slate-600 text-right whitespace-nowrap">Sale Total</th>
                  <th className="px-4 py-3 font-medium text-slate-600 text-right whitespace-nowrap">Amount Cleared</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-50">
                {clearedDebtors.map(d => (
                  <tr key={d._id} className="hover:bg-blue-50/30 transition-colors bg-blue-50/10">
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{d.createdAt?.split('T')[0]}</td>
                    <td className="px-4 py-3 text-blue-600 font-medium whitespace-nowrap">{d.clearedAt?.split('T')[0] ?? '—'}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{branchMap[d.branchId] || '-'}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{d.name}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{d.phone}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        d.paymentMethod === 'part' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {d.paymentMethod === 'part' ? 'Part Payment' : 'Unpaid'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-blue-600 text-xs font-medium">{d.clearedByName || '-'}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-slate-500">
                      {d.totalSaleAmount != null && d.totalSaleAmount > 0 ? fmt(d.totalSaleAmount) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span className="font-bold text-blue-600">{fmt(d.amountOwed)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-100 border-t-2 border-blue-200">
                  <td colSpan={8} className="px-4 py-3 font-bold text-slate-800">Total Cleared</td>
                  <td className="px-4 py-3 text-right font-bold text-blue-600 text-base">{fmt(totalCleared)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Outstanding Debts */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="p-5 border-b border-slate-100 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <h3 className="font-semibold text-slate-800">Carry-over Outstanding Debts ({debtors.length})</h3>
          {debtors.length > 0 && (
            <span className="ml-auto text-sm font-bold text-red-600">{fmt(totalOwed)}</span>
          )}
        </div>

        {loading ? (
          <div className="p-6 space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}
          </div>
        ) : debtors.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">
            No carry-over debts — all outstanding amounts are shown in the transactions above
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium text-slate-600 whitespace-nowrap">Date</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Branch</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Customer</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Phone</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Type</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Items Purchased</th>
                  <th className="px-4 py-3 font-medium text-slate-600">Recorded By</th>
                  <th className="px-4 py-3 font-medium text-slate-600 text-right whitespace-nowrap">Sale Total</th>
                  <th className="px-4 py-3 font-medium text-slate-600 text-right whitespace-nowrap">Still Owed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {debtors.map(d => {
                  const saleItems = d.saleItems ?? [];
                  return (
                    <tr key={d._id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{d.createdAt?.split('T')[0]}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{branchMap[d.branchId] || '-'}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{d.name}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{d.phone}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                          d.paymentMethod === 'part' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {d.paymentMethod === 'part' ? 'Part Payment' : 'Unpaid'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {saleItems.length > 0 ? (
                          <ul className="space-y-0.5">
                            {saleItems.map((item, i) => (
                              <li key={i} className="flex items-center gap-1.5">
                                <span className="font-medium text-slate-700">
                                  {(item as any).product_name || (item as any).productName || item.product_id}
                                </span>
                                <span className="text-slate-400">×</span>
                                <span className="font-bold text-amber-600">{item.quantity}</span>
                              </li>
                            ))}
                          </ul>
                        ) : d.notes ? (
                          <span className="text-slate-400 text-[11px]">{d.notes}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{d.createdByName || '-'}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap text-slate-500">
                        {d.totalSaleAmount != null && d.totalSaleAmount > 0 ? fmt(d.totalSaleAmount) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="font-bold text-red-600">{fmt(d.amountOwed)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-red-50 border-t-2 border-red-200">
                  <td colSpan={8} className="px-4 py-3 font-bold text-slate-800">Total Still Owed</td>
                  <td className="px-4 py-3 text-right font-bold text-red-600 text-base">{fmt(totalOwed)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}