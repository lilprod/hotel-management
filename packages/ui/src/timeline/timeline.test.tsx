import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ResourceTimeline } from './ResourceTimeline';
import type { TimelineResource, TimelineSegment } from './ResourceTimeline';
import { addDays, buildRows, diffDays, fromSlot, rowIndexAt, slotWindow, toSlot } from './math';

describe('timeline math', () => {
  it('converts dates and slots both ways', () => {
    expect(diffDays('2026-02-27', '2026-03-02')).toBe(3);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(toSlot('2026-03-04', '2026-03-01', 1)).toBe(3);
    expect(toSlot('2026-03-01T12:00', '2026-03-01', 24)).toBe(12);
    expect(fromSlot(27, '2026-03-01', 24)).toBe('2026-03-02T03:00');
    expect(fromSlot(5, '2026-03-01', 1)).toBe('2026-03-06');
  });

  it('lays out groups, collapses them and finds rows', () => {
    const res = [
      { id: 'a', group: 'g1' },
      { id: 'b', group: 'g1' },
      { id: 'c', group: 'g2' },
      { id: 'd' },
    ];
    const { rows, total } = buildRows(res, [{ id: 'g1' }, { id: 'g2' }], 30, 20);
    expect(rows.map((r) => r.key)).toEqual(['d', 'g:g1', 'a', 'b', 'g:g2', 'c']);
    expect(total).toBe(30 + 20 + 60 + 20 + 30);
    expect(rowIndexAt(rows, 35)).toBe(1);
    expect(buildRows(res, [{ id: 'g1' }, { id: 'g2' }], 30, 20, new Set(['g1'])).rows).toHaveLength(
      4,
    );
    const [first, last] = slotWindow(0, 400, 100, 50, 31, 0);
    expect([first, last]).toEqual([0, 6]);
  });
});

const rooms: TimelineResource[] = [
  { id: 'r1', label: '101', group: 'std' },
  { id: 'r2', label: '102', group: 'std' },
  { id: 'r3', label: '201', group: 'dlx' },
];
const groups = [
  { id: 'std', label: 'Standard' },
  { id: 'dlx', label: 'Deluxe' },
];
const seg = (over: Partial<TimelineSegment> = {}): TimelineSegment => ({
  id: 's1',
  resourceId: 'r1',
  start: '2026-03-03',
  end: '2026-03-06',
  label: 'Dupont',
  colorKey: 'confirmed',
  draggable: true,
  resizable: true,
  ...over,
});

const LABEL = 100;
const CELL = 40;
const ROW = 30;
const GROUP = 20;
// header = 38 ; rows: std(group) r1 r2 dlx(group) r3
const baseProps = {
  resources: rooms,
  groups,
  from: '2026-03-01',
  to: '2026-03-15',
  today: '2026-03-05',
  labelWidth: LABEL,
  cellWidth: CELL,
  rowHeight: ROW,
  groupHeight: GROUP,
  dir: 'ltr' as const,
  height: 400,
  width: 800,
};
const HEADER = 38;
const cellX = (slot: number) => LABEL + slot * CELL + CELL / 2;
const rowY = (resourceIndexTop: number) => HEADER + resourceIndexTop + ROW / 2;
const R1_Y = rowY(GROUP);
const R2_Y = rowY(GROUP + ROW);
const R3_Y = rowY(GROUP + 2 * ROW + GROUP);

