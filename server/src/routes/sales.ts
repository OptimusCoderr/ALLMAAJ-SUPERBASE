import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import sql from '../db/client.js';
import type { SaleRow, SaleItemJson } from '../db/types.js';
import { num } from '../db/types.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

const router = Router();
router.use(authMiddleware);

const parseItems = (items: any): SaleItemJson[] => {
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') {
    try { return JSON.parse(items); } catch { return []; }
  }
  return [];
};

const toSale = (s: SaleRow & { staff_name?: string }) => ({
  id:            s.id,
  _id:           s.id,
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
  items:         typeof s.items === 'string' ? JSON.parse(s.items) : (s.items ?? []),
  saleDate:      s.sale_date,
  createdAt:     s.created_at,
  reportId:      s.report_id,
});


// ── GET /api/sales ────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const { branchId, startDate, endDate, paymentMethod, limit = '100', page = '1', ids, reportId } = req.query as Record<string, string>;

    if (ids) {
      const idList = ids.split(',').map(id => id.trim()).filter(Boolean);
      if (idList.length === 0)
        return sendResponse(res, 200, 'Sales fetched', { sales: [], total: 0, page: 1, limit: 0 });
      const sales = await sql<(SaleRow & { staff_name: string })[]>`
        SELECT s.*, u.full_name AS staff_name FROM sales s
        JOIN users u ON u.id = s.staff_id
        WHERE s.id = ANY(${idList}::uuid[])
        ORDER BY s.sale_date DESC
      `;
      return sendResponse(res, 200, 'Sales fetched', { sales: sales.map(toSale), total: sales.length, page: 1, limit: sales.length });
    }

    if (reportId) {
      const sales = await sql<(SaleRow & { staff_name: string })[]>`
        SELECT s.*, u.full_name AS staff_name FROM sales s
        JOIN users u ON u.id = s.staff_id
        WHERE s.report_id = ${reportId}::uuid
        ORDER BY s.sale_date DESC
      `;
      return sendResponse(res, 200, 'Sales fetched', { sales: sales.map(toSale), total: sales.length, page: 1, limit: sales.length });
    }

    const effectiveBranchId = req.user?.role !== 'admin' && req.user?.branchId ? req.user.branchId : (branchId ?? null);
    const lim  = parseInt(limit);
    const skip = (parseInt(page) - 1) * lim;

    const sales = await sql<(SaleRow & { staff_name: string })[]>`
      SELECT s.*, u.full_name AS staff_name FROM sales s
      JOIN users u ON u.id = s.staff_id
      WHERE
        (${effectiveBranchId}::uuid IS NULL OR s.branch_id = ${effectiveBranchId}::uuid)
        AND (${paymentMethod ?? null}::payment_method IS NULL OR s.payment_method = ${paymentMethod ?? null}::payment_method)
        AND (${startDate ?? null}::timestamptz IS NULL OR s.sale_date >= ${startDate ?? null}::timestamptz)
        AND (${endDate ?? null}::timestamptz IS NULL OR s.sale_date <= ${endDate ?? null}::timestamptz)
      ORDER BY s.sale_date DESC
      LIMIT ${lim} OFFSET ${skip}
    `;

    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM sales s
      WHERE
        (${effectiveBranchId}::uuid IS NULL OR s.branch_id = ${effectiveBranchId}::uuid)
        AND (${paymentMethod ?? null}::payment_method IS NULL OR s.payment_method = ${paymentMethod ?? null}::payment_method)
        AND (${startDate ?? null}::timestamptz IS NULL OR s.sale_date >= ${startDate ?? null}::timestamptz)
        AND (${endDate ?? null}::timestamptz IS NULL OR s.sale_date <= ${endDate ?? null}::timestamptz)
    `;

    return sendResponse(res, 200, 'Sales fetched', { sales: sales.map(toSale), total: parseInt(count), page: parseInt(page), limit: lim });
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// ── GET /api/sales/:id ────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [sale] = await sql<(SaleRow & { staff_name: string })[]>`
      SELECT s.*, u.full_name AS staff_name FROM sales s
      JOIN users u ON u.id = s.staff_id
      WHERE s.id = ${req.params.id}
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
    body('items.*.productId').optional({ nullable: true }),   // ← was .notEmpty() — broke services
    body('items.*.quantity').isFloat({ min: 0.01 }),
    body('items.*.unitPrice').isFloat({ min: 0 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());
    try {
      const {
        paymentMethod, customerName, customerPhone,
        notes, saleDate, items, amountPaid,
      } = req.body;

      const branchId = req.user?.role !== 'admin' && req.user?.branchId
        ? req.user.branchId
        : req.body.branchId;

      if (!branchId) return sendError(res, 400, 'Branch is required');

      // Only product items require a productId
      for (const item of items) {
        if (item.itemType !== 'service' && !item.productId) {
          return sendError(res, 400, 'productId is required for product items');
        }
      }

      const processedItems: SaleItemJson[] = items.map((item: any) => {
        const isService = item.itemType === 'service';
        const isCut = !isService && item.cutLengthInches && item.unitLengthInches;
        const stockDeductQty = isCut
          ? item.cutLengthInches / item.unitLengthInches
          : item.quantity;
        return {
          product_id:         isService ? null : item.productId,
          product_name:       item.productName ?? '',
          item_type:          item.itemType ?? 'product',
          service_notes:      item.serviceNotes ?? null,
          quantity:           item.quantity,
          unit_price:         item.unitPrice,
          subtotal:           item.quantity * item.unitPrice,
          cut_length_inches:  item.cutLengthInches ?? null,
          unit_length_inches: item.unitLengthInches ?? null,
          stock_deduct_qty:   stockDeductQty,
        };
      });
      const totalAmount = processedItems.reduce((s, i) => s + i.subtotal, 0);

      // Cut validation — server-side minimum 8.5 inches
      for (const item of processedItems) {
        if (item.cut_length_inches != null && item.cut_length_inches < 8.5) {
          return sendError(res, 400, `Minimum cut size is 8.5 inches. Got ${item.cut_length_inches}" for "${item.product_name}"`);
        }
      }

      // Stock check — skip service items, use stock_deduct_qty for cuttable
      const productItems = processedItems.filter(i => i.item_type !== 'service' && i.product_id);
      for (const item of productItems) {
        const [stock] = await sql<[{ quantity: string; name: string }]>`
          SELECT bs.quantity, p.name
          FROM branch_stock bs
          JOIN products p ON p.id = bs.product_id
          WHERE bs.branch_id = ${branchId} AND bs.product_id = ${item.product_id}
        `;
        const available = stock ? parseFloat(stock.quantity) : 0;
        const needed = item.stock_deduct_qty ?? item.quantity;
        if (available < needed) {
          return sendError(res, 400,
            `Insufficient stock for "${stock?.name ?? item.product_id}". Available: ${available}, Requested: ${needed}`
          );
        }
      }

      const paid    = paymentMethod === 'unpaid' ? 0
                    : paymentMethod === 'part'   ? Number(amountPaid ?? 0)
                    : totalAmount;
      const balance = totalAmount - paid;
      const staffName = (req.user as any)?.fullName ?? (req.user as any)?.email ?? 'Unknown';

      const [sale] = await sql<SaleRow[]>`
        INSERT INTO sales
          (branch_id, staff_id, staff_name, customer_name, customer_phone,
           payment_method, total_amount, amount_paid, balance_due, notes, items, sale_date)
        VALUES (
          ${branchId}, ${req.userId!}, ${staffName},
          ${customerName ?? null}, ${customerPhone ?? null},
          ${paymentMethod}::payment_method, ${totalAmount},
          ${paid}, ${balance},
          ${notes ?? null}, ${JSON.stringify(processedItems)},
          ${saleDate ? new Date(saleDate).toISOString() : new Date().toISOString()}
        )
        RETURNING *
      `;

      // Deduct stock — skip service items, use stock_deduct_qty for cuttable
      for (const item of productItems) {
        const deduct = item.stock_deduct_qty ?? item.quantity;
        await sql`
          UPDATE branch_stock
          SET quantity = quantity - ${deduct}, updated_at = NOW()
          WHERE branch_id = ${branchId} AND product_id = ${item.product_id}
        `;
      }

      return sendResponse(res, 201, 'Sale recorded', toSale(sale));
    } catch (err) { return sendError(res, 500, 'Server error', err); }
  }
);

