import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import sql from '../db/client.js';
import type { SpecialCustomerRow } from '../db/types.js';
import { authMiddleware, managerOrAdmin } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

const router = Router();
router.use(authMiddleware);

const toCustomer = (r: SpecialCustomerRow) => ({
  _id:       r.id,
  id:        r.id,
  name:      r.name,
  phone:     r.phone,
  email:     r.email,
  address:   r.address,
  notes:     r.notes,
  createdBy: r.created_by,
  isActive:  r.is_active,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ── GET /api/special-customers ─────────────────────────────────────────────────
// All authenticated users (staff + admin) can fetch for use in sales page
router.get('/', async (req: Request, res: Response) => {
  try {
    const activeOnly = req.query.active !== 'false';
    const customers = await sql<SpecialCustomerRow[]>`
      SELECT * FROM special_customers
      ${activeOnly ? sql`WHERE is_active = true` : sql``}
      ORDER BY name ASC
    `;
    return sendResponse(res, 200, 'Special customers fetched', customers.map(toCustomer));
  } catch (err) {
    console.error('GET /api/special-customers error:', (err as Error).message);
    return sendError(res, 500, 'Server error');
  }
});

// ── POST /api/special-customers ────────────────────────────────────────────────
router.post(
  '/',
  managerOrAdmin,
  [
    body('name').trim().notEmpty().isLength({ max: 150 }).escape(),
    body('phone').optional({ nullable: true }).trim().isLength({ max: 30 }),
    body('email').optional({ nullable: true }).trim().isEmail().isLength({ max: 254 }).normalizeEmail(),
    body('address').optional({ nullable: true }).trim().isLength({ max: 500 }),
    body('notes').optional({ nullable: true }).trim().isLength({ max: 1000 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());

    try {
      const { name, phone, email, address, notes } = req.body;
      const [customer] = await sql<SpecialCustomerRow[]>`
        INSERT INTO special_customers (name, phone, email, address, notes, created_by)
        VALUES (
          ${name}, ${phone ?? null}, ${email ?? null},
          ${address ?? null}, ${notes ?? null}, ${req.user!.id}
        )
        RETURNING *
      `;
      return sendResponse(res, 201, 'Special customer created', toCustomer(customer));
    } catch (err) {
      console.error('POST /api/special-customers error:', (err as Error).message);
      return sendError(res, 500, 'Server error');
    }
  }
);

// ── PUT /api/special-customers/:id ────────────────────────────────────────────
router.put(
  '/:id',
  managerOrAdmin,
  [
    param('id').isUUID().withMessage('Invalid ID'),
    body('name').optional().trim().notEmpty().isLength({ max: 150 }).escape(),
    body('phone').optional({ nullable: true }).trim().isLength({ max: 30 }),
    body('email').optional({ nullable: true }).trim().isEmail().isLength({ max: 254 }).normalizeEmail(),
    body('address').optional({ nullable: true }).trim().isLength({ max: 500 }),
    body('notes').optional({ nullable: true }).trim().isLength({ max: 1000 }),
    body('isActive').optional().isBoolean(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());

    try {
      const { name, phone, email, address, notes, isActive } = req.body;
      const [customer] = await sql<SpecialCustomerRow[]>`
        UPDATE special_customers SET
          name       = COALESCE(${name      ?? null}, name),
          phone      = COALESCE(${phone     ?? null}, phone),
          email      = COALESCE(${email     ?? null}, email),
          address    = COALESCE(${address   ?? null}, address),
          notes      = COALESCE(${notes     ?? null}, notes),
          is_active  = COALESCE(${isActive  ?? null}, is_active),
          updated_at = now()
        WHERE id = ${req.params.id}
        RETURNING *
      `;
      if (!customer) return sendError(res, 404, 'Special customer not found');
      return sendResponse(res, 200, 'Special customer updated', toCustomer(customer));
    } catch (err) {
      console.error('PUT /api/special-customers/:id error:', (err as Error).message);
      return sendError(res, 500, 'Server error');
    }
  }
);

// ── DELETE /api/special-customers/:id ─────────────────────────────────────────
router.delete(
  '/:id',
  managerOrAdmin,
  [param('id').isUUID().withMessage('Invalid ID')],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());

    try {
      const [customer] = await sql<SpecialCustomerRow[]>`
        DELETE FROM special_customers WHERE id = ${req.params.id} RETURNING id, name
      `;
      if (!customer) return sendError(res, 404, 'Special customer not found');
      return sendResponse(res, 200, `"${customer.name}" deleted`);
    } catch (err) {
      console.error('DELETE /api/special-customers/:id error:', (err as Error).message);
      return sendError(res, 500, 'Server error');
    }
  }
);

export default router;