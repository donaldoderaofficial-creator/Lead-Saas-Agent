/**
 * Persistent storage for leads/reports, backed by SQLite.
 * Replaces the in-memory Maps — survives restarts and crashes.
 *
 * DB file location is configurable via DB_PATH (defaults to ./data.db).
 * For most single-server deployments this is sufficient; move to
 * Postgres only if you outgrow a single file (e.g. multiple app instances).
 */

const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || './data.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS pending_leads (
    ref TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS completed_reports (
    ref TEXT PRIMARY KEY,
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS followups (
    ref TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'new',
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    totp_secret TEXT NOT NULL,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const stmts = {
  insertPending: db.prepare(
    'INSERT OR REPLACE INTO pending_leads (ref, name, email, phone) VALUES (?, ?, ?, ?)'
  ),
  getPending: db.prepare('SELECT name, email, phone FROM pending_leads WHERE ref = ?'),
  deletePending: db.prepare('DELETE FROM pending_leads WHERE ref = ?'),
  insertReport: db.prepare(
    'INSERT OR REPLACE INTO completed_reports (ref, report_json) VALUES (?, ?)'
  ),
  getReport: db.prepare('SELECT report_json FROM completed_reports WHERE ref = ?'),
  listReports: db.prepare(
    'SELECT ref, report_json, created_at FROM completed_reports ORDER BY created_at DESC'
  ),
  upsertFollowup: db.prepare(`
    INSERT INTO followups (ref, status, notes, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(ref) DO UPDATE SET status = excluded.status, notes = excluded.notes, updated_at = datetime('now')
  `),
  getFollowup: db.prepare('SELECT status, notes, updated_at FROM followups WHERE ref = ?'),
  insertUser: db.prepare(
    'INSERT INTO users (username, password_hash, totp_secret) VALUES (?, ?, ?)'
  ),
  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  getUserById: db.prepare('SELECT id, username, totp_enabled FROM users WHERE id = ?'),
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
  enableTotp: db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?'),
};

const pendingLeads = {
  set(ref, lead) {
    stmts.insertPending.run(ref, lead.name, lead.email, lead.phone || null);
  },
  get(ref) {
    const row = stmts.getPending.get(ref);
    if (!row) return undefined;
    return { name: row.name, email: row.email, ...(row.phone ? { phone: row.phone } : {}) };
  },
  has(ref) {
    return !!stmts.getPending.get(ref);
  },
  delete(ref) {
    stmts.deletePending.run(ref);
  },
};

const completedReports = {
  set(ref, report) {
    stmts.insertReport.run(ref, JSON.stringify(report));
  },
  get(ref) {
    const row = stmts.getReport.get(ref);
    return row ? JSON.parse(row.report_json) : undefined;
  },
  has(ref) {
    return !!stmts.getReport.get(ref);
  },
};

const leads = {
  // All completed leads, most recent first, merged with follow-up status/notes.
  listAll() {
    return stmts.listReports.all().map((row) => {
      const report = JSON.parse(row.report_json);
      const followup = stmts.getFollowup.get(row.ref) || { status: 'new', notes: '', updated_at: null };
      return {
        ref: row.ref,
        createdAt: row.created_at,
        name: report.result.name,
        email: report.result.email,
        company: report.result.company,
        score: report.result.score,
        path: report.result.path,
        recommendedNextStep: report.premium?.recommendedNextStep,
        followupStatus: followup.status,
        followupNotes: followup.notes,
        followupUpdatedAt: followup.updated_at,
      };
    });
  },
  setFollowup(ref, status, notes) {
    stmts.upsertFollowup.run(ref, status, notes || '');
  },
};

module.exports = { pendingLeads, completedReports, leads, users: {
  create(username, passwordHash, totpSecret) {
    const info = stmts.insertUser.run(username, passwordHash, totpSecret);
    return info.lastInsertRowid;
  },
  findByUsername(username) {
    return stmts.getUserByUsername.get(username);
  },
  findById(id) {
    return stmts.getUserById.get(id);
  },
  count() {
    return stmts.countUsers.get().n;
  },
  enableTotp(id) {
    stmts.enableTotp.run(id);
  },
} };
