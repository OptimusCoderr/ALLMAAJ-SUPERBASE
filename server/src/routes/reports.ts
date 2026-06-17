import { Router, Request, Response } from 'express';
import sql from '../db/client.js';
import type { DailyReportRow, DebtorRow, ExpenseRow } from '../db/types.js';
import { num } from '../db/types.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

const router = Router();
router.use(authMiddleware);

// ── Mappers ───────────────────────────────────────────────────────────────────
// *_name fields are resolved via JOIN users — not stored in the row.
const toReport = (r: DailyReportRow & { submitted_by_name?: string | null; reviewed_by_name?: string | null }) => ({
  id:                r.id,
  _id:               r.id,   // ← ADD THIS
  branchId:          r.branch_id,
  submittedBy:       r.submitted_by,
  submittedByName:   r.submitted_by_name  ?? null,
  reportDate:        r.report_date,
  totalCashSales:    num(r.total_cash_sales),
  totalPosSales:     num(r.total_pos_sales),
  totalUnpaidSales:  num(r.total_unpaid_sales),
  totalSales:        num(r.total_sales),
  totalExpenses:     num(r.total_expenses),
  netIncome:         num(r.net_income),
  debtorCount:       r.debtor_count,
  totalDebtorAmount: num(r.total_debtor_amount),
  notes:             r.notes,
  status:            r.status,
  reviewedBy:        r.reviewed_by,
  reviewedByName:    r.reviewed_by_name   ?? null,
  reviewedAt:        r.reviewed_at,
  reviewNotes:       r.review_notes,
  saleIds:           (r as any).sale_ids ?? [],
  createdAt:         r.created_at,
  updatedAt:         r.updated_at,
});

const toDebtor = (d: DebtorRow & { created_by_name?: string | null; cleared_by_name?: string | null }) => ({
  id:            d.id,
  branchId:      d.branch_id,
  name:          d.name,
  phone:         d.phone,
  amountOwed:    num(d.amount_owed),
  createdBy:     d.created_by,
  createdByName: d.created_by_name  ?? null,
  saleId:        d.sale_id,
  isCleared:     d.is_cleared,
  clearedBy:     d.cleared_by,
  clearedByName: d.cleared_by_name  ?? null,
  clearedAt:     d.cleared_at,
  notes:         d.notes,
  createdAt:     d.created_at,
  updatedAt:     d.updated_at,
});

const toExpense = (e: ExpenseRow & { recorded_by_name?: string | null }) => ({
  id:              e.id,
  branchId:        e.branch_id,
  description:     e.description,
  amount:          num(e.amount),
  category:        e.category,
  recordedBy:      e.recorded_by,
  recordedByName:  e.recorded_by_name ?? null,
  expenseDate:     e.expense_date,
  notes:           e.notes,
  createdAt:       e.created_at,
});

// ── DAILY REPORTS ─────────────────────────────────────────────────────────────

// GET /api/reports/daily
router.get('/daily', async (req: Request, res: Response) => {
  try {
    const { branchId, status, startDate, endDate, limit = '50' } = req.query as Record<string, string>;
    const effectiveBranchId =
      req.user?.role !== 'admin' && req.user?.branchId ? req.user.branchId : (branchId ?? null);

    const reports = await sql<(DailyReportRow & { submitted_by_name: string; reviewed_by_name: string | null })[]>`
      SELECT
        dr.*,
        su.full_name AS submitted_by_name,
        ru.full_name AS reviewed_by_name
      FROM daily_reports dr
      JOIN users su ON su.id = dr.submitted_by
      LEFT JOIN users ru ON ru.id = dr.reviewed_by
      WHERE
        (${effectiveBranchId}::uuid IS NULL OR dr.branch_id = ${effectiveBranchId}::uuid)
        AND (${status    ?? null} IS NULL OR dr.status      = ${status    ?? null}::report_status)
        AND (${startDate ?? null} IS NULL OR dr.report_date >= ${startDate ?? null}::timestamptz::date)
        AND (${endDate   ?? null} IS NULL OR dr.report_date <= ${endDate   ?? null}::timestamptz::date)
      ORDER BY dr.report_date DESC
      LIMIT ${parseInt(limit)}
    `;
    return sendResponse(res, 200, 'Reports fetched', reports.map(toReport));
  } catch (err) { console.error('[GET /reports/daily]', err); return sendError(res, 500, 'Server error', err); }
});


