interface ColorFieldButtonProps {
  color: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  title?: string;
  minHeight?: string;
  fontSize?: string;
}

function ColorFieldButton({
  color,
  label,
  onClick,
  disabled = false,
  testId,
  title,
  minHeight = '34px',
  fontSize = '11px',
}: ColorFieldButtonProps) {
  return (
    <button
      data-testid={testId}
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      style={{
        width: '100%',
        minHeight,
        padding: '6px 8px',
        border: '1px solid #d1d5db',
        borderRadius: '4px',
        background: '#ffffff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        color: '#0f172a',
        fontSize,
      }}
    >
      <span>{label}</span>
      <span
        style={{
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          border: '1px solid #334155',
          background: color,
          flexShrink: 0,
        }}
      />
    </button>
  );
}

export default ColorFieldButton;
