const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-secret';

const { buildMiaReply } = require('../email-assistant');

test('greets and asks for the goal when the message is empty', () => {
  const reply = buildMiaReply('');
  assert.match(reply, /Mia from Dispatch Pro/);
});

test('recommends Starter for lead volume within its cap and links to checkout', () => {
  const reply = buildMiaReply('We get about 300 leads a month, which plan fits?');
  assert.match(reply, /Starter is the better fit/);
  assert.match(reply, /\/billing\.html\?plan=starter/);
});

test('recommends Growth once volume exceeds the Starter cap', () => {
  const reply = buildMiaReply('We get around 1200 leads a month, which plan fits?');
  assert.match(reply, /Growth is the better fit/);
  assert.match(reply, /\/billing\.html\?plan=growth/);
});

test('handles a price objection with value framing and a closing CTA', () => {
  const reply = buildMiaReply('This seems too expensive for us right now');
  assert.match(reply, /Starter covers up to/);
  assert.match(reply, /\/billing\.html\?plan=starter/);
});

test('handles a competitor objection by asking a discovery question', () => {
  const reply = buildMiaReply('We already use another tool for this');
  assert.match(reply, /biggest gap in your current setup/);
});

test('handles hesitation with a low-commitment next step', () => {
  const reply = buildMiaReply('I need to think about it and talk to my team');
  assert.match(reply, /billed monthly/);
  assert.match(reply, /\/billing\.html\?plan=starter/);
});

test('answers a security objection without fabricating guarantees', () => {
  const reply = buildMiaReply('Is my data secure with you?');
  assert.match(reply, /2FA/);
  assert.doesNotMatch(reply, /guarantee/i);
});

test('every fallback reply still ends with a next-step question', () => {
  const reply = buildMiaReply('tell me something random');
  assert.match(reply, /\?\s*$/);
});
