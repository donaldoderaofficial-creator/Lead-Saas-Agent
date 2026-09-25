'use strict';

/**
 * Shared helpers for the canonical Netlify Functions API.
 * Netlify Functions are the canonical stateless backend for the public
 * payment-options/config endpoints used by every deployed frontend link.
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=30, stale-while-revalidate=300',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Content-Type-Options': 'nosniff',
};

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  };
}

/**
 * Wrap a payload builder into a Netlify Function handler that only answers
 * GET/HEAD/OPTIONS and never throws an unhandled error at the client.
 */
function createReadOnlyHandler(buildBody) {
  return async (event = {}) => {
    const method = (event.httpMethod || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: JSON_HEADERS, body: '' };
    }
    if (method !== 'GET' && method !== 'HEAD') {
      return json(405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD, OPTIONS' });
    }
    try {
      return json(200, await buildBody(event));
    } catch (error) {
      return json(500, { error: 'Payment configuration is unavailable.', detail: error.message });
    }
  };
}

module.exports = { JSON_HEADERS, json, createReadOnlyHandler };
