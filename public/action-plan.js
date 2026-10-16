(function (root) {
  'use strict';

  function buildPlan(leads, { focus = 'all', size = 1, excluded = new Set() } = {}) {
    return leads
      .filter(lead => lead.ref && ['new', 'contacted'].includes(lead.followupStatus || 'new')
        && (focus === 'all' || (lead.followupStatus || 'new') === focus)
        && !excluded.has(lead.ref))
      .sort((a, b) => Number(b.path === 'priority-outreach') - Number(a.path === 'priority-outreach')
        || (Number(b.score) || 0) - (Number(a.score) || 0))
      .slice(0, size === 3 ? 3 : 1)
      .map(lead => ({
        lead,
        reason: lead.followupStatus === 'contacted'
          ? 'A conversation you can build on'
          : lead.path === 'priority-outreach' ? 'A high-priority introduction' : 'A fresh connection to explore',
        nextStep: typeof lead.recommendedNextStep === 'string' && lead.recommendedNextStep.trim()
          ? lead.recommendedNextStep.trim()
          : lead.followupStatus === 'contacted'
            ? 'Review the conversation and note a useful question for your next follow-up.'
            : 'Review this lead and draft a short, personal introduction.',
      }));
  }

  function mount(section, onOpen) {
    const doc = section.ownerDocument;
    const find = id => section.querySelector('#' + id);
    const skipped = new Set();
    const saved = new Set();
    let leads = [];

    function render() {
      const plan = buildPlan(leads, {
        focus: find('planFocus').value,
        size: Number(find('planSize').value),
        excluded: new Set([...skipped, ...saved]),
      });
      find('planProgress').textContent = saved.size
        ? `${saved.size} unique ${saved.size === 1 ? 'lead' : 'leads'} with a follow-up saved this visit. Small steps count.`
        : 'One useful next step is enough. Choose what works for you.';
      find('planRestore').hidden = skipped.size === 0;
      const list = find('planList');
      list.replaceChildren();
      for (const item of plan) {
        const card = doc.createElement('article');
        card.className = 'plan-card';
        const heading = doc.createElement('h3');
        heading.textContent = item.lead.name || item.lead.company || 'Lead';
        const reason = doc.createElement('p');
        reason.className = 'plan-reason';
        reason.textContent = item.reason;
        const step = doc.createElement('p');
        step.textContent = item.nextStep;
        const actions = doc.createElement('div');
        actions.className = 'plan-actions';
        const open = doc.createElement('button');
        open.className = 'btn primary';
        open.textContent = 'Edit follow-up';
        open.setAttribute('aria-label', `Edit follow-up for ${heading.textContent}`);
        open.onclick = () => onOpen(item.lead.ref);
        const skip = doc.createElement('button');
        skip.className = 'btn';
        skip.textContent = 'Try another';
        skip.setAttribute('aria-label', `Try another instead of ${heading.textContent}`);
        skip.onclick = () => {
          skipped.add(item.lead.ref);
          render();
          const next = list.querySelector('button') || find('planRestore');
          next.focus();
        };
        actions.append(open, skip);
        card.append(heading, reason, step, actions);
        list.appendChild(card);
      }
      find('planEmpty').hidden = plan.length > 0;
      find('planEmpty').textContent = !leads.length
        ? 'Your next connection starts here. Leads will appear after a lead report is available.'
        : 'No suggestions in this focus right now. Choose another focus, bring back skipped leads, or use the full pipeline below. Saved leads remain there too.';
    }

    find('planFocus').onchange = render;
    find('planSize').onchange = render;
    find('planRestore').onclick = () => {
      skipped.clear();
      render();
      find('planFocus').focus();
    };
    return {
      update(nextLeads) {
        leads = nextLeads;
        render();
      },
      recordSaved(ref) {
        saved.add(ref);
      },
    };
  }

  if (typeof module === 'object' && module.exports) module.exports = { buildPlan, mount };
  else root.LeadActionPlan = { buildPlan, mount };
})(typeof globalThis === 'object' ? globalThis : this);
