#!/bin/bash

# Cron 작업 설정 스크립트
# 매일 새벽 4시에 백엔드 자동 재시작

SCRIPT_PATH="/Users/gwonyeong/Desktop/Ta/code/taroti/backend/scripts/restart-backend.sh"
CRON_JOB="0 4 * * * $SCRIPT_PATH"

# 현재 crontab 백업
crontab -l > /tmp/current_cron 2>/dev/null

# 이미 설정된 cron job이 있는지 확인
if grep -q "$SCRIPT_PATH" /tmp/current_cron; then
    echo "Restart cron job already exists."
    echo "Existing job:"
    grep "$SCRIPT_PATH" /tmp/current_cron
else
    # 새 cron job 추가
    echo "Adding new cron job for backend restart..."
    echo "$CRON_JOB" >> /tmp/current_cron
    crontab /tmp/current_cron
    echo "Cron job added successfully!"
    echo "Backend will restart daily at 4:00 AM"
fi

# 임시 파일 삭제
rm /tmp/current_cron

echo ""
echo "Current cron jobs:"
crontab -l