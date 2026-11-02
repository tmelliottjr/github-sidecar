import { createContext, useContext } from 'react'
import { AlertIcon, StackIcon, SyncIcon } from '@primer/octicons-react'

import { Drawer } from '@/components/drawer'
import { ReviewIndicator, StateIcon } from '@/components/status-icons'
import { ClampedTitle } from '@/components/ui/clamped-title'
import { Hint } from '@/components/ui/tooltip'
import type { ReviewDecision, Stack, StackLayer, StackMembership } from '@/lib/github/types'
import { cn } from '@/lib/utils'

/** Review decisions for stack layers, by pull request id. Missing means not read yet. */
export const LayerReviews = createContext<ReadonlyMap<string, ReviewDecision | null>>(new Map())

/**
 * Where a row sits in its stack, as `layer / size`, and the control that opens
 * the rest of the stack beneath the row. The badge doubles as the disclosure
 * because it is the only mark on the row that is about the stack at all.
 */
export function StackBadge({
  stack,
  isOpen,
  onToggle,
  onIntent,
}: {
  stack: StackMembership
  isOpen: boolean
  onToggle: () => void
  /** Handler that is called when the badge is hovered or focused, ahead of a click. */
  onIntent: () => void
}) {
  return (
    <Hint
      label={`Stack #${stack.number} · layer ${stack.position} of ${stack.size}, onto ${stack.baseRefName}. Click to ${isOpen ? 'hide' : 'show'} it.`}
    >
      <button
        type="button"
        onClick={onToggle}
        onPointerEnter={onIntent}
        onFocus={onIntent}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Hide the stack' : 'Show the stack'}
        className={cn(
          'flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-full px-1.5 text-[11px] font-semibold',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isOpen
            ? 'bg-foreground/10 text-foreground ring-1 ring-inset ring-foreground/20'
            : 'bg-[color:var(--row-chip,var(--color-muted))] text-muted-foreground hover:text-foreground',
        )}
      >
        <StackIcon className="size-3.5" aria-hidden />
        <span className="tabular-nums">
          {stack.position}/{stack.size}
        </span>
      </button>
    </Hint>
  )
}

interface Props {
  membership: StackMembership
  /** The whole stack, once it has loaded. */
  stack: Stack | undefined
  isLoading: boolean
  isFailed: boolean
  /** Node id of the row this stack was expanded from, so it can be marked. */
  currentId: string
  onOpen: (url: string, event: React.MouseEvent) => void
  onCollapse: () => void
  onRetry: () => void
}

/**
 * The whole stack, listed top layer first so layer 1 sits at the bottom, the
 * way the branches are built. The row it was expanded from stays in the list
 * rather than being filtered out, because a stack is only legible as a whole.
 */
export function StackSection({
  membership,
  stack,
  isLoading,
  isFailed,
  currentId,
  onOpen,
  onCollapse,
  onRetry,
}: Props) {
  const size = stack?.size ?? membership.size
  const layers = stack?.layers.toReversed() ?? []

  return (
    <Drawer
      icon={<StackIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
      caption={`Stack #${membership.number}`}
      meta={
        <>
          {size} {size === 1 ? 'layer' : 'layers'} onto{' '}
          <code className="rounded-md bg-muted px-1 py-px font-mono text-[10.5px] text-foreground">
            {stack?.baseRefName ?? membership.baseRefName}
          </code>
        </>
      }
      closeLabel="Hide the stack"
      onClose={onCollapse}
    >
      <ul className="flex flex-col gap-0.5">
        {layers.map((layer, index) => (
          <li
            key={layer.id}
            className={cn(
              'relative isolate',
              // Joins this step to the next, under the row fills and focus rings:
              // 28px rows, 18px steps, 2px apart.
              index < layers.length - 1 &&
                "after:absolute after:-z-10 after:left-[14px] after:top-[25px] after:h-2 after:w-0.5 after:rounded-full after:bg-border after:content-['']",
            )}
          >
            <StackLayerRow layer={layer} isCurrent={layer.id === currentId} onOpen={onOpen} />
          </li>
        ))}

        {!stack && isLoading && (
          <li>
            <StackLoading />
          </li>
        )}
        {isFailed && !isLoading && (
          <li>
            <StackFailed onRetry={onRetry} />
          </li>
        )}
      </ul>
    </Drawer>
  )
}

/** Stands in for the layers while the stack loads. */
export function StackLoading() {
  return (
    <p className="flex h-7 items-center gap-2 px-1.5 text-[12px] text-muted-foreground">
      <SyncIcon className="size-3.5 animate-spin" aria-hidden />
      Loading the stack
    </p>
  )
}

/** Says the stack could not be loaded, and offers to try again. */
export function StackFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="flex h-7 items-center gap-2 px-1.5 text-[12px] text-muted-foreground">
      <AlertIcon className="size-3.5 shrink-0 text-attention" aria-hidden />
      Couldn’t load the stack.
      <button
        type="button"
        onClick={onRetry}
        className="font-semibold text-foreground underline underline-offset-2 hover:text-attention focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Try again
      </button>
    </p>
  )
}

/** One layer of a stack as a single line: its position, state, title, and review. */
export function StackLayerRow({
  layer,
  isCurrent,
  onOpen,
}: {
  layer: StackLayer
  isCurrent: boolean
  onOpen: (url: string, event: React.MouseEvent) => void
}) {
  const review = useContext(LayerReviews).get(layer.id) ?? null

  return (
    <button
      type="button"
      onClick={(event) => onOpen(layer.url, event)}
      aria-current={isCurrent || undefined}
      className={cn(
        'flex h-7 w-full items-center gap-2 rounded-lg px-1.5 text-left transition-colors',
        'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      )}
    >
      <span
        className={cn(
          'flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums',
          isCurrent
            ? 'bg-foreground text-background'
            : 'text-muted-foreground ring-1 ring-inset ring-border',
        )}
      >
        {layer.position}
      </span>
      <StateIcon item={{ kind: 'pull-request', state: layer.state, stateReason: null }} />
      <ClampedTitle
        title={layer.title}
        className={cn(
          'truncate text-[12px] text-foreground',
          isCurrent && 'font-semibold',
        )}
      >
        <span className="font-normal text-muted-foreground tabular-nums">#{layer.number}</span>{' '}
        {layer.title}
      </ClampedTitle>
      <span className="ml-auto flex shrink-0 items-center">
        <ReviewIndicator decision={review} />
      </span>
    </button>
  )
}
