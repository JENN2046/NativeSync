# Shared contracts experiment

This source is extracted from the accepted NativeSync implementation at
`9dc099b6007e018a9743d72048d5e6fbb43b94e7`. It inherits the repository's
attribution and licensing. It is not a replacement Agent/task/storage engine.

`src/contracts.mjs` is the only maintained implementation for the common rules:

- `createProtocol(hostPrimitives, metadataProvider)` keeps identity, wire-topic
  conversion and hash composition together. The adapter supplies the original
  host canonicalizer/serializer and Node crypto. Metadata resolution remains
  lazy, preserving the existing CommonJS initialization order.
- `createMetadata({stable, sha256, byteLength})` owns common control-field and
  envelope normalization. Desktop backfill admission stays in the desktop
  adapter. `byteLength` and hashing must be deterministic compatible functions;
  the dependency interface is not a proof that arbitrary supplied callbacks are pure.
- `createSourceScope(protocol)` owns normalization, digest and additive-set
  checks. It does not own grants, Source bindings, phone permissions or commits.
- `submissionText(validatedSubmission)` serializes an already validated fixed-key
  payload. Node and browser preserve their existing validation/error boundaries;
  the browser keeps Web Crypto, Web Locks and storage, the server keeps authenticated
  session evidence. Attachment order remains significant.

The source uses no filesystem, clock, randomness or browser storage globals.
The experiment does not move the author's canonicalization implementation into
this package; its host compatibility remains explicit and tested.

Deployment CJS/CJS/ESM files are assembled from this source by the existing
locked rolldown compiler. They are not stored in overlays. Use
`tools/assemble_release.py --out ... --node ... --pwa-dependencies ...`; see
`docs/release-assembly-20261031.md`. The build uses existing PWA lockfile versions,
with no runtime package installation or new registry dependency.

`tests/contracts-equivalence.test.cjs` compares original fixed Git module bodies,
frozen vectors and browser Web Crypto output from the assembled modules. The
release validator supplies matching hosts, assembly and dependencies explicitly.

This validates contract extraction only. Native execution authority, filesystem
durability, task recovery, scope commits and frontend state ownership stay with
their existing components.
