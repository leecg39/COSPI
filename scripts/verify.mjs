import dotenv from 'dotenv'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { chromium } from 'playwright'

const loadedEnv = dotenv.config({ quiet: true }).parsed || {}
Object.entries(loadedEnv).forEach(([key, value]) => {
  if (!process.env[key]?.trim()) process.env[key] = value
})

const apiBase = process.env.VERIFY_API_BASE || `http://localhost:${process.env.PORT || 4100}`
const uiBase = process.env.VERIFY_UI_BASE || 'http://localhost:5173'
const rawEnvValue = (key) => {
  if (!fs.existsSync('.env')) return undefined
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = fs.readFileSync('.env', 'utf8').match(new RegExp(`^\\s*${escaped}\\s*=\\s*(.*)$`, 'm'))
  return match?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2')
}
const rawAccountNo = process.env.KIS_ACCOUNT_NO?.trim() || rawEnvValue('KIS_ACCOUNT_NO')
const rawAccountNoPresent = Boolean(rawAccountNo)
const hasAccountNo = /^\d{8}$/.test(rawAccountNo || '')
const expectedAccountStatus = hasAccountNo ? 'connected' : rawAccountNoPresent ? 'invalid' : 'missing'

const results = []

const record = (name, ok, details = '') => {
  results.push({ name, ok, details })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${details ? ` - ${details}` : ''}`)
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const jsonFetch = async (path, init) => {
  const response = await fetch(path.startsWith('http') ? path : `${apiBase}${path}`, init)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`)
  return data
}

const sessionCookie = (response) => response.headers.get('set-cookie')?.split(';')[0]

