import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../..');

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
}

async function readText(filePath: string) {
  return readFile(filePath, 'utf8');
}

test('npm test 使用仓库内受版本控制的 tsx 依赖，而不是 npx 临时下载', async () => {
  const packageJson = await readJson(path.join(repoRoot, 'package.json')) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const packageLock = await readJson(path.join(repoRoot, 'package-lock.json')) as {
    packages?: Record<string, { devDependencies?: Record<string, string> }>;
  };

  assert.equal(typeof packageJson.scripts?.test, 'string');
  assert.doesNotMatch(packageJson.scripts!.test, /\bnpx\b/);
  assert.match(packageJson.scripts!.test, /^tsx --test\b/);
  assert.doesNotMatch(packageJson.scripts!.test, /--experimental-strip-types/);
  assert.match(packageJson.scripts!.test, /\bnpm run test:sidepanel\b/);
  assert.match(packageJson.scripts!.test, /\bnpm run test:resume-profiles\b/);
  assert.match(packageJson.scripts!['test:resume-profiles'], /src\/options\/AwardsSection\.test\.tsx/);
  assert.equal(typeof packageJson.scripts?.['test:sidepanel'], 'string');
  assert.match(packageJson.scripts!['test:sidepanel'], /\btsx\b/);
  assert.doesNotMatch(packageJson.scripts!['test:sidepanel'], /\bnpx\b/);
  assert.ok(packageJson.devDependencies?.tsx, 'package.json 应声明 tsx 为 devDependency');
  assert.equal(
    packageLock.packages?.['']?.devDependencies?.tsx,
    packageJson.devDependencies?.tsx
  );
  assert.ok(packageLock.packages?.['node_modules/tsx'], 'package-lock.json 应锁定 node_modules/tsx');
});

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
