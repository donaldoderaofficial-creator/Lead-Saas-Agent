const assert = require('node:assert/strict');
const test = require('node:test');
const { buildPlan, mount } = require('../public/action-plan');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const leads = [
  { ref: 'new', name: 'Amina', score: 40 },
  { ref: 'hot', name: 'Lee', path: 'priority-outreach', score: 90, followupStatus: 'new', recommendedNextStep: 'Ask about timing' },
  { ref: 'reply', score: 75, followupStatus: 'contacted' },
  { ref: 'won', score: 100, followupStatus: 'won' },
  { ref: 'lost', score: 99, followupStatus: 'lost' },
];

test('prototype: bounded suggestions use real recommendations and exclude closed leads', () => {
  const before = JSON.stringify(leads);
  const plan = buildPlan(leads, { size: 3 });
  assert.deepEqual(plan.map(item => item.lead.ref), ['hot', 'reply', 'new']);
  assert.equal(plan[0].nextStep, 'Ask about timing');
  assert.match(plan[1].nextStep, /conversation/);
  assert.equal(JSON.stringify(leads), before);
});

test('focus and size remain flexible; missing status means new', () => {
  assert.deepEqual(buildPlan(leads, { focus: 'new', size: 3 }).map(x => x.lead.ref), ['hot', 'new']);
  assert.deepEqual(buildPlan(leads, { focus: 'contacted' }).map(x => x.lead.ref), ['reply']);
  assert.equal(buildPlan(leads).length, 1);
  assert.equal(buildPlan(leads, { size: 100 }).length, 1);
});

test('skips and saved leads are session-only exclusions, not status changes', () => {
  const excluded = new Set(['hot', 'reply']);
  assert.deepEqual(buildPlan(leads, { excluded, size: 3 }).map(x => x.lead.ref), ['new']);
  assert.equal(leads[1].followupStatus, 'new');
  assert.equal(buildPlan(leads, { excluded: new Set(leads.map(x => x.ref)) }).length, 0);
  assert.deepEqual(buildPlan([]), []);
});

test('missing recommendations get concrete status-aware fallbacks', () => {
  const plan = buildPlan([{ ref: 'x', recommendedNextStep: '   ' }]);
  assert.match(plan[0].nextStep, /introduction/);
  assert.equal(buildPlan([{ followupStatus: 'new' }]).length, 0);
});

function fixture() {
  let focused;
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); }
    replaceChildren() { this.children = []; }
    setAttribute(key, value) { this.attributes[key] = value; }
    focus() { focused = this; }
    querySelector(tag) {
      for (const child of this.children) {
        if (child.tag === tag) return child;
        const nested = child.querySelector(tag);
        if (nested) return nested;
      }
      return null;
    }
  }
  const ids = Object.fromEntries(['planFocus', 'planSize', 'planProgress', 'planRestore', 'planList', 'planEmpty']
    .map(id => [id, new Element('div')]));
  ids.planFocus.value = 'all';
  ids.planSize.value = '1';
  const section = { ownerDocument: { createElement: tag => new Element(tag) }, querySelector: id => ids[id.slice(1)] };
  return { ids, section, focused: () => focused };
}

test('controls skip/restore, resize, open the right editor, and track unique successful saves', () => {
  const { ids, section, focused } = fixture();
  const opened = [];
  const plan = mount(section, ref => opened.push(ref));
  plan.update(leads);
  const actions = () => ids.planList.children[0].children[3].children;
  actions()[0].onclick();
  assert.deepEqual(opened, ['hot']);
  actions()[1].onclick();
  assert.equal(ids.planList.children[0].children[0].textContent, 'Lead');
  assert.equal(ids.planRestore.hidden, false);
  assert.equal(focused().textContent, 'Edit follow-up');
  ids.planRestore.onclick();
  assert.equal(ids.planRestore.hidden, true);
  ids.planSize.value = '3';
  ids.planSize.onchange();
  assert.equal(ids.planList.children.length, 3);
  ids.planFocus.value = 'contacted';
  ids.planFocus.onchange();
  assert.equal(ids.planList.children.length, 1);
  plan.recordSaved('reply');
  plan.recordSaved('reply');
  plan.update(leads);
  assert.equal(ids.planList.children.length, 0);
  assert.equal(ids.planEmpty.hidden, false);
  assert.match(ids.planProgress.textContent, /1 unique lead/);
  assert.equal(leads[2].followupStatus, 'contacted');
});

