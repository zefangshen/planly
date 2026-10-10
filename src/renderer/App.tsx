import { useState, useCallback, useMemo } from 'react';
import { Header } from './components/common/Header';
import { Board } from './features/board/components/Board';
import { CardModal } from './features/board/components/CardModal';
import { ArchivedView } from './features/archive/components/ArchivedView';
import { useTheme } from './hooks/useTheme';
import { useBoard } from './features/board/hooks/useBoard';
import { api } from './lib/api';
import { ALL_BOARD_ID, ALL_COLUMN_PREFIX } from '@shared/constants';
import type { Card as CardType, CardStatus } from '@shared/types/board';

const ACTIVE_VIEW_KEY = 'planly_active_view';

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const { boards, currentBoard, status, loadBoard, refresh, updateBoardLocally, setStatus } = useBoard();
  const [editingCard, setEditingCard] = useState<{ card: CardType; colId: string } | null>(null);
  // The virtual All board is always the first tab; ArchivedView keeps real boards only
  const tabs = useMemo(() => [{ id: ALL_BOARD_ID, title: 'All' }, ...boards], [boards]);
  const allMode = currentBoard?.id === ALL_BOARD_ID;
  const [view, setView] = useState<'board' | 'archived'>(
    () => (localStorage.getItem(ACTIVE_VIEW_KEY) as 'board' | 'archived') || 'board'
  );

  const onTabClick = useCallback((id: string) => {
    setView('board');
    localStorage.setItem(ACTIVE_VIEW_KEY, 'board');
    loadBoard(id);
  }, [loadBoard]);

  const onArchivedClick = useCallback(() => {
    setView('archived');
    localStorage.setItem(ACTIVE_VIEW_KEY, 'archived');
  }, []);

  const onRenameColumn = useCallback(async (id: string, title: string) => {
    // Optimistic update
    updateBoardLocally(b => ({
      ...b,
      columns: b.columns.map(c => c.id === id ? { ...c, title } : c),
    }));
    try {
      await api.renameColumn(id, title);
    } catch (e) {
      setStatus({ msg: 'Rename failed: ' + (e as Error).message, isError: true });
      await refresh();
    }
  }, [updateBoardLocally, setStatus, refresh]);

  const onDeleteColumn = useCallback(async (id: string) => {
    updateBoardLocally(b => ({
      ...b,
      columns: b.columns.filter(c => c.id !== id),
    }));
    try {
      await api.deleteColumn(id);
    } catch (e) {
      setStatus({ msg: 'Delete column failed: ' + (e as Error).message, isError: true });
      await refresh();
    }
  }, [updateBoardLocally, setStatus, refresh]);

  const onAddColumn = useCallback(async (boardId: string, title: string) => {
    try {
      const newCol = await api.createColumn(boardId, title);
      updateBoardLocally(b => ({
        ...b,
        columns: [...b.columns, newCol],
      }));
    } catch (e) {
      setStatus({ msg: 'Add column failed: ' + (e as Error).message, isError: true });
    }
  }, [updateBoardLocally, setStatus]);

  const onAddCard = useCallback(async (colId: string, title: string) => {
    try {
      const newCard = await api.createCard(colId, { title });
      updateBoardLocally(b => ({
        ...b,
        columns: b.columns.map(c =>
          c.id === colId ? { ...c, cards: [...c.cards, newCard] } : c
        ),
      }));
    } catch (e) {
      setStatus({ msg: 'Add card failed: ' + (e as Error).message, isError: true });
    }
  }, [updateBoardLocally, setStatus]);

  const onCardClick = useCallback((cardId: string, colId: string) => {
    if (!currentBoard) return;
    for (const col of currentBoard.columns) {
      const card = col.cards.find(c => c.id === cardId);
      if (card) {
        setEditingCard({ card, colId });
        return;
      }
    }
  }, [currentBoard]);

  const onMoveCard = useCallback(async (cardId: string, toColId: string, beforeCardId: string | null) => {
    // Optimistic update
    updateBoardLocally(b => {
      let movedCard: CardType | null = null;
      const newCols = b.columns.map(c => {
        const idx = c.cards.findIndex(card => card.id === cardId);
        if (idx !== -1) {
          movedCard = c.cards[idx];
          return { ...c, cards: c.cards.filter(card => card.id !== cardId) };
        }
        return c;
      });
      if (!movedCard) return b;
      return {
        ...b,
        columns: newCols.map(c => {
          if (c.id !== toColId) return c;
          if (!beforeCardId) {
            return { ...c, cards: [...c.cards, movedCard as CardType] };
          }
          const idx = c.cards.findIndex(card => card.id === beforeCardId);
          if (idx === -1) return { ...c, cards: [...c.cards, movedCard as CardType] };
          const cards = [...c.cards];
          cards.splice(idx, 0, movedCard as CardType);
          return { ...c, cards };
        }),
      };
    });
    try {
      if (toColId.startsWith(ALL_COLUMN_PREFIX)) {
        // Virtual All board: free ordering; cross-bucket moves also sync the
        // card onto its home board's matching status column
        const status = toColId.slice(ALL_COLUMN_PREFIX.length) as CardStatus;
        await api.moveAllCard(cardId, status, beforeCardId);
        // Reconcile authoritative positions (home-board side effects, anchors)
        await refresh();
      } else {
        await api.moveCard(cardId, toColId, beforeCardId);
      }
    } catch (e) {
      setStatus({ msg: 'Move failed: ' + (e as Error).message, isError: true });
      await refresh();
    }
  }, [updateBoardLocally, setStatus, refresh]);

  const onMoveColumn = useCallback(async (colId: string, beforeColumnId: string | null) => {
    // Optimistic update — reorder columns locally
    updateBoardLocally(b => {
      const cols = [...b.columns];
      const idx = cols.findIndex(c => c.id === colId);
      if (idx === -1) return b;
      const [moved] = cols.splice(idx, 1);
      let insertIdx = cols.length;
      if (beforeColumnId) {
        const bi = cols.findIndex(c => c.id === beforeColumnId);
        if (bi !== -1) insertIdx = bi;
      }
      cols.splice(insertIdx, 0, moved);
      return { ...b, columns: cols };
    });
    try {
      await api.moveColumn(colId, beforeColumnId);
    } catch (e) {
      setStatus({ msg: 'Move column failed: ' + (e as Error).message, isError: true });
      await refresh();
    }
  }, [updateBoardLocally, setStatus, refresh]);

  const onCardSave = useCallback(async (data: Partial<CardType>) => {
    if (!editingCard) return;
    try {
      await api.updateCard(editingCard.card.id, data);
      setEditingCard(null);
      await refresh();
    } catch (e) {
      setStatus({ msg: 'Save failed: ' + (e as Error).message, isError: true });
    }
  }, [editingCard, refresh, setStatus]);

  const onCardDelete = useCallback(async () => {
    if (!editingCard) return;
    try {
      await api.deleteCard(editingCard.card.id);
      setEditingCard(null);
      await refresh();
    } catch (e) {
      setStatus({ msg: 'Delete failed: ' + (e as Error).message, isError: true });
    }
  }, [editingCard, refresh, setStatus]);

  const onInlineSave = useCallback(async (cardId: string, data: { title: string; description: string }) => {
    // Optimistic update — update card text in the current board view immediately
    updateBoardLocally(b => ({
      ...b,
      columns: b.columns.map(c => ({
        ...c,
        cards: c.cards.map(card =>
          card.id === cardId ? { ...card, title: data.title, description: data.description } : card
        ),
      })),
    }));
    try {
      await api.updateCard(cardId, data);
      return true;
    } catch (e) {
      setStatus({ msg: 'Save failed: ' + (e as Error).message, isError: true });
      await refresh();
      return false;
    }
  }, [updateBoardLocally, setStatus, refresh]);

  const onArchiveCard = useCallback(async (cardId: string) => {
    updateBoardLocally(b => ({
      ...b,
      columns: b.columns.map(c => ({
        ...c,
        cards: c.cards.filter(card => card.id !== cardId),
      })),
    }));
    try {
      await api.archiveCard(cardId, true);
    } catch (e) {
      setStatus({ msg: 'Archive failed: ' + (e as Error).message, isError: true });
      await refresh();
    }
  }, [updateBoardLocally, setStatus, refresh]);

  const onArchiveAllCards = useCallback(async (colId: string) => {
    // Optimistic update — remove all cards from the column locally
    updateBoardLocally(b => ({
      ...b,
      columns: b.columns.map(c =>
        c.id === colId ? { ...c, cards: [] } : c
      ),
    }));
    try {
      const { archivedCount } = await api.archiveAllCards(colId);
      setStatus({ msg: `Archived ${archivedCount} card${archivedCount === 1 ? '' : 's'}`, isError: false });
    } catch (e) {
      setStatus({ msg: 'Archive all failed: ' + (e as Error).message, isError: true });
      await refresh();
    }
  }, [updateBoardLocally, setStatus, refresh]);

  return (
    <>
      <Header
        boards={tabs}
        currentBoardId={currentBoard?.id ?? null}
        onTabClick={onTabClick}
        onArchivedClick={onArchivedClick}
        isArchivedActive={view === 'archived'}
        theme={theme}
        onToggleTheme={toggleTheme}
        status={status}
      />
      {view === 'archived' ? (
        <ArchivedView boards={boards} />
      ) : currentBoard ? (
        <Board
          board={currentBoard}
          allMode={allMode}
          onRenameColumn={onRenameColumn}
          onDeleteColumn={onDeleteColumn}
          onAddColumn={onAddColumn}
          onAddCard={onAddCard}
          onCardClick={onCardClick}
          onMoveCard={onMoveCard}
          onMoveColumn={onMoveColumn}
          onArchiveCard={onArchiveCard}
          onArchiveAllCards={onArchiveAllCards}
          onInlineSave={onInlineSave}
        />
      ) : (
        <div style={{ padding: 40, color: 'var(--text-inverse)' }}>{status.msg}</div>
      )}
      {editingCard && (
        <CardModal
          card={editingCard.card}
          onSave={onCardSave}
          onDelete={onCardDelete}
          onClose={() => setEditingCard(null)}
        />
      )}
    </>
  );
}
