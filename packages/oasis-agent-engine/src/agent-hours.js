// ░▒▓ AGENT HOURS — the engine books the agents' working time in the Mindcraft work book ▓▒░
// The owner (2026-11-20) asked whether he can close the Oasis window when he is away. Until now the open page
// relayed each turn's end to /api/village/work, so with no Oasis tab open (or one the browser had slowed down),
// the agents' hours stopped or thinned out. The engine sees every turn and every helper start and end, so it
// books them itself; the page only shows them. His own hours stay counted by the page: they are about him
// being there.
//
// What an agent-hour is (same rule as the page used, src/lib/village/work-vow.ts in the Oasis):
//   a turn's length (the CLI's duration_ms) minus the time it only waited on its own foreground helpers (helpers
//   at once are one wait), plus each helper's running time in full, booked under its parent. A background helper
//   (the default) is not waited on: the parent works on beside it, and both count (27 Nov: a background upload
//   had cut the parent's own work out of its turn).
//   Time spent waiting on the owner is never work (Anorak, 27 Nov: the Innkeeper sat 7.2 hours on one unanswered
//   permission prompt and the book counted it): from a permission request (a tool to allow, a question, a plan)
//   to its answer or cancel, the wait is cut out of whoever waits: the agent's own turn, or the one helper whose tool
//   asked (known from the tool's parent). A helper running on its own never stops for the parent's question.
// Reports go in small batches; one that fails is kept and sent with the next (bounded). The work book books
// each (agent, kind, time) once, so a report that also arrives from an older page is not counted twice.

