const fs = require('fs');
const path = require('path');
const ImageService = require('./imageService');

class FortuneService {
  constructor(prismaClient) {
    this.prisma = prismaClient;
    // 운세 데이터 로드
    this.fortuneData = this.loadFortuneData();
    this.zodiacSigns = Object.keys(this.fortuneData.zodiac);
    // 이미지 생성 서비스 초기화
    this.imageService = new ImageService();
  }

  loadFortuneData() {
    try {
      const dataPath = path.join(__dirname, '../data/dailyFortune.json');
      const rawData = fs.readFileSync(dataPath, 'utf8');
      return JSON.parse(rawData);
    } catch (error) {
      throw new Error('운세 데이터를 로드할 수 없습니다.');
    }
  }

  // 특정 날짜의 별자리별 타로 카드 추첨
  async drawTarotCardsForDate(date, fortuneTheme = '기본운') {
    const dateString = date.toISOString().split('T')[0]; // YYYY-MM-DD 형식

    // 날짜와 테마를 기반으로 시드 생성 (같은 날 같은 테마는 항상 같은 카드)
    const seed = this.generateSeed(dateString, fortuneTheme);

    const drawnCards = {};
    const usedCards = new Set();

    for (let i = 0; i < this.zodiacSigns.length; i++) {
      const zodiacSign = this.zodiacSigns[i];

      // 별자리별로 고유한 시드 생성 (무한루프 방지를 위해 더 강한 변형)
      let cardNumber;
      let attempts = 0;
      const maxAttempts = 100; // 무한루프 방지

      do {
        const zodiacSeed = seed + i * 1000 + attempts * 100; // 시드를 더 강하게 변형
        cardNumber = this.seededRandom(zodiacSeed, 0, 21);
        attempts++;

        if (attempts > maxAttempts) {
          // 사용하지 않은 카드 중 하나를 강제로 할당
          for (let fallbackCard = 0; fallbackCard <= 21; fallbackCard++) {
            if (!usedCards.has(fallbackCard)) {
              cardNumber = fallbackCard;
              break;
            }
          }
          break;
        }
      } while (usedCards.has(cardNumber));

      usedCards.add(cardNumber);
      drawnCards[zodiacSign] = cardNumber;
    }

    return drawnCards;
  }

  // 시드 기반 랜덤 숫자 생성
  seededRandom(seed, min, max) {
    const x = Math.sin(seed) * 10000;
    const random = x - Math.floor(x);
    return Math.floor(random * (max - min + 1)) + min;
  }

