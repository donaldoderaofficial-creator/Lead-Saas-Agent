---
name: innovation-design
description: 'Take a new Lead-Saas-Agent / Dispatch Pro feature idea from concept to working code. Use when: innovating, designing a new feature, prototyping, spiking, proof of concept, exploring solution options, adding a lead-pipeline, payment (PayPal/M-Pesa), compliance, dashboard, or Netlify function capability. Produces a design brief, scored options, a prototype testing the riskiest assumption, and a tested implementation.'
argument-hint: 'Describe the feature idea or problem'
---

# Innovation Design (Lead-Saas-Agent)

Turn an idea into a validated, working feature in this Node/Express lead-qualification SaaS.

## When to Use
- A new capability for the lead pipeline, agent, billing, compliance, dashboard, or Netlify functions
- Multiple approaches exist and the best one is unclear
- An assumption must be proven before committing

## Repo Facts
- Node >= 22, Express, plain CommonJS modules at repo root; static UI in `public/` (mirrored in `netlify-static/`); serverless in `netlify/functions/`.
- Node may not be on PATH in the agent terminal: prefix `$env:Path = "C:\Program Files\nodejs;$env:Path"`.
- `npm test` = `npm run check` (`node --check` per file) + `node --test` (`test/*.test.js`). **Add new JS files to the `check` script** in `package.json`.
- Tests that load `config.js` must set `process.env.SESSION_SECRET` first.
- Payments: `enabled` is always true (advertised); use `configured` for credential checks.
- Guidance: [IMPROVEMENT_ROADMAP.md](../../../IMPROVEMENT_ROADMAP.md), [ARCHITECTURE.md](../../../ARCHITECTURE.md), [SECURITY.md](../../../SECURITY.md).

## Procedure

### 1. Frame the problem
Capture in 5-8 lines: **user & job**, **problem**, **success metric**, **constraints**, **non-goals**. If anything is unclear, infer the most reasonable version and record it as an assumption.

### 2. Explore the landscape
- Survey read-only (prefer a search subagent): related modules (`lead-pipeline.js`, `agent.js`, `store.js`, `payment-catalog.js`, `compliance.js`, etc.), existing tests, and docs above.
- Identify trust boundaries touched: `auth.js`, payments/webhooks (`paypal-client.js`, `mpesa-client.js`), `store.js` schema, external APIs (`explorium-client.js`).

### 3. Generate and score options
At least 3 options, always including a **minimal/incremental** one. Score 1-5:

| Option | Value | Effort (5=low) | Risk (5=low) | Reversibility | Fit with codebase |
|--------|-------|----------------|--------------|---------------|-------------------|

Recommend one and name its **riskiest assumption**.

### 4. Design brief
Save to `docs/designs/<idea-slug>.md` (create the folder if missing):
```
Idea:                <one line>
Chosen option:       <name + why>
Riskiest assumption: <what could make this fail>
Prototype plan:      <smallest spike that tests it>
Files touched:       <list, incl. tests + package.json check script>
Config/env:          <new vars -> config.js + env.example>
Rollback:            <feature flag / config toggle / revert>
Done when:           <success metric + tests>
```
Proceed without pausing. Record assumptions made in lieu of user input under an `Assumptions` heading. Take extra care (tests + rollback) when touching payments, webhooks, auth, or the `store.js` schema. Deploys, pushes, and data deletion still require confirmation.

### 5. Prototype
- Smallest spike testing the riskiest assumption, isolated in a new module or behind a config flag.
- Exercise it via a `node --test` case or a quick script. If it fails, return to step 3.
- Decide explicitly: **keep and harden** or **discard and rebuild**.

### 6. Implement
- Add/extend `test/<area>.test.js` first.
- Keep business logic out of route handlers in `server.js`; validate input via `validators.js` at the boundary.
- New env vars go in `config.js` and `env.example`; never hard-code secrets.
- If UI changes, update both `public/` and `netlify-static/` copies where applicable.
- No scope creep beyond the brief.

### 7. Validate
- Run `npm test`; fix every failure introduced.
- Check editor errors on changed files.
- Verify the success metric; review new inputs/external calls for OWASP Top 10 issues (injection, broken auth, SSRF, secrets exposure).

### 8. Hand off
Update the brief file with outcome, validation results, and follow-ups. Briefly report: what was built, how it was validated, remaining risks, rollback path. Suggest a commit via `npm run commit:preview`.

## Quality Gates
- [ ] Problem and success metric stated before code
- [ ] ≥3 options including minimal
- [ ] Riskiest assumption tested by a prototype
- [ ] Design brief saved in `docs/designs/` with assumptions listed
- [ ] New files added to `check` script; `npm test` passes
- [ ] Config documented in `env.example`; rollback path stated
