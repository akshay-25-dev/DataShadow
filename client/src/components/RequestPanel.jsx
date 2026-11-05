function JsonView({ value, flagKeys = [] }) {
  const lines = JSON.stringify(value, null, 2).split('\n');
  return (
    <pre className="json" tabIndex={0} aria-label="Request body stored by the server">
      {lines.map((l, i) => {
        const m = /^(\s*)"([^"]+)":(.*)$/.exec(l);
        if (!m) return <div key={i}>{l}</div>;
        return (
          <div key={i} className={flagKeys.includes(m[2]) ? 'flag' : ''}>
            {m[1]}<span className="jk">"{m[2]}"</span>:{m[3]}
          </div>
        );
      })}
    </pre>
  );
}

export default function RequestPanel({ record, flagKeys, queued }) {
  return (
    <section className="card" aria-labelledby="r-h">
      <header className="card-head">
        <div>
          <h2 id="r-h">The exact request the server stored</h2>
          <p className="cap">Read back from the server's own log, not from this page. Highlighted lines are sensitive data sent as typed.</p>
        </div>
        {record && !record.rejected && <span className="tag plain num">{record.bytes} bytes</span>}
      </header>
      {record ? (
        record.rejected ? (
          <div className="empty err" role="alert">
            <strong>The server rejected this request (HTTP 422)</strong>
            <ul>{record.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        ) : (
          <JsonView value={record.body} flagKeys={flagKeys} />
        )
      ) : (
        <div className="empty">
          <strong>{queued ? 'Nothing was sent' : 'Nothing received yet'}</strong>
          <p>{queued ? 'You are offline. The request is queued on this device.' : 'Check eligibility to see the request body here.'}</p>
        </div>
      )}
    </section>
  );
}
