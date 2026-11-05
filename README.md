# DataShadow Web

**Hackathon track:** SNH-WD-03, Zero-Trust Personal Data Architecture.
A browser-first web app that **classifies sensitive fields, decides per computation whether to run locally or remotely, transforms data before it leaves the device, and still returns a useful result** — while the server only ever sees a minimal, privacy-preserving representation.

Demo domain: **loan pre-eligibility** (all data is synthetic).

## The problem

Most web apps post the whole user profile to a server "because that's where the code runs". For a loan check that means Aadhaar, PAN, phone, income and card balances all land in a database that now needs to be protected, audited and disclosed under the DPDP Act. DataShadow challenges the assumption: the server needs a **score**, not a **profile**.

## Run it

```bash
npm install
npm run dev        # API on :8788, client on :5174
npm test           # core (34) + server (9) tests
npm run eval       # privacy-vs-accuracy numbers -> docs/eval-results.json
npm run build && npm start   # one process serves API + built client on :8788
```

Requires Node 20+.

## Deploy

One process serves the API and the built client, so there is one URL to share.

- **Render (free):** push this folder to GitHub, then in Render choose New, Blueprint, and select the repo. `render.yaml` sets the build and start commands. The free tier sleeps when idle, so open the link once before a demo.
- **Docker:** `docker build -t datashadow . && docker run -p 8788:8788 datashadow`.
- **Any Node host:** `npm ci && npm run build && npm start`, with the `PORT` environment variable set if the host requires it.

The demo-only route `/api/score-traditional` exists to show the leaky baseline. Keep it only on a demo deployment.

A recorded walkthrough and judge Q&A are in `docs/DEMO.md`.

## In the UI

- **Result** card: what share of sensitive bytes was sent as typed (traditional vs DataShadow) and the decision.
- **How the score is worked out**: base 600 plus the points each factor added, next to the band the server actually saw, and the score a traditional app would get from exact values.
- **What privacy costs in accuracy**: the evaluation results below, charted. `npm run eval` also refreshes `client/src/data/eval-results.json`, which this panel reads.

## How it works

```
 raw profile ──► classifier ──► policy engine ──► planner ──► local compute (Web Worker)
 (never leaves)   field+value     per-field rule    LOCAL or       bands / redaction / optional ε-LDP
                  + text scan     (R1…R7)           REMOTE?                 │
                                                                            ▼
 result ◄── reconstruct on device ◄── server scores BANDS ◄── allow-listed minimal payload
 (exact DTI, EMI computed locally)   (never raw data)         (+ hash-chained audit entry)
```

| Requirement | Where |
|---|---|
| Identify sensitive fields | `packages/core/src/classifier.js`: name + value signals, Verhoeff-validated Aadhaar, PAN/phone/email regexes, free-text PII scan |
| Classify computation | `computations.js`: each computation declares inputs, whether it can run on either side, and cost |
| Decide local vs remote | `planner.js`: hard constraints from policy/consent/connectivity, then a weighted cost score; every decision carries reasons and the rejected alternative |
| Transform before transmission | `transforms.js` (bands, PIN prefix, redaction), `privacy.js` (k-ary randomized response, ε budget) |
| Work under restricted connectivity | provisional on-device score, deferred queue of derived-only payloads, auto-sync on reconnect |
| Reconstruct results without raw data | `pipeline.js#reconstruct`: server returns a band-based decision; exact figures are recomputed locally |
| Audit | `audit.js`: SHA-256 hash-chained ledger of what left the device |

### Policy (`policy.js`)

| Rule | Data | Action |
|---|---|---|
| R1 | Aadhaar | never transmitted |
| R2 | PAN | only with explicit consent, only for bureau lookup |
| R3 | name, phone, email | never transmitted |
| R4 | date of birth | age band only |
| R5 | PIN code | 3-digit prefix only |
| R6 | income, EMIs, card figures | bands only |
| R7 | free text containing PII | redacted |

The **server enforces an allowlist** (`payload.js`): any field not named there is rejected with HTTP 422, so a client bug cannot leak extra data. Rejected payloads are logged as keys and error text only, never values.

### Demo controls

