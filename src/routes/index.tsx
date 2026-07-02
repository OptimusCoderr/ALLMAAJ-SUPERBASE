import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { ProtectedRoute, PublicRoute } from './ProtectedRoute';
import Layout from '../components/Layout';
import LoginPage from '../pages/LoginPage';
import DashboardPage from '../pages/DashboardPage';
import SalesPage from '../pages/SalesPage';
import DailyReportPage from '../pages/DailyReportPage';
import BranchStockPage from '../pages/BranchStockPage';
import StaffManagementPage from '../pages/admin/StaffManagementPage';
import BranchesPage from '../pages/admin/BranchesPage';
import WarehousesPage from '../pages/admin/WarehousesPage';
import WarehouseSalesPage from '../pages/admin/WarehouseSalesPage';
import ProductsPage from '../pages/admin/ProductsPage';
import SalesReportsPage from '../pages/admin/SalesReportsPage';
import DebtorsPage from '../pages/admin/DebtorsPage';
import ReportApprovalsPage from '../pages/admin/ReportApprovalsPage';
import SpecialCustomersPage from '../pages/admin/SpecialCustomersPage';
import AccessDeniedPage from '../pages/AccessDeniedPage';

const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <PublicRoute>
        <LoginPage />
      </PublicRoute>
    ),
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <Layout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'sales', element: <SalesPage /> },
      { path: 'daily-report', element: <DailyReportPage /> },
      { path: 'branch-stock', element: <BranchStockPage /> },
      // Admin routes
      {
        path: 'admin',
        element: <AccessDeniedPage />,
      },
      {
        path: 'admin/staff',
        element: (
          <ProtectedRoute requiredRole="admin">
            <StaffManagementPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/branches',
        element: (
          <ProtectedRoute requiredRole="admin">
            <BranchesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/warehouses',
        element: (
          <ProtectedRoute requiredRole="managerOrAdmin">
            <WarehousesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/warehouse-sales',
        element: (
          <ProtectedRoute requiredRole="managerOrAdmin">
            <WarehouseSalesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/products',
        element: (
          <ProtectedRoute requiredRole="managerOrAdmin">
            <ProductsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/reports',
        element: (
          <ProtectedRoute requiredRole="managerOrAdmin">
            <SalesReportsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/debtors',
        element: (
          <ProtectedRoute requiredRole="managerOrAdmin">
            <DebtorsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/report-approvals',
        element: (
          <ProtectedRoute requiredRole="managerOrAdmin">
            <ReportApprovalsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/special-customers',
        element: (
          <ProtectedRoute requiredRole="managerOrAdmin">
            <SpecialCustomersPage />
          </ProtectedRoute>
        ),
      },
      // Catch-all: unknown child routes → back to dashboard
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
  // Top-level catch-all: unknown URL while logged out → login page
  {
    path: '*',
    element: (
      <ProtectedRoute>
        <Navigate to="/" replace />
      </ProtectedRoute>
    ),
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}