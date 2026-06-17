import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import sql from '../db/client.js';
import type { WarehouseRow, WarehouseStockRow, ProductRow } from '../db/types.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

const router = Router();
router.use(authMiddleware, adminOnly);

const toWarehouse = (w: WarehouseRow) => ({
  _id: w.id, id: w.id, name: w.name, location: w.location,
  description: w.description, isActive: w.is_active,
  createdAt: w.created_at, updatedAt: w.updated_at,
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const warehouses = await sql<WarehouseRow[]>`SELECT * FROM warehouses ORDER BY name`;
    return sendResponse(res, 200, 'Warehouses fetched', warehouses.map(toWarehouse));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.post('/', [body('name').trim().notEmpty()], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());
  try {
    const { name, location, description } = req.body;
    const [w] = await sql<WarehouseRow[]>`
      INSERT INTO warehouses (name, location, description)
      VALUES (${name}, ${location ?? null}, ${description ?? null}) RETURNING *
    `;
    return sendResponse(res, 201, 'Warehouse created', toWarehouse(w));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, location, description, isActive } = req.body;
    const [w] = await sql<WarehouseRow[]>`
      UPDATE warehouses SET
        name        = COALESCE(${name        ?? null}, name),
        location    = COALESCE(${location    ?? null}, location),
        description = COALESCE(${description ?? null}, description),
        is_active   = COALESCE(${isActive    ?? null}, is_active),
        updated_at  = now()
      WHERE id = ${req.params.id} RETURNING *
    `;
    if (!w) return sendError(res, 404, 'Warehouse not found');
    return sendResponse(res, 200, 'Warehouse updated', toWarehouse(w));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.get('/:id/stock', async (req: Request, res: Response) => {
  try {
    const rows = await sql<(WarehouseStockRow & { product: ProductRow })[]>`
      SELECT ws.warehouse_id, ws.product_id, ws.quantity, ws.updated_at,
             row_to_json(p) AS product
      FROM   warehouse_stock ws
      JOIN   products p ON p.id = ws.product_id
      WHERE  ws.warehouse_id = ${req.params.id}
      ORDER  BY p.name
    `;
    return sendResponse(res, 200, 'Stock fetched', rows);
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.put('/:id/stock', async (req: Request, res: Response) => {
  try {
    const { productId, quantity } = req.body;
    if (!productId) return sendError(res, 400, 'productId is required');
    const [stock] = await sql`
      INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
      VALUES (${req.params.id}, ${productId}, ${Number(quantity) || 0})
      ON CONFLICT (warehouse_id, product_id)
      DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()
      RETURNING warehouse_id, product_id, quantity, updated_at
    `;
    return sendResponse(res, 200, 'Stock updated', stock);
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// DELETE /stock/:stockId — now uses composite key (warehouseId + productId)
router.delete('/stock/:warehouseId/:productId', async (req: Request, res: Response) => {
  try {
    await sql`
      DELETE FROM warehouse_stock
      WHERE warehouse_id = ${req.params.warehouseId}
        AND product_id   = ${req.params.productId}
    `;
    return sendResponse(res, 200, 'Stock item deleted');
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await sql`DELETE FROM warehouses WHERE id = ${req.params.id}`;
    return sendResponse(res, 200, 'Warehouse deleted');
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

export default router;