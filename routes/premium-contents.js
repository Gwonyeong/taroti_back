const express = require("express");
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const prisma = require("../lib/prisma");
const router = express.Router();

// MBTI 기질(temperament) 그룹 매핑 -> 카드 데이터의 advice 키
// NF: INFP, INFJ, ENFP, ENFJ
// NT: INTP, INTJ, ENTP, ENTJ
// SJ: ISFJ, ISTJ, ESFJ, ESTJ
// SP: ISFP, ISTP, ESFP, ESTP
function getMbtiGroup(mbti) {
  if (!mbti || mbti.length < 4) return "nf";
  const upper = mbti.toUpperCase();
  const s_n = upper[1]; // S or N
  const t_f = upper[2]; // T or F
  const j_p = upper[3]; // J or P
  if (s_n === "N" && t_f === "F") return "nf";
  if (s_n === "N" && t_f === "T") return "nt";
  if (s_n === "S" && j_p === "J") return "sj";
  if (s_n === "S" && j_p === "P") return "sp";
  return "nf";
}

// 프롬프트 템플릿에 변수 주입
function buildPrompt(template, cards, userProfile, cardDataContext) {
  const mbtiGroup = getMbtiGroup(userProfile.mbti);
  const formatArray = (arr) => Array.isArray(arr) ? arr.join(", ") : String(arr || "");

  let prompt = template;

  // 사용자 정보 주입
  prompt = prompt.replace(/\{mbti\}/g, userProfile.mbti || "");
  prompt = prompt.replace(/\{gender\}/g, userProfile.gender || "");
  prompt = prompt.replace(/\{birthDate\}/g, userProfile.birthDate || "");

  // 카드 정보 주입 (3장)
  const cardEntries = [
    { key: "card1", card: cards.card1, data: cardDataContext?.card1Data },
    { key: "card2", card: cards.card2, data: cardDataContext?.card2Data },
    { key: "card3", card: cards.card3, data: cardDataContext?.card3Data },
  ];

  for (const { key, card, data } of cardEntries) {
    prompt = prompt.replace(new RegExp(`\\{${key}\\.name\\}`, "g"), card?.name || "");
    prompt = prompt.replace(new RegExp(`\\{${key}\\.number\\}`, "g"), String(card?.number ?? ""));
    if (data) {
      prompt = prompt.replace(new RegExp(`\\{${key}Data\\.CardDescription\\}`, "g"), data.CardDescription || "");
      prompt = prompt.replace(new RegExp(`\\{${key}Data\\.Lover'sPerception\\}`, "g"), data["Lover'sPerception"] || "");
      prompt = prompt.replace(new RegExp(`\\{${key}Data\\.CardFeeling\\}`, "g"), data.CardFeeling || "");
      prompt = prompt.replace(new RegExp(`\\{${key}Data\\.PositiveKeywords\\}`, "g"), formatArray(data.PositiveKeywords));
      prompt = prompt.replace(new RegExp(`\\{${key}Data\\.NegativeKeywords\\}`, "g"), formatArray(data.NegativeKeywords));
      prompt = prompt.replace(
        new RegExp(`\\{${key}Data\\.\\{mbtiGroup\\}Advice\\}`, "g"),
        data[`${mbtiGroup}Advice`] || ""
      );
    }
  }

  // mbtiGroup placeholder
  prompt = prompt.replace(/\{mbtiGroup\}/g, mbtiGroup.toUpperCase());

  return prompt;
}

// 카드 번호로 카드 데이터 로드
function loadCardDataContext(cards) {
  const cardDescriptions = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../data/cardDescription.json"), "utf-8")
  );
  const cardList = cardDescriptions.TarotInterpretations;

  const findCard = (number) => cardList.find((c) => c.CardNumber === String(number));

  return {
    card1Data: findCard(cards.card1?.number),
    card2Data: findCard(cards.card2?.number),
    card3Data: findCard(cards.card3?.number),
  };
}

