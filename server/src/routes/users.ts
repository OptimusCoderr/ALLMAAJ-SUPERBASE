import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import sql from '../db/client.js';
import type { UserRow } from '../db/types.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

const router = Router();
router.use(authMiddleware);

const toUser = (u: UserRow) => ({
  _id:       u.id,   // <-- ADD THIS LINE
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
router.get('/', adminOnly, async (_req: Request, res: Response) => {
  try {
    const users = await sql<UserRow[]>`
      SELECT id, email, full_name, phone, role, branch_id, is_active, is_verified, created_at, updated_at
      FROM users
      ORDER BY created_at DESC
    `;
    return sendResponse(res, 200, 'Users fetched', users.map(toUser));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// ── POST /api/users ───────────────────────────────────────────────────────────
router.post(
  '/',
  adminOnly,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('fullName').trim().notEmpty(),
    body('role').isIn(['admin', 'manager', 'staff']),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());

    try {
      const { email, password, fullName, phone, role } = req.body;
      const branchId = req.body.branchId || null;
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
    // AFTER:
    } catch (err: any) {
      console.error('POST /api/users error:', err);
      if (err.code === '23505') return sendError(res, 409, 'Email already in use');
      return sendError(res, 500, err?.message || 'Server error', err);
    }
  }
);

// ── PUT /api/users/:id ────────────────────────────────────────────────────────
router.put('/:id', adminOnly, async (req: Request, res: Response) => {
  try {
    const { password, fullName, phone, role, branchId, email } = req.body;

    // Build update set dynamically to avoid overwriting unchanged fields
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (fullName  !== undefined) updates.full_name  = fullName;
    if (phone     !== undefined) updates.phone      = phone;
    if (role      !== undefined) updates.role       = role;
    if (branchId  !== undefined) updates.branch_id  = branchId;
    if (email     !== undefined) updates.email      = email.toLowerCase();
    if (password) {
      const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12');
      updates.password = await bcrypt.hash(password, rounds);
    }

    // postgres.js doesn't support dynamic SET from objects natively,
    // so we build the query with individual fields checked:
    const [user] = await sql<UserRow[]>`
      UPDATE users SET
        full_name  = COALESCE(${updates.full_name  as string  ?? null}, full_name),
        phone      = COALESCE(${updates.phone      as string  ?? null}, phone),
        role       = COALESCE(${updates.role       as string  ?? null}::user_role, role),
        branch_id  = COALESCE(${updates.branch_id  as string  ?? null}::uuid, branch_id),
        email      = COALESCE(${updates.email      as string  ?? null}, email),
        password   = COALESCE(${updates.password   as string  ?? null}, password),
        updated_at = now()
      WHERE id = ${req.params.id}
      RETURNING id, email, full_name, phone, role, branch_id, is_active, created_at, updated_at
    `;
    if (!user) return sendError(res, 404, 'User not found');
    return sendResponse(res, 200, 'User updated', toUser(user));
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

// ── PATCH /api/users/:id/toggle-active ───────────────────────────────────────
router.patch('/:id/toggle-active', adminOnly, async (req: Request, res: Response) => {
  try {
    const [user] = await sql<UserRow[]>`
      UPDATE users
      SET is_active = NOT is_active, updated_at = now()
      WHERE id = ${req.params.id}
      RETURNING id, is_active
    `;
    if (!user) return sendError(res, 404, 'User not found');
    return sendResponse(res, 200, 'User status toggled', { isActive: user.is_active });
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

export default router;