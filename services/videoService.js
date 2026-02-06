const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../lib/prisma');

class VideoService {
  constructor() {
    this.browser = null;
    this.templatesDir = path.join(__dirname, '../templates');
    this.outputDir = path.join(__dirname, '../uploads/videos');
    this.imagesDir = path.join(__dirname, '../uploads/images');
    this.dataDir = path.join(__dirname, '../data');

    // Supabase client 초기화
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    }

    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
    this.bucket = process.env.SUPABASE_BUCKET || 'taroti';


    // Prisma client 초기화
    this.prisma = new PrismaClient();

    // 영상 타입별 설정
    this.videoTypeOptions = {
      'weekly-fortune': {
        label: '주간 운세'
      },
      'true-feelings': {
        label: '그 사람의 속마음은?'
      }
    };

    // 기본 카드명 매핑
    this.cardNames = {
      0: '바보', 1: '마법사', 2: '여사제', 3: '여황제', 4: '황제',
      5: '교황', 6: '연인', 7: '전차', 8: '힘', 9: '은둔자',
      10: '운명의 수레바퀴', 11: '정의', 12: '매달린 사람', 13: '죽음', 14: '절제',
      15: '악마', 16: '탑', 17: '별', 18: '달', 19: '태양', 20: '심판', 21: '세계'
    };

