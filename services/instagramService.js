const axios = require('axios');
const prisma = require('../lib/prisma');



// Instagram Business API 기본 설정
const INSTAGRAM_API_BASE_URL = 'https://graph.instagram.com';

class InstagramService {

  /**
   * 활성 Instagram 연결 조회
   */
  static async getActiveConnection() {
    return await prisma.instagramConnection.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * 토큰 유효성 검사
   */
  static async validateToken(connection) {
    const now = new Date();
    return connection.tokenExpiresAt > now;
  }

  /**
   * Instagram API 호출 (기본 헤더 포함)
   */
  static async makeInstagramAPICall(endpoint, params = {}, method = 'GET') {
    const connection = await this.getActiveConnection();

    if (!connection) {
      throw new Error('연결된 Instagram 계정이 없습니다.');
    }

    if (!this.validateToken(connection)) {
      throw new Error('토큰이 만료되었습니다.');
    }

    const config = {
      method,
      url: `${INSTAGRAM_API_BASE_URL}${endpoint}`,
      params: {
        access_token: connection.accessToken,
        ...params
      }
    };

    if (method === 'POST') {
      config.data = params;
      delete config.params;
      config.params = { access_token: connection.accessToken };
    }

    try {
      const response = await axios(config);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 사용자 프로필 정보 조회
   */
  static async getUserProfile(userId = null) {
    const connection = await this.getActiveConnection();
    const targetUserId = userId || connection.instagramUserId;

    return await this.makeInstagramAPICall(`/${targetUserId}`, {
      fields: 'id,username,account_type,followers_count,follows_count,media_count,profile_picture_url'
    });
  }

  /**
   * 미디어 컨테이너 생성 (이미지 포스트)
   */
  static async createMediaContainer(params) {
    const { imageUrl, caption, hashtags } = params;
    const connection = await this.getActiveConnection();

    const fullCaption = hashtags ? `${caption}\n\n${hashtags}` : caption;

    return await this.makeInstagramAPICall(`/${connection.instagramUserId}/media`, {
      image_url: imageUrl,
      caption: fullCaption,
      media_type: 'IMAGE'
    }, 'POST');
  }

  /**
   * 미디어 컨테이너 게시
   */
  static async publishMedia(creationId) {
    const connection = await this.getActiveConnection();

    return await this.makeInstagramAPICall(`/${connection.instagramUserId}/media_publish`, {
      creation_id: creationId
    }, 'POST');
  }

  /**
   * 포스트 전체 프로세스 (생성 + 게시)
   */
  static async createAndPublishPost(postData) {
    try {
      const { caption, hashtags, imageUrl } = postData;

      // 1. 미디어 컨테이너 생성
      const containerResult = await this.createMediaContainer({
        imageUrl,
        caption,
        hashtags
      });

      const creationId = containerResult.id;

      // 2. 데이터베이스에 포스트 정보 저장 (게시 전 상태)
      const connection = await this.getActiveConnection();
      const post = await prisma.instagramPost.create({
        data: {
          connectionId: connection.id,
          caption,
          hashtags,
          imageUrl,
          mediaType: 'IMAGE',
          status: 'PUBLISHING',
          instagramMediaId: creationId
        }
      });

      // 3. 미디어 게시
      const publishResult = await this.publishMedia(creationId);

      // 4. 데이터베이스 업데이트 (게시 완료 상태)
      const updatedPost = await prisma.instagramPost.update({
        where: { id: post.id },
        data: {
          status: 'PUBLISHED',
          instagramPostId: publishResult.id,
          publishedAt: new Date()
        }
      });

      return {
        success: true,
        postId: updatedPost.id,
        instagramPostId: publishResult.id,
        message: '포스트가 성공적으로 게시되었습니다.'
      };

    } catch (error) {
      // 에러 발생 시 데이터베이스 업데이트
      if (postData.dbPostId) {
        await prisma.instagramPost.update({
          where: { id: postData.dbPostId },
          data: {
            status: 'FAILED',
            errorMessage: error.message,
            errorCode: error.response?.status?.toString()
          }
        });
      }

      throw error;
    }
  }

  /**
   * 예약 포스트 생성
   */
  static async schedulePost(postData, scheduledTime) {
    const connection = await this.getActiveConnection();

    const post = await prisma.instagramPost.create({
      data: {
        connectionId: connection.id,
        caption: postData.caption,
        hashtags: postData.hashtags,
        imageUrl: postData.imageUrl,
        mediaType: postData.mediaType || 'IMAGE',
        status: 'SCHEDULED',
        scheduledAt: new Date(scheduledTime)
      }
    });

    return post;
  }

  /**
   * 예약된 포스트들 조회
   */
  static async getScheduledPosts() {
    return await prisma.instagramPost.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: {
          lte: new Date()
        }
      },
      orderBy: {
        scheduledAt: 'asc'
      }
    });
  }

