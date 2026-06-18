import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import sql from '../db/client.js';
import type { UserRow } from '../db/types.js';
import { generateToken } from '../utils/jwt.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendResponse, sendError } from '../utils/apiResponse.js';

const router = Router();

// Pre-computed dummy hash used for constant-time comparison when a user is not
// found. Without this, an attacker can enumerate valid emails by measuring the
// response time difference (bcrypt vs. instant return).
const DUMMY_HASH = '$2b$12$invalidhashusedfortimingnormalization00000000000000000';

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().isLength({ max: 254 }),
    body('password').notEmpty().isLength({ max: 128 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Return a generic message — don't reveal which field failed
      return sendError(res, 401, 'Invalid email or password');
    }

    try {
      const { email, password } = req.body;

      const [user] = await sql<UserRow[]>`
        SELECT * FROM users
        WHERE email = ${email.toLowerCase()}
        LIMIT 1
      `;

      // Always run bcrypt regardless of whether the user exists.
      // This prevents timing-based user enumeration attacks.
      const hashToCompare = user?.password ?? DUMMY_HASH;
      const isMatch = await bcrypt.compare(password, hashToCompare);

      if (!user || !user.is_active || !isMatch) {
        console.warn(`[AUTH] Failed login for: ${email} from IP: ${req.ip}`);
        return sendError(res, 401, 'Invalid email or password');
      }

      const token = generateToken({
        id:       user.id,
        email:    user.email,
        role:     user.role,
        branchId: user.branch_id ?? undefined,
        fullName: user.full_name,
      });

      console.log(`[AUTH] Login: ${user.email} (${user.role}) from IP: ${req.ip}`);

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
    } catch (err) {
      console.error('[AUTH] Login error:', (err as Error).message);
      return sendError(res, 500, 'Server error');
    }
  }
);

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const [user] = await sql<UserRow[]>`
      SELECT id, email, full_name, phone, role, branch_id, is_active
      FROM users
      WHERE id = ${req.userId!} AND is_active = true
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
  } catch (err) {
    console.error('[AUTH] /me error:', (err as Error).message);
    return sendError(res, 500, 'Server error');
  }
});

export default router;
