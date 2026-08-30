import { ipcMain } from 'electron';
import { getDB } from '../db';
import { assertCurrentPermission } from '../services/authz';
import { assertValidPaymentTransition, getPaymentProvider, PaymentStatus } from '../services/payments';
import { writeAuditLog } from '../services/audit';
import { findActiveShiftForTimestamp, recordCashPayment } from '../services/cash';

export function registerPaymentsIPC() {
  ipcMain.handle('payments:updateStatus', async (_event, payload: { paymentId: number; status: PaymentStatus; providerReference?: string; failureReason?: string; metadata?: Record<string, unknown> }) => {
    try {
      assertCurrentPermission(payload.status === 'REFUNDED' ? 'refunds' : 'payments');
      const db = getDB();
      const existing = db.prepare('SELECT * FROM payments WHERE id = ?').get(payload.paymentId) as
        { id: number; order_id: number; method: string; amount_minor: number | null; amount: number; status: PaymentStatus } | undefined;
      if (!existing) { throw new Error('Payment not found'); }
      assertValidPaymentTransition(existing.status, payload.status);
      db.prepare(`UPDATE payments SET status = ?, provider_reference = COALESCE(?, provider_reference), failure_reason = ?, metadata = COALESCE(?, metadata), paid_at = CASE WHEN ? = 'PAID' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(payload.status, payload.providerReference ?? null, payload.failureReason ?? null, payload.metadata ? JSON.stringify(payload.metadata) : null, payload.status, payload.paymentId);

      if (payload.status === 'REFUNDED' && existing.method === 'cash') {
        const order = db.prepare('SELECT created_at FROM orders WHERE id = ?').get(existing.order_id) as { created_at: string } | undefined;
        if (order) {
          const shiftId = findActiveShiftForTimestamp(db, order.created_at);
          recordCashPayment(db, shiftId, 'REFUND', existing.amount_minor ?? Math.round(existing.amount * 100), existing.id);
        }
      }
      writeAuditLog(db, { action: 'payment_status', entityType: 'payment', entityId: payload.paymentId, details: { from: existing.status, to: payload.status, orderId: existing.order_id } });
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown payment status error' };
    }
  });

  ipcMain.handle('payments:verify', async (_event, payload: { paymentId: number }) => {
    try {
      assertCurrentPermission('payments');
      const db = getDB();
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(payload.paymentId) as { id: number; provider: string; transaction_reference: string; status: PaymentStatus } | undefined;
      if (!payment) { throw new Error('Payment not found'); }
      if (!payment.transaction_reference) { throw new Error('Payment has no transaction reference'); }
      const provider = getPaymentProvider(payment.provider);
      if (!provider) { return { success: true, data: { status: payment.status, message: 'Manual/offline provider; no verification adapter required.' } }; }
      const verified = await provider.verifyPayment(payment.transaction_reference);
      assertValidPaymentTransition(payment.status, verified.status);
      db.prepare(`UPDATE payments SET status = ?, provider_reference = COALESCE(?, provider_reference), metadata = COALESCE(?, metadata), paid_at = CASE WHEN ? = 'PAID' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(verified.status, verified.providerReference ?? null, verified.metadata ? JSON.stringify(verified.metadata) : null, verified.status, payment.id);
      writeAuditLog(db, { action: 'payment_verified', entityType: 'payment', entityId: payload.paymentId, details: { to: verified.status } });
      return { success: true, data: verified };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown payment verification error' };
    }
  });
}
