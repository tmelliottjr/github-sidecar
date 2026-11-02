import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  AnimatePresence,
  MotionConfig,
  PresenceContext,
  useIsPresent,
  useReducedMotion,
  type Transition,
} from 'motion/react'

import { MORPH_SPRING } from '@/lib/morph-spring'

/**
 * Motion animates a morph as progress from 0 to 1000, and its default rest
 * thresholds leave the old element on screen for half a second after the new
 * one has landed. These stop the spring within 0.3% of the end.
 */
const MORPH_TRANSITION: Transition = {
  type: 'spring',
  ...MORPH_SPRING,
  restDelta: 3,
  restSpeed: 100,
}

/**
 * Makes an element one end of the morph between the launcher and the panel.
 * Motion grows the element out of whichever one was showing, and keeps the
 * old one on screen, inert, until it has faded into the new one. With reduced
 * motion the element replaces the other one in place.
 *
 * Spread `props` onto the element. `settled` turns true once it has finished
 * growing, and is true from the start when it mounts without a morph, as on
 * page load and with reduced motion.
 *
 * `data-morphing` is set while the element is moving or leaving, for
 * decoration that scaling would distort. It is written to the DOM from
 * Motion's callbacks, so it is in place before the first frame is painted.
 */
export function useMorph<T extends Element>(ref: RefObject<T | null>, end: 'launcher' | 'panel') {
  const isPresent = useIsPresent()
  const presence = useContext(PresenceContext)
  // Motion makes a reduced-motion morph instant, but still paints one frame
  // of the new element at the old size.
  const reduceMotion = useReducedMotion()
  const [settled, setSettled] = useState(
    () => presence?.initial === false || reduceMotion === true,
  )
  const started = useRef(false)

  // Motion starts a morph before the first frame after mounting, or not at
  // all, as when a window resize has paused layout animations.
  useEffect(() => {
    if (settled) return
    const frame = requestAnimationFrame(() => {
      if (!started.current) setSettled(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [settled])

  // Motion finishes a morph without calling onLayoutAnimationComplete when the
  // window width changes. Its transform is gone by the second frame after.
  useLayoutEffect(() => {
    if (!isPresent) return
    let frame = 0
    const check = () => {
      const element = ref.current
      const transform = element instanceof HTMLElement ? element.style.transform : ''
      if (transform && transform !== 'none') return
      element?.removeAttribute('data-morphing')
      setSettled(true)
    }
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(check)
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [isPresent, ref])

  const props = {
    ref,
    layoutId: reduceMotion ? undefined : 'sidecar',
    // Fixed while present, so the panel does not spring after its top edge as
    // the page scrolls. Unset while leaving, since a leaving element with a
    // fixed dependency is removed the next time it renders.
    layoutDependency: isPresent ? end : undefined,
    transition: MORPH_TRANSITION,
    inert: !isPresent,
    'data-morphing': isPresent ? undefined : '',
    onLayoutAnimationStart: () => {
      started.current = true
      ref.current?.setAttribute('data-morphing', '')
    },
    onLayoutAnimationComplete: () => {
      ref.current?.removeAttribute('data-morphing')
      setSettled(true)
    },
  }
  return { props, settled }
}

/**
 * Props for the contents of a morphing element. Motion keeps them at their
 * own size while the element scales around them. Leaving contents stay where
 * they were rather than moving with the element, so they fade out quickly,
 * and fade back if the element returns before it has gone.
 */
export function useMorphContent() {
  const reduceMotion = useReducedMotion()
  return {
    layout: true,
    layoutDependency: 0,
    animate: { opacity: 1 },
    exit: { opacity: 0, transition: { duration: reduceMotion ? 0 : 0.12, ease: 'easeOut' } },
  } as const
}

const SettledContext = createContext(true)

/**
 * Whether the panel has finished growing. Contents that are slow to render
 * wait for it, so they neither take frames from the morph nor appear while
 * the panel is still moving.
 */
export function useMorphSettled(): boolean {
  return useContext(SettledContext)
}

/** Tells the contents of the panel whether it has finished growing. */
export function MorphSettled({ settled, children }: { settled: boolean; children: ReactNode }) {
  return <SettledContext.Provider value={settled}>{children}</SettledContext.Provider>
}

/** Swaps the launcher and the panel. Render exactly one of them, keyed, as the child. */
export function MorphPresence({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </MotionConfig>
  )
}
