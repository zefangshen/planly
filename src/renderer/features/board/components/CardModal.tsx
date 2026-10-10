import { useState, useEffect } from 'react';
import { LABEL_COLORS } from '@shared/constants';
import type { Card } from '@shared/types/board';

interface Props {
  card: Card;
  onSave: (data: Partial<Card>) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

export function CardModal({ card, onSave, onDelete, onClose }: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || '');
  const [dueDate, setDueDate] = useState(card.dueDate || '');
  const [labels, setLabels] = useState<number[]>(card.labels || []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggleLabel = (idx: number) => {
    setLabels(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const handleSave = async () => {
    await onSave({
      title: title.trim(),
      description: description.trim(),
      dueDate,
      labels,
    });
  };

  return (
    <div className="modal-overlay active" onClick={e => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="modal scrollbar">
        <h2>Edit Card</h2>
        <label>Title</label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} />
        <label>Description</label>
        <textarea className="scrollbar" value={description} onChange={e => setDescription(e.target.value)} />
        <label>Due Date</label>
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        <label>Labels</label>
        <div className="label-picker">
          {LABEL_COLORS.map((lc, i) => (
            <div
              key={i}
              className={`label-chip ${labels.includes(i) ? 'selected' : ''}`}
              style={{ background: lc.color }}
              title={lc.name}
              onClick={() => toggleLabel(i)}
            >
              {lc.name}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="delete" onClick={onDelete}>Delete Card</button>
          <div className="left">
            <button className="save" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
