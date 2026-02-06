const express = require('express');
const router = express.Router();
const slackService = require('../services/slackService');

/**
 * Slack 웹훅 테스트
 * POST /api/slack/test
 */
router.post('/test', async (req, res) => {
  try {
    const { message = '테스트 메시지입니다!' } = req.body;


    const result = await slackService.sendMessage(message, {
      username: 'TaroTI Bot',
      icon_emoji: ':crystal_ball:'
    });

    res.json({
      success: true,
      message: 'Slack 알림이 전송되었습니다.',
      result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Slack 알림 전송 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 시스템 알림 테스트
 * POST /api/slack/test-alert
 */
router.post('/test-alert', async (req, res) => {
  try {
    const {
      level = 'info',
      title = '테스트 알림',
      message = '이것은 시스템 알림 테스트입니다.'
    } = req.body;


    const result = await slackService.sendSystemAlert(level, title, message, {
      environment: 'test',
      timestamp: new Date().toISOString(),
      user: 'test-user'
    });

    res.json({
      success: true,
      message: `${level} 레벨 알림이 전송되었습니다.`,
      result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: '시스템 알림 전송 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * Instagram 게시 성공 알림 테스트
 * POST /api/slack/test-instagram-success
 */
router.post('/test-instagram-success', async (req, res) => {
  try {

    const testPostData = {
      mediaType: 'CAROUSEL_ALBUM',
      caption: '타로 주간 운세 테스트 게시물입니다. 이번 주 운세를 확인해보세요!',
      postId: 'test_post_123456789'
    };

    const result = await slackService.sendInstagramPostSuccess(testPostData);

    res.json({
      success: true,
      message: 'Instagram 게시 성공 알림이 전송되었습니다.',
      result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Instagram 성공 알림 전송 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * Instagram 게시 실패 알림 테스트
 * POST /api/slack/test-instagram-error
 */
router.post('/test-instagram-error', async (req, res) => {
  try {

    const testErrorData = {
      mediaType: 'CAROUSEL_ALBUM',
      error: 'Application request limit reached',
      details: {
        statusCode: 400,
        timestamp: new Date().toISOString(),
        stack: 'Test error stack trace...'
      }
    };

    const result = await slackService.sendInstagramPostError(testErrorData);

    res.json({
      success: true,
      message: 'Instagram 게시 실패 알림이 전송되었습니다.',
      result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Instagram 실패 알림 전송 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 비디오 생성 완료 알림 테스트
 * POST /api/slack/test-video-complete
 */
router.post('/test-video-complete', async (req, res) => {
  try {

    const testVideoData = {
      title: '타로 주간 운세\n12월 15일(월) ~ 12월 21일(일)',
      videoType: 'weekly-fortune',
      duration: 15000,
      imageCount: 7
    };

    const result = await slackService.sendVideoGenerationComplete(testVideoData);

    res.json({
      success: true,
      message: '비디오 생성 완료 알림이 전송되었습니다.',
      result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: '비디오 생성 알림 전송 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * Rate Limit 경고 알림 테스트
 * POST /api/slack/test-rate-limit-warning
 */
router.post('/test-rate-limit-warning', async (req, res) => {
  try {

    const testRateLimitData = {
      quota_usage: 95,
      quota_total: 100,
      utilizationPercentage: 95
    };

    const result = await slackService.sendRateLimitWarning(testRateLimitData);

    res.json({
      success: true,
      message: 'Rate Limit 경고 알림이 전송되었습니다.',
      result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Rate Limit 경고 알림 전송 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 사용자 활동 알림 테스트
 * POST /api/slack/test-user-activity
 */
router.post('/test-user-activity', async (req, res) => {
  try {
    const { activityType = 'signup' } = req.body;


    const testUserData = {
      userId: 'test_user_123',
      email: 'test@example.com',
      activityType: activityType
    };

    const result = await slackService.sendUserActivity(activityType, testUserData);

    res.json({
      success: true,
      message: `${activityType} 활동 알림이 전송되었습니다.`,
      result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: '사용자 활동 알림 전송 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 커스텀 메시지 테스트
 * POST /api/slack/test-custom
 */
router.post('/test-custom', async (req, res) => {
  try {
    const {
      title = '커스텀 알림 테스트',
      message = '이것은 커스텀 메시지 테스트입니다.',
      color = '#36a64f',
      urgent = false
    } = req.body;


    const result = await slackService.sendCustomMessage(title, message, {
      color,
      urgent,
      fields: [
        {
          title: 'Test Field 1',
          value: 'Test Value 1',
          short: true
        },
        {
          title: 'Test Field 2',
          value: 'Test Value 2',
          short: true
        }
      ]
    });

    res.json({
      success: true,
      message: '커스텀 메시지가 전송되었습니다.',
      result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: '커스텀 메시지 전송 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 일일 가입자 리포트 알림 테스트
 * POST /api/slack/test-daily-signup
 */
router.post('/test-daily-signup', async (req, res) => {
  try {

    // 수동으로 어제 가입자 리포트 전송
    const result = await global.sendYesterdaySignupReport();

    res.json({
      success: result.success,
      message: result.success ? '일일 가입자 리포트가 전송되었습니다.' : '일일 가입자 리포트 전송 중 오류가 발생했습니다.',
      stats: result.stats,
      slackResult: result.slackResult,
      error: result.error
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: '일일 가입자 리포트 테스트 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 가입자 스케줄러 상태 조회
 * GET /api/slack/signup-scheduler-status
 */
router.get('/signup-scheduler-status', async (req, res) => {
  try {
    // 스케줄러 상태 확인 (전역 변수 확인)
    const isRunning = global.dailySignupNotificationScheduler !== null;

    res.json({
      success: true,
      isRunning: isRunning,
      message: isRunning ? '일일 가입자 알림 스케줄러가 실행 중입니다.' : '일일 가입자 알림 스케줄러가 중지되어 있습니다.',
      schedule: '매일 오전 9시 (0 9 * * *)'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: '스케줄러 상태 조회 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 가입자 스케줄러 수동 시작
 * POST /api/slack/start-signup-scheduler
 */
router.post('/start-signup-scheduler', async (req, res) => {
  try {

    global.startDailySignupNotificationScheduler();

    res.json({
      success: true,
      message: '일일 가입자 알림 스케줄러가 시작되었습니다.',
      schedule: '매일 오전 9시 (0 9 * * *)'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: '스케줄러 시작 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 가입자 스케줄러 중지
 * POST /api/slack/stop-signup-scheduler
 */
router.post('/stop-signup-scheduler', async (req, res) => {
  try {

    const stopped = global.stopDailySignupNotificationScheduler();

    res.json({
      success: true,
      message: stopped ? '일일 가입자 알림 스케줄러가 중지되었습니다.' : '이미 중지된 상태입니다.',
      wasStopped: stopped
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: '스케줄러 중지 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 헬스체크 알림 테스트
 * POST /api/slack/test-health
 */
router.post('/test-health', async (req, res) => {
  try {
    const { status = 'startup' } = req.body;


    const result = await slackService.sendHealthCheck(status, {
      testMode: true,
      requestedBy: 'API Test'
    });

    res.json({
      success: true,
      message: `${status} 헬스체크 알림이 전송되었습니다.`,
      result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: '헬스체크 알림 전송 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

/**
 * 모든 알림 타입 한번에 테스트
 * POST /api/slack/test-all
 */
router.post('/test-all', async (req, res) => {
  try {

    const results = [];

    // 기본 메시지
    results.push(await slackService.sendMessage('🧪 Slack 알림 시스템 전체 테스트 시작'));

    // 각종 시스템 알림
    results.push(await slackService.sendSystemAlert('info', '정보 알림 테스트', '정상 작동 중입니다.'));
    results.push(await slackService.sendSystemAlert('success', '성공 알림 테스트', '작업이 성공적으로 완료되었습니다.'));
    results.push(await slackService.sendSystemAlert('warning', '경고 알림 테스트', '주의가 필요합니다.'));
    results.push(await slackService.sendSystemAlert('error', '에러 알림 테스트', '오류가 발생했습니다.'));

    // Instagram 관련 알림
    results.push(await slackService.sendInstagramPostSuccess({
      mediaType: 'CAROUSEL_ALBUM',
      caption: '테스트 캐러셀 게시물',
      postId: 'test_123'
    }));

    // Rate Limit 경고
    results.push(await slackService.sendRateLimitWarning({
      quota_usage: 90,
      quota_total: 100,
      utilizationPercentage: 90
    }));

    // 사용자 활동
    results.push(await slackService.sendUserActivity('signup', {
      userId: 'test_user_456',
      email: 'test@example.com'
    }));

    results.push(await slackService.sendMessage('✅ 모든 알림 타입 테스트 완료!'));

    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    res.json({
      success: true,
      message: `모든 알림 테스트 완료: ${successCount}/${totalCount} 성공`,
      results: results.map((r, i) => ({ test: i + 1, success: r.success, error: r.error }))
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: '전체 알림 테스트 중 오류가 발생했습니다.',
      details: error.message
    });
  }
});

module.exports = router;