function pointer(target: Element | Window, type: string, x: number, y: number) {
  fireEvent(target, new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
}
// jsdom has no PointerEvent constructor in older versions: pointer events are plain MouseEvents.
const down = (el: Element, x: number, y: number) => pointer(el, 'pointerdown', x, y);
const move = (x: number, y: number) => pointer(window, 'pointermove', x, y);
const up = (x: number, y: number) => pointer(window, 'pointerup', x, y);

describe('ResourceTimeline', () => {
  it('renders groups, resources, segments, weekend shading and the today marker', () => {
    const { container } = render(<ResourceTimeline {...baseProps} segments={[seg()]} />);
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('201')).toBeInTheDocument();
    expect(container.querySelector('[data-tl-seg="s1"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tl-today]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-tl-weekend]').length).toBeGreaterThan(0);
  });

  it('moves a segment to another resource and other dates (snapped) with a ghost', () => {
    const onMove = vi.fn();
    const { container } = render(
      <ResourceTimeline {...baseProps} segments={[seg()]} onMove={onMove} />,
    );
    const el = container.querySelector('[data-tl-seg="s1"]')!;
    down(el, cellX(2), R1_Y); // grab the first night (slot 2 = 03-03)
    move(cellX(5), R2_Y); // 3 slots later, row r2
    const ghost = container.querySelector('[data-tl-ghost="move"]');
    expect(ghost).toBeInTheDocument();
    expect(ghost).toHaveAttribute('data-valid', 'true');
    up(cellX(5), R2_Y);
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'r2', start: '2026-03-06', end: '2026-03-09' }),
    );
    expect(container.querySelector('[data-tl-ghost]')).toBeNull();
  });

  it('treats a press without movement as a click', () => {
    const onClick = vi.fn();
    const onMove = vi.fn();
    const { container } = render(
      <ResourceTimeline
        {...baseProps}
        segments={[seg()]}
        onMove={onMove}
        onSegmentClick={onClick}
      />,
    );
    const el = container.querySelector('[data-tl-seg="s1"]')!;
    down(el, cellX(3), R1_Y);
    up(cellX(3), R1_Y);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('does not move non draggable segments and ignores invalid drops', () => {
    const onMove = vi.fn();
    const { container, rerender } = render(
      <ResourceTimeline {...baseProps} segments={[seg({ draggable: false })]} onMove={onMove} />,
    );
    down(container.querySelector('[data-tl-seg="s1"]')!, cellX(3), R1_Y);
    move(cellX(6), R1_Y);
    up(cellX(6), R1_Y);
    expect(onMove).not.toHaveBeenCalled();

    rerender(
      <ResourceTimeline {...baseProps} segments={[seg()]} onMove={onMove} canDrop={() => false} />,
    );
    down(container.querySelector('[data-tl-seg="s1"]')!, cellX(3), R1_Y);
    move(cellX(6), R3_Y);
    expect(container.querySelector('[data-tl-ghost]')).toHaveAttribute('data-valid', 'false');
    up(cellX(6), R3_Y);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('resizes the end edge (extend then shorten) and never below one slot', () => {
    const onResize = vi.fn();
    const { container } = render(
      <ResourceTimeline {...baseProps} segments={[seg()]} onResize={onResize} />,
    );
    const handle = container.querySelector('[data-tl-handle]')!;
    down(handle, LABEL + 5 * CELL - 2, R1_Y); // end boundary = slot 5 (03-06)
    move(LABEL + 7 * CELL, R1_Y);
    expect(container.querySelector('[data-tl-ghost="resize"]')).toBeInTheDocument();
    up(LABEL + 7 * CELL, R1_Y);
    expect(onResize).toHaveBeenLastCalledWith(
      expect.objectContaining({ start: '2026-03-03', end: '2026-03-08' }),
    );

    down(handle, LABEL + 5 * CELL - 2, R1_Y);
    move(LABEL + 0 * CELL, R1_Y);
    up(LABEL + 0 * CELL, R1_Y);
    expect(onResize).toHaveBeenLastCalledWith(expect.objectContaining({ end: '2026-03-04' }));
  });

  it('selects a range by dragging on empty cells (inclusive cells, exclusive end)', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ResourceTimeline {...baseProps} segments={[]} onSelectRange={onSelect} />,
    );
    const row = container.querySelector('[data-tl-row="r2"]')!;
    down(row, cellX(8), R2_Y);
    move(cellX(10), R2_Y);
    expect(container.querySelector('[data-tl-ghost="select"]')).toBeInTheDocument();
    up(cellX(10), R2_Y);
    expect(onSelect).toHaveBeenCalledWith({
      resourceId: 'r2',
      start: '2026-03-09',
      end: '2026-03-12',
    });

    down(row, cellX(0), R2_Y); // simple click = one night
    up(cellX(0), R2_Y);
    expect(onSelect).toHaveBeenLastCalledWith({
      resourceId: 'r2',
      start: '2026-03-01',
      end: '2026-03-02',
    });
  });

  it('Escape cancels a drag', () => {
    const onMove = vi.fn();
    const { container } = render(
      <ResourceTimeline {...baseProps} segments={[seg()]} onMove={onMove} />,
    );
    down(container.querySelector('[data-tl-seg="s1"]')!, cellX(3), R1_Y);
    move(cellX(7), R1_Y);
    fireEvent.keyDown(window, { key: 'Escape' });
    up(cellX(7), R1_Y);
    expect(onMove).not.toHaveBeenCalled();
    expect(container.querySelector('[data-tl-ghost]')).toBeNull();
  });

  it('keyboard: Space grabs, arrows move, Shift+arrows resize, Enter confirms, Escape cancels', () => {
    const onMove = vi.fn();
    const onResize = vi.fn();
    const onClick = vi.fn();
    const { container } = render(
      <ResourceTimeline
        {...baseProps}
        segments={[seg()]}
        onMove={onMove}
        onResize={onResize}
        onSegmentClick={onClick}
      />,
    );
    const el = container.querySelector('[data-tl-seg="s1"]') as HTMLElement;
    el.focus();
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(el, { key: ' ' });
    expect(el).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(screen.getByRole('status')).toHaveTextContent('102');
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'r2', start: '2026-03-05', end: '2026-03-08' }),
    );
    expect(el).toHaveAttribute('aria-pressed', 'false');

    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onResize).toHaveBeenCalledWith(
      expect.objectContaining({ start: '2026-03-03', end: '2026-03-07' }),
    );

    onMove.mockClear();
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowLeft' });
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(onMove).not.toHaveBeenCalled();
    expect(el).toHaveAttribute('aria-pressed', 'false');
  });

  it('keyboard arrows are mirrored in RTL', () => {
    const onMove = vi.fn();
    const { container } = render(
      <ResourceTimeline {...baseProps} dir="rtl" segments={[seg()]} onMove={onMove} />,
    );
    const el = container.querySelector('[data-tl-seg="s1"]') as HTMLElement;
    fireEvent.keyDown(el, { key: ' ' });
    fireEvent.keyDown(el, { key: 'ArrowLeft' }); // later in RTL
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ start: '2026-03-04' }));
  });

  it('collapses a group', () => {
    render(<ResourceTimeline {...baseProps} segments={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Standard' }));
    expect(screen.queryByText('101')).toBeNull();
    expect(screen.getByText('201')).toBeInTheDocument();
  });

  it('shows the tooltip of a segment on hover', () => {
    const { container } = render(
      <ResourceTimeline {...baseProps} segments={[seg({ tooltip: 'Dupont - 3 nuits' })]} />,
    );
    const el = container.querySelector('[data-tl-seg="s1"]')!;
    pointer(el, 'pointerover', 10, 10);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Dupont - 3 nuits');
  });

  it('renders blocks (hatched) and the extra day header row', () => {
    const { container } = render(
      <ResourceTimeline
        {...baseProps}
        segments={[]}
        blocks={[
          { id: 'b1', resourceId: 'r2', start: '2026-03-02', end: '2026-03-04', label: 'Travaux' },
        ]}
        renderDayHeader={(d) => <span data-testid="occ">{d.slice(8)}</span>}
      />,
    );
    expect(container.querySelector('[data-tl-block="b1"]')).toBeInTheDocument();
    expect(screen.getAllByTestId('occ').length).toBeGreaterThan(5);
  });
});

