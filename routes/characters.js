const express = require('express');
const prisma = require('../lib/prisma');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

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


// 모든 캐릭터 조회
router.get('/', async (req, res) => {
  try {
    const characters = await prisma.character.findMany({
      where: {
        isActive: true
      },
      orderBy: [
        { sortOrder: 'asc' },
        { createdAt: 'desc' }
      ],
      include: {
        _count: {
          select: {
            fortuneTemplates: true
          }
        }
      }
    });

    res.json({
      success: true,
      characters
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '캐릭터 목록을 가져오는 중 오류가 발생했습니다.'
    });
  }
});

// 특정 캐릭터 조회
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const character = await prisma.character.findUnique({
      where: { id: parseInt(id) },
      include: {
        fortuneTemplates: {
          select: {
            id: true,
            title: true,
            templateKey: true
          }
        }
      }
    });

    if (!character) {
      return res.status(404).json({
        success: false,
        message: '캐릭터를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      character
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '캐릭터 정보를 가져오는 중 오류가 발생했습니다.'
    });
  }
});

// 새 캐릭터 생성
router.post('/', upload.single('image'), async (req, res) => {
  try {
    // TODO: 관리자 권한 체크 추가

    const {
      name,
      imageSrc,
      description,
      personality
    } = req.body;

    // defaultMessageScenarios는 JSON 문자열로 받을 수 있음 (FormData로 전송한 경우)
    let defaultMessageScenarios;
    if (req.body.defaultMessageScenarios) {
      try {
        defaultMessageScenarios = typeof req.body.defaultMessageScenarios === 'string'
          ? JSON.parse(req.body.defaultMessageScenarios)
          : req.body.defaultMessageScenarios;
      } catch (err) {
        defaultMessageScenarios = null;
      }
    }

    // 필수 필드 검증
    if (!name) {
      return res.status(400).json({
        success: false,
        message: '캐릭터 이름은 필수입니다.'
      });
    }

    let finalImageUrl = imageSrc;

    // 이미지 파일이 업로드된 경우
    if (req.file) {
      // UUID 기반 파일명 생성
      const fileExtension = req.file.originalname.split('.').pop();
      const fileName = `${uuidv4()}.${fileExtension}`;
      const filePath = `characters/${fileName}`;

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

      finalImageUrl = publicUrlData.publicUrl;
    }

    // 이미지가 없는 경우
    if (!finalImageUrl) {
      return res.status(400).json({
        success: false,
        message: '캐릭터 이미지가 필요합니다.'
      });
    }

    // 중복 이름 체크
    const existingCharacter = await prisma.character.findFirst({
      where: {
        name,
        isActive: true
      }
    });

    if (existingCharacter) {
      return res.status(400).json({
        success: false,
        message: '이미 같은 이름의 캐릭터가 존재합니다.'
      });
    }

    const character = await prisma.character.create({
      data: {
        name,
        imageSrc: finalImageUrl,
        description,
        personality,
        defaultMessageScenarios: defaultMessageScenarios || {
          withProfile: [
            { text: '운세를 봐줄거래!', sender: 'bot' },
            { text: '바로 카드를 뽑아보고래!', sender: 'bot', showCardSelect: true }
          ],
          needsProfile: [
            { text: '운세를 봐줄거래!', sender: 'bot' },
            { text: '먼저 생년월일을 알려줘고래~', sender: 'bot', showUserInput: 'birthDate' },
            { text: '성별도 알려줘고래!', sender: 'bot', showUserInput: 'gender' },
            { text: 'MBTI도 궁금해고래!', sender: 'bot', showUserInput: 'mbti' },
            { text: '좋아고래! 이제 카드를 뽑아보고래!', sender: 'bot', showCardSelect: true }
          ]
        }
      }
    });

    res.status(201).json({
      success: true,
      message: '캐릭터가 생성되었습니다.',
      character
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '캐릭터 생성 중 오류가 발생했습니다.'
    });
  }
});

