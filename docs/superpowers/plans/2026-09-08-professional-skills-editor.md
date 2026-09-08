# Professional Skills Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将专业技能改造成可逐项新增、编辑、排序、删除的设置页列表，并在信息浮窗的奖项之前展示可点击技能。

**Architecture:** 保持 `UserProfile.skills: string[]` 不变，新增一个只负责字符串列表编辑的 `SkillsEditor` 组件，由 `ExperienceSection` 接入。信息浮窗直接过滤有效技能并复用现有 `SectionSummary` 与字段点击机制，不改变备份、解析或自动填充链路。

**Tech Stack:** React 19、TypeScript 6、Node test runner、react-test-renderer、Vite 8

## Global Constraints

- 专业技能位于信息浮窗“项目经历”之后、“奖项 / 荣誉”之前。
- 每项技能支持新增、编辑、上移、下移、删除。
- 删除“每行一条，填充技能类字段时会合并为一段文本。”提示。
- 保持 `skills: string[]` 数据模型不变。
- 不修改简历解析、备份、WebDAV 或自动填充算法。
- 空技能不在信息浮窗中渲染；没有有效技能时隐藏整个分区。

---

## File Structure

- Create: `src/options/SkillsEditor.tsx` — 专业技能字符串列表编辑器。
- Create: `src/options/SkillsEditor.test.tsx` — 新增、编辑、排序、删除和禁用状态测试。
- Modify: `src/options/ExperienceSection.tsx` — 用 `SkillsEditor` 替换原技能 textarea 和提示。
- Modify: `src/options/ExperienceSection.test.tsx` — 验证接入及旧提示删除；若文件不存在则创建。
- Modify: `src/sidepanel/ProfileSections.tsx` — 在奖项前渲染专业技能。
- Modify: `src/sidepanel/ProfileSections.test.ts` — 浮窗顺序、点击与空状态测试。
- Modify: `package.json` — 若新测试未被标准命令覆盖，将其加入 `test:resume-profiles`。

### Task 1: 设置页专业技能列表编辑器

**Files:**
- Create: `src/options/SkillsEditor.tsx`
- Create: `src/options/SkillsEditor.test.tsx`
- Modify: `src/options/ExperienceSection.tsx`
- Modify: `src/options/ExperienceSection.test.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: `skills: string[]` 与 `onChange(skills: string[]): void`。
- Produces: `SkillsEditor` React 组件；不修改共享数据类型。

- [ ] **Step 1: 写失败的编辑器行为测试**

测试使用 `react-test-renderer` 渲染：

```tsx
<SkillsEditor
  skills={['TypeScript', 'React']}
  onChange={next => changes.push(next)}
/>
```

必须验证：

```ts
assert.deepEqual(editFirst('Node.js'), ['Node.js', 'React']);
assert.deepEqual(moveDownFirst(), ['React', 'TypeScript']);
assert.deepEqual(moveUpSecond(), ['React', 'TypeScript']);
assert.deepEqual(removeFirst(), ['React']);
assert.deepEqual(addSkill(), ['TypeScript', 'React', '']);
```

同时断言第一项“上移”和最后一项“下移”处于 disabled。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
npx tsx --test src/options/SkillsEditor.test.tsx
```

Expected: FAIL，因为 `SkillsEditor.tsx` 尚不存在。

- [ ] **Step 3: 实现最小 SkillsEditor**

组件接口：

```ts
interface SkillsEditorProps {
  skills: string[];
  onChange: (skills: string[]) => void;
}
```

实现不可变更新：

```ts
const update = (index: number, value: string) => {
  onChange(skills.map((skill, itemIndex) => itemIndex === index ? value : skill));
};

const move = (index: number, direction: -1 | 1) => {
  const target = index + direction;
  if (target < 0 || target >= skills.length) return;
  const next = [...skills];
  [next[index], next[target]] = [next[target], next[index]];
  onChange(next);
};

const remove = (index: number) => {
  onChange(skills.filter((_, itemIndex) => itemIndex !== index));
};
```

每行渲染输入框和文字按钮“上移 / 下移 / 删除”；底部按钮调用：

```ts
onChange([...skills, '']);
```

