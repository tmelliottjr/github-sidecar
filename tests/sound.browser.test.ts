import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
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

/** The middle of the ten macOS alert sounds in `/System/Library/Sounds`. */
const TARGET_LUFS = -23

interface Measurement {
  /** Maximum momentary loudness: 400 ms windows, K-weighted per ITU-R BS.1770. */
  lufs: number
  /** Sample peak, in dBFS. */
  peak: number
  /** Sample peak, from 0 to 1. */
  peakLevel: number
}

/**
 * Renders one sound through the real `playSound` into a stereo
 * `OfflineAudioContext`, the way speakers receive it, and measures it.
 */
async function measure(page: Page, name: string, volume = 1): Promise<Measurement> {
  // Returned as linear values: an infinite decibel figure does not survive the
  // trip out of the page.
  const { power, peak } = await page.evaluate(
    async ({ sound, level }) => {
      const RATE = 48_000
      const rendering = new OfflineAudioContext(2, RATE * 2, RATE)
      ;(globalThis as never as { SoundModule: any }).SoundModule.playSound(rendering, sound, level)
      const rendered = await rendering.startRendering()

      let highest = 0
      for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
        for (const sample of rendered.getChannelData(channel)) {
          highest = Math.max(highest, Math.abs(sample))
        }
      }

      // BS.1770 K-weighting at 48 kHz: a high shelf, then a high-pass.
      const weighting = new OfflineAudioContext(2, rendered.length, RATE)
      const source = weighting.createBufferSource()
      source.buffer = rendered
      source
        .connect(
          weighting.createIIRFilter(
            [1.53512485958697, -2.69169618940638, 1.19839281085285],
            [1, -1.69065929318241, 0.73248077421585],
          ),
        )
        .connect(weighting.createIIRFilter([1, -2, 1], [1, -1.99004745483398, 0.99007225036621]))
        .connect(weighting.destination)
      source.start()
      const weighted = await weighting.startRendering()

      const window = 0.4 * RATE
      let loudest = 0
      for (let start = 0; start + window <= weighted.length; start += 0.01 * RATE) {
        let windowPower = 0
        for (let channel = 0; channel < weighted.numberOfChannels; channel++) {
          const data = weighted.getChannelData(channel)
          let sum = 0
          for (let index = start; index < start + window; index++) sum += data[index] * data[index]
          windowPower += sum / window
        }
        loudest = Math.max(loudest, windowPower)
      }

      return { power: loudest, peak: highest }
    },
    { sound: name, level: volume },
  )
  return {
    lufs: -0.691 + 10 * Math.log10(power),
    peak: 20 * Math.log10(peak),
    peakLevel: peak,
  }
}

describe('how loud the sounds are', { concurrency: false, skip }, () => {
  let browser: Browser
  let page: Page

  before(async () => {
    const bundle = await esbuild.build({
      entryPoints: [fileURLToPath(new URL('../src/lib/sound.ts', import.meta.url))],
      bundle: true,
      format: 'iife',
      globalName: 'SoundModule',
      write: false,
      target: 'chrome114',
    })
    browser = await puppeteer.launch({ executablePath, headless: true })
    page = await browser.newPage()
    await page.evaluate(bundle.outputFiles[0].text)
  })

  after(async () => {
    await browser?.close()
  })

  for (const name of ['chime', 'ping', 'bell', 'knock', 'marimba']) {
    it(`plays ${name} as loud as a macOS alert sound at full volume, without clipping`, async () => {
      const { lufs, peak } = await measure(page, name)

      assert.ok(Math.abs(lufs - TARGET_LUFS) <= 1, `${name} measures ${lufs.toFixed(1)} LUFS`)
      assert.ok(peak < -1, `${name} peaks at ${peak.toFixed(1)} dBFS`)
    })
  }

  it('plays nothing for silence', async () => {
    assert.equal((await measure(page, 'none')).peakLevel, 0)
  })
})
