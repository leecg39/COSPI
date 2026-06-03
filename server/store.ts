import fs from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { config, normalizeKisAccountNo, normalizeKisAccountProductCode } from './config.ts'
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from './security.ts'
import type { AlertRule, ManualHolding, PortfolioSnapshot, PublicSettings, UserSettings } from './types.ts'

type StoredUser = {
  id: string
  email: string
  passwordHash: string
  createdAt: string
  settings: StoredSettings
}

type StoredSettings = {
  kisAppKey?: string
  kisAppSecret?: string
  kisAccountNo?: string
  kisAccountProductCode?: string
  kisPaperTrading: boolean
  liveTradingEnabled: boolean
  dartApiKey?: string
  geminiApiKey?: string
  geminiModel: string
  watchlist: string[]
  manualPortfolio: ManualHolding[]
  portfolioSnapshots?: PortfolioSnapshot[]
  alertRules?: AlertRule[]
  layout?: unknown
}

type Session = {
  userId: string
  expiresAt: string
}

type StoreData = {
  users: StoredUser[]
  sessions: Record<string, Session>
}

const storePath = path.join(config.dataDir, 'store.json')

const defaultWatchlist = ['005930', '000660', '035420', '051910', '069500']

const ensureStore = () => {
  fs.mkdirSync(config.dataDir, { recursive: true })
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify({ users: [], sessions: {} }, null, 2))
  }
}

const readStore = (): StoreData => {
  ensureStore()
  return JSON.parse(fs.readFileSync(storePath, 'utf8')) as StoreData
}

