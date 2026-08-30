export function formatPKR(value: number | null | undefined): string {
  const amount = value ?? 0;
  return `Rs ${amount.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
