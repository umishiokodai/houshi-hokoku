'use strict';
// Run with: node --test tests/aggregation.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadApp(entries, monthly = {}, startMonth = 9) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const match = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
  assert.ok(match, 'inline app script exists');
  // The initial render and service-worker setup need a real DOM; calculations do not.
  const js = match[1].split('\nrender();\n')[0];
  const data = {
    settings: { name: '', role: '正規開拓者', monthlyGoal: 50,
      yearlyGoal: 600, startMonth, useDailyGoal: false },
    entries,
    monthly
  };
  const storage = new Map([['houshi_hokoku_v1', JSON.stringify(data)]]);
  const localStorage = {
    getItem: k => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k)
  };
  const ctx = vm.createContext({ localStorage, navigator: {} });
  vm.runInContext(js, ctx, { filename: 'index.html', timeout: 1000 });
  return ctx;
}

test('別日に記録した研究1件ずつは月2件、コピー報告でも2件になる', () => {
  const app = loadApp({
    '2026-10-03': { s: 1 },
    '2026-10-28': { s: 1 }
  });
  assert.equal(app.monthStats(2026, 10).studies, 2);
  assert.match(app.reportText(2026, 10), /聖書研究: 2/);
  assert.match(app.renderCal(), /📖 研究 2/);
});

test('月単位の研究総数は日別合計と二重加算しない', () => {
  const app = loadApp({
    '2026-10-03': { s: 1 },
    '2026-10-14': { s: 1 }
  }, { '2026-10': { s: 3 } });
  assert.equal(app.monthStats(2026, 10).studies, 3);
  app.S.monthly['2026-10'].s = 1;
  assert.equal(app.monthStats(2026, 10).studies, 2);
});

test('年度累計実績は月別の整数時間の合計と一致する', () => {
  const app = loadApp({
    '2026-09-03': { a: 90 },  // 9月: 1h30m → 1h, 繰越30m
    '2026-10-04': { a: 105 }  // 10月: 1h45m+30m → 2h, 繰越15m
  });
  const sep = app.monthStats(2026, 9), oct = app.monthStats(2026, 10);
  assert.equal(sep.reportMin, 60);
  assert.equal(sep.carryOut, 30);
  assert.equal(oct.carryIn, 30);
  assert.equal(oct.reportMin, 120);
  assert.equal(oct.carryOut, 15);
  assert.equal(app.yearStats(2026).reportT, 180);
  app.yearShown = 2026;
  const html = app.renderYear();
  assert.match(html, /累計実績 3h/);
  assert.match(html, /<tr><td>合計<\/td><td><b>3h<\/b>/);
  assert.doesNotMatch(html, /累計実績 3h 15'/);
});

test('奉仕年度をまたぐ分単位の繰越は保たれ、年度累計は整数になる', () => {
  const app = loadApp({
    '2026-08-31': { a: 35 },
    '2026-09-01': { a: 30 }
  });
  assert.equal(app.monthStats(2026, 8).carryOut, 35);
  assert.equal(app.monthStats(2026, 9).carryIn, 35);
  assert.equal(app.monthStats(2026, 9).reportMin, 60);
  assert.equal(app.yearStats(2026).reportT, 60);
});

test('月単位の直接入力も次月へ繰り越し、年間合計に反映する', () => {
  const app = loadApp({}, {
    '2026-09': { a: 45 },
    '2026-10': { a: 45 }
  });
  assert.equal(app.monthStats(2026, 9).reportMin, 0);
  assert.equal(app.monthStats(2026, 9).carryOut, 45);
  assert.equal(app.monthStats(2026, 10).reportMin, 60);
  assert.equal(app.monthStats(2026, 10).carryOut, 30);
  assert.equal(app.yearStats(2026).reportT, 60);
});
