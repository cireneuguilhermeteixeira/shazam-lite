-- CreateEnum
CREATE TYPE "TrackStatus" AS ENUM ('QUEUED', 'FINGERPRINTING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "durationS" DOUBLE PRECISION,
    "s3Key" TEXT NOT NULL,
    "status" "TrackStatus" NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Track_s3Key_key" ON "Track"("s3Key");
