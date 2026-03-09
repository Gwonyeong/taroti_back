const express = require('express');
const prisma = require('../lib/prisma');
const router = express.Router();

// 클로버 잔액 조회
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
      select: { id: true, cloverBalance: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.',
      });
    }

    res.json({
      success: true,
      cloverBalance: user.cloverBalance,
    });
  } catch (error) {
    console.error('클로버 잔액 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '클로버 잔액을 조회하는 중 오류가 발생했습니다.',
    });
  }
});

// 클로버 거래 내역 조회
router.get('/user/:userId/transactions', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = '20', offset = '0', type } = req.query;

    const where = { userId: parseInt(userId) };
    if (type) {
      where.type = type;
    }

    const [transactions, totalCount] = await Promise.all([
      prisma.cloverTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.cloverTransaction.count({ where }),
    ]);

    res.json({
      success: true,
      transactions,
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: totalCount > parseInt(offset) + parseInt(limit),
      },
    });
  } catch (error) {
    console.error('클로버 거래 내역 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '거래 내역을 조회하는 중 오류가 발생했습니다.',
    });
  }
});

// 클로버 지급
router.post('/grant', async (req, res) => {
  try {
    const { userId, amount, reason } = req.body;

    if (!userId || !amount || !reason) {
      return res.status(400).json({
        success: false,
        message: 'userId, amount, reason은 필수입니다.',
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: '지급 수량은 0보다 커야 합니다.',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: parseInt(userId) },
        data: { cloverBalance: { increment: amount } },
        select: { id: true, cloverBalance: true },
      });

      const transaction = await tx.cloverTransaction.create({
        data: {
          userId: parseInt(userId),
          amount,
          type: 'EARN',
          reason,
          balanceAfter: user.cloverBalance,
        },
      });

      return { user, transaction };
    });

    res.json({
      success: true,
      message: `${amount} 클로버가 지급되었습니다.`,
      cloverBalance: result.user.cloverBalance,
      transaction: result.transaction,
    });
  } catch (error) {
    console.error('클로버 지급 오류:', error);
    res.status(500).json({
      success: false,
      message: '클로버 지급 중 오류가 발생했습니다.',
    });
  }
});

// 클로버 차감
router.post('/spend', async (req, res) => {
  try {
    const { userId, amount, reason } = req.body;

    if (!userId || !amount || !reason) {
      return res.status(400).json({
        success: false,
        message: 'userId, amount, reason은 필수입니다.',
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: '차감 수량은 0보다 커야 합니다.',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: parseInt(userId) },
        select: { cloverBalance: true },
      });

      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      if (user.cloverBalance < amount) {
        throw new Error('INSUFFICIENT_BALANCE');
      }

      const updatedUser = await tx.user.update({
        where: { id: parseInt(userId) },
        data: { cloverBalance: { decrement: amount } },
        select: { id: true, cloverBalance: true },
      });

      const transaction = await tx.cloverTransaction.create({
        data: {
          userId: parseInt(userId),
          amount: -amount,
          type: 'SPEND',
          reason,
          balanceAfter: updatedUser.cloverBalance,
        },
      });

      return { user: updatedUser, transaction };
    });

    res.json({
      success: true,
      message: `${amount} 클로버가 차감되었습니다.`,
      cloverBalance: result.user.cloverBalance,
      transaction: result.transaction,
    });
  } catch (error) {
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        message: '사용자를 찾을 수 없습니다.',
      });
    }
    if (error.message === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({
        success: false,
        message: '클로버가 부족합니다.',
      });
    }
    console.error('클로버 차감 오류:', error);
    res.status(500).json({
      success: false,
      message: '클로버 차감 중 오류가 발생했습니다.',
    });
  }
});

// 클로버로 프리미엄 콘텐츠 구매
const CLOVER_PURCHASE_COST = 30;

router.post('/purchase-premium', async (req, res) => {
  try {
    const { userId, sessionId, contentType } = req.body;

    if (!userId || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'userId와 sessionId가 필요합니다.',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. 잔액 확인
      const user = await tx.user.findUnique({
        where: { id: parseInt(userId) },
        select: { cloverBalance: true },
      });

      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      if (user.cloverBalance < CLOVER_PURCHASE_COST) {
        throw new Error('INSUFFICIENT_BALANCE');
      }

      // 2. 이미 구매된 세션인지 확인
      const session = await tx.premiumContentSession.findUnique({
        where: { id: parseInt(sessionId) },
      });

      if (!session) {
        throw new Error('SESSION_NOT_FOUND');
      }

      if (session.isPurchased) {
        throw new Error('ALREADY_PURCHASED');
      }

      // 3. 클로버 차감
      const updatedUser = await tx.user.update({
        where: { id: parseInt(userId) },
        data: { cloverBalance: { decrement: CLOVER_PURCHASE_COST } },
        select: { id: true, cloverBalance: true },
      });

      // 4. 클로버 거래 기록
      await tx.cloverTransaction.create({
        data: {
          userId: parseInt(userId),
          amount: -CLOVER_PURCHASE_COST,
          type: 'SPEND',
          reason: `프리미엄 콘텐츠 구매 (${contentType || 'premium'})`,
          balanceAfter: updatedUser.cloverBalance,
        },
      });

      // 5. 세션 구매 완료 처리
      await tx.premiumContentSession.update({
        where: { id: parseInt(sessionId) },
        data: { isPurchased: true },
      });

      return { cloverBalance: updatedUser.cloverBalance };
    });

    res.json({
      success: true,
      message: '클로버로 구매가 완료되었습니다.',
      cloverBalance: result.cloverBalance,
    });
  } catch (error) {
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
    }
    if (error.message === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ success: false, message: '클로버가 부족합니다.' });
    }
    if (error.message === 'SESSION_NOT_FOUND') {
      return res.status(404).json({ success: false, message: '세션을 찾을 수 없습니다.' });
    }
    if (error.message === 'ALREADY_PURCHASED') {
      return res.json({ success: true, message: '이미 구매된 콘텐츠입니다.' });
    }
    console.error('클로버 프리미엄 구매 오류:', error);
    res.status(500).json({ success: false, message: '구매 처리 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
