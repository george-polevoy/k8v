import type { PythonEnvironment } from '../types';
import type { PythonEnvDraftField } from '../utils/panelPythonEnvHelpers';

interface PythonEnvironmentSectionProps {
  pythonEnvDrafts: PythonEnvironment[];
  validationError: string | null;
  disableAdd: boolean;
  disableSave: boolean;
  onUpdateField: (index: number, field: PythonEnvDraftField, value: string) => void;
  onAdd: () => void;
  onDelete: (index: number) => void;
  onSave: () => void | Promise<void>;
}

function PythonEnvironmentSection({
  pythonEnvDrafts,
  validationError,
  disableAdd,
  disableSave,
  onUpdateField,
  onAdd,
  onDelete,
  onSave,
}: PythonEnvironmentSectionProps) {
  return (
    <div
      style={{
        marginTop: '10px',
        padding: '8px',
        border: '1px solid #e2e8f0',
        borderRadius: '6px',
        background: '#f8fafc',
      }}
    >
      <div style={{ fontSize: '11px', color: '#334155', fontWeight: 700, marginBottom: '8px' }}>
        Python Environments
      </div>
      {pythonEnvDrafts.length === 0 ? (
        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px' }}>
          No graph-level Python envs defined.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
          {pythonEnvDrafts.map((env, index) => (
            <div
              key={`${env.name}-${index}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: '6px',
                padding: '8px',
                border: '1px solid #dbe4ef',
                borderRadius: '4px',
                background: '#ffffff',
              }}
            >
              <input
                data-testid={`python-env-name-${index}`}
                type="text"
                value={env.name}
                placeholder="Env name"
                onChange={(event) => onUpdateField(index, 'name', event.target.value)}
                style={{
                  width: '100%',
                  padding: '6px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '11px',
                  boxSizing: 'border-box',
                }}
              />
              <input
                data-testid={`python-env-path-${index}`}
                type="text"
                value={env.pythonPath}
                placeholder="/path/to/python"
                onChange={(event) => onUpdateField(index, 'pythonPath', event.target.value)}
                style={{
                  width: '100%',
                  padding: '6px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '11px',
                  boxSizing: 'border-box',
                }}
              />
              <input
                data-testid={`python-env-cwd-${index}`}
                type="text"
                value={env.cwd}
                placeholder="/working/directory"
                onChange={(event) => onUpdateField(index, 'cwd', event.target.value)}
                style={{
                  width: '100%',
                  padding: '6px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '11px',
                  boxSizing: 'border-box',
                }}
              />
              <button
                data-testid={`python-env-delete-${index}`}
                onClick={() => onDelete(index)}
                style={{
                  justifySelf: 'end',
                  padding: '4px 8px',
                  border: '1px solid #fecaca',
                  background: '#fff1f2',
                  color: '#b91c1c',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          data-testid="python-env-add"
          disabled={disableAdd}
          onClick={onAdd}
          style={{
            flex: 1,
            padding: '7px 8px',
            background: '#e2e8f0',
            border: '1px solid #cbd5e1',
            borderRadius: '4px',
            fontSize: '11px',
            cursor: disableAdd ? 'not-allowed' : 'pointer',
          }}
        >
          Add Env
        </button>
        <button
          data-testid="python-env-save"
          disabled={disableSave}
          onClick={() => {
            void onSave();
          }}
          style={{
            flex: 1,
            padding: '7px 8px',
            background: '#0f766e',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '11px',
            cursor: disableSave ? 'not-allowed' : 'pointer',
          }}
        >
          Save Envs
        </button>
      </div>
      {validationError && (
        <div style={{ marginTop: '6px', color: '#b91c1c', fontSize: '11px' }}>
          {validationError}
        </div>
      )}
    </div>
  );
}

export default PythonEnvironmentSection;
