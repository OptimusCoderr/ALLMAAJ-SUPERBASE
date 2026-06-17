// ─── Shared DB row types (snake_case, as returned by postgres.js) ─────────────
// Schema version: post-migration 002 (optimised)

export interface UserRow {
  id: string;
  email: string;
  password: string;
  full_name: string;
  phone: string | null;
  role: 'admin' | 'manager' | 'staff';
  branch_id: string | null;
  is_verified: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BranchRow {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WarehouseRow {
  id: string;
  name: string;
  location: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit_price: string;
  previous_price: string;
  current_price: string;
  unit: string;
  category: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Stock tables now use composite PK — no id column
export interface BranchStockRow {
  branch_id: string;
  product_id: string;
  quantity: string;
  updated_at: string;
}

export interface WarehouseStockRow {
  warehouse_id: string;
  product_id: string;
  quantity: string;
  updated_at: string;
}

// product_name removed from items — JOIN products on product_id
export interface SaleItemJson {
  product_id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface SaleRow {
  id: string;
  branch_id: string;
  staff_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  payment_method: 'cash' | 'pos' | 'unpaid';
  total_amount: string;
  notes: string | null;
  items: SaleItemJson[];
  sale_date: string;
  created_at: string;
  report_id: string | null;   // replaces daily_reports.sale_ids UUID[]
}

export interface DebtorRow {
  id: string;
  branch_id: string;
  name: string;
  phone: string;
  amount_owed: string;
  created_by: string;
  sale_id: string | null;
  is_cleared: boolean;
  cleared_by: string | null;
  cleared_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseRow {
  id: string;
  branch_id: string;
  description: string;
  amount: string;
  category: string;
  recorded_by: string;
  expense_date: string;
  notes: string | null;
  created_at: string;
}

export interface DailyReportRow {
  id: string;
  branch_id: string;
  submitted_by: string;
  report_date: string;
  total_cash_sales: string;
  total_pos_sales: string;
  total_unpaid_sales: string;
  total_sales: string;         // GENERATED ALWAYS AS (cash + pos + unpaid)
  total_expenses: string;
  net_income: string;
  debtor_count: number;        // SMALLINT
  total_debtor_amount: string;
  notes: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Convert NUMERIC string → number (postgres.js returns NUMERIC as string) */
export const num = (v: string | null | undefined): number =>
  v == null ? 0 : parseFloat(v);