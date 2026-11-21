import { theme as antTheme } from 'antd';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';

import {
  addDays,
  buildRows,
  clamp,
  diffDays,
  fromSlot,
  rowIndexAt,
  rowWindow,
  slotWindow,
  toSlot,
  weekday,
} from './math';
import type { RowLayout } from './math';

/**
 * Generic resources x time-slots planning (rooms, spa cabins, restaurant tables…).
 *
 * - sticky resource column (with collapsible group headers) and sticky date header;
 * - vertical AND horizontal virtualization: only the visible rows / slots are mounted;
 * - pointer drag to move (resource and/or time), drag of the end edge to resize, drag on
 *   empty cells to select a range, snapping to slots, ghost preview, edge auto-scroll;
 * - keyboard alternative: Space grabs the focused segment, arrows move it (Shift+arrows resize
 *   the end, Up/Down change resource), Enter confirms, Escape cancels; Enter on a segment that
 *   is not grabbed activates it;
 * - RTL safe (logical CSS properties, mirrored pointer maths), colors from antd tokens (dark mode).
 *
 * Time values are `YYYY-MM-DD` (one slot per day) or `YYYY-MM-DDTHH:mm` (slotsPerDay > 1);
 * `end` is always exclusive.
 */

export interface TimelineResource {
  id: string;
  label: ReactNode;
  sublabel?: ReactNode;
  group?: string | undefined;
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string;
}
export interface TimelineGroup {
  id: string;
  label: ReactNode;
}
export interface TimelineSegment {
  id: string;
  resourceId: string;
  start: string;
  end: string;
  label: ReactNode;
  ariaLabel?: string;
  /** Key into the `colors` prop. */
  colorKey?: string;
  draggable?: boolean;
  resizable?: boolean;
  tooltip?: ReactNode;
  data?: unknown;
}
export interface TimelineBlock {
  id: string;
  resourceId: string;
  start: string;
  end: string;
  label?: string;
}
export interface TimelineColor {
  bg: string;
  fg: string;
}
export interface MoveEvent {
  segment: TimelineSegment;
  resourceId: string;
  start: string;
  end: string;
}
export interface ResizeEvent {
  segment: TimelineSegment;
  start: string;
  end: string;
}
export interface SelectEvent {
  resourceId: string;
  start: string;
  end: string;
}
export interface TimelineLabels {
  hint: string;
  grabbed: (segment: string) => string;
  moved: (resource: string, start: string, end: string) => string;
  dropped: (segment: string) => string;
  cancelled: string;
  expand: (group: string) => string;
  collapse: (group: string) => string;
  resizeHandle: string;
}

const defaultLabels: TimelineLabels = {
  hint: 'Space picks up a booking, arrow keys move it, Shift plus arrows change its end, Enter confirms, Escape cancels.',
  grabbed: (s) => `${s} picked up`,
  moved: (r, a, b) => `${r}, ${a} to ${b}`,
  dropped: (s) => `${s} dropped`,
  cancelled: 'Cancelled',
  expand: (g) => `Expand ${g}`,
  collapse: (g) => `Collapse ${g}`,
  resizeHandle: 'Resize',
};

export interface ResourceTimelineProps {
  resources: readonly TimelineResource[];
  groups?: readonly TimelineGroup[];
  /** First day shown (inclusive). */
  from: string;
  /** Last day shown (exclusive). */
  to: string;
  segments: readonly TimelineSegment[];
  blocks?: readonly TimelineBlock[];
  slotsPerDay?: number;
  cellWidth?: number;
  rowHeight?: number;
  groupHeight?: number;
  labelWidth?: number;
  /** Viewport size used until the container is measured (and in tests). */
  height?: number;
  width?: number;
  today?: string;
  weekendDays?: readonly number[];
  locale?: string;
  dir?: 'ltr' | 'rtl';
  colors?: Record<string, TimelineColor>;
  /** Optional second header row (e.g. occupancy %). */
  renderDayHeader?: (day: string, index: number) => ReactNode;
  cornerLabel?: ReactNode;
  ariaLabel?: string;
  labels?: Partial<TimelineLabels>;
  /** Snapping, in slots. */
  snap?: number;
  onMove?: (e: MoveEvent) => void;
  onResize?: (e: ResizeEvent) => void;
  onSelectRange?: (e: SelectEvent) => void;
  onSegmentClick?: (segment: TimelineSegment) => void;
  /** Return false to flag a drop target as invalid (ghost turns red, drop is ignored). */
  canDrop?: (
    segment: TimelineSegment,
    target: { resourceId: string; start: string; end: string },
  ) => boolean;
}

interface Ghost {
  kind: 'move' | 'resize' | 'select';
  resourceId: string;
  start: number;
  end: number;
  valid: boolean;
  segmentId?: string;
}

