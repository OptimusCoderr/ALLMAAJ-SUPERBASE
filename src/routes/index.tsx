import { createBrowserRouter, RouterProvider } from 'react-router-dom';
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
import ProductsPage from '../pages/admin/ProductsPage';
import SalesReportsPage from '../pages/admin/SalesReportsPage';
import DebtorsPage from '../pages/admin/DebtorsPage';
import ReportApprovalsPage from '../pages/admin/ReportApprovalsPage';
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
          <ProtectedRoute requiredRole="admin">
            <WarehousesPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/products',
        element: (
          <ProtectedRoute requiredRole="admin">
            <ProductsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/reports',
        element: (
          <ProtectedRoute requiredRole="admin">
            <SalesReportsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/debtors',
        element: (
          <ProtectedRoute requiredRole="admin">
            <DebtorsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin/report-approvals',
        element: (
          <ProtectedRoute requiredRole="admin">
            <ReportApprovalsPage />
          </ProtectedRoute>
        ),
      },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
