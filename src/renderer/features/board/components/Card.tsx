import { useState, useRef, useEffect, useLayoutEffect, useId, useCallback } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { LABEL_COLORS } from '@shared/constants';
import type { Card as CardType } from '@shared/types/board';

interface Props {
  card: CardType & { boardTitle?: string };
  colId: string;
  index: number;
  onClick: () => void;
  onArchive: (cardId: string) => void;
  onInlineSave: (cardId: string, data: { title: string; description: string }) => Promise<boolean>;
}

/** Layout constants for the hover description tooltip. */
const TOOLTIP_GAP = 4;
const TOOLTIP_MARGIN = 8;
const TOOLTIP_WIDTH = 300;
const HOVER_DELAY_MS = 150;

interface TooltipState {
  style: React.CSSProperties;
  /** Intrinsic (unconstrained) tooltip height, used for placement. */
  height: number;
  ready: boolean;
}

export function Card({ card, index, onClick, onArchive, onInlineSave }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(card.title);
  const [draftDesc, setDraftDesc] = useState(card.description || '');
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditing]);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const tooltipId = useId();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Position the tooltip so its FULL (intrinsic) height fits on-screen — the
  // tooltip is never height-capped and therefore never shows a scrollbar.
  // Prefers below the card, flips above when it fits there, and pins to the
  // viewport top for content taller than either region.
  const placeTooltip = useCallback((height: number): React.CSSProperties => {
    const el = cardRef.current;
    if (!el) return {};
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(TOOLTIP_MARGIN, Math.min(rect.left, vw - TOOLTIP_WIDTH - TOOLTIP_MARGIN));
    const spaceBelow = vh - rect.bottom - TOOLTIP_GAP;
    const spaceAbove = rect.top - TOOLTIP_GAP;
    if (height <= spaceBelow) {
      return { top: rect.bottom + TOOLTIP_GAP, left };
    }
    if (height <= spaceAbove) {
      return { bottom: vh - rect.top + TOOLTIP_GAP, left };
    }
    return { top: TOOLTIP_MARGIN, left };
  }, []);

  // Clamped horizontal coordinate shared by the measure pass and final place.
  const measureLeft = useCallback((): number => {
    const el = cardRef.current;
    if (!el) return TOOLTIP_MARGIN;
    const rect = el.getBoundingClientRect();
    return Math.max(TOOLTIP_MARGIN, Math.min(rect.left, window.innerWidth - TOOLTIP_WIDTH - TOOLTIP_MARGIN));
  }, []);

  const scheduleTooltip = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      // First render off-screen with an unbounded height so the tooltip sizes
      // to its content; a layout effect measures it and moves it into place
      // before the browser paints (no flicker, no scrollbar).
      setTooltip({ style: { left: measureLeft(), top: -99999, visibility: 'hidden' }, height: 0, ready: false });
    }, HOVER_DELAY_MS);
  };

  const clearTooltip = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setTooltip(null);
  };

  // Clear any pending hover timer on unmount.
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  // Measure the off-screen tooltip's intrinsic height and place it on-screen.
  useLayoutEffect(() => {
    if (tooltip && !tooltip.ready && tooltipRef.current) {
      const height = tooltipRef.current.offsetHeight;
      setTooltip({ style: placeTooltip(height), height, ready: true });
    }
  }, [tooltip, placeTooltip]);

  // Keep the fixed-position tooltip aligned while the page scrolls or resizes.
  useEffect(() => {
    if (!tooltip?.ready) return;
    // Scrolling only moves the anchor — reuse the measured intrinsic height.
    const reposition = () =>
      setTooltip(t => (t ? { ...t, style: placeTooltip(t.height) } : t));
    // Resizing can change the tooltip's viewport-relative width (and therefore
    // its height), so run the off-screen measure pass again.
    const remeasure = () =>
      setTooltip(t =>
        t ? { style: { left: measureLeft(), top: -99999, visibility: 'hidden' }, height: 0, ready: false } : t,
      );
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', remeasure);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', remeasure);
    };
  }, [tooltip, placeTooltip, measureLeft]);

  const enterEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDraftTitle(card.title);
    setDraftDesc(card.description || '');
    clearTooltip();
    setIsEditing(true);
  };

  const handleSave = async () => {
    const trimmed = draftTitle.trim();
    if (!trimmed) return;
    const ok = await onInlineSave(card.id, { title: trimmed, description: draftDesc.trim() });
    if (ok) setIsEditing(false);
  };

  const handleCancel = () => {
    setDraftTitle(card.title);
    setDraftDesc(card.description || '');
    setIsEditing(false);
  };

  const dueInfo = (() => {
    if (!card.dueDate) return null;
    const d = new Date(card.dueDate + 'T23:59:59');
    const now = new Date();
    const diff = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    const cls = d < now ? 'overdue' : diff <= 2 ? 'soon' : '';
    return { cls, text: new Date(card.dueDate + 'T00:00:00').toLocaleDateString() };
  })();

  return (
    <>
      <Draggable draggableId={card.id} index={index} isDragDisabled={isEditing}>
        {(provided, snapshot) => (
          <div
            ref={node => { provided.innerRef(node); cardRef.current = node; }}
            {...provided.draggableProps}
            {...(isEditing ? {} : provided.dragHandleProps)}
            className={`card ${snapshot.isDragging ? 'dragging' : ''} ${isEditing ? 'editing' : ''}`}
            style={provided.draggableProps.style}
            aria-describedby={tooltip?.ready && !isEditing ? tooltipId : undefined}
            onMouseEnter={() => {
              if (isEditing || snapshot.isDragging || !card.description?.trim()) return;
              scheduleTooltip();
            }}
            onMouseLeave={clearTooltip}
            onMouseDown={clearTooltip}
            onClick={e => {
              if (e.defaultPrevented) return;
              if (isEditing) return;
              onClick();
            }}
            onContextMenu={e => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY });
            }}
          >
            {card.labels && card.labels.length > 0 && (
              <div className="card-labels">
                {card.labels.map(li => {
                  const c = LABEL_COLORS[li];
                  if (!c) return null;
                  return (
                    <div key={li} className="card-label" style={{ background: c.color }} title={c.name} />
                  );
                })}
              </div>
            )}
            {card.boardTitle && (
              <div className="card-board-badge">{card.boardTitle}</div>
            )}
            {isEditing ? (
              <>
                <input
                  ref={titleInputRef}
                  type="text"
                  className="card-edit-input"
                  value={draftTitle}
                  onChange={e => setDraftTitle(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
                    if (e.key === 'Escape') { e.preventDefault(); handleCancel(); }
                  }}
                />
                <textarea
                  className="card-edit-textarea scrollbar"
                  value={draftDesc}
                  onChange={e => setDraftDesc(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { e.preventDefault(); handleCancel(); }
                  }}
                  rows={2}
                />
                <div className="form-actions" onClick={e => e.stopPropagation()}>
                  <button className="save" onClick={handleSave}>Save</button>
                  <button className="cancel" onClick={handleCancel}>✕</button>
                </div>
              </>
            ) : (
              <>
                <div>{card.title}</div>
                {card.description && (
                  <div className="card-description">{card.description}</div>
                )}
                {dueInfo && (
                  <div className={`card-due ${dueInfo.cls}`}>{dueInfo.text}</div>
                )}
              </>
            )}
            {!isEditing && (
              <button className="card-edit-btn" title="Edit" onClick={enterEdit}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
              </button>
            )}
          </div>
        )}
      </Draggable>
      {menu && (
        <>
          <div className="context-menu-overlay" onClick={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null); }} />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={e => e.stopPropagation()}>
            <button className="context-menu-item" onClick={() => { onArchive(card.id); setMenu(null); }}>
              Archive
            </button>
          </div>
        </>
      )}
      {tooltip && !isEditing && card.description?.trim() && (
        <div
          ref={tooltipRef}
          role="tooltip"
          id={tooltipId}
          className="card-desc-tooltip"
          style={tooltip.style}
        >
          {card.description}
        </div>
      )}
    </>
  );
}
