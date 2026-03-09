const express = require('express');
const prisma = require('../lib/prisma');

const router = express.Router();

const MAX_CLOVER_FROM_SHARE = 30; // 공유로 받을 수 있는 최대 클로버

// 인증 미들웨어 (X-User-ID 헤더 또는 JWT)
const authenticateOptionalToken = (req, res, next) => {
  try {
    const headerUserId = req.headers['x-user-id'];
    if (headerUserId) {
      req.user = { userId: parseInt(headerUserId) };
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);
    if (!token || token === 'null' || token === 'undefined') {
      req.user = null;
      return next();
    }

    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    req.user = null;
    next();
  }
};

// POST /api/viral-shares - 공유 이벤트 기록 + 클로버 지급
router.post('/', authenticateOptionalToken, async (req, res) => {
  try {
    if (!req.user) {
      return res.json({ success: true, message: '비로그인 사용자는 기록하지 않습니다.' });
    }

    const {
      moduleId,
      sentRewardsCount,
      sentRewardAmount,
      rewardUnit,
      closeReason
    } = req.body;

    if (!moduleId || sentRewardsCount === undefined) {
      return res.status(400).json({
        success: false,
        message: 'moduleId와 sentRewardsCount가 필요합니다.'
      });
    }

    const userId = req.user.userId;

    // 트랜잭션으로 기록 저장 + 클로버 지급을 원자적으로 처리
    const result = await prisma.$transaction(async (tx) => {
      // 1. 기존 누적 공유 수 조회
      const aggregate = await tx.viralShareLog.aggregate({
        where: { userId },
        _sum: { sentRewardsCount: true },
      });
      const previousTotal = aggregate._sum.sentRewardsCount || 0;

      // 2. 공유 기록 저장
      const log = await tx.viralShareLog.create({
        data: {
          userId,
          moduleId,
          sentRewardsCount,
          sentRewardAmount: sentRewardAmount ?? null,
          rewardUnit: rewardUnit ?? null,
          closeReason: closeReason ?? null
        }
      });

      // 3. 클로버 지급 계산 (1명 = 1클로버, 최대 30)
      const newTotal = previousTotal + sentRewardsCount;
      const previousClovers = Math.min(previousTotal, MAX_CLOVER_FROM_SHARE);
      const newClovers = Math.min(newTotal, MAX_CLOVER_FROM_SHARE);
      const cloversToGrant = newClovers - previousClovers;

      let cloverTransaction = null;
      if (cloversToGrant > 0) {
        const user = await tx.user.update({
          where: { id: userId },
          data: { cloverBalance: { increment: cloversToGrant } },
          select: { id: true, cloverBalance: true },
        });

        cloverTransaction = await tx.cloverTransaction.create({
          data: {
            userId,
            amount: cloversToGrant,
            type: 'EARN',
            reason: `친구 공유 리워드 (${sentRewardsCount}명 공유)`,
            balanceAfter: user.cloverBalance,
          },
        });
      }

      return { log, cloversToGrant, newTotal, cloverTransaction };
    });

    res.status(201).json({
      success: true,
      message: result.cloversToGrant > 0
        ? `공유 기록 저장 및 클로버 ${result.cloversToGrant}개 지급 완료`
        : '공유 기록이 저장되었습니다.',
      logId: result.log.id,
      cloversGranted: result.cloversToGrant,
      totalSharedCount: result.newTotal,
    });
  } catch (error) {
    console.error('공유 기록 저장 오류:', error);
    res.status(500).json({
      success: false,
      message: '공유 기록 저장 중 오류가 발생했습니다.'
    });
  }
});

// GET /api/viral-shares/summary - 누적 공유 수 및 클로버 지급 현황 조회
router.get('/summary', authenticateOptionalToken, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: '로그인이 필요합니다.'
      });
    }

    const userId = req.user.userId;

    const aggregate = await prisma.viralShareLog.aggregate({
      where: { userId },
      _sum: {
        sentRewardsCount: true,
        sentRewardAmount: true
      },
      _count: true
    });

    const totalSharedCount = aggregate._sum.sentRewardsCount || 0;
    const cloversEarned = Math.min(totalSharedCount, MAX_CLOVER_FROM_SHARE);
    const cloversRemaining = MAX_CLOVER_FROM_SHARE - cloversEarned;

    res.json({
      success: true,
      totalSharedCount,
      cloversEarned,
      cloversRemaining,
      maxClovers: MAX_CLOVER_FROM_SHARE,
      sessionCount: aggregate._count,
    });
  } catch (error) {
    console.error('공유 요약 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '공유 요약 조회 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;
