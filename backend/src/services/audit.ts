import type Database from 'better-sqlite3';
import { getCurrentRole, getCurrentStaffId } from './authz';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: number | null;
  details?: Record<string, unknown>;
  actorRole?: string | null;
  staffId?: number | null;
}

export interface AuditLogRow {
  id: number;
  action: string;
  entity_type: string;
  entity_id: number | null;
  actor_role: string | null;
  staff_id: number | null;
  staff_name: string | null;
  details: string | null;
  created_at: string;
}

export function writeAuditLog(db: Database.Database, entry: AuditEntry): void {
  db.prepare(`
    INSERT INTO audit_logs (action, entity_type, entity_id, actor_role, staff_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    entry.action,
    entry.entityType,
    entry.entityId ?? null,
    entry.actorRole ?? getCurrentRole(),
    entry.staffId ?? getCurrentStaffId(),
    entry.details ? JSON.stringify(entry.details) : null,
  );
}

export interface AuditQuery {
  entityType?: string;
  action?: string;
  limit?: number;
}

export function readAuditLogs(db: Database.Database, query: AuditQuery = {}): AuditLogRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.entityType) {
    conditions.push('entity_type = ?');
    params.push(query.entityType);
  }
  if (query.action) {
    conditions.push('action = ?');
    params.push(query.action);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(Math.trunc(query.limit ?? 100), 1), 1000);
  params.push(safeLimit);
  return db.prepare(`
    SELECT a.id, a.action, a.entity_type, a.entity_id, a.actor_role, a.staff_id, s.name AS staff_name, a.details, a.created_at
    FROM audit_logs a LEFT JOIN staff s ON s.id = a.staff_id
    ${where} ORDER BY a.id DESC LIMIT ?
  `).all(...params) as AuditLogRow[];
}

/** Convenience: single action filter for the report/timeline views. */
export function readAuditLogsByAction(db: Database.Database, action: string, limit = 200): AuditLogRow[] {
  return readAuditLogs(db, { action, limit });
}
