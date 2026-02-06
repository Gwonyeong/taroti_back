const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

class ImageService {
  constructor() {
    this.browser = null;
    this.templatesDir = path.join(__dirname, '../templates');
    this.outputDir = path.join(__dirname, '../uploads/fortune-images');

    // Supabase client 초기화
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
    this.bucket = process.env.SUPABASE_BUCKET || 'taroti';
  }

  async initialize() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ]
      });
    }

    // 출력 디렉토리 생성
    try {
      await fs.access(this.outputDir);
    } catch {
      await fs.mkdir(this.outputDir, { recursive: true });
    }
  }

  // HTML 템플릿에 데이터 바인딩 (모든 변수 처리)
  replaceTemplateVariables(htmlContent, data) {
    let result = htmlContent;

    // 기본 템플릿 변수들
    result = result
      .replace(/\{\{DATE\}\}/g, data.DATE || '')
      .replace(/\{\{ZODIAC_NAME\}\}/g, data.ZODIAC_NAME || '')
      .replace(/\{\{ZODIAC_SYMBOL\}\}/g, data.ZODIAC_SYMBOL || '')
      .replace(/\{\{ZODIAC_DATES\}\}/g, data.ZODIAC_DATES || '')
      .replace(/\{\{THEME_TITLE\}\}/g, data.THEME_TITLE || '')
      .replace(/\{\{THEME_DESCRIPTION\}\}/g, data.THEME_DESCRIPTION || '')
      .replace(/\{\{CARD_NUMBER\}\}/g, data.CARD_NUMBER || '')
      .replace(/\{\{CARD_NAME\}\}/g, data.CARD_NAME || '')
      .replace(/\{\{FORTUNE_TEXT\}\}/g, data.FORTUNE_TEXT || '')
      .replace(/\{\{KEYWORDS\}\}/g, data.KEYWORDS || '');

    // 동적 변수들 (ZODIAC1_NAME, ZODIAC2_SYMBOL 등)
    Object.keys(data).forEach(key => {
      const placeholder = `{{${key}}}`;
      const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      result = result.replace(regex, data[key] || '');
    });

    return result;
  }

  // 운세 썸네일 이미지 생성
  async generateThumbnailImage(fortuneData) {
    await this.initialize();

    try {
      const templatePath = path.join(this.templatesDir, 'fortune-thumbnail.html');
      let htmlContent = await fs.readFile(templatePath, 'utf8');

      // 템플릿 변수 치환
      htmlContent = this.replaceTemplateVariables(htmlContent, fortuneData);

      // UUID 기반 파일명 생성 (한글 제거)
      const filename = `${uuidv4()}.png`;

      return await this.generateImage(htmlContent, filename, 'thumbnail');

    } catch (error) {
      throw error;
    }
  }

  // 운세 내용 이미지 생성
  async generateContentImage(fortuneData) {
    await this.initialize();

    try {
      const templatePath = path.join(this.templatesDir, 'fortune-content.html');
      let htmlContent = await fs.readFile(templatePath, 'utf8');

      // 템플릿 변수 치환
      htmlContent = this.replaceTemplateVariables(htmlContent, fortuneData);

      // UUID 기반 파일명 생성 (한글 제거)
      const filename = `${uuidv4()}.png`;

      return await this.generateImage(htmlContent, filename, 'content');

    } catch (error) {
      throw error;
    }
  }

  // 브랜딩 이미지 생성
  async generateBrandingImage() {
    await this.initialize();

    try {
      const templatePath = path.join(this.templatesDir, 'fortune-branding.html');
      let htmlContent = await fs.readFile(templatePath, 'utf8');

      // UUID 기반 파일명 생성 (한글 제거)
      const filename = `${uuidv4()}.png`;

      return await this.generateImage(htmlContent, filename, 'branding');

    } catch (error) {
      throw error;
    }
  }

  // 키워드 포맷팅
  formatKeywords(keywords) {
    if (Array.isArray(keywords)) {
      return keywords.map(keyword => `<span class="keyword">${keyword}</span>`).join('');
    }
    return '';
  }

  // 카드 이미지 경로 가져오기
  getCardImagePath(cardNumber) {
    // 타로 카드 이름 매핑 (0-21) - 백엔드 로컬 이미지 사용
    const cardNames = [
      'TheFool',
      'TheMagician',
      'TheHighPriestess',
      'TheEmpress',
      'TheEmperor',
      'TheHierophant',
      'TheLovers',
      'TheChariot',
      'Strength',
      'TheHermit',
      'WheelOfFortune',
      'Justice',
      'TheHangedMan',
      'Death',
      'Temperance',
      'TheDevil',
      'TheTower',
      'TheStar',
      'TheMoon',
      'TheSun',
      'Judgement',
      'TheWorld'
    ];

    if (cardNumber >= 0 && cardNumber < cardNames.length) {
      // 백엔드 로컬 이미지 URL 사용 (독립적 운영)
      const paddedNumber = String(cardNumber).padStart(2, '0');
      return `http://localhost:5002/public/images/cards/${paddedNumber}-${cardNames[cardNumber]}.jpg`;
    }

    // 기본 이미지 (바보 카드)
    return `http://localhost:5002/public/images/cards/00-TheFool.jpg`;
  }

  // 실제 이미지 생성 로직 (기존 백엔드 Supabase 패턴 사용)
  async generateImage(htmlContent, filename, imageType) {
    const page = await this.browser.newPage();

    try {
      // 페이지 크기를 1080x1350으로 설정
      await page.setViewportSize({
        width: 1080,
        height: 1350
      });

      // HTML 콘텐츠 설정
      await page.setContent(htmlContent, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // 이미지를 버퍼로 생성
      const imageBuffer = await page.screenshot({
        fullPage: false,
        clip: {
          x: 0,
          y: 0,
          width: 1080,
          height: 1350
        },
        type: 'png'
      });

      // Supabase 업로드 (재시도 로직 포함)
      const filePath = `fortune-images/${filename}`;
      let uploadResult;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {

          uploadResult = await this.supabase.storage
            .from(this.bucket)
            .upload(filePath, imageBuffer, {
              contentType: 'image/png',
              cacheControl: '3600',
              upsert: false
            });

          if (uploadResult.error) {

            if (attempt === maxRetries) {
              throw new Error(`Supabase 업로드 실패 (${maxRetries}회 시도): ${uploadResult.error.message}`);
            }

            // 재시도 전 대기 (점진적 증가)
            const waitTime = attempt * 1000; // 1초, 2초, 3초
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }

          break;

        } catch (networkError) {

          if (attempt === maxRetries) {
            throw new Error(`Supabase 네트워크 오류 (${maxRetries}회 시도): ${networkError.message}`);
          }

          const waitTime = attempt * 2000; // 2초, 4초, 6초
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }

      // 공개 URL 생성
      const { data: publicUrlData } = this.supabase.storage
        .from(this.bucket)
        .getPublicUrl(filePath);

      return {
        success: true,
        filename: filename,
        publicUrl: publicUrlData.publicUrl,
        path: uploadResult.data.path,
        imageType: imageType,
        message: '이미지가 성공적으로 생성되고 업로드되었습니다'
      };

    } finally {
      await page.close();
    }
  }

  // 통합 운세 이미지 세트 생성 (6개 이미지: 썸네일 + 4개 계절별 페이지 + 마무리)
  async generateConsolidatedFortuneImageSet(fortunesData, theme = '기본운') {
    try {

      // 1. 썸네일 이미지
      const thumbnailData = this.generateConsolidatedTemplateData(fortunesData, theme, 'thumbnail');
      const thumbnailImage = await this.generateConsolidatedImage(thumbnailData, 'daily-fortune-thumbnail', 'thumbnail');

      // 2. 봄 별자리 페이지 (양자리, 황소자리, 쌍둥이자리)
      const springData = this.generateSeasonalFortuneTemplateData(fortunesData, theme, 'spring');
      const springImage = await this.generateConsolidatedImage(springData, 'daily-fortune-common', 'spring');

      // 3. 여름 별자리 페이지 (게자리, 사자자리, 처녀자리)
      const summerData = this.generateSeasonalFortuneTemplateData(fortunesData, theme, 'summer');
      const summerImage = await this.generateConsolidatedImage(summerData, 'daily-fortune-common', 'summer');

      // 4. 가을 별자리 페이지 (천칭자리, 전갈자리, 궁수자리)
      const autumnData = this.generateSeasonalFortuneTemplateData(fortunesData, theme, 'autumn');
      const autumnImage = await this.generateConsolidatedImage(autumnData, 'daily-fortune-common', 'autumn');

      // 5. 겨울 별자리 페이지 (염소자리, 물병자리, 물고기자리)
      const winterData = this.generateSeasonalFortuneTemplateData(fortunesData, theme, 'winter');
      const winterImage = await this.generateConsolidatedImage(winterData, 'daily-fortune-common', 'winter');

      // 6. 마무리 이미지
      const endingData = this.generateConsolidatedTemplateData(fortunesData, theme, 'ending');
      const endingImage = await this.generateConsolidatedImage(endingData, 'daily-fortune-ending', 'ending');

      const results = [thumbnailImage, springImage, summerImage, autumnImage, winterImage, endingImage];


      return {
        success: true,
        images: {
          thumbnail: results[0],
          spring: results[1],
          summer: results[2],
          autumn: results[3],
          winter: results[4],
          ending: results[5]
        },
        imageUrls: results.map(result => result.publicUrl),
        totalImages: 6
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // 통합 템플릿용 데이터 생성
  generateConsolidatedTemplateData(fortunesData, theme, pageType) {
    const today = new Date();
    const formattedDate = today.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // 간단한 날짜 형식 (mm월 dd일 x요일)
    const simpleDateFormat = today.toLocaleDateString('ko-KR', {
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });

    // 썸네일용 요일별 테마 처리
    if (pageType === 'thumbnail') {
      const weekday = today.getDay(); // 0: 일요일, 1: 월요일, ..., 6: 토요일
      const weekdayTheme = this.getWeekdayThemes()[weekday];

      return {
        DATE_TEXT: simpleDateFormat,
        BACKGROUND_COLOR: weekdayTheme.backgroundColor,
        TEXT_COLOR: weekdayTheme.textColor
      };
    }

    const themeInfo = {
      '기본운': {
        title: '오늘의 기본 운세',
        description: '전체적인 운의 흐름을 확인해보세요',
        simple: '기본운세',
        backgroundColor: '#F7D18A',
        textColor: '#2D1810',
        themeBackgroundColor: '#F48FB1'
      },
      '연애운': {
        title: '오늘의 연애 운세',
        description: '사랑과 인연의 흐름을 알아보세요',
        simple: '연애운세',
        backgroundColor: '#FFB6C1',
        textColor: '#8B0000',
        themeBackgroundColor: '#FF69B4'
      },
      '금전운': {
        title: '오늘의 금전 운세',
        description: '재물과 투자의 기회를 살펴보세요',
        simple: '금전운세',
        backgroundColor: '#F0E68C',
        textColor: '#B8860B',
        themeBackgroundColor: '#FFD700'
      },
      '건강운': {
        title: '오늘의 건강 운세',
        description: '몸과 마음의 건강을 체크해보세요',
        simple: '건강운세',
        backgroundColor: '#98FB98',
        textColor: '#006400',
        themeBackgroundColor: '#32CD32'
      }
    };

    const baseData = {
      DATE: formattedDate,
      DATE_SIMPLE: simpleDateFormat,
      THEME_TITLE: themeInfo[theme]?.title || '오늘의 운세',
      THEME_DESCRIPTION: themeInfo[theme]?.description || '별자리별 운세를 확인해보세요',
      THEME_SIMPLE: themeInfo[theme]?.simple || '기본운세',
      BACKGROUND_COLOR: themeInfo[theme]?.backgroundColor || '#F7D18A',
      TEXT_COLOR: themeInfo[theme]?.textColor || '#2D1810',
      THEME_BACKGROUND_COLOR: themeInfo[theme]?.themeBackgroundColor || '#F48FB1'
    };

    // 페이지별 데이터 추가
    if (pageType === 'thumbnail' || pageType === 'ending') {
      return baseData;
    }

    // 페이지별 별자리 데이터 추가
    for (let i = 0; i < fortunesData.length && i < 4; i++) {
      const fortune = fortunesData[i];
      const zodiacNum = (pageType === 'page1' ? i + 1 :
                       pageType === 'page2' ? i + 5 : i + 9);

      baseData[`ZODIAC${zodiacNum}_SYMBOL`] = fortune.zodiacInfo.symbol;
      baseData[`ZODIAC${zodiacNum}_NAME`] = fortune.zodiacSign;
      baseData[`ZODIAC${zodiacNum}_DATES`] = fortune.zodiacInfo.dates;
      baseData[`ZODIAC${zodiacNum}_CARD_NUMBER`] = fortune.cardNumber;
      baseData[`ZODIAC${zodiacNum}_CARD_NAME`] = fortune.cardData?.cardName || `카드 ${fortune.cardNumber}`;
      baseData[`ZODIAC${zodiacNum}_FORTUNE_TEXT`] = fortune.fortuneText;
      baseData[`ZODIAC${zodiacNum}_KEYWORDS`] = this.formatKeywords(fortune.keywords);

      // 카드 이미지 태그 추가
      const cardImagePath = this.getCardImagePath(fortune.cardNumber);
      baseData[`ZODIAC${zodiacNum}_CARD_IMAGE`] = cardImagePath ?
        `<img src="${cardImagePath}" alt="${fortune.cardData?.cardName || `카드 ${fortune.cardNumber}`}">` :
        `<div style="display: flex; align-items: center; justify-content: center; height: 100%; font-size: 14px; color: #999;">카드<br>${fortune.cardNumber}</div>`;
    }

    return baseData;
  }

  // 계절별 색상 테마 설정
  getSeasonalThemes() {
    return {
      spring: { // 봄
        seasonName: '봄 🌸',
        backgroundGradient: 'linear-gradient(135deg, #ffe5f1 0%, #e8f5e8 50%, #fff8dc 100%)',
        textColor: '#2d5016',
        logoColor: '#4a7c59',
        borderColor: '#a8d5a8'
      },
      summer: { // 여름
        seasonName: '여름 ☀️',
        backgroundGradient: 'linear-gradient(135deg, #FFF4E6 0%, #FFE5CC 50%, #87CEEB 100%)',
        textColor: '#B8860B',
        logoColor: '#D2691E',
        borderColor: '#F4A460'
      },
      autumn: { // 가을
        seasonName: '가을 🍂',
        backgroundGradient: 'linear-gradient(135deg, #D2691E 0%, #CD853F 30%, #DEB887 70%, #F4A460 100%)',
        textColor: '#8B4513',
        logoColor: '#A0522D',
        borderColor: '#CD853F'
      },
      winter: { // 겨울
        seasonName: '겨울 ❄️',
        backgroundGradient: 'linear-gradient(135deg, #E6F3FF 0%, #B0E0E6 30%, #87CEFA 70%, #ADD8E6 100%)',
        textColor: '#2F4F4F',
        logoColor: '#4682B4',
        borderColor: '#87CEFA'
      }
    };
  }

  // 요일별 썸네일 테마 설정
  getWeekdayThemes() {
    return {
      0: { // 일요일
        backgroundColor: '#FFE4E1', // 연한 핑크
        textColor: '#8B0000' // 짙은 빨간색
      },
      1: { // 월요일
        backgroundColor: '#E0F6FF', // 연한 하늘색
        textColor: '#003366' // 짙은 네이비
      },
      2: { // 화요일
        backgroundColor: '#FFE4B5', // 연한 오렌지
        textColor: '#8B4513' // 짙은 갈색
      },
      3: { // 수요일
        backgroundColor: '#F0FFF0', // 연한 초록
        textColor: '#006400' // 짙은 초록
      },
      4: { // 목요일
        backgroundColor: '#F5F5DC', // 베이지
        textColor: '#654321' // 짙은 갈색
      },
      5: { // 금요일
        backgroundColor: '#E6E6FA', // 연한 보라
        textColor: '#4B0082' // 인디고
      },
      6: { // 토요일
        backgroundColor: '#FFE4E1', // 연한 로즈
        textColor: '#800080' // 보라색
      }
    };
  }

  // 타로 카드 전체 목록 (랜덤 생성용)
  getAllTarotCards() {
    return [
      { number: 0, name: '바보 (The Fool)', alt: '바보' },
      { number: 1, name: '마법사 (The Magician)', alt: '마법사' },
      { number: 2, name: '여사제 (The High Priestess)', alt: '여사제' },
      { number: 3, name: '여황제 (The Empress)', alt: '여황제' },
      { number: 4, name: '황제 (The Emperor)', alt: '황제' },
      { number: 5, name: '교황 (The Hierophant)', alt: '교황' },
      { number: 6, name: '연인 (The Lovers)', alt: '연인' },
      { number: 7, name: '전차 (The Chariot)', alt: '전차' },
      { number: 8, name: '힘 (Strength)', alt: '힘' },
      { number: 9, name: '은둔자 (The Hermit)', alt: '은둔자' },
      { number: 10, name: '운명의 수레바퀴 (Wheel of Fortune)', alt: '운명의 수레바퀴' },
      { number: 11, name: '정의 (Justice)', alt: '정의' },
      { number: 12, name: '매달린 사람 (The Hanged Man)', alt: '매달린 사람' },
      { number: 13, name: '죽음 (Death)', alt: '죽음' },
      { number: 14, name: '절제 (Temperance)', alt: '절제' },
      { number: 15, name: '악마 (The Devil)', alt: '악마' },
      { number: 16, name: '탑 (The Tower)', alt: '탑' },
      { number: 17, name: '별 (The Star)', alt: '별' },
      { number: 18, name: '달 (The Moon)', alt: '달' },
      { number: 19, name: '태양 (The Sun)', alt: '태양' },
      { number: 20, name: '심판 (Judgement)', alt: '심판' },
      { number: 21, name: '세계 (The World)', alt: '세계' }
    ];
  }

  // 계절별 별자리 데이터 정의 (고정 데이터)
  getSeasonalZodiacData() {
    return {
      spring: [ // 봄 별자리 (3-5월)
        { symbol: '♈', name: '양자리', dates: '3.21 ~ 4.19' },
        { symbol: '♉', name: '황소자리', dates: '4.20 ~ 5.20' },
        { symbol: '♊', name: '쌍둥이자리', dates: '5.21 ~ 6.21' }
      ],
      summer: [ // 여름 별자리 (6-8월)
        { symbol: '♋', name: '게자리', dates: '6.22 ~ 7.22' },
        { symbol: '♌', name: '사자자리', dates: '7.23 ~ 8.22' },
        { symbol: '♍', name: '처녀자리', dates: '8.23 ~ 9.22' }
      ],
      autumn: [ // 가을 별자리 (9-11월)
        { symbol: '♎', name: '천칭자리', dates: '9.23 ~ 10.22' },
        { symbol: '♏', name: '전갈자리', dates: '10.23 ~ 11.21' },
        { symbol: '♐', name: '사수자리', dates: '11.22 ~ 12.21' }
      ],
      winter: [ // 겨울 별자리 (12-2월)
        { symbol: '♑', name: '염소자리', dates: '12.22 ~ 1.19' },
        { symbol: '♒', name: '물병자리', dates: '1.20 ~ 2.18' },
        { symbol: '♓', name: '물고기자리', dates: '2.19 ~ 3.20' }
      ]
    };
  }

  // 랜덤 카드 선택
  getRandomCard() {
    const cards = this.getAllTarotCards();
    const randomIndex = Math.floor(Math.random() * cards.length);
    return cards[randomIndex];
  }

  // daily.json 데이터 로드
  getDailyFortuneData() {
    const path = require('path');
    const fs = require('fs');
    const fortuneDataPath = path.join(__dirname, '..', 'public', 'documents', 'daily.json');
    const fortuneData = JSON.parse(fs.readFileSync(fortuneDataPath, 'utf8'));
    return fortuneData;
  }

  // 카드별 운세 설명 가져오기
  getCardFortune(cardNumber, theme) {
    const fortuneData = this.getDailyFortuneData();
    const cardContents = fortuneData[cardNumber.toString()];

    if (!cardContents || !cardContents.contents) {
      return '운세 정보를 불러올 수 없습니다.';
    }

    // contents 배열에서 랜덤으로 하나 선택
    const contents = cardContents.contents;
    const randomIndex = Math.floor(Math.random() * contents.length);
    return contents[randomIndex];
  }

  // 계절별 템플릿 데이터 생성 (새로운 공통 템플릿 시스템)
  generateSeasonalTemplateData(theme, pageType) {
    const today = new Date();

    // 간단한 날짜 형식 (mm월 dd일 x요일)
    const simpleDateFormat = today.toLocaleDateString('ko-KR', {
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });

    const themeInfo = {
      '기본운': {
        simple: '기본운세'
      },
      '연애운': {
        simple: '연애운세'
      },
      '재물운': {
        simple: '재물운세'
      },
      '학업운': {
        simple: '학업운세'
      }
    };

    // 계절별 테마와 별자리 데이터 가져오기
    const seasonalThemes = this.getSeasonalThemes();
    const zodiacData = this.getSeasonalZodiacData();

    const seasonTheme = seasonalThemes[pageType];
    const zodiacs = zodiacData[pageType];

    if (!seasonTheme || !zodiacs) {
      throw new Error(`Invalid page type: ${pageType}`);
    }

    // 랜덤 카드 3개 선택
    const card1 = this.getRandomCard();
    const card2 = this.getRandomCard();
    const card3 = this.getRandomCard();

    // 기본 템플릿 데이터
    const templateData = {
      // 색상 테마
      SEASON_NAME: seasonTheme.seasonName,
      BACKGROUND_GRADIENT: seasonTheme.backgroundGradient,
      TEXT_COLOR: seasonTheme.textColor,
      LOGO_COLOR: seasonTheme.logoColor,
      BORDER_COLOR: seasonTheme.borderColor,

      // 페이지 정보 (분할된 제목)
      DATE: simpleDateFormat,
      THEME_TITLE: `${seasonTheme.seasonName} 별자리 ${themeInfo[theme]?.simple || '기본운세'}`,
      DATE_THEME: `${simpleDateFormat} ${themeInfo[theme]?.simple || '기본운세'}`,
      SEASON_ZODIAC: `${seasonTheme.seasonName} 별자리`,
      PAGE_TITLE: `${simpleDateFormat} ${seasonTheme.seasonName} 별자리 ${themeInfo[theme]?.simple || '기본운세'}`,

      // 별자리 1
      ZODIAC1_SYMBOL: zodiacs[0].symbol,
      ZODIAC1_NAME: zodiacs[0].name,
      ZODIAC1_DATES: zodiacs[0].dates,
      ZODIAC1_CARD_IMAGE: this.getCardImagePath(card1.number),
      ZODIAC1_CARD_ALT: card1.alt,
      ZODIAC1_CARD_NAME: card1.name,
      ZODIAC1_FORTUNE_TEXT: this.getCardFortune(card1.number, theme),

      // 별자리 2
      ZODIAC2_SYMBOL: zodiacs[1].symbol,
      ZODIAC2_NAME: zodiacs[1].name,
      ZODIAC2_DATES: zodiacs[1].dates,
      ZODIAC2_CARD_IMAGE: this.getCardImagePath(card2.number),
      ZODIAC2_CARD_ALT: card2.alt,
      ZODIAC2_CARD_NAME: card2.name,
      ZODIAC2_FORTUNE_TEXT: this.getCardFortune(card2.number, theme),

      // 별자리 3
      ZODIAC3_SYMBOL: zodiacs[2].symbol,
      ZODIAC3_NAME: zodiacs[2].name,
      ZODIAC3_DATES: zodiacs[2].dates,
      ZODIAC3_CARD_IMAGE: this.getCardImagePath(card3.number),
      ZODIAC3_CARD_ALT: card3.alt,
      ZODIAC3_CARD_NAME: card3.name,
      ZODIAC3_FORTUNE_TEXT: this.getCardFortune(card3.number, theme)
    };

    return templateData;
  }

  // 실제 운세 데이터를 사용한 계절별 템플릿 데이터 생성 (기존 공용 템플릿용)
  generateSeasonalFortuneTemplateData(fortunesData, theme, season) {
    const today = new Date();
    const simpleDateFormat = today.toLocaleDateString('ko-KR', {
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });

    const themeInfo = {
      '기본운': { simple: '기본운세' },
      '연애운': { simple: '연애운세' },
      '재물운': { simple: '재물운세' },
      '학업운': { simple: '학업운세' }
    };

    // 계절별 별자리 이름 매핑 (FortuneService의 zodiacSign과 맞춤)
    const seasonMapping = {
      spring: ['양자리', '황소자리', '쌍둥이자리'],
      summer: ['게자리', '사자자리', '처녀자리'],
      autumn: ['천칭자리', '전갈자리', '사수자리'],
      winter: ['염소자리', '물병자리', '물고기자리']
    };

    const seasonZodiacs = seasonMapping[season];
    if (!seasonZodiacs) {
      throw new Error(`Invalid season: ${season}`);
    }

    // 계절별 테마와 별자리 데이터 가져오기 (기존 방식 사용)
    const seasonalThemes = this.getSeasonalThemes();
    const seasonTheme = seasonalThemes[season];

    // 실제 운세 데이터에서 해당 계절 별자리들 추출 (FortuneService 데이터 구조에 맞춤)
    const seasonFortunes = seasonZodiacs.map(zodiacName =>
      fortunesData.find(fortune => fortune.zodiacSign === zodiacName)
    ).filter(Boolean); // undefined 제거


    // 기존 공용 템플릿용 데이터 구조 (FortuneService 데이터 구조 사용)
    return {
      // 색상 테마 (기존 구조 유지)
      SEASON_NAME: seasonTheme.seasonName,
      BACKGROUND_GRADIENT: seasonTheme.backgroundGradient,
      TEXT_COLOR: seasonTheme.textColor,
      LOGO_COLOR: seasonTheme.logoColor,
      BORDER_COLOR: seasonTheme.borderColor,

      // 페이지 정보 (기존 구조 유지)
      DATE_THEME: `${simpleDateFormat} ${themeInfo[theme]?.simple || '기본운세'}`,
      SEASON_ZODIAC: `${seasonTheme.seasonName} 별자리`,
      PAGE_TITLE: `${simpleDateFormat} ${seasonTheme.seasonName} 별자리 ${themeInfo[theme]?.simple || '기본운세'}`,

      // 별자리 데이터 (FortuneService 구조에 맞춤)
      ZODIAC1_SYMBOL: seasonFortunes[0]?.zodiacInfo?.symbol || '♈',
      ZODIAC1_NAME: seasonFortunes[0]?.zodiacSign || '양자리',
      ZODIAC1_DATES: seasonFortunes[0]?.zodiacInfo?.dates || '3.21 ~ 4.19',
      ZODIAC1_CARD_IMAGE: this.getCardImagePath(seasonFortunes[0]?.cardNumber || 0),
      ZODIAC1_CARD_ALT: seasonFortunes[0]?.cardData?.cardName || '바보',
      ZODIAC1_CARD_NAME: seasonFortunes[0]?.cardData?.cardName || '바보',
      ZODIAC1_FORTUNE: seasonFortunes[0]?.fortuneText || '새로운 시작을 향한 용기가 필요한 때입니다.',

      ZODIAC2_SYMBOL: seasonFortunes[1]?.zodiacInfo?.symbol || '♉',
      ZODIAC2_NAME: seasonFortunes[1]?.zodiacSign || '황소자리',
      ZODIAC2_DATES: seasonFortunes[1]?.zodiacInfo?.dates || '4.20 ~ 5.20',
      ZODIAC2_CARD_IMAGE: this.getCardImagePath(seasonFortunes[1]?.cardNumber || 1),
      ZODIAC2_CARD_ALT: seasonFortunes[1]?.cardData?.cardName || '마법사',
      ZODIAC2_CARD_NAME: seasonFortunes[1]?.cardData?.cardName || '마법사',
      ZODIAC2_FORTUNE: seasonFortunes[1]?.fortuneText || '창조적 에너지가 충만합니다.',

      ZODIAC3_SYMBOL: seasonFortunes[2]?.zodiacInfo?.symbol || '♊',
      ZODIAC3_NAME: seasonFortunes[2]?.zodiacSign || '쌍둥이자리',
      ZODIAC3_DATES: seasonFortunes[2]?.zodiacInfo?.dates || '5.21 ~ 6.21',
      ZODIAC3_CARD_IMAGE: this.getCardImagePath(seasonFortunes[2]?.cardNumber || 2),
      ZODIAC3_CARD_ALT: seasonFortunes[2]?.cardData?.cardName || '여사제',
      ZODIAC3_CARD_NAME: seasonFortunes[2]?.cardData?.cardName || '여사제',
      ZODIAC3_FORTUNE: seasonFortunes[2]?.fortuneText || '내면의 지혜에 귀 기울이세요.'
    };
  }

  // 계절별 이미지 생성 메서드 (공통 템플릿 사용)
  async generateSeasonalImage(theme, pageType) {
    await this.initialize();

    try {
      // 공통 템플릿 사용
      const templatePath = path.join(this.templatesDir, 'daily-fortune-common.html');
      let htmlContent = await fs.readFile(templatePath, 'utf8');

      // 계절별 템플릿 데이터 생성
      const templateData = this.generateSeasonalTemplateData(theme, pageType);

      // 템플릿 변수 치환
      htmlContent = this.replaceTemplateVariables(htmlContent, templateData);

      // UUID 기반 파일명 생성
      const filename = `${uuidv4()}.png`;

      return await this.generateImage(htmlContent, filename, pageType);

    } catch (error) {
      throw error;
    }
  }

  // 통합 이미지 생성
  async generateConsolidatedImage(templateData, templateName, imageType) {
    await this.initialize();

    try {
      const templatePath = path.join(this.templatesDir, `${templateName}.html`);
      let htmlContent = await fs.readFile(templatePath, 'utf8');

      // 템플릿 변수 치환
      htmlContent = this.replaceTemplateVariables(htmlContent, templateData);

      // UUID 기반 파일명 생성
      const filename = `${uuidv4()}.png`;

      return await this.generateImage(htmlContent, filename, imageType);

    } catch (error) {
      throw error;
    }
  }

  // 운세 캐러셀 이미지 세트 생성 (썸네일, 내용, 브랜딩) - 기존 기능 유지
  async generateFortuneImageSet(fortuneData, sharedBrandingUrl = null) {
    try {
      // 브랜딩 이미지가 이미 생성되었다면 재사용, 아니라면 생성
      const brandingPromise = sharedBrandingUrl
        ? Promise.resolve({ success: true, publicUrl: sharedBrandingUrl })
        : this.generateBrandingImage();

      const results = await Promise.all([
        this.generateThumbnailImage(fortuneData),
        this.generateContentImage(fortuneData),
        brandingPromise
      ]);

      return {
        success: true,
        images: {
          thumbnail: results[0],
          content: results[1],
          branding: results[2]
        },
        imageUrls: results.map(result => result.publicUrl),
        brandingUrl: results[2].publicUrl // 다음 별자리에서 재사용하기 위해
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // 브라우저 정리
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  // 프로세스 종료 시 브라우저 정리
  setupGracefulShutdown() {
    process.on('SIGINT', async () => {
      await this.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.close();
      process.exit(0);
    });
  }
}

module.exports = ImageService;