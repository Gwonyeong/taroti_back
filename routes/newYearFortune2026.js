const express = require('express');
const prisma = require('../lib/prisma');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const router = express.Router();


// JWT 토큰에서 사용자 ID 추출하는 미들웨어
const extractUserFromToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    }
  } catch (error) {
    // 토큰이 유효하지 않아도 계속 진행 (익명 사용자도 허용)
  }
  next();
};

// 2026년 신년 운세 세션 생성 (새로운 통합 시스템으로 리다이렉션)
router.post('/', extractUserFromToken, async (req, res) => {
  try {
    const { fortuneType, selectedCardNumber, year = 2026, period = "상반기" } = req.body;

    // 입력 검증
    if (!fortuneType || selectedCardNumber === undefined) {
      return res.status(400).json({
        success: false,
        message: '운세 타입과 선택된 카드 번호가 필요합니다.'
      });
    }

    if (selectedCardNumber < 0 || selectedCardNumber > 21) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 카드 번호입니다. (0-21)'
      });
    }

    // 새로운 통합 시스템으로 리다이렉션
    // NewYear 2026 템플릿 찾기
    const template = await prisma.fortuneTemplate.findUnique({
      where: { templateKey: 'newyear-2026' }
    });

    if (!template) {
      return res.status(500).json({
        success: false,
        message: 'NewYear 2026 템플릿을 찾을 수 없습니다.'
      });
    }

    // 새로운 Fortune Session 생성
    const fortuneSession = await prisma.fortuneSession.create({
      data: {
        templateId: template.id,
        userId: req.user?.userId || null,
        selectedCard: selectedCardNumber,
        sessionMetadata: {
          fortuneType,
          year,
          period,
          legacyApi: 'newyear-2026'
        },
        fortuneData: {
          selectedCard: selectedCardNumber,
          createdAt: new Date().toISOString(),
          userAgent: req.headers['user-agent'] || null,
        }
      },
      include: {
        template: true,
        user: req.user?.userId ? {
          select: {
            id: true,
            nickname: true,
            profileImageUrl: true
          }
        } : false
      }
    });

    res.json({
      success: true,
      fortuneId: fortuneSession.id,
      message: '2026년 신년 운세 세션이 생성되었습니다.'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.'
    });
  }
});

// 2026년 신년 운세 결과 조회 (새로운 통합 시스템으로 리다이렉션)
router.get('/:fortuneId', async (req, res) => {
  try {
    const { fortuneId } = req.params;

    // fortuneId 검증
    const parsedId = parseInt(fortuneId);
    if (isNaN(parsedId)) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 운세 ID입니다.'
      });
    }

    // 먼저 새로운 시스템에서 찾기
    const fortuneSession = await prisma.fortuneSession.findFirst({
      where: {
        id: parsedId,
        template: {
          templateKey: 'newyear-2026'
        }
      },
      include: {
        template: true,
        user: {
          select: {
            id: true,
            nickname: true,
            profileImageUrl: true
          }
        }
      }
    });

    if (fortuneSession) {
      // 새로운 시스템 데이터를 기존 형식으로 변환
      const responseData = {
        id: fortuneSession.id,
        fortuneType: fortuneSession.sessionMetadata?.fortuneType || "2026년 상반기 운세",
        selectedCard: fortuneSession.selectedCard,
        year: fortuneSession.sessionMetadata?.year || 2026,
        period: fortuneSession.sessionMetadata?.period || "상반기",
        user: fortuneSession.user,
        createdAt: fortuneSession.createdAt,
        updatedAt: fortuneSession.updatedAt
      };

      return res.json({
        success: true,
        ...responseData
      });
    }

    // 새로운 시스템에 없으면 기존 시스템에서 찾기 (호환성을 위해)
    const legacyFortuneSession = await prisma.newYearFortune2026.findUnique({
      where: { id: parsedId },
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            profileImageUrl: true
          }
        }
      }
    });

    if (!legacyFortuneSession) {
      return res.status(404).json({
        success: false,
        message: '운세 세션을 찾을 수 없습니다.'
      });
    }

    // 응답 데이터 구성
    const responseData = {
      id: legacyFortuneSession.id,
      fortuneType: legacyFortuneSession.fortuneType,
      selectedCard: legacyFortuneSession.selectedCard,
      year: legacyFortuneSession.year,
      period: legacyFortuneSession.period,
      user: legacyFortuneSession.user,
      createdAt: legacyFortuneSession.createdAt,
      updatedAt: legacyFortuneSession.updatedAt
    };

    res.json({
      success: true,
      ...responseData
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.'
    });
  }
});

