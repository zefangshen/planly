import { useState, useRef, useEffect } from 'react';

interface Props {
  onAdd: (title: string) => Promise<void>;
  onCancel: () => void;
}

export function AddColumnForm({ onAdd, onCancel }: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const v = value.trim();
    if (!v) { onCancel(); return; }
    await onAdd(v);
  };

  return (
    <div className="add-column-form">
      <input
        ref={inputRef}
        type="text"
        placeholder="Enter column title..."
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="form-actions">
        <button className="save" onClick={submit}>Add Column</button>
        <button className="cancel" onClick={onCancel}>✕</button>
      </div>
    </div>
  );
}
