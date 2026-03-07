import type { ReactNode } from 'react';
import type { GraphSummary } from '../store/graphStore';
import { formatGraphOptionLabel } from '../utils/panelGraphHelpers';

interface GraphManagementControlsProps {
  graphId: string | null;
  graphName: string;
  graphSummaries: GraphSummary[];
  graphNameValue: string;
  newGraphName: string;
  isGraphActionInFlight: boolean;
  isDeleteGraphConfirming: boolean;
  onSelectGraph: (graphId: string) => void | Promise<void>;
  onGraphNameChange: (value: string) => void;
  onCommitGraphName: () => void | Promise<void>;
  onDeleteRequest: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void | Promise<void>;
  onNewGraphNameChange: (value: string) => void;
  onCreateGraph: () => void | Promise<void>;
  afterRename?: ReactNode;
  afterCreate?: ReactNode;
}

function GraphManagementControls({
  graphId,
  graphName,
  graphSummaries,
  graphNameValue,
  newGraphName,
  isGraphActionInFlight,
  isDeleteGraphConfirming,
  onSelectGraph,
  onGraphNameChange,
  onCommitGraphName,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
  onNewGraphNameChange,
  onCreateGraph,
  afterRename,
  afterCreate,
}: GraphManagementControlsProps) {
  const hasGraph = Boolean(graphId);

  return (
    <>
      <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
        Select graph
      </label>
      <select
        data-testid="graph-select"
        value={graphId ?? ''}
        disabled={isGraphActionInFlight}
        onChange={(event) => {
          void onSelectGraph(event.target.value);
        }}
        style={{
          width: '100%',
          padding: '8px',
          marginBottom: '8px',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          boxSizing: 'border-box',
        }}
      >
        {graphSummaries.length === 0 && <option value="">No graphs available</option>}
        {graphSummaries.map((summary) => (
          <option key={summary.id} value={summary.id}>
            {formatGraphOptionLabel(summary.name, summary.id)}
          </option>
        ))}
      </select>

      <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
        Rename current graph
      </label>
      <input
        data-testid="graph-name-input"
        type="text"
        value={graphNameValue}
        disabled={!hasGraph || isGraphActionInFlight}
        onChange={(event) => onGraphNameChange(event.target.value)}
        onBlur={() => {
          void onCommitGraphName();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
          if (event.key === 'Escape' && hasGraph) {
            onGraphNameChange(graphName);
            event.currentTarget.blur();
          }
        }}
        style={{
          width: '100%',
          padding: '8px',
          marginBottom: '8px',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          boxSizing: 'border-box',
        }}
      />

      {afterRename}

      {!isDeleteGraphConfirming ? (
        <button
          data-testid="delete-graph-button"
          disabled={!hasGraph || isGraphActionInFlight}
          onClick={onDeleteRequest}
          style={{
            width: '100%',
            padding: '8px 10px',
            marginBottom: '10px',
            background: '#b91c1c',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: !hasGraph || isGraphActionInFlight ? 'not-allowed' : 'pointer',
            fontSize: '12px',
          }}
        >
          Delete Current Graph
        </button>
      ) : (
        <div
          style={{
            marginBottom: '10px',
            padding: '8px',
            border: '1px solid #fecaca',
            borderRadius: '6px',
            background: '#fef2f2',
          }}
        >
          <div style={{ fontSize: '11px', color: '#7f1d1d', marginBottom: '8px' }}>
            Delete this graph permanently?
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              data-testid="confirm-delete-graph-button"
              disabled={!hasGraph || isGraphActionInFlight}
              onClick={() => {
                void onDeleteConfirm();
              }}
              style={{
                flex: 1,
                padding: '7px 8px',
                background: '#b91c1c',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: !hasGraph || isGraphActionInFlight ? 'not-allowed' : 'pointer',
                fontSize: '12px',
              }}
            >
              Confirm Delete
            </button>
            <button
              data-testid="cancel-delete-graph-button"
              disabled={isGraphActionInFlight}
              onClick={onDeleteCancel}
              style={{
                flex: 1,
                padding: '7px 8px',
                background: '#e2e8f0',
                color: '#0f172a',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                cursor: isGraphActionInFlight ? 'not-allowed' : 'pointer',
                fontSize: '12px',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
        New graph
      </label>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          data-testid="new-graph-name-input"
          type="text"
          value={newGraphName}
          disabled={isGraphActionInFlight}
          onChange={(event) => onNewGraphNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void onCreateGraph();
            }
          }}
          style={{
            flex: 1,
            padding: '8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        />
        <button
          data-testid="create-graph-button"
          disabled={isGraphActionInFlight}
          onClick={() => {
            void onCreateGraph();
          }}
          style={{
            padding: '8px 10px',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isGraphActionInFlight ? 'not-allowed' : 'pointer',
            fontSize: '12px',
          }}
        >
          Create
        </button>
      </div>

      {afterCreate}
    </>
  );
}

export default GraphManagementControls;
