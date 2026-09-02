/**
 * Draws the extension's icon, at every size the manifest asks for.
 *
 * The mark is the panel's own: a rounded square standing for the sidebar, with
 * the arrow it points at the row you are on cut out of its right edge. Drawn
 * here rather than shipped as a binary nobody can diff — run it and the PNGs
 * are rebuilt exactly as they were.
 *
 *   node scripts/make-icons.ts
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SIZES = [16, 32, 48, 128]

/** Slate, matching the panel's own foreground in light mode. */
const INK: RGB = [24, 26, 32]
const PAPER: RGB = [255, 255, 255]
/** The blue the panel marks the current row with. */
const MARK: RGB = [47, 129, 247]

type RGB = [number, number, number]

function mix(a: RGB, b: RGB, amount: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * amount),
    Math.round(a[1] + (b[1] - a[1]) * amount),
    Math.round(a[2] + (b[2] - a[2]) * amount),
  ]
}

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRect(
  x: number,
  y: number,
  half: number,
  radius: number,
): number {
  const dx = Math.abs(x) - (half - radius)
  const dy = Math.abs(y) - (half - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

/**
 * Anti-aliasing by sampling: every pixel is worked out at four points and
 * averaged, which is enough to keep the arrow's tip from turning into a step
 * at 16 pixels across.
 */
const SAMPLES = [0.25, 0.75]

function shade(size: number, px: number, py: number): [RGB, number] {
  let colour: RGB = [0, 0, 0]
  let alpha = 0

  for (const ox of SAMPLES) {
    for (const oy of SAMPLES) {
      const [sampleColour, sampleAlpha] = sample(size, px + ox, py + oy)
      colour = [
        colour[0] + sampleColour[0] * sampleAlpha,
        colour[1] + sampleColour[1] * sampleAlpha,
        colour[2] + sampleColour[2] * sampleAlpha,
      ]
      alpha += sampleAlpha
    }
  }

  const count = SAMPLES.length * SAMPLES.length
  if (alpha === 0) return [[0, 0, 0], 0]
  return [[colour[0] / alpha, colour[1] / alpha, colour[2] / alpha], alpha / count]
}

function sample(size: number, px: number, py: number): [RGB, number] {
  // Everything below is in a square from -1 to 1, so one drawing serves every
  // size the manifest asks for.
  const unit = size / 2
  const x = (px - unit) / unit
  const y = (py - unit) / unit

  const body = roundedRect(x, y, 0.94, 0.34)
  if (body > 0.02) return [[0, 0, 0], 0]

  // The panel: a lighter block filling the left three quarters.
  const panel = roundedRect(x + 0.14, y, 0.62, 0.2)
  // The arrow: a triangle whose point reaches past the panel's right edge.
  const inArrow = x > 0.34 && x < 0.78 && Math.abs(y) < 0.42 - (x - 0.34) * 0.95

  let colour = INK
  if (inArrow) colour = MARK
  else if (panel < 0) colour = mix(INK, PAPER, 0.86)

  return [colour, 1]
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function crc32(buffer: Buffer): number {
  let crc = 0xff_ff_ff_ff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xff_ff_ff_ff) >>> 0
}

function png(size: number): Buffer {
  // One filter byte per scanline, then RGBA left to right.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let offset = 0

  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0
    offset += 1
    for (let x = 0; x < size; x += 1) {
      const [colour, alpha] = shade(size, x, y)
      raw[offset] = Math.round(colour[0])
      raw[offset + 1] = Math.round(colour[1])
      raw[offset + 2] = Math.round(colour[2])
      raw[offset + 3] = Math.round(alpha * 255)
      offset += 4
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of SIZES) {
  const path = fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url))
  writeFileSync(path, png(size))
  console.info(`wrote icon-${size}.png`)
}
