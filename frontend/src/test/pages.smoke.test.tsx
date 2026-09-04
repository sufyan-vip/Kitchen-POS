/**
 * Page smoke coverage.
 *
 * Every top-level screen is mounted against the mock IPC bridge with a
 * logged-in admin and an open shift. A page that throws during render, calls a
 * bridge method that does not exist, or logs a React error fails this test —
 * the class of bug that a type-check and a production build both miss.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

import { SvgSpriteLoader } from '../components/atoms/svg-sprite-loader';
import { ToastProvider } from '../contexts/ToastContext';
import { ModalProvider } from '../contexts/ModalContext';
import { HeaderProvider } from '../contexts/HeaderContext';
import { BusinessSessionProvider } from '../contexts/BusinessSessionContext';
import { useAuthStore } from '../store/auth';

import DashboardPage from '../pages/Dashboard';
import TablesPage from '../pages/Tables';
import OrderPage from '../pages/Order';
import MenuPage from '../pages/Menu';
import InventoryPage from '../pages/Inventory';
import ReportsPage from '../pages/Reports';
import SettingsPage from '../pages/Settings';
import ExpensesPage from '../pages/Expenses';
import PurchasingPage from '../pages/Purchasing';
import StaffPage from '../pages/Staff';
import KDSPage from '../pages/KDS';
import CustomersPage from '../pages/Customers';
import PastOrdersPage from '../pages/PastOrders';
import LoginPage from '../pages/Login';
import SetupPage from '../pages/Setup';

const pages: Array<[string, React.ComponentType, string]> = [
  ['Login', LoginPage, '/login'],
  ['Setup', SetupPage, '/setup'],
  ['Dashboard', DashboardPage, '/dashboard'],
  ['Tables', TablesPage, '/tables'],
  ['Order', OrderPage, '/order/1'],
  ['KDS', KDSPage, '/kds'],
  ['Menu', MenuPage, '/menu'],
  ['Inventory', InventoryPage, '/inventory'],
  ['Purchasing', PurchasingPage, '/purchasing'],
  ['Expenses', ExpensesPage, '/expenses'],
  ['Customers', CustomersPage, '/customers'],
  ['Past Orders', PastOrdersPage, '/past-orders'],
  ['Reports', ReportsPage, '/reports'],
  ['Staff', StaffPage, '/staff'],
  ['Settings', SettingsPage, '/settings'],
];

function Providers({ children, route }: { children: React.ReactNode; route: string }) {
  return (
    <MemoryRouter initialEntries={[route]}>
      <SvgSpriteLoader url="/sprites/app-icons.svg">
      <ToastProvider>
        <HeaderProvider>
          <ModalProvider>
            <BusinessSessionProvider>
              <Routes>
                <Route path="/order/:tableId" element={<>{children}</>} />
                <Route path="*" element={<>{children}</>} />
              </Routes>
            </BusinessSessionProvider>
          </ModalProvider>
        </HeaderProvider>
      </ToastProvider>
      </SvgSpriteLoader>
    </MemoryRouter>
  );
}

const SPRITE_MARKUP = '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="icon-placeholder"></symbol></svg>';

describe('page smoke: every screen mounts against the IPC bridge', () => {
  beforeEach(() => {
    // jsdom has no document base for relative asset URLs; serve the icon
    // sprite from memory so the loader behaves as it does in the app.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(SPRITE_MARKUP, {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml' },
    }))));

    useAuthStore.setState({
      staff: { id: 1, name: 'Admin', role: 'admin', is_active: 1 },
      isAuthenticated: true,
      isSetupComplete: true,
      activeShift: { id: 1, opened_at: new Date().toISOString(), opening_cash: 0 } as never,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  for (const [name, Page, route] of pages) {
    it(`${name} renders without errors`, async () => {
      const errors: string[] = [];
      const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        errors.push(args.map(a => (a instanceof Error ? a.message : String(a))).join(' '));
      });

      const { container } = render(
        <Providers route={route}>
          <Page />
        </Providers>,
      );

      // Let effect-driven IPC loads settle.
      await waitFor(() => { expect(container.firstChild).not.toBeNull(); });
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));

      consoleError.mockRestore();

      // Noise from the test environment, not from the app: jsdom gives every
      // element a zero bounding box (so Recharts complains about container
      // size) and React's act() warning fires for IPC promises that resolve
      // after the assertion.
      const environmentNoise = [
        'not wrapped in act',
        'React Router Future Flag',
        'validateDOMNesting',
        'of chart should be greater than 0',
      ];
      const realErrors = errors.filter(message => !environmentNoise.some(noise => message.includes(noise)));
      expect(realErrors, `${name} logged errors:\n${realErrors.join('\n')}`).toEqual([]);
    });
  }
});