// Claude API로 해석 생성 (재시도 포함)
async function generateInterpretation(cards, userProfile, cardDataContext) {
  const anthropic = new Anthropic();

  const promptTemplate = fs.readFileSync(
    path.join(__dirname, "../prompts/mind-reading-premium.txt"),
    "utf-8"
  );

  const prompt = buildPrompt(promptTemplate, cards, userProfile, cardDataContext);

  const MAX_RETRIES = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Claude API] 호출 시도 ${attempt}/${MAX_RETRIES}`);
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });

      // 응답이 max_tokens로 잘렸는지 확인
      if (message.stop_reason === "max_tokens") {
        throw new Error("응답이 토큰 제한으로 잘렸습니다. 재시도합니다.");
      }

      console.log(`[Claude API] 응답 완료 (stop_reason: ${message.stop_reason}, output_tokens: ${message.usage?.output_tokens})`);
      const responseText = message.content[0].text;

      // JSON 파싱 (코드 블록으로 감싸져 있을 수 있음)
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) || responseText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch
        ? (jsonMatch[1] || jsonMatch[0]).trim()
        : responseText.trim();

      const parsed = JSON.parse(jsonStr);

      // 필수 필드 검증
      if (!parsed.deepPerception || !parsed.currentRelationship || !parsed.crisis || !parsed.future || !parsed.actionGuide || !parsed.compatibility || !parsed.finalMessage) {
        throw new Error("응답에 필수 필드가 누락되었습니다.");
      }

      console.log(`[Claude API] 호출 성공 (시도 ${attempt})`);
      return parsed;
    } catch (error) {
      lastError = error;
      console.error(`[Claude API] 시도 ${attempt} 실패:`, error.message);
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 2000; // 2초, 4초
        console.log(`[Claude API] ${delay}ms 후 재시도...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// 인증 미들웨어 (X-User-ID 헤더 또는 Bearer 토큰)
const authenticateUser = async (req, res, next) => {
  try {
    // X-User-ID 헤더 확인 (토스 앱에서 전송)
    const userId = req.headers["x-user-id"];
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: parseInt(userId) },
      });
      if (user) {
        req.user = user;
        return next();
      }
    }

    // Bearer 토큰 확인
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      // JWT 디코딩 로직 (필요시 추가)
    }

    return res.status(401).json({ success: false, message: "인증이 필요합니다." });
  } catch (error) {
    console.error("Authentication error:", error);
    return res.status(500).json({ success: false, message: "인증 처리 중 오류가 발생했습니다." });
  }
};

// 프리미엄 콘텐츠 세션 생성
router.post("/sessions", authenticateUser, async (req, res) => {
  try {
    const { contentType, selectedCard, userProfile, sessionData, cardData } = req.body;
    const userId = req.user.id;

    // 세션 생성
    const session = await prisma.premiumContentSession.create({
      data: {
        userId,
        contentType,
        selectedCard,
        userProfile,
        sessionData,
        cardData,
        status: "IN_PROGRESS",
      },
    });

    res.json({
      success: true,
      sessionId: session.id,
      data: session,
    });
  } catch (error) {
    console.error("Error creating premium content session:", error);
    res.status(500).json({ success: false, message: "세션 생성에 실패했습니다." });
  }
});

// 프리미엄 콘텐츠 세션 조회
router.get("/sessions/:sessionId", authenticateUser, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const session = await prisma.premiumContentSession.findFirst({
      where: {
        id: parseInt(sessionId),
        userId,
      },
      include: {
        purchase: true,
      },
    });

    if (!session) {
      return res.status(404).json({ success: false, message: "세션을 찾을 수 없습니다." });
    }

    res.json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("Error fetching premium content session:", error);
    res.status(500).json({ success: false, message: "세션 조회에 실패했습니다." });
  }
});

