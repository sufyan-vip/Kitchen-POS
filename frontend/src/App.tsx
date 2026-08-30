import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { hasPermission, Permission } from './lib/permissions';

import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import TablesPage from './pages/Tables';
import OrderPage from './pages/Order';
import MenuPage from './pages/Menu';
import InventoryPage from './pages/Inventory';
import ReportsPage from './pages/Reports';
import SettingsPage from './pages/Settings';
import ExpensesPage from './pages/Expenses/index';
import PurchasingPage from './pages/Purchasing';
import StaffPage from './pages/Staff';
import KDSPage from './pages/KDS';
import CustomersPage from './pages/Customers';
import CustomerDetailPage from './pages/CustomerDetail';
import ComponentsPage from './pages/Components';
import PastOrdersPage from './pages/PastOrders';
import OpenShiftModal from './components/organisms/modal/OpenShiftModal';
import AppLayout from './layouts/AppLayout';
import SetupPage from './pages/Setup';

const ProtectedRoute = ({ children, permission }: { children: React.ReactNode; permission?: Permission }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isSetupComplete = useAuthStore((state) => state.isSetupComplete);
  const activeShift = useAuthStore((state) => state.activeShift);
  const role = useAuthStore((state) => state.staff?.role);

  if (isSetupComplete === false) {
    return <Navigate to="/setup" replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (permission && !hasPermission(role ?? null, permission)) {
    // UI-level gate only: the backend independently rejects unauthorized IPC
    // calls, so this never grants access — it just avoids showing the page.
    return (
      <AppLayout>
        <div className="p-10 text-center text-gray-500">
          <p className="text-lg font-bold mb-1">Access denied</p>
          <p className="text-sm">Your role does not include the <code>{permission}</code> permission.</p>
        </div>
      </AppLayout>
    );
  }

  if (!activeShift) {
    return <OpenShiftModal />;
  }

  return <AppLayout>{children}</AppLayout>;
};

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/components" element={<ComponentsPage />} />
      <Route path="/login" element={
        useAuthStore(state => state.isSetupComplete) === false
          ? <Navigate to="/setup" replace />
          : <LoginPage />
      } />
      <Route path="/setup" element={<SetupPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute permission="reports">
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tables"
        element={
          <ProtectedRoute permission="table_viewing">
            <TablesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/order/:tableId"
        element={
          <ProtectedRoute permission="orders_create">
            <OrderPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/menu"
        element={
          <ProtectedRoute permission="menu_viewing">
            <MenuPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory"
        element={
          <ProtectedRoute permission="inventory_view">
            <InventoryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/kds"
        element={
          <ProtectedRoute permission="kot_view">
            <KDSPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/expenses"
        element={
          <ProtectedRoute permission="expenses_view">
            <ExpensesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/purchasing"
        element={
          <ProtectedRoute permission="purchasing_view">
            <PurchasingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers"
        element={
          <ProtectedRoute permission="customers_view">
            <CustomersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers/:id"
        element={
          <ProtectedRoute>
            <CustomerDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/staff"
        element={
          <ProtectedRoute permission="staff">
            <StaffPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute permission="reports">
            <ReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/past-orders"
        element={
          <ProtectedRoute permission="reports">
            <PastOrdersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute permission="settings">
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/tables" replace />} />
    </Routes>
  );
};

export default App;
