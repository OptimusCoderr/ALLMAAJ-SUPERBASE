/**
 * REST API client — talks to our Express/MongoDB backend.
 *
 * Base URL comes from VITE_API_URL (e.g. https://your-api.onrender.com).
 * The JWT is stored in sessionStorage (cleared on tab close) for XSS safety.
 */

const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

if (!BASE_URL) {
  console.error('[api] VITE_API_URL is not set. Copy .env.example to .env and fill it in.');
}

// ─── In-memory auth token ─────────────────────────────────────────────────────
let _authToken: string | null = null;

export function setAuthToken(token: string | null) { _authToken = token; }
export function getAuthToken(): string | null { return _authToken; }

// ─── Low-level fetch wrapper ──────────────────────────────────────────────────
async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (_authToken) headers['Authorization'] = `Bearer ${_authToken}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
  const body = await res.json().catch(() => ({ message: res.statusText }));
  const detail = Array.isArray(body?.errors)
    ? body.errors.map((e: any) => e.msg || e.message || JSON.stringify(e)).join('; ')
    : null;
  throw new Error(detail || body?.message || `HTTP ${res.status}`);
  }
  const json = await res.json();
  return json?.data ?? json;
}

// ─── Generic CRUD helpers ────────────────────────────────────────────────────

export async function find(
  collection: string,
  filter: object = {},
  options: { sort?: object; limit?: number; projection?: object } = {}
): Promise<any[]> {
  const endpoint = collectionToEndpoint(collection);
  const params   = new URLSearchParams();
  const f        = filter as any;

  // ── BUG FIX #4: _id.$in  →  ?ids=id1,id2,id3 ─────────────────────────────
  // ReportApprovalsPage calls find(SALES, { _id: { $in: [...] } }) to load the
  // exact sales that belong to a daily report.  The old code silently dropped
  // the $in filter, always returning [].  We now serialise it as a comma-
  // separated ?ids= param that the backend sales route understands.
  if (f._id?.$in) {
    const ids: string[] = (f._id.$in as any[]).map((v: any) =>
      typeof v === 'string' ? v : (v?.$oid ?? String(v))
    );
    if (ids.length > 0) params.set('ids', ids.join(','));
    // No other filters apply when fetching by explicit id list
    const qs   = params.toString();
    const data = await apiFetch(`${endpoint}${qs ? `?${qs}` : ''}`);
    if (Array.isArray(data)) return data;
    if (data?.sales) return data.sales;
    return [];
  }

    if (collection === Collections.WAREHOUSE_STOCK) {
    const warehouseId = (f as any).warehouseId;
    if (!warehouseId) return [];
    const data = await apiFetch(`/api/warehouses/${warehouseId}/stock`);
    return Array.isArray(data) ? data : [];
  }

  // ── Standard filters ──────────────────────────────────────────────────────
  if (f.isActive   !== undefined) params.set('active',    String(f.isActive));
  if (f.branchId)                 params.set('branchId',  f.branchId);
  if (f.status)                   params.set('status',    f.status);
  if (f.isCleared  !== undefined) params.set('isCleared', String(f.isCleared));

  // Date range (saleDate / expenseDate / reportDate)
  const dateField = f.saleDate ?? f.expenseDate ?? f.reportDate;
  if (dateField?.$gte) params.set('startDate', dateField.$gte);
  if (dateField?.$lte) params.set('endDate',   dateField.$lte);

  if (options.limit) params.set('limit', String(options.limit));

  const qs   = params.toString();
  const data = await apiFetch(`${endpoint}${qs ? `?${qs}` : ''}`);

  if (Array.isArray(data)) return data;
  if (data?.sales)         return data.sales;
  if (data?.reports)       return data.reports;
  return [];
}

export async function findOne(collection: string, filter: any): Promise<any> {
  const endpoint = collectionToEndpoint(collection);
  const id = filter?._id?.$oid ?? filter?._id ?? null;
  if (id) return apiFetch(`${endpoint}/${id}`);
  const list = await find(collection, filter);
  return list[0] ?? null;
}

export async function insertOne(collection: string, document: object): Promise<string> {
  const endpoint = collectionToEndpoint(collection);
  const result   = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(document) });
  return result?._id ?? result?.id ?? '';
}

export async function updateOne(
  collection: string,
  filter: any,
  update: any,
  _upsert = false
): Promise<number> {
  const endpoint = collectionToEndpoint(collection);
  const id       = filter?._id?.$oid ?? filter?._id ?? null;
  const payload  = update?.$set ?? update;

  // Special-case PATCH endpoints
  if (collection === Collections.DAILY_REPORTS && payload?.status) {
    await apiFetch(`/api/reports/daily/${id}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ status: payload.status, reviewNotes: payload.reviewNotes }),
    });
    return 1;
  }

  if (collection === Collections.DEBTORS) {
    if (payload?.isCleared === true)  { await apiFetch(`/api/reports/debtors/${id}/clear`,      { method: 'PATCH' }); return 1; }
    if (payload?.isCleared === false) { await apiFetch(`/api/reports/debtors/${id}/reactivate`, { method: 'PATCH' }); return 1; }
  }

  if (id) {
    if (collection === Collections.USERS && payload?.isActive !== undefined) {
      await apiFetch(`${endpoint}/${id}/toggle-active`, { method: 'PATCH' });
      return 1;
    }
    await apiFetch(`${endpoint}/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    return 1;
  }

  // Upsert-style stock endpoints
  if (collection === Collections.BRANCH_STOCK) {
    const { branchId, productId, quantity } = payload;
    await apiFetch(`/api/products/${productId}/stock`, {
      method: 'PUT', body: JSON.stringify({ branchId, quantity }),
    });
    return 1;
  }

  if (collection === Collections.WAREHOUSE_STOCK) {
    const { warehouseId, productId, quantity } = payload;
    await apiFetch(`/api/warehouses/${warehouseId}/stock`, {
      method: 'PUT', body: JSON.stringify({ productId, quantity }),
    });
    return 1;
  }

  return 0;
}

export async function deleteOne(collection: string, filter: any): Promise<number> {
  const endpoint = collectionToEndpoint(collection);
  const id       = filter?._id?.$oid ?? filter?._id ?? null;

  if (collection === Collections.WAREHOUSE_STOCK) {
    const { warehouseId, productId } = filter as any;
    if (warehouseId && productId) {
      await apiFetch(`/api/warehouses/stock/${warehouseId}/${productId}`, { method: 'DELETE' });
      return 1;
    }
  }

  await apiFetch(`${endpoint}/${id}`, { method: 'DELETE' });
  return 1;
}

export async function aggregate(
  _collection: string,
  _pipeline: object[]
): Promise<any[]> {
  // Aggregation runs server-side via /api/reports/analytics/dashboard
  return [];
}

// ─── Collection → endpoint mapping ───────────────────────────────────────────
export const Collections = {
  USERS:           'users',
  BRANCHES:        'branches',
  WAREHOUSES:      'warehouses',
  PRODUCTS:        'products',
  BRANCH_STOCK:    'branch_stock',
  WAREHOUSE_STOCK: 'warehouse_stock',
  SALES:           'sales',
  DAILY_REPORTS:   'daily_reports',
  DEBTORS:         'debtors',   // ← BUG FIX: was DEPTORS (missing B)
  EXPENSES:        'expenses',
} as const;

function collectionToEndpoint(collection: string): string {
  switch (collection) {
    case Collections.USERS:           return '/api/users';
    case Collections.BRANCHES:        return '/api/branches';
    case Collections.WAREHOUSES:      return '/api/warehouses';
    case Collections.PRODUCTS:        return '/api/products';
    case Collections.BRANCH_STOCK:    return '/api/branches/stock';
    case Collections.WAREHOUSE_STOCK: return '/api/warehouses/stock';
    case Collections.SALES:           return '/api/sales';
    case Collections.DAILY_REPORTS:   return '/api/reports/daily';
    case Collections.DEBTORS:         return '/api/reports/debtors';
    case Collections.EXPENSES:        return '/api/reports/expenses';
    default:                          return `/api/${collection}`;
  }
}
