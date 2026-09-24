CREATE TABLE "GenerationCache" ("key" TEXT NOT NULL PRIMARY KEY, "storeId" TEXT NOT NULL, "value" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "GenerationCache_storeId_idx" ON "GenerationCache"("storeId");
