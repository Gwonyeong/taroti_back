const express = require("express");
const prisma = require("../lib/prisma");
const { getTossClient } = require("../lib/tossClient");

const router = express.Router();

// 출석체크 포인트 설정
const ATTENDANCE_CONFIG = {
  promotionCode: process.env.ATTENDANCE_PROMOTION_CODE || "ATTENDANCE_DAILY",
  amount: 3,
};

// 토스 프로모션 에러 코드 메시지 매핑
const TOSS_ERROR_MESSAGES = {
  4100: "프로모션 정보를 찾을 수 없어요",
  4109: "프로모션이 실행중이 아니에요",
  4110: "리워드를 지급/회수할 수 없어요 (재시도 필요)",
  4111: "리워드 지급내역을 찾을 수 없어요",
  4112: "프로모션 머니가 부족해요",
  4113: "이미 지급/회수된 내역이에요",
  4114: "1회 지급 금액을 초과했어요",
  4116: "최대 지급 금액이 예산을 초과했어요",
};

// 재시도 가능한 에러 코드
const RETRYABLE_ERROR_CODES = ["4110"];

// 오늘 날짜 문자열 생성 (KST 기준)
const getTodayKST = () => {
  const now = new Date();
  const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = kstDate.getUTCFullYear();
  const month = String(kstDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kstDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// 출석체크 포인트 지급 (Key 발급 + 지급까지 한번에 처리)
router.post("/attendance/grant", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId가 필요합니다.",
      });
    }

    const todayKST = getTodayKST();

    // 오늘 이미 출석체크 포인트를 받았는지 확인
    const existingReward = await prisma.pointReward.findUnique({
      where: {
        userId_rewardDate_rewardType: {
          userId: parseInt(userId),
          rewardDate: todayKST,
          rewardType: "ATTENDANCE",
        },
      },
    });

    if (existingReward) {
      // SUCCESS 상태인 경우에만 이미 지급됨 처리
      if (existingReward.status === "SUCCESS") {
        return res.status(409).json({
          success: false,
          message: "오늘은 이미 출석체크 포인트를 받았습니다.",
          alreadyRewarded: true,
          reward: {
            id: existingReward.id,
            amount: existingReward.amount,
            status: existingReward.status,
            rewardDate: existingReward.rewardDate,
          },
        });
      }

      // FAILED 상태인 경우 기존 레코드 삭제 후 재시도
      console.log(
        "[출석체크] 이전 FAILED 레코드 삭제 후 재시도:",
        existingReward.id,
      );
      await prisma.pointReward.delete({
        where: { id: existingReward.id },
      });
    }

    // 사용자의 토스 userKey 조회
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
      select: { tossUserKey: true },
    });

    if (!user?.tossUserKey) {
      return res.status(400).json({
        success: false,
        message: "토스 연동 정보가 없습니다.",
      });
    }

    const tossClient = getTossClient();
    let promotionKey;
    let executeResult;

    // 1. 토스 API로 프로모션 Key 발급
    try {
      const keyResponse = await tossClient.getPromotionRewardKey(
        ATTENDANCE_CONFIG.promotionCode,
        ATTENDANCE_CONFIG.amount,
        user.tossUserKey,
      );
      console.log("[토스 Key 발급 응답]", JSON.stringify(keyResponse, null, 2));
      promotionKey = keyResponse.success?.key;
    } catch (tossError) {
      console.error("토스 프로모션 Key 발급 실패:", tossError);
      return res.status(500).json({
        success: false,
        message: "포인트 지급 준비 중 오류가 발생했습니다.",
        errorCode: tossError.response?.data?.code,
        errorMessage: tossError.response?.data?.message,
      });
    }

    // 2. 발급받은 Key로 프로모션 리워드 지급 실행 (재시도 로직 포함)
    const MAX_RETRY = 3;
    let retryCount = 0;
    let lastError = null;

    while (retryCount <= MAX_RETRY) {
      console.log("[토스 프로모션 지급 요청 파라미터]", {
        promotionCode: ATTENDANCE_CONFIG.promotionCode,
        key: promotionKey,
        amount: ATTENDANCE_CONFIG.amount,
        userKey: user.tossUserKey,
        retryCount,
      });

      try {
        executeResult = await tossClient.executePromotionReward(
          ATTENDANCE_CONFIG.promotionCode,
          promotionKey,
          ATTENDANCE_CONFIG.amount,
          user.tossUserKey,
        );
        console.log(
          "[토스 프로모션 지급 응답]",
          JSON.stringify(executeResult, null, 2),
        );

        // 응답이 왔지만 FAIL인 경우 처리
        if (executeResult.resultType === "FAIL") {
          const errorCode = executeResult.error?.errorCode;
          const errorReason =
            executeResult.error?.reason ||
            TOSS_ERROR_MESSAGES[errorCode] ||
            "알 수 없는 오류";

          console.error(
            `[토스 프로모션 지급 실패] 에러코드: ${errorCode}, 사유: ${errorReason}`,
          );

          // 4110: 재시도 가능한 에러
          if (
            RETRYABLE_ERROR_CODES.includes(errorCode) &&
            retryCount < MAX_RETRY
          ) {
            retryCount++;
            console.log(
              `[토스 프로모션] ${errorCode} 에러, 재시도 ${retryCount}/${MAX_RETRY}`,
            );
            // 잠시 대기 후 재시도 (지수 백오프)
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * retryCount),
            );
            continue;
          }

          // 재시도 불가능한 에러 또는 재시도 횟수 초과: DB에 저장 후 종료
          await prisma.pointReward.create({
            data: {
              userId: parseInt(userId),
              promotionCode: ATTENDANCE_CONFIG.promotionCode,
              amount: ATTENDANCE_CONFIG.amount,
              rewardType: "ATTENDANCE",
              rewardDate: todayKST,
              status: "FAILED",
              errorCode: errorCode,
              errorMessage: errorReason,
            },
          });

          return res.status(500).json({
            success: false,
            message: errorReason,
            errorCode: errorCode,
          });
        }

        // 성공인 경우 루프 탈출
        break;
      } catch (tossError) {
        console.error(
          "[토스 프로모션 지급 HTTP 에러]",
          JSON.stringify(tossError.response?.data, null, 2),
        );
        lastError = tossError;

        // HTTP 에러도 재시도 시도
        if (retryCount < MAX_RETRY) {
          retryCount++;
          console.log(
            `[토스 프로모션] HTTP 에러, 재시도 ${retryCount}/${MAX_RETRY}`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * retryCount),
          );
          continue;
        }

        // 재시도 횟수 초과: 지급 실패 기록 저장
        await prisma.pointReward.create({
          data: {
            userId: parseInt(userId),
            promotionCode: ATTENDANCE_CONFIG.promotionCode,
            amount: ATTENDANCE_CONFIG.amount,
            rewardType: "ATTENDANCE",
            rewardDate: todayKST,
            status: "FAILED",
            errorCode:
              tossError.response?.data?.error?.errorCode?.toString() ||
              "HTTP_ERROR",
            errorMessage:
              tossError.response?.data?.error?.reason || tossError.message,
          },
        });

        return res.status(500).json({
          success: false,
          message: "포인트 지급 중 오류가 발생했습니다.",
          errorCode: tossError.response?.data?.error?.errorCode,
          errorMessage: tossError.response?.data?.error?.reason,
        });
      }
    }

    // 3. 지급 성공 기록 저장
    const reward = await prisma.pointReward.create({
      data: {
        userId: parseInt(userId),
        promotionCode: ATTENDANCE_CONFIG.promotionCode,
        amount: ATTENDANCE_CONFIG.amount,
        rewardType: "ATTENDANCE",
        rewardDate: todayKST,
        status: "SUCCESS",
        rewardKey: executeResult.success?.key || promotionKey,
      },
    });

    res.status(201).json({
      success: true,
      message: `${ATTENDANCE_CONFIG.amount}원이 지급되었습니다!`,
      reward: {
        id: reward.id,
        amount: reward.amount,
        status: reward.status,
        rewardDate: reward.rewardDate,
      },
    });
  } catch (error) {
    console.error("포인트 지급 오류:", error);
    res.status(500).json({
      success: false,
      message: "포인트 지급 중 오류가 발생했습니다.",
    });
  }
});

