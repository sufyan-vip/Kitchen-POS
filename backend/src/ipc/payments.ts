import { ipcMain } from 'electron';
import { getDB } from '../db';
import { assertCurrentPermission } from '../services/authz';
import { assertValidPaymentTransition, getPaymentProvider, PaymentStatus } from '../services/payments';

export function registerPaymentsIPC() {
  ipcMain.handle('payments:updateStatus', async (_, payload: { paymentId: number; status: PaymentStatus; providerReference?: string; failureReason?: string; metadata?: Record<string, unknown> }) => {
    try {
      assertCurrentPermission(payload.status === 'REFUNDED' ? 'refunds' : 'payments');
      const db = getDB();
      const existing = db.prepare('SELECT status FROM payments WHERE id = ?').get(payload.paymentId) as { status: PaymentStatus } | undefined;
      if (!existing) {throw new Error('Payment not found');}
      assertValidPaymentTransition(existing.status, payload.status);
      db.prepare(`UPDATE payments SET status = ?, provider_reference = COALESCE(?, provider_reference), failure_reason = ?, metadata = COALESCE(?, metadata), paid_at = CASE WHEN ? = 'PAID' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(payload.status, payload.providerReference ?? null, payload.failureReason ?? null, payload.metadata ? JSON.stringify(payload.metadata) : null, payload.status, payload.paymentId);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown payment status error' };
    }
  });

  ipcMain.handle('payments:verify', async (_, payload: { paymentId: number }) => {
    try {
      assertCurrentPermission('payments');
      const db = getDB();
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(payload.paymentId) as { id: number; provider: string; transaction_reference: string; status: PaymentStatus } | undefined;
      if (!payment) {throw new Error('Payment not found');}
      if (!payment.transaction_reference) {throw new Error('Payment has no transaction reference');}
      const provider = getPaymentProvider(payment.provider);
      if (!provider) {return { success: true, data: { status: payment.status, message: 'Manual/offline provider; no verification adapter required.' } };}
      const verified = await provider.verifyPayment(payment.transaction_reference);
      assertValidPaymentTransition(payment.status, verified.status);
      db.prepare(`UPDATE payments SET status = ?, provider_reference = COALESCE(?, provider_reference), metadata = COALESCE(?, metadata), paid_at = CASE WHEN ? = 'PAID' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(verified.status, verified.providerReference ?? null, verified.metadata ? JSON.stringify(verified.metadata) : null, verified.status, payment.id);
      return { success: true, data: verified };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown payment verification error' };
    }
  });
}
