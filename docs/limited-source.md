# Limited SourceSync contract (isolated candidate)

This is a local-only candidate on the initial public snapshot
`65fd5863ab7f62139111a828d86bfb4bc627e7c1`. It has not been deployed or pushed.
Coordination and installation decisions remain in VCPChat #70. C1/C2 acceptance
and the installed three-core-file compatibility combination are unchanged.

## Explicit scope

Existing selected mode and legacy source grants without `scope` retain their
existing semantics. A legacy source is an approval of the entire native root.
New limited grants use `scope` and the client connection uses `sourceScope`:

```json
{"mode":"limited","topics":[
  {"ownerType":"agent","ownerId":"one","topicId":"selected"},
  {"ownerType":"agent","ownerId":"one","topicId":"old-topic"}
]}
```

These are synthetic names, not production configuration. A limited grant still
contains sourceId/deviceId/optional label. The source connection retains existing
sourceId/spaceId/sourceRoot/deviceId, `fullSelectionApproved:true`, `topics:[]`
and the previous selected-state verification. That existing approval flag does
not override the explicit limited scope. executionTopics must also be in scope.

Scope is a nonempty set of at most 128 exact ownerType/ownerId/topicId tuples;
unknown fields, incomplete/duplicate identities and malformed modes are errors.
Parent Agent/group metadata may be published for those tuples; its other topics
are not authorized. Broad owner deletion in limited mode is rejected: use exact
topic deletion, so a parent tombstone cannot hide unapproved siblings.

Discovery filters owners before their config reader and topics before their
history path/snapshot. ensureTopic/ensureSnapshot and loading durable plans also
enforce the scope. The server independently checks catalog parents/topics,
deletion targets, legacy proofs, baseline create/read/complete and Journal push.
The original HTTP push topic/device checks remain. A limited device cannot
downgrade its push to selected/unscoped headers. Bearer authentication remains
the host's existing administrative authority; this does not create a new user
permission system or a separate authentication channel.

The normalized set is retained in Adapter.source.binding; a SHA-256 digest is
sent as X-NativeSync-Scope. Limited grants require that digest, including info.
The first grant scope (including legacy null/full) is pinned in the existing
native_sync_metadata table under sourceScope:<sourceId>, in the same transaction
as source binding. No new database/table/message ledger is introduced. Reusing
an existing source with a missing, wider, narrower or otherwise changed scope
fails. Old bindings with no marker can only initialize their legacy full marker;
they cannot be silently converted into limited ones.

## Pause and recovery

For a limited source, `sourcePaused:true` pauses discovery, new captures, catalog
publication and import steps. The runtime reads connection configuration at
normal startup; this is not a live remote control switch. Pause/resume requires
normal client close and reopen with the same binding and scope. Neither switching
back to selected nor changing device/space/source is a pause mechanism.

Already captured plans, original operation IDs, receipts, cursor, pending local
commits and the execution/config records are retained. Ordinary sync may still
settle operations on already completed topics. Incomplete baselines retain their
existing outbound/inbound protection; they are not declared complete by pausing.
Outside-scope native changes remain local without snapshots or Outbox creation.
Physical owner-path collisions remain rejected. If connection is absent/offline,
the durable recovery fence protects every approved tuple (including not-yet-
attached topics), while unrelated topics can still be edited locally. Corrupt
state remains fail-closed. Resuming the same scope continues original plans.

## Validation and limits

See tests/README.md and tools/run_limited_tests.py. Use matching isolated public
host fixtures and independent dependencies, never production runtime/AppData.
The original failure is retained in the external evidence package. The old
required safety assertion now runs against an explicit limited grant; a separate
legacy whole-root test still asserts that the foreign topic is included there.

No real history, model/provider, AA/tool or phone execution is part of this work.
No C1/C2, Electron or Chromium acceptance is repeated. Production enrollment and
installation need a separate exact authorization after this candidate is reviewed.
Post-adoption code rollback must not discard scoped state or fall back to selected;
retain the compatible scoped client/recovery fence and stop import instead. A
future scope expansion is a separate migration decision, not config editing.
