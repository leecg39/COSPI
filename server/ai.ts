import { source } from './kis.ts'
import type { AiResponse, UserSettings } from './types.ts'

const localSummary = (prompt: string) => {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  const riskWords = ['급락', '적자', '부채', '소송', '감자', '유상증자', '하락']
  const positiveWords = ['성장', '흑자', '수주', '개선', '증가', '배당', '상승']
  const risks = riskWords.filter((word) => clean.includes(word))
  const positives = positiveWords.filter((word) => clean.includes(word))
  const bias = positives.length > risks.length ? '긍정 신호가 더 많습니다.' : risks.length > positives.length ? '주의 신호가 더 많습니다.' : '긍정/부정 신호가 혼재합니다.'
  const clipped = clean.slice(0, 360)
  return [
    '로컬 규칙 기반 요약입니다. Gemini API 키가 없어서 문맥 추론은 제한됩니다.',
    `핵심 내용: ${clipped || '분석할 텍스트가 충분하지 않습니다.'}`,
    `신호 판단: ${bias}`,
    risks.length ? `주의 키워드: ${risks.join(', ')}` : '주의 키워드: 뚜렷한 위험 단어가 감지되지 않았습니다.',
    positives.length ? `긍정 키워드: ${positives.join(', ')}` : '긍정 키워드: 뚜렷한 긍정 단어가 감지되지 않았습니다.',
    '투자 판단은 실시간 시세, 공시 원문, 재무제표와 함께 다시 확인해야 합니다.',
  ].join('\n')
}

const extractGeminiText = (data: unknown) => {
  const candidate = data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  return candidate.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n').trim()
}

export const analyzeWithAi = async (settings: UserSettings, prompt: string): Promise<AiResponse> => {
  const apiKey = settings.geminiApiKey
  if (!apiKey) {
    return {
      mode: 'local-rule',
      answer: localSummary(prompt),
      source: source('API_REQUIRED', 'Gemini API 키가 없어 로컬 규칙 기반 분석을 사용했습니다.', 'Local Rule Analyzer'),
    }
  }

  const model = settings.geminiModel || 'gemini-3.5-flash'
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: [
                  '너는 한국 주식 투자자를 돕는 금융 리서치 어시스턴트다.',
                  '확정되지 않은 내용은 단정하지 말고, 데이터 상태와 리스크를 분리해서 한국어로 답하라.',
                  prompt,
                ].join('\n\n'),
              },
            ],
          },
        ],
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return {
        mode: 'local-rule',
        answer: `${localSummary(prompt)}\n\nGemini 호출 실패: ${response.status}`,
        source: source('ERROR', `Gemini 호출 실패 ${response.status}`, 'Gemini API'),
      }
    }
    const text = extractGeminiText(data)
    return {
      mode: 'gemini',
      answer: text || localSummary(prompt),
      source: source(text ? 'NEAR_REALTIME' : 'NO_DATA', text ? `Gemini ${model} 분석입니다.` : 'Gemini 응답 텍스트가 비어 있습니다.', 'Gemini API'),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini 호출 오류'
    return {
      mode: 'local-rule',
      answer: `${localSummary(prompt)}\n\nGemini 호출 오류: ${message}`,
      source: source('ERROR', message, 'Gemini API'),
    }
  }
}
