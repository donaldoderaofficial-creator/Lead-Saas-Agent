const crypto = require('node:crypto');
const { parseTime, overdueFollowups } = require('./operations');

const DAY = 24 * 3600000;
const WEEK = 7 * DAY;
const STRONG_FIT_SCORE = 75;
const PREMIUM_PRICE_USD = 20;
const ACTIVE_STATUSES = new Set(['new', 'contacted']);

const PLAYBOOKS = [
  ['Same-day reply', 'Answer new strong-fit leads within the hour.', 'Restate their problem in one sentence.', 'Offer two specific call times, not "let me know".'],
  ['Second touch', 'Wait two business days after your first reply.', 'Share one useful resource tied to their goal.', 'Ask a yes/no question that is easy to answer.'],
  ['Pipeline hygiene', 'Mark every closed deal won or lost.', 'Add one note per lead on what they care about.', 'Archive anything with no reply after three touches.'],
  ['Referral ask', 'Pick your two happiest recent wins.', 'Thank them for one specific result.', 'Ask who else faces the same problem.'],
];

const INSIGHTS = [
  'The first reply sets the tone. Open with the prospect\'s problem in their own words, then offer one clear next step.',
  'A lead that goes quiet after one message is rarely a "no". A short, specific second touch often restarts the conversation.',
  'Scores rank attention, not worth. Use them to decide who to call first, and still skim the rest for surprises.',
  'Notes are future you\'s best friend. One line on what each prospect cares about makes the next call twice as easy.',
];

const LIGHTER_NOTES = [
  'Your agent worked every night this week and still didn\'t ask for overtime.',
  'No coffee breaks, no Monday blues, no "per my last email". Just leads, qualified.',
  'Somewhere a spreadsheet is relieved it no longer has to track all of this.',
  'Your agent read every inbound message this week. Even the ones written in all caps.',
];

