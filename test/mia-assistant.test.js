const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-secret';

const { buildMiaReply, buildCustomReply, improveReplyWithAI } = require('../email-assistant');

test('greets and asks for the goal when the message is empty', () => {
  const reply = buildMiaReply('');
  assert.match(reply, /Mia, Dispatch Pro/);
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

test('agent replies use only relevant facts and omit filler', () => {
  const reply = buildMiaReply('This seems too expensive for us right now');
  assert.match(reply, /Starter covers up to/);
  assert.doesNotMatch(reply, /I hear you|put it in perspective|exciting opportunity/i);
});

test('custom email drafts keep pricing, disclaimer, and requested inputs without filler', () => {
  const { reply } = buildCustomReply({ body: 'Custom package, $12000, ETH' });
  assert.match(reply, /estimate/);
  assert.match(reply, /not a payment request or financial advice/);
  assert.match(reply, /user count, monthly lead volume, integrations, timeline/);
  assert.doesNotMatch(reply, /Thank you for contacting|aligned with our mission/i);
});

test('AI email instructions require concise, decision-relevant output', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  let request;
  process.env.OPENAI_API_KEY = 'test-key';
  global.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Relevant answer.' } }] }),
    };
  };
  try {
    await improveReplyWithAI({ reply: 'Draft body', subject: 'Subject', quote: {} });
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
  assert.match(request.messages[0].content, /concise, decision-relevant/);
  assert.match(request.messages[0].content, /Remove filler/);
  assert.match(request.messages[0].content, /120 words/);
});

test('rejects AI email output that exceeds the concise-response contract', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: Array(121).fill('signal').join(' ') } }] }),
  });
  try {
    await assert.rejects(
      improveReplyWithAI({ reply: 'Draft body', subject: 'Subject', quote: {} }),
      /concise reply requirements/
    );
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});
