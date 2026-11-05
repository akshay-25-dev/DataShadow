// Local differential privacy for released *bands*, plus a per-device privacy budget.
//
// Mechanism: k-ary randomized response (k = number of bands). Keep the true band with
// probability e^ε / (e^ε + k - 1), otherwise report one of the other k-1 bands uniformly.
// This satisfies ε-local-DP for that single released value. Total privacy loss across
// released values is tracked with basic sequential composition (sum of ε).
//
// Repeat releases of the same true value reuse the first noisy answer (memoisation), so
// re-submitting the same form can't be averaged to cancel the noise.
export class BudgetExceededError extends Error {}

export class PrivacyBudget {
  constructor(total, spent = 0, ledger = [], memo = {}) {
    this.total = total;
    this.spent = spent;
    this.ledger = ledger;
    this.memo = memo;
  }
  get remaining() { return Math.max(0, this.total - this.spent); }
  canSpend(eps) { return this.spent + eps <= this.total + 1e-9; }
  spend(eps, label) {
    if (!this.canSpend(eps)) {
      throw new BudgetExceededError(`need ε=${eps}, have ${this.remaining.toFixed(2)}`);
    }
    this.spent += eps;
    this.ledger.push({ label, epsilon: eps, at: Date.now() });
  }
  snapshot() {
    return {
      total: this.total, spent: this.spent,
      ledger: this.ledger.slice(-100), memo: { ...this.memo },
    };
  }
  static from(s) { return new PrivacyBudget(s.total, s.spent, [...(s.ledger ?? [])], { ...(s.memo ?? {}) }); }
}

export function randomizedResponse(labels, trueLabel, epsilon, rng) {
  const k = labels.length;
  const trueIdx = labels.indexOf(trueLabel);
  if (trueIdx < 0) throw new Error(`Unknown label ${trueLabel}`);
  const pTrue = Math.exp(epsilon) / (Math.exp(epsilon) + k - 1);
  if (rng() < pTrue) return trueLabel;
  let j = Math.floor(rng() * (k - 1));
  if (j >= trueIdx) j++;
  return labels[j];
}

/** RNG over (0,1) backed by the platform CSPRNG (browser, worker, Node). */
export function secureRng() {
  const buf = new Uint32Array(1);
  return () => {
    globalThis.crypto.getRandomValues(buf);
    return (buf[0] + 0.5) / 4294967296;
  };
}

/** Deterministic RNG for tests and the eval script (mulberry32). */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
}
