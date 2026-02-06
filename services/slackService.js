const axios = require('axios');

class SlackService {
  constructor() {
    this.webhookUrl = process.env.SLACK_WEBHOOK_URL;
  }

  /**
   * Slack 메시지 전송
   * @param {string} text - 기본 메시지 텍스트
   * @param {Object} options - 추가 옵션
   * @param {string} options.channel - 채널명 (선택적)
   * @param {string} options.username - 사용자명 (선택적)
   * @param {string} options.icon_emoji - 이모지 아이콘 (선택적)
   * @param {Array} options.attachments - 첨부 파일 (선택적)
   * @param {Array} options.blocks - Slack 블록 (선택적)
   */
  async sendMessage(text, options = {}) {
    try {
      const payload = {
        text,
        ...options
      };

      const response = await axios.post(this.webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return { success: true, response: response.data };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 시스템 알림 메시지 (에러, 경고 등)
   * @param {string} level - 알림 레벨 (info, warning, error, success)
   * @param {string} title - 제목
   * @param {string} message - 메시지 내용
   * @param {Object} details - 추가 세부 정보
   */
  async sendSystemAlert(level, title, message, details = {}) {
    const colorMap = {
      info: '#36a64f',      // 녹색
      success: '#36a64f',   // 녹색
      warning: '#ff9500',   // 주황색
      error: '#ff0000'      // 빨간색
    };

    const iconMap = {
      info: ':information_source:',
      success: ':white_check_mark:',
      warning: ':warning:',
      error: ':x:'
    };

    const fields = [];

    // 세부 정보 추가
    if (details.environment) {
      fields.push({
        title: 'Environment',
        value: details.environment,
        short: true
      });
    }

    if (details.timestamp) {
      fields.push({
        title: 'Time',
        value: new Date(details.timestamp).toLocaleString('ko-KR'),
        short: true
      });
    }

    if (details.user) {
      fields.push({
        title: 'User',
        value: details.user,
        short: true
      });
    }

    if (details.stack && level === 'error') {
      fields.push({
        title: 'Stack Trace',
        value: `\`\`\`${details.stack}\`\`\``,
        short: false
      });
    }

    const attachment = {
      color: colorMap[level] || '#36a64f',
      title: `${iconMap[level]} ${title}`,
      text: message,
      fields: fields,
      footer: 'TaroTI Backend',
      ts: Math.floor(Date.now() / 1000)
    };

    return await this.sendMessage('', {
      attachments: [attachment]
    });
  }

  /**
   * Instagram 게시 성공 알림
   */
  async sendInstagramPostSuccess(postData) {
    const { mediaType, caption, postId } = postData;

    return await this.sendSystemAlert('success',
      'Instagram 게시 성공',
      `${mediaType} 콘텐츠가 성공적으로 게시되었습니다.`,
      {
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        postId: postId,
        caption: caption ? caption.substring(0, 100) + '...' : '캡션 없음'
      }
    );
  }

  /**
   * Instagram 게시 실패 알림
   */
  async sendInstagramPostError(errorData) {
    const { mediaType, error, details } = errorData;

    return await this.sendSystemAlert('error',
      'Instagram 게시 실패',
      `${mediaType} 콘텐츠 게시 중 오류가 발생했습니다: ${error}`,
      {
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        stack: details?.stack,
        ...details
      }
    );
  }

  /**
   * 비디오 생성 완료 알림
   */
  async sendVideoGenerationComplete(videoData) {
    const { title, videoType, duration, imageCount } = videoData;

    return await this.sendSystemAlert('success',
      '비디오 생성 완료',
      `새로운 ${videoType} 비디오가 생성되었습니다.`,
      {
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        title: title,
        duration: `${duration}ms`,
        imageCount: `${imageCount}개 이미지`
      }
    );
  }

  /**
   * Rate Limit 경고 알림
   */
  async sendRateLimitWarning(rateLimitData) {
    const { quota_usage, quota_total, utilizationPercentage } = rateLimitData;

    return await this.sendSystemAlert('warning',
      'Instagram Rate Limit 경고',
      `Instagram API 사용량이 ${utilizationPercentage}%에 도달했습니다.`,
      {
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        usage: `${quota_usage}/${quota_total}`,
        remaining: `${quota_total - quota_usage}개 남음`
      }
    );
  }

  /**
   * 사용자 활동 알림 (가입, 결제 등)
   */
  async sendUserActivity(activityType, userData) {
    const activityMap = {
      signup: { icon: ':new:', title: '신규 사용자 가입' },
      payment: { icon: ':credit_card:', title: '결제 완료' },
      fortune_completed: { icon: ':crystal_ball:', title: '운세 완료' }
    };

    const activity = activityMap[activityType] || { icon: ':information_source:', title: '사용자 활동' };

    return await this.sendSystemAlert('info',
      activity.title,
      `사용자 활동이 발생했습니다.`,
      {
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        user: userData.userId || userData.email || '알 수 없음',
        ...userData
      }
    );
  }

  /**
   * 일일 가입자 수 리포트 알림
   */
  async sendDailySignupReport(reportData) {
    const { date, totalSignups, userSignups, landingUserSignups, landingUserV2Signups } = reportData;

    const fields = [
      {
        title: '정식 가입자 (카카오 OAuth)',
        value: `${userSignups}명`,
        short: true
      },
      {
        title: '익명 사용자 (V1)',
        value: `${landingUserSignups}명`,
        short: true
      },
      {
        title: '익명 사용자 (V2)',
        value: `${landingUserV2Signups}명`,
        short: true
      },
      {
        title: '전체 합계',
        value: `${totalSignups}명`,
        short: true
      }
    ];

    const attachment = {
      color: '#36a64f',
      title: ':chart_with_upwards_trend: 일일 가입자 리포트',
      text: `${date} 신규 가입자 현황을 알려드립니다.`,
      fields: fields,
      footer: 'TaroTI Backend',
      ts: Math.floor(Date.now() / 1000)
    };

    return await this.sendMessage('', {
      attachments: [attachment]
    });
  }

  /**
   * 커스텀 메시지 (마크다운 지원)
   */
  async sendCustomMessage(title, message, options = {}) {
    const {
      color = '#36a64f',
      fields = [],
      footer = 'TaroTI Backend',
      urgent = false
    } = options;

    const attachment = {
      color,
      title: urgent ? `:rotating_light: ${title}` : title,
      text: message,
      fields,
      footer,
      ts: Math.floor(Date.now() / 1000)
    };

    return await this.sendMessage('', {
      attachments: [attachment]
    });
  }

  /**
   * 헬스체크 알림 (서버 시작/종료)
   */
  async sendHealthCheck(status, details = {}) {
    const statusMap = {
      startup: { icon: ':rocket:', title: '서버 시작', color: '#36a64f' },
      shutdown: { icon: ':octagonal_sign:', title: '서버 종료', color: '#ff9500' },
      error: { icon: ':x:', title: '서버 오류', color: '#ff0000' }
    };

    const statusInfo = statusMap[status] || statusMap.error;

    return await this.sendSystemAlert(status === 'startup' ? 'success' : status === 'shutdown' ? 'warning' : 'error',
      statusInfo.title,
      `서버 상태가 변경되었습니다.`,
      {
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        port: process.env.PORT || '5002',
        version: process.env.npm_package_version || '1.0.0',
        ...details
      }
    );
  }
}

module.exports = new SlackService();