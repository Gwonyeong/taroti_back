const express = require('express');
const prisma = require('../lib/prisma');
const router = express.Router();

// 어제 콘텐츠별 이용자 수 조회
router.get('/yesterday-viewers', async (req, res) => {
  try {
    // KST 기준 어제 날짜 계산
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const yesterday = new Date(kstNow);
    yesterday.setDate(yesterday.getDate() - 1);

    const year = yesterday.getUTCFullYear();
    const month = yesterday.getUTCMonth(); // 0-indexed
    const day = yesterday.getUTCDate();

    // KST 어제 00:00:00 ~ 오늘 00:00:00 (UTC 기준)
    const startUTC = new Date(Date.UTC(year, month, day, -9, 0, 0));
    const endUTC = new Date(Date.UTC(year, month, day + 1, -9, 0, 0));

    // FortuneSession: 템플릿별 어제 이용자 수 (세션 수 기준)
    const fortuneStats = await prisma.fortuneSession.groupBy({
      by: ['templateId'],
      where: {
        createdAt: {
          gte: startUTC,
          lt: endUTC,
        },
      },
      _count: {
        id: true,
      },
    });

    // PremiumContentSession: 콘텐츠 타입별 어제 이용자 수
    const premiumStats = await prisma.premiumContentSession.groupBy({
      by: ['contentType'],
      where: {
        createdAt: {
          gte: startUTC,
          lt: endUTC,
        },
      },
      _count: {
        id: true,
      },
    });

    const fortuneViewers = {};
    fortuneStats.forEach((stat) => {
      fortuneViewers[stat.templateId] = stat._count.id;
    });

    const premiumViewers = {};
    premiumStats.forEach((stat) => {
      premiumViewers[stat.contentType] = stat._count.id;
    });

    res.json({
      success: true,
      fortuneViewers,
      premiumViewers,
    });
  } catch (error) {
    console.error('어제 이용자 수 통계 오류:', error);
    res.status(500).json({
      success: false,
      message: '통계를 가져오는 중 오류가 발생했습니다.',
    });
  }
});

module.exports = router;
