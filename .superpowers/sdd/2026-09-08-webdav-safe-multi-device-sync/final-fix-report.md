# WebDAV 安全多设备同步最终修复报告

- 状态：DONE_WITH_CONCERNS
- 基线 HEAD：`acf43c212c290085b16bd1a6d69943f8253138d8`
- 最终提交 SHA：以本报告所在提交的 `git rev-parse HEAD` 输出为准（完整值同时在交付回复中提供）。
- 日期：2026-09-08

## 修复内容

1. 普通远端下载和强制远端下载均不再调用任何 PUT，包含 `application-records.csv` sidecar；CSV 仅随安全的本地创建/上传或冲突中显式选择本地版本更新。
2. `completeSync` 仅接受非空 ETag。内容相同或远端下载应用成功但 GET 未返回 ETag 时，返回明确错误并保留上一条可信基线的 hash、时间、action 与 ETag；设置页展示失败状态，不显示成功措辞，也不触发下载成功刷新。
3. README 补充安全双向同步契约：远端单边更新自动下载、双方修改不自动覆盖、首次内容不同进入冲突、ETag 阻止同步期间并发覆盖，并说明冲突选择及下载零 PUT 行为。

## TDD 证据

### RED

- `npx tsx --test src/shared/backup-sync.test.ts`：79 项中 74 通过、5 失败；失败分别证明普通下载仍写 CSV、双设备下载仍有 PUT、强制下载仍写 CSV、无 ETag 的相同内容与下载仍错误标记成功。
- `npx tsx --test --test-name-pattern="README 说明" src/shared/backup-sync.test.ts`：1/1 失败，README 缺少多设备同步契约。
- `npx tsx --test src/options/DataSyncSettings.test.tsx`：8 项中 7 通过、1 失败；错误状态显示“同步请求已提交”，未明确提示同步失败。

### GREEN 与最终验证

- 聚焦同步测试：`npx tsx --test src/shared/backup-sync.test.ts`，80/80 通过。
- 聚焦 UI 测试：`npx tsx --test src/options/DataSyncSettings.test.tsx`，8/8 通过。
- 全量测试：`npm test`，主阶段 165/165、sidepanel 13/13、application-records core 15/15、application-records UI 24/24、resume-profiles 94/94，全部通过。
- 静态检查：`npm run lint`，0 errors、10 warnings。
- 构建：`npm run build`，成功生成 `dist/`。
- 空白检查：`git diff --check`，退出码 0。

## Concerns

- `npm run lint` 仍报告 10 条仓库既有 warning（React Fast Refresh 导出规则 9 条、无用转义 1 条），无 error，均不位于本次功能修改范围。
- 测试仍输出仓库既有的 `react-test-renderer` deprecation、部分 `act(...)` 环境提示及预期错误路径日志；不影响退出码。
- 工作树开始时已有未提交的 `package-lock.json` 修改及 Task 1–3 报告，本次未修改、未暂存这些既有内容。
- 未 push。


---

## 规格变更轮次：无 ETag hash-fallback（2026-09-08）

- 状态：DONE_WITH_CONCERNS
- 起始提交：`bf7d0c152af9a543d84bd7037b248e784f3469bb`
- 最终提交 SHA：以本报告所在提交的 `git rev-parse HEAD` 输出为准，完整值在最终交付回复中提供。

### 变更摘要

- 新增并持久化并发模式 `etag | hash-fallback`。
- `etag` 可信基线要求 hash 与 ETag；`hash-fallback` 可信基线要求经用户确认或成功内容校验得到的 hash。
- 首次遇到无 ETag 且两端内容不同时进入带摘要的确认冲突，不自动应用或覆盖。
- 选择远端后应用并校验远端，选择本地后执行上传前复查、上传及上传后回读验证；两者成功后均建立 hash-fallback 基线。
- 后续按三方 hash 自动判定远端下载、本地上传或双方冲突，不重复要求确认。
- 后续 GET 或 PUT 返回 ETag 时自动升级为 `etag` 模式。
- UI 增加无 ETag 仅需首次确认的说明，并保留“使用本地 / 使用远端 / 暂不处理”与双侧摘要。
- 设计文档、实施计划与 README 已同步修订。

### TDD 证据

- 同步测试 RED：新增测试后 85 项中 81 通过、4 失败，分别暴露模式未归一化、缺少首次确认原因、选择远端无法建立 fallback、fallback 上传不可用。
- UI 测试 RED：9 项中 8 通过、1 失败，首次无 ETag 说明缺失。
- PUT 返回 ETag 升级测试 RED：1/1 失败，实际仍为 `hash-fallback`；修复后使用 PUT 或验证 GET 返回的 ETag 自动升级。
- 聚焦 GREEN：同步测试 88/88、UI 测试 9/9。

### Concerns

- `hash-fallback` 通过上传前 GET/hash 复查和上传后 GET/hash 验证降低覆盖风险，但不具备 ETag 条件写入的原子并发保证；用户已明确接受。
- lint 与测试输出仍包含仓库既有 warning，详见前一轮 concerns；本轮未修改相关文件。
- 起始工作树已有 `package-lock.json` 修改与 Task 1–3 未跟踪报告，本轮继续不纳入提交。
- 未 push。
