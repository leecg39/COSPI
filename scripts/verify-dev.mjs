import { spawn } from 'node:child_process'

const apiBase = process.env.VERIFY_API_BASE || `http://localhost:${process.env.PORT || 4100}`
const uiBase = process.env.VERIFY_UI_BASE || 'http://localhost:5173'
const timeoutMs = Number(process.env.VERIFY_DEV_TIMEOUT_MS || 45_000)
const startedAt = Date.now()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isApiReady = async () => {
  try {
    const response = await fetch(`${apiBase}/api/health`)
    const data = await response.json().catch(() => ({}))
    return response.ok && data.ok === true
  } catch {
    return false
  }
}

const isUiReady = async () => {
  try {
    const response = await fetch(uiBase)
    const text = await response.text().catch(() => '')
    return response.ok && text.includes('root')
  } catch {
    return false
  }
}

const waitFor = async (label, check) => {
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return
    await sleep(500)
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms`)
}

const runChild = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    })
    child.on('exit', (code) => resolve(code ?? 1))
  })

let devProcess = null
const apiReady = await isApiReady()
const uiReady = await isUiReady()

if (apiReady && uiReady) {
  console.log(`Reusing running COSPI dev server at ${uiBase} and ${apiBase}`)
} else {
  console.log('Starting COSPI dev server for verification...')
  devProcess = spawn('npm', ['run', 'dev'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
  await waitFor('API server', isApiReady)
  await waitFor('UI server', isUiReady)
}

const shutdown = () => {
  if (devProcess && !devProcess.killed) devProcess.kill('SIGINT')
}

process.on('SIGINT', () => {
  shutdown()
  process.exit(130)
})
process.on('SIGTERM', () => {
  shutdown()
  process.exit(143)
})

try {
  const code = await runChild('node', ['scripts/verify.mjs'], {
    env: {
      ...process.env,
      VERIFY_API_BASE: apiBase,
      VERIFY_UI_BASE: uiBase,
    },
  })
  shutdown()
  process.exit(code)
} catch (error) {
  shutdown()
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
