import { useEffect, useState, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { find, Collections, getAuthToken } from '../lib/api';
import type { Branch, Product } from '../lib/types';
import {
  Search, Package, Plus, X, Check, Clock, CheckCircle, XCircle,
  RefreshCw, TrendingDown, AlertTriangle, DollarSign, ArrowUpDown,
  Pencil, Trash2, ArrowLeftRight,
} from 'lucide-react';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

function authFetch(path: string, token: string, options: RequestInit = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers as any) },
  }).then(async r => {
    const j = await r.json();
    if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`);
    return j?.data ?? j;
  });
}

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface StockItem { productId: string; product: any; quantity: number; updatedAt: string; }

// A cart line while building a request in the modal, before it's submitted
interface CartItem { productId: string; productName: string; productUnit: string; quantity: number; }

// A submitted request/transfer batch — one or more product line-items approved/rejected together
interface StockRequestItem {
  id: string; productId: string; productName: string; productUnit: string; quantity: number;
  status: string; approvedByName: string | null; approvedAt: string | null;
}
interface StockRequestBatch {
  batchId: string; branchId: string; branchName: string;
  fromBranchId: string | null; fromBranchName: string | null;
  sourceType: 'warehouse' | 'others' | 'branch' | null;
  warehouseId: string | null; warehouseName: string | null;
  requestedBy: string; requestedByName: string;
  notes: string | null; status: string; // 'pending' | 'approved' | 'rejected' | 'mixed'
  createdAt: string;
  items: StockRequestItem[];
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === 'approved' || status === 'accepted') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
        <CheckCircle className="w-3.5 h-3.5" />Approved
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
        <XCircle className="w-3.5 h-3.5" />Rejected
      </span>
    );
  }
  if (status === 'mixed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-200 text-slate-700">
        Mixed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
      <Clock className="w-3.5 h-3.5" />Pending
    </span>
  );
}

function QtyBadge({ qty }: { qty: number }) {
  const cls =
    qty <= 5  ? 'bg-red-100 text-red-700' :
    qty <= 20 ? 'bg-amber-100 text-amber-700' :
                'bg-green-100 text-green-700';
  return (
    <span className={`inline-flex items-center justify-center min-w-[2.5rem] px-2 py-0.5 rounded-full text-xs font-bold ${cls}`}>
      {qty.toLocaleString()}
    </span>
  );
}

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return <span className={`${className} border-2 border-current border-t-transparent rounded-full animate-spin`} />;
}

interface ProductSearchProps {
  products: Product[];
  stockMap: Map<string, number>;
  value: string;
  selectedId: string;
  category: string;
  suggestions: Product[];
  showDropdown: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  accentColor?: 'amber' | 'blue';
  onSearchChange: (v: string) => void;
  onCategoryChange: (cat: string) => void;
  onSelect: (p: Product) => void;
  onClearSearch: () => void;
  onDropdownShow: (show: boolean) => void;
}

function ProductSearch({
  products, stockMap, value, selectedId, category, suggestions, showDropdown,
  inputRef, accentColor = 'amber',
  onSearchChange, onCategoryChange, onSelect, onClearSearch, onDropdownShow,
}: ProductSearchProps) {
  const accent = accentColor === 'blue' ? {
    pill: 'bg-blue-500 text-white border-blue-500',
    pillOff: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
    input: 'border-blue-400 bg-blue-50/30',
    ring: 'focus:ring-blue-500',
    hover: 'hover:bg-blue-50',
    catText: 'text-blue-600',
  } : {
    pill: 'bg-amber-500 text-white border-amber-500',
    pillOff: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
    input: 'border-amber-400 bg-amber-50/30',
    ring: 'focus:ring-amber-500',
    hover: 'hover:bg-amber-50',
    catText: 'text-amber-600',
  };

  const categories = useMemo(() =>
    ['all', ...Array.from(new Set(products.filter(p => p.category).map(p => p.category as string))).sort()],
    [products]
  );

  return (
    <div>
      {categories.length > 2 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {categories.map(cat => (
            <button key={cat} type="button" onClick={() => onCategoryChange(cat)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                category === cat ? accent.pill : accent.pillOff
              }`}>
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => onSearchChange(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) onDropdownShow(true); }}
          onBlur={() => setTimeout(() => onDropdownShow(false), 150)}
          placeholder="Type to search products..."
          className={`w-full pl-9 pr-9 py-2.5 border rounded-lg text-slate-800 text-sm focus:outline-none focus:ring-2 ${accent.ring} ${
            selectedId ? accent.input : 'border-slate-200'
          }`}
        />
        {value && (
          <button type="button" onClick={() => { onClearSearch(); inputRef.current?.focus(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        )}
        {showDropdown && suggestions.length > 0 && (
          <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
            {suggestions.map(p => {
              const qty = stockMap.get(p._id) ?? null;
              return (
                <button key={p._id} type="button" onMouseDown={() => onSelect(p)}
                  className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 border-b border-slate-100 last:border-0 ${accent.hover} transition-colors`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                    {p.category && <p className={`text-xs font-medium ${accent.catText}`}>{p.category}</p>}
                  </div>
                  {qty !== null ? (
                    <span className={`text-xs font-semibold shrink-0 ${qty <= 5 ? 'text-red-500' : qty <= 20 ? 'text-amber-500' : 'text-green-600'}`}>
                      {qty} in stock
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400 shrink-0">{p.unit}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {showDropdown && value.trim() && suggestions.length === 0 && (
          <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3 text-center text-sm text-slate-400">
            No products found for "{value}"
          </div>
        )}
      </div>
      {selectedId && (
        <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
          <Check className="w-3 h-3" />{products.find(p => p._id === selectedId)?.name} selected
        </p>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] sm:max-w-md p-4 sm:p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function BranchStockPage() {
  const { user } = useAuth();
  const toast    = useToast();
  const confirm  = useConfirm();
  const token = getAuthToken() ?? '';
  const isAdmin = user?.role?.toLowerCase() === 'admin';

  // ── Data state ───────────────────────────────────────────────────────────────
  const [branches, setBranches]     = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState(user?.branchId || '');
  const [stock, setStock]           = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [products, setProducts]     = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [requests, setRequests]     = useState<StockRequestBatch[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [myRequests, setMyRequests] = useState<StockRequestBatch[]>([]);
  const [myRequestsLoading, setMyRequestsLoading] = useState(false);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [tab, setTab]               = useState<'stock' | 'requests' | 'my-requests'>('stock');

  // Stock table filters
  const [tableSearch, setTableSearch]     = useState('');
  const [tableCategory, setTableCategory] = useState('all');
  const [showLowOnly, setShowLowOnly]     = useState(false);
  const [sortBy, setSortBy]               = useState<'name' | 'quantity' | 'price' | 'updated'>('name');
  const [sortDir, setSortDir]             = useState<'asc' | 'desc'>('asc');

  // Requests filter
  const [requestsBranchFilter, setRequestsBranchFilter] = useState('');

  // ── Modal state ──────────────────────────────────────────────────────────────

  // Request Stock modal
  const [showReqModal, setShowReqModal]   = useState(false);
  const [reqMode, setReqMode]             = useState<'restock' | 'transfer'>('restock');
  const [reqProductId, setReqProductId]   = useState('');
  const [reqQty, setReqQty]               = useState(1);
  const [reqNotes, setReqNotes]           = useState('');
  const [reqSaving, setReqSaving]         = useState(false);
  const [reqError, setReqError]           = useState('');
  const [reqSearch, setReqSearch]         = useState('');
  const [reqCategory, setReqCategory]     = useState('all');
  const [reqSuggestions, setReqSuggestions] = useState<Product[]>([]);
  const [showReqDropdown, setShowReqDropdown] = useState(false);
  const reqInputRef = useRef<HTMLInputElement>(null);
  const [reqFromBranchId, setReqFromBranchId] = useState('');
  const [reqFromBranchStock, setReqFromBranchStock] = useState<StockItem[]>([]);
  const [reqFromBranchStockLoading, setReqFromBranchStockLoading] = useState(false);
  const [reqItems, setReqItems]           = useState<CartItem[]>([]);

  // Add Stock modal (admin)
  const [showAddModal, setShowAddModal]   = useState(false);
  const [addProductId, setAddProductId]   = useState('');
  const [addQty, setAddQty]               = useState(1);
  const [addInputMode, setAddInputMode]   = useState<'pieces' | 'inches'>('pieces');
  const [addInches, setAddInches]         = useState(0);
  const [addSourceType, setAddSourceType] = useState('warehouse');
  const [addWarehouseId, setAddWarehouseId] = useState('');
  const [addSaving, setAddSaving]         = useState(false);
  const [addError, setAddError]           = useState('');
  const [addSearch, setAddSearch]         = useState('');
  const [addCategory, setAddCategory]     = useState('all');
  const [addSuggestions, setAddSuggestions] = useState<Product[]>([]);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  // Edit Stock modal (admin)
  const [editingStock, setEditingStock]   = useState<StockItem | null>(null);
  const [editQty, setEditQty]             = useState(0);
  const [editSaving, setEditSaving]       = useState(false);
  const [editError, setEditError]         = useState('');

  // Approve modal (admin)
  // item === null means "approve/reject every pending item in the batch at once";
  // a specific item means a single line-item is being actioned on its own —
  // useful since different materials can come from different warehouses.
  const [approving, setApproving]         = useState<{ batch: StockRequestBatch; item: StockRequestItem | null } | null>(null);
  const [approveSourceType, setApproveSourceType] = useState('warehouse');
  const [approveWarehouseId, setApproveWarehouseId] = useState('');
  const [approveSaving, setApproveSaving] = useState(false);
  const [approveError, setApproveError]   = useState('');

  // ── Derived / memoised ───────────────────────────────────────────────────────

  const addSelectedProduct = useMemo(
    () => (addProductId ? products.find(p => p._id === addProductId) ?? null : null),
    [products, addProductId]
  );

  const stockMap = useMemo<Map<string, number>>(
    () => new Map(stock.map(s => [s.productId, s.quantity])),
    [stock]
  );

  const reqFromBranchStockMap = useMemo<Map<string, number>>(
    () => new Map(reqFromBranchStock.map(s => [s.productId, s.quantity])),
    [reqFromBranchStock]
  );

  const reqDestinationBranchId = isAdmin ? selectedBranch : (user?.branchId || '');
  const transferBranchOptions = branches.filter(b => b._id !== reqDestinationBranchId);

  const tableCategories = useMemo(() => {
    const counts = new Map<string, number>();
    stock.forEach(s => {
      const cat = s.product?.category || 'Uncategorised';
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [stock]);

  const filtered = useMemo(() => {
    let items = stock.filter(s => {
      const q = tableSearch.toLowerCase();
      if (tableCategory !== 'all') {
        const cat = s.product?.category || 'Uncategorised';
        if (cat !== tableCategory) return false;
      }
      if (showLowOnly && s.quantity > 20) return false;
      if (q && !s.product?.name?.toLowerCase().includes(q) && !(s.product?.category || '').toLowerCase().includes(q)) return false;
      return true;
    });
    return [...items].sort((a, b) => {
      let cmp = 0;
      if      (sortBy === 'name')     cmp = (a.product?.name || '').localeCompare(b.product?.name || '');
      else if (sortBy === 'quantity') cmp = a.quantity - b.quantity;
      else if (sortBy === 'price')    cmp = (a.product?.unitPrice || 0) - (b.product?.unitPrice || 0);
      else if (sortBy === 'updated')  cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [stock, tableSearch, tableCategory, showLowOnly, sortBy, sortDir]);

  const requestBranches = useMemo(() => {
    const map = new Map<string, string>();
    requests.forEach(r => map.set(r.branchId, r.branchName));
    return Array.from(map.entries());
  }, [requests]);

  const filteredRequests = requestsBranchFilter
    ? requests.filter(r => r.branchId === requestsBranchFilter)
    : requests;

  const pendingMyRequests = myRequests.filter(r => r.items.some(i => i.status === 'pending')).length;
  const branchName = branches.find(b => b._id === selectedBranch)?.name || '';
  const critical   = stock.filter(s => s.quantity <= 5).length;
  const low        = stock.filter(s => s.quantity > 5 && s.quantity <= 20).length;
  const totalValue = stock.reduce((sum, s) => sum + s.quantity * (s.product?.unitPrice || 0), 0);
  const fmt        = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
  const hasTableFilters = tableSearch || tableCategory !== 'all' || showLowOnly;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function toggleSort(col: typeof sortBy) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }

  function clearTableFilters() {
    setTableSearch(''); setTableCategory('all'); setShowLowOnly(false);
  }

  function getProductMatches(search: string, category: string): Product[] {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    const base = category !== 'all' ? products.filter(p => p.category === category) : products;
    return base.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.sku ?? '').toLowerCase().includes(q) ||
      (p.category ?? '').toLowerCase().includes(q)
    );
  }

  // Request form search
  function handleReqSearchChange(v: string) {
    setReqSearch(v); setReqProductId('');
    let m = v.trim() ? getProductMatches(v, reqCategory) : [];
    if (reqMode === 'transfer') m = m.filter(p => reqFromBranchStockMap.has(p._id));
    setReqSuggestions(m); setShowReqDropdown(v.trim().length > 0);
  }
  function handleReqCategoryChange(cat: string) {
    setReqCategory(cat); setReqSearch(''); setReqProductId('');
    setReqSuggestions([]); setShowReqDropdown(false);
  }
  function selectReqProduct(p: Product) {
    setReqProductId(p._id); setReqSearch(p.name);
    setReqSuggestions([]); setShowReqDropdown(false);
  }
  function resetReqSearch() {
    setReqSearch(''); setReqCategory('all'); setReqProductId(''); setReqQty(1);
    setReqSuggestions([]); setShowReqDropdown(false);
    setReqMode('restock'); setReqFromBranchId(''); setReqFromBranchStock([]);
    setReqItems([]);
  }

  function handleReqModeChange(mode: 'restock' | 'transfer') {
    setReqMode(mode); setReqFromBranchId(''); setReqFromBranchStock([]);
    setReqSearch(''); setReqProductId(''); setReqCategory('all'); setReqQty(1);
    setReqSuggestions([]); setShowReqDropdown(false);
    setReqItems([]);
  }

  async function handleReqFromBranchChange(branchId: string) {
    setReqFromBranchId(branchId);
    setReqSearch(''); setReqProductId(''); setReqSuggestions([]); setShowReqDropdown(false);
    setReqItems([]);
    if (!branchId) { setReqFromBranchStock([]); return; }
    setReqFromBranchStockLoading(true);
    try {
      const data = await authFetch(`/api/branches/${branchId}/stock`, token);
      const rows = Array.isArray(data) ? data : [];
      setReqFromBranchStock(rows.map((s: any) => ({
        productId: s.product_id, quantity: Number(s.quantity), updatedAt: s.updated_at,
        product: s.product ? { _id: s.product.id, id: s.product.id, name: s.product.name, unit: s.product.unit, category: s.product.category } : undefined,
      })).filter((s: any) => s.product));
    } catch {}
    setReqFromBranchStockLoading(false);
  }

  // Cart helpers for the multi-item Request Stock modal
  function addReqItem() {
    if (!reqProductId) { setReqError('Select a product first'); return; }
    if (!reqQty || reqQty <= 0) { setReqError('Enter a valid quantity'); return; }
    if (reqItems.some(i => i.productId === reqProductId)) {
      setReqError('That product is already in the list — remove it first to change the quantity');
      return;
    }
    if (reqMode === 'transfer') {
      const available = reqFromBranchStockMap.get(reqProductId) ?? 0;
      if (reqQty > available) { setReqError(`Only ${available} available at the source branch`); return; }
    }
    const pool = reqMode === 'transfer' ? reqFromBranchStock.map(s => s.product).filter(Boolean) : products;
    const product = pool.find((p: any) => p._id === reqProductId);
    if (!product) return;
    setReqItems(items => [...items, { productId: reqProductId, productName: product.name, productUnit: product.unit, quantity: reqQty }]);
    setReqError('');
    setReqSearch(''); setReqProductId(''); setReqQty(1); setReqSuggestions([]); setShowReqDropdown(false);
  }

  function removeReqItem(productId: string) {
    setReqItems(items => items.filter(i => i.productId !== productId));
  }

  // Add form search
  function handleAddSearchChange(v: string) {
    setAddSearch(v); setAddProductId('');
    const m = v.trim() ? getProductMatches(v, addCategory) : [];
    setAddSuggestions(m); setShowAddDropdown(v.trim().length > 0);
  }
  function handleAddCategoryChange(cat: string) {
    setAddCategory(cat); setAddSearch(''); setAddProductId('');
    setAddSuggestions([]); setShowAddDropdown(false);
  }
  function selectAddProduct(p: Product) {
    setAddProductId(p._id); setAddSearch(p.name);
    setAddInputMode('pieces'); setAddInches(0);
    setAddSuggestions([]); setShowAddDropdown(false);
  }
  function resetAddSearch() {
    setAddSearch(''); setAddCategory('all'); setAddProductId('');
    setAddInputMode('pieces'); setAddInches(0);
    setAddSuggestions([]); setShowAddDropdown(false);
  }

  // ── Data fetching ────────────────────────────────────────────────────────────

  useEffect(() => {
    find(Collections.BRANCHES, { isActive: true }, { sort: { name: 1 } }).then(data => {
      setBranches(data as Branch[]);
      if (!selectedBranch && isAdmin && data[0]) setSelectedBranch((data[0] as Branch)._id);
    });
    find(Collections.PRODUCTS, { isActive: true }).then(d => setProducts(d as Product[]));
  }, []);

  useEffect(() => {
    if (!user) return;
    if (isAdmin) { find(Collections.WAREHOUSES, {}).then(d => setWarehouses(d)); fetchRequests(); }
    else fetchMyRequests();
  }, [user?.role]);

  useEffect(() => { if (selectedBranch) fetchStock(); }, [selectedBranch]);

  async function fetchStock() {
    setStockLoading(true);
    try {
      const data = await authFetch(`/api/branches/${selectedBranch}/stock`, token);
      const rows = Array.isArray(data) ? data : [];
      setStock(rows.map((s: any) => ({
        productId: s.product_id,
        quantity:  Number(s.quantity),
        updatedAt: s.updated_at,
        product: s.product ? {
          _id: s.product.id, id: s.product.id,
          name: s.product.name, unit: s.product.unit,
          category: s.product.category,
          unitPrice: parseFloat(s.product.unit_price ?? s.product.current_price ?? 0),
          isCuttable: s.product.is_cuttable ?? false,
          unitLengthInches: s.product.unit_length_inches != null ? parseFloat(s.product.unit_length_inches) : null,
        } : undefined,
      })).filter((s: any) => s.product));
    } catch {}
    setStockLoading(false);
  }

  async function fetchRequests() {
    setRequestsLoading(true);
    try {
      const data = await authFetch('/api/branches/stock-requests?status=pending', token);
      setRequests(Array.isArray(data) ? data : []);
    } catch {}
    setRequestsLoading(false);
  }

  async function fetchMyRequests() {
    setMyRequestsLoading(true);
    try {
      const data = await authFetch('/api/branches/stock-requests/mine', token);
      setMyRequests(Array.isArray(data) ? data : []);
    } catch {}
    setMyRequestsLoading(false);
  }

  // ── Action handlers ──────────────────────────────────────────────────────────

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    // Fold in whatever's currently in the product/qty fields as one last item,
    // so a single-product request doesn't require clicking "Add Item" first.
    const items = [...reqItems];
    if (reqProductId) {
      if (items.some(i => i.productId === reqProductId)) { setReqError('That product is already in the list'); return; }
      if (!reqQty || reqQty <= 0) { setReqError('Enter a valid quantity'); return; }
      if (reqMode === 'transfer') {
        const available = reqFromBranchStockMap.get(reqProductId) ?? 0;
        if (reqQty > available) { setReqError(`Only ${available} available at the source branch`); return; }
      }
      const pool = reqMode === 'transfer' ? reqFromBranchStock.map(s => s.product).filter(Boolean) : products;
      const product = pool.find((p: any) => p._id === reqProductId);
      if (product) items.push({ productId: reqProductId, productName: product.name, productUnit: product.unit, quantity: reqQty });
    }
    if (items.length === 0) { setReqError('Add at least one product'); return; }
    if (reqMode === 'transfer' && !reqFromBranchId) { setReqError('Select a branch to transfer from'); return; }

    setReqSaving(true); setReqError('');
    try {
      await authFetch('/api/branches/stock-requests', token, {
        method: 'POST',
        body: JSON.stringify({
          branchId: selectedBranch, notes: reqNotes,
          fromBranchId: reqMode === 'transfer' ? reqFromBranchId : undefined,
          items: items.map(i => ({ productId: i.productId, quantity: i.quantity })),
        }),
      });
      setShowReqModal(false);
      setReqNotes(''); resetReqSearch();
      fetchMyRequests(); setTab('my-requests');
      const itemWord = items.length === 1 ? 'item' : 'items';
      toast.success(reqMode === 'transfer'
        ? `Transfer request submitted (${items.length} ${itemWord})`
        : `Stock request submitted (${items.length} ${itemWord})`);
    } catch (err: any) { setReqError(err.message || 'Failed to submit'); }
    setReqSaving(false);
  }

  async function submitDirectAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addProductId) { setAddError('Select a product'); return; }
    if (addSourceType === 'warehouse' && !addWarehouseId) { setAddError('Select a warehouse'); return; }

    let finalQty = addQty;
    if (addInputMode === 'inches' && addSelectedProduct?.isCuttable && addSelectedProduct?.unitLengthInches) {
      if (!addInches || addInches <= 0) { setAddError('Enter a valid length in inches'); return; }
      finalQty = addInches / addSelectedProduct.unitLengthInches;
    }

    setAddSaving(true); setAddError('');
    try {
      await authFetch(`/api/branches/${selectedBranch}/stock/add`, token, {
        method: 'POST',
        body: JSON.stringify({ productId: addProductId, quantity: finalQty, sourceType: addSourceType, warehouseId: addWarehouseId || undefined }),
      });
      setShowAddModal(false);
      setAddQty(1); setAddSourceType('warehouse'); setAddWarehouseId(''); resetAddSearch();
      fetchStock(); toast.success('Stock added successfully');
    } catch (err: any) { setAddError(err.message || 'Failed to add stock'); }
    setAddSaving(false);
  }

  async function submitEditStock(e: React.FormEvent) {
    e.preventDefault();
    if (!editingStock) return;
    setEditSaving(true); setEditError('');
    try {
      await authFetch(`/api/branches/${selectedBranch}/stock/${editingStock.productId}`, token, {
        method: 'PUT',
        body: JSON.stringify({ quantity: editQty }),
      });
      setEditingStock(null); fetchStock(); toast.success('Stock quantity updated');
    } catch (err: any) { setEditError(err.message || 'Failed to update stock'); }
    setEditSaving(false);
  }

  async function deleteStockItem(item: StockItem) {
    if (!await confirm({ title: 'Remove Stock', message: `Remove "${item.product?.name}" from ${branchName} stock? This cannot be undone.`, confirmText: 'Remove', danger: true })) return;
    try {
      await authFetch(`/api/branches/${selectedBranch}/stock/${item.productId}`, token, { method: 'DELETE' });
      fetchStock(); toast.info(`Removed ${item.product?.name} from stock`);
    } catch (err: any) { toast.error(err.message || 'Failed to remove stock item'); }
  }

  async function approveRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!approving) return;
    const { batch, item } = approving;
    const isTransfer = batch.sourceType === 'branch';
    if (!isTransfer && approveSourceType === 'warehouse' && !approveWarehouseId) { setApproveError('Select a warehouse'); return; }
    setApproveSaving(true); setApproveError('');
    try {
      const url = item
        ? `/api/branches/stock-requests/item/${item.id}/approve`
        : `/api/branches/stock-requests/${batch.batchId}/approve`;
      await authFetch(url, token, {
        method: 'PATCH',
        body: JSON.stringify(isTransfer ? {} : { sourceType: approveSourceType, warehouseId: approveWarehouseId || null }),
      });
      const count = item ? 1 : batch.items.length;
      setApproving(null);
      fetchRequests();
      if (batch.branchId === selectedBranch || batch.fromBranchId === selectedBranch) fetchStock();
      toast.success(`Approved ${count} item${count !== 1 ? 's' : ''}`);
    } catch (err: any) { setApproveError(err.message || 'Failed to approve'); }
    setApproveSaving(false);
  }

  async function rejectRequest(batch: StockRequestBatch, item?: StockRequestItem) {
    const count = item ? 1 : batch.items.length;
    const label = item ? `"${item.productName}"` : `this request (${count} item${count !== 1 ? 's' : ''})`;
    if (!await confirm({ title: 'Reject Request', message: `Reject ${label} at ${batch.branchName}?`, confirmText: 'Reject', danger: true })) return;
    try {
      const url = item
        ? `/api/branches/stock-requests/item/${item.id}/reject`
        : `/api/branches/stock-requests/${batch.batchId}/reject`;
      await authFetch(url, token, { method: 'PATCH' });
      fetchRequests(); toast.error(`Rejected ${count} item${count !== 1 ? 's' : ''}`);
    } catch (err: any) { toast.error(err.message || 'Failed to reject'); }
  }

  function displayCuttableQty(qty: number, unitLengthInches: number): string {
    const fullPieces = Math.floor(qty);
    const remnantInches = +(((qty - fullPieces) * unitLengthInches).toFixed(1));
    if (remnantInches < 0.1) return `${fullPieces} ${fullPieces === 1 ? 'pc' : 'pcs'}`;
    const ft = Math.floor(remnantInches / 12);
    const inRem = +(remnantInches % 12).toFixed(1);
    let remnantStr: string;
    if (ft === 0) remnantStr = `${remnantInches}"`;
    else if (inRem < 0.1) remnantStr = `${ft}ft`;
    else remnantStr = `${ft}ft ${inRem}"`;
    if (fullPieces === 0) return remnantStr;
    return `${fullPieces} pcs + ${remnantStr}`;
  }

  // ── Sort icon helper ─────────────────────────────────────────────────────────

  function SortIcon({ col }: { col: typeof sortBy }) {
    return (
      <ArrowUpDown className={`w-3 h-3 inline ml-1 ${sortBy === col ? 'text-amber-500' : 'text-slate-300'}`} />
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Branch Stock</h1>
          <p className="text-slate-500 text-sm mt-0.5">Inventory at each branch</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {isAdmin && (
            <button
              onClick={() => { setShowAddModal(true); setAddError(''); resetAddSearch(); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium text-sm transition-colors">
              <Plus className="w-4 h-4" /><span className="hidden sm:inline">Add Stock</span>
            </button>
          )}
          <button
            onClick={() => { setShowReqModal(true); setReqError(''); resetReqSearch(); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
            <Plus className="w-4 h-4" /><span className="hidden sm:inline">{isAdmin ? 'Add Request' : 'Request Stock'}</span>
          </button>
        </div>
      </div>

      {/* Stats cards */}
      {stock.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {[
            { icon: <Package className="w-5 h-5 text-blue-500" />, bg: 'bg-blue-50', label: 'Total Products', value: stock.length, color: '' },
            { icon: <AlertTriangle className="w-5 h-5 text-red-500" />, bg: 'bg-red-50', label: 'Critical (≤5)', value: critical, color: critical > 0 ? 'text-red-600' : '' },
            { icon: <TrendingDown className="w-5 h-5 text-amber-500" />, bg: 'bg-amber-50', label: 'Low Stock (6–20)', value: low, color: low > 0 ? 'text-amber-600' : '' },
            { icon: <DollarSign className="w-5 h-5 text-green-500" />, bg: 'bg-green-50', label: 'Total Value', value: fmt(totalValue), color: '', small: true },
          ].map(({ icon, bg, label, value, color, small }) => (
            <div key={label} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center shrink-0`}>{icon}</div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">{label}</p>
                <p className={`font-bold text-slate-800 leading-tight ${small ? 'text-sm' : 'text-xl'} ${color}`}>{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200">
        <button onClick={() => setTab('stock')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'stock' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          Stock
        </button>
        {isAdmin && (
          <button onClick={() => { setTab('requests'); fetchRequests(); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${tab === 'requests' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            Pending Requests
            {requests.length > 0 && (
              <span className="bg-amber-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">{requests.length}</span>
            )}
          </button>
        )}
        {!isAdmin && (
          <button onClick={() => { setTab('my-requests'); fetchMyRequests(); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${tab === 'my-requests' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            My Requests
            {pendingMyRequests > 0 && (
              <span className="bg-amber-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">{pendingMyRequests}</span>
            )}
          </button>
        )}
      </div>

      {/* ── Stock Tab ── */}
      {tab === 'stock' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          {/* Controls bar */}
          <div className="p-4 sm:p-6 border-b border-slate-100 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              {isAdmin ? (
                <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
                  className="px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm">
                  {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                </select>
              ) : (
                <div className="px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 bg-slate-50 text-sm">
                  {branchName || 'Your Branch'}
                </div>
              )}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="text" value={tableSearch} onChange={e => setTableSearch(e.target.value)}
                  placeholder="Search products or category..."
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm" />
              </div>
              <button onClick={() => setShowLowOnly(v => !v)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${showLowOnly ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-200 text-slate-600 hover:border-amber-300 hover:text-amber-600'}`}>
                <AlertTriangle className="w-4 h-4" />Low Stock
              </button>
            </div>

            {/* Category pills for stock table */}
            {tableCategories.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => setTableCategory('all')}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${tableCategory === 'all' ? 'bg-slate-700 text-white border-slate-700' : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'}`}>
                  All ({stock.length})
                </button>
                {tableCategories.map(([cat, count]) => (
                  <button key={cat} onClick={() => setTableCategory(cat)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${tableCategory === cat ? 'bg-amber-500 text-white border-amber-500' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'}`}>
                    {cat} ({count})
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Table header metadata */}
          {branchName && !stockLoading && stock.length > 0 && (
            <div className="px-4 sm:px-6 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Package className="w-4 h-4 text-amber-500" />
                <span className="font-medium">{branchName}</span>
                {hasTableFilters && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span>Showing {filtered.length} of {stock.length}</span>
                    <button onClick={clearTableFilters} className="text-amber-500 hover:text-amber-600 text-xs underline underline-offset-2">
                      Clear filters
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Critical ≤5</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />Low ≤20</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />OK &gt;20</span>
              </div>
            </div>
          )}

          {/* Table body */}
          <div className="px-4 sm:px-6 pb-6">
            {stockLoading ? (
              <div className="py-8 space-y-2">
                {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="font-medium">{hasTableFilters ? 'No products match your filters' : 'No stock records found'}</p>
                {hasTableFilters && (
                  <button onClick={clearTableFilters} className="mt-2 text-amber-500 text-sm hover:underline">Clear filters</button>
                )}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b border-slate-200">
                        <th className="pb-3 pt-4 font-medium text-slate-600 cursor-pointer select-none hover:text-slate-800 whitespace-nowrap"
                          onClick={() => toggleSort('name')}>
                          Product<SortIcon col="name" />
                        </th>
                        <th className="pb-3 pt-4 font-medium text-slate-600 hidden md:table-cell">Category</th>
                        <th className="pb-3 pt-4 font-medium text-slate-600 hidden sm:table-cell">Unit</th>
                        <th className="pb-3 pt-4 font-medium text-slate-600 text-right cursor-pointer select-none hover:text-slate-800 whitespace-nowrap"
                          onClick={() => toggleSort('quantity')}>
                          Qty<SortIcon col="quantity" />
                        </th>
                        <th className="pb-3 pt-4 font-medium text-slate-600 text-right cursor-pointer select-none hover:text-slate-800 hidden lg:table-cell whitespace-nowrap"
                          onClick={() => toggleSort('price')}>
                          Price<SortIcon col="price" />
                        </th>
                        <th className="pb-3 pt-4 font-medium text-slate-600 cursor-pointer select-none hover:text-slate-800 hidden lg:table-cell whitespace-nowrap"
                          onClick={() => toggleSort('updated')}>
                          Updated<SortIcon col="updated" />
                        </th>
                        {isAdmin && <th className="pb-3 pt-4 font-medium text-slate-600 text-right w-20">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filtered.map(item => (
                        <tr key={item.productId} className="group hover:bg-slate-50 transition-colors">
                          <td className="py-3 font-medium text-slate-800 pr-4">{item.product?.name}</td>
                          <td className="py-3 text-slate-500 hidden md:table-cell pr-4">{item.product?.category || '–'}</td>
                          <td className="py-3 text-slate-500 hidden sm:table-cell pr-4">{item.product?.unit}</td>
                          <td className="py-3 text-right pr-4">
                            {(item.product as any)?.isCuttable && (item.product as any)?.unitLengthInches
                              ? (
                                <div>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                                    {displayCuttableQty(item.quantity, (item.product as any).unitLengthInches)}
                                  </span>
                                  <div className="text-xs text-amber-600 mt-0.5">each = {(item.product as any).unitLengthInches}"</div>
                                </div>
                              )
                              : (
                                <QtyBadge qty={item.quantity} />
                              )
                            }
                            <div className="text-xs text-slate-500 mt-0.5">{fmt(item.product?.unitPrice || 0)}</div>
                          </td>
                          <td className="py-3 text-right text-slate-600 hidden lg:table-cell pr-4">{fmt(item.product?.unitPrice || 0)}</td>
                          <td className="py-3 text-slate-400 text-xs hidden lg:table-cell pr-4"
                            title={new Date(item.updatedAt).toLocaleString()}>
                            {relativeTime(item.updatedAt)}
                          </td>
                          {isAdmin && (
                            <td className="py-3 text-right">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => { setEditingStock(item); setEditQty(item.quantity); setEditError(''); }}
                                  title="Edit quantity"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => deleteStockItem(item)}
                                  title="Remove from stock"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hasTableFilters && filtered.length !== stock.length && (
                  <p className="text-xs text-slate-400 text-center mt-4">
                    Showing {filtered.length} of {stock.length} products
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Admin: Pending Requests Tab ── */}
      {tab === 'requests' && isAdmin && (
        <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <h3 className="font-semibold text-slate-700">Pending Stock Requests</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {filteredRequests.length} request{filteredRequests.length !== 1 ? 's' : ''}
                {requestBranches.length > 1 ? ` from ${requestBranches.length} branches` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {requestBranches.length > 1 && (
                <select value={requestsBranchFilter} onChange={e => setRequestsBranchFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500">
                  <option value="">All branches</option>
                  {requestBranches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              )}
              <button onClick={fetchRequests} disabled={requestsLoading}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
                <RefreshCw className={`w-4 h-4 ${requestsLoading ? 'animate-spin' : ''}`} />Refresh
              </button>
            </div>
          </div>

          {requestsLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>{requestsBranchFilter ? 'No pending requests for this branch' : 'No pending requests'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRequests.map(req => (
                <div key={req.batchId} className={`border border-slate-200 border-l-4 rounded-xl p-4 flex flex-col sm:flex-row sm:items-start gap-4 ${req.sourceType === 'branch' ? 'border-l-blue-400' : 'border-l-amber-400'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                        {req.items.length} item{req.items.length !== 1 ? 's' : ''}
                      </span>
                      {req.sourceType === 'branch' && (
                        <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                          <ArrowLeftRight className="w-3 h-3" />Transfer
                        </span>
                      )}
                      <StatusBadge status={req.status} />
                    </div>
                    {req.sourceType === 'branch' ? (
                      <p className="text-sm text-slate-500 mb-1.5">
                        <span className="font-medium text-slate-700">{req.fromBranchName}</span>
                        {' → '}
                        <span className="font-medium text-slate-700">{req.branchName}</span>
                      </p>
                    ) : (
                      <p className="text-sm text-slate-500 mb-1.5">Branch: <span className="font-medium text-slate-700">{req.branchName}</span></p>
                    )}
                    <div className="space-y-1 mb-1.5">
                      {req.items.map(item => (
                        <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-slate-800 truncate">{item.productName}</span>
                            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full shrink-0">{item.quantity} {item.productUnit}</span>
                          </div>
                          {req.items.length > 1 && (
                            <div className="flex gap-1 shrink-0">
                              <button
                                onClick={() => { setApproving({ batch: req, item }); setApproveSourceType('warehouse'); setApproveWarehouseId(''); setApproveError(''); }}
                                title="Approve this item"
                                className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors">
                                <CheckCircle className="w-4 h-4" />
                              </button>
                              <button onClick={() => rejectRequest(req, item)}
                                title="Reject this item"
                                className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors">
                                <XCircle className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-sm text-slate-500">
                      By <span className="font-medium text-slate-700">{req.requestedByName}</span>
                      {' · '}
                      <span title={new Date(req.createdAt).toLocaleString()}>{relativeTime(req.createdAt)}</span>
                    </p>
                    {req.notes && <p className="text-xs text-slate-400 mt-1 italic">"{req.notes}"</p>}
                    {req.items.length > 1 && (
                      <p className="text-xs text-slate-400 mt-1">Different items can be approved individually from different warehouses using the icons above.</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => { setApproving({ batch: req, item: null }); setApproveSourceType('warehouse'); setApproveWarehouseId(''); setApproveError(''); }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors">
                      <CheckCircle className="w-4 h-4" />{req.items.length > 1 ? 'Approve All' : 'Approve'}
                    </button>
                    <button onClick={() => rejectRequest(req)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-sm font-medium transition-colors">
                      <XCircle className="w-4 h-4" />{req.items.length > 1 ? 'Reject All' : 'Reject'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Staff: My Requests Tab ── */}
      {tab === 'my-requests' && !isAdmin && (
        <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-slate-700">My Stock Requests</h3>
              <p className="text-xs text-slate-400 mt-0.5">{myRequests.length} total · {pendingMyRequests} pending</p>
            </div>
            <button onClick={fetchMyRequests} disabled={myRequestsLoading}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
              <RefreshCw className={`w-4 h-4 ${myRequestsLoading ? 'animate-spin' : ''}`} />Refresh
            </button>
          </div>

          {myRequestsLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}</div>
          ) : myRequests.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>No requests yet. Use "Request Stock" to submit one.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {myRequests.map(req => (
                <div key={req.batchId} className={`border rounded-xl p-4 border-l-4 ${
                  req.status === 'approved' || req.status === 'accepted'
                    ? 'border-slate-100 border-l-green-400'
                    : req.status === 'rejected'
                    ? 'border-red-50 border-l-red-400'
                    : 'border-slate-200 border-l-amber-400'
                }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                          {req.items.length} item{req.items.length !== 1 ? 's' : ''}
                        </span>
                        {req.sourceType === 'branch' && (
                          <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            <ArrowLeftRight className="w-3 h-3" />Transfer
                          </span>
                        )}
                      </div>
                      {req.sourceType === 'branch' && (
                        <p className="text-sm text-slate-500 mb-1">
                          From <span className="font-medium text-slate-700">{req.fromBranchName}</span>
                        </p>
                      )}
                      <div className="space-y-1 mb-1">
                        {req.items.map(item => (
                          <div key={item.id} className="flex items-center gap-2 text-sm flex-wrap">
                            <span className="font-medium text-slate-800">{item.productName}</span>
                            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{item.quantity} {item.productUnit}</span>
                            {req.items.length > 1 && <StatusBadge status={item.status} />}
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-slate-400" title={new Date(req.createdAt).toLocaleString()}>
                        {relativeTime(req.createdAt)}
                      </p>
                      {req.notes && <p className="text-xs text-slate-500 mt-1 italic">"{req.notes}"</p>}
                    </div>
                    <StatusBadge status={req.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Request Stock Modal ── */}
      {showReqModal && (
        <Modal title={reqMode === 'transfer' ? 'Request Branch Transfer' : 'Request Stock'} onClose={() => { setShowReqModal(false); resetReqSearch(); }}>
          {reqError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{reqError}</div>}
          <form onSubmit={submitRequest} className="space-y-4">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
              <button type="button" onClick={() => handleReqModeChange('restock')}
                className={`flex-1 py-2 font-medium transition-colors ${reqMode === 'restock' ? 'bg-amber-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                Restock
              </button>
              <button type="button" onClick={() => handleReqModeChange('transfer')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 font-medium transition-colors ${reqMode === 'transfer' ? 'bg-blue-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                <ArrowLeftRight className="w-3.5 h-3.5" />Transfer from Branch
              </button>
            </div>
            {isAdmin && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Destination Branch</label>
                <select value={selectedBranch} onChange={e => { setSelectedBranch(e.target.value); if (reqMode === 'transfer') handleReqFromBranchChange(''); }}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm">
                  {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                </select>
              </div>
            )}
            {reqMode === 'transfer' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Source Branch *</label>
                <select value={reqFromBranchId} onChange={e => handleReqFromBranchChange(e.target.value)} required
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                  <option value="">Select branch to transfer from...</option>
                  {transferBranchOptions.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                </select>
                {reqFromBranchStockLoading && <p className="text-xs text-slate-400 mt-1">Loading stock…</p>}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Product *</label>
              <ProductSearch
                products={reqMode === 'transfer' ? reqFromBranchStock.map(s => s.product).filter(Boolean) : products}
                stockMap={reqMode === 'transfer' ? reqFromBranchStockMap : stockMap}
                value={reqSearch}
                selectedId={reqProductId}
                category={reqCategory}
                suggestions={reqSuggestions}
                showDropdown={showReqDropdown}
                inputRef={reqInputRef}
                accentColor={reqMode === 'transfer' ? 'blue' : 'amber'}
                onSearchChange={handleReqSearchChange}
                onCategoryChange={handleReqCategoryChange}
                onSelect={selectReqProduct}
                onClearSearch={() => { setReqSearch(''); setReqProductId(''); setReqSuggestions([]); setShowReqDropdown(false); }}
                onDropdownShow={setShowReqDropdown}
              />
              {reqMode === 'transfer' && !reqFromBranchId && (
                <p className="text-xs text-slate-400 mt-1">Select a source branch first to search its stock.</p>
              )}
              {reqMode === 'transfer' && reqProductId && (
                <p className="text-xs text-blue-600 mt-1">{reqFromBranchStockMap.get(reqProductId) ?? 0} available at source branch</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Quantity *</label>
              <div className="flex gap-2">
                <input type="number" min="0.01" step="0.01" value={reqQty}
                  onChange={e => setReqQty(Number(e.target.value))}
                  className="flex-1 px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm" />
                <button type="button" onClick={addReqItem}
                  className={`flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium text-white shrink-0 transition-colors ${reqMode === 'transfer' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-amber-500 hover:bg-amber-600'}`}>
                  <Plus className="w-4 h-4" />Add Item
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">Add each product you need, then submit the whole list in one request.</p>
            </div>

            {reqItems.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Items to {reqMode === 'transfer' ? 'transfer' : 'request'} ({reqItems.length})
                </label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2">
                  {reqItems.map(item => (
                    <div key={item.productId} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-2 text-sm">
                      <span className="font-medium text-slate-800 truncate">{item.productName}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{item.quantity} {item.productUnit}</span>
                        <button type="button" onClick={() => removeReqItem(item.productId)}
                          className="text-slate-400 hover:text-red-500 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea value={reqNotes} onChange={e => setReqNotes(e.target.value)} rows={2}
                placeholder="Optional — reason, urgency, etc."
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none text-sm" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => { setShowReqModal(false); resetReqSearch(); }}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
              <button type="submit" disabled={reqSaving}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-white rounded-lg font-medium text-sm transition-colors ${reqMode === 'transfer' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-amber-500 hover:bg-amber-600'}`}>
                {reqSaving ? <Spinner /> : <Check className="w-4 h-4" />}{reqMode === 'transfer' ? 'Submit Transfer Request' : 'Submit Request'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Add Stock Modal (admin) ── */}
      {showAddModal && isAdmin && (
        <Modal title="Add Stock to Branch" onClose={() => { setShowAddModal(false); resetAddSearch(); }}>
          <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
            Adding directly to: <span className="font-semibold">{branchName}</span>
          </div>
          {addError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{addError}</div>}
          <form onSubmit={submitDirectAdd} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Branch</label>
              <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                {branches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Product *</label>
              <ProductSearch
                products={products}
                stockMap={stockMap}
                value={addSearch}
                selectedId={addProductId}
                category={addCategory}
                suggestions={addSuggestions}
                showDropdown={showAddDropdown}
                inputRef={addInputRef}
                accentColor="blue"
                onSearchChange={handleAddSearchChange}
                onCategoryChange={handleAddCategoryChange}
                onSelect={selectAddProduct}
                onClearSearch={() => { setAddSearch(''); setAddProductId(''); setAddInputMode('pieces'); setAddInches(0); setAddSuggestions([]); setShowAddDropdown(false); }}
                onDropdownShow={setShowAddDropdown}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Quantity *</label>
              {addSelectedProduct?.isCuttable && addSelectedProduct?.unitLengthInches ? (
                <div className="space-y-2">
                  {/* Mode toggle */}
                  <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
                    <button type="button"
                      onClick={() => setAddInputMode('pieces')}
                      className={`flex-1 py-2 font-medium transition-colors ${addInputMode === 'pieces' ? 'bg-blue-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                      In Pieces
                    </button>
                    <button type="button"
                      onClick={() => setAddInputMode('inches')}
                      className={`flex-1 py-2 font-medium transition-colors ${addInputMode === 'inches' ? 'bg-blue-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                      In Inches
                    </button>
                  </div>

                  {addInputMode === 'pieces' ? (
                    <input type="number" min="0.01" step="0.01" value={addQty}
                      onChange={e => setAddQty(Number(e.target.value))} required
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
                  ) : (
                    <div className="space-y-1.5">
                      <div className="relative">
                        <input type="number" min="0.1" step="0.1" value={addInches || ''}
                          onChange={e => setAddInches(Number(e.target.value))} required
                          placeholder="Total length in inches"
                          className="w-full px-3 py-2.5 pr-14 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">inches</span>
                      </div>
                      {addInches > 0 && (
                        <div className="px-3 py-2 bg-blue-50 rounded-lg text-xs text-blue-700">
                          = <span className="font-semibold">{(addInches / addSelectedProduct.unitLengthInches).toFixed(4)}</span> pieces
                          <span className="text-blue-400 ml-1">({addInches}" ÷ {addSelectedProduct.unitLengthInches}" per piece)</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <input type="number" min="0.01" step="0.01" value={addQty}
                  onChange={e => setAddQty(Number(e.target.value))} required
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Source *</label>
              <select value={addSourceType} onChange={e => { setAddSourceType(e.target.value); setAddWarehouseId(''); }}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                <option value="warehouse">From Warehouse</option>
                <option value="others">Others (External)</option>
              </select>
            </div>
            {addSourceType === 'warehouse' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Warehouse *</label>
                <select value={addWarehouseId} onChange={e => setAddWarehouseId(e.target.value)} required
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                  <option value="">Select warehouse...</option>
                  {warehouses.map((w: any) => <option key={w._id} value={w._id}>{w.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => { setShowAddModal(false); resetAddSearch(); }}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
              <button type="submit" disabled={addSaving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium text-sm transition-colors">
                {addSaving ? <Spinner /> : <Check className="w-4 h-4" />}Add Stock
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Edit Stock Modal (admin) ── */}
      {editingStock && isAdmin && (
        <Modal title="Edit Stock Quantity" onClose={() => setEditingStock(null)}>
          <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm text-slate-700">
            <p className="font-medium">{editingStock.product?.name}</p>
            <p className="text-slate-500 text-xs mt-0.5">
              Current: <span className="font-semibold">{editingStock.quantity.toLocaleString()} {editingStock.product?.unit}</span>
            </p>
            <p className="text-slate-400 text-xs mt-0.5">Branch: {branchName}</p>
          </div>
          {editError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{editError}</div>}
          <form onSubmit={submitEditStock} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Quantity *</label>
              <input type="number" min="0" step="0.01" value={editQty}
                onChange={e => setEditQty(Number(e.target.value))} required autoFocus
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm" />
              <p className="text-xs text-slate-400 mt-1">Sets the exact quantity (does not add to existing).</p>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditingStock(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
              <button type="submit" disabled={editSaving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors">
                {editSaving ? <Spinner /> : <Check className="w-4 h-4" />}Save Changes
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Approve Modal (admin) ── */}
      {approving && (() => {
        const { batch, item } = approving;
        const isTransfer = batch.sourceType === 'branch';
        const displayItems = item ? [item] : batch.items;
        return (
          <Modal title={
            isTransfer ? (item ? 'Approve Transfer Item' : 'Approve Branch Transfer')
                       : (item ? 'Approve Item' : 'Approve Stock Request')
          } onClose={() => setApproving(null)}>
            <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm text-slate-700">
              {isTransfer ? (
                <p className="text-slate-500 text-xs mb-2">
                  <span className="font-medium text-slate-700">{batch.fromBranchName}</span>
                  {' → '}
                  <span className="font-medium text-slate-700">{batch.branchName}</span>
                  {' · '}Requested by {batch.requestedByName}
                </p>
              ) : (
                <p className="text-slate-500 text-xs mb-2">For {batch.branchName} · Requested by {batch.requestedByName}</p>
              )}
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {displayItems.map(i => (
                  <p key={i.id}><span className="font-medium">{i.productName}</span> × {i.quantity} {i.productUnit}</p>
                ))}
              </div>
            </div>
            {approveError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{approveError}</div>}
            <form onSubmit={approveRequest} className="space-y-4">
              {isTransfer ? (
                <p className="text-sm text-slate-500">
                  This will move {displayItems.length > 1 ? 'these items' : 'this item'} out of {batch.fromBranchName} stock and into {batch.branchName} stock.
                </p>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Stock Source *</label>
                    <select value={approveSourceType} onChange={e => { setApproveSourceType(e.target.value); setApproveWarehouseId(''); }}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm">
                      <option value="warehouse">From Warehouse</option>
                      <option value="others">Others (External)</option>
                    </select>
                  </div>
                  {approveSourceType === 'warehouse' && (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Warehouse *</label>
                      <select value={approveWarehouseId} onChange={e => setApproveWarehouseId(e.target.value)} required
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm">
                        <option value="">Select warehouse...</option>
                        {warehouses.map((w: any) => <option key={w._id} value={w._id}>{w.name}</option>)}
                      </select>
                      {!item && displayItems.length > 1 && (
                        <p className="text-xs text-slate-400 mt-1">All items approved here come from the same warehouse — use the per-item approve buttons to split sourcing.</p>
                      )}
                    </div>
                  )}
                </>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setApproving(null)}
                  className="flex-1 py-2.5 border border-slate-200 rounded-lg text-slate-600 font-medium text-sm">Cancel</button>
                <button type="submit" disabled={approveSaving}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium text-sm transition-colors">
                  {approveSaving ? <Spinner /> : <CheckCircle className="w-4 h-4" />}
                  {isTransfer ? (item ? 'Approve Item' : 'Approve Transfer') : (item ? 'Approve Item' : 'Approve All & Add Stock')}
                </button>
              </div>
            </form>
          </Modal>
        );
      })()}

    </div>
  );
}