/** Own time in a turn: its length minus the union of the spans (helpers, waits on the owner) inside it. */
export function ownTurnMs(durationMs, endTs, helpers) {
  const from = endTs - durationMs;
  const spans = helpers
    .map((h) => [Math.max(from, h.start), Math.min(endTs, h.end ?? endTs)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let waited = 0;
  let cursor = from;
  for (const [a, b] of spans) {
    if (b <= cursor) continue;
    waited += b - Math.max(a, cursor);
    cursor = b;
  }
  return Math.max(0, durationMs - waited);
}

const MAX_QUEUE = 2000;

export class AgentHours {
  /**
   * @param {{ webUrl?: string, headers?: () => Record<string,string>, fetch?: typeof fetch, flushMs?: number,
   *           heartbeatMs?: number, log?: (...a: any[]) => void, enabled?: boolean }} o
   */
  constructor(o = {}) {
    this.webUrl = (o.webUrl || process.env.OASIS_WEB_URL || 'http://127.0.0.1:4516').replace(/\/+$/, '');
    this.headers = o.headers || (() => ({}));
    this.fetch = o.fetch || ((...a) => fetch(...a));
    this.flushMs = o.flushMs ?? 3000;
    this.heartbeatMs = o.heartbeatMs ?? 5 * 60_000;
    this.log = o.log || (() => {});
    this.enabled = o.enabled !== false;
    /** agentId -> Map(helper id -> { start, end }) */
    this.spans = new Map();
    /** agentId -> Map(permission request id -> { start, end, helper }): waits on the owner's answer; helper = whose */
    this.waits = new Map();
    /** agentId -> Map(tool use id -> the helper's tool use id), for tools a helper calls */
    this.helperTools = new Map();
    this.queue = [];
    this.timer = null;
    this.beat = null;
    this.sending = false;
  }

  start() {
    if (!this.enabled || this.beat) return;
    // An empty report now and then tells the Oasis the engine is booking, so open pages stop relaying.
    this.beat = setInterval(() => this.flush(true), this.heartbeatMs);
    this.beat.unref?.();
    this.flush(true);
  }

  stop() {
    if (this.beat) clearInterval(this.beat);
    if (this.timer) clearTimeout(this.timer);
    this.beat = null;
    this.timer = null;
  }

  /** Every event the engine emits; `agent` is the agent it belongs to (for its session and name). */
  onEvent(event, agent) {
    if (!this.enabled || !event || !agent) return;
    const { kind, agentId, ts } = event;
    if (typeof ts !== 'number') return;
    if (kind === 'tool.start') {
      if (typeof event.parentToolUseId !== 'string' || !event.parentToolUseId || typeof event.toolUseId !== 'string') return;
      let tools = this.helperTools.get(agentId);
      if (!tools) this.helperTools.set(agentId, (tools = new Map()));
      tools.set(event.toolUseId, event.parentToolUseId);
      if (tools.size > 5000) tools.delete(tools.keys().next().value);
      return;
    }
    if (kind === 'permission.request' || kind === 'permission.resolved') {
      const id = event.requestId;
      if (typeof id !== 'string' || !id) return;
      let waits = this.waits.get(agentId);
      if (!waits) this.waits.set(agentId, (waits = new Map()));
      if (kind === 'permission.request') {
        // A page reload re-announces nothing here, but a repeat must not move the start: keep the first.
        const helper = (typeof event.toolUseId === 'string' && this.helperTools.get(agentId)?.get(event.toolUseId)) || null;
        if (!waits.has(id)) waits.set(id, { start: typeof event.askedAt === 'number' ? Math.min(event.askedAt, ts) : ts, end: null, helper });
      } else {
        const wait = waits.get(id);
        if (wait && wait.end === null) wait.end = ts;
      }
      return;
    }
    if (kind !== 'turn.end' && kind !== 'subagent.start' && kind !== 'subagent.end') return;
    const who = { key: agent.sessionId || agent.id || agentId, name: agent.name || agentId };
    let spans = this.spans.get(agentId);
    if (!spans) this.spans.set(agentId, (spans = new Map()));
    const waits = this.waits.get(agentId) || new Map();
    const ids = [event.toolUseId, event.taskId].filter((id) => typeof id === 'string' && id);
    if (kind === 'subagent.start') {
      // A resumed helper (SendMessage) starts a new span under the same id.
      if (ids[0]) spans.set(ids[0], { start: ts, end: null, other: ids[1] || null, background: event.background === true });
      return;
    }
    if (kind === 'subagent.end') {
      let span = null;
      for (const id of ids) span ||= spans.get(id) || [...spans.values()].find((s) => s.other === id) || null;
      let spanId = null;
      for (const [id, s] of spans) if (s === span) spanId = id;
      if (!span || span.end !== null) return;
      span.end = ts;
      // A helper counts in full, less any time it stood still on the owner's answer to its own tool.
      const own = [...waits.values()].filter((w) => w.helper && (w.helper === spanId || w.helper === span.other || ids.includes(w.helper)));
      this.push({ ...who, ts, kind: 'helper', ms: ownTurnMs(ts - span.start, ts, own) });
      for (const [id, w] of waits) if (own.includes(w) && w.end !== null) waits.delete(id);
      const tools = this.helperTools.get(agentId);
      if (tools) for (const [tool, parent] of tools) if (parent === spanId || ids.includes(parent)) tools.delete(tool);
      return;
    }
    if (!(event.durationMs > 0)) return;
    this.push({ ...who, ts, kind: 'turn', ms: ownTurnMs(event.durationMs, ts, [...[...spans.values()].filter((s) => !s.background), ...[...waits.values()].filter((w) => !w.helper)]) });
    // Helpers and waits that finished before this turn ended are done with.
    for (const [id, span] of spans) if (span.end !== null && span.end <= ts) spans.delete(id);
    for (const [id, wait] of waits) if (!wait.helper && wait.end !== null && wait.end <= ts) waits.delete(id);
  }

  push(report) {
    this.queue.push(report);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; this.flush(false); }, this.flushMs);
      this.timer.unref?.();
    }
  }

  /** Send what is queued (or an empty heartbeat). A failure keeps the reports for the next try. */
  async flush(heartbeat) {
    if (this.sending) return;
    if (!this.queue.length && !heartbeat) return;
    this.sending = true;
    const batch = this.queue.slice(0, 200);
    try {
      const response = await this.fetch(`${this.webUrl}/api/village/work`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.headers() },
        body: JSON.stringify({ agentWork: batch, source: 'engine' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.queue.splice(0, batch.length);
      // More than one batch waiting: the next goes right away.
      if (this.queue.length && !this.timer) {
        this.timer = setTimeout(() => { this.timer = null; this.flush(false); }, 0);
        this.timer.unref?.();
      }
    } catch (error) {
      if (batch.length) this.log(`agent hours: not booked yet (${error.message}); ${this.queue.length} waiting`);
      // A heartbeat that found no Oasis (the engine starts before the page server) is tried again soon, so open
      // pages hand the booking over within a minute instead of five.
      if ((this.queue.length || heartbeat) && !this.timer) {
        this.timer = setTimeout(() => { this.timer = null; this.flush(heartbeat && !this.queue.length); }, 30_000);
        this.timer.unref?.();
      }
    } finally {
      this.sending = false;
    }
  }
}
