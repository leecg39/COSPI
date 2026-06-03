import { randomUUID } from 'node:crypto'
import { config } from './config.ts'
import type {
  Candle,
  ChartInterval,
  ChartPayload,
  ChartRange,
  ExecutionItem,
  ExecutionPayload,
  FinancialPayload,
  FinancialRow,
  OptionChainPayload,
  OptionContract,
  OptionMonth,
  PortfolioPosition,
  Quote,
  SourceMeta,
  TradingMode,
  UserSettings,
} from './types.ts'

type KisCredentials = {
  appKey: string
  appSecret: string
  accountNo?: string
  accountProductCode?: string
  paper: boolean
}

type TokenCache = {
  accessToken: string
  expiresAt: number
}

const tokenCache = new Map<string, TokenCache>()
const tokenInFlight = new Map<string, Promise<string>>()
const quoteCache = new Map<string, { expiresAt: number; value: Quote[] }>()
const chartCache = new Map<string, { expiresAt: number; value: ChartPayload }>()
const indexCache = new Map<string, { expiresAt: number; value: Quote[] }>()
const optionCache = new Map<string, { expiresAt: number; value: OptionChainPayload }>()
const financialCache = new Map<string, { expiresAt: number; value: FinancialPayload }>()
const KIS_REQUEST_SPACING_MS = 360
const KIS_RATE_LIMIT_RETRY_MS = 1200
let kisRequestQueue = Promise.resolve()
let lastKisRequestAt = 0

const symbolNames: Record<string, { name: string; market: Quote['market'] }> = {
  '005930': { name: '삼성전자', market: 'KOSPI' },
  '000660': { name: 'SK하이닉스', market: 'KOSPI' },
  '035420': { name: 'NAVER', market: 'KOSPI' },
  '051910': { name: 'LG화학', market: 'KOSPI' },
  '035720': { name: '카카오', market: 'KOSPI' },
  '068270': { name: '셀트리온', market: 'KOSPI' },
  '069500': { name: 'KODEX 200', market: 'ETF' },
  '229200': { name: 'KODEX 코스닥150', market: 'ETF' },
}

const nowIso = () => new Date().toISOString()

export const source = (state: SourceMeta['state'], message?: string, provider = 'KIS Open API'): SourceMeta => ({
  provider,
  state,
  label:
    state === 'REALTIME'
      ? '실시간'
      : state === 'NEAR_REALTIME'
        ? '근실시간'
        : state === 'DELAYED'
          ? '지연 데이터'
          : state === 'API_REQUIRED'
            ? 'API 필요'
            : state === 'RATE_LIMITED'
              ? '요청 제한'
              : state === 'NO_DATA'
                ? '데이터 없음'
                : '오류',
  asOf: nowIso(),
  message,
})

const rangeDays: Record<ChartRange, number> = {
  '1M': 35,
  '3M': 100,
  '6M': 190,
  '1Y': 370,
  '2Y': 740,
  '5Y': 1850,
  '10Y': 3700,
}

const intervalCode: Record<ChartInterval, 'D' | 'W' | 'M'> = {
  '1D': 'D',
  '1W': 'W',
  '1M': 'M',
}

const compactDate = (date: Date) => {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}

const dashedDate = (dateText: string) => `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}`

const numberOrNull = (value: string | number | null | undefined) => {
  if (value == null || value === '') return null
  const numeric = Number(String(value).replaceAll(',', '').trim())
  return Number.isFinite(numeric) ? numeric : null
}

const kisDateOrNull = (value: string | null | undefined) => {
  if (!value) return null
  return /^\d{8}$/.test(value) ? dashedDate(value) : value
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const throttleKisRequest = async () => {
  const waitForSlot = async () => {
    const elapsed = Date.now() - lastKisRequestAt
    if (elapsed < KIS_REQUEST_SPACING_MS) await sleep(KIS_REQUEST_SPACING_MS - elapsed)
    lastKisRequestAt = Date.now()
  }
  kisRequestQueue = kisRequestQueue.then(waitForSlot, waitForSlot)
  await kisRequestQueue
}

const isKisRateLimit = (status: number, message: string) => status === 429 || message.includes('초과')

const credentialsFromSettings = (settings: UserSettings): KisCredentials | null => {
  if (!settings.kisAppKey || !settings.kisAppSecret) return null
  return {
    appKey: settings.kisAppKey,
    appSecret: settings.kisAppSecret,
    accountNo: settings.kisAccountNo,
    accountProductCode: settings.kisAccountProductCode || '01',
    paper: settings.kisPaperTrading,
  }
}

const getBaseUrl = (credentials: KisCredentials) =>
  credentials.paper ? config.kis.paperBaseUrl : config.kis.realBaseUrl

const tokenKey = (credentials: KisCredentials) => `${credentials.paper ? 'paper' : 'real'}:${credentials.appKey}`

const settingsCacheKey = (settings: UserSettings) => `${settings.kisPaperTrading ? 'paper' : 'real'}:${settings.kisAppKey || ''}`

const isCacheableState = (state: SourceMeta['state']) => state !== 'ERROR' && state !== 'RATE_LIMITED'

const getAccessToken = async (credentials: KisCredentials) => {
  const key = tokenKey(credentials)
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt > Date.now() + 1000 * 60) return cached.accessToken
  const pending = tokenInFlight.get(key)
  if (pending) return pending

  const request = (async () => {
    try {
      await throttleKisRequest()
      const response = await fetch(`${getBaseUrl(credentials)}/oauth2/tokenP`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          appkey: credentials.appKey,
          appsecret: credentials.appSecret,
        }),
      })
      const data = (await response.json().catch(() => ({}))) as Record<string, string | number>
      if (!response.ok || typeof data.access_token !== 'string') {
        throw new Error(String(data.msg1 || data.message || `KIS token error ${response.status}`))
      }
      const ttl = Number(data.expires_in || 86400)
      tokenCache.set(key, { accessToken: data.access_token, expiresAt: Date.now() + ttl * 1000 })
      return data.access_token
    } finally {
      tokenInFlight.delete(key)
    }
  })()
  tokenInFlight.set(key, request)
  return request
}

