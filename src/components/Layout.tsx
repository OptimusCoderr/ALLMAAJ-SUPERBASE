import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  ShoppingBag, LayoutDashboard, Package, Warehouse, GitBranch,
  TrendingUp, FileText, Users, Menu, LogOut,
  Store, UserCheck, Star, Truck,
} from 'lucide-react';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  roles: string[];
}

const NAV_ITEMS: NavItem[] = [
  { path: '/',           label: 'Dashboard',        icon: <LayoutDashboard className="w-5 h-5" />, roles: ['admin', 'manager', 'staff'] },
  { path: '/sales',      label: 'Record Sale',      icon: <ShoppingBag className="w-5 h-5" />,     roles: ['admin', 'manager', 'staff'] },
  { path: '/daily-report', label: 'Daily Report',  icon: <FileText className="w-5 h-5" />,       roles: ['admin', 'manager', 'staff'] },
  { path: '/branch-stock', label: 'Branch Stock',  icon: <Store className="w-5 h-5" />,           roles: ['admin', 'manager', 'staff'] },
  { path: '/admin/reports', label: 'Sales Reports', icon: <TrendingUp className="w-5 h-5" />,     roles: ['admin', 'manager'] },
  { path: '/admin/debtors', label: 'Debtors',       icon: <UserCheck className="w-5 h-5" />,       roles: ['admin', 'manager'] },
  { path: '/admin/report-approvals', label: 'Report Approvals', icon: <FileText className="w-5 h-5" />, roles: ['admin', 'manager'] },
  { path: '/admin/warehouses', label: 'Warehouses', icon: <Warehouse className="w-5 h-5" />,      roles: ['admin', 'manager'] },
  { path: '/admin/warehouse-sales', label: 'Warehouse Sales', icon: <Truck className="w-5 h-5" />, roles: ['admin', 'manager'] },
  { path: '/admin/products', label: 'Products',    icon: <Package className="w-5 h-5" />,        roles: ['admin', 'manager'] },
  { path: '/admin/branches', label: 'Branches',     icon: <GitBranch className="w-5 h-5" />,       roles: ['admin', 'manager'] },
  { path: '/admin/special-customers', label: 'Special Customers', icon: <Star className="w-5 h-5" />, roles: ['admin', 'manager'] },
  { path: '/admin/staff', label: 'Staff Management', icon: <Users className="w-5 h-5" />,          roles: ['admin'] },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const role = user?.role ?? 'staff';
  const visibleItems = NAV_ITEMS.filter(item => item.roles.includes(role));

  const roleBadgeColor: Record<string, string> = {
    admin:   'bg-red-100 text-red-700',
    manager: 'bg-purple-100 text-purple-700',
    staff:   'bg-green-100 text-green-700',
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
      isActive
        ? 'bg-amber-500 text-white shadow-lg'
        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
    }`;

  const Sidebar = () => (
    <div className="flex flex-col h-full bg-slate-900 text-white">
      <div className="p-6 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <ShoppingBag className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-white text-lg leading-tight">ALLMAAJ-INVENTORY</h1>
            <p className="text-slate-400 text-xs">Sales Management</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {visibleItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => setSidebarOpen(false)}
            className={navLinkClass}
          >
            {item.icon}
            <span className="flex-1 text-left truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-700">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 bg-slate-700 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
            {(user?.fullName || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{user?.fullName || 'User'}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${roleBadgeColor[role] || 'bg-slate-100 text-slate-600'}`}>
              {role}
            </span>
          </div>
        </div>
        <button
          onClick={() => { signOut(); navigate('/login'); }}
          className="w-full flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-sm transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh bg-slate-100 overflow-hidden">
      <div className="hidden lg:flex w-64 flex-shrink-0 flex-col">
        <Sidebar />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-64">
            <Sidebar />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
          <div className="lg:hidden flex items-center gap-3 p-3 sm:p-4 bg-white border-b border-slate-200">
          <button onClick={() => setSidebarOpen(true)} className="text-slate-600 hover:text-slate-900">
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
              <ShoppingBag className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-800">ALLMAAJ-PRO</span>
          </div>
        </div>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}