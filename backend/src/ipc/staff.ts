import { ipcMain } from 'electron';
import { getDB } from '../db';
import { assertCurrentPermission, ROLES, setCurrentRole, setCurrentStaffId } from '../services/authz';
import { writeAuditLog } from '../services/audit';
import { generateSalt, hashPin, verifyPin } from '../services/passwords';
import { asText } from './text';

interface StaffRow {
  id: number;
  name: string;
  role: string;
  is_active: number;
  pin: string | null;
  pin_hash: string | null;
  pin_salt: string | null;
}

/** Public staff row — never expose PIN material to the renderer. */
function publicStaff(row: StaffRow): { id: number; name: string; role: string; is_active: number } {
  return { id: row.id, name: row.name, role: row.role, is_active: row.is_active };
}

function staffPinMatches(row: StaffRow, candidate: string): boolean {
  if (row.pin_hash && row.pin_salt) {
    return verifyPin(candidate, row.pin_salt, row.pin_hash);
  }
  // Legacy pre-hash row: compare the plaintext column.
  return row.pin !== null && row.pin === candidate;
}

/** Migrate a legacy plaintext-PIN row to the hashed form after a successful login. */
function migrateToHashedPin(db: ReturnType<typeof getDB>, staffId: number, pin: string): void {
  const salt = generateSalt();
  db.prepare('UPDATE staff SET pin_hash = ?, pin_salt = ?, pin = NULL WHERE id = ?')
    .run(hashPin(pin, salt), salt, staffId);
}

function applyHashedPin(db: ReturnType<typeof getDB>, staffId: number, pin: string): void {
  const salt = generateSalt();
  db.prepare('UPDATE staff SET pin_hash = ?, pin_salt = ?, pin = NULL WHERE id = ?')
    .run(hashPin(pin, salt), salt, staffId);
}

export function registerStaffIPC() {
  ipcMain.handle('staff:login', async (_event, payload: { pin: unknown }) => {
    try {
      const db = getDB();
      const candidate = asText(payload.pin);
      const rows = db.prepare('SELECT id, name, role, is_active, pin, pin_hash, pin_salt FROM staff WHERE is_active = 1').all() as StaffRow[];
      const user = rows.find(r => staffPinMatches(r, candidate));
      if (user) {
        setCurrentRole(user.role);
        setCurrentStaffId(user.id);
        if (!user.pin_hash) {
          migrateToHashedPin(db, user.id, candidate);
        }
        writeAuditLog(db, { action: 'login', entityType: 'staff', entityId: user.id, details: { success: true } });
        return { success: true, data: publicStaff(user) };
      }
      writeAuditLog(db, { action: 'login_failed', entityType: 'staff', details: { success: false } });
      return { success: false, error: 'Invalid PIN' };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('staff:logout', async () => {
    try {
      const db = getDB();
      writeAuditLog(db, { action: 'logout', entityType: 'staff' });
      setCurrentRole(null);
      setCurrentStaffId(null);
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('staff:getAll', async () => {
    try {
      assertCurrentPermission('staff');
      const db = getDB();
      const staff = (db.prepare('SELECT id, name, role, is_active FROM staff ORDER BY is_active DESC, name').all() as StaffRow[]).map(publicStaff);
      return { success: true, data: staff };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('staff:upsert', async (_event, payload: { id?: number, name: unknown, pin: unknown, role: unknown }) => {
    try {
      assertCurrentPermission('staff');
      const role = asText(payload.role).toLowerCase();
      if (!(ROLES as readonly string[]).includes(role)) { throw new Error(`Invalid role: ${role}`); }
      const name = asText(payload.name).trim();
      if (!name) { throw new Error('Name is required'); }
      const pin = asText(payload.pin);
      if (pin.length < 4 || pin.length > 10) { throw new Error('PIN must be 4-10 characters'); }
      const db = getDB();
      const salt = generateSalt();
      const pinHash = hashPin(pin, salt);
      if (payload.id) {
        const stmt = db.prepare('UPDATE staff SET name = ?, role = ?, pin_hash = ?, pin_salt = ?, pin = NULL WHERE id = ?');
        const info = stmt.run(name, role, pinHash, salt, payload.id);
        if (info.changes === 0) { throw new Error('Staff not found'); }
        writeAuditLog(db, { action: 'update', entityType: 'staff', entityId: payload.id, details: { name, role } });
        return { success: true, data: { id: payload.id } };
      }
      const stmt = db.prepare('INSERT INTO staff (name, role, pin_hash, pin_salt, pin) VALUES (?, ?, ?, ?, NULL)');
      const info = stmt.run(name, role, pinHash, salt);
      const id = Number(info.lastInsertRowid);
      writeAuditLog(db, { action: 'create', entityType: 'staff', entityId: id, details: { name, role } });
      return { success: true, data: { id } };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('staff:delete', async (_event, payload: { id: number }) => {
    try {
      assertCurrentPermission('staff');
      const db = getDB();
      const stmt = db.prepare('UPDATE staff SET is_active = 0 WHERE id = ?');
      const info = stmt.run(payload.id);
      if (info.changes > 0) {
        writeAuditLog(db, { action: 'deactivate', entityType: 'staff', entityId: payload.id });
        return { success: true };
      }
      return { success: false, error: 'Staff not found' };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });

  ipcMain.handle('staff:changePin', async (_event, payload: { id: number, currentPin: unknown, newPin: unknown }) => {
    try {
      const db = getDB();
      const user = db.prepare('SELECT id, pin, pin_hash, pin_salt FROM staff WHERE id = ?').get(payload.id) as Pick<StaffRow, 'id' | 'pin' | 'pin_hash' | 'pin_salt'> | undefined;
      if (!user) { return { success: false, error: 'User not found' }; }
      const currentPin = asText(payload.currentPin);
      const currentMatches = user.pin_hash && user.pin_salt
        ? verifyPin(currentPin, user.pin_salt, user.pin_hash)
        : user.pin === currentPin;
      if (!currentMatches) { return { success: false, error: 'Current PIN is incorrect' }; }
      const newPin = asText(payload.newPin);
      if (newPin.length < 4 || newPin.length > 10) { return { success: false, error: 'PIN must be 4-10 characters' }; }
      applyHashedPin(db, payload.id, newPin);
      writeAuditLog(db, { action: 'pin_changed', entityType: 'staff', entityId: payload.id });
      return { success: true };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  });
}