// 오늘 출석체크 여부 확인
router.get("/attendance/today/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const todayKST = getTodayKST();

    const existingReward = await prisma.pointReward.findUnique({
      where: {
        userId_rewardDate_rewardType: {
          userId: parseInt(userId),
          rewardDate: todayKST,
          rewardType: "ATTENDANCE",
        },
      },
    });

    res.json({
      success: true,
      hasRewardedToday: !!existingReward,
      reward: existingReward
        ? {
            id: existingReward.id,
            amount: existingReward.amount,
            status: existingReward.status,
            rewardDate: existingReward.rewardDate,
          }
        : null,
    });
  } catch (error) {
    console.error("출석체크 여부 확인 오류:", error);
    res.status(500).json({
      success: false,
      message: "출석체크 여부 확인 중 오류가 발생했습니다.",
    });
  }
});

// 사용자의 포인트 지급 기록 조회
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = "20", offset = "0" } = req.query;

    const [rewards, totalCount] = await Promise.all([
      prisma.pointReward.findMany({
        where: { userId: parseInt(userId) },
        orderBy: { createdAt: "desc" },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.pointReward.count({ where: { userId: parseInt(userId) } }),
    ]);

    // 총 지급 금액 계산 (SUCCESS 상태만)
    const totalAmount = await prisma.pointReward.aggregate({
      where: {
        userId: parseInt(userId),
        status: "SUCCESS",
      },
      _sum: {
        amount: true,
      },
    });

    res.json({
      success: true,
      rewards,
      totalAmount: totalAmount._sum.amount || 0,
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: totalCount > parseInt(offset) + parseInt(limit),
      },
    });
  } catch (error) {
    console.error("포인트 지급 기록 조회 오류:", error);
    res.status(500).json({
      success: false,
      message: "포인트 지급 기록 조회 중 오류가 발생했습니다.",
    });
  }
});

module.exports = router;
