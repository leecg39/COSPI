# COSPI WTS

국내주식 투자자를 위한 웹 기반 금융 터미널입니다. 첫 화면은 고밀도 WTS 화면으로 시작하며, 국내 주식/ETF 시세, 차트, 뉴스, DART 공시, 포트폴리오, 주문, AI 분석 패널을 제공합니다.

## 빠른 실행

```bash
npm install
cp .env.example .env
npm run dev
```

- 프론트엔드: http://localhost:5173
- API 서버: http://localhost:4100
- 상태 확인: http://localhost:4100/api/health

프로덕션 빌드:

```bash
npm run build
npm run start
```

실행 중인 로컬 서버 검증:

```bash
npm run verify
```

서버 기동부터 검증까지 한 번에 실행:

```bash
npm run verify:dev
```

Docker:

```bash
cp .env.example .env
docker compose up --build
```

## 현재 구현 범위

- KIS Open API 기반 국내주식/ETF 현재가, 국내 지수, 환율, 금리, 글로벌 지수, 옵션 체인, 실적/재무, 기간별 차트, 잔고, 체결 내역, 모의/실전 주문 호출 구조
- 차트 기간 `1M / 3M / 6M / 1Y / 2Y / 5Y / 10Y`, 인터벌 `1D / 1W / 1M`
- 캔들, 거래량, MA20, MA60, Bollinger Band, RSI, MACD
- 공개 RSS 기반 국내 경제/증시 뉴스와 로컬 규칙 기반 감성/종목/중요도 분석
- OpenDART 종목코드-기업 고유번호 매핑 캐시 기반 공시 조회
- Gemini API 선택 연동, 키가 없으면 로컬 규칙 기반 한국어 요약. AI 컨텍스트는 선택 종목, 뉴스, DART, 실적/재무, 차트, 포트폴리오 상태를 포함합니다.
- 로그인 후 KIS/DART/Gemini 키, 관심종목, 가격 알림, 수동 포트폴리오 입력/수정, 자산 스냅샷, 레이아웃 저장
- 국내 옵션 월물/콜풋 체인 조회 전용 패널
- 패널 드래그 이동, 박스 리사이즈, 좌/중앙/우 패널 폭 조절, 사용자별 브라우저 레이아웃 저장
- 데이터 상태 배지: `실시간`, `근실시간`, `지연`, `API 필요`, `데이터 없음`, `요청 제한`, `오류`
- `/Users/user01/Desktop/DESIGN.md`의 Coinbase Spain 스타일 레퍼런스를 적용한 밝은 화이트/미드나이트/전기 블루 UI

## 필요한 API 키

| 기능 | 제공자 | 환경변수/설정 | 상태 |
| --- | --- | --- | --- |
| 국내주식/ETF 시세, 국내 지수, 차트, 실적/재무, 잔고, 체결 내역, 주문 | 한국투자증권 KIS Developers | `KIS_APP_KEY`, `KIS_APP_SECRET`, 계좌번호 | 기본 데이터 소스 |
| DART 공시 | 금융감독원 OpenDART | `DART_API_KEY` | 선택 |
| AI 분석 | Google Gemini API | `GEMINI_API_KEY`, `GEMINI_MODEL` | 선택 |
| 환율/금리 | 한국투자증권 KIS Open API | 기존 KIS 키 | 원/달러, 국고채 3년/10년 |
| 글로벌 지수 | 한국투자증권 KIS Open API | 기존 KIS 키 | S&P 500, NASDAQ 100 |
| 국내 옵션 체인 | 한국투자증권 KIS Open API | 기존 KIS 키 | 옵션 월물, 콜/풋 전광판 조회 전용 |

한국투자증권 Open API는 OAuth 2.0 기반이며, 공식 개발자센터에서 API 신청과 문서를 확인합니다. OpenDART는 `crtfc_key` 인증키를 사용합니다. Gemini API는 `x-goog-api-key` 헤더 기반 호출을 사용합니다.

## 보안과 데이터 정책

- 비로그인 사용자는 공개 뉴스와 일반 시장 화면을 볼 수 있습니다.
- 로그인 사용자는 개인 설정과 API 키를 저장할 수 있습니다.
- 저장되는 API 키는 서버의 `MASTER_KEY`로 AES-256-GCM 암호화됩니다.
- API 키 원문은 클라이언트로 다시 내려주지 않고 `hasKisKeys` 같은 보유 여부만 내려줍니다.
- 운영 배포에서는 반드시 강한 `SESSION_SECRET`, `MASTER_KEY`, HTTPS, 리버스 프록시 보안 헤더를 설정하세요.
- 숫자 데이터가 없으면 임의 숫자를 만들지 않습니다. 화면과 API 응답은 `API 필요 / 데이터 없음 / 지연 데이터 / 요청 제한 / 오류`를 표시합니다.
- OpenDART 기업 고유번호 목록은 `data/dart-corp-codes.json`에 공개 데이터 캐시로 저장되며, `.env`와 사용자 API 키 원문은 ZIP 산출물에 포함하지 않습니다.

자세한 내용은 [API_KEYS.md](./docs/API_KEYS.md), [SECURITY.md](./docs/SECURITY.md), [DATA_POLICY.md](./docs/DATA_POLICY.md), [LAYOUT.md](./docs/LAYOUT.md), [COMPLETION_AUDIT.md](./docs/COMPLETION_AUDIT.md)를 보세요.

## 주문/거래 분리

- 기본 주문 모드는 `모의투자`입니다.
- 실전투자 주문은 `ALLOW_LIVE_TRADING=true`, 사용자 설정의 실전투자 허용, KIS 실전 환경 설정, 확인 문구 `실전투자 주문`이 모두 필요합니다.
- UI는 모의투자와 실전투자를 다른 색상과 라벨로 표시합니다.

## 배포 메모

1. `.env`를 서버에 생성합니다.
2. HTTPS 리버스 프록시(Nginx, Caddy, Traefik 등)를 앞단에 둡니다.
3. `/app/data` 볼륨을 백업합니다.
4. 법인/제휴 서비스로 시세를 화면에 제공할 경우 거래소/코스콤 등 시세정보 이용계약 필요 여부를 별도 확인하세요.