  // 날짜와 테마를 기반으로 시드 생성
  generateSeed(dateString, theme) {
    let hash = 0;
    const str = dateString + theme;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit integer 변환
    }
    return Math.abs(hash);
  }

  // 특정 별자리와 카드로 운세 생성
  generateFortune(zodiacSign, cardNumber, fortuneTheme = '기본운') {
    try {
      const zodiacInfo = this.fortuneData.zodiac[zodiacSign];
      const themeInfo = this.fortuneData.themes[fortuneTheme];
      const cardFortunes = this.fortuneData.fortunes[cardNumber.toString()];

      if (!zodiacInfo || !themeInfo || !cardFortunes) {
        throw new Error('운세 데이터를 찾을 수 없습니다.');
      }

      const fortuneTexts = cardFortunes[fortuneTheme];
      if (!fortuneTexts || fortuneTexts.length === 0) {
        throw new Error(`${fortuneTheme}에 대한 운세 데이터가 없습니다.`);
      }

      // 랜덤하게 운세 텍스트 선택
      const randomIndex = Math.floor(Math.random() * fortuneTexts.length);
      const fortuneText = fortuneTexts[randomIndex];

      // 타로 카드 데이터 (기존 newYearFortune2026.json에서 가져오기)
      const cardData = this.getCardData(cardNumber);

      return {
        zodiacSign,
        zodiacInfo,
        fortuneTheme,
        themeInfo,
        cardNumber,
        cardData,
        fortuneText,
        keywords: zodiacInfo.keywords,
        createdAt: new Date()
      };
    } catch (error) {
      throw error;
    }
  }

  // 타로 카드 데이터 가져오기
  getCardData(cardNumber) {
    try {
      // newYearFortune2026.json 파일에서 카드 데이터 로드
      const cardDataPath = path.join(__dirname, '../data/newYearFortune2026.json');

      if (fs.existsSync(cardDataPath)) {
        const cardData = JSON.parse(fs.readFileSync(cardDataPath, 'utf8'));
        return cardData[cardNumber.toString()] || null;
      }
    } catch (error) {
    }

    // 기본 카드 데이터 반환
    return {
      cardName: `카드 ${cardNumber}`,
      keywords: ['운세', '타로', '미래']
    };
  }

  // 전체 별자리의 오늘 운세 생성
  async generateDailyFortunes(date = new Date(), fortuneTheme = '기본운') {
    try {

      const drawnCards = await this.drawTarotCardsForDate(date, fortuneTheme);

      const fortunes = [];

      for (let i = 0; i < this.zodiacSigns.length; i++) {
        const zodiacSign = this.zodiacSigns[i];
        const cardNumber = drawnCards[zodiacSign];


        const fortune = this.generateFortune(zodiacSign, cardNumber, fortuneTheme);
        fortunes.push(fortune);

      }

      return fortunes;
    } catch (error) {
      throw error;
    }
  }

  // 데이터베이스에 운세 저장 (배치 처리)
  async saveDailyFortunes(fortunes) {
    try {
      // 배치 처리를 위해 createMany 사용
      const fortuneData = fortunes.map(fortune => ({
        zodiacSign: fortune.zodiacSign,
        fortuneTheme: fortune.fortuneTheme,
        tarotCard: fortune.cardNumber,
        fortuneText: fortune.fortuneText,
        imageUrls: [], // 이미지 URL은 나중에 업데이트
        status: 'PENDING'
      }));

      const result = await this.prisma.dailyFortunePost.createMany({
        data: fortuneData
      });


      // 생성된 레코드들을 반환하기 위해 다시 조회
      const today = new Date().toISOString().split('T')[0];
      const savedPosts = await this.prisma.dailyFortunePost.findMany({
        where: {
          createdAt: {
            gte: new Date(today + 'T00:00:00.000Z'),
            lte: new Date(today + 'T23:59:59.999Z')
          },
          fortuneTheme: fortunes[0]?.fortuneTheme
        },
        orderBy: { createdAt: 'desc' },
        take: fortunes.length
      });

      return savedPosts;
    } catch (error) {
      throw error;
    }
  }

  // HTML 템플릿용 데이터 생성
  generateTemplateData(fortune, templateType = 'thumbnail') {
    const today = new Date();
    const formattedDate = today.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const baseData = {
      DATE: formattedDate,
      ZODIAC_NAME: fortune.zodiacSign,
      ZODIAC_SYMBOL: fortune.zodiacInfo.symbol,
      ZODIAC_DATES: fortune.zodiacInfo.dates,
      THEME_TITLE: fortune.themeInfo.title,
      THEME_DESCRIPTION: fortune.themeInfo.description,
      CARD_NUMBER: fortune.cardNumber,
      CARD_NAME: fortune.cardData?.cardName || `카드 ${fortune.cardNumber}`,
      FORTUNE_TEXT: fortune.fortuneText,
      KEYWORDS: this.formatKeywords(fortune.keywords)
    };

    return baseData;
  }

  // 키워드 포맷팅
  formatKeywords(keywords) {
    if (Array.isArray(keywords)) {
      return keywords.map(keyword => `<span class="keyword">${keyword}</span>`).join('');
    }
    return '';
  }

  // 특정 별자리의 운세 가져오기
  async getFortuneByZodiac(zodiacSign, date = new Date(), fortuneTheme = '기본운') {
    try {
      const drawnCards = await this.drawTarotCardsForDate(date, fortuneTheme);
      const cardNumber = drawnCards[zodiacSign];
      return this.generateFortune(zodiacSign, cardNumber, fortuneTheme);
    } catch (error) {
      throw error;
    }
  }

  // 통합 운세 이미지 생성 (6개 이미지로 구성된 단일 포스트)
  async generateConsolidatedFortuneImages(fortunes, theme = '기본운') {
    try {

      // 모든 운세 데이터로 통합 이미지 세트 생성
      return await this.imageService.generateConsolidatedFortuneImageSet(fortunes, theme);
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // 데이터베이스에 운세 저장 (이미지 URL 포함) - 사용 안 함 (개별 운세 저장용)
  async saveDailyFortunesWithImages(fortunes, imageResults) {
    try {
      const fortuneData = fortunes.map((fortune, index) => {
        const imageResult = imageResults[index];
        return {
          zodiacSign: fortune.zodiacSign,
          fortuneTheme: fortune.fortuneTheme,
          tarotCard: fortune.cardNumber,
          fortuneText: fortune.fortuneText,
          imageUrls: imageResult?.success ? imageResult.imageUrls : [],
          status: imageResult?.success ? 'READY' : 'FAILED'
        };
      });

      const result = await this.prisma.dailyFortunePost.createMany({
        data: fortuneData
      });


      // 생성된 레코드들을 반환하기 위해 다시 조회
      const today = new Date().toISOString().split('T')[0];
      const savedPosts = await this.prisma.dailyFortunePost.findMany({
        where: {
          createdAt: {
            gte: new Date(today + 'T00:00:00.000Z'),
            lte: new Date(today + 'T23:59:59.999Z')
          },
          fortuneTheme: fortunes[0]?.fortuneTheme
        },
        orderBy: { createdAt: 'desc' },
        take: fortunes.length
      });

      return savedPosts;
    } catch (error) {
      throw error;
    }
  }

  // 이미지 서비스 정리
  async cleanup() {
    if (this.imageService) {
      await this.imageService.close();
    }
  }
}

module.exports = FortuneService;