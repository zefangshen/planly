import { useState, useRef, useEffect } from 'react';

interface Props {
  onAdd: (title: string) => Promise<void>;
  onCancel: () => void;
}

export function AddCardForm({ onAdd, onCancel }: Props) {
  const [value, setValue] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const submit = async () => {
    const v = value.trim();
    if (!v) { onCancel(); return; }
    await onAdd(v);
  };

  return (
    <div className="add-card-form">
      <textarea
        ref={taRef}
        className="scrollbar"
        placeholder="Enter a title for this card..."
        rows={3}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="form-actions">
        <button className="save" onClick={submit}>Add Card</button>
        <button className="cancel" onClick={onCancel}>✕</button>
      </div>
    </div>
  );
}
