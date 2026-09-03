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
    product TEXT,
    payment_method TEXT,
    plan TEXT,
    amount_crypto TEXT,
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
    crypto_payment_reference TEXT,
    crypto_transaction_id TEXT,
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

  CREATE TABLE IF NOT EXISTS edrms_records (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    record_type TEXT NOT NULL,
    classification TEXT NOT NULL DEFAULT 'internal',
    status TEXT NOT NULL DEFAULT 'draft',
    owner TEXT NOT NULL,
    retention_until TEXT,
    storage_uri TEXT,
    checksum TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS edrms_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor_id INTEGER NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (record_id) REFERENCES edrms_records(id),
    FOREIGN KEY (actor_id) REFERENCES users(id)
  );
`);

for (const column of ['crypto_payment_reference', 'crypto_transaction_id']) {
  try { db.exec(`ALTER TABLE subscription ADD COLUMN ${column} TEXT`); } catch (_) {}
}
for (const column of ['product', 'payment_method', 'plan', 'amount_crypto']) {
  try { db.exec(`ALTER TABLE pending_leads ADD COLUMN ${column} TEXT`); } catch (_) {}
}

const pendingLeads = {
  set(ref, lead) {
    db.prepare('INSERT OR REPLACE INTO pending_leads (ref, name, email, phone, product, payment_method, plan, amount_crypto) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ref, lead.name, lead.email, lead.phone || null, lead.product || null, lead.paymentMethod || null, lead.plan || null, lead.amountCrypto || null);
  },
  get(ref) {
    const row = db.prepare('SELECT name, email, phone, product, payment_method, plan, amount_crypto FROM pending_leads WHERE ref = ?').get(ref);
    if (!row) return undefined;
    return {
      name: row.name,
      email: row.email,
      ...(row.phone ? { phone: row.phone } : {}),
      ...(row.product ? { product: row.product } : {}),
      ...(row.payment_method ? { paymentMethod: row.payment_method } : {}),
      ...(row.plan ? { plan: row.plan } : {}),
      ...(row.amount_crypto ? { amountCrypto: row.amount_crypto } : {}),
    };
  },
  has(ref) {
    return !!db.prepare('SELECT name FROM pending_leads WHERE ref = ?').get(ref);
  },
  delete(ref) {
    db.prepare('DELETE FROM pending_leads WHERE ref = ?').run(ref);
  },
};

const completedReports = {
  set(ref, report) {
    db.prepare('INSERT OR REPLACE INTO completed_reports (ref, report_json) VALUES (?, ?)')
      .run(ref, JSON.stringify(report));
  },
  get(ref) {
    const row = db.prepare('SELECT report_json FROM completed_reports WHERE ref = ?').get(ref);
    return row ? JSON.parse(row.report_json) : undefined;
  },
  has(ref) {
    return !!db.prepare('SELECT report_json FROM completed_reports WHERE ref = ?').get(ref);
  },
};

const payments = {
  record({ provider, transactionId, reference, amount, currency, status = 'confirmed', raw }) {
    const result = db.prepare(`
      INSERT OR IGNORE INTO payment_transactions
        (provider, transaction_id, reference, amount, currency, status, raw_json)
      VALUES (@provider, @transactionId, @reference, @amount, @currency, @status, @rawJson)
    `).run({
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
  findByReference(reference, provider = 'bitcoin-ebook') {
    const row = db.prepare(`
      SELECT id, status, raw_json
      FROM payment_transactions
      WHERE provider = ? AND reference = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(provider, reference);
    if (!row) return undefined;
    return { id: row.id, status: row.status, raw: row.raw_json ? JSON.parse(row.raw_json) : null };
  },
  updateStatus(id, status) {
    db.prepare('UPDATE payment_transactions SET status = ? WHERE id = ?').run(status, id);
  },
};

