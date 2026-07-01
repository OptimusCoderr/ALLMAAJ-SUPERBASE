import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

// Fail fast at startup — never serve with a missing or weak secret
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET must be set and at least 32 characters. ' +
    "Generate one: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
  );
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      user?: {
        id: string;
        email: string;
        role: string;
        fullName?: string;
        branchId?: string;
      };
    }
  }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const token = authHeader.slice(7);
    if (!token) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],  // Prevent algorithm confusion attack (e.g. 'none')
      issuer: 'biztrack-api',
    }) as any;

    // Require all essential claims — reject structurally invalid tokens
    if (!decoded.id || !decoded.email || !decoded.role) {
      res.status(401).json({ message: 'Invalid token' });
      return;
    }

    req.user = {
      id:       decoded.id,
      email:    decoded.email,
      role:     decoded.role,
      fullName: decoded.fullName,
      branchId: decoded.branchId,
    };
    req.userId = decoded.id;
    next();
  } catch {
    // Never expose JWT error details to the client
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

export const adminOnly = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ message: 'Admin access required' });
    return;
  }
  next();
};

export const managerOrAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
    res.status(403).json({ message: 'Manager or admin access required' });
    return;
  }
  next();
};

export const staffOnly = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user || !['admin', 'manager', 'staff'].includes(req.user.role)) {
    res.status(403).json({ message: 'Insufficient permissions' });
    return;
  }
  next();
};