test('untrusted lead text stays text and a new page visit resets plan state', () => {
  const { ids, section } = fixture();
  const malicious = [{ ref: 'x', name: '<img src=x onerror=alert(1)>', recommendedNextStep: '<script>bad()</script>' }];
  const plan = mount(section, () => {});
  plan.update(malicious);
  assert.equal(ids.planList.children[0].children[0].textContent, malicious[0].name);
  assert.equal(ids.planList.children[0].children[2].textContent, malicious[0].recommendedNextStep);
  plan.recordSaved('x');
  plan.update(malicious);
  assert.equal(ids.planList.children.length, 0);
  mount(section, () => {}).update(malicious);
  assert.equal(ids.planList.children.length, 1);
});

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard-v2.html'), 'utf8');
test('dashboard loads action-plan module before its inline script and inline JavaScript parses', () => {
  assert.ok(dashboard.indexOf('src="/action-plan.js"') < dashboard.indexOf('const actionPlan='));
  for (const [, script] of dashboard.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script);
});

test('follow-up save uses the existing PATCH API; failures retain drafts and do not count as progress', async () => {
  const source = dashboard.match(/async function saveLead\(\)[\s\S]*?(?=\nfunction openDetails)/)[0];
  for (const fail of [true, false]) {
    const recorded = [], messages = [], requests = [];
    const draft = new Map([['a/b', { status: 'contacted', notes: 'Next: ask about timing' }]]);
    const lead = { ref: 'a/b', followupStatus: 'new' };
    const button = { dataset: { save: lead.ref }, disabled: false, closest: () => card };
    const card = {
      querySelector: tag => ({ value: tag === 'select' ? 'contacted' : 'Next: ask about timing' }),
      contains: () => false,
    };
    let rendered = 0;
    const context = vm.createContext({
      leads: [lead], followupDrafts: draft, actionPlan: { recordSaved: ref => recorded.push(ref) },
      api: async (url, options) => {
        assert.equal(button.disabled, true);
        requests.push({ url, options });
        if (fail) throw Error('Save unavailable. Try again.');
      },
      render: () => rendered++, toast: message => messages.push(message), document: { activeElement: null },
    });

    test('refresh failure explicitly reports stale data without replacing the current pipeline', async () => {
      const source = dashboard.match(/async function load\([\s\S]*?(?=\nfunction escape)/)[0];
      const messages = [];
      const context = vm.createContext({
        leads, toast: message => messages.push(message),
        api: async () => { throw Error('Service unavailable'); },
      });
      vm.runInContext(source, context);
      await context.load(true);
      assert.equal(context.leads, leads);
      assert.match(messages[0], /Could not refresh.*Service unavailable.*last loaded pipeline/);
    });
    vm.runInContext(source, context);
    await context.saveLead.call(button);
    assert.equal(requests[0].url, '/api/leads/a%2Fb/followup');
    assert.equal(requests[0].options.method, 'PATCH');
    assert.deepEqual(JSON.parse(requests[0].options.body), { status: 'contacted', notes: 'Next: ask about timing' });
    assert.equal(button.disabled, false);
    assert.deepEqual(recorded, fail ? [] : ['a/b']);
    assert.equal(draft.has('a/b'), fail);
    assert.equal(rendered, fail ? 0 : 1);
    assert.equal(lead.followupStatus, fail ? 'new' : 'contacted');
    assert.match(messages[0], fail ? /Save unavailable/ : /saved/);
  }
});
