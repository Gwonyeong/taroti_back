const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// 카드 해석 데이터 로드
const loadCardData = (type) => {
  try {
    let dataPath = '';
    if (type === 'weekly-fortune') {
      dataPath = path.join(__dirname, '../data/weeklyFortune.json');
    } else if (type === 'true-feelings') {
      dataPath = path.join(__dirname, '../data/trueFeelings.json');
    } else {
      dataPath = path.join(__dirname, '../data/weeklyFortune.json'); // 기본값
    }

    const data = fs.readFileSync(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
};

// 여러 카드의 해석 데이터를 가져오는 API
router.post('/interpretations', (req, res) => {
  try {
    const { cardNumbers, type } = req.body;


    if (!Array.isArray(cardNumbers)) {
      return res.status(400).json({
        success: false,
        error: 'cardNumbers는 배열이어야 합니다.'
      });
    }

    const cardData = loadCardData(type);
    if (!cardData || !cardData.cards) {
      return res.status(500).json({
        success: false,
        error: '카드 데이터를 로드할 수 없습니다.'
      });
    }

    const cards = cardNumbers.map(cardNumber => {
      const card = cardData.cards[cardNumber];
      if (!card) {
        return null;
      }

      let interpretation = '';
      let cardName = card.koreanName || card.name || `${cardNumber}번 카드`;

      // 영상 종류에 따른 해석 내용 선택
      if (type === 'weekly-fortune' && card.weeklyFortune) {
        interpretation = card.weeklyFortune.overall;
      } else if (type === 'true-feelings' && card.trueFeelings) {
        interpretation = card.trueFeelings.feeling;
      } else {
        interpretation = card.overall || '카드 해석을 찾을 수 없습니다.';
      }

      return {
        cardNumber,
        koreanName: cardName,
        interpretation
      };
    }).filter(card => card !== null);


    res.json({
      success: true,
      cards,
      type,
      total: cards.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 단일 카드 해석 데이터를 가져오는 API
router.get('/:cardNumber/interpretation', (req, res) => {
  try {
    const { cardNumber } = req.params;
    const { type } = req.query;

    const cardData = loadCardData(type);
    if (!cardData || !cardData.cards) {
      return res.status(500).json({
        success: false,
        error: '카드 데이터를 로드할 수 없습니다.'
      });
    }

    const card = cardData.cards[cardNumber];
    if (!card) {
      return res.status(404).json({
        success: false,
        error: '해당 카드를 찾을 수 없습니다.'
      });
    }

    let interpretation = '';
    if (type === 'weekly-fortune' && card.weeklyFortune) {
      interpretation = card.weeklyFortune.overall;
    } else if (type === 'true-feelings' && card.trueFeelings) {
      interpretation = card.trueFeelings.feeling;
    } else {
      interpretation = card.overall || '카드 해석을 찾을 수 없습니다.';
    }

    res.json({
      success: true,
      card: {
        cardNumber: parseInt(cardNumber),
        koreanName: card.koreanName || card.name,
        interpretation,
        weeklyFortune: card.weeklyFortune,
        trueFeelings: card.trueFeelings
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;