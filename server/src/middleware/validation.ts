import { body, validationResult, param, query } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      message: 'Validation failed',
      errors: errors.array().map(e => ({
        field:   (e as any).path ?? (e as any).param,
        message: e.msg,
      })),
    });
    return;
  }
  next();
};

// ── Auth validations ──────────────────────────────────────────────────────────

export const validateRegister = [
  body('email').isEmail().normalizeEmail().isLength({ max: 254 }),
  // IMPORTANT: never call .escape() on passwords — it HTML-encodes special chars
  // and bcrypt will then hash the corrupted value, breaking login for those users.
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be 8–128 characters'),
  body('fullName').trim().notEmpty().isLength({ max: 100 }).escape(),
  body('phone').optional().trim().isLength({ max: 20 }),
  handleValidationErrors,
];

export const validateLogin = [
  body('email').isEmail().normalizeEmail().isLength({ max: 254 }),
  // No .escape() on password — only length guard to prevent DoS
  body('password').notEmpty().isLength({ max: 128 }).withMessage('Password is required'),
  handleValidationErrors,
];

// ── Product validations ───────────────────────────────────────────────────────

export const validateProduct = [
  body('name').trim().notEmpty().isLength({ max: 200 }).escape(),
  body('unitPrice').isFloat({ min: 0, max: 9_999_999.99 }),
  body('currentPrice').optional().isFloat({ min: 0, max: 9_999_999.99 }),
  body('unit').isIn([
    'piece', 'kg', 'litre', 'box', 'carton', 'bag',
    'roll', 'pair', 'set', 'dozen', 'pack', 'bottle', 'tin', 'sachet',
  ]),
  body('category').optional().trim().isLength({ max: 100 }).escape(),
  body('description').optional().trim().isLength({ max: 1000 }).escape(),
  body('sku').optional().trim().isLength({ max: 50 }).escape(),
  handleValidationErrors,
];

// ── Sale validations ──────────────────────────────────────────────────────────
// NOTE: branchId and productId are PostgreSQL UUIDs, NOT MongoDB ObjectIds.
// isMongoId() checks for a 24-char hex string and would reject all valid UUIDs.

export const validateSale = [
  body('branchId').isUUID().withMessage('Invalid branch ID'),
  body('paymentMethod').isIn(['cash', 'pos', 'unpaid', 'part']),
  body('items')
    .isArray({ min: 1, max: 100 })
    .withMessage('Items must be an array of 1–100 entries'),
  body('items.*.productId').isUUID().withMessage('Invalid product ID'),
  body('items.*.quantity').isFloat({ min: 0.001, max: 99_999 }),
  body('items.*.unitPrice').isFloat({ min: 0, max: 9_999_999.99 }),
  body('customerName').optional().trim().isLength({ max: 150 }).escape(),
  body('customerPhone').optional().trim().isLength({ max: 20 }),
  body('notes').optional().trim().isLength({ max: 500 }).escape(),
  body('amountPaid').optional().isFloat({ min: 0 }),
  handleValidationErrors,
];

// ── Pagination ────────────────────────────────────────────────────────────────

export const validatePagination = [
  query('page').optional().isInt({ min: 1, max: 10_000 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  handleValidationErrors,
];

// ── UUID path parameter ───────────────────────────────────────────────────────

export const validateIdParam = [
  param('id').isUUID().withMessage('Invalid ID format'),
  handleValidationErrors,
];
