import type { PythonEnvironment } from '../../types';
import type { PythonEnvDraftField } from '../../utils/panelPythonEnvHelpers';
import PythonEnvironmentSection from '../PythonEnvironmentSection';

interface GraphPanelPythonSectionProps {
  graphExists: boolean;
  graphId: string | null;
  pythonEnvDrafts: PythonEnvironment[];
  validationError: string | null;
  isGraphActionInFlight: boolean;
  onUpdateField: (index: number, field: PythonEnvDraftField, value: string) => void;
  onAdd: () => void;
  onDelete: (index: number) => void;
  onSave: () => void | Promise<void>;
}

function GraphPanelPythonSection({
  graphExists,
  graphId,
  pythonEnvDrafts,
  validationError,
  isGraphActionInFlight,
  onUpdateField,
  onAdd,
  onDelete,
  onSave,
}: GraphPanelPythonSectionProps) {
  return (
    <>
      <PythonEnvironmentSection
        pythonEnvDrafts={pythonEnvDrafts}
        validationError={validationError}
        disableAdd={isGraphActionInFlight}
        disableSave={isGraphActionInFlight || !graphExists}
        onUpdateField={onUpdateField}
        onAdd={onAdd}
        onDelete={onDelete}
        onSave={onSave}
      />
      {graphId && (
        <div style={{ marginTop: '8px', fontSize: '10px', color: '#64748b' }}>
          Current graph ID: <code>{graphId}</code>
        </div>
      )}
    </>
  );
}

export default GraphPanelPythonSection;

