# ROADMAP

## Completed tasks (initially minimal)
- Repository planning scaffold created.
- Added root-level goals, roadmap, and change log artifacts.

## Current phase
Bootstrap planning and scope definition.

## Next tasks
- Define first implementable feature slice with clear requirements.
- Add initial architecture notes aligned to goals and non-goals.
- Establish baseline testing approach and CI expectations.
- Assign ownership for roadmap updates and decision tracking.

## Deferred features
- Advanced integrations and external dependencies.
- Performance optimization and scale-focused improvements.
- Non-essential UX/workflow enhancements.

## Blockers
- API endpoint and route compatibility across CANChat forks is unvalidated for v0.1.
  - Discovery currently probes only: `/api/chats`, `/api/conversations`, `/chats` for list and create operations.
  - Detail route currently assumes one of: `/api/chats/{id}`, `/api/conversations/{id}`, `/chats/{id}`.
  - UI routing assumption for opening chats is `/c/{chat_id}`; this may differ by fork.
  - Blocker impact: manual test steps that depend on live chat listing/detail creation cannot be marked `pass` until fork-specific endpoint and route validation is completed.

## Testing status
- Planning documentation created.
- No automated tests defined yet for implementation code.

## v0.1 Manual testing matrix
| Step ID | Manual test step | Status | Notes |
| --- | --- | --- | --- |
| V0.1-M1 | Configure CANChat base URL in extension settings and save. | pass | Settings persistence is implemented and manually exercised during development. |
| V0.1-M2 | Run endpoint discovery against target CANChat fork and verify list endpoint resolution. | in progress | Candidate list exists, but fork-specific validation is incomplete. |
| V0.1-M3 | Fetch chat list and verify response-shape normalization (`array`, `items`, `chats`, or `conversations`). | not started | Blocked until M2 passes on each target fork. |
| V0.1-M4 | Fetch chat detail by ID from discovered template route and verify ID-like field presence. | not started | Depends on validated detail endpoint and representative IDs. |
| V0.1-M5 | Create a chat via discovered create endpoint and verify successful response. | not started | Not yet validated per fork; may require payload-shape adjustments. |
| V0.1-M6 | Validate UI route pattern for opening a chat (`/c/{chat_id}`) end-to-end. | fail | Current route pattern is an assumption only; no successful fork validation recorded yet. |

## API and routing assumptions (to be updated after validation)
- Assumption A1: List endpoint is discoverable via one of `/api/chats`, `/api/conversations`, or `/chats`.
- Assumption A2: Detail endpoint accepts `{id}` under one of `/api/chats/{id}`, `/api/conversations/{id}`, or `/chats/{id}`.
- Assumption A3: Create endpoint is available at the same path family as list endpoints.
- Assumption A4: Chat UI deep-link pattern is `/c/{chat_id}`.

### Validation update log
- 2026-04-30: Initial assumptions documented. No fork-specific validation evidence captured yet; all assumption statuses remain `unvalidated`.
