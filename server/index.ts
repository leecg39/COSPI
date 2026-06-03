import cookieParser from 'cookie-parser'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { analyzeWithAi } from './ai.ts'
import { config, isProduction } from './config.ts'
import { getDartFilings } from './dart.ts'
import { getChart, getDomesticIndexQuotes, getFinancials, getOptionChain, getQuotes, getTradeExecutions, placeOrder, source } from './kis.ts'
import { getMacroSnapshot } from './macro.ts'
import { getMarketNews } from './news.ts'
import { getPortfolio } from './portfolio.ts'
import {
  authenticateUser,
  appendPortfolioSnapshot,
  createSession,
  createUser,
  destroySession,
  getSettings,
  getUserBySession,
  getUserProfile,
  toPublicSettings,
  updateSettings,
} from './store.ts'
import type { ChartInterval, ChartRange, TradingMode, UserSettings } from './types.ts'

const app = express()
const sessionCookie = 'cospi_session'

app.use(express.json({ limit: '1mb' }))
app.use(cookieParser(config.sessionSecret))

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProduction,
  maxAge: 1000 * 60 * 60 * 24 * 7,
  signed: true,
}

const currentUser = (req: express.Request) => getUserBySession(req.signedCookies?.[sessionCookie])

const currentSettings = (req: express.Request): UserSettings => getSettings(currentUser(req)?.id)

const requireUser: express.RequestHandler = (req, res, next) => {
  const user = currentUser(req)
  if (!user) {
    res.status(401).json({ message: '로그인이 필요합니다.' })
    return
  }
  res.locals.user = user
  next()
}

const normalizeSymbols = (value: unknown) => {
  const raw = typeof value === 'string' ? value : '005930,000660,035420,069500'
  return raw
    .split(',')
    .map((symbol) => symbol.trim())
    .filter((symbol) => /^[A-Z0-9/]{2,12}$/.test(symbol))
    .slice(0, 20)
}

const isChartRange = (value: string): value is ChartRange => ['1M', '3M', '6M', '1Y', '2Y', '5Y', '10Y'].includes(value)

const isChartInterval = (value: string): value is ChartInterval => ['1D', '1W', '1M'].includes(value)

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'COSPI WTS',
    time: new Date().toISOString(),
  })
})

app.get('/api/providers/status', (req, res) => {
  const settings = currentSettings(req)
  res.json({
    kis: {
      configured: Boolean(settings.kisAppKey && settings.kisAppSecret),
      accountConfigured: Boolean(settings.kisAccountNo),
      accountStatus: settings.kisAccountNo ? 'connected' : config.kis.accountNoInvalid ? 'invalid' : 'missing',
      paperDefault: settings.kisPaperTrading,
      baseUrl: settings.kisPaperTrading ? config.kis.paperBaseUrl : config.kis.realBaseUrl,
    },
    dart: { configured: Boolean(settings.dartApiKey) },
    gemini: { configured: Boolean(settings.geminiApiKey), model: settings.geminiModel },
    liveTrading: {
      serverEnabled: config.allowLiveTrading,
      userEnabled: settings.liveTradingEnabled,
    },
  })
})

app.get('/api/auth/me', (req, res) => {
  const user = currentUser(req)
  if (!user) {
    res.json({ user: null, settings: toPublicSettings(getSettings(undefined)) })
    return
  }
  const profile = getUserProfile(user.id)
  res.json({ user: profile, settings: toPublicSettings(getSettings(user.id)) })
})

app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string }
  if (!email || !password || password.length < 8) {
    res.status(400).json({ message: '이메일과 8자 이상 비밀번호가 필요합니다.' })
    return
  }
  try {
    const user = await createUser(email, password)
    const token = createSession(user.id)
    res.cookie(sessionCookie, token, cookieOptions)
    res.status(201).json({ user, settings: toPublicSettings(getSettings(user.id)) })
  } catch (error) {
    res.status(409).json({ message: error instanceof Error ? error.message : '회원가입 실패' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string }
  if (!email || !password) {
    res.status(400).json({ message: '이메일과 비밀번호가 필요합니다.' })
    return
  }
  const user = await authenticateUser(email, password)
  if (!user) {
    res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' })
    return
  }
  const token = createSession(user.id)
  res.cookie(sessionCookie, token, cookieOptions)
  res.json({ user, settings: toPublicSettings(getSettings(user.id)) })
})

app.post('/api/auth/logout', (req, res) => {
  destroySession(req.signedCookies?.[sessionCookie])
  res.clearCookie(sessionCookie)
  res.json({ ok: true })
})

