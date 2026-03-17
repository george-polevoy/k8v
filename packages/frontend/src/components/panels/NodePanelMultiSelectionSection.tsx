import type { ReactNode } from 'react';
import { sectionCardStyle } from './panelSectionStyles';

interface NodePanelMultiSelectionSectionProps {
  selectedNodeSetSummary: string;
  selectedCount: number;
  nodeCardColorSection: ReactNode;
}

function NodePanelMultiSelectionSection({
  selectedNodeSetSummary,
  selectedCount,
  nodeCardColorSection,
}: NodePanelMultiSelectionSectionProps) {
  return (
    <div>
      <h4
        data-testid="multi-node-selection-summary"
        style={{ marginBottom: '12px', lineHeight: 1.35 }}
      >
        {selectedNodeSetSummary}
      </h4>

      <div
        style={{
          ...sectionCardStyle,
          fontSize: '12px',
          color: '#334155',
          lineHeight: 1.5,
        }}
      >
        <div>Selection size: {selectedCount}</div>
        <div>Editor actions in this view apply to the full selected set.</div>
      </div>

      {nodeCardColorSection}
    </div>
  );
}

export default NodePanelMultiSelectionSection;
