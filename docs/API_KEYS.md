# API 키와 데이터 제공자

## 한국투자증권 KIS Developers

공식 개발자센터: https://apiportal.koreainvestment.com/

사용 목적:

- 국내주식/ETF 현재가: `/uapi/domestic-stock/v1/quotations/inquire-price`
- 국내주식 기간별 차트: `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`
- 국내 지수/업종 기간별 시세: `/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice`
- 환율/글로벌 지수: `/uapi/overseas-price/v1/quotations/inquire-time-indexchartprice`
- 국고채 금리: `/uapi/domestic-stock/v1/quotations/comp-interest`
- 손익계산서: `/uapi/domestic-stock/v1/finance/income-statement`
- 재무상태표: `/uapi/domestic-stock/v1/finance/balance-sheet`
- 수익성비율: `/uapi/domestic-stock/v1/finance/profit-ratio`
- 안정성비율: `/uapi/domestic-stock/v1/finance/stability-ratio`
- 국내 옵션 월물 리스트: `/uapi/domestic-futureoption/v1/quotations/display-board-option-list`
- 국내 옵션 콜/풋 전광판: `/uapi/domestic-futureoption/v1/quotations/display-board-callput`
- 국내주식 잔고: `/uapi/domestic-stock/v1/trading/inquire-balance`
- 국내주식 일별 주문/체결 조회: `/uapi/domestic-stock/v1/trading/inquire-daily-ccld`
- 국내주식 주문: `/uapi/domestic-stock/v1/trading/order-cash`

필요 값:

- `KIS_APP_KEY`
- `KIS_APP_SECRET`
- `KIS_ACCOUNT_NO`: KIS CANO 8자리 숫자
- `KIS_ACCOUNT_PRODUCT_CODE` 기본값 `01`
- 모의투자 기본값: `KIS_USE_PAPER=true`

토큰:

- 서버는 `/oauth2/tokenP`로 client credentials 토큰을 발급받고 메모리에 캐시합니다.
- 토큰 발급 실패, 요청 제한, 키 누락은 숫자 데이터 대신 상태 배지로 표시합니다.
- 앱 화면에서 저장한 KIS 키는 암호화 저장되며 원문은 다시 표시하지 않습니다.
- 계좌 연결 상태는 `connected`, `missing`, `invalid`로 구분하며, `invalid`는 값은 있지만 CANO 8자리 숫자 형식이 아닌 경우입니다.

주문:

- 모의투자 매수/매도 TR ID: `VTTC0802U`, `VTTC0801U`
- 실전투자 매수/매도 TR ID: `TTTC0802U`, `TTTC0801U`
- 실전투자는 서버 `ALLOW_LIVE_TRADING=true`와 사용자 설정, 확인 문구가 모두 필요합니다.

체결 내역:

- 최근 30일 주문/체결 조회 TR ID: 모의 `VTTC8001R`, 실전 `TTTC8001R`
- `KIS_ACCOUNT_NO`가 없거나 8자리 숫자 형식이 아니면 숫자나 샘플 행을 만들지 않고 `API 필요`로 표시합니다.
- 3개월 이전 체결 내역은 별도 과거 조회 TR이 필요하므로 현재 화면에서는 조회하지 않습니다.

## OpenDART

공식 개발가이드: https://opendart.fss.or.kr/guide/main.do

사용 목적:

- 기업 고유번호 목록: `https://opendart.fss.or.kr/api/corpCode.xml`
- 공시 목록: `https://opendart.fss.or.kr/api/list.json`
- 기업 개황: `https://opendart.fss.or.kr/api/company.json`

필요 값:

- `DART_API_KEY`

응답 상태:

- 정상 `000`
- 조회 데이터 없음 `013`
- 요청 제한 초과 `020`
- 그 외 오류는 화면에 오류 상태로 표시합니다.

구현 메모:

- 화면에서 종목코드(`005930` 등)로 공시를 요청하면 서버가 `corpCode.xml` ZIP을 내려받아 `data/dart-corp-codes.json`에 공개 데이터 캐시로 저장합니다.
- 이후 종목코드로 OpenDART 기업 고유번호(`corp_code`)를 찾아 `list.json`에 전달합니다.
- 기업 고유번호를 찾지 못하면 임의 기업을 대체 표시하지 않고 `데이터 없음`으로 응답합니다.

## Gemini API

공식 문서: https://ai.google.dev/api

필요 값:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`, 기본값 `gemini-3.5-flash`

호출 방식:

- REST `generateContent`
- 인증 헤더: `x-goog-api-key`

키가 없으면:

- 서버가 로컬 규칙 기반 요약을 반환합니다.
- 응답에는 `mode: local-rule`과 `API 필요` 상태가 표시됩니다.

## 뉴스

현재 기본 뉴스는 로그인 없이 공개 RSS를 통해 가져옵니다.

- 제공자: Google News RSS
- 상태: `지연 데이터`
- 분석: 서버 로컬 규칙 기반 감성/중요도/관련 종목 추출

운영 서비스에서는 네이버 검색 API, 제휴 뉴스 API, 유료 뉴스 피드 등으로 교체할 수 있습니다.

## 환율, 금리, 글로벌 지수

현재 화면의 원/달러, 국고채 3년/10년, S&P 500, NASDAQ 100은 KIS Open API로 조회합니다.

- 원/달러: `inquire-time-indexchartprice`, `FID_COND_MRKT_DIV_CODE=X`, `FID_INPUT_ISCD=FX@KRW`
- S&P 500: `inquire-time-indexchartprice`, `FID_COND_MRKT_DIV_CODE=N`, `FID_INPUT_ISCD=SPX`
- NASDAQ 100: `inquire-time-indexchartprice`, `FID_COND_MRKT_DIV_CODE=N`, `FID_INPUT_ISCD=NDX`
- 국고채 3년/10년: `comp-interest`, `FID_COND_MRKT_DIV_CODE=I`, `FID_COND_SCR_DIV_CODE=20702`

운영 확장 후보:

- 환율: 공공데이터포털, 한국수출입은행 환율 API
- 금리: 한국은행 ECOS, 공공데이터포털
- 글로벌 지수: KIS 해외지수 API 또는 상용 데이터 피드

## 국내 지수와 옵션

국내 지수 패널과 상단 Strip은 KIS 국내업종/지수 API를 사용합니다.

- KOSPI: `inquire-daily-indexchartprice`, `FID_COND_MRKT_DIV_CODE=U`, `FID_INPUT_ISCD=0001`
- KOSDAQ: `FID_INPUT_ISCD=1001`
- KOSPI 200: `FID_INPUT_ISCD=2001`
- KOSDAQ 150: `FID_INPUT_ISCD=3003`

옵션 체인 패널은 조회 전용입니다.

- 월물: `display-board-option-list`, TR `FHPIO056104C0`, `FID_COND_SCR_DIV_CODE=509`
- 콜/풋 전광판: `display-board-callput`, TR `FHPIF05030100`, `FID_COND_MRKT_DIV_CODE=O`

옵션 주문 기능은 현재 국내주식 주문과 분리되어 있으며, 실제 주문으로 연결하지 않습니다.

## 실적/재무

실적/재무 패널은 리서치 화면에서 보이는 경우에만 비동기로 조회합니다.

- 손익계산서: TR `FHKST66430200`
- 재무상태표: TR `FHKST66430100`
- 수익성비율: TR `FHKST66430400`
- 안정성비율: TR `FHKST66430600`

KIS가 반환하지 않은 항목은 빈칸 또는 `--`로 표시하며, 과거 실적을 추정해서 채우지 않습니다.
