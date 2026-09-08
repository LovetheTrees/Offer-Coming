import type {
  ApplicationRecord,
  BackupData,
  BackupDocument,
  SyncAction,
  SyncResultStatus,
  WebDAVConfig,
} from './types';
import { serializeApplicationRecordsCsv } from './applicationRecords.ts';
import { createBackupDocument, createBackupSummary, parseAndValidateBackup, serializeBackup } from './backup.ts';
import { StorageService } from './storage.ts';
import { normalizeResumeProfileLibrary } from './resumeProfiles.ts';
import {
  getRemoteDocument,
  putRemoteApplicationRecordsCsv,
  putRemoteDocument,
  WebDAVError,
} from '../services/webdav.ts';

let syncQueue: Promise<unknown> = Promise.resolve();

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortedValue(entry)]),
    );
  }
  return value;
}

function normalizeBusinessData(data: BackupData): BackupData {
  let resumeProfileLibrary = data.resumeProfileLibrary;
  try {
    if (data.resumeProfileLibrary?.schemaVersion === 1 && Array.isArray(data.resumeProfileLibrary.profiles)) {
      resumeProfileLibrary = normalizeResumeProfileLibrary(data.resumeProfileLibrary);
    }
  } catch {
    // 序列化工具仍需对无效输入保持稳定；导入边界会单独拒绝该结构。
  }
  return {
    ...data,
    resumeProfileLibrary,
    applicationRecords: data.applicationRecords ?? [],
  };
}

export function stableStringifyBusinessData(data: BackupData): string {
  return JSON.stringify(sortedValue(normalizeBusinessData(data)));
}

export async function sha256BusinessData(data: BackupData): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringifyBusinessData(data));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function decideSyncAction(
  hasTrustedBaseline: boolean,
  baseHash: string | undefined,
  localHash: string,
  remoteHash: string | undefined,
  remoteExists: boolean,
): SyncAction {
  if (remoteExists && localHash === remoteHash) return 'no-change';
  if (!remoteExists) return hasTrustedBaseline ? 'conflict' : 'create-remote';
  if (!hasTrustedBaseline) return 'conflict';
  if (remoteHash === baseHash && localHash !== baseHash) return 'upload-local';
  if (localHash === baseHash && remoteHash !== baseHash) return 'download-remote';
  return 'conflict';
}

function extensionVersion(): string {
  return chrome.runtime.getManifest().version;
}

async function setError(error: unknown, fallback: string): Promise<'error' | 'conflict'> {
  const current = await StorageService.getSyncMetadata();
  if (error instanceof WebDAVError && error.code === 'PRECONDITION_FAILED') {
    let conflict = current.conflict;
    try {
      const config = await StorageService.getWebDAVConfig();
      if (config) {
        const [localData, remote] = await Promise.all([
          StorageService.getBackupData(),
          getRemoteDocument(config),
        ]);
        const parsed = remote.exists ? parseAndValidateBackup(remote.json || '') : null;
        if (parsed?.success) {
          conflict = {
            local: createBackupSummary(createBackupDocument(localData, extensionVersion())),
            remote: createBackupSummary(parsed.document),
          };
        }
      }
    } catch {
      // 冲突状态本身优先保留；摘要可在下一次手动同步时重新生成。
    }
    await StorageService.saveSyncMetadata({
      ...current,
      status: 'conflict',
      lastError: error.message,
      conflict,
    });
    return 'conflict';
  }
  await StorageService.saveSyncMetadata({
    ...current,
    status: 'error',
    lastError: error instanceof Error ? error.message : fallback,
  });
  return 'error';
}

async function completeSync(
  hash: string,
  etag: string | undefined,
  action: Exclude<SyncAction, 'conflict'>,
): Promise<void> {
  await StorageService.saveSyncMetadata({
    status: 'synced',
    hasTrustedBaseline: true,
    lastAction: action,
    etag,
    lastSyncedHash: hash,
    lastSyncedAt: new Date().toISOString(),
  });
}

