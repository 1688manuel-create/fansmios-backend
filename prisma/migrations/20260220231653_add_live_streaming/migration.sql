-- CreateEnum
CREATE TYPE "StreamStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED');

-- CreateTable
CREATE TABLE "LiveStream" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "StreamStatus" NOT NULL DEFAULT 'SCHEDULED',
    "streamKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveStream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveChatMessage" (
    "id" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isDonation" BOOLEAN NOT NULL DEFAULT false,
    "amount" DOUBLE PRECISION DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveStream_streamKey_key" ON "LiveStream"("streamKey");

-- AddForeignKey
ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
