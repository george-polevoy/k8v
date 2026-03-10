import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  Application,
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  settings,
} from 'pixi.js';
import type { NodeGraphicsComputationDebug } from '../store/graphStore';

interface UsePixiCanvasLifecycleParams {
  canvasHostRef: MutableRefObject<HTMLDivElement | null>;
  appRef: MutableRefObject<Application | null>;
  viewportRef: MutableRefObject<Container | null>;
  edgeLayerRef: MutableRefObject<Graphics | null>;
  nodeLayerRef: MutableRefObject<Container | null>;
  drawingHandleLayerRef: MutableRefObject<Container | null>;
  drawLayerRef: MutableRefObject<Graphics | null>;
  effectsLayerRef: MutableRefObject<Graphics | null>;
  backgroundSpriteRef: MutableRefObject<Sprite | null>;
  viewportRefreshRafRef: MutableRefObject<number | null>;
  selectedNodeGraphicsDebugRef: MutableRefObject<NodeGraphicsComputationDebug | null>;
  setCanvasReady: Dispatch<SetStateAction<boolean>>;
  setSelectedNodeGraphicsDebug: (debug: NodeGraphicsComputationDebug | null) => void;
  applyCanvasCursor: () => void;
  refreshCanvasBackgroundTexture: () => void;
  handleStagePointerDown: (event: FederatedPointerEvent) => void;
  handleStagePointerMove: (event: FederatedPointerEvent) => void;
  handleWindowPointerMove: (event: PointerEvent) => void;
  handleStagePointerUp: (event: FederatedPointerEvent) => void;
  handleWheel: (event: WheelEvent) => void;
  handleResize: () => void;
  handleKeyDown: (event: KeyboardEvent) => void;
  handleKeyUp: (event: KeyboardEvent) => void;
  finishInteraction: () => void;
  drawEffects: () => void;
  clearAllNodeGraphicsTextures: () => void;
  renderGraphRef: MutableRefObject<() => void>;
  appliedCanvasBackgroundSignatureRef: MutableRefObject<string>;
}

const PIXEL_RATIO = typeof window !== 'undefined' ? Math.max(window.devicePixelRatio || 1, 1) : 1;

