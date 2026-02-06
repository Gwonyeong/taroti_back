const express = require('express');
const prisma = require('../lib/prisma');
const crypto = require('crypto');

const router = express.Router();


// 공유 링크 생성 - 범용 API
router.post('/', async (req, res) => {
  try {
    const {
      resourceType, // 'fortune-session', 'december-fortune', 'newyear-2026' 등
      resourceId,
      title,
      description,
      image
    } = req.body;

    if (!resourceType || !resourceId) {
      return res.status(400).json({
        success: false,
        message: 'resourceType과 resourceId가 필요합니다.'
      });
    }

    const parsedId = parseInt(resourceId);
    if (isNaN(parsedId)) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 리소스 ID입니다.'
      });
    }

    let resourceData = null;
    let shareData = null;
    let metadata = null;

    // 리소스 타입에 따라 다른 처리
    if (resourceType === 'fortune-session') {
      // 통합 운세 세션
      const session = await prisma.fortuneSession.findUnique({
        where: { id: parsedId },
        include: {
          template: true,
          user: {
            select: {
              id: true,
              nickname: true
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
        userProfile = { nickname: session.user.nickname };
      } else if (session.userProfileSnapshot) {
        const snapshot = JSON.parse(session.userProfileSnapshot);
        userProfile = { nickname: snapshot.nickname || "타로티 친구" };
      }

      // 카드 표시명 함수
      const getCardDisplayName = (cardNumber) => {
        const displayNames = {
          0: "THE FOOL (바보)", 1: "THE MAGICIAN (마법사)", 2: "THE HIGH PRIESTESS (여사제)",
          3: "THE EMPRESS (여황제)", 4: "THE EMPEROR (황제)", 5: "THE HIEROPHANT (교황)",
          6: "THE LOVERS (연인)", 7: "THE CHARIOT (전차)", 8: "STRENGTH (힘)",
          9: "THE HERMIT (은둔자)", 10: "WHEEL OF FORTUNE (운명의 수레바퀴)", 11: "JUSTICE (정의)",
          12: "THE HANGED MAN (매달린 사람)", 13: "DEATH (죽음)", 14: "TEMPERANCE (절제)",
          15: "THE DEVIL (악마)", 16: "THE TOWER (탑)", 17: "THE STAR (별)",
          18: "THE MOON (달)", 19: "THE SUN (태양)", 20: "JUDGEMENT (심판)", 21: "THE WORLD (세계)"
        };
        return displayNames[cardNumber] || "THE FOOL (바보)";
      };

      const cardName = getCardDisplayName(session.selectedCard);
      const nickname = userProfile.nickname || "타로티 친구";
      const sessionMetadata = session.sessionMetadata ? JSON.parse(session.sessionMetadata) : {};
      const fortuneType = sessionMetadata.fortuneType || session.template.title;

      // 공유할 운세 데이터 구성
      shareData = {
        originalFortuneId: session.id,
        fortuneType,
        selectedCard: session.selectedCard,
        nickname,
        cardName,
        shareType: 'fortune-session',
        templateKey: session.template.templateKey,
        createdAt: new Date().toISOString()
      };

      // 카드 이미지 URL 생성 (실제 경로로 수정)
      const getCardImageUrl = (cardNumber) => {
        const cardNames = {
          0: "TheFool", 1: "TheMagician", 2: "TheHighPriestess",
          3: "TheEmpress", 4: "TheEmperor", 5: "TheHierophant",
          6: "TheLovers", 7: "TheChariot", 8: "Strength",
          9: "TheHermit", 10: "WheelOfFortune", 11: "Justice",
          12: "TheHangedMan", 13: "Death", 14: "Temperance",
          15: "TheDevil", 16: "TheTower", 17: "TheStar",
          18: "TheMoon", 19: "TheSun", 20: "Judgement", 21: "TheWorld"
        };
        const cardName = cardNames[cardNumber] || "TheFool";
        return `${process.env.FRONTEND_URL || 'https://taroti-front.vercel.app'}/documents/illustrator/${cardNumber}-${cardName}.jpg`;
      };

      // 메타데이터 구성
      metadata = {
        title: title || `${nickname}님의 ${fortuneType} 결과 - ${cardName}`,
        description: description || `${nickname}님이 선택한 ${cardName} 카드의 ${fortuneType} 결과를 확인해보세요.`,
        image: image || getCardImageUrl(session.selectedCard),
        cardName,
        nickname,
        fortuneType
      };

      resourceData = session;

    } else {
      // 다른 리소스 타입들은 추후 추가 가능
      return res.status(400).json({
        success: false,
        message: '지원하지 않는 리소스 타입입니다.'
      });
    }

    // 고유한 공유 ID 생성
    const shareId = crypto.randomUUID();

    // ShareLink에 저장 (upsert로 기존 링크가 있으면 업데이트)
    const shareLink = await prisma.shareLink.upsert({
      where: { originalFortuneId: resourceData.id },
      create: {
        shareId,
        originalFortuneId: resourceData.id,
        fortuneData: shareData,
        metadata: metadata
      },
      update: {
        metadata: metadata, // 메타데이터만 업데이트
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      shareId: shareLink.shareId,
      shareUrl: `/share-fortune/${shareLink.shareId}`,
      message: '공유 링크가 생성되었습니다.'
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: '공유 링크 생성 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;