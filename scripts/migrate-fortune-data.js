const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * 기존 운세 데이터를 새로운 통합 시스템으로 마이그레이션
 */
async function migrateFortunes() {

  try {
    // 1. 기본 템플릿들 생성
    await createDefaultTemplates();

    // 2. 12월 운세 데이터 마이그레이션
    await migrateDecemberFortunes();

    // 3. 2026년 신년 운세 데이터 마이그레이션
    await migrateNewYearFortunes2026();


    // 4. 통계 정보 출력
    await printMigrationStats();

  } catch (error) {
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * 기본 템플릿들 생성
 */
async function createDefaultTemplates() {

  // 12월 운세 템플릿
  const decemberTemplate = await prisma.fortuneTemplate.upsert({
    where: { templateKey: 'december-fortune' },
    update: {},
    create: {
      templateKey: 'december-fortune',
      title: '12월 운세',
      description: '12월의 운세를 타로카드로 확인해보세요',
      category: 'monthly',
      characterInfo: {
        name: '돌핀',
        imageSrc: '/images/characters/dollfin/dollfin.jpg'
      },
      messageScenario: [
        { text: "12월의 운세를 봐줄거래!", sender: "bot" },
        { text: "바로 카드를 뽑아보고래!", sender: "bot", showCardSelect: true }
      ],
      cardConfig: {
        cardNumbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], // 0-10번 카드
        cardSelectCount: 3,
        cardBackImage: '/images/cardback.jpg'
      },
      theme: {
        primaryColor: '#4F46E5',
        secondaryColor: '#7C3AED',
        backgroundGradient: 'from-blue-50 to-purple-50'
      },
      images: {
        background: '/images/december-bg.jpg',
        cardBack: '/images/cardback.jpg'
      },
      isPremium: false,
      sortOrder: 1
    }
  });

  // 2026년 신년 운세 템플릿
  const newYearTemplate = await prisma.fortuneTemplate.upsert({
    where: { templateKey: 'newyear-2026' },
    update: {},
    create: {
      templateKey: 'newyear-2026',
      title: '2026년 신년운세',
      description: '2026년 상반기 운세를 확인해보세요',
      category: 'yearly',
      characterInfo: {
        name: '돌핀',
        imageSrc: '/images/characters/dollfin/dollfin.jpg'
      },
      messageScenario: [
        { text: "2026년 상반기 운세를 봐줄거래!", sender: "bot" },
        { text: "새로운 한 해니까 더욱 특별한 운세가 기다리고 있을거래!", sender: "bot" },
        { text: "바로 카드를 뽑아보고래!", sender: "bot", showCardSelect: true }
      ],
      cardConfig: {
        cardNumbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], // 0-21번 모든 카드
        cardSelectCount: 3,
        cardBackImage: '/images/cardback.jpg'
      },
      theme: {
        primaryColor: '#DC2626',
        secondaryColor: '#EA580C',
        backgroundGradient: 'from-red-50 to-orange-50'
      },
      images: {
        background: '/images/newyear-bg.jpg',
        cardBack: '/images/cardback.jpg'
      },
      isPremium: false,
      sortOrder: 2
    }
  });

}

/**
 * 12월 운세 데이터 마이그레이션
 */
async function migrateDecemberFortunes() {

  // 12월 운세 템플릿 조회
  const template = await prisma.fortuneTemplate.findUnique({
    where: { templateKey: 'december-fortune' }
  });

  if (!template) {
    throw new Error('12월 운세 템플릿을 찾을 수 없습니다.');
  }

  // 기존 12월 운세 데이터 조회
  const decemberFortunes = await prisma.decemberFortune.findMany({
    orderBy: { createdAt: 'asc' }
  });


  let migratedCount = 0;
  for (const fortune of decemberFortunes) {
    try {
      await prisma.fortuneSession.create({
        data: {
          templateId: template.id,
          userId: fortune.userId,
          selectedCard: fortune.selectedCard,
          fortuneData: fortune.fortuneData,
          sessionMetadata: {
            fortuneType: fortune.fortuneType,
            originalId: fortune.id,
            migratedFrom: 'december_fortunes'
          },
          isPremium: fortune.isPaid || false,
          isPaid: fortune.isPaid || false,
          paymentId: fortune.paymentId,
          createdAt: fortune.createdAt,
          updatedAt: fortune.updatedAt
        }
      });
      migratedCount++;
    } catch (error) {
    }
  }

}

/**
 * 2026년 신년 운세 데이터 마이그레이션
 */
async function migrateNewYearFortunes2026() {

  // 신년 운세 템플릿 조회
  const template = await prisma.fortuneTemplate.findUnique({
    where: { templateKey: 'newyear-2026' }
  });

  if (!template) {
    throw new Error('2026년 신년 운세 템플릿을 찾을 수 없습니다.');
  }

  // 기존 신년 운세 데이터 조회
  const newYearFortunes = await prisma.newYearFortune2026.findMany({
    orderBy: { createdAt: 'asc' }
  });


  let migratedCount = 0;
  for (const fortune of newYearFortunes) {
    try {
      await prisma.fortuneSession.create({
        data: {
          templateId: template.id,
          userId: fortune.userId,
          selectedCard: fortune.selectedCard,
          fortuneData: fortune.fortuneData,
          sessionMetadata: {
            fortuneType: fortune.fortuneType,
            year: fortune.year,
            period: fortune.period,
            originalId: fortune.id,
            migratedFrom: 'newyear_fortunes_2026'
          },
          isPremium: fortune.isPaid || false,
          isPaid: fortune.isPaid || false,
          paymentId: fortune.paymentId,
          createdAt: fortune.createdAt,
          updatedAt: fortune.updatedAt
        }
      });
      migratedCount++;
    } catch (error) {
    }
  }

}

/**
 * 마이그레이션 통계 정보 출력
 */
async function printMigrationStats() {

  // 템플릿 개수
  const templateCount = await prisma.fortuneTemplate.count();

  // 세션 개수 (템플릿별)
  const sessionsByTemplate = await prisma.fortuneSession.groupBy({
    by: ['templateId'],
    _count: true
  });

  for (const group of sessionsByTemplate) {
    const template = await prisma.fortuneTemplate.findUnique({
      where: { id: group.templateId },
      select: { title: true }
    });
  }

  // 총 세션 수
  const totalSessions = await prisma.fortuneSession.count();

  // 사용자별 세션 수
  const sessionsWithUsers = await prisma.fortuneSession.count({
    where: { userId: { not: null } }
  });
}

// 스크립트 실행
if (require.main === module) {
  migrateFortunes()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      process.exit(1);
    });
}

module.exports = { migrateFortunes };