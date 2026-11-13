import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { pollForToken, requestDeviceCode, type DeviceCode } from '../src/lib/github/oauth.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

type Answer = { status?: number; body: unknown } | Error

/** Answers each request with the next entry, and records what was sent. */
function stubFetch(answers: Answer[]) {
  const sent: Array<{ url: string; params: Record<string, string> }> = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      params: Object.fromEntries(new URLSearchParams(init.body as URLSearchParams)),
    })
    const answer = answers.shift()
    if (!answer) throw new Error('no answer left')
    if (answer instanceof Error) throw answer
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return sent
}

const code: DeviceCode = {
  deviceCode: 'DEVICE',
  userCode: 'WDJB-MJHT',
  verificationUri: 'https://github.com/login/device',
  expiresAt: 900_000,
  intervalMs: 5_000,
}

/** Polls with no real waiting, and records how long each wait would have been. */
function instantly() {
  const waits: number[] = []
  return {
    waits,
    options: { now: () => 1_000, wait: async (ms: number) => void waits.push(ms) },
  }
}

describe('requestDeviceCode', () => {
  it('asks for repository and organization read access', async () => {
    const sent = stubFetch([
      {
        body: {
          device_code: 'DEVICE',
          user_code: 'WDJB-MJHT',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        },
      },
    ])

    const result = await requestDeviceCode('CLIENT', { now: () => 1_000 })

    assert.deepEqual(sent, [
      {
        url: 'https://github.com/login/device/code',
        params: { client_id: 'CLIENT', scope: 'repo read:org' },
      },
    ])
    assert.deepEqual(result, { ...code, expiresAt: 901_000 })
  })

  it('says when GitHub does not know the app', async () => {
    stubFetch([{ status: 404, body: { error: 'Not Found' } }])
    await assert.rejects(() => requestDeviceCode('NOPE'), /does not recognize this OAuth app/)
  })
})

describe('pollForToken', () => {
  it('keeps asking until the code is approved', async () => {
    const sent = stubFetch([
      { body: { error: 'authorization_pending' } },
      { body: { error: 'authorization_pending' } },
      { body: { access_token: 'gho_token', token_type: 'bearer', scope: 'repo,read:org' } },
    ])
    const { waits, options } = instantly()

    assert.equal(await pollForToken('CLIENT', code, options), 'gho_token')
    assert.deepEqual(waits, [5_000, 5_000, 5_000])
    assert.deepEqual(sent[0], {
      url: 'https://github.com/login/oauth/access_token',
      params: {
        client_id: 'CLIENT',
        device_code: 'DEVICE',
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
    })
  })

  it('waits as long as GitHub asks after being told to slow down', async () => {
    stubFetch([
      { body: { error: 'slow_down', interval: 10 } },
      { body: { error: 'slow_down' } },
      { body: { access_token: 'gho_token' } },
    ])
    const { waits, options } = instantly()

    await pollForToken('CLIENT', code, options)
    assert.deepEqual(waits, [5_000, 10_000, 15_000])
  })

  it('keeps going after a dropped connection or a server error', async () => {
    stubFetch([
      new TypeError('Failed to fetch'),
      { status: 502, body: null },
      { body: { access_token: 'gho_token' } },
    ])
    assert.equal(await pollForToken('CLIENT', code, instantly().options), 'gho_token')
  })

  it('asks again when the connection drops partway through an answer', async () => {
    const answers = [
      new Response(
        new ReadableStream({ start: (stream) => stream.error(new TypeError('network error')) }),
        { status: 200 },
      ),
      new Response(JSON.stringify({ access_token: 'gho_token' }), { status: 200 }),
    ]
    globalThis.fetch = (async () => answers.shift()) as unknown as typeof fetch

    assert.equal(await pollForToken('CLIENT', code, instantly().options), 'gho_token')
  })

  it('drops a request that hangs, and asks again', { timeout: 5_000 }, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    let calls = 0
    globalThis.fetch = ((_url: string, init: RequestInit) => {
      calls += 1
      if (calls > 1) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: 'gho_token' })))
      }
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      })
    }) as unknown as typeof fetch

    const polling = pollForToken('CLIENT', code, instantly().options)
    await new Promise((resolve) => setImmediate(resolve))
    t.mock.timers.tick(30_000)

    assert.equal(await polling, 'gho_token')
  })

  it('stops when the reader cancels on GitHub', async () => {
    stubFetch([{ body: { error: 'access_denied' } }])
    await assert.rejects(
      () => pollForToken('CLIENT', code, instantly().options),
      /canceled on GitHub/,
    )
  })

  it('stops without asking once the code has expired', async () => {
    const sent = stubFetch([])
    await assert.rejects(
      () => pollForToken('CLIENT', code, { ...instantly().options, now: () => 900_000 }),
      /expired/,
    )
    assert.deepEqual(sent, [])
  })

  it('stops when it is canceled', async () => {
    const sent = stubFetch([])
    const controller = new AbortController()
    const polling = pollForToken('CLIENT', code, { signal: controller.signal })
    controller.abort(new Error('canceled'))
    await assert.rejects(() => polling, /canceled/)
    assert.deepEqual(sent, [])
  })
})
