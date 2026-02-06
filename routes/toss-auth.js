/**
 * 토스 OAuth 인증 라우트
 * POST /api/auth/toss/token - 인가 코드 → 액세스 토큰 교환
 * GET /api/auth/toss/user - 사용자 정보 조회
 * POST /api/auth/toss/logout - OAuth 연결 해제
 * POST /api/auth/toss-sign-out - 토스 로그아웃 웹훅 콜백
 */
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { getTossClient } = require("../lib/tossClient");
const { tossDecrypt } = require("../lib/tossDecrypt");

// Prisma는 server.js에서 전달받음
let prisma = null;

const initPrisma = (prismaClient) => {
  prisma = prismaClient;
};

/**
 * 토스 토큰 인증 미들웨어
 * Authorization 헤더의 Bearer 토큰을 검증하고 사용자 정보를 req.user에 설정
 */
const authenticateTossToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "토스 액세스 토큰이 필요합니다." });
    }

    // 토스 JWT 디코딩 (서명 검증 없이 - 토스 공개키가 없으므로)
    const decoded = jwt.decode(token);

    if (!decoded) {
      return res.status(401).json({ error: "유효하지 않은 토큰입니다." });
    }

    // 토큰 만료 확인
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return res.status(401).json({ error: "토큰이 만료되었습니다." });
    }

    // sub 클레임에서 userKey 추출 (Base64 인코딩된 값)
    const tossUserSub = decoded.sub;

    // X-User-ID 헤더가 있으면 해당 사용자 조회, 없으면 tossUserKey로 조회
    const headerUserId = req.headers["x-user-id"];
    let user;

    if (headerUserId) {
      user = await prisma.user.findUnique({
        where: { id: parseInt(headerUserId) },
      });
    }

    // 사용자를 찾지 못했거나 토스 로그아웃 상태인 경우
    if (!user) {
      return res.status(401).json({ error: "사용자를 찾을 수 없습니다." });
    }

    if (user.tossLoggedOut) {
      return res.status(401).json({ error: "토스 연결이 해제되었습니다." });
    }

    // req.user에 사용자 정보 설정
    req.user = {
      userId: user.id,
      tossUserSub,
      nickname: user.nickname || user.tossName,
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: "인증 처리 중 오류가 발생했습니다." });
  }
};

/**
 * POST /api/auth/toss/token
 * 인가 코드로 액세스 토큰을 교환합니다.
 */
router.post("/toss/token", async (req, res) => {
  try {
    const { authorizationCode, referrer } = req.body;

    if (!authorizationCode) {
      return res.status(400).json({
        resultType: "FAIL",
        error: { message: "authorizationCode가 필요합니다." },
      });
    }

    const tossClient = getTossClient();
    const tossResponse = await tossClient.generateToken(
      authorizationCode,
      referrer
    );

    // Toss API 응답은 { resultType, success: { accessToken, ... } } 구조
    const tokenData = tossResponse.success || tossResponse;
    const accessToken = tokenData.accessToken || tokenData.access_token;
    const refreshToken = tokenData.refreshToken || tokenData.refresh_token;
    const scope = tokenData.scope;
    const tokenType = tokenData.tokenType || tokenData.token_type;
    const expiresIn = tokenData.expiresIn || tokenData.expires_in;

    res.json({
      resultType: "SUCCESS",
      success: {
        accessToken,
        refreshToken,
        scope,
        tokenType,
        expiresIn,
      },
    });
  } catch (error) {
    res.status(500).json({
      resultType: "FAIL",
      error: { message: error.response?.data?.message || error.message },
    });
  }
});

/**
 * GET /api/auth/toss/user
 * 액세스 토큰으로 사용자 정보를 조회하고 DB에 저장/업데이트합니다.
 */