// 2026년 신년 운세 공유 링크 생성 (새로운 통합 시스템으로 리다이렉션)
router.post('/:fortuneId/share', async (req, res) => {
  try {
    const { fortuneId } = req.params;
    const { title, description, image, cardName, nickname, fortuneType } = req.body;

    // fortuneId 검증
    const parsedId = parseInt(fortuneId);
    if (isNaN(parsedId)) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 운세 ID입니다.'
      });
    }

    // 먼저 새로운 시스템에서 찾기
    const fortuneSession = await prisma.fortuneSession.findFirst({
      where: {
        id: parsedId,
        template: {
          templateKey: 'newyear-2026'
        }
      },
      include: {
        template: true,
        user: {
          select: {
            id: true,
            nickname: true,
            profileImageUrl: true
          }
        }
      }
    });

    let fortuneData;
    if (fortuneSession) {
      // 새로운 시스템 데이터를 기존 형식으로 변환
      fortuneData = {
        id: fortuneSession.id,
        fortuneType: fortuneSession.sessionMetadata?.fortuneType || "2026년 상반기 운세",
        selectedCard: fortuneSession.selectedCard,
        year: fortuneSession.sessionMetadata?.year || 2026,
        period: fortuneSession.sessionMetadata?.period || "상반기",
        user: fortuneSession.user
      };
    } else {
      // 기존 시스템에서 찾기 (호환성을 위해)
      const legacyFortuneSession = await prisma.newYearFortune2026.findUnique({
        where: { id: parsedId },
        include: {
          user: {
            select: {
              id: true,
              nickname: true,
              profileImageUrl: true
            }
          }
        }
      });

      if (!legacyFortuneSession) {
        return res.status(404).json({
          success: false,
          message: '운세 세션을 찾을 수 없습니다.'
        });
      }
      fortuneData = legacyFortuneSession;
    }

    // 고유한 공유 ID 생성
    const shareId = crypto.randomUUID();

    // 공유할 운세 데이터 구성
    const shareData = {
      originalFortuneId: fortuneData.id,
      fortuneType: fortuneData.fortuneType,
      selectedCard: fortuneData.selectedCard,
      year: fortuneData.year,
      period: fortuneData.period,
      nickname: nickname || fortuneData.user?.nickname || "타로티 친구",
      cardName: cardName,
      shareType: 'newyear-2026',
      createdAt: new Date().toISOString()
    };

    // 메타데이터 구성
    const metadata = {
      title: title || `${shareData.nickname}님의 2026년 상반기 운세`,
      description: description || "새로운 한 해의 운세를 확인해보세요!",
      image: image,
      cardName: cardName,
      nickname: shareData.nickname,
      fortuneType: fortuneType || "2026년 상반기 운세"
    };

    // ShareLink에 저장 (기존 테이블 재활용, originalFortuneId는 unique이므로 upsert 사용)
    const shareLink = await prisma.shareLink.create({
      data: {
        shareId,
        originalFortuneId: fortuneData.id,
        fortuneData: shareData,
        metadata: metadata
      }
    });

    res.json({
      success: true,
      shareId: shareLink.shareId,
      shareUrl: `/share-newyear-2026/${shareLink.shareId}`,
      message: '공유 링크가 생성되었습니다.'
    });

  } catch (error) {

    // Unique constraint 오류 처리 (이미 공유 링크가 존재하는 경우)
    if (error.code === 'P2002') {
      try {
        const existingShare = await prisma.shareLink.findUnique({
          where: { originalFortuneId: parseInt(req.params.fortuneId) }
        });

        if (existingShare) {
          return res.json({
            success: true,
            shareId: existingShare.shareId,
            shareUrl: `/share-newyear-2026/${existingShare.shareId}`,
            message: '기존 공유 링크를 반환합니다.'
          });
        }
      } catch (fetchError) {
      }
    }

    res.status(500).json({
      success: false,
      message: '공유 링크 생성 중 오류가 발생했습니다.'
    });
  }
});

// 사용자별 2026년 신년 운세 목록 조회 (새로운 통합 시스템으로 리다이렉션)
router.get('/user/list', extractUserFromToken, async (req, res) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: '인증이 필요합니다.'
      });
    }

    // 새로운 시스템에서 조회
    const newFortuneList = await prisma.fortuneSession.findMany({
      where: {
        userId: req.user.userId,
        template: {
          templateKey: 'newyear-2026'
        }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        selectedCard: true,
        sessionMetadata: true,
        createdAt: true
      }
    });

    // 기존 시스템에서 조회 (호환성을 위해)
    const legacyFortuneList = await prisma.newYearFortune2026.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fortuneType: true,
        selectedCard: true,
        year: true,
        period: true,
        createdAt: true
      }
    });

    // 새로운 시스템 데이터를 기존 형식으로 변환
    const newFormatted = newFortuneList.map(item => ({
      id: item.id,
      fortuneType: item.sessionMetadata?.fortuneType || "2026년 상반기 운세",
      selectedCard: item.selectedCard,
      year: item.sessionMetadata?.year || 2026,
      period: item.sessionMetadata?.period || "상반기",
      createdAt: item.createdAt
    }));

    // 두 시스템의 데이터 합치기 및 정렬
    const combinedList = [...newFormatted, ...legacyFortuneList]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      fortunes: combinedList,
      count: combinedList.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다.'
    });
  }
});

module.exports = router;