async function saveConflictWithoutChangingBaseline(
  previous: Awaited<ReturnType<typeof StorageService.getSyncMetadata>>,
  localData: BackupData,
  remoteDocument: BackupDocument,
  message: string,
): Promise<void> {
  await StorageService.saveSyncMetadata({
    ...previous,
    status: 'conflict',
    lastError: message,
    conflict: {
      local: createBackupSummary(createBackupDocument(localData, extensionVersion())),
      remote: createBackupSummary(remoteDocument),
    },
  });
}

async function syncApplicationRecordsCsvSidecar(
  records: ApplicationRecord[],
  config: WebDAVConfig | null,
  force = false,
): Promise<void> {
  if (!config || (!config.enabled && !force)) return;
  await putRemoteApplicationRecordsCsv(config, serializeApplicationRecordsCsv(records));
}

async function upload(
  data: BackupData,
  localHash: string,
  etag: string | undefined,
  create: boolean,
  config: WebDAVConfig,
  forceSidecarUpload = false,
): Promise<void> {
  if (!create && !etag) {
    throw new WebDAVError(
      'MISSING_ETAG',
      '远端服务未提供 ETag，不支持安全覆盖；请改用支持 ETag 的 WebDAV 服务',
    );
  }
  const document = createBackupDocument(data, extensionVersion());
  const result = await putRemoteDocument(
    config,
    serializeBackup(document),
    create ? { type: 'create' } : { type: 'update', etag: etag as string },
  );
  let nextEtag = result.etag;
  if (!nextEtag) {
    const refreshed = await getRemoteDocument(config);
    nextEtag = refreshed.etag;
  }
  if (!nextEtag) {
    throw new WebDAVError(
      'MISSING_ETAG',
      '远端服务未提供 ETag，数据已上传但无法继续安全同步；请改用支持 ETag 的 WebDAV 服务',
    );
  }
  await syncApplicationRecordsCsvSidecar(data.applicationRecords ?? [], config, forceSidecarUpload);
  await completeSync(localHash, nextEtag, create ? 'create-remote' : 'upload-local');
}

export async function performSync(reason: string): Promise<SyncResultStatus> {
  const config = await StorageService.getWebDAVConfig();
  const isManualSync = reason === 'manual';
  if (!config) return 'disabled';
  if (!config.enabled && !isManualSync) return 'disabled';

  const previous = await StorageService.getSyncMetadata();
  await StorageService.saveSyncMetadata({ ...previous, status: 'syncing', lastError: undefined });

  try {
    const localData = await StorageService.getBackupData();
    const localHash = await sha256BusinessData(localData);
    const localDocument = createBackupDocument(localData, extensionVersion());
    const remote = await getRemoteDocument(config);

    let remoteDocument: BackupDocument | undefined;
    let remoteHash: string | undefined;
    if (remote.exists) {
      const parsed = parseAndValidateBackup(remote.json || '');
      if (!parsed.success) throw new Error(`远端备份无效：${parsed.error.message}`);
      remoteDocument = parsed.document;
      remoteHash = await sha256BusinessData(remoteDocument.data);
    }

    const action = decideSyncAction(
      previous.hasTrustedBaseline,
      previous.lastSyncedHash,
      localHash,
      remoteHash,
      remote.exists,
    );
    if (action === 'create-remote') {
      await upload(localData, localHash, undefined, true, config, isManualSync);
    } else if (action === 'no-change') {
      await syncApplicationRecordsCsvSidecar(localData.applicationRecords ?? [], config, isManualSync);
      await completeSync(localHash, remote.etag, 'no-change');
    } else if (action === 'upload-local') {
      await upload(localData, localHash, remote.etag, false, config, isManualSync);
    } else if (action === 'download-remote' && remoteDocument) {
      await StorageService.applyRemoteBusinessData(remoteDocument.data);
      const effectiveLocalData = await StorageService.getBackupData();
      const effectiveHash = await sha256BusinessData(effectiveLocalData);
      if (effectiveHash !== remoteHash) {
        await saveConflictWithoutChangingBaseline(
          previous,
          effectiveLocalData,
          remoteDocument,
          '应用云端数据后的本地内容与远端不一致，已停止同步以避免覆盖',
        );
        return 'conflict';
      }
      await syncApplicationRecordsCsvSidecar(
        effectiveLocalData.applicationRecords ?? [],
        config,
        isManualSync,
      );
      await completeSync(effectiveHash, remote.etag, 'download-remote');
    } else if (remoteDocument) {
      await StorageService.saveSyncMetadata({
        ...previous,
        status: 'conflict',
        lastError: '本地和远端数据均有变化，请选择保留版本',
        conflict: {
          local: createBackupSummary(localDocument),
          remote: createBackupSummary(remoteDocument),
        },
      });
      return 'conflict';
    } else {
      await StorageService.saveSyncMetadata({
        ...previous,
        status: 'conflict',
        lastError: '远端文件已被删除，已停止自动重建；请选择上传本地数据或暂不处理',
        conflict: undefined,
      });
      return 'conflict';
    }
    return 'synced';
  } catch (error) {
    return await setError(error, '同步失败');
  }
}