// ── PUT /api/sales/:id  (edit — same-day only) ────────────────────────────────
router.put(
  '/:id',
  [
    body('paymentMethod').isIn(['cash', 'pos', 'unpaid', 'part']),
    body('items').isArray({ min: 1 }),
    body('items.*.productId').optional({ nullable: true }),   // ← same fix as POST
    body('items.*.quantity').isFloat({ min: 0.01 }),
    body('items.*.unitPrice').isFloat({ min: 0 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());

    try {
      const saleId  = req.params.id;
      const isAdmin = req.user?.role === 'admin';

      const [existing] = await sql<SaleRow[]>`SELECT * FROM sales WHERE id = ${saleId}`;
      if (!existing) return sendError(res, 404, 'Sale not found');

      const [dateCheck] = await sql<[{ is_today: boolean }]>`
        SELECT (${existing.sale_date}::timestamptz AT TIME ZONE 'Africa/Lagos')::date
               = (NOW() AT TIME ZONE 'Africa/Lagos')::date AS is_today
      `;
      if (!dateCheck.is_today)
        return sendError(res, 403, 'Sales can only be edited on the day they were made. This sale is locked.');

      if (!isAdmin && existing.staff_id !== req.userId)
        return sendError(res, 403, 'You can only edit your own sales.');

      const { paymentMethod, customerName, customerPhone, notes, items, amountPaid } = req.body;

      // Only product items require a productId
      for (const item of items) {
        if (item.itemType !== 'service' && !item.productId) {
          return sendError(res, 400, 'productId is required for product items');
        }
      }

      const newItems: SaleItemJson[] = items.map((item: any) => {
        const isService = item.itemType === 'service';
        const isCut = !isService && item.cutLengthInches && item.unitLengthInches;
        const stockDeductQty = isCut
          ? item.cutLengthInches / item.unitLengthInches
          : item.quantity;
        return {
          product_id:         isService ? null : item.productId,
          product_name:       item.productName ?? '',
          item_type:          item.itemType ?? 'product',
          service_notes:      item.serviceNotes ?? null,
          quantity:           item.quantity,
          unit_price:         item.unitPrice,
          subtotal:           item.quantity * item.unitPrice,
          cut_length_inches:  item.cutLengthInches ?? null,
          unit_length_inches: item.unitLengthInches ?? null,
          stock_deduct_qty:   stockDeductQty,
        };
      });
      const totalAmount = newItems.reduce((s, i) => s + i.subtotal, 0);

      // Cut validation
      for (const item of newItems) {
        if (item.cut_length_inches != null && item.cut_length_inches < 8.5) {
          return sendError(res, 400, `Minimum cut size is 8.5 inches. Got ${item.cut_length_inches}" for "${item.product_name}"`);
        }
      }

      // Restore old stock — skip service items, use stock_deduct_qty
      const oldItems = parseItems(existing.items);
      const oldProductItems = oldItems.filter(i => i.item_type !== 'service' && i.product_id);
      for (const old of oldProductItems) {
        const restore = old.stock_deduct_qty ?? old.quantity;
        await sql`
          UPDATE branch_stock
          SET quantity = quantity + ${restore}, updated_at = NOW()
          WHERE branch_id = ${existing.branch_id} AND product_id = ${old.product_id}
        `;
      }

      // Check new stock — skip service items, use stock_deduct_qty
      const newProductItems = newItems.filter(i => i.item_type !== 'service' && i.product_id);
      for (const item of newProductItems) {
        const [stock] = await sql<[{ quantity: string; name: string }]>`
          SELECT bs.quantity, p.name
          FROM branch_stock bs
          JOIN products p ON p.id = bs.product_id
          WHERE bs.branch_id = ${existing.branch_id} AND bs.product_id = ${item.product_id}
        `;
        const available = stock ? parseFloat(stock.quantity) : 0;
        const needed = item.stock_deduct_qty ?? item.quantity;
        if (available < needed) {
          // Roll back: re-deduct old product stock
          for (const old of oldProductItems) {
            const restore = old.stock_deduct_qty ?? old.quantity;
            await sql`
              UPDATE branch_stock
              SET quantity = quantity - ${restore}, updated_at = NOW()
              WHERE branch_id = ${existing.branch_id} AND product_id = ${old.product_id}
            `;
          }
          return sendError(res, 400,
            `Insufficient stock for "${stock?.name ?? item.product_id}". Available: ${available}, Requested: ${needed}`
          );
        }
      }

      const paid    = paymentMethod === 'unpaid' ? 0
                    : paymentMethod === 'part'   ? Number(amountPaid ?? 0)
                    : totalAmount;
      const balance = totalAmount - paid;
      const oldBalance = num((existing as any).balance_due ?? 0);

      const [updated] = await sql<SaleRow[]>`
        UPDATE sales SET
          customer_name  = ${customerName ?? null},
          customer_phone = ${customerPhone ?? null},
          payment_method = ${paymentMethod}::payment_method,
          total_amount   = ${totalAmount},
          amount_paid    = ${paid},
          balance_due    = ${balance},
          notes          = ${notes ?? null},
          items          = ${JSON.stringify(newItems)},
          updated_at     = NOW()
        WHERE id = ${saleId}
        RETURNING *
      `;

      // Deduct new stock — skip service items, use stock_deduct_qty
      for (const item of newProductItems) {
        const deduct = item.stock_deduct_qty ?? item.quantity;
        await sql`
          UPDATE branch_stock
          SET quantity = quantity - ${deduct}, updated_at = NOW()
          WHERE branch_id = ${existing.branch_id} AND product_id = ${item.product_id}
        `;
      }

      // Sync debtor if balance changed
      if (balance !== oldBalance) {
        const debtorsById = await sql`
          SELECT id FROM debtors WHERE sale_id = ${saleId} AND is_cleared = false LIMIT 1
        `;
        if (debtorsById.length > 0) {
          if (balance <= 0) {
            await sql`UPDATE debtors SET amount_owed = 0, is_cleared = true, updated_at = NOW() WHERE sale_id = ${saleId}`;
          } else {
            await sql`UPDATE debtors SET amount_owed = ${balance}, updated_at = NOW() WHERE sale_id = ${saleId} AND is_cleared = false`;
          }
        } else if (customerPhone) {
          if (balance <= 0) {
            await sql`UPDATE debtors SET amount_owed = 0, is_cleared = true, updated_at = NOW() WHERE phone = ${customerPhone} AND branch_id = ${existing.branch_id} AND is_cleared = false`;
          } else {
            await sql`UPDATE debtors SET amount_owed = ${balance}, updated_at = NOW() WHERE phone = ${customerPhone} AND branch_id = ${existing.branch_id} AND is_cleared = false`;
          }
        }
      }

      const [withStaff] = await sql<(SaleRow & { staff_name: string })[]>`
        SELECT s.*, u.full_name AS staff_name FROM sales s
        JOIN users u ON u.id = s.staff_id WHERE s.id = ${saleId}
      `;
      return sendResponse(res, 200, 'Sale updated', toSale(withStaff));
    } catch (err) { return sendError(res, 500, 'Server error', err); }
  }
);

// ── DELETE /api/sales/:id  (same-day only — staff own / admin any) ─────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const saleId  = req.params.id;
    const isAdmin = req.user?.role === 'admin';

    const [existing] = await sql<SaleRow[]>`SELECT * FROM sales WHERE id = ${saleId}`;
    if (!existing) return sendError(res, 404, 'Sale not found');

    const [dateCheck] = await sql<[{ is_today: boolean }]>`
      SELECT (${existing.sale_date}::timestamptz AT TIME ZONE 'Africa/Lagos')::date
             = (NOW() AT TIME ZONE 'Africa/Lagos')::date AS is_today
    `;
    if (!dateCheck.is_today)
      return sendError(res, 403, 'Sales can only be deleted on the day they were made. This sale is locked.');

    if (!isAdmin && existing.staff_id !== req.userId)
      return sendError(res, 403, 'You can only delete your own sales.');

    // Restore stock before deleting — skip service items, use stock_deduct_qty
    const oldItems = parseItems(existing.items);
    const oldProductItems = oldItems.filter((i: any) => i.item_type !== 'service' && i.product_id);
    for (const item of oldProductItems) {
      const restore = item.stock_deduct_qty ?? item.quantity;
      await sql`
        UPDATE branch_stock
        SET quantity = quantity + ${restore}, updated_at = NOW()
        WHERE branch_id = ${existing.branch_id} AND product_id = ${item.product_id}
      `;
    }

    const debtorsById = await sql`SELECT id FROM debtors WHERE sale_id = ${saleId} LIMIT 1`;
    if (debtorsById.length > 0) {
      await sql`UPDATE debtors SET is_cleared = true, amount_owed = 0, updated_at = NOW() WHERE sale_id = ${saleId}`;
    } else if ((existing as any).customer_phone) {
      await sql`
        UPDATE debtors SET is_cleared = true, amount_owed = 0, updated_at = NOW()
        WHERE phone = ${(existing as any).customer_phone}
          AND branch_id = ${existing.branch_id} AND is_cleared = false
      `;
    }

    await sql`DELETE FROM sales WHERE id = ${saleId}`;
    return sendResponse(res, 200, 'Sale deleted');
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});


export default router;