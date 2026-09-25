// This folder is deployed as a SEPARATE Netlify site (manual drag-and-drop),
// so it cannot use same-origin relative paths. Point it at the canonical
// Netlify site that hosts the Netlify Functions API.
//
// Change this value if your canonical site uses a different domain.
window.DISPATCH_API_URL = 'https://lead-saas-agent.netlify.app';
