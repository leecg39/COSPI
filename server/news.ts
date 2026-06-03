import { XMLParser } from 'fast-xml-parser'
import { nanoid } from 'nanoid'
import { source } from './kis.ts'
import type { NewsItem } from './types.ts'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
})

const symbolKeywordMap: Record<string, string[]> = {
  '005930': ['삼성전자', '삼성', '반도체'],
  '000660': ['SK하이닉스', '하이닉스', 'HBM'],
  '035420': ['NAVER', '네이버'],
  '035720': ['카카오'],
  '051910': ['LG화학', '배터리'],
  '068270': ['셀트리온', '바이오'],
  '069500': ['KODEX 200', '코스피200', 'ETF'],
}

const positiveWords = ['상승', '개선', '호조', '수혜', '증가', '최고', '강세', '흑자', '기대']
const negativeWords = ['하락', '부진', '적자', '감소', '우려', '급락', '약세', '리스크', '쇼크']
const highWords = ['속보', '긴급', '실적', '공시', '금리', '환율', '반도체', '코스피', '코스닥']

const stripHtml = (value: string) =>
  value
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .trim()

const textValue = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return textValue(record['#text'] ?? record.text ?? record._text ?? record.href ?? '')
  }
  return ''
}

const pickPublisher = (title: string) => {
  const parts = title.split(' - ')
  return parts.length > 1 ? parts.at(-1) || 'Google News' : 'Google News'
}

const localAnalyze = (title: string, summary: string) => {
  const text = `${title} ${summary}`
  const positive = positiveWords.filter((word) => text.includes(word)).length
  const negative = negativeWords.filter((word) => text.includes(word)).length
  const relatedSymbols = Object.entries(symbolKeywordMap)
    .filter(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))
    .map(([symbol]) => symbol)
  const importance = highWords.some((word) => text.includes(word)) || relatedSymbols.length > 0 ? 'high' : text.length > 90 ? 'medium' : 'low'

  return {
    sentiment: positive > negative ? 'positive' : negative > positive ? 'negative' : 'neutral',
    importance,
    relatedSymbols,
  } as Pick<NewsItem, 'sentiment' | 'importance' | 'relatedSymbols'>
}

export const getMarketNews = async () => {
  const query = encodeURIComponent('국내 주식 OR 코스피 OR 코스닥 경제')
  const url = `https://news.google.com/rss/search?q=${query}&hl=ko&gl=KR&ceid=KR:ko`
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return {
        source: source('ERROR', `뉴스 RSS 응답 오류 ${response.status}`, 'Google News RSS'),
        items: [] as NewsItem[],
      }
    }
    const xml = await response.text()
    const parsed = parser.parse(xml) as {
      rss?: { channel?: { item?: Array<Record<string, string>> | Record<string, string> } }
    }
    const rawItems = parsed.rss?.channel?.item
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : []
    const news = items.slice(0, 18).map((item) => {
      const title = stripHtml(textValue(item.title) || '제목 없음')
      const description = stripHtml(textValue(item.description))
      const summary = description.split('...')[0]?.slice(0, 180) || title
      const analysis = localAnalyze(title, summary)
      const itemSource = source('DELAYED', '공개 RSS 기반 지연 뉴스입니다.', 'Google News RSS')
      const pubDate = textValue(item.pubDate)
      const guid = textValue(item.guid)
      const link = textValue(item.link)
      const publishedAt = pubDate ? new Date(pubDate).toISOString() : null
      return {
        id: guid || link || nanoid(),
        title,
        link: link || url,
        publisher: pickPublisher(title),
        publishedAt,
        summary,
        ...analysis,
        source: itemSource,
      } satisfies NewsItem
    })
    return {
      source: source(news.length ? 'DELAYED' : 'NO_DATA', news.length ? '공개 RSS 기반 지연 뉴스입니다.' : '뉴스 항목이 없습니다.', 'Google News RSS'),
      items: news,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '뉴스 RSS 조회 오류'
    return {
      source: source('ERROR', message, 'Google News RSS'),
      items: [] as NewsItem[],
    }
  }
}
