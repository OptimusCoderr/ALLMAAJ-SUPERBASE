import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import sql from '../db/client.js';
import type { SaleRow, SaleItemJson } from '../db/types.js';
import { num } from '../db/types.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

const router = Router();
router.use(authMiddleware);

const toSale = (s: SaleRow & { staff_name?: string }) => ({
  id:            s.id,
  branchId:      s.branch_id,
  staffId:       s.staff_id,
  staffName:     s.staff_name ?? null,
  customerName:  s.customer_name,
  customerPhone: s.customer_phone,
  paymentMethod: s.payment_method,
  totalAmount:   num(s.total_amount),
  amountPaid:    num((s as any).amount_paid ?? s.total_amount),
  balanceDue:    num((s as any).balance_due ?? 0),
  notes:         s.notes,
  items:         s.items,
  saleDate:      s.sale_date,
  createdAt:     s.created_at,
  reportId:      s.report_id,
});

// ── GET /api/sales ────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      branchId, startDate, endDate, paymentMethod,
      limit = '100', page = '1', ids,
    } = req.query as Record<string, string>;

    if (ids) {
      const idList = ids.split(',').map(id => id.trim()).filter(Boolean);
      if (idList.length === 0)
        return sendResponse(res, 200, 'Sales fetched', { sales: [], total: 0, page: 1, limit: 0 });

      const sales = await sql<(SaleRow & { staff_name: string })[]>`
        SELECT s.*, u.full_name AS staff_name
        FROM sales s
        JOIN users u ON u.id = s.staff_id
        WHERE s.id = ANY(${idList}::uuid[])
        ORDER BY s.sale_date DESC
      `;
      return sendResponse(res, 200, 'Sales fetched', {
        sales: sales.map(toSale), total: sales.length, page: 1, limit: sales.length,
      });
    }

    const effectiveBranchId =
      req.user?.role !== 'admin' && req.user?.branchId
        ? req.user.branchId
        : (branchId ?? null);

    const lim  = parseInt(limit);
    const skip = (parseInt(page) - 1) * lim;

    // Normalise 'part' filter → 'unpaid' since part is stored as unpaid in DB
    const dbPaymentMethod = paymentMethod === 'part' ? 'unpaid' : (paymentMethod ?? null);

    const sales = await sql<(SaleRow & { staff_name: string })[]>`
      SELECT s.*, u.full_name AS staff_name
      FROM   sales s
      JOIN   users u ON u.id = s.staff_id
      WHERE
        (${effectiveBranchId}::uuid IS NULL OR s.branch_id = ${effectiveBranchId}::uuid)
        AND (${dbPaymentMethod}::payment_method IS NULL
             OR s.payment_method = ${dbPaymentMethod}::payment_method)
        AND (${startDate ?? null}::timestamptz IS NULL
             OR s.sale_date >= ${startDate ?? null}::timestamptz)
        AND (${endDate ?? null}::timestamptz IS NULL
             OR s.sale_date <= ${endDate ?? null}::timestamptz)
      ORDER BY s.sale_date DESC
      LIMIT  ${lim}
      OFFSET ${skip}
    `;

    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM sales s
      WHERE
        (${effectiveBranchId}::uuid IS NULL OR s.branch_id = ${effectiveBranchId}::uuid)
        AND (${dbPaymentMethod}::payment_method IS NULL
             OR s.payment_method = ${dbPaymentMethod}::payment_method)
        AND (${startDate ?? null}::timestamptz IS NULL
             OR s.sale_date >= ${startDate ?? null}::timestamptz)
        AND (${endDate ?? null}::timestamptz IS NULL
             OR s.sale_date <= ${endDate ?? null}::timestamptz)
    `;

    return sendResponse(res, 200, 'Sales fetched', {
      sales: sales.map(toSale), total: parseInt(count), page: parseInt(page), limit: lim,
    });
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// ── GET /api/sales/:id ────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [sale] = await sql<(SaleRow & { staff_name: string })[]>`
      SELECT s.*, u.full_name AS staff_name
      FROM   sales s
      JOIN   users u ON u.id = s.staff_id
      WHERE  s.id = ${req.params.id}
    `;
    if (!sale) return sendError(res, 404, 'Sale not found');
    return sendResponse(res, 200, 'Sale fetched', toSale(sale));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// ── POST /api/sales ───────────────────────────────────────────────────────────
router.post(
  '/',
  [
    body('branchId').notEmpty(),
    body('paymentMethod').isIn(['cash', 'pos', 'unpaid', 'part']),
    body('items').isArray({ min: 1 }),
    body('items.*.productId').notEmpty(),
    body('items.*.quantity').isFloat({ min: 0.01 }),
    body('items.*.unitPrice').isFloat({ min: 0 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());
    try {
      const {
        branchId, paymentMethod, customerName, customerPhone,
        notes, saleDate, items, amountPaid, balanceDue,
      } = req.body;

      const processedItems: SaleItemJson[] = items.map((item: any) => ({
        product_id: item.productId,
        quantity:   item.quantity,
        unit_price: item.unitPrice,
        subtotal:   item.quantity * item.unitPrice,
      }));
      const totalAmount = processedItems.reduce((s, i) => s + i.subtotal, 0);

      const paid    = paymentMethod === 'unpaid' ? 0
                    : paymentMethod === 'part'   ? Number(amountPaid ?? 0)
                    : totalAmount;
      const balance = totalAmount - paid;

      const staffName = (req.user as any)?.fullName ?? (req.user as any)?.email ?? 'Unknown';

      // 'part' is stored as 'unpaid' in DB since the enum only has cash/pos/unpaid.
      // Balance tracking is handled via the debtors table.
      const dbPaymentMethod = paymentMethod === 'part' ? 'unpaid' : paymentMethod;

      const [sale] = await sql<SaleRow[]>`
        INSERT INTO sales
          (branch_id, staff_id, staff_name, customer_name, customer_phone,
           payment_method, total_amount, notes, items, sale_date)
        VALUES (
          ${branchId}, ${req.userId!}, ${staffName},
          ${customerName ?? null}, ${customerPhone ?? null},
          ${dbPaymentMethod}::payment_method, ${totalAmount},
          ${notes ?? null}, ${JSON.stringify(processedItems)},
          ${saleDate ? new Date(saleDate).toISOString() : new Date().toISOString()}
        )
        RETURNING *
      `;

      // Auto-create debtor when there is an outstanding balance
      if (balance > 0 && customerName) {
        const itemsSummary = processedItems
          .map((i: any) => `${i.product_id} x${i.quantity}`)
          .join(', ');
        await sql`
          INSERT INTO debtors
            (name, phone, amount_owed, branch_id, created_by, sale_id, notes)
          VALUES (
            ${customerName}, ${customerPhone ?? null}, ${balance},
            ${branchId}, ${req.userId!}, ${sale.id},
            ${notes ? `Sale: ${itemsSummary} | ${notes}` : `Sale: ${itemsSummary}`}
          )
        `;
      }

      return sendResponse(res, 201, 'Sale recorded', {
        ...toSale(sale),
        // Return computed values so the frontend knows what was paid/owed
        paymentMethod,   // return the original ('part'), not the DB value
        amountPaid: paid,
        balanceDue: balance,
      });
    } catch (err) { return sendError(res, 500, 'Server error', err); }
  }
);

// ── DELETE /api/sales/:id ─────────────────────────────────────────────────────
router.delete('/:id', adminOnly, async (req: Request, res: Response) => {
  try {
    await sql`DELETE FROM sales WHERE id = ${req.params.id}`;
    return sendResponse(res, 200, 'Sale deleted');
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

export default router;