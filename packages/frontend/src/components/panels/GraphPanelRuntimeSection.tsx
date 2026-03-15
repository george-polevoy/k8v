interface GraphPanelRuntimeSectionProps {
  graphExists: boolean;
  isGraphActionInFlight: boolean;
  recomputeConcurrencyValue: string;
  executionTimeoutSecondsValue: string;
  minRecomputeConcurrency: number;
  maxRecomputeConcurrency: number;
  onRecomputeConcurrencyChange: (value: string) => void;
  onCommitRecomputeConcurrency: () => void | Promise<void>;
  onResetRecomputeConcurrency: () => void;
  onExecutionTimeoutChange: (value: string) => void;
  onCommitExecutionTimeout: () => void | Promise<void>;
  onResetExecutionTimeout: () => void;
}

function GraphPanelRuntimeSection({
  graphExists,
  isGraphActionInFlight,
  recomputeConcurrencyValue,
  executionTimeoutSecondsValue,
  minRecomputeConcurrency,
  maxRecomputeConcurrency,
  onRecomputeConcurrencyChange,
  onCommitRecomputeConcurrency,
  onResetRecomputeConcurrency,
  onExecutionTimeoutChange,
  onCommitExecutionTimeout,
  onResetExecutionTimeout,
}: GraphPanelRuntimeSectionProps) {
  return (
    <>
      <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
        Recompute workers
      </label>
      <input
        data-testid="graph-recompute-concurrency-input"
        type="number"
        min={minRecomputeConcurrency}
        max={maxRecomputeConcurrency}
        step={1}
        value={recomputeConcurrencyValue}
        disabled={!graphExists || isGraphActionInFlight}
        onChange={(event) => onRecomputeConcurrencyChange(event.target.value)}
        onBlur={() => {
          void onCommitRecomputeConcurrency();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            onResetRecomputeConcurrency();
            event.currentTarget.blur();
          }
        }}
        style={{
          width: '100%',
          padding: '8px',
          marginBottom: '4px',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ marginBottom: '8px', fontSize: '10px', color: '#64748b' }}>
        Graph-level backend recompute worker concurrency (1-32).
      </div>

      <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
        Script timeout (seconds)
      </label>
      <input
        data-testid="graph-execution-timeout-input"
        type="number"
        min={0.001}
        step={0.1}
        value={executionTimeoutSecondsValue}
        disabled={!graphExists || isGraphActionInFlight}
        onChange={(event) => onExecutionTimeoutChange(event.target.value)}
        onBlur={() => {
          void onCommitExecutionTimeout();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            onResetExecutionTimeout();
            event.currentTarget.blur();
          }
        }}
        style={{
          width: '100%',
          padding: '8px',
          marginBottom: '4px',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ marginBottom: '8px', fontSize: '10px', color: '#64748b' }}>
        Graph-level inline runtime timeout. Default 30 seconds. No maximum.
      </div>
    </>
  );
}

export default GraphPanelRuntimeSection;

