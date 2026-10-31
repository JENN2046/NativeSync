# Execution decision experiment (test only)

This experiment extracts two existing local decisions: interrupted non-group
execution classification at restart, and the state patch after an existing
durable Journal intent has been applied. It is not a new task runner or event log.

`src/lifecycle.mjs` accepts a row observation, an input kind, external observation
time and (when applicable) a Journal receipt. It returns a guarded patch or no
decision. It has no clock, randomness, filesystem, network or database access.

This model and `tests/fixtures/executionLifecyclePrototype.cjs` remain local
experiments. They are not imported by the candidate ConversationExecution and
are not included in the install payload. The candidate retains original bulk
SQL recovery and durable Journal intent settlement. Historical reports describe
the earlier prototype; see the release scope for the current selection.

The model checks and guarded-write comparisons remain useful experimental
evidence, separate from verification of the installed candidate. They do not
establish filesystem durability or external exactly-once execution.
