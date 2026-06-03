import dotenv from 'dotenv'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(rootDir, '.env')
const loadedEnv = dotenv.config({ path: envPath, quiet: true }).parsed || {}

Object.entries(loadedEnv).forEach(([key, value]) => {
  if (!process.env[key]?.trim()) process.env[key] = value
})

const boolFromEnv = (value: string | undefined, fallback = false) => {
  if (value == null) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

export const normalizeKisAccountNo = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed && /^\d{8}$/.test(trimmed) ? trimmed : undefined
}

export const normalizeKisAccountProductCode = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed && /^\d{2}$/.test(trimmed) ? trimmed : '01'
}

const rawEnvValue = (key: string) => {
  if (!fs.existsSync(envPath)) return undefined
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = fs.readFileSync(envPath, 'utf8').match(new RegExp(`^\\s*${escaped}\\s*=\\s*(.*)$`, 'm'))
  return match?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2')
}

const rawKisAccountNo = process.env.KIS_ACCOUNT_NO?.trim() || rawEnvValue('KIS_ACCOUNT_NO')
const masterSecret = process.env.MASTER_KEY || process.env.SESSION_SECRET || 'cospi-local-development-key'

export const config = {
  rootDir,
  dataDir: process.env.DATA_DIR || path.join(rootDir, 'data'),
  port: Number(process.env.PORT || 4100),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'cospi-local-session-secret',
  masterKey: createHash('sha256').update(masterSecret).digest(),
  allowLiveTrading: boolFromEnv(process.env.ALLOW_LIVE_TRADING, false),
  kis: {
    realBaseUrl: process.env.KIS_REAL_BASE_URL || 'https://openapi.koreainvestment.com:9443',
    paperBaseUrl: process.env.KIS_PAPER_BASE_URL || 'https://openapivts.koreainvestment.com:29443',
    appKey: process.env.KIS_APP_KEY,
    appSecret: process.env.KIS_APP_SECRET,
    accountNoRawPresent: Boolean(rawKisAccountNo),
    accountNoInvalid: Boolean(rawKisAccountNo && !normalizeKisAccountNo(rawKisAccountNo)),
    accountNo: normalizeKisAccountNo(rawKisAccountNo),
    accountProductCode: normalizeKisAccountProductCode(process.env.KIS_ACCOUNT_PRODUCT_CODE),
    usePaper: boolFromEnv(process.env.KIS_USE_PAPER, true),
  },
  dartApiKey: process.env.DART_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
}

export const isProduction = config.nodeEnv === 'production'
