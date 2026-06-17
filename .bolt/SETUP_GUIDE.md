# BizTrack Pro — Setup & Deployment Guide

## Architecture Overview

```
Frontend (React/Vite)          Backend (Express/MongoDB)
  Vercel / Netlify    ──────►   Render / Railway / VPS
  VITE_API_URL=...              PORT=5000
```

---

## 1. Backend Setup

### Files you now have in `server/src/routes/`:
| File | Handles |
|------|---------|
| `auth.ts` | POST /api/auth/login, GET /api/auth/me |
| `products.ts` | Full CRUD + branch stock assignment |
| `branches.ts` | Full CRUD + stock fetch |
| `sales.ts` | Create/list sales with date filters |
| `reports.ts` | Daily reports, debtors, expenses, dashboard analytics |
| `users.ts` | Staff management (admin only) |
| `warehouses.ts` | Full CRUD + warehouse stock management |

### Environment Variables — create `server/.env`:
```bash
cp server/.env.example server/.env
```
Then fill in:
```
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/biztrack?retryWrites=true&w=majority
JWT_SECRET=a_random_secret_at_least_32_characters_long
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:5173
BCRYPT_ROUNDS=12
```

### Install & run backend:
```bash
cd server
npm install
npm run dev        # development (nodemon)
npm run build      # compile TypeScript → dist/
npm start          # production
```

### Create your first admin user (run once):
```bash
# From the server/ directory, run this Node snippet:
node -e "
const mongoose = require('mongoose');
require('dotenv/config');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('YourPassword123', 12);
  await mongoose.connection.db.collection('users').insertOne({
    fullName: 'Admin User',
    email: 'admin@yourcompany.com',
    password: hash,
    role: 'admin',
    phone: '',
    branchId: null,
    isActive: true,
    isVerified: true,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  console.log('Admin created!');
  process.exit(0);
});
"
```

---

## 2. Frontend Setup

### Environment Variables — create `.env` at the project root:
```bash
cp frontend.env.example .env
```
Contents:
```
# Development — point to local backend
VITE_API_URL=http://localhost:5000

# Production — point to your deployed backend
# VITE_API_URL=https://your-backend.onrender.com
```

### Install & run frontend:
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # output → dist/
```

---

## 3. API Endpoint Reference

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/login | ❌ | `{ email, password }` → `{ token, user }` |
| GET | /api/auth/me | ✅ | Returns current user |

### Products
| Method | Path | Admin | Description |
|--------|------|-------|-------------|
| GET | /api/products?active=true | ✅ | List products |
| POST | /api/products | ✅✅ | Create product |
| PUT | /api/products/:id | ✅✅ | Update product |
| DELETE | /api/products/:id | ✅✅ | Soft-deactivate |
| PUT | /api/products/:id/stock | ✅✅ | Assign stock to branch |

### Sales
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/sales?branchId=&startDate=&endDate= | List sales |
| POST | /api/sales | Record a sale |

### Reports
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/reports/daily | List daily reports |
| POST | /api/reports/daily | Submit daily report |
| PATCH | /api/reports/daily/:id/review | Approve/reject (admin) |
| GET | /api/reports/debtors | List debtors |
| POST | /api/reports/debtors | Add debtor |
| PATCH | /api/reports/debtors/:id/clear | Mark cleared (admin) |
| PATCH | /api/reports/debtors/:id/reactivate | Reactivate (admin) |
| GET | /api/reports/expenses | List expenses |
| POST | /api/reports/expenses | Add expense |
| GET | /api/reports/analytics/dashboard | Dashboard stats |

---

## 4. Deploying to Production

### Backend → Render (free tier)
1. Push your `server/` folder to GitHub (separate repo or monorepo)
2. New Web Service on render.com → connect repo
3. Build command: `cd server && npm install && npm run build`
4. Start command: `node server/dist/index.js`
5. Add all environment variables from `.env` in the Render dashboard
6. Copy the service URL (e.g. `https://biztrack-api.onrender.com`)

### Frontend → Vercel
1. Push frontend root to GitHub
2. Import project on vercel.com
3. Set environment variable: `VITE_API_URL=https://biztrack-api.onrender.com`
4. Build command: `npm run build` | Output: `dist`

### CORS — update backend after deploying frontend
```
CORS_ORIGIN=https://your-frontend.vercel.app
```

---

## 5. Key Changes Made

### Backend (new files created):
- `server/src/routes/auth.ts` — login + /me endpoint
- `server/src/routes/products.ts` — products + branch stock
- `server/src/routes/branches.ts` — branch CRUD + stock
- `server/src/routes/sales.ts` — sales recording + filtering
- `server/src/routes/reports.ts` — daily reports, debtors, expenses, dashboard
- `server/src/routes/users.ts` — staff management
- `server/src/routes/warehouses.ts` — warehouse CRUD + stock
- `server/src/utils/jwt.ts` — added `fullName` to token payload
- `server/src/middleware/auth.ts` — added `fullName` to request user

### Frontend (updated):
- `src/lib/api.ts` — completely rewritten to call Express REST API (no more MongoDB Atlas Data API)
- `src/lib/auth.ts` — updated to call `/api/auth/login` on your backend

### What did NOT change:
All page components (`src/pages/**`) are unchanged — they still call the same
`find()`, `insertOne()`, `updateOne()`, `deleteOne()` functions. The new `api.ts`
translates those calls into proper REST requests automatically.
