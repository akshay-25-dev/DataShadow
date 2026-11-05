export function Segmented({ label, value, onChange, options }) {
  return (
    <div className="seg">
      <span className="seg-label">{label}</span>
      <div
        className="seg-opts" role="radiogroup" aria-label={label}
        style={{ '--n': options.length, '--i': Math.max(0, options.findIndex((o) => o.value === value)) }}
      >
        <span className="thumb" aria-hidden="true" />
        {options.map((o) => (
          <button
            key={o.value} type="button" role="radio" aria-checked={value === o.value}
            className={value === o.value ? 'on' : ''} title={o.hint} onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-box" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
