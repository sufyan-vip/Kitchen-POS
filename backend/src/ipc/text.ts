/**
 * Runtime coercion for renderer-supplied text fields.
 *
 * IPC payloads are declared with `unknown` for free-text fields because the
 * boundary is not type-checked at runtime (a compromised/older renderer could
 * send anything). This helper safely flattens the values the renderer actually
 * sends (strings, and numbers/booleans for legacy callers) and rejects exotic
 * types (objects, null) as empty strings so downstream validation rejects them.
 */
export function asText(value: unknown): string {
  if (typeof value === 'string') { return value; }
  if (typeof value === 'number' || typeof value === 'boolean') { return String(value); }
  return '';
}