// 캐릭터 정보 수정
router.put('/:id', upload.single('image'), async (req, res) => {
  try {
    // TODO: 관리자 권한 체크 추가

    const { id } = req.params;
    const {
      name,
      imageSrc,
      description,
      personality,
      isActive,
      sortOrder
    } = req.body;

    // defaultMessageScenarios는 JSON 문자열로 받을 수 있음 (FormData로 전송한 경우)
    let defaultMessageScenarios;
    if (req.body.defaultMessageScenarios) {
      try {
        defaultMessageScenarios = typeof req.body.defaultMessageScenarios === 'string'
          ? JSON.parse(req.body.defaultMessageScenarios)
          : req.body.defaultMessageScenarios;
      } catch (err) {
        defaultMessageScenarios = undefined;
      }
    }

    const character = await prisma.character.findUnique({
      where: { id: parseInt(id) }
    });

    if (!character) {
      return res.status(404).json({
        success: false,
        message: '캐릭터를 찾을 수 없습니다.'
      });
    }

    // 이름 변경 시 중복 체크
    if (name && name !== character.name) {
      const existingCharacter = await prisma.character.findFirst({
        where: {
          name,
          isActive: true,
          id: {
            not: parseInt(id)
          }
        }
      });

      if (existingCharacter) {
        return res.status(400).json({
          success: false,
          message: '이미 같은 이름의 캐릭터가 존재합니다.'
        });
      }
    }

    // 새 이미지 파일이 업로드된 경우 처리
    let finalImageUrl = imageSrc;

    if (req.file) {
      // UUID 기반 파일명 생성
      const fileExtension = req.file.originalname.split('.').pop();
      const fileName = `${uuidv4()}.${fileExtension}`;
      const filePath = `characters/${fileName}`;

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

      finalImageUrl = publicUrlData.publicUrl;

      // 기존 Supabase 이미지 삭제 (선택적)
      if (character.imageSrc && character.imageSrc.includes('supabase')) {
        try {
          const oldPath = character.imageSrc.split('/').slice(-2).join('/');
          await supabase.storage.from(STORAGE_BUCKET).remove([oldPath]);
        } catch (deleteError) {
        }
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (finalImageUrl !== undefined) updateData.imageSrc = finalImageUrl;
    if (description !== undefined) updateData.description = description;
    if (personality !== undefined) updateData.personality = personality;
    if (defaultMessageScenarios !== undefined) updateData.defaultMessageScenarios = defaultMessageScenarios;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const updatedCharacter = await prisma.character.update({
      where: { id: parseInt(id) },
      data: updateData
    });

    res.json({
      success: true,
      message: '캐릭터 정보가 수정되었습니다.',
      character: updatedCharacter
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '캐릭터 정보 수정 중 오류가 발생했습니다.'
    });
  }
});

// 캐릭터 삭제 (비활성화)
router.delete('/:id', async (req, res) => {
  try {
    // TODO: 관리자 권한 체크 추가

    const { id } = req.params;

    const character = await prisma.character.findUnique({
      where: { id: parseInt(id) },
      include: {
        _count: {
          select: {
            fortuneTemplates: true
          }
        }
      }
    });

    if (!character) {
      return res.status(404).json({
        success: false,
        message: '캐릭터를 찾을 수 없습니다.'
      });
    }

    // 사용 중인 템플릿이 있는지 확인
    if (character._count.fortuneTemplates > 0) {
      return res.status(400).json({
        success: false,
        message: '이 캐릭터를 사용하는 운세 템플릿이 있어 삭제할 수 없습니다.'
      });
    }

    // 완전 삭제 대신 비활성화
    await prisma.character.update({
      where: { id: parseInt(id) },
      data: { isActive: false }
    });

    res.json({
      success: true,
      message: '캐릭터가 삭제되었습니다.'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: '캐릭터 삭제 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;