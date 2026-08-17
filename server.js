// Add near the top:
require('dotenv').config();

// ...later, replace the store import and the session middleware setup:

const session = require('express-session');
const { pendingLeads, completedReports, leads, users, createSessionStore } = require('./store');

// ...

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: createSessionStore(session), // use SQLite-backed store from store.js
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
  },
}));