describe('ResourceTimeline performance (TR-04: 150 units x 31 days < 1 s)', () => {
  it('mounts only the visible window and renders within budget', () => {
    const resources: TimelineResource[] = [];
    const segments: TimelineSegment[] = [];
    for (let i = 0; i < 150; i++) {
      resources.push({ id: `r${i}`, label: String(100 + i), group: `t${i % 5}` });
      for (let k = 0; k < 4; k++)
        segments.push({
          id: `s${i}-${k}`,
          resourceId: `r${i}`,
          start: addDays('2026-03-01', k * 8),
          end: addDays('2026-03-01', k * 8 + 3 + (i % 4)),
          label: `Guest ${i}-${k}`,
          colorKey: 'confirmed',
          draggable: true,
          resizable: true,
        });
    }
    const groups = [0, 1, 2, 3, 4].map((i) => ({ id: `t${i}`, label: `Type ${i}` }));
    const t0 = performance.now();
    const { container } = render(
      <ResourceTimeline
        resources={resources}
        groups={groups}
        segments={segments}
        from="2026-03-01"
        to="2026-04-01"
        height={700}
        width={1400}
      />,
    );
    const elapsed = performance.now() - t0;
    const mounted = container.querySelectorAll('[data-tl-seg]').length;
    console.info(
      `[perf] ResourceTimeline 150x31, ${segments.length} segments: ${elapsed.toFixed(0)} ms, ${mounted} segments mounted`,
    );
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(120);
    expect(elapsed).toBeLessThan(1000);
  });
});
