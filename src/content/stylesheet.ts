/**
 * `@property` rules have no effect inside a shadow root, so Tailwind's
 * registered custom properties never take their initial values there. Every
 * declaration built on one — `box-shadow`, `border-style`, the transform
 * stack — then resolves against an unset variable and computes to nothing,
 * which is why the panel would otherwise render with no border and no shadow.
 *
 * Tailwind already emits those initial values as ordinary declarations in its
 * lowest-precedence layer, but behind an `@supports` test for engines with no
 * `@property` support at all. Chrome fails that test, so dropping the guard is
 * all it takes to get the fallbacks applied in the shadow tree.
 */
export function withShadowRootProperties(css: string): string {
  const layer = css.indexOf('@layer properties')
  if (layer === -1) return css

  const supports = css.indexOf('@supports', layer)
  const nextLayer = css.indexOf('@layer', layer + '@layer properties'.length)
  if (supports === -1 || (nextLayer !== -1 && supports > nextLayer)) return css

  const open = css.indexOf('{', supports)
  if (open === -1) return css

  let depth = 0
  let close = -1
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') {
      depth -= 1
      if (depth === 0) {
        close = index
        break
      }
    }
  }
  if (close === -1) return css

  return css.slice(0, supports) + css.slice(open + 1, close) + css.slice(close + 1)
}
