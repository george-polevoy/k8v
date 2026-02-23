import { useGraphStore } from '../store/graphStore';
import { toHumanReadableDiagnosticsMessage } from '../utils/diagnostics';

interface DiagnosticsPanelProps {
  embedded?: boolean;
}

function DiagnosticsPanel({ embedded = false }: DiagnosticsPanelProps) {
  const error = useGraphStore((state) => state.error);
  const message = toHumanReadableDiagnosticsMessage(error);

  return (
    <div
      data-testid="diagnostics-panel"
      style={embedded
        ? {}
        : {
            width: '300px',
            background: '#f9f9f9',
            borderLeft: '1px solid #ddd',
            padding: '16px',
            overflowY: 'auto',
          }}
    >
      {!embedded && <h3 style={{ marginBottom: '16px' }}>Diagnostics</h3>}

      {message ? (
        <div
          data-testid="diagnostics-has-error"
          style={{
            border: '1px solid #fecaca',
            background: '#fef2f2',
            borderRadius: '6px',
            padding: '10px',
          }}
        >
          <div
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#b91c1c',
              marginBottom: '6px',
            }}
          >
            Backend Failure
          </div>
          <div
            data-testid="diagnostics-message"
            style={{
              fontSize: '12px',
              color: '#7f1d1d',
              lineHeight: 1.45,
            }}
          >
            {message}
          </div>
        </div>
      ) : (
        <div
          data-testid="diagnostics-empty"
          style={{
            border: '1px solid #dbe4ef',
            background: '#ffffff',
            borderRadius: '6px',
            padding: '10px',
            fontSize: '12px',
            color: '#334155',
          }}
        >
          No backend failures.
        </div>
      )}
    </div>
  );
}

export default DiagnosticsPanel;

