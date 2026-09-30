import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

// Release 20 (RP-602): SQLite serialises writes, so a batch can wait behind the worker. Give interactive
// transactions room (the 5 s default timed out at 5.3 s) instead of failing with a raw database error.
const options = { transactionOptions: { maxWait: 15000, timeout: 20000 } };

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient(options);
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient(options);

export default prisma;
