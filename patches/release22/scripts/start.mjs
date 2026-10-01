// Release 19: run migrations once, then start the web app and the worker with plain node
// (no npm wrappers, no tsx) and a heap limit each, sized for a 512 MB container.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createErrorWindow, createRing, restartAlert, stateFile, readState, writeState, sendAlert } from "./monitor.mjs";
if (
  process.env.DEMO_MODE !== "true" &&
  (!process.env.ENCRYPTION_KEY ||
    !process.env.SESSION_SECRET ||
    !process.env.SHOPIFY_API_KEY ||
    !process.env.SHOPIFY_API_SECRET)
)
  throw new Error("Production secrets are missing");
const heap = (name, fallback) => `--max-old-space-size=${Number(process.env[name]) || fallback}`;
if (process.env.SKIP_MIGRATE !== "true") {
  const migrate = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { stdio: "inherit" });
  if (migrate.status !== 0) process.exit(migrate.status || 1);
}
const worker = existsSync("build/worker/worker.mjs")
  ? [heap("WORKER_HEAP_MB", 200), "build/worker/worker.mjs"]
  : [heap("WORKER_HEAP_MB", 200), "--import", "tsx", "scripts/worker.ts"];
// Release 22 (R22-204): alert the owner on a restart outside a deploy, and on bursts of 5xx responses.
const monitorFile = stateFile();
const startedAt = new Date().toISOString();
const state = { commit: process.env.RENDER_GIT_COMMIT || "", startedAt, lastSeen: startedAt, clean: false, lastLines: [] };
const restart = restartAlert(readState(monitorFile), state);
writeState(monitorFile, state);
if (restart) sendAlert(restart).catch(() => {});
const ring = createRing(30);
const errors = createErrorWindow();
let stopping = false, exiting = false;
const save = () => writeState(monitorFile, { ...state, lastSeen: new Date().toISOString(), lastLines: ring.lines() });
setInterval(save, 15_000).unref();
const pipe = (stream, out, web) => {
  let partial = "";
  stream.on("data", (chunk) => {
    out.write(chunk);
    const text = partial + chunk.toString();
    const lines = text.split("\n");
    partial = lines.pop() || "";
    for (const line of lines) {
      ring.push(line);
      const alert = web ? errors.line(line) : null;
      if (alert) sendAlert(alert).catch(() => {});
    }
  });
};
const start = (args, web) => {
  const child = spawn(process.execPath, args, { stdio: ["inherit", "pipe", "pipe"] });
  pipe(child.stdout, process.stdout, web);
  pipe(child.stderr, process.stderr, web);
  return child;
};
const children = [
  start([heap("WEB_HEAP_MB", 180), "node_modules/@react-router/serve/bin.js", "./build/server/index.js"], true),
  start(worker, false),
];
for (const [index, child] of children.entries())
  child.on("exit", async (code, signal) => {
    if (exiting) return;
    exiting = true;
    children.forEach((c) => c.kill());
    if (!stopping) {
      // A process stopping on its own is a crash: alert now, and tell the next start it was already sent.
      state.exit = `${index === 0 ? "web" : "worker"} process exited${signal ? ` on ${signal}` : ` with code ${code}`}`;
      save();
      await sendAlert({ kind: "restart", text: `RankPilot is restarting at ${new Date().toISOString()}: the ${state.exit}. Last log lines:\n${ring.lines().slice(-15).join("\n")}`, at: new Date().toISOString(), lastLines: ring.lines() }).catch(() => {});
      writeState(monitorFile, { ...state, alerted: true, lastSeen: new Date().toISOString(), lastLines: ring.lines() });
    }
    process.exit(code || 0);
  });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    state.clean = true;
    save();
    children.forEach((c) => c.kill());
  });
