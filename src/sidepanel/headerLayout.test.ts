import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

test('页眉第一行承载标题和操作按钮，说明文字独占第二行', () => {
  assert.match(
    appSource,
    /<div className="panel-header-main">[\s\S]*?<h1>网申信息浮窗<\/h1>[\s\S]*?<div className="header-actions">/,
  );
  assert.match(
    appSource,
    /<\/div>\s*<p className="panel-subtitle">\{subtitleText\}<\/p>\s*<\/header>/,
  );
});

test('页眉按钮不换行且说明文字使用完整宽度', () => {
  assert.match(
    cssSource,
    /\.panel-header-main\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/s,
  );
  assert.match(
    cssSource,
    /\.settings-button,[\s\S]*?\.pip-button[\s\S]*?white-space:\s*nowrap;/,
  );
  assert.match(cssSource, /\.panel-subtitle\s*\{[^}]*width:\s*100%;/s);
  assert.doesNotMatch(cssSource, /\.panel-subtitle\s*\{[^}]*max-width:/s);
});
