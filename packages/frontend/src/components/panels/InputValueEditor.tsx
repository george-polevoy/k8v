import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { InputDefinition, type GraphCommand } from '../../types';

export type InputUpdates = Omit<Extract<GraphCommand, { kind: 'node_update_input' }>, 'kind' | 'nodeId' | 'inputName'>;

interface Props {
  input: InputDefinition;
  index: number;
  source?: string;
  onUpdate: (updates: InputUpdates) => Promise<void>;
}

function displayValue(input: InputDefinition): string {
  if (input.defaultValue === undefined) return '';
  if (input.schema.format === 'date-time' && typeof input.defaultValue === 'string') {
    const date = new Date(input.defaultValue);
    // datetime-local displays wall time; persist an ISO instant with an explicit timezone.
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
  }
  return String(input.defaultValue);
}

const fieldStyle = { width: '100%', boxSizing: 'border-box' as const, padding: '6px', border: '1px solid #cbd5e1', borderRadius: '4px' };

export default function InputValueEditor({ input, index, source, onUpdate }: Props) {
  const [draft, setDraft] = useState(() => displayValue(input));
  const [range, setRange] = useState(() => ({ min: String(input.editor?.min ?? 0), max: String(input.editor?.max ?? 100), step: String(input.editor?.step ?? 1) }));
  const [error, setError] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<InputUpdates | null>(null);
  const dirty = useRef(false);
  const checkbox = useRef<HTMLInputElement>(null);
  const savedValue = displayValue(input);
  const savedMin = String(input.editor?.min ?? 0);
  const savedMax = String(input.editor?.max ?? 100);
  const savedStep = String(input.editor?.step ?? 1);
  useEffect(() => {
    setDraft(savedValue);
    setRange({ min: savedMin, max: savedMax, step: savedStep });
    dirty.current = false;
    setError(null);
    setPendingType(null);
    // Preserve drafts across unrelated graph/runtime updates.
  }, [savedValue, savedMin, savedMax, savedStep, input.schema.type, input.schema.format]);
  useEffect(() => {
    if (checkbox.current) checkbox.current.indeterminate = input.defaultValue === undefined;
  }, [input.defaultValue, input.schema.type]);

  const commit = async (updates: InputUpdates): Promise<boolean> => {
    const candidate = { ...input, ...updates };
    if (updates.clearDefaultValue) delete candidate.defaultValue;
    if (updates.editor === null) delete candidate.editor;
    const parsed = InputDefinition.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return false;
    }
    setError(null);
    setPendingType(null);
    // A later edit must stay dirty while an earlier save is still in flight.
    dirty.current = false;
    try {
      await onUpdate(updates);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };

  const changeType = (type: string) => {
    const schema = type === 'date-time' ? { type: 'string' as const, format: 'date-time' as const }
      : { type: type as 'any' | 'number' | 'string' | 'boolean' };
    const currentNumber = typeof input.defaultValue === 'number' ? input.defaultValue : 0;
    const editor = type === 'number'
      ? { min: Math.min(0, currentNumber), max: Math.max(100, currentNumber + 1), step: 1 }
      : null;
    const updates: InputUpdates = { schema, editor };
    const candidate = { ...input, schema, editor: editor ?? undefined };
    if (!InputDefinition.safeParse(candidate).success) {
      setPendingType(updates);
      setError('The saved value is incompatible. Clear it to change the type.');
      return;
    }
    void commit(updates);
  };

  const commitValue = (value: string) => {
    if (!dirty.current || source) return;
    if (input.schema.type === 'number') {
      if (value.trim() === '') {
        void commit({ clearDefaultValue: true });
      } else {
        void commit({ defaultValue: Number(value) });
      }
    } else if (input.schema.format === 'date-time') {
      const date = new Date(value);
      if (!value) void commit({ clearDefaultValue: true });
      else if (Number.isFinite(date.getTime())) void commit({ defaultValue: date.toISOString() });
      else setError('Choose a valid date and time.');
    } else {
      void commit({ defaultValue: value });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      dirty.current = false;
      setDraft(displayValue(input));
      setRange({ min: String(input.editor?.min ?? 0), max: String(input.editor?.max ?? 100), step: String(input.editor?.step ?? 1) });
      setError(null);
      setPendingType(null);
      event.currentTarget.blur();
    }
  };
  const type = input.schema.format === 'date-time' ? 'date-time' : input.schema.type;
  const hasControl = type === 'number' || type === 'string' || type === 'date-time' || type === 'boolean';
  const min = Number(range.min);
  const max = Number(range.max);
  const step = Number(range.step);
  const sliderAvailable = Number.isFinite(min) && Number.isFinite(max) && max > min && Number.isFinite(step) && step > 0;

  return <div style={{ gridColumn: '1 / -1', fontSize: '11px', display: 'grid', gap: '6px' }}>
    <label>Type
      <select aria-label={`Type for ${input.name}`} data-testid={`input-type-${index}`} value={type} onChange={(event) => changeType(event.target.value)} style={fieldStyle}>
        <option value="any">Not specified</option>
        <option value="number">Numeric</option>
        <option value="string">Text</option>
        <option value="date-time">Date-time</option>
        <option value="boolean">Boolean</option>
        {['object', 'array', 'null'].includes(type) && <option value={type}>{type === 'object' ? 'Not specified (legacy)' : type}</option>}
      </select>
    </label>
    {source && <div data-testid={`input-source-${index}`} style={{ color: '#64748b' }}>From {source}. Local value is retained for use after disconnecting.</div>}
    {hasControl && <fieldset disabled={Boolean(source)} style={{ margin: 0, padding: 0, border: 0, minWidth: 0 }}>
      <legend style={{ padding: 0, marginBottom: '4px' }}>Local value {input.defaultValue === undefined ? '(not set)' : ''}</legend>
      {type === 'boolean' ? <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input ref={checkbox} data-testid={`input-value-${index}`} aria-label={`Value for ${input.name}`} type="checkbox" checked={input.defaultValue === true} onChange={(event) => { void commit({ defaultValue: event.target.checked }); }} />
        {input.defaultValue === undefined ? 'Not set' : String(input.defaultValue)}
      </label> : <input
        data-testid={`input-value-${index}`}
        aria-label={`Value for ${input.name}`}
        type={type === 'number' ? 'number' : type === 'date-time' ? 'datetime-local' : 'text'}
        step={type === 'date-time' ? '0.001' : input.editor?.step ?? 'any'}
        min={type === 'number' ? input.editor?.min : undefined}
        max={type === 'number' ? input.editor?.max : undefined}
        value={draft}
        onInput={(event) => { dirty.current = true; setDraft(event.currentTarget.value); }}
        onChange={(event) => { dirty.current = true; setDraft(event.target.value); }}
        onBlur={(event) => commitValue(event.target.value)}
        onKeyDown={onKeyDown}
        style={fieldStyle}
      />}
      {type === 'number' && sliderAvailable && <input
        aria-label={`Slider for ${input.name}`}
        data-testid={`input-slider-${index}`}
        type="range" min={min} max={max} step={step}
        value={draft === '' ? min : Number(draft)}
        onChange={(event) => { dirty.current = true; setDraft(event.target.value); }}
        onPointerUp={(event) => commitValue(event.currentTarget.value)}
        onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commitValue(event.currentTarget.value); }}
        onBlur={(event) => commitValue(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        style={{ width: '100%' }}
      />}
    </fieldset>}
    {type === 'date-time' && <div style={{ color: '#64748b' }}>Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Saved as UTC ISO 8601.</div>}
    {type === 'number' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
      {(['min', 'max', 'step'] as const).map((field) => <label key={field}>{field}
        <input data-testid={`input-${field}-${index}`} aria-label={`${field} for ${input.name}`} type="number" step="any" value={range[field]}
          onChange={(event) => { dirty.current = true; setRange((current) => ({ ...current, [field]: event.target.value })); }}
          onBlur={() => {
            if (!dirty.current) return;
            if (Object.values(range).some((value) => value.trim() === '')) { setError('Enter min, max and step.'); return; }
            void commit({ editor: { min, max, step } });
          }} onKeyDown={onKeyDown} style={fieldStyle} />
      </label>)}
    </div>}
    {input.defaultValue !== undefined && <button data-testid={`input-clear-${index}`} disabled={Boolean(source)} onClick={() => { void commit({ clearDefaultValue: true }); }}>Clear local value</button>}
    {error && <div role="alert" style={{ color: '#b91c1c' }}>{error}</div>}
    {pendingType && <button data-testid={`input-confirm-type-${index}`} onClick={() => { void commit({ ...pendingType, clearDefaultValue: true }); }}>Clear value and change type</button>}
  </div>;
}
