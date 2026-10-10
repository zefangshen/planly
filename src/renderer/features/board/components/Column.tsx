import { useState, useRef, useEffect } from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { Card } from './Card';
import { AddCardForm } from './AddCardForm';
import type { Column as ColumnType } from '@shared/types/board';

interface Props {
  col: ColumnType;
  index: number;
  /** Read-only columns (virtual All board) can't be dragged, renamed, deleted, or receive new cards. */
  readOnly?: boolean;
  /** Show the kebab menu's "Archive all cards" action even on read-only columns (All board Done column). */
  canArchiveAll?: boolean;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAddCard: (colId: string, title: string) => Promise<void>;
  onCardClick: (cardId: string, colId: string) => void;
  onArchiveCard: (cardId: string) => void;
  onArchiveAllCards: (colId: string) => void;
  onInlineSave: (cardId: string, data: { title: string; description: string }) => Promise<boolean>;
}

export function Column({ col, index, readOnly = false, canArchiveAll = false, onRename, onDelete, onAddCard, onCardClick, onArchiveCard, onArchiveAllCards, onInlineSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(col.title);
  const [showAddCard, setShowAddCard] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmArchiveAll, setConfirmArchiveAll] = useState(false);
  const titleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing && titleRef.current) {
      titleRef.current.focus();
      const range = document.createRange();
      range.selectNodeContents(titleRef.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [editing]);

  const finishEdit = async () => {
    const v = title.trim();
    setEditing(false);
    if (!v || v === col.title) {
      setTitle(col.title);
      return;
    }
    await onRename(col.id, v);
  };

  return (
    <Draggable draggableId={col.id} index={index} isDragDisabled={readOnly}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`column ${readOnly ? 'read-only' : ''} ${snapshot.isDragging ? 'dragging' : ''}`}
          style={provided.draggableProps.style}
        >
          <div className="column-header" {...(readOnly ? {} : provided.dragHandleProps)}>
            <div
              ref={titleRef}
              className={`column-title ${editing ? 'editing' : ''}`}
              contentEditable={editing && !readOnly}
              suppressContentEditableWarning
              onDoubleClick={e => {
                if (readOnly) return;
                e.stopPropagation();
                setEditing(true);
              }}
              onBlur={finishEdit}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); }
                if (e.key === 'Escape') { setTitle(col.title); setEditing(false); (e.target as HTMLElement).blur(); }
              }}
              onInput={e => setTitle((e.target as HTMLElement).textContent || '')}
              title={readOnly ? undefined : 'Double-click to rename'}
            >
              {col.title}
            </div>
            <span className="column-count">{col.cards.length}</span>
            {(!readOnly || canArchiveAll) && (
              <button
                className="column-menu"
                title="Column actions"
                onClick={e => {
                  e.stopPropagation();
                  setShowMenu(true);
                }}
              >
                ⋯
              </button>
            )}
          </div>
          <Droppable droppableId={col.id} type="card" direction="vertical">
            {(dropProvided, dropSnapshot) => (
              <div
                ref={dropProvided.innerRef}
                {...dropProvided.droppableProps}
                className={`card-list scrollbar ${dropSnapshot.isDraggingOver ? 'dragging-over' : ''}`}
              >
                {col.cards.map((card, idx) => (
                  <Card
                    key={card.id}
                    card={card}
                    colId={col.id}
                    index={idx}
                    onClick={() => onCardClick(card.id, col.id)}
                    onArchive={onArchiveCard}
                    onInlineSave={onInlineSave}
                  />
                ))}
                {dropProvided.placeholder}
              </div>
            )}
          </Droppable>
          {!readOnly && (
            showAddCard ? (
              <AddCardForm
                onAdd={async (t) => { await onAddCard(col.id, t); setShowAddCard(false); }}
                onCancel={() => setShowAddCard(false)}
              />
            ) : (
              <button className="add-card-btn" onClick={e => { e.stopPropagation(); setShowAddCard(true); }}>
                <span>+</span> Add a card
              </button>
            )
          )}
          {showMenu && !confirmDelete && !confirmArchiveAll && (
            <>
              <div className="context-menu-overlay" onClick={() => setShowMenu(false)} />
              <div className="column-menu-dropdown" onClick={e => e.stopPropagation()}>
                <button
                  className="context-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmArchiveAll(true);
                  }}
                  disabled={col.cards.length === 0}
                >
                  Archive all cards
                </button>
                {!readOnly && (
                  <button
                    className="context-menu-item danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(true);
                    }}
                  >
                    Delete column
                  </button>
                )}
              </div>
            </>
          )}
          {confirmArchiveAll && (
            <>
              <div className="context-menu-overlay" onClick={() => { setConfirmArchiveAll(false); setShowMenu(false); }} />
              <div className="column-menu-dropdown confirm-delete" onClick={e => e.stopPropagation()}>
                <div className="confirm-delete-text">
                  Archive all {col.cards.length} {col.cards.length === 1 ? 'card' : 'cards'} in "{col.title}"?
                  They can be restored from the Archived view.
                </div>
                <button
                  className="context-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmArchiveAll(false);
                    setShowMenu(false);
                    onArchiveAllCards(col.id);
                  }}
                >
                  Yes, archive all
                </button>
                <button
                  className="context-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmArchiveAll(false);
                    setShowMenu(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
          {confirmDelete && (
            <>
              <div className="context-menu-overlay" onClick={() => { setConfirmDelete(false); setShowMenu(false); }} />
              <div className="column-menu-dropdown confirm-delete" onClick={e => e.stopPropagation()}>
                <div className="confirm-delete-text">
                  Delete "{col.title}" and all its cards?
                </div>
                <button
                  className="context-menu-item danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(false);
                    setShowMenu(false);
                    onDelete(col.id);
                  }}
                >
                  Yes, delete
                </button>
                <button
                  className="context-menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(false);
                    setShowMenu(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Draggable>
  );
}