// GET /api/reports/daily/:id
router.get('/daily/:id', async (req: Request, res: Response) => {
  try {
    const [report] = await sql<(DailyReportRow & { submitted_by_name: string; reviewed_by_name: string | null })[]>`
      SELECT dr.*, su.full_name AS submitted_by_name, ru.full_name AS reviewed_by_name
      FROM   daily_reports dr
      JOIN   users su ON su.id = dr.submitted_by
      LEFT JOIN users ru ON ru.id = dr.reviewed_by
      WHERE dr.id = ${req.params.id}
    `;
    if (!report) return sendError(res, 404, 'Report not found');
    return sendResponse(res, 200, 'Report fetched', toReport(report));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// POST /api/reports/daily  (upsert — one report per branch per day)
router.post('/daily', async (req: Request, res: Response) => {
  try {
    const { branchId, reportDate } = req.body;
    if (!branchId || !reportDate) return sendError(res, 400, 'branchId and reportDate are required');

    const {
      totalCashSales = 0, totalPosSales = 0, totalUnpaidSales = 0,
      totalExpenses = 0, netIncome = 0,
      debtorCount = 0, totalDebtorAmount = 0, notes,
      // saleIds no longer accepted — sales link to report via sales.report_id
    } = req.body;

    const [report] = await sql<DailyReportRow[]>`
      INSERT INTO daily_reports (
        branch_id, submitted_by, report_date,
        total_cash_sales, total_pos_sales, total_unpaid_sales,
        total_expenses, net_income, debtor_count, total_debtor_amount,
        notes, status
      ) VALUES (
        ${branchId}, ${req.userId!}, ${reportDate}::date,
        ${totalCashSales}, ${totalPosSales}, ${totalUnpaidSales},
        ${totalExpenses}, ${netIncome}, ${debtorCount}, ${totalDebtorAmount},
        ${notes ?? null}, 'pending'
      )
      ON CONFLICT (branch_id, report_date) DO UPDATE SET
        submitted_by        = EXCLUDED.submitted_by,
        total_cash_sales    = EXCLUDED.total_cash_sales,
        total_pos_sales     = EXCLUDED.total_pos_sales,
        total_unpaid_sales  = EXCLUDED.total_unpaid_sales,
        total_expenses      = EXCLUDED.total_expenses,
        net_income          = EXCLUDED.net_income,
        debtor_count        = EXCLUDED.debtor_count,
        total_debtor_amount = EXCLUDED.total_debtor_amount,
        notes               = EXCLUDED.notes,
        status              = 'pending',
        updated_at          = now()
      RETURNING *
    `;

    // Link today's sales to this report (replace any prior link for this branch/date)
    await sql`
      UPDATE sales
      SET report_id = ${report.id}
      WHERE branch_id = ${branchId}
        AND sale_date::date = ${reportDate}::date
        AND (report_id IS NULL OR report_id != ${report.id})
    `;

    return sendResponse(res, 201, 'Report submitted', toReport(report));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// PATCH /api/reports/daily/:id/review  (admin only)
router.patch('/daily/:id/review', adminOnly, async (req: Request, res: Response) => {
  try {
    const { status, reviewNotes } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status))
      return sendError(res, 400, 'Invalid status');

    const [report] = await sql<DailyReportRow[]>`
      UPDATE daily_reports SET
        status       = ${status}::report_status,
        reviewed_by  = ${req.userId!},
        reviewed_at  = now(),
        review_notes = ${reviewNotes ?? null},
        updated_at   = now()
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    if (!report) return sendError(res, 404, 'Report not found');
    return sendResponse(res, 200, 'Report reviewed', toReport(report));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// ── DEBTORS ───────────────────────────────────────────────────────────────────

// GET /api/reports/debtors
router.get('/debtors', async (req: Request, res: Response) => {
  try {
    const { branchId, isCleared } = req.query as Record<string, string>;
    const effectiveBranchId =
      req.user?.role !== 'admin' && req.user?.branchId ? req.user.branchId : (branchId ?? null);
    const clearedFilter = isCleared === 'true' ? true : isCleared === 'false' ? false : null;

    const debtors = await sql<(DebtorRow & { created_by_name: string; cleared_by_name: string | null })[]>`
      SELECT
        d.*,
        cu.full_name AS created_by_name,
        cl.full_name AS cleared_by_name
      FROM debtors d
      JOIN   users cu ON cu.id = d.created_by
      LEFT JOIN users cl ON cl.id = d.cleared_by
      WHERE
        (${effectiveBranchId}::uuid IS NULL OR d.branch_id = ${effectiveBranchId}::uuid)
        AND (${clearedFilter} IS NULL OR d.is_cleared = ${clearedFilter})
      ORDER BY d.created_at DESC
    `;
    return sendResponse(res, 200, 'Debtors fetched', debtors.map(toDebtor));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// POST /api/reports/debtors
// REPLACE THIS:
router.post('/debtors', async (req: Request, res: Response) => {
  try {
    const { name, phone, amountOwed, branchId, saleId, notes } = req.body;
    const createdByName = (req.user as any)?.fullName ?? 'Unknown';
    const [debtor] = await sql<DebtorRow[]>`
      INSERT INTO debtors (name, phone, amount_owed, branch_id, created_by, created_by_name, sale_id, notes)
      VALUES (
        ${name}, ${phone}, ${amountOwed}, ${branchId},
        ${req.userId!}, ${createdByName},
        ${saleId ?? null}, ${notes ?? null}
      )
      RETURNING *
    `;
    return sendResponse(res, 201, 'Debtor recorded', toDebtor(debtor));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// WITH THIS:
router.post('/debtors', async (req: Request, res: Response) => {
  try {
    const { name, phone, amountOwed, branchId, saleId, notes } = req.body;
    const [debtor] = await sql<DebtorRow[]>`
      INSERT INTO debtors (name, phone, amount_owed, branch_id, created_by, sale_id, notes)
      VALUES (
        ${name}, ${phone}, ${amountOwed}, ${branchId},
        ${req.userId!},
        ${saleId ?? null}, ${notes ?? null}
      )
      RETURNING *
    `;
    return sendResponse(res, 201, 'Debtor recorded', toDebtor(debtor));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// PATCH /api/reports/debtors/:id/clear  (admin only)
router.patch('/debtors/:id/clear', adminOnly, async (req: Request, res: Response) => {
  try {
    const [debtor] = await sql<DebtorRow[]>`
      UPDATE debtors SET
        is_cleared = true, cleared_by = ${req.userId!},
        cleared_at = now(), updated_at = now()
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    if (!debtor) return sendError(res, 404, 'Debtor not found');
    return sendResponse(res, 200, 'Debtor cleared', toDebtor(debtor));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// PATCH /api/reports/debtors/:id/reactivate  (admin only)
router.patch('/debtors/:id/reactivate', adminOnly, async (req: Request, res: Response) => {
  try {
    const [debtor] = await sql<DebtorRow[]>`
      UPDATE debtors SET
        is_cleared = false, cleared_by = NULL, cleared_at = NULL, updated_at = now()
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    if (!debtor) return sendError(res, 404, 'Debtor not found');
    return sendResponse(res, 200, 'Debtor reactivated', toDebtor(debtor));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// ── EXPENSES ──────────────────────────────────────────────────────────────────

// GET /api/reports/expenses
router.get('/expenses', async (req: Request, res: Response) => {
  try {
    const { branchId, startDate, endDate } = req.query as Record<string, string>;
    const effectiveBranchId =
      req.user?.role !== 'admin' && req.user?.branchId ? req.user.branchId : (branchId ?? null);

    const expenses = await sql<(ExpenseRow & { recorded_by_name: string })[]>`
      SELECT e.*, u.full_name AS recorded_by_name
      FROM   expenses e
      JOIN   users u ON u.id = e.recorded_by
      WHERE
        (${effectiveBranchId}::uuid IS NULL OR e.branch_id = ${effectiveBranchId}::uuid)
        AND (${startDate ?? null}::timestamptz IS NULL OR e.expense_date >= ${startDate ?? null}::timestamptz)
        AND (${endDate   ?? null}::timestamptz IS NULL OR e.expense_date <= ${endDate   ?? null}::timestamptz)
      ORDER BY e.expense_date DESC
    `;
    return sendResponse(res, 200, 'Expenses fetched', expenses.map(toExpense));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// POST /api/reports/expenses
router.post('/expenses', async (req: Request, res: Response) => {
  try {
    const { branchId, description, amount, category, expenseDate, notes } = req.body;
    const [expense] = await sql<ExpenseRow[]>`
      INSERT INTO expenses (branch_id, description, amount, category, recorded_by, expense_date, notes)
      VALUES (
        ${branchId}, ${description}, ${amount},
        ${category ?? 'other'}::expense_category,
        ${req.userId!},
        ${expenseDate ? new Date(expenseDate).toISOString() : new Date().toISOString()},
        ${notes ?? null}
      )
      RETURNING *
    `;
    return sendResponse(res, 201, 'Expense recorded', toExpense(expense));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// ── DASHBOARD ANALYTICS ───────────────────────────────────────────────────────

// GET /api/reports/analytics/dashboard
router.get('/analytics/dashboard', async (req: Request, res: Response) => {
  try {
    const branchId =
      req.user?.role !== 'admin' && req.user?.branchId ? req.user.branchId : null;

    const today    = new Date().toISOString().split('T')[0];
    const sevenAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    const [salesAgg, expenseAgg, [pendingRow], debtorAgg] = await Promise.all([
      sql<{ payment_method: string; total: string }[]>`
        SELECT payment_method, COALESCE(SUM(total_amount), 0)::text AS total
        FROM sales
        WHERE sale_date::date = ${today}::date
          AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}::uuid)
        GROUP BY payment_method
      `,
      sql<[{ total: string }]>`
        SELECT COALESCE(SUM(amount), 0)::text AS total FROM expenses
        WHERE expense_date::date = ${today}::date
          AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}::uuid)
      `,
      sql<[{ count: string }]>`
        SELECT COUNT(*)::text AS count FROM daily_reports
        WHERE status = 'pending'
          AND report_date >= ${sevenAgo}::date
          AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}::uuid)
      `,
      sql<[{ count: string; total: string }]>`
        SELECT COUNT(*)::text AS count, COALESCE(SUM(amount_owed), 0)::text AS total
        FROM debtors
        WHERE is_cleared = false
          AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}::uuid)
      `,
    ]);

    const by = Object.fromEntries(salesAgg.map(r => [r.payment_method, num(r.total)]));
    return sendResponse(res, 200, 'Dashboard data fetched', {
      todaySales:        (by.cash ?? 0) + (by.pos ?? 0) + (by.unpaid ?? 0),
      todayCash:          by.cash    ?? 0,
      todayPos:           by.pos     ?? 0,
      todayExpenses:      num(expenseAgg[0]?.total),
      pendingReports:     parseInt(pendingRow?.count ?? '0'),
      activeDebtors:      parseInt(debtorAgg[0]?.count ?? '0'),
      totalDebtorAmount:  num(debtorAgg[0]?.total),
    });
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

export default router;