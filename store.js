/**
 * Persistent storage for the Lead Agent SaaS app.
 *
 * This module keeps the core SaaS records in SQLite so they survive process
 * restarts and are cheaply queryable from the dashboard and admin APIs.
 */

function loadDatabaseClass() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    if (typeof DatabaseSync === 'function') {
      return DatabaseSync;
    }
  } catch (error) {
    // Node 22+ exposes the built-in SQLite module. The native better-sqlite3
    // package can fail hard on older Linux images, so we avoid loading it unless
    // the runtime itself does not provide a safe SQLite implementation.
  }

  try {
    const BetterSqlite3 = require('better-sqlite3');
    if (typeof BetterSqlite3 === 'function') {
      return BetterSqlite3;
    }
  } catch (error) {
    // This is intentionally left as a last resort; the project targets Node 22,
    // where the built-in SQLite API is available and much more stable.
  }

  throw new Error('No supported SQLite implementation is available for this runtime.');
}

const Database = loadDatabaseClass();
const db = new Database(process.env.DB_PATH || './data.db');

if (typeof db.pragma === 'function') {
  db.pragma('journal_mode = WAL');
} else {
  db.exec('PRAGMA journal_mode = WAL');
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
    role TEXT NOT NULL DEFAULT 'user',
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscription (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    plan TEXT NOT NULL DEFAULT 'none',
    billing_type TEXT,
    paypal_subscription_id TEXT,
    status TEXT NOT NULL DEFAULT 'inactive',
    current_period_end TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS compliance_clients (
    client_key TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active',
    violation_count INTEGER NOT NULL DEFAULT 0,
    verified_payment_reference TEXT,
    verified_payment_amount REAL,
    verified_payment_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS compliance_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_key TEXT NOT NULL,
    categories TEXT NOT NULL,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS compliance_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    client_key TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payment_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    reference TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    raw_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(provider, transaction_id)
  );
`);

const stmts = {
  insertPending: db.prepare('INSERT OR REPLACE INTO pending_leads (ref, name, email, phone) VALUES (?, ?, ?, ?)'),
  getPending: db.prepare('SELECT name, email, phone FROM pending_leads WHERE ref = ?'),
  deletePending: db.prepare('DELETE FROM pending_leads WHERE ref = ?'),
  insertReport: db.prepare('INSERT OR REPLACE INTO completed_reports (ref, report_json) VALUES (?, ?)'),
  getReport: db.prepare('SELECT report_json FROM completed_reports WHERE ref = ?'),
  listReports: db.prepare('SELECT ref, report_json, created_at FROM completed_reports ORDER BY created_at DESC'),
  upsertFollowup: db.prepare(`
    INSERT INTO followups (ref, status, notes, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(ref) DO UPDATE SET status = excluded.status, notes = excluded.notes, updated_at = datetime('now')
  `),
  getFollowup: db.prepare('SELECT status, notes, updated_at FROM followups WHERE ref = ?'),
  insertUser: db.prepare('INSERT INTO users (username, password_hash, totp_secret, role) VALUES (?, ?, ?, ?)'),
  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
  enableTotp: db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?'),
  setRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
  getSubscription: db.prepare('SELECT * FROM subscription WHERE id = 1'),
  upsertSubscription: db.prepare(`
    INSERT INTO subscription (id, plan, billing_type, paypal_subscription_id, status, current_period_end, updated_at)
    VALUES (1, @plan, @billingType, @paypalSubscriptionId, @status, @currentPeriodEnd, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      plan = @plan,
      billing_type = @billingType,
      paypal_subscription_id = @paypalSubscriptionId,
      status = @status,
      current_period_end = @currentPeriodEnd,
      updated_at = datetime('now')
  `),
  upsertClient: db.prepare(`
    INSERT INTO compliance_clients (
      client_key, status, violation_count, verified_payment_reference, verified_payment_amount, verified_payment_at, updated_at
    ) VALUES (@clientKey, @status, @violationCount, @verifiedPaymentReference, @verifiedPaymentAmount, @verifiedPaymentAt, datetime('now'))
    ON CONFLICT(client_key) DO UPDATE SET
      status = excluded.status,
      violation_count = excluded.violation_count,
      verified_payment_reference = excluded.verified_payment_reference,
      verified_payment_amount = excluded.verified_payment_amount,
      verified_payment_at = excluded.verified_payment_at,
      updated_at = datetime('now')
  `),
  getClient: db.prepare('SELECT * FROM compliance_clients WHERE client_key = ?'),
  insertIncident: db.prepare('INSERT INTO compliance_incidents (client_key, categories, summary, status) VALUES (?, ?, ?, ?)'),
  listIncidents: db.prepare('SELECT * FROM compliance_incidents WHERE client_key = ? ORDER BY created_at DESC'),
  insertAudit: db.prepare('INSERT INTO compliance_audit (event_type, client_key, details) VALUES (?, ?, ?)'),
  listAudit: db.prepare('SELECT * FROM compliance_audit ORDER BY created_at DESC'),
  insertPayment: db.prepare(`
    INSERT OR IGNORE INTO payment_transactions
      (provider, transaction_id, reference, amount, currency, status, raw_json)
    VALUES (@provider, @transactionId, @reference, @amount, @currency, @status, @rawJson)
  `),
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

const payments = {
  record({ provider, transactionId, reference, amount, currency, status = 'confirmed', raw }) {
    const result = stmts.insertPayment.run({
      provider,
      transactionId,
      reference,
      amount: Number(amount),
      currency,
      status,
      rawJson: raw ? JSON.stringify(raw) : null,
    });
    return result.changes === 1;
  },
};

const leads = {
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

const users = {
  create(username, passwordHash, totpSecret, role = 'user') {
    const info = stmts.insertUser.run(username, passwordHash, totpSecret, role);
    return Number(info.lastInsertRowid);
  },
  findByUsername(username) {
    return stmts.getUserByUsername.get(username);
  },
  findById(id) {
    return stmts.getUserById.get(id);
  },
  count() {
    return Number(stmts.countUsers.get().n);
  },
  enableTotp(id) {
    stmts.enableTotp.run(id);
  },
  setRole(id, role) {
    stmts.setRole.run(role, id);
  },
};

const subscription = {
  get() {
    const row = stmts.getSubscription.get();
    if (!row) {
      return { plan: 'none', status: 'inactive', billingType: null, paypalSubscriptionId: null, currentPeriodEnd: null };
    }
    return {
      plan: row.plan,
      status: row.status,
      billingType: row.billing_type,
      paypalSubscriptionId: row.paypal_subscription_id,
      currentPeriodEnd: row.current_period_end,
    };
  },
  set({ plan, billingType, paypalSubscriptionId, status, currentPeriodEnd }) {
    stmts.upsertSubscription.run({
      plan,
      billingType: billingType || null,
      paypalSubscriptionId: paypalSubscriptionId || null,
      status,
      currentPeriodEnd: currentPeriodEnd || null,
    });
  },
};

const compliance = {
  getClient(clientKey) {
    const row = stmts.getClient.get(clientKey);
    if (!row) return null;
    return {
      clientKey: row.client_key,
      status: row.status,
      violationCount: Number(row.violation_count),
      verifiedPaymentReference: row.verified_payment_reference,
      verifiedPaymentAmount: row.verified_payment_amount,
      verifiedPaymentAt: row.verified_payment_at,
    };
  },
  listAudit() {
    return stmts.listAudit.all();
  },
  recordViolation(clientKey, categories, summary = '') {
    const current = stmts.getClient.get(clientKey) || {
      client_key: clientKey,
      status: 'active',
      violation_count: 0,
      verified_payment_reference: null,
      verified_payment_amount: null,
      verified_payment_at: null,
    };
    const violationCount = Number(current.violation_count || 0) + 1;
    const status = violationCount >= 2 ? 'suspended' : 'active';

    stmts.upsertClient.run({
      clientKey,
      status,
      violationCount,
      verifiedPaymentReference: current.verified_payment_reference || null,
      verifiedPaymentAmount: current.verified_payment_amount || null,
      verifiedPaymentAt: current.verified_payment_at || null,
    });

    const incidentId = Number(stmts.insertIncident.run(clientKey, JSON.stringify(categories), summary, status === 'suspended' ? 'suspended' : 'open').lastInsertRowid);
    stmts.insertAudit.run('violation-recorded', clientKey, JSON.stringify({ incidentId, categories, violationCount, status }));

    return { incidentId, violationCount, status };
  },
  recordVerifiedPayment(clientKey, reference, amount = 0) {
    const client = stmts.getClient.get(clientKey) || { client_key: clientKey, status: 'active', violation_count: 0 };
    stmts.upsertClient.run({
      clientKey,
      status: client.status === 'suspended' ? 'suspended' : 'active',
      violationCount: Number(client.violation_count || 0),
      verifiedPaymentReference: reference,
      verifiedPaymentAmount: amount,
      verifiedPaymentAt: new Date().toISOString(),
    });
    stmts.insertAudit.run('payment-verified', clientKey, JSON.stringify({ reference, amount }));
    return this.getClient(clientKey);
  },
  reinstate(clientKey) {
    const client = this.getClient(clientKey);
    if (!client) return { ok: false, reason: 'unknown-client' };
    if (!client.verifiedPaymentReference) {
      return { ok: false, reason: 'payment-not-verified' };
    }

    stmts.upsertClient.run({
      clientKey,
      status: 'active',
      violationCount: client.violationCount,
      verifiedPaymentReference: client.verifiedPaymentReference,
      verifiedPaymentAmount: client.verifiedPaymentAmount,
      verifiedPaymentAt: client.verifiedPaymentAt,
    });
    stmts.insertAudit.run('reinstate', clientKey, JSON.stringify({ reference: client.verifiedPaymentReference }));
    return { ok: true };
  },
};

function createSessionStore(sessionLib) {
  const SQLiteStore = require('connect-sqlite3')(sessionLib || require('express-session'));
  return new SQLiteStore({ db: process.env.SESSION_DB_PATH || 'sessions.sqlite' });
}

module.exports = {
  pendingLeads,
  completedReports,
  payments,
  leads,
  users,
  subscription,
  compliance,
  createSessionStore,
};
