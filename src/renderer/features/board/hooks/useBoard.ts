import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@renderer/lib/api';
import type { Board, BoardWithColumns } from '@shared/types/board';
import { ALL_BOARD_ID } from '@shared/constants';

const ACTIVE_BOARD_KEY = 'planly_active_board';

export function useBoard() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [currentBoard, setCurrentBoard] = useState<BoardWithColumns | null>(null);
  const [status, setStatus] = useState<{ msg: string; isError: boolean }>({ msg: 'Loading...', isError: false });
  const constCurrentId = useRef<string | null>(null);

  const loadBoards = useCallback(async () => {
    setStatus({ msg: 'Loading...', isError: false });
    try {
      const data = await api.getBoards();
      setBoards(data.boards);
      const savedId = localStorage.getItem(ACTIVE_BOARD_KEY);
      if (savedId === ALL_BOARD_ID) {
        await loadBoard(ALL_BOARD_ID);
      } else {
        const initial = data.boards.find(b => b.id === savedId);
        // Default to the virtual All board when there is no usable saved tab
        await loadBoard(initial ? initial.id : ALL_BOARD_ID);
      }
    } catch (e) {
      setStatus({ msg: 'Failed to load: ' + (e as Error).message, isError: true });
    }
  }, []);

  const loadBoard = useCallback(async (boardId: string) => {
    constCurrentId.current = boardId;
    localStorage.setItem(ACTIVE_BOARD_KEY, boardId);
    setStatus({ msg: 'Loading...', isError: false });
    try {
      const data = boardId === ALL_BOARD_ID
        ? await api.getAllBoard()
        : await api.getBoard(boardId);
      if (constCurrentId.current === boardId) {
        setCurrentBoard(data);
        setStatus({ msg: '', isError: false });
      }
    } catch (e) {
      if (constCurrentId.current === boardId) {
        setStatus({ msg: 'Failed to load board: ' + (e as Error).message, isError: true });
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    if (currentBoard) {
      await loadBoard(currentBoard.id);
    } else {
      await loadBoards();
    }
  }, [currentBoard, loadBoard, loadBoards]);

  const updateBoardLocally = useCallback((updater: (b: BoardWithColumns) => BoardWithColumns) => {
    setCurrentBoard(prev => (prev ? updater(prev) : prev));
  }, []);

  useEffect(() => {
    loadBoards();
  }, [loadBoards]);

  return { boards, currentBoard, status, loadBoard, refresh, updateBoardLocally, setStatus };
}
