# CHANGES

## 2026-05-11 — Reliability hardening for sync, restore, and endpoint discovery

### Summary
Implemented the reliability-first improvement pass for the working extension.

### What changed
- Centralized restore behavior in `src/restore.js` with `restoreChat(origin, chat)`, shared payload normalization, remote ID extraction, restore mapping writes, chat remapping, and search document remapping.
- Updated archive and sidebar restore actions to use the shared restore API instead of duplicated UI-local logic.
- Hardened endpoint discovery in `src/api.js` with route-family-aware detail/create selection and stored diagnostics for list/detail candidate outcomes.
- Updated `createChat` to use the discovered create endpoint instead of hardcoding `/api/v1/chats/new`.
- Refactored backup execution in `src/background.js` to return structured results, track per-chat detail failures, and queue one follow-up run when sync is triggered during an active backup.
- Added shared `src/chatText.js` helpers for HTML escaping, plain-text extraction, and snippets; sidebar titles are now escaped before insertion.
- Replaced the popup clear-archive placeholder with a real local archive clear for chats, search docs, restore mappings, sync metadata, and `lastSyncAt`.

### Tests
- Added automated coverage for endpoint fallback/diagnostics, create endpoint selection, restore remapping, queued backup behavior, partial backup failures, and shared UI text helpers.
- `npm test` passes with 17 tests.

### Follow-up
- Validate the discovered API routes and `/c/{chat_id}` UI route against real CANChat/Open WebUI fork deployments.
- Consider surfacing endpoint diagnostics in the popup UI after failed Save/Test attempts.

## 2026-04-30 — Prefer v1 CANChat/Open WebUI API candidates

### Summary
Updated endpoint discovery candidate order to prefer v1 paths first for list, detail, and create operations.

### What changed
- `src/api.js` now probes list endpoints in this order: `/api/v1/chats`, `/api/chats`, `/api/conversations`, `/chats`.
- `src/api.js` detail templates now include `/api/v1/chats/{id}` first.
- `src/api.js` create candidates now include `/api/v1/chats` first.
- `ROADMAP.md` blocker and assumptions were updated to reflect v1-first probing.

### Why
The Save/Test flow was failing to discover list endpoints on environments that expose v1 routes. Prioritizing v1 improves compatibility with Open WebUI-style APIs while retaining fallbacks for non-v1 forks.

### Follow-up
- Capture fork-specific validation evidence for v1 and fallback paths in the roadmap validation log.
- Improve endpoint discovery diagnostics by surfacing per-candidate status/errors instead of swallowing exceptions.


## 2026-04-30 — v0.1 manual testing matrix and fork-compatibility assumptions

### Summary
Added a v0.1 manual testing matrix to `ROADMAP.md` with per-step status tracking (`not started`, `in progress`, `pass`, `fail`) and documented current blockers related to CANChat fork endpoint/routing differences.

### Exact change rationale
- v0.1 execution needs explicit visibility into which manual checks are complete versus blocked.
- Endpoint discovery and route assumptions are currently implementation-defined and may not match all CANChat forks.
- Capturing assumptions and blockers in planning docs reduces ambiguity and provides a concrete validation checklist before implementation hardening.

### Assumptions documented
- API list discovery candidates are `/api/chats`, `/api/conversations`, and `/chats`.
- Detail route candidates follow `.../{id}` templates.
- Chat route pattern is assumed to be `/c/{chat_id}` until proven per fork.
- Response shape assumptions for list/detail remain based on current normalization heuristics.

### Follow-up work
1. Validate endpoint discovery and chat route behavior against each supported CANChat fork environment.
2. Update `ROADMAP.md` validation log with concrete evidence (fork name/version, endpoint path, route pattern, date).
3. Replace failed/blocked statuses once validated and note any incompatible forks.
4. If incompatibilities are found, implement fork-specific routing and endpoint adapters, then document design decisions here.

## 2026-04-30 — Repository bootstrap documentation

### Summary
Initialized repository planning baseline with three root documents:
- `GOALS.md`
- `ROADMAP.md`
- `CHANGES.md`

### Decisions
- Adopt documentation-first project bootstrap.
- Track scope, sequencing, and key assumptions in dedicated files.
- Require synchronized updates to these files whenever scope or implementation changes.

### Assumptions
- Project is pre-implementation or early implementation.
- Requirements will evolve; documentation is expected to be iterative.
- Contributors will use these files as the canonical planning source.

### Follow-ups
- Add feature-level entries as implementation begins.
- Record any security/governance-impacting decisions in future changes.

## 2026-04-30 — Relax list discovery validation to endpoint reachability

Adjusted list endpoint discovery to treat a successful HTTP response as discovery success, even when JSON parsing fails or the payload shape is not one of the known list schemas.

- `src/api.js` now accepts 2xx list candidate responses as discovered endpoints when response parsing/shape validation is inconclusive.
- Added debug metadata indicating whether the response parsed as JSON and when an unknown shape is accepted.

Why
- Some CANChat/Open WebUI forks expose valid list routes with variant payload contracts, causing false negatives during Save & Test endpoint discovery.
