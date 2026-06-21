import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { seedAdmin } from './scripts/seed.js'; 

import authRoutes      from './routes/auth.js';
import productRoutes   from './routes/products.js';
import branchRoutes    from './routes/branches.js';
import saleRoutes      from './routes/sales.js';
import reportRoutes    from './routes/reports.js';
import userRoutes      from './routes/users.js';
import warehouseRoutes from './routes/warehouses.js';
import specialCustomerRoutes from './routes/specialCustomers.js';

import sql from './db/client.js';

const app    = express();
const PORT   = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === 'production';

// ── Trust proxy ────────────────────────────────────────────────────────────────
// Required for express-rate-limit to use the real client IP behind nginx/load balancers
app.set('trust proxy', 1);

// ── Security headers (Helmet) ──────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'none'"],
      scriptSrc:      ["'none'"],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],  // Equivalent to X-Frame-Options: DENY
    },
  },
  hsts: {
    maxAge: 31_536_000,   // 1 year
    includeSubDomains: true,
    preload: true,
  },
  crossOriginEmbedderPolicy: false,  // Not needed for a JSON API
}));

// Remove X-Powered-By to avoid fingerprinting the tech stack
app.use((_req, res, next) => {
  res.removeHeader('X-Powered-By');
  next();
});

// ── CORS ───────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // In production, reject requests with no origin (prevents server-to-server abuse)
    if (!origin) {
      return isProd ? cb(new Error('Origin required'), false) : cb(null, true);
    }
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'), false);
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 600,  // Cache CORS preflight for 10 minutes
}));

// ── Rate limiting ──────────────────────────────────────────────────────────────
// Strict limiter for auth routes — prevents brute-force and credential stuffing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,
  message:  { message: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,  // Only failed attempts count toward the limit
});

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS   || '900000'),
  max:      parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '200'),
  message:  { message: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authLimiter);
app.use('/api/',     apiLimiter);

// ── Body parsing ───────────────────────────────────────────────────────────────
// Reduced from 10mb — large payloads are a DoS vector for JSON parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: false }));

// ── Request ID ─────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const reqId = (req.headers['x-request-id'] as string) || randomUUID();
  res.setHeader('X-Request-Id', reqId);
  (req as any).requestId = reqId;
  next();
});

// ── Request logging ────────────────────────────────────────────────────────────
// Log method + masked path only — never log headers (auth tokens) or body (passwords)
app.use((req, _res, next) => {
  const safePath = req.path.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '/:id'
  );
  console.log(`${new Date().toISOString()} ${req.method} ${safePath} [${(req as any).requestId}]`);
  next();
});

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    await sql`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/products',   productRoutes);
app.use('/api/branches',   branchRoutes);
app.use('/api/sales',      saleRoutes);
app.use('/api/reports',    reportRoutes);
app.use('/api/users',      userRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/special-customers', specialCustomerRoutes);

// ── 404 ────────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

// ── Global error handler ───────────────────────────────────────────────────────
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const reqId = (req as any).requestId || 'unknown';
  console.error(`[${reqId}] Unhandled error: ${err.message || err}`);

  if (err.message?.includes('CORS')) {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  // Never expose stack traces or internal error details to clients in production
  res.status(err.statusCode || 500).json({
    message: isProd ? 'Internal server error' : (err.message || 'Internal server error'),
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`ALLMAAJ API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  sql`SELECT 1`
    .then(async () => {
      console.log('Database connected ✓');
      await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_cuttable boolean NOT NULL DEFAULT false`;
      await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_length_inches numeric`;
      console.log('Schema migration ✓');
      return seedAdmin();
    })
    .catch(e => { console.error('Database connection failed:', e.message); process.exit(1); });
});
