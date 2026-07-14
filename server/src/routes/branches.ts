import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { randomUUID } from 'crypto';
import sql from '../db/client.js';
import type { BranchRow, BranchStockRow, ProductRow } from '../db/types.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';
import { notifyAdmins, notifyUser } from '../utils/notifications.js';

const router = Router();
router.use(authMiddleware);

const toBranch = (b: BranchRow) => ({
  _id: b.id, id: b.id, name: b.name, location: b.location,
  description: b.description, isActive: b.is_active,
  createdAt: b.created_at, updatedAt: b.updated_at,
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const { active } = req.query;
    const branches = active === 'true'
      ? await sql<BranchRow[]>`SELECT * FROM branches WHERE is_active = true ORDER BY name`
      : await sql<BranchRow[]>`SELECT * FROM branches ORDER BY name`;
    return sendResponse(res, 200, 'Branches fetched', branches.map(toBranch));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.post('/', adminOnly, [
  body('name').trim().notEmpty().isLength({ max: 100 }).escape(),
  body('location').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 500 }),
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());
  try {
    const { name, location, description } = req.body;
    const [branch] = await sql<BranchRow[]>`
      INSERT INTO branches (name, location, description)
      VALUES (${name}, ${location ?? null}, ${description ?? null})
      RETURNING *
    `;
    return sendResponse(res, 201, 'Branch created', toBranch(branch));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// ── Stock Requests (MUST be before /:id to avoid route conflict) ──────────────
// A "batch" is one or more stock_requests rows sharing a batch_id — staff can
// bundle several products into a single request/transfer, and admins
// approve or reject the whole batch in one action.

// Group flat stock_requests rows (one per product) into batch objects with an
// items[] array. Each item carries its own status/approvedByName/approvedAt
// since admins can approve/reject items individually (different materials
// often need to come from different warehouses) — a batch's overall status
// is 'mixed' once its items disagree.
function groupIntoBatches(rows: any[]) {
  const batches = new Map<string, any>();
  for (const r of rows) {
    let batch = batches.get(r.batch_id);
    if (!batch) {
      batch = {
        batchId:         r.batch_id,
        branchId:        r.branch_id,
        branchName:      r.branch_name,
        fromBranchId:    r.from_branch_id,
        fromBranchName:  r.from_branch_name,
        sourceType:      r.source_type,
        warehouseId:     r.warehouse_id,
        warehouseName:   r.warehouse_name,
        requestedBy:     r.requested_by,
        requestedByName: r.requested_by_name,
        notes:           r.notes,
        createdAt:       r.created_at,
        items:           [] as any[],
      };
      batches.set(r.batch_id, batch);
    }
    batch.items.push({
      id: r.id, productId: r.product_id, productName: r.product_name,
      productUnit: r.product_unit, quantity: Number(r.quantity),
      status: r.status, approvedByName: r.approved_by_name, approvedAt: r.approved_at,
    });
  }
  const result = Array.from(batches.values());
  for (const batch of result) {
    const statuses = new Set(batch.items.map((i: any) => i.status));
    batch.status = statuses.size === 1 ? batch.items[0].status : 'mixed';
  }
  return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// Staff or admin creates a stock request with one or more product line-items.
// Optionally pass fromBranchId to request the items be transferred from
// another branch instead of the usual warehouse/others restock — still
// requires admin approval either way.
//POST /api/branches/stock-requests
router.post('/stock-requests', async (req: Request, res: Response) => {
  try {
    const { notes, fromBranchId } = req.body;
    const branchId = req.user?.role !== 'admin' && req.user?.branchId
      ? req.user.branchId
      : req.body.branchId;

    // Accept either items: [{productId, quantity}] or the legacy single productId/quantity shape.
    const items: { productId: string; quantity: number }[] = Array.isArray(req.body.items) && req.body.items.length > 0
      ? req.body.items
      : (req.body.productId && req.body.quantity ? [{ productId: req.body.productId, quantity: req.body.quantity }] : []);

    if (!branchId || items.length === 0) return sendError(res, 400, 'branchId and at least one item (productId, quantity) are required');
    if (fromBranchId && fromBranchId === branchId) return sendError(res, 400, 'Source branch must be different from the destination branch');
    for (const item of items) {
      if (!item.productId || !item.quantity || Number(item.quantity) <= 0) {
        return sendError(res, 400, 'Each item requires a productId and a positive quantity');
      }
    }

    const batchId    = randomUUID();
    const sourceType = fromBranchId ? 'branch' : null;

    const rows = await sql.begin(async (tx) => {
      const inserted = [];
      for (const item of items) {
        const [row] = await tx`
          INSERT INTO stock_requests (batch_id, branch_id, product_id, quantity, requested_by, requested_by_name, notes, from_branch_id, source_type)
          VALUES (
            ${batchId}, ${branchId}, ${item.productId}, ${Number(item.quantity)}, ${req.user!.id}, ${req.user!.fullName || req.user!.email}, ${notes ?? null},
            ${fromBranchId ?? null}, ${sourceType}::stock_source
          )
          RETURNING *
        `;
        inserted.push(row);
      }
      return inserted;
    });

    const branchNames = await sql`SELECT id, name FROM branches WHERE id IN (${branchId}, ${fromBranchId ?? branchId})`;
    const branchNameMap = Object.fromEntries(branchNames.map((b: any) => [b.id, b.name]));
    const requesterName = req.user!.fullName || req.user!.email;
    const itemWord = items.length === 1 ? 'item' : 'items';
    await notifyAdmins({
      type: 'stock_request_pending',
      title: fromBranchId ? `New transfer request (${items.length} ${itemWord})` : `New stock request (${items.length} ${itemWord})`,
      message: fromBranchId
        ? `${requesterName} requested a transfer from ${branchNameMap[fromBranchId] ?? 'another branch'} to ${branchNameMap[branchId] ?? 'a branch'}`
        : `${requesterName} requested stock for ${branchNameMap[branchId] ?? 'a branch'}`,
      link: '/branch-stock',
    });

    return sendResponse(res, 201, 'Stock request submitted', { batchId, items: rows });
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// Staff gets their own requests (all statuses), grouped into batches
router.get('/stock-requests/mine', async (req: Request, res: Response) => {
  try {
    const rows = await sql`
      SELECT sr.*, b.name AS branch_name, p.name AS product_name, p.unit AS product_unit,
             w.name AS warehouse_name, fb.name AS from_branch_name
      FROM stock_requests sr
      JOIN branches b ON b.id = sr.branch_id
      JOIN products p ON p.id = sr.product_id
      LEFT JOIN warehouses w ON w.id = sr.warehouse_id
      LEFT JOIN branches fb  ON fb.id = sr.from_branch_id
      WHERE sr.requested_by = ${req.user!.id}
      ORDER BY sr.created_at DESC
    `;
    return sendResponse(res, 200, 'Your requests fetched', groupIntoBatches(rows));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// Admin gets all requests (filtered by status if provided), grouped into batches
router.get('/stock-requests', adminOnly, async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const rows = status
      ? await sql`
          SELECT sr.*, b.name AS branch_name, p.name AS product_name, p.unit AS product_unit,
                 w.name AS warehouse_name, fb.name AS from_branch_name
          FROM stock_requests sr
          JOIN branches b  ON b.id = sr.branch_id
          JOIN products p  ON p.id = sr.product_id
          LEFT JOIN warehouses w ON w.id = sr.warehouse_id
          LEFT JOIN branches fb  ON fb.id = sr.from_branch_id
          WHERE sr.status = ${status as string}::stock_request_status
          ORDER BY sr.created_at DESC
        `
      : await sql`
          SELECT sr.*, b.name AS branch_name, p.name AS product_name, p.unit AS product_unit,
                 w.name AS warehouse_name, fb.name AS from_branch_name
          FROM stock_requests sr
          JOIN branches b  ON b.id = sr.branch_id
          JOIN products p  ON p.id = sr.product_id
          LEFT JOIN warehouses w ON w.id = sr.warehouse_id
          LEFT JOIN branches fb  ON fb.id = sr.from_branch_id
          ORDER BY sr.created_at DESC
        `;
    return sendResponse(res, 200, 'Requests fetched', groupIntoBatches(rows));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// :batchId identifies the whole group of line-items — approves/rejects
// whichever items in the batch are still pending (items already resolved
// individually, see below, are left untouched).
router.patch('/stock-requests/:batchId/approve', adminOnly, async (req: Request, res: Response) => {
  try {
    const allItems = await sql`SELECT * FROM stock_requests WHERE batch_id = ${req.params.batchId}`;
    if (allItems.length === 0) return sendError(res, 404, 'Request not found');
    const items = allItems.filter((r: any) => r.status === 'pending');
    if (items.length === 0) return sendError(res, 400, 'No pending items left in this request');

    const first = items[0];

    const updated = await sql.begin(async (tx) => {
      // Branch-to-branch transfer: source branch was already chosen by the
      // requester, admin just approves/rejects — no sourceType/warehouse to pick.
      if (first.source_type === 'branch') {
        if (!first.from_branch_id) throw Object.assign(new Error('Transfer request is missing a source branch'), { status: 400 });

        for (const item of items) {
          const [fromStock] = await tx`
            SELECT quantity FROM branch_stock WHERE branch_id = ${item.from_branch_id} AND product_id = ${item.product_id}
          `;
          if (!fromStock || Number(fromStock.quantity) < Number(item.quantity)) {
            throw Object.assign(new Error(`Insufficient stock at the source branch for one of the items`), { status: 400 });
          }
        }
        for (const item of items) {
          await tx`
            UPDATE branch_stock SET quantity = quantity - ${Number(item.quantity)}, updated_at = now()
            WHERE branch_id = ${item.from_branch_id} AND product_id = ${item.product_id}
          `;
          await tx`
            INSERT INTO branch_stock (branch_id, product_id, quantity)
            VALUES (${item.branch_id}, ${item.product_id}, ${Number(item.quantity)})
            ON CONFLICT (branch_id, product_id)
            DO UPDATE SET quantity = branch_stock.quantity + EXCLUDED.quantity, updated_at = now()
          `;
        }
        return tx`
          UPDATE stock_requests SET
            status           = 'approved',
            approved_by      = ${req.user!.id},
            approved_by_name = ${req.user!.fullName || req.user!.email},
            approved_at      = now(),
            updated_at       = now()
          WHERE batch_id = ${req.params.batchId} AND status = 'pending'
          RETURNING *
        `;
      }

      const { sourceType, warehouseId } = req.body;
      if (!sourceType) throw Object.assign(new Error('sourceType is required (warehouse or others)'), { status: 400 });
      if (sourceType === 'warehouse' && !warehouseId) throw Object.assign(new Error('warehouseId is required when source is warehouse'), { status: 400 });

      if (sourceType === 'warehouse') {
        for (const item of items) {
          const [ws] = await tx`SELECT quantity FROM warehouse_stock WHERE warehouse_id = ${warehouseId} AND product_id = ${item.product_id}`;
          if (!ws || Number(ws.quantity) < Number(item.quantity)) {
            throw Object.assign(new Error('Insufficient warehouse stock for one of the items'), { status: 400 });
          }
        }
        for (const item of items) {
          await tx`
            UPDATE warehouse_stock SET quantity = quantity - ${Number(item.quantity)}, updated_at = now()
            WHERE warehouse_id = ${warehouseId} AND product_id = ${item.product_id}
          `;
        }
      }

      for (const item of items) {
        await tx`
          INSERT INTO branch_stock (branch_id, product_id, quantity)
          VALUES (${item.branch_id}, ${item.product_id}, ${Number(item.quantity)})
          ON CONFLICT (branch_id, product_id)
          DO UPDATE SET quantity = branch_stock.quantity + EXCLUDED.quantity, updated_at = now()
        `;
      }

      return tx`
        UPDATE stock_requests SET
          status           = 'approved',
          source_type      = ${sourceType}::stock_source,
          warehouse_id     = ${warehouseId ?? null},
          approved_by      = ${req.user!.id},
          approved_by_name = ${req.user!.fullName || req.user!.email},
          approved_at      = now(),
          updated_at       = now()
        WHERE batch_id = ${req.params.batchId} AND status = 'pending'
        RETURNING *
      `;
    });

    const itemWord = items.length === 1 ? 'item' : 'items';
    await notifyUser(first.requested_by, {
      type: 'stock_request_approved',
      title: `Your stock request was approved (${items.length} ${itemWord})`,
      link: '/branch-stock',
    });

    return sendResponse(res, 200, 'Request approved', groupIntoBatches(updated)[0]);
  } catch (err: any) {
    if (err?.status === 400) return sendError(res, 400, err.message);
    return sendError(res, 500, 'Server error', err);
  }
});

router.patch('/stock-requests/:batchId/reject', adminOnly, async (req: Request, res: Response) => {
  try {
    const { notes } = req.body;
    const updated = await sql`
      UPDATE stock_requests SET
        status      = 'rejected',
        notes       = COALESCE(${notes ?? null}, notes),
        updated_at  = now()
      WHERE batch_id = ${req.params.batchId} AND status = 'pending'
      RETURNING *
    `;
    if (updated.length === 0) return sendError(res, 404, 'Request not found or already processed');

    const first = updated[0];
    const itemWord = updated.length === 1 ? 'item' : 'items';
    await notifyUser(first.requested_by, {
      type: 'stock_request_rejected',
      title: `Your stock request was rejected (${updated.length} ${itemWord})`,
      message: notes ?? undefined,
      link: '/branch-stock',
    });

    return sendResponse(res, 200, 'Request rejected', groupIntoBatches(updated)[0]);
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// Approve/reject a single line-item within a batch, independent of the rest —
// different materials often need to be sourced from different warehouses.
router.patch('/stock-requests/item/:itemId/approve', adminOnly, async (req: Request, res: Response) => {
  try {
    const [item] = await sql`SELECT * FROM stock_requests WHERE id = ${req.params.itemId}`;
    if (!item) return sendError(res, 404, 'Item not found');
    if (item.status !== 'pending') return sendError(res, 400, 'Item is no longer pending');

    const updated = await sql.begin(async (tx) => {
      if (item.source_type === 'branch') {
        if (!item.from_branch_id) throw Object.assign(new Error('Transfer item is missing a source branch'), { status: 400 });

        const [fromStock] = await tx`
          SELECT quantity FROM branch_stock WHERE branch_id = ${item.from_branch_id} AND product_id = ${item.product_id}
        `;
        if (!fromStock || Number(fromStock.quantity) < Number(item.quantity)) {
          throw Object.assign(new Error('Insufficient stock at the source branch'), { status: 400 });
        }
        await tx`
          UPDATE branch_stock SET quantity = quantity - ${Number(item.quantity)}, updated_at = now()
          WHERE branch_id = ${item.from_branch_id} AND product_id = ${item.product_id}
        `;
        await tx`
          INSERT INTO branch_stock (branch_id, product_id, quantity)
          VALUES (${item.branch_id}, ${item.product_id}, ${Number(item.quantity)})
          ON CONFLICT (branch_id, product_id)
          DO UPDATE SET quantity = branch_stock.quantity + EXCLUDED.quantity, updated_at = now()
        `;
        const [row] = await tx`
          UPDATE stock_requests SET
            status = 'approved', approved_by = ${req.user!.id}, approved_by_name = ${req.user!.fullName || req.user!.email},
            approved_at = now(), updated_at = now()
          WHERE id = ${req.params.itemId} AND status = 'pending'
          RETURNING *
        `;
        return row;
      }

      const { sourceType, warehouseId } = req.body;
      if (!sourceType) throw Object.assign(new Error('sourceType is required (warehouse or others)'), { status: 400 });
      if (sourceType === 'warehouse' && !warehouseId) throw Object.assign(new Error('warehouseId is required when source is warehouse'), { status: 400 });

      if (sourceType === 'warehouse') {
        const [ws] = await tx`SELECT quantity FROM warehouse_stock WHERE warehouse_id = ${warehouseId} AND product_id = ${item.product_id}`;
        if (!ws || Number(ws.quantity) < Number(item.quantity)) {
          throw Object.assign(new Error('Insufficient warehouse stock'), { status: 400 });
        }
        await tx`
          UPDATE warehouse_stock SET quantity = quantity - ${Number(item.quantity)}, updated_at = now()
          WHERE warehouse_id = ${warehouseId} AND product_id = ${item.product_id}
        `;
      }

      await tx`
        INSERT INTO branch_stock (branch_id, product_id, quantity)
        VALUES (${item.branch_id}, ${item.product_id}, ${Number(item.quantity)})
        ON CONFLICT (branch_id, product_id)
        DO UPDATE SET quantity = branch_stock.quantity + EXCLUDED.quantity, updated_at = now()
      `;

      const [row] = await tx`
        UPDATE stock_requests SET
          status = 'approved', source_type = ${sourceType}::stock_source, warehouse_id = ${warehouseId ?? null},
          approved_by = ${req.user!.id}, approved_by_name = ${req.user!.fullName || req.user!.email},
          approved_at = now(), updated_at = now()
        WHERE id = ${req.params.itemId} AND status = 'pending'
        RETURNING *
      `;
      return row;
    });

    if (!updated) return sendError(res, 400, 'Item is no longer pending');

    const [productRow] = await sql`SELECT name, unit FROM products WHERE id = ${item.product_id}`;
    await notifyUser(item.requested_by, {
      type: 'stock_request_approved',
      title: 'A stock request item was approved',
      message: `${productRow?.name ?? 'Item'} × ${item.quantity} ${productRow?.unit ?? ''}`.trim(),
      link: '/branch-stock',
    });

    return sendResponse(res, 200, 'Item approved', updated);
  } catch (err: any) {
    if (err?.status === 400) return sendError(res, 400, err.message);
    return sendError(res, 500, 'Server error', err);
  }
});

router.patch('/stock-requests/item/:itemId/reject', adminOnly, async (req: Request, res: Response) => {
  try {
    const { notes } = req.body;
    const [updated] = await sql`
      UPDATE stock_requests SET
        status      = 'rejected',
        notes       = COALESCE(${notes ?? null}, notes),
        updated_at  = now()
      WHERE id = ${req.params.itemId} AND status = 'pending'
      RETURNING *
    `;
    if (!updated) return sendError(res, 404, 'Item not found or already processed');

    const [productRow] = await sql`SELECT name, unit FROM products WHERE id = ${updated.product_id}`;
    await notifyUser(updated.requested_by, {
      type: 'stock_request_rejected',
      title: 'A stock request item was rejected',
      message: `${productRow?.name ?? 'Item'} × ${updated.quantity} ${productRow?.unit ?? ''}`.trim(),
      link: '/branch-stock',
    });

    return sendResponse(res, 200, 'Item rejected', updated);
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// Low-stock items across branches — admins see every branch, staff/managers
// see only their own. Drives the dashboard's low-stock widget.
// GET /api/branches/stock/low?threshold=20
router.get('/stock/low', async (req: Request, res: Response) => {
  try {
    const threshold = Number(req.query.threshold) || 20;
    const branchId = req.user?.role !== 'admin' && req.user?.branchId ? req.user.branchId : null;

    const rows = await sql`
      SELECT bs.branch_id, b.name AS branch_name, bs.product_id, p.name AS product_name, p.unit AS product_unit, bs.quantity
      FROM branch_stock bs
      JOIN branches b ON b.id = bs.branch_id
      JOIN products p ON p.id = bs.product_id
      WHERE bs.quantity <= ${threshold}
        AND (${branchId}::uuid IS NULL OR bs.branch_id = ${branchId}::uuid)
      ORDER BY bs.quantity ASC
      LIMIT 100
    `;
    return sendResponse(res, 200, 'Low stock fetched', rows);
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// ── Branch CRUD (/:id routes AFTER all fixed-path routes) ────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [branch] = await sql<BranchRow[]>`SELECT * FROM branches WHERE id = ${req.params.id}`;
    if (!branch) return sendError(res, 404, 'Branch not found');
    return sendResponse(res, 200, 'Branch fetched', toBranch(branch));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.get('/:id/stock', async (req: Request, res: Response) => {
  try {
    const rows = await sql<(BranchStockRow & { product: ProductRow })[]>`
      SELECT bs.branch_id, bs.product_id, bs.quantity, bs.updated_at,
             row_to_json(p) AS product
      FROM   branch_stock bs
      JOIN   products p ON p.id = bs.product_id
      WHERE  bs.branch_id = ${req.params.id}
      ORDER  BY p.name
    `;
    return sendResponse(res, 200, 'Stock fetched', rows);
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.put('/:id', adminOnly, [
  body('name').optional().trim().notEmpty().isLength({ max: 100 }).escape(),
  body('location').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 500 }),
  body('isActive').optional().isBoolean(),
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());
  try {
    const { name, location, description, isActive } = req.body;
    const [branch] = await sql<BranchRow[]>`
      UPDATE branches SET
        name        = COALESCE(${name        ?? null}, name),
        location    = COALESCE(${location    ?? null}, location),
        description = COALESCE(${description ?? null}, description),
        is_active   = COALESCE(${isActive    ?? null}, is_active),
        updated_at  = now()
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    if (!branch) return sendError(res, 404, 'Branch not found');
    return sendResponse(res, 200, 'Branch updated', toBranch(branch));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.delete('/:id', adminOnly, async (req: Request, res: Response) => {
  try {
    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*) FROM sales          WHERE branch_id = ${req.params.id})::int AS sales_count,
        (SELECT COUNT(*) FROM daily_reports  WHERE branch_id = ${req.params.id})::int AS reports_count,
        (SELECT COUNT(*) FROM stock_requests WHERE branch_id = ${req.params.id} OR from_branch_id = ${req.params.id})::int AS requests_count,
        (SELECT COUNT(*) FROM debtors        WHERE branch_id = ${req.params.id})::int AS debtors_count,
        (SELECT COUNT(*) FROM expenses       WHERE branch_id = ${req.params.id})::int AS expenses_count
    `;

    const blocking: string[] = [];
    if (counts.sales_count    > 0) blocking.push(`${counts.sales_count} sale${counts.sales_count !== 1 ? 's' : ''}`);
    if (counts.reports_count  > 0) blocking.push(`${counts.reports_count} daily report${counts.reports_count !== 1 ? 's' : ''}`);
    if (counts.requests_count > 0) blocking.push(`${counts.requests_count} stock request${counts.requests_count !== 1 ? 's' : ''}`);
    if (counts.debtors_count  > 0) blocking.push(`${counts.debtors_count} debtor record${counts.debtors_count !== 1 ? 's' : ''}`);
    if (counts.expenses_count > 0) blocking.push(`${counts.expenses_count} expense${counts.expenses_count !== 1 ? 's' : ''}`);

    if (blocking.length > 0) {
      return sendError(res, 409, `Cannot delete: this branch has ${blocking.join(', ')}. Deactivate it instead to preserve the records.`);
    }
    await sql`DELETE FROM branches WHERE id = ${req.params.id}`;
    return sendResponse(res, 200, 'Branch deleted');
    } catch (err: any) {
    if (err.code === '23503') {
      return sendError(res, 409, 'Cannot delete: this branch has linked records. Deactivate it instead.');
    }
    return sendError(res, 500, 'Server error', err);
  }
});

router.post('/:id/stock/add', adminOnly, async (req: Request, res: Response) => {
  try {
    const { productId, quantity, sourceType, warehouseId } = req.body;
    if (!productId || !quantity || !sourceType) return sendError(res, 400, 'productId, quantity and sourceType are required');
    if (sourceType === 'warehouse' && !warehouseId) return sendError(res, 400, 'warehouseId required when source is warehouse');

    if (sourceType === 'warehouse') {
      const [ws] = await sql`SELECT quantity FROM warehouse_stock WHERE warehouse_id = ${warehouseId} AND product_id = ${productId}`;
      if (!ws || Number(ws.quantity) < Number(quantity)) return sendError(res, 400, 'Insufficient warehouse stock');
      await sql`
        UPDATE warehouse_stock SET quantity = quantity - ${Number(quantity)}, updated_at = now()
        WHERE warehouse_id = ${warehouseId} AND product_id = ${productId}
      `;
    }

    await sql`
      INSERT INTO branch_stock (branch_id, product_id, quantity)
      VALUES (${req.params.id}, ${productId}, ${Number(quantity)})
      ON CONFLICT (branch_id, product_id)
      DO UPDATE SET quantity = branch_stock.quantity + EXCLUDED.quantity, updated_at = now()
    `;
    return sendResponse(res, 200, 'Stock added');
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});


// Set stock quantity directly (absolute value, not additive) — admin only
router.put('/:id/stock/:productId', adminOnly, async (req: Request, res: Response) => {
  try {
    const { quantity } = req.body;
    if (quantity === undefined || quantity === null) return sendError(res, 400, 'quantity is required');
    if (Number(quantity) < 0) return sendError(res, 400, 'quantity cannot be negative');

    await sql`
      INSERT INTO branch_stock (branch_id, product_id, quantity)
      VALUES (${req.params.id}, ${req.params.productId}, ${Number(quantity)})
      ON CONFLICT (branch_id, product_id)
      DO UPDATE SET quantity = ${Number(quantity)}, updated_at = now()
    `;
    return sendResponse(res, 200, 'Stock updated');
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// Remove a product from branch stock entirely — admin only
router.delete('/:id/stock/:productId', adminOnly, async (req: Request, res: Response) => {
  try {
    const result = await sql`
      DELETE FROM branch_stock
      WHERE branch_id = ${req.params.id} AND product_id = ${req.params.productId}
      RETURNING product_id
    `;
    if (result.length === 0) return sendError(res, 404, 'Stock item not found');
    return sendResponse(res, 200, 'Stock item removed');
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});


export default router;