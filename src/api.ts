import type {
  AiResponse,
  ChartInterval,
  ChartPayload,
  ChartRange,
  ExecutionPayload,
  FilingItem,
  FinancialPayload,
  NewsItem,
  OptionChainPayload,
  PortfolioPosition,
  PortfolioSnapshot,
  PublicSettings,
  Quote,
  SourceMeta,
  User,
} from './types'

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof data.message === 'string' ? data.message : `요청 실패 ${response.status}`
    throw new Error(message)
  }
  return data as T
}

export const api = {
  me: () => request<{ user: User | null; settings: PublicSettings }>('/api/auth/me'),
  login: (email: string, password: string) =>
    request<{ user: User; settings: PublicSettings }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string) =>
    request<{ user: User; settings: PublicSettings }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  saveSettings: (settings: Record<string, unknown>) =>
    request<{ settings: PublicSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  quotes: (symbols: string[]) =>
    request<{ source: SourceMeta; quotes: Quote[] }>(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`),
  chart: (symbol: string, range: ChartRange, interval: ChartInterval) =>
    request<ChartPayload>(`/api/market/chart?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`),
  macro: () => request<{ source: SourceMeta; items: Quote[] }>('/api/market/macro'),
  indices: () => request<{ source: SourceMeta; indices: Quote[] }>('/api/market/indices'),
  options: (month?: string | null) =>
    request<OptionChainPayload>(`/api/market/options${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  news: () => request<{ source: SourceMeta; items: NewsItem[] }>('/api/news'),
  dart: (stockCode: string) =>
    request<{ source: SourceMeta; items: FilingItem[] }>(`/api/research/dart?stockCode=${encodeURIComponent(stockCode)}`),
  financials: (symbol: string) =>
    request<FinancialPayload>(`/api/research/financials?symbol=${encodeURIComponent(symbol)}`),
  ai: (prompt: string) =>
    request<AiResponse>('/api/ai/analyze', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),
  portfolio: () =>
    request<{ source: SourceMeta; totalValue: number; totalProfitLoss: number; positions: PortfolioPosition[]; snapshots: PortfolioSnapshot[] }>('/api/portfolio'),
  executions: () => request<ExecutionPayload>('/api/portfolio/executions'),
  saveManualPortfolio: (manualPortfolio: PublicSettings['manualPortfolio']) =>
    request<{ settings: PublicSettings }>('/api/portfolio/manual', {
      method: 'PUT',
      body: JSON.stringify({ manualPortfolio }),
    }),
  order: (payload: Record<string, unknown>) =>
    request<{ accepted: boolean; source: SourceMeta; message: string; response?: unknown }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}
