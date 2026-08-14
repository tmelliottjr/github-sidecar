import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import esbuild from 'esbuild'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const executablePath = CHROME_PATHS.find((candidate) => existsSync(candidate))
const skip = executablePath ? false : 'no Chrome binary available'

/**
 * Exercises the real IndexedDB store in a browser. The search service tests
 * cover policy against an in-memory fake; this covers the persistence layer,
 * where transaction lifetimes and index queries are easy to get subtly wrong.
 */
let browser: Browser
let page: Page
let server: Server

function entry(key: string, query: string, updatedAt: number) {
  return {
    key,
    query,
    updatedAt,
    page: {
      items: [],
      totalCount: 0,
      endCursor: null,
      hasNextPage: false,
      fetchedAt: updatedAt,
    },
  }
}

describe('indexedDb cache store', { concurrency: false, skip }, () => {
  before(async () => {
    const bundle = await esbuild.build({
      entryPoints: [fileURLToPath(new URL('../src/background/cache.ts', import.meta.url))],
      bundle: true,
      format: 'iife',
      globalName: 'CacheModule',
      write: false,
      target: 'chrome114',
    })

    // IndexedDB needs a real origin, and about:blank is opaque. A throwaway
    // local server gives one without depending on the network.
    server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<!doctype html><title>cache</title>')
    })
    const origin = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`)
      })
    })

    browser = await puppeteer.launch({ executablePath, headless: true })
    page = await browser.newPage()
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await page.evaluate(bundle.outputFiles[0].text)

    const ready = await page.evaluate(
      () => typeof (globalThis as never as { CacheModule: unknown }).CacheModule,
    )
    assert.equal(ready, 'object')
  })

  after(async () => {
    await browser?.close()
    server?.close()
  })

  it('round-trips an entry', async () => {
    const result = await page.evaluate(async (record) => {
      const { indexedDbStore } = (globalThis as never as { CacheModule: any }).CacheModule
      await indexedDbStore.write(record)
      const read = await indexedDbStore.read(record.key)
      return read?.page.fetchedAt ?? null
    }, entry('q\u0000', 'q', 500))

    assert.equal(result, 500)
  })

  it('returns undefined for an unknown key', async () => {
    const result = await page.evaluate(async () => {
      const { indexedDbStore } = (globalThis as never as { CacheModule: any }).CacheModule
      return (await indexedDbStore.read('missing')) ?? 'undefined'
    })
    assert.equal(result, 'undefined')
  })

  it('overwrites an existing key rather than duplicating it', async () => {
    const result = await page.evaluate(async (record) => {
      const { indexedDbStore } = (globalThis as never as { CacheModule: any }).CacheModule
      await indexedDbStore.write({ ...record, updatedAt: 900 })
      const read = await indexedDbStore.read(record.key)
      return read.updatedAt
    }, entry('q\u0000', 'q', 500))

    assert.equal(result, 900)
  })

  it('deletes every page of one query and leaves others intact', async () => {
    const survivors = await page.evaluate(
      async (records) => {
        const { indexedDbStore } = (globalThis as never as { CacheModule: any })
          .CacheModule
        await Promise.all(records.map((record: unknown) => indexedDbStore.write(record)))

        await indexedDbStore.deleteQuery('alpha')

        const remaining = await Promise.all(
          records.map(async (record: { key: string }) =>
            (await indexedDbStore.read(record.key)) ? record.key : null,
          ),
        )
        return remaining.filter(Boolean)
      },
      [
        entry('alpha\u0000', 'alpha', 1),
        entry('alpha\u0000C1', 'alpha', 2),
        entry('beta\u0000', 'beta', 3),
      ],
    )

    assert.deepEqual(survivors, ['beta\u0000'])
  })

  it('prunes only entries older than the cutoff', async () => {
    const remaining = await page.evaluate(async () => {
      const { indexedDbStore } = (globalThis as never as { CacheModule: any }).CacheModule
      const now = Date.now()

      const build = (key: string, updatedAt: number) => ({
        key,
        query: 'prune',
        updatedAt,
        page: {
          items: [],
          totalCount: 0,
          endCursor: null,
          hasNextPage: false,
          fetchedAt: updatedAt,
        },
      })

      await indexedDbStore.write(build('old', now - 60_000))
      await indexedDbStore.write(build('new', now - 1000))

      await indexedDbStore.prune(10_000)

      return {
        old: Boolean(await indexedDbStore.read('old')),
        fresh: Boolean(await indexedDbStore.read('new')),
      }
    })

    assert.deepEqual(remaining, { old: false, fresh: true })
  })
})
