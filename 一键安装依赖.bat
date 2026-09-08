@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"
echo == Job-Application-Helper 一键安装 ^& 构建 ==
echo 目录: %cd%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 node。请先安装 Node.js ^(建议 LTS 版本^) 后重试。
  echo 下载: https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 npm。请确认 Node.js 安装正常，然后重试。
  pause
  exit /b 1
)

echo node:
node -v
echo npm:
npm -v
echo.

node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>=23 || (a===22&&b>=12) || a===21 || (a===20&&b>=19) ? 0 : 1)"
if errorlevel 1 (
  echo [错误] 当前 Node.js 版本不满足要求。
  echo 请安装 Node.js 20.19+ 或 22.12+，推荐使用最新 LTS 版本。
  echo 下载: https://nodejs.org/
  pause
  exit /b 1
)

set "INSTALL_STATUS=0"
set "TEST_STATUS=0"
set "BUILD_STATUS=0"

if exist package-lock.json (
  echo == 安装依赖: npm ci ==
  call npm ci
) else (
  echo == 安装依赖: npm install ^(未找到 package-lock.json^) ==
  call npm install
)

if errorlevel 1 (
  set "INSTALL_STATUS=1"
  echo [错误] 依赖安装失败。请查看上方 npm 日志，其中通常会标出失败的依赖。
)

echo.
echo == 运行测试: npm test ==
call npm test
if errorlevel 1 (
  set "TEST_STATUS=1"
  echo [错误] 自动化测试失败；仍将继续尝试构建。
)

echo.
echo == 构建: npm run build ==
call npm run build
if errorlevel 1 (
  set "BUILD_STATUS=1"
  echo [错误] 构建失败，请查看上方日志。
)

echo.
echo == 执行结果汇总 ==
if "!INSTALL_STATUS!"=="0" (echo 依赖安装: 成功) else (echo 依赖安装: 失败)
if "!TEST_STATUS!"=="0" (echo 测试: 成功) else (echo 测试: 失败)
if "!BUILD_STATUS!"=="0" (echo 构建: 成功) else (echo 构建: 失败)

if "!INSTALL_STATUS!!TEST_STATUS!!BUILD_STATUS!" NEQ "000" (
  echo 流程已全部尝试，但存在失败，请根据上方日志处理。
  pause
  exit /b 1
)

echo.
echo 完成！依赖安装、测试和构建均已通过。
echo 浏览器加载目录: %cd%\dist
echo 请在 Chrome/Edge 扩展管理页开启开发者模式，然后选择“加载已解压的扩展程序”。
pause
exit /b 0
