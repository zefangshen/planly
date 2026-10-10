# Fix: Unwanted vertical spacing in empty board columns

## Summary

Empty columns render a ~40px blank band between the column header and the "+ Add a card" button, caused by `min-height: 40px` on `.card-list`. The fix is a single CSS rule that removes the min-height only when the list is truly empty, while preserving the drop-target height automatically during drag-over via the dnd placeholder.

## Current State Analysis

- [Column.tsx:93-113](file:///Users/zefang/Documents/career/airs/general/planly/src/renderer/features/board/components/Column.tsx#L93-L113) renders the column body as a `Droppable` div with class `card-list scrollbar` containing the cards and `dropProvided.placeholder`.
- [global.css:289-294](file:///Users/zefang/Documents/career/airs/general/planly/src/renderer/styles/global.css#L289-L294):
  ```css
  .card-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px;
    min-height: 40px;
  }
  ```
- With zero cards, the list still occupies `min-height: 40px` → the unwanted gap between `.column-header` (padding-bottom 8px) and `.add-card-btn`.
- In non-empty columns the cards fill this area, so no gap is perceived; the rhythm from header text to first card is 8px (header padding) + 4px (list padding) = 12px.
- The min-height only serves as a rest-state drop zone for `@hello-pangea/dnd`. When a drag targets an empty list, the library mounts `dropProvided.placeholder` (a real element with the dragged card's height) inside the list.
- `.card-list` is used only in Column.tsx; no other component depends on its min-height. JSX whitespace between the `{...}` expressions is stripped at compile time, so an empty list has zero child nodes.

## Proposed Changes

### 1. `src/renderer/styles/global.css` — one additive rule

Add immediately after the existing `.card-list` block (after line 294):

```css
/* Empty columns: collapse the rest-state drop zone so the "+ Add a card"
   button sits directly under the header (same 12px rhythm as non-empty
   columns). While a drag targets this list, the dnd placeholder element
   renders inside it, so :empty no longer matches and the 40px min-height
   drop zone is restored automatically. */
.card-list:empty {
  min-height: 0;
}
```

**Why this approach:**
- Zero TSX/JS changes; no new props, classes, or state.
- `:empty` matches only when there are no cards AND no placeholder. During drag-over of an empty column, the placeholder mounts → the rule stops applying → the list regains its 40px min-height plus the placeholder height, keeping a generous drop target exactly when needed.
- Keeps the 4px vertical padding, so the residual header→button spacing (8px + 4px = 12px) matches the header→first-card rhythm of non-empty columns.

**No changes to:** Column.tsx, Board.tsx, AddCardForm.tsx, or any other file.

## Assumptions & Decisions

- The `dropProvided.placeholder` from `@hello-pangea/dnd` renders `null` when the list is not the active drag target (standard library behavior), so `:empty` is reliable here.
- Read-only All-board columns share `.card-list`; an empty read-only column will collapse to header height. This is desirable and consistent with the request.
- Columns are fixed 286px wide with no media-query reflow; the fix is viewport-size independent by construction (window height only affects the column `max-height`, which already shrinks the list area, not the empty-state spacing).
- No theme impact: the change alters only geometry, and both light/dark themes share the same `.card-list` rule.

## Verification

1. `npm run typecheck` (or the project's equivalent) — no TS errors expected (CSS-only change).
2. `npm run build` — confirms the stylesheet bundles cleanly.
3. Run the dev app (`npm run dev`) and verify:
   - An empty column shows the "+ Add a card" button directly under the header with ~12px spacing, visually matching the header→card gap in non-empty columns.
   - Non-empty columns are pixel-identical to before.
   - Drag a card over the empty column: the placeholder appears and the list expands (drop target works); drop succeeds.
   - Drag out without dropping: the empty column collapses back.
   - Open the add-card form in an empty column (textarea + actions render directly under the header), then cancel.
   - Resize the window to small/large heights and toggle light/dark theme: no regressions.
   - All board (read-only): empty status columns collapse to the header; cards and badges in populated columns are unaffected.
