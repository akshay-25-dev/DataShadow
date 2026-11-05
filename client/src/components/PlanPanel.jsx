const PILL = {
  LOCAL: ['On your device', 'teal'],
  PASSTHROUGH: ['Sent as typed', 'plain'],
  REMOTE: ['On the server', 'indigo'],
  REMOTE_TRANSFORMED: ['Server, reduced first', 'indigo'],
  REMOTE_CONSENTED: ['Server, raw with consent', 'red'],
  LOCAL_FALLBACK: ['Device, provisional', 'amber'],
  DEFERRED: ['Queued for later', 'amber'],
  BLOCKED_CONSENT: ['Blocked, no consent', 'plain'],
  BLOCKED: ['Blocked', 'red'],
  BLOCKED_UPSTREAM: ['Blocked, missing input', 'red'],
  BLOCKED_BUDGET: ['Blocked, budget spent', 'red'],
  WITHHELD: ['Withheld by policy', 'plain'],
};

function plainWhy(e) {
  switch (e.decision) {
    case 'LOCAL':
      return e.kind === 'redact'
        ? 'Phone numbers, PAN and similar details in your notes are blanked out before anything is sent.'
        : 'Needs your exact figures, so it runs here. Only a coarse band can leave.';
    case 'PASSTHROUGH': return 'Low-risk details the lender needs, so they are sent as typed.';
    case 'REMOTE_TRANSFORMED': return 'Needs data only the server has, so just the first 3 digits of your PIN code are sent.';
    case 'REMOTE_CONSENTED': return 'You allowed it. Your PAN is sent as typed and the audit trail records it.';
    case 'REMOTE': return 'The server only receives bands, never your raw data.';
    case 'LOCAL_FALLBACK': return 'The server is slow or unreachable, so a provisional answer is worked out here.';
    case 'DEFERRED': return 'You are offline. This is queued and sent when you reconnect.';
    case 'BLOCKED_CONSENT': return 'Needs your PAN. Tick "Allow bureau lookup" to permit it.';
    default: return e.reasons[0];
  }
}

// Collapse the three low-risk pass-through fields into one row to keep the list short.
function groupRows(plan) {
  const rows = [];
  let merged = null;
  for (const e of plan) {
    if (e.decision === 'PASSTHROUGH') {
      if (!merged) {
        merged = { ...e, id: 'passthrough', label: 'Loan amount, tenure and employment', options: {}, reasons: [e.reasons[0]] };
        rows.push(merged);
      }
    } else rows.push(e);
  }
  return rows;
}

function Option({ name, o }) {
  if (!o) return null;
  return (
    <tr>
      <td>{name}</td>
      <td>{o.feasible ? 'possible' : 'ruled out'}</td>
      <td className="num">{o.score ?? '–'}</td>
      <td className="num">{o.latencyMs != null ? `${o.latencyMs} ms` : '–'}</td>
    </tr>
  );
}

export default function PlanPanel({ plan, mode, stale, budget, strict, network }) {
  const pct = Math.min(100, (budget.spent / budget.total) * 100);
  return (
    <section className="card plan-card" aria-labelledby="pl-h">
      <header className="card-head">
        <div>
          <h2 id="pl-h">Where each calculation runs</h2>
          <p className="cap">
            {mode === 'traditional'
              ? 'No planner here. The traditional flow sends the whole profile to the server.'
              : `A rulebook plus a cost check decides, per calculation, between your device and the server. ${network.online ? `Network: about ${Math.round(network.rttMs)} ms away.` : 'Network: offline.'}`}
          </p>
        </div>
        {mode === 'datashadow' && stale && <span className="tag amber">Preview. Press Check eligibility.</span>}
      </header>

      {mode === 'datashadow' && (
        <>
          <ol className="plan">
            {groupRows(plan).map((e) => {
              const [text, tone] = PILL[e.decision] ?? [e.decision, 'plain'];
              return (
                <li key={e.id}>
                  <details>
                    <summary>
                      <span className="p-main">
                        <span className="p-name">{e.label}</span>
                        <span className="p-why">{plainWhy(e)}</span>
                      </span>
                      <span className={`tag ${tone}`}>{text}</span>
                    </summary>
                    <div className="p-body">
                      <p className="p-tech">Technical detail</p>
                      <ul>{e.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                      {(e.options.local || e.options.remote) && (
                        <table className="opts">
                          <thead><tr><th>Option</th><th>Status</th><th>Cost score</th><th>Time</th></tr></thead>
                          <tbody>
                            <Option name="Your device" o={e.options.local} />
                            <Option name="Server" o={e.options.remote} />
                          </tbody>
                        </table>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
          {strict && (
            <div className="budget">
              <div className="b-top"><span>Privacy budget spent (ε)</span><span className="num">{budget.spent.toFixed(1)} of {budget.total}</span></div>
              <div className="meter"><span className="indigo" style={{ width: `${pct}%` }} /></div>
              <p className="cap">Strict mode adds random noise to each band. Every new band released spends some budget.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
