# 一键安装与构建脚本容错 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 macOS 和 Windows 一键脚本在依赖安装或测试失败后仍尝试构建，并在结束时准确汇总各阶段结果。

**Architecture:** 两个平台脚本继续顺序执行安装、测试、构建，但各阶段独立捕获退出码，不再因可恢复的阶段失败提前退出。使用静态回归测试锁定脚本控制流和最终退出语义，再通过真实测试与构建验证项目未受影响。

**Tech Stack:** Bash、Windows Batch、Node.js test runner、TypeScript、npm

## Global Constraints

- Node.js 或 npm 缺失、Node.js 版本不满足要求时仍立即退出。
- 依赖安装、测试或构建失败时必须保留原始命令输出。
- 依赖安装或测试失败后仍必须实际执行 `npm run build`。
- 任一阶段失败时脚本最终必须返回非零退出码。
- 不修改锁文件、不自动重试、不切换 npm 源、不猜测失败包名。
- macOS 与 Windows 脚本行为保持一致。

---

### Task 1: 为两个一键脚本增加独立阶段状态与最终汇总

**Files:**
- Modify: `src/shared/packageScripts.test.ts`
- Modify: `一键安装依赖.command`
- Modify: `一键安装依赖.bat`

**Interfaces:**
- Consumes: npm 命令退出码；现有 `npm ci`/`npm install`、`npm test`、`npm run build` 命令。
- Produces: `install_status`、`test_status`、`build_status`（Bash）及 `INSTALL_STATUS`、`TEST_STATUS`、`BUILD_STATUS`（Batch）三个阶段状态；最终统一成功或失败退出码。

- [ ] **Step 1: 在现有脚本测试中加入失败后仍构建的回归断言**

在 `src/shared/packageScripts.test.ts` 增加脚本文本读取和两个测试：

```ts
async function readText(filePath: string) {
  return readFile(filePath, 'utf8');
}

test('macOS 一键脚本独立记录安装测试构建状态并最终汇总', async () => {
  const script = await readText(path.join(repoRoot, '一键安装依赖.command'));

  assert.match(script, /install_status=0/);
  assert.match(script, /test_status=0/);
  assert.match(script, /build_status=0/);
  assert.match(script, /if ! npm (ci|install); then/);
  assert.match(script, /if ! npm test; then/);
  assert.match(script, /if ! npm run build; then/);
  assert.match(script, /依赖安装.*测试.*构建/s);
  assert.match(script, /exit 1/);
});

test('Windows 一键脚本独立记录安装测试构建状态并最终汇总', async () => {
  const script = await readText(path.join(repoRoot, '一键安装依赖.bat'));

  assert.match(script, /set "INSTALL_STATUS=0"/i);
  assert.match(script, /set "TEST_STATUS=0"/i);
  assert.match(script, /set "BUILD_STATUS=0"/i);
  assert.match(script, /call npm test/i);
  assert.match(script, /call npm run build/i);
  assert.match(script, /依赖安装.*测试.*构建/is);
  assert.match(script, /exit \/b 1/i);
});
```

这些断言锁定两个核心行为：每个阶段有独立状态，且脚本包含构建和最终失败退出路径。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
npx tsx --test src/shared/packageScripts.test.ts
```

Expected: 新增的两个测试 FAIL，因为现有脚本没有三个阶段状态变量及统一汇总。

- [ ] **Step 3: 修改 macOS 脚本为阶段独立执行**

将 `一键安装依赖.command` 的严格模式改为：

```bash
set -uo pipefail
```

环境检查之后初始化状态：

```bash
install_status=0
test_status=0
build_status=0
```

依赖安装使用条件语句记录失败，但不退出：

```bash
if [[ -f package-lock.json ]]; then
  echo "== 安装依赖: npm ci =="
  if ! npm ci; then
    install_status=1
    echo "[错误] 依赖安装失败。请查看上方 npm 日志，其中通常会标出失败的依赖。"
  fi
else
  echo "== 安装依赖: npm install (未找到 package-lock.json) =="
  if ! npm install; then
    install_status=1
    echo "[错误] 依赖安装失败。请查看上方 npm 日志，其中通常会标出失败的依赖。"
  fi
fi
```

测试和构建同样独立记录：

```bash
if ! npm test; then
  test_status=1
  echo "[错误] 自动化测试失败；仍将继续尝试构建。"
fi

if ! npm run build; then
  build_status=1
  echo "[错误] 构建失败，请查看上方日志。"
fi
```

最后汇总并统一决定退出码：

```bash
echo "== 执行结果汇总 =="
[[ $install_status -eq 0 ]] && echo "依赖安装: 成功" || echo "依赖安装: 失败"
[[ $test_status -eq 0 ]] && echo "测试: 成功" || echo "测试: 失败"
[[ $build_status -eq 0 ]] && echo "构建: 成功" || echo "构建: 失败"

if (( install_status || test_status || build_status )); then
  echo "流程已全部尝试，但存在失败，请根据上方日志处理。"
  read -n 1 -s -r -p "按任意键退出..."
  echo
  exit 1
fi
```

仅在三个状态均为 0 时显示 `dist/` 加载说明并正常结束。

- [ ] **Step 4: 修改 Windows 脚本为阶段独立执行**

环境检查后初始化：

```bat
set "INSTALL_STATUS=0"
set "TEST_STATUS=0"
set "BUILD_STATUS=0"
```

安装命令后不退出，只记录：

```bat
if errorlevel 1 (
  set "INSTALL_STATUS=1"
  echo [错误] 依赖安装失败。请查看上方 npm 日志，其中通常会标出失败的依赖。
)
```

测试和构建分别执行并记录：

```bat
call npm test
if errorlevel 1 (
  set "TEST_STATUS=1"
  echo [错误] 自动化测试失败；仍将继续尝试构建。
)

call npm run build
if errorlevel 1 (
  set "BUILD_STATUS=1"
  echo [错误] 构建失败，请查看上方日志。
)
```

最终使用三个状态输出逐项结果；任一状态为 1 时 `pause` 后 `exit /b 1`，全部成功才显示 `dist\` 加载说明并 `exit /b 0`。

- [ ] **Step 5: 运行目标测试并确认 GREEN**

Run:

```bash
npx tsx --test src/shared/packageScripts.test.ts
```

Expected: 全部 PASS，0 failures。

- [ ] **Step 6: 运行脚本语法、完整测试与构建验证**

Run:

```bash
bash -n '一键安装依赖.command'
npm test
npm run build
git diff --check
```

Expected:

- Bash 语法检查退出码 0。
- 全量测试 0 failures。
- 构建退出码 0，生成 `dist/`。
- `git diff --check` 无输出。

Windows Batch 无法在 macOS 原生执行，因此通过静态回归测试验证其关键控制流，并人工检查 `if errorlevel` 与状态变量语义。

- [ ] **Step 7: 提交实现**

```bash
git add src/shared/packageScripts.test.ts '一键安装依赖.command' '一键安装依赖.bat'
git commit -m "fix: continue build after setup failures" --trailer "Co-Authored-By: Aime <aime@bytedance.com>"
```
