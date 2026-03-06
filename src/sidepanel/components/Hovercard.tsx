import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface HovercardProps {
  trigger: ReactNode;
  children: (opts: { hovered: boolean }) => ReactNode;
  popoverWidth?: number;
  showDelay?: number;
  hideDelay?: number;
  className?: string;
}

export function Hovercard({
  trigger,
  children,
  popoverWidth = 320,
  showDelay = 400,
  hideDelay = 300,
  className = '',
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

    let left = rect.left + rect.width / 2 - popoverWidth / 2;
    left = Math.max(margin, Math.min(left, viewportWidth - popoverWidth - margin));

    if (rect.top < 200) {
      setPlacement('below');
      setPopoverStyle({ position: 'fixed', top: rect.bottom + 6, left });
    } else {
      setPlacement('above');
      setPopoverStyle({ position: 'fixed', bottom: window.innerHeight - rect.top + 6, left });
    }
  }, [popoverWidth]);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
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
            className={`flex flex-col bg-bg-secondary border border-border rounded-[10px] shadow-[0_8px_24px_rgba(0,0,0,0.45)] z-[9999] overflow-hidden ${animationClass} ${className}`}
            style={popoverStyle}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
          >
            {children({ hovered })}
          </div>,
          document.body,
        )}
    </span>
  );
}