  /**
   * 예약된 포스트 실행
   */
  static async executeScheduledPost(postId) {
    const post = await prisma.instagramPost.findUnique({
      where: { id: postId }
    });

    if (!post || post.status !== 'SCHEDULED') {
      throw new Error('예약된 포스트를 찾을 수 없습니다.');
    }

    return await this.createAndPublishPost({
      caption: post.caption,
      hashtags: post.hashtags,
      imageUrl: post.imageUrl,
      dbPostId: post.id
    });
  }

  /**
   * 미디어 인사이트 조회
   */
  static async getMediaInsights(mediaId) {
    try {
      return await this.makeInstagramAPICall(`/${mediaId}/insights`, {
        metric: 'impressions,reach,likes,comments,saves,shares'
      });
    } catch (error) {
      return null;
    }
  }

  /**
   * 계정 인사이트 조회
   */
  static async getAccountInsights(period = 'day', since = null, until = null) {
    const connection = await this.getActiveConnection();

    const params = {
      metric: 'impressions,reach,profile_views,follower_count',
      period
    };

    if (since) params.since = since;
    if (until) params.until = until;

    try {
      return await this.makeInstagramAPICall(`/${connection.instagramUserId}/insights`, params);
    } catch (error) {
      return null;
    }
  }

  /**
   * 포스트 통계 업데이트
   */
  static async updatePostStatistics(postId) {
    try {
      const post = await prisma.instagramPost.findUnique({
        where: { id: postId }
      });

      if (!post || !post.instagramPostId) {
        return null;
      }

      // Instagram API에서 포스트 정보 조회
      const mediaData = await this.makeInstagramAPICall(`/${post.instagramPostId}`, {
        fields: 'like_count,comments_count,timestamp'
      });

      // 인사이트 정보 조회 (가능한 경우)
      const insights = await this.getMediaInsights(post.instagramPostId);

      const updateData = {
        likeCount: mediaData.like_count || 0,
        commentCount: mediaData.comments_count || 0
      };

      if (insights && insights.data) {
        insights.data.forEach(metric => {
          switch (metric.name) {
            case 'impressions':
              updateData.impressionCount = metric.values[0]?.value || 0;
              break;
            case 'reach':
              updateData.reachCount = metric.values[0]?.value || 0;
              break;
          }
        });
      }

      return await prisma.instagramPost.update({
        where: { id: postId },
        data: updateData
      });

    } catch (error) {
      return null;
    }
  }

  /**
   * 자동 포스팅용 일일 운세 컨텐츠 생성
   */
  static generateDailyFortuneContent() {
    const fortuneMessages = [
      "오늘은 새로운 시작의 날입니다. 타로 카드가 전하는 운세를 확인해보세요! ✨",
      "당신의 오늘 운세는 어떨까요? 타로로 알아보는 특별한 하루 🔮",
      "새로운 하루, 새로운 기회! 타로가 전하는 오늘의 메시지 💫",
      "오늘 하루 어떤 일이 일어날까요? 타로로 미리 준비해보세요 🌟",
      "타로 카드가 전하는 오늘의 특별한 메시지를 놓치지 마세요! ✨"
    ];

    const hashtags = "#타로 #운세 #TaroTI #오늘의운세 #타로카드 #점술 #미래 #오늘하루 #행운 #메시지";

    const randomMessage = fortuneMessages[Math.floor(Math.random() * fortuneMessages.length)];

    return {
      caption: randomMessage,
      hashtags: hashtags
    };
  }

  /**
   * 토큰 자동 갱신 (만료 7일 전)
   */
  static async autoRefreshToken() {
    try {
      const connection = await this.getActiveConnection();

      if (!connection) {
        return false;
      }

      const now = new Date();
      const expirationTime = new Date(connection.tokenExpiresAt);
      const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;

      // 만료 7일 전이면 토큰 갱신
      if (expirationTime.getTime() - now.getTime() <= sevenDaysInMs) {

        const refreshResponse = await axios.get(`${INSTAGRAM_API_BASE_URL}/refresh_access_token`, {
          params: {
            grant_type: 'ig_refresh_token',
            access_token: connection.accessToken
          }
        });

        const { access_token: newToken, expires_in } = refreshResponse.data;
        const newExpiresAt = new Date(Date.now() + expires_in * 1000);

        await prisma.instagramConnection.update({
          where: { id: connection.id },
          data: {
            accessToken: newToken,
            tokenExpiresAt: newExpiresAt,
            lastRefreshedAt: new Date()
          }
        });

        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }
}

module.exports = InstagramService;