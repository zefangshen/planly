# Plan: Inline Card Editing

## Summary

Add an inline editing mode to card components so users can edit a card's title and description directly on the board without opening the card detail modal. An edit button (pencil icon) appears in the top-right corner of each card. Clicking it converts the title into a text input and the description into a textarea, pre-populated with current values. The edit button is replaced by Save and Cancel action buttons. Save persists changes via `api.updateCard` with an optimistic local update; Cancel discards drafts and reverts to view mode. Works on both home boards and the virtual All board.

## Current State Analysis

### Card Component ([Card.tsx](file:///Users/zefang/Documents/career/airs/general/planly/src/renderer/features/board/components/Card.tsx))
- Renders inside a `Draggable` wrapper from `@hello-pangea/dnd`
- Displays: labels (color chips), board-origin badge (All board), title, description, due date
- Click on card body → calls `onClick` prop → opens `CardModal` (the existing detail-page-style editor)
- Right-click context menu → Archive only
- Card div already has `position: relative` (needed for absolute-positioned edit button)

### Existing Edit Flow ([CardModal.tsx](file:///Users/zefang/Documents/career/airs/general/planly/src/renderer/features/board/components/CardModal.tsx))
- Full modal with title (input), description (textarea), due date (date picker), labels (color picker)
- Save assembles `Partial<Card>` and calls `onSave` prop
- Keyboard: Escape closes the modal

### Data Flow ([App.tsx](file:///Users/zefang/Documents/career/airs/general/planly/src/renderer/App.tsx))
- App holds `onCardSave(data)` which calls `api.updateCard(editingCard.card.id, data)` → `refresh()`
- Callbacks are threaded App → Board → Column → Card
- `useBoard` hook provides `updateBoardLocally` (optimistic updates) and `refresh` (full reload)
- Optimistic update pattern used by column rename, card move, archive (lines 36–48, 100–143, 190–204)

### Card Type ([board.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/shared/types/board.ts#L10-L17))
```ts
interface Card { id, columnId, title, description, dueDate, labels }
```

### Styling ([global.css](file:///Users/zefang/Documents/career/airs/general/planly/src/renderer/styles/global.css))
- Single global stylesheet, no CSS modules
- Card styles at lines 386–444: `.card`, `.card-description`, `.card-due`, `.card-labels`, `.card-board-badge`
- Form pattern at lines 464–502: `.add-card-form` inputs, `.form-actions` with `.save` and `.cancel` buttons
- CSS variables for theming: `--input-bg`, `--input-focus`, `--primary-btn-bg`, `--card-border-hover`, etc.
- Dark theme overrides at lines 64–105

### Backend ([card-service.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/main/services/card-service.ts))
- `updateCard` validates title is non-empty, updates title/description/due_date/labels
- API surface: `api.updateCard(id, Partial<Card>)` → `{ ok: boolean }`

## Decisions (from user clarification)
- **Editable fields:** Title (text input) + Description (textarea) only. Due date and labels remain in the CardModal (still accessible by clicking card body).
- **All board:** Inline editing enabled everywhere. `api.updateCard` routes by card ID to the home board automatically.

## Proposed Changes

### 1. Card.tsx — Add inline edit mode

**File:** `src/renderer/features/board/components/Card.tsx`

**New props:**
```ts
interface Props {
  card: CardType & { boardTitle?: string };
  colId: string;
  index: number;
  onClick: () => void;
  onArchive: (cardId: string) => void;
  onInlineSave: (cardId: string, data: { title: string; description: string }) => Promise<boolean>;
  // Returns true on success, false on failure — Card exits edit mode only on success
}
```

**New state:**
```ts
const [isEditing, setIsEditing] = useState(false);
const [draftTitle, setDraftTitle] = useState(card.title);
const [draftDesc, setDraftDesc] = useState(card.description || '');
```

**Edit button (view mode only):**
- Pencil-icon button, absolutely positioned in the top-right corner of the card (card already has `position: relative`)
- `onClick` calls `e.stopPropagation()` (prevents card body click → modal) then `e.preventDefault()` (prevents drag) and enters edit mode
- Subtle by default (semi-transparent), brightens on card hover
- Hidden during drag

**Enter edit mode:**
- `setDraftTitle(card.title)`, `setDraftDesc(card.description || '')`, `setIsEditing(true)`
- Focus title input and select all text (mirrors Column rename pattern, lines 31–39 in Column.tsx)
- Disable dragging: `<Draggable isDragDisabled={isEditing}>`

**Edit mode rendering:**
- Replace `<div>{card.title}</div>` with `<input type="text" className="card-edit-input" value={draftTitle} .../>`
- Replace `<div className="card-description">{card.description}</div>` with `<textarea className="card-edit-textarea scrollbar" value={draftDesc} .../>`
- Labels, board badge, and due date remain visible (read-only) above/below the inputs
- Replace the edit button with Save + Cancel buttons using existing `.form-actions` / `.save` / `.cancel` classes
- Add `.editing` class to the card div for visual distinction

**Keyboard shortcuts (matching AddCardForm + CardModal patterns):**
- Enter in title input → save
- Escape anywhere → cancel (revert drafts, exit edit mode)

