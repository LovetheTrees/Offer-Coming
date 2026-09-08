# WebDAV Safe Multi-Device Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WebDAV synchronization safely download remote-only updates, upload only proven local-only updates, and stop all automatic overwrites when the synchronization baseline is missing or both sides changed.

**Architecture:** Extend per-device sync metadata with an explicit trusted-baseline marker and last successful action. Keep synchronization decisions as a pure three-way comparison over business-data hashes. Split remote application from uploading: a download path may only apply and verify remote data; if effective local data differs afterward, it must stop with a conflict rather than upload. Preserve ETag conditional requests for all updates and expose the completed action to the settings UI.

**Tech Stack:** TypeScript, Chrome Extension MV3 storage, WebDAV HTTP/ETag, React, Node test runner with `tsx`.

## Global Constraints

- Do not add permanently visible upload-local or download-remote buttons.
- Do not use device clocks or `updatedAt` values to choose the newest side.
- Hash all WebDAV business data, but exclude synchronization metadata and export timestamps.
- Automatic upload is allowed only when a trusted baseline proves the local side alone changed.
- A missing or untrusted baseline with different local and remote content must produce a conflict.
- A download branch must never upload data back to the remote server.
- Existing remote updates use the ETag read during the same synchronization attempt when available; confirmed hash-fallback mode must instead recheck the remote hash before PUT and verify it after PUT.
- Only a fully successful create, upload, verified download, or equal-content comparison establishes a trusted baseline.
- Existing metadata is trusted in `etag` mode only with both a non-empty `lastSyncedHash` and ETag; explicit `hash-fallback` metadata requires a non-empty hash established by confirmation or successful validation.
- Do not push changes unless the user explicitly requests it.

---

### Task 1: Trusted baseline metadata and pure synchronization decisions

**Files:**
- Modify: `src/shared/types.ts:170-184`
- Modify: `src/shared/storage.ts:247-254`
- Modify: `src/shared/sync.ts:60-72,116-123`
- Test: `src/shared/backup-sync.test.ts`

**Interfaces:**
- Consumes: existing `SyncAction`, `SyncStatus`, `SyncMetadata`, and SHA-256 business-data hashes.
- Produces: `SyncMetadata.hasTrustedBaseline: boolean`, `SyncMetadata.lastAction?: 'create-remote' | 'no-change' | 'upload-local' | 'download-remote'`, `normalizeSyncMetadata(value): SyncMetadata`, and `decideSyncAction(hasTrustedBaseline, baseHash, localHash, remoteHash, remoteExists): SyncAction`.

- [ ] **Step 1: Write failing metadata migration and decision tests**

Add tests that prove:

```ts
assert.equal(normalizeSyncMetadata({ status: 'synced', lastSyncedHash: 'v1', etag: 'e1' }).hasTrustedBaseline, true);
assert.equal(normalizeSyncMetadata({ status: 'synced', lastSyncedHash: 'v1' }).hasTrustedBaseline, false);
assert.equal(normalizeSyncMetadata({ status: 'synced', etag: 'e1' }).hasTrustedBaseline, false);
assert.equal(normalizeSyncMetadata({ status: 'synced', hasTrustedBaseline: false, lastSyncedHash: 'v1', etag: 'e1' }).hasTrustedBaseline, false);

assert.equal(decideSyncAction(true, 'v1', 'v1', 'v2', true), 'download-remote');
assert.equal(decideSyncAction(true, 'v1', 'v2', 'v1', true), 'upload-local');
assert.equal(decideSyncAction(true, 'v1', 'v2-local', 'v2-remote', true), 'conflict');
assert.equal(decideSyncAction(false, undefined, 'local', 'remote', true), 'conflict');
assert.equal(decideSyncAction(false, undefined, 'same', 'same', true), 'no-change');
assert.equal(decideSyncAction(false, undefined, 'local', undefined, false), 'create-remote');
assert.equal(decideSyncAction(true, 'v1', 'v1', undefined, false), 'conflict');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx tsx --test src/shared/backup-sync.test.ts
```

Expected: FAIL because `hasTrustedBaseline`, `lastAction`, `normalizeSyncMetadata`, and the new decision signature do not exist.

- [ ] **Step 3: Implement metadata normalization**

Add the fields to `SyncMetadata` and normalize stored values in `StorageService.getSyncMetadata()`:

```ts
export function normalizeSyncMetadata(value: unknown): SyncMetadata {
  const metadata = value && typeof value === 'object' ? value as Partial<SyncMetadata> : {};
  const inferredTrusted = Boolean(metadata.lastSyncedHash && metadata.etag);
  return {
    ...metadata,
    status: metadata.status ?? 'idle',
    hasTrustedBaseline: metadata.hasTrustedBaseline ?? inferredTrusted,
  };
}
```

An explicit `false` must remain false. Do not create a baseline from WebDAV configuration or connection testing.

- [ ] **Step 4: Implement the pure trusted-baseline decision table**

Update `decideSyncAction` so equal content is handled first, then missing remote, then untrusted baseline, then the four trusted-baseline cases. `completeSync` must write:

```ts
{
  status: 'synced',
  hasTrustedBaseline: true,
  lastAction: action,
  etag,
  lastSyncedHash: hash,
  lastSyncedAt: new Date().toISOString(),
}
```

Require callers to pass the completed `SyncAction`.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
npx tsx --test src/shared/backup-sync.test.ts
```

Expected: all backup/synchronization tests pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/shared/types.ts src/shared/storage.ts src/shared/sync.ts src/shared/backup-sync.test.ts
git commit -m "fix: add trusted webdav sync baseline" --trailer "Co-Authored-By: Aime <aime@bytedance.com>"
```

---

### Task 2: Safe download path and two-device regression

**Files:**
- Modify: `src/shared/sync.ts:169-245,258-305`
- Test: `src/shared/backup-sync.test.ts`

**Interfaces:**
- Consumes: trusted decision interface and metadata fields from Task 1.
- Produces: a synchronization engine where `download-remote` only applies and verifies remote business data; mismatched effective data becomes a conflict and never invokes `putRemoteDocument`.

- [ ] **Step 1: Write a failing two-device A/B regression test**

Build two independent `SyncMetadata` states sharing one in-memory remote document:

```text
A baseline/local = V1
B baseline/local = V1
B local becomes V2
B sync uploads V2
A sync keeps local V1 and sees remote V2
```

Assert after A synchronizes:

```ts
assert.deepEqual(aLocalData, v2);
assert.equal(aMetadata.lastSyncedHash, await sha256BusinessData(v2));
assert.equal(aMetadata.lastAction, 'download-remote');
assert.equal(aMetadata.hasTrustedBaseline, true);
assert.equal(putCallsDuringASync, 0);
```

Also add a regression where applying remote data produces an effective hash different from `remoteHash`; assert status is `conflict`, no PUT occurs, and the baseline remains unchanged.

- [ ] **Step 2: Add failing safety tests for all decision branches**

Cover:

- local-only change uploads using the current GET ETag;
- remote-only change downloads without PUT;
- both sides changed returns conflict without PUT;
- untrusted differing data returns conflict without PUT;
- trusted baseline plus missing remote returns conflict;
- `PRECONDITION_FAILED` preserves the previous trusted baseline and records conflict;
- failed remote application does not update the baseline.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
npx tsx --test src/shared/backup-sync.test.ts
```

Expected: at least the effective-hash mismatch test fails because the current download branch calls `upload(...)` at `src/shared/sync.ts:218`, and metadata action assertions fail.

- [ ] **Step 4: Implement safe action execution**

Update `performSync` to pass `previous.hasTrustedBaseline` into `decideSyncAction` and record the exact successful action.

For `download-remote`:

```ts
await StorageService.applyRemoteBusinessData(remoteDocument.data);
const effectiveLocalData = await StorageService.getBackupData();
const effectiveHash = await sha256BusinessData(effectiveLocalData);
if (effectiveHash !== remoteHash) {
  await saveConflictWithoutChangingBaseline(...);
  return 'conflict';
}
await syncApplicationRecordsCsvSidecar(...);
await completeSync(effectiveHash, remote.etag, 'download-remote');
```

Do not call `upload` from this branch. Apply the same rule to `performForceDownloadRemote`: a forced download may overwrite local data, but it still may not turn normalization differences into an automatic remote upload.

For conflicts and errors, preserve `hasTrustedBaseline`, `lastSyncedHash`, and the prior successful ETag unless a newly read ETag is needed only for conflict display; never claim a new baseline.

- [ ] **Step 5: Verify focused and WebDAV service tests**

Run:

```bash
npx tsx --test src/shared/backup-sync.test.ts
npm test
```

Expected: all tests pass; the A/B test records zero PUT calls during A synchronization.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/shared/sync.ts src/shared/backup-sync.test.ts
git commit -m "fix: prevent stale webdav overwrite" --trailer "Co-Authored-By: Aime <aime@bytedance.com>"
```

---

### Task 3: Accurate synchronization feedback and local refresh

**Files:**
- Modify: `src/options/DataSyncSettings.tsx:159-190,304-333`
- Modify: `src/options/DataSyncSettings.test.tsx`
- Modify: `src/shared/types.ts` only if the message response needs a typed action payload
- Modify: `src/background/index.ts:253-257` only if the message response must include the action directly

**Interfaces:**
- Consumes: `SyncMetadata.lastAction` and `SYNC_NOW` status from Tasks 1-2.
- Produces: action-specific success notices and a call to `onDataChanged()` after a successful remote download.

- [ ] **Step 1: Write failing UI behavior tests**

Use component-level tests rather than source-string assertions for the new behavior. Mock `MessageService.sendMessage` so `SYNC_NOW` resolves with each action and assert:

```text
create-remote  → 已创建云端备份
upload-local   → 已上传本地更新
no-change      → 本地与云端已一致
download-remote → 已下载云端更新 and onDataChanged called once
conflict       → 同步遇到冲突 and no success wording
```

Add a test that untrusted-baseline conflict text contains:

```text
无法确认本地与云端的先后关系，系统未覆盖任何数据
```

- [ ] **Step 2: Run the focused UI test and verify RED**

Run:

```bash
npx tsx --test src/options/DataSyncSettings.test.tsx
```

Expected: FAIL because the current UI always displays `同步完成` and does not refresh data after normal remote download.

- [ ] **Step 3: Return or reload the completed action**

Prefer returning the action in the `SYNC_NOW` response:

```ts
{ status: SyncResultStatus; action?: SyncAction }
```

If preserving the current response is simpler, reload `GET_SYNC_STATUS` after `SYNC_NOW` and read `metadata.lastAction`. Keep a single source of truth and avoid duplicating action inference in the UI.

- [ ] **Step 4: Implement action-specific notices and refresh**

Map successful actions to the exact text from Step 1. Call `onDataChanged()` only after `download-remote` or resolving a conflict with the remote version. Keep force-direction controls conditional on `metadata.status === 'conflict'`; do not add permanent buttons.

Use the untrusted-baseline explanation when conflict metadata indicates no trusted baseline. Preserve the existing local/remote summaries and “暂不处理” behavior.

- [ ] **Step 5: Verify UI and full suite**

Run:

```bash
npx tsx --test src/options/DataSyncSettings.test.tsx
npm test
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/options/DataSyncSettings.tsx src/options/DataSyncSettings.test.tsx src/shared/types.ts src/background/index.ts
git commit -m "fix: report webdav sync direction" --trailer "Co-Authored-By: Aime <aime@bytedance.com>"
```

---

### Task 4: Documentation and final compatibility verification

**Files:**
- Modify: `README.md:154-193`
- Test: `src/shared/backup-sync.test.ts`
- Test: `src/options/DataSyncSettings.test.tsx`

**Interfaces:**
- Consumes: completed trusted-baseline behavior and UI wording.
- Produces: user-facing documentation that matches the shipped synchronization behavior.

- [ ] **Step 1: Add a failing documentation contract test**

Assert README documents:

```text
- 未修改设备会下载云端更新
- 双方都修改时不会自动覆盖
- 首次连接且两边数据不同时需要手动选择
- ETag 用于阻止同步过程中的并发覆盖
```

- [ ] **Step 2: Run the documentation test and verify RED**

Run the test file containing the README contract. Expected: FAIL because the current README only states that ETag prevents silent overwrite and does not describe trusted-baseline behavior.

- [ ] **Step 3: Update README WebDAV synchronization documentation**

Explain the four-way decision table in concise user language. State that “立即同步” is safe bidirectional synchronization, not unconditional upload. Explain when conflict buttons appear and that no data is overwritten before the user chooses.

- [ ] **Step 4: Run final verification**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected:

- all tests pass;
- lint has no errors;
- build succeeds and generates `dist/`;
- no whitespace errors;
- only intended tracked files are changed before commit.

- [ ] **Step 5: Commit Task 4**

```bash
git add README.md src/shared/backup-sync.test.ts src/options/DataSyncSettings.test.tsx
git commit -m "docs: explain safe webdav synchronization" --trailer "Co-Authored-By: Aime <aime@bytedance.com>"
```


---

### Task 5: No-ETag hash fallback specification change

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/storage.ts`, `src/shared/sync.ts`, `src/services/webdav.ts`
- Modify: `src/options/DataSyncSettings.tsx`
- Test: `src/shared/backup-sync.test.ts`, `src/options/DataSyncSettings.test.tsx`
- Docs: design document, implementation plan, `README.md`

- [x] **Step 1: Write failing concurrency-mode and no-ETag behavior tests**
  - Persist and normalize `etag | hash-fallback`.
  - First differing no-ETag remote produces summaries and confirmation state; equal content is verified and establishes fallback without prompting.
  - Confirming remote or local establishes a trusted hash baseline.
  - Cover no-repeat confirmation, A/B remote-only download, both-changed conflict, pre-upload recheck, post-upload verification, and ETag upgrade.

- [x] **Step 2: Verify RED**
  - Focused sync tests failed on missing mode normalization, missing confirmation reason, remote confirmation, and fallback upload behavior.
  - Focused UI test failed because the one-time no-ETag explanation was absent.

- [x] **Step 3: Implement the two concurrency modes**
  - ETag mode requires hash plus ETag and keeps conditional writes.
  - Hash fallback requires a confirmed/verified hash baseline, rechecks before PUT, verifies after PUT, and upgrades when ETag appears.
  - If the remote is initially absent and create PUT plus verification GET both omit ETag, matching read-back and local hashes establish a `create-remote` fallback baseline; failed or mismatched read-back leaves no baseline and performs no repeated PUT.
  - Download paths remain PUT-free.

- [x] **Step 4: Update conflict UI and documentation**
  - Show the one-time no-ETag explanation, both summaries, and all three choices.
  - Document the accepted lack of atomic concurrency guarantee in fallback mode.

- [x] **Step 5: Final verification and commit**
  - Run focused tests, `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.
  - Commit with the required co-author trailer; do not push.
