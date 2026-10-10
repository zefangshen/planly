import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '@renderer/lib/api';
import type { ArchivedCard } from '@shared/types/board';

interface Props {
  boards: { id: string; title: string }[];
}

export function ArchivedView({ boards }: Props) {
  const [cards, setCards] = useState<ArchivedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [boardFilter, setBoardFilter] = useState('all');
  const [sortNewest, setSortNewest] = useState(true);

  const loadCards = useCallback(async () => {
    try {
      const data = await api.getArchivedCards();
      setCards(data.cards);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const onRestore = useCallback(async (id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
    try {
      await api.restoreCard(id);
    } catch {
      await loadCards();
    }
  }, [loadCards]);

  const onDelete = useCallback(async (id: string) => {
    if (!window.confirm('Permanently delete this archived card? This cannot be undone.')) {
      return;
    }
    setCards(prev => prev.filter(c => c.id !== id));
    try {
      await api.deleteCard(id);
    } catch {
      await loadCards();
    }
  }, [loadCards]);

  const filtered = useMemo(() => {
    let result = cards;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(c => c.title.toLowerCase().includes(q));
    }
    if (boardFilter !== 'all') {
      result = result.filter(c => c.boardId === boardFilter);
    }
    const sorted = [...result].sort((a, b) => {
      const cmp = (a.archivedAt || '').localeCompare(b.archivedAt || '');
      return sortNewest ? -cmp : cmp;
    });
    return sorted;
  }, [cards, search, boardFilter, sortNewest]);

  const formatDate = (s: string) => {
    if (!s) return '—';
    try {
      return new Date(s.replace(' ', 'T') + 'Z').toLocaleString();
    } catch {
      return s;
    }
  };

  return (
    <div className="archived-view scrollbar">
      <div className="archived-toolbar">
        <input
          type="text"
          className="archived-search"
          placeholder="Search archived cards..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="archived-filter"
          value={boardFilter}
          onChange={e => setBoardFilter(e.target.value)}
        >
          <option value="all">All Boards</option>
          {boards.map(b => (
            <option key={b.id} value={b.id}>{b.title}</option>
          ))}
        </select>
        <button
          className="archived-sort-btn"
          onClick={() => setSortNewest(prev => !prev)}
          title="Toggle sort order"
        >
          {sortNewest ? 'Newest first' : 'Oldest first'}
        </button>
      </div>

      {loading ? (
        <div className="archived-empty">Loading archived cards...</div>
      ) : filtered.length === 0 ? (
        <div className="archived-empty">No archived cards found.</div>
      ) : (
        <table className="archived-table">
          <thead>
            <tr>
              <th>Card</th>
              <th>Board</th>
              <th>Column</th>
              <th>Archived</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(card => (
              <tr key={card.id}>
                <td className="archived-card-title">{card.title}</td>
                <td>{card.boardTitle}</td>
                <td>{card.columnTitle}</td>
                <td className="archived-date">{formatDate(card.archivedAt)}</td>
                <td className="archived-actions">
                  <button
                    className="restore-btn"
                    onClick={() => onRestore(card.id)}
                  >
                    Restore
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => onDelete(card.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
