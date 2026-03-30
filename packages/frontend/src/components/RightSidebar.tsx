import {
  ReactNode,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { readGraphSidebarState, saveGraphSidebarState } from '../store/graphSidebarSessionStorage';
import { useGraphStore } from '../store/graphStore';
import Toolbar from './Toolbar';

const GraphPanel = lazy(() => import('./GraphPanel'));
const NodePanel = lazy(() => import('./NodePanel'));
const OutputPanel = lazy(() => import('./OutputPanel'));
const DiagnosticsPanel = lazy(() => import('./DiagnosticsPanel'));

type SidebarSectionId = 'tools' | 'graph' | 'node' | 'output' | 'diagnostics';

interface SidebarState {
  activeSection: SidebarSectionId;
  isExpanded: boolean;
}

interface SidebarSectionDefinition {
  id: SidebarSectionId;
  title: string;
  icon: ReactNode;
  hasAlert?: boolean;
  content: ReactNode;
}

const DEFAULT_SIDEBAR_STATE: SidebarState = {
  activeSection: 'graph',
  isExpanded: true,
};
const RAIL_WIDTH_PX = 68;
const CONTENT_WIDTH_PX = 380;
const VALID_SECTION_IDS: SidebarSectionId[] = [
  'tools',
  'graph',
  'node',
  'output',
  'diagnostics',
];

function isSidebarSectionId(value: string): value is SidebarSectionId {
  return VALID_SECTION_IDS.includes(value as SidebarSectionId);
}

function resolveSidebarState(graphId: string | null): SidebarState {
  if (!graphId) {
    return DEFAULT_SIDEBAR_STATE;
  }

  const persistedState = readGraphSidebarState(graphId);
  if (!persistedState || !isSidebarSectionId(persistedState.activeSection)) {
    return DEFAULT_SIDEBAR_STATE;
  }

  return {
    activeSection: persistedState.activeSection,
    isExpanded: persistedState.isExpanded,
  };
}

function PanelSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div style={{ fontSize: '12px', color: '#64748b' }}>Loading panel...</div>}>
      {children}
    </Suspense>
  );
}

function IconFrame({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: 'center',
        display: 'inline-flex',
        height: '20px',
        justifyContent: 'center',
        width: '20px',
      }}
    >
      {children}
    </span>
  );
}

function ToolsIcon() {
  return (
    <IconFrame>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2.25" y="2.25" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="10.75" y="2.25" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="2.25" y="10.75" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
        <rect x="10.75" y="10.75" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </IconFrame>
  );
}

function GraphIcon() {
  return (
    <IconFrame>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="4.25" cy="9" r="1.75" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="13.75" cy="4.25" r="1.75" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="13.75" cy="13.75" r="1.75" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.9 8.17L12.1 5.08" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M5.9 9.83L12.1 12.92" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </IconFrame>
  );
}

function NodeIcon() {
  return (
    <IconFrame>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="3" y="3" width="12" height="12" rx="2.2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 6.25H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 9H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M6 11.75H10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </IconFrame>
  );
}

function OutputIcon() {
  return (
    <IconFrame>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M4 5.25L7.5 9L4 12.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 12.75H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="2.25" y="2.25" width="13.5" height="13.5" rx="2.25" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </IconFrame>
  );
}

function DiagnosticsIcon() {
  return (
    <IconFrame>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M9 3.1L15.2 14.25H2.8L9 3.1Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M9 6.9V10.15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="9" cy="12.45" r="0.75" fill="currentColor" />
      </svg>
    </IconFrame>
  );
}