- [ ] **Step 4: 接入 ExperienceSection 并删除旧 UI**

在 `ExperienceSection.tsx` 中：

```tsx
<h2 style={{ ...styles.sectionTitle, marginTop: '36px' }}>专业技能</h2>
<SkillsEditor skills={skills} onChange={onChangeSkills} />
```

删除旧提示和技能 textarea。增加接入测试，断言源码或渲染结果不再包含：

```text
每行一条，填充技能类字段时会合并为一段文本。
```

- [ ] **Step 5: 将新测试纳入标准测试命令**

若 `npm test` 未覆盖该文件，将 `src/options/SkillsEditor.test.tsx` 和 `src/options/ExperienceSection.test.tsx` 加入 `test:resume-profiles`。

- [ ] **Step 6: 验证 GREEN**

Run:

```bash
npx tsx --test src/options/SkillsEditor.test.tsx src/options/ExperienceSection.test.tsx
npm run test:resume-profiles
```

Expected: 全部 PASS。

- [ ] **Step 7: 提交 Task 1**

```bash
git add src/options/SkillsEditor.tsx src/options/SkillsEditor.test.tsx src/options/ExperienceSection.tsx src/options/ExperienceSection.test.tsx package.json
git commit -m "feat: add professional skills editor" --trailer "Co-Authored-By: Aime <aime@bytedance.com>"
```

### Task 2: 信息浮窗专业技能分区

**Files:**
- Modify: `src/sidepanel/ProfileSections.tsx`
- Modify: `src/sidepanel/ProfileSections.test.ts`

**Interfaces:**
- Consumes: `profile.skills: string[]`。
- Produces: “专业技能”分区；点击调用现有 `onFieldClick(value, key)`。

- [ ] **Step 1: 写失败的浮窗回归测试**

构造：

```ts
const profile = {
  ...emptyProfile,
  projects: [{ id: 'p1', name: '项目', role: '', startDate: '', endDate: '', description: '' }],
  skills: ['TypeScript', '', 'React'],
  awards: [{ id: 'a1', name: '一等奖', role: '', date: '', description: '' }],
};
```

断言：

- 标题顺序为“项目经历” < “专业技能” < “奖项 / 荣誉”。
- 页面包含 `TypeScript`、`React`，不产生空技能按钮。
- 点击 `React` 调用：

```ts
onFieldClick('React', 'skill-2');
```

- `skills: []` 或仅空字符串时不包含“专业技能”。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
npx tsx --test src/sidepanel/ProfileSections.test.ts
```

Expected: FAIL，因为当前浮窗没有专业技能分区。

- [ ] **Step 3: 实现技能分区**

在项目分区之后计算：

```ts
const visibleSkills = profile.skills
  .map((skill, index) => ({ skill: skill.trim(), index }))
  .filter(item => item.skill.length > 0);
```

然后在奖项分区之前渲染：

```tsx
{visibleSkills.length > 0 && (
  <SectionSummary title="专业技能">
    {visibleSkills.map(({ skill, index }) => (
      <FieldButton
        key={`skill-${index}`}
        fieldKey={`skill-${index}`}
        value={skill}
        workingKey={workingKey}
        onFieldClick={onFieldClick}
      />
    ))}
  </SectionSummary>
)}
```

具体字段按钮复用文件中现有可点击字段实现，不创建新的交互体系。

- [ ] **Step 4: 验证 GREEN**

Run:

```bash
npx tsx --test src/sidepanel/ProfileSections.test.ts
npm run test:sidepanel
```

Expected: 全部 PASS。

- [ ] **Step 5: 运行最终验证**

Run:

```bash
npm test
npm run build
npx oxlint src/options/SkillsEditor.tsx src/options/ExperienceSection.tsx src/sidepanel/ProfileSections.tsx
git diff --check
```

Expected: 测试和构建退出码 0；lint 无 error；diff check 无输出。

- [ ] **Step 6: 提交 Task 2**

```bash
git add src/sidepanel/ProfileSections.tsx src/sidepanel/ProfileSections.test.ts
git commit -m "feat: show professional skills in information window" --trailer "Co-Authored-By: Aime <aime@bytedance.com>"
```
