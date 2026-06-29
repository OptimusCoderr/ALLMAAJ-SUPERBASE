import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import sql from '../db/client.js';
import type { UserRow } from '../db/types.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

const router = Router();
router.use(authMiddleware);

const toUser = (u: UserRow) => ({
  _id:       u.id,
  id:        u.id,
  fullName:  u.full_name,
  email:     u.email,
  phone:     u.phone,
  role:      u.role,
  branchId:  u.branch_id,
  isActive:  u.is_active,
  createdAt: u.created_at,
});

// ── GET /api/users ────────────────────────────────────────────────────────────
router.get('/', adminOnly, async (req: Request, res: Response) => {
  try {
    const { page, limit: limitParam, search, role, active } = req.query as Record<string, string>;

    const isActive = active === 'true' ? true : active === 'false' ? false : null;

    if (page && limitParam) {
      const lim  = Math.min(parseInt(limitParam) || 25, 200);
      const skip = (parseInt(page) - 1) * lim;

      const users = await sql<UserRow[]>`
        SELECT id, email, full_name, phone, role, branch_id, is_active, is_verified, created_at, updated_at
        FROM users
        WHERE
          (${isActive}::boolean IS NULL OR is_active = ${isActive}::boolean)
          AND (${role ?? null}::text IS NULL OR role::text = ${role ?? null})
          AND (${search ?? null}::text IS NULL OR full_name ILIKE ${'%' + (search ?? '') + '%'} OR email ILIKE ${'%' + (search ?? '') + '%'})
        ORDER BY created_at DESC
        LIMIT ${lim} OFFSET ${skip}
      `;
      const [{ count }] = await sql<[{ count: string }]>`
        SELECT COUNT(*)::text AS count FROM users
        WHERE
          (${isActive}::boolean IS NULL OR is_active = ${isActive}::boolean)
          AND (${role ?? null}::text IS NULL OR role::text = ${role ?? null})
          AND (${search ?? null}::text IS NULL OR full_name ILIKE ${'%' + (search ?? '') + '%'} OR email ILIKE ${'%' + (search ?? '') + '%'})
      `;
      return sendResponse(res, 200, 'Users fetched', {
        users: users.map(toUser),
        total: parseInt(count),
        page: parseInt(page),
        limit: lim,
      });
    }

    const users = await sql<UserRow[]>`
      SELECT id, email, full_name, phone, role, branch_id, is_active, is_verified, created_at, updated_at
      FROM users
      ORDER BY created_at DESC
    `;
    return sendResponse(res, 200, 'Users fetched', users.map(toUser));
  } catch (err) {
    console.error('GET /api/users error:', (err as Error).message);
    return sendError(res, 500, 'Server error');
  }
});

// ── POST /api/users ───────────────────────────────────────────────────────────
router.post(
  '/',
  adminOnly,
  [
    body('email').isEmail().normalizeEmail().isLength({ max: 254 }),
    // No .escape() on password — special chars are valid and bcrypt hashes the raw value
    body('password')
      .isLength({ min: 8, max: 128 })
      .withMessage('Password must be 8–128 characters'),
    body('fullName').trim().notEmpty().isLength({ max: 100 }).escape(),
    body('phone').optional().trim().isLength({ max: 20 }),
    body('role').isIn(['admin', 'manager', 'staff']),
    body('branchId').optional({ nullable: true }).isUUID().withMessage('Invalid branch ID'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());

    try {
      const { email, password, fullName, phone, role, branchId } = req.body;
      const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12');
      const hash   = await bcrypt.hash(password, rounds);

      const [user] = await sql<UserRow[]>`
        INSERT INTO users (email, password, full_name, phone, role, branch_id, is_verified, is_active)
        VALUES (
          ${email.toLowerCase()}, ${hash}, ${fullName}, ${phone ?? null},
          ${role}, ${branchId ?? null}, true, true
        )
        RETURNING id, email, full_name, phone, role, branch_id
      `;
      return sendResponse(res, 201, 'User created', toUser(user));
    } catch (err: any) {
      console.error('POST /api/users error:', err.message);
      if (err.code === '23505') return sendError(res, 409, 'Email already in use');
      return sendError(res, 500, 'Server error');
    }
  }
);