interface DragState {
  kind: 'move' | 'resize' | 'select';
  segment?: TimelineSegment;
  startX: number;
  startY: number;
  active: boolean;
  /** Slot offset between the grabbed cell and the segment start. */
  grab: number;
  anchor: number;
  segStart: number;
  segEnd: number;
  resourceId: string;
  lastX: number;
  lastY: number;
}

const DRAG_THRESHOLD = 4;
const DAY_ROW = 38;
const SLOT_ROW = 20;
const EXTRA_ROW = 24;
const EDGE = 48;

export function ResourceTimeline(props: ResourceTimelineProps) {
  const {
    resources,
    groups = [],
    from,
    to,
    segments,
    blocks = [],
    slotsPerDay = 1,
    cellWidth = 44,
    rowHeight = 34,
    groupHeight = 28,
    labelWidth = 150,
    height = 600,
    width = 1200,
    weekendDays = [0, 6],
    locale = 'en',
    colors = {},
    renderDayHeader,
    cornerLabel,
    ariaLabel,
    snap = 1,
  } = props;
  const labels = { ...defaultLabels, ...props.labels };
  const { token } = antTheme.useToken();
  const today = props.today ?? new Date().toISOString().slice(0, 10);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [rtl, setRtl] = useState(props.dir === 'rtl');
  useLayoutEffect(() => {
    if (props.dir) return setRtl(props.dir === 'rtl');
    const el = scrollerRef.current;
    if (el && typeof getComputedStyle === 'function')
      setRtl(getComputedStyle(el).direction === 'rtl');
  }, [props.dir]);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const days = Math.max(0, diffDays(from, to));
  const slots = days * slotsPerDay;
  const dayW = cellWidth * slotsPerDay;
  const contentW = labelWidth + slots * cellWidth;
  const headerH = DAY_ROW + (slotsPerDay > 1 ? SLOT_ROW : 0) + (renderDayHeader ? EXTRA_ROW : 0);

  const { rows, total } = useMemo(
    () => buildRows(resources, groups, rowHeight, groupHeight, collapsed),
    [resources, groups, rowHeight, groupHeight, collapsed],
  );
  const rowIndexByResource = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => r.resource && m.set(r.resource.id, i));
    return m;
  }, [rows]);

  const toSlots = useCallback((v: string) => toSlot(v, from, slotsPerDay), [from, slotsPerDay]);
  const segByResource = useMemo(() => {
    const m = new Map<string, TimelineSegment[]>();
    for (const s of segments) {
      const list = m.get(s.resourceId) ?? [];
      list.push(s);
      m.set(s.resourceId, list);
    }
    return m;
  }, [segments]);
  const blocksByResource = useMemo(() => {
    const m = new Map<string, TimelineBlock[]>();
    for (const b of blocks) {
      const list = m.get(b.resourceId) ?? [];
      list.push(b);
      m.set(b.resourceId, list);
    }
    return m;
  }, [blocks]);

  // ── viewport (virtualization window) ──
  const [view, setView] = useState({ top: 0, start: 0, w: width, h: height });
  const viewRef = useRef(view);
  const syncView = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const next = {
      top: el.scrollTop,
      start: Math.abs(el.scrollLeft),
      w: el.clientWidth || width,
      h: el.clientHeight || height,
    };
    const prev = viewRef.current;
    // Re-render only when the window of rows / slots could change (quantised on cell sizes).
    if (
      Math.floor(prev.top / rowHeight) !== Math.floor(next.top / rowHeight) ||
      Math.floor(prev.start / cellWidth) !== Math.floor(next.start / cellWidth) ||
      prev.w !== next.w ||
      prev.h !== next.h
    ) {
      viewRef.current = next;
      setView(next);
    }
  }, [width, height, rowHeight, cellWidth]);
  useEffect(() => {
    syncView();
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(syncView);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncView]);

  const [firstRow, lastRow] = rowWindow(rows, view.top, view.h);
  const [firstSlot, lastSlot] = slotWindow(view.start, view.w, labelWidth, cellWidth, slots);
  const firstDay = Math.floor(firstSlot / slotsPerDay);
  const lastDay = Math.min(days, Math.ceil(lastSlot / slotsPerDay));

  // ── formatters ──
  const fmt = useMemo(
    () => ({
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }),
      full: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }),
    }),
    [locale],
  );
  const dayLabel = useCallback(
    (v: string) =>
      fmt.full.format(new Date(`${v.slice(0, 10)}T00:00:00Z`)) +
      (v.length > 10 ? ` ${v.slice(11)}` : ''),
    [fmt],
  );

  // ── interactions ──
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const ghostRef = useRef<Ghost | null>(null);
  const setGhostBoth = (g: Ghost | null) => {
    ghostRef.current = g;
    setGhost(g);
  };
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });

  const toValue = useCallback(
    (slot: number) => fromSlot(slot, from, slotsPerDay),
    [from, slotsPerDay],
  );

  /** Pointer position → fractional slot and row index. */
  const locate = useCallback(
    (clientX: number, clientY: number) => {
      const el = scrollerRef.current;
      const rect = el?.getBoundingClientRect() ?? { left: 0, right: 0, top: 0 };
      const sl = el?.scrollLeft ?? 0;
      const x = rtl ? rect.right - clientX + Math.abs(sl) : clientX - rect.left + sl;
      const y = clientY - rect.top + (el?.scrollTop ?? 0) - headerH;
      return { px: (x - labelWidth) / cellWidth, rowIdx: rowIndexAt(rowsRef.current, y) };
    },
    [rtl, labelWidth, cellWidth, headerH],
  );

  const resourceAt = (idx: number): string | null => {
    const row = rowsRef.current[idx];
    return row?.kind === 'resource' && row.resource ? row.resource.id : null;
  };

  const evaluate = useCallback(
    (d: DragState, clientX: number, clientY: number): Ghost | null => {
      const { px, rowIdx } = locate(clientX, clientY);
      const targetRes = resourceAt(rowIdx) ?? d.resourceId;
      if (d.kind === 'select') {
        const cur = clamp(Math.floor(px), 0, slots - 1);
        const lo = Math.min(d.anchor, cur);
        const hi = Math.max(d.anchor, cur);
        return { kind: 'select', resourceId: d.resourceId, start: lo, end: hi + 1, valid: true };
      }
      const seg = d.segment!;
      if (d.kind === 'resize') {
        const end = Math.max(d.segStart + snap, Math.round(px / snap) * snap);
        const valid =
          latest.current.canDrop?.(seg, {
            resourceId: seg.resourceId,
            start: toValue(d.segStart),
            end: toValue(Math.min(end, slots)),
          }) ?? true;
        return {
          kind: 'resize',
          resourceId: seg.resourceId,
          start: d.segStart,
          end: Math.min(end, slots),
          valid,
          segmentId: seg.id,
        };
      }
      const len = d.segEnd - d.segStart;
      const start = clamp(Math.round((Math.floor(px) - d.grab) / snap) * snap, 1 - len, slots - 1);
      const valid =
        latest.current.canDrop?.(seg, {
          resourceId: targetRes,
          start: toValue(start),
          end: toValue(start + len),
        }) ?? true;
      return {
        kind: 'move',
        resourceId: targetRes,
        start,
        end: start + len,
        valid,
        segmentId: seg.id,
      };
    },
    [locate, slots, snap, toValue],
  );

  const finish = useCallback(
    (g: Ghost | null, d: DragState) => {
      const cb = latest.current;
      if (!g || !g.valid) return;
      if (g.kind === 'select') {
        cb.onSelectRange?.({
          resourceId: g.resourceId,
          start: toValue(g.start),
          end: toValue(g.end),
        });
        return;
      }
      const seg = d.segment!;
      if (g.kind === 'resize') {
        if (g.end !== d.segEnd)
          cb.onResize?.({ segment: seg, start: toValue(g.start), end: toValue(g.end) });
        return;
      }
      if (g.start !== d.segStart || g.resourceId !== seg.resourceId)
        cb.onMove?.({
          segment: seg,
          resourceId: g.resourceId,
          start: toValue(g.start),
          end: toValue(g.end),
        });
    },
    [toValue],
  );

  const stopDrag = useRef<() => void>(() => undefined);
  const autoScroll = useRef(0);

  const beginDrag = useCallback(
    (d: DragState) => {
      dragRef.current = d;
      const onMove = (e: PointerEvent) => {
        const cur = dragRef.current;
        if (!cur) return;
        cur.lastX = e.clientX;
        cur.lastY = e.clientY;
        if (!cur.active) {
          if (Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY) < DRAG_THRESHOLD) return;
          cur.active = true;
          setDragging(true);
          setTip(null);
        }
        setGhostBoth(evaluate(cur, e.clientX, e.clientY));
      };
      const end = (commit: boolean) => {
        const cur = dragRef.current;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey);
        cancelAnimationFrame(autoScroll.current);
        dragRef.current = null;
        stopDrag.current = () => undefined;
        setDragging(false);
        if (!cur) return;
        const g = ghostRef.current;
        setGhostBoth(null);
        if (!commit) return;
        if (!cur.active) {
          if (cur.kind === 'select') {
            const ghostCell = evaluate(cur, cur.startX, cur.startY);
            finish(ghostCell, cur);
          } else if (cur.segment) latest.current.onSegmentClick?.(cur.segment);
          return;
        }
        finish(g, cur);
      };
      const onUp = () => end(true);
      const onCancel = () => end(false);
      const onKey = (e: globalThis.KeyboardEvent) => {
        if (e.key === 'Escape') end(false);
      };
      stopDrag.current = () => end(false);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey);
      // Edge auto-scroll while dragging.
      const tick = () => {
        const cur = dragRef.current;
        const el = scrollerRef.current;
        if (cur?.active && el) {
          const r = el.getBoundingClientRect();
          let dx = 0;
          let dy = 0;
          if (cur.lastX > r.right - EDGE) dx = 18;
          else if (cur.lastX < r.left + EDGE + labelWidth) dx = -18;
          if (cur.lastY > r.bottom - EDGE) dy = 18;
          else if (cur.lastY < r.top + EDGE + headerH) dy = -18;
          if (dx || dy) {
            el.scrollBy({ left: rtl ? -dx : dx, top: dy });
            setGhostBoth(evaluate(cur, cur.lastX, cur.lastY));
          }
        }
        autoScroll.current = requestAnimationFrame(tick);
      };
      if (typeof requestAnimationFrame === 'function')
        autoScroll.current = requestAnimationFrame(tick);
    },
    [evaluate, finish, labelWidth, headerH, rtl],
  );
  useEffect(() => () => stopDrag.current(), []);

  const onSegPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, seg: TimelineSegment, mode: 'move' | 'resize') => {
      if (e.button !== 0) return;
      if (mode === 'move' && !seg.draggable) return;
      if (mode === 'resize' && !seg.resizable) return;
      e.stopPropagation();
      const { px } = locate(e.clientX, e.clientY);
      const start = toSlots(seg.start);
      beginDrag({
        kind: mode,
        segment: seg,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        active: false,
        grab: Math.floor(px) - start,
        anchor: 0,
        segStart: start,
        segEnd: toSlots(seg.end),
        resourceId: seg.resourceId,
      });
    },
    [beginDrag, locate, toSlots],
  );

  const onRowPointerDown = (
    e: ReactPointerEvent<HTMLElement>,
    row: RowLayout<TimelineResource>,
  ) => {
    if (e.button !== 0 || !props.onSelectRange || !row.resource) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-tl-seg],[data-tl-label]')) return;
    const { px } = locate(e.clientX, e.clientY);
    if (px < 0 || px >= slots) return;
    const cell = Math.floor(px);
    beginDrag({
      kind: 'select',
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      active: false,
      grab: 0,
      anchor: cell,
      segStart: cell,
      segEnd: cell + 1,
      resourceId: row.resource.id,
    });
  };

  // ── keyboard ──
  const ensureVisible = (rowIdx: number, start: number, end: number) => {
    const el = scrollerRef.current;
    const row = rowsRef.current[rowIdx];
    if (!el || !row) return;
    const rowTop = headerH + row.top;
    if (rowTop < el.scrollTop + headerH) el.scrollTop = rowTop - headerH;
    else if (rowTop + row.height > el.scrollTop + el.clientHeight)
      el.scrollTop = rowTop + row.height - el.clientHeight;
    const x0 = labelWidth + start * cellWidth;
    const x1 = labelWidth + end * cellWidth;
    const sl = Math.abs(el.scrollLeft);
    if (x0 < sl + labelWidth) el.scrollLeft = (rtl ? -1 : 1) * Math.max(0, x0 - labelWidth);
    else if (x1 > sl + el.clientWidth) el.scrollLeft = (rtl ? -1 : 1) * (x1 - el.clientWidth);
  };

  const cancelGrab = () => {
    setGrabbedId(null);
    setGhostBoth(null);
  };

  const onSegKeyDown = (e: KeyboardEvent<HTMLElement>, seg: TimelineSegment) => {
    const g = ghostRef.current;
    const grabbed = grabbedId === seg.id && g;
    const segText = seg.ariaLabel ?? (typeof seg.label === 'string' ? seg.label : seg.id);
    if (!grabbed) {
      if (e.key === 'Enter') {
        e.preventDefault();
        latest.current.onSegmentClick?.(seg);
      } else if ((e.key === ' ' || e.key === 'Spacebar') && (seg.draggable || seg.resizable)) {
        e.preventDefault();
        setGrabbedId(seg.id);
        setGhostBoth({
          kind: 'move',
          resourceId: seg.resourceId,
          start: toSlots(seg.start),
          end: toSlots(seg.end),
          valid: true,
          segmentId: seg.id,
        });
        setAnnounce(`${labels.grabbed(segText)}. ${labels.hint}`);
      }
      return;
    }
    const orig = { start: toSlots(seg.start), end: toSlots(seg.end) };
    const next = { ...g };
    let handled = true;
    const horizontal = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (horizontal) {
      const delta = (rtl ? -horizontal : horizontal) * snap;
      if (e.shiftKey) {
        if (!seg.resizable) return;
        next.end = clamp(g.end + delta, g.start + snap, slots);
        next.kind = 'resize';
      } else {
        if (!seg.draggable) return;
        next.start = g.start + delta;
        next.end = g.end + delta;
        if (next.end <= 0 || next.start >= slots) return;
        next.kind = 'move';
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!seg.draggable) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      let i = (rowIndexByResource.get(g.resourceId) ?? 0) + step;
      while (rowsRef.current[i] && rowsRef.current[i]!.kind !== 'resource') i += step;
      const rid = resourceAt(i);
      if (!rid) return;
      next.resourceId = rid;
      next.kind = 'move';
    } else if (e.key === 'Enter' || e.key === ' ') {
      const cb = latest.current;
      const target = { resourceId: g.resourceId, start: toValue(g.start), end: toValue(g.end) };
      const ok = g.valid && (cb.canDrop?.(seg, target) ?? true);
      cancelGrab();
      if (ok) {
        if (
          g.kind === 'resize' ||
          (g.resourceId === seg.resourceId && g.start === orig.start && g.end !== orig.end)
        ) {
          if (g.end !== orig.end)
            cb.onResize?.({ segment: seg, start: toValue(g.start), end: toValue(g.end) });
        } else if (g.resourceId !== seg.resourceId || g.start !== orig.start || g.end !== orig.end)
          cb.onMove?.({ segment: seg, ...target });
        setAnnounce(labels.dropped(segText));
      }
    } else if (e.key === 'Escape') {
      cancelGrab();
      setAnnounce(labels.cancelled);
    } else handled = false;
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') return;
    next.valid =
      latest.current.canDrop?.(seg, {
        resourceId: next.resourceId,
        start: toValue(next.start),
        end: toValue(next.end),
      }) ?? true;
    setGhostBoth(next);
    ensureVisible(rowIndexByResource.get(next.resourceId) ?? 0, next.start, next.end);
    const res = resources.find((r) => r.id === next.resourceId);
    setAnnounce(
      labels.moved(
        res?.ariaLabel ?? (typeof res?.label === 'string' ? res.label : next.resourceId),
        dayLabel(toValue(next.start)),
        dayLabel(toValue(next.end)),
      ),
    );
  };

  // ── rendering ──
  const hintId = useRef(`tl-hint-${Math.random().toString(36).slice(2, 8)}`).current;
  const vars = {
    '--tl-bg': token.colorBgContainer,
    '--tl-border': token.colorBorderSecondary,
    '--tl-group-bg': token.colorFillTertiary,
    '--tl-weekend': token.colorFillQuaternary,
    '--tl-today': token.colorPrimaryBg,
    '--tl-today-line': token.colorPrimary,
    '--tl-text': token.colorText,
    '--tl-muted': token.colorTextSecondary,
    '--tl-focus': token.colorPrimary,
    '--tl-invalid': token.colorError,
    '--tl-hatch': token.colorTextQuaternary,
    '--tl-ghost': token.colorPrimary,
  } as CSSProperties;
  const dayStyle = (i: number): CSSProperties => ({
    position: 'absolute',
    insetInlineStart: labelWidth + i * dayW,
    width: dayW,
  });
  const weekendCols: number[] = [];
  let todayCol = -1;
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    if (weekendDays.includes(weekday(d))) weekendCols.push(i);
    if (d === today) todayCol = i;
  }

  const dayCells: ReactNode[] = [];
  const extraCells: ReactNode[] = [];
  for (let i = firstDay; i < lastDay; i++) {
    const d = addDays(from, i);
    const wk = weekendDays.includes(weekday(d));
    const isToday = d === today;
    dayCells.push(
      <div
        key={d}
        data-tl-day={d}
        style={{
          ...dayStyle(i),
          top: 0,
          height: DAY_ROW,
          borderInlineStart: '1px solid var(--tl-border)',
          borderBlockEnd: '1px solid var(--tl-border)',
          textAlign: 'center',
          lineHeight: '15px',
          paddingTop: 4,
          background: isToday ? 'var(--tl-today)' : wk ? 'var(--tl-weekend)' : 'var(--tl-bg)',
          color: wk ? 'var(--tl-muted)' : 'var(--tl-text)',
          fontWeight: isToday ? 700 : 400,
          fontSize: 12,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ textTransform: 'capitalize' }}>
          {fmt.weekday.format(new Date(`${d}T00:00:00Z`))}
        </div>
        <div style={{ fontSize: 14 }}>{Number(d.slice(8, 10))}</div>
      </div>,
    );
    if (renderDayHeader)
      extraCells.push(
        <div
          key={d}
          style={{
            ...dayStyle(i),
            top: headerH - EXTRA_ROW,
            height: EXTRA_ROW,
            borderInlineStart: '1px solid var(--tl-border)',
            borderBlockEnd: '1px solid var(--tl-border)',
            background: 'var(--tl-bg)',
            fontSize: 11,
            textAlign: 'center',
            lineHeight: `${EXTRA_ROW - 1}px`,
            boxSizing: 'border-box',
          }}
        >
          {renderDayHeader(d, i)}
        </div>,
      );
  }
  const slotCells: ReactNode[] = [];
  if (slotsPerDay > 1)
    for (let i = firstSlot; i < lastSlot; i++) {
      const label = toValue(i).slice(11);
      slotCells.push(
        <div
          key={i}
          style={{
            position: 'absolute',
            insetInlineStart: labelWidth + i * cellWidth,
            width: cellWidth,
            top: DAY_ROW,
            height: SLOT_ROW,
            borderInlineStart: '1px solid var(--tl-border)',
            borderBlockEnd: '1px solid var(--tl-border)',
            fontSize: 10,
            textAlign: 'center',
            color: 'var(--tl-muted)',
            background: 'var(--tl-bg)',
            boxSizing: 'border-box',
          }}
        >
          {label}
        </div>,
      );
    }

  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rowNodes: ReactNode[] = [];
  for (let ri = firstRow; ri <= lastRow; ri++) {
    const row = rows[ri];
    if (!row) continue;
    if (row.kind === 'group') {
      const g = groups.find((x) => x.id === row.groupId);
      const isCollapsed = collapsed.has(row.groupId ?? '');
      const gText = typeof g?.label === 'string' ? g.label : (row.groupId ?? '');
      rowNodes.push(
        <div
          key={row.key}
          data-tl-group={row.groupId}
          style={{
            position: 'absolute',
            top: headerH + row.top,
            height: row.height,
            width: contentW,
            insetInlineStart: 0,
            background: 'var(--tl-group-bg)',
            borderBlockEnd: '1px solid var(--tl-border)',
            zIndex: 1,
          }}
        >
          <button
            type="button"
            data-tl-label
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? labels.expand(gText) : labels.collapse(gText)}
            onClick={() => toggleGroup(row.groupId ?? '')}
            style={{
              position: 'sticky',
              insetInlineStart: 0,
              width: Math.max(labelWidth, Math.min(view.w, 420)),
              maxWidth: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 10px',
              border: 0,
              background: 'var(--tl-group-bg)',
              color: 'var(--tl-text)',
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
              textAlign: 'start',
            }}
          >
            <span aria-hidden style={{ fontSize: 9 }}>
              {isCollapsed ? (rtl ? '◀' : '▶') : '▼'}
            </span>
            {g?.label}
          </button>
        </div>,
      );
      continue;
    }
    const res = row.resource!;
    const own = segByResource.get(res.id) ?? [];
    const ownBlocks = blocksByResource.get(res.id) ?? [];
    rowNodes.push(
      <div
        key={row.key}
        data-tl-row={res.id}
        onPointerDown={(e) => onRowPointerDown(e, row)}
        style={{
          position: 'absolute',
          top: headerH + row.top,
          height: row.height,
          width: contentW,
          insetInlineStart: 0,
          borderBlockEnd: '1px solid var(--tl-border)',
          boxSizing: 'border-box',
          backgroundImage: 'linear-gradient(to right, var(--tl-border) 1px, transparent 1px)',
          backgroundSize: `${cellWidth}px 100%`,
          backgroundPosition: rtl ? '0 0' : `${labelWidth}px 0`,
          backgroundRepeat: 'repeat-x',
          zIndex: 1,
          touchAction: 'pan-y',
        }}
      >
        <div
          data-tl-label
          style={{
            position: 'sticky',
            insetInlineStart: 0,
            zIndex: 5,
            width: labelWidth,
            height: '100%',
            boxSizing: 'border-box',
            padding: '0 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            background: 'var(--tl-bg)',
            borderInlineEnd: '1px solid var(--tl-border)',
            color: 'var(--tl-text)',
            fontSize: 13,
            overflow: 'hidden',
          }}
        >
          <span style={{ fontWeight: 600 }}>{res.label}</span>
          {res.sublabel ? (
            <span style={{ color: 'var(--tl-muted)', fontSize: 11 }}>{res.sublabel}</span>
          ) : null}
        </div>
        {ownBlocks.map((b) => {
          const s = Math.max(0, toSlots(b.start));
          const e = Math.min(slots, toSlots(b.end));
          if (e <= firstSlot || s >= lastSlot || e <= s) return null;
          return (
            <div
              key={b.id}
              data-tl-block={b.id}
              role="img"
              aria-label={b.label}
              onPointerEnter={(ev) =>
                b.label && setTip({ x: ev.clientX, y: ev.clientY, content: b.label })
              }
              onPointerLeave={() => setTip(null)}
              style={{
                position: 'absolute',
                insetInlineStart: labelWidth + s * cellWidth,
                width: (e - s) * cellWidth,
                top: 3,
                height: row.height - 7,
                backgroundImage:
                  'repeating-linear-gradient(135deg, var(--tl-hatch) 0 2px, transparent 2px 8px)',
                border: '1px solid var(--tl-hatch)',
                borderRadius: 4,
                opacity: 0.8,
                fontSize: 11,
                color: 'var(--tl-text)',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                paddingInline: 6,
                lineHeight: `${row.height - 9}px`,
              }}
            >
              {b.label}
            </div>
          );
        })}
        {own.map((s) => {
          const a = toSlots(s.start);
          const b = toSlots(s.end);
          if (b <= firstSlot || a >= lastSlot) return null;
          return (
            <SegmentView
              key={s.id}
              segment={s}
              start={a}
              end={b}
              slots={slots}
              labelWidth={labelWidth}
              cellWidth={cellWidth}
              height={row.height}
              color={
                colors[s.colorKey ?? ''] ?? {
                  bg: token.colorPrimary,
                  fg: token.colorTextLightSolid,
                }
              }
              dimmed={dragging ? ghost?.segmentId === s.id : grabbedId === s.id}
              grabbed={grabbedId === s.id}
              resizeLabel={labels.resizeHandle}
              onPointerDown={onSegPointerDown}
              onKeyDown={onSegKeyDown}
              onTip={setTip}
              describedBy={hintId}
            />
          );
        })}
      </div>,
    );
  }

  const ghostRow = ghost ? rowIndexByResource.get(ghost.resourceId) : undefined;
  const ghostNode =
    ghost && ghostRow !== undefined && rows[ghostRow] ? (
      <div
        data-tl-ghost={ghost.kind}
        data-valid={ghost.valid}
        aria-hidden
        style={{
          position: 'absolute',
          top: headerH + rows[ghostRow]!.top + 3,
          height: rows[ghostRow]!.height - 7,
          insetInlineStart: labelWidth + ghost.start * cellWidth,
          width: Math.max(1, (ghost.end - ghost.start) * cellWidth - 2),
          border: `2px dashed ${ghost.valid ? 'var(--tl-ghost)' : 'var(--tl-invalid)'}`,
          background: ghost.valid
            ? 'color-mix(in srgb, var(--tl-ghost) 22%, transparent)'
            : 'color-mix(in srgb, var(--tl-invalid) 25%, transparent)',
          borderRadius: 5,
          pointerEvents: 'none',
          zIndex: 6,
          boxSizing: 'border-box',
        }}
      />
    ) : null;

  return (
    <div
      data-tl-root
      dir={props.dir}
      style={{ ...vars, position: 'relative', background: 'var(--tl-bg)', color: 'var(--tl-text)' }}
    >
      <style>
        {
          '[data-tl-seg]:focus-visible{outline:2px solid var(--tl-focus)}[data-tl-seg][aria-pressed="true"]{outline:2px solid var(--tl-focus)}'
        }
      </style>
      <div id={hintId} style={visuallyHidden}>
        {labels.hint}
      </div>
      <div role="status" aria-live="polite" style={visuallyHidden}>
        {announce}
      </div>
      <div
        ref={scrollerRef}
        role="region"
        aria-label={ariaLabel}
        data-tl-scroller
        onScroll={() => {
          syncView();
          const d = dragRef.current;
          if (d?.active) setGhostBoth(evaluate(d, d.lastX, d.lastY));
        }}
        style={{
          height,
          overflow: 'auto',
          position: 'relative',
          border: '1px solid var(--tl-border)',
          borderRadius: 6,
          userSelect: dragging ? 'none' : undefined,
          cursor: dragging ? 'grabbing' : undefined,
        }}
      >
        <div style={{ position: 'relative', width: contentW, height: headerH + total }}>
          <div
            style={{
              position: 'absolute',
              top: headerH,
              bottom: 0,
              insetInlineStart: 0,
              width: contentW,
              zIndex: 0,
            }}
          >
            {weekendCols.map((i) => (
              <div
                key={i}
                data-tl-weekend
                style={{
                  ...dayStyle(i),
                  top: 0,
                  bottom: 0,
                  background: 'var(--tl-weekend)',
                }}
              />
            ))}
            {todayCol >= 0 ? (
              <div
                data-tl-today
                style={{
                  ...dayStyle(todayCol),
                  top: 0,
                  bottom: 0,
                  background: 'var(--tl-today)',
                  borderInlineStart: '2px solid var(--tl-today-line)',
                  opacity: 0.7,
                }}
              />
            ) : null}
          </div>
          <div
            data-tl-header
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 8,
              height: headerH,
              width: contentW,
              background: 'var(--tl-bg)',
            }}
          >
            <div
              style={{
                position: 'sticky',
                insetInlineStart: 0,
                zIndex: 9,
                width: labelWidth,
                height: headerH,
                boxSizing: 'border-box',
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                background: 'var(--tl-bg)',
                borderInlineEnd: '1px solid var(--tl-border)',
                borderBlockEnd: '1px solid var(--tl-border)',
                fontSize: 12,
                color: 'var(--tl-muted)',
              }}
            >
              {cornerLabel}
            </div>
            {dayCells}
            {slotCells}
            {extraCells}
          </div>
          {rowNodes}
          {ghostNode}
        </div>
      </div>
      {tip ? (
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            insetInlineStart: tip.x + 14,
            top: tip.y + 14,
            zIndex: 1000,
            maxWidth: 280,
            padding: '6px 10px',
            borderRadius: 6,
            background: token.colorBgSpotlight,
            color: token.colorTextLightSolid,
            fontSize: 12,
            pointerEvents: 'none',
            boxShadow: token.boxShadowSecondary,
          }}
        >
          {tip.content}
        </div>
      ) : null}
    </div>
  );
}

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