export function usePixiCanvasLifecycle(params: UsePixiCanvasLifecycleParams): void {
  const {
    canvasHostRef,
    appRef,
    viewportRef,
    edgeLayerRef,
    nodeLayerRef,
    drawingHandleLayerRef,
    drawLayerRef,
    effectsLayerRef,
    backgroundSpriteRef,
    viewportRefreshRafRef,
    selectedNodeGraphicsDebugRef,
    setCanvasReady,
    setSelectedNodeGraphicsDebug,
    applyCanvasCursor,
    refreshCanvasBackgroundTexture,
    handleStagePointerDown,
    handleStagePointerMove,
    handleWindowPointerMove,
    handleStagePointerUp,
    handleWheel,
    handleResize,
    handleKeyDown,
    handleKeyUp,
    finishInteraction,
    drawEffects,
    clearAllNodeGraphicsTextures,
    renderGraphRef,
    appliedCanvasBackgroundSignatureRef,
  } = params;

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return;
    }

    settings.ROUND_PIXELS = false;

    const app = new Application({
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0,
      resolution: PIXEL_RATIO,
      resizeTo: host,
    });

    appRef.current = app;
    setCanvasReady(true);
    host.appendChild(app.view as HTMLCanvasElement);

    const viewport = new Container();
    const edgeLayer = new Graphics();
    const nodeLayer = new Container();
    const drawingHandleLayer = new Container();
    const drawLayer = new Graphics();
    drawLayer.eventMode = 'none';
    drawingHandleLayer.eventMode = 'passive';
    const effectsLayer = new Graphics();
    effectsLayer.eventMode = 'none';
    const backgroundSprite = new Sprite(Texture.WHITE);
    backgroundSprite.position.set(0, 0);
    backgroundSprite.width = app.screen.width;
    backgroundSprite.height = app.screen.height;
    backgroundSprite.eventMode = 'none';

    backgroundSpriteRef.current = backgroundSprite;
    viewportRef.current = viewport;
    edgeLayerRef.current = edgeLayer;
    nodeLayerRef.current = nodeLayer;
    drawingHandleLayerRef.current = drawingHandleLayer;
    drawLayerRef.current = drawLayer;
    effectsLayerRef.current = effectsLayer;

    app.stage.addChild(backgroundSprite);
    viewport.addChild(edgeLayer);
    viewport.addChild(nodeLayer);
    viewport.addChild(drawLayer);
    viewport.addChild(drawingHandleLayer);
    viewport.addChild(effectsLayer);
    app.stage.addChild(viewport);

    app.stage.eventMode = 'static';
    app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);

    const canvasElement = app.view as HTMLCanvasElement;
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    canvasElement.style.display = 'block';
    canvasElement.style.width = '100%';
    canvasElement.style.height = '100%';
    canvasElement.style.touchAction = 'none';
    canvasElement.tabIndex = 0;
    canvasElement.style.outline = 'none';
    applyCanvasCursor();
    refreshCanvasBackgroundTexture();

    app.stage.on('pointerdown', handleStagePointerDown);
    app.stage.on('pointermove', handleStagePointerMove);
    app.stage.on('pointerup', handleStagePointerUp);
    app.stage.on('pointerupoutside', handleStagePointerUp);
    app.renderer.on('resize', handleResize);
    canvasElement.addEventListener('contextmenu', handleContextMenu);
    canvasElement.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('pointerup', finishInteraction);
    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    app.ticker.add(drawEffects);

    renderGraphRef.current();

    return () => {
      if (viewportRefreshRafRef.current !== null) {
        window.cancelAnimationFrame(viewportRefreshRafRef.current);
        viewportRefreshRafRef.current = null;
      }

      window.removeEventListener('pointerup', finishInteraction);
      canvasElement.removeEventListener('contextmenu', handleContextMenu);
      canvasElement.removeEventListener('wheel', handleWheel);
      app.stage.off('pointerdown', handleStagePointerDown);
      app.stage.off('pointermove', handleStagePointerMove);
      app.stage.off('pointerup', handleStagePointerUp);
      app.stage.off('pointerupoutside', handleStagePointerUp);
      app.renderer.off('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('keyup', handleKeyUp);
      app.ticker.remove(drawEffects);
      clearAllNodeGraphicsTextures();
      selectedNodeGraphicsDebugRef.current = null;
      setSelectedNodeGraphicsDebug(null);
      app.destroy(true);
      setCanvasReady(false);
      appliedCanvasBackgroundSignatureRef.current = '';
      backgroundSpriteRef.current = null;
      appRef.current = null;
      viewportRef.current = null;
      edgeLayerRef.current = null;
      nodeLayerRef.current = null;
      drawingHandleLayerRef.current = null;
      drawLayerRef.current = null;
      effectsLayerRef.current = null;
    };
  }, [
    appRef,
    applyCanvasCursor,
    appliedCanvasBackgroundSignatureRef,
    backgroundSpriteRef,
    canvasHostRef,
    clearAllNodeGraphicsTextures,
    drawEffects,
    drawLayerRef,
    drawingHandleLayerRef,
    edgeLayerRef,
    effectsLayerRef,
    finishInteraction,
    handleKeyDown,
    handleKeyUp,
    handleResize,
    handleStagePointerDown,
    handleStagePointerMove,
    handleWindowPointerMove,
    handleStagePointerUp,
    handleWheel,
    nodeLayerRef,
    refreshCanvasBackgroundTexture,
    renderGraphRef,
    selectedNodeGraphicsDebugRef,
    setCanvasReady,
    setSelectedNodeGraphicsDebug,
    viewportRef,
    viewportRefreshRafRef,
  ]);
}
