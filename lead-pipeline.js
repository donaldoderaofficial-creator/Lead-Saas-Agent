/**
 * The lead pipeline as four named agents on one EventEmitter chain:
 *   retrieval -> scoring -> validation -> decision
 * Each agent only knows the event it listens for and the event it emits —
 * they don't call each other directly.
 */

const EventEmitter = require('events');
const { scoreLead } = require('./lead-model');

class Agent extends EventEmitter {}

// ---- Retrieval agent: enrich the raw lead ----
// In production this can be replaced by a consented enrichment provider.
async function enrichLead(lead) {
  const companySizeGuess = lead.companySize === 'enterprise' ? 'enterprise' : 'small';
  return {
    ...lead,
    company: lead.email.split('@')[1],
    companySizeGuess,
  };
}

// ---- Scoring agent: bounded neural model ----
function modelScore(lead) {
  return scoreLead(lead).score;
}

// ---- Validation agent: sanity-check before acting on the score ----
function validateLead(lead) {
  return (
    typeof lead.name === 'string' && lead.name.trim().length > 0 &&
    typeof lead.email === 'string' && lead.email.includes('@') &&
    typeof lead.score === 'number' && lead.score >= 0 && lead.score <= 100
  );
}

// One fresh agent per call so concurrent requests never cross-talk.
function processLead(lead) {
  return new Promise((resolve, reject) => {
    const agent = new Agent();
    const log = [];

    if (!lead || !lead.name || !lead.email) {
      return reject(new Error('Lead needs { name, email }'));
    }

    // retrieval agent
    agent.on('lead:received', async (l) => {
      log.push(`Got lead: ${l.name} <${l.email}>`);
      try {
        const enriched = await enrichLead(l);
        log.push(`features -> ${enriched.companySizeGuess}`);
        agent.emit('lead:enriched', enriched);
      } catch (err) {
        agent.emit('lead:error', { ...l, reason: `enrichment failed: ${err.message}` });
      }
    });

    // scoring agent
    agent.on('lead:enriched', (l) => {
      const score = modelScore(l);
      log.push(`${l.company} scored ${score}/100`);
      agent.emit('lead:scored', { ...l, score });
    });

    // validation agent
    agent.on('lead:scored', (l) => {
      if (validateLead(l)) {
        agent.emit('lead:validated', l);
      } else {
        agent.emit('lead:error', { ...l, reason: 'failed validation' });
      }
    });

    // decision agent
    agent.on('lead:validated', (l) => {
      agent.emit(l.score >= 70 ? 'lead:hot' : 'lead:nurture', l);
    });

    agent.on('lead:hot', (l) => {
      log.push(`Hot lead — priority outreach for ${l.name}`);
      agent.emit('lead:done', { ...l, path: 'priority-outreach' });
    });

    agent.on('lead:nurture', (l) => {
      log.push(`Adding ${l.name} to nurture sequence`);
      agent.emit('lead:done', { ...l, path: 'nurture-sequence' });
    });

    agent.on('lead:done', (l) => resolve({ result: l, log }));
    agent.on('lead:error', (l) => {
      log.push(`Error: ${l.reason}`);
      reject(new Error(l.reason));
    });

    agent.emit('lead:received', lead);
  });
}

module.exports = { processLead };
