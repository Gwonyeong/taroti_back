# 환경변수 관리 가이드

## 개요

TaroTI 백엔드는 개발환경과 프로덕션환경을 위한 별도의 환경변수 파일을 지원합니다.

## 환경별 파일

### 개발환경
- **파일**: `.env`
- **용도**: 로컬 개발 및 테스트
- **데이터베이스**: 로컬 PostgreSQL
- **Instagram Redirect**: ngrok URL

### 프로덕션환경
- **파일**: `.env.production`
- **용도**: Vercel 배포
- **데이터베이스**: Supabase PostgreSQL
- **Instagram Redirect**: vercel.app URL

## 환경변수 목록

| 변수명 | 개발환경 | 프로덕션환경 | 설명 |
|--------|----------|--------------|------|
| `DATABASE_URL` | 로컬 DB | Supabase DB | PostgreSQL 연결 문자열 |
| `INSTAGRAM_REDIRECT_URI` | ngrok URL | vercel URL | Instagram OAuth 콜백 URI |
| `FRONTEND_URL` | localhost:5001 | vercel frontend | 프론트엔드 URL |

## 사용 방법

### 로컬 개발
```bash
npm run dev
# .env 파일 사용
```

### 프로덕션 배포
```bash
npm run deploy
# .env.production 파일 사용
# NODE_ENV=production 자동 설정
```

### 로컬 프로덕션 테스트
```bash
npm run start:prod
# .env.production 파일로 로컬 실행
```

## 배포 과정

1. **환경변수 확인**: `.env.production` 파일에 프로덕션 설정 존재
2. **Vercel 설정**: `vercel.json`에 `NODE_ENV=production` 설정
3. **배포 실행**: `npm run deploy` 또는 `vercel --prod`

## 보안 주의사항

- **민감한 정보**: `.env` 파일들은 Git에 커밋하지 않음
- **환경분리**: 개발과 프로덕션 환경변수 완전 분리
- **토큰 관리**: Instagram App Secret 등 민감한 키는 안전하게 관리

## Instagram API 설정

### 개발환경
- Redirect URI: `https://foxiest-jerome-untruly.ngrok-free.dev/admin/instagram/callback`
- Meta Dashboard에 ngrok URL 등록 필요

### 프로덕션환경
- Redirect URI: `https://tarotiback.vercel.app/admin/instagram/callback`
- Meta Dashboard에 vercel URL 등록 필요

## 트러블슈팅

### 환경변수 로드 실패
- `NODE_ENV` 값 확인
- 파일 경로 확인
- 파일 권한 확인

### Instagram 연결 실패
- Meta Dashboard의 Redirect URI 등록 확인
- 환경별 올바른 URL 사용 확인

## 환경변수 템플릿

### .env (개발환경)
```env
DATABASE_URL="postgresql://user:password@localhost:25432/postgres?schema=taroti"
INSTAGRAM_REDIRECT_URI=https://foxiest-jerome-untruly.ngrok-free.dev/admin/instagram/callback
FRONTEND_URL=http://localhost:5001
```

### .env.production (프로덕션)
```env
DATABASE_URL="postgresql://postgres.xxx:password@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?schema=taroti"
INSTAGRAM_REDIRECT_URI=https://tarotiback.vercel.app/admin/instagram/callback
FRONTEND_URL=https://taroti-front.vercel.app
```