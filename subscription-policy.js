const PAID_STATUSES = new Set(['active']);

// Access requires a confirmed payment covering the current moment; no trials, grace periods, or open-ended access.
function hasActiveSubscription(subscription, now = Date.now()) {
  if (!subscription || !subscription.plan || subscription.plan === 'none') return false;
  if (!PAID_STATUSES.has(subscription.status)) return false;
  const paidUntil = Date.parse(subscription.currentPeriodEnd);
  return Number.isFinite(paidUntil) && paidUntil > now;
}

function paidThrough(currentPeriodEnd, paidAt = Date.now()) {
  const current = Date.parse(currentPeriodEnd) || 0;
  const end = new Date(paidAt);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return new Date(Math.max(current, end.getTime())).toISOString();
}

module.exports = { hasActiveSubscription, paidThrough };
