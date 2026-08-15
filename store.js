/**
 * Persistent storage for leads/reports, backed by SQLite.
 * Replaces the in-memory Maps — survives restarts and crashes.
 *
 * DB file location is configurable via DB_PATH (defaults to ./data.db).
 * For most single-server deployments this is sufficient; move to
 * Postgres only if you outgrow a single file (e.g. multiple app instances).
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(process.env.DB_PATH || './data.db');
db.pragma('journal_mode = WAL');

function addColumnIfMissing(table, definition) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}

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

  CREATE TABLE IF NOT EXISTS compliance_clients (
    client_key TEXT PRIMARY KEY,
    violation_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    suspension_reason TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS compliance_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_key TEXT NOT NULL,
    categories_json TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    reviewer_id INTEGER,
    review_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS compliance_payments (
    client_key TEXT PRIMARY KEY,
    payment_reference TEXT NOT NULL,
    verified_by INTEGER NOT NULL,
    verified_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_sessions (
    sid TEXT PRIMARY KEY,
    session_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS compliance_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    event_type TEXT NOT NULL,
    client_key TEXT,
    incident_id INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS compliance_legal_reviews (
    incident_id INTEGER PRIMARY KEY,
    decision TEXT NOT NULL,
    legal_reviewer_id INTEGER NOT NULL,
    legal_reference TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

addColumnIfMissing('users', "role TEXT NOT NULL DEFAULT 'analyst'");
db.prepare("UPDATE users SET role = 'owner' WHERE id = (SELECT MIN(id) FROM users) AND role = 'analyst'").run();
db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)').run();

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
  getUserById: db.prepare('SELECT id, username, totp_enabled, role FROM users WHERE id = ?'),
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
  enableTotp: db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?'),
  updateUserRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
  getComplianceClient: db.prepare('SELECT * FROM compliance_clients WHERE client_key = ?'),
  upsertComplianceClient: db.prepare(`
    INSERT INTO compliance_clients (client_key, violation_count, status, suspension_reason, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(client_key) DO UPDATE SET
      violation_count = excluded.violation_count,
      status = excluded.status,
      suspension_reason = excluded.suspension_reason,
      updated_at = excluded.updated_at
  `),
  insertComplianceIncident: db.prepare(
    'INSERT INTO compliance_incidents (client_key, categories_json, excerpt) VALUES (?, ?, ?)'
  ),
  listComplianceIncidents: db.prepare(
    'SELECT * FROM compliance_incidents ORDER BY created_at DESC LIMIT 100'
  ),
  getComplianceIncident: db.prepare('SELECT * FROM compliance_incidents WHERE id = ?'),
  reviewComplianceIncident: db.prepare(`
    UPDATE compliance_incidents
    SET status = ?, reviewer_id = ?, review_notes = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `),
  getCompliancePayment: db.prepare('SELECT * FROM compliance_payments WHERE client_key = ?'),
  upsertCompliancePayment: db.prepare(`
    INSERT INTO compliance_payments (client_key, payment_reference, verified_by, verified_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(client_key) DO UPDATE SET
      payment_reference = excluded.payment_reference,
      verified_by = excluded.verified_by,
      verified_at = excluded.verified_at
  `),
  insertAudit: db.prepare(
    'INSERT INTO compliance_audit_log (actor_id, event_type, client_key, incident_id, metadata_json) VALUES (?, ?, ?, ?, ?)'
  ),
  listAudit: db.prepare('SELECT * FROM compliance_audit_log ORDER BY created_at DESC LIMIT 200'),
  getLegalReview: db.prepare('SELECT * FROM compliance_legal_reviews WHERE incident_id = ?'),
  upsertLegalReview: db.prepare(`
    INSERT INTO compliance_legal_reviews (incident_id, decision, legal_reviewer_id, legal_reference, notes, reviewed_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(incident_id) DO UPDATE SET
      decision = excluded.decision,
      legal_reviewer_id = excluded.legal_reviewer_id,
      legal_reference = excluded.legal_reference,
      notes = excluded.notes,
      reviewed_at = excluded.reviewed_at
  `),
  getSession: db.prepare('SELECT session_json FROM app_sessions WHERE sid = ? AND expires_at > ?'),
  setSession: db.prepare(`
    INSERT INTO app_sessions (sid, session_json, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(sid) DO UPDATE SET session_json = excluded.session_json, expires_at = excluded.expires_at
  `),
  deleteSession: db.prepare('DELETE FROM app_sessions WHERE sid = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM app_sessions WHERE expires_at <= ?'),
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

const compliance = {
  getClient(clientKey) {
    return stmts.getComplianceClient.get(clientKey);
  },
  recordViolation(clientKey, categories, excerpt) {
    const existing = stmts.getComplianceClient.get(clientKey);
    const violationCount = (existing?.violation_count || 0) + 1;
    const status = violationCount >= 2 ? 'suspended' : 'warning';
    const reason = status === 'suspended' ? 'Repeated safety-policy violations require administrator review.' : null;
    stmts.upsertComplianceClient.run(clientKey, violationCount, status, reason);
    const incident = stmts.insertComplianceIncident.run(clientKey, JSON.stringify(categories), excerpt);
    const incidentId = Number(incident.lastInsertRowid);
    stmts.insertAudit.run(null, 'violation-recorded', clientKey, incidentId, JSON.stringify({ categories, violationCount, status }));
    return { incidentId, violationCount, status };
  },
  listIncidents() {
    return stmts.listComplianceIncidents.all().map((row) => ({
      ...row,
      categories: JSON.parse(row.categories_json),
    }));
  },
  getIncident(id) {
    const row = stmts.getComplianceIncident.get(id);
    return row ? { ...row, categories: JSON.parse(row.categories_json) } : undefined;
  },
  reviewIncident(id, status, reviewerId, notes) {
    stmts.reviewComplianceIncident.run(status, reviewerId, notes || '', id);
    stmts.insertAudit.run(reviewerId, 'incident-reviewed', null, id, JSON.stringify({ status, notes: notes || '' }));
  },
  recordLegalReview(incidentId, decision, reviewerId, legalReference, notes) {
    stmts.upsertLegalReview.run(incidentId, decision, reviewerId, legalReference, notes || '');
    stmts.insertAudit.run(reviewerId, 'legal-review-recorded', null, incidentId, JSON.stringify({ decision, legalReference }));
  },
  recordVerifiedPayment(clientKey, paymentReference, verifiedBy) {
    stmts.upsertCompliancePayment.run(clientKey, paymentReference, verifiedBy);
    stmts.insertAudit.run(verifiedBy, 'payment-verified', clientKey, null, JSON.stringify({ paymentReference }));
  },
  reinstate(clientKey) {
    const existing = stmts.getComplianceClient.get(clientKey);
    if (!existing) return { ok: false, reason: 'unknown-client' };
    if (!stmts.getCompliancePayment.get(clientKey)) {
      return { ok: false, reason: 'payment-not-verified' };
    }
    stmts.upsertComplianceClient.run(clientKey, existing.violation_count, 'active', null);
    return { ok: true };
  },
  audit(actorId, eventType, clientKey, incidentId, metadata = {}) {
    stmts.insertAudit.run(actorId || null, eventType, clientKey || null, incidentId || null, JSON.stringify(metadata));
  },
  listAudit() {
    return stmts.listAudit.all().map((row) => ({ ...row, metadata: JSON.parse(row.metadata_json) }));
  },
  getLegalReview(incidentId) {
    return stmts.getLegalReview.get(incidentId);
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

function createSessionStore(session) {
  return new class SqliteSessionStore extends session.Store {
    get(sid, callback) {
      try {
        const row = stmts.getSession.get(sid, Date.now());
        callback(null, row ? JSON.parse(row.session_json) : null);
      } catch (err) { callback(err); }
    }
    set(sid, value, callback = () => {}) {
      try {
        const expiresAt = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000;
        stmts.setSession.run(sid, JSON.stringify(value), expiresAt);
        stmts.deleteExpiredSessions.run(Date.now());
        callback(null);
      } catch (err) { callback(err); }
    }
    destroy(sid, callback = () => {}) {
      try { stmts.deleteSession.run(sid); callback(null); } catch (err) { callback(err); }
    }
    touch(sid, value, callback = () => {}) { this.set(sid, value, callback); }
  }();
}

async function backupDatabase(directory) {
  if (!directory) return null;
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, `lead-agent-${new Date().toISOString().slice(0, 10)}.db`);
  await db.backup(filename);
  return filename;
}

module.exports = { pendingLeads, completedReports, leads, compliance, createSessionStore, backupDatabase, users: {
  create(username, passwordHash, totpSecret, role) {
    const info = db.prepare('INSERT INTO users (username, password_hash, totp_secret, role) VALUES (?, ?, ?, ?)').run(username, passwordHash, totpSecret, role);
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
  setRole(id, role) {
    stmts.updateUserRole.run(role, id);
  },
} };
