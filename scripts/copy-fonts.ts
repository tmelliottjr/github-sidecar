import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Copies the Open Sans variable font into public/ so it can be served as a
 * web-accessible resource. The content script builds @font-face rules at
 * runtime with chrome.runtime.getURL(), so relative CSS urls never apply.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'node_modules/@fontsource-variable/open-sans/files')
const target = resolve(root, 'public/fonts')

const FILES = [
  'open-sans-latin-wght-normal.woff2',
  'open-sans-latin-ext-wght-normal.woff2',
]

await mkdir(target, { recursive: true })
await Promise.all(
  FILES.map((file) => copyFile(resolve(source, file), resolve(target, file))),
)

console.log(`Copied ${FILES.length} font files to public/fonts`)
