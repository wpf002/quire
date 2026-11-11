-- CreateTable
CREATE TABLE "public"."CategoryRankObservation" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryRankObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CategoryRankObservation_bookId_observedAt_idx" ON "public"."CategoryRankObservation"("bookId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryRankObservation_bookId_category_observedAt_key" ON "public"."CategoryRankObservation"("bookId", "category", "observedAt");

-- AddForeignKey
ALTER TABLE "public"."CategoryRankObservation" ADD CONSTRAINT "CategoryRankObservation_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
