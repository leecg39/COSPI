import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  Bell,
  Bot,
  BriefcaseBusiness,
  CandlestickChart,
  ChevronDown,
  Clock3,
  GripVertical,
  KeyRound,
  LayoutGrid,
  LogIn,
  LogOut,
  Maximize2,
  Newspaper,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Trash2,
} from 'lucide-react'
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type Time,
} from 'lightweight-charts'
import { api } from './api'
import { bollingerBands, macd, movingAverage, rsi } from './indicators'
import type {
  AiResponse,
  AlertRule,
  ChartInterval,
  ChartPayload,
  ChartRange,
  DataState,
  ExecutionPayload,
  FilingItem,
  FinancialPayload,
  ManualHolding,
  NewsItem,
  OptionChainPayload,
  OptionContract,
  PortfolioPosition,
  PortfolioSnapshot,
  PublicSettings,
  Quote,
  SourceMeta,
  User,
} from './types'

type ViewKey = 'markets' | 'portfolio' | 'research' | 'chart' | 'orders' | 'ai' | 'settings'
type PanelKey = 'left' | 'center' | 'right'
type WidgetId = 'indices' | 'market-watch' | 'macro' | 'chart' | 'news' | 'dart' | 'financials' | 'portfolio' | 'executions' | 'options' | 'order' | 'ai' | 'settings'
type ViewLayout = Record<PanelKey, WidgetId[]>
type LayoutState = Record<ViewKey, ViewLayout>
type PanelWidths = { left: number; right: number }
type WidgetSize = { width?: number; height?: number }
type WidgetSizeState = Record<ViewKey, Partial<Record<WidgetId, WidgetSize>>>

const views: Array<{ id: ViewKey; label: string; icon: typeof Activity }> = [
  { id: 'markets', label: '시장', icon: Activity },
  { id: 'portfolio', label: '포트폴리오', icon: BriefcaseBusiness },
  { id: 'research', label: '리서치', icon: Newspaper },
  { id: 'chart', label: '차트', icon: CandlestickChart },
  { id: 'orders', label: '주문', icon: ShoppingCart },
  { id: 'ai', label: 'AI', icon: Bot },
  { id: 'settings', label: '설정', icon: Settings },
]

const defaultLayout: LayoutState = {
  markets: { left: ['indices', 'market-watch', 'macro'], center: ['chart'], right: ['news'] },
  portfolio: { left: ['market-watch'], center: ['portfolio'], right: ['executions', 'ai'] },
  research: { left: ['indices'], center: ['news', 'dart', 'financials'], right: ['ai'] },
  chart: { left: ['market-watch', 'macro'], center: ['chart'], right: ['ai'] },
  orders: { left: ['market-watch'], center: ['order'], right: ['portfolio', 'executions', 'options'] },
  ai: { left: ['news'], center: ['ai'], right: ['dart'] },
  settings: { left: ['market-watch'], center: ['settings'], right: ['macro'] },
}

const fallbackAlertRules: AlertRule[] = []

const widgetTitles: Record<WidgetId, string> = {
  indices: '국내 지수',
  'market-watch': '관심종목',
  macro: '환율/금리/글로벌',
  chart: '차트',
  news: '뉴스 분석',
  dart: 'DART 공시',
  financials: '실적/재무',
  portfolio: '포트폴리오',
  executions: '체결 내역',
  options: '옵션 체인',
  order: '주문',
  ai: 'AI 어시스턴트',
  settings: '로그인/설정',
}

const stateLabel: Record<DataState, string> = {
  REALTIME: '실시간',
  NEAR_REALTIME: '근실시간',
  DELAYED: '지연',
  API_REQUIRED: 'API 필요',
  NO_DATA: '데이터 없음',
  RATE_LIMITED: '요청 제한',
  ERROR: '오류',
}

const formatNumber = (value: number | null | undefined, digits = 0) =>
  value == null ? '--' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits }).format(value)

const formatPercent = (value: number | null | undefined) => (value == null ? '--' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`)

const formatRatio = (value: number | null | undefined) => (value == null ? '--' : `${value.toFixed(2)}%`)

const formatTime = (value: string | null | undefined) => {
  if (!value) return '--'
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

const allWidgetIds = new Set<WidgetId>(Object.keys(widgetTitles) as WidgetId[])

const storageKey = (name: string, userId?: string | null) => `${name}-${userId || 'anon'}`

const createClientId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`

const readStored = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key)
    return saved ? (JSON.parse(saved) as T) : fallback
  } catch {
    return fallback
  }
}

const normalizeViewLayout = (value: Partial<ViewLayout> | undefined, fallback: ViewLayout): ViewLayout => {
  const used = new Set<WidgetId>()
  const next: ViewLayout = { left: [], center: [], right: [] }
  ;(['left', 'center', 'right'] as PanelKey[]).forEach((panel) => {
    const widgets = Array.isArray(value?.[panel]) ? value?.[panel] || [] : fallback[panel]
    widgets.forEach((widgetId) => {
      if (allWidgetIds.has(widgetId) && !used.has(widgetId)) {
        next[panel].push(widgetId)
        used.add(widgetId)
      }
    })
  })
  ;(['left', 'center', 'right'] as PanelKey[]).forEach((panel) => {
    fallback[panel].forEach((widgetId) => {
      if (!used.has(widgetId)) {
        next[panel].push(widgetId)
        used.add(widgetId)
      }
    })
  })
  return next
}

const normalizeLayout = (value: Partial<LayoutState> | null | undefined): LayoutState =>
  views.reduce((acc, view) => {
    acc[view.id] = normalizeViewLayout(value?.[view.id], defaultLayout[view.id])
    return acc
  }, {} as LayoutState)

const loadLayout = (userId?: string | null): LayoutState => {
  const saved = readStored<Partial<LayoutState> | null>(storageKey('cospi-layout-v2', userId), null)
  const legacy = saved || readStored<Partial<LayoutState> | null>('cospi-layout-v1', null)
  return normalizeLayout(legacy)
}

const loadPanelWidths = (userId?: string | null): PanelWidths => {
  const saved = readStored<Partial<PanelWidths>>(storageKey('cospi-panel-widths-v2', userId), readStored('cospi-panel-widths-v1', {}))
  return { left: 300, right: 360, ...saved }
}

const loadWidgetSizes = (userId?: string | null): WidgetSizeState => {
  const saved = readStored<Partial<WidgetSizeState>>(storageKey('cospi-widget-sizes-v2', userId), {})
  return views.reduce((acc, view) => {
    acc[view.id] = saved[view.id] || {}
    return acc
  }, {} as WidgetSizeState)
}

const layoutHasWidget = (layout: ViewLayout, widgetId: WidgetId) =>
  layout.left.includes(widgetId) || layout.center.includes(widgetId) || layout.right.includes(widgetId)

const clampWidgetSize = (size: WidgetSize): WidgetSize => ({
  width: size.width ? Math.min(920, Math.max(220, size.width)) : undefined,
  height: size.height ? Math.min(900, Math.max(190, size.height)) : undefined,
})

const displayDigits = (quote: Quote) => (quote.currency === 'PERCENT' || quote.market === 'FX' || quote.market === 'GLOBAL' || quote.market === 'INDEX' ? 2 : 0)

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '--'
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

const formatCompactNumber = (value: number | null | undefined) => {
  if (value == null) return '--'
  if (Math.abs(value) >= 100000000) return `${formatNumber(value / 100000000, 1)}억`
  if (Math.abs(value) >= 10000) return `${formatNumber(value / 10000, 1)}만`
  return formatNumber(value)
}

