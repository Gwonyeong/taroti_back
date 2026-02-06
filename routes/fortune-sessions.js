const express = require('express');
const prisma = require('../lib/prisma');

const router = express.Router();


// 인증 미들웨어 (옵션: 로그인한 경우만)
// X-User-ID 헤더 (Toss 앱) 또는 JWT 토큰 지원
const authenticateOptionalToken = (req, res, next) => {
  try {
    // 1. X-User-ID 헤더 확인 (Toss 앱에서 전송)
    const headerUserId = req.headers['x-user-id'];
    if (headerUserId) {
      req.user = { userId: parseInt(headerUserId) };
      return next();
    }

    // 2. JWT 토큰 확인 (기존 방식)
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // 토큰이 없는 경우 비로그인 사용자로 처리
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
    // 토큰 검증 실패해도 비로그인 사용자로 처리
    req.user = null;
    next();
  }
};

// 운세 세션 생성 (템플릿 기반)
router.post('/template/:templateKey', authenticateOptionalToken, async (req, res) => {
  try {
    const { templateKey } = req.params;
    const {
      selectedCard,
      userProfileData, // { birthDate, gender, mbti }
      fortuneType
    } = req.body;

    // 템플릿 조회
    const template = await prisma.fortuneTemplate.findUnique({
      where: { templateKey, isActive: true }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        message: '활성화된 운세 템플릿을 찾을 수 없습니다.'
      });
    }

    // 사용자 상태 확인
    let userId = null;
    let shouldUpdateUserProfile = false;
    let userProfileSnapshot = null;
    let isAnonymous = true;

    if (req.user) {
      // 로그인 사용자
      userId = req.user.userId;
      isAnonymous = false;

      // 사용자 프로필 조회
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { birthDate: true, gender: true, mbti: true }
      });

      // 프로필이 불완전한 경우 업데이트 필요
      const requiredFields = JSON.parse(template.requiredFields || '[]');
      const missingFields = requiredFields.filter(field => !user[field]);

      if (missingFields.length > 0 && userProfileData) {
        shouldUpdateUserProfile = true;
      }
    } else {
      // 비로그인 사용자 - 프로필 데이터를 세션에 저장
      if (userProfileData) {
        userProfileSnapshot = userProfileData;
      }
    }

    // 트랜잭션으로 세션 생성 및 사용자 프로필 업데이트
    const result = await prisma.$transaction(async (tx) => {
      // 로그인 사용자 프로필 업데이트
      if (shouldUpdateUserProfile && userProfileData) {
        await tx.user.update({
          where: { id: userId },
          data: {
            birthDate: userProfileData.birthDate || undefined,
            gender: userProfileData.gender || undefined,
            mbti: userProfileData.mbti || undefined
          }
        });
      }

      // 운세 세션 생성
      const session = await tx.fortuneSession.create({
        data: {
          templateId: template.id,
          userId,
          selectedCard,
          isAnonymous,
          userProfileSnapshot: userProfileSnapshot ? JSON.stringify(userProfileSnapshot) : null,
          sessionMetadata: JSON.stringify({
            fortuneType: fortuneType || template.title,
            templateKey
          })
        }
      });

      return session;
    });

    res.status(201).json({
      success: true,
      message: '운세 세션이 생성되었습니다.',
      sessionId: result.id,
      fortuneId: result.id // 기존 호환성을 위해
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '운세 세션 생성 중 오류가 발생했습니다.'
    });
  }
});

