/**
 * Explorium API client (the data provider behind Vibe Prospecting).
 * Public API, separate from the Claude/MCP integration — sign up for your
 * own key at https://admin.explorium.ai, free trial includes 500 enrichments/month.
 *
 * .env:
 *   EXPLORIUM_API_KEY=your-api-key
 */

require('dotenv').config();

const BASE_URL = 'https://api.explorium.ai/v1';

function requireApiKey() {
  const key = process.env.EXPLORIUM_API_KEY;
  if (!key) throw new Error('Missing EXPLORIUM_API_KEY. Set it in your .env file.');
  return key;
}

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      API_KEY: requireApiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Explorium API error (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

/**
 * Use case 1: find companies matching criteria (industry, size, location).
 * @param {{ countryCode?: string[], companySize?: string[], linkedinCategory?: string[], city?: string[], limit?: number }} params
 */
async function fetchBusinesses({ countryCode, companySize, linkedinCategory, city, limit = 20 }) {
  const filters = {};
  if (countryCode?.length) filters.country_code = { values: countryCode };
  if (companySize?.length) filters.company_size = { values: companySize };
  if (linkedinCategory?.length) filters.linkedin_category = { values: linkedinCategory };
  if (city?.length) filters.city_region_country = { values: city };

  return post('/businesses', {
    mode: 'full',
    size: limit,
    page_size: Math.min(limit, 100),
    page: 1,
    filters,
  });
}

/**
 * Use case 2: find a specific person's contact info.
 * @param {{ fullName?: string, companyName?: string, email?: string }} params
 */
async function findPersonContact({ fullName, companyName, email }) {
  const matchInput = email ? { email } : { full_name: fullName, company_name: companyName };
  const matchResult = await post('/prospects/match', { prospects_to_match: [matchInput] });

  const match = matchResult.matched_prospects?.[0];
  if (!match?.prospect_id) {
    return { matched: false, matchResult };
  }

  const contacts = await post('/prospects/contacts_information/enrich', {
    prospect_id: match.prospect_id,
    parameters: { contact_types: ['email', 'phone'] },
  });

  return { matched: true, prospectId: match.prospect_id, contacts: contacts.data };
}

/**
 * Use case 3: find prospects at companies you already have (by Explorium business IDs).
 * @param {{ businessIds: string[], jobLevel?: string[], jobDepartment?: string[], limit?: number }} params
 */
async function fetchProspectsAtCompanies({ businessIds, jobLevel, jobDepartment, limit = 20 }) {
  const filters = { business_id: { values: businessIds } };
  if (jobLevel?.length) filters.job_level = { values: jobLevel };
  if (jobDepartment?.length) filters.job_department = { values: jobDepartment };

  return post('/prospects', {
    mode: 'full',
    size: limit,
    page_size: Math.min(limit, 100),
    page: 1,
    filters,
  });
}

module.exports = { fetchBusinesses, findPersonContact, fetchProspectsAtCompanies };