**Save handler:**
```ts
const handleSave = async () => {
  const trimmed = draftTitle.trim();
  if (!trimmed) return; // backend rejects empty title; don't exit edit mode
  const ok = await onInlineSave(card.id, { title: trimmed, description: draftDesc.trim() });
  if (ok) setIsEditing(false);
};
```

**Cancel handler:**
```ts
const handleCancel = () => {
  setDraftTitle(card.title);
  setDraftDesc(card.description || '');
  setIsEditing(false);
};
```

**Drag handle:** When editing, do not spread `dragHandleProps` onto the card div (prevents drag-initiation from input areas). Use a conditional: `{...(isEditing ? {} : provided.dragHandleProps)}`.

### 2. App.tsx — Add `onInlineSave` handler

**File:** `src/renderer/App.tsx`

Add a new callback (alongside existing `onCardSave` at line 168):
```ts
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
```

Pass `onInlineSave={onInlineSave}` to `<Board>` (line 238).

### 3. Board.tsx — Thread the prop

**File:** `src/renderer/features/board/components/Board.tsx`

- Add `onInlineSave: (cardId: string, data: { title: string; description: string }) => Promise<boolean>` to `Props` interface
- Pass `onInlineSave={onInlineSave}` to each `<Column>` (line 94)

### 4. Column.tsx — Thread the prop

**File:** `src/renderer/features/board/components/Column.tsx`

- Add `onInlineSave` to `Props` interface (same signature)
- Pass `onInlineSave={onInlineSave}` to each `<Card>` (line 104)

### 5. global.css — Add inline edit styles

**File:** `src/renderer/styles/global.css`

Insert after the existing `.card-board-badge` block (around line 444):

```css
/* Inline edit button — top-right corner of card */
.card-edit-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  background: none;
  border: none;
  border-radius: 3px;
  padding: 2px 4px;
  cursor: pointer;
  color: var(--text-secondary);
  opacity: 0;
  transition: opacity 0.12s ease;
  z-index: 1;
}
.card:hover .card-edit-btn { opacity: 0.6; }
.card-edit-btn:hover { opacity: 1; background: var(--menu-hover-bg); }

/* Inline editing state */
.card.editing {
  border-color: var(--input-focus);
  cursor: default;
}
.card.editing:hover { box-shadow: var(--card-shadow); }

/* Inline title input */
.card-edit-input {
  width: 100%;
  border: none;
  border-radius: 3px;
  padding: 2px 4px;
  margin: -2px -4px;
  font-size: 14px;
  font-family: inherit;
  font-weight: inherit;
  background: var(--input-bg);
  color: var(--text-primary);
  outline: 2px solid transparent;
  box-sizing: border-box;
}
.card-edit-input:focus { outline-color: var(--input-focus); }

/* Inline description textarea */
.card-edit-textarea {
  width: 100%;
  border: none;
  border-radius: 3px;
  padding: 4px;
  margin-top: 4px;
  font-size: 12px;
  font-family: inherit;
  resize: vertical;
  min-height: 40px;
  max-height: 120px;
  background: var(--input-bg);
  color: var(--text-secondary);
  outline: 2px solid transparent;
  box-sizing: border-box;
}
.card-edit-textarea:focus { outline-color: var(--input-focus); }
```

Reuse existing `.form-actions` / `.save` / `.cancel` classes (lines 481–502) for the Save/Cancel buttons — no new button styles needed.

For the edit button icon, use a small inline SVG pencil (12×12) so it renders crisply across platforms:
```tsx
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
</svg>
```

## Edge Cases Handled

| Case | Handling |
|------|----------|
| Empty title on save | `handleSave` returns early without exiting edit mode; backend also validates |
| Long-form description | Textarea has `max-height: 120px` with `resize: vertical` and `.scrollbar` class |
| Rapid edit→cancel toggle | Synchronous React state reset; no race conditions since `isEditing` is a single boolean |
| Card click during edit | Edit button `stopPropagation` prevents modal open; drag disabled prevents DnD conflicts |
| Save failure | Optimistic update reverted by `refresh()`; Card stays in edit mode (returns `false`) |
| All board editing | Works transparently — `api.updateCard(cardId, ...)` routes to home board by ID |
| Dark mode | All styles use theme CSS variables (`--input-bg`, `--input-focus`, etc.) |

## Verification

1. **Typecheck:** `npm run typecheck` — ensure new props compile
2. **Build:** `npm run build` — ensure renderer bundle builds
3. **Manual testing:**
   - Click edit button → inputs appear with current values, title focused
   - Modify title + description → Save → card shows new text, exits edit mode
   - Modify → Cancel → card reverts to original text, exits edit mode
   - Press Enter in title → saves
   - Press Escape → cancels
   - Try saving empty title → stays in edit mode
   - Long description → textarea scrolls within max-height
   - Rapidly click edit→cancel→edit → stable, no flicker
   - All board: edit a card → title/description update after save and refresh
   - Dark mode: inputs and buttons use correct colors
   - Card body click still opens CardModal (due date/labels editing)
   - Drag still works in view mode; disabled in edit mode
