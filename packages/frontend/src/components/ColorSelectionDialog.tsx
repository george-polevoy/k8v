import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  colorWithOpacityToCss,
  hexToRgbChannels,
  hsvToRgbChannels,
  normalizeColorWithOpacity,
  normalizeHexColor,
  rgbChannelsToHex,
  rgbChannelsToHsv,
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

interface ColorDraftState {
  color: string;
  redPercent: number;
  greenPercent: number;
  bluePercent: number;
  hueDegrees: number;
  saturationPercent: number;
  valuePercent: number;
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

function clampHueDegrees(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(360, Math.max(0, Math.round(value)));
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function channelToPercent(channel: number): number {
  return clampPercent((clampChannel(channel) / 255) * 100);
}

function percentToChannel(percent: number): number {
  return clampChannel((clampPercent(percent) / 100) * 255);
}

function buildColorDraftState(color: string, fallbackHueDegrees?: number): ColorDraftState {
  const normalizedColor = normalizeHexColor(color, '#ffffff');
  const rgb = hexToRgbChannels(normalizedColor);
  const hsv = rgbChannelsToHsv(rgb);
  const hueDegrees = (hsv.s <= 0.0001 || hsv.v <= 0.0001) && Number.isFinite(fallbackHueDegrees)
    ? clampHueDegrees(fallbackHueDegrees as number)
    : clampHueDegrees(hsv.h);

  return {
    color: normalizedColor,
    redPercent: channelToPercent(rgb.r),
    greenPercent: channelToPercent(rgb.g),
    bluePercent: channelToPercent(rgb.b),
    hueDegrees,
    saturationPercent: clampPercent(hsv.s * 100),
    valuePercent: clampPercent(hsv.v * 100),
  };
}

function resolveRelativePointerPosition(
  event: ReactPointerEvent<HTMLDivElement>
): { xRatio: number; yRatio: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    xRatio: clampRatio((event.clientX - bounds.left) / Math.max(bounds.width, 1)),
    yRatio: clampRatio((event.clientY - bounds.top) / Math.max(bounds.height, 1)),
  };
}

function isPrimaryPointerDrag(event: ReactPointerEvent<HTMLDivElement>): boolean {
  return event.buttons === 1 || event.currentTarget.hasPointerCapture(event.pointerId);
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
  const [draftState, setDraftState] = useState(() => buildColorDraftState(initialParsedColor.hex));
  const [draftOpacity, setDraftOpacity] = useState(() => initialParsedColor.alpha);

  useEffect(() => {
    if (!open) {
      return;
    }
    const parsed = normalizeColorWithOpacity(initialColor, defaultColor);
    setDraftState(buildColorDraftState(parsed.hex));
    setDraftOpacity(parsed.alpha);
  }, [defaultColor, initialColor, open]);

  const applyHexColor = (nextColor: string, fallbackHueDegrees = draftState.hueDegrees) => {
    setDraftState(buildColorDraftState(nextColor, fallbackHueDegrees));
  };

  const applyRgbPercents = (nextRed: number, nextGreen: number, nextBlue: number) => {
    const normalizedRed = clampPercent(nextRed);
    const normalizedGreen = clampPercent(nextGreen);
    const normalizedBlue = clampPercent(nextBlue);
    applyHexColor(
      rgbChannelsToHex({
        r: percentToChannel(normalizedRed),
        g: percentToChannel(normalizedGreen),
        b: percentToChannel(normalizedBlue),
      }),
      draftState.hueDegrees
    );
  };

  const applyHsv = (
    nextHueDegrees: number,
    nextSaturationPercent: number,
    nextValuePercent: number
  ) => {
    const normalizedHueDegrees = clampHueDegrees(nextHueDegrees);
    const normalizedSaturationPercent = clampPercent(nextSaturationPercent);
    const normalizedValuePercent = clampPercent(nextValuePercent);
    applyHexColor(
      rgbChannelsToHex(
        hsvToRgbChannels({
          h: normalizedHueDegrees,
          s: normalizedSaturationPercent / 100,
          v: normalizedValuePercent / 100,
        })
      ),
      normalizedHueDegrees
    );
  };

  const updateSaturationValueFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { xRatio, yRatio } = resolveRelativePointerPosition(event);
    applyHsv(draftState.hueDegrees, xRatio * 100, (1 - yRatio) * 100);
  };

