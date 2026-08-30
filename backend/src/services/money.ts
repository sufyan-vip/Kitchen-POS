/* eslint-disable */
export const DEFAULT_CURRENCY = 'PKR';

export function toMinorUnits(amount: number | string): number {
  if (typeof amount === 'number' && !Number.isFinite(amount)) {
    throw new Error('Invalid monetary amount');
  }
  const normalized = (typeof amount === 'number' ? amount.toFixed(4) : String(amount)).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{0,4})?$/.test(normalized)) {
    throw new Error(`Invalid monetary amount: ${amount}`);
  }
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ''] = unsigned.split('.');
  const padded = (`${fraction  }000`).slice(0, 3);
  const thirdDigit = Number(padded[2] ?? '0');
  let minor = Number(whole || '0') * 100 + Number(padded.slice(0, 2));
  if (thirdDigit >= 5) {minor += 1;}
  return negative ? -minor : minor;
}

export function fromMinorUnits(minor: number): number {
  return Math.round(minor) / 100;
}

export function formatCurrency(amount: number | string, currency = DEFAULT_CURRENCY, locale = 'en-PK'): string {
  const minor = typeof amount === 'number' && Number.isInteger(amount) ? amount : toMinorUnits(amount);
  const major = fromMinorUnits(minor);
  if (currency === 'PKR') {
    return `Rs ${major.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(major);
}
