const NAMES = {
  PLAN: 'Planned', LOCAL_COMPUTE: 'Computed on device', TRANSMIT: 'Sent to server', RESULT: 'Result received',
  QUEUED: 'Queued while offline', SYNC: 'Synced from queue', REJECTED: 'Server rejected request',
  TRANSMIT_RAW: 'Sent everything (traditional)', RUN_FAILED: 'Run failed',
};
const summary = (d) => {
  const s = JSON.stringify(d);
  return s.length > 96 ? `${s.slice(0, 93)}…` : s;
};

export default function LedgerPanel({ entries, chain, onTamper, tampered, onReset }) {
  const shown = entries.slice(-8).reverse();
  return (
    <section className="card" aria-labelledby="l-h">
      <header className="card-head">
        <div>
          <h2 id="l-h">Audit trail</h2>
          <p className="cap">Each entry is sealed with the one before it (SHA-256). It records what left the device, never the values.</p>
        </div>
        {chain && (
          <span className={`tag ${chain.ok ? 'teal' : 'red'}`} role="status">
            {chain.ok ? `Chain intact, ${chain.length} entries` : `Chain broken at entry ${chain.brokenAt}`}
          </span>
        )}
      </header>
      {shown.length === 0 ? (
        <div className="empty"><strong>No entries yet</strong><p>Every check adds a few sealed entries here.</p></div>
      ) : (
        <ol className="ledger">
          {shown.map((e) => (
            <li key={e.seq} className={chain && !chain.ok && e.seq === chain.brokenAt ? 'broken' : ''}>
              <span className="l-seq num">{e.seq}</span>
              <span className="l-body">
                <strong>{NAMES[e.type] ?? e.type}</strong>
                <span className="l-detail num">{summary(e.detail)}</span>
              </span>
              <code className="l-hash">{e.hash.slice(0, 8)}</code>
            </li>
          ))}
        </ol>
      )}
      <div className="btn-row end">
        <button type="button" className="btn quiet" onClick={onTamper} disabled={entries.length < 2}>
          {tampered ? 'Undo tampering' : 'Try tampering with history'}
        </button>
        <button type="button" className="btn quiet" onClick={onReset}>Clear everything</button>
      </div>
    </section>
  );
}
