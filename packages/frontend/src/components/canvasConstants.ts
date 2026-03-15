export const ANNOTATION_TEXT_INSET_X = 8;
export const ANNOTATION_TEXT_INSET_Y = 8;
export const ANNOTATION_TEXT_INSET_BOTTOM = 8;
export const ANNOTATION_CONNECTION_EDGE_HIT_WIDTH = 14;
export const PORT_RADIUS = 4;
export const NODE_GRAPHICS_FALLBACK_ASPECT_RATIO = 0.6;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const ZOOM_SENSITIVITY = 0.0014;
export const VIEWPORT_MARGIN = 100;
export const EDGE_HIT_WIDTH = 16;
export const CONNECTION_WIRE_SCREEN_WIDTH = 1;
export const CONNECTION_WIRE_FOREGROUND_ALPHA = 0.92;
export const CONNECTION_WIRE_BACKGROUND_ALPHA = 0.64;
export const CONNECTION_WIRE_SELECTED_FOREGROUND_ALPHA = 1;
export const CONNECTION_WIRE_SELECTED_BACKGROUND_ALPHA = 0.9;
export const MINIMAP_WIDTH = 220;
export const MINIMAP_HEIGHT = 140;
export const MINIMAP_PADDING = 8;
export const NODE_DRAG_START_THRESHOLD = 2;
export const LIGHTNING_DURATION_MS = 900;
export const NODE_SHOCK_DURATION_MS = 1200;
export const DRAW_SMOOTHING_STEP = 1;
export const NUMERIC_SLIDER_LEFT_PADDING = 12;
export const NUMERIC_SLIDER_RIGHT_PADDING = 34;
export const NUMERIC_SLIDER_Y_OFFSET = 15;
export const NODE_RESIZE_HANDLE_SIZE = 10;
export const NODE_RESIZE_HANDLE_MARGIN = 4;
export const SMOKE_EMIT_INTERVAL_MS = 140;
export const SMOKE_MIN_DURATION_MS = 720;
export const SMOKE_MAX_DURATION_MS = 1320;
export const SMOKE_MAX_PARTICLES = 96;
export const PROJECTION_TRANSITION_DURATION_MS = 260;
export const PIXEL_RATIO = typeof window !== 'undefined' ? Math.max(window.devicePixelRatio || 1, 1) : 1;
export const MAX_TEXT_RESOLUTION = PIXEL_RATIO * 4;
export const NODE_TITLE_CHAR_WIDTH_ESTIMATE = 8;
export const NODE_TITLE_TEXT_STYLE = {
  fontFamily: 'Arial',
  fontSize: 14,
  fontWeight: 'bold' as const,
  fill: 0x0f172a,
};
export const VIEWPORT_INTERACTION_SETTLE_MS = 180;
export const VIEWPORT_GRAPHICS_SETTLE_MS = 420;

export const CANVAS_VIEWPORT_CONFIG = {
  pixelRatio: PIXEL_RATIO,
  maxTextResolution: MAX_TEXT_RESOLUTION,
  minimapWidth: MINIMAP_WIDTH,
  minimapHeight: MINIMAP_HEIGHT,
  minimapPadding: MINIMAP_PADDING,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  viewportMargin: VIEWPORT_MARGIN,
  projectionTransitionDurationMs: PROJECTION_TRANSITION_DURATION_MS,
};

export const CANVAS_RUNTIME_CONFIG = {
  edgeHitWidth: EDGE_HIT_WIDTH,
  connectionWireScreenWidth: CONNECTION_WIRE_SCREEN_WIDTH,
  connectionWireForegroundAlpha: CONNECTION_WIRE_FOREGROUND_ALPHA,
  connectionWireBackgroundAlpha: CONNECTION_WIRE_BACKGROUND_ALPHA,
  connectionWireSelectedForegroundAlpha: CONNECTION_WIRE_SELECTED_FOREGROUND_ALPHA,
  connectionWireSelectedBackgroundAlpha: CONNECTION_WIRE_SELECTED_BACKGROUND_ALPHA,
  lightningDurationMs: LIGHTNING_DURATION_MS,
  nodeShockDurationMs: NODE_SHOCK_DURATION_MS,
  smokeEmitIntervalMs: SMOKE_EMIT_INTERVAL_MS,
  smokeMinDurationMs: SMOKE_MIN_DURATION_MS,
  smokeMaxDurationMs: SMOKE_MAX_DURATION_MS,
  smokeMaxParticles: SMOKE_MAX_PARTICLES,
};

export const CANVAS_INTERACTION_CONFIG = {
  portRadius: PORT_RADIUS,
  annotationEdgeHitWidth: ANNOTATION_CONNECTION_EDGE_HIT_WIDTH,
  nodeDragStartThreshold: NODE_DRAG_START_THRESHOLD,
  drawSmoothingStep: DRAW_SMOOTHING_STEP,
  zoomSensitivity: ZOOM_SENSITIVITY,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
};
