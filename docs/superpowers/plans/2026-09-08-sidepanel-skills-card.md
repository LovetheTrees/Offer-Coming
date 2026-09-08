# 信息窗口专业技能卡片样式调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让信息窗口中的每条专业技能使用与其他栏目一致的卡片结构，并移除技能序号。

**Architecture:** 仅调整 `SkillsSection` 的 JSX 结构，复用现有 `record-card`、`field-list`、`field-button` 和字段文本样式，不新增数据结构或 CSS。通过服务端静态渲染测试验证结构与文案，通过现有交互测试保护点击写入行为。

**Tech Stack:** React、TypeScript、Node.js test runner、React DOM Server、React Test Renderer

## Global Constraints

- 每条有效技能独立展示为一张卡片。
- 卡片只展示技能内容，不展示序号或“技能”标签。
- 保留点击写入、工作键、数量统计、折叠和空数据隐藏行为。
- 不修改 `UserProfile.skills` 数据结构和设置页技能编辑器。
- 不新增 CSS 或依赖。

---

### Task 1: 统一专业技能卡片结构

**Files:**
- Modify: `src/sidepanel/ProfileSections.test.ts:203-244`
- Modify: `src/sidepanel/ProfileSections.tsx:120-157`

**Interfaces:**
- Consumes: `skills: string[]`、`workingKey: string | null`、`onFieldClick(key: string, value: string): void`
- Produces: 使用现有 `record-card > field-list > field-button` 结构渲染的技能卡片；工作键继续为 `skill-${原始数组下标}`

- [ ] **Step 1: 写入失败的结构回归测试**

在“专业技能显示在奖项之前并过滤空项”测试中，为技能按钮添加可定位的结构断言：

```ts
assert.equal((html.match(/class="record-card skill-card"/g) || []).length, 2);
assert.doesNotMatch(html, /技能 1|技能 2|技能 3/);
assert.match(html, /class="field-button skill-field-button"/);
```

该测试捕获的生产缺陷是：专业技能继续使用独立的 `field-row single-field-record` 外观，或重新出现序号标签。

- [ ] **Step 2: 运行目标测试并确认 RED**

Run:

```bash
npm run test:resume-profiles -- --test-name-pattern="专业技能显示在奖项之前并过滤空项"
```

Expected: FAIL，因为当前输出不包含 `record-card skill-card`，且仍包含“技能 1”“技能 3”。

- [ ] **Step 3: 实现最小 JSX 调整**

将 `SkillsSection` 中每条技能改为：

```tsx
<article className="record-card skill-card" key={key}>
  <div className="field-list">
    <button
      type="button"
      className="field-button skill-field-button"
      onClick={() => onFieldClick(key, skill.value)}
      disabled={workingKey !== null}
      title={workingKey === key ? '正在填写当前字段' : '点击写入当前网页输入框'}
    >
      <span className="field-value">{skill.value}</span>
      {workingKey === key && <span className="field-working">写入中</span>}
    </button>
  </div>
</article>
```

删除原来的 `<span className="field-label">技能 {skill.index + 1}</span>`，保留过滤逻辑与工作键计算。

- [ ] **Step 4: 运行目标测试并确认 GREEN**

Run:

```bash
npm run test:resume-profiles -- --test-name-pattern="专业技能"
```

Expected: 所有专业技能相关测试 PASS；点击 `React` 仍传递 `['skill-1', 'React']`。

- [ ] **Step 5: 运行本次修改文件的局部检查**

Run:

```bash
npx oxlint src/sidepanel/ProfileSections.tsx src/sidepanel/ProfileSections.test.ts
```

Expected: 0 errors。

- [ ] **Step 6: 运行完整项目测试**

Run:

```bash
npm test
```

Expected: exit code 0，全部测试通过。

- [ ] **Step 7: 提交实现**

```bash
git add src/sidepanel/ProfileSections.tsx src/sidepanel/ProfileSections.test.ts docs/superpowers/plans/2026-09-08-sidepanel-skills-card.md
git commit -m "style: align sidepanel skill cards"
```
