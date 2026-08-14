import { memo, useCallback, useState } from 'react'
import {
  AlertTriangle,
  ChevronRight,
  Layers,
  MessageSquare,
  Pin,
  PinOff,
  RotateCw,
} from 'lucide-react'

import { StackBadge, StackSection } from '@/components/stack-section'
import {
  CheckIndicator,
  LabelDots,
  ReviewIndicator,
  StateIcon,
} from '@/components/status-icons'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Hint } from '@/components/ui/tooltip'
import type { SearchItem } from '@/lib/github/types'
import { cn, relativeTime } from '@/lib/utils'

interface Props {
  item: SearchItem
  isPinned: boolean
  isStackOpen: boolean
  onOpen: (item: SearchItem, event: React.MouseEvent) => void
  onOpenUrl: (url: string, event: React.MouseEvent) => void
  onRefresh: (item: SearchItem) => Promise<void>
  onTogglePin: (item: SearchItem) => void
  onToggleStack: (item: SearchItem) => void
}

type RefreshState = { status: 'idle' | 'loading' } | { status: 'error'; message: string }

function ItemRowImpl({
  item,
  isPinned,
  isStackOpen,
  onOpen,
  onOpenUrl,
  onRefresh,
  onTogglePin,
  onToggleStack,
}: Props) {
  const [refresh, setRefresh] = useState<RefreshState>({ status: 'idle' })
  const stack = item.stack

  const refreshItem = useCallback(() => {
    setRefresh({ status: 'loading' })
    void onRefresh(item)
      .then(() => setRefresh({ status: 'idle' }))
      .catch((error: unknown) =>
        setRefresh({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
      )
  }, [item, onRefresh])

  const togglePin = useCallback(() => onTogglePin(item), [item, onTogglePin])
  const toggleStack = useCallback(() => onToggleStack(item), [item, onToggleStack])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-pinned={isPinned || undefined}
          className={cn('group flex flex-col', isPinned && 'bg-accent/40')}
        >
          <div className="flex w-full items-start">
            <button
              type="button"
              onClick={(event) => onOpen(item, event)}
              aria-busy={refresh.status === 'loading'}
              className={cn(
                'flex min-w-0 flex-1 gap-2.5 py-2.5 pl-3 text-left transition-colors',
                stack ? 'pr-1' : 'pr-3',
                'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                'group-data-[state=open]:bg-accent',
              )}
            >
              <StateIcon item={item} />

              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-start gap-2">
                  <span className="line-clamp-2 flex-1 text-[13px] font-semibold leading-snug text-foreground">
                    {item.title}
                  </span>
                  {/*
                   * A refresh reports itself in the same slot as the timestamp it
                   * is about to change, so the row says what it is doing without
                   * reflowing around a new element.
                   */}
                  <span className="flex shrink-0 items-center pt-px text-[11px] tabular-nums text-muted-foreground">
                    {refresh.status === 'loading' ? (
                      <RotateCw
                        className="size-3 animate-spin-slow"
                        aria-label="Refreshing"
                      />
                    ) : refresh.status === 'error' ? (
                      <Hint label={refresh.message}>
                        <AlertTriangle
                          className="size-3 text-attention"
                          aria-label="Refresh failed"
                        />
                      </Hint>
                    ) : (
                      relativeTime(item.updatedAt)
                    )}
                  </span>
                </span>

                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {isPinned && (
                    <Pin
                      className="size-3 shrink-0 text-accent-foreground"
                      aria-label="Pinned"
                    />
                  )}
                  <span className="truncate font-medium">{item.repository}</span>
                  <span aria-hidden>#{item.number}</span>
                  {item.authorLogin && (
                    <Author login={item.authorLogin} avatarUrl={item.authorAvatarUrl} />
                  )}
                </span>

                {(stack ||
                  item.labels.length > 0 ||
                  item.commentCount > 0 ||
                  item.checkState ||
                  item.reviewDecision) && (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {stack && <StackBadge stack={stack} />}
                    <CheckIndicator state={item.checkState} />
                    <ReviewIndicator decision={item.reviewDecision} />
                    <LabelDots labels={item.labels} total={item.labelCount} />

                    {item.commentCount > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                        <MessageSquare className="size-3" />
                        {item.commentCount}
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>

            {/*
             * The stack gets its own control rather than expanding from the
             * row: clicking a row still has to mean "open this pull request".
             */}
            {stack && (
              <button
                type="button"
                onClick={toggleStack}
                aria-expanded={isStackOpen}
                aria-label={isStackOpen ? 'Hide the stack' : 'Show the stack'}
                className={cn(
                  'flex shrink-0 items-center self-stretch px-2 text-muted-foreground transition-colors',
                  'hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:outline-none',
                )}
              >
                <ChevronRight
                  className={cn(
                    'size-3.5 transition-transform',
                    isStackOpen && 'rotate-90',
                  )}
                />
              </button>
            )}
          </div>

          {stack && isStackOpen && (
            <StackSection stack={stack} currentId={item.id} onOpen={onOpenUrl} />
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onSelect={togglePin}>
          {isPinned ? <PinOff /> : <Pin />}
          {isPinned ? 'Unpin item' : 'Pin item'}
        </ContextMenuItem>
        {stack && (
          <ContextMenuItem onSelect={toggleStack}>
            <Layers />
            {isStackOpen ? 'Hide the stack' : 'Show the stack'}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={refreshItem} disabled={refresh.status === 'loading'}>
          <RotateCw />
          Refresh this item
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const ItemRow = memo(ItemRowImpl)

/**
 * The author, as a face and a handle. The avatar stands in for the separator
 * that would otherwise sit before the login, so it reads as one more mark in
 * the meta line rather than an extra element.
 */
function Author({ login, avatarUrl }: { login: string; avatarUrl: string | null }) {
  // A blocked or missing avatar must not leave a torn image in the row, so it
  // falls back to the separator the handle used to carry on its own.
  const [broken, setBroken] = useState(false)
  const showAvatar = Boolean(avatarUrl) && !broken

  return (
    <span className="flex min-w-0 items-center gap-1">
      {showAvatar ? (
        <img
          src={avatarUrl as string}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="size-3.5 shrink-0 rounded-full bg-muted ring-1 ring-border/60"
        />
      ) : (
        <span aria-hidden>·</span>
      )}
      <span className="truncate">{login}</span>
    </span>
  )
}