const loginOrRegister = async (email, password) => {
  const login = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const loginCookie = sessionCookie(login)
  if (login.ok && loginCookie) return loginCookie

  const register = await fetch(`${apiBase}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const registerCookie = sessionCookie(register)
  assert(register.ok && registerCookie, 'auth did not create a session cookie')
  return registerCookie
}

const logout = async (cookie) => {
  if (!cookie) return
  await fetch(`${apiBase}/api/auth/logout`, {
    method: 'POST',
    headers: { cookie },
  }).catch(() => undefined)
}

const run = async (name, fn) => {
  try {
    const details = await fn()
    record(name, true, details)
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error))
  }
}

const requiredEnv = ['KIS_APP_KEY', 'KIS_APP_SECRET', 'DART_API_KEY', 'GEMINI_API_KEY']
await run('environment keys', () => {
  const missing = requiredEnv.filter((key) => !process.env[key]?.trim())
  assert(missing.length === 0, `missing ${missing.join(', ')}`)
  return hasAccountNo ? 'market/ai keys and valid KIS account are present' : 'market/ai keys present; KIS_ACCOUNT_NO is empty or invalid'
})

await run('health', async () => {
  const data = await jsonFetch('/api/health')
  assert(data.ok === true, 'health ok was not true')
  return data.service || 'ok'
})

await run('provider status', async () => {
  const data = await jsonFetch('/api/providers/status')
  assert(data.kis?.configured, 'KIS keys are not configured')
  assert(data.dart?.configured, 'DART key is not configured')
  assert(data.gemini?.configured, 'Gemini key is not configured')
  assert(Boolean(data.kis?.accountConfigured) === hasAccountNo, 'KIS account status does not match .env')
  assert(data.kis?.accountStatus === expectedAccountStatus, `expected KIS account status ${expectedAccountStatus}, got ${data.kis?.accountStatus}`)
  return `kis=${data.kis.configured}, account=${data.kis.accountStatus}, dart=${data.dart.configured}, gemini=${data.gemini.configured}`
})

await run('market quotes', async () => {
  const data = await jsonFetch('/api/market/quotes?symbols=005930,000660')
  assert(data.source?.state === 'NEAR_REALTIME', `unexpected state ${data.source?.state}`)
  assert(data.quotes?.length === 2, 'expected two quotes')
  assert(data.quotes.every((quote) => quote.price != null), 'quote price is missing')
  return `${data.quotes.length} quotes`
})

await run('indices', async () => {
  const data = await jsonFetch('/api/market/indices')
  assert(data.source?.state === 'NEAR_REALTIME', `unexpected state ${data.source?.state}`)
  assert(data.indices?.length >= 4, 'expected domestic indices')
  return `${data.indices.length} indices`
})

await run('macro', async () => {
  const data = await jsonFetch('/api/market/macro')
  assert(data.source?.state === 'NEAR_REALTIME', `unexpected state ${data.source?.state}`)
  assert(data.items?.length === 5, `expected 5 macro items, got ${data.items?.length}`)
  const weak = data.items.filter((item) => item.source?.state !== 'NEAR_REALTIME' || item.price == null)
  assert(weak.length === 0, `missing macro values: ${weak.map((item) => item.symbol).join(', ')}`)
  return data.items.map((item) => item.symbol).join(', ')
})

await run('chart', async () => {
  const data = await jsonFetch('/api/market/chart?symbol=005930&range=1Y&interval=1D')
  assert(data.source?.state === 'NEAR_REALTIME', `unexpected state ${data.source?.state}`)
  assert(data.candles?.length > 20, 'not enough candles')
  return `${data.candles.length} candles`
})

await run('news', async () => {
  const data = await jsonFetch('/api/news')
  assert(data.source?.state === 'DELAYED', `unexpected state ${data.source?.state}`)
  assert(data.items?.length > 0, 'news is empty')
  assert(data.items.every((item) => typeof item.id === 'string'), 'news id must be a string')
  return `${data.items.length} items`
})

await run('dart', async () => {
  const data = await jsonFetch('/api/research/dart?stockCode=005930')
  assert(['DELAYED', 'NO_DATA'].includes(data.source?.state), `unexpected state ${data.source?.state}`)
  assert(data.source?.state === 'NO_DATA' || data.items?.length > 0, 'DART items are empty')
  return `${data.source.state}, ${data.items.length} items`
})

await run('financials', async () => {
  const data = await jsonFetch('/api/research/financials?symbol=005930')
  assert(data.source?.state === 'NEAR_REALTIME', `unexpected state ${data.source?.state}`)
  assert(data.rows?.length > 0, 'financial rows are empty')
  return `${data.rows.length} rows`
})

await run('options', async () => {
  const data = await jsonFetch('/api/market/options')
  assert(data.source?.state === 'NEAR_REALTIME', `unexpected state ${data.source?.state}`)
  assert(data.months?.length > 0, 'option months are empty')
  assert(data.calls?.length > 0 && data.puts?.length > 0, 'option calls/puts are empty')
  return `${data.months.length} months, ${data.calls.length}/${data.puts.length} contracts`
})

await run('ai', async () => {
  const data = await jsonFetch('/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '연결 상태를 한 문장으로 확인해줘.' }),
  })
  assert(data.mode === 'gemini', `unexpected mode ${data.mode}`)
  assert(data.source?.state === 'NEAR_REALTIME', `unexpected state ${data.source?.state}`)
  return `${data.mode}/${data.source.provider}`
})

await run('authenticated account APIs', async () => {
  const email = 'verify-api@cospi.local'
  const password = 'password123'
  const cookie = await loginOrRegister(email, password)
  try {
    const portfolio = await jsonFetch('/api/portfolio', { headers: { cookie } })
    const executions = await jsonFetch('/api/portfolio/executions', { headers: { cookie } })
    const safeOrder = await jsonFetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        mode: hasAccountNo ? 'live' : 'paper',
        side: 'buy',
        symbol: '005930',
        quantity: 1,
        orderType: 'limit',
        price: 1,
        liveConfirm: '검증용 차단',
      }),
    })
    if (hasAccountNo) {
      assert(portfolio.source?.state !== 'API_REQUIRED', 'KIS account is set but portfolio still requires API')
      assert(executions.source?.state !== 'API_REQUIRED', 'KIS account is set but executions still require API')
      assert(safeOrder.accepted === false && safeOrder.source?.state === 'API_REQUIRED', 'live order safety gate did not block verification order')
    } else {
      assert(portfolio.source?.state === 'API_REQUIRED', `expected portfolio API_REQUIRED without account, got ${portfolio.source?.state}`)
      assert(executions.source?.state === 'API_REQUIRED', `expected API_REQUIRED without account, got ${executions.source?.state}`)
      assert(safeOrder.accepted === false && safeOrder.source?.state === 'API_REQUIRED', 'paper order did not report API_REQUIRED without account')
    }
    return `portfolio=${portfolio.source.state}, executions=${executions.source.state}, order=${safeOrder.source.state}`
  } finally {
    await logout(cookie)
  }
})

await run('browser smoke', async () => {
  const cookie = await loginOrRegister('verify-ui@cospi.local', 'password123')
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 860 } })
    const [cookieName, ...cookieValueParts] = cookie.split('=')
    await context.addCookies([
      {
        name: cookieName,
        value: cookieValueParts.join('='),
        url: uiBase,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])
    const page = await context.newPage()
    const errors = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.goto(uiBase, { waitUntil: 'load' })
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: '설정' }).click()
    await page.waitForTimeout(700)
    const settingsText = await page.locator('body').innerText()
    assert(settingsText.includes('KIS 키') && settingsText.includes('연결됨'), 'KIS status is not visible')
    assert(settingsText.includes('DART') && settingsText.includes('Gemini'), 'provider status summary is incomplete')
    const expectedAccountText = expectedAccountStatus === 'connected' ? '연결됨' : expectedAccountStatus === 'invalid' ? '형식 오류' : '필요'
    assert(settingsText.includes('KIS 계좌') && settingsText.includes(expectedAccountText), 'KIS account status is incorrect')
    await page.getByRole('button', { name: '시장' }).click()
    await page.waitForTimeout(700)
    const marketText = await page.locator('body').innerText()
    assert(!marketText.includes('N225') && !marketText.includes('Nikkei'), 'removed empty Nikkei item is still visible')
    const design = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      const activeNav = document.querySelector('.global-nav button.active')
      const widget = document.querySelector('.widget')
      const chart = document.querySelector('.chart-canvas')
      const checkedText = [...document.querySelectorAll('.global-nav button, .widget-header h2')].map((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }))
      return {
        rootBg: root.getPropertyValue('--bg').trim(),
        primary: root.getPropertyValue('--color-coinbase-blue').trim(),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        activeBg: activeNav ? getComputedStyle(activeNav).backgroundColor : '',
        widgetBg: widget ? getComputedStyle(widget).backgroundColor : '',
        widgetRadius: widget ? getComputedStyle(widget).borderRadius : '',
        chartBg: chart ? getComputedStyle(chart).backgroundColor : '',
        clippedTextCount: checkedText.filter((item) => item.scrollWidth > item.clientWidth + 1).length,
      }
    })
    assert(design.rootBg === '#ffffff', `DESIGN.md root background token not applied: ${design.rootBg}`)
    assert(design.primary === '#0052ff', `DESIGN.md primary token not applied: ${design.primary}`)
    assert(design.bodyBg === 'rgb(247, 248, 249)', `unexpected body background ${design.bodyBg}`)
    assert(design.activeBg === 'rgb(0, 82, 255)', `active nav is not Coinbase blue: ${design.activeBg}`)
    assert(design.widgetBg === 'rgb(255, 255, 255)', `widget background is not white: ${design.widgetBg}`)
    assert(design.widgetRadius === '24px', `widget radius does not match DESIGN.md cards: ${design.widgetRadius}`)
    assert(design.chartBg === 'rgb(255, 255, 255)', `chart background is not light: ${design.chartBg}`)
    assert(design.clippedTextCount === 0, `navigation/widget text is clipped in ${design.clippedTextCount} places`)
    assert(errors.length === 0, `browser console errors: ${errors.slice(0, 3).join(' | ')}`)
    return 'settings, market, and DESIGN.md tokens rendered without console errors'
  } finally {
    await logout(cookie)
    await browser.close()
  }
})

await run('zip excludes secrets', () => {
  if (!fs.existsSync('cospi-wts.zip')) return 'cospi-wts.zip not present; skipped'
  const unzip = spawnSync('unzip', ['-l', 'cospi-wts.zip'], { encoding: 'utf8' })
  assert(unzip.status === 0, unzip.stderr || 'unzip failed')
  const forbidden = unzip.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/).slice(3).join(' '))
    .filter((name) => name === '.env' || name.startsWith('data/') || name.includes('store.json') || name.includes('dart-corp-codes') || /^cospi-.*\.png$/.test(name))
  assert(forbidden.length === 0, `forbidden files in zip: ${forbidden.join(', ')}`)
  return 'no .env/data/store/cache/debug images'
})

const failed = results.filter((result) => !result.ok)
if (failed.length) {
  console.error(`\n${failed.length} verification checks failed.`)
  process.exit(1)
}

console.log(`\nAll ${results.length} verification checks passed.`)
