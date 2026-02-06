const express = require('express');
const prisma = require('../lib/prisma');

const router = express.Router();



// 추천 콘텐츠 목록 조회 (공개 API - 인증 불필요)
router.get('/', async (req, res) => {
  try {
    const {
      active = 'true',
      page_type,
      limit = '6',
      offset = '0'
    } = req.query;

    // 쿼리 조건 구성
    const where = {};

    if (active === 'true') {
      where.active = true;
      // 연결된 콘텐츠도 활성화 상태여야 함
      where.content = {
        active: true
      };
    } else if (active === 'false') {
      where.active = false;
    }

    // 페이지 타입별 필터링
    if (page_type === 'december-fortune') {
      where.showOnDecemberFortune = true;
    } else if (page_type === 'newyear-fortune') {
      where.showOnNewYearFortune = true;
    } else if (page_type === 'mind-reading') {
      where.showOnMindReading = true;
    }

    const recommendations = await prisma.contentRecommendation.findMany({
      where,
      include: {
        content: true
      },
      orderBy: [
        { sortOrder: 'asc' },
        { createdAt: 'desc' }
      ],
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    const formattedRecommendations = recommendations.map(rec => ({
      id: rec.id,
      title: rec.content.title,
      description: rec.content.description,
      imageUrl: rec.content.image_url,
      linkUrl: rec.content.link_url,
      category: 'general', // 기본값
      tags: [], // 기본값
      viewCount: rec.viewCount,
      clickCount: rec.clickCount,
      // 추천 관련 정보
      recommendationId: rec.id,
      contentId: rec.contentId,
      sortOrder: rec.sortOrder
    }));

    res.json({
      success: true,
      recommendations: formattedRecommendations,
      count: formattedRecommendations.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '콘텐츠 추천 목록을 가져오는 중 오류가 발생했습니다.'
    });
  }
});

// 추천 콘텐츠 관리용 목록 조회 (어드민)
router.get('/admin', async (req, res) => {
  try {
    const {
      active,
      search,
      limit = '20',
      offset = '0'
    } = req.query;

    // 쿼리 조건 구성
    const where = {};

    if (active === 'true') {
      where.active = true;
    } else if (active === 'false') {
      where.active = false;
    }

    if (search) {
      where.OR = [
        {
          content: {
            title: { contains: search, mode: 'insensitive' }
          }
        },
        {
          content: {
            description: { contains: search, mode: 'insensitive' }
          }
        }
      ];
    }

    const [recommendations, totalCount] = await Promise.all([
      prisma.contentRecommendation.findMany({
        where,
        include: {
          content: true
        },
        orderBy: { sortOrder: 'asc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      }),
      prisma.contentRecommendation.count({ where })
    ]);

    const formattedRecommendations = recommendations.map(rec => ({
      id: rec.id,
      contentId: rec.contentId,
      content: {
        id: rec.content.id,
        title: rec.content.title,
        description: rec.content.description,
        imageUrl: rec.content.image_url,
        linkUrl: rec.content.link_url,
        active: rec.content.active,
        sortOrder: rec.content.sort_order
      },
      active: rec.active,
      sortOrder: rec.sortOrder,
      viewCount: rec.viewCount,
      clickCount: rec.clickCount,
      showOnDecemberFortune: rec.showOnDecemberFortune,
      showOnNewYearFortune: rec.showOnNewYearFortune,
      showOnMindReading: rec.showOnMindReading,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt
    }));

    res.json({
      success: true,
      recommendations: formattedRecommendations,
      totalCount,
      page: Math.floor(parseInt(offset) / parseInt(limit)) + 1,
      totalPages: Math.ceil(totalCount / parseInt(limit))
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '관리자 콘텐츠 목록을 가져오는 중 오류가 발생했습니다.'
    });
  }
});

// 특정 추천 콘텐츠 조회
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const recommendation = await prisma.contentRecommendation.findUnique({
      where: { id: parseInt(id) },
      include: {
        content: true
      }
    });

    if (!recommendation) {
      return res.status(404).json({
        success: false,
        message: '추천 콘텐츠를 찾을 수 없습니다.'
      });
    }

    const formattedRecommendation = {
      id: recommendation.id,
      contentId: recommendation.contentId,
      content: {
        id: recommendation.content.id,
        title: recommendation.content.title,
        description: recommendation.content.description,
        imageUrl: recommendation.content.image_url,
        linkUrl: recommendation.content.link_url,
        active: recommendation.content.active,
        sortOrder: recommendation.content.sort_order
      },
      active: recommendation.active,
      sortOrder: recommendation.sortOrder,
      viewCount: recommendation.viewCount,
      clickCount: recommendation.clickCount,
      showOnDecemberFortune: recommendation.showOnDecemberFortune,
      showOnNewYearFortune: recommendation.showOnNewYearFortune,
      showOnMindReading: recommendation.showOnMindReading,
      createdAt: recommendation.createdAt,
      updatedAt: recommendation.updatedAt
    };

    res.json({
      success: true,
      recommendation: formattedRecommendation
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '추천 콘텐츠 정보를 가져오는 중 오류가 발생했습니다.'
    });
  }
});

// 추천 콘텐츠 생성 (어드민)
router.post('/', async (req, res) => {
  try {
    const {
      contentId,
      showOnDecemberFortune = true,
      showOnNewYearFortune = true,
      showOnMindReading = false,
      sortOrder = 0
    } = req.body;

    // 입력 검증
    if (!contentId) {
      return res.status(400).json({
        success: false,
        message: '콘텐츠 ID는 필수입니다.'
      });
    }

    // 콘텐츠 존재 여부 확인
    const content = await prisma.content.findUnique({
      where: { id: parseInt(contentId) }
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: '선택한 콘텐츠를 찾을 수 없습니다.'
      });
    }

    // 이미 추천에 등록된 콘텐츠인지 확인
    const existingRecommendation = await prisma.contentRecommendation.findFirst({
      where: { contentId: parseInt(contentId) }
    });

    if (existingRecommendation) {
      return res.status(400).json({
        success: false,
        message: '이미 추천 목록에 등록된 콘텐츠입니다.'
      });
    }

    const recommendation = await prisma.contentRecommendation.create({
      data: {
        contentId: parseInt(contentId),
        showOnDecemberFortune,
        showOnNewYearFortune,
        showOnMindReading,
        sortOrder
      },
      include: {
        content: true
      }
    });

    const formattedRecommendation = {
      id: recommendation.id,
      contentId: recommendation.contentId,
      content: {
        id: recommendation.content.id,
        title: recommendation.content.title,
        description: recommendation.content.description,
        imageUrl: recommendation.content.image_url,
        linkUrl: recommendation.content.link_url,
        active: recommendation.content.active,
        sortOrder: recommendation.content.sort_order
      },
      active: recommendation.active,
      sortOrder: recommendation.sortOrder,
      showOnDecemberFortune: recommendation.showOnDecemberFortune,
      showOnNewYearFortune: recommendation.showOnNewYearFortune,
      showOnMindReading: recommendation.showOnMindReading,
      createdAt: recommendation.createdAt,
      updatedAt: recommendation.updatedAt
    };

    res.status(201).json({
      success: true,
      message: '추천 콘텐츠가 생성되었습니다.',
      recommendation: formattedRecommendation
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '추천 콘텐츠 생성 중 오류가 발생했습니다.'
    });
  }
});

// 추천 콘텐츠 수정 (어드민)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      contentId,
      active,
      showOnDecemberFortune,
      showOnNewYearFortune,
      showOnMindReading,
      sortOrder
    } = req.body;

    // 존재 여부 확인
    const exists = await prisma.contentRecommendation.findUnique({
      where: { id: parseInt(id) }
    });

    if (!exists) {
      return res.status(404).json({
        success: false,
        message: '추천 콘텐츠를 찾을 수 없습니다.'
      });
    }

    // 콘텐츠 변경 시 존재 여부 및 중복 확인
    if (contentId !== undefined) {
      const content = await prisma.content.findUnique({
        where: { id: parseInt(contentId) }
      });

      if (!content) {
        return res.status(404).json({
          success: false,
          message: '선택한 콘텐츠를 찾을 수 없습니다.'
        });
      }

      // 다른 추천에 이미 등록된 콘텐츠인지 확인 (자기 자신 제외)
      const existingRecommendation = await prisma.contentRecommendation.findFirst({
        where: {
          contentId: parseInt(contentId),
          id: { not: parseInt(id) }
        }
      });

      if (existingRecommendation) {
        return res.status(400).json({
          success: false,
          message: '이미 다른 추천에 등록된 콘텐츠입니다.'
        });
      }
    }

    const updateData = {};
    if (contentId !== undefined) updateData.contentId = parseInt(contentId);
    if (active !== undefined) updateData.active = active;
    if (showOnDecemberFortune !== undefined) updateData.showOnDecemberFortune = showOnDecemberFortune;
    if (showOnNewYearFortune !== undefined) updateData.showOnNewYearFortune = showOnNewYearFortune;
    if (showOnMindReading !== undefined) updateData.showOnMindReading = showOnMindReading;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const recommendation = await prisma.contentRecommendation.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: {
        content: true
      }
    });

    const formattedRecommendation = {
      id: recommendation.id,
      contentId: recommendation.contentId,
      content: {
        id: recommendation.content.id,
        title: recommendation.content.title,
        description: recommendation.content.description,
        imageUrl: recommendation.content.image_url,
        linkUrl: recommendation.content.link_url,
        active: recommendation.content.active,
        sortOrder: recommendation.content.sort_order
      },
      active: recommendation.active,
      sortOrder: recommendation.sortOrder,
      showOnDecemberFortune: recommendation.showOnDecemberFortune,
      showOnNewYearFortune: recommendation.showOnNewYearFortune,
      showOnMindReading: recommendation.showOnMindReading,
      createdAt: recommendation.createdAt,
      updatedAt: recommendation.updatedAt
    };

    res.json({
      success: true,
      message: '추천 콘텐츠가 수정되었습니다.',
      recommendation: formattedRecommendation
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '추천 콘텐츠 수정 중 오류가 발생했습니다.'
    });
  }
});

