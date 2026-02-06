const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * 기존 FortuneTemplate의 characterInfo를 Character 모델로 마이그레이션하는 스크립트
 */

async function migrateToCharacterSystem() {

  try {
    // 1. Character 테이블이 존재하는지 확인하고 생성

    // 2. 기존 FortuneTemplate에서 characterInfo 데이터 추출
    const templates = await prisma.fortuneTemplate.findMany({
      select: {
        id: true,
        templateKey: true,
        title: true,
        characterInfo: true,
        messageScenarios: true
      }
    });


    // 3. 기존 characterInfo에서 고유한 캐릭터들 추출
    const uniqueCharacters = new Map();

    templates.forEach(template => {
      if (template.characterInfo && typeof template.characterInfo === 'object') {
        const charInfo = template.characterInfo;
        const charKey = `${charInfo.name}-${charInfo.imageSrc}`;

        if (!uniqueCharacters.has(charKey)) {
          uniqueCharacters.set(charKey, {
            name: charInfo.name || '타로티',
            imageSrc: charInfo.imageSrc || '/images/character/default.png',
            description: charInfo.description || null,
            personality: '친근하고 따뜻한 말투로 운세를 봐주는 캐릭터',
            defaultMessageScenarios: template.messageScenarios || null
          });
        }
      }
    });


    // 4. Character 테이블에 캐릭터들 생성
    const createdCharacters = [];

    for (const [key, charData] of uniqueCharacters) {

      const character = await prisma.character.create({
        data: charData
      });

      createdCharacters.push({
        ...character,
        originalKey: key
      });
    }


    // 5. 기본 캐릭터가 없으면 생성 (타로티)
    if (createdCharacters.length === 0) {

      const defaultCharacter = await prisma.character.create({
        data: {
          name: '타로티',
          imageSrc: '/images/character/taroti.png',
          description: '따뜻하고 친근한 타로 운세 전문가',
          personality: '~고래 말투를 사용하며 친근하게 운세를 봐주는 캐릭터',
          defaultMessageScenarios: {
            withProfile: [
              { text: '운세를 봐줄거래!', sender: 'bot' },
              { text: '바로 카드를 뽑아보고래!', sender: 'bot', showCardSelect: true }
            ],
            needsProfile: [
              { text: '운세를 봐줄거래!', sender: 'bot' },
              { text: '먼저 생년월일을 알려줘고래~', sender: 'bot', showUserInput: 'birthDate' },
              { text: '성별도 알려줘고래!', sender: 'bot', showUserInput: 'gender' },
              { text: 'MBTI도 궁금해고래!', sender: 'bot', showUserInput: 'mbti' },
              { text: '좋아고래! 이제 카드를 뽑아보고래!', sender: 'bot', showCardSelect: true }
            ]
          }
        }
      });

      createdCharacters.push({
        ...defaultCharacter,
        originalKey: 'default'
      });
    }



    return createdCharacters;

  } catch (error) {
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 스크립트 직접 실행 시
if (require.main === module) {
  migrateToCharacterSystem()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      process.exit(1);
    });
}

module.exports = { migrateToCharacterSystem };