// 운세 세션 조회
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.fortuneSession.findUnique({
      where: { id: parseInt(sessionId) },
      include: {
        template: true,
        user: {
          select: {
            id: true,
            nickname: true,
            birthDate: true,
            gender: true,
            mbti: true
          }
        }
      }
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: '운세 세션을 찾을 수 없습니다.'
      });
    }

    // 사용자 프로필 데이터 결합
    let userProfile = {};

    if (session.user) {
      // 로그인 사용자 프로필 사용
      userProfile = {
        birthDate: session.user.birthDate,
        gender: session.user.gender,
        mbti: session.user.mbti
      };
    } else if (session.userProfileSnapshot) {
      // 비로그인 사용자 스냅샷 사용
      userProfile = JSON.parse(session.userProfileSnapshot);
    }

    res.json({
      success: true,
      session: {
        id: session.id,
        selectedCard: session.selectedCard,
        userProfile,
        template: {
          id: session.template.id,
          templateKey: session.template.templateKey,
          title: session.template.title,
          description: session.template.description,
          category: session.template.category,
          imageUrl: session.template.imageUrl,
          characterInfo: typeof session.template.characterInfo === 'string'
            ? JSON.parse(session.template.characterInfo)
            : session.template.characterInfo,
          cardConfig: typeof session.template.cardConfig === 'string'
            ? JSON.parse(session.template.cardConfig)
            : session.template.cardConfig,
          fortuneSettings: typeof session.template.fortuneSettings === 'string'
            ? JSON.parse(session.template.fortuneSettings)
            : session.template.fortuneSettings,
          resultTemplateData: typeof session.template.resultTemplateData === 'string'
            ? JSON.parse(session.template.resultTemplateData)
            : session.template.resultTemplateData,
          theme: typeof session.template.theme === 'string'
            ? JSON.parse(session.template.theme)
            : session.template.theme,
          isActive: session.template.isActive,
          isPremium: session.template.isPremium
        },
        sessionMetadata: session.sessionMetadata ? JSON.parse(session.sessionMetadata) : {},
        isAnonymous: session.isAnonymous,
        createdAt: session.createdAt
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '운세 세션을 가져오는 중 오류가 발생했습니다.'
    });
  }
});

// 운세 결과 업데이트 (AI 생성 후 저장용)
router.patch('/:sessionId/result', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { fortuneData } = req.body;

    const session = await prisma.fortuneSession.update({
      where: { id: parseInt(sessionId) },
      data: {
        fortuneData: JSON.stringify(fortuneData)
      }
    });

    res.json({
      success: true,
      message: '운세 결과가 저장되었습니다.',
      sessionId: session.id
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '운세 결과 업데이트 중 오류가 발생했습니다.'
    });
  }
});

