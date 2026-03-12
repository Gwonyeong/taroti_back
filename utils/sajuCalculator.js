let calculateFourPillars;
const manseryeokReady = import("manseryeok").then((mod) => {
  calculateFourPillars = mod.calculateFourPillars;
});

// 십이시진 → hour 매핑
const birthTimeToHour = {
  자시: 0,
  축시: 2,
  인시: 4,
  묘시: 6,
  진시: 8,
  사시: 10,
  오시: 12,
  미시: 14,
  신시: 16,
  유시: 18,
  술시: 20,
  해시: 22,
};

/**
 * 사주팔자를 계산하고 DB 저장용 데이터를 반환한다.
 * @param {Object} params
 * @param {string} params.birthDate - "YYYY-MM-DD" 형식
 * @param {string} params.birthCalendarType - "solar" | "lunar"
 * @param {string|null} params.birthTime - 십이시진 ("자시"~"해시") 또는 null
 * @returns {Object} UserSaju 모델에 저장할 데이터
 */
async function calculateSaju({ birthDate, birthCalendarType, birthTime }) {
  await manseryeokReady;
  const date = new Date(birthDate);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = birthTime ? (birthTimeToHour[birthTime] ?? 12) : 12;
  const isLunar = birthCalendarType === "lunar";

  const result = calculateFourPillars({
    year,
    month,
    day,
    hour,
    minute: 0,
    isLunar,
  });

  // 오행 분포 계산 (천간 4개 + 지지 4개 = 8글자)
  const elements = [
    result.yearElement.stem,
    result.yearElement.branch,
    result.monthElement.stem,
    result.monthElement.branch,
    result.dayElement.stem,
    result.dayElement.branch,
    result.hourElement.stem,
    result.hourElement.branch,
  ];

  const elementProfile = { 목: 0, 화: 0, 토: 0, 금: 0, 수: 0 };
  for (const el of elements) {
    if (elementProfile[el] !== undefined) {
      elementProfile[el]++;
    }
  }

  // 가장 강한 오행
  const dominantElement = Object.entries(elementProfile).sort(
    (a, b) => b[1] - a[1],
  )[0][0];

  // 음양 분포 계산
  const yinYangs = [
    result.yearYinYang.stem,
    result.yearYinYang.branch,
    result.monthYinYang.stem,
    result.monthYinYang.branch,
    result.dayYinYang.stem,
    result.dayYinYang.branch,
    result.hourYinYang.stem,
    result.hourYinYang.branch,
  ];

  const yinYangProfile = { 음: 0, 양: 0 };
  for (const yy of yinYangs) {
    if (yinYangProfile[yy] !== undefined) {
      yinYangProfile[yy]++;
    }
  }

  return {
    fourPillars: result.toObject(),
    fourPillarsHanja: result.toHanjaObject(),
    dominantElement,
    elementProfile,
    yinYangProfile,
    dayElement: result.dayElement,
    dayYinYang: result.dayYinYang,
    calculatedFrom: {
      year,
      month,
      day,
      hour,
      minute: 0,
      isLunar,
      birthTime: birthTime || null,
    },
  };
}

/**
 * 사용자의 사주를 계산하고 DB에 저장/업데이트한다.
 * 이미 동일한 입력값으로 계산된 결과가 있으면 스킵한다.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {number} userId
 * @param {Object} params - { birthDate, birthCalendarType, birthTime }
 * @returns {Object} 저장된 UserSaju 레코드
 */
async function ensureUserSaju(prisma, userId, { birthDate, birthCalendarType, birthTime }) {
  if (!birthDate) return null;

  const existing = await prisma.userSaju.findUnique({ where: { userId } });

  // 동일 입력값이면 재계산 스킵
  if (existing) {
    const prev = existing.calculatedFrom;
    const date = new Date(birthDate);
    const hour = birthTime ? (birthTimeToHour[birthTime] ?? 12) : 12;
    if (
      prev.year === date.getFullYear() &&
      prev.month === date.getMonth() + 1 &&
      prev.day === date.getDate() &&
      prev.hour === hour &&
      prev.isLunar === (birthCalendarType === "lunar") &&
      prev.birthTime === (birthTime || null)
    ) {
      return existing;
    }
  }

  const sajuData = await calculateSaju({ birthDate, birthCalendarType, birthTime });

  return prisma.userSaju.upsert({
    where: { userId },
    create: {
      userId,
      ...sajuData,
      calculatedAt: new Date(),
    },
    update: {
      ...sajuData,
      calculatedAt: new Date(),
    },
  });
}

module.exports = { calculateSaju, ensureUserSaju, birthTimeToHour };