  const updateHueFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { xRatio } = resolveRelativePointerPosition(event);
    applyHsv(xRatio * 360, draftState.saturationPercent, draftState.valuePercent);
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
        data-current-color={draftState.color}
        data-current-alpha={draftOpacity}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(380px, 100%)',
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
                ? colorWithOpacityToCss({ hex: draftState.color, alpha: draftOpacity })
                : draftState.color,
              flexShrink: 0,
            }}
          />
          <div style={{ fontSize: '11px', color: '#475569' }}>Preview</div>
        </div>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: '#475569', marginBottom: '6px' }}>
            Saturation / Value
          </div>
          <div
            data-testid="color-selection-sv-picker"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              updateSaturationValueFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (!isPrimaryPointerDrag(event)) {
                return;
              }
              updateSaturationValueFromPointer(event);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            style={{
              position: 'relative',
              width: '100%',
              height: '168px',
              borderRadius: '10px',
              border: '1px solid #cbd5e1',
              background: `linear-gradient(to top, #000000, transparent), linear-gradient(to right, #ffffff, hsl(${draftState.hueDegrees}, 100%, 50%))`,
              cursor: 'crosshair',
              touchAction: 'none',
              userSelect: 'none',
              marginBottom: '8px',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: `${draftState.saturationPercent}%`,
                top: `${100 - draftState.valuePercent}%`,
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                border: '2px solid #ffffff',
                boxShadow: '0 0 0 1px rgba(15, 23, 42, 0.5)',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
            />
          </div>
          <div style={{ fontSize: '11px', color: '#475569', marginBottom: '6px' }}>
            Hue: {draftState.hueDegrees}°
          </div>
          <div
            data-testid="color-selection-hue-slider"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              updateHueFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (!isPrimaryPointerDrag(event)) {
                return;
              }
              updateHueFromPointer(event);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            style={{
              position: 'relative',
              width: '100%',
              height: '14px',
              borderRadius: '999px',
              border: '1px solid #cbd5e1',
              background: 'linear-gradient(to right, #ff0000 0%, #ffff00 16.6%, #00ff00 33.3%, #00ffff 50%, #0000ff 66.6%, #ff00ff 83.3%, #ff0000 100%)',
              cursor: 'pointer',
              touchAction: 'none',
              userSelect: 'none',
              marginBottom: '6px',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: `${(draftState.hueDegrees / 360) * 100}%`,
                top: '50%',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                border: '2px solid #ffffff',
                boxShadow: '0 0 0 1px rgba(15, 23, 42, 0.55)',
                background: '#ffffff',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b' }}>
            <span>Saturation: {draftState.saturationPercent}%</span>
            <span>Value: {draftState.valuePercent}%</span>
          </div>
        </div>
        <div style={{ marginBottom: '12px', display: 'grid', gap: '8px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: '#475569' }}>
            Red: {draftState.redPercent}%
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={draftState.redPercent}
              onChange={(event) => {
                const nextRed = Number.parseInt(event.target.value, 10);
                applyRgbPercents(nextRed, draftState.greenPercent, draftState.bluePercent);
              }}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ display: 'block', fontSize: '11px', color: '#475569' }}>
            Green: {draftState.greenPercent}%
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={draftState.greenPercent}
              onChange={(event) => {
                const nextGreen = Number.parseInt(event.target.value, 10);
                applyRgbPercents(draftState.redPercent, nextGreen, draftState.bluePercent);
              }}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ display: 'block', fontSize: '11px', color: '#475569' }}>
            Blue: {draftState.bluePercent}%
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={draftState.bluePercent}
              onChange={(event) => {
                const nextBlue = Number.parseInt(event.target.value, 10);
                applyRgbPercents(draftState.redPercent, draftState.greenPercent, nextBlue);
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
                onClick={() => applyHexColor(normalizedPreset)}
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  borderRadius: '6px',
                  border: draftState.color === normalizedPreset ? '2px solid #0f172a' : '1px solid #94a3b8',
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
              const normalized = normalizeHexColor(draftState.color, defaultColor);
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