const writeStore = (data: StoreData) => {
  ensureStore()
  const tempPath = `${storePath}.${process.pid}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2))
  fs.renameSync(tempPath, storePath)
}

const defaultStoredSettings = (): StoredSettings => ({
  kisPaperTrading: config.kis.usePaper,
  liveTradingEnabled: false,
  geminiModel: config.geminiModel,
  watchlist: defaultWatchlist,
  manualPortfolio: [],
  portfolioSnapshots: [],
  alertRules: [],
})

const decryptSettings = (settings: StoredSettings): UserSettings => ({
  kisAppKey: decryptSecret(settings.kisAppKey),
  kisAppSecret: decryptSecret(settings.kisAppSecret),
  kisAccountNo: settings.kisAccountNo,
  kisAccountProductCode: settings.kisAccountProductCode || '01',
  kisPaperTrading: settings.kisPaperTrading,
  liveTradingEnabled: settings.liveTradingEnabled,
  dartApiKey: decryptSecret(settings.dartApiKey),
  geminiApiKey: decryptSecret(settings.geminiApiKey),
  geminiModel: settings.geminiModel || config.geminiModel,
  watchlist: settings.watchlist?.length ? settings.watchlist : defaultWatchlist,
  manualPortfolio: settings.manualPortfolio || [],
  portfolioSnapshots: settings.portfolioSnapshots || [],
  alertRules: settings.alertRules || [],
  layout: settings.layout,
})

export const toPublicSettings = (settings: UserSettings): PublicSettings => ({
  kisAccountNo: settings.kisAccountNo,
  kisAccountProductCode: settings.kisAccountProductCode,
  kisPaperTrading: settings.kisPaperTrading,
  liveTradingEnabled: settings.liveTradingEnabled,
  geminiModel: settings.geminiModel,
  watchlist: settings.watchlist,
  manualPortfolio: settings.manualPortfolio,
  portfolioSnapshots: settings.portfolioSnapshots,
  alertRules: settings.alertRules,
  layout: settings.layout,
  hasKisKeys: Boolean(settings.kisAppKey && settings.kisAppSecret),
  kisAccountStatus: settings.kisAccountNo ? 'connected' : config.kis.accountNoInvalid ? 'invalid' : 'missing',
  hasDartKey: Boolean(settings.dartApiKey),
  hasGeminiKey: Boolean(settings.geminiApiKey),
})

export const createUser = async (email: string, password: string) => {
  const normalizedEmail = email.trim().toLowerCase()
  const data = readStore()
  if (data.users.some((user) => user.email === normalizedEmail)) {
    throw new Error('이미 등록된 이메일입니다.')
  }
  const user: StoredUser = {
    id: nanoid(),
    email: normalizedEmail,
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
    settings: defaultStoredSettings(),
  }
  data.users.push(user)
  writeStore(data)
  return { id: user.id, email: user.email }
}

export const authenticateUser = async (email: string, password: string) => {
  const normalizedEmail = email.trim().toLowerCase()
  const data = readStore()
  const user = data.users.find((candidate) => candidate.email === normalizedEmail)
  if (!user) return null
  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) return null
  return { id: user.id, email: user.email }
}

export const createSession = (userId: string) => {
  const data = readStore()
  const token = nanoid(48)
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
  data.sessions[token] = { userId, expiresAt }
  writeStore(data)
  return token
}

export const destroySession = (token: string | undefined) => {
  if (!token) return
  const data = readStore()
  delete data.sessions[token]
  writeStore(data)
}

export const getUserBySession = (token: string | undefined) => {
  if (!token) return null
  const data = readStore()
  const session = data.sessions[token]
  if (!session) return null
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    delete data.sessions[token]
    writeStore(data)
    return null
  }
  const user = data.users.find((candidate) => candidate.id === session.userId)
  return user ? { id: user.id, email: user.email } : null
}

export const getSettings = (userId: string | undefined): UserSettings => {
  const userSettings = userId ? readStore().users.find((user) => user.id === userId)?.settings : undefined
  const settings = userSettings ? decryptSettings(userSettings) : decryptSettings(defaultStoredSettings())
  return {
    ...decryptSettings(defaultStoredSettings()),
    ...settings,
    kisAppKey: settings.kisAppKey || config.kis.appKey,
    kisAppSecret: settings.kisAppSecret || config.kis.appSecret,
    kisAccountNo: normalizeKisAccountNo(settings.kisAccountNo) || config.kis.accountNo,
    kisAccountProductCode: normalizeKisAccountProductCode(settings.kisAccountProductCode || config.kis.accountProductCode),
    kisPaperTrading: settings.kisPaperTrading ?? config.kis.usePaper,
    dartApiKey: settings.dartApiKey || config.dartApiKey,
    geminiApiKey: settings.geminiApiKey || config.geminiApiKey,
    geminiModel: settings.geminiModel || config.geminiModel,
  }
}

export const updateSettings = (userId: string, patch: Partial<UserSettings>) => {
  const data = readStore()
  const user = data.users.find((candidate) => candidate.id === userId)
  if (!user) throw new Error('사용자를 찾을 수 없습니다.')
  const current = user.settings

  user.settings = {
    ...current,
    kisAppKey: patch.kisAppKey === undefined ? current.kisAppKey : encryptSecret(patch.kisAppKey),
    kisAppSecret: patch.kisAppSecret === undefined ? current.kisAppSecret : encryptSecret(patch.kisAppSecret),
    kisAccountNo: patch.kisAccountNo === undefined ? current.kisAccountNo : normalizeKisAccountNo(patch.kisAccountNo),
    kisAccountProductCode: patch.kisAccountProductCode === undefined ? current.kisAccountProductCode : normalizeKisAccountProductCode(patch.kisAccountProductCode),
    kisPaperTrading: patch.kisPaperTrading ?? current.kisPaperTrading,
    liveTradingEnabled: patch.liveTradingEnabled ?? current.liveTradingEnabled,
    dartApiKey: patch.dartApiKey === undefined ? current.dartApiKey : encryptSecret(patch.dartApiKey),
    geminiApiKey: patch.geminiApiKey === undefined ? current.geminiApiKey : encryptSecret(patch.geminiApiKey),
    geminiModel: patch.geminiModel ?? current.geminiModel,
    watchlist: patch.watchlist ?? current.watchlist,
    manualPortfolio: patch.manualPortfolio ?? current.manualPortfolio,
    portfolioSnapshots: patch.portfolioSnapshots ?? current.portfolioSnapshots,
    alertRules: patch.alertRules ?? current.alertRules,
    layout: patch.layout ?? current.layout,
  }

  writeStore(data)
  return toPublicSettings(getSettings(userId))
}

export const getUserProfile = (userId: string) => {
  const user = readStore().users.find((candidate) => candidate.id === userId)
  return user ? { id: user.id, email: user.email } : null
}

export const appendPortfolioSnapshot = (userId: string, totalValue: number, totalProfitLoss: number) => {
  const data = readStore()
  const user = data.users.find((candidate) => candidate.id === userId)
  if (!user) return []

  const current = user.settings.portfolioSnapshots || []
  if (totalValue <= 0) return current

  const now = new Date()
  const latest = current.at(-1)
  const snapshot = {
    time: now.toISOString(),
    totalValue,
    totalProfitLoss,
  }
  const next =
    latest && now.getTime() - new Date(latest.time).getTime() < 1000 * 60 * 10
      ? [...current.slice(0, -1), snapshot]
      : [...current, snapshot]

  user.settings.portfolioSnapshots = next.slice(-120)
  writeStore(data)
  return user.settings.portfolioSnapshots
}
