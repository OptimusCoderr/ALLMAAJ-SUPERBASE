import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import sql from '../db/client.js';
import type { ProductRow } from '../db/types.js';
import { num } from '../db/types.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

const router = Router();
router.use(authMiddleware);

const toProduct = (p: ProductRow) => ({
  _id: p.id, id: p.id, name: p.name, sku: p.sku, description: p.description,
  unitPrice: num(p.unit_price), previousPrice: num(p.previous_price),
  currentPrice: num(p.current_price), unit: p.unit,
  category: p.category, isActive: p.is_active,
  createdAt: p.created_at, updatedAt: p.updated_at,
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const { active } = req.query;
    const products =
      active === 'true'  ? await sql<ProductRow[]>`SELECT * FROM products WHERE is_active = true  ORDER BY name` :
      active === 'false' ? await sql<ProductRow[]>`SELECT * FROM products WHERE is_active = false ORDER BY name` :
                           await sql<ProductRow[]>`SELECT * FROM products ORDER BY name`;
    return sendResponse(res, 200, 'Products fetched', products.map(toProduct));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [product] = await sql<ProductRow[]>`SELECT * FROM products WHERE id = ${req.params.id}`;
    if (!product) return sendError(res, 404, 'Product not found');
    return sendResponse(res, 200, 'Product fetched', toProduct(product));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.post('/', adminOnly,
  [body('name').trim().notEmpty(), body('unitPrice').isFloat({ min: 0 }),
   body('unit').isIn(['piece','kg','litre','box','carton','bag','roll','pair','set','dozen'])],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());
    try {
      const { name, sku, description, unitPrice, unit, category } = req.body;
      const [product] = await sql<ProductRow[]>`
        INSERT INTO products (name, sku, description, unit_price, previous_price, current_price, unit, category)
        VALUES (${name}, ${sku ?? null}, ${description ?? null}, ${unitPrice}, 0,
                ${req.body.currentPrice ?? unitPrice}, ${unit}::product_unit, ${category ?? null})
        RETURNING *
      `;
      return sendResponse(res, 201, 'Product created', toProduct(product));
    } catch (err: any) {
      if (err.code === '23505') return sendError(res, 409, 'SKU already exists');
      return sendError(res, 500, 'Server error', err);
    }
  }
);

router.put('/:id', adminOnly, [body('name').optional().trim().notEmpty()], async (req: Request, res: Response) => {
  try {
    const [existing] = await sql<ProductRow[]>`SELECT * FROM products WHERE id = ${req.params.id}`;
    if (!existing) return sendError(res, 404, 'Product not found');
    const { name, sku, description, unitPrice, unit, category, isActive } = req.body;
    const newUnit      = num(existing.unit_price);
    const newCurrent   = unitPrice !== undefined ? unitPrice : num(existing.current_price);
    const newPrevious  = unitPrice !== undefined && unitPrice !== newUnit
                         ? num(existing.current_price) : num(existing.previous_price);
    const [product] = await sql<ProductRow[]>`
      UPDATE products SET
        name           = COALESCE(${name        ?? null}, name),
        sku            = COALESCE(${sku         ?? null}, sku),
        description    = COALESCE(${description ?? null}, description),
        unit_price     = ${unitPrice ?? newUnit},
        previous_price = ${newPrevious},
        current_price  = ${newCurrent},
        unit           = COALESCE(${unit        ?? null}::product_unit, unit),
        category       = COALESCE(${category    ?? null}, category),
        is_active      = COALESCE(${isActive    ?? null}, is_active),
        updated_at     = now()
      WHERE id = ${req.params.id}
      RETURNING *
    `;
    return sendResponse(res, 200, 'Product updated', toProduct(product));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

router.delete('/:id', adminOnly, async (req: Request, res: Response) => {
  try {
    await sql`UPDATE products SET is_active = false, updated_at = now() WHERE id = ${req.params.id}`;
    return sendResponse(res, 200, 'Product deactivated');
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// Upsert branch stock — composite PK, no id in response
router.put('/:id/stock', adminOnly, async (req: Request, res: Response) => {
  try {
    const { branchId, quantity } = req.body;
    if (!branchId) return sendError(res, 400, 'branchId is required');
    const [stock] = await sql`
      INSERT INTO branch_stock (branch_id, product_id, quantity)
      VALUES (${branchId}, ${req.params.id}, ${Number(quantity) || 0})
      ON CONFLICT (branch_id, product_id)
      DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()
      RETURNING branch_id, product_id, quantity, updated_at
    `;
    return sendResponse(res, 200, 'Stock updated', stock);
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

export default router;