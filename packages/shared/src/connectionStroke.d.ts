export interface GraphConnectionStrokeSettings {
  foregroundColor: string;
  backgroundColor: string;
  foregroundWidth: number;
  backgroundWidth: number;
}

export const MIN_CONNECTION_STROKE_WIDTH: number;
export const MAX_CONNECTION_STROKE_WIDTH: number;
export const MIN_CONNECTION_BRIGHTNESS_DELTA: number;
export const CONNECTION_BRIGHTNESS_ADJUSTMENT: number;
export const DEFAULT_GRAPH_CONNECTION_STROKE: Readonly<GraphConnectionStrokeSettings>;

export function normalizeGraphConnectionStroke(
  value: Partial<GraphConnectionStrokeSettings> | null | undefined
): GraphConnectionStrokeSettings;

