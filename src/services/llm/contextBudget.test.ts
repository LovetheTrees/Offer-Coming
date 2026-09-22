import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserProfile } from '../../shared/types.ts';
import {
  estimateTokens,
  truncateForBudget,
  compactProfileForSection,
  serializeCompactProfile,
  budgetResumeText,
} from './contextBudget.ts';

function longText(unit: string, repeat: number): string {
  return unit.repeat(repeat);
}

test('estimateTokens 对中文按 ~1 token/字、英文按 ~1 token/4 字符估算', () => {
  // 中文 100 字 ≈ 100 token（±10% 宽松断言，仅验证量级）
  assert.ok(estimateTokens(longText('中', 100)) >= 90);
  assert.ok(estimateTokens(longText('中', 100)) <= 110);
  // 英文 200 字符 ≈ 50 token
  assert.ok(estimateTokens('a'.repeat(200)) >= 45);
  assert.ok(estimateTokens('a'.repeat(200)) <= 55);
  assert.equal(estimateTokens(''), 0);
});

test('truncateForBudget 短文本不截断', () => {
  const short = '一段很短的自我介绍。';
  assert.equal(truncateForBudget(short, 1000), short);
});

test('truncateForBudget 超长文本被压到预算内并保留头尾', () => {
  const text = longText('这是一段很长的描述内容需要被控制体积', 2000);
  const maxTokens = 500;
  const result = truncateForBudget(text, maxTokens);
  assert.ok(estimateTokens(result) <= maxTokens + 10, `实际 ${estimateTokens(result)} 应≤ ${maxTokens + 10}`);
  assert.ok(result.includes('已截断'));
  assert.ok(result.endsWith('需要被控制体积')); // 尾部保留
});

test('compactProfileForSection 只保留当前模块相关子集并裁剪长文本', () => {
  const profile: UserProfile = {
    personal: { name: '张三', gender: '', birthDate: '', phone: '', email: '', selfEvaluation: longText('自我评价内容', 400) },
    education: [{ id: 'e1', school: 'A大学', major: '计算机', degree: '本科', startDate: '2018-09', endDate: '2022-06' }],
    experience: Array.from({ length: 10 }, (_, i) => ({
      id: `x${i}`, company: `公司${i}`, position: '工程师', startDate: '2020-01', endDate: '2023-01',
      description: longText('详细工作描述内容', 300),
    })),
    projects: [{ id: 'p1', name: '项目', role: '负责人', startDate: '2021-01', endDate: '2022-01', description: '项目描述' }],
    awards: [], customInformation: [], skills: ['Java', 'Python'], certifications: [],
  };

  const work = compactProfileForSection(profile, '工作经历');
  assert.deepEqual(Object.keys(work).sort(), ['experience', 'personal']);
  // 经历上限 8 条
  assert.equal((work.experience as unknown[]).length, 8);
  // 长描述已被截断
  const serialized = serializeCompactProfile(work);
  assert.ok(serialized.includes('已截断'));
  assert.ok(serialized.length < JSON.stringify(profile).length);

  const edu = compactProfileForSection(profile, '教育');
  assert.deepEqual(Object.keys(edu).sort(), ['education', 'personal']);
});

test('compactProfileForSection 未命中任何模块时兜底附带技能与证书', () => {
  const profile: UserProfile = {
    personal: { name: '李四', gender: '', birthDate: '', phone: '', email: '' },
    education: [], experience: [], projects: [], awards: [], customInformation: [],
    skills: ['C++'], certifications: [{ id: 'c1', name: 'CET-6', issuer: '', date: '' }],
  };
  const subset = compactProfileForSection(profile, '基本信息');
  assert.ok('skills' in subset);
  assert.ok('certifications' in subset);
});

test('budgetResumeText 超长简历被压到预算内并标记截断', () => {
  const raw = longText('这是简历正文内容', 20000);
  const { text, truncated } = budgetResumeText(raw);
  assert.equal(truncated, true);
  assert.ok(estimateTokens(text) <= 12000);
});

test('budgetResumeText 短简历不截断', () => {
  const raw = '姓名：张三\n学校：某大学';
  const { text, truncated } = budgetResumeText(raw);
  assert.equal(truncated, false);
  assert.equal(text, raw);
});
