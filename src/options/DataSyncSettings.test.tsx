import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { MessageService } from '../shared/message';
import type { SyncAction, SyncMetadata } from '../shared/types';
import { DataSyncSettings } from './DataSyncSettings';

const originalSendMessage = MessageService.sendMessage;
const originalWindow = globalThis.window;
(globalThis as typeof globalThis & { React: typeof React; IS_REACT_ACT_ENVIRONMENT: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function statusText(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root.findByProps({ role: 'status' }).children.join('');
}

async function renderSettings(
  syncResult: { status: string; action?: SyncAction },
  metadata: SyncMetadata = { status: 'synced', hasTrustedBaseline: true },
) {
  let dataChanges = 0;
  let renderer!: TestRenderer.ReactTestRenderer;
  globalThis.window = {
    setInterval: () => 1,
    clearInterval: () => undefined,
  } as unknown as Window & typeof globalThis;
  MessageService.sendMessage = async message => {
    if (message.type === 'GET_WEBDAV_CONFIG') {
      return { success: true, data: { enabled: true, serverUrl: 'https://dav.example.com/', username: 'u', password: 'p' } };
    }
    if (message.type === 'GET_SYNC_STATUS') return { success: true, data: metadata };
    if (message.type === 'SYNC_NOW') return { success: true, data: syncResult };
    throw new Error(`Unexpected message: ${message.type}`);
  };
  await act(async () => {
    renderer = TestRenderer.create(<DataSyncSettings onDataChanged={() => { dataChanges += 1; }} />);
  });
  const syncButton = renderer.root.findAllByType('button').find(button => button.children.includes('立即同步'));
  assert.ok(syncButton);
  await act(async () => syncButton.props.onClick());
  return { renderer, dataChanges };
}

async function cleanup(renderer?: TestRenderer.ReactTestRenderer) {
  if (renderer) await act(async () => renderer.unmount());
  MessageService.sendMessage = originalSendMessage;
  globalThis.window = originalWindow;
}

for (const [action, expected] of [
  ['create-remote', '已创建云端备份'],
  ['upload-local', '已上传本地更新'],
  ['no-change', '本地与云端已一致'],
] as const) {
  test(`立即同步 ${action} 显示准确结果`, async () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    try {
      ({ renderer } = await renderSettings({ status: 'synced', action }));
      assert.equal(statusText(renderer), expected);
    } finally {
      await cleanup(renderer);
    }
  });
}

test('立即同步下载云端更新后刷新设置页数据', async () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    let dataChanges: number;
    ({ renderer, dataChanges } = await renderSettings({ status: 'synced', action: 'download-remote' }));
    assert.equal(statusText(renderer), '已下载云端更新');
    assert.equal(dataChanges, 1);
  } finally {
    await cleanup(renderer);
  }
});

test('立即同步冲突不显示成功措辞', async () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    ({ renderer } = await renderSettings({ status: 'conflict' }, { status: 'conflict', hasTrustedBaseline: true }));
    const text = statusText(renderer);
    assert.match(text, /同步遇到冲突/);
    assert.doesNotMatch(text, /已上传|已下载|已一致|已创建/);
  } finally {
    await cleanup(renderer);
  }
});

test('无可信基线冲突明确说明未覆盖任何数据', async () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    ({ renderer } = await renderSettings(
      { status: 'conflict' },
      { status: 'conflict', hasTrustedBaseline: false },
    ));
    const pageText = JSON.stringify(renderer.toJSON());
    assert.match(pageText, /无法确认本地与云端的先后关系，系统未覆盖任何数据/);
  } finally {
    await cleanup(renderer);
  }
});

test('同步方向按钮仅在冲突状态显示', async () => {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    ({ renderer } = await renderSettings({ status: 'synced', action: 'no-change' }));
    const normalButtons = renderer.root.findAllByType('button').flatMap(button => button.children);
    assert.ok(!normalButtons.includes('使用本地'));
    assert.ok(!normalButtons.includes('使用远端'));
    await cleanup(renderer);
    renderer = undefined;

    ({ renderer } = await renderSettings({ status: 'conflict' }, { status: 'conflict', hasTrustedBaseline: false }));
    const conflictButtons = renderer.root.findAllByType('button').flatMap(button => button.children);
    assert.ok(conflictButtons.includes('重新上传本地数据'));
    assert.ok(conflictButtons.includes('暂不处理'));
  } finally {
    await cleanup(renderer);
  }
});
