import type { CanvasBackgroundSettings, GraphConnectionStrokeSettings } from '../../types';
import { mutedSectionCardStyle, sectionTitleStyle } from './panelSectionStyles';

interface GraphPanelAppearanceSectionProps {
  graphExists: boolean;
  isGraphActionInFlight: boolean;
  canvasBackgroundDraft: CanvasBackgroundSettings;
  connectionStrokeDraft: GraphConnectionStrokeSettings;
  onCanvasBackgroundDraftChange: (updater: (current: CanvasBackgroundSettings) => CanvasBackgroundSettings) => void;
  onOpenCanvasBackgroundColorDialog: () => void;
  onSaveCanvasBackground: () => void | Promise<void>;
  onOpenConnectionStrokeColorDialog: (target: 'foreground' | 'background') => void;
  onConnectionStrokeForegroundWidthChange: (value: string) => void;
  onConnectionStrokeBackgroundWidthChange: (value: string) => void;
  onSaveConnectionStroke: () => void | Promise<void>;
}

function GraphPanelAppearanceSection({
  graphExists,
  isGraphActionInFlight,
  canvasBackgroundDraft,
  connectionStrokeDraft,
  onCanvasBackgroundDraftChange,
  onOpenCanvasBackgroundColorDialog,
  onSaveCanvasBackground,
  onOpenConnectionStrokeColorDialog,
  onConnectionStrokeForegroundWidthChange,
  onConnectionStrokeBackgroundWidthChange,
  onSaveConnectionStroke,
}: GraphPanelAppearanceSectionProps) {
  return (
    <>
      <div style={mutedSectionCardStyle}>
        <div style={sectionTitleStyle}>Projection Background</div>
        <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
          Mode
        </label>
        <select
          data-testid="canvas-background-mode-select"
          value={canvasBackgroundDraft.mode}
          disabled={!graphExists || isGraphActionInFlight}
          onChange={(event) =>
            onCanvasBackgroundDraftChange((current) => ({
              ...current,
              mode: event.target.value === 'solid' ? 'solid' : 'gradient',
            }))
          }
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        >
          <option value="gradient">Gradient</option>
          <option value="solid">Solid</option>
        </select>

        <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
          Base color
        </label>
        <button
          data-testid="canvas-background-color-input"
          type="button"
          disabled={!graphExists || isGraphActionInFlight}
          onClick={onOpenCanvasBackgroundColorDialog}
          style={{
            width: '100%',
            height: '34px',
            marginBottom: '8px',
            padding: '6px 8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            boxSizing: 'border-box',
            background: '#ffffff',
            cursor: !graphExists || isGraphActionInFlight ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            color: '#0f172a',
            fontSize: '11px',
          }}
        >
          <span>Choose color</span>
          <span
            style={{
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              border: '1px solid #334155',
              background: canvasBackgroundDraft.baseColor,
              flexShrink: 0,
            }}
          />
        </button>

        <button
          data-testid="canvas-background-save"
          disabled={!graphExists || isGraphActionInFlight}
          onClick={() => {
            void onSaveCanvasBackground();
          }}
          style={{
            width: '100%',
            padding: '7px 8px',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '11px',
            cursor: !graphExists || isGraphActionInFlight ? 'not-allowed' : 'pointer',
          }}
        >
          Save Background
        </button>
      </div>

      <div style={mutedSectionCardStyle}>
        <div style={sectionTitleStyle}>Connection Strokes</div>

        <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
          Foreground color
        </label>
        <button
          data-testid="connection-stroke-foreground-color-input"
          type="button"
          disabled={!graphExists || isGraphActionInFlight}
          onClick={() => onOpenConnectionStrokeColorDialog('foreground')}
          style={{
            width: '100%',
            height: '34px',
            marginBottom: '8px',
            padding: '6px 8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            boxSizing: 'border-box',
            background: '#ffffff',
            cursor: !graphExists || isGraphActionInFlight ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            color: '#0f172a',
            fontSize: '11px',
          }}
        >
          <span>Choose color</span>
          <span
            style={{
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              border: '1px solid #334155',
              background: connectionStrokeDraft.foregroundColor,
              flexShrink: 0,
            }}
          />
        </button>

        <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
          Background color
        </label>
        <button
          data-testid="connection-stroke-background-color-input"
          type="button"
          disabled={!graphExists || isGraphActionInFlight}
          onClick={() => onOpenConnectionStrokeColorDialog('background')}
          style={{
            width: '100%',
            height: '34px',
            marginBottom: '8px',
            padding: '6px 8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            boxSizing: 'border-box',
            background: '#ffffff',
            cursor: !graphExists || isGraphActionInFlight ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            color: '#0f172a',
            fontSize: '11px',
          }}
        >
          <span>Choose color</span>
          <span
            style={{
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              border: '1px solid #334155',
              background: connectionStrokeDraft.backgroundColor,
              flexShrink: 0,
            }}
          />
        </button>

        <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
          Foreground width
        </label>
        <input
          data-testid="connection-stroke-foreground-width-input"
          type="number"
          min={0.25}
          max={24}
          step={0.1}
          value={connectionStrokeDraft.foregroundWidth}
          disabled={!graphExists || isGraphActionInFlight}
          onChange={(event) => onConnectionStrokeForegroundWidthChange(event.target.value)}
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        />

        <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
          Background width
        </label>
        <input
          data-testid="connection-stroke-background-width-input"
          type="number"
          min={0.5}
          max={48}
          step={0.1}
          value={connectionStrokeDraft.backgroundWidth}
          disabled={!graphExists || isGraphActionInFlight}
          onChange={(event) => onConnectionStrokeBackgroundWidthChange(event.target.value)}
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '4px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ marginBottom: '8px', fontSize: '10px', color: '#64748b' }}>
          Background width stays 2x foreground width.
        </div>

        <button
          data-testid="connection-stroke-save"
          disabled={!graphExists || isGraphActionInFlight}
          onClick={() => {
            void onSaveConnectionStroke();
          }}
          style={{
            width: '100%',
            padding: '7px 8px',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '11px',
            cursor: !graphExists || isGraphActionInFlight ? 'not-allowed' : 'pointer',
          }}
        >
          Save Connection Strokes
        </button>
      </div>
    </>
  );
}

export default GraphPanelAppearanceSection;