const kisGet = async <T>(
  credentials: KisCredentials,
  path: string,
  trId: string,
  params: Record<string, string>,
) => {
  const accessToken = await getAccessToken(credentials)
  const url = new URL(path, getBaseUrl(credentials))
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await throttleKisRequest()
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        appkey: credentials.appKey,
        appsecret: credentials.appSecret,
        tr_id: trId,
        custtype: 'P',
      },
    })
    const data = (await response.json().catch(() => ({}))) as T & Record<string, string>
    if (response.ok && (!data.rt_cd || data.rt_cd === '0')) return data

    const message = data.msg1 || data.message || `KIS request error ${response.status}`
    if (isKisRateLimit(response.status, message) && attempt === 0) {
      await sleep(KIS_RATE_LIMIT_RETRY_MS)
      continue
    }
    if (isKisRateLimit(response.status, message)) throw new Error(`RATE_LIMIT:${message}`)
    throw new Error(message)
  }
  throw new Error('KIS request error')
}

const emptyQuote = (symbol: string, state: SourceMeta['state'], message?: string): Quote => {
  const info = symbolNames[symbol] || { name: symbol, market: 'KOSPI' as const }
  return {
    symbol,
    name: info.name,
    market: info.market,
    currency: 'KRW',
    price: null,
    change: null,
    changeRate: null,
    volume: null,
    source: source(state, message),
  }
}

