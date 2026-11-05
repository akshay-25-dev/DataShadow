// In-memory "what the server actually received" log, keyed by session. Powers the inspector's right pane.
// Deliberately NOT a database: DataShadow's point is that the server holds almost nothing sensitive.
// A Mongo adapter can implement the same three methods (add/list/clear) later.
export class MemoryStore {
  constructor({ perSession = 25, maxSessions = 500 } = {}) {
    this.perSession = perSession;
    this.maxSessions = maxSessions;
    this.m = new Map();
  }

  add(session, rec) {
    let list = this.m.get(session);
    if (!list) {
      if (this.m.size >= this.maxSessions) this.m.delete(this.m.keys().next().value);
      list = [];
      this.m.set(session, list);
    }
    list.push(rec);
    if (list.length > this.perSession) list.shift();
  }

  list(session) { return [...(this.m.get(session) ?? [])].reverse(); }

  clear(session) { this.m.delete(session); }
}
