-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'SHADOWBANNED';

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "messageId" TEXT;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
