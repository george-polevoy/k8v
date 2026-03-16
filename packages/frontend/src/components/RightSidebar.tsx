import { ReactNode, Suspense, lazy, useEffect, useState } from 'react';
import { useGraphStore } from '../store/graphStore';

const GraphPanel = lazy(() => import('./GraphPanel'));
const NodePanel = lazy(() => import('./NodePanel'));
const OutputPanel = lazy(() => import('./OutputPanel'));
const DiagnosticsPanel = lazy(() => import('./DiagnosticsPanel'));

type SidebarSectionId = 'graph' | 'node' | 'output' | 'diagnostics';

function PanelSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div style={{ fontSize: '12px', color: '#64748b' }}>Loading panel...</div>}>
      {children}
    </Suspense>
  );
}

interface AccordionSectionProps {
  id: SidebarSectionId;
  title: string;
  expanded: boolean;
  hasAlert?: boolean;
  onToggle: (id: SidebarSectionId) => void;
  children: ReactNode;
}

function AccordionSection({
  id,
  title,
  expanded,
  hasAlert = false,
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
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: hasAlert ? '#b91c1c' : '#1e293b',
          }}
        >
          <span>{title}</span>
          {hasAlert && (
            <span
              data-testid={`sidebar-alert-${id}`}
              aria-label={`${title} has errors`}
              title={`${title} has errors`}
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '999px',
                background: '#dc2626',
                boxShadow: '0 0 0 2px rgba(220, 38, 38, 0.2)',
                display: 'inline-block',
              }}
            />
          )}
        </span>
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
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const selectedNodeIds = useGraphStore((state) => state.selectedNodeIds);
  const selectedDrawingId = useGraphStore((state) => state.selectedDrawingId);
  const error = useGraphStore((state) => state.error);
  const [expandedSection, setExpandedSection] = useState<SidebarSectionId | null>('graph');
  const diagnosticsHasAlert = Boolean(error);

  const handleToggleSection = (sectionId: SidebarSectionId) => {
    setExpandedSection((current) => (current === sectionId ? null : sectionId));
  };

  useEffect(() => {
    if (!selectedNodeId && selectedNodeIds.length === 0 && !selectedDrawingId) {
      return;
    }
    setExpandedSection('node');
  }, [selectedDrawingId, selectedNodeId, selectedNodeIds.length]);

  return (
    <aside
      data-testid="right-sidebar"
      style={{
        width: '100%',
        background: '#f3f6fa',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <AccordionSection
        id="graph"
        title="Graph"
        expanded={expandedSection === 'graph'}
        onToggle={handleToggleSection}
      >
        <PanelSuspense>
          <GraphPanel embedded />
        </PanelSuspense>
      </AccordionSection>
      <AccordionSection
        id="node"
        title="Node"
        expanded={expandedSection === 'node'}
        onToggle={handleToggleSection}
      >
        <PanelSuspense>
          <NodePanel embedded />
        </PanelSuspense>
      </AccordionSection>
      <AccordionSection
        id="output"
        title="Output"
        expanded={expandedSection === 'output'}
        onToggle={handleToggleSection}
      >
        <PanelSuspense>
          <OutputPanel embedded />
        </PanelSuspense>
      </AccordionSection>
      <AccordionSection
        id="diagnostics"
        title="Diagnostics"
        hasAlert={diagnosticsHasAlert}
        expanded={expandedSection === 'diagnostics'}
        onToggle={handleToggleSection}
      >
        <PanelSuspense>
          <DiagnosticsPanel embedded />
        </PanelSuspense>
      </AccordionSection>
    </aside>
  );
}

export default RightSidebar;
