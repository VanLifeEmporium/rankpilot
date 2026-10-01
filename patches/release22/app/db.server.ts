import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { isAbsolute, resolve, dirname } from "node:path";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
  // eslint-disable-next-line no-var
  var prismaReady: Promise<DbSettings> | undefined;
}

// Release 20 (RP-602): SQLite serialises writes, so a batch can wait behind the worker. Give interactive
// transactions room (the 5 s default timed out at 5.3 s) instead of failing with a raw database error.
// Release 22 (R22-200): SQLite allows one writer at a time. Each process (web, worker) uses ONE
// connection, so its queries queue inside Prisma instead of inside SQLite: with a pool, an open
// transaction could not commit while other connections in the same process sat in SQLite's lock wait,
// and they failed together with "database is locked" after the timeout (reproduced in
// tests/r22-sprint1.test.ts). Between the two processes, WAL plus a 10 s busy_timeout lets each wait
// for the other's write instead of failing. pool_timeout is how long a query may queue for the connection.
export const BUSY_TIMEOUT_S = 10;
export function sqliteUrl(url = process.env.DATABASE_URL || "") {
  if (!url.startsWith("file:")) return url;
  const add = (u: string, key: string, value: string | number) => (new RegExp(`[?&]${key}=`).test(u) ? u : `${u}${u.includes("?") ? "&" : "?"}${key}=${value}`);
  return add(add(add(url, "connection_limit", 1), "socket_timeout", BUSY_TIMEOUT_S), "pool_timeout", 30);
}
const url = sqliteUrl();
const options = { transactionOptions: { maxWait: 15000, timeout: 20000 }, ...(url ? { datasources: { db: { url } } } : {}) };

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient(options);
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient(options);

export type DbSettings = { journalMode: string; busyTimeout: number; backup?: string; error?: string };
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v));
/** The SQLite file behind DATABASE_URL (relative paths resolve from prisma/schema.prisma, as Prisma does). */
export function sqliteFile(raw = process.env.DATABASE_URL || "") {
  if (!raw.startsWith("file:")) return null;
  const path = raw.slice(5).split("?")[0];
  return isAbsolute(path) ? path : resolve("prisma", path);
}
/**
 * Release 22 (R22-200): write-ahead logging lets the web process read while the worker writes, so
 * neither fails with "database busy". WAL is stored in the database file, so this runs once per
 * process and is a no-op afterwards. Before the first switch a consistent copy is taken with
 * VACUUM INTO (safe while the app is running) as the rollback backup.
 */
export async function ensureDatabaseSettings(client: PrismaClient = prisma, file: string | null = sqliteFile()): Promise<DbSettings> {
  try {
    const mode = String(((await client.$queryRawUnsafe("PRAGMA journal_mode")) as { journal_mode: string }[])[0]?.journal_mode || "").toLowerCase();
    let backup: string | undefined;
    if (mode !== "wal") {
      if (file && existsSync(file)) {
        backup = `${file}.pre-wal-${new Date().toISOString().slice(0, 10)}.bak`;
        // The web and worker processes start together; whichever is second finds the backup already there.
        if (!existsSync(backup) && existsSync(dirname(backup))) await client.$executeRawUnsafe(`VACUUM INTO '${backup.replace(/'/g, "''")}'`).catch((e) => { if (!existsSync(backup!)) throw e; });
      }
      await client.$queryRawUnsafe("PRAGMA journal_mode=WAL");
    }
    const after = String(((await client.$queryRawUnsafe("PRAGMA journal_mode")) as { journal_mode: string }[])[0]?.journal_mode || "").toLowerCase();
    const busy = num(((await client.$queryRawUnsafe("PRAGMA busy_timeout")) as { timeout: unknown }[])[0]?.timeout);
    return { journalMode: after, busyTimeout: busy, ...(backup ? { backup } : {}) };
  } catch (e) {
    return { journalMode: "unknown", busyTimeout: 0, error: (e as Error).message };
  }
}
/** Runs once per process; the result is logged at start-up and shown at /health. */
export function databaseReady() {
  if (!global.prismaReady) global.prismaReady = ensureDatabaseSettings().then((s) => {
    console.log(`RankPilot database: journal_mode=${s.journalMode} busy_timeout=${s.busyTimeout}${s.backup ? ` backup=${s.backup}` : ""}${s.error ? ` error=${s.error}` : ""}`);
    return s;
  });
  return global.prismaReady;
}

// Start-up check in each process (web and worker); tests manage their own database.
if (!process.env.VITEST) void databaseReady();

export default prisma;
