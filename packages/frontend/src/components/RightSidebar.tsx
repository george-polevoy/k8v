import { ReactNode, useState } from 'react';
import GraphPanel from './GraphPanel';
import NodePanel from './NodePanel';
import OutputPanel from './OutputPanel';

type SidebarSectionId = 'graph' | 'node' | 'output';

interface AccordionSectionProps {
  id: SidebarSectionId;
  title: string;
  expanded: boolean;
  onToggle: (id: SidebarSectionId) => void;
  children: ReactNode;
}

function AccordionSection({
  id,
  title,
  expanded,
  onToggle,
  children,
}: AccordionSectionProps) {
  return (
    <section
      style={{
        borderBottom: '1px solid #d7dde6',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        flex: expanded ? 1 : '0 0 auto',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        data-testid={`sidebar-toggle-${id}`}
        onClick={() => onToggle(id)}
        style={{
          width: '100%',
          padding: '12px',
          border: 'none',
          background: expanded ? '#e8edf5' : '#f3f6fa',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: '13px',
          fontWeight: 700,
          color: '#1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>{title}</span>
        <span>{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div
          data-testid={`sidebar-content-${id}`}
          style={{
            padding: '12px',
            overflowY: 'auto',
            minHeight: 0,
            flex: 1,
            background: '#f8fafd',
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}

function RightSidebar() {
  const [expandedSection, setExpandedSection] = useState<SidebarSectionId | null>('graph');

  const handleToggleSection = (sectionId: SidebarSectionId) => {
    setExpandedSection((current) => (current === sectionId ? null : sectionId));
  };

  return (
    <aside
      data-testid="right-sidebar"
      style={{
        width: '420px',
        background: '#f3f6fa',
        borderLeft: '1px solid #cfd8e3',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <AccordionSection
        id="graph"
        title="Graph"
        expanded={expandedSection === 'graph'}
        onToggle={handleToggleSection}
      >
        <GraphPanel embedded />
      </AccordionSection>
      <AccordionSection
        id="node"
        title="Node"
        expanded={expandedSection === 'node'}
        onToggle={handleToggleSection}
      >
        <NodePanel embedded showGraphSection={false} />
      </AccordionSection>
      <AccordionSection
        id="output"
        title="Output"
        expanded={expandedSection === 'output'}
        onToggle={handleToggleSection}
      >
        <OutputPanel embedded />
      </AccordionSection>
    </aside>
  );
}

export default RightSidebar;