interface SegmentViewProps {
  segment: TimelineSegment;
  start: number;
  end: number;
  slots: number;
  labelWidth: number;
  cellWidth: number;
  height: number;
  color: TimelineColor;
  dimmed: boolean;
  grabbed: boolean;
  resizeLabel: string;
  describedBy: string;
  onPointerDown: (
    e: ReactPointerEvent<HTMLElement>,
    seg: TimelineSegment,
    mode: 'move' | 'resize',
  ) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>, seg: TimelineSegment) => void;
  onTip: (t: { x: number; y: number; content: ReactNode } | null) => void;
}

const SegmentView = memo(function SegmentView(p: SegmentViewProps) {
  const { segment: s } = p;
  const s0 = Math.max(0, p.start);
  const s1 = Math.min(p.slots, p.end);
  const clippedStart = p.start < 0;
  const clippedEnd = p.end > p.slots;
  const interactive = s.draggable || s.resizable;
  return (
    <div
      data-tl-seg={s.id}
      data-color={s.colorKey}
      role="button"
      tabIndex={0}
      aria-label={s.ariaLabel ?? (typeof s.label === 'string' ? s.label : undefined)}
      aria-pressed={interactive ? p.grabbed : undefined}
      aria-describedby={interactive ? p.describedBy : undefined}
      onPointerDown={(e) => p.onPointerDown(e, s, 'move')}
      onKeyDown={(e) => p.onKeyDown(e, s)}
      onPointerEnter={(e) =>
        s.tooltip && p.onTip({ x: e.clientX, y: e.clientY, content: s.tooltip })
      }
      onPointerLeave={() => p.onTip(null)}
      onBlur={() => p.onTip(null)}
      style={{
        position: 'absolute',
        insetInlineStart: p.labelWidth + s0 * p.cellWidth + 1,
        width: (s1 - s0) * p.cellWidth - 2,
        top: 3,
        height: p.height - 7,
        boxSizing: 'border-box',
        background: p.color.bg,
        color: p.color.fg,
        borderRadius: `${clippedStart ? 0 : 5}px ${clippedEnd ? 0 : 5}px ${clippedEnd ? 0 : 5}px ${clippedStart ? 0 : 5}px`,
        opacity: p.dimmed ? 0.4 : 1,
        padding: '0 8px',
        fontSize: 12,
        lineHeight: `${p.height - 9}px`,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        cursor: s.draggable ? 'grab' : 'pointer',
        zIndex: 3,
        outlineOffset: 1,
        touchAction: s.draggable ? 'none' : 'auto',
      }}
    >
      {s.label}
      {s.resizable && !clippedEnd ? (
        <span
          data-tl-handle
          aria-hidden
          title={p.resizeLabel}
          onPointerDown={(e) => p.onPointerDown(e, s, 'resize')}
          style={{
            position: 'absolute',
            insetBlock: 0,
            insetInlineEnd: 0,
            width: 8,
            cursor: 'ew-resize',
            background: 'color-mix(in srgb, currentColor 30%, transparent)',
          }}
        />
      ) : null}
    </div>
  );
});
