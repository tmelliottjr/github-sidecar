import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
  className?: string;
}

interface TooltipPosition {
  style: React.CSSProperties;
  arrowLeft: number;
  placement: 'above' | 'below';
}

export function Tooltip({ content, children, delay = 400, className = '' }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<TooltipPosition | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const measuringRef = useRef<HTMLDivElement>(null);

  const computePosition = useCallback((): TooltipPosition | null => {
    if (!triggerRef.current || !measuringRef.current) return null;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tipRect = measuringRef.current.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const arrowSize = 4;

    const triggerCenterX = triggerRect.left + triggerRect.width / 2;
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;

    const placeAbove = spaceBelow < tipRect.height + gap + arrowSize + margin && spaceAbove > spaceBelow;
    const placement = placeAbove ? 'above' as const : 'below' as const;

    let left = triggerCenterX - tipRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));

    const arrowLeft = Math.max(8, Math.min(triggerCenterX - left, tipRect.width - 8));

    const style: React.CSSProperties = { position: 'fixed', left };
    if (placeAbove) {
      style.bottom = window.innerHeight - triggerRect.top + gap + arrowSize;
    } else {
      style.top = triggerRect.bottom + gap + arrowSize;
    }

    return { style, arrowLeft, placement };
  }, []);

  const show = useCallback(() => {
    showTimer.current = setTimeout(() => {
      // First render invisibly to measure, then position and reveal
      setVisible(true);
      requestAnimationFrame(() => {
        const p = computePosition();
        if (p) setPos(p);
      });
    }, delay);
  }, [delay, computePosition]);

  const hide = useCallback(() => {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    setVisible(false);
    setPos(null);
  }, []);

  useEffect(() => {
    return () => { if (showTimer.current) clearTimeout(showTimer.current); };
  }, []);

  if (!content) {
    return <>{children}</>;
  }

  const animClass = pos
    ? (pos.placement === 'above' ? 'animate-tooltip-up' : 'animate-tooltip-down')
    : '';

  return (
    <span
      ref={triggerRef}
      className={`inline-flex self-stretch items-stretch ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible && createPortal(
        <div
          ref={measuringRef}
          className={`tooltip-container ${pos ? animClass : ''}`}
          style={pos ? pos.style : { position: 'fixed', top: -9999, left: -9999 }}
        >
          {pos && (
            <div
              className={`tooltip-arrow ${pos.placement === 'above' ? 'tooltip-arrow-down' : 'tooltip-arrow-up'}`}
              style={{ left: pos.arrowLeft }}
            />
          )}
          {content}
        </div>,
        document.body,
      )}
    </span>
  );
}