// 사용자의 프리미엄 콘텐츠 세션 목록 조회
router.get("/sessions", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { contentType, status } = req.query;

    const where = { userId };
    if (contentType) where.contentType = contentType;
    if (status) where.status = status;

    const sessions = await prisma.premiumContentSession.findMany({
      where,
      include: {
        purchase: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    console.error("Error fetching premium content sessions:", error);
    res.status(500).json({ success: false, message: "세션 목록 조회에 실패했습니다." });
  }
});

// 프리미엄 콘텐츠 세션 업데이트
router.patch("/sessions/:sessionId", authenticateUser, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;
    const { selectedCard, sessionData, cardData, resultData, status, isCompleted } = req.body;

    // 세션 소유권 확인
    const existingSession = await prisma.premiumContentSession.findFirst({
      where: {
        id: parseInt(sessionId),
        userId,
      },
    });

    if (!existingSession) {
      return res.status(404).json({ success: false, message: "세션을 찾을 수 없습니다." });
    }

    // 업데이트 데이터 구성
    const updateData = {};
    if (selectedCard !== undefined) updateData.selectedCard = selectedCard;
    if (sessionData !== undefined) updateData.sessionData = sessionData;
    if (cardData !== undefined) updateData.cardData = cardData;
    if (resultData !== undefined) updateData.resultData = resultData;
    if (status !== undefined) updateData.status = status;
    if (isCompleted !== undefined) updateData.isCompleted = isCompleted;

    const session = await prisma.premiumContentSession.update({
      where: { id: parseInt(sessionId) },
      data: updateData,
    });

    res.json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("Error updating premium content session:", error);
    res.status(500).json({ success: false, message: "세션 업데이트에 실패했습니다." });
  }
});

// 세션 완료 처리
router.post("/sessions/:sessionId/complete", authenticateUser, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;
    const { resultData } = req.body;

    const session = await prisma.premiumContentSession.updateMany({
      where: {
        id: parseInt(sessionId),
        userId,
      },
      data: {
        status: "COMPLETED",
        isCompleted: true,
        resultData,
      },
    });

    if (session.count === 0) {
      return res.status(404).json({ success: false, message: "세션을 찾을 수 없습니다." });
    }

    const updatedSession = await prisma.premiumContentSession.findUnique({
      where: { id: parseInt(sessionId) },
    });

    res.json({
      success: true,
      data: updatedSession,
    });
  } catch (error) {
    console.error("Error completing premium content session:", error);
    res.status(500).json({ success: false, message: "세션 완료 처리에 실패했습니다." });
  }
});

// 구매 연결
router.post("/sessions/:sessionId/purchase", authenticateUser, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;
    const { orderId, sku, amount } = req.body;

    // 세션 확인
    const session = await prisma.premiumContentSession.findFirst({
      where: {
        id: parseInt(sessionId),
        userId,
      },
    });

    if (!session) {
      return res.status(404).json({ success: false, message: "세션을 찾을 수 없습니다." });
    }

    // 이미 구매된 경우
    if (session.isPurchased) {
      return res.status(400).json({ success: false, message: "이미 구매된 세션입니다." });
    }

    // 구매 기록 생성
    const purchase = await prisma.purchase.create({
      data: {
        userId,
        orderId,
        sku,
        productType: "PREMIUM_CONTENT",
        status: "COMPLETED",
        amount,
        metadata: {
          contentType: session.contentType,
          sessionId: session.id,
        },
      },
    });

    // 세션 업데이트
    const updatedSession = await prisma.premiumContentSession.update({
      where: { id: parseInt(sessionId) },
      data: {
        purchaseId: purchase.id,
        isPurchased: true,
      },
      include: {
        purchase: true,
      },
    });

    res.json({
      success: true,
      data: updatedSession,
    });
  } catch (error) {
    console.error("Error processing purchase:", error);
    res.status(500).json({ success: false, message: "구매 처리에 실패했습니다." });
  }
});

// 구매 여부 확인
router.get("/sessions/:sessionId/purchase-status", authenticateUser, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const session = await prisma.premiumContentSession.findFirst({
      where: {
        id: parseInt(sessionId),
        userId,
      },
      include: {
        purchase: true,
      },
    });

    if (!session) {
      return res.status(404).json({ success: false, message: "세션을 찾을 수 없습니다." });
    }

    res.json({
      success: true,
      isPurchased: session.isPurchased,
      purchase: session.purchase,
    });
  } catch (error) {
    console.error("Error checking purchase status:", error);
    res.status(500).json({ success: false, message: "구매 상태 확인에 실패했습니다." });
  }
});

