export type DataState =
  | 'REALTIME'
  | 'NEAR_REALTIME'
  | 'DELAYED'
  | 'API_REQUIRED'
  | 'NO_DATA'
  | 'RATE_LIMITED'
  | 'ERROR'

export type SourceMeta = {
  provider: string
  state: DataState
  label: string
  asOf?: string
  message?: string
}

export type Quote = {
  symbol: string
  name: string
  market: 'KOSPI' | 'KOSDAQ' | 'ETF' | 'INDEX' | 'FX' | 'RATE' | 'GLOBAL'
  currency: 'KRW' | 'USD' | 'POINT' | 'PERCENT'
  price: number | null
  change: number | null
  changeRate: number | null
  volume: number | null
  source: SourceMeta
}

export type OptionMonth = {
  code: string
  month: string
  label: string
}

export type OptionContract = {
  code: string
  strike: number | null
  price: number | null
  change: number | null
  changeRate: number | null
  bid: number | null
  ask: number | null
  volume: number | null
  openInterest: number | null
  impliedVolatility: number | null
  delta: number | null
  moneyness: string | null
  source: SourceMeta
}

export type OptionChainPayload = {
  source: SourceMeta
  months: OptionMonth[]
  selectedMonth: string | null
  calls: OptionContract[]
  puts: OptionContract[]
}

export type Candle = {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type ChartRange = '1M' | '3M' | '6M' | '1Y' | '2Y' | '5Y' | '10Y'

export type ChartInterval = '1D' | '1W' | '1M'

export type ChartPayload = {
  symbol: string
  range: ChartRange
  interval: ChartInterval
  candles: Candle[]
  source: SourceMeta
}

export type PortfolioSnapshot = {
  time: string
  totalValue: number
  totalProfitLoss: number
}

export type ExecutionItem = {
  id: string
  orderDate: string | null
  orderNo: string
  symbol: string
  name: string
  side: 'buy' | 'sell' | 'unknown'
  sideLabel: string
  orderQuantity: number | null
  filledQuantity: number | null
  remainingQuantity: number | null
  orderPrice: number | null
  filledPrice: number | null
  filledAmount: number | null
  orderType: string
  status: string
  source: SourceMeta
}

export type ExecutionPayload = {
  source: SourceMeta
  items: ExecutionItem[]
}

export type AlertRule = {
  id: string
  symbol: string
  condition: 'above' | 'below'
  targetPrice: number
  enabled: boolean
  createdAt: string
}

export type NewsItem = {
  id: string
  title: string
  link: string
  publisher: string
  publishedAt: string | null
  summary: string
  sentiment: 'positive' | 'neutral' | 'negative'
  importance: 'high' | 'medium' | 'low'
  relatedSymbols: string[]
  source: SourceMeta
}

export type FilingItem = {
  id: string
  corpName: string
  stockCode: string | null
  reportName: string
  receiptNo: string
  filedAt: string
  link: string
  source: SourceMeta
}

export type FinancialRow = {
  period: string
  revenue: number | null
  operatingProfit: number | null
  netIncome: number | null
  totalAssets: number | null
  totalDebt: number | null
  totalEquity: number | null
  roe: number | null
  netMargin: number | null
  debtRatio: number | null
  currentRatio: number | null
}

export type FinancialPayload = {
  symbol: string
  source: SourceMeta
  rows: FinancialRow[]
}

export type ManualHolding = {
  id: string
  symbol: string
  name: string
  sector: string
  quantity: number
  averagePrice: number
  expectedDividend: number
}

export type PortfolioPosition = ManualHolding & {
  marketPrice: number | null
  marketValue: number | null
  profitLoss: number | null
  returnRate: number | null
  weight: number | null
  source: SourceMeta
}

export type PublicSettings = {
  kisAccountNo?: string
  kisAccountProductCode?: string
  kisPaperTrading: boolean
  liveTradingEnabled: boolean
  geminiModel: string
  watchlist: string[]
  manualPortfolio: ManualHolding[]
  portfolioSnapshots: PortfolioSnapshot[]
  alertRules: AlertRule[]
  layout?: unknown
  hasKisKeys: boolean
  kisAccountStatus: 'connected' | 'missing' | 'invalid'
  hasDartKey: boolean
  hasGeminiKey: boolean
}

export type User = {
  id: string
  email: string
}

export type AiResponse = {
  mode: 'gemini' | 'local-rule'
  answer: string
  source: SourceMeta
}
