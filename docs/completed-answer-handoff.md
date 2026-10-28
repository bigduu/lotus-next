# Completed-answer handoff

A completed stream can precede its canonical history checkpoint. The frontend
keeps only the pending final body in process memory, scoped to its session and
turn; it never writes that body into canonical history. Canonical confirmation,
a verified clear, a confirmed relevant truncate/delete, or session removal
retires the handoff. In-flight older callbacks are fenced after those actions.

The cache holds at most 128 unresolved handoffs and expires each after 30
minutes. If an unconfirmed entry expires or is evicted, its body can disappear
when its pane is closed until the canonical history arrives. Expiration and
eviction do not imply persistence or successful confirmation.

An absent acknowledged user anchor in an ordinary history read is ambiguous:
it can be an older snapshot or a deletion. The handoff remains pending but is
not attached to another turn until its anchor reappears. A `session_cleared`
feed event fences entries already known at notification time. That event has no
revision, so a delayed cross-client event cannot prove whether an independently
observed new run predates it. Ordinary remote message deletion/truncation also
has no exact generation signal in this UI; these cases remain unverified.

Hook-local operation numbers are not global identities. Known identical runs
may coalesce only when the execution response supplies the same session/run ID;
missing run identity is not guessed from equal text or message IDs. Two panes
with no run identity can therefore temporarily show duplicate unconfirmed bodies.
The history contract likewise cannot prove two same-turn, same-text attempts
from one unchanged canonical message; one canonical ID confirms at most one
pending attempt. The cache and UI projections reset on a full page reload.

History readiness treats a nonempty text or image part as a terminal assistant
response, while a genuinely empty checkpoint continues the bounded history
read. The existing assistant-history mapper does not project `content_parts`
into the displayed message when `content` is empty; this separate parts-only
rendering gap is not fixed or claimed as covered by this slice.
