import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BROWSER_TARGETS, isBrowserTarget, type BrowserTarget } from './manifest.ts'

/**
 * Production build, once per browser.
 *
 * Each browser gets its own `dist/<browser>/` because each needs its own
 * manifest and, on Chrome, an extra document nobody else has. Named here
 * rather than in an npm script so the whole thing works the same way on every
 * platform, without an environment variable prefix a shell has to understand.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const requested = process.argv.slice(2)
for (const name of requested) {
  if (!isBrowserTarget(name)) {
    console.error(`Unknown browser ${JSON.stringify(name)}.`)
    console.error(`Expected one of: ${BROWSER_TARGETS.join(', ')}`)
    process.exit(1)
  }
}

const targets: BrowserTarget[] =
  requested.length > 0 ? (requested as BrowserTarget[]) : BROWSER_TARGETS

function run(target: BrowserTarget, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn('npx', args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, BROWSER: target },
    })
    child.on('exit', (code) => {
      if (code === 0) done()
      else fail(new Error(`${args.join(' ')} for ${target} exited with code ${code}`))
    })
  })
}

for (const target of targets) {
  console.log(`\n— building for ${target} —`)
  await rm(resolve(root, 'dist', target), { recursive: true, force: true })
  await run(target, ['vite', 'build'])
  await run(target, ['vite', 'build', '--config', 'vite.content.config.ts'])
}

console.log(`\nBuilt ${targets.join(', ')} into dist/.`)