router.get("/toss/user", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.replace("Bearer ", "");

    if (!accessToken) {
      return res.status(401).json({
        resultType: "FAIL",
        error: { message: "액세스 토큰이 필요합니다." },
      });
    }

    // 1. 토스에서 사용자 정보 조회
    const tossClient = getTossClient();
    const userInfo = await tossClient.getUserInfo(accessToken);

    // 2. 암호화된 필드 복호화
    const decryptedUserInfo = tossDecrypt.decryptUserData(userInfo);

    // userKey는 중첩 구조 또는 직접 접근 모두 지원
    const userKey =
      decryptedUserInfo.userKey ||
      userInfo.success?.userKey ||
      userInfo.userKey;

    // 3. 정보 새로고침 요청인 경우 (X-User-ID 헤더 있음) tossLoggedOut 체크
    const headerUserId = req.headers["x-user-id"];
    if (headerUserId) {
      const existingUser = await prisma.user.findUnique({
        where: { id: parseInt(headerUserId) },
        select: { tossLoggedOut: true },
      });

      // 기존 사용자가 토스 연결 해제 상태면 401 반환
      if (existingUser?.tossLoggedOut) {
        return res.status(401).json({
          resultType: "FAIL",
          error: { message: "토스 연결이 해제되었습니다." },
        });
      }
    }

    // 4. DB에 사용자 upsert
    const user = await prisma.user.upsert({
      where: { tossUserKey: userKey?.toString() },
      update: {
        tossName: decryptedUserInfo.name,
        tossPhone: decryptedUserInfo.phone,
        tossBirthday: decryptedUserInfo.birthday,
        tossCi: decryptedUserInfo.ci,
        tossGender: decryptedUserInfo.gender,
        tossNationality: decryptedUserInfo.nationality,
        tossLastLogin: new Date(),
        tossLoggedOut: false,
      },
      create: {
        tossUserKey: userKey?.toString(),
        tossName: decryptedUserInfo.name,
        nickname: decryptedUserInfo.name,
        tossCi: decryptedUserInfo.ci,
        tossPhone: decryptedUserInfo.phone,
        tossBirthday: decryptedUserInfo.birthday,
        tossGender: decryptedUserInfo.gender,
        tossNationality: decryptedUserInfo.nationality,
        tossLastLogin: new Date(),
      },
    });

    // 5. Purchase 테이블에서 AD_FREE 구매 내역 확인
    const adFreePurchase = await prisma.purchase.findFirst({
      where: {
        userId: user.id,
        productType: "AD_FREE",
        status: "COMPLETED",
      },
    });

    res.json({
      resultType: "SUCCESS",
      success: decryptedUserInfo,
      dbUser: {
        id: user.id,
        name: user.tossName || user.nickname,
        nickname: user.nickname,
        gender: user.gender || user.tossGender,
        birthDate: user.birthDate || user.tossBirthday,
        tossBirthday: user.tossBirthday,
        tossGender: user.tossGender,
        mbti: user.mbti,
        adFree: !!adFreePurchase,
      },
    });
  } catch (error) {
    res.status(500).json({
      resultType: "FAIL",
      error: { message: error.response?.data?.message || error.message },
    });
  }
});

/**
 * POST /api/auth/toss/logout
 * OAuth 연결을 해제합니다. (사용자 요청)
 */
router.post("/toss/logout", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.replace("Bearer ", "");

    if (!accessToken) {
      return res.status(401).json({
        resultType: "FAIL",
        error: { message: "액세스 토큰이 필요합니다." },
      });
    }

    const tossClient = getTossClient();
    await tossClient.removeByAccessToken(accessToken);

    res.json({
      resultType: "SUCCESS",
      message: "로그아웃 완료",
    });
  } catch (error) {
    // 로그아웃 실패해도 클라이언트에서는 로컬 데이터 삭제하면 됨
    res.json({
      resultType: "SUCCESS",
      message: "로그아웃 완료 (토스 API 오류 무시)",
    });
  }
});

/**
 * PUT /api/auth/profile
 * 사용자 프로필(생년월일, 성별, MBTI) 업데이트
 */
router.put("/profile", authenticateTossToken, async (req, res) => {
  try {
    const { birthDate, gender, mbti } = req.body;
    const userId = req.user.userId;

    // 업데이트할 데이터 구성
    const updateData = {};
    if (birthDate !== undefined) updateData.birthDate = birthDate;
    if (gender !== undefined) updateData.gender = gender;
    if (mbti !== undefined) updateData.mbti = mbti;

    // DB 업데이트
    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    res.json({
      success: true,
      message: "프로필이 업데이트되었습니다.",
      user: {
        id: user.id,
        birthDate: user.birthDate,
        gender: user.gender,
        mbti: user.mbti,
      },
    });
  } catch (error) {
    console.error("프로필 업데이트 오류:", error);
    res.status(500).json({
      success: false,
      message: "프로필 업데이트 중 오류가 발생했습니다.",
    });
  }
});

/**
 * GET /api/auth/check-status
 * 사용자의 로그인 상태 (tossLoggedOut) 확인
 * 프론트엔드에서 주기적으로 호출하여 연결 해제 여부 체크
 */
router.get("/check-status", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];

    if (!userId) {
      return res.status(400).json({ success: false, message: "사용자 ID가 필요합니다." });
    }

    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
      select: { id: true, tossLoggedOut: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "사용자를 찾을 수 없습니다." });
    }

    if (user.tossLoggedOut) {
      return res.status(401).json({ success: false, message: "토스 연결이 해제되었습니다." });
    }

    res.json({ success: true, isLoggedIn: true });
  } catch (error) {
    console.error("check-status 오류:", error.message);
    res.status(500).json({ success: false, message: "상태 확인 중 오류가 발생했습니다." });
  }
});

/**
 * POST /api/auth/purchase/process
 * 인앱 구매 처리 API
 * SKU에 따라 해당 상품의 혜택을 사용자에게 부여
 */
