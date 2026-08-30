import { Button, Input, Select } from '../../../components/atoms';
import { useState, useEffect, forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { api } from '../../../lib/ipc';
import { CartItem, Customer } from '../../../types/models';
import { useToast } from '../../../hooks/useToast';
import { CustomerSelect } from '../../../components/organisms/CustomerSelect';

interface Props {
  orderId: number;
  cart: CartItem[];
  initialCustomer?: Customer | null;
  onClose: () => void;
}

export interface BillModalHandle {
  save: () => void;
  print: () => void;
}

/**
 * Authoritative settlement numbers come from the backend order row
 * (recalculated by the order service); the client never derives the bill
 * total from the cart. Cart-derived figures are previews only.
 */
interface AuthoritativeOrder {
  id: number;
  status: string;
  subtotal_minor: number;
  tax_minor: number;
  service_charge_minor: number;
  delivery_charge_minor: number;
  discount_minor: number;
  total_minor: number;
  total_paid_minor: number;
  items: Array<{
    id: number;
    name: string;
    qty: number;
    line_total_minor: number | null;
    unit_price_minor: number | null;
    variant_name: string | null;
    modifier_snapshot: string | null;
    note: string | null;
  }>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Convert rupee input to integer paisa, matching the backend's toMinorUnits. */
function toMinor(rupees: number): number {
  return Math.round((Number.isFinite(rupees) ? rupees : 0) * 100);
}

const BillModal = forwardRef<BillModalHandle, Props>(({ orderId, cart, initialCustomer, onClose }, ref) => {
  const { showToast } = useToast();

  const [order, setOrder] = useState<AuthoritativeOrder | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [discount, setDiscount] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(initialCustomer ?? null);
  const [payments, setPayments] = useState<{ method: string; amount: number; status: 'PAID' | 'PENDING' }[]>([]);
  const [taxName, setTaxName] = useState('Sales Tax');

  useEffect(() => {
    let active = true;
    void api.orders.getById({ orderId }).then(res => {
      if (!active) { return; }
      if (res.success && res.data) {
        setOrder(res.data as unknown as AuthoritativeOrder);
      } else {
        setLoadError(res.error ?? 'Could not load order totals');
      }
    }).catch(() => {
      if (active) { setLoadError('Could not load order totals'); }
    });
    return () => { active = false; };
  }, [orderId]);

  useEffect(() => {
    void api.settings.get().then(res => {
      if (res.success && res.data) {
        const data = res.data as Record<string, unknown>;
        setTaxName(typeof data.tax_name === 'string' ? data.tax_name : 'Sales Tax');
      }
    });
  }, []);

  // ── Authoritative totals (integer paisa from the backend order row) ──────
  const subtotalMinor = order?.subtotal_minor ?? 0;
  const taxMinor = order?.tax_minor ?? 0;
  const serviceChargeMinor = order?.service_charge_minor ?? 0;
  const deliveryChargeMinor = order?.delivery_charge_minor ?? 0;
  const baseTotalMinor = order?.total_minor ?? 0; // includes any stored discount
  const paidMinor = order?.total_paid_minor ?? 0;

  // Bill-time discount: FIXED rupees (mirrors backend billing.createBill:
  // discountMinor = toMinorUnits(value); total = max(0, total_minor - discountMinor))
  const discountMinor = toMinor(discount);
  const grandTotalMinor = Math.max(0, baseTotalMinor - discountMinor);
  const remainingMinor = Math.max(0, grandTotalMinor - paidMinor);

  const isPendingMethod = (method: string): boolean => method === 'jazzcash' || method === 'easypaisa';
  const settledPaymentsMinor = toMinor(payments.reduce((sum, p) => sum + (p.status === 'PAID' ? (p.amount || 0) : 0), 0));
  const pendingPaymentsMinor = toMinor(payments.reduce((sum, p) => sum + (p.status === 'PENDING' ? (p.amount || 0) : 0), 0));
  const isBalanced = settledPaymentsMinor === remainingMinor;

  useEffect(() => {
    setPayments([{ method: 'cash', amount: round2(remainingMinor / 100), status: 'PAID' }]);
  }, [remainingMinor]);

  const handlePaymentChange = (index: number, field: string, value: string | number) => {
    setPayments(prev => prev.map((p, i) => {
      if (i !== index) { return p; }
      const next = { ...p, [field]: value };
      if (field === 'method') {
        next.status = isPendingMethod(String(value)) ? 'PENDING' : 'PAID';
      }
      return next;
    }));
  };

  const handleConfirm = async (shouldPrint: boolean) => {
    if (!order) { return; }
    if (!isBalanced) {
      showToast({ message: 'Settled payments must balance the remaining total', variant: 'warning' });
      return;
    }
    if (pendingPaymentsMinor > 0 && settledPaymentsMinor < remainingMinor) {
      showToast({ message: 'Wallet payments are pending until verified and cannot settle the balance', variant: 'warning' });
      return;
    }
    const unpaidAmount = payments.filter(p => p.method === 'unpaid' && p.status === 'PAID').reduce((sum, p) => sum + (p.amount || 0), 0);
    if (unpaidAmount > 0) {
      if (!selectedCustomer) {
        showToast({ message: 'Please select a customer for unpaid balance', variant: 'warning' });
        return;
      }
      if (selectedCustomer.outstanding_balance + unpaidAmount > selectedCustomer.credit_limit) {
        showToast({ message: 'Credit limit exceeded for this customer', variant: 'error' });
        return;
      }
    }

    try {
      const res = await api.billing.createBill({ orderId, payments, discount, customerId: selectedCustomer?.id });
      if (res.success) {
        let paymentStatus = 'PAID';
        if (res.data && typeof res.data === 'object') {
          const record = res.data as Record<string, unknown>;
          if (typeof record.payment_status === 'string') { paymentStatus = record.payment_status; }
        }
        if (shouldPrint) {
          const mappedItems = cart.map(i => ({ name: i.name, qty: i.qty, unit_price: i.price }));
          const printRes = await api.print.bill({ bill: res.data, orderItems: mappedItems, settings: {} });
          if (!printRes.success) {
            showToast({ message: `Failed to print bill: ${printRes.error}`, variant: 'error' });
          }
        }
        if (paymentStatus === 'PAYMENT_PENDING') {
          showToast({ message: 'Bill created — payment remains PENDING until the wallet payment is verified', variant: 'warning' });
        } else {
          showToast({ message: 'Bill generated successfully', variant: 'success' });
        }
        onClose();
      } else {
        showToast({ message: res.error ?? 'Failed to generate bill', variant: 'error' });
      }
    } catch (e) {
      console.error(e);
      showToast({ message: 'An unexpected error occurred', variant: 'error' });
    }
  };

  useImperativeHandle(ref, () => ({
    save: () => { void handleConfirm(false); },
    print: () => { void handleConfirm(true); },
  }));

  let breakdownLines: Array<{ key: string; name: string; qty: number; lineMinor: number }>;
  if (order && order.items.length > 0) {
    breakdownLines = order.items.map(item => {
      const unitMinor = item.unit_price_minor ?? 0;
      return { key: `oi-${item.id}`, name: item.name, qty: item.qty, lineMinor: item.line_total_minor ?? unitMinor * item.qty };
    });
  } else {
    breakdownLines = cart.map(item => ({ key: `cart-${item.id}`, name: item.name, qty: item.qty, lineMinor: Math.round(item.price * item.qty * 100) }));
  }

  let breakdownBody: ReactNode;
  if (loadError) {
    breakdownBody = (
      <div className="text-red-600 text-sm py-4">
        {loadError} — billing is disabled until totals can be verified with the server.
      </div>
    );
  } else if (!order) {
    breakdownBody = <div className="text-gray-500 py-4 text-sm">Loading authoritative totals…</div>;
  } else {
    breakdownBody = (
      <>
        <div className="space-y-3 mb-6">
          {breakdownLines.map(line => (
            <div key={line.key} className="flex justify-between text-sm">
              <p className="font-medium">{line.name} x {line.qty}</p>
              <p className="font-medium">Rs {(line.lineMinor / 100).toFixed(2)}</p>
            </div>
          ))}
        </div>

        <div className="border-t pt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Taxable Amount</span>
            <span>Rs {(subtotalMinor / 100).toFixed(2)}</span>
          </div>
          <div className="flex flex-col gap-1 my-1">
            <div className="flex justify-between items-center mt-2">
              <span className="w-1/3">Discount</span>
              <div className="w-24">
                <Input
                  type="number"
                  className="text-right"
                  value={discount}
                  onChange={e => { setDiscount(Number(e.target.value) || 0); }}
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5 mt-1">
              {[5, 10, 15, 20, 25, 30].map(pct => (
                <Button
                  key={pct}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setDiscount(Math.round((subtotalMinor * pct) / 100) / 100); }}
                  className="!rounded-full !px-2 !py-0.5 !text-xs"
                >
                  {pct}%
                </Button>
              ))}
            </div>
          </div>
          {taxMinor > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>{taxName}</span>
              <span>Rs {(taxMinor / 100).toFixed(2)}</span>
            </div>
          )}
          {serviceChargeMinor > 0 && <div className="flex justify-between text-gray-600"><span>Service Charge</span><span>Rs {(serviceChargeMinor / 100).toFixed(2)}</span></div>}
          {deliveryChargeMinor > 0 && <div className="flex justify-between text-gray-600"><span>Delivery Charge</span><span>Rs {(deliveryChargeMinor / 100).toFixed(2)}</span></div>}
          <div className="flex justify-between font-bold text-lg pt-2 border-t mt-2">
            <span>Grand Total</span>
            <span>Rs {(grandTotalMinor / 100).toFixed(2)}</span>
          </div>
          {paidMinor > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Already Paid</span>
              <span>Rs {(paidMinor / 100).toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold">
            <span>Remaining</span>
            <span>Rs {(remainingMinor / 100).toFixed(2)}</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 flex flex-col md:flex-row gap-8">
      {/* Left Side - Itemized Breakdown */}
      <div className="flex-1">
        <h3 className="font-bold text-gray-700 border-b pb-2 mb-4">Itemised Breakdown</h3>
        {breakdownBody}
      </div>

      {/* Right Side - Payment Split */}
      <div className="w-full md:w-64 bg-gray-50 p-4 rounded border flex flex-col h-[calc(100vh-12rem)] overflow-y-auto">
        <div className="mb-6 relative">
          <h3 className="font-bold text-gray-700 mb-2 border-b pb-2">Customer</h3>
          <CustomerSelect selectedCustomer={selectedCustomer} onSelect={setSelectedCustomer} />
        </div>

        <h3 className="font-bold text-gray-700 border-b pb-2 mb-4">Payments</h3>
        <div className="space-y-3">
          {payments.map((p, i) => (
            <div key={i} className="flex flex-col gap-2 relative border p-2 rounded bg-white">
              {payments.length > 1 && (
                <Button size="icon" variant="ghost" onClick={() => { setPayments(prev => prev.filter((_, idx) => idx !== i)); }} className="absolute top-1 right-1 text-red-500 h-6 w-6">✕</Button>
              )}
              <div className="flex gap-2">
                <div className="flex-1">
                  <Select value={p.method} onChange={(e) => { handlePaymentChange(i, 'method', e.target.value); }}>
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="jazzcash">JazzCash</option>
                    <option value="easypaisa">Easypaisa</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="other">Other</option>
                    <option value="unpaid">Unpaid Balance</option>
                  </Select>
                </div>
                <div className="flex-1">
                  <Input
                    type="number"
                    placeholder="Amount"
                    value={p.amount === 0 && payments.length === 1 ? '' : p.amount}
                    onChange={(e) => { handlePaymentChange(i, 'amount', Number(e.target.value)); }}
                    min={p.method === 'unpaid' ? undefined : '0'}
                    step="0.01"
                  />
                  {p.method === 'unpaid' && (
                    <p className="text-[10px] text-gray-500 mt-1 leading-tight">Amount is added to the customer's outstanding balance.</p>
                  )}
                  {p.status === 'PENDING' && (
                    <p className="text-[10px] text-amber-600 mt-1 leading-tight">Wallet payment is pending and does not count as settled.</p>
                  )}
                </div>
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() => { setPayments(prev => [...prev, { method: 'card', amount: 0 }]); }}
            className="w-full py-2 border-dashed border-2 bg-transparent text-blue-600 hover:bg-blue-50"
          >
            + Split Payment
          </Button>
        </div>

        <div className="mt-6 pt-4 border-t">
          <div className="flex justify-between text-sm mb-1">
            <span>Settled (tendered):</span>
            <span className={`font-bold ${!isBalanced ? 'text-red-600' : 'text-green-600'}`}>
              Rs {(settledPaymentsMinor / 100).toFixed(2)}
            </span>
          </div>
          {pendingPaymentsMinor > 0 && (
            <div className="flex justify-between text-sm mb-1">
              <span>Pending:</span>
              <span className="font-bold text-amber-600">Rs {(pendingPaymentsMinor / 100).toFixed(2)}</span>
            </div>
          )}
          {pendingPaymentsMinor > 0 && (
            <p className="text-xs text-amber-600 text-right">
              JazzCash/Easypaisa stay PENDING until verified — pending amounts do not settle the bill.
            </p>
          )}
          {!isBalanced && (
            <p className="text-xs text-red-500 text-right">
              Balance due: Rs {((remainingMinor - settledPaymentsMinor) / 100).toFixed(2)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

BillModal.displayName = 'BillModal';

export default BillModal;
