import { useCallback, useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import {
  CanvasBackgroundSettings,
  GraphConnectionStrokeSettings,
} from '../types';
import { normalizeCanvasBackground } from '../utils/canvasBackground';
import {
  DEFAULT_GRAPH_CONNECTION_STROKE,
  normalizeGraphConnectionStroke,
} from '../utils/connectionStroke';
import {
  DEFAULT_GRAPH_CAMERA_ID,
  getNextCameraName,
  normalizeGraphCameraState,
  removeGraphCamera,
  resolveGraphCamera,
} from '../utils/cameras';
import {
  applyProjectionToNodes,
  cloneProjectionNodeCardSizes,
  cloneProjectionNodePositions,
  DEFAULT_GRAPH_PROJECTION_ID,
  normalizeGraphProjectionState,
  withCanvasBackgroundInProjection,
} from '../utils/projections';
import ColorSelectionDialog from './ColorSelectionDialog';
import { useGraphManagementState } from './useGraphManagementState';
import GraphPanelAppearanceSection from './panels/GraphPanelAppearanceSection';
import GraphPanelCameraSection from './panels/GraphPanelCameraSection';
import GraphPanelIdentitySection from './panels/GraphPanelIdentitySection';
import GraphPanelProjectionSection from './panels/GraphPanelProjectionSection';
import GraphPanelPythonSection from './panels/GraphPanelPythonSection';
import GraphPanelRuntimeSection from './panels/GraphPanelRuntimeSection';
import {
  embeddedPanelCardStyle,
  floatingPanelStyle,
  standalonePanelCardStyle,
} from './panels/panelSectionStyles';
import { v4 as uuidv4 } from 'uuid';

const MIN_RECOMPUTE_CONCURRENCY = 1;
const MAX_RECOMPUTE_CONCURRENCY = 32;
const DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS = 30_000;
const DEFAULT_GRAPH_EXECUTION_TIMEOUT_SECONDS = DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS / 1000;

function formatProjectionOptionLabel(name: string, id: string): string {
  if (id === DEFAULT_GRAPH_PROJECTION_ID) {
    return `${name} (${id})`;
  }
  return `${name} (${id.slice(0, 8)})`;
}

function formatCameraOptionLabel(name: string, id: string): string {
  if (id === DEFAULT_GRAPH_CAMERA_ID) {
    return `${name} (${id})`;
  }
  return `${name} (${id.slice(0, 8)})`;
}

function getNextProjectionName(existingNames: string[]): string {
  const existing = new Set(existingNames);
  let index = 1;
  let candidate = `Projection ${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `Projection ${index}`;
  }
  return candidate;
}

function normalizeRecomputeConcurrency(
  value: unknown,
  fallback = MIN_RECOMPUTE_CONCURRENCY
): number {
  const parsedValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number.parseInt(value, 10)
      : Number.NaN;

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  const rounded = Math.trunc(parsedValue);
  return Math.min(
    MAX_RECOMPUTE_CONCURRENCY,
    Math.max(MIN_RECOMPUTE_CONCURRENCY, rounded)
  );
}

function normalizeGraphExecutionTimeoutMs(
  value: unknown,
  fallback = DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS
): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function normalizeExecutionTimeoutSeconds(
  value: unknown,
  fallback = DEFAULT_GRAPH_EXECUTION_TIMEOUT_SECONDS
): number {
  const parsedValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number.parseFloat(value)
      : Number.NaN;

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
}

interface GraphPanelProps {
  embedded?: boolean;
}

type ConnectionStrokeColorTarget = 'foreground' | 'background' | null;

function GraphPanel({ embedded = false }: GraphPanelProps) {
  const selectedCameraId = useGraphStore((state) => state.selectedCameraId);
  const selectCamera = useGraphStore((state) => state.selectCamera);
  const {
    graph,
    graphSummaries,
    refreshGraphSummaries,
    updateGraph,
    graphNameValue,
    setGraphNameValue,
    newGraphName,
    setNewGraphName,
    pythonEnvDrafts,
    pythonEnvValidationError,
    isGraphActionInFlight,
    isDeleteGraphConfirming,
    runGraphAction,
    commitGraphName,
    handleSelectGraph,
    handleCreateGraph,
    requestDeleteCurrentGraph,
    cancelDeleteCurrentGraph,
    handleDeleteCurrentGraph,
    updatePythonEnvDraftField,
    addPythonEnvDraft,
    deletePythonEnvDraft,
    commitPythonEnvs,
  } = useGraphManagementState();
  const [canvasBackgroundDraft, setCanvasBackgroundDraft] = useState<CanvasBackgroundSettings>(
    normalizeCanvasBackground(undefined)
  );
  const [showCanvasBackgroundColorDialog, setShowCanvasBackgroundColorDialog] = useState(false);
  const [connectionStrokeDraft, setConnectionStrokeDraft] = useState<GraphConnectionStrokeSettings>(
    normalizeGraphConnectionStroke(undefined)
  );
  const [connectionStrokeColorTarget, setConnectionStrokeColorTarget] =
    useState<ConnectionStrokeColorTarget>(null);
  const [recomputeConcurrencyValue, setRecomputeConcurrencyValue] = useState(
    String(MIN_RECOMPUTE_CONCURRENCY)
  );
  const [executionTimeoutSecondsValue, setExecutionTimeoutSecondsValue] = useState(
    String(DEFAULT_GRAPH_EXECUTION_TIMEOUT_SECONDS)
  );

  const flushCurrentCameraViewportState = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    (window as Window & {
      __k8vFlushViewportCameraState?: () => void;
    }).__k8vFlushViewportCameraState?.();
  }, []);

  useEffect(() => {
    if (graph) {
      const projectionState = normalizeGraphProjectionState(
        graph.nodes,
        graph.projections,
        graph.activeProjectionId,
        graph.canvasBackground
      );
      const activeProjection = projectionState.projections.find(
        (projection) => projection.id === projectionState.activeProjectionId
      ) ?? projectionState.projections[0];
      setCanvasBackgroundDraft(
        normalizeCanvasBackground(activeProjection?.canvasBackground ?? graph.canvasBackground)
      );
      setConnectionStrokeDraft(normalizeGraphConnectionStroke(graph.connectionStroke));
      setRecomputeConcurrencyValue(
        String(
          normalizeRecomputeConcurrency(
            graph.recomputeConcurrency,
            MIN_RECOMPUTE_CONCURRENCY
          )
        )
      );
      setExecutionTimeoutSecondsValue(
        String(
          normalizeGraphExecutionTimeoutMs(graph.executionTimeoutMs) / 1000
        )
      );
    } else {
      setCanvasBackgroundDraft(normalizeCanvasBackground(undefined));
      setConnectionStrokeDraft(normalizeGraphConnectionStroke(undefined));
      setRecomputeConcurrencyValue(String(MIN_RECOMPUTE_CONCURRENCY));
      setExecutionTimeoutSecondsValue(String(DEFAULT_GRAPH_EXECUTION_TIMEOUT_SECONDS));
    }
    setConnectionStrokeColorTarget(null);
  }, [graph]);

  const commitRecomputeConcurrency = useCallback(async () => {
    if (!graph) {
      return;
    }

    const current = normalizeRecomputeConcurrency(
      graph.recomputeConcurrency,
      MIN_RECOMPUTE_CONCURRENCY
    );
    const next = normalizeRecomputeConcurrency(recomputeConcurrencyValue, current);
    setRecomputeConcurrencyValue(String(next));
    if (next === current) {
      return;
    }

    await runGraphAction(async () => {
      await updateGraph({ recomputeConcurrency: next });
      await refreshGraphSummaries();
    });
  }, [graph, recomputeConcurrencyValue, refreshGraphSummaries, runGraphAction, updateGraph]);

  const commitExecutionTimeout = useCallback(async () => {
    if (!graph) {
      return;
    }

    const currentTimeoutMs = normalizeGraphExecutionTimeoutMs(graph.executionTimeoutMs);
    const currentSeconds = currentTimeoutMs / 1000;
    const nextSeconds = normalizeExecutionTimeoutSeconds(executionTimeoutSecondsValue, currentSeconds);
    const nextTimeoutMs = Math.max(1, Math.round(nextSeconds * 1000));
    setExecutionTimeoutSecondsValue(String(nextTimeoutMs / 1000));
    if (nextTimeoutMs === currentTimeoutMs) {
      return;
    }

    await runGraphAction(async () => {
      await updateGraph({ executionTimeoutMs: nextTimeoutMs });
      await refreshGraphSummaries();
    });
  }, [executionTimeoutSecondsValue, graph, refreshGraphSummaries, runGraphAction, updateGraph]);

  const commitCanvasBackground = useCallback(async () => {
    if (!graph) {
      return;
    }

    const projectionState = normalizeGraphProjectionState(
      graph.nodes,
      graph.projections,
      graph.activeProjectionId,
      graph.canvasBackground
    );
    const activeProjection = projectionState.projections.find(
      (projection) => projection.id === projectionState.activeProjectionId
    ) ?? projectionState.projections[0];
    if (!activeProjection) {
      return;
    }

    const normalized = normalizeCanvasBackground(canvasBackgroundDraft);
    const currentNormalized = normalizeCanvasBackground(
      activeProjection.canvasBackground ?? graph.canvasBackground
    );
    if (
      normalized.mode === currentNormalized.mode &&
      normalized.baseColor === currentNormalized.baseColor
    ) {
      return;
    }
    const updatedProjections = projectionState.projections.map((projection) =>
      projection.id === projectionState.activeProjectionId
        ? withCanvasBackgroundInProjection(projection, normalized)
        : projection
    );

    await runGraphAction(async () => {
      await updateGraph({
        projections: updatedProjections,
        activeProjectionId: projectionState.activeProjectionId,
        canvasBackground: normalized,
      });
      await refreshGraphSummaries();
    });
  }, [canvasBackgroundDraft, graph, refreshGraphSummaries, runGraphAction, updateGraph]);

  const updateConnectionStrokeForegroundWidth = useCallback((nextValue: string) => {
    const parsedValue = Number.parseFloat(nextValue);
    if (!Number.isFinite(parsedValue)) {
      return;
    }
    setConnectionStrokeDraft((current) => normalizeGraphConnectionStroke({
      ...current,
      foregroundWidth: parsedValue,
      backgroundWidth: parsedValue * 2,
    }));
  }, []);

  const updateConnectionStrokeBackgroundWidth = useCallback((nextValue: string) => {
    const parsedValue = Number.parseFloat(nextValue);
    if (!Number.isFinite(parsedValue)) {
      return;
    }
    setConnectionStrokeDraft((current) => normalizeGraphConnectionStroke({
      ...current,
      foregroundWidth: parsedValue * 0.5,
      backgroundWidth: parsedValue,
    }));
  }, []);

  const commitConnectionStroke = useCallback(async () => {
    if (!graph) {
      return;
    }

    const normalized = normalizeGraphConnectionStroke(connectionStrokeDraft);
    setConnectionStrokeDraft(normalized);
    const current = normalizeGraphConnectionStroke(graph.connectionStroke);
    if (
      normalized.foregroundColor === current.foregroundColor &&
      normalized.backgroundColor === current.backgroundColor &&
      normalized.foregroundWidth === current.foregroundWidth &&
      normalized.backgroundWidth === current.backgroundWidth
    ) {
      return;
    }

    await runGraphAction(async () => {
      await updateGraph({ connectionStroke: normalized });
      await refreshGraphSummaries();
    });
  }, [connectionStrokeDraft, graph, refreshGraphSummaries, runGraphAction, updateGraph]);

  const handleSelectProjection = useCallback(async (projectionId: string) => {
    if (!graph || !projectionId.trim()) {
      return;
    }

    const projectionState = normalizeGraphProjectionState(
      graph.nodes,
      graph.projections,
      graph.activeProjectionId,
      graph.canvasBackground
    );
    if (projectionState.activeProjectionId === projectionId) {
      return;
    }

    const selectedProjection = projectionState.projections.find(
      (projection) => projection.id === projectionId
    );
    if (!selectedProjection) {
      return;
    }

    await runGraphAction(async () => {
      const nextBackground = normalizeCanvasBackground(
        selectedProjection.canvasBackground ?? graph.canvasBackground
      );
      await updateGraph({
        projections: projectionState.projections,
        activeProjectionId: selectedProjection.id,
        nodes: applyProjectionToNodes(graph.nodes, selectedProjection),
        canvasBackground: nextBackground,
      });
      await refreshGraphSummaries();
    });
  }, [graph, refreshGraphSummaries, runGraphAction, updateGraph]);

  const handleAddProjection = useCallback(async () => {
    if (!graph) {
      return;
    }

    const projectionState = normalizeGraphProjectionState(
      graph.nodes,
      graph.projections,
      graph.activeProjectionId,
      graph.canvasBackground
    );
    const sourceProjection = projectionState.projections.find(
      (projection) => projection.id === projectionState.activeProjectionId
    );
    const projectionId = uuidv4();
    const projectionName = getNextProjectionName(
      projectionState.projections.map((projection) => projection.name)
    );
    const newProjection = {
      id: projectionId,
      name: projectionName,
      nodePositions: cloneProjectionNodePositions(graph.nodes, sourceProjection),
      nodeCardSizes: cloneProjectionNodeCardSizes(graph.nodes, sourceProjection),
      canvasBackground: normalizeCanvasBackground(
        sourceProjection?.canvasBackground ?? graph.canvasBackground
      ),
    };

    await runGraphAction(async () => {
      await updateGraph({
        projections: [...projectionState.projections, newProjection],
        activeProjectionId: newProjection.id,
        nodes: applyProjectionToNodes(graph.nodes, newProjection),
        canvasBackground: normalizeCanvasBackground(newProjection.canvasBackground),
      });
      await refreshGraphSummaries();
    });
  }, [graph, refreshGraphSummaries, runGraphAction, updateGraph]);

  const handleRemoveProjection = useCallback(async () => {
    if (!graph) {
      return;
    }

    const projectionState = normalizeGraphProjectionState(
      graph.nodes,
      graph.projections,
      graph.activeProjectionId,
      graph.canvasBackground
    );
    if (projectionState.projections.length <= 1) {
      return;
    }

    const activeProjection = projectionState.projections.find(
      (projection) => projection.id === projectionState.activeProjectionId
    );
    if (!activeProjection || activeProjection.id === DEFAULT_GRAPH_PROJECTION_ID) {
      return;
    }

    const remainingProjections = projectionState.projections.filter(
      (projection) => projection.id !== activeProjection.id
    );
    if (remainingProjections.length === 0) {
      return;
    }

    const nextActiveProjection = remainingProjections.find(
      (projection) => projection.id === DEFAULT_GRAPH_PROJECTION_ID
    ) ?? remainingProjections[0];

    await runGraphAction(async () => {
      const nextBackground = normalizeCanvasBackground(
        nextActiveProjection.canvasBackground ?? graph.canvasBackground
      );
      await updateGraph({
        projections: remainingProjections,
        activeProjectionId: nextActiveProjection.id,
        nodes: applyProjectionToNodes(graph.nodes, nextActiveProjection),
        canvasBackground: nextBackground,
      });
      await refreshGraphSummaries();
    });
  }, [graph, refreshGraphSummaries, runGraphAction, updateGraph]);

  const handleAddCamera = useCallback(async () => {
    const currentGraph = useGraphStore.getState().graph ?? graph;
    if (!currentGraph) {
      return;
    }

    flushCurrentCameraViewportState();

    const latestGraph = useGraphStore.getState().graph ?? currentGraph;
    const latestSelectedCameraId = useGraphStore.getState().selectedCameraId ?? selectedCameraId;
    const cameraOptions = normalizeGraphCameraState(latestGraph.cameras);
    const sourceCamera = resolveGraphCamera(cameraOptions, latestSelectedCameraId);
    const nextCamera = {
      id: uuidv4(),
      name: getNextCameraName(cameraOptions.map((camera) => camera.name)),
      viewport: sourceCamera.viewport ? { ...sourceCamera.viewport } : undefined,
      floatingWindows: Object.fromEntries(
        Object.entries(sourceCamera.floatingWindows ?? {}).map(([windowId, windowPosition]) => [
          windowId,
          {
            horizontal: { ...windowPosition.horizontal },
            vertical: { ...windowPosition.vertical },
          },
        ])
      ),
    };

    await runGraphAction(async () => {
      await updateGraph({
        cameras: [...cameraOptions, nextCamera],
      });
      selectCamera(nextCamera.id);
    });
  }, [flushCurrentCameraViewportState, graph, runGraphAction, selectCamera, selectedCameraId, updateGraph]);

  const handleRemoveCamera = useCallback(async () => {
    if (!graph) {
      return;
    }

    const cameraOptions = normalizeGraphCameraState(graph.cameras);
    const activeCamera = resolveGraphCamera(cameraOptions, selectedCameraId);
    if (activeCamera.id === DEFAULT_GRAPH_CAMERA_ID) {
      return;
    }
    if (cameraOptions.length <= 1) {
      return;
    }

    const remainingCameras = removeGraphCamera(cameraOptions, activeCamera.id);
    if (remainingCameras.length === 0) {
      return;
    }
    const nextSelectedCameraId = remainingCameras.find((camera) => camera.id === DEFAULT_GRAPH_CAMERA_ID)?.id
      ?? remainingCameras[0].id;

    await runGraphAction(async () => {
      await updateGraph({
        cameras: remainingCameras,
      });
      selectCamera(nextSelectedCameraId);
    });
  }, [graph, runGraphAction, selectCamera, selectedCameraId, updateGraph]);

  const projectionState = graph
    ? normalizeGraphProjectionState(
      graph.nodes,
      graph.projections,
      graph.activeProjectionId,
      graph.canvasBackground
    )
    : null;
  const projectionOptions = projectionState?.projections ?? [];
  const activeProjectionId = projectionState?.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID;
  const cameraOptions = graph ? normalizeGraphCameraState(graph.cameras) : [];
  const activeCameraId = selectedCameraId ?? cameraOptions[0]?.id ?? DEFAULT_GRAPH_CAMERA_ID;
  const canRemoveActiveProjection = Boolean(
    graph &&
    !isGraphActionInFlight &&
    projectionOptions.length > 1 &&
    activeProjectionId !== DEFAULT_GRAPH_PROJECTION_ID
  );
  const canRemoveActiveCamera = Boolean(
    graph &&
    !isGraphActionInFlight &&
    cameraOptions.length > 1 &&
    activeCameraId !== DEFAULT_GRAPH_CAMERA_ID
  );
  const isConnectionStrokeColorDialogOpen = connectionStrokeColorTarget !== null;
  const connectionStrokeDialogTitle = connectionStrokeColorTarget === 'background'
    ? 'Connection Background Color'
    : 'Connection Foreground Color';
  const connectionStrokeDialogDescription = connectionStrokeColorTarget === 'background'
    ? 'Background stroke is drawn under the foreground stroke and auto-kept at 2x foreground width.'
    : 'Foreground stroke is drawn on top of the background stroke for connector clarity.';
  const connectionStrokeDialogInitialColor = connectionStrokeColorTarget === 'background'
    ? connectionStrokeDraft.backgroundColor
    : connectionStrokeDraft.foregroundColor;
  const runtimeSettings = (
    <GraphPanelRuntimeSection
      graphExists={Boolean(graph)}
      isGraphActionInFlight={isGraphActionInFlight}
      recomputeConcurrencyValue={recomputeConcurrencyValue}
      executionTimeoutSecondsValue={executionTimeoutSecondsValue}
      minRecomputeConcurrency={MIN_RECOMPUTE_CONCURRENCY}
      maxRecomputeConcurrency={MAX_RECOMPUTE_CONCURRENCY}
      onRecomputeConcurrencyChange={setRecomputeConcurrencyValue}
      onCommitRecomputeConcurrency={commitRecomputeConcurrency}
      onResetRecomputeConcurrency={() => {
        setRecomputeConcurrencyValue(
          String(
            normalizeRecomputeConcurrency(
              graph?.recomputeConcurrency,
              MIN_RECOMPUTE_CONCURRENCY
            )
          )
        );
      }}
      onExecutionTimeoutChange={setExecutionTimeoutSecondsValue}
      onCommitExecutionTimeout={commitExecutionTimeout}
      onResetExecutionTimeout={() => {
        const currentTimeoutMs = normalizeGraphExecutionTimeoutMs(graph?.executionTimeoutMs);
        setExecutionTimeoutSecondsValue(String(currentTimeoutMs / 1000));
      }}
    />
  );

  return (
    <div
      data-testid="graph-panel"
      style={embedded ? undefined : floatingPanelStyle}
    >
      {!embedded && <h3 style={{ marginBottom: '16px' }}>Graph Panel</h3>}
      <div style={embedded ? embeddedPanelCardStyle : standalonePanelCardStyle}>
        <GraphPanelIdentitySection
          graphId={graph?.id ?? null}
          graphName={graph?.name ?? ''}
          graphSummaries={graphSummaries}
          graphNameValue={graphNameValue}
          newGraphName={newGraphName}
          isGraphActionInFlight={isGraphActionInFlight}
          isDeleteGraphConfirming={isDeleteGraphConfirming}
          onSelectGraph={handleSelectGraph}
          onGraphNameChange={setGraphNameValue}
          onCommitGraphName={commitGraphName}
          onDeleteRequest={requestDeleteCurrentGraph}
          onDeleteCancel={cancelDeleteCurrentGraph}
          onDeleteConfirm={handleDeleteCurrentGraph}
          onNewGraphNameChange={setNewGraphName}
          onCreateGraph={handleCreateGraph}
          runtimeSettings={runtimeSettings}
        />
        <GraphPanelCameraSection
          graphExists={Boolean(graph)}
          isGraphActionInFlight={isGraphActionInFlight}
          activeCameraId={activeCameraId}
          cameraOptions={cameraOptions}
          canRemoveActiveCamera={canRemoveActiveCamera}
          formatCameraLabel={formatCameraOptionLabel}
          onSelectCamera={(cameraId) => {
            flushCurrentCameraViewportState();
            selectCamera(cameraId);
          }}
          onAddCamera={handleAddCamera}
          onRemoveCamera={handleRemoveCamera}
        />
        <GraphPanelProjectionSection
          graphExists={Boolean(graph)}
          isGraphActionInFlight={isGraphActionInFlight}
          activeProjectionId={activeProjectionId}
          projectionOptions={projectionOptions}
          canRemoveActiveProjection={canRemoveActiveProjection}
          formatProjectionLabel={formatProjectionOptionLabel}
          onSelectProjection={handleSelectProjection}
          onAddProjection={handleAddProjection}
          onRemoveProjection={handleRemoveProjection}
        />
        <GraphPanelAppearanceSection
          graphExists={Boolean(graph)}
          isGraphActionInFlight={isGraphActionInFlight}
          canvasBackgroundDraft={canvasBackgroundDraft}
          connectionStrokeDraft={connectionStrokeDraft}
          onCanvasBackgroundDraftChange={(updater) => {
            setCanvasBackgroundDraft((current) => updater(current));
          }}
          onOpenCanvasBackgroundColorDialog={() => {
            if (!graph || isGraphActionInFlight) {
              return;
            }
            setShowCanvasBackgroundColorDialog(true);
          }}
          onSaveCanvasBackground={commitCanvasBackground}
          onOpenConnectionStrokeColorDialog={(target) => {
            if (!graph || isGraphActionInFlight) {
              return;
            }
            setConnectionStrokeColorTarget(target);
          }}
          onConnectionStrokeForegroundWidthChange={updateConnectionStrokeForegroundWidth}
          onConnectionStrokeBackgroundWidthChange={updateConnectionStrokeBackgroundWidth}
          onSaveConnectionStroke={commitConnectionStroke}
        />
        <GraphPanelPythonSection
          graphExists={Boolean(graph)}
          graphId={graph?.id ?? null}
          pythonEnvDrafts={pythonEnvDrafts}
          validationError={pythonEnvValidationError}
          isGraphActionInFlight={isGraphActionInFlight}
          onUpdateField={updatePythonEnvDraftField}
          onAdd={addPythonEnvDraft}
          onDelete={deletePythonEnvDraft}
          onSave={commitPythonEnvs}
        />
      </div>
      <ColorSelectionDialog
        open={showCanvasBackgroundColorDialog}
        title="Canvas Base Color"
        description="This color is used directly in solid mode and as the base tone in gradient mode."
        initialColor={canvasBackgroundDraft.baseColor}
        defaultColor="#1d437e"
        confirmLabel="Use Color"
        onCancel={() => setShowCanvasBackgroundColorDialog(false)}
        onConfirm={(color) => {
          setCanvasBackgroundDraft((current) => ({
            ...current,
            baseColor: color,
          }));
          setShowCanvasBackgroundColorDialog(false);
        }}
      />
      <ColorSelectionDialog
        open={isConnectionStrokeColorDialogOpen}
        title={connectionStrokeDialogTitle}
        description={connectionStrokeDialogDescription}
        initialColor={connectionStrokeDialogInitialColor}
        defaultColor={connectionStrokeColorTarget === 'background'
          ? DEFAULT_GRAPH_CONNECTION_STROKE.backgroundColor
          : DEFAULT_GRAPH_CONNECTION_STROKE.foregroundColor}
        confirmLabel="Use Color"
        onCancel={() => setConnectionStrokeColorTarget(null)}
        onConfirm={(color) => {
          setConnectionStrokeDraft((current) => normalizeGraphConnectionStroke({
            ...current,
            ...(connectionStrokeColorTarget === 'background'
              ? { backgroundColor: color }
              : { foregroundColor: color }),
          }));
          setConnectionStrokeColorTarget(null);
        }}
      />
    </div>
  );
}

export default GraphPanel;
