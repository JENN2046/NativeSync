# Execution decision experiment

This experiment extracts two existing local decisions: interrupted non-group
execution classification at restart, and the state patch after an existing
durable Journal intent has been applied. It is not a new task runner or event log.

`src/lifecycle.mjs` accepts a row observation, an input kind, external observation
time and (when applicable) a Journal receipt. It returns a guarded patch or no
decision. It has no clock, randomness, filesystem, network or database access.

The production-shaped adapter in `mobile/executionLifecycle.js` retains SQLite
authority: it observes interrupted rows inside a write transaction, and every
patch compares the relevant current durable fields in the same SQL write.
Plans are not authorization and cannot be applied blindly after state changes.

`ConversationExecution` actually uses this path in the experiment. Journal
publication still follows the original durable-intent / apply / settle sequence,
with original operation IDs and idempotent replay. Group recovery, native tool
dispatch, AA acceptance, final evidence and uncertain results remain owned by
their existing implementations.

The shared build command generates one deployment-local CommonJS file for this
model. It does not bundle execution decisions into the browser.

The tests compare 252 combinations with the original fixed SQL, exercise 10000
deterministic restart transitions, reject stale plans using actual SQLite,
and retain real process-exit tests. The memory model supplements the physical
recovery tests; it does not establish filesystem durability or external exactly-once.
