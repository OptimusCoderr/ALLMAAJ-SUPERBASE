import { body, validationResult, param, query } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Auth validations
export const validateRegister = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).trim().escape(),
  body('fullName').trim().escape().notEmpty(),
  body('phone').optional().trim(),
  handleValidationErrors,
];

export const validateLogin = [
  body('email').isEmail().normalizeEmail(),
  body('password').trim().escape(),
  handleValidationErrors,
];

// Product validations
export const validateProduct = [
  body('name').trim().escape().notEmpty(),
  body('unitPrice').isFloat({ min: 0 }),
  body('currentPrice').optional().isFloat({ min: 0 }),
  body('unit').isIn(['piece', 'kg', 'litre', 'box', 'carton', 'bag', 'roll', 'pair', 'set', 'dozen']),
  body('category').optional().trim().escape(),
  handleValidationErrors,
];

// Sale validations
export const validateSale = [
  body('branchId').isMongoId(),
  body('paymentMethod').isIn(['cash', 'pos', 'unpaid']),
  body('items').isArray({ min: 1 }),
  body('items.*.productId').isMongoId(),
  body('items.*.quantity').isFloat({ min: 0.01 }),
  body('items.*.unitPrice').isFloat({ min: 0 }),
  body('customerName').optional().trim().escape(),
  body('customerPhone').optional().trim(),
  body('notes').optional().trim().escape(),
  handleValidationErrors,
];

// Pagination
export const validatePagination = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  handleValidationErrors,
];