const linePath = (snapshots: PortfolioSnapshot[]) => {
  if (snapshots.length < 2) return ''
  const values = snapshots.map((snapshot) => snapshot.totalValue)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return snapshots
    .map((snapshot, index) => {
      const x = (index / (snapshots.length - 1)) * 100
      const y = 42 - ((snapshot.totalValue - min) / span) * 34
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

const sectorAllocations = (positions: PortfolioPosition[]) => {
  const total = positions.reduce((sum, position) => sum + (position.marketValue || 0), 0)
  const groups = new Map<string, number>()
  positions.forEach((position) => groups.set(position.sector || '미분류', (groups.get(position.sector || '미분류') || 0) + (position.marketValue || 0)))
  return [...groups.entries()]
    .map(([sector, value]) => ({ sector, value, weight: total > 0 ? (value / total) * 100 : null }))
    .sort((a, b) => b.value - a.value)
}

const pairOptionsByStrike = (calls: OptionContract[], puts: OptionContract[]) => {
  const strikes = Array.from(new Set([...calls, ...puts].map((item) => item.strike).filter((strike): strike is number => strike != null))).sort((a, b) => a - b)
  return strikes.map((strike) => ({
    strike,
    call: calls.find((item) => item.strike === strike) || null,
    put: puts.find((item) => item.strike === strike) || null,
  }))
}

const StatusBadge = ({ source }: { source: SourceMeta }) => (
  <span className={`status status-${source.state.toLowerCase()}`} title={`${source.provider}${source.message ? `: ${source.message}` : ''}`}>
    {stateLabel[source.state]}
  </span>
)

const EmptyState = ({ source }: { source: SourceMeta }) => (
  <div className="empty-state">
    <StatusBadge source={source} />
    <p>{source.message || source.label}</p>
  </div>
)

const ConnectionStatus = ({ settings }: { settings: PublicSettings | null }) => {
  const items = [
    { label: 'KIS 키', status: settings?.hasKisKeys ? 'connected' : 'missing', text: settings?.hasKisKeys ? '연결됨' : '필요' },
    {
      label: 'KIS 계좌',
      status: settings?.kisAccountStatus || 'missing',
      text: settings?.kisAccountStatus === 'connected' ? '연결됨' : settings?.kisAccountStatus === 'invalid' ? '형식 오류' : '필요',
    },
    { label: 'DART', status: settings?.hasDartKey ? 'connected' : 'missing', text: settings?.hasDartKey ? '연결됨' : '필요' },
    { label: 'Gemini', status: settings?.hasGeminiKey ? 'connected' : 'missing', text: settings?.hasGeminiKey ? '연결됨' : '필요' },
  ]
  return (
    <div className="connection-grid">
      {items.map((item) => (
        <div className={item.status} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.text}</strong>
        </div>
      ))}
    </div>
  )
}

const WidgetFrame = ({
  id,
  children,
  onDragStart,
  onRefresh,
  size,
  onResize,
}: {
  id: WidgetId
  children: ReactNode
  onDragStart: (id: WidgetId) => void
  onRefresh?: () => void
  size?: WidgetSize
  onResize: (id: WidgetId, size: WidgetSize) => void
}) => {
  const frameRef = useRef<HTMLElement | null>(null)
  const resizingRef = useRef(false)

  useEffect(() => {
    const onUp = () => {
      if (!resizingRef.current || !frameRef.current) return
      resizingRef.current = false
      const rect = frameRef.current.getBoundingClientRect()
      onResize(id, clampWidgetSize({ width: Math.round(rect.width), height: Math.round(rect.height) }))
    }
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mouseup', onUp)
    }
  }, [id, onResize])

  return (
    <section
      ref={frameRef}
      className="widget"
      data-widget={id}
      onMouseDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        resizingRef.current = rect.right - event.clientX <= 22 && rect.bottom - event.clientY <= 22
      }}
      style={{
        width: size?.width ? `${size.width}px` : undefined,
        height: size?.height ? `${size.height}px` : undefined,
      }}
    >
      <header className="widget-header">
        <button
          type="button"
          className="icon-button drag-handle"
          title="이동"
          draggable
          onDragStart={() => onDragStart(id)}
        >
          <GripVertical size={15} />
        </button>
        <h2>{widgetTitles[id]}</h2>
        <div className="widget-tools">
          {onRefresh ? (
            <button type="button" className="icon-button" title="새로고침" onClick={onRefresh}>
              <RefreshCw size={14} />
            </button>
          ) : null}
        </div>
      </header>
      <div className="widget-body">{children}</div>
    </section>
  )
}

const TickerStrip = ({ quotes, onSelect }: { quotes: Quote[]; onSelect: (symbol: string) => void }) => (
  <div className="ticker-strip" aria-label="주요 지수 틱 테이프">
    {quotes.length ? (
      quotes.map((quote) => (
        <button type="button" key={quote.symbol} className="ticker-item" onClick={() => onSelect(quote.symbol)}>
          <span className="ticker-symbol">{quote.symbol}</span>
          <span>{quote.name}</span>
          <strong>{formatNumber(quote.price, displayDigits(quote))}</strong>
          <span className={quote.changeRate != null && quote.changeRate < 0 ? 'down' : 'up'}>{formatPercent(quote.changeRate)}</span>
          <StatusBadge source={quote.source} />
        </button>
      ))
    ) : (
      <span className="ticker-empty">시세 대기</span>
    )}
  </div>
)

const MarketWatch = ({ quotes, onSelect }: { quotes: Quote[]; onSelect: (symbol: string) => void }) => (
  <div className="table-wrap">
    <table className="terminal-table">
      <thead>
        <tr>
          <th>종목</th>
          <th>현재가</th>
          <th>등락률</th>
          <th>상태</th>
        </tr>
      </thead>
      <tbody>
        {quotes.map((quote) => (
          <tr key={quote.symbol} onClick={() => onSelect(quote.symbol)}>
            <td>
              <strong>{quote.symbol}</strong>
              <span>{quote.name}</span>
            </td>
            <td>{formatNumber(quote.price)}</td>
            <td className={quote.changeRate != null && quote.changeRate < 0 ? 'down' : 'up'}>{formatPercent(quote.changeRate)}</td>
            <td>
              <StatusBadge source={quote.source} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const IndexPanel = ({ indices }: { indices: Quote[] }) => (
  <div className="macro-grid index-grid">
    {indices.map((item) => (
      <div className="macro-cell" key={item.symbol}>
        <div>
          <strong>{item.name}</strong>
          <span>{item.symbol}</span>
        </div>
        <b>{formatNumber(item.price, 2)}</b>
        <em className={item.changeRate != null && item.changeRate < 0 ? 'down' : 'up'}>
          {item.change == null ? '--' : `${item.change >= 0 ? '+' : ''}${formatNumber(item.change, 2)}`} / {formatPercent(item.changeRate)}
        </em>
        <StatusBadge source={item.source} />
      </div>
    ))}
  </div>
)

const MacroPanel = ({ items, source }: { items: Quote[]; source: SourceMeta | null }) => (
  <div className="macro-grid">
    {items.map((item) => (
      <div className="macro-cell" key={item.symbol}>
        <div>
          <strong>{item.name}</strong>
          <span>{item.symbol}</span>
        </div>
        <b>{formatNumber(item.price, displayDigits(item))}</b>
        <em className={item.changeRate != null && item.changeRate < 0 ? 'down' : 'up'}>
          {item.change == null ? '--' : `${item.change >= 0 ? '+' : ''}${formatNumber(item.change, 2)}`} / {formatPercent(item.changeRate)}
        </em>
        <StatusBadge source={item.source} />
      </div>
    ))}
    {!items.length && source ? <EmptyState source={source} /> : null}
  </div>
)

const useChart = (payload: ChartPayload | null) => {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !payload?.candles.length) return
    container.innerHTML = ''
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#5b616e',
      },
      grid: {
        vertLines: { color: '#eef0f3' },
        horzLines: { color: '#eef0f3' },
      },
      rightPriceScale: {
        borderColor: '#dedfe2',
      },
      timeScale: {
        borderColor: '#dedfe2',
        timeVisible: true,
      },
      crosshair: {
        mode: 1,
      },
      autoSize: true,
    })

    const candles = payload.candles.map((candle) => ({
      time: candle.time as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }))
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#27ad75',
      downColor: '#f0616d',
      borderVisible: false,
      wickUpColor: '#27ad75',
      wickDownColor: '#f0616d',
    })
    candleSeries.setData(candles)

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#8a919e',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    })
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    volumeSeries.setData(
      payload.candles.map((candle) => ({
        time: candle.time as Time,
        value: candle.volume,
        color: candle.close >= candle.open ? 'rgba(39,173,117,.24)' : 'rgba(240,97,109,.24)',
      })),
    )

    const ma20 = movingAverage(payload.candles, 20)
    const ma60 = movingAverage(payload.candles, 60)
    const bands = bollingerBands(payload.candles)
    chart.addSeries(LineSeries, { color: '#0052ff', lineWidth: 1 }).setData(ma20.map((point) => ({ time: point.time as Time, value: point.value })))
    chart.addSeries(LineSeries, { color: '#141519', lineWidth: 1 }).setData(ma60.map((point) => ({ time: point.time as Time, value: point.value })))
    chart.addSeries(LineSeries, { color: 'rgba(91,97,110,.34)', lineWidth: 1 }).setData(bands.map((point) => ({ time: point.time as Time, value: point.upper })))
    chart.addSeries(LineSeries, { color: 'rgba(91,97,110,.34)', lineWidth: 1 }).setData(bands.map((point) => ({ time: point.time as Time, value: point.lower })))
    chart.timeScale().fitContent()

    return () => chart.remove()
  }, [payload])

  return containerRef
}

