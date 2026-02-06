-- CreateTable
CREATE TABLE "landingUser" (
    "id" SERIAL NOT NULL,
    "birthDate" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "mbti" TEXT NOT NULL,
    "purchaseClicked" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landingUser_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "banners" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "pc_image_url" TEXT NOT NULL,
    "mobile_image_url" TEXT,
    "link_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contents" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "link_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "kakaoId" TEXT NOT NULL,
    "email" TEXT,
    "nickname" TEXT NOT NULL,
    "profileImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_kakaoId_key" ON "users"("kakaoId");

