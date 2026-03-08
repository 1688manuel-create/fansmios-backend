-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "isPPV" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "price" DOUBLE PRECISION DEFAULT 0.0;

-- CreateTable
CREATE TABLE "PostPurchase" (
    "id" TEXT NOT NULL,
    "fanId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "pricePaid" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostPurchase_fanId_postId_key" ON "PostPurchase"("fanId", "postId");

-- AddForeignKey
ALTER TABLE "PostPurchase" ADD CONSTRAINT "PostPurchase_fanId_fkey" FOREIGN KEY ("fanId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostPurchase" ADD CONSTRAINT "PostPurchase_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
