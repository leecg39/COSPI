import fs from 'node:fs'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import { config } from './config.ts'
import { source } from './kis.ts'
import type { FilingItem, UserSettings } from './types.ts'

type DartListResponse = {
  status: string
  message: string
  list?: Array<{
    corp_name: string
    corp_code: string
    stock_code?: string
    report_nm: string
    rcept_no: string
    rcept_dt: string
  }>
}

type DartCorpCodeEntry = {
  corpCode: string
  corpName: string
  stockCode: string
  modifyDate: string
}

type DartCorpCodeCache = {
  fetchedAt: string
  entries: DartCorpCodeEntry[]
}

type DartCorpCodeXml = {
  result?: {
    list?: Array<{
      corp_code?: string
      corp_name?: string
      stock_code?: string
      modify_date?: string
    }> | {
      corp_code?: string
      corp_name?: string
      stock_code?: string
      modify_date?: string
    }
  }
}

const dartXmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
})

const corpCodeCachePath = path.join(config.dataDir, 'dart-corp-codes.json')
const corpCodeCacheTtlMs = 1000 * 60 * 60 * 24 * 7
let corpCodeCache: { expiresAt: number; entries: DartCorpCodeEntry[]; byStockCode: Map<string, DartCorpCodeEntry> } | null = null

const formatDartDate = (date: string) => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`

const compactDate = (date: Date) => {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}

const normalizeStockCode = (stockCode?: string) => {
  const normalized = stockCode?.trim()
  return normalized && /^\d{6}$/.test(normalized) ? normalized : undefined
}

const indexCorpEntries = (entries: DartCorpCodeEntry[]) => ({
  entries,
  byStockCode: new Map(entries.map((entry) => [entry.stockCode, entry])),
})

const readCorpCodeCacheFile = (): DartCorpCodeCache | null => {
  if (!fs.existsSync(corpCodeCachePath)) return null
  const stat = fs.statSync(corpCodeCachePath)
  if (Date.now() - stat.mtimeMs > corpCodeCacheTtlMs) return null
  return JSON.parse(fs.readFileSync(corpCodeCachePath, 'utf8')) as DartCorpCodeCache
}

const writeCorpCodeCacheFile = (cache: DartCorpCodeCache) => {
  fs.mkdirSync(config.dataDir, { recursive: true })
  const tempPath = `${corpCodeCachePath}.${process.pid}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(cache))
  fs.renameSync(tempPath, corpCodeCachePath)
}

const downloadCorpCodeEntries = async (apiKey: string) => {
  const url = new URL('https://opendart.fss.or.kr/api/corpCode.xml')
  url.searchParams.set('crtfc_key', apiKey)
  const response = await fetch(url)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!response.ok) throw new Error(`OpenDART 기업 고유번호 응답 오류 ${response.status}`)
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    const text = strFromU8(bytes)
    const parsed = dartXmlParser.parse(text) as { result?: { message?: string } }
    throw new Error(parsed.result?.message || 'OpenDART 기업 고유번호 파일이 ZIP 형식이 아닙니다.')
  }

  const files = unzipSync(bytes)
  const xmlFile = Object.entries(files).find(([name]) => name.toLowerCase().endsWith('.xml'))?.[1]
  if (!xmlFile) throw new Error('OpenDART 기업 고유번호 ZIP 안에서 XML 파일을 찾지 못했습니다.')

  const parsed = dartXmlParser.parse(strFromU8(xmlFile)) as DartCorpCodeXml
  const rawList = parsed.result?.list
  const list = Array.isArray(rawList) ? rawList : rawList ? [rawList] : []
  return list
    .map((item) => ({
      corpCode: item.corp_code || '',
      corpName: item.corp_name || '',
      stockCode: item.stock_code || '',
      modifyDate: item.modify_date || '',
    }))
    .filter((item) => item.corpCode && /^\d{6}$/.test(item.stockCode))
}