const ChartPanel = ({
  payload,
  range,
  interval,
  selectedSymbol,
  onRange,
  onInterval,
}: {
  payload: ChartPayload | null
  range: ChartRange
  interval: ChartInterval
  selectedSymbol: string
  onRange: (range: ChartRange) => void
  onInterval: (interval: ChartInterval) => void
}) => {
  const chartRef = useChart(payload)
  const rsiValue = payload ? rsi(payload.candles).at(-1)?.value : undefined
  const macdValue = payload ? macd(payload.candles).at(-1) : undefined
  const ranges: ChartRange[] = ['1M', '3M', '6M', '1Y', '2Y', '5Y', '10Y']
  const intervals: ChartInterval[] = ['1D', '1W', '1M']

  return (
    <div className="chart-panel">
      <div className="control-row">
        <strong>{selectedSymbol}</strong>
        <div className="segmented">
          {ranges.map((item) => (
            <button type="button" key={item} className={range === item ? 'active' : ''} onClick={() => onRange(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="segmented">
          {intervals.map((item) => (
            <button type="button" key={item} className={interval === item ? 'active' : ''} onClick={() => onInterval(item)}>
              {item}
            </button>
          ))}
        </div>
      </div>
      {payload?.candles.length ? <div className="chart-canvas" ref={chartRef} /> : payload ? <EmptyState source={payload.source} /> : <div className="chart-canvas skeleton" />}
      <div className="indicator-strip">
        <span>MA20</span>
        <span>MA60</span>
        <span>Bollinger 20/2</span>
        <span>RSI {rsiValue == null ? '--' : rsiValue.toFixed(2)}</span>
        <span>MACD {macdValue ? `${macdValue.macd} / ${macdValue.signal}` : '--'}</span>
      </div>
      {payload ? <StatusBadge source={payload.source} /> : null}
    </div>
  )
}

const NewsPanel = ({ items, source, onAnalyze }: { items: NewsItem[]; source: SourceMeta | null; onAnalyze: (text: string) => void }) => (
  <div className="news-list">
    {items.map((item) => (
      <article className="news-row" key={item.id}>
        <div>
          <a href={item.link} target="_blank" rel="noreferrer">
            {item.title}
          </a>
          <p>{item.summary}</p>
          <span>{item.publisher}</span>
          <span>{formatTime(item.publishedAt)}</span>
        </div>
        <div className="news-meta">
          <span className={`pill sentiment-${item.sentiment}`}>{item.sentiment}</span>
          <span className="pill">{item.importance}</span>
          <span className="pill">{item.relatedSymbols.length ? item.relatedSymbols.join(', ') : '종목 없음'}</span>
          <button type="button" className="icon-button" title="AI 분석" onClick={() => onAnalyze(`${item.title}\n${item.summary}`)}>
            <Bot size={14} />
          </button>
        </div>
      </article>
    ))}
    {!items.length && source ? <EmptyState source={source} /> : null}
  </div>
)

const DartPanel = ({ items, source, selectedSymbol, onSymbol, onRefresh }: { items: FilingItem[]; source: SourceMeta | null; selectedSymbol: string; onSymbol: (symbol: string) => void; onRefresh: () => void }) => (
  <div className="stack">
    <div className="input-line">
      <input value={selectedSymbol} onChange={(event) => onSymbol(event.target.value)} maxLength={6} />
      <button type="button" className="command-button" onClick={onRefresh}>
        조회
      </button>
    </div>
    <div className="filing-list">
      {items.map((item) => (
        <a href={item.link} target="_blank" rel="noreferrer" className="filing-row" key={item.id}>
          <strong>{item.reportName}</strong>
          <span>
            {item.corpName} {item.stockCode ? `(${item.stockCode})` : ''}
          </span>
          <span>{item.filedAt}</span>
        </a>
      ))}
      {!items.length && source ? <EmptyState source={source} /> : null}
    </div>
  </div>
)

const FinancialPanel = ({ payload, selectedSymbol, onSymbol, onRefresh }: { payload: FinancialPayload | null; selectedSymbol: string; onSymbol: (symbol: string) => void; onRefresh: () => void }) => (
  <div className="stack">
    <div className="input-line">
      <input value={selectedSymbol} onChange={(event) => onSymbol(event.target.value)} maxLength={6} />
      <button type="button" className="command-button" onClick={onRefresh}>
        조회
      </button>
      {payload ? <StatusBadge source={payload.source} /> : null}
    </div>
    {payload?.rows.length ? (
      <div className="table-wrap">
        <table className="terminal-table financial-table">
          <thead>
            <tr>
              <th>기간</th>
              <th>매출</th>
              <th>영업익</th>
              <th>순이익</th>
              <th>자산</th>
              <th>부채</th>
              <th>자본</th>
              <th>ROE</th>
              <th>순이익률</th>
              <th>부채비율</th>
            </tr>
          </thead>
          <tbody>
            {payload.rows.slice(0, 8).map((row) => (
              <tr key={row.period}>
                <td><strong>{row.period}</strong></td>
                <td>{formatCompactNumber(row.revenue)}</td>
                <td>{formatCompactNumber(row.operatingProfit)}</td>
                <td>{formatCompactNumber(row.netIncome)}</td>
                <td>{formatCompactNumber(row.totalAssets)}</td>
                <td>{formatCompactNumber(row.totalDebt)}</td>
                <td>{formatCompactNumber(row.totalEquity)}</td>
                <td>{formatRatio(row.roe)}</td>
                <td>{formatRatio(row.netMargin)}</td>
                <td>{formatRatio(row.debtRatio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : payload ? (
      <EmptyState source={payload.source} />
    ) : (
      <div className="empty-state compact">실적 데이터 로딩 중</div>
    )}
  </div>
)

const OptionPriceCell = ({ item }: { item: OptionContract | null }) => (
  <td>
    {item ? (
      <>
        <strong>{formatNumber(item.price, 2)}</strong>
        <span className={item.changeRate != null && item.changeRate < 0 ? 'down' : 'up'}>{formatPercent(item.changeRate)}</span>
        <span>{formatNumber(item.bid, 2)} / {formatNumber(item.ask, 2)}</span>
      </>
    ) : (
      '--'
    )}
  </td>
)

const OptionsPanel = ({ payload, selectedMonth, onMonth, onRefresh }: { payload: OptionChainPayload | null; selectedMonth: string; onMonth: (month: string) => void; onRefresh: () => void }) => {
  const rows = payload ? pairOptionsByStrike(payload.calls, payload.puts).slice(0, 40) : []
  return (
    <div className="options-panel">
      <div className="control-row">
        <strong>KOSPI 옵션</strong>
        <select value={selectedMonth || payload?.selectedMonth || ''} onChange={(event) => onMonth(event.target.value)}>
          {payload?.months.map((month) => (
            <option value={month.month} key={month.month}>
              {month.label}
            </option>
          ))}
        </select>
        <button type="button" className="command-button" onClick={onRefresh}>
          조회
        </button>
        {payload ? <StatusBadge source={payload.source} /> : null}
      </div>
      {payload && rows.length ? (
        <div className="table-wrap">
          <table className="terminal-table options-table">
            <thead>
              <tr>
                <th>콜 코드</th>
                <th>콜 가격/호가</th>
                <th>콜 IV/Delta</th>
                <th>행사가</th>
                <th>풋 IV/Delta</th>
                <th>풋 가격/호가</th>
                <th>풋 코드</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.strike}>
                  <td>{row.call?.code || '--'}<span>{formatCompactNumber(row.call?.volume)}</span></td>
                  <OptionPriceCell item={row.call} />
                  <td>{formatNumber(row.call?.impliedVolatility, 2)}<span>{formatNumber(row.call?.delta, 4)}</span></td>
                  <td><strong>{formatNumber(row.strike, 2)}</strong></td>
                  <td>{formatNumber(row.put?.impliedVolatility, 2)}<span>{formatNumber(row.put?.delta, 4)}</span></td>
                  <OptionPriceCell item={row.put} />
                  <td>{row.put?.code || '--'}<span>{formatCompactNumber(row.put?.volume)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : payload ? (
        <EmptyState source={payload.source} />
      ) : (
        <div className="empty-state compact">옵션 월물 로딩 중</div>
      )}
    </div>
  )
}

const PortfolioGraph = ({ snapshots, large, onLarge }: { snapshots: PortfolioSnapshot[]; large: boolean; onLarge: () => void }) => {
  const latest = snapshots.at(-1)
  const path = linePath(snapshots)
  return (
    <div className={large ? 'portfolio-graph large' : 'portfolio-graph'}>
      <div className="graph-head">
        <strong>자산 추이</strong>
        <button type="button" className="icon-button" title="크게 보기" onClick={onLarge}>
          <Maximize2 size={14} />
        </button>
      </div>
      {latest ? (
        <div className="asset-trend">
          <svg viewBox="0 0 100 48" role="img" aria-label="포트폴리오 자산 추이">
            <line x1="0" y1="42" x2="100" y2="42" />
            {path ? <path d={path} /> : <circle cx="50" cy="24" r="2.2" />}
          </svg>
          <div className="trend-meta">
            <strong>{formatNumber(latest.totalValue)}원</strong>
            <span className={latest.totalProfitLoss < 0 ? 'down' : 'up'}>{formatNumber(latest.totalProfitLoss)}원</span>
            <span>{formatDateTime(latest.time)} · {snapshots.length}개 스냅샷</span>
          </div>
        </div>
      ) : (
        <div className="empty-state compact">저장된 실제 자산 스냅샷이 없습니다.</div>
      )}
    </div>
  )
}

const SectorAllocation = ({ positions }: { positions: PortfolioPosition[] }) => {
  const sectors = sectorAllocations(positions)
  return (
    <div className="portfolio-graph">
      <div className="graph-head">
        <strong>섹터 비중</strong>
      </div>
      {sectors.length ? (
        <div className="allocation-bars">
          {sectors.map((sector) => (
            <div className="allocation-row" key={sector.sector}>
              <span>{sector.sector}</span>
              <div>
                <i style={{ width: `${sector.weight || 0}%` }} />
              </div>
              <b>{formatPercent(sector.weight)}</b>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">섹터 비중을 계산할 평가금액이 없습니다.</div>
      )}
    </div>
  )
}

const PortfolioPanel = ({
  user,
  settings,
  positions,
  snapshots,
  source,
  totalValue,
  totalProfitLoss,
  onSaveManual,
}: {
  user: User | null
  settings: PublicSettings | null
  positions: PortfolioPosition[]
  snapshots: PortfolioSnapshot[]
  source: SourceMeta | null
  totalValue: number
  totalProfitLoss: number
  onSaveManual: (portfolio: ManualHolding[]) => Promise<void>
}) => {
  const [symbol, setSymbol] = useState('005930')
  const [name, setName] = useState('삼성전자')
  const [quantity, setQuantity] = useState('0')
  const [averagePrice, setAveragePrice] = useState('0')
  const [expectedDividend, setExpectedDividend] = useState('0')
  const [sector, setSector] = useState('반도체')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [largeGraph, setLargeGraph] = useState(false)
  const manualPortfolio = settings?.manualPortfolio || []

  const resetManualForm = () => {
    setEditingId(null)
    setQuantity('0')
    setAveragePrice('0')
    setExpectedDividend('0')
  }

  const saveManual = async () => {
    const nextHolding = {
      id: editingId || `${Date.now()}`,
      symbol,
      name,
      sector,
      quantity: Number(quantity),
      averagePrice: Number(averagePrice),
      expectedDividend: Number(expectedDividend),
    }
    await onSaveManual(editingId ? manualPortfolio.map((holding) => (holding.id === editingId ? nextHolding : holding)) : [...manualPortfolio, nextHolding])
    resetManualForm()
  }

  const startEditManual = (holding: ManualHolding) => {
    setEditingId(holding.id)
    setSymbol(holding.symbol)
    setName(holding.name)
    setSector(holding.sector)
    setQuantity(String(holding.quantity))
    setAveragePrice(String(holding.averagePrice))
    setExpectedDividend(String(holding.expectedDividend))
  }

  const removeManual = async (id: string) => {
    await onSaveManual(manualPortfolio.filter((holding) => holding.id !== id))
  }

  if (!user) {
    return <EmptyState source={{ provider: 'COSPI', state: 'API_REQUIRED', label: '로그인 필요', message: '포트폴리오는 로그인 후 표시됩니다.' }} />
  }

  return (
    <div className="portfolio-panel">
      <div className="metric-grid">
        <div>
          <span>평가금액</span>
          <strong>{formatNumber(totalValue)}원</strong>
        </div>
        <div>
          <span>평가손익</span>
          <strong className={totalProfitLoss < 0 ? 'down' : 'up'}>{formatNumber(totalProfitLoss)}원</strong>
        </div>
        <div>
          <span>상태</span>
          {source ? <StatusBadge source={source} /> : null}
        </div>
      </div>
      <PortfolioGraph snapshots={snapshots} large={false} onLarge={() => setLargeGraph(true)} />
      {largeGraph ? (
        <div className="modal-backdrop" onClick={() => setLargeGraph(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <PortfolioGraph snapshots={snapshots} large onLarge={() => setLargeGraph(false)} />
          </div>
        </div>
      ) : null}
      <SectorAllocation positions={positions} />
      <div className="table-wrap">
        <table className="terminal-table">
          <thead>
            <tr>
              <th>종목</th>
              <th>평가금액</th>
              <th>손익</th>
              <th>비중</th>
              <th>배당예상</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <tr key={position.id}>
                <td>
                  <strong>{position.symbol}</strong>
                  <span>{position.name}</span>
                </td>
                <td>{formatNumber(position.marketValue)}원</td>
                <td className={position.profitLoss != null && position.profitLoss < 0 ? 'down' : 'up'}>{formatNumber(position.profitLoss)}원</td>
                <td>{formatPercent(position.weight)}</td>
                <td>{formatNumber(position.expectedDividend)}원</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="manual-form">
        <input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="종목코드" />
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="종목명" />
        <input value={sector} onChange={(event) => setSector(event.target.value)} placeholder="섹터" />
        <input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="numeric" placeholder="수량" />
        <input value={averagePrice} onChange={(event) => setAveragePrice(event.target.value)} inputMode="numeric" placeholder="평균단가" />
        <input value={expectedDividend} onChange={(event) => setExpectedDividend(event.target.value)} inputMode="numeric" placeholder="배당예상" />
        <button type="button" className="command-button" onClick={saveManual}>
          {editingId ? '수정 저장' : '추가'}
        </button>
      </div>
      {manualPortfolio.length ? (
        <div className="manual-list">
          {manualPortfolio.map((holding) => (
            <div className="manual-row" key={holding.id}>
              <span>{holding.symbol}</span>
              <strong>{holding.name}</strong>
              <span>{holding.sector}</span>
              <span>{formatNumber(holding.quantity)}주</span>
              <span>{formatNumber(holding.averagePrice)}원</span>
              <button type="button" className="command-button" onClick={() => startEditManual(holding)}>
                수정
              </button>
              <button type="button" className="icon-button" title="삭제" onClick={() => removeManual(holding.id)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const ExecutionsPanel = ({ user, payload, onRefresh }: { user: User | null; payload: ExecutionPayload | null; onRefresh: () => void }) => {
  if (!user) {
    return <EmptyState source={{ provider: 'COSPI', state: 'API_REQUIRED', label: '로그인 필요', message: '체결 내역은 로그인 후 표시됩니다.' }} />
  }

  return (
    <div className="execution-panel">
      <div className="control-row">
        <Clock3 size={16} />
        <strong>최근 30일</strong>
        {payload ? <StatusBadge source={payload.source} /> : null}
        <button type="button" className="command-button" onClick={onRefresh}>
          조회
        </button>
      </div>
      {payload && payload.items.length ? (
        <div className="table-wrap">
          <table className="terminal-table execution-table">
            <thead>
              <tr>
                <th>일자/주문</th>
                <th>종목</th>
                <th>구분</th>
                <th>주문</th>
                <th>체결</th>
                <th>평균가</th>
                <th>체결금액</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {payload.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.orderDate || '--'}</strong>
                    <span>{item.orderNo}</span>
                  </td>
                  <td>
                    <strong>{item.symbol}</strong>
                    <span>{item.name}</span>
                  </td>
                  <td className={item.side === 'sell' ? 'side-sell' : item.side === 'buy' ? 'side-buy' : undefined}>{item.sideLabel}</td>
                  <td>
                    {formatNumber(item.orderQuantity)}주
                    <span>{formatNumber(item.orderPrice)}원</span>
                  </td>
                  <td>
                    {formatNumber(item.filledQuantity)}주
                    <span>잔량 {formatNumber(item.remainingQuantity)}주</span>
                  </td>
                  <td>{formatNumber(item.filledPrice)}원</td>
                  <td>{formatNumber(item.filledAmount)}원</td>
                  <td>
                    {item.status}
                    <span>{item.orderType}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : payload ? (
        <EmptyState source={payload.source} />
      ) : (
        <div className="empty-state compact">체결 내역 로딩 중</div>
      )}
    </div>
  )
}

const AiPanel = ({
  selectedSymbol,
  latestNews,
  filings,
  financialPayload,
  chartPayload,
  positions,
  portfolioTotal,
  portfolioSource,
  result,
  onAnalyze,
  onLoadFinancials,
}: {
  selectedSymbol: string
  latestNews: NewsItem | null
  filings: FilingItem[]
  financialPayload: FinancialPayload | null
  chartPayload: ChartPayload | null
  positions: PortfolioPosition[]
  portfolioTotal: { value: number; profitLoss: number }
  portfolioSource: SourceMeta | null
  result: AiResponse | null
  onAnalyze: (prompt: string) => Promise<void>
  onLoadFinancials: () => Promise<FinancialPayload>
}) => {
  const [prompt, setPrompt] = useState('')
  const fillContext = async () => {
    const financialData = financialPayload || (await onLoadFinancials().catch(() => null))
    const currentChart = chartPayload
    const latestCandle = currentChart?.candles.at(-1)
    const latestFiling = filings[0]
    const latestFinancial = financialData?.rows[0]
    const holding = positions.find((position) => position.symbol === selectedSymbol)
    const topPositions = positions
      .filter((position) => position.marketValue != null)
      .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))
      .slice(0, 5)
      .map((position) => `${position.symbol} ${position.name} ${formatPercent(position.weight)} 평가 ${formatNumber(position.marketValue)}원 (${position.source.label})`)
      .join('\n')
    const chartContext =
      currentChart && latestCandle
        ? `차트 최신 캔들(${currentChart.symbol}, ${currentChart.range}/${currentChart.interval}, ${currentChart.source.label}): ${latestCandle.time} 종가 ${formatNumber(latestCandle.close)} 거래량 ${formatCompactNumber(latestCandle.volume)}`
        : `차트: ${currentChart?.source.label || '데이터 없음'}`
    setPrompt(
      [
        `종목코드: ${selectedSymbol}`,
        latestNews ? `최근 뉴스(${latestNews.source.label}): ${latestNews.title}\n${latestNews.summary}` : '최근 뉴스: 데이터 없음',
        latestFiling
          ? `최근 DART 공시(${latestFiling.source.label}): ${latestFiling.reportName} / ${latestFiling.corpName} / ${latestFiling.filedAt} / ${latestFiling.link}`
          : `최근 DART 공시: ${filings.length ? '선택 종목과 다른 공시만 있음' : '데이터 없음'}`,
        latestFinancial
          ? [
              `최근 실적/재무(${financialData?.source.label || '상태 없음'}) 기간: ${latestFinancial.period}`,
              `매출: ${formatCompactNumber(latestFinancial.revenue)}`,
              `영업이익: ${formatCompactNumber(latestFinancial.operatingProfit)}`,
              `순이익: ${formatCompactNumber(latestFinancial.netIncome)}`,
              `ROE: ${formatRatio(latestFinancial.roe)}`,
              `부채비율: ${formatRatio(latestFinancial.debtRatio)}`,
            ].join('\n')
          : `실적/재무: ${financialData?.source.label || '데이터 없음'}`,
        chartContext,
        holding
          ? `내 보유(${holding.source.label}): ${holding.name} ${formatNumber(holding.quantity)}주, 평가 ${formatNumber(holding.marketValue)}원, 손익 ${formatNumber(holding.profitLoss)}원, 비중 ${formatPercent(holding.weight)}`
          : '내 보유: 선택 종목 보유 데이터 없음',
        topPositions ? `포트폴리오 상위 보유:\n${topPositions}` : '포트폴리오 상위 보유: 데이터 없음',
        `포트폴리오 총 평가(${portfolioSource?.label || '데이터 없음'}): ${formatNumber(portfolioTotal.value)}원 / 총 손익 ${formatNumber(portfolioTotal.profitLoss)}원`,
        '위 데이터의 상태가 실제/지연/API 필요/데이터 없음 중 무엇인지 구분해서 한국어로 요약하고, 투자 판단 전 확인할 리스크와 추가 확인 항목을 분리해줘.',
      ].join('\n'),
    )
  }

  return (
    <div className="ai-panel">
      <div className="control-row">
        <button type="button" className="command-button" onClick={() => void fillContext()}>
          컨텍스트
        </button>
        <button type="button" className="command-button primary" onClick={() => onAnalyze(prompt)}>
          분석
        </button>
      </div>
      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="종목, 뉴스, 공시, 포트폴리오 질문" />
      <pre className="ai-output">{result?.answer || 'AI 응답 대기'}</pre>
      {result ? <StatusBadge source={result.source} /> : null}
    </div>
  )
}

const OrderPanel = ({ user, selectedSymbol, onOrder }: { user: User | null; selectedSymbol: string; onOrder: (payload: Record<string, unknown>) => Promise<string> }) => {
  const [mode, setMode] = useState<'paper' | 'live'>('paper')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [symbol, setSymbol] = useState(selectedSymbol)
  const [quantity, setQuantity] = useState('1')
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [price, setPrice] = useState('0')
  const [liveConfirm, setLiveConfirm] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => setSymbol(selectedSymbol), [selectedSymbol])

  const submit = async () => {
    const result = await onOrder({
      mode,
      side,
      symbol,
      quantity: Number(quantity),
      orderType,
      price: Number(price),
      liveConfirm,
    })
    setMessage(result)
  }

  if (!user) {
    return <EmptyState source={{ provider: 'COSPI', state: 'API_REQUIRED', label: '로그인 필요', message: '주문은 로그인 후 사용할 수 있습니다.' }} />
  }

  return (
    <div className={`order-panel ${mode === 'live' ? 'live-mode' : 'paper-mode'}`}>
      <div className="trade-banner">
        <ShieldAlert size={18} />
        <strong>{mode === 'paper' ? '모의투자 주문' : '실전투자 주문'}</strong>
      </div>
      <div className="form-grid">
        <label>
          모드
          <select value={mode} onChange={(event) => setMode(event.target.value as 'paper' | 'live')}>
            <option value="paper">모의투자</option>
            <option value="live">실전투자</option>
          </select>
        </label>
        <label>
          매수/매도
          <select value={side} onChange={(event) => setSide(event.target.value as 'buy' | 'sell')}>
            <option value="buy">매수</option>
            <option value="sell">매도</option>
          </select>
        </label>
        <label>
          종목
          <input value={symbol} onChange={(event) => setSymbol(event.target.value)} />
        </label>
        <label>
          수량
          <input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="numeric" />
        </label>
        <label>
          주문유형
          <select value={orderType} onChange={(event) => setOrderType(event.target.value as 'market' | 'limit')}>
            <option value="market">시장가</option>
            <option value="limit">지정가</option>
          </select>
        </label>
        <label>
          가격
          <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="numeric" disabled={orderType === 'market'} />
        </label>
      </div>
      {mode === 'live' ? <input className="danger-input" value={liveConfirm} onChange={(event) => setLiveConfirm(event.target.value)} placeholder="실전투자 주문" /> : null}
      <button type="button" className={`wide-button ${mode === 'live' ? 'danger' : 'primary'}`} onClick={submit}>
        {mode === 'paper' ? '모의 주문 전송' : '실전 주문 전송'}
      </button>
      {message ? <p className="notice-line">{message}</p> : null}
    </div>
  )
}

const SettingsPanel = ({
  user,
  settings,
  onLogin,
  onRegister,
  onLogout,
  onSave,
}: {
  user: User | null
  settings: PublicSettings | null
  onLogin: (email: string, password: string) => Promise<void>
  onRegister: (email: string, password: string) => Promise<void>
  onLogout: () => Promise<void>
  onSave: (payload: Record<string, unknown>) => Promise<void>
}) => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [kisAppKey, setKisAppKey] = useState('')
  const [kisAppSecret, setKisAppSecret] = useState('')
  const [kisAccountNo, setKisAccountNo] = useState('')
  const [kisAccountProductCode, setKisAccountProductCode] = useState('01')
  const [dartApiKey, setDartApiKey] = useState('')
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [geminiModel, setGeminiModel] = useState('gemini-3.5-flash')
  const [watchlist, setWatchlist] = useState('005930,000660,035420,051910,069500')
  const [kisPaperTrading, setKisPaperTrading] = useState(true)
  const [liveTradingEnabled, setLiveTradingEnabled] = useState(false)
  const [alertRules, setAlertRules] = useState<AlertRule[]>([])
  const [alertSymbol, setAlertSymbol] = useState('005930')
  const [alertCondition, setAlertCondition] = useState<'above' | 'below'>('above')
  const [alertTargetPrice, setAlertTargetPrice] = useState('')
  const [settingsMessage, setSettingsMessage] = useState('')

  useEffect(() => {
    if (!settings) return
    setKisAccountNo(settings.kisAccountNo || '')
    setKisAccountProductCode(settings.kisAccountProductCode || '01')
    setGeminiModel(settings.geminiModel || 'gemini-3.5-flash')
    setWatchlist(settings.watchlist.join(','))
    setKisPaperTrading(settings.kisPaperTrading)
    setLiveTradingEnabled(settings.liveTradingEnabled)
    setAlertRules(settings.alertRules || [])
  }, [settings])

  const addAlertRule = () => {
    const symbol = alertSymbol.trim().toUpperCase()
    const targetPrice = Number(alertTargetPrice)
    if (!/^[A-Z0-9/]{2,12}$/.test(symbol) || !Number.isFinite(targetPrice) || targetPrice <= 0) {
      setSettingsMessage('알림 종목과 목표가를 확인하세요.')
      return
    }
    setAlertRules((current) => [
      ...current,
      {
        id: createClientId(),
        symbol,
        condition: alertCondition,
        targetPrice,
        enabled: true,
        createdAt: new Date().toISOString(),
      },
    ])
    setAlertTargetPrice('')
    setSettingsMessage('')
  }

  const save = async () => {
    const payload: Record<string, unknown> = {
      kisAccountNo,
      kisAccountProductCode,
      kisPaperTrading,
      liveTradingEnabled,
      geminiModel,
      watchlist: watchlist.split(',').map((item) => item.trim()).filter(Boolean),
      alertRules,
    }
    if (kisAppKey) payload.kisAppKey = kisAppKey
    if (kisAppSecret) payload.kisAppSecret = kisAppSecret
    if (dartApiKey) payload.dartApiKey = dartApiKey
    if (geminiApiKey) payload.geminiApiKey = geminiApiKey
    await onSave(payload)
    setKisAppKey('')
    setKisAppSecret('')
    setDartApiKey('')
    setGeminiApiKey('')
    setSettingsMessage('설정이 저장되었습니다.')
  }

  return (
    <div className="settings-panel">
      <div className="auth-box">
        {user ? (
          <>
            <div>
              <strong>{user.email}</strong>
              <span>로그인됨</span>
            </div>
            <button type="button" className="command-button" onClick={onLogout}>
              <LogOut size={14} />
              로그아웃
            </button>
          </>
        ) : (
          <>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@example.com" />
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="비밀번호 8자 이상" />
            <button type="button" className="command-button" onClick={() => onLogin(email, password)}>
              <LogIn size={14} />
              로그인
            </button>
            <button type="button" className="command-button" onClick={() => onRegister(email, password)}>
              가입
            </button>
          </>
        )}
      </div>
      <ConnectionStatus settings={settings} />
      <div className="form-grid">
        <label>
          KIS App Key
          <input value={kisAppKey} onChange={(event) => setKisAppKey(event.target.value)} type="password" placeholder={settings?.hasKisKeys ? '저장됨' : '미설정'} />
        </label>
        <label>
          KIS App Secret
          <input value={kisAppSecret} onChange={(event) => setKisAppSecret(event.target.value)} type="password" placeholder={settings?.hasKisKeys ? '저장됨' : '미설정'} />
        </label>
        <label>
          계좌번호
          <input value={kisAccountNo} onChange={(event) => setKisAccountNo(event.target.value)} inputMode="numeric" maxLength={8} placeholder="CANO 8자리" />
        </label>
        <label>
          상품코드
          <input value={kisAccountProductCode} onChange={(event) => setKisAccountProductCode(event.target.value)} inputMode="numeric" maxLength={2} placeholder="01" />
        </label>
        <label>
          DART API Key
          <input value={dartApiKey} onChange={(event) => setDartApiKey(event.target.value)} type="password" placeholder={settings?.hasDartKey ? '저장됨' : '미설정'} />
        </label>
        <label>
          Gemini API Key
          <input value={geminiApiKey} onChange={(event) => setGeminiApiKey(event.target.value)} type="password" placeholder={settings?.hasGeminiKey ? '저장됨' : '미설정'} />
        </label>
        <label>
          Gemini Model
          <input value={geminiModel} onChange={(event) => setGeminiModel(event.target.value)} />
        </label>
        <label>
          관심종목
          <input value={watchlist} onChange={(event) => setWatchlist(event.target.value)} />
        </label>
      </div>
      <div className="toggle-row">
        <label>
          <input type="checkbox" checked={kisPaperTrading} onChange={(event) => setKisPaperTrading(event.target.checked)} />
          모의투자 기본
        </label>
        <label>
          <input type="checkbox" checked={liveTradingEnabled} onChange={(event) => setLiveTradingEnabled(event.target.checked)} />
          실전투자 UI 허용
        </label>
      </div>
      <div className="settings-section">
        <div className="section-head">
          <strong>가격 알림</strong>
          <span>{alertRules.length}개</span>
        </div>
        <div className="alert-form">
          <input value={alertSymbol} onChange={(event) => setAlertSymbol(event.target.value)} placeholder="종목코드" />
          <select value={alertCondition} onChange={(event) => setAlertCondition(event.target.value as 'above' | 'below')}>
            <option value="above">이상</option>
            <option value="below">이하</option>
          </select>
          <input value={alertTargetPrice} onChange={(event) => setAlertTargetPrice(event.target.value)} inputMode="numeric" placeholder="목표가" />
          <button type="button" className="command-button" onClick={addAlertRule}>
            추가
          </button>
        </div>
        {alertRules.length ? (
          <div className="alert-rule-list">
            {alertRules.map((rule) => (
              <div className="alert-rule-row" key={rule.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(event) =>
                      setAlertRules((current) => current.map((item) => (item.id === rule.id ? { ...item, enabled: event.target.checked } : item)))
                    }
                  />
                  <span>{rule.symbol}</span>
                </label>
                <strong>
                  {rule.condition === 'above' ? '이상' : '이하'} {formatNumber(rule.targetPrice)}원
                </strong>
                <button type="button" className="icon-button" title="알림 삭제" onClick={() => setAlertRules((current) => current.filter((item) => item.id !== rule.id))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {settingsMessage ? <p className="notice-line">{settingsMessage}</p> : null}
      <button type="button" className="wide-button primary" onClick={save} disabled={!user}>
        <Save size={15} />
        저장
      </button>
    </div>
  )
}

function App() {
  const [activeView, setActiveView] = useState<ViewKey>('markets')
  const [layout, setLayout] = useState<LayoutState>(() => loadLayout(null))
  const [panelWidths, setPanelWidths] = useState(() => loadPanelWidths(null))
  const [widgetSizes, setWidgetSizes] = useState<WidgetSizeState>(() => loadWidgetSizes(null))
  const [draggedWidget, setDraggedWidget] = useState<WidgetId | null>(null)
  const [selectedSymbol, setSelectedSymbol] = useState('005930')
  const [command, setCommand] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [indices, setIndices] = useState<Quote[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [macroItems, setMacroItems] = useState<Quote[]>([])
  const [macroSource, setMacroSource] = useState<SourceMeta | null>(null)
  const [newsItems, setNewsItems] = useState<NewsItem[]>([])
  const [newsSource, setNewsSource] = useState<SourceMeta | null>(null)
  const [filings, setFilings] = useState<FilingItem[]>([])
  const [dartSource, setDartSource] = useState<SourceMeta | null>(null)
  const [financialPayload, setFinancialPayload] = useState<FinancialPayload | null>(null)
  const [chartPayload, setChartPayload] = useState<ChartPayload | null>(null)
  const [chartRange, setChartRange] = useState<ChartRange>('1Y')
  const [chartInterval, setChartInterval] = useState<ChartInterval>('1D')
  const [positions, setPositions] = useState<PortfolioPosition[]>([])
  const [portfolioSnapshots, setPortfolioSnapshots] = useState<PortfolioSnapshot[]>([])
  const [portfolioSource, setPortfolioSource] = useState<SourceMeta | null>(null)
  const [portfolioTotal, setPortfolioTotal] = useState({ value: 0, profitLoss: 0 })
  const [executionPayload, setExecutionPayload] = useState<ExecutionPayload | null>(null)
  const [optionChain, setOptionChain] = useState<OptionChainPayload | null>(null)
  const [optionMonth, setOptionMonth] = useState('')
  const [aiResult, setAiResult] = useState<AiResponse | null>(null)
  const [notice, setNotice] = useState('')
  const terminalRef = useRef<HTMLDivElement | null>(null)
  const splitterRef = useRef<PanelKey | null>(null)
  const triggeredAlertIdsRef = useRef<Set<string>>(new Set())

  const watchlist = settings?.watchlist?.length ? settings.watchlist : ['005930', '000660', '035420', '051910', '069500']
  const alertRules = settings?.alertRules || fallbackAlertRules
  const trackedSymbols = Array.from(new Set([...watchlist, ...alertRules.filter((rule) => rule.enabled).map((rule) => rule.symbol)]))
  const trackedSymbolsKey = trackedSymbols.join(',')
  const displayQuotes = quotes.filter((quote) => watchlist.includes(quote.symbol))
  const latestNews = newsItems[0] || null
  const activeLayout = layout[activeView]
  const tickerQuotes = [...indices, ...displayQuotes]

  useEffect(() => {
    api
      .me()
      .then((data) => {
        setUser(data.user)
        setSettings(data.settings)
      })
      .catch((error) => setNotice(error.message))
  }, [])

  useEffect(() => {
    setLayout(loadLayout(user?.id || null))
    setPanelWidths(loadPanelWidths(user?.id || null))
    setWidgetSizes(loadWidgetSizes(user?.id || null))
  }, [user?.id])

  useEffect(() => {
    localStorage.setItem(storageKey('cospi-layout-v2', user?.id || null), JSON.stringify(layout))
  }, [layout, user?.id])

  useEffect(() => {
    localStorage.setItem(storageKey('cospi-panel-widths-v2', user?.id || null), JSON.stringify(panelWidths))
  }, [panelWidths, user?.id])

  useEffect(() => {
    localStorage.setItem(storageKey('cospi-widget-sizes-v2', user?.id || null), JSON.stringify(widgetSizes))
  }, [widgetSizes, user?.id])

  const refreshQuotes = async () => {
    const data = await api.quotes(trackedSymbols)
    setQuotes(data.quotes)
  }

  const refreshIndices = async () => {
    const data = await api.indices()
    setIndices(data.indices)
  }

  const refreshMacro = async () => {
    const data = await api.macro()
    setMacroItems(data.items)
    setMacroSource(data.source)
  }

  const refreshNews = async () => {
    const data = await api.news()
    setNewsItems(data.items)
    setNewsSource(data.source)
  }

  const refreshDart = async () => {
    const data = await api.dart(selectedSymbol)
    setFilings(data.items)
    setDartSource(data.source)
  }

  const refreshFinancials = async () => {
    const data = await api.financials(selectedSymbol)
    setFinancialPayload(data)
    return data
  }

  const refreshChart = async () => {
    const data = await api.chart(selectedSymbol, chartRange, chartInterval)
    setChartPayload(data)
  }

  const refreshPortfolio = async () => {
    if (!user) return
    const data = await api.portfolio()
    setPositions(data.positions)
    setPortfolioSource(data.source)
    setPortfolioTotal({ value: data.totalValue, profitLoss: data.totalProfitLoss })
    setPortfolioSnapshots(data.snapshots)
  }

  const refreshExecutions = async () => {
    if (!user) return
    const data = await api.executions()
    setExecutionPayload(data)
  }

  const refreshOptions = async () => {
    const data = await api.options(optionMonth || null)
    setOptionChain(data)
    if (!optionMonth && data.selectedMonth) setOptionMonth(data.selectedMonth)
  }

  useEffect(() => {
    const symbols = trackedSymbolsKey.split(',').filter(Boolean)
    api
      .indices()
      .then((data) => setIndices(data.indices))
      .catch((error) => setNotice(error.message))
    api
      .quotes(symbols)
      .then((data) => setQuotes(data.quotes))
      .catch((error) => setNotice(error.message))
    api
      .macro()
      .then((data) => {
        setMacroItems(data.items)
        setMacroSource(data.source)
      })
      .catch((error) => setNotice(error.message))
    api
      .news()
      .then((data) => {
        setNewsItems(data.items)
        setNewsSource(data.source)
      })
      .catch((error) => setNotice(error.message))
  }, [trackedSymbolsKey])

  useEffect(() => {
    if (!alertRules.length || !quotes.length) return
    const prices = new Map(quotes.map((quote) => [quote.symbol, quote.price]))
    const nextTriggered = new Set(triggeredAlertIdsRef.current)
    const messages: string[] = []

    alertRules.forEach((rule) => {
      if (!rule.enabled) {
        nextTriggered.delete(rule.id)
        return
      }
      const price = prices.get(rule.symbol)
      if (price == null) {
        nextTriggered.delete(rule.id)
        return
      }
      const hit = rule.condition === 'above' ? price >= rule.targetPrice : price <= rule.targetPrice
      if (hit && !nextTriggered.has(rule.id)) {
        messages.push(`${rule.symbol} ${formatNumber(price)}원 ${rule.condition === 'above' ? '이상' : '이하'} ${formatNumber(rule.targetPrice)}원`)
        nextTriggered.add(rule.id)
      }
      if (!hit) nextTriggered.delete(rule.id)
    })

    triggeredAlertIdsRef.current = nextTriggered
    if (messages.length) setNotice(`가격 알림: ${messages.join(' / ')}`)
  }, [alertRules, quotes])

  useEffect(() => {
    if (!layoutHasWidget(activeLayout, 'options')) return
    api
      .options(optionMonth || null)
      .then((data) => {
        setOptionChain(data)
        if (!optionMonth && data.selectedMonth) setOptionMonth(data.selectedMonth)
      })
      .catch((error) => setNotice(error.message))
  }, [activeView, activeLayout, optionMonth])

  useEffect(() => {
    api
      .chart(selectedSymbol, chartRange, chartInterval)
      .then((data) => setChartPayload(data))
      .catch((error) => setNotice(error.message))
    api
      .dart(selectedSymbol)
      .then((data) => {
        setFilings(data.items)
        setDartSource(data.source)
      })
      .catch((error) => setNotice(error.message))
  }, [selectedSymbol, chartRange, chartInterval])

  useEffect(() => {
    if (!layoutHasWidget(activeLayout, 'financials')) return
    api
      .financials(selectedSymbol)
      .then((data) => setFinancialPayload(data))
      .catch((error) => setNotice(error.message))
  }, [selectedSymbol, activeView, activeLayout])

  useEffect(() => {
    if (!user?.id) return
    api
      .portfolio()
      .then((data) => {
        setPositions(data.positions)
        setPortfolioSource(data.source)
        setPortfolioTotal({ value: data.totalValue, profitLoss: data.totalProfitLoss })
        setPortfolioSnapshots(data.snapshots)
      })
      .catch((error) => setNotice(error.message))
  }, [user?.id, settings?.manualPortfolio])

  useEffect(() => {
    if (!user?.id || !layoutHasWidget(activeLayout, 'executions')) return
    api
      .executions()
      .then((data) => setExecutionPayload(data))
      .catch((error) => setNotice(error.message))
  }, [user?.id, activeView, activeLayout])

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const panel = splitterRef.current
      const terminal = terminalRef.current
      if (!panel || !terminal) return
      const rect = terminal.getBoundingClientRect()
      if (panel === 'left') {
        setPanelWidths((current) => ({
          ...current,
          left: Math.min(460, Math.max(220, event.clientX - rect.left)),
        }))
      }
      if (panel === 'right') {
        setPanelWidths((current) => ({
          ...current,
          right: Math.min(520, Math.max(260, rect.right - event.clientX)),
        }))
      }
    }
    const onUp = () => {
      splitterRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const moveWidget = (targetPanel: PanelKey) => {
    if (!draggedWidget) return
    setLayout((current) => {
      const nextView: ViewLayout = {
        left: current[activeView].left.filter((id) => id !== draggedWidget),
        center: current[activeView].center.filter((id) => id !== draggedWidget),
        right: current[activeView].right.filter((id) => id !== draggedWidget),
      }
      nextView[targetPanel] = [...nextView[targetPanel], draggedWidget]
      return { ...current, [activeView]: nextView }
    })
    setDraggedWidget(null)
  }

  const handleCommand = () => {
    const trimmed = command.trim()
    if (!trimmed) return
    if (/^\d{6}$/.test(trimmed)) {
      setSelectedSymbol(trimmed)
      setActiveView('chart')
    } else if (trimmed === '/ai') {
      setActiveView('ai')
    } else {
      setNotice(`명령을 처리하지 못했습니다: ${trimmed}`)
    }
    setCommand('')
  }

  const analyze = async (prompt: string) => {
    const result = await api.ai(prompt)
    setAiResult(result)
    setActiveView('ai')
  }

  const login = async (email: string, password: string) => {
    const data = await api.login(email, password)
    setUser(data.user)
    setSettings(data.settings)
    setNotice('로그인되었습니다.')
  }

  const register = async (email: string, password: string) => {
    const data = await api.register(email, password)
    setUser(data.user)
    setSettings(data.settings)
    setNotice('계정이 생성되었습니다.')
  }

  const logout = async () => {
    await api.logout()
    const data = await api.me()
    setUser(data.user)
    setSettings(data.settings)
    setPositions([])
    setExecutionPayload(null)
    setNotice('로그아웃되었습니다.')
  }

  const saveSettings = async (payload: Record<string, unknown>) => {
    const data = await api.saveSettings(payload)
    setSettings(data.settings)
    setNotice('설정이 저장되었습니다.')
  }

  const saveManualPortfolio = async (portfolio: ManualHolding[]) => {
    const data = await api.saveManualPortfolio(portfolio)
    setSettings(data.settings)
    await refreshPortfolio()
  }

  const submitOrder = async (payload: Record<string, unknown>) => {
    const response = await api.order(payload)
    setNotice(response.message)
    return response.message
  }

  const refreshMap: Partial<Record<WidgetId, () => void>> = {
    indices: () => refreshIndices().catch((error) => setNotice(error.message)),
    'market-watch': () => refreshQuotes().catch((error) => setNotice(error.message)),
    macro: () => refreshMacro().catch((error) => setNotice(error.message)),
    chart: () => refreshChart().catch((error) => setNotice(error.message)),
    news: () => refreshNews().catch((error) => setNotice(error.message)),
    dart: () => refreshDart().catch((error) => setNotice(error.message)),
    financials: () => refreshFinancials().catch((error) => setNotice(error.message)),
    portfolio: () => refreshPortfolio().catch((error) => setNotice(error.message)),
    executions: () => refreshExecutions().catch((error) => setNotice(error.message)),
    options: () => refreshOptions().catch((error) => setNotice(error.message)),
  }

  const widgetContent: Record<WidgetId, ReactNode> = {
    indices: <IndexPanel indices={indices} />,
    'market-watch': <MarketWatch quotes={displayQuotes} onSelect={(symbol) => setSelectedSymbol(symbol)} />,
    macro: <MacroPanel items={macroItems} source={macroSource} />,
    chart: (
      <ChartPanel
        payload={chartPayload}
        range={chartRange}
        interval={chartInterval}
        selectedSymbol={selectedSymbol}
        onRange={setChartRange}
        onInterval={setChartInterval}
      />
    ),
    news: <NewsPanel items={newsItems} source={newsSource} onAnalyze={analyze} />,
    dart: <DartPanel items={filings} source={dartSource} selectedSymbol={selectedSymbol} onSymbol={setSelectedSymbol} onRefresh={refreshDart} />,
    financials: <FinancialPanel payload={financialPayload} selectedSymbol={selectedSymbol} onSymbol={setSelectedSymbol} onRefresh={refreshFinancials} />,
    portfolio: (
      <PortfolioPanel
        user={user}
        settings={settings}
        positions={positions}
        snapshots={portfolioSnapshots}
        source={portfolioSource}
        totalValue={portfolioTotal.value}
        totalProfitLoss={portfolioTotal.profitLoss}
        onSaveManual={saveManualPortfolio}
      />
    ),
    executions: <ExecutionsPanel user={user} payload={executionPayload} onRefresh={refreshExecutions} />,
    options: <OptionsPanel payload={optionChain} selectedMonth={optionMonth} onMonth={setOptionMonth} onRefresh={refreshOptions} />,
    order: <OrderPanel user={user} selectedSymbol={selectedSymbol} onOrder={submitOrder} />,
    ai: (
      <AiPanel
        selectedSymbol={selectedSymbol}
        latestNews={latestNews}
        filings={filings}
        financialPayload={financialPayload}
        chartPayload={chartPayload}
        positions={positions}
        portfolioTotal={portfolioTotal}
        portfolioSource={portfolioSource}
        result={aiResult}
        onAnalyze={analyze}
        onLoadFinancials={refreshFinancials}
      />
    ),
    settings: <SettingsPanel user={user} settings={settings} onLogin={login} onRegister={register} onLogout={logout} onSave={saveSettings} />,
  }

  const updateWidgetSize = useCallback((id: WidgetId, size: WidgetSize) => {
    setWidgetSizes((current) => {
      const previous = current[activeView]?.[id]
      if (previous?.width === size.width && previous?.height === size.height) return current
      return {
        ...current,
        [activeView]: {
          ...current[activeView],
          [id]: size,
        },
      }
    })
  }, [activeView])

  const renderPanel = (panel: PanelKey) => (
    <div
      className={`terminal-panel panel-${panel}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => moveWidget(panel)}
    >
      {activeLayout[panel].map((widgetId) => (
        <WidgetFrame
          key={widgetId}
          id={widgetId}
          onDragStart={setDraggedWidget}
          onRefresh={refreshMap[widgetId]}
          size={widgetSizes[activeView]?.[widgetId]}
          onResize={updateWidgetSize}
        >
          {widgetContent[widgetId]}
        </WidgetFrame>
      ))}
    </div>
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <LayoutGrid size={18} />
          <strong>COSPI WTS</strong>
        </div>
        <nav className="global-nav">
          {views.map((view) => {
            const Icon = view.icon
            return (
              <button type="button" key={view.id} className={activeView === view.id ? 'active' : ''} onClick={() => setActiveView(view.id)}>
                <Icon size={15} />
                {view.label}
              </button>
            )
          })}
        </nav>
        <div className="command">
          <Search size={15} />
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleCommand()
            }}
            placeholder="005930 또는 /ai"
          />
          <button type="button" className="icon-button" title="실행" onClick={handleCommand}>
            <ChevronDown size={14} />
          </button>
        </div>
        <button type="button" className="ai-button" onClick={() => setActiveView('ai')}>
          <Bot size={16} />
          AI
        </button>
        <button type="button" className="icon-button auth-indicator" title={user ? user.email : '비로그인'} onClick={() => setActiveView('settings')}>
          {user ? <KeyRound size={16} /> : <LogIn size={16} />}
        </button>
      </header>
      <TickerStrip quotes={tickerQuotes} onSelect={(symbol) => setSelectedSymbol(symbol)} />
      {notice ? (
        <div className="notice">
          <Bell size={14} />
          <span>{notice}</span>
          <button type="button" className="icon-button" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      ) : null}
      <main
        ref={terminalRef}
        className="terminal-grid"
        style={{
          gridTemplateColumns: `${panelWidths.left}px 6px minmax(430px, 1fr) 6px ${panelWidths.right}px`,
        }}
      >
        {renderPanel('left')}
        <button type="button" className="splitter" aria-label="좌측 패널 조절" onMouseDown={() => (splitterRef.current = 'left')} />
        {renderPanel('center')}
        <button type="button" className="splitter" aria-label="우측 패널 조절" onMouseDown={() => (splitterRef.current = 'right')} />
        {renderPanel('right')}
      </main>
    </div>
  )
}

export default App
