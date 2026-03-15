import type { GraphNode, PythonEnvironment } from '../../types';

interface NodePanelInlineCodeSectionProps {
  selectedNode: GraphNode;
  graphPythonEnvs: PythonEnvironment[];
  selectedPythonEnvExists: boolean;
  codeValue: string;
  onUpdateNodeRuntime: (runtime: string) => void;
  onUpdateNodePythonEnv: (pythonEnv: string) => void;
  onCodeChange: (value: string) => void;
  onCommitInlineCode: () => void;
  onResetInlineCode: () => void;
}

function NodePanelInlineCodeSection({
  selectedNode,
  graphPythonEnvs,
  selectedPythonEnvExists,
  codeValue,
  onUpdateNodeRuntime,
  onUpdateNodePythonEnv,
  onCodeChange,
  onCommitInlineCode,
  onResetInlineCode,
}: NodePanelInlineCodeSectionProps) {
  return (
    <div>
      <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
        Runtime:
      </label>
      <select
        value={selectedNode.config.runtime || 'javascript_vm'}
        onChange={(event) => {
          onUpdateNodeRuntime(event.target.value);
        }}
        style={{
          width: '100%',
          padding: '8px',
          marginBottom: '16px',
          border: '1px solid #ddd',
          borderRadius: '4px',
        }}
      >
        <option value="javascript_vm">JavaScript VM</option>
        <option value="python_process">Python Process</option>
      </select>
      {selectedNode.config.runtime === 'python_process' && (
        <>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Python Env:
          </label>
          <select
            value={selectedNode.config.pythonEnv || ''}
            onChange={(event) => {
              onUpdateNodePythonEnv(event.target.value);
            }}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '10px',
              border: '1px solid #ddd',
              borderRadius: '4px',
            }}
          >
            <option value="">Default backend Python</option>
            {graphPythonEnvs.map((env) => (
              <option key={env.name} value={env.name}>
                {env.name}
              </option>
            ))}
          </select>
          {selectedNode.config.pythonEnv && !selectedPythonEnvExists && (
            <div style={{ marginBottom: '10px', color: '#b91c1c', fontSize: '11px' }}>
              Selected env "{selectedNode.config.pythonEnv}" no longer exists on this graph.
            </div>
          )}
        </>
      )}
      <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
        Code:
      </label>
      <textarea
        value={codeValue}
        onChange={(event) => {
          onCodeChange(event.target.value);
        }}
        onBlur={onCommitInlineCode}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onResetInlineCode();
            event.currentTarget.blur();
          }
        }}
        style={{
          width: '100%',
          minHeight: '200px',
          fontFamily: 'monospace',
          fontSize: '12px',
          padding: '8px',
          border: '1px solid #ddd',
          borderRadius: '4px',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

export default NodePanelInlineCodeSection;

