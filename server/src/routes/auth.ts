import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import sql from '../db/client.js';
import type { UserRow } from '../db/types.js';
import { generateToken } from '../utils/jwt.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

const router = Router();

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post(
  '/login',
  [body('email').isEmail().normalizeEmail(), body('password').trim().notEmpty()],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return sendError(res, 400, 'Validation failed', errors.array());

    try {
      const { email, password } = req.body;

      const [user] = await sql<UserRow[]>`
        SELECT * FROM users
        WHERE email = ${email.toLowerCase()}
          AND is_active = true
        LIMIT 1
      `;
      if (!user) return sendError(res, 401, 'Invalid email or password');

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return sendError(res, 401, 'Invalid email or password');

      const token = generateToken({
        id:       user.id,
        email:    user.email,
        role:     user.role,
        branchId: user.branch_id ?? undefined,
        fullName: user.full_name,
      });

      return sendResponse(res, 200, 'Login successful', {
        token,
        user: {
          id:       user.id,
          fullName: user.full_name,
          email:    user.email,
          phone:    user.phone,
          role:     user.role,
          branchId: user.branch_id,
        },
      });
    } catch (err) { return sendError(res, 500, 'Server error', err); }
  }
);

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const [user] = await sql<UserRow[]>`
      SELECT id, email, full_name, phone, role, branch_id
      FROM users
      WHERE id = ${req.userId!}
      LIMIT 1
    `;
    if (!user) return sendError(res, 404, 'User not found');

    return sendResponse(res, 200, 'User fetched', {
      id:       user.id,
      fullName: user.full_name,
      email:    user.email,
      phone:    user.phone,
      role:     user.role,
      branchId: user.branch_id,
    });
  } catch (err) { return sendError(res, 500, 'Server error', err); }
});

export default router;