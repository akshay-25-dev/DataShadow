// Append-only, hash-chained audit ledger: every entry commits to the previous one, so editing or
// deleting any past entry breaks verification of everything after it. Works in browsers, workers and Node.
const enc = new TextEncoder();
export const GENESIS = '0'.repeat(64);

export async function sha256Hex(s) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

export class AuditLedger {
  constructor(entries = []) { this.entries = entries; }

  async append(type, detail = {}) {
    const prev = this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS;
    const seq = this.entries.length ? this.entries[this.entries.length - 1].seq + 1 : 0;
    const ts = new Date().toISOString();
    const hash = await sha256Hex(stableStringify({ seq, ts, type, detail, prev }));
    const entry = { seq, ts, type, detail, prev, hash };
    this.entries.push(entry);
    return entry;
  }

  async verify() {
    let prev = this.entries[0]?.prev ?? GENESIS;
    for (const e of this.entries) {
      const h = await sha256Hex(stableStringify({ seq: e.seq, ts: e.ts, type: e.type, detail: e.detail, prev: e.prev }));
      if (e.prev !== prev || h !== e.hash) return { ok: false, brokenAt: e.seq };
      prev = e.hash;
    }
    return { ok: true, length: this.entries.length };
  }
}
