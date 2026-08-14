/**
 * Mirrors GitHub's colour mode onto the shadow root so the sidebar matches the
 * page. GitHub sets data-color-mode / data-light-theme / data-dark-theme on
 * <html> and updates them live when the user switches themes.
 */
export function watchColorScheme(onChange: (isDark: boolean) => void): () => void {
  const root = document.documentElement
  const media = window.matchMedia('(prefers-color-scheme: dark)')

  const resolve = () => {
    const mode = root.getAttribute('data-color-mode')
    if (mode === 'dark') return true
    if (mode === 'light') return false
    return media.matches
  }

  const notify = () => onChange(resolve())

  const observer = new MutationObserver(notify)
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-color-mode', 'data-dark-theme', 'data-light-theme'],
  })
  media.addEventListener('change', notify)
  notify()

  return () => {
    observer.disconnect()
    media.removeEventListener('change', notify)
  }
}
