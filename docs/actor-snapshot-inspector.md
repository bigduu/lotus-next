# Authorized actor snapshot Inspector (#199)

The Inspector reads Bamboo #1337's schema-v1 DTO through the existing authenticated
API client: `GET /api/v1/actors/{root}/snapshot?subtree_id={root}`. This is a local,
cancellable snapshot view. It adds no socket, polling, broker credentials, event
replay, or permission authority.

`snapshot_id` has the producer's `as1-` plus 64 lowercase hex shape and is an opaque
equality identity. Per-actor metadata/directory revisions are retained. They are
never converted into a global revision, sequence, attempt, or stream cursor.
Activation UUIDs accept Rust `Uuid::parse_str` forms (simple, hyphenated, braced,
lowercase `urn:uuid:` prefix; case-insensitive hex). Original identities are kept.

The whole DTO is rejected for unsupported shapes, unexpected fields, invalid
scope/parent/depth relationships, unsafe integer revisions, or violated budgets.
There is no partial tree success. Public response reads are capped at 256 KiB and
256 nodes, actor IDs at 256 UTF-8 bytes, titles at 160 Unicode scalar values.
Producer storage budgets may also reject a read; the UI displays the failure and
allows an explicit retry.

Logical states are last durable records: `cold`, `active`, `failed`, `retired`.
`active` is labeled "活动记录" and is not proof of online health. Placement class
labels preserve the distinctions: `local` 本机, `docker` 容器, `ssh` SSH, `remote`
远端, `schedulable` 待调度. Missing directory or placement observations remain
unknown. Health, queue, wait, and request counts are not in this DTO and stay null.

Expanding a row changes only the local virtualized tree. Explicit child selection
uses the existing secondary message projection and `message.{id}` channel on the
single Bamboo stream. Root selection clears the child preview and selects the
main Root. Refresh keeps selection while cancellation and a request generation
guard discard late responses from a closed Inspector or different Root.

Evidence lives in `actorSnapshot.test.ts`, `useActorSnapshot.test.tsx`, and the
built-artifact `actor-snapshot-inspector.spec.ts`. The browser fixture uses 129
actors through depth three, verifies bounded mounted rows, expansion without
content reads, selected-child projection, Root return, loading and budget errors
on desktop and phone. Canonical snapshot/event reconciliation remains a separate
follow-up to the producer event DTOs (#928/#929/#930).