// 프리미엄 콘텐츠 해석 생성 (USE_MOCK_DATA=true이면 mock, 아니면 Claude API)
router.post("/generate-interpretation", authenticateUser, async (req, res) => {
  try {
    const { mindReadingId, cards, userProfile, cardDataContext } = req.body;

    if (!mindReadingId) {
      return res.status(400).json({ success: false, message: "mindReadingId가 필요합니다." });
    }

    const parsedId = parseInt(mindReadingId);

    // PremiumContentSession 찾기 또는 MindReading 기반으로 생성
    let session = null;

    if (!isNaN(parsedId)) {
      session = await prisma.premiumContentSession.findFirst({
        where: { id: parsedId, userId: req.user.id },
      });
    }

    if (!session) {
      // 같은 사용자의 mind-reading 세션 찾기
      session = await prisma.premiumContentSession.findFirst({
        where: {
          userId: req.user.id,
          contentType: "mind-reading",
          selectedCard: cards?.card1?.number,
        },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!session) {
      // 세션이 없으면 새로 생성
      session = await prisma.premiumContentSession.create({
        data: {
          userId: req.user.id,
          contentType: "mind-reading",
          selectedCard: cards?.card1?.number,
          userProfile: userProfile || {},
          status: "IN_PROGRESS",
        },
      });
      console.log("[generate-interpretation] 새 PremiumContentSession 생성:", session.id);
    }

    // 이미 결과가 있으면 캐싱된 결과 반환
    if (session.resultData) {
      return res.json({ success: true, data: session.resultData });
    }

    let interpretation;
    const useMock = process.env.USE_MOCK_DATA === "true";

    if (useMock) {
      // Mock 데이터 반환
      interpretation = require("../mocks/mind-reading-premium-response.json");
      console.log("[generate-interpretation] Mock 데이터 사용");
    } else {
      // 실제 Claude API 호출
      console.log("[generate-interpretation] Claude API 호출 시작");
      const resolvedCardData = cardDataContext || loadCardDataContext(cards);
      try {
        interpretation = await generateInterpretation(cards, userProfile, resolvedCardData);
        console.log("[generate-interpretation] Claude API 호출 성공");
      } catch (apiError) {
        console.error("[generate-interpretation] Claude API 호출 실패:", apiError.message);
        return res.status(502).json({
          success: false,
          message: "AI 해석 생성에 실패했습니다. 잠시 후 다시 시도해주세요.",
          error: process.env.NODE_ENV === "development" ? apiError.message : undefined,
        });
      }
    }

    // 트랜잭션으로 결과 저장 (데이터 정합성 보장)
    await prisma.$transaction(async (tx) => {
      await tx.premiumContentSession.update({
        where: { id: session.id },
        data: {
          additionalCards: cards,
          resultData: interpretation,
          status: "COMPLETED",
        },
      });
    });

    console.log(`[generate-interpretation] 세션 ${session.id} 결과 저장 완료`);
    res.json({ success: true, data: interpretation });
  } catch (error) {
    console.error("Error generating interpretation:", error);
    res.status(500).json({ success: false, message: "해석 생성에 실패했습니다." });
  }
});

// 콘텐츠 타입별 구매 여부 확인 (특정 콘텐츠를 이미 구매했는지)
router.get("/purchase-check", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { contentType } = req.query;

    const purchasedSession = await prisma.premiumContentSession.findFirst({
      where: {
        userId,
        contentType,
        isPurchased: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      success: true,
      hasPurchased: !!purchasedSession,
      session: purchasedSession,
    });
  } catch (error) {
    console.error("Error checking purchase:", error);
    res.status(500).json({ success: false, message: "구매 확인에 실패했습니다." });
  }
});

module.exports = router;
