import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import authRoutes      from './routes/auth.js';
import productRoutes   from './routes/products.js';
import branchRoutes    from './routes/branches.js';
import saleRoutes      from './routes/sales.js';
import reportRoutes    from './routes/reports.js';
import userRoutes      from './routes/users.js';
import warehouseRoutes from './routes/warehouses.js';

// Import client eagerly so any connection errors surface at startup
import sql from './db/client.js';

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:         process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use('/api/', rateLimit({
  windowMs:      parseInt(process.env.RATE_LIMIT_WINDOW_MS  || '900000'),
  max:           parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message:       'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders:   false,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ── Request logging ───────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    await sql`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/products',   productRoutes);
app.use('/api/branches',   branchRoutes);
app.use('/api/sales',      saleRoutes);
app.use('/api/reports',    reportRoutes);
app.use('/api/users',      userRoutes);
app.use('/api/warehouses', warehouseRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(err.statusCode || 500).json({
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`BizTrack API running on port ${PORT}`);
  // Verify DB connectivity at startup
  sql`SELECT 1`.then(() => console.log('Supabase connected ✓'))
               .catch(e  => { console.error('Supabase connection failed:', e); process.exit(1); });
});