const leads = {
  listAll() {
    return db.prepare('SELECT ref, report_json, created_at FROM completed_reports ORDER BY created_at DESC').all().map((row) => {
      const report = JSON.parse(row.report_json);
      const followup = db.prepare('SELECT status, notes, updated_at FROM followups WHERE ref = ?').get(row.ref) || { status: 'new', notes: '', updated_at: null };
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
    db.prepare(`
      INSERT INTO followups (ref, status, notes, updated_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(ref) DO UPDATE SET status = excluded.status, notes = excluded.notes, updated_at = datetime('now')
    `).run(ref, status, notes || '');
  },
};

const records = {
  create({ id, title, recordType, classification = 'internal', owner, retentionUntil = null, storageUri = null, checksum = null, metadata = {}, createdBy }) {
    db.prepare(`
      INSERT INTO edrms_records
        (id, title, record_type, classification, owner, retention_until, storage_uri, checksum, metadata_json, created_by)
      VALUES (@id, @title, @recordType, @classification, @owner, @retentionUntil, @storageUri, @checksum, @metadataJson, @createdBy)
    `).run({
      id,
      title,
      recordType,
      classification,
      owner,
      retentionUntil,
      storageUri,
      checksum,
      metadataJson: JSON.stringify(metadata),
      createdBy,
    });
    this.audit(id, 'created', createdBy, { status: 'draft' });
    return this.get(id);
  },
  get(id) {
    const row = db.prepare('SELECT * FROM edrms_records WHERE id = ?').get(id);
    if (!row) return undefined;
    return {
      id: row.id,
      title: row.title,
      recordType: row.record_type,
      classification: row.classification,
      status: row.status,
      owner: row.owner,
      retentionUntil: row.retention_until,
      storageUri: row.storage_uri,
      checksum: row.checksum,
      metadata: JSON.parse(row.metadata_json),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },
  list({ status, recordType } = {}) {
    const conditions = [];
    const values = [];
    if (status) { conditions.push('status = ?'); values.push(status); }
    if (recordType) { conditions.push('record_type = ?'); values.push(recordType); }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM edrms_records${where} ORDER BY updated_at DESC`).all(...values).map((row) => this.get(row.id));
  },
  transition(id, nextStatus, actorId) {
    const record = this.get(id);
    if (!record) return { ok: false, reason: 'not-found' };
    const allowed = {
      draft: ['active', 'archived'],
      active: ['archived'],
      archived: ['active', 'disposed'],
      disposed: [],
    };
    if (!allowed[record.status]?.includes(nextStatus)) {
      return { ok: false, reason: 'invalid-transition', status: record.status };
    }
    db.prepare("UPDATE edrms_records SET status = ?, updated_at = datetime('now') WHERE id = ?").run(nextStatus, id);
    this.audit(id, `status-${nextStatus}`, actorId, { from: record.status, to: nextStatus });
    return { ok: true, record: this.get(id) };
  },
  audit(recordId, action, actorId, details = {}) {
    db.prepare('INSERT INTO edrms_audit (record_id, action, actor_id, details) VALUES (?, ?, ?, ?)')
      .run(recordId, action, actorId, JSON.stringify(details));
  },
  listAudit(recordId) {
    return db.prepare('SELECT * FROM edrms_audit WHERE record_id = ? ORDER BY created_at DESC').all(recordId);
  },
};

const users = {
  create(username, passwordHash, totpSecret, role = 'user') {
    const info = db.prepare('INSERT INTO users (username, password_hash, totp_secret, role) VALUES (?, ?, ?, ?)')
      .run(username, passwordHash, totpSecret, role);
    return Number(info.lastInsertRowid);
  },
  findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },
  findById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },
  count() {
    return Number(db.prepare('SELECT COUNT(*) AS n FROM users').get().n);
  },
  enableTotp(id) {
    db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(id);
  },
  setRole(id, role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  },
};

const subscription = {
  get() {
    const row = db.prepare('SELECT * FROM subscription WHERE id = 1').get();
    if (!row) {
      return { plan: 'none', status: 'inactive', billingType: null, paypalSubscriptionId: null, currentPeriodEnd: null };
    }
    return {
      plan: row.plan,
      status: row.status,
      billingType: row.billing_type,
      paypalSubscriptionId: row.paypal_subscription_id,
      cryptoPaymentReference: row.crypto_payment_reference,
      cryptoTransactionId: row.crypto_transaction_id,
      currentPeriodEnd: row.current_period_end,
    };
  },
  set({ plan, billingType, paypalSubscriptionId, cryptoPaymentReference, cryptoTransactionId, status, currentPeriodEnd }) {
    db.prepare(`
      INSERT INTO subscription (id, plan, billing_type, paypal_subscription_id, crypto_payment_reference, crypto_transaction_id, status, current_period_end, updated_at)
      VALUES (1, @plan, @billingType, @paypalSubscriptionId, @cryptoPaymentReference, @cryptoTransactionId, @status, @currentPeriodEnd, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        plan = @plan,
        billing_type = @billingType,
        paypal_subscription_id = @paypalSubscriptionId,
        crypto_payment_reference = @cryptoPaymentReference,
        crypto_transaction_id = @cryptoTransactionId,
        status = @status,
        current_period_end = @currentPeriodEnd,
        updated_at = datetime('now')
    `).run({
      plan,
      billingType: billingType || null,
      paypalSubscriptionId: paypalSubscriptionId || null,
      cryptoPaymentReference: cryptoPaymentReference || null,
      cryptoTransactionId: cryptoTransactionId || null,
      status,
      currentPeriodEnd: currentPeriodEnd || null,
    });
  },
};

const compliance = {
  getClient(clientKey) {
    const row = db.prepare('SELECT * FROM compliance_clients WHERE client_key = ?').get(clientKey);
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
    return db.prepare('SELECT * FROM compliance_audit ORDER BY created_at DESC').all();
  },
  recordViolation(clientKey, categories, summary = '') {
    const current = db.prepare('SELECT * FROM compliance_clients WHERE client_key = ?').get(clientKey) || {
      client_key: clientKey,
      status: 'active',
      violation_count: 0,
      verified_payment_reference: null,
      verified_payment_amount: null,
      verified_payment_at: null,
    };
    const violationCount = Number(current.violation_count || 0) + 1;
    const status = violationCount >= 2 ? 'suspended' : 'active';

    db.prepare(`
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
    `).run({
      clientKey,
      status,
      violationCount,
      verifiedPaymentReference: current.verified_payment_reference || null,
      verifiedPaymentAmount: current.verified_payment_amount || null,
      verifiedPaymentAt: current.verified_payment_at || null,
    });

    const incidentId = Number(db.prepare('INSERT INTO compliance_incidents (client_key, categories, summary, status) VALUES (?, ?, ?, ?)')
      .run(clientKey, JSON.stringify(categories), summary, status === 'suspended' ? 'suspended' : 'open').lastInsertRowid);
    db.prepare('INSERT INTO compliance_audit (event_type, client_key, details) VALUES (?, ?, ?)')
      .run('violation-recorded', clientKey, JSON.stringify({ incidentId, categories, violationCount, status }));

    return { incidentId, violationCount, status };
  },
  recordVerifiedPayment(clientKey, reference, amount = 0) {
    const client = db.prepare('SELECT * FROM compliance_clients WHERE client_key = ?').get(clientKey) || { client_key: clientKey, status: 'active', violation_count: 0 };
    db.prepare(`
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
    `).run({
      clientKey,
      status: client.status === 'suspended' ? 'suspended' : 'active',
      violationCount: Number(client.violation_count || 0),
      verifiedPaymentReference: reference,
      verifiedPaymentAmount: amount,
      verifiedPaymentAt: new Date().toISOString(),
    });
    db.prepare('INSERT INTO compliance_audit (event_type, client_key, details) VALUES (?, ?, ?)')
      .run('payment-verified', clientKey, JSON.stringify({ reference, amount }));
    return this.getClient(clientKey);
  },
  reinstate(clientKey) {
    const client = this.getClient(clientKey);
    if (!client) return { ok: false, reason: 'unknown-client' };
    if (!client.verifiedPaymentReference) {
      return { ok: false, reason: 'payment-not-verified' };
    }

    db.prepare(`
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
    `).run({
      clientKey,
      status: 'active',
      violationCount: client.violationCount,
      verifiedPaymentReference: client.verifiedPaymentReference,
      verifiedPaymentAmount: client.verifiedPaymentAmount,
      verifiedPaymentAt: client.verifiedPaymentAt,
    });
    db.prepare('INSERT INTO compliance_audit (event_type, client_key, details) VALUES (?, ?, ?)')
      .run('reinstate', clientKey, JSON.stringify({ reference: client.verifiedPaymentReference }));
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
  records,
  users,
  subscription,
  compliance,
  createSessionStore,
};
