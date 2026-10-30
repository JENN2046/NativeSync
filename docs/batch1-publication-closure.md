# Batch1 final targeted closure (2026-10-29)

Baseline d1b3b56c36e9a093717078306035b56f199b291b; Commander #6490534773.
No product changes were necessary. The new tests use the actual plugin's initialize,
registerApiRoutes, ExecutionConfigs.publish and mobile acceptance/engine, with real
loopback HTTP and temporary SQLite. They do not substitute a mock config publisher.

- Second-batch503 and request timeout leave first batch v2, later topics/group v1.
  Mobile catalog reports each actual version/hash; unprepared topics refuse without
  DB side effects. Existing execution v1 and group aliases/member order stay frozen.
- Accepted second batch + dropped HTTP response retains v2. Refetch and same payload
  retries do not add versions, messages or tasks. A real child exits78 after COMMIT
  before HTTP response; reopening the SQLite DB and republishing is idempotent.
- Mixed accepted snapshots [1,2,1,1] really execute after recovery: 4 executions,
  2 group steps, 5 loopback model HTTPs; replay adds zero calls. Native tool/AA0.
  This config-focused test does not pretend to execute the native Handler tool chain;
  the existing native-AA/approval cases in the full selection exercise that chain.
- 95,999 /96,000 /96,001 /150,000 actual UTF8 body bytes use unchanged protocol and
  round-trip full prompts. 96KB is only a batching threshold. The public host parser
  is unchanged300mb; server config's existing128000 character ceiling still rejects
  an invalid128001-char prompt with INVALID_EXECUTION_CONFIG and preserves all rows.
  Publishing is per-request atomic, not globally atomic across all topics; eligible
  topics may intentionally run their current v1 while another topic is already v2.

Early test failures are retained (wrong test route404, wrong SQL table name); only
fixture assertions were corrected. Product bytes stayed equal to d1b3b56c throughout.
No production/real provider/phone/AA/tool access, no C1/C2 or old43 repeat.

Offline dependency delivery includes only package-lock resolved public tarballs,
SRI+SHA256 manifests, a clean-cache builder and the previously identified Linux x64
Node ABI137 better-sqlite3 binary/license. No .npmrc, credentials, real data or full
user cache is copied. All runtime installation must use fresh isolated paths.

Batch2 preparation compares installed historical354d52ac code with candidate;
it is not a new production version scan or authorization. See the delivered
BATCH2_MATCHED_FILES.json and BATCH2_EXECUTION_CHOICES.md. Browser/Electron/phone/TLS,
production installation/rollback and real provider/AA remain NOT RUN this round.