export function enqueueSync(reason: string): void {
  syncQueue = syncQueue.then(() => performSync(reason), () => performSync(reason));
}

export function enqueueSyncAndWait(reason: string): Promise<SyncResultStatus> {
  const task = syncQueue.then(() => performSync(reason), () => performSync(reason));
  syncQueue = task;
  return task;
}

async function performForceUploadLocal(): Promise<SyncResultStatus> {
  const config = await StorageService.getWebDAVConfig();
  if (!config) return 'disabled';
  await StorageService.saveSyncMetadata({
    ...(await StorageService.getSyncMetadata()),
    status: 'syncing',
    lastError: undefined,
  });
  try {
    const [localData, remote] = await Promise.all([
      StorageService.getBackupData(),
      getRemoteDocument(config),
    ]);
    const localHash = await sha256BusinessData(localData);
    await upload(localData, localHash, remote.etag, !remote.exists, config, true);
    return 'synced';
  } catch (error) {
    return await setError(error, '上传失败');
  }
}

async function performForceDownloadRemote(): Promise<SyncResultStatus> {
  const config = await StorageService.getWebDAVConfig();
  if (!config) return 'disabled';
  const previous = await StorageService.getSyncMetadata();
  await StorageService.saveSyncMetadata({
    ...previous,
    status: 'syncing',
    lastError: undefined,
  });
  try {
    const remote = await getRemoteDocument(config);
    if (!remote.exists) throw new Error('远端文件不存在，无法下载');
    const parsed = parseAndValidateBackup(remote.json || '');
    if (!parsed.success) throw new Error(`远端备份无效：${parsed.error.message}`);
    await StorageService.applyRemoteBusinessData(parsed.document.data);
    const effectiveLocalData = await StorageService.getBackupData();
    const effectiveHash = await sha256BusinessData(effectiveLocalData);
    const remoteHash = await sha256BusinessData(parsed.document.data);
    if (effectiveHash !== remoteHash) {
      await saveConflictWithoutChangingBaseline(
        previous,
        effectiveLocalData,
        parsed.document,
        '应用云端数据后的本地内容与远端不一致，已停止同步以避免覆盖',
      );
      return 'conflict';
    }
    await syncApplicationRecordsCsvSidecar(effectiveLocalData.applicationRecords ?? [], config, true);
    await completeSync(effectiveHash, remote.etag, 'download-remote');
    return 'synced';
  } catch (error) {
    return await setError(error, '下载失败');
  }
}

export async function resolveConflict(choice: 'local' | 'remote'): Promise<SyncResultStatus> {
  return choice === 'local' ? forceUploadLocal() : forceDownloadRemote();
}

export function forceUploadLocal(): Promise<SyncResultStatus> {
  const task = syncQueue.then(performForceUploadLocal, performForceUploadLocal);
  syncQueue = task;
  return task;
}

export function forceDownloadRemote(): Promise<SyncResultStatus> {
  const task = syncQueue.then(performForceDownloadRemote, performForceDownloadRemote);
  syncQueue = task;
  return task;
}
