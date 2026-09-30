// Release 19: run migrations once, then start the web app and the worker with plain node
// (no npm wrappers, no tsx) and a heap limit each, sized for a 512 MB container.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
const children = [
  spawn(process.execPath, [heap("WEB_HEAP_MB", 180), "node_modules/@react-router/serve/bin.js", "./build/server/index.js"], { stdio: "inherit" }),
  spawn(process.execPath, worker, { stdio: "inherit" }),
];
for (const child of children)
  child.on("exit", (code) => {
    children.forEach((c) => c.kill());
    process.exit(code || 0);
  });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => children.forEach((c) => c.kill()));
