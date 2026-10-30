# Controlled same-source authorization transition (isolated candidate)

This is a new Batch1 mechanism, not production authorization or a distributed
single transaction. Server DB commit and client state commit are separately
atomic; durable idempotent receipts bridge acceptance/reply loss and restart.
No new database, registry, AA engine, attachment engine or handover framework.

## Trusted explicit input

The existing static NativeSyncFullSources grant keeps its original `scope` and
may separately stage `approvedScope` with the exact new limited collection, or
explicit `{ "mode": "full" }` for the existing all-native-root/future-discovery
contract. Ordinary scope edits, discovery, a requested body or missing fields
are not approval. Host Bearer protection and source/device/space identity remain.
The internal source HTTP POST `/source/scope-transition` takes `opId`,
`expectedScopeHash`, `newScope`; newScope must exactly equal that separately
staged static approval. No shrinking, implicit full mode or new-source transfer.

The client connection keeps the same sourceId/deviceId/spaceId/sourceRoot, sets
the explicitly approved `sourceScope`, and adds `scopeTransition` containing
`opId` and `expectedScopeHash`. Explicit full uses sourceScope:{mode:"full"};
absence cannot trigger a full transition. At normal startup SourceSync.verify
requires settled old queues/receipts/plans or published topic deletions, checks
physical root/target paths and identity, requests the approved CAS, verifies the
receipt, then Adapter.open verifies the original whole-state hash before its
atomic replacement of source binding only. Acked/receipts/cursor are retained.
Use this startup path; manually forcing server transitions cannot attest an
offline client's Outbox. Unsettled state is not automatically cleared/adopted.

## Server atomicity and old permissions

One existing central-SQLite transaction validates the old pin, exact approved
target, device/space, portable physical case/path collisions, old settled catalog
and other-source ownership conflicts. All prior source-scoped sessions and all
unused source-scoped pairings are frozen to old topic keys using the already
supported exact-topic scopes. IDs/cookie hashes/expiry/selection and job domains
are not changed. Scope pin and idempotent receipt in native_sync_metadata commit
together. Failure after permission freeze or pin write rolls back all table data.
A real child process exit after the uncommitted pin write also leaves all table
logical digests unchanged after reopen. This is not a physical WAL-byte claim.

Pair consumption rereads scopes inside its write transaction, preventing a stale
pre-read from recreating live source authority after competing conversion.
Normal source binding/info reject stale in-memory pin views; source mobile
authorization additionally checks the granted tuple, not merely sourceId.
Accepted old topic deletions remain hidden, not resurrected by an expansion.

Limited additions are exact, monotone, max128; explicit full approval reuses the
legacy full-root implementation and rejects existing foreign catalog ownership.
Future native-path/identity errors remain discovery failures, never automatic
ownership takeover. Old cookies stay on old keys while newly approved source
pairings see the current authorized collection/root. Repeated/concurrent opIds
replay the same receipt; changed payload or stale old digest fails closed.
On restart, original configured scope plus the same approvedScope restores the
committed pin only when its saved approval receipt matches. Without that proof,
ordinary changed grants remain SOURCE_SCOPE_CHANGED.

## Execution and full-feature reuse

Dynamic source topics require explicit registered native aliases, not test-side
mutation. Reuse NativeMobileTopics/memberAliases and the author's AgentManager;
existing catalog keys must match, and collisions/renames are rejected. Source-
authorized or explicitly staged mappings may contain up to128 entries; legacy
unscoped selection remains bounded at8. Desktop source executionTopics likewise
supports128 explicitly selected identities; no automatic private-prompt grant.
Private config publication batches multi-topic bodies near96KB UTF8, without
truncating or newly rejecting single snapshots; per-topic version/hash and group
member snapshot atomicity remain the server's existing contract. Endpoint,
versioned configs, attachments and group policies remain explicit opt-ins.

## Evidence and actual limits

tools/run_full_feature.py executes the directly affected synthetic module chains:
controlled scope, mobile submit/replay/result and desktop restore; native Queue
offline/conflict/process-exit; PWA upload kernel plus real HTTP binary/hash
roundtrip; Desktop upload/restore and CAS reopen; group frozen config, approvals,
cancel/review/restart; actual Handler/tool parser/PluginManager/AgentAssistant,
parent reply before AA finish, forged callback non-authority, native result and
actual child exit. Native AA starts are synthetic tasks with loopback model HTTP,
not paid models or real production tasks. Matched Group test moves the obsolete
AgentManager snapshot assertion to the plugin snapshot adapter, keeping original
host behavior and unrelated-alias checks. AA fixture includes dynamic plugin
source dependencies; old timeouts from missing better-sqlite3 bindings and all
earlier failures are retained, not counted as feature success.

No production read/write/deploy/restart, real phone/Electron/browser/TLS/model/tool
or AA operations. Existing C1/C2/phone and whole43 are not rerun; two selected
legacy full-source cases are directly affected compatibility checks. JEV/game
cloud execution and unpublished desktop workspace/context remain explicitly
unavailable under the inherited contract, not silently treated as cloud parity.
New-source transfer and scope narrowing remain unsupported, with original
counterexamples retained; they are not required for the implemented same-source
approved route. Actual UI rehydration on scope-mode change, OS-specific ACL/
symlink behavior and real all-source execution/attachments/AA continuity require
Batch2's precise authorization and hardware evidence. This Node candidate is
not a formal production release or a claim every possible combination was run.

Production currently remains the old installed354d52ac product combination and
existing two-topic data. Continuous real writes, data expansion, installation,
phone sending, real models/tools/AA and Git publication still need Jenn's exact
authorization. sourcePaused is not a completed-topic write freeze. Failures keep
state/receipts and same-scope fences; never clear/replay/rebuild another space.
