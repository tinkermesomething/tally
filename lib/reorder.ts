/** Pure maths for press-and-hold drag reordering - no DOM, no React, so the
 * rules are tested exactly. Rows are described by their vertical extent. */

export type RowRect = { id: number; top: number; bottom: number };

/** Where the dragged row would land if released at `pointerY`: its final
 * index in the list once it has been lifted out. It lands after every other
 * row whose middle is above the pointer. */
export function dropIndex(pointerY: number, rows: RowRect[], draggedId: number): number {
  return rows.filter((r) => r.id !== draggedId && (r.top + r.bottom) / 2 < pointerY).length;
}

/** The y position of the drop line for a final index: just above the row it
 * would push down, or - past the last row - the bottom of the whole group
 * (`endY`, which includes any expanded children under the last row). */
export function slotY(index: number, rows: RowRect[], draggedId: number, endY: number): number {
  const others = rows.filter((r) => r.id !== draggedId);
  return index < others.length ? others[index].top : endY;
}

/** How fast (px per frame) a scroll box should scroll while dragging near its
 * top/bottom edge: 0 in the middle, up to `max` right at the edge, negative
 * (up) near the top. */
export function autoScrollSpeed(pointerY: number, boxTop: number, boxBottom: number, edge = 56, max = 16): number {
  if (pointerY < boxTop + edge) return -Math.round(max * Math.min(1, (boxTop + edge - pointerY) / edge));
  if (pointerY > boxBottom - edge) return Math.round(max * Math.min(1, (pointerY - (boxBottom - edge)) / edge));
  return 0;
}

// ---- Sortable-list motion (the lifted row, the gap and the sliding rows) ----

/** A draggable row (or a row plus its expanded child rows) measured once, when
 * the drag starts, in SCROLL-CONTENT coordinates - so scrolling or the shifting
 * rows themselves never disturb the hit-testing. */
export type Block = { id: number; mid: number; height: number };

/** Final index the dragged block would land at: after every OTHER block whose
 * middle is above the pointer (also in content coordinates). */
export function targetIndex(pointerContentY: number, blocks: Block[], draggedId: number): number {
  return blocks.filter((b) => b.id !== draggedId && b.mid < pointerContentY).length;
}

/** How far each block is translated (px) to open the gap at `to`: the blocks
 * the dragged one passes slide by its height toward where it came from, and
 * the dragged block's own placeholder moves to the gap. Everything else stays
 * at 0. This is the sortable-list pattern: the gap IS the drop indicator. */
export function slideOffsets(blocks: Block[], draggedId: number, to: number): Map<number, number> {
  const out = new Map<number, number>(blocks.map((b) => [b.id, 0]));
  const from = blocks.findIndex((b) => b.id === draggedId);
  if (from < 0 || to === from) return out;
  const H = blocks[from].height;
  if (to > from) {
    let passed = 0;
    for (let i = from + 1; i <= to && i < blocks.length; i++) {
      out.set(blocks[i].id, -H);
      passed += blocks[i].height;
    }
    out.set(draggedId, passed);
  } else {
    let passed = 0;
    for (let i = to; i < from; i++) {
      out.set(blocks[i].id, H);
      passed += blocks[i].height;
    }
    out.set(draggedId, -passed);
  }
  return out;
}
