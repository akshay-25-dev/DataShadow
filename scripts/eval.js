// Evaluation: how much does DataShadow leak, how big are payloads, and what does privacy cost in accuracy?
// Deterministic (seeded). Run: npm run eval
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  generateProfile, seededRng, classifyProfile, DEFAULT_POLICY, makeContext, planAll, executeLocal, buildPayload,
  measurePayload, computeExactFeatures, scoreRaw, scoreDerived, FEATURES, bucketLabel, clamp, randomizedResponse,
  PrivacyBudget, payloadBytes, normalizeProfile,
} from '@datashadow/core';

const N = 3000;
const NOW = new Date('2026-11-04T00:00:00Z');
const EPSILONS = [Infinity, 8, 4, 2, 1, 0.5];
const rng = seededRng(20261104);
const profiles = Array.from({ length: N }, () => generateProfile(rng));

// ---- 1. leakage + payload size (Standard mode) --------------------------------------------------------
let tradBytes = 0; let dsBytes = 0; let tradExposed = 0; let dsExposed = 0; let tradSens = 0; let dsSens = 0;
for (const p of profiles) {
  const cls = classifyProfile(p);
  const norm = normalizeProfile(p);
  const t = measurePayload({ profile: norm }, norm, cls);
  tradBytes += t.totalBytes; tradExposed += t.exposedFields.length; tradSens += t.exposedBytes;
  const plan = planAll(makeContext({ classifications: cls, policy: DEFAULT_POLICY }));
  const local = executeLocal(p, plan, { budget: new PrivacyBudget(1e9), rng, now: NOW });
  const payload = buildPayload(p, plan, local.released, { session: 'eval-session-0001' });
  const d = measurePayload(payload, norm, cls);
  dsBytes += payloadBytes(payload); dsExposed += d.exposedFields.length; dsSens += d.exposedBytes;
}
const leakage = {
  profiles: N,
  traditional: { avgPayloadBytes: +(tradBytes / N).toFixed(0), avgSensitiveFieldsExposed: +(tradExposed / N).toFixed(2), avgSensitiveBytesExposed: +(tradSens / N).toFixed(0) },
  datashadow: { avgPayloadBytes: +(dsBytes / N).toFixed(0), avgSensitiveFieldsExposed: +(dsExposed / N).toFixed(2), avgSensitiveBytesExposed: +(dsSens / N).toFixed(0) },
};

// ---- 2. privacy vs accuracy ---------------------------------------------------------------------------
const truth = profiles.map((p) => scoreRaw(computeExactFeatures(p, NOW)));
const accuracy = EPSILONS.map((eps) => {
  const r = seededRng(7 + (Number.isFinite(eps) ? eps * 1000 : 0));
  let agree = 0; let absDiff = 0; let flippedToApprove = 0; let flippedToDecline = 0;
  profiles.forEach((p, i) => {
    const exact = computeExactFeatures(p, NOW);
    const d = { employment_type: p.employmentType };
    for (const [name, spec] of Object.entries(FEATURES)) {
      const label = bucketLabel(clamp(exact[name], spec.clip[0], spec.clip[1]), spec.edges, spec.labels);
      d[spec.key] = Number.isFinite(eps) ? randomizedResponse(spec.labels, label, eps, r) : label;
    }
    const s = scoreDerived(d);
    if (s.decision === truth[i].decision) agree++;
    else if (s.decision === 'LIKELY_APPROVE') flippedToApprove++;
    else if (s.decision === 'LIKELY_DECLINE') flippedToDecline++;
    absDiff += Math.abs(s.score - truth[i].score);
  });
  return {
    epsilonPerFeature: Number.isFinite(eps) ? eps : 'banding only',
    epsilonPerRequest: Number.isFinite(eps) ? eps * Object.keys(FEATURES).length : 0,
    decisionAgreementPct: +((100 * agree) / N).toFixed(1),
    meanAbsScoreError: +(absDiff / N).toFixed(1),
    falseApprovePct: +((100 * flippedToApprove) / N).toFixed(1),
    falseDeclinePct: +((100 * flippedToDecline) / N).toFixed(1),
  };
});

const decisions = truth.reduce((m, t) => ({ ...m, [t.decision]: (m[t.decision] ?? 0) + 1 }), {});
const results = { seed: 20261104, leakage, decisionMix: decisions, accuracy };
mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
const out = `${JSON.stringify(results, null, 2)}\n`;
writeFileSync(new URL('../docs/eval-results.json', import.meta.url), out);
mkdirSync(new URL('../client/src/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../client/src/data/eval-results.json', import.meta.url), out); // the in-app Evaluation panel reads this copy

console.log(`\nLeakage over ${N} synthetic applicants`);
console.table({ Traditional: leakage.traditional, DataShadow: leakage.datashadow });
console.log('Ground-truth decision mix:', decisions);
console.log('\nPrivacy vs accuracy (decision vs the raw-data model)');
console.table(accuracy);
