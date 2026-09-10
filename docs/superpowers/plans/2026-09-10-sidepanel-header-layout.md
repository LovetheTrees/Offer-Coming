# 信息浮窗页眉排版调整 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将信息浮窗页眉调整为标题与按钮同一行、说明文字独占第二行的稳定布局。

**Architecture:** 在 `App.tsx` 中增加明确的第一行容器 `panel-header-main`，把说明文字移到该容器之后。CSS 以纵向页眉包裹横向标题行，按钮统一尺寸并禁止换行；窄屏只压缩按钮间距和内边距，不改变结构。

**Tech Stack:** React、TypeScript、CSS、Node.js test runner

## Global Constraints

- 两个按钮统一高度、横向文字、不换行，并向上、向右收紧。
- 按钮底部不超过“网申信息浮窗”标题底线。
- 说明文字独占第二行并使用页眉完整宽度。
- 保留侧边栏模式与浮窗模式的现有按钮行为。
- 不修改标题、说明文案和信息字段区域。

---

### Task 1: 重构页眉结构并修正响应式布局

**Files:**
- Create: `src/sidepanel/headerLayout.test.ts`
- Modify: `src/sidepanel/App.tsx:180-202`
- Modify: `src/sidepanel/index.css:39-108,398-408`
- Modify: `package.json`（仅当标准测试命令尚未覆盖新测试文件时加入该文件）

**Interfaces:**
- Consumes: `isFloatMode`、`handleOpenFloatWindow()`、`handlePictureInPicture()`、`chrome.runtime.openOptionsPage()`
- Produces: `panel-header > panel-header-main + panel-subtitle` 页眉结构；按钮行为不变

- [ ] **Step 1: 编写失败的页眉布局测试**

创建 `src/sidepanel/headerLayout.test.ts`，读取 `App.tsx` 和 `index.css`，验证以下布局契约：

```ts
assert.match(appSource, /<div className="panel-header-main">[\s\S]*?<h1>网申信息浮窗<\/h1>[\s\S]*?<div className="header-actions">/);
assert.match(appSource, /<\/div>\s*<p className="panel-subtitle">\{subtitleText\}<\/p>\s*<\/header>/);
assert.match(cssSource, /\.panel-header-main\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/s);
assert.match(cssSource, /\.settings-button,[\s\S]*?\.pip-button[\s\S]*?white-space:\s*nowrap;/);
assert.match(cssSource, /\.panel-subtitle\s*\{[^}]*width:\s*100%;/s);
assert.doesNotMatch(cssSource, /\.panel-subtitle\s*\{[^}]*max-width:/s);
```

该测试捕获的缺陷是：说明文字重新进入标题左列、按钮允许换行，或说明文字再次被最大宽度限制。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
npx tsx --test src/sidepanel/headerLayout.test.ts
```

Expected: FAIL，因为当前不存在 `panel-header-main`，按钮共享规则没有 `white-space: nowrap`，说明文字仍有 `max-width: 260px`。

- [ ] **Step 3: 实现最小 DOM 调整**

将页眉改为：

```tsx
<header className="panel-header">
  <div className="panel-header-main">
    <h1>网申信息浮窗</h1>
    <div className="header-actions">
      {/* 保留现有条件按钮与点击行为 */}
    </div>
  </div>
  <p className="panel-subtitle">{subtitleText}</p>
</header>
```

- [ ] **Step 4: 实现页眉与按钮 CSS**

调整为：

```css
.panel-header {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 0 0 4px 2px;
  margin-bottom: 14px;
}

.panel-header-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
}

.settings-button,
.pip-button {
  min-height: 32px;
  height: 32px;
  padding: 6px 10px;
  white-space: nowrap;
}

.header-actions {
  align-items: flex-start;
  flex-shrink: 0;
  gap: 6px;
  margin-top: -2px;
}

.panel-subtitle {
  width: 100%;
  margin: 0;
  line-height: 1.5;
}

@media (max-width: 360px) {
  .header-actions {
    gap: 4px;
  }

  .settings-button,
  .pip-button {
    padding-inline: 8px;
  }
}
```

保持 `.primary-action` 的既有尺寸规则，不受页眉按钮覆盖影响。

- [ ] **Step 5: 运行目标测试并确认 GREEN**

Run:

```bash
npx tsx --test src/sidepanel/headerLayout.test.ts
```

Expected: PASS。

- [ ] **Step 6: 将新测试加入标准测试命令并运行完整验证**

若 `npm test` 不会自动运行新文件，则把 `src/sidepanel/headerLayout.test.ts` 加入 `test:sidepanel`。然后运行：

```bash
npm test
npm run build
npx oxlint src/sidepanel/App.tsx src/sidepanel/headerLayout.test.ts
git diff --check
```

Expected: 全部命令 exit code 0；Oxlint 0 errors；构建成功。

- [ ] **Step 7: 提交实现**

```bash
git add src/sidepanel/App.tsx src/sidepanel/index.css src/sidepanel/headerLayout.test.ts package.json docs/superpowers/plans/2026-09-10-sidepanel-header-layout.md
git commit -m "style: refine sidepanel header layout"
```
