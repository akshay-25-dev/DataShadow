import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProfile, SAMPLE_PROFILE, DEFAULT_POLICY, makeContext, planAll, executeLocal, buildPayload,
  PrivacyBudget, scoreDerived,
} from '@datashadow/core';
import { createApp } from '../src/app.js';

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body) => fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

function payloadFor(profile, consent = {}) {
  const classifications = classifyProfile(profile);
  const plan = planAll(makeContext({ classifications, policy: DEFAULT_POLICY, consent }));
  const local = executeLocal(profile, plan, { budget: new PrivacyBudget(40), now: new Date('2026-11-04T00:00:00Z') });
  return buildPayload(profile, plan, local.released, { consent, session: 'sess-server-test' });
}

test('health', async () => {
  const r = await fetch(`${base}/api/health`);
  assert.equal((await r.json()).ok, true);
});

test('accepts a minimised payload and scores it exactly like the shared model', async () => {
  const payload = payloadFor(SAMPLE_PROFILE);
  const r = await post('/api/score', payload);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.mode, 'datashadow');
  assert.equal(j.score, scoreDerived(payload.features).score);
  assert.equal(j.serviceable, true); // 560 is serviceable
  assert.equal(j.bureau, null);
});

test('rejects raw sensitive fields, and never echoes their values', async () => {
  const payload = payloadFor(SAMPLE_PROFILE);
  payload.features.monthlyIncome = 85000;
  payload.features.fullName = 'Aarav Mehta';
  const r = await post('/api/score', payload);
  assert.equal(r.status, 422);
  const text = await r.text();
  assert.ok(!text.includes('Aarav') && !text.includes('85000'));
  assert.match(text, /not on the allowlist/);
  // rejected payloads are logged as keys + errors only
  const log = await (await fetch(`${base}/api/received?session=sess-server-test`)).json();
  const rejected = log.records.find((x) => x.rejected);
  assert.ok(rejected && !('body' in rejected));
  assert.ok(!JSON.stringify(rejected).includes('Aarav'));
});

test('PAN is rejected without consent and accepted with it (simulated bureau band returned)', async () => {
  const noConsent = payloadFor(SAMPLE_PROFILE);
  noConsent.features.pan = 'ABCDE1234F';
  noConsent.ops.push('bureau_lookup');
  assert.equal((await post('/api/score', noConsent)).status, 422);

  const r = await post('/api/score', payloadFor(SAMPLE_PROFILE, { bureau: true }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(['good', 'fair', 'poor'].includes(j.bureau));
  assert.equal(j.bureauSimulated, true);
});

test('region check uses server-held data and only sees the 3-digit prefix', async () => {
  const p = payloadFor({ ...SAMPLE_PROFILE, pincode: '999999' });
  assert.equal(p.features.region3, '999');
  const j = await (await post('/api/score', p)).json();
  assert.equal(j.serviceable, false);
});

test('missing required band is rejected', async () => {
  const p = payloadFor(SAMPLE_PROFILE);
  delete p.features.dti_band;
  assert.equal((await post('/api/score', p)).status, 422);
});

test('traditional baseline route stores the whole raw profile (that is the point of the comparison)', async () => {
  const session = 'sess-trad-0001';
  const r = await post('/api/score-traditional', { session, mode: 'traditional', profile: SAMPLE_PROFILE });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mode, 'traditional');
  const log = await (await fetch(`${base}/api/received?session=${session}`)).json();
  assert.equal(log.records[0].body.profile.aadhaar, SAMPLE_PROFILE.aadhaar);
});

test('malformed JSON gets a clean 400', async () => {
  const r = await fetch(`${base}/api/score`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope',
  });
  assert.equal(r.status, 400);
});

test('received log is per session and can be cleared', async () => {
  const s = 'sess-clear-0001';
  const p = payloadFor(SAMPLE_PROFILE);
  p.session = s;
  await post('/api/score', p);
  assert.equal((await (await fetch(`${base}/api/received?session=${s}`)).json()).records.length, 1);
  await fetch(`${base}/api/received?session=${s}`, { method: 'DELETE' });
  assert.equal((await (await fetch(`${base}/api/received?session=${s}`)).json()).records.length, 0);
});
