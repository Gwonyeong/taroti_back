/**
 * 테스트용 운세 세션 데이터 생성 스크립트
 * 사용법: node scripts/seed-test-sessions.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const USER_ID = 32;

async function main() {
  console.log(`\n🎴 userId ${USER_ID}에 대한 테스트 운세 세션 생성 시작...\n`);

  // 1. 활성화된 템플릿 조회
  const templates = await prisma.fortuneTemplate.findMany({
    where: { isActive: true },
    select: { id: true, templateKey: true, title: true }
  });

  if (templates.length === 0) {
    console.log('❌ 활성화된 운세 템플릿이 없습니다.');
    return;
  }

  console.log(`📋 활성화된 템플릿: ${templates.map(t => t.title).join(', ')}\n`);

  // 2. 테스트 날짜 생성 (최근 30일 중 랜덤 10일)
  const today = new Date();
  const testDates = [];

  // 최근 30일 중에서 랜덤하게 날짜 선택
  const usedDays = new Set();
  while (testDates.length < 10) {
    const daysAgo = Math.floor(Math.random() * 30);
    if (!usedDays.has(daysAgo)) {
      usedDays.add(daysAgo);
      const date = new Date(today);
      date.setDate(date.getDate() - daysAgo);
      // UTC 기준으로 저장 (한국시간 -9시간)
      date.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), 0, 0);
      testDates.push(date);
    }
  }

  // 날짜순 정렬
  testDates.sort((a, b) => a - b);

  // 3. 세션 데이터 생성
  const sessionsToCreate = testDates.map((date, index) => {
    const template = templates[index % templates.length];
    const selectedCard = Math.floor(Math.random() * 22); // 0-21 메이저 아르카나

    return {
      templateId: template.id,
      userId: USER_ID,
      selectedCard,
      isAnonymous: false,
      sessionMetadata: JSON.stringify({
        fortuneType: template.title,
        templateKey: template.templateKey
      }),
      createdAt: date,
      updatedAt: date
    };
  });

  // 4. 데이터베이스에 삽입
  for (const session of sessionsToCreate) {
    const created = await prisma.fortuneSession.create({
      data: session
    });

    const kstDate = new Date(session.createdAt.getTime() + 9 * 60 * 60 * 1000);
    console.log(`✅ 세션 생성: ID ${created.id}, 카드 ${session.selectedCard}, 날짜(KST): ${kstDate.toLocaleDateString('ko-KR')}`);
  }

  console.log(`\n🎉 총 ${sessionsToCreate.length}개의 테스트 세션이 생성되었습니다!\n`);

  // 5. 생성된 세션 확인
  const userSessions = await prisma.fortuneSession.findMany({
    where: { userId: USER_ID },
    orderBy: { createdAt: 'desc' },
    take: 15,
    include: {
      template: { select: { title: true } }
    }
  });

  console.log(`📊 userId ${USER_ID}의 최근 세션 목록:`);
  userSessions.forEach(s => {
    const kstDate = new Date(s.createdAt.getTime() + 9 * 60 * 60 * 1000);
    console.log(`   - ${s.template.title} | 카드 ${s.selectedCard} | ${kstDate.toLocaleDateString('ko-KR')}`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
