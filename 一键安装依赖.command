#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")"

echo "== Job-Application-Helper 一键安装 & 构建 =="
echo "目录: $(pwd)"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 node。请先安装 Node.js (建议 LTS 版本)，然后重试。"
  echo "下载: https://nodejs.org/"
  read -n 1 -s -r -p "按任意键退出..."
  echo
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[错误] 未检测到 npm。请确认 Node.js 安装正常，然后重试。"
  read -n 1 -s -r -p "按任意键退出..."
  echo
  exit 1
fi

echo "node: $(node -v)"
echo "npm:  $(npm -v)"
echo

if ! node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>=23 || (a===22&&b>=12) || a===21 || (a===20&&b>=19) ? 0 : 1)"; then
  echo "[错误] 当前 Node.js 版本不满足要求。"
  echo "请安装 Node.js 20.19+ 或 22.12+，推荐使用最新 LTS 版本。"
  echo "下载: https://nodejs.org/"
  read -n 1 -s -r -p "按任意键退出..."
  echo
  exit 1
fi

install_status=0
test_status=0
build_status=0

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

echo
echo "== 运行测试: npm test =="
if ! npm test; then
  test_status=1
  echo "[错误] 自动化测试失败；仍将继续尝试构建。"
fi

echo
echo "== 构建: npm run build =="
if ! npm run build; then
  build_status=1
  echo "[错误] 构建失败，请查看上方日志。"
fi

echo
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

echo
echo "完成！依赖安装、测试和构建均已通过。"
echo "浏览器加载目录: $(pwd)/dist"
echo "请在 Chrome/Edge 扩展管理页开启开发者模式，然后选择“加载已解压的扩展程序”。"
read -n 1 -s -r -p "按任意键退出..."
echo
