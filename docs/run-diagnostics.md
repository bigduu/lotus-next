# Run diagnostics

The generation/submission error alert has an optional **View diagnostics** action. Opening it previews a fresh allowlist JSON locally. The user can explicitly **Read service diagnostics** from the existing session-detail API, review the result and request a JSON download. Opening, cancelling, reading or downloading never uploads diagnostics, invokes a model/tool, retries a generation or changes permissions. Existing technical-error text and Retry behavior remain intact.

## Compatible transport

This consumer follows the frozen Bamboo source contract `665fa220ed2623499087c92135c5026b52bc46b8`. That backend candidate was source-only and had not been compiled or exercised with this frontend at implementation time. Optional structured receipts may arrive as `diagnostic` on existing error events or `session.last_run_diagnostic` on `GET /api/v1/sessions/{id}`. List/index summaries omit the detail field. Older servers and malformed/missing/null receipts retain the original error and show structured details as not provided. Lotus neither invents an endpoint nor calls `bamboo_diagnostics` automatically.

The public projection accepts only schema 1, stop events, known finite labels and bounded integers, with at most 4096 serialized bytes. It rejects unknown fields. Its host-generated diagnostic/request/error UUIDs must match, its domain-separated session hash must match the selected conversation, and its full generated error must match the displayed failure (with the existing optional `LLM error: ` wrapper). An isolated UUID substring cannot attach a structured receipt. The session hash and runtime correlation ID are observational: they do not authorize recovery, tool replay or control, and runtime `run_id` is not asserted equal to a Host activation/backend run ID.

Legacy terminal errors may carry one exact lowercase UUID-v4 marker, optionally followed by the fixed upstream support guidance. Only that bounded marker is extracted. Prose such as “1 request(s)” is never parsed into a configured retry limit. The structured preview shows actual attempts and their separate limit, failure stage and retry-stop reason only when a valid receipt supplies them.

## Lifetime and canonical reads

A live error receipt is labelled as a live observation, not proof of a saved checkpoint. An explicit read uses the existing no-store session-detail request and validates the same-read status, session and complete error. It withdraws old structured fields immediately. Missing, invalid or failed reads cannot revive the old live receipt. A changed session, running state or failure invalidates the preview and disables its download. Canonical confirmation means the matching receipt was observed in that read; it does not authorize a later retry.

New runs, switched sessions, closed dialogs and subsequent failures invalidate pending imports, reads and download handlers. Reopening even the same failure creates a new preview identity. The owned stream guards reject late errors from an earlier operation. The optional decoder loads before a stream subscription, preserving error/terminal order; its load failure leaves ordinary legacy error observation available. An aborted subscription does not connect after that load. These fields do not alter pending approvals, workspace selection or execution admission.

## Export boundary

The report is built from an explicit allowlist: schema/collection time; bounded public Lotus version, revision and host kind; recognized conversation and numeric client-operation identifiers; strict diagnostic identifiers and source; and validated public diagnostic enums, timestamps, nullable HTTP status, budgets, elapsed times, attempts and runtime correlation. Collection time is distinct from error occurrence time. The free-text failure classification is omitted from the export even after validation.

No original error prose, messages/reasoning, tool arguments/results/stdout, files, screenshots, settings, endpoints/query strings, headers, tokens, cookies or credentials are copied. Unknown and malformed values become unavailable/null. Arbitrary object dumps and regex-only redaction are not used. Support identifiers remain linkable; the user sees the exact JSON before sharing it. Download uses the ordinary browser Blob mechanism, with no native business dependency; the UI reports a download request rather than claiming a file was saved.

## Verification limits

Framework tests cover the frozen record and independent session-hash vectors, legacy marker compatibility, whitelist/privacy boundaries, explicit canonical reads, old-field withdrawal, local download mechanics, lazy cancellation and cross-session/new-run isolation. They do not establish that the backend candidate is deployed or prove an actual SSE/WS/checkpoint round trip. Real backend transport and native file-save acceptance remain separate until current-source binaries are available.
