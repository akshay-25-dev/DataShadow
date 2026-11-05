import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProfile, SAMPLE_PROFILE, DEFAULT_POLICY, makeContext, planAll } from '../src/index.js';

const classifications = classifyProfile(SAMPLE_PROFILE);
const plan = (opts = {}) => {
  const p = planAll(makeContext({ classifications, policy: DEFAULT_POLICY, ...opts }));
  return Object.fromEntries(p.map((e) => [e.id, e]));
};

test('online, no consent: bands local, region transformed, bureau blocked, score remote', () => {
  const p = plan();
  for (const id of ['dti_band', 'util_band', 'afford_band', 'age_band', 'income_band', 'notes_redact']) {
    assert.equal(p[id].decision, 'LOCAL', id);
  }
  assert.equal(p.region_check.decision, 'REMOTE_TRANSFORMED');
  assert.deepEqual(p.region_check.transforms, { pincode: 'generalize_prefix' });
  assert.equal(p.bureau_lookup.decision, 'BLOCKED_CONSENT');
  assert.equal(p.risk_score.decision, 'REMOTE');
  assert.deepEqual(p.risk_score.rawFields, []); // the score op sees no raw profile field
  for (const id of ['employment_type', 'loan_amount', 'tenure_months']) assert.equal(p[id].decision, 'PASSTHROUGH');
});

test('local decisions cite the policy rule that rejected the remote option', () => {
  const p = plan();
  assert.match(p.dti_band.reasons.join(' '), /R6-financial-band/);
  assert.match(p.age_band.reasons.join(' '), /R4-dob-band/);
});

test('consent turns bureau lookup into a flagged raw send of PAN only', () => {
  const p = plan({ consent: { bureau: true } });
  assert.equal(p.bureau_lookup.decision, 'REMOTE_CONSENTED');
  assert.deepEqual(p.bureau_lookup.rawFields, ['pan']);
});

test('offline: score falls back to local, region deferred, bureau never queued', () => {
  const p = plan({ network: { online: false, rttMs: Infinity }, consent: { bureau: true } });
  assert.equal(p.risk_score.decision, 'LOCAL_FALLBACK');
  assert.equal(p.region_check.decision, 'DEFERRED');
  assert.equal(p.bureau_lookup.decision, 'BLOCKED');
  assert.match(p.bureau_lookup.reasons.join(' '), /never queued/);
  assert.equal(p.dti_band.decision, 'LOCAL'); // local work is unaffected by connectivity
});

test('latency trade-off flips the score between remote and provisional-local', () => {
  assert.equal(plan({ network: { online: true, rttMs: 100 } }).risk_score.decision, 'REMOTE');
  assert.equal(plan({ network: { online: true, rttMs: 800 } }).risk_score.decision, 'REMOTE');
  assert.equal(plan({ network: { online: true, rttMs: 2500 } }).risk_score.decision, 'LOCAL_FALLBACK');
});

test('a never-transmit identifier can never be planned for the wire', () => {
  const p = plan({ consent: { bureau: true } });
  for (const e of Object.values(p)) {
    for (const f of e.rawFields) assert.ok(!['aadhaar', 'fullName', 'phone', 'email'].includes(f), `${e.id} raw ${f}`);
  }
});
