import { ReactNode, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const VIEWPORT_PADDING_PX = 8;

interface WindowPosition {
  x: number;
  y: number;
}

interface WindowSize {
  width: number;
  height: number;
}

interface DragState {
  pointerStartX: number;
  pointerStartY: number;
  originX: number;
  originY: number;
}

interface FloatingWindowProps {
  id: string;
  title: string;
  initialPosition: WindowPosition;
  width: number;
  height?: number;
  zIndex?: number;
  children: ReactNode;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampPositionToViewport(position: WindowPosition, size: WindowSize): WindowPosition {
  if (typeof window === 'undefined') {
    return position;
  }
  const maxX = Math.max(VIEWPORT_PADDING_PX, window.innerWidth - size.width - VIEWPORT_PADDING_PX);
  const maxY = Math.max(VIEWPORT_PADDING_PX, window.innerHeight - size.height - VIEWPORT_PADDING_PX);
  return {
    x: clamp(position.x, VIEWPORT_PADDING_PX, maxX),
    y: clamp(position.y, VIEWPORT_PADDING_PX, maxY),
  };
}

function FloatingWindow({
  id,
  title,
  initialPosition,
  width,
  height,
  zIndex = 20,
  children,
}: FloatingWindowProps) {
  const [position, setPosition] = useState<WindowPosition>(initialPosition);
  const [windowSize, setWindowSize] = useState<WindowSize>({
    width,
    height: height ?? 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const windowSizeRef = useRef(windowSize);

  useEffect(() => {
    windowSizeRef.current = windowSize;
  }, [windowSize]);

  const updateMeasuredWindowSize = useCallback(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const bounds = element.getBoundingClientRect();
    const nextSize = {
      width: bounds.width,
      height: bounds.height,
    };
    setWindowSize((current) => (
      Math.abs(current.width - nextSize.width) < 0.5 && Math.abs(current.height - nextSize.height) < 0.5
        ? current
        : nextSize
    ));
    setPosition((current) => clampPositionToViewport(current, nextSize));
  }, []);

  useEffect(() => {
    updateMeasuredWindowSize();
    if (!containerRef.current || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      updateMeasuredWindowSize();
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
    };
  }, [updateMeasuredWindowSize]);

  useEffect(() => {
    const handleViewportResize = () => {
      setPosition((current) => clampPositionToViewport(current, windowSizeRef.current));
    };
    window.addEventListener('resize', handleViewportResize);
    return () => {
      window.removeEventListener('resize', handleViewportResize);
    };
  }, []);

  const handleDragPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = {
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }
      const nextPosition = {
        x: dragState.originX + (event.clientX - dragState.pointerStartX),
        y: dragState.originY + (event.clientY - dragState.pointerStartY),
      };
      setPosition(clampPositionToViewport(nextPosition, windowSizeRef.current));
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDragging]);

  return (
    <section
      ref={containerRef}
      data-testid={`floating-window-${id}`}
      style={{
        position: 'absolute',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${width}px`,
        height: height ? `${height}px` : undefined,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100vh - 16px)',
        border: '1px solid rgba(148, 163, 184, 0.75)',
        borderRadius: '10px',
        boxShadow: '0 16px 32px rgba(15, 23, 42, 0.28)',
        background: 'rgba(248, 250, 252, 0.96)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        pointerEvents: 'auto',
        zIndex,
      }}
    >
      <div
        data-testid={`floating-window-drag-${id}`}
        onPointerDown={handleDragPointerDown}
        style={{
          height: '34px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          borderBottom: '1px solid rgba(148, 163, 184, 0.5)',
          background: 'linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)',
          color: '#0f172a',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.02em',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <span>{title}</span>
        <span style={{ color: '#64748b', fontWeight: 600 }}>drag</span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </div>
    </section>
  );
}

export default FloatingWindow;
