# Session compatibility after an in-place reconnect

This independent #2077 frontend follow-up starts at frozen `7eb9574`, without changing that checkout or the original `8dea054` artifact. It consumes the same detail-only `execution_compatibility` v1 contract, under Bamboo #1048 / #2000 coordination. Current #2078 Task single/pair/rollback P1 and any later backend candidate remain independent; this frontend is not a fix or runtime acceptance of those server/storage guards.

## Observed gap and smallest correction

The compatibility hook read detail on mount and explicit refresh only. Account-feed reconnection refreshed session lists/history/pending, while list rows may omit compatibility. A mounted transcript could therefore continue displaying an old compatibility assessment after a real WebSocket connection recovered, until the user manually refreshed or an execution returned a typed 409.

One new hook test failed against that original source (expected the second detail GET, observed only one). The new desktop and phone browser fixture also both failed against a local copy of the original 8dea artifact: a new socket connected, but the canonical conflict notice never appeared. Original failure logs/traces are retained. An initial command-directory error happened before Vitest and is recorded separately, not counted as RED.

The hook now subscribes to the existing `onReconnected` notification and only rereads its current selected/bound session. Cleanup removes the listener on binding change/unmount. It issues no execution, input, permission, migration, scope update or historical-session enumeration. A fresh report updates the view through the existing memory observation generations; a typed execution conflict still wins over an older in-flight reconnect response. Existing missing-report/read-error policy and the explicit refresh button remain intact.

## Scoped validation

New hook cases cover conflict discovery, legacy-compatible recovery, current-binding cleanup and typed-409/read races. The built-browser case uses two actual routed socket close/reconnect cycles in the same document (one main navigation). It preserves transcript/draft while the server reports a conflict, then displays a fresh legacy-compatible report. Recovery performs no automatic write; only a subsequent explicit Send may submit the retained draft. All HTTP/WS responses are synthetic.

Only this new candidate needs a build. Its source/resource hashes and browser outcomes are recorded in its delivery receipt, distinct from 7eb/8dea and 9ba. No unchanged 349-case suite, old full browser suite, Rust build, login addition, Bodhi/native business dependency, real user scope or paid model request is included. Actual listening #2078 integration stays UNRUN until the backend owner provides a P1-repaired current-source binary and an isolated fixture receipt.
