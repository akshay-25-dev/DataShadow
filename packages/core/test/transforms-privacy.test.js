import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketLabel, ageYears, redactText, pwl, emi, scanText, PrivacyBudget, BudgetExceededError,
  randomizedResponse, seededRng, FEATURES, scoreRaw, scoreDerived, decisionFor,
} from '../src/index.js';

test('bucketing: lower edge belongs to the upper band', () => {
  const { edges, labels } = FEATURES.dti;
  assert.equal(bucketLabel(0.199, edges, labels), 'lt20');
  assert.equal(bucketLabel(0.2, edges, labels), '20_35');
  assert.equal(bucketLabel(0.5, edges, labels), 'gt50');
});

test('ageYears handles birthdays', () => {
  const now = new Date('2026-11-04T00:00:00Z');
  assert.equal(ageYears('1994-11-04', now), 32);
  assert.equal(ageYears('1994-11-05', now), 31);
  assert.ok(Number.isNaN(ageYears('nope', now)));
});

test('redactText removes phone, PAN and email but keeps the rest', () => {
  const out = redactText('Call 9876543210 or a@b.com. PAN ABCDE1234F. Thanks');
  assert.ok(!/9876543210|a@b\.com|ABCDE1234F/.test(out));
  assert.ok(out.includes('Thanks'));
  assert.equal(scanText(out).length, 0);
});

test('pwl and emi sanity', () => {
  assert.equal(pwl([[0, 0], [10, 100]], 5), 50);
  assert.equal(pwl([[0, 0], [10, 100]], 99), 100);
  assert.ok(Math.abs(emi(500000, 0.11, 36) - 16370) < 30);
});

test('privacy budget enforces total epsilon', () => {
  const b = new PrivacyBudget(5);
  b.spend(2, 'a');
  b.spend(3, 'b');
  assert.throws(() => b.spend(0.5, 'c'), BudgetExceededError);
  assert.equal(b.remaining, 0);
  assert.equal(PrivacyBudget.from(b.snapshot()).spent, 5);
});

test('k-RR keeps the true label with probability e^ε/(e^ε+k-1)', () => {
  const rng = seededRng(42);
  const labels = FEATURES.dti.labels; // k = 4
  const eps = 2;
  let kept = 0;
  const N = 40000;
  for (let i = 0; i < N; i++) if (randomizedResponse(labels, '20_35', eps, rng) === '20_35') kept++;
  const expected = Math.exp(eps) / (Math.exp(eps) + labels.length - 1);
  assert.ok(Math.abs(kept / N - expected) < 0.01, `${kept / N} vs ${expected}`);
});

test('k-RR with low epsilon spreads the other labels uniformly', () => {
  const rng = seededRng(7);
  const labels = FEATURES.income.labels; // k = 5
  const counts = Object.fromEntries(labels.map((l) => [l, 0]));
  for (let i = 0; i < 50000; i++) counts[randomizedResponse(labels, 'lt25k', 0.5, rng)]++;
  const others = labels.filter((l) => l !== 'lt25k').map((l) => counts[l]);
  assert.ok(Math.max(...others) - Math.min(...others) < 1200, JSON.stringify(counts));
});

test('derived scoring equals raw scoring when the exact value sits at the band midpoint', () => {
  const raw = scoreRaw({
    dti: 0.275, util: 0.45, afford: 0.175, age: 30, income: 37500, employment: 'salaried',
  });
  const der = scoreDerived({
    dti_band: '20_35', util_band: '30_60', afford_band: '10_25', age_band: '25_34', income_band: '25k_50k',
    employment_type: 'salaried',
  });
  assert.equal(raw.score, der.score);
  assert.equal(decisionFor(raw.score), der.decision);
});

test('scoreDerived rejects unknown band labels', () => {
  assert.throws(() => scoreDerived({ dti_band: 'bogus' }));
});
