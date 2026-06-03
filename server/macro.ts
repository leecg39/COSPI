import { getKisMacroQuotes, source } from './kis.ts'
import type { Quote, SourceMeta, UserSettings } from './types.ts'

type MacroSnapshot = {
  source: SourceMeta
  items: Quote[]
}

let macroCache: { key: string; expiresAt: number; value: MacroSnapshot } | null = null

export const getMacroSnapshot = async (settings: UserSettings): Promise<MacroSnapshot> => {
  const cacheKey = `${settings.kisPaperTrading}:${settings.kisAppKey || ''}`
  if (macroCache && macroCache.key === cacheKey && macroCache.expiresAt > Date.now()) return macroCache.value

  const items = await getKisMacroQuotes(settings)
  const state: SourceMeta['state'] = items.some((item) => item.source.state === 'ERROR')
    ? 'ERROR'
    : items.some((item) => item.source.state === 'RATE_LIMITED')
      ? 'RATE_LIMITED'
      : items.some((item) => item.source.state === 'NEAR_REALTIME')
        ? 'NEAR_REALTIME'
        : items.some((item) => item.source.state === 'API_REQUIRED')
          ? 'API_REQUIRED'
          : 'NO_DATA'

  const value = {
    source: source(state, 'KIS 해외지수/환율/금리 API를 사용합니다.'),
    items,
  }
  if (state !== 'ERROR' && state !== 'RATE_LIMITED') {
    macroCache = { key: cacheKey, expiresAt: Date.now() + 30_000, value }
  }
  return value
}
