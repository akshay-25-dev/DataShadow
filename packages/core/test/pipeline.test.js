import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProfile, SAMPLE_PROFILE, DEFAULT_POLICY, makeContext, planAll, executeLocal, applyWithheld, buildPayload,
  fieldFates, measurePayload, validatePayload, PrivacyBudget, seededRng, generateProfile, computeExactFeatures,
  scoreRaw, scoreDerived, AuditLedger, reconstruct,
} from '../src/index.js';

const NOW = new Date('2026-11-04T00:00:00Z');

function run(profile, { epsilon = Infinity, consent = {}, network, budget = new PrivacyBudget(40), seed = 1 } = {}) {
  const classifications = classifyProfile(profile);
  let plan = planAll(makeContext({ classifications, policy: DEFAULT_POLICY, consent, network }));
  const local = executeLocal(profile, plan, { budget, epsilon, rng: seededRng(seed), now: NOW });
  plan = applyWithheld(plan, local.withheld);
  const payload = buildPayload(profile, plan, local.released, { consent, session: 'test-session-1' });
  const metrics = measurePayload(payload, profile, classifications);
  return { classifications, plan, local, payload, metrics };
}

test('sample profile: payload is valid, contains no raw sensitive data, and scores like the raw model', () => {
  const { payload, metrics, local } = run(SAMPLE_PROFILE);
  assert.deepEqual(validatePayload(payload), { ok: true, errors: [] });
  assert.deepEqual(metrics.exposedFields, []);
  assert.equal(metrics.leakagePct, 0);
  assert.deepEqual(metrics.tripwires, []);
  assert.equal(payload.features.region3, '560');
  assert.ok(!('pan' in payload.features));
  assert.ok(!JSON.stringify(payload).includes('Aarav'));
  const derived = scoreDerived(payload.features);
  const raw = scoreRaw(computeExactFeatures(SAMPLE_PROFILE, NOW));
  assert.equal(derived.decision, raw.decision);
  assert.ok(Math.abs(derived.score - raw.score) <= 25, `${derived.score} vs ${raw.score}`);
  assert.ok(local.exact.dti_band > 0);
});

test('notes are redacted before they reach the payload', () => {
  const { payload } = run(SAMPLE_PROFILE);
  assert.ok(!/9876543210|ABCDE1234F/.test(payload.features.notes_redacted));
  assert.match(payload.features.notes_redacted, /REDACTED/);
});

test('PROPERTY: over 400 random applicants, DataShadow never puts raw sensitive data on the wire', () => {
  const rng = seededRng(2026);
  let strictRuns = 0;
  for (let i = 0; i < 400; i++) {
    const profile = generateProfile(rng);
    const epsilon = i % 2 ? 2 : Infinity;
    const { payload, metrics } = run(profile, { epsilon, budget: new PrivacyBudget(1e6), seed: i + 1 });
    assert.deepEqual(validatePayload(payload), { ok: true, errors: [] }, `valid #${i}`);
    assert.deepEqual(metrics.exposedFields, [], `exposed #${i}: ${JSON.stringify(payload)}`);
    assert.deepEqual(metrics.tripwires, [], `tripwire #${i}`);
    assert.equal(metrics.exposedBytes, 0);
    if (Number.isFinite(epsilon)) strictRuns++;
  }
  assert.equal(strictRuns, 200);
});

test('with consent, exactly one raw field is exposed: PAN', () => {
  const { payload, metrics } = run(SAMPLE_PROFILE, { consent: { bureau: true } });
  assert.deepEqual(metrics.exposedFields, ['pan']);
  assert.equal(payload.features.pan, 'ABCDE1234F');
  assert.ok(validatePayload(payload).ok);
});

test('traditional baseline leaks every sensitive field (so the meter has something to compare against)', () => {
  const classifications = classifyProfile(SAMPLE_PROFILE);
  const m = measurePayload({ profile: SAMPLE_PROFILE }, SAMPLE_PROFILE, classifications);
  assert.equal(m.leakagePct, 100);
  assert.ok(m.exposedFields.includes('aadhaar') && m.exposedFields.includes('monthlyIncome'));
});

