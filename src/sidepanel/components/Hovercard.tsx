import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip } from './Tooltip';

interface HovercardProps {
  trigger: ReactNode;
  children: (opts: { hovered: boolean }) => ReactNode;
  popoverWidth?: number;
  showDelay?: number;
  hideDelay?: number;
  className?: string;
  showClose?: boolean;
}

export function Hovercard({
  trigger,
  children,
  popoverWidth = 320,
  showDelay = 400,
  hideDelay = 300,
  className = '',
  showClose = false,
}: HovercardProps) {
  const [hovered, setHovered] = useState(false);
  const [showPopover, setShowPopover] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const [placement, setPlacement] = useState<'above' | 'below'>('above');
  const showTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const computePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 6;
    const viewportWidth = window.innerWidth;

    const maxWidth = Math.floor(viewportWidth * 0.9);
    const actualWidth = Math.min(popoverWidth, maxWidth);
    const isCapped = actualWidth < popoverWidth;

    let left: number;
    if (isCapped) {
      left = Math.floor((viewportWidth - actualWidth) / 2);
    } else {
      left = rect.left + rect.width / 2 - actualWidth / 2;
      left = Math.max(margin, Math.min(left, viewportWidth - actualWidth - margin));
    }

    const widthStyle = actualWidth < popoverWidth ? { width: actualWidth } : { width: popoverWidth };

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
      setPlacement('below');
      setPopoverStyle({ position: 'fixed', top: rect.bottom + 6, left, ...widthStyle });
    } else {
      setPlacement('above');
      setPopoverStyle({ position: 'fixed', bottom: window.innerHeight - rect.top + 6, left, ...widthStyle });
    }
  }, [popoverWidth]);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const closeNow = useCallback(() => {
    if (showTimerRef.current) { clearTimeout(showTimerRef.current); showTimerRef.current = null; }
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setShowPopover(false);
    setHovered(false);
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => {
      setShowPopover(false);
      setHovered(false);
    }, hideDelay);
  }, [cancelHide, hideDelay]);

  const handleTriggerEnter = useCallback(() => {
    cancelHide();
    setHovered(true);
    showTimerRef.current = setTimeout(() => {
      computePosition();
      setShowPopover(true);
    }, showDelay);
  }, [computePosition, cancelHide, showDelay]);

  const handleTriggerLeave = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const animationClass = placement === 'above' ? 'animate-hovercard-up' : 'animate-hovercard-down';

  return (
    <span
      ref={triggerRef}
      className="inline-flex items-center gap-0.5 cursor-default relative"
      onMouseEnter={handleTriggerEnter}
      onMouseLeave={handleTriggerLeave}
    >
      {trigger}
      {showPopover &&
        createPortal(
          <div
            className={`flex flex-col bg-bg-secondary border border-border rounded-[10px] shadow-[0_8px_24px_rgba(0,0,0,0.45)] z-[9999] overflow-hidden relative ${animationClass} ${className}`}
            style={popoverStyle}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
          >
            {showClose && (
              <Tooltip content="Close">
                <button
                  onClick={(e) => { e.stopPropagation(); closeNow(); }}
                  className="absolute top-1.5 right-1.5 z-10 bg-bg-tertiary/80 border-none text-text-secondary cursor-pointer p-0.5 rounded-md flex items-center justify-center hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
                </button>
              </Tooltip>
            )}
            {children({ hovered })}
          </div>,
          document.body,
        )}
    </span>
  );
}
