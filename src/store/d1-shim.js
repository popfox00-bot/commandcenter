// A D1-compatible facade over node:sqlite so shared/sql-store.js runs unchanged locally and in tests.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../worker/migrations');

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? Number(a) : a))); }
  _exec() {
    const stmt = this.db.prepare(this.sql);
    if (/^\s*(SELECT|WITH)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) {
      const rows = stmt.all(...this.args).map((r) => ({ ...r }));
      return { results: rows, success: true, meta: { changes: /^\s*(SELECT|WITH)\b/i.test(this.sql) ? 0 : rows.length } };
    }
    const info = stmt.run(...this.args);
    return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
  async all() { return this._exec(); }
  async run() { return this._exec(); }
  async first(col) {
    const row = this._exec().results[0] ?? null;
    return col && row ? row[col] : row;
  }
}

export class D1Shim {
  constructor(path = ':memory:') { this.db = new DatabaseSync(path); this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;'); }
  prepare(sql) { return new Statement(this.db, sql); }
  async batch(stmts) {
    this.db.exec('BEGIN');
    try {
      const out = stmts.map((s) => s._exec());
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
  async exec(sql) { this.db.exec(sql); return { count: 1 }; }
  migrate(dir = MIGRATIONS_DIR) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) this.db.exec(readFileSync(join(dir, f), 'utf8'));
    return this;
  }
  close() { this.db.close(); }
}
