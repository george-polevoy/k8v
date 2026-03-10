import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  colorWithOpacityToCss,
  normalizeColorWithOpacity,
  normalizeHexColor,
  serializeColorWithOpacity,
} from '../utils/color';

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
  allowOpacity?: boolean;
  confirmLabel?: string;
  description?: string;
  onCancel: () => void;
  onConfirm: (color: string) => void;
}

interface RgbChannels {
  r: number;
  g: number;
  b: number;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(255, Math.max(0, Math.round(value)));
}

function hexToRgbChannels(hex: string): RgbChannels {
  const normalizedHex = normalizeHexColor(hex, '#000000');
  return {
    r: Number.parseInt(normalizedHex.slice(1, 3), 16),
    g: Number.parseInt(normalizedHex.slice(3, 5), 16),
    b: Number.parseInt(normalizedHex.slice(5, 7), 16),
  };
}

function rgbChannelsToHex(channels: RgbChannels): string {
  const channel = (value: number) => clampChannel(value).toString(16).padStart(2, '0');
  return `#${channel(channels.r)}${channel(channels.g)}${channel(channels.b)}`;
}

function channelToPercent(channel: number): number {
  return clampPercent((clampChannel(channel) / 255) * 100);
}

function percentToChannel(percent: number): number {
  return clampChannel((clampPercent(percent) / 100) * 255);
}

function ColorSelectionDialog({
  open,
  title,
  initialColor,
  defaultColor = '#ffffff',
  presetColors = DEFAULT_PRESET_COLORS,
  allowOpacity = false,
  confirmLabel = 'Apply',
  description,
  onCancel,
  onConfirm,
}: ColorSelectionDialogProps) {
  const initialParsedColor = normalizeColorWithOpacity(initialColor, defaultColor);
  const initialRgb = hexToRgbChannels(initialParsedColor.hex);
  const [draftColor, setDraftColor] = useState(() => initialParsedColor.hex);
  const [draftOpacity, setDraftOpacity] = useState(() => initialParsedColor.alpha);
  const [draftRedPercent, setDraftRedPercent] = useState(() => channelToPercent(initialRgb.r));
  const [draftGreenPercent, setDraftGreenPercent] = useState(() => channelToPercent(initialRgb.g));
  const [draftBluePercent, setDraftBluePercent] = useState(() => channelToPercent(initialRgb.b));

  useEffect(() => {
    if (!open) {
      return;
    }
    const parsed = normalizeColorWithOpacity(initialColor, defaultColor);
    const parsedRgb = hexToRgbChannels(parsed.hex);
    setDraftColor(parsed.hex);
    setDraftOpacity(parsed.alpha);
    setDraftRedPercent(channelToPercent(parsedRgb.r));
    setDraftGreenPercent(channelToPercent(parsedRgb.g));
    setDraftBluePercent(channelToPercent(parsedRgb.b));
  }, [defaultColor, initialColor, open]);

  const applyRgbPercents = (nextRed: number, nextGreen: number, nextBlue: number) => {
    const normalizedRed = clampPercent(nextRed);
    const normalizedGreen = clampPercent(nextGreen);
    const normalizedBlue = clampPercent(nextBlue);
    setDraftRedPercent(normalizedRed);
    setDraftGreenPercent(normalizedGreen);
    setDraftBluePercent(normalizedBlue);
    setDraftColor(
      rgbChannelsToHex({
        r: percentToChannel(normalizedRed),
        g: percentToChannel(normalizedGreen),
        b: percentToChannel(normalizedBlue),
      })
    );
  };

  if (!open) {
    return null;
  }

  const dialog = (
    <div
      data-testid="color-selection-dialog-overlay"
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
        data-testid="color-selection-dialog"
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
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              border: '1px solid #334155',
              background: allowOpacity
                ? colorWithOpacityToCss({ hex: draftColor, alpha: draftOpacity })
                : draftColor,
              flexShrink: 0,
            }}
          />
          <div style={{ fontSize: '11px', color: '#475569' }}>Preview</div>
        </div>
        <div style={{ marginBottom: '12px', display: 'grid', gap: '8px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: '#475569' }}>
            Red: {draftRedPercent}%
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={draftRedPercent}
              onChange={(event) => {
                const nextRed = Number.parseInt(event.target.value, 10);
                applyRgbPercents(nextRed, draftGreenPercent, draftBluePercent);
              }}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ display: 'block', fontSize: '11px', color: '#475569' }}>
            Green: {draftGreenPercent}%
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={draftGreenPercent}
              onChange={(event) => {
                const nextGreen = Number.parseInt(event.target.value, 10);
                applyRgbPercents(draftRedPercent, nextGreen, draftBluePercent);
              }}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ display: 'block', fontSize: '11px', color: '#475569' }}>
            Blue: {draftBluePercent}%
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={draftBluePercent}
              onChange={(event) => {
                const nextBlue = Number.parseInt(event.target.value, 10);
                applyRgbPercents(draftRedPercent, draftGreenPercent, nextBlue);
              }}
              style={{ width: '100%' }}
            />
          </label>
        </div>
        {allowOpacity && (
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '11px', color: '#475569', marginBottom: '4px' }}>
              Opacity: {Math.round(draftOpacity * 100)}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(draftOpacity * 100)}
              onChange={(event) => {
                const nextOpacity = Math.min(100, Math.max(0, Number.parseInt(event.target.value, 10))) / 100;
                setDraftOpacity(nextOpacity);
              }}
              style={{ width: '100%' }}
            />
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '6px', marginBottom: '12px' }}>
          {presetColors.map((preset, index) => {
            const normalizedPreset = normalizeHexColor(preset, defaultColor);
            return (
              <button
                key={normalizedPreset}
                data-testid={`color-preset-${index}`}
                data-color={normalizedPreset}
                type="button"
                onClick={() => {
                  const presetRgb = hexToRgbChannels(normalizedPreset);
                  setDraftColor(normalizedPreset);
                  setDraftRedPercent(channelToPercent(presetRgb.r));
                  setDraftGreenPercent(channelToPercent(presetRgb.g));
                  setDraftBluePercent(channelToPercent(presetRgb.b));
                }}
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
              if (allowOpacity) {
                onConfirm(serializeColorWithOpacity({ hex: normalized, alpha: draftOpacity }, true));
                return;
              }
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

  return createPortal(dialog, document.body);
}

export default ColorSelectionDialog;
