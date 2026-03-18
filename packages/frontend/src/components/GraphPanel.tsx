import { useCallback, useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';
import {
  CanvasBackgroundSettings,
  DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
  DEFAULT_GRAPH_PROJECTION_ID,
  GraphConnectionStrokeSettings,
  getNextProjectionName,
  materializeGraphProjectionState,
  normalizeGraphExecutionTimeoutMs,
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
import ColorSelectionDialog from './ColorSelectionDialog';
import { useGraphManagementState } from './useGraphManagementState';
import GraphPanelAppearanceSection from './panels/GraphPanelAppearanceSection';
import GraphPanelIdentitySection from './panels/GraphPanelIdentitySection';
import GraphPanelPythonSection from './panels/GraphPanelPythonSection';
import GraphPanelRuntimeSection from './panels/GraphPanelRuntimeSection';
import GraphPanelListSection from './panels/GraphPanelListSection';
import {
  embeddedPanelCardStyle,
  floatingPanelStyle,
  standalonePanelCardStyle,
} from './panels/panelSectionStyles';
import { v4 as uuidv4 } from 'uuid';

const MIN_RECOMPUTE_CONCURRENCY = 1;
const MAX_RECOMPUTE_CONCURRENCY = 32;
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
    graphNameValue,
    setGraphNameValue,
    newGraphName,
    setNewGraphName,
    pythonEnvDrafts,
    pythonEnvValidationError,
    isGraphActionInFlight,
    isDeleteGraphConfirming,
    commitGraphName,
    handleSelectGraph,
    handleCreateGraph,
    requestDeleteCurrentGraph,
    cancelDeleteCurrentGraph,
    handleDeleteCurrentGraph,
    runGraphCommands,
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
  const projectionState = graph
    ? materializeGraphProjectionState(
      graph.nodes,
      graph.projections,
      graph.activeProjectionId,
      graph.canvasBackground
    )
    : null;
  const activeProjection = projectionState?.projections.find(
    (projection) => projection.id === projectionState.activeProjectionId
  ) ?? projectionState?.projections[0] ?? null;
  const projectionOptions = projectionState?.projections ?? [];
  const activeProjectionId = projectionState?.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID;
  const cameraOptions = graph ? normalizeGraphCameraState(graph.cameras) : [];
  const activeCamera = graph ? resolveGraphCamera(cameraOptions, selectedCameraId) : null;
  const activeCameraId = activeCamera?.id ?? DEFAULT_GRAPH_CAMERA_ID;

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
      const normalizedProjectionState = materializeGraphProjectionState(
        graph.nodes,
        graph.projections,
        graph.activeProjectionId,
        graph.canvasBackground
      );
      setCanvasBackgroundDraft(
        normalizeCanvasBackground(normalizedProjectionState.canvasBackground)
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

    await runGraphCommands([{
      kind: 'set_recompute_concurrency',
      recomputeConcurrency: next,
    }]);
  }, [graph, recomputeConcurrencyValue, runGraphCommands]);

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

    await runGraphCommands([{
      kind: 'set_execution_timeout',
      executionTimeoutMs: nextTimeoutMs,
    }]);
  }, [executionTimeoutSecondsValue, graph, runGraphCommands]);

  const commitCanvasBackground = useCallback(async () => {
    if (!graph || !activeProjection) {
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
    await runGraphCommands([{
      kind: 'set_canvas_background',
      canvasBackground: normalized,
    }]);
  }, [activeProjection, canvasBackgroundDraft, graph, runGraphCommands]);

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

    await runGraphCommands([{
      kind: 'set_connection_stroke',
      connectionStroke: normalized,
    }]);
  }, [connectionStrokeDraft, graph, runGraphCommands]);

  const handleSelectProjection = useCallback(async (projectionId: string) => {
    if (!projectionState || !projectionId.trim()) {
      return;
    }
    if (projectionState.activeProjectionId === projectionId) {
      return;
    }

    const selectedProjection = projectionState.projections.find(
      (projection) => projection.id === projectionId
    );
    if (!selectedProjection) {
      return;
    }

    await runGraphCommands([{
      kind: 'set_active_projection',
      activeProjectionId: selectedProjection.id,
    }]);
  }, [projectionState, runGraphCommands]);

  const handleAddProjection = useCallback(async () => {
    if (!projectionState) {
      return;
    }
    const projectionId = uuidv4();
    const projectionName = getNextProjectionName(
      projectionState.projections.map((projection) => projection.name)
    );
    await runGraphCommands([{
      kind: 'graph_projection_add',
      projectionId,
      name: projectionName,
      sourceProjectionId: projectionState.activeProjectionId,
    }]);
  }, [projectionState, runGraphCommands]);

  const handleRemoveProjection = useCallback(async () => {
    if (
      !projectionState ||
      !activeProjection ||
      projectionState.projections.length <= 1 ||
      activeProjection.id === DEFAULT_GRAPH_PROJECTION_ID
    ) {
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

    await runGraphCommands([
      {
        kind: 'replace_projections',
        projections: remainingProjections,
      },
      {
        kind: 'set_active_projection',
        activeProjectionId: nextActiveProjection.id,
      },
    ]);
  }, [activeProjection, projectionState, runGraphCommands]);

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

    await runGraphCommands(
      [{
        kind: 'replace_cameras',
        cameras: [...cameraOptions, nextCamera],
      }],
      {
        refreshSummaries: false,
        afterSubmit: () => {
          selectCamera(nextCamera.id);
        },
      }
    );
  }, [flushCurrentCameraViewportState, graph, runGraphCommands, selectCamera, selectedCameraId]);

  const handleRemoveCamera = useCallback(async () => {
    if (!graph) {
      return;
    }

    const currentCameraOptions = normalizeGraphCameraState(graph.cameras);
    const currentActiveCamera = resolveGraphCamera(currentCameraOptions, selectedCameraId);
    if (
      currentActiveCamera.id === DEFAULT_GRAPH_CAMERA_ID ||
      currentCameraOptions.length <= 1
    ) {
      return;
    }

    const remainingCameras = removeGraphCamera(currentCameraOptions, currentActiveCamera.id);
    if (remainingCameras.length === 0) {
      return;
    }
    const nextSelectedCameraId = remainingCameras.find((camera) => camera.id === DEFAULT_GRAPH_CAMERA_ID)?.id
      ?? remainingCameras[0].id;

    await runGraphCommands(
      [{
        kind: 'replace_cameras',
        cameras: remainingCameras,
      }],
      {
        refreshSummaries: false,
        afterSubmit: () => {
          selectCamera(nextSelectedCameraId);
        },
      }
    );
  }, [graph, runGraphCommands, selectCamera, selectedCameraId]);
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
        <GraphPanelListSection
          title="Cameras"
          selectLabel="Current camera for this window"
          addLabel="Add Camera"
          removeLabel="Remove Current Camera"
          description="Selecting a camera only changes this browser window. Camera contents are shared on the graph."
          graphExists={Boolean(graph)}
          isGraphActionInFlight={isGraphActionInFlight}
          activeId={activeCameraId}
          options={cameraOptions}
          canRemoveActive={canRemoveActiveCamera}
          formatLabel={(camera) => formatCameraOptionLabel(camera.name, camera.id)}
          getOptionId={(camera) => camera.id}
          onSelect={(cameraId) => {
            flushCurrentCameraViewportState();
            selectCamera(cameraId);
          }}
          onAdd={handleAddCamera}
          onRemove={handleRemoveCamera}
          dataTestPrefix="camera"
        />
        <GraphPanelListSection
          title="Projections"
          selectLabel="Active projection"
          addLabel="Add Projection"
          removeLabel="Remove Active Projection"
          graphExists={Boolean(graph)}
          isGraphActionInFlight={isGraphActionInFlight}
          activeId={activeProjectionId}
          options={projectionOptions}
          canRemoveActive={canRemoveActiveProjection}
          formatLabel={(projection) => formatProjectionOptionLabel(projection.name, projection.id)}
          getOptionId={(projection) => projection.id}
          onSelect={handleSelectProjection}
          onAdd={handleAddProjection}
          onRemove={handleRemoveProjection}
          dataTestPrefix="projection"
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
