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

Generate deployment-local CJS/CJS/ESM artifacts with:

```sh
npm run contracts:build
npm run contracts:check
```

The copies in overlays are generated deployment outputs. They must be shipped
alongside the adapters and must not be edited manually. No runtime npm package
installation, package registry, new protocol version or database migration is
introduced. The PWA uses only the submission serializer; unused factories are
removed by its existing build.

`tests/contracts-equivalence.test.cjs` compares original fixed Git module bodies,
frozen vectors and browser Web Crypto output with the extracted implementation.
It requires the same isolated public host fixtures as integration tests. Run
`npm run test:contracts` with `NATIVESYNC_TEST_HOSTS` and
`VCP_R21_AA_DEPENDENCIES` explicitly supplied, or use the full integration runner.

This validates contract extraction only. Native execution authority, filesystem
durability, task recovery, scope commits and frontend state ownership stay with
their existing components.
