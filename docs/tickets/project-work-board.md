# Project Work board MVP

Tracks Bamboo-agent #2041, slice D. The backend Project–Work relation is authoritative. This UI never derives membership from a session's project, a directory, a title, or a scope string.

## Entry and behavior

Open **Project Work** from a project's sidebar action menu. The default list and optional column view show the same explicitly linked Work. Columns are the backend's projection: Draft/Ready → todo, Active → doing, Submitted → awaiting acceptance, Accepted → accepted. Blocked retains its backend resume stage and an additional reason; paused is visible. Cancelled is an opt-in separate group and never appears in accepted. Selecting a Work changes only the local detail view; there are no drag-to-transition or acceptance controls.

Project workspace paths are metadata, not new execution permissions. Selecting Work shows the immutable adopted context, contract, dependencies, active assignment, owner session/run, and current/accepted submission evidence. Historical stale evidence is labelled as such. The project context summary is current project metadata; adopted context comes from the ticket backend snapshot and may be older.

## API contract

- `POST tickets/project-board`: explicit `project_id`, `include_cancelled`, `include_archived: false`, page limit 100, cursor and fixed commit. Counts cover the backend snapshot rather than just loaded cards. `total` includes cancelled; cancelled count is retained even while rows are hidden.
- `POST tickets/inspect`: selected ID, `assignments/requests/submissions`, 64 KiB budget, same immutable commit.
- All requests use the existing authenticated API client. Owner access is required in UI and enforced by the server.
- Every page validates commit/sequence/epoch, project identity, cursor progress, stable counts and duplicate IDs. Partial/index-lagged coverage displays unknown counts. More pages load explicitly; the UI does not claim all cards are loaded while a cursor remains.
- Refresh and online reconnect discard the old snapshot before reloading. Expired/gapped pagination (409/410) restarts from a full snapshot. Aborted, closed or superseded requests cannot replace the current project. This slice does not add a second polling/event loop; authenticated realtime invalidation is a later integration boundary.
- Older servers returning 404 display unsupported backend, not an empty project. No mock data is shipped in production.

## Scope of evidence

Unit/component tests exercise pinned pagination, inconsistent snapshots and cursors, partial counts, owner gating, missing APIs, project switching, stale evidence, cancellation grouping and read-only selection. The browser fixture covers desktop/tablet/phone and light/dark themes against the production bundle, using mocked HTTP responses. These tests establish UI/API-contract behavior, not a real Bamboo end-to-end integration. Live Project–Work creation/adoption and realtime reconnect acceptance must be verified with the matching Bamboo implementation before claiming the full #2041 MVP complete.

## Captured backend serialization contract

`src/test/fixtures/projectWorkBoardContract` preserves exact synthetic HTTP response bytes from Bamboo's `project_work_board_http` test at source `41a56acaec2ebc27aa8961a4f6d6023a2c695268`, tree `9fcc45c520572ca8fbb3edac403288962b2f635b` (test-only capture extension on `2373fe8e`). Its manifest records request bodies, snapshot and SHA-256 hashes. The Lotus contract regression verifies those hashes and consumes the captured two-page board and single-ID inspector through the production client.

Bamboo computes counts before paging. A legitimate page with a next cursor sets `truncated: true` and `omitted_count` to remaining rows; this does not make the full board counts unknown when scope coverage and index are authoritative. Unexplained omissions without a cursor still display unknown counts.

The producer uses a page size of one to exercise pagination; Lotus normally asks for up to 100. This is captured HTTP/serde response compatibility, not a live browser-to-Bamboo run, model execution, or a claim that the full feature has shipped.
