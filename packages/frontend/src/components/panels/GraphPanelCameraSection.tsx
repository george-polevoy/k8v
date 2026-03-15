import { mutedSectionCardStyle, sectionTitleStyle } from './panelSectionStyles';

interface CameraOption {
  id: string;
  name: string;
}

interface GraphPanelCameraSectionProps {
  graphExists: boolean;
  isGraphActionInFlight: boolean;
  activeCameraId: string;
  cameraOptions: CameraOption[];
  canRemoveActiveCamera: boolean;
  formatCameraLabel: (name: string, id: string) => string;
  onSelectCamera: (cameraId: string) => void;
  onAddCamera: () => void | Promise<void>;
  onRemoveCamera: () => void | Promise<void>;
}

function GraphPanelCameraSection({
  graphExists,
  isGraphActionInFlight,
  activeCameraId,
  cameraOptions,
  canRemoveActiveCamera,
  formatCameraLabel,
  onSelectCamera,
  onAddCamera,
  onRemoveCamera,
}: GraphPanelCameraSectionProps) {
  return (
    <div style={mutedSectionCardStyle}>
      <div style={sectionTitleStyle}>Cameras</div>
      <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
        Current camera for this window
      </label>
      <select
        data-testid="camera-select"
        value={graphExists ? activeCameraId : ''}
        disabled={!graphExists || isGraphActionInFlight}
        onChange={(event) => onSelectCamera(event.target.value)}
        style={{
          width: '100%',
          padding: '8px',
          marginBottom: '8px',
          border: '1px solid #d1d5db',
          borderRadius: '4px',
          boxSizing: 'border-box',
        }}
      >
        {cameraOptions.map((camera) => (
          <option key={camera.id} value={camera.id}>
            {formatCameraLabel(camera.name, camera.id)}
          </option>
        ))}
      </select>
      <div style={{ marginBottom: '8px', fontSize: '10px', color: '#64748b' }}>
        Selecting a camera only changes this browser window. Camera contents are shared on the graph.
      </div>
      <button
        data-testid="camera-add"
        disabled={!graphExists || isGraphActionInFlight}
        onClick={() => {
          void onAddCamera();
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
        Add Camera
      </button>
      <button
        data-testid="camera-remove"
        disabled={!canRemoveActiveCamera}
        onClick={() => {
          void onRemoveCamera();
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
          cursor: canRemoveActiveCamera ? 'pointer' : 'not-allowed',
        }}
      >
        Remove Current Camera
      </button>
    </div>
  );
}

export default GraphPanelCameraSection;

