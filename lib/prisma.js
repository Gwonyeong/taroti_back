const { PrismaClient } = require('@prisma/client');

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({
    log: ['error', 'warn'],
    errorFormat: 'minimal',
  });
} else if (process.env.NODE_ENV === 'scheduler') {
  const basePrisma = new PrismaClient({
    log: ['error', 'warn'],
    errorFormat: 'minimal',
  });

  // 쿼리 실패 시 재연결 후 재시도
  prisma = basePrisma.$extends({
    query: {
      async $allOperations({ args, query }) {
        try {
          return await query(args);
        } catch (error) {
          if (error.message?.includes('Connection') || error.message?.includes('Closed')) {
            console.log('[Prisma Scheduler] Connection lost, reconnecting...');
            await basePrisma.$disconnect();
            await basePrisma.$connect();
            return await query(args);
          }
          throw error;
        }
      },
    },
  });
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient({
      log: ['error', 'warn'],
    });
  }
  prisma = global.prisma;
}

module.exports = prisma;
