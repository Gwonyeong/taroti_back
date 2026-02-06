#!/bin/bash

# TaroTI Backend 자동 재시작 스크립트
# 메모리 누수와 장시간 가동으로 인한 성능 저하 방지

BACKEND_DIR="/Users/gwonyeong/Desktop/Ta/code/taroti/backend"
LOG_FILE="$BACKEND_DIR/logs/restart.log"

# 로그 디렉토리 생성
mkdir -p "$BACKEND_DIR/logs"

# 현재 시간 기록
echo "===== Restart initiated at $(date) =====" >> "$LOG_FILE"

# Backend 디렉토리로 이동
cd "$BACKEND_DIR"

# PM2를 사용한 재시작
if command -v pm2 &> /dev/null; then
    echo "Restarting backend with PM2..." >> "$LOG_FILE"

    # 현재 메모리 사용량 기록
    pm2 describe taroti-backend >> "$LOG_FILE" 2>&1

    # 부드러운 재시작 (0-downtime)
    pm2 reload taroti-backend >> "$LOG_FILE" 2>&1

    if [ $? -eq 0 ]; then
        echo "Backend restarted successfully" >> "$LOG_FILE"
    else
        echo "Restart failed, attempting force restart..." >> "$LOG_FILE"
        pm2 restart taroti-backend >> "$LOG_FILE" 2>&1
    fi

    # 재시작 후 상태 확인
    sleep 5
    pm2 status taroti-backend >> "$LOG_FILE" 2>&1
else
    echo "PM2 not found, using fallback method..." >> "$LOG_FILE"

    # PM2가 없는 경우 프로세스 직접 재시작
    pkill -f "node server.js"
    sleep 2
    nohup node server.js > "$LOG_FILE" 2>&1 &
    echo "Backend restarted using fallback method" >> "$LOG_FILE"
fi

echo "===== Restart completed at $(date) =====" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"