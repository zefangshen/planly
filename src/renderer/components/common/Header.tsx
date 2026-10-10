import type { Board } from '@shared/types/board';

interface Props {
  boards: Board[];
  currentBoardId: string | null;
  onTabClick: (id: string) => void;
  onArchivedClick: () => void;
  isArchivedActive: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  status: { msg: string; isError: boolean };
}

const SUN_PATH = (
  <>
    <circle cx="12" cy="12" r="4"></circle>
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path>
  </>
);
const MOON_PATH = (
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
);

export function Header({ boards, currentBoardId, onTabClick, onArchivedClick, isArchivedActive, theme, onToggleTheme, status }: Props) {
  return (
    <header>
      <div className="header-left">
        <h1>Planly</h1>
        <div className="header-divider"></div>
        <div className="tabs">
          {boards.map(b => (
            <button
              key={b.id}
              className={`tab-btn ${currentBoardId === b.id && !isArchivedActive ? 'active' : ''}`}
              onClick={() => onTabClick(b.id)}
            >
              {b.title}
            </button>
          ))}
          <div className="header-divider"></div>
          <button
            className={`tab-btn archived-tab ${isArchivedActive ? 'active' : ''}`}
            onClick={onArchivedClick}
          >
            Archived
          </button>
        </div>
      </div>
      <div className="actions">
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {theme === 'dark' ? SUN_PATH : MOON_PATH}
          </svg>
        </button>
        <span className={`status ${status.isError ? 'error' : ''}`}>{status.msg}</span>
      </div>
    </header>
  );
}