export const getQuotes = async (symbols: string[], settings: UserSettings): Promise<Quote[]> => {
  const cacheKey = `${settingsCacheKey(settings)}:${symbols.join(',')}`
  const cached = quoteCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const credentials = credentialsFromSettings(settings)
  if (!credentials) {
    return symbols.map((symbol) => emptyQuote(symbol, 'API_REQUIRED', '한국투자증권 App Key/App Secret이 필요합니다.'))
  }

  const results: Quote[] = []
  for (const symbol of symbols) {
    try {
      const data = await kisGet<{ output?: Record<string, string> }>(
        credentials,
        '/uapi/domestic-stock/v1/quotations/inquire-price',
        'FHKST01010100',
        { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: symbol },
      )
      const output = data.output
      const info = symbolNames[symbol] || { name: output?.hts_kor_isnm || symbol, market: 'KOSPI' as const }
      results.push({
        symbol,
        name: output?.hts_kor_isnm || info.name,
        market: info.market,
        currency: 'KRW',
        price: Number(output?.stck_prpr || 0) || null,
        change: Number(output?.prdy_vrss || 0) || null,
        changeRate: Number(output?.prdy_ctrt || 0) || null,
        volume: Number(output?.acml_vol || 0) || null,
        source: source('NEAR_REALTIME', credentials.paper ? '모의투자 환경 시세입니다.' : '한국투자증권 국내주식 현재가입니다.'),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'KIS 시세 조회 오류'
      results.push(emptyQuote(symbol, message.startsWith('RATE_LIMIT:') ? 'RATE_LIMITED' : 'ERROR', message.replace('RATE_LIMIT:', '')))
    }
  }
  if (results.every((quote) => isCacheableState(quote.source.state))) {
    quoteCache.set(cacheKey, { expiresAt: Date.now() + 10_000, value: results })
  }
  return results
}

type DomesticIndexOutput = {
  output1?: Record<string, string>
  output2?: Record<string, string>[]
}

const domesticIndices = [
  { symbol: 'KOSPI', name: 'KOSPI', inputCode: '0001' },
  { symbol: 'KOSDAQ', name: 'KOSDAQ', inputCode: '1001' },
  { symbol: 'KOSPI200', name: 'KOSPI 200', inputCode: '2001' },
  { symbol: 'KSQ150', name: 'KOSDAQ 150', inputCode: '3003' },
]

export const getChart = async (
  symbol: string,
  range: ChartRange,
  interval: ChartInterval,
  settings: UserSettings,
): Promise<ChartPayload> => {
  const cacheKey = `${settingsCacheKey(settings)}:${symbol}:${range}:${interval}`
  const cached = chartCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const credentials = credentialsFromSettings(settings)
  if (!credentials) {
    return {
      symbol,
      range,
      interval,
      candles: [],
      source: source('API_REQUIRED', '차트 데이터는 KIS 국내주식 기간별 시세 API 키가 필요합니다.'),
    }
  }

  const end = new Date()
  const start = new Date(end.getTime() - rangeDays[range] * 24 * 60 * 60 * 1000)
  const indexInfo = domesticIndices.find((item) => item.symbol === symbol || item.inputCode === symbol)
  if (indexInfo) {
    try {
      const data = await kisGet<DomesticIndexOutput>(
        credentials,
        '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice',
        'FHKUP03500100',
        {
          FID_COND_MRKT_DIV_CODE: 'U',
          FID_INPUT_ISCD: indexInfo.inputCode,
          FID_INPUT_DATE_1: compactDate(start),
          FID_INPUT_DATE_2: compactDate(end),
          FID_PERIOD_DIV_CODE: intervalCode[interval],
        },
      )
      const candles = (data.output2 || [])
        .map((row): Candle => ({
          time: dashedDate(row.stck_bsop_date),
          open: Number(row.bstp_nmix_oprc),
          high: Number(row.bstp_nmix_hgpr),
          low: Number(row.bstp_nmix_lwpr),
          close: Number(row.bstp_nmix_prpr),
          volume: Number(row.acml_vol),
        }))
        .filter((candle) => candle.time && candle.open && candle.high && candle.low && candle.close)
        .reverse()
      const value = {
        symbol: indexInfo.symbol,
        range,
        interval,
        candles,
        source: source(candles.length ? 'NEAR_REALTIME' : 'NO_DATA', candles.length ? 'KIS 국내 지수 기간별 시세입니다.' : '조회된 지수 차트 데이터가 없습니다.'),
      }
      if (isCacheableState(value.source.state)) chartCache.set(cacheKey, { expiresAt: Date.now() + 60_000, value })
      return value
    } catch (error) {
      const message = error instanceof Error ? error.message : 'KIS 지수 차트 조회 오류'
      return {
        symbol: indexInfo.symbol,
        range,
        interval,
        candles: [],
        source: source(message.startsWith('RATE_LIMIT:') ? 'RATE_LIMITED' : 'ERROR', message.replace('RATE_LIMIT:', '')),
      }
    }
  }
  try {
    const data = await kisGet<{ output2?: Record<string, string>[] }>(
      credentials,
      '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      'FHKST03010100',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: symbol,
        FID_INPUT_DATE_1: compactDate(start),
        FID_INPUT_DATE_2: compactDate(end),
        FID_PERIOD_DIV_CODE: intervalCode[interval],
        FID_ORG_ADJ_PRC: '0',
      },
    )
    const candles = (data.output2 || [])
      .map((row): Candle => ({
        time: dashedDate(row.stck_bsop_date),
        open: Number(row.stck_oprc),
        high: Number(row.stck_hgpr),
        low: Number(row.stck_lwpr),
        close: Number(row.stck_clpr),
        volume: Number(row.acml_vol),
      }))
      .filter((candle) => candle.time && candle.open && candle.high && candle.low && candle.close)
      .reverse()
    const value = {
      symbol,
      range,
      interval,
      candles,
      source: source(candles.length ? 'NEAR_REALTIME' : 'NO_DATA', candles.length ? 'KIS 기간별 시세입니다.' : '조회된 차트 데이터가 없습니다.'),
    }
    if (isCacheableState(value.source.state)) chartCache.set(cacheKey, { expiresAt: Date.now() + 60_000, value })
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : 'KIS 차트 조회 오류'
    return {
      symbol,
      range,
      interval,
      candles: [],
      source: source(message.startsWith('RATE_LIMIT:') ? 'RATE_LIMITED' : 'ERROR', message.replace('RATE_LIMIT:', '')),
    }
  }
}

const indexRequiredQuote = (item: (typeof domesticIndices)[number]): Quote => ({
  symbol: item.symbol,
  name: item.name,
  market: 'INDEX',
  currency: 'POINT',
  price: null,
  change: null,
  changeRate: null,
  volume: null,
  source: source('API_REQUIRED', 'KIS 국내업종/지수 API 키가 필요합니다.'),
})

const quoteFromDomesticIndex = (item: (typeof domesticIndices)[number], output: Record<string, string> | undefined): Quote => {
  const price = validNumber(output?.bstp_nmix_prpr)
  return {
    symbol: item.symbol,
    name: item.name,
    market: 'INDEX',
    currency: 'POINT',
    price,
    change: Number(output?.bstp_nmix_prdy_vrss || 0) || null,
    changeRate: Number(output?.bstp_nmix_prdy_ctrt || 0) || null,
    volume: Number(output?.acml_vol || 0) || null,
    source: source(price == null ? 'NO_DATA' : 'NEAR_REALTIME', price == null ? 'KIS 국내 지수 값이 비어 있습니다.' : 'KIS 국내업종기간별시세 지수 데이터입니다.'),
  }
}

export const getDomesticIndexQuotes = async (settings: UserSettings): Promise<Quote[]> => {
  const cacheKey = settingsCacheKey(settings)
  const cached = indexCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const credentials = credentialsFromSettings(settings)
  if (!credentials) return domesticIndices.map(indexRequiredQuote)

  const end = new Date()
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
  const results: Quote[] = []
  for (const item of domesticIndices) {
    try {
      const data = await kisGet<DomesticIndexOutput>(
        credentials,
        '/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice',
        'FHKUP03500100',
        {
          FID_COND_MRKT_DIV_CODE: 'U',
          FID_INPUT_ISCD: item.inputCode,
          FID_INPUT_DATE_1: compactDate(start),
          FID_INPUT_DATE_2: compactDate(end),
          FID_PERIOD_DIV_CODE: 'D',
        },
      )
      results.push(quoteFromDomesticIndex(item, data.output1))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'KIS 국내 지수 조회 오류'
      results.push({
        ...indexRequiredQuote(item),
        source: source(message.startsWith('RATE_LIMIT:') ? 'RATE_LIMITED' : 'ERROR', message.replace('RATE_LIMIT:', '')),
      })
    }
  }
  if (results.every((quote) => isCacheableState(quote.source.state))) {
    indexCache.set(cacheKey, { expiresAt: Date.now() + 20_000, value: results })
  }
  return results
}

type OverseasIndexOutput = {
  output1?: Record<string, string>
  output2?: Record<string, string>[]
}

type CompInterestOutput = {
  output1?: Record<string, string>[]
  output2?: Record<string, string>[]
}

const macroRequiredQuote = (symbol: string, name: string, market: Quote['market'], currency: Quote['currency'], message: string): Quote => ({
  symbol,
  name,
  market,
  currency,
  price: null,
  change: null,
  changeRate: null,
  volume: null,
  source: source('API_REQUIRED', message),
})

const macroErrorQuote = (
  symbol: string,
  name: string,
  market: Quote['market'],
  currency: Quote['currency'],
  error: unknown,
): Quote => {
  const message = error instanceof Error ? error.message : 'KIS 매크로 데이터 조회 오류'
  return {
    symbol,
    name,
    market,
    currency,
    price: null,
    change: null,
    changeRate: null,
    volume: null,
    source: source(message.startsWith('RATE_LIMIT:') ? 'RATE_LIMITED' : 'ERROR', message.replace('RATE_LIMIT:', '')),
  }
}

const validNumber = (value: string | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null
}

const quoteFromOverseasIndex = (
  symbol: string,
  name: string,
  market: Quote['market'],
  currency: Quote['currency'],
  output: Record<string, string> | undefined,
  message: string,
): Quote => {
  const price = validNumber(output?.ovrs_nmix_prpr)
  return {
    symbol,
    name: output?.hts_kor_isnm || name,
    market,
    currency,
    price,
    change: Number(output?.ovrs_nmix_prdy_vrss || 0) || null,
    changeRate: Number(output?.prdy_ctrt || 0) || null,
    volume: Number(output?.acml_vol || 0) || null,
    source: source(price == null ? 'NO_DATA' : 'NEAR_REALTIME', price == null ? 'KIS가 0 또는 빈 값을 반환했습니다.' : message),
  }
}

const getOverseasIndexQuote = async (
  credentials: KisCredentials,
  symbol: string,
  name: string,
  market: Quote['market'],
  currency: Quote['currency'],
  marketDivision: 'N' | 'X' | 'KX',
  inputCode: string,
) => {
  const data = await kisGet<OverseasIndexOutput>(
    credentials,
    '/uapi/overseas-price/v1/quotations/inquire-time-indexchartprice',
    'FHKST03030200',
    {
      FID_COND_MRKT_DIV_CODE: marketDivision,
      FID_INPUT_ISCD: inputCode,
      FID_HOUR_CLS_CODE: '0',
      FID_PW_DATA_INCU_YN: 'Y',
    },
  )
  return quoteFromOverseasIndex(symbol, name, market, currency, data.output1, 'KIS 해외지수/환율 분봉 조회입니다.')
}

const quoteFromInterest = (
  symbol: string,
  displayName: string,
  rows: Record<string, string>[],
): Quote => {
  const row = rows.find((item) => item.hts_kor_isnm === displayName && validNumber(item.bond_mnrt_prpr) != null)
  if (!row) {
    return {
      symbol,
      name: displayName,
      market: 'RATE',
      currency: 'PERCENT',
      price: null,
      change: null,
      changeRate: null,
      volume: null,
      source: source('NO_DATA', `${displayName} 항목을 찾지 못했습니다.`),
    }
  }
  return {
    symbol,
    name: displayName,
    market: 'RATE',
    currency: 'PERCENT',
    price: validNumber(row.bond_mnrt_prpr),
    change: Number(row.bond_mnrt_prdy_vrss || 0) || null,
    changeRate: Number(row.prdy_ctrt || row.bstp_nmix_prdy_ctrt || 0) || null,
    volume: null,
    source: source('NEAR_REALTIME', `KIS 금리 종합 데이터입니다. 기준일 ${row.stck_bsop_date || '미상'}`),
  }
}

const getInterestQuotes = async (credentials: KisCredentials) => {
  const data = await kisGet<CompInterestOutput>(
    credentials,
    '/uapi/domestic-stock/v1/quotations/comp-interest',
    'FHPST07020000',
    {
      FID_COND_MRKT_DIV_CODE: 'I',
      FID_COND_SCR_DIV_CODE: '20702',
      FID_DIV_CLS_CODE: '0',
      FID_DIV_CLS_CODE1: '',
    },
  )
  const rows = [...(data.output1 || []), ...(data.output2 || [])]
  return [quoteFromInterest('KR10Y', '국고채 10년', rows), quoteFromInterest('KR3Y', '국고채 3년', rows)]
}

export const getKisMacroQuotes = async (settings: UserSettings): Promise<Quote[]> => {
  const credentials = credentialsFromSettings(settings)
  const required = [
    macroRequiredQuote('USD/KRW', '원/달러 환율', 'FX', 'KRW', 'KIS App Key/App Secret이 필요합니다.'),
    macroRequiredQuote('KR10Y', '국고채 10년', 'RATE', 'PERCENT', 'KIS 금리 종합 API 키가 필요합니다.'),
    macroRequiredQuote('KR3Y', '국고채 3년', 'RATE', 'PERCENT', 'KIS 금리 종합 API 키가 필요합니다.'),
    macroRequiredQuote('SPX', 'S&P 500', 'GLOBAL', 'POINT', 'KIS 해외지수 API 키가 필요합니다.'),
    macroRequiredQuote('NDX', 'NASDAQ 100', 'GLOBAL', 'POINT', 'KIS 해외지수 API 키가 필요합니다.'),
  ]
  if (!credentials) return required

  const usdKrw = await getOverseasIndexQuote(credentials, 'USD/KRW', '원/달러 환율', 'FX', 'KRW', 'X', 'FX@KRW').catch((error) =>
    macroErrorQuote('USD/KRW', '원/달러 환율', 'FX', 'KRW', error),
  )
  const [kr10y, kr3y] = await getInterestQuotes(credentials).catch((error) => [
    macroErrorQuote('KR10Y', '국고채 10년', 'RATE', 'PERCENT', error),
    macroErrorQuote('KR3Y', '국고채 3년', 'RATE', 'PERCENT', error),
  ])
  const spx = await getOverseasIndexQuote(credentials, 'SPX', 'S&P 500', 'GLOBAL', 'POINT', 'N', 'SPX').catch((error) =>
    macroErrorQuote('SPX', 'S&P 500', 'GLOBAL', 'POINT', error),
  )
  const ndx = await getOverseasIndexQuote(credentials, 'NDX', 'NASDAQ 100', 'GLOBAL', 'POINT', 'N', 'NDX').catch((error) =>
    macroErrorQuote('NDX', 'NASDAQ 100', 'GLOBAL', 'POINT', error),
  )

  return [usdKrw, kr10y, kr3y, spx, ndx]
}

type OptionMonthListOutput = {
  output?: Record<string, string>[]
}

type OptionBoardOutput = {
  output1?: Record<string, string>[]
  output2?: Record<string, string>[]
}

const emptyOptionChain = (state: SourceMeta['state'], message: string): OptionChainPayload => ({
  source: source(state, message, 'KIS Domestic FutureOption API'),
  months: [],
  selectedMonth: null,
  calls: [],
  puts: [],
})

const formatOptionMonth = (month: string) => {
  if (!/^\d{6}$/.test(month)) return month
  return `${month.slice(0, 4)}.${month.slice(4, 6)}`
}

const optionFromRow = (row: Record<string, string>): OptionContract => ({
  code: row.optn_shrn_iscd || '',
  strike: Number(row.acpr || 0) || null,
  price: Number(row.optn_prpr || 0) || null,
  change: Number(row.optn_prdy_vrss || 0) || null,
  changeRate: Number(row.optn_prdy_ctrt || 0) || null,
  bid: Number(row.optn_bidp || 0) || null,
  ask: Number(row.optn_askp || 0) || null,
  volume: Number(row.acml_vol || 0) || null,
  openInterest: Number(row.hts_otst_stpl_qty || 0) || null,
  impliedVolatility: Number(row.hts_ints_vltl || 0) || null,
  delta: Number(row.delta_val || 0) || null,
  moneyness: row.atm_cls_name || null,
  source: source('NEAR_REALTIME', 'KIS 국내옵션전광판 콜풋 조회입니다.', 'KIS Domestic FutureOption API'),
})

export const getOptionChain = async (settings: UserSettings, requestedMonth?: string): Promise<OptionChainPayload> => {
  const cacheKey = `${settingsCacheKey(settings)}:${requestedMonth || 'front'}`
  const cached = optionCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const credentials = credentialsFromSettings(settings)
  if (!credentials) return emptyOptionChain('API_REQUIRED', 'KIS App Key/App Secret이 필요합니다.')

  try {
    const monthData = await kisGet<OptionMonthListOutput>(
      credentials,
      '/uapi/domestic-futureoption/v1/quotations/display-board-option-list',
      'FHPIO056104C0',
      {
        FID_COND_SCR_DIV_CODE: '509',
        FID_COND_MRKT_DIV_CODE: '',
        FID_COND_MRKT_CLS_CODE: '',
      },
    )
    const months: OptionMonth[] = (monthData.output || [])
      .map((row) => ({
        code: row.mtrt_yymm_code,
        month: row.mtrt_yymm,
        label: formatOptionMonth(row.mtrt_yymm),
      }))
      .filter((month) => month.month)
    const selectedMonth = months.some((month) => month.month === requestedMonth) ? requestedMonth || null : months[0]?.month || null
    if (!selectedMonth) return emptyOptionChain('NO_DATA', '조회 가능한 옵션 월물이 없습니다.')

    const boardData = await kisGet<OptionBoardOutput>(
      credentials,
      '/uapi/domestic-futureoption/v1/quotations/display-board-callput',
      'FHPIF05030100',
      {
        FID_COND_MRKT_DIV_CODE: 'O',
        FID_COND_SCR_DIV_CODE: '20503',
        FID_MRKT_CLS_CODE: 'CO',
        FID_MTRT_CNT: selectedMonth,
        FID_MRKT_CLS_CODE1: 'PO',
        FID_COND_MRKT_CLS_CODE: '',
      },
    )
    const calls = (boardData.output1 || []).map(optionFromRow).filter((item) => item.code)
    const puts = (boardData.output2 || []).map(optionFromRow).filter((item) => item.code)
    const value = {
      source: source(calls.length || puts.length ? 'NEAR_REALTIME' : 'NO_DATA', calls.length || puts.length ? 'KIS 국내옵션전광판 조회입니다.' : '옵션 체인 항목이 없습니다.', 'KIS Domestic FutureOption API'),
      months,
      selectedMonth,
      calls,
      puts,
    }
    if (value.source.state !== 'NO_DATA') optionCache.set(cacheKey, { expiresAt: Date.now() + 30_000, value })
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : 'KIS 옵션 체인 조회 오류'
    return emptyOptionChain(message.startsWith('RATE_LIMIT:') ? 'RATE_LIMITED' : 'ERROR', message.replace('RATE_LIMIT:', ''))
  }
}

type FinancialOutput = {
  output?: Record<string, string>[]
}

const financialNumber = (value: string | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed !== 99.99 ? parsed : null
}

const emptyFinancials = (symbol: string, state: SourceMeta['state'], message: string): FinancialPayload => ({
  symbol,
  source: source(state, message, 'KIS Finance API'),
  rows: [],
})

const mergeFinancialRows = (
  income: Record<string, string>[],
  balance: Record<string, string>[],
  profit: Record<string, string>[],
  stability: Record<string, string>[],
) => {
  const periods = Array.from(new Set([...income, ...balance, ...profit, ...stability].map((row) => row.stac_yymm).filter(Boolean))).sort((a, b) => b.localeCompare(a))
  return periods.map((period): FinancialRow => {
    const incomeRow = income.find((row) => row.stac_yymm === period)
    const balanceRow = balance.find((row) => row.stac_yymm === period)
    const profitRow = profit.find((row) => row.stac_yymm === period)
    const stabilityRow = stability.find((row) => row.stac_yymm === period)
    return {
      period,
      revenue: financialNumber(incomeRow?.sale_account),
      operatingProfit: financialNumber(incomeRow?.op_prfi),
      netIncome: financialNumber(incomeRow?.thtr_ntin),
      totalAssets: financialNumber(balanceRow?.total_aset),
      totalDebt: financialNumber(balanceRow?.total_lblt),
      totalEquity: financialNumber(balanceRow?.total_cptl),
      roe: financialNumber(profitRow?.self_cptl_ntin_inrt),
      netMargin: financialNumber(profitRow?.sale_ntin_rate),
      debtRatio: financialNumber(stabilityRow?.lblt_rate),
      currentRatio: financialNumber(stabilityRow?.crnt_rate),
    }
  })
}

export const getFinancials = async (settings: UserSettings, symbol: string): Promise<FinancialPayload> => {
  const cacheKey = `${settingsCacheKey(settings)}:${symbol}`
  const cached = financialCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const credentials = credentialsFromSettings(settings)
  if (!credentials) return emptyFinancials(symbol, 'API_REQUIRED', 'KIS App Key/App Secret이 필요합니다.')
  if (!/^\d{6}$/.test(symbol)) return emptyFinancials(symbol, 'NO_DATA', '재무 데이터는 국내 주식 6자리 종목코드가 필요합니다.')

  try {
    const common = {
      FID_DIV_CLS_CODE: '1',
      fid_cond_mrkt_div_code: 'J',
      fid_input_iscd: symbol,
    }
    const income = await kisGet<FinancialOutput>(credentials, '/uapi/domestic-stock/v1/finance/income-statement', 'FHKST66430200', common)
    const balance = await kisGet<FinancialOutput>(credentials, '/uapi/domestic-stock/v1/finance/balance-sheet', 'FHKST66430100', common)
    const profit = await kisGet<FinancialOutput>(credentials, '/uapi/domestic-stock/v1/finance/profit-ratio', 'FHKST66430400', common)
    const stability = await kisGet<FinancialOutput>(
      credentials,
      '/uapi/domestic-stock/v1/finance/stability-ratio',
      'FHKST66430600',
      {
        fid_div_cls_code: '1',
        fid_cond_mrkt_div_code: 'J',
        fid_input_iscd: symbol,
      },
    )
    const rows = mergeFinancialRows(income.output || [], balance.output || [], profit.output || [], stability.output || [])
    const value = {
      symbol,
      source: source(rows.length ? 'NEAR_REALTIME' : 'NO_DATA', rows.length ? 'KIS 국내주식 재무제표/비율 데이터입니다.' : '조회된 재무 데이터가 없습니다.', 'KIS Finance API'),
      rows,
    }
    if (isCacheableState(value.source.state)) financialCache.set(cacheKey, { expiresAt: Date.now() + 60_000, value })
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : 'KIS 재무 데이터 조회 오류'
    return emptyFinancials(symbol, message.startsWith('RATE_LIMIT:') ? 'RATE_LIMITED' : 'ERROR', message.replace('RATE_LIMIT:', ''))
  }
}

const kisPost = async <T>(
  credentials: KisCredentials,
  path: string,
  trId: string,
  body: Record<string, string>,
  withHash = false,
) => {
  const accessToken = await getAccessToken(credentials)
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    appkey: credentials.appKey,
    appsecret: credentials.appSecret,
    tr_id: trId,
    custtype: 'P',
    'Content-Type': 'application/json',
  }
  if (withHash) {
    const hashResponse = await fetch(`${getBaseUrl(credentials)}/uapi/hashkey`, {
      method: 'POST',
      headers: {
        appkey: credentials.appKey,
        appsecret: credentials.appSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const hashData = (await hashResponse.json().catch(() => ({}))) as { HASH?: string }
    if (hashData.HASH) headers.hashkey = hashData.HASH
  }
  await throttleKisRequest()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${getBaseUrl(credentials)}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const data = (await response.json().catch(() => ({}))) as T & Record<string, string>
    if (response.ok && (!data.rt_cd || data.rt_cd === '0')) return data

    const message = data.msg1 || data.message || `KIS request error ${response.status}`
    if (isKisRateLimit(response.status, message) && attempt === 0) {
      await sleep(KIS_RATE_LIMIT_RETRY_MS)
      await throttleKisRequest()
      continue
    }
    if (isKisRateLimit(response.status, message)) throw new Error(`RATE_LIMIT:${message}`)
    throw new Error(message)
  }
  throw new Error('KIS request error')
}

export const getBrokerPortfolio = async (settings: UserSettings): Promise<PortfolioPosition[]> => {
  const credentials = credentialsFromSettings(settings)
  if (!credentials || !credentials.accountNo) return []

  const data = await kisGet<{ output1?: Record<string, string>[] }>(
    credentials,
    '/uapi/domestic-stock/v1/trading/inquire-balance',
    credentials.paper ? 'VTTC8434R' : 'TTTC8434R',
    {
      CANO: credentials.accountNo,
      ACNT_PRDT_CD: credentials.accountProductCode || '01',
      AFHR_FLPR_YN: 'N',
      OFL_YN: '',
      INQR_DVSN: '02',
      UNPR_DVSN: '01',
      FUND_STTL_ICLD_YN: 'N',
      FNCG_AMT_AUTO_RDPT_YN: 'N',
      PRCS_DVSN: '00',
      CTX_AREA_FK100: '',
      CTX_AREA_NK100: '',
    },
  )

  return (data.output1 || []).map((row) => {
    const quantity = Number(row.hldg_qty || 0)
    const averagePrice = Number(row.pchs_avg_pric || 0)
    const marketPrice = Number(row.prpr || 0) || null
    const marketValue = Number(row.evlu_amt || 0) || null
    const profitLoss = Number(row.evlu_pfls_amt || 0) || null
    const returnRate = Number(row.evlu_pfls_rt || 0) || null
    return {
      id: row.pdno || row.prdt_name || randomUUID(),
      symbol: row.pdno,
      name: row.prdt_name || row.pdno,
      sector: '미분류',
      quantity,
      averagePrice,
      expectedDividend: 0,
      marketPrice,
      marketValue,
      profitLoss,
      returnRate,
      weight: null,
      source: source('NEAR_REALTIME', credentials.paper ? 'KIS 모의투자 잔고입니다.' : 'KIS 실전투자 잔고입니다.'),
    }
  })
}

const emptyExecutions = (state: SourceMeta['state'], message: string): ExecutionPayload => ({
  source: source(state, message, 'KIS Trading API'),
  items: [],
})

const normalizeExecutionSide = (code: string, label: string): ExecutionItem['side'] => {
  if (code === '02' || label.includes('매수')) return 'buy'
  if (code === '01' || label.includes('매도')) return 'sell'
  return 'unknown'
}

const executionFromRow = (row: Record<string, string>, rowIndex: number, itemSource: SourceMeta): ExecutionItem => {
  const orderQuantity = numberOrNull(row.ord_qty)
  const filledQuantity = numberOrNull(row.tot_ccld_qty ?? row.ccld_qty)
  const remainingQuantity = numberOrNull(row.rmn_qty) ?? (orderQuantity != null && filledQuantity != null ? Math.max(orderQuantity - filledQuantity, 0) : null)
  const sideCode = row.sll_buy_dvsn_cd || row.trad_dvsn_cd || ''
  const sideLabel = row.sll_buy_dvsn_cd_name || row.trad_dvsn_name || sideCode || '--'
  const status =
    row.ccld_dvsn_name ||
    (filledQuantity && remainingQuantity ? '부분체결' : filledQuantity ? '체결' : row.rjct_qty && row.rjct_qty !== '0' ? '거부' : '미체결')

  return {
    id: `${row.ord_dt || row.odno || 'execution'}-${row.odno || row.pdno || rowIndex}`,
    orderDate: kisDateOrNull(row.ord_dt),
    orderNo: row.odno || '--',
    symbol: row.pdno || '--',
    name: row.prdt_name || row.prdt_abrv_name || row.pdno || '--',
    side: normalizeExecutionSide(sideCode, sideLabel),
    sideLabel,
    orderQuantity,
    filledQuantity,
    remainingQuantity,
    orderPrice: numberOrNull(row.ord_unpr),
    filledPrice: numberOrNull(row.avg_prvs ?? row.avg_pric ?? row.ccld_unpr),
    filledAmount: numberOrNull(row.tot_ccld_amt ?? row.ccld_amt),
    orderType: row.ord_dvsn_name || row.ord_dvsn_cd || '--',
    status,
    source: itemSource,
  }
}

export const getTradeExecutions = async (settings: UserSettings): Promise<ExecutionPayload> => {
  const credentials = credentialsFromSettings(settings)
  if (!credentials) return emptyExecutions('API_REQUIRED', 'KIS App Key/App Secret이 필요합니다.')
  if (!credentials.accountNo) return emptyExecutions('API_REQUIRED', 'KIS 계좌번호(CANO)가 필요합니다.')

  const end = new Date()
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)
  try {
    const data = await kisGet<{ output1?: Record<string, string>[]; output2?: Record<string, string>[] }>(
      credentials,
      '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
      credentials.paper ? 'VTTC8001R' : 'TTTC8001R',
      {
        CANO: credentials.accountNo,
        ACNT_PRDT_CD: credentials.accountProductCode || '01',
        INQR_STRT_DT: compactDate(start),
        INQR_END_DT: compactDate(end),
        SLL_BUY_DVSN_CD: '00',
        INQR_DVSN: '00',
        PDNO: '',
        CCLD_DVSN: '00',
        ORD_GNO_BRNO: '',
        ODNO: '',
        INQR_DVSN_3: '00',
        INQR_DVSN_1: '',
        EXCG_ID_DVSN_CD: 'KRX',
        CTX_AREA_FK100: '',
        CTX_AREA_NK100: '',
      },
    )
    const rows = [data.output1, data.output2]
      .flatMap((output) => (Array.isArray(output) ? output : []))
      .filter((row) => row.pdno || row.odno)
    const itemSource = source('NEAR_REALTIME', credentials.paper ? 'KIS 모의투자 주식일별주문체결조회입니다.' : 'KIS 실전투자 주식일별주문체결조회입니다.', 'KIS Trading API')
    const items = rows.map((row, index) => executionFromRow(row, index, itemSource))
    return {
      source: source(items.length ? 'NEAR_REALTIME' : 'NO_DATA', items.length ? '최근 30일 KIS 주식일별주문체결조회입니다.' : '최근 30일 조회된 주문/체결 내역이 없습니다.', 'KIS Trading API'),
      items,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'KIS 체결 내역 조회 오류'
    return emptyExecutions(message.startsWith('RATE_LIMIT:') ? 'RATE_LIMITED' : 'ERROR', message.replace('RATE_LIMIT:', ''))
  }
}

export const canUseLiveTrading = (settings: UserSettings, mode: TradingMode) =>
  mode === 'paper' || (config.allowLiveTrading && settings.liveTradingEnabled && !settings.kisPaperTrading)

export const placeOrder = async (
  settings: UserSettings,
  request: {
    mode: TradingMode
    side: 'buy' | 'sell'
    symbol: string
    quantity: number
    orderType: 'market' | 'limit'
    price?: number
    liveConfirm?: string
  },
) => {
  const credentials = credentialsFromSettings(settings)
  if (!credentials || !credentials.accountNo) {
    return {
      accepted: false,
      source: source('API_REQUIRED', 'KIS App Key/App Secret과 계좌번호가 필요합니다.'),
      message: 'API 키 또는 계좌 정보가 없어 주문을 전송하지 않았습니다.',
    }
  }
  if (!canUseLiveTrading(settings, request.mode)) {
    return {
      accepted: false,
      source: source('API_REQUIRED', '실전투자 주문은 설정과 서버 환경변수 ALLOW_LIVE_TRADING=true가 모두 필요합니다.'),
      message: '실전투자 주문이 비활성화되어 있습니다.',
    }
  }
  if (request.mode === 'live' && request.liveConfirm !== '실전투자 주문') {
    return {
      accepted: false,
      source: source('API_REQUIRED', '실전투자 확인 문구가 일치하지 않습니다.'),
      message: '확인 문구가 없어 실전 주문을 차단했습니다.',
    }
  }

  const usingPaper = request.mode === 'paper'
  const orderCredentials = { ...credentials, paper: usingPaper }
  const trId = usingPaper
    ? request.side === 'buy'
      ? 'VTTC0802U'
      : 'VTTC0801U'
    : request.side === 'buy'
      ? 'TTTC0802U'
      : 'TTTC0801U'
  const body = {
    CANO: credentials.accountNo,
    ACNT_PRDT_CD: credentials.accountProductCode || '01',
    PDNO: request.symbol,
    ORD_DVSN: request.orderType === 'market' ? '01' : '00',
    ORD_QTY: String(request.quantity),
    ORD_UNPR: request.orderType === 'market' ? '0' : String(request.price || 0),
  }

  const data = await kisPost<Record<string, unknown>>(
    orderCredentials,
    '/uapi/domestic-stock/v1/trading/order-cash',
    trId,
    body,
    true,
  )
  return {
    accepted: true,
    source: source('NEAR_REALTIME', usingPaper ? 'KIS 모의투자 주문 응답입니다.' : 'KIS 실전투자 주문 응답입니다.'),
    message: usingPaper ? '모의투자 주문이 전송되었습니다.' : '실전투자 주문이 전송되었습니다.',
    response: data,
  }
}
