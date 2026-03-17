import { mutedSectionCardStyle, sectionTitleStyle } from './panelSectionStyles';

interface GraphPanelListSectionProps<Item> {
  title: string;
  selectLabel: string;
  addLabel: string;
  removeLabel: string;
  graphExists: boolean;
  isGraphActionInFlight: boolean;
  activeId: string;
  options: Item[];
  canRemoveActive: boolean;
  formatLabel: (item: Item) => string;
  getOptionId: (item: Item) => string;
  onSelect: (id: string) => void | Promise<void>;
  onAdd: () => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  dataTestPrefix: string;
  description?: string;
}

function GraphPanelListSection<Item>({
  title,
  selectLabel,
  addLabel,
  removeLabel,
  graphExists,
  isGraphActionInFlight,
  activeId,
  options,
  canRemoveActive,
  formatLabel,
  getOptionId,
  onSelect,
  onAdd,
  onRemove,
  dataTestPrefix,
  description,
}: GraphPanelListSectionProps<Item>) {
  const selectTestId = `${dataTestPrefix}-select`;
  const addTestId = `${dataTestPrefix}-add`;
  const removeTestId = `${dataTestPrefix}-remove`;

  return (
    <div style={mutedSectionCardStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      <label style={{ display: 'block', marginBottom: '6px', fontSize: '11px', color: '#475569' }}>
        {selectLabel}
      </label>
      <select
        data-testid={selectTestId}
        value={graphExists ? activeId : ''}
        disabled={!graphExists || isGraphActionInFlight}
        onChange={(event) => {
          void onSelect(event.target.value);
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
        {options.map((option) => {
          const optionId = getOptionId(option);
          return (
            <option key={optionId} value={optionId}>
              {formatLabel(option)}
            </option>
          );
        })}
      </select>
      {description && (
        <div style={{ marginBottom: '8px', fontSize: '10px', color: '#64748b' }}>{description}</div>
      )}
      <button
        data-testid={addTestId}
        disabled={!graphExists || isGraphActionInFlight}
        onClick={() => {
          void onAdd();
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
        {addLabel}
      </button>
      <button
        data-testid={removeTestId}
        disabled={!canRemoveActive}
        onClick={() => {
          void onRemove();
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
          cursor: canRemoveActive ? 'pointer' : 'not-allowed',
        }}
      >
        {removeLabel}
      </button>
    </div>
  );
}

export default GraphPanelListSection;
