const express = require('express');
const router = express.Router();
const axios = require('axios');
const prisma = require('../lib/prisma');
const slackService = require('../services/slackService');
const FortuneService = require('../services/fortuneService');



// Instagram Business API 기본 설정
const INSTAGRAM_API_BASE_URL = 'https://graph.instagram.com';
const INSTAGRAM_OAUTH_BASE_URL = 'https://api.instagram.com/oauth';

// Instagram 업로드 헬퍼 함수
async function uploadToInstagram(connection, savedPosts, theme) {
  try {

    for (let i = 0; i < savedPosts.length; i++) {
      const post = savedPosts[i];

      // Supabase 공개 URL들을 직접 사용 (이미 전체 URL임)
      const imageUrls = post.imageUrls;

      // 캐러셀 캡션 생성
      const caption = generateInstagramCaption(post, theme);


      // Instagram 캐러셀 업로드
      const uploadResult = await uploadInstagramCarousel(
        connection,
        imageUrls,
        caption
      );

      if (uploadResult.success) {
        // 데이터베이스에 Instagram 포스트 ID 저장
        await prisma.dailyFortunePost.update({
          where: { id: post.id },
          data: {
            instagramPostId: uploadResult.mediaId,
            status: 'PUBLISHED',
            publishedAt: new Date()
          }
        });
      } else {
        // 실패한 포스트는 상태를 FAILED로 업데이트
        await prisma.dailyFortunePost.update({
          where: { id: post.id },
          data: {
            status: 'FAILED',
            errorMessage: uploadResult.error
          }
        });
      }

      // API 제한을 위해 잠시 대기
      if (i < savedPosts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return { success: true };

  } catch (error) {
    throw error;
  }
}

// Instagram 캐러셀 업로드 함수 (개선된 버전 with 재시도 로직)
async function uploadInstagramCarousel(connection, imageUrls, caption) {
  try {

    // Step 1: 각 이미지에 대해 child container 생성
    const childContainerIds = [];
    for (let i = 0; i < imageUrls.length; i++) {
      try {
        const childContainerResponse = await axios.post(
          `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media`,
          {
            image_url: imageUrls[i],
            is_carousel_item: true,
            access_token: connection.accessToken
          }
        );
        childContainerIds.push(childContainerResponse.data.id);

        // API 제한을 피하기 위한 딜레이 (각 컨테이너 생성 사이에 1초 대기)
        if (i < imageUrls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        throw new Error(`이미지 ${i + 1} 컨테이너 생성 실패: ${error.response?.data?.error?.message || error.message}`);
      }
    }

    // Step 1.5: 모든 child container가 준비될 때까지 대기 (3초)
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 2: 캐러셀 container 생성
    let carouselContainerId;
    try {
      const carouselContainerResponse = await axios.post(
        `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media`,
        {
          media_type: 'CAROUSEL',
          children: childContainerIds.join(','),
          caption: caption,
          access_token: connection.accessToken
        }
      );
      carouselContainerId = carouselContainerResponse.data.id;
    } catch (error) {
      throw new Error(`캐러셀 컨테이너 생성 실패: ${error.response?.data?.error?.message || error.message}`);
    }

    // Step 2.5: 캐러셀 container가 준비될 때까지 대기 (5초)
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 3: 미디어 발행 (재시도 로직 포함)
    let mediaId;
    const maxRetries = 3;

    for (let retry = 0; retry < maxRetries; retry++) {
      try {

        const publishResponse = await axios.post(
          `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media_publish`,
          {
            creation_id: carouselContainerId,
            access_token: connection.accessToken
          }
        );

        mediaId = publishResponse.data.id;
        break; // 성공하면 루프 탈출

      } catch (error) {
        const isLastRetry = retry === maxRetries - 1;
        const errorMessage = error.response?.data?.error?.message || error.message;
        const errorCode = error.response?.data?.error?.code || 'UNKNOWN';
        const errorType = error.response?.data?.error?.type || 'UNKNOWN';


        // 특정 에러 타입에 대한 대기 시간 조정
        let waitTime = (retry + 1) * 3000; // 기본: 3초, 6초, 9초

        // Instagram API Rate Limit 에러인 경우 더 오래 대기
        if (errorCode === 32 || errorMessage.includes('rate limit') || errorMessage.includes('Application request limit')) {
          waitTime = (retry + 1) * 10000; // 10초, 20초, 30초
        }

        if (isLastRetry) {
          throw new Error(`미디어 발행 실패 (${maxRetries}회 시도) - 코드: ${errorCode}, 메시지: ${errorMessage}`);
        }

        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    return {
      success: true,
      mediaId: mediaId,
      carouselContainerId: carouselContainerId
    };

  } catch (error) {

    // Container들이 성공적으로 생성되었는지 확인
    if (carouselContainerId && childContainerIds.length > 0) {

      // 에러 메시지 상세 분석을 위한 추가 로깅

      // Rate limit 오류인 경우 부분적 성공으로 처리
      if (error.message.includes('Application request limit') ||
          error.message.includes('Rate limit') ||
          error.message.includes('코드: 4') ||
          error.message.includes('코드: -1')) {
        return {
          success: true, // 부분적 성공으로 처리
          partial: true,
          mediaId: null,
          carouselContainerId: carouselContainerId,
          note: 'Instagram API Rate Limit 또는 시스템 오류로 인해 발행 확인 불가하지만 Container 생성 완료'
        };
      }
    }

    return {
      success: false,
      error: error.message
    };
  }
}

// 통합 데이터베이스 저장 함수
async function saveDailyConsolidatedFortune(fortunes, imageResults, theme) {
  try {
    // 모든 별자리 운세를 하나의 레코드로 저장
    const fortunesData = fortunes.map(fortune => ({
      zodiacSign: fortune.zodiacSign,
      cardNumber: fortune.cardNumber,
      fortuneText: fortune.fortuneText
    }));

    const savedPost = await prisma.dailyFortunePost.create({
      data: {
        zodiacSign: 'ALL_ZODIACS', // 모든 별자리 통합
        fortuneTheme: theme,
        tarotCard: 0, // 통합 포스트용 기본값
        fortuneText: JSON.stringify(fortunesData), // 모든 운세 데이터를 JSON으로 저장
        imageUrls: imageResults.imageUrls,
        status: 'READY',
        createdAt: new Date()
      }
    });

    return savedPost;

  } catch (error) {
    throw error;
  }
}

// 통합 Instagram 업로드 함수
async function uploadConsolidatedToInstagram(connection, savedPost, theme) {
  try {
    savedPost.imageUrls.forEach((url, index) => {
      const imageType = ['썸네일', '페이지1', '페이지2', '페이지3', '마무리'][index];
    });

    const caption = generateConsolidatedInstagramCaption(theme);

    const uploadResult = await uploadInstagramCarousel(
      connection,
      savedPost.imageUrls,
      caption
    );

    if (uploadResult.success) {

      const postStatus = uploadResult.partial ? 'PENDING' : 'PUBLISHED';
      const mediaId = uploadResult.mediaId || uploadResult.carouselContainerId || 'CONTAINER_' + Date.now();

      const instagramPost = await prisma.instagramPost.create({
        data: {
          connectionId: connection.id,
          instagramMediaId: mediaId,
          instagramPostId: mediaId,
          caption: caption,
          hashtags: connection.defaultHashtags || '',
          imageUrl: JSON.stringify(savedPost.imageUrls),
          mediaType: 'CAROUSEL_ALBUM',
          status: postStatus,
          publishedAt: new Date()
        }
      });

      if (uploadResult.partial) {
      } else {
      }


      // 성공 또는 부분적 성공 시 결과 반환
      return {
        success: true,
        partial: uploadResult.partial || false,
        mediaId: mediaId,
        postId: instagramPost.id,
        publishedAt: instagramPost.publishedAt,
        note: uploadResult.note
      };
    } else {
      throw new Error(uploadResult.error);
    }

  } catch (error) {
    throw error;
  }
}

// 통합 Instagram 캡션 생성 함수
function generateConsolidatedInstagramCaption(theme) {
  const today = new Date().toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric'
  });

  const themeTitle = {
    '기본운': '오늘의 기본 운세',
    '연애운': '오늘의 연애 운세',
    '금전운': '오늘의 금전 운세',
    '건강운': '오늘의 건강 운세'
  }[theme] || '오늘의 운세';

  return `🔮 ${today} ${themeTitle} ✨

12개 별자리 모든 운세를 한 번에!
당신의 별자리를 찾아 오늘의 메시지를 확인해보세요 🌟

📖 스와이프해서 더 자세한 운세 보기 👉
🎴 타로카드로 풀어보는 특별한 메시지

📱 더 자세한 개인 맞춤 상담은 프로필 링크에서! 👆

#타로 #운세 #${theme.replace('운', '')} #타로티 #TaroTI #오늘의운세 #별자리운세 #타로카드 #점성술 #12별자리 #오늘의타로`;
}

// 개별 Instagram 캡션 생성 함수 (기존 기능 유지)
function generateInstagramCaption(post, theme) {
  const today = new Date().toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric'
  });

  return `🔮 ${today} ${post.zodiacSign} ${theme} ✨

${post.fortuneText}

📱 더 자세한 운세와 타로 상담은 프로필 링크에서! 👆

#타로 #운세 #${post.zodiacSign} #${theme.replace('운', '')} #타로티 #TaroTI #오늘의운세 #별자리운세 #타로카드 #점성술`;
}

/**
 * 인스타그램 연결 상태 확인
 * GET /api/instagram/status
 */
router.get('/status', async (req, res) => {
  try {
    // 현재 활성화된 Instagram 연결 조회
    const connection = await prisma.instagramConnection.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });

    if (!connection) {
      return res.json({
        isConnected: false,
        message: 'Instagram 계정이 연결되지 않았습니다.'
      });
    }

    // 토큰 만료 확인
    const now = new Date();
    const isTokenExpired = connection.tokenExpiresAt <= now;

    if (isTokenExpired) {
      return res.json({
        isConnected: false,
        message: '토큰이 만료되었습니다. 다시 연결해주세요.',
        tokenExpired: true
      });
    }

    res.json({
      isConnected: true,
      accessToken: connection.accessToken,
      userInfo: {
        id: connection.instagramUserId,
        username: connection.instagramUsername,
        account_type: connection.accountType
      },
      settings: {
        autoPostingEnabled: connection.autoPostingEnabled,
        postingTime: connection.postingTime,
        postingFrequency: connection.postingFrequency,
        defaultHashtags: connection.defaultHashtags
      },
      tokenExpiresAt: connection.tokenExpiresAt
    });

  } catch (error) {
    res.status(500).json({
      error: '상태 확인 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * Instagram OAuth 콜백 처리
 * POST /api/instagram/callback
 */
router.post('/callback', async (req, res) => {
  try {
    const { code } = req.body;


    if (!code) {
      return res.status(400).json({
        error: '인증 코드가 필요합니다.'
      });
    }

    // Step 1: 인증 코드를 단기 액세스 토큰으로 교환

    // URLSearchParams를 사용하여 form-urlencoded 형식으로 변환
    const params = new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID,
      client_secret: process.env.INSTAGRAM_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI,
      code: code
    });

    const tokenResponse = await axios.post(
      `${INSTAGRAM_OAUTH_BASE_URL}/access_token`,
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    // Instagram API 응답 구조 확인
    let access_token, user_id, permissions;

    // 응답이 배열 형태인 경우와 객체 형태인 경우를 모두 처리
    if (tokenResponse.data.data && Array.isArray(tokenResponse.data.data)) {
      ({ access_token, user_id, permissions } = tokenResponse.data.data[0]);
    } else if (tokenResponse.data.access_token) {
      access_token = tokenResponse.data.access_token;
      user_id = tokenResponse.data.user_id;
      permissions = tokenResponse.data.permissions;
    } else {
      throw new Error('예상치 못한 토큰 응답 형식');
    }


    // Step 2: 단기 토큰을 장기 토큰으로 교환
    const longTokenResponse = await axios.get(`${INSTAGRAM_API_BASE_URL}/access_token`, {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: process.env.INSTAGRAM_APP_SECRET,
        access_token: access_token
      }
    });

    const { access_token: longLivedToken, expires_in } = longTokenResponse.data;

    // Step 3: 사용자 정보 조회 (실패해도 계속 진행)
    let userInfo = {
      id: user_id,
      username: null,
      account_type: 'BUSINESS'
    };

    try {
      // 먼저 비즈니스 계정 정보를 가져오기 위해 me 엔드포인트 시도
      const meResponse = await axios.get(`${INSTAGRAM_API_BASE_URL}/v21.0/me`, {
        params: {
          fields: 'id,username,account_type',
          access_token: longLivedToken
        }
      });

      if (meResponse.data) {
        userInfo = meResponse.data;
      }
    } catch (meError) {

      try {
        // user_id로 직접 조회 시도
        const userInfoResponse = await axios.get(`${INSTAGRAM_API_BASE_URL}/v21.0/${user_id}`, {
          params: {
            fields: 'id,username',
            access_token: longLivedToken
          }
        });
        userInfo = { ...userInfoResponse.data, account_type: 'BUSINESS' };
      } catch (userError) {
        // 사용자 정보 조회가 실패해도 계속 진행
      }
    }

    // Step 4: 데이터베이스에 연결 정보 저장
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // 기존 활성 연결 비활성화
    await prisma.instagramConnection.updateMany({
      where: { isActive: true },
      data: { isActive: false }
    });

    // 새 연결 생성
    const connection = await prisma.instagramConnection.create({
      data: {
        accessToken: longLivedToken,
        tokenExpiresAt: expiresAt,
        instagramUserId: userInfo.id,
        instagramUsername: userInfo.username,
        accountType: userInfo.account_type,
        permissions: Array.isArray(permissions) ? permissions : (permissions ? permissions.split(',') : null),
        isActive: true,
        lastRefreshedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Instagram 연결이 완료되었습니다.',
      userInfo: {
        id: userInfo.id,
        username: userInfo.username,
        account_type: userInfo.account_type
      },
      tokenExpiresAt: expiresAt
    });

  } catch (error) {

    res.status(500).json({
      error: 'Instagram 연결 중 오류가 발생했습니다.',
      details: error.response?.data || error.message,
      errorCode: error.response?.status
    });
  }
});

/**
 * 토큰 갱신
 * POST /api/instagram/refresh-token
 */
router.post('/refresh-token', async (req, res) => {
  try {
    // 현재 활성화된 연결 조회
    const connection = await prisma.instagramConnection.findFirst({
      where: { isActive: true }
    });

    if (!connection) {
      return res.status(404).json({
        error: '연결된 Instagram 계정이 없습니다.'
      });
    }

    // 토큰 갱신 API 호출
    const refreshResponse = await axios.get(`${INSTAGRAM_API_BASE_URL}/refresh_access_token`, {
      params: {
        grant_type: 'ig_refresh_token',
        access_token: connection.accessToken
      }
    });

    const { access_token: newToken, expires_in } = refreshResponse.data;
    const newExpiresAt = new Date(Date.now() + expires_in * 1000);

    // 데이터베이스 업데이트
    const updatedConnection = await prisma.instagramConnection.update({
      where: { id: connection.id },
      data: {
        accessToken: newToken,
        tokenExpiresAt: newExpiresAt,
        lastRefreshedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: '토큰이 성공적으로 갱신되었습니다.',
      accessToken: newToken,
      tokenExpiresAt: newExpiresAt
    });

  } catch (error) {
    res.status(500).json({
      error: '토큰 갱신 중 오류가 발생했습니다.',
      details: error.response?.data || error.message
    });
  }
});

/**
 * Instagram 연결 해제
 * POST /api/instagram/disconnect
 */
router.post('/disconnect', async (req, res) => {
  try {
    // 모든 활성 연결 비활성화
    await prisma.instagramConnection.updateMany({
      where: { isActive: true },
      data: { isActive: false }
    });

    res.json({
      success: true,
      message: 'Instagram 연결이 해제되었습니다.'
    });

  } catch (error) {
    res.status(500).json({
      error: '연결 해제 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 연결 테스트
 * POST /api/instagram/test
 */
router.post('/test', async (req, res) => {
  try {
    const connection = await prisma.instagramConnection.findFirst({
      where: { isActive: true }
    });

    if (!connection) {
      return res.status(404).json({
        error: '연결된 Instagram 계정이 없습니다.'
      });
    }

    // Instagram API로 사용자 정보 조회하여 연결 테스트
    const response = await axios.get(`${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}`, {
      params: {
        fields: 'id,username,account_type,followers_count,follows_count,media_count',
        access_token: connection.accessToken
      }
    });

    const userInfo = response.data;

    // 데이터베이스의 사용자 정보 업데이트
    await prisma.instagramConnection.update({
      where: { id: connection.id },
      data: {
        instagramUsername: userInfo.username,
        accountType: userInfo.account_type,
        lastRefreshedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: '연결 테스트가 성공했습니다.',
      userInfo: {
        id: userInfo.id,
        username: userInfo.username,
        account_type: userInfo.account_type,
        followers_count: userInfo.followers_count,
        follows_count: userInfo.follows_count,
        media_count: userInfo.media_count
      }
    });

  } catch (error) {

    if (error.response?.status === 400 && error.response.data?.error?.code === 190) {
      // 토큰 만료
      await prisma.instagramConnection.updateMany({
        where: { isActive: true },
        data: { isActive: false }
      });

      return res.status(401).json({
        error: '토큰이 만료되었습니다. 다시 연결해주세요.',
        tokenExpired: true
      });
    }

    res.status(500).json({
      error: '연결 테스트 중 오류가 발생했습니다.',
      details: error.response?.data || error.message
    });
  }
});

/**
 * 자동 포스팅 설정 업데이트
 * POST /api/instagram/settings
 */
router.post('/settings', async (req, res) => {
  try {
    const {
      autoPostingEnabled,
      postingTime,
      postingFrequency,
      defaultHashtags
    } = req.body;

    const connection = await prisma.instagramConnection.findFirst({
      where: { isActive: true }
    });

    if (!connection) {
      return res.status(404).json({
        error: '연결된 Instagram 계정이 없습니다.'
      });
    }

    const updatedConnection = await prisma.instagramConnection.update({
      where: { id: connection.id },
      data: {
        autoPostingEnabled: autoPostingEnabled !== undefined ? autoPostingEnabled : connection.autoPostingEnabled,
        postingTime: postingTime || connection.postingTime,
        postingFrequency: postingFrequency || connection.postingFrequency,
        defaultHashtags: defaultHashtags || connection.defaultHashtags
      }
    });

    res.json({
      success: true,
      message: '설정이 저장되었습니다.',
      settings: {
        autoPostingEnabled: updatedConnection.autoPostingEnabled,
        postingTime: updatedConnection.postingTime,
        postingFrequency: updatedConnection.postingFrequency,
        defaultHashtags: updatedConnection.defaultHashtags
      }
    });

  } catch (error) {
    res.status(500).json({
      error: '설정 저장 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 캐러셀 게시물 업로드 (여러 이미지)
 * POST /api/instagram/upload-carousel
 */
router.post('/upload-carousel', async (req, res) => {
  try {
    const { imageUrls, caption, hashtags } = req.body;

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({
        error: '이미지 URL 배열이 필요합니다. (최소 1개, 최대 10개)'
      });
    }

    if (imageUrls.length > 10) {
      return res.status(400).json({
        error: 'Instagram 캐러셀은 최대 10개의 이미지만 지원합니다.'
      });
    }

    if (!caption) {
      return res.status(400).json({
        error: '캡션은 필수입니다.'
      });
    }

    // 현재 활성화된 연결 조회
    const connection = await prisma.instagramConnection.findFirst({
      where: { isActive: true }
    });

    if (!connection) {
      return res.status(404).json({
        error: '연결된 Instagram 계정이 없습니다.'
      });
    }

    // Step 1: 각 이미지에 대한 미디어 컨테이너 생성
    const childContainerIds = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const imageUrl = imageUrls[i];

      try {
        const childContainerResponse = await axios.post(
          `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media`,
          {
            image_url: imageUrl,
            is_carousel_item: true,
            access_token: connection.accessToken
          }
        );

        childContainerIds.push(childContainerResponse.data.id);

        // API 제한을 피하기 위한 잠시 대기
        if (i < imageUrls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        throw new Error(`이미지 ${i + 1} 처리 중 오류가 발생했습니다: ${error.response?.data?.error?.message || error.message}`);
      }
    }

    // Step 2: 캐러셀 컨테이너 생성
    const carouselContainerResponse = await axios.post(
      `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media`,
      {
        media_type: 'CAROUSEL',
        children: childContainerIds,
        caption: `${caption}\n\n${hashtags || connection.defaultHashtags || ''}`.trim(),
        access_token: connection.accessToken
      }
    );

    const carouselContainerId = carouselContainerResponse.data.id;

    // Step 3: 캐러셀 발행
    const publishResponse = await axios.post(
      `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media_publish`,
      {
        creation_id: carouselContainerId,
        access_token: connection.accessToken
      }
    );

    const mediaId = publishResponse.data.id;

    // Step 4: 데이터베이스에 포스트 정보 저장
    const instagramPost = await prisma.instagramPost.create({
      data: {
        connectionId: connection.id,
        instagramMediaId: mediaId,
        instagramPostId: mediaId,
        caption: caption,
        hashtags: hashtags || connection.defaultHashtags || '',
        imageUrl: JSON.stringify(imageUrls),
        mediaType: 'CAROUSEL_ALBUM',
        status: 'PUBLISHED',
        publishedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: `Instagram에 ${imageUrls.length}개 이미지 캐러셀이 성공적으로 게시되었습니다.`,
      post: {
        id: instagramPost.id,
        instagramMediaId: mediaId,
        caption: caption,
        imageUrls: imageUrls,
        imageCount: imageUrls.length,
        publishedAt: instagramPost.publishedAt
      }
    });

  } catch (error) {

    // 에러 코드에 따른 상세 메시지
    let errorMessage = '캐러셀 게시물 업로드 중 오류가 발생했습니다.';

    if (error.response?.data?.error) {
      const instagramError = error.response.data.error;
      if (instagramError.code === 190) {
        errorMessage = '토큰이 만료되었습니다. 다시 연결해주세요.';
      } else if (instagramError.code === 100) {
        errorMessage = '이미지 URL이 유효하지 않거나 접근할 수 없습니다.';
      } else if (instagramError.message) {
        errorMessage = instagramError.message;
      }
    }

    res.status(500).json({
      error: errorMessage,
      details: error.response?.data || error.message
    });
  }
});

/**
 * 단일 이미지 게시물 업로드 (기존 기능 유지)
 * POST /api/instagram/upload
 */
router.post('/upload', async (req, res) => {
  try {
    const { imageUrl, caption, hashtags } = req.body;

    if (!imageUrl || !caption) {
      return res.status(400).json({
        error: '이미지 URL과 캡션은 필수입니다.'
      });
    }

    // 현재 활성화된 연결 조회
    const connection = await prisma.instagramConnection.findFirst({
      where: { isActive: true }
    });

    if (!connection) {
      return res.status(404).json({
        error: '연결된 Instagram 계정이 없습니다.'
      });
    }

    // Step 1: 미디어 컨테이너 생성
    const containerResponse = await axios.post(
      `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media`,
      {
        image_url: imageUrl,
        caption: `${caption}\n\n${hashtags || connection.defaultHashtags || ''}`.trim(),
        access_token: connection.accessToken
      }
    );

    const containerId = containerResponse.data.id;

    // Step 2: 미디어 발행
    const publishResponse = await axios.post(
      `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media_publish`,
      {
        creation_id: containerId,
        access_token: connection.accessToken
      }
    );

    const mediaId = publishResponse.data.id;

    // Step 3: 데이터베이스에 포스트 정보 저장
    const instagramPost = await prisma.instagramPost.create({
      data: {
        connectionId: connection.id,
        instagramMediaId: mediaId,
        instagramPostId: mediaId,
        caption: caption,
        hashtags: hashtags || connection.defaultHashtags || '',
        imageUrl: imageUrl,
        mediaType: 'IMAGE',
        status: 'PUBLISHED',
        publishedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Instagram에 성공적으로 게시되었습니다.',
      post: {
        id: instagramPost.id,
        instagramMediaId: mediaId,
        caption: caption,
        imageUrl: imageUrl,
        publishedAt: instagramPost.publishedAt
      }
    });

  } catch (error) {

    // 에러 코드에 따른 상세 메시지
    let errorMessage = '게시물 업로드 중 오류가 발생했습니다.';

    if (error.response?.data?.error) {
      const instagramError = error.response.data.error;
      if (instagramError.code === 190) {
        errorMessage = '토큰이 만료되었습니다. 다시 연결해주세요.';
      } else if (instagramError.code === 100) {
        errorMessage = '이미지 URL이 유효하지 않거나 접근할 수 없습니다.';
      } else if (instagramError.message) {
        errorMessage = instagramError.message;
      }
    }

    res.status(500).json({
      error: errorMessage,
      details: error.response?.data || error.message
    });
  }
});

/**
 * 스케줄러 상태 조회
 * GET /api/instagram/scheduler/status
 */
router.get('/scheduler/status', async (req, res) => {
  try {
    // 데이터베이스에서 스케줄러 설정 조회
    const scheduler = await prisma.dailyFortuneScheduler.findFirst({
      orderBy: { createdAt: 'desc' }
    });

    if (!scheduler) {
      return res.json({
        isActive: false,
        postingTime: '09:00',
        fortuneTheme: '기본운',
        nextRunAt: null,
        lastRunAt: null,
        message: '스케줄러가 설정되지 않았습니다.'
      });
    }

    res.json({
      isActive: scheduler.isActive,
      postingTime: scheduler.postingTime,
      fortuneTheme: scheduler.fortuneTheme,
      nextRunAt: scheduler.nextRunAt,
      lastRunAt: scheduler.lastRunAt,
      settings: scheduler.settings
    });

  } catch (error) {
    res.status(500).json({
      error: '스케줄러 상태 조회 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 스케줄러 시작/중지
 * POST /api/instagram/scheduler/start
 */
router.post('/scheduler/start', async (req, res) => {
  try {
    const { action, postingTime, fortuneTheme } = req.body;
    const isStart = action === 'start';

    // 다음 실행 시간 계산
    let nextRunAt = null;
    if (isStart && postingTime) {
      const now = new Date();
      const [hours, minutes] = postingTime.split(':').map(Number);
      nextRunAt = new Date();
      nextRunAt.setHours(hours, minutes, 0, 0);

      // 만약 현재 시간이 오늘의 실행 시간을 지났다면 내일로 설정
      if (nextRunAt <= now) {
        nextRunAt.setDate(nextRunAt.getDate() + 1);
      }
    }

    // 기존 스케줄러 설정 업데이트 또는 새로 생성
    const scheduler = await prisma.dailyFortuneScheduler.upsert({
      where: { id: 1 }, // 단일 스케줄러 설정
      update: {
        isActive: isStart,
        postingTime: postingTime || '09:00',
        fortuneTheme: fortuneTheme || '기본운',
        nextRunAt: nextRunAt
      },
      create: {
        id: 1,
        isActive: isStart,
        postingTime: postingTime || '09:00',
        fortuneTheme: fortuneTheme || '기본운',
        nextRunAt: nextRunAt
      }
    });

    // 실제 스케줄러 시작/중지 수행
    if (isStart) {
      if (global.startFortuneScheduler) {
        global.startFortuneScheduler(postingTime || '09:00', fortuneTheme || '기본운');
      } else {
      }
    } else {
      if (global.stopFortuneScheduler) {
        const stopped = global.stopFortuneScheduler();
      } else {
      }
    }

    res.json({
      success: true,
      message: isStart ? '스케줄러가 시작되었습니다.' : '스케줄러가 중지되었습니다.',
      isActive: scheduler.isActive,
      nextRunAt: scheduler.nextRunAt
    });

  } catch (error) {
    res.status(500).json({
      error: '스케줄러 상태 변경 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 공통 운세 생성 실행 함수
 * 즉시 실행과 스케줄된 실행 모두에서 사용
 */
async function executeFortuneGeneration(fortuneTheme = '기본운') {
  const startTime = Date.now();
  let fortuneService;

  try {

    const theme = fortuneTheme || '기본운';

    // Instagram 연결 상태 확인
    const connection = await prisma.instagramConnection.findFirst({
      where: { isActive: true }
    });

    if (!connection) {
      throw new Error('연결된 Instagram 계정이 없습니다.');
    }


    // FortuneService 인스턴스 생성
    fortuneService = new FortuneService(prisma);

    // 1단계: 오늘 날짜로 전체 별자리 운세 생성
    const fortunes = await fortuneService.generateDailyFortunes(new Date(), theme);

    // 2단계: 통합 이미지 생성 (5개 이미지)
    const imageResults = await fortuneService.generateConsolidatedFortuneImages(fortunes, theme);

    if (!imageResults.success) {
      throw new Error('이미지 생성 실패: ' + imageResults.error);
    }

    // 3단계: 데이터베이스에 통합 운세 저장
    const savedPost = await saveDailyConsolidatedFortune(fortunes, imageResults, theme);

    // 4단계: Instagram에 통합 캐러셀 포스트 업로드
    const uploadResponse = await uploadConsolidatedToInstagram(connection, savedPost, theme);

    if (!uploadResponse || !uploadResponse.success) {
      throw new Error('Instagram 업로드 응답이 없거나 실패했습니다');
    }

    // 부분적 성공인 경우 추가 로깅
    if (uploadResponse.partial) {
    }

    // 스케줄러 상태 업데이트
    await prisma.dailyFortuneScheduler.upsert({
      where: { id: 1 },
      update: { lastRunAt: new Date() },
      create: {
        id: 1,
        isActive: false,
        lastRunAt: new Date(),
        postingTime: '09:00',
        fortuneTheme: theme
      }
    });

    // 5단계: 리소스 정리
    await fortuneService.cleanup();

    const totalTime = Date.now() - startTime;

    return {
      success: true,
      message: '통합 운세 생성 및 Instagram 업로드가 완료되었습니다.',
      fortuneTheme: theme,
      generatedCount: fortunes.length,
      imageCount: imageResults.totalImages || 5,
      savedPostId: savedPost.id,
      imageUrls: imageResults.imageUrls,
      instagram: {
        mediaId: uploadResponse.mediaId,
        postId: uploadResponse.postId,
        publishedAt: uploadResponse.publishedAt
      },
      totalTimeMs: totalTime,
      timestamp: new Date().toISOString(),
      fortunes: fortunes.map(f => ({
        zodiacSign: f.zodiacSign,
        cardNumber: f.cardNumber,
        cardName: f.cardData?.cardName
      }))
    };

  } catch (error) {

    // 에러 발생 시에도 리소스 정리
    try {
      if (fortuneService) {
        await fortuneService.cleanup();
      }
    } catch (cleanupError) {
    }

    // 더 상세한 에러 메시지 제공
    const errorMessage = error.message || '알 수 없는 오류가 발생했습니다';
    const isInstagramError = errorMessage.includes('Instagram');
    const isRateLimitError = errorMessage.includes('Application request limit') ||
                             errorMessage.includes('Rate limit') ||
                             errorMessage.includes('코드: 4') ||
                             errorMessage.includes('코드: -1') ||
                             errorMessage.includes('Fatal');


    // Rate Limit 에러인 경우 부분적 성공 가능성 알림
    if (isRateLimitError) {
    }

    return {
      success: false,
      error: '스케줄러 실행 중 오류가 발생했습니다.',
      details: errorMessage,
      type: isInstagramError ? 'instagram_upload_error' : 'general_error',
      isRateLimitError: isRateLimitError,
      timeElapsed: Date.now() - startTime,
      note: isRateLimitError ? '이 오류는 Rate Limit으로 인한 것으로, 실제로는 포스팅이 성공했을 가능성이 높습니다.' : null
    };
  }
}

/**
 * 스케줄러 즉시 실행 API
 * POST /api/instagram/scheduler/run-now
 */
router.post('/scheduler/run-now', async (req, res) => {
  try {
    const { fortuneTheme } = req.body;
    const result = await executeFortuneGeneration(fortuneTheme || '기본운');

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: '즉시 실행 중 예기치 않은 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 스케줄러 설정 업데이트
 * POST /api/instagram/scheduler/settings
 */
router.post('/scheduler/settings', async (req, res) => {
  try {
    const { postingTime, fortuneTheme, settings } = req.body;

    // 스케줄러 설정 업데이트
    const scheduler = await prisma.dailyFortuneScheduler.upsert({
      where: { id: 1 },
      update: {
        postingTime: postingTime,
        fortuneTheme: fortuneTheme,
        settings: settings || null
      },
      create: {
        id: 1,
        isActive: false,
        postingTime: postingTime || '09:00',
        fortuneTheme: fortuneTheme || '기본운',
        settings: settings || null
      }
    });

    res.json({
      success: true,
      message: '스케줄러 설정이 저장되었습니다.',
      postingTime: scheduler.postingTime,
      fortuneTheme: scheduler.fortuneTheme
    });

  } catch (error) {
    res.status(500).json({
      error: '스케줄러 설정 업데이트 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * HTML 템플릿 미리보기
 * GET /api/instagram/preview-templates
 */
router.get('/preview-templates', async (req, res) => {
  try {
    const { templateType, theme = '기본운' } = req.query;

    // 예시 운세 데이터 생성
    const mockFortunes = generateMockFortunes();

    const FortuneService = require('../services/fortuneService');
    const fortuneService = new FortuneService(prisma);

    const ImageService = require('../services/imageService');
    const imageService = new ImageService();

    let htmlContent = '';
    let templateData = {};

    switch (templateType) {
      case 'thumbnail':
        templateData = imageService.generateConsolidatedTemplateData(mockFortunes, theme, 'thumbnail');
        htmlContent = await generateTemplateHTML('daily-fortune-thumbnail', templateData);
        break;
      case 'page1':
        // 봄 별자리 - 새로운 공통 템플릿 사용
        templateData = imageService.generateSeasonalTemplateData(theme, 'page1');
        htmlContent = await generateTemplateHTML('daily-fortune-common', templateData);
        break;
      case 'page2':
        // 여름 별자리 - 새로운 공통 템플릿 사용
        templateData = imageService.generateSeasonalTemplateData(theme, 'page2');
        htmlContent = await generateTemplateHTML('daily-fortune-common', templateData);
        break;
      case 'page3':
        // 가을 별자리 - 새로운 공통 템플릿 사용
        templateData = imageService.generateSeasonalTemplateData(theme, 'page3');
        htmlContent = await generateTemplateHTML('daily-fortune-common', templateData);
        break;
      case 'page4':
        // 겨울 별자리 - 새로운 공통 템플릿 사용
        templateData = imageService.generateSeasonalTemplateData(theme, 'page4');
        htmlContent = await generateTemplateHTML('daily-fortune-common', templateData);
        break;
      case 'ending':
        templateData = imageService.generateConsolidatedTemplateData(mockFortunes, theme, 'ending');
        htmlContent = await generateTemplateHTML('daily-fortune-ending', templateData);
        break;
      default:
        return res.status(400).json({ error: '유효하지 않은 템플릿 타입입니다.' });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlContent);

  } catch (error) {
    res.status(500).json({
      error: 'HTML 미리보기 생성 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

// 예시 운세 데이터 생성 함수
function generateMockFortunes() {
  // 계절별 별자리 분류
  const seasonZodiacs = {
    spring: ['양자리', '황소자리', '쌍둥이자리'],    // 봄 (3-5월)
    summer: ['게자리', '사자자리', '처녀자리'],      // 여름 (6-8월)
    autumn: ['천칭자리', '전갈자리', '사수자리'],    // 가을 (9-11월)
    winter: ['염소자리', '물병자리', '물고기자리']   // 겨울 (12-2월)
  };

  const zodiacSigns = [
    ...seasonZodiacs.spring,
    ...seasonZodiacs.summer,
    ...seasonZodiacs.autumn,
    ...seasonZodiacs.winter
  ];
  const zodiacData = {
    '천칭자리': { symbol: '♎', dates: '9.23 - 10.22', keywords: ['균형', '조화', '미적감각'] },
    '물병자리': { symbol: '♒', dates: '1.20 - 2.18', keywords: ['독창성', '자유', '혁신'] },
    '쌍둥이자리': { symbol: '♊', dates: '5.21 - 6.21', keywords: ['소통', '다재다능', '호기심'] },
    '처녀자리': { symbol: '♍', dates: '8.23 - 9.22', keywords: ['완벽주의', '분석력', '실용성'] },
    '사수자리': { symbol: '♐', dates: '11.22 - 12.21', keywords: ['모험', '철학', '자유로움'] },
    '염소자리': { symbol: '♑', dates: '12.22 - 1.19', keywords: ['목표지향', '책임감', '인내'] },
    '양자리': { symbol: '♈', dates: '3.21 - 4.19', keywords: ['리더십', '열정', '용기'] },
    '황소자리': { symbol: '♉', dates: '4.20 - 5.20', keywords: ['안정성', '인내력', '실용성'] },
    '게자리': { symbol: '♋', dates: '6.22 - 7.22', keywords: ['감수성', '직감', '보호본능'] },
    '사자자리': { symbol: '♌', dates: '7.23 - 8.22', keywords: ['자신감', '창조력', '관대함'] },
    '전갈자리': { symbol: '♏', dates: '10.23 - 11.21', keywords: ['강렬함', '직감', '변화'] },
    '물고기자리': { symbol: '♓', dates: '2.19 - 3.20', keywords: ['상상력', '직감', '감성'] }
  };

  // 간단한 운세 텍스트 생성 함수
  function generateSimpleFortune(sign) {
    const fortunes = {
      '양자리': '새로운 시작과 도전의 에너지가 강해지는 날입니다. 리더십을 발휘할 기회가 찾아올 수 있어요.',
      '황소자리': '안정적인 발전과 꾸준한 노력이 결실을 맺는 시기입니다. 인내심을 가지고 진행해보세요.',
      '쌍둥이자리': '소통과 학습의 기회가 많아지는 날입니다. 새로운 정보와 지식을 적극적으로 받아들여보세요.',
      '게자리': '가족과 가까운 사람들과의 관계가 중요해지는 시기입니다. 따뜻한 마음으로 배려해주세요.',
      '사자자리': '창의성과 자신감이 빛을 발하는 날입니다. 당당하게 자신을 표현해보세요.',
      '처녀자리': '세심한 계획과 분석이 좋은 결과를 가져다주는 시기입니다. 꼼꼼하게 준비해보세요.',
      '천칭자리': '조화와 균형을 찾는 것이 중요한 날입니다. 공정한 판단으로 문제를 해결해보세요.',
      '전갈자리': '깊이 있는 통찰력과 집중력을 발휘할 수 있는 시기입니다. 본질을 파악해보세요.',
      '사수자리': '모험과 탐험의 정신이 새로운 기회를 가져다주는 날입니다. 자유롭게 도전해보세요.',
      '염소자리': '목표 달성을 위한 체계적인 접근이 필요한 시기입니다. 책임감을 가지고 실행해보세요.',
      '물병자리': '독창적인 아이디어와 혁신적 사고가 빛나는 날입니다. 자유롭게 발상을 전환해보세요.',
      '물고기자리': '직감과 감성이 중요한 역할을 하는 시기입니다. 마음의 소리에 귀 기울여보세요.'
    };

    return fortunes[sign] || '오늘은 새로운 가능성이 열리는 특별한 날입니다.';
  }

  return zodiacSigns.map((sign) => ({
    zodiacSign: sign,
    zodiacInfo: zodiacData[sign],
    cardNumber: Math.floor(Math.random() * 22),
    cardData: { cardName: '예시 타로카드' },
    fortuneText: generateSimpleFortune(sign),
    keywords: zodiacData[sign].keywords,
    season: getSeasonByZodiac(sign)
  }));

  function getSeasonByZodiac(sign) {
    const seasonMap = {
      '양자리': 'spring', '황소자리': 'spring', '쌍둥이자리': 'spring',
      '게자리': 'summer', '사자자리': 'summer', '처녀자리': 'summer',
      '천칭자리': 'autumn', '전갈자리': 'autumn', '사수자리': 'autumn',
      '염소자리': 'winter', '물병자리': 'winter', '물고기자리': 'winter'
    };
    return seasonMap[sign] || 'spring';
  }
}

// HTML 템플릿 생성 함수
async function generateTemplateHTML(templateName, templateData) {
  const fs = require('fs').promises;
  const path = require('path');

  const templatePath = path.join(__dirname, '../templates', `${templateName}.html`);
  let htmlContent = await fs.readFile(templatePath, 'utf8');

  // 템플릿 변수 치환
  Object.keys(templateData).forEach(key => {
    const placeholder = `{{${key}}}`;
    const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    htmlContent = htmlContent.replace(regex, templateData[key] || '');
  });

  return htmlContent;
}


/**
 * 포스팅 통계 조회
 * GET /api/instagram/analytics
 */
router.get('/analytics', async (req, res) => {
  try {
    const connection = await prisma.instagramConnection.findFirst({
      where: { isActive: true },
      include: {
        posts: {
          where: {
            status: 'PUBLISHED'
          },
          orderBy: {
            publishedAt: 'desc'
          }
        }
      }
    });

    if (!connection) {
      return res.status(404).json({
        error: '연결된 Instagram 계정이 없습니다.'
      });
    }

    const posts = connection.posts;
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // 통계 계산
    const totalPosts = posts.length;
    const thisMonthPosts = posts.filter(post => post.publishedAt >= thisMonth).length;
    const totalLikes = posts.reduce((sum, post) => sum + post.likeCount, 0);
    const totalComments = posts.reduce((sum, post) => sum + post.commentCount, 0);
    const avgLikes = totalPosts > 0 ? Math.round(totalLikes / totalPosts) : 0;
    const avgComments = totalPosts > 0 ? Math.round(totalComments / totalPosts) : 0;

    res.json({
      success: true,
      analytics: {
        totalPosts,
        thisMonthPosts,
        avgLikes,
        avgComments,
        totalLikes,
        totalComments,
        recentPosts: posts.slice(0, 10).map(post => ({
          id: post.id,
          caption: post.caption.substring(0, 100) + '...',
          publishedAt: post.publishedAt,
          likeCount: post.likeCount,
          commentCount: post.commentCount
        }))
      }
    });

  } catch (error) {
    res.status(500).json({
      error: '통계 조회 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * Instagram Rate Limit 확인
 * GET /api/instagram/rate-limit
 */
router.get('/rate-limit', async (req, res) => {
  try {

    // 현재 활성화된 연결 조회
    const connection = await prisma.instagramConnection.findFirst({
      where: { isActive: true }
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        error: '연결된 Instagram 계정이 없습니다.'
      });
    }

    // 토큰 만료 확인
    const now = new Date();
    if (connection.tokenExpiresAt <= now) {
      return res.status(401).json({
        success: false,
        error: 'Instagram 토큰이 만료되었습니다. 다시 연결해주세요.'
      });
    }

    // Instagram API를 통해 Rate Limit 정보 조회
    const rateLimitResponse = await axios.get(
      `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/content_publishing_limit`,
      {
        params: {
          access_token: connection.accessToken
        }
      }
    );

    // API 응답 구조 확인을 위한 로깅

    const rateLimitData = rateLimitResponse.data.data ? rateLimitResponse.data.data[0] : rateLimitResponse.data;

    // 24시간 동안의 게시 기록도 함께 조회 (검증용)
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentPosts = await prisma.instagramPost.findMany({
      where: {
        connectionId: connection.id,
        status: 'PUBLISHED',
        publishedAt: {
          gte: last24Hours
        }
      },
      orderBy: {
        publishedAt: 'desc'
      }
    });


    // 안전한 데이터 추출
    const quotaUsage = rateLimitData.quota_usage || 0;
    const quotaTotal = rateLimitData.config?.quota_total || rateLimitData.quota_total || 100; // 기본값 100
    const remainingQuota = quotaTotal - quotaUsage;
    const utilizationPercentage = quotaTotal > 0 ? Math.round((quotaUsage / quotaTotal) * 100) : 0;

    res.json({
      success: true,
      rateLimitInfo: {
        // Instagram API 응답
        quota_usage: quotaUsage,
        config: {
          quota_total: quotaTotal
        },
        // 추가 계산된 정보
        remainingQuota: remainingQuota,
        utilizationPercentage: utilizationPercentage,
        // 내부 기록 검증
        localPostCount: recentPosts.length,
        resetTime: new Date(Date.now() + (24 * 60 * 60 * 1000)), // 대략적인 리셋 시간
        recentPosts: recentPosts.slice(0, 5).map(post => ({
          id: post.id,
          caption: post.caption ? post.caption.substring(0, 50) + '...' : '',
          mediaType: post.mediaType,
          publishedAt: post.publishedAt
        })),
        // 디버깅을 위한 원본 응답
        rawResponse: rateLimitData
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Rate Limit 정보 조회 중 오류가 발생했습니다.',
      details: error.response?.data?.error?.message || error.message
    });
  }
});

/**
 * Instagram 미디어 게시 (영상 및 이미지 지원)
 * POST /api/instagram/publish
 */
router.post('/publish', async (req, res) => {
  try {
    const {
      mediaUrl,
      mediaUrls,
      mediaType = 'IMAGE', // IMAGE, VIDEO, CAROUSEL_ALBUM
      caption,
      scheduleTime,
      metadata = {}
    } = req.body;


    // 필수 파라미터 검증 (캐러셀의 경우 mediaUrls 사용)
    const hasMedia = mediaUrl || (mediaUrls && mediaUrls.length > 0);
    if (!hasMedia) {
      return res.status(400).json({
        success: false,
        error: '미디어 URL이 필요합니다.'
      });
    }

    if (!caption) {
      return res.status(400).json({
        success: false,
        error: '캡션이 필요합니다.'
      });
    }

    // 현재 활성화된 연결 조회
    const connection = await prisma.instagramConnection.findFirst({
      where: { isActive: true }
    });

    if (!connection) {
      return res.status(404).json({
        success: false,
        error: '연결된 Instagram 계정이 없습니다.'
      });
    }

    // Rate Limit 사전 확인 (캐러셀 게시시 API 호출 절약을 위해 건너뜀)
    if (mediaType !== 'CAROUSEL_ALBUM') {
      try {
        const rateLimitResponse = await axios.get(
          `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/content_publishing_limit`,
          {
            params: {
              access_token: connection.accessToken
            }
          }
        );

        const rateLimitData = rateLimitResponse.data.data ? rateLimitResponse.data.data[0] : rateLimitResponse.data;

        // 안전한 데이터 추출
        const quotaUsage = rateLimitData.quota_usage || 0;
        const quotaTotal = rateLimitData.config?.quota_total || rateLimitData.quota_total || 100;
        const remainingQuota = quotaTotal - quotaUsage;
        const utilizationPercentage = quotaTotal > 0 ? Math.round((quotaUsage / quotaTotal) * 100) : 0;


        if (remainingQuota <= 0) {
          return res.status(429).json({
            success: false,
            error: 'Instagram 게시 한도에 도달했습니다. 24시간 후 다시 시도해주세요.',
            rateLimitInfo: {
              quota_usage: quotaUsage,
              quota_total: quotaTotal,
              remainingQuota: remainingQuota,
              utilizationPercentage: utilizationPercentage
            }
          });
        }

        if (utilizationPercentage >= 90) {
        }

      } catch (rateLimitError) {
        // Rate Limit 확인 실패 시에도 게시는 계속 진행
      }
    } else {
    }

    // 토큰 만료 확인
    const now = new Date();
    if (connection.tokenExpiresAt <= now) {
      return res.status(401).json({
        success: false,
        error: 'Instagram 토큰이 만료되었습니다. 다시 연결해주세요.'
      });
    }

    let publishResult;

    try {
      if (mediaType === 'VIDEO' || mediaType === 'REELS') {
        publishResult = await publishInstagramReels(connection, mediaUrl, caption);
      } else if (mediaType === 'IMAGE') {
        publishResult = await publishInstagramImage(connection, mediaUrl, caption);
      } else if (mediaType === 'CAROUSEL_ALBUM') {
        // 캐러셀은 mediaUrls 배열로 전달됨
        publishResult = await publishInstagramCarousel(connection, mediaUrls, caption);
      } else {
        return res.status(400).json({
          success: false,
          error: '지원하지 않는 미디어 타입입니다. (IMAGE, REELS, CAROUSEL_ALBUM만 지원)'
        });
      }

      // 성공한 경우 데이터베이스에 저장
      if (publishResult.success) {
        const instagramPost = await prisma.instagramPost.create({
          data: {
            connectionId: connection.id,
            instagramMediaId: publishResult.mediaId,
            instagramPostId: publishResult.postId,
            caption: caption,
            mediaType: mediaType,
            imageUrl: mediaType === 'CAROUSEL_ALBUM' ? JSON.stringify(mediaUrls) : mediaUrl,
            status: scheduleTime ? 'SCHEDULED' : 'PUBLISHED',
            scheduledAt: scheduleTime ? new Date(scheduleTime) : null,
            publishedAt: scheduleTime ? null : new Date(),
            metadata: metadata
          }
        });

        // Slack 알림: 게시 성공
        try {
          await slackService.sendInstagramPostSuccess({
            mediaType: mediaType,
            caption: caption,
            postId: publishResult.postId
          });
        } catch (slackError) {
        }

        res.json({
          success: true,
          message: scheduleTime ? 'Instagram 게시물이 예약되었습니다.' : 'Instagram에 성공적으로 게시되었습니다.',
          data: {
            id: instagramPost.id,
            mediaId: publishResult.mediaId,
            postId: publishResult.postId,
            publishedAt: instagramPost.publishedAt,
            scheduledAt: instagramPost.scheduledAt
          }
        });
      } else {
        throw new Error(publishResult.error);
      }

    } catch (error) {

      // Slack 알림: 게시 실패
      try {
        await slackService.sendInstagramPostError({
          mediaType: mediaType || 'UNKNOWN',
          error: error.message,
          details: {
            stack: error.stack,
            timestamp: new Date().toISOString(),
            caption: caption ? caption.substring(0, 100) + '...' : 'N/A'
          }
        });
      } catch (slackError) {
      }

      res.status(500).json({
        success: false,
        error: `게시 실패: ${error.message}`
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: '게시 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

// Instagram 릴스 게시 헬퍼 함수
async function publishInstagramReels(connection, videoUrl, caption) {
  try {

    // Step 1: 릴스 컨테이너 생성 (1초 지점을 썸네일로 설정)
    const containerResponse = await axios.post(
      `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media`,
      {
        media_type: 'REELS',
        video_url: videoUrl,
        caption: caption,
        thumbnail_offset: 1000, // 1초 지점을 썸네일로 사용 (밀리초 단위)
        access_token: connection.accessToken
      }
    );

    const containerId = containerResponse.data.id;

    // Step 2: 컨테이너 상태 확인 (비디오 처리 대기)
    let isReady = false;
    let attempts = 0;
    const maxAttempts = 30; // 최대 5분 대기

    while (!isReady && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10초 대기

      try {
        const statusResponse = await axios.get(
          `${INSTAGRAM_API_BASE_URL}/${containerId}`,
          {
            params: {
              fields: 'status_code',
              access_token: connection.accessToken
            }
          }
        );

        const statusCode = statusResponse.data.status_code;

        if (statusCode === 'FINISHED') {
          isReady = true;
        } else if (statusCode === 'ERROR') {
          throw new Error('Instagram에서 비디오 처리 중 오류가 발생했습니다.');
        }

        attempts++;
      } catch (error) {
        attempts++;
      }
    }

    if (!isReady) {
      throw new Error('비디오 처리 시간이 초과되었습니다. 나중에 다시 시도해주세요.');
    }

    // Step 3: 게시
    const publishResponse = await axios.post(
      `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media_publish`,
      {
        creation_id: containerId,
        access_token: connection.accessToken
      }
    );

    const postId = publishResponse.data.id;

    return {
      success: true,
      mediaId: containerId,
      postId: postId
    };

  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

// Instagram 이미지 게시 헬퍼 함수
async function publishInstagramImage(connection, imageUrl, caption) {
  try {

    // Step 1: 이미지 컨테이너 생성
    const containerResponse = await axios.post(
      `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media`,
      {
        image_url: imageUrl,
        caption: caption,
        access_token: connection.accessToken
      }
    );

    const containerId = containerResponse.data.id;

    // Step 2: 게시
    const publishResponse = await axios.post(
      `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media_publish`,
      {
        creation_id: containerId,
        access_token: connection.accessToken
      }
    );

    const postId = publishResponse.data.id;

    return {
      success: true,
      mediaId: containerId,
      postId: postId
    };

  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

// Instagram 캐러셀 게시 헬퍼 함수 (새 버전)
async function publishInstagramCarousel(connection, imageUrls, caption) {
  try {

    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      throw new Error('이미지 URL 배열이 필요합니다.');
    }

    if (imageUrls.length > 10) {
      throw new Error('Instagram 캐러셀은 최대 10개의 이미지만 지원합니다.');
    }

    // Step 1: 이미지 URL 접근성 검증
    for (let i = 0; i < imageUrls.length; i++) {
      try {
        const response = await axios.head(imageUrls[i]);
      } catch (error) {
        throw new Error(`이미지 ${i + 1} URL에 접근할 수 없습니다: ${imageUrls[i]}`);
      }
    }

    // Step 2: 각 이미지에 대해 child container 생성
    const childContainerIds = [];
    for (let i = 0; i < imageUrls.length; i++) {
      try {
        const childContainerResponse = await axios.post(
          `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media`,
          {
            image_url: imageUrls[i],
            is_carousel_item: true,
            access_token: connection.accessToken
          }
        );
        childContainerIds.push(childContainerResponse.data.id);

        // API 제한을 피하기 위한 딜레이 (더 긴 간격)
        if (i < imageUrls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000)); // 3초로 증가
        }
      } catch (error) {
        throw new Error(`이미지 ${i + 1} 컨테이너 생성 실패: ${error.response?.data?.error?.message || error.message}`);
      }
    }

    // Step 3: 캐러셀 컨테이너 생성
    const carouselContainerResponse = await axios.post(
      `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media`,
      {
        media_type: 'CAROUSEL',
        children: childContainerIds,
        caption: caption,
        access_token: connection.accessToken
      }
    );

    const carouselContainerId = carouselContainerResponse.data.id;

    // Instagram 미디어 처리 완료 대기 (단순 고정 대기)

    // 폴링 대신 충분한 시간 대기 (API 호출 절약)
    await new Promise(resolve => setTimeout(resolve, 45000));

    // Step 4: 게시
    const publishResponse = await axios.post(
      `${INSTAGRAM_API_BASE_URL}/${connection.instagramUserId}/media_publish`,
      {
        creation_id: carouselContainerId,
        access_token: connection.accessToken
      }
    );

    const postId = publishResponse.data.id;

    return {
      success: true,
      mediaId: carouselContainerId,
      postId: postId
    };

  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

module.exports = router;