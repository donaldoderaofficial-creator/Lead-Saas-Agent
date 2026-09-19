/**
 * Lead qualification pipeline.
 * Process: retrieval -> enrichment -> scoring -> validation -> decision
 * Each stage transforms the lead and passes it to the next stage.
 */

const { LEAD_SCORE } = require('./constants');
const { scoreLead } = require('./lead-model');
const { logger } = require('./logger');

/**
 * Enrich lead with company information and size estimation.
 * @param {Object} lead - Raw lead data
 * @returns {Promise<Object>} Enriched lead
 */
async function enrichLead(lead) {
  try {
    const companySizeGuess = lead.companySize === 'enterprise' ? 'enterprise' : 'small';
    const company = lead.email.split('@')[1];
    
    if (!company) {
      throw new Error('Invalid email domain for enrichment');
    }
    
    return {
      ...lead,
      company,
      companySizeGuess,
    };
  } catch (error) {
    logger.error('Lead enrichment failed', { email: lead.email, error: error.message });
    throw error;
  }
}

/**
 * Score lead using the neural model.
 * @param {Object} lead - Lead with enriched data
 * @returns {number} Score from 0-100
 */
function modelScore(lead) {
  try {
    const result = scoreLead(lead);
    if (typeof result.score !== 'number' || result.score < 0 || result.score > 100) {
      throw new Error('Invalid score from model');
    }
    return result.score;
  } catch (error) {
    logger.error('Lead scoring failed', { email: lead.email, error: error.message });
    throw error;
  }
}

/**
 * Validate lead data structure and constraints.
 * @param {Object} lead - Lead to validate
 * @returns {boolean} Whether lead passes validation
 */
function validateLead(lead) {
  if (typeof lead.name !== 'string' || lead.name.trim().length === 0) return false;
  if (typeof lead.email !== 'string' || !lead.email.includes('@')) return false;
  if (typeof lead.score !== 'number' || lead.score < LEAD_SCORE.MIN_SCORE || lead.score > LEAD_SCORE.MAX_SCORE) return false;
  return true;
}

/**
 * Process a lead through the qualification pipeline.
 * Uses a promise-based pipeline pattern for better error handling and readability.
 * @param {Object} lead - Raw lead data with name and email
 * @returns {Promise<Object>} Result object with qualified lead and processing log
 */
function processLead(lead) {
  const log = [];
  
  return Promise.resolve()
    .then(() => {
      // Step 1: Validate input
      if (!lead || typeof lead !== 'object') {
        throw new Error('Lead must be an object');
      }
      if (!lead.name || typeof lead.name !== 'string' || lead.name.trim().length === 0) {
        throw new Error('Lead needs a valid name');
      }
      if (!lead.email || typeof lead.email !== 'string' || !lead.email.includes('@')) {
        throw new Error('Lead needs a valid email');
      }
      log.push(`Received lead: ${lead.name} <${lead.email}>`);
      return lead;
    })
    .then(l => {
      // Step 2: Enrich
      return enrichLead(l).then(enriched => {
        log.push(`Enriched with company: ${enriched.company}, size: ${enriched.companySizeGuess}`);
        return enriched;
      });
    })
    .then(l => {
      // Step 3: Score
      const score = modelScore(l);
      log.push(`Scored: ${score}/100`);
      return { ...l, score };
    })
    .then(l => {
      // Step 4: Validate
      if (!validateLead(l)) {
        throw new Error('Lead failed validation checks');
      }
      log.push('Validation passed');
      return l;
    })
    .then(l => {
      // Step 5: Decide
      const isHot = l.score >= LEAD_SCORE.HOT_THRESHOLD;
      const path = isHot ? 'priority-outreach' : 'nurture-sequence';
      log.push(`Decision: ${isHot ? 'HOT lead for immediate outreach' : 'Add to nurture sequence'}`);
      return { ...l, path };
    })
    .then(result => {
      logger.info('Lead processed successfully', { email: result.email, score: result.score, path: result.path });
      return { result, log };
    })
    .catch(error => {
      logger.error('Lead processing failed', { email: lead?.email, error: error.message });
      log.push(`Pipeline error: ${error.message}`);
      throw error;
    });
}

module.exports = { processLead };
