module.exports = {
  apps: [
    // 기존 백엔드 서버
    {
      name: 'taroti-backend',
      script: './server.js',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      },
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'uploads', '.git'],
      max_memory_restart: '1G',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: false,
      cron_restart: '0 4 * * *',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 60000,
      autorestart: true,
      monitor_cpu: true,
      monitor_memory: true
    },
    
    // 스케줄러 전용 인스턴스
    {
      name: 'taroti-scheduler',
      script: './server.js',
      instances: 1,
      exec_mode: 'fork',
      cwd: '/Users/gwonyeong/Desktop/projects/taroti/taroti_code/taroti/backend',

      // NODE_ENV=scheduler 설정 시 server.js가 자동으로 .env.scheduler 로드
      env: {
        NODE_ENV: 'scheduler',
        PORT: 6001
      },
      
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'uploads', '.git'],
      max_memory_restart: '512M',
      error_file: './logs/scheduler-err.log',
      out_file: './logs/scheduler-out.log',
      log_file: './logs/scheduler-combined.log',
      time: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 60000,
      autorestart: true
    }
  ]
};