app.get('/api/settings', requireUser, (_req, res) => {
  res.json({ settings: toPublicSettings(getSettings(res.locals.user.id)) })
})

app.put('/api/settings', requireUser, (req, res) => {
  const settings = updateSettings(res.locals.user.id, req.body as Partial<UserSettings>)
  res.json({ settings })
})

app.get('/api/market/quotes', async (req, res) => {
  const quotes = await getQuotes(normalizeSymbols(req.query.symbols), currentSettings(req))
  res.json({ source: quotes[0]?.source || source('NO_DATA', '조회 종목이 없습니다.'), quotes })
})

app.get('/api/market/chart', async (req, res) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : '005930'
  const rangeRaw = typeof req.query.range === 'string' ? req.query.range : '1Y'
  const intervalRaw = typeof req.query.interval === 'string' ? req.query.interval : '1D'
  const range = isChartRange(rangeRaw) ? rangeRaw : '1Y'
  const interval = isChartInterval(intervalRaw) ? intervalRaw : '1D'
  res.json(await getChart(symbol, range, interval, currentSettings(req)))
})

app.get('/api/market/macro', async (req, res) => {
  res.json(await getMacroSnapshot(currentSettings(req)))
})

app.get('/api/market/indices', async (req, res) => {
  const indices = await getDomesticIndexQuotes(currentSettings(req))
  res.json({ source: indices[0]?.source || source('NO_DATA', '국내 지수 항목이 없습니다.'), indices })
})

app.get('/api/market/options', async (req, res) => {
  const month = typeof req.query.month === 'string' ? req.query.month : undefined
  res.json(await getOptionChain(currentSettings(req), month))
})

app.get('/api/news', async (_req, res) => {
  res.json(await getMarketNews())
})

app.get('/api/research/dart', async (req, res) => {
  const corpCode = typeof req.query.corpCode === 'string' ? req.query.corpCode : undefined
  const stockCode = typeof req.query.stockCode === 'string' ? req.query.stockCode : undefined
  res.json(await getDartFilings(currentSettings(req), corpCode, stockCode))
})

app.get('/api/research/financials', async (req, res) => {
  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : '005930'
  res.json(await getFinancials(currentSettings(req), symbol))
})

app.post('/api/ai/analyze', async (req, res) => {
  const { prompt } = req.body as { prompt?: string }
  if (!prompt?.trim()) {
    res.status(400).json({ message: '분석할 텍스트가 필요합니다.' })
    return
  }
  res.json(await analyzeWithAi(currentSettings(req), prompt))
})

app.get('/api/portfolio', requireUser, async (_req, res) => {
  const portfolio = await getPortfolio(getSettings(res.locals.user.id))
  const snapshots = appendPortfolioSnapshot(res.locals.user.id, portfolio.totalValue, portfolio.totalProfitLoss)
  res.json({ ...portfolio, snapshots })
})

app.put('/api/portfolio/manual', requireUser, (req, res) => {
  const current = getSettings(res.locals.user.id)
  const manualPortfolio = Array.isArray(req.body.manualPortfolio) ? req.body.manualPortfolio : current.manualPortfolio
  const settings = updateSettings(res.locals.user.id, { manualPortfolio })
  res.json({ settings })
})

app.get('/api/portfolio/executions', requireUser, async (_req, res) => {
  res.json(await getTradeExecutions(getSettings(res.locals.user.id)))
})

app.post('/api/orders', requireUser, async (req, res) => {
  const body = (req.body || {}) as {
    mode?: TradingMode
    side?: 'buy' | 'sell'
    symbol?: string
    quantity?: number
    orderType?: 'market' | 'limit'
    price?: number
    liveConfirm?: string
  }
  if (!body.mode || !body.side || !body.symbol || !body.quantity || !body.orderType) {
    res.status(400).json({ message: 'mode, side, symbol, quantity, orderType이 필요합니다.' })
    return
  }
  try {
    res.json(
      await placeOrder(getSettings(res.locals.user.id), {
        mode: body.mode,
        side: body.side,
        symbol: body.symbol,
        quantity: body.quantity,
        orderType: body.orderType,
        price: body.price,
        liveConfirm: body.liveConfirm,
      }),
    )
  } catch (error) {
    res.status(502).json({
      accepted: false,
      source: source('ERROR', error instanceof Error ? error.message : '주문 전송 오류'),
      message: '주문 전송 중 오류가 발생했습니다.',
    })
  }
})

const distPath = path.join(config.rootDir, 'dist')
if (isProduction && fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.listen(config.port, () => {
  console.log(`COSPI WTS server listening on http://localhost:${config.port}`)
})
