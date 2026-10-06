import { autoScrollSpeed, slideOffsets, targetIndex, type Block } from "@/lib/reorder";

/** Press-and-hold drag to reorder rows, for mouse, pen and touch (Pointer
 * Events). Hold ~0.4s without moving to pick a row up; a quick click or a
 * swipe is left alone, so clicking a name to edit it and scrolling still work.
 *
 * The motion follows the sortable-list pattern (as in dnd-kit and native
 * reorder UIs): the held row LIFTS - a floating copy with a shadow and a soft
 * accent outline follows the pointer - while the original becomes a dimmed
 * placeholder. The other rows SLIDE out of the way with a short transform
 * transition, so the gap that opens shows exactly where it will land (no
 * separate indicator line). On release the lifted copy settles into the gap,
 * and the order is committed once. The scroll box auto-scrolls near its edges;
 * Esc cancels; reduced-motion users get instant movement.
 *
 * Only `transform` and `opacity` are animated, and nothing relies on
 * `position: relative` on a <tr> (unsupported in Safari). Rows are found by two
 * attributes: data-reorder-group (who it may be reordered among) and
 * data-reorder-id. */

export const HOLD_MS = 380;
const MOVE_TOLERANCE = 8; // px of movement that cancels a hold (it was a scroll or a click-drag)
const SLIDE_MS = 220;
const SETTLE_MS = 200;
const SAFETY_MS = 3000; // never leave the page in drag state if the save never answers

type StartEvent = { button: number; pointerType: string; clientX: number; clientY: number; target: EventTarget | null };

export type PressHoldOptions = {
  row: HTMLElement;
  group: string;
  id: number;
  /** Called on release with the row's final position (0 = first). Resolve when
   * the new order has been saved AND rendered: the rows then stop being
   * displaced (until then they stay where the drag left them). Reject to slide
   * everything back. */
  onDrop: (toIndex: number) => Promise<unknown> | void;
  /** Rows of this group whose group name starts with this move together with
   * their row (a top-level category and its expanded subcategories). */
  childGroupPrefix?: string;
  holdMs?: number;
};

const groupRows = (group: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[data-reorder-group="${group.replace(/["\\]/g, "\\$&")}"]`));

function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** A row and (optionally) the child rows that follow it. */
function blockOf(row: HTMLElement, childGroupPrefix?: string): HTMLElement[] {
  const els = [row];
  if (!childGroupPrefix) return els;
  for (let n = row.nextElementSibling as HTMLElement | null; n; n = n.nextElementSibling as HTMLElement | null) {
    if (!n.dataset.reorderGroup?.startsWith(childGroupPrefix)) break;
    els.push(n);
  }
  return els;
}

const prefersReducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The floating copy of the held row. Table rows are cloned into their own
 * table (cell widths copied) inside a clipped box the width of the visible
 * scroll area; anything else is cloned as is. */
function makeGhost(row: HTMLElement, clipLeft: number, clipWidth: number, rowRect: DOMRect): HTMLDivElement {
  const ghost = document.createElement("div");
  ghost.className = "reorder-ghost";
  ghost.setAttribute("data-testid", "reorder-ghost");
  ghost.setAttribute("aria-hidden", "true");
  const clone = row.cloneNode(true) as HTMLElement;
  // The copy must never be mistaken for a real row, nor be interactive.
  for (const el of [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))]) {
    el.removeAttribute("data-reorder-group");
    el.removeAttribute("data-reorder-id");
    el.removeAttribute("data-dragging");
    el.removeAttribute("id");
    if (el.matches("button, a, input, select, textarea")) el.setAttribute("tabindex", "-1");
  }
  if (row.tagName === "TR") {
    const srcTable = row.closest("table");
    const table = document.createElement("table");
    table.className = srcTable?.className ?? "";
    table.style.tableLayout = "fixed";
    table.style.borderCollapse = "collapse";
    table.style.width = `${rowRect.width}px`;
    table.style.marginLeft = `${rowRect.left - clipLeft}px`;
    const origCells = Array.from(row.children) as HTMLElement[];
    Array.from(clone.children).forEach((cell, i) => ((cell as HTMLElement).style.width = `${origCells[i]?.getBoundingClientRect().width ?? 0}px`));
    const tbody = document.createElement("tbody");
    tbody.appendChild(clone);
    table.appendChild(tbody);
    ghost.appendChild(table);
    ghost.style.width = `${clipWidth}px`;
    ghost.style.left = `${clipLeft}px`;
  } else {
    clone.style.margin = "0";
    ghost.appendChild(clone);
    ghost.style.width = `${rowRect.width}px`;
    ghost.style.left = `${rowRect.left}px`;
  }
  ghost.style.top = `${rowRect.top}px`;
  return ghost;
}

