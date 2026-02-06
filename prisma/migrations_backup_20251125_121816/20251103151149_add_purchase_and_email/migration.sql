-- AlterTable
ALTER TABLE "landingUser" ADD COLUMN     "email" TEXT,
ADD COLUMN     "purchaseClicked" BOOLEAN NOT NULL DEFAULT false;
