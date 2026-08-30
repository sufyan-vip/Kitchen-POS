import crypto from 'crypto';

export type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | 'EXPIRED';
export type PaymentProviderName = 'cash' | 'card' | 'jazzcash' | 'easypaisa' | 'bank_transfer' | 'other';

const allowedTransitions: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED'],
  AUTHORIZED: ['PAID', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PAID: ['REFUNDED'],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
  EXPIRED: [],
};

export function canTransitionPaymentStatus(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to || allowedTransitions[from].includes(to);
}

export function assertValidPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransitionPaymentStatus(from, to)) {
    throw new Error(`Invalid payment status transition: ${from} -> ${to}`);
  }
}

export interface CreatePaymentRequest {
  orderId: number;
  amountMinor: number;
  currency: string;
  transactionReference?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderPaymentResult {
  status: PaymentStatus;
  transactionReference: string;
  providerReference?: string;
  paymentUrl?: string;
  qrPayload?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentProvider {
  name: PaymentProviderName;
  createPayment(request: CreatePaymentRequest): Promise<ProviderPaymentResult>;
  verifyPayment(transactionReference: string): Promise<ProviderPaymentResult>;
}

function txRef(prefix: string, orderId: number): string {
  return `${prefix}-${orderId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Payment provider adapters.
 *
 * SAFE-SANDBOX DESIGN (deliberate): JazzCash and Easypaisa require official
 * merchant accounts, API credentials, request signing and status callbacks.
 * Until a merchant is configured, adapters here:
 *   - NEVER invent credentials, merchant IDs, signatures or endpoints;
 *   - NEVER fabricate a PAID status — requests stay PENDING with metadata
 *     explaining that the provider is not configured;
 *   - read credentials only from backend environment variables
 *     (JAZZCASH_* / EASYPAISA_*) which are never stored in the database,
 *     settings, or logs.
 * A production integration must be completed from the current official
 * provider documentation (request format, signature scheme, callback
 * verification) — see createPayment()/verifyPayment() below.
 */
abstract class EnvConfiguredProvider implements PaymentProvider {
  abstract name: PaymentProviderName;
  protected mode: string;
  constructor(protected env: NodeJS.ProcessEnv = process.env) {
    this.mode = 'sandbox';
  }
  protected abstract envPrefix: string;
  protected getMode(): string {
    return this.env[`${this.envPrefix}_MODE`] ?? this.mode;
  }
  protected hasCredentials(keys: string[]): boolean {
    return keys.every(k => Boolean(this.env[k]));
  }
  async createPayment(request: CreatePaymentRequest): Promise<ProviderPaymentResult> {
    const transactionReference = request.transactionReference ?? txRef(this.name.toUpperCase(), request.orderId);
    if (!this.hasCredentials(this.requiredCredentialKeys())) {
      return {
        status: 'PENDING',
        transactionReference,
        metadata: {
          mode: this.getMode(),
          configured: false,
          message: `${this.name} merchant credentials are not configured. Use official provider documentation and keep secrets in backend environment variables only.`,
        },
      };
    }
    // Do not invent provider-specific API endpoints/signatures. A real adapter must be completed
    // from current official merchant documentation before production use.
    return {
      status: 'PENDING',
      transactionReference,
      metadata: { mode: this.getMode(), configured: true, message: 'Provider adapter configured; implement official request/signature/status flow before production.' },
    };
  }
  async verifyPayment(transactionReference: string): Promise<ProviderPaymentResult> {
    return {
      status: 'PENDING',
      transactionReference,
      metadata: { mode: this.getMode(), message: 'Awaiting provider-supported status verification/callback.' },
    };
  }
  protected abstract requiredCredentialKeys(): string[];
}

export class JazzCashProvider extends EnvConfiguredProvider {
  name: PaymentProviderName = 'jazzcash';
  protected envPrefix = 'JAZZCASH';
  protected requiredCredentialKeys() {
    return ['JAZZCASH_MERCHANT_ID', 'JAZZCASH_PASSWORD', 'JAZZCASH_INTEGRITY_SALT', 'JAZZCASH_API_URL'];
  }
}

export class EasypaisaProvider extends EnvConfiguredProvider {
  name: PaymentProviderName = 'easypaisa';
  protected envPrefix = 'EASYPAISA';
  protected requiredCredentialKeys() {
    return ['EASYPAISA_STORE_ID', 'EASYPAISA_HASH_KEY', 'EASYPAISA_API_URL'];
  }
}

export function getPaymentProvider(name: string): PaymentProvider | null {
  switch (name) {
    case 'jazzcash': return new JazzCashProvider();
    case 'easypaisa': return new EasypaisaProvider();
    default: return null;
  }
}