// 운세 세션 목록 조회 (관리자용)
router.get('/', async (req, res) => {
  try {
    const {
      templateKey,
      limit = '20',
      offset = '0',
      includeAnonymous = 'true'
    } = req.query;

    const where = {};
    if (templateKey) {
      where.template = { templateKey };
    }
    if (includeAnonymous === 'false') {
      where.isAnonymous = false;
    }

    const [sessions, totalCount] = await Promise.all([
      prisma.fortuneSession.findMany({
        where,
        include: {
          template: {
            select: {
              templateKey: true,
              title: true
            }
          },
          user: {
            select: {
              id: true,
              nickname: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      }),
      prisma.fortuneSession.count({ where })
    ]);

    res.json({
      success: true,
      sessions: sessions.map(session => ({
        id: session.id,
        template: session.template,
        user: session.user,
        selectedCard: session.selectedCard,
        isAnonymous: session.isAnonymous,
        hasResult: !!session.fortuneData,
        createdAt: session.createdAt
      })),
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: totalCount > parseInt(offset) + parseInt(limit)
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '운세 세션 목록을 가져오는 중 오류가 발생했습니다.'
    });
  }
});

// 캘린더용 특정 날짜 운세 조회 (더 구체적인 경로를 먼저 정의)
router.get('/user/:userId/calendar/date', async (req, res) => {
  try {
    const { userId } = req.params;
    const { date } = req.query; // YYYY-MM-DD 형식 (KST 기준)

    if (!date) {
      return res.status(400).json({
        success: false,
        message: '날짜(date) 파라미터가 필요합니다.'
      });
    }

    // KST 날짜를 UTC 범위로 변환 (KST = UTC+9)
    // KST 0시 = UTC 전날 15시, KST 23:59:59 = UTC 당일 14:59:59
    const [year, month, day] = date.split('-').map(Number);
    const startUTC = new Date(Date.UTC(year, month - 1, day, -9, 0, 0)); // KST 0시 -> UTC
    const endUTC = new Date(Date.UTC(year, month - 1, day, 14, 59, 59)); // KST 23:59:59 -> UTC

    const sessions = await prisma.fortuneSession.findMany({
      where: {
        userId: parseInt(userId),
        createdAt: {
          gte: startUTC,
          lte: endUTC
        }
      },
      include: {
        template: {
          select: {
            id: true,
            templateKey: true,
            title: true,
            imageUrl: true,
            cardConfig: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // 카드 이름 매핑 (메이저 아르카나)
    const cardNames = [
      '바보', '마법사', '여사제', '여황제', '황제', '교황',
      '연인', '전차', '힘', '은둔자', '운명의 수레바퀴', '정의',
      '매달린 사람', '죽음', '절제', '악마', '탑', '별',
      '달', '태양', '심판', '세계'
    ];

    const formattedSessions = sessions.map(session => ({
      id: session.id,
      selectedCard: session.selectedCard,
      cardName: cardNames[session.selectedCard] || `카드 ${session.selectedCard}`,
      template: {
        id: session.template.id,
        templateKey: session.template.templateKey,
        title: session.template.title,
        imageUrl: session.template.imageUrl
      },
      createdAt: session.createdAt
    }));

    res.json({
      success: true,
      date,
      sessions: formattedSessions,
      total: formattedSessions.length
    });

  } catch (error) {
    console.error('날짜별 운세 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '운세를 가져오는 중 오류가 발생했습니다.'
    });
  }
});

// 캘린더용 운세 기록 날짜 조회 (가벼운 API)
router.get('/user/:userId/calendar', async (req, res) => {
  try {
    const { userId } = req.params;
    const { year, month } = req.query; // 선택적: 특정 월만 조회

    const where = { userId: parseInt(userId) };

    // 특정 월만 조회하는 경우
    if (year && month) {
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);
      where.createdAt = {
        gte: startDate,
        lte: endDate
      };
    }

    const sessions = await prisma.fortuneSession.findMany({
      where,
      select: {
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // 날짜만 추출 (중복 제거 없이 전체 반환 - 프론트에서 처리)
    const dates = sessions.map(session => session.createdAt.toISOString());

    res.json({
      success: true,
      dates,
      total: dates.length
    });

  } catch (error) {
    console.error('캘린더 날짜 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '캘린더 날짜를 가져오는 중 오류가 발생했습니다.'
    });
  }
});

// 사용자별 운세 기록 조회 (일반적인 경로는 마지막에 정의)
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = '20', offset = '0' } = req.query;

    const [sessions, totalCount] = await Promise.all([
      prisma.fortuneSession.findMany({
        where: { userId: parseInt(userId) },
        include: {
          template: {
            select: {
              id: true,
              templateKey: true,
              title: true,
              description: true,
              imageUrl: true,
              category: true,
              cardConfig: true,
              fortuneSettings: true,
              resultTemplateData: true,
              characterInfo: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      }),
      prisma.fortuneSession.count({ where: { userId: parseInt(userId) } })
    ]);

    // JSON 필드 파싱
    const parsedSessions = sessions.map(session => {
      const template = session.template;
      return {
        id: session.id,
        selectedCard: session.selectedCard,
        createdAt: session.createdAt,
        template: {
          ...template,
          cardConfig: typeof template.cardConfig === 'string'
            ? JSON.parse(template.cardConfig)
            : template.cardConfig,
          fortuneSettings: typeof template.fortuneSettings === 'string'
            ? JSON.parse(template.fortuneSettings)
            : template.fortuneSettings,
          resultTemplateData: typeof template.resultTemplateData === 'string'
            ? JSON.parse(template.resultTemplateData)
            : template.resultTemplateData,
          characterInfo: typeof template.characterInfo === 'string'
            ? JSON.parse(template.characterInfo)
            : template.characterInfo
        }
      };
    });

    res.json({
      success: true,
      sessions: parsedSessions,
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: totalCount > parseInt(offset) + parseInt(limit)
      }
    });

  } catch (error) {
    console.error('사용자 운세 기록 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '운세 기록을 가져오는 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;