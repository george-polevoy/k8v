import { Suspense, lazy, type PointerEventHandler, type ReactNode, type RefObject } from 'react';
import type { AnnotationOverlayEntry } from './canvasTypes';

const AnnotationMarkdown = lazy(() => import('./AnnotationMarkdown'));

interface CanvasChromeProps {
  canvasHostRef: RefObject<HTMLDivElement>;
  minimapCanvasRef: RefObject<HTMLCanvasElement>;
  annotationOverlays: AnnotationOverlayEntry[];
  annotationOverlayViewportRef: RefObject<HTMLDivElement>;
  handleMinimapPointerDown: PointerEventHandler<HTMLCanvasElement>;
  overlay: ReactNode;
  minimapWidth: number;
  minimapHeight: number;
}

export function CanvasChrome({
  canvasHostRef,
  minimapCanvasRef,
  annotationOverlays,
  annotationOverlayViewportRef,
  handleMinimapPointerDown,
  overlay,
  minimapWidth,
  minimapHeight,
}: CanvasChromeProps) {
  return (
    <div
      data-testid="canvas-root"
      style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}
    >
      <div
        ref={canvasHostRef}
        style={{ width: '100%', height: '100%', overflow: 'hidden' }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 4,
        }}
      >
        <div
          ref={annotationOverlayViewportRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: 'translate(0px, 0px) scale(1)',
            transformOrigin: '0 0',
            width: '1px',
            height: '1px',
          }}
        >
          {annotationOverlays.map((overlayEntry) => (
            <div
              key={overlayEntry.nodeId}
              data-testid={`annotation-overlay-${overlayEntry.nodeId}`}
              style={{
                position: 'absolute',
                left: `${overlayEntry.x}px`,
                top: `${overlayEntry.y}px`,
                width: `${overlayEntry.width}px`,
                height: `${overlayEntry.height}px`,
                overflow: 'hidden',
                padding: '4px 6px 6px',
                color: overlayEntry.fontColor,
              }}
            >
              <Suspense
                fallback={
                  <div
                    className="annotation-markdown"
                    style={{ color: overlayEntry.fontColor, fontSize: `${overlayEntry.fontSize}px` }}
                  >
                    {overlayEntry.text}
                  </div>
                }
              >
                <AnnotationMarkdown
                  markdown={overlayEntry.text}
                  color={overlayEntry.fontColor}
                  fontSize={overlayEntry.fontSize}
                />
              </Suspense>
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: '14px',
          bottom: '14px',
          width: `${minimapWidth}px`,
          height: `${minimapHeight}px`,
          borderRadius: '8px',
          border: '1px solid rgba(148, 163, 184, 0.65)',
          background: 'rgba(15, 23, 42, 0.72)',
          backdropFilter: 'blur(2px)',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.35)',
          overflow: 'hidden',
          zIndex: 5,
        }}
      >
        <canvas
          ref={minimapCanvasRef}
          width={minimapWidth}
          height={minimapHeight}
          onPointerDown={handleMinimapPointerDown}
          onWheel={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            cursor: 'pointer',
          }}
        />
      </div>
      {overlay && (
        <div style={{ position: 'absolute', inset: 0 }}>
          {overlay}
        </div>
      )}
    </div>
  );
}
