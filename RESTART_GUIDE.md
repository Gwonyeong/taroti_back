# 백엔드 자동 재시작 가이드

## 개요
서버 장시간 가동으로 인한 메모리 누수 및 성능 저하 방지를 위한 자동 재시작 시스템

## 구성 요소

### 1. PM2 프로세스 매니저
- **설정 파일**: `ecosystem.config.js`
- **기능**:
  - 메모리 1GB 초과 시 자동 재시작
  - 매일 새벽 4시 자동 재시작
  - 에러 발생 시 자동 재시작
  - 로그 관리 및 모니터링

### 2. 재시작 스크립트
- **위치**: `scripts/restart-backend.sh`
- **기능**: PM2를 통한 무중단 재시작 수행

### 3. Cron 설정 스크립트
- **위치**: `scripts/setup-restart-cron.sh`
- **기능**: 시스템 cron에 재시작 작업 등록

## 사용 방법

### PM2로 서버 시작
```bash
# 개발 환경
npm run pm2:start

# 프로덕션 환경
npm run pm2:start:prod
```

### PM2 관리 명령어
```bash
npm run pm2:status    # 상태 확인
npm run pm2:logs      # 로그 확인
npm run pm2:restart   # 재시작
npm run pm2:reload    # 무중단 재시작
npm run pm2:stop      # 중지
npm run pm2:delete    # 삭제
```

### Cron 자동 재시작 설정
```bash
# Cron job 설정 (1회만 실행)
./scripts/setup-restart-cron.sh

# 수동 재시작
./scripts/restart-backend.sh
```

## 자동 재시작 정책

1. **메모리 기반**: 1GB 초과 시 자동 재시작
2. **시간 기반**: 매일 새벽 4시 자동 재시작
3. **에러 기반**: 프로세스 크래시 시 자동 재시작

## 로그 위치
- PM2 로그: `logs/` 디렉토리
- 재시작 로그: `logs/restart.log`

## 주의 사항
- PM2 시작 전 기존 nodemon 프로세스 종료 필요
- Cron 설정은 1회만 실행 (중복 방지)
- 프로덕션 환경에서는 `pm2:reload` 사용 권장 (무중단)