// 추천 콘텐츠 삭제 (어드민)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 존재 여부 확인
    const exists = await prisma.contentRecommendation.findUnique({
      where: { id: parseInt(id) }
    });

    if (!exists) {
      return res.status(404).json({
        success: false,
        message: '추천 콘텐츠를 찾을 수 없습니다.'
      });
    }

    await prisma.contentRecommendation.delete({
      where: { id: parseInt(id) }
    });

    res.json({
      success: true,
      message: '추천 콘텐츠가 삭제되었습니다.'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '추천 콘텐츠 삭제 중 오류가 발생했습니다.'
    });
  }
});

// 추천 콘텐츠 클릭 카운트 증가
router.post('/:id/click', async (req, res) => {
  try {
    const { id } = req.params;

    const recommendation = await prisma.contentRecommendation.update({
      where: { id: parseInt(id) },
      data: {
        clickCount: {
          increment: 1
        }
      }
    });

    res.json({
      success: true,
      message: '클릭이 기록되었습니다.'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '클릭 기록 중 오류가 발생했습니다.'
    });
  }
});

// 추천 콘텐츠 조회수 증가
router.post('/:id/view', async (req, res) => {
  try {
    const { id } = req.params;

    const recommendation = await prisma.contentRecommendation.update({
      where: { id: parseInt(id) },
      data: {
        viewCount: {
          increment: 1
        }
      }
    });

    res.json({
      success: true,
      message: '조회가 기록되었습니다.'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '조회 기록 중 오류가 발생했습니다.'
    });
  }
});

