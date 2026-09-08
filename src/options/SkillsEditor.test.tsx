import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SkillsEditor } from './SkillsEditor.tsx';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function findButton(root: TestRenderer.ReactTestInstance, label: string) {
  return root.findAllByType('button').find(item => item.children.join('') === label)!;
}

async function renderSkills(initial: string[]) {
  let current = initial;
  let renderer!: TestRenderer.ReactTestRenderer;
  const render = () => <SkillsEditor skills={current} onChange={next => { current = next; }} />;
  await act(async () => { renderer = TestRenderer.create(render()); });
  return {
    renderer,
    current: () => current,
    refresh: async () => act(async () => { renderer.update(render()); }),
  };
}

test('新增和编辑专业技能只更新目标项', async () => {
  const env = await renderSkills(['TypeScript']);
  await act(async () => { findButton(env.renderer.root, '添加专业技能').props.onClick(); });
  assert.deepEqual(env.current(), ['TypeScript', '']);
  await env.refresh();

  const inputs = env.renderer.root.findAllByType('input');
  await act(async () => { inputs[1].props.onChange({ target: { value: 'React' } }); });
  assert.deepEqual(env.current(), ['TypeScript', 'React']);
});

test('专业技能支持上移、下移和删除', async () => {
  const env = await renderSkills(['A', 'B', 'C']);
  let rows = env.renderer.root.findAll(node => typeof node.props['data-skill-index'] === 'number');
  assert.equal(findButton(rows[0], '上移').props.disabled, true);
  assert.equal(findButton(rows[2], '下移').props.disabled, true);

  await act(async () => { findButton(rows[1], '上移').props.onClick(); });
  assert.deepEqual(env.current(), ['B', 'A', 'C']);
  await env.refresh();

  rows = env.renderer.root.findAll(node => typeof node.props['data-skill-index'] === 'number');
  await act(async () => { findButton(rows[0], '下移').props.onClick(); });
  assert.deepEqual(env.current(), ['A', 'B', 'C']);
  await env.refresh();

  rows = env.renderer.root.findAll(node => typeof node.props['data-skill-index'] === 'number');
  await act(async () => { findButton(rows[1], '删除').props.onClick(); });
  assert.deepEqual(env.current(), ['A', 'C']);
});

test('专业技能编辑器不再显示旧提示或多行文本框', async () => {
  const env = await renderSkills(['TypeScript']);
  const text = JSON.stringify(env.renderer.toJSON());
  assert.doesNotMatch(text, /每行一条，填充技能类字段时会合并为一段文本/);
  assert.equal(env.renderer.root.findAllByType('textarea').length, 0);
});
