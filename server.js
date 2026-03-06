// 환경에 따른 .env 파일 로드
const path = require("path");
const envFile = {
  production: '.env.production',
  scheduler: '.env.scheduler',
}[process.env.NODE_ENV] || '.env';

require("dotenv").config({
  path: path.resolve(__dirname, envFile),
});

console.log(`[ENV] Loaded ${envFile} | NODE_ENV=${process.env.NODE_ENV} | PORT=${process.env.PORT}`);
console.log(`[ENV] ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ? "SET (" + process.env.ANTHROPIC_API_KEY.substring(0, 10) + "...)" : "NOT SET"}`);
const express = require("express");
const cors = require("cors");
const multer = require("multer");
// PrismaClient는 lib/prisma.js에서 관리
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const cron = require("node-cron");

// Import routes
const newYearFortune2026Routes = require("./routes/newYearFortune2026");
const contentRecommendationsRoutes = require("./routes/contentRecommendations");
const contentsRoutes = require("./routes/contents");
const featuredContentsRoutes = require("./routes/featured-contents");
const instagramRoutes = require("./routes/instagram");
const slackRoutes = require("./routes/slack");
const fortuneTemplatesRoutes = require("./routes/fortune-templates");
const fortuneSessionsRoutes = require("./routes/fortune-sessions");
const charactersRoutes = require("./routes/characters");
const cardsRoutes = require("./routes/cards");
const shareRoutes = require("./routes/share");
const pointRewardsRoutes = require("./routes/point-rewards");
const premiumContentsRoutes = require("./routes/premium-contents");
const contentStatsRoutes = require("./routes/content-stats");
const {
  router: tossAuthRoutes,
  initPrisma: initTossAuthPrisma,
  authenticateTossToken,
} = require("./routes/toss-auth");

// Import services (Vercel 환경에서는 Playwright 관련 서비스 제외)
let VideoService = null;
if (!process.env.VERCEL) {
  try {
    VideoService = require("./services/videoService");
  } catch (error) {}
}

const app = express();

// Prisma client 초기화 - lib/prisma.js 사용 (스케줄러 reconnect 로직 포함)
let prisma;
try {
  prisma = require('./lib/prisma');
} catch (error) {
  prisma = null;
}

const PORT = process.env.PORT || 5002;

// 전역 스케줄러 관리 변수
let fortuneScheduler = null;

// Supabase client 초기화
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Storage bucket name
const STORAGE_BUCKET = process.env.SUPABASE_BUCKET || "dollpickmap";

// Multer 메모리 저장소 설정 (파일 업로드용)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB 제한
  },
  fileFilter: (req, file, cb) => {
    // 이미지 파일만 허용
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("이미지 파일만 업로드 가능합니다."), false);
    }
  },
});

// 환경별 기본 폴더 경로 생성
const getBasePath = () => {
  const isProduction = process.env.NODE_ENV === "production";
  return isProduction ? "" : "dev";
};

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json());

// 업로드된 파일들을 static으로 서빙
app.use("/uploads", express.static("uploads"));

// 공용 리소스 파일들을 static으로 서빙 (타로 카드 이미지 등)
app.use("/public", express.static("public"));

// Route registration
app.use("/api/newyear-fortune-2026", newYearFortune2026Routes);
app.use("/api/content-recommendations", contentRecommendationsRoutes);
app.use("/api/contents", contentsRoutes);
app.use("/api/featured-contents", featuredContentsRoutes);
app.use("/api/instagram", instagramRoutes);
app.use("/api/slack", slackRoutes);
app.use("/api/fortune-templates", fortuneTemplatesRoutes);
app.use("/api/fortune-sessions", fortuneSessionsRoutes);
app.use("/api/characters", charactersRoutes);
app.use("/api/share", shareRoutes);
app.use("/api/cards", cardsRoutes);
app.use("/api/point-rewards", pointRewardsRoutes);
app.use("/api/premium-contents", premiumContentsRoutes);
app.use("/api/content-stats", contentStatsRoutes);
app.use("/api/auth", tossAuthRoutes);

// Toss Auth 라우트에 Prisma 초기화
initTossAuthPrisma(prisma);

// Instagram OAuth callback을 위한 리다이렉트 처리
app.get("/admin/instagram/callback", (req, res) => {
  // Instagram 콜백을 프론트엔드로 리다이렉트
  const { code, error, error_reason, error_description } = req.query;
  const params = new URLSearchParams(req.query);
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5001";
  res.redirect(`${frontendUrl}/admin/instagram/callback?${params.toString()}`);
});

