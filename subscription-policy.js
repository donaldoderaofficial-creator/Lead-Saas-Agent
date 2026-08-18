const ACTIVE_STATUSES = new Set(['active', 'approved', 'trialing']);

function hasActiveSubscription(subscription) {
  return Boolean(
    subscription
    && subscription.plan
    && subscription.plan !== 'none'
    && ACTIVE_STATUSES.has(subscription.status)
  );
}

module.exports = { hasActiveSubscription };
