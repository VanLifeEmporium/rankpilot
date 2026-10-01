// Release 22 (R22-204): alerts for the app owner when the service returns 5xx errors or restarts
// outside a deploy. Alerts go to the log (level error, "RankPilot ALERT") and, when ALERT_WEBHOOK_URL is
// set, to that webhook as JSON ({text, content}: Slack, Discord, Teams workflows and most chat tools accept it).
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

const REQUEST = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+) (\d{3})\b/;

/** More than `limit` 5xx responses within `windowMs` raises one alert, then waits `cooldownMs`. */
export function createErrorWindow({ limit = 3, windowMs = 5 * 60_000, cooldownMs = 15 * 60_000 } = {}) {
  let errors = [];
  let lastAlert = -Infinity;
  return {
    /** Feed one log line; returns an alert when the threshold is crossed. */
    line(text, now = Date.now()) {
      const m = String(text).replace(/\u001b\[[0-9;]*m/g, "").trim().match(REQUEST);
      if (!m) return null;
      return this.record(Number(m[3]), `${m[1]} ${m[2].split("?")[0]}`, now);
    },
    record(status, route, now = Date.now()) {
      if (status < 500) return null;
      errors = [...errors.filter((e) => now - e.at <= windowMs), { at: now, status, route }];
      if (errors.length <= limit || now - lastAlert < cooldownMs) return null;
      lastAlert = now;
      const routes = [...new Map(errors.map((e) => [e.route, errors.filter((x) => x.route === e.route).length])).entries()].sort((a, b) => b[1] - a[1]);
      return {
        kind: "5xx",
        text: `RankPilot: ${errors.length} server errors (5xx) in the last ${Math.round(windowMs / 60000)} minutes, first at ${new Date(errors[0].at).toISOString()}, latest at ${new Date(now).toISOString()}. Failing routes: ${routes.map(([r, n]) => `${r} (${n})`).join(", ")}.`,
        routes: routes.map(([route, count]) => ({ route, count })),
        at: new Date(now).toISOString(),
      };
    },
  };
}

/** The last `size` log lines, for restart alerts. */
export function createRing(size = 30) {
  const lines = [];
  return {
    push(text) { for (const l of String(text).split(/\r?\n/)) { const t = l.replace(/\u001b\[[0-9;]*m/g, "").trimEnd(); if (!t || / \/health /.test(t)) continue; lines.push(t.slice(0, 300)); if (lines.length > size) lines.shift(); } },
    lines: () => [...lines],
  };
}

/**
 * A restart outside a deploy: the previous run did not shut down cleanly (crash, out of memory, a
 * process exiting), or it ran the same code. A deploy changes RENDER_GIT_COMMIT and stops the old run
 * cleanly, so it raises nothing. A manual redeploy of the same commit is reported too, labelled so.
 */
export function restartAlert(previous, current) {
  if (!previous || !previous.startedAt || previous.alerted) return null;
  const sameCode = !!current.commit && previous.commit === current.commit;
  if (previous.clean && !sameCode) return null;
  const why = previous.clean ? "It stopped normally but restarted with the same code (a restart or a manual redeploy, not a code deploy)" : `It stopped without a normal shutdown${previous.exit ? ` (${previous.exit})` : ""}: a crash, out-of-memory stop or platform restart`;
  return {
    kind: "restart",
    text: `RankPilot restarted at ${current.startedAt}. ${why}. Last seen running at ${previous.lastSeen || previous.startedAt}.${previous.lastLines?.length ? `\nLast log lines:\n${previous.lastLines.slice(-15).join("\n")}` : ""}`,
    at: current.startedAt,
    lastSeen: previous.lastSeen || previous.startedAt,
    lastLines: previous.lastLines || [],
  };
}

export function stateFile(env = process.env) {
  const url = env.DATABASE_URL || "";
  const file = url.startsWith("file:") ? url.slice(5).split("?")[0] : "";
  return env.MONITOR_STATE_FILE || (file ? join(dirname(file), "rankpilot-monitor.json") : "");
}
export function readState(file) {
  try { return file ? JSON.parse(readFileSync(file, "utf8")) : null; } catch { return null; }
}
export function writeState(file, state) {
  if (!file) return;
  try { writeFileSync(file + ".tmp", JSON.stringify(state)); renameSync(file + ".tmp", file); } catch { /* the alert log line still goes out */ }
}

export async function sendAlert(alert, env = process.env, fetcher = globalThis.fetch) {
  console.error(`RankPilot ALERT (${alert.kind}): ${alert.text}`);
  const url = env.ALERT_WEBHOOK_URL;
  if (!url || !fetcher) return false;
  try {
    const res = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: alert.text, content: alert.text.slice(0, 1900), alert }), signal: AbortSignal.timeout(5000) });
    if (!res.ok) console.error(`RankPilot ALERT webhook returned HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error(`RankPilot ALERT webhook failed: ${e.message}`);
    return false;
  }
}
