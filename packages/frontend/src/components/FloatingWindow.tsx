import { ReactNode, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useGraphStore } from '../store/graphStore';
import {
  clampFloatingWindowPositionToViewport,
  resolveFloatingWindowCameraLayout,
  resolveFloatingWindowPositionFromCamera,
  resolveGraphCamera,
  updateGraphCamera,
  type FloatingWindowPosition,
  type FloatingWindowSize,
} from '../utils/cameras';

interface DragState {
  pointerStartX: number;
  pointerStartY: number;
  originX: number;
  originY: number;
}

interface FloatingWindowProps {
  id: string;
  title: string;
  initialPosition: FloatingWindowPosition;
  width: number;
  height?: number;
  zIndex?: number;
  children: ReactNode;
}

function getViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function arePositionsClose(left: FloatingWindowPosition, right: FloatingWindowPosition): boolean {
  return Math.abs(left.x - right.x) < 0.5 && Math.abs(left.y - right.y) < 0.5;
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
  const graph = useGraphStore((state) => state.graph);
  const selectedCameraId = useGraphStore((state) => state.selectedCameraId);
  const submitGraphCommands = useGraphStore((state) => state.submitGraphCommands);
  const [position, setPosition] = useState<FloatingWindowPosition>(() => (
    clampFloatingWindowPositionToViewport(
      initialPosition,
      { width, height: height ?? 0 },
      getViewportSize()
    )
  ));
  const [windowSize, setWindowSize] = useState<FloatingWindowSize>({
    width,
    height: height ?? 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const positionRef = useRef(position);
  const windowSizeRef = useRef(windowSize);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    windowSizeRef.current = windowSize;
  }, [windowSize]);

  const persistWindowPositionToCamera = useCallback((nextPosition: FloatingWindowPosition) => {
    if (!graph) {
      return;
    }

    const viewportSize = getViewportSize();
    const currentCamera = resolveGraphCamera(graph.cameras, selectedCameraId);
    const nextLayout = resolveFloatingWindowCameraLayout(
      nextPosition,
      windowSizeRef.current,
      viewportSize
    );
    const currentWindowPosition = currentCamera.floatingWindows?.[id];
    if (
      currentWindowPosition?.horizontal.edge === nextLayout.horizontal.edge &&
      currentWindowPosition?.vertical.edge === nextLayout.vertical.edge &&
      currentWindowPosition?.horizontal.ratio === nextLayout.horizontal.ratio &&
      currentWindowPosition?.vertical.ratio === nextLayout.vertical.ratio
    ) {
      return;
    }

    void submitGraphCommands([{
      kind: 'replace_cameras',
      cameras: updateGraphCamera(graph.cameras, currentCamera.id, (camera) => ({
        ...camera,
        floatingWindows: {
          ...(camera.floatingWindows ?? {}),
          [id]: nextLayout,
        },
      })),
    }]);
  }, [graph, id, selectedCameraId, submitGraphCommands]);

  const applyCameraWindowPosition = useCallback(() => {
    if (isDragging) {
      return;
    }

    const viewportSize = getViewportSize();
    const currentCamera = resolveGraphCamera(graph?.cameras, selectedCameraId);
    const nextPosition = resolveFloatingWindowPositionFromCamera(
      currentCamera.floatingWindows?.[id],
      windowSizeRef.current,
      viewportSize,
      initialPosition
    );

    setPosition((current) => arePositionsClose(current, nextPosition) ? current : nextPosition);
  }, [graph?.cameras, id, initialPosition, isDragging, selectedCameraId]);

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
    applyCameraWindowPosition();
  }, [applyCameraWindowPosition, graph?.id, graph?.updatedAt, selectedCameraId, windowSize]);

  useEffect(() => {
    const handleViewportResize = () => {
      applyCameraWindowPosition();
    };
    window.addEventListener('resize', handleViewportResize);
    return () => {
      window.removeEventListener('resize', handleViewportResize);
    };
  }, [applyCameraWindowPosition]);

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
      const nextPosition = clampFloatingWindowPositionToViewport(
        {
          x: dragState.originX + (event.clientX - dragState.pointerStartX),
          y: dragState.originY + (event.clientY - dragState.pointerStartY),
        },
        windowSizeRef.current,
        getViewportSize()
      );
      setPosition(nextPosition);
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      setIsDragging(false);
      persistWindowPositionToCamera(positionRef.current);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDragging, persistWindowPositionToCamera]);

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