test('field fates: identifiers stay local, financials are transformed, service fields go raw', () => {
  const { plan } = run(SAMPLE_PROFILE);
  const f = fieldFates(SAMPLE_PROFILE, plan);
  assert.equal(f.aadhaar, 'LOCAL_ONLY');
  assert.equal(f.fullName, 'LOCAL_ONLY');
  assert.equal(f.monthlyIncome, 'TRANSFORMED');
  assert.equal(f.pincode, 'TRANSFORMED');
  assert.equal(f.loanAmount, 'SENT_RAW');
  assert.equal(fieldFates(SAMPLE_PROFILE, plan, 'traditional').aadhaar, 'SENT_RAW');
  assert.equal(fieldFates(SAMPLE_PROFILE, run(SAMPLE_PROFILE, { consent: { bureau: true } }).plan).pan, 'SENT_RAW');
});

test('strict mode spends epsilon, memoises repeats, and exhaustion withholds the score', () => {
  const budget = new PrivacyBudget(12);
  const first = run(SAMPLE_PROFILE, { epsilon: 2, budget, seed: 5 });
  assert.equal(first.local.epsilonSpent, 10); // 5 features x ε=2
  const again = run(SAMPLE_PROFILE, { epsilon: 2, budget, seed: 99 });
  assert.equal(again.local.epsilonSpent, 0); // memoised: same noisy answers, no new spend
  assert.deepEqual(again.local.released, first.local.released);

  const other = { ...SAMPLE_PROFILE, monthlyIncome: 20000, monthlyEmi: 15000 };
  const starved = run(other, { epsilon: 2, budget, seed: 3 });
  assert.ok(starved.local.withheld.length > 0);
  const byId = Object.fromEntries(starved.plan.map((e) => [e.id, e]));
  assert.equal(byId.risk_score.decision, 'BLOCKED_UPSTREAM');
  assert.ok(!starved.payload.ops.includes('risk_score'));
});

test('offline run produces a provisional local score and a queueable payload without PAN', () => {
  const { local, payload, plan } = run(SAMPLE_PROFILE, {
    network: { online: false, rttMs: Infinity }, consent: { bureau: true },
  });
  assert.ok(local.provisional && local.provisional.score >= 300);
  assert.ok(payload.ops.includes('risk_score') && payload.ops.includes('region_check'));
  assert.ok(!payload.ops.includes('bureau_lookup'));
  assert.ok(!('pan' in payload.features));
  assert.equal(plan.find((e) => e.id === 'risk_score').decision, 'LOCAL_FALLBACK');
});

test('reconstruct merges server answer with exact on-device values', () => {
  const { local } = run(SAMPLE_PROFILE);
  const server = scoreDerived(run(SAMPLE_PROFILE).payload.features);
  const r = reconstruct(server, SAMPLE_PROFILE, local.exact);
  assert.equal(r.localDetail.dtiPct, 14.1);
  assert.equal(r.localDetail.ageYears, 32);
  assert.equal(r.decision, server.decision);
});

test('payload validation: allowlist, consent gate, PII tripwire, no value echo', () => {
  const good = run(SAMPLE_PROFILE).payload;
  const extra = { ...good, features: { ...good.features, monthlyIncome: 85000 } };
  const r1 = validatePayload(extra);
  assert.ok(!r1.ok);
  assert.ok(!JSON.stringify(r1.errors).includes('85000'));
  assert.ok(!validatePayload({ ...good, features: { ...good.features, pan: 'ABCDE1234F' } }).ok); // no consent
  assert.ok(!validatePayload({ ...good, features: { ...good.features, notes_redacted: 'call 9876543210' } }).ok);
  assert.ok(!validatePayload({ ...good, extra: 1 }).ok);
  assert.ok(!validatePayload({ ...good, features: { ...good.features, dti_band: '0.14' } }).ok);
});

test('audit ledger: hash chain verifies and detects tampering', async () => {
  const l = new AuditLedger();
  await l.append('PLAN', { a: 1 });
  await l.append('TRANSMIT', { bytes: 500 });
  await l.append('RESULT', { decision: 'X' });
  assert.deepEqual(await l.verify(), { ok: true, length: 3 });
  l.entries[1].detail.bytes = 5;
  assert.deepEqual(await l.verify(), { ok: false, brokenAt: 1 });
});
