const express = require('express');
const prisma = require('../lib/prisma');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Supabase client 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
const STORAGE_BUCKET = process.env.SUPABASE_BUCKET || 'taroti';

// 메모리 스토리지 사용 (파일을 디스크에 저장하지 않고 바로 Supabase로)
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('이미지 파일만 업로드 가능합니다.'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB 제한
  }
});

// 운세 템플릿 목록 조회 (관리자용)
router.get('/', async (req, res) => {
  try {
    const { includeInactive = 'false', type } = req.query;

    const where = {};
    if (includeInactive !== 'true') {
      where.isActive = true;
    }
    // type 필터링 (default, mini 등)
    if (type) {
      where.type = type;
    }

    const templates = await prisma.fortuneTemplate.findMany({
      where,
      orderBy: [
        { sortOrder: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    res.json({
      success: true,
      templates: templates.map(template => ({
        ...template,
        // JSON 필드들을 파싱해서 반환
        messageScenarios: typeof template.messageScenarios === 'string'
          ? JSON.parse(template.messageScenarios)
          : template.messageScenarios,
        requiredFields: typeof template.requiredFields === 'string'
          ? JSON.parse(template.requiredFields)
          : template.requiredFields,
        characterInfo: typeof template.characterInfo === 'string'
          ? JSON.parse(template.characterInfo)
          : template.characterInfo,
        cardConfig: typeof template.cardConfig === 'string'
          ? JSON.parse(template.cardConfig)
          : template.cardConfig,
        fortuneSettings: typeof template.fortuneSettings === 'string'
          ? JSON.parse(template.fortuneSettings)
          : template.fortuneSettings,
        resultTemplateData: typeof template.resultTemplateData === 'string'
          ? JSON.parse(template.resultTemplateData)
          : template.resultTemplateData,
        theme: typeof template.theme === 'string'
          ? JSON.parse(template.theme)
          : template.theme
      }))
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '운세 템플릿 목록을 가져오는 중 오류가 발생했습니다.'
    });
  }
});

// 특정 운세 템플릿 조회
router.get('/:templateKey', async (req, res) => {
  try {
    const { templateKey } = req.params;

    const template = await prisma.fortuneTemplate.findUnique({
      where: { templateKey },
      include: {
        character: true,
        _count: {
          select: { sessions: true }
        }
      }
    });

    if (!template) {
      return res.status(404).json({
        success: false,
        message: '운세 템플릿을 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      template: {
        ...template,
        // JSON 필드들을 파싱해서 반환
        messageScenarios: typeof template.messageScenarios === 'string'
          ? JSON.parse(template.messageScenarios)
          : template.messageScenarios,
        requiredFields: typeof template.requiredFields === 'string'
          ? JSON.parse(template.requiredFields)
          : template.requiredFields,
        characterInfo: typeof template.characterInfo === 'string'
          ? JSON.parse(template.characterInfo)
          : template.characterInfo,
        cardConfig: typeof template.cardConfig === 'string'
          ? JSON.parse(template.cardConfig)
          : template.cardConfig,
        theme: typeof template.theme === 'string'
          ? JSON.parse(template.theme)
          : template.theme,
        fortuneSettings: typeof template.fortuneSettings === 'string'
          ? JSON.parse(template.fortuneSettings)
          : template.fortuneSettings,
        resultTemplateData: typeof template.resultTemplateData === 'string'
          ? JSON.parse(template.resultTemplateData)
          : template.resultTemplateData,
        sessionCount: template._count.sessions
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '운세 템플릿을 가져오는 중 오류가 발생했습니다.'
    });
  }
});

// 운세 템플릿 생성 (관리자용)
router.post('/', async (req, res) => {
  try {
    const {
      templateKey,
      title,
      description,
      category = 'special',
      type = 'default',
      imageUrl,
      characterId,
      messageScenarios,
      requiredFields = ['birthDate', 'gender', 'mbti'],
      characterInfo,
      cardConfig,
      fortuneSettings,
      resultTemplateData,
      apiEndpoint,
      resultPageUrl,
      theme,
      isActive = true,
      isPremium = false,
      sortOrder = 0
    } = req.body;

    // 필수 필드 검증
    if (!templateKey || !title || !messageScenarios || !characterInfo || !cardConfig) {
      return res.status(400).json({
        success: false,
        message: '필수 필드가 누락되었습니다. (templateKey, title, messageScenarios, characterInfo, cardConfig)'
      });
    }

    // templateKey 공백 검증
    if (/\s/.test(templateKey)) {
      return res.status(400).json({
        success: false,
        message: '템플릿 키에 공백을 포함할 수 없습니다.'
      });
    }

    // templateKey 중복 검사
    const existingTemplate = await prisma.fortuneTemplate.findUnique({
      where: { templateKey }
    });

    if (existingTemplate) {
      return res.status(400).json({
        success: false,
        message: '이미 존재하는 템플릿 키입니다.'
      });
    }

    const template = await prisma.fortuneTemplate.create({
      data: {
        templateKey,
        title,
        description,
        category,
        type,
        imageUrl,
        characterId,
        messageScenarios: JSON.stringify(messageScenarios),
        requiredFields: JSON.stringify(requiredFields),
        characterInfo: JSON.stringify(characterInfo),
        cardConfig: JSON.stringify(cardConfig),
        fortuneSettings: fortuneSettings ? JSON.stringify(fortuneSettings) : null,
        resultTemplateData: resultTemplateData ? JSON.stringify(resultTemplateData) : null,
        apiEndpoint,
        resultPageUrl,
        theme: theme ? JSON.stringify(theme) : null,
        isActive,
        isPremium,
        sortOrder
      }
    });

    res.status(201).json({
      success: true,
      message: '운세 템플릿이 생성되었습니다.',
      template: {
        ...template,
        messageScenarios: JSON.parse(template.messageScenarios),
        requiredFields: JSON.parse(template.requiredFields),
        characterInfo: JSON.parse(template.characterInfo),
        cardConfig: JSON.parse(template.cardConfig),
        fortuneSettings: template.fortuneSettings ? JSON.parse(template.fortuneSettings) : null,
        resultTemplateData: template.resultTemplateData ? JSON.parse(template.resultTemplateData) : null,
        theme: template.theme ? JSON.parse(template.theme) : null
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '운세 템플릿 생성 중 오류가 발생했습니다.'
    });
  }
});

// 운세 템플릿 수정 (관리자용)
router.put('/:templateKey', async (req, res) => {
  try {
    const { templateKey } = req.params;
    const {
      title,
      description,
      category,
      type,
      imageUrl,
      characterId,
      messageScenarios,
      requiredFields,
      characterInfo,
      cardConfig,
      fortuneSettings,
      resultTemplateData,
      apiEndpoint,
      resultPageUrl,
      theme,
      isActive,
      isPremium,
      sortOrder
    } = req.body;

    // 템플릿 존재 여부 확인
    const existingTemplate = await prisma.fortuneTemplate.findUnique({
      where: { templateKey }
    });

    if (!existingTemplate) {
      return res.status(404).json({
        success: false,
        message: '운세 템플릿을 찾을 수 없습니다.'
      });
    }

    // 업데이트할 데이터 구성
    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (category !== undefined) updateData.category = category;
    if (type !== undefined) updateData.type = type;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
    if (characterId !== undefined) updateData.characterId = characterId;
    if (messageScenarios !== undefined) updateData.messageScenarios = JSON.stringify(messageScenarios);
    if (requiredFields !== undefined) updateData.requiredFields = JSON.stringify(requiredFields);
    if (characterInfo !== undefined) updateData.characterInfo = JSON.stringify(characterInfo);
    if (cardConfig !== undefined) updateData.cardConfig = JSON.stringify(cardConfig);
    if (fortuneSettings !== undefined) updateData.fortuneSettings = JSON.stringify(fortuneSettings);
    if (resultTemplateData !== undefined) updateData.resultTemplateData = JSON.stringify(resultTemplateData);
    if (apiEndpoint !== undefined) updateData.apiEndpoint = apiEndpoint;
    if (resultPageUrl !== undefined) updateData.resultPageUrl = resultPageUrl;
    if (theme !== undefined) updateData.theme = JSON.stringify(theme);
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isPremium !== undefined) updateData.isPremium = isPremium;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const template = await prisma.fortuneTemplate.update({
      where: { templateKey },
      data: updateData
    });

    res.json({
      success: true,
      message: '운세 템플릿이 수정되었습니다.',
      template: {
        ...template,
        messageScenarios: JSON.parse(template.messageScenarios),
        requiredFields: JSON.parse(template.requiredFields),
        characterInfo: JSON.parse(template.characterInfo),
        cardConfig: JSON.parse(template.cardConfig),
        fortuneSettings: template.fortuneSettings ? JSON.parse(template.fortuneSettings) : null,
        resultTemplateData: template.resultTemplateData ? JSON.parse(template.resultTemplateData) : null,
        theme: template.theme ? JSON.parse(template.theme) : null
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '운세 템플릿 수정 중 오류가 발생했습니다.'
    });
  }
});

// 운세 템플릿 삭제 (관리자용)
router.delete('/:templateKey', async (req, res) => {
  try {
    const { templateKey } = req.params;

    // 템플릿 존재 여부 확인
    const existingTemplate = await prisma.fortuneTemplate.findUnique({
      where: { templateKey },
      include: {
        _count: {
          select: { sessions: true }
        }
      }
    });

    if (!existingTemplate) {
      return res.status(404).json({
        success: false,
        message: '운세 템플릿을 찾을 수 없습니다.'
      });
    }

    // 세션이 있는 경우 삭제 방지 (옵션)
    if (existingTemplate._count.sessions > 0) {
      return res.status(400).json({
        success: false,
        message: '이 템플릿을 사용한 세션이 있어 삭제할 수 없습니다. 비활성화를 고려해주세요.'
      });
    }

    await prisma.fortuneTemplate.delete({
      where: { templateKey }
    });

    res.json({
      success: true,
      message: '운세 템플릿이 삭제되었습니다.'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '운세 템플릿 삭제 중 오류가 발생했습니다.'
    });
  }
});

// 운세 템플릿 순서 변경 (관리자용)
router.patch('/reorder', async (req, res) => {
  try {
    const { updates } = req.body; // [{ templateKey, sortOrder }, ...]

    if (!Array.isArray(updates)) {
      return res.status(400).json({
        success: false,
        message: '업데이트 배열이 필요합니다.'
      });
    }

    // 트랜잭션으로 순서 업데이트
    await prisma.$transaction(
      updates.map(({ templateKey, sortOrder }) =>
        prisma.fortuneTemplate.update({
          where: { templateKey },
          data: { sortOrder }
        })
      )
    );

    res.json({
      success: true,
      message: '템플릿 순서가 업데이트되었습니다.'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '템플릿 순서 업데이트 중 오류가 발생했습니다.'
    });
  }
});

// 이미지 파일 업로드 (Supabase 사용)
router.post('/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '이미지 파일이 필요합니다.'
      });
    }

    // UUID 기반 파일명 생성
    const fileExtension = req.file.originalname.split('.').pop();
    const fileName = `${uuidv4()}.${fileExtension}`;
    const filePath = `fortune-templates/${fileName}`;

    // Supabase에 업로드
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      return res.status(500).json({
        success: false,
        message: 'Supabase 업로드 실패: ' + error.message
      });
    }

    // 공개 URL 생성
    const { data: publicUrlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    res.status(200).json({
      success: true,
      message: '이미지 업로드가 완료되었습니다.',
      imageUrl: publicUrlData.publicUrl
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '이미지 업로드 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;