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
  isCuttable: p.is_cuttable ?? false,
  unitLengthInches: p.unit_length_inches != null ? num(p.unit_length_inches) : null,
  createdAt: p.created_at, updatedAt: p.updated_at,
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const { active, page, limit: limitParam, search, category } = req.query as Record<string, string>;

    const isActive = active === 'true' ? true : active === 'false' ? false : null;

    if (page && limitParam) {
      const lim  = Math.min(parseInt(limitParam) || 25, 200);
      const skip = (parseInt(page) - 1) * lim;

      const products = await sql<ProductRow[]>`
        SELECT * FROM products
        WHERE
          (${isActive}::boolean IS NULL OR is_active = ${isActive}::boolean)
          AND (${search ?? null}::text IS NULL OR name ILIKE ${'%' + (search ?? '') + '%'} OR category ILIKE ${'%' + (search ?? '') + '%'})
          AND (${category ?? null}::text IS NULL OR category = ${category ?? null})
        ORDER BY name
        LIMIT ${lim} OFFSET ${skip}
      `;
      const [{ count }] = await sql<[{ count: string }]>`
        SELECT COUNT(*)::text AS count FROM products
        WHERE
          (${isActive}::boolean IS NULL OR is_active = ${isActive}::boolean)
          AND (${search ?? null}::text IS NULL OR name ILIKE ${'%' + (search ?? '') + '%'} OR category ILIKE ${'%' + (search ?? '') + '%'})
          AND (${category ?? null}::text IS NULL OR category = ${category ?? null})
      `;
      return sendResponse(res, 200, 'Products fetched', {
        products: products.map(toProduct),
        total: parseInt(count),
        page: parseInt(page),
        limit: lim,
      });
    }

    const products =
      isActive === true  ? await sql<ProductRow[]>`SELECT * FROM products WHERE is_active = true  ORDER BY name` :
      isActive === false ? await sql<ProductRow[]>`SELECT * FROM products WHERE is_active = false ORDER BY name` :
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
  [
    body('name').trim().notEmpty().isLength({ max: 200 }).escape(),
    body('sku').optional({ nullable: true }).trim().isLength({ max: 50 }),
    body('description').optional({ nullable: true }).trim().isLength({ max: 1000 }),
    body('category').optional({ nullable: true }).trim().isLength({ max: 100 }),
    body('unitPrice').isFloat({ min: 0 }),
    body('unit').isIn(['piece','kg','litre','box','carton','bag','roll','pair','set','dozen']),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());
    try {
      const { name, sku, description, unitPrice, unit, category, isCuttable, unitLengthInches } = req.body;
      const [product] = await sql<ProductRow[]>`
        INSERT INTO products (name, sku, description, unit_price, previous_price, current_price, unit, category, is_cuttable, unit_length_inches)
        VALUES (${name}, ${sku ?? null}, ${description ?? null}, ${unitPrice}, 0,
                ${req.body.currentPrice ?? unitPrice}, ${unit}::product_unit, ${category ?? null},
                ${isCuttable ?? false}, ${isCuttable && unitLengthInches ? unitLengthInches : null})
        RETURNING *
      `;
      return sendResponse(res, 201, 'Product created', toProduct(product));
    } catch (err: any) {
      if (err.code === '23505') return sendError(res, 409, 'SKU already exists');
      return sendError(res, 500, 'Server error', err);
    }
  }
);

router.put('/:id', adminOnly, [
  body('name').optional().trim().notEmpty().isLength({ max: 200 }).escape(),
  body('sku').optional({ nullable: true }).trim().isLength({ max: 50 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 1000 }),
  body('category').optional({ nullable: true }).trim().isLength({ max: 100 }),
  body('unitPrice').optional().isFloat({ min: 0 }),
  body('unit').optional().isIn(['piece','kg','litre','box','carton','bag','roll','pair','set','dozen']),
], async (req: Request, res: Response) => {
  try {
    const [existing] = await sql<ProductRow[]>`SELECT * FROM products WHERE id = ${req.params.id}`;
    if (!existing) return sendError(res, 404, 'Product not found');
    const { name, sku, description, unitPrice, unit, category, isActive, isCuttable, unitLengthInches } = req.body;
    const newUnit      = num(existing.unit_price);
    const newCurrent   = unitPrice !== undefined ? unitPrice : num(existing.current_price);
    const newPrevious  = unitPrice !== undefined && unitPrice !== newUnit
                         ? num(existing.current_price) : num(existing.previous_price);
    const newIsCuttable = isCuttable !== undefined ? isCuttable : existing.is_cuttable;
    const newUnitLengthInches = newIsCuttable && unitLengthInches != null ? unitLengthInches
                              : isCuttable === false ? null
                              : existing.unit_length_inches;
    const [product] = await sql<ProductRow[]>`
      UPDATE products SET
        name               = COALESCE(${name        ?? null}, name),
        sku                = COALESCE(${sku         ?? null}, sku),
        description        = COALESCE(${description ?? null}, description),
        unit_price         = ${unitPrice ?? newUnit},
        previous_price     = ${newPrevious},
        current_price      = ${newCurrent},
        unit               = COALESCE(${unit        ?? null}::product_unit, unit),
        category           = COALESCE(${category    ?? null}, category),
        is_active          = COALESCE(${isActive    ?? null}, is_active),
        is_cuttable        = ${newIsCuttable},
        unit_length_inches = ${newUnitLengthInches},
        updated_at         = now()
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