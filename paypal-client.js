// near top, after require('dotenv').config();
const fetch = globalThis.fetch;
if (!fetch) {
  throw new Error('Global fetch() is not available in this Node runtime. Use Node 18+ or add a fetch polyfill.');
}