import { memo, useCallback, useState } from 'react'
import {
  AlertIcon,
  CommentIcon,
  PinIcon,
  PinSlashIcon,
  StackIcon,
  SyncIcon,
} from '@primer/octicons-react'

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
import { ClampedTitle } from '@/components/ui/clamped-title'
import { Hint } from '@/components/ui/tooltip'
import type { SearchItem } from '@/lib/github/types'
import { cn, relativeTime } from '@/lib/utils'

/** Row padding (12px) plus the state icon (16px) and the gap after it (10px). */
const MARKS_INDENT = 'pl-[38px]'

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

  const hasMarks =
    Boolean(stack) ||
    item.labels.length > 0 ||
    item.commentCount > 0 ||
    Boolean(item.checkState) ||
    Boolean(item.reviewDecision)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-pinned={isPinned || undefined}
          className={cn('group flex flex-col', isPinned && 'bg-accent/40')}
        >
          {/*
           * Hover and focus are carried by the row's own wrapper rather than
           * the button, so the marks below the meta line — which sit outside
           * the click target now that one of them is a control — still read as
           * part of the same row.
           */}
          <div
            className={cn(
              'flex flex-col transition-colors',
              'hover:bg-accent has-[:focus-visible]:bg-accent',
              'group-data-[state=open]:bg-accent',
            )}
          >
            <button
              type="button"
              onClick={(event) => onOpen(item, event)}
              aria-busy={refresh.status === 'loading'}
              className={cn(
                'flex w-full min-w-0 gap-2.5 px-3 pt-2.5 text-left focus-visible:outline-none',
                hasMarks ? 'pb-1' : 'pb-2.5',
              )}
            >
              <StateIcon item={item} />

              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-start gap-2">
                  <ClampedTitle
                    title={item.title}
                    className="line-clamp-2 flex-1 text-[13px] font-semibold leading-snug text-foreground"
                  />
                  {/*
                   * A refresh reports itself in the same slot as the timestamp it
                   * is about to change, so the row says what it is doing without
                   * reflowing around a new element.
                   */}
                  <span className="flex shrink-0 items-center pt-px text-[11px] tabular-nums text-muted-foreground">
                    {refresh.status === 'loading' ? (
                      <SyncIcon
                        className="size-3 animate-spin-slow"
                        aria-label="Refreshing"
                      />
                    ) : refresh.status === 'error' ? (
                      <Hint label={refresh.message}>
                        <AlertIcon
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
                    <PinIcon
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
              </span>
            </button>

            {/*
             * Indented past the state icon so the marks line up under the
             * title. `MARKS_INDENT` is that icon plus the row's own padding.
             */}
            {hasMarks && (
              <div className={cn('flex flex-wrap items-center gap-1.5 pb-2.5 pr-3', MARKS_INDENT)}>
                {stack && (
                  <StackBadge
                    stack={stack}
                    isOpen={isStackOpen}
                    onToggle={toggleStack}
                  />
                )}
                <CheckIndicator state={item.checkState} />
                <ReviewIndicator decision={item.reviewDecision} />

                {item.commentCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                    <CommentIcon className="size-3" />
                    {item.commentCount}
                  </span>
                )}

                {/*
                 * Labels are the least of what this line says, so they are put
                 * where the eye lands last rather than in the run of marks.
                 */}
                <span className="ml-auto flex items-center pl-1.5">
                  <LabelDots labels={item.labels} total={item.labelCount} />
                </span>
              </div>
            )}
          </div>

          {/*
           * The stack stays mounted so it can slide rather than appear. A
           * collapsed grid row measures the section without reserving space
           * for it, which is what lets the height animate at all; `inert`
           * keeps the hidden rows out of the tab order while it is closed.
           */}
          {stack && (
            <div
              data-stack={isStackOpen ? 'open' : 'closed'}
              inert={!isStackOpen}
              aria-hidden={!isStackOpen}
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-300 ease-stack',
                'motion-reduce:transition-none',
                isStackOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
            >
              <div className="overflow-hidden">
                <StackSection
                  stack={stack}
                  currentId={item.id}
                  onOpen={onOpenUrl}
                  onCollapse={toggleStack}
                />
              </div>
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onSelect={togglePin}>
          {isPinned ? <PinSlashIcon /> : <PinIcon />}
          {isPinned ? 'Unpin item' : 'Pin item'}
        </ContextMenuItem>
        {stack && (
          <ContextMenuItem onSelect={toggleStack}>
            <StackIcon />
            {isStackOpen ? 'Hide the stack' : 'Show the stack'}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={refreshItem} disabled={refresh.status === 'loading'}>
          <SyncIcon />
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
