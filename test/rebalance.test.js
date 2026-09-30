import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocate,
  driftBand,
  planMonth,
  reconcileBuffer,
  toCents,
  validateSettings,
  wholeShares,
} from '../rebalance.js';

// Every figure below is invented for the tests.

const settings = { buffer: toCents(3000), deadband: toCents(100), bandPoints: 5, bandRelative: 0.25 };
const fund = (ticker, weight, shares, bid, ask) => ({ ticker, weight, shares, bid: toCents(bid), ask: toCents(ask) });

test('buffer below target is topped up from cash first', () => {
  const r = reconcileBuffer(toCents(1000), toCents(2800), toCents(3000), toCents(100));
  assert.deepEqual(r, { action: 'buy', amount: toCents(200), deployable: toCents(800), unmet: 0 });
});

test('cash that cannot cover the shortfall all goes to the buffer', () => {
  const r = reconcileBuffer(toCents(150), toCents(2800), toCents(3000), toCents(100));
  assert.deepEqual(r, { action: 'buy', amount: toCents(150), deployable: 0, unmet: toCents(50) });
});

test('buffer over target plus deadband sells the excess', () => {
  const r = reconcileBuffer(toCents(500), toCents(3250), toCents(3000), toCents(100));
  assert.deepEqual(r, { action: 'sell', amount: toCents(250), deployable: toCents(750), unmet: 0 });
});

test('buffer inside the deadband is left alone', () => {
  const r = reconcileBuffer(toCents(500), toCents(3100), toCents(3000), toCents(100));
  assert.deepEqual(r, { action: 'none', amount: 0, deployable: toCents(500), unmet: 0 });
});

test('allocations with no overweight sleeve are the raw targets and sum to the deposit', () => {
  const a = allocate([5000, 2400, 560], [0.6, 0.3, 0.1], 1750);
  assert.deepEqual(a.map((x) => Math.round(x)), [826, 513, 411]);
  assert.equal(Math.round(a.reduce((s, x) => s + x, 0)), 1750);
});

test('an overweight sleeve is clamped to zero and the deposit split pro rata', () => {
  const a = allocate([90000, 1000, 9000], [0.6, 0.3, 0.1], 2000);
  assert.equal(a[0], 0);
  assert.equal(a[1].toFixed(2), '1922.08');
  assert.equal(a[2].toFixed(2), '77.92');
  assert.equal(Math.round(a[1] + a[2]), 2000);
});

test('whole shares floor at the limit price, and an exact multiple is not lost', () => {
  assert.equal(wholeShares(132800, 10002), 13);
  assert.equal(wholeShares(10002, 5001), 2);
  assert.equal(wholeShares(5000, 7001), 0);
  assert.equal(wholeShares(-5, 100), 0);
});

test('drift band is the tighter of the absolute and relative limits', () => {
  assert.equal(driftBand(0.6, 5, 0.25), 0.05);
  assert.equal(driftBand(0.1, 5, 0.25), 0.025);
});

test('a monthly plan recaptures excess buffer and buys toward target', () => {
  const plan = planMonth(
    {
      cash: toCents(1500),
      mmValue: toCents(3250),
      funds: [fund('AAA', 0.6, 50, 100, 100.02), fund('BBB', 0.3, 20, 120, 120.05), fund('CCC', 0.1, 8, 70, 70.01)],
    },
    settings,
  );
  assert.equal(plan.buffer.action, 'sell');
  assert.equal(plan.deposit, toCents(1750));
  assert.deepEqual(plan.buys.map((b) => b.shares), [8, 4, 5]);
  assert.equal(plan.remainder, toCents(1750) - (8 * 10002 + 4 * 12005 + 5 * 7001));
  assert.equal(plan.rebalance, null);
});

test('drift that buying cannot fix offers a full rebalance with sells', () => {
  const plan = planMonth(
    {
      cash: 0,
      mmValue: toCents(3000),
      funds: [fund('AAA', 0.6, 40, 100, 100.02), fund('BBB', 0.3, 40, 120, 120.05), fund('CCC', 0.1, 8, 70, 70.01)],
    },
    settings,
  );
  assert.ok(plan.drift[1].flagged);
  assert.ok(plan.rebalance);
  assert.deepEqual(plan.rebalance.sells.map((s) => s.shares), [0, 16, 0]);
  assert.deepEqual(plan.rebalance.buys.map((b) => b.shares), [15, 0, 5]);
  assert.ok(plan.rebalance.remainder >= 0);
});

test('settings must name unique funds whose targets total 100%', () => {
  const ok = { buffer: 0, deadband: 0, funds: [{ ticker: 'AAA', target: 60 }, { ticker: 'BBB', target: 40 }] };
  assert.deepEqual(validateSettings(ok), []);
  const bad = { ...ok, funds: [{ ticker: 'AAA', target: 60 }, { ticker: 'aaa', target: 30 }] };
  assert.equal(validateSettings(bad).length, 2);
});
