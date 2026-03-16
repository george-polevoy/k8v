import type { ReactNode } from 'react';
import GraphManagementControls from '../GraphManagementControls';

interface GraphPanelIdentitySectionProps {
  graphId: string | null;
  graphName: string;
  graphSummaries: Array<{ id: string; name: string; revision: number; updatedAt: number }>;
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
  runtimeSettings: ReactNode;
}

function GraphPanelIdentitySection({
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
  runtimeSettings,
}: GraphPanelIdentitySectionProps) {
  return (
    <GraphManagementControls
      graphId={graphId}
      graphName={graphName}
      graphSummaries={graphSummaries}
      graphNameValue={graphNameValue}
      newGraphName={newGraphName}
      isGraphActionInFlight={isGraphActionInFlight}
      isDeleteGraphConfirming={isDeleteGraphConfirming}
      onSelectGraph={onSelectGraph}
      onGraphNameChange={onGraphNameChange}
      onCommitGraphName={onCommitGraphName}
      onDeleteRequest={onDeleteRequest}
      onDeleteCancel={onDeleteCancel}
      onDeleteConfirm={onDeleteConfirm}
      onNewGraphNameChange={onNewGraphNameChange}
      onCreateGraph={onCreateGraph}
      afterRename={runtimeSettings}
    />
  );
}

export default GraphPanelIdentitySection;
