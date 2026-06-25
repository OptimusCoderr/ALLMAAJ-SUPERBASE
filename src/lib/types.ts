/**
 * Domain types for MongoDB-backed BizTrack app.
 */

export interface MongoDoc {
  _id: string;
}

// ─── Users (created by admin only) ─────────────────────────────────────────────

export interface User extends MongoDoc {
  fullName: string;
  email: string;
  phone: string;
  role: 'admin' | 'staff';
  branchId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Branches & Warehouses ─────────────────────────────────────────────────────

export interface Branch extends MongoDoc {
  name: string;
  location: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Warehouse extends MongoDoc {
  name: string;
  location: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Products ──────────────────────────────────────────────────────────────────

export interface Product extends MongoDoc {
  name: string;
  sku?: string;
  description?: string;
  unitPrice: number;
  unit: string;
  category?: string;
  isActive: boolean;
  isCuttable?: boolean;
  inchesPerPiece?: number | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Stock ────────────────────────────────────────────────────────────────────

export interface BranchStock extends MongoDoc {
  branchId: string;
  productId: string;
  quantity: number;
  updatedAt: string;
  product?: Product;
}

export interface WarehouseStock extends MongoDoc {
  warehouseId: string;
  productId: string;
  quantity: number;
  updatedAt: string;
  product?: Product;
}

// ─── Sales ─────────────────────────────────────────────────────────────────────

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface Sale extends MongoDoc {
  branchId: string;
  staffId: string;
  staffName: string;
  customerName?: string;
  customerPhone?: string;
  paymentMethod: 'cash' | 'pos' | 'unpaid';
  totalAmount: number;
  notes?: string;
  items: SaleItem[];
  saleDate: string;
  createdAt: string;
  updatedAt: string;
  branchName?: string;
}

// ─── Debtors (unpaid customers) ────────────────────────────────────────────────

export interface Debtor extends MongoDoc {
  name: string;
  phone: string;
  amountOwed: number;
  branchId: string;
  createdBy: string;
  createdByName: string;
  saleId?: string;
  isCleared: boolean;
  clearedBy?: string;
  clearedByName?: string;
  clearedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  branchName?: string;
}

// ─── Expenses ──────────────────────────────────────────────────────────────────

export interface Expense extends MongoDoc {
  branchId: string;
  description: string;
  amount: number;
  category: string;
  recordedBy: string;
  recordedByName: string;
  expenseDate: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  branchName?: string;
}

// ─── Daily Report (submitted by staff, reviewed by admin) ───────────────────────

export interface DailyReport extends MongoDoc {
  branchId: string;
  submittedBy: string;
  submittedByName: string;
  reportDate: string;
  totalCashSales: number;
  totalPosSales: number;
  totalUnpaidSales: number;
  totalSales: number;
  totalExpenses: number;
  netIncome: number;
  debtorCount: number;
  totalDebtorAmount: number;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  saleIds: string[];
  expenseIds: string[];
  debtorIds: string[];
  createdAt: string;
  updatedAt: string;
  branchName?: string;
}
