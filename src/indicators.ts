import type { Candle } from './types'

export type IndicatorPoint = {
  time: string
  value: number
}

export type BollingerPoint = {
  time: string
  middle: number
  upper: number
  lower: number
}

export type MacdPoint = {
  time: string
  macd: number
  signal: number
  histogram: number
}

const round = (value: number) => Number(value.toFixed(2))

export const movingAverage = (candles: Candle[], period: number): IndicatorPoint[] =>
  candles
    .map((candle, index) => {
      if (index + 1 < period) return null
      const slice = candles.slice(index + 1 - period, index + 1)
      return {
        time: candle.time,
        value: round(slice.reduce((sum, item) => sum + item.close, 0) / period),
      }
    })
    .filter((item): item is IndicatorPoint => Boolean(item))

export const bollingerBands = (candles: Candle[], period = 20, multiplier = 2): BollingerPoint[] =>
  candles
    .map((candle, index) => {
      if (index + 1 < period) return null
      const slice = candles.slice(index + 1 - period, index + 1)
      const middle = slice.reduce((sum, item) => sum + item.close, 0) / period
      const variance = slice.reduce((sum, item) => sum + (item.close - middle) ** 2, 0) / period
      const deviation = Math.sqrt(variance)
      return {
        time: candle.time,
        middle: round(middle),
        upper: round(middle + deviation * multiplier),
        lower: round(middle - deviation * multiplier),
      }
    })
    .filter((item): item is BollingerPoint => Boolean(item))

const ema = (values: number[], period: number) => {
  const k = 2 / (period + 1)
  return values.reduce<number[]>((acc, value, index) => {
    if (index === 0) return [value]
    acc.push(value * k + acc[index - 1] * (1 - k))
    return acc
  }, [])
}

export const rsi = (candles: Candle[], period = 14): IndicatorPoint[] => {
  if (candles.length <= period) return []
  const points: IndicatorPoint[] = []
  for (let index = period; index < candles.length; index += 1) {
    const slice = candles.slice(index - period + 1, index + 1)
    let gains = 0
    let losses = 0
    for (let cursor = 1; cursor < slice.length; cursor += 1) {
      const change = slice[cursor].close - slice[cursor - 1].close
      if (change >= 0) gains += change
      else losses += Math.abs(change)
    }
    const averageGain = gains / period
    const averageLoss = losses / period
    const value = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)
    points.push({ time: candles[index].time, value: round(value) })
  }
  return points
}

export const macd = (candles: Candle[]): MacdPoint[] => {
  const closes = candles.map((candle) => candle.close)
  const fast = ema(closes, 12)
  const slow = ema(closes, 26)
  const macdLine = closes.map((_, index) => fast[index] - slow[index])
  const signalLine = ema(macdLine, 9)
  return candles
    .map((candle, index) => {
      if (index < 26) return null
      const macdValue = macdLine[index]
      const signal = signalLine[index]
      return {
        time: candle.time,
        macd: round(macdValue),
        signal: round(signal),
        histogram: round(macdValue - signal),
      }
    })
    .filter((item): item is MacdPoint => Boolean(item))
}
