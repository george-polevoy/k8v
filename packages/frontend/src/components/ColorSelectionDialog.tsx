import { useEffect, useState } from 'react';
import { normalizeHexColor } from '../utils/color';

const DEFAULT_PRESET_COLORS = [
  '#ffffff',
  '#000000',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
];

interface ColorSelectionDialogProps {
  open: boolean;
  title: string;
  initialColor: string;
  defaultColor?: string;
  presetColors?: string[];
  confirmLabel?: string;
  description?: string;
  onCancel: () => void;
  onConfirm: (color: string) => void;
}

function resolveTypedColor(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'white') {
    return '#ffffff';
  }
  if (trimmed === 'green') {
    return '#22c55e';
  }
  if (trimmed === 'red') {
    return '#ef4444';
  }
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function ColorSelectionDialog({
  open,
  title,
  initialColor,
  defaultColor = '#ffffff',
  presetColors = DEFAULT_PRESET_COLORS,
  confirmLabel = 'Apply',
  description,
  onCancel,
  onConfirm,
}: ColorSelectionDialogProps) {
  const [draftColor, setDraftColor] = useState(() => normalizeHexColor(initialColor, defaultColor));
  const [draftInput, setDraftInput] = useState(() => normalizeHexColor(initialColor, defaultColor));

  useEffect(() => {
    if (!open) {
      return;
    }
    const normalized = normalizeHexColor(initialColor, defaultColor);
    setDraftColor(normalized);
    setDraftInput(normalized);
  }, [defaultColor, initialColor, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
        padding: '12px',
      }}
      onClick={onCancel}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(340px, 100%)',
          background: '#ffffff',
          border: '1px solid #dbe4ef',
          borderRadius: '10px',
          boxShadow: '0 8px 28px rgba(15, 23, 42, 0.28)',
          padding: '14px',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>{title}</div>
        {description && (
          <div style={{ fontSize: '12px', color: '#475569', marginBottom: '10px', lineHeight: 1.35 }}>
            {description}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <input
            type="color"
            value={draftColor}
            onChange={(event) => {
              const normalized = normalizeHexColor(event.target.value, defaultColor);
              setDraftColor(normalized);
              setDraftInput(normalized);
            }}
            style={{
              width: '54px',
              height: '34px',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: 0,
              background: '#ffffff',
              cursor: 'pointer',
            }}
          />
          <input
            type="text"
            value={draftInput}
            onChange={(event) => {
              const nextText = event.target.value;
              setDraftInput(nextText);
              const typedColor = resolveTypedColor(nextText);
              if (typedColor) {
                setDraftColor(typedColor);
              }
            }}
            onBlur={() => {
              const normalized = normalizeHexColor(draftInput, draftColor);
              setDraftColor(normalized);
              setDraftInput(normalized);
            }}
            placeholder="#ffffff"
            spellCheck={false}
            style={{
              flex: 1,
              padding: '7px 8px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '12px',
              boxSizing: 'border-box',
            }}
          />
          <div
            title="Preview"
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              border: '1px solid #334155',
              background: draftColor,
              flexShrink: 0,
            }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '6px', marginBottom: '12px' }}>
          {presetColors.map((preset) => {
            const normalizedPreset = normalizeHexColor(preset, defaultColor);
            return (
              <button
                key={normalizedPreset}
                type="button"
                onClick={() => {
                  setDraftColor(normalizedPreset);
                  setDraftInput(normalizedPreset);
                }}
                title={normalizedPreset}
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  borderRadius: '6px',
                  border: draftColor === normalizedPreset ? '2px solid #0f172a' : '1px solid #94a3b8',
                  background: normalizedPreset,
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '7px 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              color: '#0f172a',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const normalized = normalizeHexColor(draftColor, defaultColor);
              onConfirm(normalized);
            }}
            style={{
              padding: '7px 10px',
              borderRadius: '6px',
              border: 'none',
              background: '#2563eb',
              color: '#ffffff',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ColorSelectionDialog;
