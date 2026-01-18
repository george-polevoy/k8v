import React, { useState, useEffect, useRef } from 'react';

interface InputNameDialogProps {
  onSubmit: (name: string) => void;
  onCancel: () => void;
  existingNames: string[];
}

function InputNameDialog({ onSubmit, onCancel, existingNames }: InputNameDialogProps) {
  const [inputName, setInputName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus input on mount
    inputRef.current?.focus();
  }, []);

  const validateAndSubmit = () => {
    const trimmedName = inputName.trim();

    // Check if empty
    if (!trimmedName) {
      setError('Input name cannot be empty');
      return;
    }

    // Validate format
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedName)) {
      setError('Must start with letter/underscore, only letters, numbers, and underscores allowed');
      return;
    }

    // Check length
    if (trimmedName.length > 50) {
      setError('Input name must be 50 characters or less');
      return;
    }

    // Check for duplicates
    if (existingNames.includes(trimmedName)) {
      setError(`Input "${trimmedName}" already exists`);
      return;
    }

    // All validations passed
    onSubmit(trimmedName);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      validateAndSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <>
      {/* Overlay */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 9999,
        }}
        onClick={onCancel}
      />

      {/* Dialog */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'white',
          padding: '24px',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          zIndex: 10000,
          minWidth: '400px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px' }}>
          Name the new input
        </h3>

        <input
          ref={inputRef}
          type="text"
          value={inputName}
          onChange={(e) => {
            setInputName(e.target.value);
            setError(null); // Clear error on input change
          }}
          onKeyDown={handleKeyDown}
          placeholder="e.g., myInput, value1, dataSource"
          style={{
            width: '100%',
            padding: '8px',
            border: error ? '2px solid #d32f2f' : '1px solid #ddd',
            borderRadius: '4px',
            fontSize: '14px',
            marginBottom: '8px',
            boxSizing: 'border-box',
          }}
        />

        {error && (
          <div
            style={{
              color: '#d32f2f',
              fontSize: '12px',
              marginBottom: '16px',
              padding: '8px',
              background: '#ffebee',
              borderRadius: '4px',
              border: '1px solid #ffcdd2',
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            fontSize: '12px',
            color: '#666',
            marginBottom: '16px',
            lineHeight: '1.4',
          }}
        >
          Must start with a letter or underscore. Only letters, numbers, and underscores allowed.
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              background: '#f5f5f5',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Cancel
          </button>
          <button
            onClick={validateAndSubmit}
            style={{
              padding: '8px 16px',
              background: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Add Input
          </button>
        </div>
      </div>
    </>
  );
}

export default InputNameDialog;
