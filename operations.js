const DEPARTMENTS = {
  hr: {
    label: 'HR',
    types: ['hiring', 'onboarding', 'offboarding', 'leave', 'performance_review', 'training'],
  },
  marketing_sales: {
    label: 'Marketing & Sales',
    types: ['campaign', 'content', 'deal', 'follow_up'],
  },
  manufacturing: {
    label: 'Manufacturing',
    types: ['work_order', 'maintenance', 'quality_issue'],
    billableTypes: ['work_order'],
    qualityGate: true,
  },
  it: {
    label: 'IT',
    types: ['incident', 'change', 'access_request', 'asset'],
  },
  service: {
    label: 'Service',
    types: ['support_ticket', 'service_job', 'complaint'],
    billableTypes: ['service_job'],
  },
};

const PRIORITY_SLA_HOURS = { urgent: 4, high: 24, normal: 72, low: 168 };
const CLOSED_STATUSES = new Set(['done', 'cancelled']);

const BASE_TRANSITIONS = {
  open: ['in_progress', 'cancelled'],
  in_progress: ['blocked', 'done', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  done: [],
  cancelled: [],
};

// Manufacturing work must pass quality check before it can be marked done.
const QUALITY_TRANSITIONS = {
  ...BASE_TRANSITIONS,
  in_progress: ['blocked', 'quality_check', 'cancelled'],
  quality_check: ['in_progress', 'done'],
};

const FOLLOWUP_SLA_HOURS = { new: 24, contacted: 72 };

function transitionsFor(department) {
  return DEPARTMENTS[department]?.qualityGate ? QUALITY_TRANSITIONS : BASE_TRANSITIONS;
}

function isBillable(department, type) {
  return Boolean(DEPARTMENTS[department]?.billableTypes?.includes(type));
}

function parseTime(value) {
  if (!value) return NaN;
  const text = String(value);
  // SQLite datetime('now') is UTC without a zone marker.
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text);
}

function optionalText(value, field, max) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new Error(`${field} must be ${max} characters or fewer`);
  return value.trim();
}

function validateItem(input = {}, now = Date.now()) {
  const { department, type, title, priority = 'normal', dueAt } = input;
  if (!DEPARTMENTS[department]) throw new Error(`department must be one of ${Object.keys(DEPARTMENTS).join(', ')}`);
  if (!DEPARTMENTS[department].types.includes(type)) {
    throw new Error(`type for ${department} must be one of ${DEPARTMENTS[department].types.join(', ')}`);
  }
  if (!title || typeof title !== 'string' || !title.trim() || title.length > 200) {
    throw new Error('title is required and must be 200 characters or fewer');
  }
  if (!PRIORITY_SLA_HOURS[priority]) throw new Error(`priority must be one of ${Object.keys(PRIORITY_SLA_HOURS).join(', ')}`);
  let due = now + PRIORITY_SLA_HOURS[priority] * 3600000;
  if (dueAt !== undefined && dueAt !== null && dueAt !== '') {
    due = parseTime(dueAt);
    if (!Number.isFinite(due)) throw new Error('dueAt must be a valid ISO date');
  }
  return {
    department,
    type,
    title: title.trim(),
    description: optionalText(input.description, 'description', 2000),
    owner: optionalText(input.owner, 'owner', 200),
    customer: optionalText(input.customer, 'customer', 200),
    paymentReference: optionalText(input.paymentReference, 'paymentReference', 200),
    priority,
    dueAt: new Date(due).toISOString(),
  };
}

function checkTransition(item, nextStatus, { paymentConfirmed = false } = {}) {
  const allowed = transitionsFor(item.department)[item.status] || [];
  if (!allowed.includes(nextStatus)) return { ok: false, reason: 'invalid-transition', status: item.status, allowed };
  if (nextStatus === 'in_progress' && item.status === 'open' && isBillable(item.department, item.type) && !paymentConfirmed) {
    return { ok: false, reason: 'payment-required' };
  }
  return { ok: true };
}

function isOverdue(item, now = Date.now()) {
  return !CLOSED_STATUSES.has(item.status) && parseTime(item.dueAt) < now;
}

function overdueFollowups(leads, now = Date.now()) {
  return leads.filter((lead) => {
    const status = lead.followupStatus || 'new';
    const hours = FOLLOWUP_SLA_HOURS[status];
    if (!hours) return false;
    const since = parseTime(status === 'new' ? lead.createdAt : (lead.followupUpdatedAt || lead.createdAt));
    return Number.isFinite(since) && now - since > hours * 3600000;
  });
}

function buildOverview(items, leads, now = Date.now()) {
  const departments = {};
  for (const [key, { label }] of Object.entries(DEPARTMENTS)) {
    departments[key] = { label, total: 0, open: 0, overdue: 0, byStatus: {} };
  }
  for (const item of items) {
    const summary = departments[item.department];
    if (!summary) continue;
    summary.total += 1;
    summary.byStatus[item.status] = (summary.byStatus[item.status] || 0) + 1;
    if (!CLOSED_STATUSES.has(item.status)) summary.open += 1;
    if (isOverdue(item, now)) summary.overdue += 1;
  }
  const followups = overdueFollowups(leads, now);
  departments.marketing_sales.overdueFollowups = followups.length;
  return {
    departments,
    overdueItems: items.filter((item) => isOverdue(item, now)),
    overdueFollowups: followups.map(({ ref, name, company, score, followupStatus, createdAt }) => ({ ref, name, company, score, followupStatus, createdAt })),
  };
}

function buildStrategyBrief(items, leads, now = Date.now()) {
  const activeLeads = leads.filter((lead) => ['new', 'contacted'].includes(lead.followupStatus));
  const strongFitLeads = activeLeads.filter((lead) => Number(lead.score) >= 75);
  const topOpportunities = activeLeads
    .filter((lead) => Number(lead.score) >= 85)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
  const departmentLoad = new Map();

  for (const item of items) {
    if (CLOSED_STATUSES.has(item.status) || !DEPARTMENTS[item.department]) continue;
    departmentLoad.set(item.department, (departmentLoad.get(item.department) || 0) + 1);
  }

  const overdueSales = overdueFollowups(leads, now);
  const overdueWork = items.filter((item) => isOverdue(item, now));

  return {
    strengths: strongFitLeads.length ? [{
      count: strongFitLeads.length,
      recommendation: 'Prioritize follow-up on active leads scoring 75 or higher.',
    }] : [],
    opportunities: topOpportunities.map((lead) => ({
      leadRef: lead.ref,
      name: lead.name,
      score: lead.score,
      recommendation: 'Contact this high-fit lead while intent is active.',
    })),
    weaknesses: [...departmentLoad.entries()]
      .filter(([, open]) => open >= 3)
      .map(([department, open]) => ({
        department,
        label: DEPARTMENTS[department].label,
        open,
        recommendation: 'Consider delegating or outsourcing suitable low-risk work after access and vendor checks.',
      })),
    threats: [
      ...(overdueSales.length ? [{
        type: 'sales-followups',
        count: overdueSales.length,
        recommendation: 'Review overdue sales follow-ups to reduce the risk of losing active demand.',
      }] : []),
      ...(overdueWork.length ? [{
        type: 'overdue-work',
        count: overdueWork.length,
        recommendation: 'Triage overdue work and assign an owner or revised due date.',
      }] : []),
    ],
  };
}

module.exports = {
  DEPARTMENTS,
  PRIORITY_SLA_HOURS,
  parseTime,
  transitionsFor,
  isBillable,
  validateItem,
  checkTransition,
  isOverdue,
  overdueFollowups,
  buildOverview,
  buildStrategyBrief,
};
