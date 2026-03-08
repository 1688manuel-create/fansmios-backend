-- CreateEnum
CREATE TYPE "PostVisibility" AS ENUM ('PUBLIC', 'SUBSCRIBERS_ONLY');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "mediaType" "MediaType" NOT NULL DEFAULT 'TEXT',
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "visibility" "PostVisibility" NOT NULL DEFAULT 'SUBSCRIBERS_ONLY';
