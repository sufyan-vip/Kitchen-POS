export const DEFAULT_CURRENCY = 'PKR';

export function toMinorUnits(amount: number | string): number {
  if (typeof amount === 'number' && !Number.isFinite(amount)) {
    throw new Error('Invalid monetary amount');
  }
  const normalized = (typeof amount === 'number' ? amount.toFixed(4) : amount).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{0,4})?$/.test(normalized)) {
    throw new Error(`Invalid monetary amount: ${amount}`);
  }
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ''] = unsigned.split('.');
  const padded = (`${fraction  }000`).slice(0, 3);
  const thirdDigit = Number(padded.slice(2, 3) || '0');
  let minor = Number(whole || '0') * 100 + Number(padded.slice(0, 2));
  if (thirdDigit >= 5) {minor += 1;}
  return negative ? -minor : minor;
}

export function fromMinorUnits(minor: number): number {
  return Math.round(minor) / 100;
}

function formatMajor(major: number, currency: string, locale: string): string {
  if (currency === 'PKR') {
    return `Rs ${major.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(major);
}

/**
 * Format an integer minor-unit (paisa) amount.
 * This is the form every stored `*_minor` column uses.
 */
export function formatCurrencyMinor(minor: number, currency = DEFAULT_CURRENCY, locale = 'en-PK'): string {
  return formatMajor(fromMinorUnits(minor), currency, locale);
}

/**
 * Format a major-unit (rupee) amount.
 *
 * This used to guess: an integer argument was read as *minor* units while a
 * decimal was read as *major* units. Receipts pass rupee values, so a bill of
 * Rs 1,700.00 printed as "Rs 17" while Rs 1,700.50 printed correctly. The unit
 * is now explicit — use formatCurrencyMinor() for paisa.
 */
export function formatCurrency(amount: number | string, currency = DEFAULT_CURRENCY, locale = 'en-PK'): string {
  return formatMajor(fromMinorUnits(toMinorUnits(amount)), currency, locale);
}