// ── PUT /api/users/:id ────────────────────────────────────────────────────────
router.put(
  '/:id',
  adminOnly,
  [
    param('id').isUUID().withMessage('Invalid user ID'),
    body('email').optional().isEmail().normalizeEmail().isLength({ max: 254 }),
    body('password').optional().isLength({ min: 8, max: 128 }).withMessage('Password must be 8–128 characters'),
    body('fullName').optional().trim().notEmpty().isLength({ max: 100 }).escape(),
    body('phone').optional().trim().isLength({ max: 20 }),
    body('role').optional().isIn(['admin', 'manager', 'staff']),
    body('branchId').optional({ nullable: true }).isUUID().withMessage('Invalid branch ID'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());

    try {
      const { password, fullName, phone, role, branchId, email } = req.body;

      let passwordHash: string | undefined;
      if (password) {
        const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12');
        passwordHash = await bcrypt.hash(password, rounds);
      }

      const [user] = await sql<UserRow[]>`
        UPDATE users SET
          full_name  = COALESCE(${fullName  ?? null}, full_name),
          phone      = COALESCE(${phone     ?? null}, phone),
          role       = COALESCE(${role      ?? null}::user_role, role),
          branch_id  = COALESCE(${branchId  ?? null}::uuid, branch_id),
          email      = COALESCE(${email     ? email.toLowerCase() : null}, email),
          password   = COALESCE(${passwordHash ?? null}, password),
          updated_at = now()
        WHERE id = ${req.params.id}
        RETURNING id, email, full_name, phone, role, branch_id, is_active, created_at, updated_at
      `;
      if (!user) return sendError(res, 404, 'User not found');
      return sendResponse(res, 200, 'User updated', toUser(user));
    } catch (err: any) {
      console.error('PUT /api/users/:id error:', err.message);
      if (err.code === '23505') return sendError(res, 409, 'Email already in use');
      return sendError(res, 500, 'Server error');
    }
  }
);


// ── DELETE /api/users/:id ─────────────────────────────────────────────────────
router.delete('/:id', adminOnly, async (req: Request, res: Response) => {
  try {
    if (req.params.id === req.userId) {
      return sendError(res, 400, 'You cannot delete your own account');
    }
    const [user] = await sql<UserRow[]>`
      DELETE FROM users WHERE id = ${req.params.id} RETURNING id, full_name
    `;
    if (!user) return sendError(res, 404, 'User not found');
    return sendResponse(res, 200, `"${user.full_name}" deleted`);
  } catch (err: any) {
    if (err.code === '23503') {
      return sendError(res, 409, 'Cannot delete this user — they have sales or records linked to their account. Deactivate them instead.');
    }
    return sendError(res, 500, 'Server error', err);
  }
});



// ── PATCH /api/users/:id/toggle-active ───────────────────────────────────────
router.patch(
  '/:id/toggle-active',
  adminOnly,
  [param('id').isUUID().withMessage('Invalid user ID')],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());

    // Prevent an admin from deactivating their own account
    if (req.params.id === req.userId) {
      return sendError(res, 400, 'You cannot deactivate your own account');
    }

    try {
      const [user] = await sql<UserRow[]>`
        UPDATE users
        SET is_active = NOT is_active, updated_at = now()
        WHERE id = ${req.params.id}
        RETURNING id, is_active
      `;
      if (!user) return sendError(res, 404, 'User not found');
      return sendResponse(res, 200, 'User status toggled', { isActive: user.is_active });
    } catch (err) {
      console.error('PATCH /api/users/:id/toggle-active error:', (err as Error).message);
      return sendError(res, 500, 'Server error');
    }
  }
);

export default router;