const getCorpCodeIndex = async (apiKey: string) => {
  if (corpCodeCache && corpCodeCache.expiresAt > Date.now()) return corpCodeCache

  const cached = readCorpCodeCacheFile()
  if (cached) {
    corpCodeCache = { ...indexCorpEntries(cached.entries), expiresAt: Date.now() + corpCodeCacheTtlMs }
    return corpCodeCache
  }

  const entries = await downloadCorpCodeEntries(apiKey)
  writeCorpCodeCacheFile({ fetchedAt: new Date().toISOString(), entries })
  corpCodeCache = { ...indexCorpEntries(entries), expiresAt: Date.now() + corpCodeCacheTtlMs }
  return corpCodeCache
}

export const getDartFilings = async (settings: UserSettings, corpCode?: string, stockCode?: string) => {
  const apiKey = settings.dartApiKey
  if (!apiKey) {
    return {
      source: source('API_REQUIRED', 'OpenDART 인증키가 필요합니다.', 'OpenDART'),
      items: [] as FilingItem[],
    }
  }

  const normalizedStockCode = normalizeStockCode(stockCode)
  let resolvedCorpCode = corpCode
  let resolvedCorpName: string | undefined

  if (!resolvedCorpCode && normalizedStockCode) {
    try {
      const corpIndex = await getCorpCodeIndex(apiKey)
      const entry = corpIndex.byStockCode.get(normalizedStockCode)
      if (!entry) {
        return {
          source: source('NO_DATA', `${normalizedStockCode}에 해당하는 OpenDART 기업 고유번호가 없습니다.`, 'OpenDART'),
          items: [] as FilingItem[],
        }
      }
      resolvedCorpCode = entry.corpCode
      resolvedCorpName = entry.corpName
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenDART 기업 고유번호 조회 오류'
      return {
        source: source(message.includes('초과') ? 'RATE_LIMITED' : 'ERROR', message, 'OpenDART'),
        items: [] as FilingItem[],
      }
    }
  }

  const url = new URL('https://opendart.fss.or.kr/api/list.json')
  url.searchParams.set('crtfc_key', apiKey)
  if (resolvedCorpCode) url.searchParams.set('corp_code', resolvedCorpCode)
  if (!resolvedCorpCode && normalizedStockCode) url.searchParams.set('stock_code', normalizedStockCode)
  const bgnDate = new Date()
  bgnDate.setMonth(bgnDate.getMonth() - (resolvedCorpCode ? 24 : 3))
  url.searchParams.set('bgn_de', compactDate(bgnDate))
  url.searchParams.set('page_count', '20')
  url.searchParams.set('sort', 'date')
  url.searchParams.set('sort_mth', 'desc')

  try {
    const response = await fetch(url)
    const data = (await response.json()) as DartListResponse
    if (!response.ok || data.status !== '000') {
      const state = data.status === '020' ? 'RATE_LIMITED' : data.status === '013' ? 'NO_DATA' : 'ERROR'
      return {
        source: source(state, data.message || `OpenDART 오류 ${response.status}`, 'OpenDART'),
        items: [] as FilingItem[],
      }
    }
    const items = (data.list || []).map((item) => ({
      id: item.rcept_no,
      corpName: item.corp_name,
      stockCode: item.stock_code || normalizedStockCode || null,
      reportName: item.report_nm,
      receiptNo: item.rcept_no,
      filedAt: formatDartDate(item.rcept_dt),
      link: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`,
      source: source('DELAYED', 'OpenDART 공시 목록입니다.', 'OpenDART'),
    }))
    return {
      source: source(
        items.length ? 'DELAYED' : 'NO_DATA',
        items.length
          ? `${resolvedCorpName ? `${resolvedCorpName} ` : ''}OpenDART 공시 목록입니다.`
          : `${resolvedCorpName || normalizedStockCode || '선택 항목'}의 공시 항목이 없습니다.`,
        'OpenDART',
      ),
      items,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OpenDART 조회 오류'
    return {
      source: source('ERROR', message, 'OpenDART'),
      items: [] as FilingItem[],
    }
  }
}
