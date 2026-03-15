import { mutedSectionCardStyle, sectionTitleStyle } from './panelSectionStyles';

interface ProjectionOption {
  id: string;
  name: string;
}

interface GraphPanelProjectionSectionProps {
  graphExists: boolean;
  isGraphActionInFlight: boolean;
  activeProjectionId: string;
  projectionOptions: ProjectionOption[];
  canRemoveActiveProjection: boolean;
  formatProjectionLabel: (name: string, id: string) => string;
  onSelectProjection: (projectionId: string) => void | Promise<void>;
  onAddProjection: () => void | Promise<void>;
  onRemoveProjection: () => void | Promise<void>;
}

function GraphPanelProjectionSection({
  graphExists,
  isGraphActionInFlight,
  activeProjectionId,
  projectionOptions,
  canRemoveActiveProjection,
  formatProjectionLabel,
  onSelectProjection,
  onAddProjection,
  onRemoveProjection,
}: GraphPanelProjectionSectionProps) {
  return (
    <div style={mutedSectionCardStyle}>
      <div style={sectionTitleStyle}>Projections</div>
      <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
        Active projection
      </label>
      <select
        data-testid="projection-select"
        value={graphExists ? activeProjectionId : ''}
        disabled={!graphExists || isGraphActionInFlight}
        onChange={(event) => {
          void onSelectProjection(event.target.value);
        }}
        style={{
          width: '100%',
          padding: '8px',
          marginBottom: '8px',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          boxSizing: 'border-box',
        }}
      >
        {projectionOptions.map((projection) => (
          <option key={projection.id} value={projection.id}>
            {formatProjectionLabel(projection.name, projection.id)}
          </option>
        ))}
      </select>
      <button
        data-testid="projection-add"
        disabled={!graphExists || isGraphActionInFlight}
        onClick={() => {
          void onAddProjection();
        }}
        style={{
          width: '100%',
          padding: '7px 8px',
          background: '#475569',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontSize: '11px',
          cursor: !graphExists || isGraphActionInFlight ? 'not-allowed' : 'pointer',
        }}
      >
        Add Projection
      </button>
      <button
        data-testid="projection-remove"
        disabled={!canRemoveActiveProjection}
        onClick={() => {
          void onRemoveProjection();
        }}
        style={{
          width: '100%',
          marginTop: '8px',
          padding: '7px 8px',
          background: '#b91c1c',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontSize: '11px',
          cursor: canRemoveActiveProjection ? 'pointer' : 'not-allowed',
        }}
      >
        Remove Active Projection
      </button>
    </div>
  );
}

export default GraphPanelProjectionSection;