app.get("/", (req, res) => {
  res.json({ message: "TaroTI Backend API" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// 버킷 목록 확인 API (디버깅용)
app.get("/api/test-buckets", async (req, res) => {
  try {
    const { data, error } = await supabase.storage.listBuckets();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ buckets: data, targetBucket: STORAGE_BUCKET });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Landing User 저장 API
app.post("/api/landing-user", async (req, res) => {
  try {
    const { birthDate, gender, mbti } = req.body;

    // 입력 데이터 검증
    if (!birthDate || !gender || !mbti) {
      return res.status(400).json({
        error: "Missing required fields: birthDate, gender, mbti",
      });
    }

    // 데이터베이스에 사용자 정보 저장
    const landingUser = await prisma.landingUser.create({
      data: {
        birthDate,
        gender,
        mbti,
      },
    });

    res.json({
      success: true,
      landingUserId: landingUser.id,
      message: "User data saved successfully",
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// Landing User 조회 API
app.get("/api/landing-user/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const landingUser = await prisma.landingUser.findUnique({
      where: { id: parseInt(id) },
    });

    if (!landingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(landingUser);
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// Landing User V2 저장 API
app.post("/api/landing-user-v2", async (req, res) => {
  try {
    const { birthDate, gender, mbti, selectedCardNumber } = req.body;

    // 입력 데이터 검증
    if (!birthDate || !gender || !mbti) {
      return res.status(400).json({
        error: "Missing required fields: birthDate, gender, mbti",
      });
    }

    // 데이터베이스에 사용자 정보 저장 (V2)
    const landingUserV2 = await prisma.landingUserV2.create({
      data: {
        birthDate,
        gender,
        mbti,
        selectedCard: selectedCardNumber,
      },
    });

    res.json({
      success: true,
      landingUserId: landingUserV2.id,
      message: "User data saved successfully",
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// Landing User V2 조회 API
app.get("/api/landing-user-v2/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const landingUserV2 = await prisma.landingUserV2.findUnique({
      where: { id: parseInt(id) },
    });

    if (!landingUserV2) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(landingUserV2);
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// Landing User V2 다시하기 API
app.patch("/api/landing-user-v2/:id/restart", async (req, res) => {
  try {
    const { id } = req.params;

    const updatedUser = await prisma.landingUserV2.update({
      where: { id: parseInt(id) },
      data: {
        isRestarted: true,
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: "Restart status updated successfully",
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// Landing User V2 피드백 저장 API
app.patch("/api/landing-user-v2/:id/feedback", async (req, res) => {
  try {
    const { id } = req.params;
    const { feedback } = req.body;

    if (!feedback) {
      return res.status(400).json({
        error: "Missing feedback data",
      });
    }

    const updatedUser = await prisma.landingUserV2.update({
      where: { id: parseInt(id) },
      data: {
        feedback,
        updatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: "Feedback saved successfully",
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// Purchase 클릭 및 이메일 저장 API (V1)
app.patch("/api/landing-user/:id/purchase", async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    const updateData = {
      purchaseClicked: true,
      updatedAt: new Date(),
    };

    if (email) {
      updateData.email = email;
    }

    const updatedUser = await prisma.landingUser.update({
      where: { id: parseInt(id) },
      data: updateData,
    });

    res.json({
      success: true,
      message: "Purchase click recorded successfully",
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// Purchase 클릭 및 이메일 저장 API (V2)
app.patch("/api/landing-user-v2/:id/purchase", async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;

    const updateData = {
      purchaseClicked: true,
      updatedAt: new Date(),
    };

    if (email) {
      updateData.email = email;
    }

    const updatedUser = await prisma.landingUserV2.update({
      where: { id: parseInt(id) },
      data: updateData,
    });

    res.json({
      success: true,
      message: "Purchase click recorded successfully",
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// ============================================
// 배너 관리 API
// ============================================

// 배너 목록 조회
app.get("/api/banners", async (req, res) => {
  try {
    const { active } = req.query;

    const where = active === "true" ? { active: true } : {};

    const banners = await prisma.banner.findMany({
      where,
      orderBy: { sort_order: "asc" },
    });

    res.json(banners);
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 배너 생성
app.post("/api/banners", async (req, res) => {
  try {
    const {
      title,
      description,
      pc_image_url,
      mobile_image_url,
      link_url,
      active,
    } = req.body;

    if (!title || !pc_image_url) {
      return res.status(400).json({
        error: "Missing required fields: title, pc_image_url",
      });
    }

    // 최대 sort_order 값을 가져와서 +1
    const maxOrder = await prisma.banner.findFirst({
      orderBy: { sort_order: "desc" },
      select: { sort_order: true },
    });

    const newSortOrder = (maxOrder?.sort_order || 0) + 1;

    const banner = await prisma.banner.create({
      data: {
        title,
        description,
        pc_image_url,
        mobile_image_url,
        link_url,
        active: active !== undefined ? active : true,
        sort_order: newSortOrder,
      },
    });

    res.json(banner);
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 배너 수정
app.put("/api/banners/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      pc_image_url,
      mobile_image_url,
      link_url,
      active,
    } = req.body;

    const banner = await prisma.banner.update({
      where: { id: parseInt(id) },
      data: {
        title,
        description,
        pc_image_url,
        mobile_image_url,
        link_url,
        active,
      },
    });

    res.json(banner);
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 배너 삭제
app.delete("/api/banners/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.banner.delete({
      where: { id: parseInt(id) },
    });

    res.json({ success: true, message: "Banner deleted successfully" });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 배너 순서 업데이트
app.patch("/api/banners/reorder", async (req, res) => {
  try {
    const { updates } = req.body; // [{ id, sort_order }, ...]

    if (!Array.isArray(updates)) {
      return res.status(400).json({
        error: "Updates must be an array",
      });
    }

    // 트랜잭션으로 순서 업데이트
    const results = await prisma.$transaction(
      updates.map(({ id, sort_order }) =>
        prisma.banner.update({
          where: { id: parseInt(id) },
          data: { sort_order },
        })
      )
    );

    res.json({ success: true, message: "Banner order updated successfully" });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// ============================================
// 콘텐츠 관리 API
// ============================================

// 콘텐츠 목록 조회
app.get("/api/contents", async (req, res) => {
  try {
    const { active } = req.query;

    const where = active === "true" ? { active: true } : {};

    const contents = await prisma.content.findMany({
      where,
      orderBy: { sort_order: "asc" },
    });

    res.json(contents);
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 콘텐츠 생성
app.post("/api/contents", async (req, res) => {
  try {
    const { title, description, image_url, link_url, active } = req.body;

    if (!title || !description || !image_url) {
      return res.status(400).json({
        error: "Missing required fields: title, description, image_url",
      });
    }

    // 최대 sort_order 값을 가져와서 +1
    const maxOrder = await prisma.content.findFirst({
      orderBy: { sort_order: "desc" },
      select: { sort_order: true },
    });

    const newSortOrder = (maxOrder?.sort_order || 0) + 1;

    const content = await prisma.content.create({
      data: {
        title,
        description,
        image_url,
        link_url,
        active: active !== undefined ? active : true,
        sort_order: newSortOrder,
      },
    });

    res.json(content);
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 콘텐츠 수정
app.put("/api/contents/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, image_url, link_url, active } = req.body;

    const content = await prisma.content.update({
      where: { id: parseInt(id) },
      data: {
        title,
        description,
        image_url,
        link_url,
        active,
      },
    });

    res.json(content);
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 콘텐츠 삭제
app.delete("/api/contents/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.content.delete({
      where: { id: parseInt(id) },
    });

    res.json({ success: true, message: "Content deleted successfully" });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 콘텐츠 순서 업데이트
app.patch("/api/contents/reorder", async (req, res) => {
  try {
    const { updates } = req.body; // [{ id, sort_order }, ...]

    if (!Array.isArray(updates)) {
      return res.status(400).json({
        error: "Updates must be an array",
      });
    }

    // 트랜잭션으로 순서 업데이트
    const results = await prisma.$transaction(
      updates.map(({ id, sort_order }) =>
        prisma.content.update({
          where: { id: parseInt(id) },
          data: { sort_order },
        })
      )
    );

    res.json({ success: true, message: "Content order updated successfully" });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// ============================================
// 파일 업로드 API
// ============================================

/**
 * POST /api/upload/images
 * 이미지 파일들을 Supabase Storage에 업로드
 */
app.post("/api/upload/images", upload.array("images", 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: "Bad Request",
        message: "업로드할 이미지가 없습니다.",
      });
    }

    const { v4: uuidv4 } = require("uuid");
    const uploadedUrls = [];

    for (const file of req.files) {
      // 고유한 파일명 생성
      const fileExtension = file.originalname.split(".").pop();
      const fileName = `${uuidv4()}.${fileExtension}`;
      const filePath = `review-images/${fileName}`;

      // Supabase Storage에 파일 업로드
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          cacheControl: "3600",
          upsert: false,
        });

      if (error) {
        return res.status(500).json({
          error: "Storage Error",
          message: "이미지 업로드 중 오류가 발생했습니다.",
        });
      }

      // 공개 URL 생성
      const { data: publicUrlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filePath);

      uploadedUrls.push(publicUrlData.publicUrl);
    }

    res.json({
      success: true,
      message: "이미지가 성공적으로 업로드되었습니다.",
      data: {
        urls: uploadedUrls,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal Server Error",
      message: "이미지 업로드 중 오류가 발생했습니다.",
    });
  }
});

// 범용 파일 업로드 (기존 API 유지)
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    // multipart 요청에서는 req.body가 있는지 먼저 확인
    const bucket = req.body?.bucket;
    const folder = req.body?.folder || "";
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    if (!bucket) {
      return res.status(400).json({ error: "Bucket name is required" });
    }

    // 파일명 생성
    const fileExt = file.originalname.split(".").pop();
    const fileName = `${Date.now()}-${Math.random()
      .toString(36)
      .substring(2)}.${fileExt}`;

    // 환경별 폴더 구조
    const basePath = getBasePath();
    let filePath;

    if (basePath) {
      // 개발 환경: dev/folder/filename 또는 dev/filename
      filePath = folder
        ? `${basePath}/${folder}/${fileName}`
        : `${basePath}/${fileName}`;
    } else {
      // 프로덕션 환경: folder/filename 또는 filename
      filePath = folder ? `${folder}/${fileName}` : fileName;
    }

    // Vercel 환경에서는 메모리에서만 처리, 로컬 환경에서는 파일 저장
    let publicUrl;

    if (process.env.VERCEL) {
      // Vercel 환경: 파일 시스템 사용 불가, base64 URL 반환
      const base64Data = file.buffer.toString("base64");
      const mimeType = file.mimetype || "application/octet-stream";
      publicUrl = `data:${mimeType};base64,${base64Data}`;

      // 또는 Supabase로 직접 업로드
      if (
        supabase &&
        process.env.SUPABASE_URL &&
        process.env.SUPABASE_ANON_KEY
      ) {
        try {
          const { data, error } = await supabase.storage
            .from(bucket)
            .upload(filePath, file.buffer, {
              contentType: file.mimetype,
              cacheControl: "3600",
              upsert: false,
            });

          if (!error) {
            const { data: urlData } = supabase.storage
              .from(bucket)
              .getPublicUrl(filePath);
            publicUrl = urlData.publicUrl;
          }
        } catch (uploadError) {}
      }
    } else {
      // 로컬 개발 환경: 기존 코드 유지
      const uploadsDir = path.join(__dirname, "uploads", bucket);
      if (folder) {
        const fullDir = path.join(uploadsDir, folder);
        fs.mkdirSync(fullDir, { recursive: true });
        fs.writeFileSync(path.join(fullDir, fileName), file.buffer);
        filePath = `${bucket}/${folder}/${fileName}`;
      } else {
        fs.mkdirSync(uploadsDir, { recursive: true });
        fs.writeFileSync(path.join(uploadsDir, fileName), file.buffer);
        filePath = `${bucket}/${fileName}`;
      }

      publicUrl = `http://localhost:${PORT}/uploads/${filePath}`;
    }

    res.json({
      path: filePath,
      publicUrl: publicUrl,
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

/**
 * POST /api/upload/banner
 * 배너 이미지를 Supabase Storage에 업로드
 */
app.post("/api/upload/banner", upload.single("image"), async (req, res) => {
  try {
    const { type } = req.body; // 'pc' or 'mobile'
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        error: "Bad Request",
        message: "업로드할 이미지가 없습니다.",
      });
    }

    const { v4: uuidv4 } = require("uuid");
    const deviceFolder = type === "mobile" ? "mobile" : "pc";

    // 고유한 파일명 생성
    const fileExtension = file.originalname.split(".").pop();
    const fileName = `${uuidv4()}.${fileExtension}`;
    const filePath = `banners/${deviceFolder}/${fileName}`;

    // Supabase Storage에 파일 업로드
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      return res.status(500).json({
        error: "Storage Error",
        message: "이미지 업로드 중 오류가 발생했습니다.",
      });
    }

    // 공개 URL 생성
    const { data: publicUrlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    res.json({
      success: true,
      message: "이미지가 성공적으로 업로드되었습니다.",
      data: {
        path: data.path,
        publicUrl: publicUrlData.publicUrl,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal Server Error",
      message: "이미지 업로드 중 오류가 발생했습니다.",
    });
  }
});

/**
 * POST /api/upload/content
 * 콘텐츠 이미지를 Supabase Storage에 업로드
 */
app.post("/api/upload/content", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        error: "Bad Request",
        message: "업로드할 이미지가 없습니다.",
      });
    }

    const { v4: uuidv4 } = require("uuid");

    // 고유한 파일명 생성
    const fileExtension = file.originalname.split(".").pop();
    const fileName = `${uuidv4()}.${fileExtension}`;
    const filePath = `contents/${fileName}`;

    // Supabase Storage에 파일 업로드
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      return res.status(500).json({
        error: "Storage Error",
        message: "이미지 업로드 중 오류가 발생했습니다.",
      });
    }

    // 공개 URL 생성
    const { data: publicUrlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    res.json({
      success: true,
      message: "이미지가 성공적으로 업로드되었습니다.",
      data: {
        path: data.path,
        publicUrl: publicUrlData.publicUrl,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal Server Error",
      message: "이미지 업로드 중 오류가 발생했습니다.",
    });
  }
});

/**
 * DELETE /api/upload/images
 * Supabase Storage에서 이미지 파일 삭제
 */
app.delete("/api/upload/images", async (req, res) => {
  try {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        error: "Bad Request",
        message: "삭제할 이미지 URL이 없습니다.",
      });
    }

    const filePaths = urls.map((url) => {
      // URL에서 파일 경로 추출
      const urlParts = url.split("/");
      return urlParts.slice(-2).join("/"); // review-images/filename.ext 형태
    });

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(filePaths);

    if (error) {
      return res.status(500).json({
        error: "Storage Error",
        message: "이미지 삭제 중 오류가 발생했습니다.",
      });
    }

    res.json({
      success: true,
      message: "이미지가 성공적으로 삭제되었습니다.",
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal Server Error",
      message: "이미지 삭제 중 오류가 발생했습니다.",
    });
  }
});

// 파일 삭제 API (기존 API 유지)
app.delete("/api/delete-file", async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({
        error: "Missing imageUrl",
      });
    }

    // Supabase URL에서 파일 경로 추출
    const baseUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/`;

    if (imageUrl.includes(baseUrl)) {
      const filePath = imageUrl.replace(baseUrl, "");

      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([filePath]);

      if (error) {
        throw error;
      }

      res.json({ success: true, message: "File deleted successfully" });
    } else {
      // 로컬 파일일 경우 (개발용)
      // fs와 path는 이미 상단에서 require됨

      // URL에서 uploads/ 경로 추출
      const match = imageUrl.match(/\/uploads\/(.*)/);
      if (match) {
        const filePath = match[1];
        const fullFilePath = path.join(__dirname, "uploads", filePath);

        if (fs.existsSync(fullFilePath)) {
          fs.unlinkSync(fullFilePath);
        }
      }

      res.json({ success: true, message: "File deleted successfully" });
    }
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
      details: error.toString(),
    });
  }
});

// ============================================
// 카카오 로그인 API
// ============================================

// JWT 토큰 생성 함수
const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET || "taroti-jwt-secret", {
    expiresIn: "7d",
  });
};

// JWT 토큰 검증 미들웨어
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET || "taroti-jwt-secret",
    (err, user) => {
      if (err) {
        return res.status(403).json({ error: "Invalid token" });
      }
      req.user = user;
      next();
    }
  );
};

// 카카오 로그인 API
app.post("/api/auth/kakao", async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({
        error: "Access token is required",
      });
    }

    // 카카오 API로 사용자 정보 조회
    const kakaoUserResponse = await axios.get(
      "https://kapi.kakao.com/v2/user/me",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const kakaoUser = kakaoUserResponse.data;
    const kakaoId = String(kakaoUser.id);

    // 기존 사용자 확인 또는 새 사용자 생성
    let user = await prisma.user.findUnique({
      where: { kakaoId },
    });

    if (!user) {
      // 새 사용자 생성
      user = await prisma.user.create({
        data: {
          kakaoId,
          email: kakaoUser.kakao_account?.email,
          nickname: kakaoUser.properties?.nickname || "사용자",
          profileImageUrl: kakaoUser.properties?.profile_image,
        },
      });
    } else {
      // 기존 사용자 정보 업데이트
      user = await prisma.user.update({
        where: { kakaoId },
        data: {
          email: kakaoUser.kakao_account?.email,
          nickname: kakaoUser.properties?.nickname || user.nickname,
          profileImageUrl:
            kakaoUser.properties?.profile_image || user.profileImageUrl,
        },
      });
    }

    // JWT 토큰 생성
    const token = generateToken({
      userId: user.id,
      kakaoId: user.kakaoId,
      nickname: user.nickname,
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        nickname: user.nickname,
        email: user.email,
        profileImageUrl: user.profileImageUrl,
      },
      token,
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 사용자 정보 조회 API
app.get("/api/auth/me", authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 프로필 완성도 확인
    const hasCompleteProfile = !!(user.gender && user.mbti && user.birthDate);

    res.json({
      id: user.id,
      nickname: user.nickname,
      email: user.email,
      profileImageUrl: user.profileImageUrl,
      gender: user.gender,
      mbti: user.mbti,
      birthDate: user.birthDate,
      hasCompleteProfile,
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 생년월일 유효성 검사 함수
const validateBirthDate = (birthDate) => {
  // YYMMDD 형식 확인 (6자리 숫자)
  if (!/^\d{6}$/.test(birthDate)) {
    return {
      valid: false,
      error: "생년월일은 YYMMDD 형식의 6자리 숫자여야 합니다.",
    };
  }

  const year = parseInt(birthDate.substring(0, 2));
  const month = parseInt(birthDate.substring(2, 4));
  const day = parseInt(birthDate.substring(4, 6));

  // 월 유효성 검사 (1-12)
  if (month < 1 || month > 12) {
    return { valid: false, error: "유효하지 않은 월입니다. (01-12)" };
  }

  // 일 유효성 검사
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // 윤년 고려하여 2월은 29일로 설정
  if (day < 1 || day > daysInMonth[month - 1]) {
    return {
      valid: false,
      error: `유효하지 않은 일입니다. ${month}월은 1-${
        daysInMonth[month - 1]
      }일까지 가능합니다.`,
    };
  }

  // 2월 29일 윤년 체크
  if (month === 2 && day === 29) {
    // 년도가 00-30이면 2000년대, 31-99이면 1900년대로 가정
    const fullYear = year <= 30 ? 2000 + year : 1900 + year;
    const isLeapYear =
      (fullYear % 4 === 0 && fullYear % 100 !== 0) || fullYear % 400 === 0;
    if (!isLeapYear) {
      return {
        valid: false,
        error: `${fullYear}년은 윤년이 아니므로 2월 29일은 유효하지 않습니다.`,
      };
    }
  }

  // 미래 날짜 체크
  const currentYear = new Date().getFullYear() % 100;
  const fullYear = year <= 30 ? 2000 + year : 1900 + year;
  const currentFullYear = new Date().getFullYear();
  const inputDate = new Date(fullYear, month - 1, day);
  const today = new Date();

  if (inputDate > today) {
    return { valid: false, error: "미래 날짜는 입력할 수 없습니다." };
  }

  // 너무 오래된 날짜 체크 (1900년 이전)
  if (fullYear < 1900) {
    return { valid: false, error: "1900년 이후의 날짜만 입력 가능합니다." };
  }

  return { valid: true };
};

// 사용자 프로필 업데이트 API
app.patch("/api/auth/profile", authenticateToken, async (req, res) => {
  try {
    const { gender, mbti, birthDate } = req.body;

    // 생년월일 유효성 검사
    if (birthDate !== undefined) {
      const validation = validateBirthDate(birthDate);
      if (!validation.valid) {
        return res.status(400).json({
          error: "Invalid birth date",
          message: validation.error,
        });
      }
    }

    // 성별 유효성 검사
    if (gender !== undefined && !["남성", "여성"].includes(gender)) {
      return res.status(400).json({
        error: "Invalid gender",
        message: "성별은 '남성' 또는 '여성'이어야 합니다.",
      });
    }

    // MBTI 유효성 검사
    const validMbtiTypes = [
      "INTJ",
      "INTP",
      "ENTJ",
      "ENTP",
      "INFJ",
      "INFP",
      "ENFJ",
      "ENFP",
      "ISTJ",
      "ISFJ",
      "ESTJ",
      "ESFJ",
      "ISTP",
      "ISFP",
      "ESTP",
      "ESFP",
      "UNKNOWN",
    ];
    if (mbti !== undefined && !validMbtiTypes.includes(mbti)) {
      return res.status(400).json({
        error: "Invalid MBTI type",
        message: "유효하지 않은 성격 유형입니다.",
      });
    }

    // 업데이트할 데이터 준비
    const updateData = {};
    if (gender !== undefined) updateData.gender = gender;
    if (mbti !== undefined) updateData.mbti = mbti;
    if (birthDate !== undefined) updateData.birthDate = birthDate;

    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: updateData,
    });

    // 프로필 완성도 확인
    const hasCompleteProfile = !!(user.gender && user.mbti && user.birthDate);

    res.json({
      success: true,
      user: {
        id: user.id,
        nickname: user.nickname,
        email: user.email,
        profileImageUrl: user.profileImageUrl,
        gender: user.gender,
        mbti: user.mbti,
        birthDate: user.birthDate,
        hasCompleteProfile,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 로그아웃 API (클라이언트에서 토큰 삭제)
app.post("/api/auth/logout", (req, res) => {
  res.json({
    success: true,
    message: "Logged out successfully",
  });
});

// ============================================
// Mind Reading API
// ============================================

// Mind Reading 세션 생성 API
app.post("/api/mind-reading", authenticateToken, async (req, res) => {
  try {
    const { gender, mbti, birthDate, selectedCard, sessionData } = req.body;

    // 입력 데이터 검증
    if (!gender || !mbti || !birthDate) {
      return res.status(400).json({
        error: "Missing required fields: gender, mbti, birthDate",
      });
    }

    // 생년월일 유효성 검사
    const birthDateValidation = validateBirthDate(birthDate);
    if (!birthDateValidation.valid) {
      return res.status(400).json({
        error: "Invalid birth date",
        message: birthDateValidation.error,
      });
    }

    // 성별 유효성 검사
    if (!["남성", "여성"].includes(gender)) {
      return res.status(400).json({
        error: "Invalid gender",
        message: "성별은 '남성' 또는 '여성'이어야 합니다.",
      });
    }

    // MBTI 유효성 검사
    const validMbtiTypes = [
      "INTJ",
      "INTP",
      "ENTJ",
      "ENTP",
      "INFJ",
      "INFP",
      "ENFJ",
      "ENFP",
      "ISTJ",
      "ISFJ",
      "ESTJ",
      "ESFJ",
      "ISTP",
      "ISFP",
      "ESTP",
      "ESFP",
      "UNKNOWN",
    ];
    if (!validMbtiTypes.includes(mbti)) {
      return res.status(400).json({
        error: "Invalid MBTI type",
        message: "유효하지 않은 성격 유형입니다.",
      });
    }

    // selectedCard 유효성 검사 및 처리
    let validSelectedCard = null;
    if (selectedCard !== undefined && selectedCard !== null) {
      const cardNum = parseInt(selectedCard);
      if (!isNaN(cardNum) && cardNum >= 0 && cardNum <= 21) {
        validSelectedCard = cardNum;
      }
    }

    // 디버깅: selectedCard 값 확인

    // Mind Reading 세션 생성
    const mindReading = await prisma.mindReading.create({
      data: {
        userId: req.user.userId,
        gender,
        mbti,
        birthDate,
        selectedCard: validSelectedCard,
        sessionData,
      },
    });

    res.json({
      success: true,
      mindReadingId: mindReading.id,
      message: "Mind Reading session created successfully",
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// Mind Reading 세션 조회 API
app.get("/api/mind-reading/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const mindReading = await prisma.mindReading.findUnique({
      where: {
        id: parseInt(id),
      },
      include: {
        user: {
          select: {
            nickname: true,
            profileImageUrl: true,
          },
        },
      },
    });

    if (!mindReading) {
      return res.status(404).json({ error: "Mind Reading session not found" });
    }

    res.json(mindReading);
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// Mind Reading 세션 업데이트 API
app.patch("/api/mind-reading/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { sessionData, isCompleted, isPaid, paymentClicked, interestShown } =
      req.body;

    const updateData = {};
    if (sessionData !== undefined) updateData.sessionData = sessionData;
    if (isCompleted !== undefined) updateData.isCompleted = isCompleted;
    if (isPaid !== undefined) updateData.isPaid = isPaid;
    if (paymentClicked !== undefined)
      updateData.paymentClicked = paymentClicked;
    if (interestShown !== undefined) updateData.interestShown = interestShown;

    const mindReading = await prisma.mindReading.update({
      where: {
        id: parseInt(id),
        userId: req.user.userId, // 본인의 세션만 수정 가능
      },
      data: updateData,
    });

    res.json({
      success: true,
      message: "Mind Reading session updated successfully",
      mindReading,
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// ============================================
// December Fortune API
// ============================================
// December Fortune 세션 생성 API (새로운 통합 시스템으로 리다이렉션)
app.post("/api/december-fortune", authenticateToken, async (req, res) => {
  try {
    const { fortuneType, selectedCardNumber } = req.body;

    // 입력 데이터 검증
    if (!fortuneType) {
      return res.status(400).json({
        error: "Missing required field: fortuneType",
      });
    }

    // 운세 타입 유효성 검사
    if (!["학업운", "금전운", "기본운"].includes(fortuneType)) {
      return res.status(400).json({
        error: "Invalid fortune type",
        message: "운세 타입은 '학업운', '금전운' 또는 '기본운'이어야 합니다.",
      });
    }

    // 카드 번호 유효성 검사
    if (selectedCardNumber === undefined || selectedCardNumber === null) {
      return res.status(400).json({
        error: "Missing required field: selectedCardNumber",
      });
    }

    if (
      !Number.isInteger(selectedCardNumber) ||
      selectedCardNumber < 0 ||
      selectedCardNumber > 21
    ) {
      return res.status(400).json({
        error: "Invalid card number",
        message: "카드 번호는 0-21 사이의 정수여야 합니다.",
      });
    }

    // 새로운 통합 시스템으로 리다이렉션
    // December Fortune 템플릿 찾기
    const template = await prisma.fortuneTemplate.findUnique({
      where: { templateKey: "december-fortune" },
    });

    if (!template) {
      return res.status(500).json({
        error: "Template not found",
        message: "December Fortune 템플릿을 찾을 수 없습니다.",
      });
    }

    // 새로운 Fortune Session 생성
    const fortuneSession = await prisma.fortuneSession.create({
      data: {
        templateId: template.id,
        userId: req.user.userId,
        selectedCard: selectedCardNumber,
        sessionMetadata: {
          fortuneType,
          legacyApi: "december-fortune",
        },
        fortuneData: {
          createdAt: new Date(),
          userAgent: req.headers["user-agent"] || "unknown",
        },
      },
      include: {
        template: true,
        user: {
          select: {
            nickname: true,
            profileImageUrl: true,
          },
        },
      },
    });

    // 기존 응답 형식과 호환되도록 변환
    res.status(201).json({
      success: true,
      message: "December Fortune session created successfully",
      fortuneId: fortuneSession.id,
      decemberFortune: {
        id: fortuneSession.id,
        userId: fortuneSession.userId,
        fortuneType,
        selectedCard: fortuneSession.selectedCard,
        fortuneData: fortuneSession.fortuneData,
        user: fortuneSession.user,
        createdAt: fortuneSession.createdAt,
        updatedAt: fortuneSession.updatedAt,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// December Fortune 세션 조회 API (새로운 통합 시스템으로 리다이렉션)
app.get("/api/december-fortune/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 먼저 새로운 시스템에서 찾기
    const fortuneSession = await prisma.fortuneSession.findFirst({
      where: {
        id: parseInt(id),
        template: {
          templateKey: "december-fortune",
        },
      },
      include: {
        template: true,
        user: {
          select: {
            nickname: true,
            profileImageUrl: true,
          },
        },
      },
    });

    if (fortuneSession) {
      // 새로운 시스템 데이터를 기존 형식으로 변환
      const decemberFortune = {
        id: fortuneSession.id,
        userId: fortuneSession.userId,
        fortuneType: fortuneSession.sessionMetadata?.fortuneType || "기본운",
        selectedCard: fortuneSession.selectedCard,
        fortuneData: fortuneSession.fortuneData,
        user: fortuneSession.user,
        createdAt: fortuneSession.createdAt,
        updatedAt: fortuneSession.updatedAt,
      };
      return res.json(decemberFortune);
    }

    // 새로운 시스템에 없으면 기존 시스템에서 찾기 (호환성을 위해)
    const legacyDecemberFortune = await prisma.decemberFortune.findUnique({
      where: {
        id: parseInt(id),
      },
      include: {
        user: {
          select: {
            nickname: true,
            profileImageUrl: true,
          },
        },
      },
    });

    if (!legacyDecemberFortune) {
      return res
        .status(404)
        .json({ error: "December Fortune session not found" });
    }

    res.json(legacyDecemberFortune);
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// December Fortune 공유 링크 생성 API (새로운 통합 시스템으로 리다이렉션)
app.post("/api/december-fortune/:id/share", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, image, cardName, nickname, fortuneType } =
      req.body;

    // 먼저 새로운 시스템에서 찾기
    const fortuneSession = await prisma.fortuneSession.findFirst({
      where: {
        id: parseInt(id),
        template: {
          templateKey: "december-fortune",
        },
      },
      include: {
        template: true,
        user: {
          select: {
            nickname: true,
            profileImageUrl: true,
          },
        },
      },
    });

    let fortuneData;
    if (fortuneSession) {
      // 새로운 시스템 데이터를 기존 형식으로 변환
      fortuneData = {
        id: fortuneSession.id,
        userId: fortuneSession.userId,
        fortuneType: fortuneSession.sessionMetadata?.fortuneType || "기본운",
        selectedCard: fortuneSession.selectedCard,
        fortuneData: fortuneSession.fortuneData,
        user: fortuneSession.user,
        createdAt: fortuneSession.createdAt,
        updatedAt: fortuneSession.updatedAt,
      };
    } else {
      // 기존 시스템에서 찾기 (호환성을 위해)
      const decemberFortune = await prisma.decemberFortune.findUnique({
        where: {
          id: parseInt(id),
        },
        include: {
          user: {
            select: {
              nickname: true,
              profileImageUrl: true,
            },
          },
        },
      });

      if (!decemberFortune) {
        return res
          .status(404)
          .json({ error: "December Fortune session not found" });
      }
      fortuneData = decemberFortune;
    }

    // 기존 공유 링크가 있는지 확인
    let shareLink = await prisma.shareLink.findUnique({
      where: {
        originalFortuneId: parseInt(id),
      },
    });

    // 기존 링크가 없으면 새로 생성
    if (!shareLink) {
      // 안전한 shareId 생성
      const shareId = `f${id}${Date.now().toString(36)}`.slice(0, 12);

      // 안전한 메타데이터 생성
      const userNickname =
        fortuneData.user?.nickname || nickname || "타로티 친구";
      const metadata = {
        title: title || `${userNickname}님의 12월 운세 결과`,
        description: description || "타로카드로 알아보는 12월 운세",
        image: image || `https://taroti-front.vercel.app/logo192.png`,
        cardName: cardName || "타로카드",
        nickname: userNickname,
        fortuneType: fortuneType || fortuneData.fortuneType || "운세",
      };

      // 데이터베이스에 공유 링크 저장
      shareLink = await prisma.shareLink.create({
        data: {
          shareId,
          originalFortuneId: parseInt(id),
          fortuneData: JSON.parse(JSON.stringify(fortuneData)),
          metadata: JSON.parse(JSON.stringify(metadata)),
        },
      });
    }

    res.json({
      success: true,
      shareId: shareLink.shareId,
      shareUrl: `${req.protocol}://${req.get("host")}/share/${
        shareLink.shareId
      }`,
      originalFortuneId: id,
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 공유 링크에서 원본 데이터 조회 API (프론트엔드용 - 필요한 경우)
app.get("/api/share/:shareId", async (req, res) => {
  try {
    const { shareId } = req.params;

    // 데이터베이스에서 공유 데이터 조회
    let shareLink = await prisma.shareLink.findUnique({
      where: {
        shareId: shareId,
      },
    });

    // 데이터베이스에 없는 경우, 클라이언트에서 생성한 ShareId인지 확인
    if (!shareLink) {
      try {
        // base64 디코딩 시도
        const decoded = atob(
          shareId.padEnd(shareId.length + ((4 - (shareId.length % 4)) % 4), "=")
        );
        const match = decoded.match(/^fortune-(\d+)$/);

        if (match) {
          const fortuneId = parseInt(match[1]);

          // 해당 운세 데이터를 직접 조회
          const decemberFortune = await prisma.decemberFortune.findUnique({
            where: { id: fortuneId },
            include: {
              user: {
                select: {
                  nickname: true,
                  profileImageUrl: true,
                },
              },
            },
          });

          if (decemberFortune) {
            // 임시 shareLink 객체 생성
            shareLink = {
              shareId,
              originalFortuneId: fortuneId,
              fortuneData: decemberFortune,
              metadata: {
                title: `${
                  decemberFortune.user?.nickname || "타로티 친구"
                }님의 12월 ${decemberFortune.fortuneType} 결과`,
                description: "타로카드로 알아보는 12월 운세",
                image: "https://taroti-front.vercel.app/logo192.png",
                cardName: "타로카드",
                nickname: decemberFortune.user?.nickname || "타로티 친구",
                fortuneType: decemberFortune.fortuneType || "운세",
              },
            };
          }
        }
      } catch (decodeError) {}
    }

    if (!shareLink) {
      return res.status(404).json({ error: "Share link not found" });
    }

    res.json({
      success: true,
      shareId,
      originalFortuneId: shareLink.originalFortuneId,
      fortuneData: shareLink.fortuneData,
      metadata: shareLink.metadata,
      originalUrl: `https://taroti-front.vercel.app/december-fortune-result/${shareLink.originalFortuneId}`,
    });
  } catch (error) {
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 공유 전용 HTML 페이지 서빙 (SSR용)
app.get("/share/:shareId", async (req, res) => {
  try {
    const { shareId } = req.params;

    // 데이터베이스에서 공유 데이터 조회
    let shareLink = await prisma.shareLink.findUnique({
      where: {
        shareId: shareId,
      },
    });

    // 데이터베이스에 없는 경우, 클라이언트에서 생성한 ShareId인지 확인
    if (!shareLink) {
      try {
        // base64 디코딩 시도
        const decoded = atob(
          shareId.padEnd(shareId.length + ((4 - (shareId.length % 4)) % 4), "=")
        );
        const match = decoded.match(/^fortune-(\d+)$/);

        if (match) {
          const fortuneId = parseInt(match[1]);

          // 해당 운세 데이터를 직접 조회
          const decemberFortune = await prisma.decemberFortune.findUnique({
            where: { id: fortuneId },
            include: {
              user: {
                select: {
                  nickname: true,
                  profileImageUrl: true,
                },
              },
            },
          });

          if (decemberFortune) {
            // 임시 shareLink 객체 생성
            shareLink = {
              shareId,
              originalFortuneId: fortuneId,
              fortuneData: decemberFortune,
              metadata: {
                title: `${
                  decemberFortune.user?.nickname || "타로티 친구"
                }님의 12월 ${decemberFortune.fortuneType} 결과`,
                description: "타로카드로 알아보는 12월 운세",
                image: "https://taroti-front.vercel.app/logo192.png",
                cardName: "타로카드",
                nickname: decemberFortune.user?.nickname || "타로티 친구",
                fortuneType: decemberFortune.fortuneType || "운세",
              },
            };
          }
        }
      } catch (decodeError) {}
    }

    if (!shareLink) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <title>TaroTI - 공유 링크를 찾을 수 없음</title>
          <meta http-equiv="refresh" content="3;url=https://taroti-front.vercel.app">
        </head>
        <body>
          <p>공유 링크를 찾을 수 없습니다. 3초 후 홈페이지로 이동합니다...</p>
        </body>
        </html>
      `);
    }

    // 저장된 메타데이터 사용
    const { metadata } = shareLink;
    // 공유 링크 자체 URL (OG 태그용)
    const shareUrl = `${req.protocol}://${req.get("host")}/share/${shareId}`;

    // 리다이렉트할 원본 URL (프론트엔드)
    const originalUrl = `https://taroti-front.vercel.app/december-fortune-result/${shareLink.originalFortuneId}`;

    // 정적 HTML 반환 (SNS 크롤러가 읽을 수 있도록)
    const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${metadata.title}</title>
    <meta name="description" content="${metadata.description}">

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="${shareUrl}">
    <meta property="og:title" content="${metadata.title}">
    <meta property="og:description" content="${metadata.description}">
    <meta property="og:image" content="${metadata.image}">
    <meta property="og:locale" content="ko_KR">
    <meta property="og:site_name" content="TaroTI">

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:url" content="${shareUrl}">
    <meta name="twitter:title" content="${metadata.title}">
    <meta name="twitter:description" content="${metadata.description}">
    <meta name="twitter:image" content="${metadata.image}">

    <!-- 카카오톡 공유용 -->
    <meta property="og:image:width" content="800">
    <meta property="og:image:height" content="400">

    <!-- SNS 크롤러를 위해 지연 리다이렉트 -->
    <meta http-equiv="refresh" content="5;url=${originalUrl}">

    <style>
        body {
            font-family: 'Noto Sans KR', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
        }
        .container {
            text-align: center;
            max-width: 500px;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        h1 { margin: 0 0 20px 0; font-size: 24px; }
        p { margin: 10px 0; font-size: 16px; opacity: 0.9; }
        .loading { font-size: 14px; opacity: 0.7; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔮 ${metadata.title}</h1>
        <p>${metadata.description}</p>
        <div class="loading">운세 결과 페이지로 이동 중...</div>
    </div>

    <script>
        // JavaScript가 실행되는 경우 즉시 리다이렉트
        window.location.href = '${originalUrl}';
    </script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (error) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="ko">
      <head>
        <meta charset="UTF-8">
        <title>TaroTI - 오류</title>
        <meta http-equiv="refresh" content="3;url=https://taroti-front.vercel.app">
      </head>
      <body>
        <p>오류가 발생했습니다. 3초 후 홈페이지로 이동합니다...</p>
      </body>
      </html>
    `);
  }
});

// 사용자 콘텐츠 기록 API (마이페이지)
app.get("/api/my-content/mind-reading", authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // 전체 개수 가져오기
    const totalCount = await prisma.mindReading.count({
      where: { userId: userId },
    });

    // 페이지네이션된 데이터 가져오기
    const mindReadings = await prisma.mindReading.findMany({
      where: { userId: userId },
      select: {
        id: true,
        selectedCard: true,
        createdAt: true,
        sessionData: true, // result 대신 sessionData 사용
        isCompleted: true,
      },
      orderBy: { createdAt: "desc" },
      skip: skip,
      take: limit,
    });

    // 응답 데이터 포맷 변경 (프론트엔드와 일치하도록)
    const formattedItems = mindReadings.map((item) => ({
      id: item.id,
      selectedCard: item.selectedCard,
      createdAt: item.createdAt,
      result: item.sessionData, // sessionData를 result로 매핑
      isCompleted: item.isCompleted,
    }));

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      items: formattedItems,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalCount: totalCount,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: "마음 읽기 기록을 가져오는데 실패했습니다.",
      details: error.message,
    });
  }
});

app.get(
  "/api/my-content/monthly-fortune",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.userId;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      // 새로운 시스템에서 December Fortune 세션들 조회
      const newSystemSessions = await prisma.fortuneSession.findMany({
        where: {
          userId: userId,
          template: {
            templateKey: "december-fortune",
          },
        },
        select: {
          id: true,
          selectedCard: true,
          sessionMetadata: true,
          fortuneData: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });

      // 기존 시스템에서 December Fortune 조회 (호환성을 위해)
      const legacyDecemberFortunes = await prisma.decemberFortune.findMany({
        where: { userId: userId },
        select: {
          id: true,
          fortuneType: true,
          selectedCard: true,
          createdAt: true,
          fortuneData: true,
        },
        orderBy: { createdAt: "desc" },
      });

      // 새로운 시스템 데이터를 기존 형식으로 변환
      const newFormatted = newSystemSessions.map((item) => ({
        id: item.id,
        fortuneType: item.sessionMetadata?.fortuneType || "기본운",
        selectedCardNumber: item.selectedCard,
        createdAt: item.createdAt,
        result: item.fortuneData,
      }));

      // 기존 시스템 데이터 포맷팅
      const legacyFormatted = legacyDecemberFortunes.map((item) => ({
        id: item.id,
        fortuneType: item.fortuneType,
        selectedCardNumber: item.selectedCard,
        createdAt: item.createdAt,
        result: item.fortuneData,
      }));

      // 두 시스템의 데이터 합치기 및 정렬
      const allItems = [...newFormatted, ...legacyFormatted].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );

      // 페이지네이션 적용
      const totalCount = allItems.length;
      const formattedItems = allItems.slice(skip, skip + limit);
      const totalPages = Math.ceil(totalCount / limit);

      res.json({
        items: formattedItems,
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalCount: totalCount,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      res.status(500).json({
        error: "월별 운세 기록을 가져오는데 실패했습니다.",
        details: error.message,
      });
    }
  }
);

// 2026년 상반기 운세 전용 공유 API 엔드포인트
app.get("/api/share-newyear-2026/:shareId", async (req, res) => {
  try {
    const { shareId } = req.params;

    // 데이터베이스에서 공유 데이터 조회
    const shareLink = await prisma.shareLink.findUnique({
      where: {
        shareId: shareId,
      },
    });

    if (!shareLink) {
      return res.status(404).json({
        success: false,
        error: "Share link not found",
      });
    }

    // 2026년 신년 운세 타입인지 확인
    if (shareLink.fortuneData.shareType !== "newyear-2026") {
      return res.status(404).json({
        success: false,
        error: "Invalid share link type",
      });
    }

    res.json({
      success: true,
      shareId,
      selectedCard: shareLink.fortuneData.selectedCard,
      nickname: shareLink.fortuneData.nickname,
      cardName: shareLink.metadata.cardName,
      fortuneType: shareLink.metadata.fortuneType,
      title: shareLink.metadata.title,
      description: shareLink.metadata.description,
      image: shareLink.metadata.image,
      originalFortuneId: shareLink.originalFortuneId,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 2026년 상반기 운세 전용 공유 HTML 페이지
app.get("/share-newyear-2026/:shareId", async (req, res) => {
  try {
    const { shareId } = req.params;

    // 데이터베이스에서 공유 데이터 조회
    const shareLink = await prisma.shareLink.findUnique({
      where: {
        shareId: shareId,
      },
    });

    if (!shareLink) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <title>TaroTI - 공유 링크를 찾을 수 없음</title>
          <meta http-equiv="refresh" content="3;url=https://taroti-front.vercel.app">
        </head>
        <body>
          <p>공유 링크를 찾을 수 없습니다. 3초 후 홈페이지로 이동합니다...</p>
        </body>
        </html>
      `);
    }

    // 2026년 신년 운세 타입인지 확인
    if (shareLink.fortuneData.shareType !== "newyear-2026") {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <title>TaroTI - 잘못된 공유 링크</title>
          <meta http-equiv="refresh" content="3;url=https://taroti-front.vercel.app">
        </head>
        <body>
          <p>잘못된 공유 링크입니다. 3초 후 홈페이지로 이동합니다...</p>
        </body>
        </html>
      `);
    }

    // 저장된 메타데이터 사용
    const { metadata } = shareLink;

    // 공유 링크 자체 URL (OG 태그용)
    const shareUrl = `${req.protocol}://${req.get(
      "host"
    )}/share-newyear-2026/${shareId}`;

    // 리다이렉트할 원본 URL (프론트엔드)
    const originalUrl = `https://taroti-front.vercel.app/newyear-fortune-result-2026/${shareLink.originalFortuneId}`;

    // 정적 HTML 반환 (SNS 크롤러가 읽을 수 있도록)
    const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${metadata.title}</title>
    <meta name="description" content="${metadata.description}">

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="${shareUrl}">
    <meta property="og:title" content="${metadata.title}">
    <meta property="og:description" content="${metadata.description}">
    <meta property="og:image" content="${metadata.image}">
    <meta property="og:locale" content="ko_KR">
    <meta property="og:site_name" content="TaroTI">

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:url" content="${shareUrl}">
    <meta name="twitter:title" content="${metadata.title}">
    <meta name="twitter:description" content="${metadata.description}">
    <meta name="twitter:image" content="${metadata.image}">

    <!-- 카카오톡 공유용 -->
    <meta property="og:image:width" content="800">
    <meta property="og:image:height" content="400">

    <!-- SNS 크롤러를 위해 지연 리다이렉트 -->
    <meta http-equiv="refresh" content="5;url=${originalUrl}">

    <style>
        body {
            font-family: 'Noto Sans KR', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
        }
        .container {
            text-align: center;
            max-width: 500px;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        h1 { margin: 0 0 20px 0; font-size: 24px; }
        p { margin: 10px 0; font-size: 16px; opacity: 0.9; }
        .loading { font-size: 14px; opacity: 0.7; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎊 ${metadata.title}</h1>
        <p>${metadata.description}</p>
        <div class="loading">2026년 상반기 운세 결과 페이지로 이동 중...</div>
    </div>
    <script>
        // JavaScript가 실행되는 경우 즉시 리다이렉트
        window.location.href = '${originalUrl}';
    </script>
</body>
</html>
    `;

    res.send(html);
  } catch (error) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="ko">
      <head>
        <meta charset="UTF-8">
        <title>TaroTI - 오류 발생</title>
        <meta http-equiv="refresh" content="3;url=https://taroti-front.vercel.app">
      </head>
      <body>
        <p>오류가 발생했습니다. 3초 후 홈페이지로 이동합니다...</p>
      </body>
      </html>
    `);
  }
});

// 스케줄러 초기화 함수
const initializeScheduler = async () => {
  try {
    // 1. Instagram 운세 스케줄러 초기화
    // 데이터베이스에서 활성화된 스케줄러 설정 확인
    const schedulerConfig = await prisma.dailyFortuneScheduler.findUnique({
      where: { id: 1 },
    });

    if (schedulerConfig && schedulerConfig.isActive) {
      // 운세 스케줄러 시작
      startFortuneScheduler(
        schedulerConfig.postingTime,
        schedulerConfig.fortuneTheme
      );
    }

    // 2. 일일 가입자 알림 스케줄러 시작 (항상 활성화)
    startDailySignupNotificationScheduler();

    console.log('[Scheduler] 스케줄러 초기화 완료');
  } catch (error) {
    console.error('[Scheduler] 스케줄러 초기화 실패:', error.message);
    console.error('[Scheduler] Stack:', error.stack);
  }
};

// 운세 스케줄러 시작 함수
const startFortuneScheduler = (postingTime, fortuneTheme = "기본운") => {
  // 기존 스케줄러가 있다면 중지
  if (fortuneScheduler) {
    fortuneScheduler.stop();
  }

  // 시간 파싱 (HH:MM 형식)
  const [hours, minutes] = postingTime.split(":").map(Number);
  const cronPattern = `${minutes} ${hours} * * *`; // 매일 지정된 시간에 실행

  fortuneScheduler = cron.schedule(
    cronPattern,
    async () => {
      try {
        // 즉시 실행과 동일한 로직 호출
        const result = await executeScheduledFortune(fortuneTheme);

        if (result.success) {
        } else {
        }
      } catch (error) {}
    },
    {
      scheduled: true,
      timezone: "Asia/Seoul",
    }
  );
};

// 스케줄된 운세 생성 실행 함수 (즉시 실행과 동일한 로직)
const executeScheduledFortune = async (fortuneTheme) => {
  try {
    // Instagram routes 모듈에서 공통 실행 함수 호출
    const instagramModule = require("./routes/instagram");

    // executeFortuneGeneration 함수가 export되어 있는지 확인 필요
    // 현재는 axios로 내부 API 호출하는 방식 사용
    const axios = require("axios");
    const response = await axios.post(
      `http://localhost:${PORT}/api/instagram/scheduler/run-now`,
      {
        fortuneTheme: fortuneTheme,
      }
    );

    return response.data;
  } catch (error) {
    return {
      success: false,
      error: error.message || "스케줄된 운세 생성 실패",
      details: error.response?.data || error.toString(),
    };
  }
};

// 스케줄러 중지 함수
const stopFortuneScheduler = () => {
  if (fortuneScheduler) {
    fortuneScheduler.stop();
    fortuneScheduler = null;
    return true;
  }
  return false;
};

// 스케줄러 관리 함수들을 전역으로 export
global.startFortuneScheduler = startFortuneScheduler;
global.stopFortuneScheduler = stopFortuneScheduler;

// ============================================
// 일일 가입자 알림 스케줄러
// ============================================

let dailySignupNotificationScheduler = null;

// 일일 가입자 수 집계 함수
const getDailySignupStats = async (targetDate) => {
  try {
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // 각 테이블별 가입자 수 조회
    const [userSignups, landingUserSignups, landingUserV2Signups] =
      await Promise.all([
        prisma.user.count({
          where: {
            createdAt: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
        }),
        prisma.landingUser.count({
          where: {
            createdAt: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
        }),
        prisma.landingUserV2.count({
          where: {
            createdAt: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
        }),
      ]);

    const totalSignups =
      userSignups + landingUserSignups + landingUserV2Signups;

    return {
      date: targetDate.toISOString().split("T")[0],
      totalSignups,
      userSignups,
      landingUserSignups,
      landingUserV2Signups,
    };
  } catch (error) {
    throw error;
  }
};

// 일일 가입자 알림 스케줄러 시작 함수
const startDailySignupNotificationScheduler = () => {
  // 기존 스케줄러가 있다면 중지
  if (dailySignupNotificationScheduler) {
    dailySignupNotificationScheduler.stop();
  }

  // 매일 오전 9시에 어제 가입자 수 알림 (0 9 * * *)
  const cronPattern = "0 9 * * *";

  dailySignupNotificationScheduler = cron.schedule(
    cronPattern,
    async () => {
      try {
        // 어제 날짜 계산
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        // 어제 가입자 수 집계
        const signupStats = await getDailySignupStats(yesterday);

        // Slack으로 알림 전송
        const slackService = require("./services/slackService");
        const result = await slackService.sendDailySignupReport(signupStats);

        if (result.success) {
        } else {
        }
      } catch (error) {
        // 오류 발생 시에도 Slack 알림
        try {
          const slackService = require("./services/slackService");
          await slackService.sendSystemAlert(
            "error",
            "일일 가입자 리포트 오류",
            "일일 가입자 집계 중 오류가 발생했습니다.",
            {
              environment: process.env.NODE_ENV || "development",
              timestamp: new Date().toISOString(),
              stack: error.stack,
            }
          );
        } catch (slackError) {}
      }
    },
    {
      scheduled: true,
      timezone: "Asia/Seoul",
    }
  );
};

// 일일 가입자 알림 스케줄러 중지 함수
const stopDailySignupNotificationScheduler = () => {
  if (dailySignupNotificationScheduler) {
    dailySignupNotificationScheduler.stop();
    dailySignupNotificationScheduler = null;
    return true;
  }
  return false;
};

// 수동으로 어제 가입자 리포트 전송하는 함수 (테스트용)
const sendYesterdaySignupReport = async () => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const signupStats = await getDailySignupStats(yesterday);

    const slackService = require("./services/slackService");
    const result = await slackService.sendDailySignupReport(signupStats);

    return {
      success: result.success,
      stats: signupStats,
      slackResult: result,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

// 전역으로 export
global.startDailySignupNotificationScheduler =
  startDailySignupNotificationScheduler;
global.stopDailySignupNotificationScheduler =
  stopDailySignupNotificationScheduler;
global.sendYesterdaySignupReport = sendYesterdaySignupReport;

// ============================================
// DATABASE HEALTH CHECK
// ============================================

// 데이터베이스 연결 확인
app.get("/api/db-health", async (req, res) => {
  try {
    if (!prisma) {
      return res.status(500).json({
        success: false,
        database: "disconnected",
        message: "Prisma client is not initialized",
        environment: process.env.VERCEL ? "vercel" : "local",
      });
    }

    // 간단한 데이터베이스 쿼리로 연결 확인
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      success: true,
      database: "connected",
      message: "Database connection is healthy",
      environment: process.env.VERCEL ? "vercel" : "local",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      database: "error",
      message: "Database connection failed",
      error: error.message,
      environment: process.env.VERCEL ? "vercel" : "local",
    });
  }
});

// ============================================
// VIDEO API - 영상 생성 테스트
// ============================================

// 생성된 영상 목록 조회
app.get("/api/video/list", async (req, res) => {
  try {
    // Prisma 클라이언트 확인
    if (!prisma) {
      return res.status(500).json({
        success: false,
        error: "Database connection not available",
        details: "Prisma client is not initialized",
      });
    }

    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // 총 개수 조회
    const totalCount = await prisma.generatedVideo.count();

    // 영상 목록 조회 (최신 순) - 연결된 이미지들도 함께 조회
    const videos = await prisma.generatedVideo.findMany({
      orderBy: {
        createdAt: "desc",
      },
      skip: parseInt(skip),
      take: parseInt(limit),
      select: {
        id: true,
        title: true,
        filename: true,
        publicUrl: true,
        duration: true,
        videoType: true,
        selectedCards: true,
        isPublished: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        images: {
          select: {
            id: true,
            filename: true,
            publicUrl: true,
            imageType: true,
            cardIndex: true,
            cardNumber: true,
            cardName: true,
            order: true,
          },
          orderBy: [
            { order: "asc" }, // 캐러셀 이미지는 order 순서로
            { cardIndex: "asc" }, // 일반 이미지는 cardIndex 순서로
          ],
        },
      },
    });

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: {
        videos: videos,
        pagination: {
          currentPage: parseInt(page),
          totalPages: totalPages,
          totalCount: totalCount,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "영상 목록 조회 중 오류가 발생했습니다",
      details: error.message,
    });
  }
});

// OPTIONS 메서드 처리 (CORS preflight)
app.options("/api/video/test/card-flip", (req, res) => {
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.sendStatus(200);
});

// 카드 뒤집기 영상 생성 테스트
app.post("/api/video/test/card-flip", async (req, res) => {
  try {
    const { videoType = "weekly-fortune", customTitle } = req.body;

    // videoType 검증
    const validTypes = ["weekly-fortune", "true-feelings"];
    if (!validTypes.includes(videoType)) {
      return res.status(400).json({
        success: false,
        error: "유효하지 않은 비디오 타입입니다",
        validTypes: validTypes,
      });
    }

    if (customTitle) {
    } else {
    }

    // Vercel 환경에서는 비디오 생성 비활성화
    if (process.env.VERCEL) {
      return res.status(503).json({
        success: false,
        error: "Video generation is not available in serverless environment",
        message: "Video generation requires local server environment",
      });
    }

    if (!VideoService) {
      return res.status(503).json({
        success: false,
        error: "VideoService not available",
        message: "Video generation service is not loaded",
      });
    }

    const videoService = new VideoService();
    const result = await videoService.generateCardFlipVideo(
      videoType,
      customTitle
    );

    await videoService.close();

    res.json({
      success: true,
      message: "카드 뒤집기 영상이 성공적으로 생성되었습니다",
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "카드 뒤집기 영상 생성 중 오류가 발생했습니다",
      message: error.message,
      method: req.method,
      url: req.url,
      environment: process.env.VERCEL ? "vercel" : "local",
    });
  }
});

// 통합 운세 공유 API 엔드포인트
app.get("/api/share-fortune/:shareId", async (req, res) => {
  try {
    const { shareId } = req.params;

    // 데이터베이스에서 공유 데이터 조회
    const shareLink = await prisma.shareLink.findUnique({
      where: {
        shareId: shareId,
      },
    });

    if (!shareLink) {
      return res.status(404).json({
        success: false,
        error: "Share link not found",
      });
    }

    // 통합 운세 세션 타입인지 확인
    if (shareLink.fortuneData.shareType !== "fortune-session") {
      return res.status(404).json({
        success: false,
        error: "Invalid share link type",
      });
    }

    res.json({
      success: true,
      shareId,
      selectedCard: shareLink.fortuneData.selectedCard,
      nickname: shareLink.fortuneData.nickname,
      cardName: shareLink.metadata.cardName,
      fortuneType: shareLink.metadata.fortuneType,
      title: shareLink.metadata.title,
      description: shareLink.metadata.description,
      image: shareLink.metadata.image,
      originalFortuneId: shareLink.originalFortuneId,
      templateKey: shareLink.fortuneData.templateKey,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
    });
  }
});

// 통합 운세 공유 HTML 페이지
app.get("/share-fortune/:shareId", async (req, res) => {
  try {
    const { shareId } = req.params;

    // 데이터베이스에서 공유 데이터 조회
    const shareLink = await prisma.shareLink.findUnique({
      where: {
        shareId: shareId,
      },
    });

    if (!shareLink) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <title>TaroTI - 공유 링크를 찾을 수 없음</title>
          <meta http-equiv="refresh" content="3;url=https://taroti-front.vercel.app">
        </head>
        <body>
          <p>공유 링크를 찾을 수 없습니다. 3초 후 홈페이지로 이동합니다...</p>
        </body>
        </html>
      `);
    }

    // 통합 운세 세션 타입인지 확인
    if (shareLink.fortuneData.shareType !== "fortune-session") {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <title>TaroTI - 잘못된 공유 링크</title>
          <meta http-equiv="refresh" content="3;url=https://taroti-front.vercel.app">
        </head>
        <body>
          <p>잘못된 공유 링크입니다. 3초 후 홈페이지로 이동합니다...</p>
        </body>
        </html>
      `);
    }

    // 저장된 메타데이터 사용
    const { metadata } = shareLink;

    // 공유 링크 자체 URL (OG 태그용)
    const shareUrl = `${req.protocol}://${req.get(
      "host"
    )}/share-fortune/${shareId}`;

    // 리다이렉트할 원본 URL (프론트엔드) - 직접 결과 페이지로
    const originalUrl = `https://taroti-front.vercel.app/fortune/${shareLink.fortuneData.templateKey}/result/${shareLink.originalFortuneId}`;

    // 정적 HTML 반환 (SNS 크롤러가 읽을 수 있도록)
    const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${metadata.title}</title>
    <meta name="description" content="${metadata.description}">

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="${shareUrl}">
    <meta property="og:title" content="${metadata.title}">
    <meta property="og:description" content="${metadata.description}">
    <meta property="og:image" content="${metadata.image}">
    <meta property="og:locale" content="ko_KR">
    <meta property="og:site_name" content="TaroTI">

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:url" content="${shareUrl}">
    <meta name="twitter:title" content="${metadata.title}">
    <meta name="twitter:description" content="${metadata.description}">
    <meta name="twitter:image" content="${metadata.image}">

    <!-- 카카오톡 공유용 -->
    <meta property="og:image:width" content="800">
    <meta property="og:image:height" content="400">

    <!-- SNS 크롤러를 위해 지연 리다이렉트 -->
    <meta http-equiv="refresh" content="5;url=${originalUrl}">

    <style>
        body {
            font-family: 'Noto Sans KR', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            text-align: center;
        }
        .loading {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        .card-image {
            width: 120px;
            height: 180px;
            background: white;
            border-radius: 10px;
            margin: 20px auto;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            color: #666;
        }
        .loading-dots {
            display: inline-block;
            position: relative;
            width: 20px;
            height: 20px;
            margin-left: 10px;
        }
        .loading-dots div {
            position: absolute;
            top: 8px;
            width: 4px;
            height: 4px;
            border-radius: 50%;
            background: white;
            animation: loading 1.2s linear infinite;
        }
        .loading-dots div:nth-child(1) { left: 2px; animation-delay: 0s; }
        .loading-dots div:nth-child(2) { left: 8px; animation-delay: -0.4s; }
        .loading-dots div:nth-child(3) { left: 14px; animation-delay: -0.8s; }
        @keyframes loading {
            0%, 80%, 100% { transform: scale(0); }
            40% { transform: scale(1); }
        }
    </style>
</head>
<body>
    <div class="loading">
        <h2>🔮 ${metadata.nickname}님의 운세 결과</h2>
        <div class="card-image">
            ${metadata.cardName}
        </div>
        <p>잠시만 기다려주세요...</p>
        <div class="loading-dots">
            <div></div>
            <div></div>
            <div></div>
        </div>
        <br><br>
        <small style="opacity: 0.8;">자동으로 페이지가 이동하지 않으면 <a href="${originalUrl}" style="color: #fff; text-decoration: underline;">여기를 클릭</a>하세요.</small>
    </div>

    <!-- 자동 리다이렉트를 위한 JavaScript -->
    <script>
        // 5초 후 리다이렉트 (SNS 크롤러 대응)
        setTimeout(function() {
            window.location.href = '${originalUrl}';
        }, 5000);

        // 사용자가 클릭할 수 있도록 유지
        // 즉시 리다이렉트는 제거
    </script>
</body>
</html>`;

    res.send(html);
  } catch (error) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="ko">
      <head>
        <meta charset="UTF-8">
        <title>TaroTI - 오류 발생</title>
        <meta http-equiv="refresh" content="3;url=https://taroti-front.vercel.app">
      </head>
      <body>
        <p>페이지를 불러오는 중 오류가 발생했습니다. 3초 후 홈페이지로 이동합니다...</p>
      </body>
      </html>
    `);
  }
});

// 영상 서비스 상태 확인
app.get("/api/video/status", async (req, res) => {
  try {
    if (process.env.VERCEL) {
      return res.json({
        success: false,
        message: "Video service is not available in serverless environment",
        features: [],
        supported_formats: [],
        max_duration: "0s",
        environment: "serverless",
      });
    }

    res.json({
      success: true,
      message: "Video service is available",
      features: [
        "card-flip-animation",
        "supabase-upload",
        "random-card-selection",
      ],
      supported_formats: ["webm", "mp4"],
      max_duration: "10s",
      environment: "local",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Video service status check failed",
      message: error.message,
    });
  }
});

// Vercel 서버리스 함수를 위한 export
if (process.env.VERCEL) {
  // Vercel 환경에서는 서버리스 함수로 export
  module.exports = app;
} else {
  // 로컬 개발 환경에서는 일반 서버 실행
  app.listen(PORT, () => {
    // 스케줄러 인스턴스에서만 스케줄러 초기화 (taroti-scheduler)
    if (process.env.NODE_ENV === 'scheduler') {
      initializeScheduler();
    }
  });
}

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
