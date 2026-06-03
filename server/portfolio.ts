import { getBrokerPortfolio, getQuotes, source } from './kis.ts'
import type { ManualHolding, PortfolioPosition, SourceMeta, UserSettings } from './types.ts'

const positionFromHolding = (holding: ManualHolding, marketPrice: number | null, quoteSource: PortfolioPosition['source']): PortfolioPosition => {
  const cost = holding.quantity * holding.averagePrice
  const marketValue = marketPrice == null ? null : holding.quantity * marketPrice
  const profitLoss = marketValue == null ? null : marketValue - cost
  const returnRate = profitLoss == null || cost === 0 ? null : (profitLoss / cost) * 100
  return {
    ...holding,
    marketPrice,
    marketValue,
    profitLoss,
    returnRate,
    weight: null,
    source: quoteSource,
  }
}

const applyWeights = (positions: PortfolioPosition[]) => {
  const total = positions.reduce((sum, position) => sum + (position.marketValue || 0), 0)
  return positions.map((position) => ({
    ...position,
    weight: total > 0 && position.marketValue != null ? (position.marketValue / total) * 100 : null,
  }))
}

export const getPortfolio = async (settings: UserSettings) => {
  const manual = settings.manualPortfolio || []
  let manualPositions: PortfolioPosition[] = []
  if (manual.length) {
    const quotes = await getQuotes(
      manual.map((holding) => holding.symbol),
      settings,
    )
    manualPositions = manual.map((holding) => {
      const quote = quotes.find((item) => item.symbol === holding.symbol)
      return positionFromHolding(
        holding,
        quote?.price ?? null,
        quote?.source || source('NO_DATA', '수동 포트폴리오의 현재가가 없습니다.'),
      )
    })
  }

  const brokerAccessSource = !settings.kisAppKey || !settings.kisAppSecret
    ? source('API_REQUIRED', 'KIS App Key/App Secret이 필요합니다.')
    : !settings.kisAccountNo
      ? source('API_REQUIRED', 'KIS 계좌번호(CANO)가 필요합니다.')
      : null

  let brokerPositions: PortfolioPosition[] = []
  if (!brokerAccessSource) {
    try {
      brokerPositions = await getBrokerPortfolio(settings)
    } catch (error) {
      brokerPositions = [
        {
          id: 'kis-balance-error',
          symbol: 'KIS',
          name: 'KIS 잔고 조회',
          sector: '시스템',
          quantity: 0,
          averagePrice: 0,
          expectedDividend: 0,
          marketPrice: null,
          marketValue: null,
          profitLoss: null,
          returnRate: null,
          weight: null,
          source: source('ERROR', error instanceof Error ? error.message : 'KIS 잔고 조회 오류'),
        },
      ]
    }
  }

  const positions = applyWeights([...brokerPositions, ...manualPositions])
  const totalValue = positions.reduce((sum, position) => sum + (position.marketValue || 0), 0)
  const totalProfitLoss = positions.reduce((sum, position) => sum + (position.profitLoss || 0), 0)
  const sourceState: SourceMeta['state'] = brokerAccessSource
    ? brokerAccessSource.state
    : positions.length
      ? positions.some((position) => position.source.state === 'ERROR')
        ? 'ERROR'
        : positions.some((position) => position.source.state === 'API_REQUIRED')
          ? 'API_REQUIRED'
          : 'NEAR_REALTIME'
      : 'NO_DATA'
  const sourceMessage = brokerAccessSource?.message || (positions.length ? '브로커 잔고와 수동 포트폴리오를 합산했습니다.' : '포트폴리오 항목이 없습니다.')

  return {
    source: source(sourceState, sourceMessage),
    totalValue,
    totalProfitLoss,
    positions,
  }
}
