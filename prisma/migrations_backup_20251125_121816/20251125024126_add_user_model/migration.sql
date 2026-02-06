-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
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
