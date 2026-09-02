import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import puppeteer, { type Browser, type Page } from 'puppeteer-core'

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const executablePath = CHROME_PATHS.find((candidate) => existsSync(candidate))
const skip = executablePath ? false : 'no Chrome binary available'

const distDir = fileURLToPath(new URL('../dist/', import.meta.url))

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
}

function serveDist(): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://x')
    const path = normalize(join(distDir, pathname))
    if (!path.startsWith(distDir)) {
      response.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(path)
      response.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'text/plain' })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, origin: `http://127.0.0.1:${port}` })
    })
  })
}

/**
 * Records what the sound asks Web Audio for, so the tune can be checked
 * without a speaker. A real `AudioContext` would play into a headless
 * browser's void and report nothing about what it played.
 */
const AUDIO_STUB = `
window.__played = [];
window.__contexts = 0;
class FakeParam {
  constructor(kind, note) { this.kind = kind; this.note = note }
  setValueAtTime(value, at) { this.note.envelope.push(['set', value, at]) }
  linearRampToValueAtTime(value, at) { this.note.envelope.push(['linear', value, at]) }
  exponentialRampToValueAtTime(value, at) { this.note.envelope.push(['exponential', value, at]) }
}
class FakeAudioContext {
  constructor() { window.__contexts += 1; this.currentTime = 0; this.destination = { kind: 'destination' } }
  async resume() {}
  createOscillator() {
    const note = { frequency: null, type: null, start: null, stop: null, envelope: [] };
    window.__played.push(note);
    return {
      set type(value) { note.type = value },
      frequency: { set value(hz) { note.frequency = hz } },
      connect: (target) => target,
      start: (at) => { note.start = at },
      stop: (at) => { note.stop = at },
    };
  }
  createGain() {
    const note = window.__played.at(-1);
    return { gain: new FakeParam('gain', note), connect: (target) => target };
  }
}
window.AudioContext = FakeAudioContext;

window.__listeners = [];
window.chrome = {
  runtime: {
    id: 'stub',
    onMessage: { addListener: (listener) => window.__listeners.push(listener) },
  },
};
window.__send = (message) =>
  new Promise((resolve) => window.__listeners[0](message, {}, resolve));
`

describe('the notification sound', { concurrency: false, skip }, () => {
  let server: Server
  let browser: Browser
  let page: Page

  before(async () => {
    const served = await serveDist()
    server = served.server

    browser = await puppeteer.launch({ executablePath, headless: true })
    page = await browser.newPage()
    await page.evaluateOnNewDocument(AUDIO_STUB)
    await page.goto(`${served.origin}/offscreen.html`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(
      () => (window as unknown as { __listeners: unknown[] }).__listeners.length > 0,
    )
  })

  after(async () => {
    await browser?.close()
    server?.close()
  })

  const played = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __played: Array<{
              frequency: number
              type: string
              start: number
              stop: number
              envelope: Array<[string, number, number]>
            }>
          }
        ).__played,
    )

  const send = (name: string, volume = 1) =>
    page.evaluate(
      ({ name: sound, volume: level }) =>
        (window as unknown as { __send: (m: unknown) => Promise<unknown> }).__send({
          type: 'play-sound',
          name: sound,
          volume: level,
        }),
      { name, volume },
    )

  const clear = () =>
    page.evaluate(() => {
      ;(window as unknown as { __played: unknown[] }).__played.length = 0
    })

  const peak = (note: { envelope: Array<[string, number, number]> }) =>
    Math.max(...note.envelope.map(([, value]) => value))

  it('plays the sound it was asked for, by name', async () => {
    // Answered, so the worker knows the sound was taken rather than lost.
    assert.deepEqual(await send('chime'), { ok: true })

    const notes = await played()
    assert.deepEqual(
      notes.map((note) => note.frequency),
      [880, 1318.5],
    )
    // The second note follows the first rather than landing on top of it.
    assert.ok(notes[1].start > notes[0].start)
    assert.equal(notes[0].type, 'sine')
  })

  it('plays a different one when a different one is chosen', async () => {
    await clear()
    await send('marimba')

    const notes = await played()
    assert.deepEqual(
      notes.map((note) => note.frequency),
      [587.3, 880, 1174.7],
    )
    assert.equal(notes[0].type, 'triangle')
  })

  it('takes the volume it is given, and silence for an answer', async () => {
    await clear()
    await send('chime', 0.25)
    const quiet = await played()

    await clear()
    await send('chime', 1)
    const loud = await played()
    assert.ok(peak(quiet[0]) < peak(loud[0]))

    await clear()
    await send('chime', 0)
    assert.deepEqual(await played(), [])

    await clear()
    await send('none', 1)
    assert.deepEqual(await played(), [])
  })

  it('ignores a sound it has never heard of', async () => {
    await clear()
    await send('foghorn')
    assert.deepEqual(await played(), [])
  })

  it('fades every note in and out, so it chimes rather than clicks', async () => {
    await clear()
    await send('bell')
    const notes = await played()
    const shapes = notes[0].envelope.map(([kind]) => kind)

    assert.deepEqual(shapes, ['set', 'linear', 'exponential'])
    assert.equal(notes[0].envelope[0][1], 0)
  })

  it('keeps one audio context however often it is asked', async () => {
    await send('chime')
    await send('ping')

    assert.equal(
      await page.evaluate(() => (window as unknown as { __contexts: number }).__contexts),
      1,
    )
  })

  it('ignores messages that are not for it', async () => {
    const answer = await page.evaluate(() =>
      (window as unknown as { __listeners: Array<(m: unknown, s: unknown, r: unknown) => unknown> }).__listeners[0](
        { type: 'something-else' },
        {},
        () => undefined,
      ),
    )
    assert.equal(answer, false)
  })
})
