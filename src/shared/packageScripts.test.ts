import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

async function writeExecutable(filePath: string, content: string) {
  await writeFile(filePath, content);
  await chmod(filePath, 0o755);
}

async function runMacScript(statuses: {
  install?: number;
  test?: number;
  build?: number;
  nodeVersion?: number;
  includeNode?: boolean;
  includeNpm?: boolean;
}) {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'package-script-'));
  const binDir = path.join(fixtureDir, 'bin');
  await writeFile(path.join(fixtureDir, 'package-lock.json'), '{}');
  await writeFile(path.join(fixtureDir, '一键安装依赖.command'), await readText(path.join(repoRoot, '一键安装依赖.command')));
  await import('node:fs/promises').then(({ mkdir }) => mkdir(binDir));

  await writeExecutable(path.join(binDir, 'dirname'), '#!/bin/bash\n/usr/bin/dirname "$@"\n');
  if (statuses.includeNode !== false) {
    await writeExecutable(path.join(binDir, 'node'), `#!/bin/bash\nif [[ "$1" == "-v" ]]; then echo v22.12.0; exit 0; fi\nexit ${statuses.nodeVersion ?? 0}\n`);
  }
  if (statuses.includeNpm !== false) {
    await writeExecutable(path.join(binDir, 'npm'), `#!/bin/bash\necho "$*" >> "${fixtureDir}/npm-calls.log"\ncase "$*" in\n  -v) echo 10.0.0; exit 0 ;;\n  ci) exit ${statuses.install ?? 0} ;;\n  test) exit ${statuses.test ?? 0} ;;\n  "run build") exit ${statuses.build ?? 0} ;;\nesac\nexit 0\n`);
  }

  try {
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn('/bin/bash', [path.join(fixtureDir, '一键安装依赖.command')], {
        cwd: fixtureDir,
        env: { ...process.env, PATH: binDir },
      });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      child.on('error', reject);
      child.on('close', code => resolve({ code, output }));
      child.stdin.end('x');
    });
    const calls = await readFile(path.join(fixtureDir, 'npm-calls.log'), 'utf8').catch(() => '');
    return { ...result, calls };
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

function assertStageOrder(calls: string) {
  assert.ok(calls.indexOf('ci\n') < calls.indexOf('test\n'));
  assert.ok(calls.indexOf('test\n') < calls.indexOf('run build\n'));
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
  assert.equal(packageLock.packages?.['']?.devDependencies?.tsx, packageJson.devDependencies?.tsx);
  assert.ok(packageLock.packages?.['node_modules/tsx'], 'package-lock.json 应锁定 node_modules/tsx');
});

for (const scenario of [
  { name: '安装失败后仍按顺序测试和构建', statuses: { install: 1 }, failed: '依赖安装' },
  { name: '测试失败后仍按顺序构建', statuses: { test: 1 }, failed: '测试' },
  { name: '构建失败时汇总失败', statuses: { build: 1 }, failed: '构建' },
]) {
  test(`macOS 一键脚本${scenario.name}并返回非零`, async () => {
    const result = await runMacScript(scenario.statuses);

    assert.equal(result.code, 1);
    assertStageOrder(result.calls);
    assert.match(result.output, new RegExp(`${scenario.failed}: 失败`));
    assert.match(result.output, /== 执行结果汇总 ==/);
    assert.doesNotMatch(result.output, /浏览器加载目录/);
  });
}

test('macOS 一键脚本全部成功时按顺序执行并返回零', async () => {
  const result = await runMacScript({});

  assert.equal(result.code, 0);
  assertStageOrder(result.calls);
  assert.match(result.output, /依赖安装: 成功.*测试: 成功.*构建: 成功/s);
  assert.match(result.output, /浏览器加载目录/);
});

for (const scenario of [
  { name: '缺少 node', statuses: { includeNode: false } },
  { name: '缺少 npm', statuses: { includeNpm: false } },
  { name: 'Node.js 版本不满足要求', statuses: { nodeVersion: 1 } },
]) {
  test(`macOS 一键脚本${scenario.name}时立即退出`, async () => {
    const result = await runMacScript(scenario.statuses);

    assert.equal(result.code, 1);
    assert.doesNotMatch(result.calls, /^(ci|test|run build)$/m);
    assert.doesNotMatch(result.output, /== 安装依赖|== 运行测试|== 构建|== 执行结果汇总/);
  });
}

test('Windows 一键脚本严格保持环境检查、阶段顺序和最终聚合结构', async () => {
  const script = await readText(path.join(repoRoot, '一键安装依赖.bat'));
  const install = script.indexOf('call npm ci');
  const testStage = script.indexOf('call npm test');
  const build = script.indexOf('call npm run build');
  const summary = script.indexOf('echo == 执行结果汇总 ==');
  const aggregate = script.indexOf('if "!INSTALL_STATUS!!TEST_STATUS!!BUILD_STATUS!" NEQ "000"');

  assert.ok(install < testStage && testStage < build && build < summary && summary < aggregate);
  assert.match(script, /call npm ci[\s\S]*?if errorlevel 1 \(\s*set "INSTALL_STATUS=1"[\s\S]*?\)\s*echo\.\s*echo == 运行测试/);
  assert.match(script, /call npm test\s*if errorlevel 1 \(\s*set "TEST_STATUS=1"[\s\S]*?\)\s*echo\.\s*echo == 构建/);
  assert.match(script, /call npm run build\s*if errorlevel 1 \(\s*set "BUILD_STATUS=1"[\s\S]*?\)/);
  assert.match(script, /if "!INSTALL_STATUS!!TEST_STATUS!!BUILD_STATUS!" NEQ "000" \([\s\S]*?exit \/b 1[\s\S]*?\)[\s\S]*?exit \/b 0/i);
  assert.doesNotMatch(script.slice(install, summary), /exit \/b/i);

  const environmentChecks = script.slice(0, script.indexOf('set "INSTALL_STATUS=0"'));
  assert.equal((environmentChecks.match(/exit \/b 1/gi) ?? []).length, 3);
  assert.ok(environmentChecks.indexOf('where node') < environmentChecks.indexOf('where npm'));
  assert.ok(environmentChecks.indexOf('where npm') < environmentChecks.indexOf('node -e'));
});
