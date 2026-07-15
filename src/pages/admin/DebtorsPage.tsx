import { Fragment, useEffect, useMemo, useState, useCallback } from 'react';
import { find, updateOne, getAuthToken, Collections } from '../../lib/api';
import type { Debtor, Branch, DebtorPayment, SpecialCustomer } from '../../lib/types';
import {
  UserCheck, Search, CheckCircle, XCircle, Phone, User, Clock, Trash2,
  Pencil, X, History, ChevronDown, ChevronUp, DollarSign, CreditCard,
  ArrowLeftRight, Calendar, AlertTriangle, Plus, Star, Mail, MapPin,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { SkeletonCard } from '../../components/Skeleton';
import Pagination from '../../components/Pagination';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

// ── Types ──────────────────────────────────────────────────────────────────────

interface EditDebtorState {
  debtor: Debtor;
  name: string;
  phone: string;
  amount: string;
  notes: string;
  dueDate: string;
  loading: boolean;
  error: string;
}

interface PayModalState {
  debtor: Debtor;
  amount: string;
  method: 'cash' | 'pos' | 'transfer';
  notes: string;
  loading: boolean;
  error: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function timeOwing(createdAt: string): { label: string; days: number } {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  if (days === 0) return { label: 'Today', days };
  if (days === 1) return { label: '1 day', days };
  if (days < 7)   return { label: `${days} days`, days };
  if (days < 30)  return { label: `${Math.floor(days / 7)}w ${days % 7}d`, days };
  if (days < 365) return { label: `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''}`, days };
  return { label: `${Math.floor(days / 365)} yr+`, days };
}

function urgencyStyle(days: number): string {
  if (days >= 30) return 'text-red-700 bg-red-100';
  if (days >= 7)  return 'text-orange-700 bg-orange-100';
  if (days >= 1)  return 'text-amber-700 bg-amber-100';
  return 'text-slate-600 bg-slate-100';
}

function parseProducts(notes: string | undefined): string {
  if (!notes) return '';
  const match = notes.match(/^Sale:\s*(.+?)(\s*\|.*)?$/);
  return match ? match[1].trim() : '';
}

function isOverdue(dueDate: string | null | undefined, isCleared: boolean): boolean {
  if (!dueDate || isCleared) return false;
  return new Date(dueDate) < new Date();
}

function methodIcon(method: 'cash' | 'pos' | 'transfer') {
  if (method === 'cash')     return <DollarSign className="w-3 h-3" />;
  if (method === 'pos')      return <CreditCard className="w-3 h-3" />;
  return <ArrowLeftRight className="w-3 h-3" />;
}

function methodLabel(method: 'cash' | 'pos' | 'transfer') {
  if (method === 'cash')  return 'Cash';
  if (method === 'pos')   return 'POS';
  return 'Transfer';
}

// Loose phone match (last 10 digits) so "08012345678" and "+2348012345678"
// are recognised as the same person despite formatting differences.
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function fmtDateTime(dateStr: string) {
  const d = new Date(dateStr);
  return {
    date: d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
  };
}

// ── Special-customer grouping ────────────────────────────────────────────────
//
// A debtor record only ever carries a name + phone (no email — that only
// lives on the Special Customer profile, so it can't be used to match
// incoming debt records against one). The same person can end up with
// slightly different phone numbers across visits (retyped, new line, etc.),
// so a debtor is matched to a Special Customer if EITHER its phone OR its
// name matches — phone is tried first since it's the stronger identifier.

interface CustomerGroupRow { type: 'group'; key: string; special: SpecialCustomer; debtors: Debtor[] }
interface SingleRow        { type: 'single'; key: string; debtor: Debtor }
type ListRow = CustomerGroupRow | SingleRow;

interface SpecialCustomerIndex {
  byPhone: Map<string, SpecialCustomer>;
  byName: Map<string, SpecialCustomer>;
}

function buildSpecialCustomerIndex(specials: SpecialCustomer[]): SpecialCustomerIndex {
  const byPhone = new Map<string, SpecialCustomer>();
  const byName  = new Map<string, SpecialCustomer>();
  for (const c of specials) {
    if (c.phone) {
      const norm = normalizePhone(c.phone);
      if (norm.length >= 7) byPhone.set(norm, c);
    }
    if (c.name) byName.set(normalizeName(c.name), c);
  }
  return { byPhone, byName };
}

function matchSpecialCustomer(d: Debtor, index: SpecialCustomerIndex): SpecialCustomer | undefined {
  if (d.phone) {
    const norm = normalizePhone(d.phone);
    if (norm.length >= 7) {
      const byPhone = index.byPhone.get(norm);
      if (byPhone) return byPhone;
    }
  }
  if (d.name) {
    const byName = index.byName.get(normalizeName(d.name));
    if (byName) return byName;
  }
  return undefined;
}

// Groups debtor records matching a known Special Customer (by phone or name)
// into a single row with all their debts inside, leaving everyone else as-is.
// Grouped by the customer's stable _id so debts that matched via different
// signals (one by phone, another by name) still land in the same group.
// Preserves incoming order — each group appears at the position of its
// first (most recent, since the list is newest-first) matching debt.
function buildListRows(debtors: Debtor[], index: SpecialCustomerIndex): ListRow[] {
  const rows: ListRow[] = [];
  const groupIndex = new Map<string, number>();
  for (const d of debtors) {
    const special = matchSpecialCustomer(d, index);
    if (special) {
      const idx = groupIndex.get(special._id);
      if (idx !== undefined) {
        (rows[idx] as CustomerGroupRow).debtors.push(d);
      } else {
        groupIndex.set(special._id, rows.length);
        rows.push({ type: 'group', key: `group-${special._id}`, special, debtors: [d] });
      }
    } else {
      rows.push({ type: 'single', key: d._id, debtor: d });
    }
  }
  return rows;
}

// Lifetime relationship stats for a special customer, computed over ALL of
// their debt records (not just whatever the current filters show) — matched
// the same phone-or-name way as the grouping above.
function customerLifetimeStats(allDebtors: Debtor[], special: SpecialCustomer, index: SpecialCustomerIndex) {
  const matches = allDebtors.filter(d => matchSpecialCustomer(d, index)?._id === special._id);
  const totalTransactions   = matches.length;
  const totalClearedCount   = matches.filter(d => d.isCleared).length;
  const totalEverOwed       = matches.reduce((s, d) => s + (d.totalAmount ?? d.totalSaleAmount ?? d.amountOwed), 0);
  const firstDebtDate       = matches.reduce<string>((min, d) => (!min || d.createdAt < min) ? d.createdAt : min, '');
  return { totalTransactions, totalClearedCount, totalEverOwed, firstDebtDate };
}

// ── Shared row actions (passed down to both card types) ─────────────────────────

interface DebtorActions {
  fmt: (n: number) => string;
  deleting: string | null;
  clearing: string | null;
  expandedId: string | null;
  historyMap: Record<string, DebtorPayment[]>;
  historyLoading: Record<string, boolean>;
  onPay: (d: Debtor) => void;
  onEdit: (d: Debtor) => void;
  onClear: (d: Debtor) => void;
  onReactivate: (d: Debtor) => void;
  onDelete: (d: Debtor) => void;
  onToggleHistory: (id: string) => void;
}

function PaymentHistoryPanel({ debtorId, actions }: { debtorId: string; actions: DebtorActions }) {
  const history = actions.historyMap[debtorId];
  const loading = actions.historyLoading[debtorId];
  if (loading) return <p className="text-xs text-slate-400 text-center py-3">Loading history…</p>;
  if (!history || history.length === 0) return <p className="text-xs text-slate-400 text-center py-3">No payments recorded yet</p>;
  return (
    <div className="space-y-2">
      {history.map(p => (
        <div key={p._id} className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded font-medium ${
              p.method === 'cash' ? 'bg-green-100 text-green-700'
              : p.method === 'pos' ? 'bg-blue-100 text-blue-700'
              : 'bg-purple-100 text-purple-700'
            }`}>
              {methodIcon(p.method)}{methodLabel(p.method)}
            </span>
            <span className="text-slate-600">
              {new Date(p.paidAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            {p.recordedByName && <span className="text-slate-400">· {p.recordedByName}</span>}
            {p.notes && <span className="text-slate-400 italic">· {p.notes}</span>}
          </div>
          <span className="font-bold text-green-700">{actions.fmt(p.amount)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Regular (non-special) debtor card — unchanged detailed layout ──────────────

function DebtorCard({ d, actions }: { d: Debtor; actions: DebtorActions }) {
  const { label: timeLabel, days } = timeOwing(d.createdAt);
  const products     = parseProducts(d.notes);
  const isPartPay    = d.paymentMethod === 'part';
  const overdue      = isOverdue(d.dueDate, d.isCleared);
  const originalAmt  = d.totalAmount ?? d.totalSaleAmount ?? null;
  const paidAmt      = originalAmt != null ? Math.max(0, originalAmt - d.amountOwed) : null;
  const progressPct  = (originalAmt && originalAmt > 0) ? Math.min(100, (paidAmt! / originalAmt) * 100) : null;
  const isExpanded   = actions.expandedId === d._id;

  return (
    <div className={`bg-white rounded-xl shadow-sm border transition-all ${
      overdue ? 'border-orange-300' : d.isCleared ? 'border-blue-200 bg-blue-50/30' : 'border-slate-100'
    }`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${overdue ? 'bg-orange-100' : 'bg-amber-100'}`}>
              <User className={`w-5 h-5 ${overdue ? 'text-orange-600' : 'text-amber-600'}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-800">{d.name}</span>
                {overdue && (
                  <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700">
                    <AlertTriangle className="w-3 h-3" />Overdue
                  </span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  isPartPay ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
                }`}>
                  {isPartPay ? 'Part Payment' : 'Unpaid'}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  d.isCleared ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {d.isCleared ? 'Cleared' : 'Active'}
                </span>
              </div>

              <a href={`tel:${d.phone}`} className="flex items-center gap-1 text-sm text-blue-600 hover:underline mt-0.5">
                <Phone className="w-3 h-3" />{d.phone}
              </a>

              {products && (
                <p className="text-xs text-slate-500 mt-1 truncate max-w-xs">
                  <span className="font-medium text-slate-600">Items:</span> {products}
                </p>
              )}

              <p className="text-xs text-slate-400 mt-1">
                Recorded {new Date(d.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>

              {d.dueDate && (
                <p className={`flex items-center gap-1 text-xs mt-1 font-medium ${overdue ? 'text-orange-600' : 'text-slate-500'}`}>
                  <Calendar className="w-3 h-3" />
                  Due: {new Date(d.dueDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}

              {d.createdByName && (
                <p className="text-xs text-slate-400 mt-0.5">Recorded by {d.createdByName}</p>
              )}
              {d.isCleared && d.clearedByName && (
                <p className="text-xs text-blue-600 mt-0.5">Cleared by {d.clearedByName}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <div className="text-right">
              <p className={`font-bold text-lg ${d.isCleared ? 'text-blue-600' : 'text-red-600'}`}>
                {actions.fmt(d.amountOwed)}
              </p>
              {originalAmt != null && originalAmt > 0 && (
                <p className="text-xs text-slate-400">of {actions.fmt(originalAmt)}</p>
              )}
              {d.isCleared && d.clearedAt && (
                <p className="text-xs text-blue-400 mt-0.5">{new Date(d.clearedAt).toLocaleDateString('en-NG')}</p>
              )}
            </div>

            {!d.isCleared && (
              <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${urgencyStyle(days)}`}>
                <Clock className="w-3 h-3" />{timeLabel}
              </span>
            )}

            <div className="flex flex-col gap-1.5 items-end">
              {!d.isCleared && (
                <button
                  onClick={() => actions.onPay(d)}
                  disabled={actions.deleting === d._id || actions.clearing === d._id}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />Pay
                </button>
              )}
              <button
                onClick={() => actions.onEdit(d)}
                disabled={actions.deleting === d._id || actions.clearing === d._id}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <Pencil className="w-3.5 h-3.5" />Edit
              </button>
              {d.isCleared ? (
                <button
                  onClick={() => actions.onReactivate(d)}
                  disabled={actions.clearing === d._id || actions.deleting === d._id}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  {actions.clearing === d._id
                    ? <span className="w-3 h-3 border border-amber-600 border-t-transparent rounded-full animate-spin" />
                    : <XCircle className="w-3.5 h-3.5" />}
                  Reactivate
                </button>
              ) : (
                <button
                  onClick={() => actions.onClear(d)}
                  disabled={actions.clearing === d._id || actions.deleting === d._id}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-teal-50 text-teal-700 hover:bg-teal-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  {actions.clearing === d._id
                    ? <span className="w-3 h-3 border border-teal-600 border-t-transparent rounded-full animate-spin" />
                    : <CheckCircle className="w-3.5 h-3.5" />}
                  Clear
                </button>
              )}
              <button
                onClick={() => actions.onDelete(d)}
                disabled={actions.deleting === d._id || actions.clearing === d._id}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
              >
                {actions.deleting === d._id
                  ? <span className="w-3 h-3 border border-red-600 border-t-transparent rounded-full animate-spin" />
                  : <Trash2 className="w-3.5 h-3.5" />}
                Delete
              </button>
            </div>
          </div>
        </div>

        {progressPct !== null && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>Paid: {actions.fmt(paidAmt!)}</span>
              <span>{progressPct.toFixed(0)}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${d.isCleared ? 'bg-blue-400' : 'bg-amber-400'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={() => actions.onToggleHistory(d._id)}
          className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
        >
          <History className="w-3.5 h-3.5" />
          Payment History
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 bg-slate-50/60 rounded-b-xl">
          <PaymentHistoryPanel debtorId={d._id} actions={actions} />
        </div>
      )}
    </div>
  );
}

// ── Special-customer group card — collapsed summary that expands into a table
// of every individual debt (transaction), with the date recorded and the
// outstanding time frame called out per row. ──────────────────────────────────

function CustomerGroupCard({
  group, allDebtors, index, actions,
}: {
  group: CustomerGroupRow;
  allDebtors: Debtor[];
  index: SpecialCustomerIndex;
  actions: DebtorActions;
}) {
  const [open, setOpen] = useState(false);
  const { special, debtors } = group;
  const stats = useMemo(() => customerLifetimeStats(allDebtors, special, index), [allDebtors, special, index]);

  const sorted      = [...debtors].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const totalOwed   = debtors.reduce((s, d) => s + d.amountOwed, 0);
  const overdueCount = debtors.filter(d => isOverdue(d.dueDate, d.isCleared)).length;

  return (
    <div className={`bg-white rounded-xl shadow-sm border overflow-hidden ${overdueCount > 0 ? 'border-orange-300' : 'border-amber-200'}`}>
      <button onClick={() => setOpen(v => !v)} className="w-full text-left p-4 hover:bg-amber-50/40 transition-colors">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <Star className="w-5 h-5 text-amber-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-800">{special.name}</span>
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                  <Star className="w-3 h-3" />Special Customer
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">
                  {debtors.length} debt{debtors.length !== 1 ? 's' : ''} in view
                </span>
                {overdueCount > 0 && (
                  <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700">
                    <AlertTriangle className="w-3 h-3" />{overdueCount} overdue
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1">
                {special.phone && (
                  <a href={`tel:${special.phone}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 text-sm text-blue-600 hover:underline">
                    <Phone className="w-3 h-3" />{special.phone}
                  </a>
                )}
                {special.email && (
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <Mail className="w-3 h-3" />{special.email}
                  </span>
                )}
                {special.address && (
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <MapPin className="w-3 h-3" />{special.address}
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-400 mt-1.5">
                {stats.totalTransactions} transaction{stats.totalTransactions !== 1 ? 's' : ''} lifetime
                {' · '}{stats.totalClearedCount} cleared
                {' · '}{actions.fmt(stats.totalEverOwed)} total ever owed
                {stats.firstDebtDate && (
                  <> · customer since {new Date(stats.firstDebtDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</>
                )}
              </p>
            </div>
          </div>

          <div className="text-right flex-shrink-0">
            <p className="font-bold text-lg text-red-600">{actions.fmt(totalOwed)}</p>
            <p className="text-xs text-slate-400">owed in view</p>
            <div className="mt-1.5 flex justify-end text-slate-400">
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs text-slate-500">
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Date Recorded</th>
                <th className="px-4 py-2.5 font-medium">Items</th>
                <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Original</th>
                <th className="px-4 py-2.5 font-medium text-right whitespace-nowrap">Owed</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Due Date</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">Time Frame</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map(d => {
                const { label: timeLabel, days } = timeOwing(d.createdAt);
                const overdue     = isOverdue(d.dueDate, d.isCleared);
                const originalAmt = d.totalAmount ?? d.totalSaleAmount ?? null;
                const products    = parseProducts(d.notes);
                const isExpanded  = actions.expandedId === d._id;
                const recorded    = fmtDateTime(d.createdAt);
                return (
                  <Fragment key={d._id}>
                    <tr className={overdue ? 'bg-orange-50/50' : undefined}>
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                        {recorded.date}
                        <div className="text-xs text-slate-400">{recorded.time}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 max-w-[200px] truncate" title={products}>{products || '—'}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500 whitespace-nowrap">{originalAmt != null ? actions.fmt(originalAmt) : '—'}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${d.isCleared ? 'text-blue-600' : 'text-red-600'}`}>{actions.fmt(d.amountOwed)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {d.dueDate ? (
                          <span className={overdue ? 'text-orange-600 font-medium' : 'text-slate-500'}>
                            {new Date(d.dueDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {!d.isCleared ? (
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${urgencyStyle(days)}`}>
                            <Clock className="w-3 h-3" />{timeLabel}
                          </span>
                        ) : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          d.isCleared ? 'bg-blue-100 text-blue-700' : overdue ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {d.isCleared ? 'Cleared' : overdue ? 'Overdue' : 'Active'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          {!d.isCleared && (
                            <button onClick={() => actions.onPay(d)} title="Record payment" disabled={actions.deleting === d._id || actions.clearing === d._id}
                              className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-50">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => actions.onEdit(d)} title="Edit" disabled={actions.deleting === d._id || actions.clearing === d._id}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {d.isCleared ? (
                            <button onClick={() => actions.onReactivate(d)} title="Reactivate" disabled={actions.clearing === d._id || actions.deleting === d._id}
                              className="p-1.5 text-amber-600 hover:bg-amber-50 rounded transition-colors disabled:opacity-50">
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button onClick={() => actions.onClear(d)} title="Clear" disabled={actions.clearing === d._id || actions.deleting === d._id}
                              className="p-1.5 text-teal-600 hover:bg-teal-50 rounded transition-colors disabled:opacity-50">
                              <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => actions.onDelete(d)} title="Delete" disabled={actions.deleting === d._id || actions.clearing === d._id}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => actions.onToggleHistory(d._id)} title="Payment history"
                            className="p-1.5 text-slate-400 hover:bg-slate-100 rounded transition-colors">
                            <History className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="px-4 py-3 bg-slate-50/60">
                          <PaymentHistoryPanel debtorId={d._id} actions={actions} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function DebtorsPage() {
  const { user } = useAuth();
  const toast    = useToast();
  const confirm  = useConfirm();

  const [debtors, setDebtors]           = useState<Debtor[]>([]);
  const [branches, setBranches]         = useState<Branch[]>([]);
  const [specialCustomers, setSpecialCustomers] = useState<SpecialCustomer[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'cleared' | 'overdue'>('active');
  const [clearing, setClearing]         = useState<string | null>(null);
  const [deleting, setDeleting]         = useState<string | null>(null);
  const [editDebtor, setEditDebtor]     = useState<EditDebtorState | null>(null);
  const [payModal, setPayModal]         = useState<PayModalState | null>(null);
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [historyMap, setHistoryMap]     = useState<Record<string, DebtorPayment[]>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    find(Collections.BRANCHES, {}, { sort: { name: 1 } }).then(b => setBranches(b as Branch[]));
    find(Collections.SPECIAL_CUSTOMERS, {}).then(c => setSpecialCustomers(c as SpecialCustomer[]));
  }, []);

  useEffect(() => { fetchDebtors(); }, [branchFilter]);

  async function fetchDebtors() {
    setLoading(true);
    try {
      const filter: Record<string, any> = {};
      if (branchFilter) filter.branchId = branchFilter;
      const d = await find(Collections.DEBTORS, filter);
      setDebtors(d as Debtor[]);
    } catch (err) {
      console.error('Failed to load debtors:', err);
      setDebtors([]);
    } finally {
      setLoading(false);
    }
  }

  // ── Payment history ─────────────────────────────────────────────────────────

  const loadHistory = useCallback(async (debtorId: string) => {
    if (historyMap[debtorId] !== undefined) return;
    setHistoryLoading(prev => ({ ...prev, [debtorId]: true }));
    try {
      const res = await fetch(`${BASE}/api/reports/debtors/${debtorId}/payments`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      const json = await res.json();
      setHistoryMap(prev => ({ ...prev, [debtorId]: json.data ?? [] }));
    } catch {
      setHistoryMap(prev => ({ ...prev, [debtorId]: [] }));
    } finally {
      setHistoryLoading(prev => ({ ...prev, [debtorId]: false }));
    }
  }, [historyMap]);

  function toggleHistory(debtorId: string) {
    if (expandedId === debtorId) {
      setExpandedId(null);
    } else {
      setExpandedId(debtorId);
      loadHistory(debtorId);
    }
  }

  // ── Record payment ──────────────────────────────────────────────────────────

  async function recordPayment() {
    if (!payModal) return;
    const amt = parseFloat(payModal.amount);
    if (!amt || amt <= 0) { setPayModal({ ...payModal, error: 'Enter a valid amount' }); return; }
    if (amt > payModal.debtor.amountOwed + 0.01) {
      setPayModal({ ...payModal, error: `Cannot exceed amount owed (₦${payModal.debtor.amountOwed.toLocaleString('en-NG')})` });
      return;
    }
    setPayModal({ ...payModal, loading: true, error: '' });
    try {
      const res = await fetch(`${BASE}/api/reports/debtors/${payModal.debtor._id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({
          amount: amt,
          method: payModal.method,
          notes:  payModal.notes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);

      const updatedDebtor: Debtor = json.data?.debtor;
      if (updatedDebtor) {
        setDebtors(prev => prev.map(d => d._id === payModal.debtor._id ? { ...d, ...updatedDebtor } : d));
      }
      setHistoryMap(prev => { const copy = { ...prev }; delete copy[payModal.debtor._id]; return copy; });
      toast.success(`Payment of ₦${amt.toLocaleString('en-NG')} recorded`);
      setPayModal(null);
    } catch (err: any) {
      setPayModal(prev => prev ? { ...prev, loading: false, error: err.message || 'Failed to record payment' } : null);
    }
  }

  // ── Debt management ─────────────────────────────────────────────────────────

  async function clearDebtor(d: Debtor) {
    if (!await confirm({ title: 'Clear Debt', message: `Mark "${d.name}" as fully cleared? They owed ₦${d.amountOwed.toLocaleString('en-NG')}.`, confirmText: 'Clear Debt' })) return;
    setClearing(d._id);
    try {
      await updateOne(Collections.DEBTORS, { _id: { $oid: d._id } }, {
        $set: { isCleared: true },
      });
      setDebtors(prev => prev.map(x => x._id === d._id
        ? { ...x, isCleared: true, clearedBy: user!.id, clearedByName: user!.fullName, clearedAt: new Date().toISOString(), amountOwed: 0 }
        : x));
    } catch (err: any) {
      toast.error(err.message || 'Failed to clear debtor');
    }
    setClearing(null);
  }

  async function deleteDebtor(d: Debtor) {
    if (!await confirm({ title: 'Delete Debtor', message: `Permanently delete "${d.name}"? This cannot be undone.`, confirmText: 'Delete', danger: true })) return;
    setDeleting(d._id);
    try {
      const res = await fetch(`${BASE}/api/reports/debtors/${d._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      setDebtors(prev => prev.filter(x => x._id !== d._id));
      toast.success('Debtor deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete debtor');
    }
    setDeleting(null);
  }

  function openEditDebtor(d: Debtor) {
    setEditDebtor({
      debtor: d,
      name:    d.name || '',
      phone:   d.phone || '',
      amount:  String(d.amountOwed),
      notes:   d.notes || '',
      dueDate: d.dueDate ? d.dueDate.split('T')[0] : '',
      loading: false,
      error:   '',
    });
  }

  async function handleSaveEditDebtor() {
    if (!editDebtor) return;
    if (!editDebtor.name.trim())                                   { setEditDebtor({ ...editDebtor, error: 'Name required' }); return; }
    if (!editDebtor.phone.trim())                                  { setEditDebtor({ ...editDebtor, error: 'Phone required' }); return; }
    if (!editDebtor.amount || parseFloat(editDebtor.amount) <= 0) { setEditDebtor({ ...editDebtor, error: 'Amount owed required' }); return; }
    setEditDebtor({ ...editDebtor, loading: true, error: '' });
    try {
      const res = await fetch(`${BASE}/api/reports/debtors/${editDebtor.debtor._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({
          name:      editDebtor.name.trim(),
          phone:     editDebtor.phone.trim(),
          amountOwed: parseFloat(editDebtor.amount),
          notes:     editDebtor.notes.trim() || null,
          dueDate:   editDebtor.dueDate || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
      const updated: Debtor = json.data;
      setDebtors(prev => prev.map(x => x._id === editDebtor.debtor._id ? { ...x, ...updated } : x));
      setEditDebtor(null);
      toast.success('Debtor updated');
    } catch (err: any) {
      setEditDebtor(prev => prev ? { ...prev, loading: false, error: err.message || 'Failed to save' } : null);
    }
  }

  async function reactivateDebtor(d: Debtor) {
    if (!await confirm({ title: 'Reactivate Debtor', message: `Reactivate "${d.name}" as an active debtor?`, confirmText: 'Reactivate' })) return;
    setClearing(d._id);
    try {
      await updateOne(Collections.DEBTORS, { _id: { $oid: d._id } }, {
        $set: { isCleared: false },
      });
      setDebtors(prev => prev.map(x => x._id === d._id
        ? { ...x, isCleared: false, clearedBy: undefined, clearedByName: undefined, clearedAt: undefined }
        : x));
    } catch (err: any) {
      toast.error(err.message || 'Failed to reactivate');
    }
    setClearing(null);
  }

  // ── Derived lists ───────────────────────────────────────────────────────────

  const [page, setPage]   = useState(1);
  const [limit, setLimit] = useState(20);

  useEffect(() => { setPage(1); }, [search, branchFilter, statusFilter]);

  const filtered = debtors.filter(d => {
    if (statusFilter === 'active'  && d.isCleared)  return false;
    if (statusFilter === 'cleared' && !d.isCleared) return false;
    if (statusFilter === 'overdue' && (!isOverdue(d.dueDate, d.isCleared) || d.isCleared)) return false;
    if (search) {
      const q = search.toLowerCase();
      return d.name.toLowerCase().includes(q) || d.phone.includes(search);
    }
    return true;
  });

  // Debtors matching a Special Customer (by phone) are grouped into one row
  // with all their debts inside, shown as a table once expanded.
  const specialCustomerIndex = useMemo(() => buildSpecialCustomerIndex(specialCustomers), [specialCustomers]);
  const rows        = useMemo(() => buildListRows(filtered, specialCustomerIndex), [filtered, specialCustomerIndex]);
  const paginated   = rows.slice((page - 1) * limit, page * limit);
  const totalPages  = Math.max(1, Math.ceil(rows.length / limit));

  const totalActive   = debtors.filter(d => !d.isCleared).reduce((s, d) => s + d.amountOwed, 0);
  const totalCleared  = debtors.filter(d =>  d.isCleared).reduce((s, d) => s + (d.totalAmount ?? d.amountOwed), 0);
  const overdueCount  = debtors.filter(d => isOverdue(d.dueDate, d.isCleared)).length;
  const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

  const debtorActions: DebtorActions = {
    fmt, deleting, clearing, expandedId, historyMap, historyLoading,
    onPay:         d => setPayModal({ debtor: d, amount: '', method: 'cash', notes: '', loading: false, error: '' }),
    onEdit:        openEditDebtor,
    onClear:       clearDebtor,
    onReactivate:  reactivateDebtor,
    onDelete:      deleteDebtor,
    onToggleHistory: toggleHistory,
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Debtors</h1>
        <p className="text-slate-500 text-sm mt-1">Manage customers with unpaid balances</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-slate-500 text-sm">Active Debtors</p>
          <p className="font-bold text-slate-800 text-xl mt-1">{debtors.filter(d => !d.isCleared).length}</p>
          <p className="text-sm font-medium mt-1 text-red-600">{fmt(totalActive)}</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-blue-100 bg-blue-50/30">
          <p className="text-slate-500 text-sm">Cleared Debtors</p>
          <p className="font-bold text-slate-800 text-xl mt-1">{debtors.filter(d => d.isCleared).length}</p>
          <p className="text-sm font-medium mt-1 text-blue-600">{fmt(totalCleared)}</p>
        </div>
        <div className="col-span-2 sm:col-span-1 bg-white rounded-xl p-5 shadow-sm border border-orange-100 bg-orange-50/30">
          <p className="text-slate-500 text-sm">Overdue</p>
          <p className="font-bold text-orange-700 text-xl mt-1">{overdueCount}</p>
          <p className="text-xs text-orange-500 mt-1">Past due date</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or phone..."
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          {user?.role === 'admin' && (
            <select
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value)}
              className="px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">All Branches</option>
              {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
            </select>
          )}
          <div className="flex gap-1.5 flex-wrap">
            {(['active', 'cleared', 'overdue', 'all'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                  statusFilter === s
                    ? s === 'overdue' ? 'bg-orange-500 text-white' : 'bg-amber-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {s}{s === 'overdue' && overdueCount > 0 && (
                  <span className="ml-1.5 bg-white/30 text-white text-xs rounded-full px-1.5 py-0.5">{overdueCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Cards */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <UserCheck className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No debtors found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {paginated.map(row => row.type === 'group'
            ? <CustomerGroupCard key={row.key} group={row} allDebtors={debtors} index={specialCustomerIndex} actions={debtorActions} />
            : <DebtorCard key={row.key} d={row.debtor} actions={debtorActions} />
          )}
        </div>
      )}

      {/* ── Pagination ── */}
      {!loading && rows.length > limit && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-4">
          <Pagination
            page={page}
            totalPages={totalPages}
            total={rows.length}
            limit={limit}
            onPageChange={setPage}
            onLimitChange={l => { setLimit(l); setPage(1); }}
            limitOptions={[10, 20, 50]}
          />
        </div>
      )}

      {/* ── Record Payment Modal ── */}
      {payModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Record Payment</h2>
                <p className="text-sm text-slate-500 mt-0.5">{payModal.debtor.name} · Owes {fmt(payModal.debtor.amountOwed)}</p>
              </div>
              <button onClick={() => setPayModal(null)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {payModal.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{payModal.error}</div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Amount (₦) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={payModal.amount}
                  onChange={e => setPayModal({ ...payModal, amount: e.target.value })}
                  placeholder={`Max ₦${payModal.debtor.amountOwed.toLocaleString('en-NG')}`}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Payment Method *</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['cash', 'pos', 'transfer'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setPayModal({ ...payModal, method: m })}
                      className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-semibold border transition-colors ${
                        payModal.method === m
                          ? 'bg-amber-500 text-white border-amber-500'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {m === 'cash' && <DollarSign className="w-4 h-4" />}
                      {m === 'pos'  && <CreditCard className="w-4 h-4" />}
                      {m === 'transfer' && <ArrowLeftRight className="w-4 h-4" />}
                      {methodLabel(m)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Notes (optional)</label>
                <input
                  type="text"
                  value={payModal.notes}
                  onChange={e => setPayModal({ ...payModal, notes: e.target.value })}
                  placeholder="e.g. partial payment, bank ref…"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                />
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t border-slate-100">
              <button
                onClick={() => setPayModal(null)}
                disabled={payModal.loading}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={recordPayment}
                disabled={payModal.loading || !payModal.amount}
                className="flex-1 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                {payModal.loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Record Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Debtor Modal ── */}
      {editDebtor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Edit Debtor</h2>
              <button onClick={() => setEditDebtor(null)}
                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {editDebtor.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{editDebtor.error}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Name *</label>
                  <input
                    type="text"
                    value={editDebtor.name}
                    onChange={e => setEditDebtor({ ...editDebtor, name: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Phone *</label>
                  <input
                    type="tel"
                    value={editDebtor.phone}
                    onChange={e => setEditDebtor({ ...editDebtor, phone: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Amount Owed (₦) *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={editDebtor.amount}
                    onChange={e => setEditDebtor({ ...editDebtor, amount: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Due Date</label>
                  <input
                    type="date"
                    value={editDebtor.dueDate}
                    onChange={e => setEditDebtor({ ...editDebtor, dueDate: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-slate-50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Notes (optional)</label>
                <textarea
                  value={editDebtor.notes}
                  onChange={e => setEditDebtor({ ...editDebtor, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-slate-50"
                />
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t border-slate-100">
              <button
                onClick={() => setEditDebtor(null)}
                disabled={editDebtor.loading}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEditDebtor}
                disabled={editDebtor.loading}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                {editDebtor.loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}