- **Architecture:** Traditional vs DataShadow, with a live leakage meter and the exact JSON the server stored.
- **Network:** Online / Slow / Offline. Slow flips the eligibility score to a provisional on-device result; Offline queues a derived-only payload.
- **Privacy:** Standard (bands) or Strict (bands plus ε-local-DP with a visible budget).
- **Consent:** ticking it sends PAN raw (flagged red, audited) and the meter moves.
- **Simulate tampering:** edits a past ledger entry and shows the chain break.

## Results (`npm run eval`, 3000 synthetic applicants, seeded)

| | Traditional | DataShadow |
|---|---|---|
| Sensitive fields sent raw (avg) | 10.1 | **0** |
| Sensitive bytes sent raw (avg) | 119 B | **0 B** |
| Payload size (avg) | 378 B | 365 B |

Payload size is **not** reduced meaningfully: this profile is small. The win is *what* is in the payload, not how big it is.

Decision agreement with the raw-data model:

| Mode | ε / feature | Agreement | Mean score error |
|---|---|---|---|
| Bands only | none | 85.1% | 18.8 pts |
| Strict | 8 | 84.7% | 19.0 |
| Strict | 4 | 77.7% | 29.6 |
| Strict | 2 | 55.3% | 64.4 |
| Strict | 1 | 43.6% | 86.2 |

**Read this honestly.** Banding alone changes ~15% of decisions versus a model with exact inputs (4.9% false approvals, 1.7% false declines). Local differential privacy on a *single applicant's* five features is expensive: at ε=2 per feature (the UI's Strict default) agreement falls to 55%. Both are real trade-offs of the approach, not bugs; the levers are finer bands (less minimisation, more accuracy) or a larger ε. A production system would also add central/shuffle DP or secure aggregation, which this prototype does not implement.

## Threat model

**Protects against:** a curious or breached server/database, server logs, third-party analytics on the server side, and accidental over-collection by client code (server allowlist).

**What the server still learns:** five bands, employment type, loan amount and tenure, a 3-digit PIN prefix, redacted notes, and a session ID. Bands are quasi-identifiers; combined with other data they can narrow identity. The PIN prefix plus age band plus income band is far less identifying than the raw profile but **not anonymous**.

**Out of scope:** a compromised browser or device, malicious extensions, network metadata (IP, timing, payload size), and a malicious client lying about its inputs (the server cannot verify bands were computed honestly; that would need attestation or ZK proofs, which are **not** implemented).

**Consented PAN:** when the user consents, PAN is sent raw over TLS. This is a deliberate, audited exception, not privacy-preserving.

**Simulated parts:** the credit-bureau response is a deterministic function of the PAN, not a real bureau call.

**Storage:** the raw profile is never written to localStorage. Persisted on device: privacy budget (with its memoised noisy releases), the audit ledger, and queued *derived-only* payloads. A raw identifier is never queued; consented bureau lookups are not deferred when offline.

## Privacy mechanisms, briefly

- **Banding** is the main data minimisation: the server's model only needs bands, so nothing finer is sent.
- **k-ary randomized response** (Strict mode): keep the true band with probability e^ε/(e^ε+k−1), otherwise report a uniformly random other band. This is ε-local-DP per released value; the budget uses basic sequential composition (sum of ε). Repeat releases of the same true value reuse the first noisy answer, so resubmitting can't average the noise away.

## Third-party technologies disclosed

React 18, Vite 5, Express 4, Playwright (used only to test the UI during development), Node.js built-in test runner and WebCrypto. **No external AI models, APIs or datasets are used at runtime**; the classifier, planner and privacy mechanisms are rule-based and live in `packages/core`. Synthetic applicants are generated by `packages/core/src/synthetic.js`. AI-assisted development (Claude) was used to scaffold this codebase.

## Layout

```
packages/core   isomorphic logic (classifier, policy, planner, privacy, audit, model) + tests
server          Express API (/api/score allowlist, /api/score-traditional baseline, /api/received)
client          React inspector UI, Web Worker for local compute, offline queue
scripts/eval.js seeded evaluation
docs/           eval-results.json
```

`/api/score-traditional` exists only to show the baseline in the demo; never enable it in a real deployment.

## Roadmap

1. Finer-grained / adaptive bands and an accuracy-vs-minimisation slider.
2. Evaluation tab in the UI (chart of the table above).
3. Mongo-backed store (the `MemoryStore` interface is three methods).
4. transformers.js NER as a second-opinion classifier for free text.
5. Deploy and record the 2-minute demo.