function RightSidebar() {
  const graphId = useGraphStore((state) => state.graph?.id ?? null);
  const error = useGraphStore((state) => state.error);
  const diagnosticsHasAlert = Boolean(error);
  const [sidebarState, setSidebarState] = useState<SidebarState>(DEFAULT_SIDEBAR_STATE);

  useEffect(() => {
    setSidebarState(resolveSidebarState(graphId));
  }, [graphId]);

  useEffect(() => {
    if (!graphId) {
      return;
    }

    saveGraphSidebarState(graphId, sidebarState);
  }, [graphId, sidebarState]);

  const sectionDefinitions = useMemo<SidebarSectionDefinition[]>(() => ([
    {
      id: 'tools',
      title: 'Tools',
      icon: <ToolsIcon />,
      content: (
        <PanelSuspense>
          <Toolbar embedded />
        </PanelSuspense>
      ),
    },
    {
      id: 'graph',
      title: 'Graph',
      icon: <GraphIcon />,
      content: (
        <PanelSuspense>
          <GraphPanel embedded />
        </PanelSuspense>
      ),
    },
    {
      id: 'node',
      title: 'Node',
      icon: <NodeIcon />,
      content: (
        <PanelSuspense>
          <NodePanel embedded />
        </PanelSuspense>
      ),
    },
    {
      id: 'output',
      title: 'Output',
      icon: <OutputIcon />,
      content: (
        <PanelSuspense>
          <OutputPanel embedded />
        </PanelSuspense>
      ),
    },
    {
      id: 'diagnostics',
      title: 'Diagnostics',
      icon: <DiagnosticsIcon />,
      hasAlert: diagnosticsHasAlert,
      content: (
        <PanelSuspense>
          <DiagnosticsPanel embedded />
        </PanelSuspense>
      ),
    },
  ]), [diagnosticsHasAlert]);

  const activeSection = sectionDefinitions.find(
    (section) => section.id === sidebarState.activeSection
  ) ?? sectionDefinitions.find((section) => section.id === DEFAULT_SIDEBAR_STATE.activeSection) ?? sectionDefinitions[0];

  return (
    <aside
      data-testid="right-sidebar"
      style={{
        width: `${RAIL_WIDTH_PX + (sidebarState.isExpanded ? CONTENT_WIDTH_PX : 0)}px`,
        minWidth: `${RAIL_WIDTH_PX + (sidebarState.isExpanded ? CONTENT_WIDTH_PX : 0)}px`,
        maxWidth: `${RAIL_WIDTH_PX + (sidebarState.isExpanded ? CONTENT_WIDTH_PX : 0)}px`,
        background: '#f8fafc',
        display: 'flex',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        borderLeft: '1px solid #d7dde6',
        boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.6) inset',
      }}
    >
      <div
        data-testid="sidebar-rail"
        style={{
          width: `${RAIL_WIDTH_PX}px`,
          minWidth: `${RAIL_WIDTH_PX}px`,
          maxWidth: `${RAIL_WIDTH_PX}px`,
          background: '#eef2f7',
          borderRight: sidebarState.isExpanded ? '1px solid #d7dde6' : 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '6px',
          padding: '12px 8px',
        }}
      >
        {sectionDefinitions.map((section) => {
          const isActive = sidebarState.activeSection === section.id;
          const isHighlighted = isActive && sidebarState.isExpanded;
          return (
            <button
              key={section.id}
              type="button"
              data-testid={`sidebar-toggle-${section.id}`}
              aria-label={section.title}
              aria-pressed={isHighlighted}
              title={section.title}
              onClick={() => {
                setSidebarState((current) => (
                  current.activeSection === section.id
                    ? {
                        activeSection: current.activeSection,
                        isExpanded: !current.isExpanded,
                      }
                    : {
                        activeSection: section.id,
                        isExpanded: true,
                      }
                ));
              }}
              style={{
                width: '100%',
                border: '1px solid transparent',
                background: isHighlighted ? '#dbe5f2' : isActive ? '#e8edf5' : 'transparent',
                color: section.hasAlert ? '#b91c1c' : isHighlighted ? '#0f172a' : '#334155',
                borderRadius: '12px',
                padding: '10px 6px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px',
                position: 'relative',
              }}
            >
              {section.icon}
              <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.04em' }}>
                {section.title}
              </span>
              {section.hasAlert && (
                <span
                  data-testid={`sidebar-alert-${section.id}`}
                  aria-label={`${section.title} has errors`}
                  title={`${section.title} has errors`}
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    width: '9px',
                    height: '9px',
                    borderRadius: '999px',
                    background: '#dc2626',
                    boxShadow: '0 0 0 2px rgba(248, 250, 252, 0.95)',
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
      {sidebarState.isExpanded && (
        <div
          data-testid="sidebar-content-pane"
          style={{
            width: `${CONTENT_WIDTH_PX}px`,
            minWidth: `${CONTENT_WIDTH_PX}px`,
            maxWidth: `${CONTENT_WIDTH_PX}px`,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            background: '#f8fafc',
          }}
        >
          <div
            style={{
              padding: '14px 16px 10px',
              borderBottom: '1px solid #dbe4ef',
              background: 'rgba(255, 255, 255, 0.72)',
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', letterSpacing: '0.08em' }}>
              {activeSection.title.toUpperCase()}
            </div>
          </div>
          <div
            data-testid={`sidebar-content-${activeSection.id}`}
            style={{
              padding: '12px',
              overflowY: 'auto',
              minHeight: 0,
              flex: 1,
            }}
          >
            {activeSection.content}
          </div>
        </div>
      )}
    </aside>
  );
}

export default RightSidebar;
