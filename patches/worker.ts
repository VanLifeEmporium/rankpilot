import "dotenv/config";
import { tick, schedule } from "../app/core/service.server";
import prisma from "../app/db.server";
let stop = false;
process.on("SIGTERM", () => {
  stop = true;
});
process.on("SIGINT", () => {
  stop = true;
});
console.log("RankPilot worker ready");
while (!stop) {
  try {
    try { await schedule(); } catch(e) { console.error("Scheduler:", e instanceof Error ? e.message : "failed"); }
    if (!(await tick())) await new Promise((r) => setTimeout(r, 1500));
  } catch (e) {
    console.error("Worker:", e instanceof Error ? e.message : "failed");
    await new Promise((r) => setTimeout(r, 3000));
  }
}
await prisma.$disconnect();
