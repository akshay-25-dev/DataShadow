# DataShadow: 2-minute demo script and judge Q&A

Record at 1080p, browser zoomed to 100%, window about 1440 wide. Use the sample applicant (Aarav Mehta) and do a
dry run first. Everything below is clickable in the app; nothing is faked.

## Before you hit record
- Reload the page. Privacy level: Standard. Connection: Online. "Allow bureau lookup" unticked.
- Clear the audit trail (Clear everything), so the log starts clean.
- Close other tabs and notifications.

## Script (about 2:00)

| Time | On screen | Say |
|---|---|---|
| 0:00 | Top of the page | "Loan apps ask for your Aadhaar, PAN and income just to tell you whether you are eligible. Once they have it, you cannot take it back. DataShadow checks eligibility without the server ever seeing those values." |
| 0:15 | Switch **How it is processed** to **Traditional**, press **Check eligibility** | "First, how a normal app works. Everything is posted as typed." Point at the red **100%**: "12 of 12 sensitive fields were sent." Scroll to **The exact request the server stored** and point at the highlighted lines: "This is read back from the server's own log, not from this page." |
| 0:40 | Switch to **DataShadow**, press **Check eligibility** | "Same applicant, same form." Point at the right-hand column: "The server sees *Not sent* for Aadhaar, PAN, phone and email, and only coarse bands such as *EMI share under 20%* for the numbers." Point at **0%**. |
| 1:00 | Scroll to **Where each calculation runs** | "A rulebook plus a cost check decides, per calculation, whether it runs here or on the server. Anything needing exact figures runs on this device. The server only gets what it truly needs." |
| 1:15 | Scroll to **How the score is worked out** | "The score is not a black box. It starts at 600, and each band adds or removes points. 802 here, against 803 if the server had seen the exact numbers." |
| 1:30 | Set **Connection** to **Offline**, press **Check eligibility**, then set it back to **Online** | "No network. Nothing leaves the device. The request is queued with derived values only, and it sends itself when we reconnect." |
| 1:45 | Scroll to **Audit trail**, press **Try tampering with history** | "Every step is hash-chained. Edit one entry and the chain breaks, so tampering is detectable." |
| 1:55 | Scroll to **What privacy costs in accuracy** | "Over 3,000 synthetic applicants: 10 sensitive fields leaked per request in a traditional app, zero with DataShadow, and 85% of decisions identical to the exact-value score. We show the accuracy cost of Strict mode honestly too." |

Tip: do the offline step with the bureau box unticked, so the queue contains only derived bands.

## Numbers you can quote (all reproducible with `npm run eval`)
- 3,000 seeded synthetic applicants. Traditional exposes 10.13 sensitive fields per request on average; DataShadow 0.
- Request size: 378 bytes traditional vs 365 bytes DataShadow.
- Decision agreement with the exact-value score: 85.1% with bands only, 84.7% at ε=8, 77.7% at ε=4, 55.3% at ε=2, 43.6% at ε=1.
- Leak % in the app = bytes of sensitive values found in the request ÷ total bytes of the sensitive values. With the bureau box ticked the PAN is sent as typed (10 of 164 bytes = 6.1%), and the app says so.

## Likely judge questions
**Is this real privacy or just hiding fields?**
Both layers are enforced. The client sends only an allowlisted payload; the server rejects anything else with HTTP 422 and never echoes values back. The leak meter checks the real request body for sensitive values, including ones hidden inside free text.

**What does Strict mode do, and why is accuracy lower?**
It adds local differential privacy (k-ary randomized response) to each band, so even the bands are noisy. Smaller ε means stronger privacy and more flipped bands. We chart that trade-off rather than hide it.

**What if the user's browser or an extension is compromised?**
Out of scope: if the device is compromised, the data is exposed. The design protects against an over-collecting or breached server and against network observers. This is stated in the README threat model.

**Why rules and not machine learning?**
The track rewards explainable decisions and the hackathon has a policy on AI and third-party tools, so we disclose everything. The classifier, policy, planner and scorer are deterministic and tested, and no external AI service runs at runtime.

**Why not homomorphic encryption or MPC?**
They are heavy for a browser-first, intermittent-connectivity setting. Banding plus on-device computation gives most of the benefit with tiny payloads. They are a natural roadmap item for scores that need exact values.

**What happens with no connection?**
The planner marks remote-only steps as deferred, the device computes a provisional result, a derived-only request is queued, and raw identifiers are never queued.

**Is the score a real credit score?**
No. It is a transparent pre-eligibility model used to demonstrate the architecture. The bureau lookup is simulated, and the README says so.

## Submission checklist
- [ ] Live link opens and the sample run works (see "Deploy" in the README).
- [ ] Demo video under the time limit, link works without login.
- [ ] Repository public, README renders, CI passes.
- [ ] Third-party technologies and AI-tool use disclosed (README section).
- [ ] Run `npm test` and `npm run eval` once more on a clean checkout.
