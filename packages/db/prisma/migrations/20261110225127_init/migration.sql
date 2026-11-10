-- CreateEnum
CREATE TYPE "public"."Plan" AS ENUM ('starter', 'author', 'press');

-- CreateEnum
CREATE TYPE "public"."BookStage" AS ENUM ('upload', 'edit', 'comply', 'metadata', 'export', 'publish', 'track');

-- CreateEnum
CREATE TYPE "public"."PassKind" AS ENUM ('copyedit', 'proofread', 'structural');

-- CreateEnum
CREATE TYPE "public"."JobStatus" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "public"."EditStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "public"."AiRole" AS ENUM ('none', 'assisted', 'generated');

-- CreateEnum
CREATE TYPE "public"."RecommendationStatus" AS ENUM ('open', 'applied', 'dismissed');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "public"."Plan" NOT NULL DEFAULT 'starter',
    "spendCapCentsDaily" INTEGER NOT NULL DEFAULT 300,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Book" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "author" TEXT NOT NULL,
    "genre" TEXT NOT NULL DEFAULT '',
    "stage" "public"."BookStage" NOT NULL DEFAULT 'upload',
    "trimSize" TEXT NOT NULL DEFAULT '6x9',
    "isbn" TEXT,
    "aboutAuthor" TEXT,
    "dedication" TEXT,
    "seriesStarter" BOOLEAN NOT NULL DEFAULT false,
    "asin" TEXT,
    "blurb" JSONB,
    "declaration" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ManuscriptVersion" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManuscriptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Upload" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Pass" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "kind" "public"."PassKind" NOT NULL,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'queued',
    "manuscriptVersion" INTEGER NOT NULL,
    "model" TEXT,
    "modelSkippedReason" TEXT,
    "touch" JSONB,
    "notes" JSONB,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Edit" (
    "id" TEXT NOT NULL,
    "passId" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "rule" TEXT,
    "source" TEXT NOT NULL,
    "aiRole" "public"."AiRole" NOT NULL,
    "status" "public"."EditStatus" NOT NULL DEFAULT 'pending',
    "authorRevised" BOOLEAN NOT NULL DEFAULT false,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Edit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ComplianceReport" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "disclosure" JSONB NOT NULL,
    "checklist" JSONB NOT NULL,
    "confirmations" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DiscoveryRun" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "sources" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Recommendation" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "dataSources" TEXT[],
    "status" "public"."RecommendationStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "outcome" JSONB,
    "outcomeAt" TIMESTAMP(3),

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MetadataVersion" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT NOT NULL,
    "keywordBoxes" TEXT[],
    "boxPhrases" JSONB NOT NULL,
    "categories" TEXT[],
    "ebookPriceCents" INTEGER,
    "paperbackPriceCents" INTEGER,
    "appliedAt" TIMESTAMP(3),
    "recommendationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetadataVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TrackedKeyword" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RankObservation" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "rank" INTEGER,
    "provider" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BsrObservation" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "bsr" INTEGER,
    "provider" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BsrObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Export" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "trimSize" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "preflight" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SpendEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookId" TEXT,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpendEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "public"."Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "public"."Session"("userId");

-- CreateIndex
CREATE INDEX "Book_userId_idx" ON "public"."Book"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ManuscriptVersion_bookId_version_key" ON "public"."ManuscriptVersion"("bookId", "version");

-- CreateIndex
CREATE INDEX "Upload_bookId_idx" ON "public"."Upload"("bookId");

-- CreateIndex
CREATE INDEX "Pass_bookId_createdAt_idx" ON "public"."Pass"("bookId", "createdAt");

-- CreateIndex
CREATE INDEX "Edit_bookId_status_idx" ON "public"."Edit"("bookId", "status");

-- CreateIndex
CREATE INDEX "Edit_passId_idx" ON "public"."Edit"("passId");

-- CreateIndex
CREATE INDEX "ComplianceReport_bookId_createdAt_idx" ON "public"."ComplianceReport"("bookId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscoveryRun_bookId_createdAt_idx" ON "public"."DiscoveryRun"("bookId", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_bookId_createdAt_idx" ON "public"."Recommendation"("bookId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetadataVersion_bookId_version_key" ON "public"."MetadataVersion"("bookId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedKeyword_bookId_keyword_key" ON "public"."TrackedKeyword"("bookId", "keyword");

-- CreateIndex
CREATE INDEX "RankObservation_bookId_observedAt_idx" ON "public"."RankObservation"("bookId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RankObservation_bookId_keyword_observedAt_key" ON "public"."RankObservation"("bookId", "keyword", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BsrObservation_bookId_observedAt_key" ON "public"."BsrObservation"("bookId", "observedAt");

-- CreateIndex
CREATE INDEX "Export_bookId_createdAt_idx" ON "public"."Export"("bookId", "createdAt");

-- CreateIndex
CREATE INDEX "SpendEntry_userId_createdAt_idx" ON "public"."SpendEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SpendEntry_createdAt_idx" ON "public"."SpendEntry"("createdAt");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "public"."Job"("status", "runAt");

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Book" ADD CONSTRAINT "Book_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ManuscriptVersion" ADD CONSTRAINT "ManuscriptVersion_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Upload" ADD CONSTRAINT "Upload_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Pass" ADD CONSTRAINT "Pass_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Edit" ADD CONSTRAINT "Edit_passId_fkey" FOREIGN KEY ("passId") REFERENCES "public"."Pass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Edit" ADD CONSTRAINT "Edit_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ComplianceReport" ADD CONSTRAINT "ComplianceReport_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Recommendation" ADD CONSTRAINT "Recommendation_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MetadataVersion" ADD CONSTRAINT "MetadataVersion_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MetadataVersion" ADD CONSTRAINT "MetadataVersion_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "public"."Recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TrackedKeyword" ADD CONSTRAINT "TrackedKeyword_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RankObservation" ADD CONSTRAINT "RankObservation_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BsrObservation" ADD CONSTRAINT "BsrObservation_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Export" ADD CONSTRAINT "Export_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SpendEntry" ADD CONSTRAINT "SpendEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SpendEntry" ADD CONSTRAINT "SpendEntry_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "public"."Book"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
