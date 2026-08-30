import { render, screen, waitFor, act } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import BillModal, { BillModalHandle } from './BillModal';
import { ToastProvider } from '../../../contexts/ToastContext';
import type { CartItem } from '../../../types/models';

const getById = vi.fn<(payload: { orderId: number }) => Promise<{ success: boolean; data?: unknown; error?: string }>>();
const getSettings = vi.fn<() => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>>();
const createBill = vi.fn<(payload: { orderId: number; payments: Array<{ method: string; amount: number }>; discount: number; customerId?: number }) => Promise<{ success: boolean; data?: unknown; error?: string }>>();
const printBill = vi.fn<(payload: unknown) => Promise<{ success: boolean; error?: string }>>();

vi.mock('../../../lib/ipc', () => ({
  api: {
    orders: { getById: (payload: { orderId: number }) => getById(payload) },
    settings: { get: () => getSettings() },
    billing: { createBill: (payload: { orderId: number; payments: Array<{ method: string; amount: number }>; discount: number; customerId?: number }) => createBill(payload) },
    print: { bill: (payload: unknown) => printBill(payload) },
  },
}));

const AUTHORITATIVE_ORDER = {
  id: 7,
  status: 'SENT_TO_KITCHEN',
  subtotal_minor: 10000,
  tax_minor: 1500,
  service_charge_minor: 0,
  delivery_charge_minor: 0,
  discount_minor: 0,
  total_minor: 11500,
  total_paid_minor: 0,
  items: [{ id: 1, name: 'Biryani', qty: 2, line_total_minor: 10000, unit_price_minor: 5000, variant_name: null, modifier_snapshot: null, note: null }],
};

const CART: CartItem[] = [{ id: 1, name: 'Biryani', price: 9999, qty: 2 }]; // deliberately diverges from backend

function renderModal(): React.RefObject<BillModalHandle | null> {
  const ref = createRef<BillModalHandle | null>();
  render(
    <ToastProvider>
      <BillModal ref={ref} orderId={7} cart={CART} onClose={() => undefined} />
    </ToastProvider>
  );
  return ref;
}

describe('BillModal — authoritative backend totals', () => {
  beforeEach(() => {
    getById.mockReset();
    getSettings.mockReset();
    createBill.mockReset();
    printBill.mockReset();
    getById.mockResolvedValue({ success: true, data: AUTHORITATIVE_ORDER });
    getSettings.mockResolvedValue({ success: true, data: { tax_name: 'Sales Tax' } });
    createBill.mockResolvedValue({ success: true, data: { bill_number: 'BILL-1' } });
    printBill.mockResolvedValue({ success: true });
  });

  it('displays backend totals, never cart-derived totals', async () => {
    renderModal();
    // The cart sums to Rs 19998, but the authoritative order total is Rs 11500.
    await waitFor(() => {
      // Rs 100.00 appears as the line-item total AND the taxable amount (both from the backend)
      expect(screen.getAllByText('Rs 100.00').length).toBe(2);
    });
    expect(screen.getByText('Rs 15.00')).toBeInTheDocument(); // tax 1500 minor
    // Rs 115.00 appears as grand total, default tendered amount, and remaining
    expect(screen.getAllByText('Rs 115.00').length).toBe(3);
    expect(screen.queryByText('Rs 19998.00')).not.toBeInTheDocument();
  });

  it('sends payments that balance the backend remaining total', async () => {
    const ref = renderModal();
    await waitFor(() => { expect(screen.getAllByText('Rs 115.00').length).toBeGreaterThan(0); });
    act(() => { ref.current?.save(); });
    await waitFor(() => { expect(createBill).toHaveBeenCalledTimes(1); });
    const payload = createBill.mock.calls[0][0] as { orderId: number; payments: Array<{ method: string; amount: number; status?: string }>; discount: number };
    expect(payload.orderId).toBe(7);
    // Default cash payment equals the authoritative total (Rs 115.00)
    expect(payload.payments).toEqual([{ method: 'cash', amount: 115, status: 'PAID' }]);
  });

  it('recomputes the grand total from the authoritative subtotal when a discount is applied', async () => {
    const ref = renderModal();
    await waitFor(() => { expect(screen.getAllByText('Rs 115.00').length).toBeGreaterThan(0); });
    // 10% of the authoritative subtotal (Rs 100.00) = Rs 10.00
    const pctButton = screen.getByRole('button', { name: '10%' });
    act(() => { pctButton.click(); });
    expect(screen.getAllByText('Rs 105.00').length).toBe(3); // grand total + tendered + remaining
    act(() => { ref.current?.save(); });
    await waitFor(() => { expect(createBill).toHaveBeenCalledTimes(1); });
    const payload = createBill.mock.calls[0][0] as { payments: Array<{ method: string; amount: number; status?: string }>; discount: number };
    expect(payload.discount).toBe(10);
    expect(payload.payments).toEqual([{ method: 'cash', amount: 105, status: 'PAID' }]);
  });

  it('disables billing when authoritative totals cannot be loaded', async () => {
    getById.mockResolvedValue({ success: false, error: 'Order not found' });
    const ref = renderModal();
    await waitFor(() => { expect(screen.getByText(/billing is disabled/i)).toBeInTheDocument(); });
    act(() => { ref.current?.save(); });
    expect(createBill).not.toHaveBeenCalled();
  });
});
