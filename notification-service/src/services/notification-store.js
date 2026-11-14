import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class NotificationStore {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS notifications (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        payment_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        message TEXT NOT NULL,
        processed_at TEXT NOT NULL
      );`);
  }
  record(event, message) {
    const result = this.db.prepare(`INSERT INTO notifications(event_id,payment_id,event_type,message,processed_at)
      VALUES(?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING`).run(
      event.eventId, event.paymentId, event.eventType, message, new Date().toISOString());
    return result.changes === 1;
  }
  list(paymentId, limit = 100) {
    if (paymentId) return this.db.prepare(`SELECT event_id AS eventId,payment_id AS paymentId,event_type AS eventType,
      message,processed_at AS processedAt FROM notifications WHERE payment_id=? ORDER BY sequence LIMIT ?`).all(paymentId, limit);
    return this.db.prepare(`SELECT event_id AS eventId,payment_id AS paymentId,event_type AS eventType,
      message,processed_at AS processedAt FROM notifications ORDER BY sequence DESC LIMIT ?`).all(limit);
  }
  healthy() { this.db.prepare('SELECT 1').get(); return true; }
  close() { this.db.close(); }
}