function isoWeekKey(now = Date.now()) {
  const date = new Date(now);
  const day = date.getUTCDay() || 7;
  const thursday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 4 - day);
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.ceil(((thursday - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function sendDueAt(now, sendDay, sendHour) {
  const date = new Date(now);
  const day = date.getUTCDay() || 7;
  const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (day - 1));
  return monday + (sendDay - 1) * DAY + sendHour * 3600000;
}

function within(value, from, to) {
  const time = parseTime(value);
  return Number.isFinite(time) && time >= from && time <= to;
}

// Lead fields come from inbound forms; keep them single-line and short in email text.
function clean(value, max = 80) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

function leadSummary(lead) {
  return {
    name: clean(lead.name) || 'Unnamed lead',
    company: clean(lead.company),
    score: lead.score,
    nextStep: clean(lead.recommendedNextStep, 200),
  };
}

function weeklyActivity(leads, now = Date.now()) {
  const from = now - WEEK;
  const captured = leads.filter((lead) => within(lead.createdAt, from, now));
  const strongFit = captured.filter((lead) => Number(lead.score) >= STRONG_FIT_SCORE);
  const scores = captured.map((lead) => Number(lead.score)).filter(Number.isFinite);
  const updatedThisWeek = (status) => leads.filter((lead) => lead.followupStatus === status && within(lead.followupUpdatedAt, from, now)).length;
  const byScore = (a, b) => Number(b.score) - Number(a.score);
  const active = leads.filter((lead) => ACTIVE_STATUSES.has(lead.followupStatus || 'new')).sort(byScore);
  const top = [...strongFit].sort(byScore)[0] || null;
  const overdue = overdueFollowups(leads, now);
  return {
    from,
    to: now,
    captured: captured.length,
    strongFit: strongFit.length,
    strongFitWaiting: strongFit.filter((lead) => (lead.followupStatus || 'new') === 'new').length,
    averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    contacted: updatedThisWeek('contacted'),
    won: updatedThisWeek('won'),
    overdue: overdue.length,
    topLead: top && leadSummary(top),
    priorityLeads: active.slice(0, 3).map(leadSummary),
    draftLeads: active.filter((lead) => Number(lead.score) >= STRONG_FIT_SCORE).slice(0, 10).map(leadSummary),
    stalledLeads: active
      .filter((lead) => lead.followupStatus === 'contacted' && parseTime(lead.followupUpdatedAt || lead.createdAt) < from)
      .slice(0, 10)
      .map(leadSummary),
  };
}

function firstName(email) {
  const token = String(email || '').split('@')[0].split(/[._+-]/)[0];
  return /^[a-z]{2,20}$/i.test(token) ? token[0].toUpperCase() + token.slice(1).toLowerCase() : 'there';
}

function formatDay(time) {
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function leadLabel(lead) {
  return `${lead.name}${lead.company ? ` at ${lead.company}` : ''}`;
}

function trend(label, current, previous) {
  if (current === null || previous === null) return `- ${label}: ${current ?? 'n/a'}`;
  const delta = current - previous;
  return `- ${label}: ${current} (last week ${previous}, ${delta >= 0 ? '+' : ''}${delta})`;
}

function premiumSections(a, previous) {
  const lines = ['', 'Week over week:'];
  lines.push(trend('Leads captured', a.captured, previous.captured));
  lines.push(trend('Strong fits', a.strongFit, previous.strongFit));
  lines.push(trend('Deals won', a.won, previous.won));
  lines.push(trend('Average score', a.averageScore, previous.averageScore));

  lines.push('', 'Ready-to-send replies:');
  if (!a.draftLeads.length) lines.push('No strong-fit leads are waiting right now.');
  for (const lead of a.draftLeads) {
    const reason = lead.nextStep ? ` The best next step looks like: ${lead.nextStep}` : '';
    lines.push(`> To ${leadLabel(lead)}:`, `  "Hi ${lead.name}, thanks for reaching out${lead.company ? ` about ${lead.company}` : ''}.${reason} Would 15 minutes on Thursday or Friday work for a quick call?"`);
  }

  lines.push('', 'Stalled-lead rescue:');
  if (!a.stalledLeads.length) lines.push('No contacted leads have gone quiet for more than a week.');
  for (const lead of a.stalledLeads) {
    lines.push(`> To ${leadLabel(lead)}:`, `  "Hi ${lead.name}, I know things get busy. Is solving this still a priority this quarter, or should I check back later?"`);
  }
  return lines;
}

function premiumTeaser(a, upgradeUrl) {
  const extras = ['week-over-week trends for your pipeline'];
  if (a.draftLeads.length) extras.unshift(`${plural(a.draftLeads.length, 'ready-to-send reply draft')} for ${a.draftLeads.slice(0, 2).map((lead) => lead.name).join(' and ')}${a.draftLeads.length > 2 ? ' and others' : ''}`);
  if (a.stalledLeads.length) extras.push(`a rescue message for ${plural(a.stalledLeads.length, 'stalled lead')}`);
  return [
    '', 'In this week\'s premium edition:',
    ...extras.map((extra) => `- ${extra}`),
    `Premium is $${PREMIUM_PRICE_USD}/month, paid in BTC or ETH. Upgrade: ${upgradeUrl}`,
  ];
}

function buildNewsletter({ email, activity, previous, premium = false, weekKey, dashboardUrl, upgradeUrl, unsubscribeUrl }) {
  const rotation = Number(String(weekKey).slice(-2)) || 0;
  const a = activity;
  const lines = [`Hi ${firstName(email)},`, ''];

  if (a.captured) {
    lines.push(`Here's what your Dispatch Pro agent did from ${formatDay(a.from)} to ${formatDay(a.to)}:`, '');
    lines.push(`- Captured and scored ${plural(a.captured, 'new lead')}`);
    lines.push(`- Flagged ${a.strongFit} as strong fits (score ${STRONG_FIT_SCORE}+)`);
    if (a.averageScore !== null) lines.push(`- Average lead score: ${a.averageScore}`);
    if (a.topLead) lines.push(`- Top lead: ${leadLabel(a.topLead)} (score ${a.topLead.score})`);
    if (a.contacted) lines.push(`- ${plural(a.contacted, 'lead')} moved to contacted`);
    if (a.won) lines.push(`- ${plural(a.won, 'deal')} marked won`);
  } else {
    lines.push('It was a quiet week: no new leads came in. Your agent stayed on watch around the clock, so nothing slipped past.');
  }

  lines.push('');
  if (a.overdue) {
    lines.push(`${plural(a.overdue, 'lead')} ${a.overdue === 1 ? 'has' : 'have'} been waiting past the follow-up window. Busy weeks happen to everyone; start with the oldest and the rest gets easier.`);
  } else if (a.won) {
    lines.push(`Congratulations on the ${a.won === 1 ? 'win' : 'wins'}. That's the result of steady follow-up, and it shows.`);
  } else if (a.captured) {
    lines.push('Every lead got a timely follow-up this week. That consistency is the hard part, and you\'re doing it.');
  }

  if (a.priorityLeads.length) {
    lines.push('', 'Who to call first:');
    a.priorityLeads.forEach((lead, index) => {
      lines.push(`${index + 1}. ${leadLabel(lead)} (score ${lead.score})${lead.nextStep ? ` - ${lead.nextStep}` : ''}`);
    });
  }

  const [playbookTitle, ...steps] = PLAYBOOKS[rotation % PLAYBOOKS.length];
  lines.push('', `This week's playbook: ${playbookTitle}`, ...steps.map((step, index) => `${index + 1}. ${step}`));

  lines.push('', 'Worth knowing:', INSIGHTS[rotation % INSIGHTS.length]);
  lines.push('', 'On a lighter note:', LIGHTER_NOTES[rotation % LIGHTER_NOTES.length]);

  if (premium && previous) lines.push(...premiumSections(a, previous));

  lines.push('', 'Your move this week:');
  if (a.strongFitWaiting) lines.push(`Reply to your ${plural(a.strongFitWaiting, 'strong-fit lead')} still waiting on a first touch before Wednesday.`);
  else if (a.overdue) lines.push(`Clear the ${plural(a.overdue, 'overdue follow-up')} by Friday.`);
  else lines.push('Connect one more lead source and see what your agent does with the extra demand.');

  if (!premium && upgradeUrl) lines.push(...premiumTeaser(a, upgradeUrl));

  lines.push('', `Open your dashboard: ${dashboardUrl}`, '', 'Dispatch Pro', '', `Don't want these weekly updates? Unsubscribe: ${unsubscribeUrl}`);

  const subject = a.captured
    ? `Your agent's week: ${plural(a.captured, 'lead')} captured, ${a.strongFit} strong ${a.strongFit === 1 ? 'fit' : 'fits'}`
    : 'Your agent\'s week: quiet inbox, steady watch';
  return { subject: premium ? `[Premium] ${subject}` : subject, text: lines.join('\n') };
}

function unsubscribeToken(userId, secret) {
  return crypto.createHmac('sha256', String(secret)).update(`newsletter-unsubscribe:${userId}`).digest('hex');
}

function verifyUnsubscribeToken(userId, token, secret) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
  return crypto.timingSafeEqual(Buffer.from(unsubscribeToken(userId, secret)), Buffer.from(token));
}

function isPremium(premiumUntil, now = Date.now()) {
  const until = Date.parse(premiumUntil);
  return Number.isFinite(until) && until > now;
}

async function runWeeklyNewsletters({ users, leads, isSubscribed, send, now = Date.now(), baseUrl, secret, sendDay = 1, sendHour = 8 }) {
  const weekKey = isoWeekKey(now);
  const result = { weekKey, sent: 0, skipped: 0, failed: 0, status: 'ok' };
  if (now < sendDueAt(now, sendDay, sendHour)) return { ...result, status: 'not-due' };
  if (!isSubscribed()) return { ...result, status: 'no-active-subscription' };

  const allLeads = leads.listAll();
  const activity = weeklyActivity(allLeads, now);
  const previous = weeklyActivity(allLeads, now - WEEK);
  for (const user of users.listNewsletterRecipients()) {
    if (!users.claimNewsletterWeek(user.id, weekKey)) { result.skipped += 1; continue; }
    const unsubscribeUrl = `${baseUrl}/api/newsletter/unsubscribe?u=${user.id}&t=${unsubscribeToken(user.id, secret)}`;
    const message = buildNewsletter({
      email: user.username,
      activity,
      previous,
      premium: isPremium(user.premiumUntil, now),
      weekKey,
      dashboardUrl: `${baseUrl}/dashboard-v2.html`,
      upgradeUrl: `${baseUrl}/newsletter-premium.html`,
      unsubscribeUrl,
    });
    try {
      const delivery = await send({ to: user.username, ...message, unsubscribeUrl });
      if (!delivery.sent) throw new Error(delivery.reason || 'not sent');
      result.sent += 1;
    } catch (err) {
      users.releaseNewsletterWeek(user.id, weekKey);
      result.failed += 1;
      result.lastError = err.message;
    }
  }
  return result;
}

module.exports = {
  PREMIUM_PRICE_USD,
  isoWeekKey,
  sendDueAt,
  weeklyActivity,
  buildNewsletter,
  isPremium,
  unsubscribeToken,
  verifyUnsubscribeToken,
  runWeeklyNewsletters,
};
