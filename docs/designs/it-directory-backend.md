# IT Directory Backend

## Problem frame

- **User & job:** Internal administrators need one place to maintain a searchable IT inventory and consult security operating guidance.
- **Problem:** The SaaS has IT work items but no structured directory catalog for people, computers, groups, or printers.
- **Success metric:** Administrators can create and search directory objects by organizational-unit base and constrained LDAP-style filters; the security guide is available through an authenticated API.
- **Constraints:** Backend only, existing Express/SQLite stack, parameterized SQL, admin-only access, bounded search results, and additive schema changes.
- **Non-goals:** Live Active Directory/LDAP/Kerberos integration, domain replication/DNS/GPO enforcement, account unlocks, password/hash/ticket storage, and UI changes.

## Options

| Option | Value | Effort (5=low) | Risk (5=low) | Reversibility | Fit with codebase |
|---|---:|---:|---:|---|---:|
| Add a backend-only SQLite directory catalog, constrained LDAP-style search, and static guide endpoint | 5 | 3 | 4 | High | 5 |
| Integrate directly with a live LDAP/Active Directory forest | 5 | 1 | 1 | Medium | 1 |
| Add only an unpersisted security-guide endpoint | 2 | 5 | 5 | High | 4 |

## Design brief

**Idea:** Add an authenticated IT directory catalog and security guide to the SaaS backend.

**Chosen option:** Additive SQLite storage with a validated service and admin-only router. It provides useful search without requiring domain credentials or introducing an external directory trust boundary. Keep product-generated agent responses concise and decision-relevant; cap and validate AI-assisted email rewrites.

**Riskiest assumption:** A constrained LDAP filter subset is sufficient for the intended internal searches. The prototype will exercise equality filters, nested conjunction/disjunction/negation, OU subtree scoping, invalid input rejection, and parameterized storage queries.

**Prototype plan:** Test the parser and service against the existing SQLite-backed store, plus route authorization and response behavior through an HTTP test app.

**Files touched:** `store.js`, `services/it-directory-service.js`, `routes/it-directory.js`, `server.js`, `agent.js`, `email-assistant.js`, `lead-pipeline.js`, `package.json`, `ARCHITECTURE.md`, `SECURITY.md`, agent/directory tests, and this brief.

**Config/env:** No new variables.

**Rollback:** Revert the backend route/service commit. The additive table and indexes can remain unused; no existing schema or data is transformed.

**Done when:** Create/update/search paths reject invalid data safely, the API is admin-only, the rule guide describes OSI controls and safe lockout triage, search is bounded and parameterized, and `npm test` passes.

## Assumptions

- “All in the back-end” means no new HTML/UI or static-site copy.
- The directory is a SaaS catalog, not an authoritative identity provider and not a live synchronization client.
- Example names and password hashes in the prompt are illustrative. No sample personal records, passwords, password hashes, Kerberos tickets, or `ntds.dit` data will be seeded or stored.
- A Group Policy restriction is not overridden by this service. Kerberos troubleshooting is guidance only; account unlocks and domain changes remain operator actions.
- “OSI model in sync” is interpreted as documenting relevant security controls by layer, not synchronizing the seven conceptual layers as data.

## Outcome

Implemented admin-only create/search/update/audit APIs for directory records, an authenticated security-guide API, and concise output constraints for the project planner, Mia, the lead-processing log, and AI-assisted email replies. No frontend assets were changed. The directory uses an indexed reversed-DN key for subtree searches; AI email output over 120 words or containing common filler is rejected rather than sent.

Validation results: `npm test` passed all 95 tests, including syntax checks, directory HTTP/SQLite tests, and concise-agent response tests. `git diff --check` passed.
