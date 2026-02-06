-- CreateTable
CREATE TABLE "landingUserV2" (
    "id" SERIAL NOT NULL,
    "birthDate" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "mbti" TEXT NOT NULL,
    "purchaseClicked" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "selectedCard" INTEGER,
    "isRestarted" BOOLEAN NOT NULL DEFAULT false,
    "feedback" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landingUserV2_pkey" PRIMARY KEY ("id")
);
