import type { NodeExecutionState, NodeGraphicsComputationDebug } from '../../store/graphStore';
import type { GraphNode } from '../../types';
import { sectionCardStyle } from './panelSectionStyles';

interface NodePanelExecutionSectionProps {
  selectedNode: GraphNode;
  autoRecomputeEnabled: boolean;
  statusLightColor: string;
  nodeExecutionState: NodeExecutionState | null;
  selectedNodeGraphicsDebug: NodeGraphicsComputationDebug | null;
  isGraphicsDebugExpanded: boolean;
  setIsGraphicsDebugExpanded: (updater: (value: boolean) => boolean) => void;
  onSetAutoRecompute: (enabled: boolean) => void;
  onRunSelectedNode: () => void | Promise<void>;
  formatDebugMetricValue: (value: number | null, maxFractionDigits?: number) => string;
  formatDebugPixelList: (values: number[]) => string;
}

function NodePanelExecutionSection({
  selectedNode,
  autoRecomputeEnabled,
  statusLightColor,
  nodeExecutionState,
  selectedNodeGraphicsDebug,
  isGraphicsDebugExpanded,
  setIsGraphicsDebugExpanded,
  onSetAutoRecompute,
  onRunSelectedNode,
  formatDebugMetricValue,
  formatDebugPixelList,
}: NodePanelExecutionSectionProps) {
  return (
    <div style={sectionCardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '12px', color: '#334155', fontWeight: 600 }}>Execution Status</span>
        <span style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: statusLightColor,
          border: '1px solid rgba(0,0,0,0.15)',
          display: 'inline-block',
        }} />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
        <input
          data-testid="auto-recompute-toggle"
          type="checkbox"
          checked={autoRecomputeEnabled}
          onChange={(event) => onSetAutoRecompute(event.target.checked)}
        />
        Auto recompute when upstream changes
      </label>
      {nodeExecutionState?.hasError && nodeExecutionState.errorMessage && (
        <div
          data-testid="node-execution-error"
          style={{
            marginTop: '8px',
            color: '#b91c1c',
            fontSize: '11px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {nodeExecutionState.errorMessage}
        </div>
      )}
      <button
        data-testid="run-selected-node-button"
        onClick={() => {
          void onRunSelectedNode();
        }}
        style={{
          marginTop: '10px',
          width: '100%',
          padding: '8px',
          background: '#0ea5e9',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
        }}
      >
        Run Selected Node
      </button>
      {selectedNodeGraphicsDebug && selectedNodeGraphicsDebug.nodeId === selectedNode.id && (
        <div
          data-testid="node-graphics-debug"
          style={{
            marginTop: '10px',
            padding: '8px',
            borderRadius: '4px',
            border: '1px solid #dbe4ef',
            background: '#f8fafc',
            fontSize: '10px',
            fontFamily: 'monospace',
            color: '#334155',
            lineHeight: 1.35,
            wordBreak: 'break-word',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: isGraphicsDebugExpanded ? '6px' : '0',
            }}
          >
            <span style={{ fontWeight: 700 }}>Graphics Budget Debug</span>
            <button
              data-testid="node-graphics-debug-toggle"
              onClick={() => {
                setIsGraphicsDebugExpanded((value) => !value);
              }}
              style={{
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                background: '#f8fafc',
                padding: '3px 8px',
                fontSize: '10px',
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              {isGraphicsDebugExpanded ? 'Hide details' : 'Show details'}
            </button>
          </div>
          {isGraphicsDebugExpanded && (
            <>
              <div>hasGraphicsOutput: {selectedNodeGraphicsDebug.hasGraphicsOutput ? 'true' : 'false'}</div>
              <div>isRenderableGraphics: {selectedNodeGraphicsDebug.isRenderableGraphics ? 'true' : 'false'}</div>
              <div>graphicsId: {selectedNodeGraphicsDebug.graphicsId ?? '-'}</div>
              <div>mimeType: {selectedNodeGraphicsDebug.mimeType ?? '-'}</div>
              <div>levelCount: {selectedNodeGraphicsDebug.levelCount}</div>
              <div>levelPixels: {formatDebugPixelList(selectedNodeGraphicsDebug.levelPixels)}</div>
              <div>viewportScale: {formatDebugMetricValue(selectedNodeGraphicsDebug.viewportScale, 4)}</div>
              <div>projectionWidth: {formatDebugMetricValue(selectedNodeGraphicsDebug.projectionWidth)}</div>
              <div>projectedWidthOnScreen: {formatDebugMetricValue(selectedNodeGraphicsDebug.projectedWidthOnScreen, 2)}</div>
              <div>devicePixelRatio: {formatDebugMetricValue(selectedNodeGraphicsDebug.devicePixelRatio, 2)}</div>
              <div>estimatedMaxPixels: {formatDebugMetricValue(selectedNodeGraphicsDebug.estimatedMaxPixels)}</div>
              <div>stableMaxPixels: {formatDebugMetricValue(selectedNodeGraphicsDebug.stableMaxPixels)}</div>
              <div>selectedLevel: {formatDebugMetricValue(selectedNodeGraphicsDebug.selectedLevel)}</div>
              <div>selectedLevelPixels: {formatDebugMetricValue(selectedNodeGraphicsDebug.selectedLevelPixels)}</div>
              <div>shouldLoadByViewport: {selectedNodeGraphicsDebug.shouldLoadProjectedGraphicsByViewport ? 'true' : 'false'}</div>
              <div>canReloadProjectedGraphics: {selectedNodeGraphicsDebug.canReloadProjectedGraphics ? 'true' : 'false'}</div>
              <div>shouldLoadProjectedGraphics: {selectedNodeGraphicsDebug.shouldLoadProjectedGraphics ? 'true' : 'false'}</div>
              <div>requestUrl: {selectedNodeGraphicsDebug.requestUrl ?? '-'}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default NodePanelExecutionSection;

