-- AlterTable
ALTER TABLE "CreatorProfile" ADD COLUMN     "blockedCountries" TEXT,
ADD COLUMN     "hideBalance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minPpvPrice" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "welcomeMessage" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isPrivateProfile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pushNotifications" BOOLEAN NOT NULL DEFAULT true;
