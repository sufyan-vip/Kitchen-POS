import type Database from 'better-sqlite3';
import { getCurrentRole } from './authz';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: number | null;
  details?: Record<string, unknown>;
  actorRole?: string | null;
}

export function writeAuditLog(db: Database.Database, entry: AuditEntry): void {
  db.prepare(`
    INSERT INTO audit_logs (action, entity_type, entity_id, actor_role, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    entry.action,
    entry.entityType,
    entry.entityId ?? null,
    entry.actorRole ?? getCurrentRole(),
    entry.details ? JSON.stringify(entry.details) : null,
  );
}

export function readAuditLogs(db: Database.Database, limit = 100): Array<{
  id: number;
  action: string;
  entity_type: string;
  entity_id: number | null;
  actor_role: string | null;
  details: string | null;
  created_at: string;
}> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  return db.prepare(`
    SELECT id, action, entity_type, entity_id, actor_role, details, created_at
    FROM audit_logs
    WHERE entity_type IN ('category', 'menu_item', 'menu_item_variant', 'modifier_group', 'modifier', 'dining_area', 'table')
    ORDER BY id DESC
    LIMIT ?
  `).all(safeLimit) as Array<{
    id: number;
    action: string;
    entity_type: string;
    entity_id: number | null;
    actor_role: string | null;
    details: string | null;
    created_at: string;
  }>;
}