/** Starts watching a press. Returns a cancel function. */
export function beginPressAndHold(e: StartEvent, opts: PressHoldOptions): () => void {
  if (e.pointerType === "mouse" && e.button !== 0) return () => {};
  if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']")) return () => {};

  const { row, group, id, onDrop, childGroupPrefix, holdMs = HOLD_MS } = opts;
  const startX = e.clientX;
  const startY = e.clientY;
  let lastY = startY;
  let active = false;
  let finished = false;
  let raf = 0;
  const timer: { id?: ReturnType<typeof setTimeout> } = {};
  const reduced = prefersReducedMotion();

  // set when the drag starts
  let ghost: HTMLDivElement | null = null;
  let blocks: Block[] = [];
  const blockEls = new Map<number, HTMLElement[]>();
  let box: HTMLElement | null = null;
  let grabOffset = 0;
  let to = -1;
  let from = -1;

  const boxMetrics = () => {
    if (box) {
      const r = box.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, scroll: box.scrollTop };
    }
    return { top: 0, bottom: window.innerHeight, scroll: window.scrollY };
  };
  /** Viewport y -> y in scroll-content coordinates (what the blocks were measured in). */
  const toContent = (y: number) => y - boxMetrics().top + boxMetrics().scroll;

  const setTransforms = (offsets: Map<number, number>, animate: boolean) => {
    for (const [bid, els] of blockEls) {
      const dy = offsets.get(bid) ?? 0;
      for (const el of els) {
        el.style.transition = animate && !reduced ? `transform ${SLIDE_MS}ms ease` : "none";
        el.style.transform = dy === 0 ? "" : `translateY(${dy}px)`;
      }
    }
  };

  const update = () => {
    if (!active || !ghost) return;
    ghost.style.top = `${lastY - grabOffset}px`;
    const next = targetIndex(toContent(lastY), blocks, id);
    if (next !== to) {
      to = next;
      setTransforms(slideOffsets(blocks, id, to), true);
    }
  };

  const block = (ev: TouchEvent) => ev.preventDefault(); // stop the page scrolling under a held finger
  const swallowClick = (ev: Event) => {
    ev.stopPropagation();
    ev.preventDefault();
  };

  const loop = () => {
    if (!active || finished) return;
    const m = boxMetrics();
    const v = autoScrollSpeed(lastY, m.top, m.bottom);
    if (v !== 0) {
      if (box) box.scrollTop += v;
      else window.scrollBy(0, v);
      update();
    }
    raf = requestAnimationFrame(loop);
  };

  const removeListeners = () => {
    clearTimeout(timer.id);
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("touchmove", block);
  };

  /** Everything back to normal: no transforms, no ghost, no dimming. */
  const reset = () => {
    for (const els of blockEls.values()) {
      for (const el of els) {
        el.style.transform = "";
        el.style.transition = "";
        el.style.opacity = "";
        el.style.willChange = "";
        delete el.dataset.reorderPlaceholder;
      }
    }
    delete row.dataset.dragging;
    ghost?.remove();
    ghost = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  const cleanup = () => {
    if (finished) return;
    finished = true;
    removeListeners();
    if (active) reset();
  };

  /** Slide everything back to rest (cancel / failed save), then clean up. */
  const slideBack = () => {
    finished = true;
    removeListeners();
    if (!active) return;
    setTransforms(new Map(), true);
    if (ghost) {
      ghost.style.transition = reduced ? "none" : `opacity ${SETTLE_MS}ms ease`;
      ghost.style.opacity = "0";
    }
    setTimeout(reset, reduced ? 0 : SLIDE_MS + 20);
  };

  const onMove = (ev: PointerEvent) => {
    lastY = ev.clientY;
    if (!active) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_TOLERANCE) cleanup(); // a scroll or click-drag, not a pick-up
      return;
    }
    update();
  };

  const onUp = () => {
    if (!active) return cleanup();
    // The browser fires a click after the release; don't let it open an editor.
    window.addEventListener("click", swallowClick, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallowClick, { capture: true }), 0);
    const dropAt = to;
    if (dropAt === from) return slideBack();

    // Settle the lifted copy into the gap, keep the rows where the drag left
    // them until the saved order has rendered, then let go of all of it.
    finished = true;
    removeListeners();
    const placeholder = blockEls.get(id)?.[0];
    if (ghost && placeholder) {
      const target = placeholder.getBoundingClientRect();
      ghost.style.transition = reduced ? "none" : `top ${SETTLE_MS}ms ease, box-shadow ${SETTLE_MS}ms ease, transform ${SETTLE_MS}ms ease`;
      ghost.style.top = `${target.top}px`;
      ghost.style.transform = "none";
      ghost.style.boxShadow = "none";
    }
    const done = () => reset();
    const safety = setTimeout(done, SAFETY_MS);
    Promise.resolve(onDrop(dropAt)).then(
      () => {
        clearTimeout(safety);
        // Two frames: the freshly rendered order is painted before the displacement is removed.
        requestAnimationFrame(() => requestAnimationFrame(done));
      },
      () => {
        clearTimeout(safety);
        setTransforms(new Map(), true); // the save failed: slide everything back
        setTimeout(done, reduced ? 0 : SLIDE_MS + 20);
      }
    );
  };

  const onCancel = () => cleanup();
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    if (active) slideBack();
    else cleanup();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey);

  timer.id = setTimeout(() => {
    const els = groupRows(group);
    from = els.findIndex((r) => r.dataset.reorderId === String(id));
    if (from < 0) return cleanup();
    active = true;
    box = scrollParentOf(row);
    const m = boxMetrics();
    blocks = els.map((el) => {
      const group_ = blockOf(el, childGroupPrefix);
      const first = group_[0].getBoundingClientRect();
      const last = group_[group_.length - 1].getBoundingClientRect();
      const bid = Number(el.dataset.reorderId);
      blockEls.set(bid, group_);
      return { id: bid, mid: (first.top + last.bottom) / 2 - m.top + m.scroll, height: last.bottom - first.top };
    });
    to = from;

    const rowRect = row.getBoundingClientRect();
    grabOffset = lastY - rowRect.top;
    const clip = box?.getBoundingClientRect();
    ghost = makeGhost(row, clip?.left ?? rowRect.left, clip?.width ?? rowRect.width, rowRect);
    document.body.appendChild(ghost);

    // The original (with its expanded children) becomes the dimmed placeholder that travels to the gap.
    for (const el of blockEls.get(id) ?? []) {
      el.style.opacity = "0.28";
      el.dataset.reorderPlaceholder = "true";
    }
    for (const els2 of blockEls.values()) for (const el of els2) el.style.willChange = "transform";
    row.dataset.dragging = "true";
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    window.getSelection()?.removeAllRanges();
    document.addEventListener("touchmove", block, { passive: false });
    update();
    raf = requestAnimationFrame(loop);
  }, holdMs);

  return cleanup;
}
