import { useState, useRef, useCallback } from 'react';
import { DragDropContext, Droppable, DropResult } from '@hello-pangea/dnd';
import { Column } from './Column';
import { AddColumnForm } from './AddColumnForm';
import { ALL_BOARD_ID, ALL_COLUMN_PREFIX } from '@shared/constants';
import type { BoardWithColumns } from '@shared/types/board';

interface Props {
  board: BoardWithColumns;
  /** Virtual All board: columns are read-only; cards can only move between status buckets. */
  allMode?: boolean;
  onRenameColumn: (id: string, title: string) => Promise<void>;
  onDeleteColumn: (id: string) => Promise<void>;
  onAddColumn: (boardId: string, title: string) => Promise<void>;
  onAddCard: (colId: string, title: string) => Promise<void>;
  onCardClick: (cardId: string, colId: string) => void;
  onMoveCard: (cardId: string, toColId: string, beforeCardId: string | null) => Promise<void>;
  onMoveColumn: (colId: string, beforeColumnId: string | null) => Promise<void>;
  onArchiveCard: (cardId: string) => void;
  onArchiveAllCards: (colId: string) => void;
  onInlineSave: (cardId: string, data: { title: string; description: string }) => Promise<boolean>;
}

export function Board({ board, allMode = false, onRenameColumn, onDeleteColumn, onAddColumn, onAddCard, onCardClick, onMoveCard, onMoveColumn, onArchiveCard, onArchiveAllCards, onInlineSave }: Props) {
  const [showAddColumn, setShowAddColumn] = useState(false);

  // Always have the latest board state in event handlers (avoids stale closures)
  const boardRef = useRef(board);
  boardRef.current = board;

  const onDragEnd = useCallback((result: DropResult) => {
    const { source, destination, type } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return;
    }

    if (type === 'column') {
      // Columns can't be reordered on the virtual All board
      if (allMode) return;
      // Column reorder
      const colId = result.draggableId;
      const cols = boardRef.current.columns;
      const oldIndex = cols.findIndex(c => c.id === colId);
      if (oldIndex === -1) return;

      // Build new order
      const newCols = Array.from(cols);
      const [moved] = newCols.splice(oldIndex, 1);
      newCols.splice(destination.index, 0, moved);

      // Compute beforeColumnId (the column that comes after the moved one)
      const beforeColumnId = newCols[destination.index + 1]?.id ?? null;
      onMoveColumn(colId, beforeColumnId);
      return;
    }

    if (type === 'card') {
      // Card move — within same column or across columns
      const cardId = result.draggableId;
      const fromColId = source.droppableId;
      const toColId = destination.droppableId;
      const fromCol = boardRef.current.columns.find(c => c.id === fromColId);
      const toCol = boardRef.current.columns.find(c => c.id === toColId);
      if (!fromCol || !toCol) return;

      // Build what the target column's cards will look like after the move
      let targetCards = [...toCol.cards];
      if (fromColId === toColId) {
        // Same column: remove the card from source.index first
        targetCards.splice(source.index, 1);
      }
      // The card at destination.index in this reduced array is the one
      // that the dropped card lands before → that's our beforeCardId.
      const beforeCard = targetCards[destination.index];
      const beforeCardId = beforeCard ? beforeCard.id : null;

      onMoveCard(cardId, toColId, beforeCardId);
    }
  }, [allMode, onMoveColumn, onMoveCard]);

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="board" type="column" direction="horizontal">
        {(provided) => (
          <div
            id="board"
            ref={provided.innerRef}
            {...provided.droppableProps}
          >
            {board.columns.map((col, index) => (
              <Column
                key={col.id}
                col={col}
                index={index}
                readOnly={allMode}
                // Only the All board's Done column offers bulk archive
                canArchiveAll={allMode && board.id === ALL_BOARD_ID && col.id === `${ALL_COLUMN_PREFIX}done`}
                onRename={onRenameColumn}
                onDelete={onDeleteColumn}
                onAddCard={onAddCard}
                onCardClick={onCardClick}
                onArchiveCard={onArchiveCard}
                onArchiveAllCards={onArchiveAllCards}
                onInlineSave={onInlineSave}
              />
            ))}
            {provided.placeholder}
            {!allMode && (
              <div id="add-column-wrapper">
                {showAddColumn ? (
                  <AddColumnForm
                    onAdd={async (t) => { await onAddColumn(board.id, t); setShowAddColumn(false); }}
                    onCancel={() => setShowAddColumn(false)}
                  />
                ) : (
                  <button className="add-column-btn" onClick={() => setShowAddColumn(true)}>
                    <span>+</span> Add another column
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
