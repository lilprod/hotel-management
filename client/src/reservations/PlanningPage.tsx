import {
  DoubleLeftOutlined,
  DoubleRightOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { Alert, App as AntApp, Button, Drawer, Flex, Input, Select, Space, Spin } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { EmptyState, PageHeader, ResourceTimeline, useUiStore } from '@hm/ui';
import type { MoveEvent, ResizeEvent, SelectEvent, TimelineSegment } from '@hm/ui';

import { useApiError } from '../auth/useApiError';
import { useCan } from '../auth/useCan';
import { NewReservationWizard } from './NewReservationWizard';
import type { WizardInitial } from './NewReservationWizard';
import { ReservationDrawer } from './ReservationDrawer';
import { addDays, conflictDetails, get, keys, nightsBetween, planningPath, post } from './api';
import type { PlanningData, PlanningSegment } from './api';
import { conflictLines } from './conflict';
import {
  applyOp,
  buildPlanningModel,
  isUnassignedResource,
  unassignedTypeOf,
} from './planning-model';
import type { PlanningOp } from './planning-model';
import { PropertySelect, useActiveProperty } from './property';
import { usePlanningRealtime } from './realtime';
import { StatusLegend, usePlanningColors } from './status';

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function useViewportHeight(offset: number, min = 420, max = 760) {
  const compute = () =>
    typeof window === 'undefined' ? 600 : Math.min(max, Math.max(min, window.innerHeight - offset));
  const [h, setH] = useState(compute);
  useEffect(() => {
    const on = () => setH(compute());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return h;
}

interface MoveVars {
  op: PlanningOp;
  seg: PlanningSegment;
  roomId: string | null;
  changeRoomType: boolean;
}

/** Planning of the property (OP-10): resource timeline with drag & drop, resize, quick create. */
export function PlanningPage() {
  const { t, i18n } = useTranslation('reservations');
  const { message } = AntApp.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toMessage = useApiError();
  const { can } = useCan();
  const language = useUiStore((s) => s.language);
  const { propertyId } = useActiveProperty();
  const colors = usePlanningColors();
  const height = useViewportHeight(360);

  const [from, setFrom] = useState(() => addDays(todayLocal(), -2));
  const [span, setSpan] = useState(31);
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [conflict, setConflict] = useState<string[] | null>(null);
  const [create, setCreate] = useState<WizardInitial | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const to = addDays(from, span);

  const canMove = can('reservations.assign');
  const canUpdate = can('reservations.update');
  const canCreate = can('reservations.create');

  const planningKey = useMemo(
    () => keys.planning(propertyId ?? '', from, to),
    [propertyId, from, to],
  );
  const query = useQuery({
    queryKey: planningKey,
    queryFn: () => get<PlanningData>(planningPath(propertyId!, from, to)),
    enabled: !!propertyId,
    placeholderData: (prev) => prev,
  });
  const data = query.data;

  const model = useMemo(
    () => (data ? buildPlanningModel(data, { typeIds, unassignedLabel: t('unassigned') }) : null),
    [data, typeIds, t],
  );
  // Without edit rights the segments are read-only.
  const segments = useMemo<TimelineSegment[]>(
    () =>
      (model?.segments ?? []).map((s) => ({
        ...s,
        draggable: !!s.draggable && canMove,
        resizable: !!s.resizable && canUpdate,
        tooltip: tooltipOf(s.data as PlanningSegment, t),
      })),
    [model, canMove, canUpdate, t],
  );

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: keys.planningAll });
    void qc.invalidateQueries({ queryKey: keys.reservations });
  }, [qc]);

  // Live refresh: coalesce bursts of events in one refetch.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  usePlanningRealtime(propertyId, () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(refresh, 150);
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const mutation = useMutation({
    mutationFn: async ({ op, seg, roomId, changeRoomType }: MoveVars) => {
      if (op.kind === 'resize') {
        const mode = op.departure > op.fromDeparture ? 'extend' : 'shorten';
        return post(`/reservations/${seg.reservationId}/${mode}`, { departure: op.departure });
      }
      const base = `/reservations/${seg.reservationId}/rooms/${seg.id}`;
      const datesChanged = op.arrival !== seg.arrival || op.departure !== seg.departure;
      if (!roomId && !datesChanged) return post(`${base}/unassign`);
      return post(`${base}/move`, {
        roomId,
        ...(datesChanged ? { arrival: op.arrival, departure: op.departure } : {}),
        ...(changeRoomType ? { changeRoomType: true } : {}),
      });
    },
    onMutate: async ({ op }) => {
      setConflict(null);
      await qc.cancelQueries({ queryKey: keys.planningAll });
      const previous = qc.getQueryData<PlanningData>(planningKey);
      if (previous) qc.setQueryData(planningKey, applyOp(previous, op));
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(planningKey, ctx.previous);
      const lines = conflictLines(err, t, ctx?.previous ?? data, i18n.language);
      if (conflictDetails(err)) setConflict(lines.length ? lines : [toMessage(err)]);
      else void message.error(toMessage(err));
    },
    onSettled: refresh,
  });

  const typeOfRoom = useMemo(() => {
    const m = new Map<string, string>();
    for (const type of data?.roomTypes ?? []) for (const r of type.rooms) m.set(r.id, type.id);
    return m;
  }, [data]);

  const onMove = (e: MoveEvent) => {
    const seg = e.segment.data as PlanningSegment;
    const roomId = isUnassignedResource(e.resourceId) ? null : e.resourceId;
    const targetType = roomId ? typeOfRoom.get(roomId) : seg.roomTypeId;
    mutation.mutate({
      seg,
      roomId,
      changeRoomType: !!targetType && targetType !== seg.roomTypeId,
      op: { kind: 'move', segmentId: seg.id, roomId, arrival: e.start, departure: e.end },
    });
  };
  const onResize = (e: ResizeEvent) => {
    const seg = e.segment.data as PlanningSegment;
    if (e.end === seg.departure) return;
    mutation.mutate({
      seg,
      roomId: seg.roomId,
      changeRoomType: false,
      op: {
        kind: 'resize',
        segmentId: seg.id,
        reservationId: seg.reservationId,
        fromDeparture: seg.departure,
        departure: e.end,
      },
    });
  };
  const onSelectRange = (e: SelectEvent) => {
    if (!canCreate || !propertyId) return;
    const unassigned = isUnassignedResource(e.resourceId);
    const roomTypeId = unassigned ? unassignedTypeOf(e.resourceId) : typeOfRoom.get(e.resourceId);
    setCreate({
      propertyId,
      arrival: e.start,
      departure: e.end,
      ...(roomTypeId ? { roomTypeId } : {}),
      ...(unassigned ? {} : { roomId: e.resourceId }),
    });
  };
  const canDrop = (seg: TimelineSegment, target: { resourceId: string }) =>
    !isUnassignedResource(target.resourceId) ||
    unassignedTypeOf(target.resourceId) === (seg.data as PlanningSegment).roomTypeId;

  const monthStart = (shift: number) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + shift, 1);
    return d.toISOString().slice(0, 10);
  };

  const today = data?.businessDate ?? todayLocal();
  const locale = language === 'en' ? 'en' : 'fr';

  let body: ReactNode;
  if (!propertyId) body = <EmptyState title={t('noProperty')} />;
  else if (query.isError && !data)
    body = (
      <Alert
        type="error"
        showIcon
        message={toMessage(query.error)}
        action={<Button onClick={() => void query.refetch()}>{t('retry')}</Button>}
      />
    );
  else if (!model) body = <Spin style={{ display: 'block', margin: '80px auto' }} />;
  else if (!model.resources.length) body = <EmptyState title={t('noRooms')} />;
  else
    body = (
      <ResourceTimeline
        ariaLabel={t('planning.aria')}
        resources={model.resources}
        groups={model.groups}
        segments={segments}
        blocks={model.blocks}
        from={from}
        to={to}
        today={today}
        locale={locale}
        height={height}
        colors={colors}
        cornerLabel={t('planning.rooms', { count: model.totalRooms })}
        renderDayHeader={(d) => {
          const pct = model.occupancy.get(d) ?? 0;
          return (
            <span
              title={t('planning.occupancy', { pct })}
              style={{ fontWeight: pct >= 90 ? 700 : 400 }}
            >
              {pct}%
            </span>
          );
        }}
        onMove={onMove}
        onResize={onResize}
        onSelectRange={canCreate ? onSelectRange : undefined}
        onSegmentClick={(s) => setDetailId((s.data as PlanningSegment).reservationId)}
        canDrop={canDrop}
        labels={{
          hint: t('planning.keyboardHint'),
          grabbed: (s) => t('planning.grabbed', { s }),
          moved: (r, a, b) => t('planning.moved', { r, a, b }),
          dropped: (s) => t('planning.dropped', { s }),
          cancelled: t('planning.cancelled'),
          expand: (g) => t('planning.expand', { g }),
          collapse: (g) => t('planning.collapse', { g }),
          resizeHandle: t('planning.resize'),
        }}
      />
    );

  return (
    <>
      <PageHeader
        title={t('planning.title')}
        subtitle={t('planning.subtitle')}
        actions={
          canCreate ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/reservations/new')}
            >
              {t('newReservation')}
            </Button>
          ) : null
        }
      />
      <Flex wrap gap={12} align="center" style={{ marginBottom: 12 }}>
        <PropertySelect />
        <Space.Compact>
          <Button
            icon={<DoubleLeftOutlined />}
            aria-label={t('nav.minus14')}
            onClick={() => setFrom(addDays(from, -14))}
          />
          <Button
            icon={<LeftOutlined />}
            aria-label={t('nav.minus7')}
            onClick={() => setFrom(addDays(from, -7))}
          />
          <Button onClick={() => setFrom(addDays(todayLocal(), -2))}>{t('nav.today')}</Button>
          <Button
            icon={<RightOutlined />}
            aria-label={t('nav.plus7')}
            onClick={() => setFrom(addDays(from, 7))}
          />
          <Button
            icon={<DoubleRightOutlined />}
            aria-label={t('nav.plus14')}
            onClick={() => setFrom(addDays(from, 14))}
          />
        </Space.Compact>
        <Space.Compact>
          <Button
            onClick={() => (
              setFrom(monthStart(-1)),
              setSpan(nightsBetween(monthStart(-1), monthStart(0)))
            )}
          >
            {t('nav.prevMonth')}
          </Button>
          <Button
            onClick={() => (
              setFrom(monthStart(1)),
              setSpan(nightsBetween(monthStart(1), monthStart(2)))
            )}
          >
            {t('nav.nextMonth')}
          </Button>
        </Space.Compact>
        <Input
          type="date"
          aria-label={t('nav.from')}
          value={from}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
          style={{ width: 150 }}
        />
        <Select
          aria-label={t('nav.span')}
          value={span}
          onChange={setSpan}
          options={[14, 31, 62, 92].map((n) => ({ value: n, label: t('nav.days', { count: n }) }))}
          style={{ width: 110 }}
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          aria-label={t('filters.roomType')}
          placeholder={t('filters.roomType')}
          value={typeIds}
          onChange={setTypeIds}
          options={(data?.roomTypes ?? []).map((rt) => ({ value: rt.id, label: rt.name }))}
          style={{ minWidth: 200 }}
        />
      </Flex>
      <div style={{ marginBottom: 10 }}>
        <StatusLegend />
      </div>
      {conflict ? (
        <Alert
          type="error"
          showIcon
          closable
          onClose={() => setConflict(null)}
          style={{ marginBottom: 10 }}
          message={t('conflict.title')}
          description={
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {conflict.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          }
        />
      ) : null}
      {body}
      <Drawer
        open={!!create}
        width={760}
        onClose={() => setCreate(null)}
        destroyOnHidden
        title={t('wizard.quickTitle')}
      >
        {create ? (
          <NewReservationWizard
            initial={create}
            onDone={() => {
              setCreate(null);
              refresh();
            }}
          />
        ) : null}
      </Drawer>
      <ReservationDrawer id={detailId} onClose={() => setDetailId(null)} onChanged={refresh} />
    </>
  );
}

function tooltipOf(s: PlanningSegment, t: TFunction): ReactNode {
  return (
    <div>
      <strong>{s.guestName || s.number}</strong>
      <div>
        {s.number} - {t(`status.${s.status}`, { defaultValue: s.status })}
      </div>
      <div>
        {s.arrival} → {s.departure} ({nightsBetween(s.arrival, s.departure)} {t('nightsShort')})
      </div>
      <div>{t('guestsCount', { adults: s.adults, children: s.children })}</div>
    </div>
  );
}
