import type { GraphicsArtifact } from '../types';

export type PencilColor = string;
export type PencilThickness = 1 | 3 | 9;

export interface NodeExecutionState {
  isPending: boolean;
  isComputing: boolean;
  hasError: boolean;
  isStale: boolean;
  errorMessage: string | null;
  lastRunAt: number | null;
}

export interface NodeGraphicsComputationDebug {
  nodeId: string;
  nodeType: string;
  hasGraphicsOutput: boolean;
  isRenderableGraphics: boolean;
  graphicsId: string | null;
  mimeType: string | null;
  levelCount: number;
  levelPixels: number[];
  viewportScale: number;
  projectionWidth: number | null;
  projectedWidthOnScreen: number | null;
  devicePixelRatio: number;
  estimatedMaxPixels: number | null;
  stableMaxPixels: number | null;
  selectedLevel: number | null;
  selectedLevelPixels: number | null;
  shouldLoadProjectedGraphicsByViewport: boolean;
  canReloadProjectedGraphics: boolean;
  shouldLoadProjectedGraphics: boolean;
  requestUrl: string | null;
}

export type NodeGraphicsOutputMap = Record<string, GraphicsArtifact | null>;

export interface GraphSummary {
  id: string;
  name: string;
  updatedAt: number;
}
