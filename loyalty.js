const USD_PER_POINT = 5;

const SUBSCRIPTION_CREDIT = Object.freeze({
  points: 100,
  usd: 5,
});

function creditForPoints(points) {
  if (!Number.isSafeInteger(points) || points < 0 || points % SUBSCRIPTION_CREDIT.points !== 0) {
    throw new Error(`points must be a non-negative multiple of ${SUBSCRIPTION_CREDIT.points}`);
  }
  return (points / SUBSCRIPTION_CREDIT.points) * SUBSCRIPTION_CREDIT.usd;
}

function pointsForSubscription(amountUsd) {
  const amount = Number(amountUsd);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('subscription amount must be a positive finite amount');
  }
  const points = Math.floor(amount / USD_PER_POINT);
  if (!Number.isSafeInteger(points)) {
    throw new Error('subscription amount is too large to convert to loyalty points');
  }
  return points;
}

module.exports = {
  USD_PER_POINT,
  SUBSCRIPTION_CREDIT,
  creditForPoints,
  pointsForSubscription,
};