router.post("/purchase/process", authenticateTossToken, async (req, res) => {
  try {
    const { orderId, sku, amount } = req.body;
    const userId = req.user.userId;

    if (!orderId || !sku) {
      return res.status(400).json({
        success: false,
        message: "orderId와 sku가 필요합니다.",
      });
    }

    // 이미 처리된 주문인지 확인
    const existingPurchase = await prisma.purchase.findUnique({
      where: { orderId },
    });

    if (existingPurchase) {
      console.log(`이미 처리된 주문 - orderId: ${orderId}`);
      return res.json({
        success: true,
        message: "이미 처리된 주문입니다.",
        productType: existingPurchase.productType,
      });
    }

    // 광고 제거 상품 처리
    const AD_FREE_SKU = process.env.AD_FREE_SKU;

    if (sku === AD_FREE_SKU) {
      // 구매 기록 저장
      await prisma.purchase.create({
        data: {
          userId,
          orderId,
          sku,
          productType: "AD_FREE",
          status: "COMPLETED",
          amount: amount || null,
        },
      });

      console.log(`광고 제거 구매 완료 - userId: ${userId}, orderId: ${orderId}`);

      return res.json({
        success: true,
        message: "광고 제거가 적용되었습니다.",
        productType: "AD_FREE",
        adFree: true,
      });
    }

    // 알 수 없는 SKU - 기록은 저장하되 혜택은 미적용
    await prisma.purchase.create({
      data: {
        userId,
        orderId,
        sku,
        productType: "UNKNOWN",
        status: "PENDING",
        amount: amount || null,
        metadata: { note: "알 수 없는 SKU" },
      },
    });

    console.warn(`알 수 없는 SKU: ${sku}, orderId: ${orderId}`);
    return res.status(400).json({
      success: false,
      message: "알 수 없는 상품입니다.",
    });
  } catch (error) {
    console.error("구매 처리 오류:", error);
    res.status(500).json({
      success: false,
      message: "구매 처리 중 오류가 발생했습니다.",
    });
  }
});

/**
 * GET /api/auth/purchases
 * 사용자의 구매 내역 조회
 */
router.get("/purchases", authenticateTossToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const purchases = await prisma.purchase.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderId: true,
        sku: true,
        productType: true,
        status: true,
        amount: true,
        createdAt: true,
      },
    });

    res.json({
      success: true,
      purchases,
    });
  } catch (error) {
    console.error("구매 내역 조회 오류:", error);
    res.status(500).json({
      success: false,
      message: "구매 내역 조회 중 오류가 발생했습니다.",
    });
  }
});

/**
 * POST /api/auth/toss-sign-out
 * 토스에서 사용자가 앱 연결을 해제하면 호출되는 웹훅 콜백
 * referrer: "UNLINK" | "WITHDRAWAL_TERMS" | "WITHDRAWAL_TOSS"
 * Basic Auth: taroti
 */
router.post("/toss-sign-out", async (req, res) => {
  // Basic Auth 검증
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return res.status(401).json({ message: "인증이 필요합니다." });
  }

  const base64Credentials = authHeader.split(" ")[1];
  const credentials = Buffer.from(base64Credentials, "base64").toString("utf8");
  // credentials 형식: "username:password" 또는 "taroti" 또는 "taroti:"
  const expectedCredentials = ["taroti", "taroti:", "taroti:taroti"];

  if (!expectedCredentials.some(expected => credentials === expected || credentials.startsWith("taroti"))) {
    return res.status(401).json({ message: "인증 실패" });
  }

  const { userKey, referrer } = req.body;

  // 유효성 검사
  if (!userKey) {
    return res.status(400).json({ message: "userKey가 필요합니다." });
  }

  const validReferrers = ["UNLINK", "WITHDRAWAL_TERMS", "WITHDRAWAL_TOSS"];
  if (referrer && !validReferrers.includes(referrer)) {
    return res.status(400).json({ message: "잘못된 referrer 값입니다." });
  }

  try {
    // DB에서 사용자 로그아웃 상태 업데이트
    await prisma.user.update({
      where: { tossUserKey: userKey?.toString() },
      data: { tossLoggedOut: true },
    });

    // 토스에 연결 해제 요청
    let warning = null;
    try {
      const tossClient = getTossClient();
      await tossClient.removeByUserKey(userKey);
    } catch (tossError) {
      console.error("토스 OAuth 연결 해제 실패:", tossError.message);
      warning = "토스 OAuth 연결 해제 실패";
    }

    const response = { message: "로그아웃 처리 완료", userKey, referrer };
    if (warning) {
      response.message = "로그아웃 처리 완료 (부분 실패)";
      response.warning = warning;
    }

    res.json(response);
  } catch (error) {
    console.error("toss-sign-out 처리 오류:", error.message);
    // 에러가 발생해도 200 응답 (토스 재시도 방지)
    res.json({
      message: "로그아웃 처리 완료 (에러 발생)",
      error: error.message,
    });
  }
});

module.exports = { router, initPrisma, authenticateTossToken };