    // 영상 타입별 설정
    this.videoTypes = {
      'weekly-fortune': {
        jsonFile: 'weeklyFortune.json',
        titleGenerator: this.generateWeeklyTitle.bind(this),
        contentKey: 'weeklyFortune',
        ctaTitle: '⭐ 매주 업로드되는 주간 운세',
        ctaMessage: '팔로우 하고, 매주 월요일,<br />운세를 받아보세요!',
        footerText: '매주 업데이트'
      },
      'true-feelings': {
        jsonFile: 'trueFeelings.json',
        titleGenerator: () => '그 사람의 속마음은?',
        contentKey: 'trueFeelings',
        ctaTitle: '💕 매일 업로드되는 속마음 타로',
        ctaMessage: '팔로우 하고, 매일,<br />궁금한 마음을 확인하세요!',
        footerText: '매일 업데이트'
      }
    };
  }

  // 릴스용 캡션 생성 함수
  generateReelsCaption(videoType, cardNumbers, cardContent) {

    const typeLabel = this.videoTypeOptions[videoType]?.label || videoType;

    // 카드 해석 정보 추출 및 포맷팅
    let cardInterpretationsText = '';

    if (cardContent && cardContent.cards && Array.isArray(cardNumbers)) {
      cardInterpretationsText = cardNumbers.map((cardNumber, index) => {
        const card = cardContent.cards.find(c => c.cardNumber === cardNumber);
        if (!card) {
          const cardName = this.cardNames[cardNumber] || `${cardNumber}번 카드`;
          return `${index + 1}번 : ${cardName}
카드 해석을 찾을 수 없습니다.`;
        }

        let interpretation = '';
        const cardName = card.koreanName || this.cardNames[cardNumber] || `${cardNumber}번 카드`;

        // 영상 종류에 따른 해석 내용 선택
        if (videoType === 'weekly-fortune' && card.weeklyFortune) {
          interpretation = card.weeklyFortune.overall;
        } else if (videoType === 'true-feelings' && card.trueFeelings) {
          interpretation = card.trueFeelings.feeling;
        } else if (card.overall) {
          interpretation = card.overall;
        } else {
          interpretation = '이 카드의 의미를 영상에서 확인해보세요!';
        }

        return `${index + 1}번 : ${cardName}
${interpretation}`;
      }).join('\n\n');
    } else {
      // 카드 데이터가 없으면 기본 구조만 생성
      cardInterpretationsText = cardNumbers.map((cardNumber, index) => {
        const cardName = this.cardNames[cardNumber] || `${cardNumber}번 카드`;
        return `${index + 1}번 : ${cardName}
카드 해석 데이터를 로드하지 못했습니다.`;
      }).join('\n\n');
    }

    const cardsText = Array.isArray(cardNumbers) ?
      `📋 선택된 카드: ${cardNumbers.join(', ')}번` : '';

    // 영상 종류에 따른 타이틀 및 설명 조정
    const contentTitle = videoType === 'weekly-fortune' ? '이번 주 운세' :
                        videoType === 'true-feelings' ? '그 사람의 속마음' : '운세 해석';

    const finalCaption = `✨ ${typeLabel} ✨

${cardsText ? `${cardsText}\n\n` : ''}${cardInterpretationsText ? `🔮 ${contentTitle}:\n\n${cardInterpretationsText}\n\n` : ''}타로 카드로 보는 운세를 확인해보세요!

🌟 매주 새로운 운세가 업데이트됩니다
💫 당신만을 위한 특별한 메시지

#타로 #운세 #타로카드 #점술`;

    return finalCaption;
  }

  async initialize() {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--allow-running-insecure-content'
        ]
      });
    }

    // 출력 디렉토리 생성
    try {
      await fs.access(this.outputDir);
    } catch {
      await fs.mkdir(this.outputDir, { recursive: true });
    }

    // 이미지 디렉토리 생성
    try {
      await fs.access(this.imagesDir);
    } catch {
      await fs.mkdir(this.imagesDir, { recursive: true });
    }
  }

  // 타로 카드 이미지 경로 가져오기 (ImageService와 동일)
  getCardImagePath(cardNumber) {
    const cardNames = [
      'TheFool', 'TheMagician', 'TheHighPriestess', 'TheEmpress',
      'TheEmperor', 'TheHierophant', 'TheLovers', 'TheChariot',
      'Strength', 'TheHermit', 'WheelOfFortune', 'Justice',
      'TheHangedMan', 'Death', 'Temperance', 'TheDevil',
      'TheTower', 'TheStar', 'TheMoon', 'TheSun',
      'Judgement', 'TheWorld'
    ];

    if (cardNumber >= 0 && cardNumber < cardNames.length) {
      const paddedNumber = String(cardNumber).padStart(2, '0');
      return `http://localhost:5002/public/images/cards/${paddedNumber}-${cardNames[cardNumber]}.jpg`;
    }

    return `http://localhost:5002/public/images/cards/00-TheFool.jpg`;
  }

  // 4개의 랜덤 카드 선택 (중복 없이)
  getRandomCards() {
    const cardNumbers = Array.from({length: 22}, (_, i) => i); // 0~21
    const selectedCards = [];

    for (let i = 0; i < 4; i++) {
      const randomIndex = Math.floor(Math.random() * cardNumbers.length);
      selectedCards.push(cardNumbers.splice(randomIndex, 1)[0]);
    }

    return selectedCards;
  }

  // HTML 템플릿에 데이터 바인딩
  replaceTemplateVariables(htmlContent, data) {
    let result = htmlContent;

    Object.keys(data).forEach(key => {
      const placeholder = `{{${key}}}`;
      const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      result = result.replace(regex, data[key] || '');
    });

    return result;
  }

  // 주간 운세 제목 생성 (다음 주 월요일~일요일)
  generateWeeklyTitle() {
    const today = new Date();
    const currentDay = today.getDay();

    // 다음 주 월요일 계산 (0: 일요일, 1: 월요일, ...)
    const daysToNextMonday = currentDay === 0 ? 1 : 8 - currentDay;
    const nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + daysToNextMonday);

    // 다음 주 일요일
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);

    // 포맷팅: "12월 15일(월) ~ 12월 21일(일)"
    const formatDate = (date) => {
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const weekDays = ['일', '월', '화', '수', '목', '금', '토'];
      const weekDay = weekDays[date.getDay()];
      return `${month}월 ${day}일(${weekDay})`;
    };

    const dateRange = `${formatDate(nextMonday)} ~ ${formatDate(nextSunday)}`;
    return `타로 주간 운세\n${dateRange}`;
  }

  // JSON 파일에서 카드 콘텐츠 가져오기
  async getCardContent(videoType, cardNumbers) {
    const typeConfig = this.videoTypes[videoType];
    if (!typeConfig) {
      throw new Error(`Unknown video type: ${videoType}`);
    }

    const jsonPath = path.join(this.dataDir, typeConfig.jsonFile);
    const jsonContent = await fs.readFile(jsonPath, 'utf8');
    const data = JSON.parse(jsonContent);

    const cardContents = cardNumbers.map(cardNum => {
      const card = data.cards[cardNum.toString()];
      if (!card) {
        return null;
      }
      return {
        number: cardNum,
        name: card.name,
        koreanName: card.koreanName,
        content: card[typeConfig.contentKey]
      };
    }).filter(Boolean);

    return {
      title: data.title,
      description: data.description,
      cards: cardContents
    };
  }

  // 카드별 설명 이미지 생성
  async generateCardDescriptionImages(videoType, cardNumbers, cardContent, title) {
    const typeConfig = this.videoTypes[videoType];
    const generatedImages = [];

    for (let i = 0; i < cardNumbers.length; i++) {
      const card = cardContent.cards[i];
      if (!card) continue;

      const cardNumber = cardNumbers[i];
      const imageFilename = `${uuidv4()}-card-${i + 1}.png`;

      // 키워드 HTML 생성
      const keywords = card.content.keywords || [];
      const keywordsHtml = keywords.map(keyword =>
        `<div class="keyword">#${keyword}</div>`
      ).join('');

      // 템플릿 데이터 준비
      const templateData = {
        CONTENT_TYPE: cardContent.title,
        CARD_INDEX: i + 1,
        CARD_IMAGE: this.getCardImagePath(cardNumber),
        CARD_NAME: card.name,
        CARD_KOREAN_NAME: card.koreanName,
        MAIN_DESCRIPTION_TITLE: this.getMainDescriptionTitle(videoType),
        MAIN_DESCRIPTION: this.getMainDescription(card.content, videoType),
        ADVICE_TEXT: this.getAdviceText(card.content, videoType),
        KEYWORDS_HTML: keywordsHtml
      };

      // HTML 템플릿 로드 및 바인딩
      const templatePath = path.join(this.templatesDir, 'card-description.html');
      let htmlContent = await fs.readFile(templatePath, 'utf8');
      htmlContent = this.replaceTemplateVariables(htmlContent, templateData);

      // 이미지 생성
      const context = await this.browser.newContext();
      const page = await context.newPage();
      await page.setViewportSize({ width: 1080, height: 1350 });
      await page.goto(`data:text/html,${encodeURIComponent(htmlContent)}`, {
        waitUntil: 'networkidle'
      });

      // 2초 대기 (폰트 로딩 및 애니메이션)
      await page.waitForTimeout(2000);

      // 스크린샷 생성
      const imagePath = path.join(this.imagesDir, imageFilename);
      await page.screenshot({
        path: imagePath,
        fullPage: true
      });

      await context.close();

      // 이미지 파일이 정상 생성되었는지 확인
      try {
        const stats = await fs.stat(imagePath);

        if (stats.size === 0) {
          throw new Error(`빈 이미지 파일 생성됨: ${imageFilename}`);
        }
      } catch (statError) {
        throw new Error(`이미지 파일 확인 실패: ${statError.message}`);
      }

      // Supabase에 이미지 업로드
      const imageBuffer = await fs.readFile(imagePath);
      const storagePath = `images/${imageFilename}`;

      let uploadResult;
      try {
        uploadResult = await this.supabase.storage
          .from(this.bucket)
          .upload(storagePath, imageBuffer, {
            contentType: 'image/png',
            cacheControl: '3600',
            upsert: false
          });
      } catch (uploadError) {
        throw new Error(`카드 ${i + 1} 이미지 업로드 중 예외 발생: ${uploadError.message}`);
      }

      if (uploadResult.error) {
        throw new Error(`카드 ${i + 1} 이미지 업로드 실패: ${JSON.stringify(uploadResult.error)}`);
      }

      // 공개 URL 생성
      const { data: publicUrlData } = this.supabase.storage
        .from(this.bucket)
        .getPublicUrl(storagePath);

      generatedImages.push({
        type: 'card-description',
        cardIndex: i + 1,
        cardNumber: cardNumber,
        cardName: card.koreanName,
        filename: imageFilename,
        publicUrl: publicUrlData.publicUrl,
        storagePath: storagePath
      });

      // 임시 파일 정리
      await fs.unlink(imagePath);
    }

    return generatedImages;
  }

  // 마무리 페이지 이미지 생성
  async generateEndingImage(videoType, cardNumbers, cardContent, title) {
    const typeConfig = this.videoTypes[videoType];
    const imageFilename = `${uuidv4()}-ending.png`;

    // 선택된 카드들 HTML 생성
    const selectedCardsHtml = cardNumbers.map((cardNum, index) => {
      const card = cardContent.cards[index];
      return `<div class="card-item">${index + 1}. ${card?.koreanName || '알 수 없음'}</div>`;
    }).join('');

    // 템플릿 데이터 준비
    const templateData = {
      CONTENT_TYPE: cardContent.title,
      SELECTED_CARDS_HTML: selectedCardsHtml,
      CTA_TITLE: typeConfig.ctaTitle,
      CTA_MESSAGE: typeConfig.ctaMessage,
      FOOTER_TEXT: typeConfig.footerText
    };

    // HTML 템플릿 로드 및 바인딩
    const templatePath = path.join(this.templatesDir, 'card-series-ending.html');
    let htmlContent = await fs.readFile(templatePath, 'utf8');
    htmlContent = this.replaceTemplateVariables(htmlContent, templateData);

    // 이미지 생성
    const context = await this.browser.newContext();
    const page = await context.newPage();
    await page.setViewportSize({ width: 1080, height: 1350 });
    await page.goto(`data:text/html,${encodeURIComponent(htmlContent)}`, {
      waitUntil: 'networkidle'
    });

    // 2초 대기 (폰트 로딩 및 애니메이션)
    await page.waitForTimeout(2000);

    // 스크린샷 생성
    const imagePath = path.join(this.imagesDir, imageFilename);
    await page.screenshot({
      path: imagePath,
      fullPage: true
    });

    await context.close();

    // 이미지 파일이 정상 생성되었는지 확인
    try {
      const stats = await fs.stat(imagePath);

      if (stats.size === 0) {
        throw new Error(`빈 마무리 이미지 파일 생성됨: ${imageFilename}`);
      }
    } catch (statError) {
      throw new Error(`마무리 이미지 파일 확인 실패: ${statError.message}`);
    }

    // Supabase에 이미지 업로드
    const imageBuffer = await fs.readFile(imagePath);
    const storagePath = `images/${imageFilename}`;

    let uploadResult;
    try {
      uploadResult = await this.supabase.storage
        .from(this.bucket)
        .upload(storagePath, imageBuffer, {
          contentType: 'image/png',
          cacheControl: '3600',
          upsert: false
        });
    } catch (uploadError) {
      throw new Error(`마무리 이미지 업로드 중 예외 발생: ${uploadError.message}`);
    }

    if (uploadResult.error) {
      throw new Error(`마무리 이미지 업로드 실패: ${JSON.stringify(uploadResult.error)}`);
    }

    // 공개 URL 생성
    const { data: publicUrlData } = this.supabase.storage
      .from(this.bucket)
      .getPublicUrl(storagePath);

    // 임시 파일 정리
    await fs.unlink(imagePath);

    return {
      type: 'ending',
      filename: imageFilename,
      publicUrl: publicUrlData.publicUrl,
      storagePath: storagePath
    };
  }

  // 비디오 타입별 메인 설명 제목 반환
  getMainDescriptionTitle(videoType) {
    const titles = {
      'weekly-fortune': '📅 이번 주 운세',
      'true-feelings': '💭 속마음'
    };
    return titles[videoType] || '설명';
  }

  // 비디오 타입별 메인 설명 내용 반환
  getMainDescription(cardContent, videoType) {
    if (videoType === 'weekly-fortune') {
      return cardContent.overall;
    } else if (videoType === 'true-feelings') {
      return cardContent.feeling;
    }
    return '';
  }

  // 비디오 타입별 조언 텍스트 반환
  getAdviceText(cardContent, videoType) {
    return cardContent.advice || '';
  }

  // 카드 뒤집기 애니메이션 영상 생성
  async generateCardFlipVideo(videoType = 'weekly-fortune', customTitle = null) {
    await this.initialize();

    let context = null;
    let page = null;

    try {
      // 영상 타입 설정 가져오기
      const typeConfig = this.videoTypes[videoType];
      if (!typeConfig) {
        throw new Error(`Unknown video type: ${videoType}`);
      }

      // 제목 생성 (커스텀 제목이 없으면 자동 생성)
      const title = customTitle || typeConfig.titleGenerator();

      // 랜덤 카드 4개 선택
      const cardNumbers = this.getRandomCards();

      // JSON에서 카드 콘텐츠 가져오기
      const cardContent = await this.getCardContent(videoType, cardNumbers);

      // 템플릿 데이터 준비
      const templateData = {
        TITLE: title,
        CARD1_NUMBER: cardNumbers[0],
        CARD2_NUMBER: cardNumbers[1],
        CARD3_NUMBER: cardNumbers[2],
        CARD4_NUMBER: cardNumbers[3],
        CARD1_IMAGE: this.getCardImagePath(cardNumbers[0]),
        CARD2_IMAGE: this.getCardImagePath(cardNumbers[1]),
        CARD3_IMAGE: this.getCardImagePath(cardNumbers[2]),
        CARD4_IMAGE: this.getCardImagePath(cardNumbers[3]),
        // 카드별 콘텐츠 추가
        CARD1_NAME: cardContent.cards[0]?.koreanName || '',
        CARD2_NAME: cardContent.cards[1]?.koreanName || '',
        CARD3_NAME: cardContent.cards[2]?.koreanName || '',
        CARD4_NAME: cardContent.cards[3]?.koreanName || '',
        // 영상 타입별 추가 데이터
        VIDEO_TYPE: videoType,
        CONTENT_TITLE: cardContent.title,
        CONTENT_DESC: cardContent.description
      };

      // HTML 템플릿 로드 및 바인딩
      const templatePath = path.join(this.templatesDir, 'card-flip-animation.html');
      let htmlContent = await fs.readFile(templatePath, 'utf8');
      htmlContent = this.replaceTemplateVariables(htmlContent, templateData);

      // 임시 파일명 생성
      const videoFilename = `${uuidv4()}.webm`;

      // Playwright의 영상 녹화 설정 (인스타그램 게시물 4:5 비율)
      context = await this.browser.newContext({
        recordVideo: {
          dir: this.outputDir,
          size: { width: 1080, height: 1350 }
        }
      });

      page = await context.newPage();
      await page.setViewportSize({
        width: 1080,
        height: 1350
      });

      await page.goto(`data:text/html,${encodeURIComponent(htmlContent)}`, {
        waitUntil: 'networkidle'
      });

      // 페이지 완전 로딩 및 스타일 적용을 위한 추가 대기
      await page.waitForTimeout(1000);

      // 배경 이미지와 모든 콘텐츠가 로딩될 때까지 대기
      await page.waitForFunction(() => {
        const body = document.body;
        const computedStyle = window.getComputedStyle(body);
        return computedStyle.backgroundImage !== 'none';
      }, {}, { timeout: 5000 }).catch(() => {
        // 배경 이미지 로딩 대기 시간 초과 무시
      });

      // 애니메이션 시작
      await page.evaluate(() => {
        if (typeof window.startCardFlipAnimation === 'function') {
          window.startCardFlipAnimation();
        }
      });

      // 7초 대기 (카드 뒷면 표시 + 카드 애니메이션 + 엔딩 메시지 완료까지)
      await page.waitForTimeout(7000);

      // 페이지 닫기로 녹화 종료
      await page.close();
      await context.close();

      // 녹화된 파일 찾기 (가장 최근 생성된 webm 파일)
      const files = await fs.readdir(this.outputDir);
      const videoFiles = files.filter(file => file.endsWith('.webm'));
      const latestVideo = videoFiles
        .map(file => ({
          name: file,
          path: path.join(this.outputDir, file),
          time: require('fs').statSync(path.join(this.outputDir, file)).mtime
        }))
        .sort((a, b) => b.time - a.time)[0];

      if (!latestVideo) {
        throw new Error('녹화된 영상 파일을 찾을 수 없습니다');
      }

      const recordingPath = latestVideo.path;
      const tempVideoPath = path.join(this.outputDir, videoFilename);

      // 녹화된 파일을 지정된 위치로 복사
      await fs.copyFile(recordingPath, tempVideoPath);

      // Supabase 업로드
      const videoBuffer = await fs.readFile(tempVideoPath);
      const filePath = `videos/${videoFilename}`;


      const uploadResult = await this.supabase.storage
        .from(this.bucket)
        .upload(filePath, videoBuffer, {
          contentType: 'video/webm',
          cacheControl: '3600',
          upsert: false
        });

      if (uploadResult.error) {
        throw new Error(`Supabase 업로드 실패: ${uploadResult.error.message}`);
      }

      // 공개 URL 생성
      const { data: publicUrlData } = this.supabase.storage
        .from(this.bucket)
        .getPublicUrl(filePath);

      // 임시 파일 정리
      try {
        await fs.unlink(tempVideoPath);
        // recordingPath는 Playwright가 자동 관리하므로 별도 삭제하지 않음
        if (recordingPath !== tempVideoPath) {
          await fs.unlink(recordingPath);
        }
      } catch (error) {
        // 임시 파일 삭제 실패는 무시
      }

      // 캐러셀용 7페이지 이미지 생성 (카드 뒷면 1개 + 카드 앞면 1개 + 카드 설명 4개 + 마무리 1개)
      const carouselImages = await this.generateCarouselImages(videoType, cardNumbers, cardContent, title);

      const allImages = carouselImages;

      // 릴스 캡션 생성
      const reelsCaption = this.generateReelsCaption(videoType, cardNumbers, cardContent);

      // 데이터베이스에 영상 정보 저장
      try {
        const savedVideo = await this.prisma.generatedVideo.create({
          data: {
            title: title,
            filename: videoFilename,
            publicUrl: publicUrlData.publicUrl,
            storagePath: uploadResult.data.path,
            duration: 7000,
            videoType: videoType,
            selectedCards: cardNumbers,
            reelsCaption: reelsCaption, // 생성된 릴스 캡션 저장
            metadata: {
              resolution: { width: 1080, height: 1350 },
              format: 'webm',
              thumbnailIntro: true,
              endingMessage: true,
              cardContent: cardContent,
              generatedImages: allImages
            }
          }
        });

        // 생성된 이미지들을 데이터베이스에 저장
        for (const imageData of allImages) {
          try {
            await this.prisma.generatedImage.create({
              data: {
                filename: imageData.filename,
                publicUrl: imageData.publicUrl,
                storagePath: imageData.storagePath,
                imageType: imageData.type,
                cardIndex: imageData.cardIndex || null,
                cardNumber: imageData.cardNumber || null,
                cardName: imageData.cardName || null,
                order: imageData.order || null,
                videoId: savedVideo.id
              }
            });
          } catch (imageDbError) {
            // 이미지 DB 저장 실패는 무시
          }
        }

      } catch (dbError) {
        // 데이터베이스 저장 실패는 무시 (영상은 정상 생성됨)
      }

      return {
        success: true,
        filename: videoFilename,
        publicUrl: publicUrlData.publicUrl,
        path: uploadResult.data.path,
        duration: 7000,
        cards: cardNumbers,
        videoType: videoType,
        cardContent: cardContent,
        generatedImages: allImages,
        message: `카드 뒤집기 영상과 ${allImages.length}개의 추가 이미지가 성공적으로 생성되었습니다`
      };

    } catch (error) {
      throw error;
    } finally {
      // 페이지와 컨텍스트 정리
      if (page) {
        await page.close();
      }
      if (context) {
        await context.close();
      }
    }
  }

  // 브라우저 정리
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    // Prisma client 정리
    await this.prisma.$disconnect();
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

  // 캐러셀용 7페이지 이미지 생성 (카드 뒷면 1개 + 카드 앞면 1개 + 카드 해설 4개 + 마무리 1개)
  async generateCarouselImages(videoType, cardNumbers, cardContent, title) {
    const carouselImages = [];

    try {
      // 1. 카드 뒷면 이미지 생성 (첫 번째 카드 기준)
      const backImage = await this.generateCardBackImage(1, title);
      if (backImage) {
        carouselImages.push({
          ...backImage,
          type: 'carousel-card-back',
          order: 1
        });
      }

      // 2. 카드 앞면 이미지 생성 (4장 카드)
      const frontImage = await this.generateCardFrontImage(cardNumbers, cardContent, title);
      if (frontImage) {
        carouselImages.push({
          ...frontImage,
          type: 'carousel-card-front',
          order: 2
        });
      }

      // 3. 카드 해설 4개 이미지 생성 (기존 함수 재사용)
      const cardDescImages = await this.generateCardDescriptionImages(videoType, cardNumbers, cardContent, title);
      cardDescImages.forEach((img, index) => {
        carouselImages.push({
          ...img,
          type: 'carousel-description',
          order: 3 + index
        });
      });

      // 4. 마무리 이미지 생성 (기존 함수 재사용)
      const endingImage = await this.generateEndingImage(videoType, cardNumbers, cardContent, title);
      if (endingImage) {
        carouselImages.push({
          ...endingImage,
          type: 'carousel-ending',
          order: 7
        });
      }

      return carouselImages;

    } catch (error) {
      return [];
    }
  }

  // 카드 뒷면 이미지 생성
  async generateCardBackImage(cardIndex, title) {
    try {
      const templateData = {
        TITLE: title
      };

      const templatePath = path.join(this.templatesDir, 'card-back.html');
      let htmlContent = await fs.readFile(templatePath, 'utf8');
      htmlContent = this.replaceTemplateVariables(htmlContent, templateData);

      // 이미지 생성
      const context = await this.browser.newContext();
      const page = await context.newPage();

      await page.setViewportSize({
        width: 1080,
        height: 1350
      });

      await page.setContent(htmlContent, { waitUntil: 'networkidle' });

      // 이미지와 폰트 로딩을 위해 추가 대기
      await page.waitForTimeout(3000);

      const filename = `${uuidv4()}-cards-back.png`;
      const filepath = path.join(this.outputDir, filename);

      await page.screenshot({
        path: filepath,
        fullPage: true
      });

      await page.close();
      await context.close();

      // Supabase 업로드
      const imageBuffer = await fs.readFile(filepath);
      const storagePath = `images/${filename}`;

      const uploadResult = await this.supabase.storage
        .from(this.bucket)
        .upload(storagePath, imageBuffer, {
          contentType: 'image/png',
          cacheControl: '3600',
          upsert: false
        });

      if (uploadResult.error) {
        throw new Error(`Supabase 업로드 실패: ${uploadResult.error.message}`);
      }

      const { data: publicUrlData } = this.supabase.storage
        .from(this.bucket)
        .getPublicUrl(storagePath);

      // 임시 파일 정리
      await fs.unlink(filepath);


      return {
        filename,
        publicUrl: publicUrlData.publicUrl,
        storagePath: uploadResult.data.path
      };

    } catch (error) {
      return null;
    }
  }

  // 카드 앞면 이미지 생성
  async generateCardFrontImage(cardNumbers, cardContent, title) {
    try {
      const templateData = {
        TITLE: title,
        CARD1_IMAGE: this.getCardImagePath(cardNumbers[0]),
        CARD1_KOREAN_NAME: cardContent.cards[0]?.koreanName || '',
        CARD2_IMAGE: this.getCardImagePath(cardNumbers[1]),
        CARD2_KOREAN_NAME: cardContent.cards[1]?.koreanName || '',
        CARD3_IMAGE: this.getCardImagePath(cardNumbers[2]),
        CARD3_KOREAN_NAME: cardContent.cards[2]?.koreanName || '',
        CARD4_IMAGE: this.getCardImagePath(cardNumbers[3]),
        CARD4_KOREAN_NAME: cardContent.cards[3]?.koreanName || ''
      };

      const templatePath = path.join(this.templatesDir, 'card-front.html');
      let htmlContent = await fs.readFile(templatePath, 'utf8');
      htmlContent = this.replaceTemplateVariables(htmlContent, templateData);

      // 이미지 생성
      const context = await this.browser.newContext();
      const page = await context.newPage();

      await page.setViewportSize({
        width: 1080,
        height: 1350
      });

      await page.setContent(htmlContent, { waitUntil: 'networkidle' });

      // 이미지와 폰트 로딩을 위해 추가 대기
      await page.waitForTimeout(3000);

      const filename = `${uuidv4()}-cards-front.png`;
      const filepath = path.join(this.outputDir, filename);

      await page.screenshot({
        path: filepath,
        fullPage: true
      });

      await page.close();
      await context.close();

      // Supabase 업로드
      const imageBuffer = await fs.readFile(filepath);
      const storagePath = `images/${filename}`;

      const uploadResult = await this.supabase.storage
        .from(this.bucket)
        .upload(storagePath, imageBuffer, {
          contentType: 'image/png',
          cacheControl: '3600',
          upsert: false
        });

      if (uploadResult.error) {
        throw new Error(`Supabase 업로드 실패: ${uploadResult.error.message}`);
      }

      const { data: publicUrlData } = this.supabase.storage
        .from(this.bucket)
        .getPublicUrl(storagePath);

      // 임시 파일 정리
      await fs.unlink(filepath);


      return {
        filename,
        publicUrl: publicUrlData.publicUrl,
        storagePath: uploadResult.data.path
      };

    } catch (error) {
      return null;
    }
  }
}

module.exports = VideoService;