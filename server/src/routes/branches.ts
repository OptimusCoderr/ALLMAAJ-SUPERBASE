import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import sql from '../db/client.js';
import type { BranchRow, BranchStockRow, ProductRow } from '../db/types.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

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

router.post('/', adminOnly, [body('name').trim().notEmpty()], async (req: Request, res: Response) => {
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

// Staff or admin creates a stock request
//POST /api/branches/stock-requests
// NEW
router.post('/stock-requests', async (req: Request, res: Response) => {
  try {
    const { productId, quantity, notes } = req.body;
    const branchId = req.user?.role !== 'admin' && req.user?.branchId
      ? req.user.branchId
      : req.body.branchId;
    if (!branchId || !productId || !quantity) return sendError(res, 400, 'branchId, productId and quantity are required');
    
    const [row] = await sql`
      INSERT INTO stock_requests (branch_id, product_id, quantity, requested_by, requested_by_name, notes)
      VALUES (${branchId}, ${productId}, ${Number(quantity)}, ${req.user!.id}, ${req.user!.fullName || req.user!.email}, ${notes ?? null})
      RETURNING *
    `;
    return sendResponse(res, 201, 'Stock request submitted', row);
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// Staff gets their own requests (all statuses)
router.get('/stock-requests/mine', async (req: Request, res: Response) => {
  try {
    const rows = await sql`
      SELECT sr.*, b.name AS branch_name, p.name AS product_name, p.unit AS product_unit
      FROM stock_requests sr
      JOIN branches b ON b.id = sr.branch_id
      JOIN products p ON p.id = sr.product_id
      WHERE sr.requested_by = ${req.user!.id}
      ORDER BY sr.created_at DESC
    `;
    return sendResponse(res, 200, 'Your requests fetched', rows);
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// Admin gets all requests (filtered by status if provided)
router.get('/stock-requests', adminOnly, async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const rows = status
      ? await sql`
          SELECT sr.*, b.name AS branch_name, p.name AS product_name, p.unit AS product_unit,
                 w.name AS warehouse_name
          FROM stock_requests sr
          JOIN branches b  ON b.id = sr.branch_id
          JOIN products p  ON p.id = sr.product_id
          LEFT JOIN warehouses w ON w.id = sr.warehouse_id
          WHERE sr.status = ${status as string}::stock_request_status
          ORDER BY sr.created_at DESC
        `
      : await sql`
          SELECT sr.*, b.name AS branch_name, p.name AS product_name, p.unit AS product_unit,
                 w.name AS warehouse_name
          FROM stock_requests sr
          JOIN branches b  ON b.id = sr.branch_id
          JOIN products p  ON p.id = sr.product_id
          LEFT JOIN warehouses w ON w.id = sr.warehouse_id
          ORDER BY sr.created_at DESC
        `;
    return sendResponse(res, 200, 'Requests fetched', rows);
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.patch('/stock-requests/:id/approve', adminOnly, async (req: Request, res: Response) => {
  try {
    const { sourceType, warehouseId } = req.body;
    if (!sourceType) return sendError(res, 400, 'sourceType is required (warehouse or others)');
    if (sourceType === 'warehouse' && !warehouseId) return sendError(res, 400, 'warehouseId is required when source is warehouse');

    const [request] = await sql`SELECT * FROM stock_requests WHERE id = ${req.params.id}`;
    if (!request) return sendError(res, 404, 'Request not found');
    if (request.status !== 'pending') return sendError(res, 400, 'Request is no longer pending');

    if (sourceType === 'warehouse') {
      const [ws] = await sql`SELECT quantity FROM warehouse_stock WHERE warehouse_id = ${warehouseId} AND product_id = ${request.product_id}`;
      if (!ws || Number(ws.quantity) < Number(request.quantity)) return sendError(res, 400, 'Insufficient warehouse stock');
      await sql`
        UPDATE warehouse_stock SET quantity = quantity - ${Number(request.quantity)}, updated_at = now()
        WHERE warehouse_id = ${warehouseId} AND product_id = ${request.product_id}
      `;
    }

    await sql`
      INSERT INTO branch_stock (branch_id, product_id, quantity)
      VALUES (${request.branch_id}, ${request.product_id}, ${Number(request.quantity)})
      ON CONFLICT (branch_id, product_id)
      DO UPDATE SET quantity = branch_stock.quantity + EXCLUDED.quantity, updated_at = now()
    `;

    const [updated] = await sql`
      UPDATE stock_requests SET
        status           = 'approved',
        source_type      = ${sourceType}::stock_source,
        warehouse_id     = ${warehouseId ?? null},
        approved_by      = ${req.user!.id},
        approved_by_name = ${req.user!.fullName || req.user!.email},
        approved_at      = now(),
        updated_at       = now()
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    return sendResponse(res, 200, 'Request approved', updated);
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.patch('/stock-requests/:id/reject', adminOnly, async (req: Request, res: Response) => {
  try {
    const { notes } = req.body;
    const [updated] = await sql`
      UPDATE stock_requests SET
        status      = 'rejected',
        notes       = COALESCE(${notes ?? null}, notes),
        updated_at  = now()
      WHERE id = ${req.params.id} AND status = 'pending'
      RETURNING *
    `;
    if (!updated) return sendError(res, 404, 'Request not found or already processed');
    return sendResponse(res, 200, 'Request rejected', updated);
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

router.put('/:id', adminOnly, async (req: Request, res: Response) => {
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
    await sql`DELETE FROM branches WHERE id = ${req.params.id}`;
    return sendResponse(res, 200, 'Branch deleted');
  } catch (err) { return sendError(res, 500, 'Server error', err); }
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

export default router;