const express = require('express');
const prisma = require('../lib/prisma');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

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

// 인증 미들웨어
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
  }

  // 간단한 토큰 검증 (실제로는 JWT 검증 로직 필요)
  if (token !== 'valid-admin-token') {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }

  next();
};

// 활성 콘텐츠 목록 조회 (공개 API)
router.get('/', async (req, res) => {
  try {
    const { active = 'true' } = req.query;

    const whereClause = {};
    if (active === 'true') {
      whereClause.active = true;
    }

    const contents = await prisma.content.findMany({
      where: whereClause,
      orderBy: [
        { sort_order: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    res.json({
      success: true,
      contents: contents.map(content => ({
        id: content.id,
        title: content.title,
        description: content.description,
        imageUrl: content.image_url,
        linkUrl: content.link_url,
        active: content.active,
        sortOrder: content.sort_order,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: '콘텐츠 목록을 조회하는데 실패했습니다.'
    });
  }
});

// 관리자용 콘텐츠 목록 조회 (인증 필요)
router.get('/admin', authMiddleware, async (req, res) => {
  try {
    const { search, active } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const whereClause = {};

    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (active !== undefined) {
      whereClause.active = active === 'true';
    }

    const [contents, total] = await Promise.all([
      prisma.content.findMany({
        where: whereClause,
        orderBy: [
          { sort_order: 'asc' },
          { createdAt: 'desc' }
        ],
        skip: offset,
        take: limit
      }),
      prisma.content.count({ where: whereClause })
    ]);

    res.json({
      success: true,
      contents: contents.map(content => ({
        id: content.id,
        title: content.title,
        description: content.description,
        imageUrl: content.image_url,
        linkUrl: content.link_url,
        active: content.active,
        sortOrder: content.sort_order,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: '콘텐츠 목록을 조회하는데 실패했습니다.'
    });
  }
});

// 콘텐츠 생성 (관리자용)
router.post('/', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { title, description, linkUrl, active, sortOrder } = req.body;

    if (!title || !description) {
      return res.status(400).json({
        success: false,
        error: '제목과 설명은 필수입니다.'
      });
    }

    let imageUrl = '';
    if (req.file) {
      // UUID 기반 파일명 생성
      const fileExtension = req.file.originalname.split('.').pop();
      const fileName = `${uuidv4()}.${fileExtension}`;
      const filePath = `contents/${fileName}`;

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
          error: 'Supabase 업로드 실패: ' + error.message
        });
      }

      // 공개 URL 생성
      const { data: publicUrlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filePath);

      imageUrl = publicUrlData.publicUrl;
    }

    const content = await prisma.content.create({
      data: {
        title,
        description,
        image_url: imageUrl,
        link_url: linkUrl || '',
        active: active === 'true',
        sort_order: parseInt(sortOrder) || 0
      }
    });

    res.status(201).json({
      success: true,
      content: {
        id: content.id,
        title: content.title,
        description: content.description,
        imageUrl: content.image_url,
        linkUrl: content.link_url,
        active: content.active,
        sortOrder: content.sort_order,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: '콘텐츠 생성에 실패했습니다.'
    });
  }
});

// 콘텐츠 수정 (관리자용)
router.put('/:id', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, linkUrl, active, sortOrder } = req.body;

    const existingContent = await prisma.content.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existingContent) {
      return res.status(404).json({
        success: false,
        error: '콘텐츠를 찾을 수 없습니다.'
      });
    }

    let imageUrl = existingContent.image_url;
    if (req.file) {
      // UUID 기반 파일명 생성
      const fileExtension = req.file.originalname.split('.').pop();
      const fileName = `${uuidv4()}.${fileExtension}`;
      const filePath = `contents/${fileName}`;

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
          error: 'Supabase 업로드 실패: ' + error.message
        });
      }

      // 공개 URL 생성
      const { data: publicUrlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filePath);

      imageUrl = publicUrlData.publicUrl;

      // 기존 Supabase 이미지 삭제 (선택적)
      if (existingContent.image_url && existingContent.image_url.includes('supabase')) {
        try {
          const oldPath = existingContent.image_url.split('/').slice(-2).join('/');
          await supabase.storage.from(STORAGE_BUCKET).remove([oldPath]);
        } catch (deleteError) {
        }
      }
    }

    const content = await prisma.content.update({
      where: { id: parseInt(id) },
      data: {
        title: title || existingContent.title,
        description: description || existingContent.description,
        image_url: imageUrl,
        link_url: linkUrl !== undefined ? linkUrl : existingContent.link_url,
        active: active !== undefined ? active === 'true' : existingContent.active,
        sort_order: sortOrder !== undefined ? parseInt(sortOrder) : existingContent.sort_order
      }
    });

    res.json({
      success: true,
      content: {
        id: content.id,
        title: content.title,
        description: content.description,
        imageUrl: content.image_url,
        linkUrl: content.link_url,
        active: content.active,
        sortOrder: content.sort_order,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: '콘텐츠 수정에 실패했습니다.'
    });
  }
});

// 콘텐츠 삭제 (관리자용)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const existingContent = await prisma.content.findUnique({
      where: { id: parseInt(id) }
    });

    if (!existingContent) {
      return res.status(404).json({
        success: false,
        error: '콘텐츠를 찾을 수 없습니다.'
      });
    }

    // 이미지 파일 삭제 (선택적)
    if (existingContent.image_url && existingContent.image_url.startsWith('/uploads/')) {
      try {
        const imagePath = path.join(__dirname, '..', existingContent.image_url);
        await fs.unlink(imagePath);
      } catch (unlinkError) {
      }
    }

    await prisma.content.delete({
      where: { id: parseInt(id) }
    });

    res.json({
      success: true,
      message: '콘텐츠가 삭제되었습니다.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: '콘텐츠 삭제에 실패했습니다.'
    });
  }
});

module.exports = router;