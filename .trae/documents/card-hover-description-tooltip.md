# Plan: Card Hover Description Tooltip

## Summary
Add a hover-triggered tooltip to each card that reveals the card's full description text. The inline description is truncated to 2 lines (with ellipsis); hovering the card for ~150ms shows a fixed-position overlay containing the complete description. The tooltip auto-dismisses on mouse-leave, is viewport-aware (flips above when space below is tight), uses ARIA attributes for accessibility, and never causes layout shifts.

## Current State Analysis
- **Card component**: [Card.tsx](file:///Users/zefang/Documents/career/airs/general/planly/src/renderer/features/board/components/Card.tsx) renders a `Draggable` card with inline title + full description (lines 122-125). No truncation; no hover preview.
- **Card type**: [board.ts](file:///Users/zefang/Documents/career/airs/general/planly/src/shared/types/board.ts#L10-L17) — `description: string` field.
- **Styles**: [global.css](file:///Users/zefang/Documents/career/airs/general/planly/src/renderer/styles/global.css#L386-L414) — `.card` has `position: relative`; `.card-description` has no truncation. `.card-list` (line 291) uses `overflow-y: auto`, so an absolutely-positioned child tooltip would be clipped.
- **Existing overlay pattern**: context-menu (lines 141-150) uses an overlay div + absolutely positioned menu — similar two-element pattern.
- **No tooltip/popover library** in package.json (no radix/floating-ui). Implementation will be self-contained.
- **Styling approach**: plain CSS in `global.css` with CSS variables for theming (light/dark).

## Proposed Changes

### 1. `src/renderer/features/board/components/Card.tsx`
Add hover state + tooltip rendering inside the existing `Card` component.

**New state & refs:**
- `const [showTooltip, setShowTooltip] = useState(false);`
- `const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number; above: boolean } | null>(null);`
- `const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);`
- `const tooltipRef = useRef<HTMLDivElement>(null);`
- `const tooltipId = useId();` (stable ARIA id; `useId` is already available via React 18)
- `const cardRef = useRef<HTMLDivElement>(null);` — attached to the card's outer div (alongside `provided.innerRef`).

**Hover handlers on the card's outer div (non-editing, non-dragging only):**
- `onMouseEnter`: if `card.description?.trim()` and not `isEditing`, start a 150ms timer → set `showTooltip(true)` and compute position.
- `onMouseLeave`: clear timer, set `showTooltip(false)`, clear `tooltipPos`.
- Clear the timer in a `useEffect` cleanup to avoid leaks on unmount.

**Position computation (when `showTooltip` becomes true):**
- Read `cardRef.current.getBoundingClientRect()`.
- Default: place tooltip `4px` below the card bottom (`top = rect.bottom + 4`, `left = rect.left`).
- Flip: if `rect.bottom + 208 > window.innerHeight` (208 ≈ max-height + margin), place above (`top = rect.top - estimatedHeight - 4`); set `above: true`.
- Constrain `left` so the tooltip (max-width 300px) doesn't overflow the right viewport edge: `left = Math.min(rect.left, window.innerWidth - 300 - 8)`.
- Set `tooltipPos` after measuring the tooltip's own height via `tooltipRef` in a layout effect.

**Tooltip rendering (after the existing context-menu block):**
- Render only when `showTooltip && tooltipPos && card.description?.trim()` and not `isEditing` and not `snapshot.isDragging`.
- Element: `<div ref={tooltipRef} role="tooltip" id={tooltipId} className="card-desc-tooltip ${above ? 'above' : ''}" style={{ top, left }}>` containing the full `card.description` text.
- Add `aria-describedby={tooltipId}` to the card's outer div when tooltip is visible.

**Disable hover during drag**: pass `isDragDisabled` already exists; the `Draggable` `snapshot.isDragging` is available inside the render-prop. Guard the `onMouseEnter` with `snapshot.isDragging`.

### 2. `src/renderer/styles/global.css`
**Truncate inline description** — modify `.card-description` (around line 410):
```css
.card-description {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
```

**Add tooltip styles** (after the `.card-description` rule):
```css
.card-desc-tooltip {
  position: fixed;
  z-index: 1000;
  max-width: 300px;
  max-height: 200px;
  overflow-y: auto;
  padding: 10px 12px;
  background: var(--tooltip-bg, var(--card-bg));
  color: var(--text-primary);
  border: 1px solid var(--card-border-hover);
  border-radius: 6px;
  box-shadow: var(--card-shadow-hover);
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
  pointer-events: none;
}
```
- `pointer-events: none` ensures the tooltip never steals hover focus (prevents flicker) and never causes layout reflow.
- `position: fixed` escapes the `.card-list` overflow clipping.
- `z-index: 1000` sits above cards and column scroll containers.
- `white-space: pre-wrap` preserves description line breaks while wrapping.
- The `.scrollbar` class can be added for consistent scrollbar styling inside the tooltip.

**Theming**: add `--tooltip-bg` variable to both light and dark theme blocks (lines ~22 and ~84), defaulting to `--card-bg` if absent.

## Assumptions & Decisions
- **Delay**: 150ms (midpoint of the requested 100–200ms range).
- **Tooltip shows whenever a description exists** — even short ones — for consistent behavior. Truncation still applies inline so cards stay compact.
- **Positioning**: `position: fixed` with viewport-aware flip (below default, above when insufficient space) and left-edge clamping. No external positioning library.
- **`pointer-events: none`** on the tooltip prevents flicker and hover-stealing; the tooltip is non-interactive (read-only preview), matching the request.
- **No layout shift**: inline truncation reserves fixed space; tooltip is `position: fixed` so it never affects document flow.
- **Disabled states**: tooltip suppressed during inline editing (`isEditing`) and during drag (`snapshot.isDragging`).
- **Accessibility**: `role="tooltip"`, `id` via `useId`, `aria-describedby` on the card; tooltip only rendered when visible (so it's not exposed to AT when hidden).
- **Responsive**: max-width 300px + left-edge clamping keeps tooltip on-screen across viewport sizes; `max-height: 200px` with scroll for very long descriptions.

## Verification Steps
1. `npm run typecheck` — confirm no type errors with new state/refs/`useId`.
2. `npm run build` — confirm renderer build succeeds.
3. Manual / browser verification:
   - Hover a card with a long description → after ~150ms a tooltip appears below the card showing the full text; inline text is clamped to 2 lines with ellipsis.
   - Move mouse away → tooltip disappears immediately.
   - Card near the bottom of viewport → tooltip flips to appear above the card.
   - Card near the right edge → tooltip's left is clamped so it stays on-screen.
   - Very long description → tooltip scrolls internally (max-height 200px).
   - Card with no description → no tooltip, no inline text.
   - During inline edit mode → no tooltip while editing.
   - During drag → no tooltip while dragging.
   - Resize window narrower/wider → tooltip remains on-screen and readable.
   - Inspect with devtools: card has `aria-describedby` pointing to the tooltip's id when visible; tooltip has `role="tooltip"`.
   - Confirm no layout shift in the column when tooltip appears/disappears (neighbor cards don't move).
