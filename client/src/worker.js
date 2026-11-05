// Local-compute worker. The raw profile is posted here and only derived values come back out; the main
// thread never needs the sensitive computation. Everything in executeLocal is pure apart from the budget.
import { executeLocal, PrivacyBudget, secureRng } from '@datashadow/core';

self.onmessage = (ev) => {
  const { id, profile, plan, epsilon, budgetSnap, now } = ev.data;
  try {
    const budget = PrivacyBudget.from(budgetSnap);
    const out = executeLocal(profile, plan, { budget, epsilon, rng: secureRng(), now: new Date(now) });
    self.postMessage({ id, ok: true, out });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
};