// 추천 콘텐츠 순서 일괄 업데이트 (어드민)
router.patch('/reorder', async (req, res) => {
  try {
    const { updates } = req.body; // [{ id, sortOrder }, ...]

    if (!Array.isArray(updates)) {
      return res.status(400).json({
        success: false,
        message: '업데이트 정보가 배열 형태여야 합니다.'
      });
    }

    // 트랜잭션으로 순서 업데이트
    const results = await prisma.$transaction(
      updates.map(({ id, sortOrder }) =>
        prisma.contentRecommendation.update({
          where: { id: parseInt(id) },
          data: { sortOrder }
        })
      )
    );

    res.json({
      success: true,
      message: '추천 콘텐츠 순서가 업데이트되었습니다.',
      updatedCount: results.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '추천 콘텐츠 순서 변경 중 오류가 발생했습니다.'
    });
  }
});

// 활용 가능한 콘텐츠 목록 조회 (어드민용 - 추천 등록 시 사용)
router.get('/admin/available-contents', async (req, res) => {
  try {
    const { search, active = 'true' } = req.query;

    // 이미 추천에 등록된 콘텐츠 ID 조회
    const existingRecommendations = await prisma.contentRecommendation.findMany({
      select: { contentId: true }
    });
    const existingContentIds = existingRecommendations.map(r => r.contentId);

    // 쿼리 조건 구성
    const where = {
      id: {
        notIn: existingContentIds // 이미 등록된 콘텐츠는 제외
      }
    };

    if (active === 'true') {
      where.active = true;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    const contents = await prisma.content.findMany({
      where,
      orderBy: [
        { sort_order: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    const formattedContents = contents.map(content => ({
      id: content.id,
      title: content.title,
      description: content.description,
      imageUrl: content.image_url,
      linkUrl: content.link_url,
      active: content.active,
      sortOrder: content.sort_order,
      createdAt: content.createdAt,
      updatedAt: content.updatedAt
    }));

    res.json({
      success: true,
      contents: formattedContents
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '활용 가능한 콘텐츠 목록을 가져오는 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;