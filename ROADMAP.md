# ROADMAP

## Completed tasks (initially minimal)

- Repository planning scaffold created.
- Added root-level goals, roadmap, and changelog artifacts.

## Current phase

Reliability hardening for the implemented browser extension.

## Next tasks

- Validate endpoint discovery and chat deep-link routes against each supported CANChat/Open WebUI fork.
- Add browser-level manual validation for backup, restore, import/export, and side panel workflows.
- Decide whether popup import/delete flows need additional confirmation or dry-run summaries before release.
- Establish CI execution for the Node test suite.

## Deferred features

- Advanced integrations and external dependencies.
- Performance optimization and scale-focused improvements.
- Non-essential UX/workflow enhancements.

## Blockers

- API endpoint and route compatibility across CANChat forks is still unvalidated for v0.1.
  - Discovery currently probes: `/api/v1/chats`, `/api/chats`, `/api/conversations`, `/chats` for list and create operations (v1-first).
  - Detail route validation now uses a sample chat ID when list results provide one; otherwise it falls back to the closest route family.
  - Create route selection now follows the discovered list route family, with `/api/v1/chats/new` preferred for v1.
  - UI routing assumption for opening chats is `/c/{chat_id}`; this may differ by fork.
  - Blocker impact: manual test steps that depend on live chat listing/detail creation cannot be marked `pass` until fork-specific endpoint and route validation is completed.

## Testing status

- Automated Node test suite exists and currently covers export/search helpers plus reliability-focused API discovery, restore remapping, queued backup behavior, partial backup failures, and shared UI text helpers.
- Browser-level manual testing remains required before treating v0.1 as release-ready.

## v0.1 Manual testing matrix

| Step ID | Manual test step                                                                                         | Status      | Notes                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| V0.1-M1 | Configure CANChat base URL in extension settings and save.                                               | pass        | Settings persistence is implemented and manually exercised during development.                        |
| V0.1-M2 | Run endpoint discovery against target CANChat fork and verify list endpoint resolution.                  | in progress | Candidate list exists with diagnostics, but fork-specific validation is incomplete.                   |
| V0.1-M3 | Fetch chat list and verify response-shape normalization (`array`, `items`, `chats`, or `conversations`). | not started | Blocked until M2 passes on each target fork.                                                          |
| V0.1-M4 | Fetch chat detail by ID from discovered template route and verify ID-like field presence.                | not started | Depends on validated detail endpoint and representative IDs.                                          |
| V0.1-M5 | Create a chat via discovered create endpoint and verify successful response.                             | not started | Create route is selected from the discovered route family; payload shape still needs fork validation. |
| V0.1-M6 | Validate UI route pattern for opening a chat (`/c/{chat_id}`) end-to-end.                                | fail        | Current route pattern is an assumption only; no successful fork validation recorded yet.              |

## API and routing assumptions (to be updated after validation)

- Assumption A1: List endpoint is discoverable via one of `/api/v1/chats`, `/api/chats`, `/api/conversations`, or `/chats`.
- Assumption A2: Detail endpoint accepts `{id}` under one of `/api/v1/chats/{id}`, `/api/chats/{id}`, `/api/conversations/{id}`, or `/chats/{id}`.
- Assumption A3: Create endpoint is available at the same path family as list endpoints, with `/api/v1/chats/new` preferred for v1-compatible forks.
- Assumption A4: Chat UI deep-link pattern is `/c/{chat_id}`.

### Validation update log

- 2026-04-30: Initial assumptions documented. No fork-specific validation evidence captured yet; all assumption statuses remain `unvalidated`.
