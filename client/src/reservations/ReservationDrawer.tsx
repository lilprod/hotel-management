import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useApiError } from '../auth/useApiError';
import { useCan } from '../auth/useCan';
import { formatMoney } from '../pages/settings/util';
import { conflictDetails, formatDayLong, get, keys, nightsBetween, post, qs } from './api';
import type { AuditEntry, Reservation, ReservationResult, ReservationRoom } from './api';
import { usePenaltyPreview } from './penalty';
import { useCustomFieldDefs, useLabel, useLookup, useRoomTypes } from './refs';
import { ReservationStatusTag } from './status';

const { Text } = Typography;

interface Props {
  id: string | null;
  onClose: () => void;
  /** Called after any change (planning / list refresh). */
  onChanged?: () => void;
}

type Action = 'cancel' | 'noshow' | 'dates' | 'assign' | null;

/** Reservation detail (OP-13/14): guests, rooms & nights, totals, history and lifecycle actions. */
export function ReservationDrawer({ id, onClose, onChanged }: Props) {
  const { t } = useTranslation('reservations');
  const { can } = useCan();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const toMessage = useApiError();
  const [action, setAction] = useState<Action>(null);

  const query = useQuery({
    queryKey: keys.reservation(id ?? ''),
    queryFn: async () => (await get<ReservationResult>(`/reservations/${id}`)).reservation,
    enabled: !!id,
  });
  const r = query.data;
  const roomTypes = useRoomTypes(r?.propertyId ?? null);
  const typeName = (tid: string) => roomTypes.data?.find((x) => x.id === tid)?.name ?? '';

  const changed = (res?: Reservation) => {
    if (res) qc.setQueryData(keys.reservation(res.id), { reservation: res, warnings: [] });
    void qc.invalidateQueries({ queryKey: keys.reservation(id ?? '') });
    void qc.invalidateQueries({ queryKey: keys.reservations });
    onChanged?.();
  };

  const confirm = useMutation({
    mutationFn: () => post<ReservationResult>(`/reservations/${id}/confirm`, { notifyGuest: true }),
    onSuccess: (res) => {
      void message.success(t('detail.confirmed'));
      changed(res.reservation);
    },
    onError: (e) => void message.error(toMessage(e)),
  });

  const editable = r && (r.status === 'PENDING' || r.status === 'CONFIRMED');
  const buttons: ReactNode[] = [];
  if (r?.status === 'PENDING' && can('reservations.update'))
    buttons.push(
      <Button
        key="confirm"
        type="primary"
        loading={confirm.isPending}
        onClick={() => confirm.mutate()}
      >
        {t('actions.confirm')}
      </Button>,
    );
  if (editable && can('reservations.update'))
    buttons.push(
      <Button key="dates" onClick={() => setAction('dates')}>
        {t('actions.changeDates')}
      </Button>,
    );
  if (editable && can('reservations.assign'))
    buttons.push(
      <Button key="assign" onClick={() => setAction('assign')}>
        {t('actions.assign')}
      </Button>,
    );
  if (r?.status === 'CONFIRMED' && can('reservations.cancel'))
    buttons.push(
      <Button key="noshow" onClick={() => setAction('noshow')}>
        {t('actions.noShow')}
      </Button>,
    );
  if (editable && can('reservations.cancel'))
    buttons.push(
      <Button key="cancel" danger onClick={() => setAction('cancel')}>
        {t('actions.cancel')}
      </Button>,
    );

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      width={820}
      destroyOnHidden
      title={
        r ? (
          <Space>
            <span>{t('detail.title', { number: r.number })}</span>
            <ReservationStatusTag status={r.status} />
          </Space>
        ) : (
          t('detail.loading')
        )
      }
      extra={buttons.length ? <Space wrap>{buttons}</Space> : null}
    >
      {query.isLoading ? <Skeleton active /> : null}
      {query.isError ? <Alert type="error" showIcon message={toMessage(query.error)} /> : null}
      {r ? (
        <Tabs
          items={[
            {
              key: 'detail',
              label: t('detail.tabDetail'),
              children: <Detail r={r} typeName={typeName} />,
            },
            ...(can('audit.read')
              ? [{ key: 'history', label: t('detail.tabHistory'), children: <History id={r.id} /> }]
              : []),
          ]}
        />
      ) : null}
      {r ? (
        <>
          <CancelModal
            r={r}
            open={action === 'cancel' || action === 'noshow'}
            kind={action === 'noshow' ? 'NO_SHOW' : 'CANCELLATION'}
            onClose={() => setAction(null)}
            onDone={(res) => {
              setAction(null);
              changed(res);
            }}
          />
          <DatesModal
            r={r}
            open={action === 'dates'}
            onClose={() => setAction(null)}
            onDone={(res) => {
              setAction(null);
              changed(res);
            }}
          />
          <AssignModal
            r={r}
            open={action === 'assign'}
            typeName={typeName}
            onClose={() => setAction(null)}
            onDone={(res) => {
              setAction(null);
              changed(res);
            }}
          />
        </>
      ) : null}
    </Drawer>
  );
}

function Detail({ r, typeName }: { r: Reservation; typeName: (id: string) => string }) {
  const { t, i18n } = useTranslation('reservations');
  const label = useLabel();
  const defs = useCustomFieldDefs('reservation');
  const sources = useLookup('reservation_source');
  const segments = useLookup('guest_segment');
  const lookupLabel = (list: typeof sources.data, code: string | null) => {
    const v = list?.find((x) => x.code === code);
    return v ? label(v.label) : (code ?? '-');
  };
  const money = (n: number) => formatMoney(n, r.currency);
  const customRows = (defs.data ?? []).filter((d) => r.customFields[d.key] !== undefined);

  const columns = [
    {
      title: t('detail.room'),
      key: 'room',
      render: (_: unknown, l: ReservationRoom) => (
        <span>
          <strong>{l.roomNumber ?? t('unassigned')}</strong>{' '}
          <Text type="secondary">{typeName(l.roomTypeId)}</Text>
        </span>
      ),
    },
    {
      title: t('detail.stay'),
      key: 'stay',
      render: (_: unknown, l: ReservationRoom) =>
        `${formatDayLong(l.arrival, i18n.language)} → ${formatDayLong(l.departure, i18n.language)} (${nightsBetween(l.arrival, l.departure)})`,
    },
    {
      title: t('detail.occupancy'),
      key: 'occ',
      render: (_: unknown, l: ReservationRoom) =>
        t('guestsCount', { adults: l.adults, children: l.children }),
    },
    {
      title: t('status.label'),
      key: 'st',
      render: (_: unknown, l: ReservationRoom) => <ReservationStatusTag status={l.status} />,
    },
    {
      title: t('detail.total'),
      key: 'total',
      align: 'end' as const,
      render: (_: unknown, l: ReservationRoom) => money(l.total),
    },
  ];

  return (
    <Flex vertical gap={20}>
      <Descriptions size="small" column={2} bordered>
        <Descriptions.Item label={t('detail.booker')} span={2}>
          {r.booker ? (
            <Space wrap>
              <strong>
                {r.booker.firstName} {r.booker.lastName}
              </strong>
              {r.booker.isBlacklisted ? <Tag color="red">{t('guest.blacklisted')}</Tag> : null}
              <Text type="secondary">
                {[r.booker.phone, r.booker.email].filter(Boolean).join(' - ')}
              </Text>
            </Space>
          ) : (
            t('detail.allotment')
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('detail.dates')}>
          {formatDayLong(r.arrival, i18n.language)} → {formatDayLong(r.departure, i18n.language)}
        </Descriptions.Item>
        <Descriptions.Item label={t('detail.guests')}>
          {t('guestsCount', { adults: r.adults, children: r.children })}
        </Descriptions.Item>
        <Descriptions.Item label={t('detail.channel')}>
          {t(`channel.${r.channel}`, { defaultValue: r.channel })}
        </Descriptions.Item>
        <Descriptions.Item label={t('detail.source')}>
          {lookupLabel(sources.data, r.source)}
        </Descriptions.Item>
        <Descriptions.Item label={t('detail.segment')}>
          {lookupLabel(segments.data, r.segment)}
        </Descriptions.Item>
        {r.optionExpiresAt ? (
          <Descriptions.Item label={t('detail.optionExpires')}>
            {new Date(r.optionExpiresAt).toLocaleString(i18n.language)}
          </Descriptions.Item>
        ) : null}
        {r.cancelReason ? (
          <Descriptions.Item label={t('detail.cancelReason')} span={2}>
            {r.cancelReason}
          </Descriptions.Item>
        ) : null}
      </Descriptions>

      <div>
        <Typography.Title level={5}>{t('detail.rooms')}</Typography.Title>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          columns={columns}
          dataSource={r.rooms}
          expandable={{
            expandedRowRender: (l) => (
              <Flex wrap gap={6} aria-label={t('detail.nightlyPrices')}>
                {l.dailyPrices.map((n) => (
                  <Tag key={n.date}>
                    {formatDayLong(n.date, i18n.language)} : {money(n.total)}
                  </Tag>
                ))}
              </Flex>
            ),
          }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}>
                <strong>{t('detail.roomTotal')}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="end">
                <strong>{money(r.roomTotal)}</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </div>

      {r.penalty ? (
        <Alert
          type={r.penalty.amount > 0 ? 'warning' : 'info'}
          showIcon
          message={t(
            r.penalty.kind === 'NO_SHOW' ? 'detail.penaltyNoShow' : 'detail.penaltyCancel',
            {
              amount: formatMoney(r.penalty.amount, r.penalty.currency),
            },
          )}
          description={
            r.penalty.waived
              ? t('detail.penaltyWaived', {
                  amount: formatMoney(r.penalty.computedAmount, r.penalty.currency),
                })
              : undefined
          }
        />
      ) : null}

      {r.notes ? (
        <div>
          <Typography.Title level={5}>{t('detail.notes')}</Typography.Title>
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{r.notes}</Typography.Paragraph>
        </div>
      ) : null}

      {customRows.length ? (
        <Descriptions size="small" column={2} title={t('detail.customFields')} bordered>
          {customRows.map((d) => (
            <Descriptions.Item key={d.key} label={label(d.label)}>
              {renderCustom(r.customFields[d.key])}
            </Descriptions.Item>
          ))}
        </Descriptions>
      ) : null}
    </Flex>
  );
}

function renderCustom(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  return v === null || v === undefined ? '-' : String(v);
}

function History({ id }: { id: string }) {
  const { t, i18n } = useTranslation('reservations');
  const q = useQuery({
    queryKey: ['audit', 'reservation', id],
    queryFn: () =>
      get<{ items: AuditEntry[] }>(
        `/audit${qs({ entity: 'reservation', entityId: id, limit: 50 })}`,
      ),
  });
  if (q.isLoading) return <Skeleton active />;
  if (!q.data?.items.length) return <Empty description={t('detail.noHistory')} />;
  return (
    <Timeline
      items={q.data.items.map((e) => ({
        key: e.id,
        children: (
          <div>
            <strong>
              {t(`history.${e.action.replace('reservation.', '')}`, { defaultValue: e.action })}
            </strong>
            <div>
              <Text type="secondary">{new Date(e.at).toLocaleString(i18n.language)}</Text>
            </div>
          </div>
        ),
      }))}
    />
  );
}

function ErrorBlock({ err }: { err: unknown }) {
  const { t } = useTranslation('reservations');
  const toMessage = useApiError();
  if (!err) return null;
  const c = conflictDetails(err);
  return (
    <Alert
      type="error"
      showIcon
      style={{ marginTop: 12 }}
      message={toMessage(err)}
      description={
        c && (c.clashes.length || c.short.length) ? (
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {[
              ...c.clashes.map(
                (x) =>
                  `${x.date} (${t(`conflict.reason.${x.reason}`, { defaultValue: x.reason })})`,
              ),
              ...c.short.map((x) => `${x.date}`),
            ].map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : undefined
      }
    />
  );
}

/** Cancellation / no-show: the computed penalty is displayed BEFORE the staff member confirms. */
function CancelModal({
  r,
  open,
  kind,
  onClose,
  onDone,
}: {
  r: Reservation;
  open: boolean;
  kind: 'CANCELLATION' | 'NO_SHOW';
  onClose: () => void;
  onDone: (r: Reservation) => void;
}) {
  const { t } = useTranslation('reservations');
  const { message } = AntApp.useApp();
  const label = useLabel();
  const reasons = useLookup('cancel_reason');
  const preview = usePenaltyPreview(r, kind, open);
  const [reason, setReason] = useState<string>();
  const [note, setNote] = useState('');
  const [waive, setWaive] = useState(false);
  const noShow = kind === 'NO_SHOW';

  const run = useMutation({
    mutationFn: () =>
      noShow
        ? post<{ reservation: Reservation }>(`/reservations/${r.id}/no-show`, {
            waivePenalty: waive,
          })
        : post<{ reservation: Reservation }>(`/reservations/${r.id}/cancel`, {
            reasonCode: reason,
            ...(note ? { note } : {}),
            waivePenalty: waive,
          }),
    onSuccess: (res) => {
      void message.success(t(noShow ? 'actions.noShowDone' : 'actions.cancelDone'));
      onDone(res.reservation);
    },
  });
  const p = preview.data;
  return (
    <Modal
      open={open}
      onCancel={onClose}
      destroyOnHidden
      title={t(noShow ? 'noShow.title' : 'cancel.title', { number: r.number })}
      okText={t(noShow ? 'noShow.confirm' : 'cancel.confirm')}
      cancelText={t('close')}
      okButtonProps={{ danger: true, disabled: !noShow && !reason, loading: run.isPending }}
      onOk={() => run.mutate()}
    >
      <Flex vertical gap={12}>
        {preview.isLoading ? (
          <Skeleton.Input active block size="small" />
        ) : p ? (
          <Alert
            data-testid="penalty-preview"
            type={p.amount > 0 ? 'warning' : 'success'}
            showIcon
            message={
              p.amount > 0
                ? t('penalty.amount', { amount: formatMoney(waive ? 0 : p.amount, p.currency) })
                : t('penalty.none')
            }
            description={
              p.percent > 0
                ? t('penalty.detail', {
                    percent: p.percent,
                    days: p.daysBefore,
                    amount: formatMoney(p.amount, p.currency),
                  })
                : undefined
            }
          />
        ) : (
          <Alert type="info" showIcon message={t('penalty.unknown')} />
        )}
        {!noShow ? (
          <>
            <label>
              <div>{t('cancel.reason')}</div>
              <Select
                aria-label={t('cancel.reason')}
                style={{ width: '100%' }}
                value={reason}
                onChange={setReason}
                loading={reasons.isLoading}
                options={(reasons.data ?? []).map((v) => ({
                  value: v.code,
                  label: label(v.label),
                }))}
              />
            </label>
            <label>
              <div>{t('cancel.note')}</div>
              <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </>
        ) : null}
        <Checkbox checked={waive} onChange={(e) => setWaive(e.target.checked)}>
          {t('penalty.waive')}
        </Checkbox>
        <ErrorBlock err={run.error} />
      </Flex>
    </Modal>
  );
}

/** Extend / shorten: the server decides from the new departure (later = extend). */
function DatesModal({
  r,
  open,
  onClose,
  onDone,
}: {
  r: Reservation;
  open: boolean;
  onClose: () => void;
  onDone: (r: Reservation) => void;
}) {
  const { t } = useTranslation('reservations');
  const { message } = AntApp.useApp();
  const [departure, setDeparture] = useState(r.departure);
  const mode = departure > r.departure ? 'extend' : 'shorten';
  const run = useMutation({
    mutationFn: () => post<ReservationResult>(`/reservations/${r.id}/${mode}`, { departure }),
    onSuccess: (res) => {
      void message.success(t(mode === 'extend' ? 'dates.extended' : 'dates.shortened'));
      onDone(res.reservation);
    },
  });
  return (
    <Modal
      open={open}
      onCancel={onClose}
      destroyOnHidden
      title={t('dates.title')}
      okText={t(mode === 'extend' ? 'dates.extend' : 'dates.shorten')}
      cancelText={t('close')}
      okButtonProps={{
        disabled: departure === r.departure || departure <= r.arrival,
        loading: run.isPending,
      }}
      onOk={() => run.mutate()}
    >
      <label>
        <div>{t('dates.newDeparture')}</div>
        <Input
          type="date"
          value={departure}
          min={r.arrival}
          onChange={(e) => setDeparture(e.target.value)}
        />
      </label>
      <p style={{ marginTop: 8 }}>
        {t('dates.current', {
          departure: r.departure,
          nights: nightsBetween(r.arrival, departure),
        })}
      </p>
      <ErrorBlock err={run.error} />
    </Modal>
  );
}

function AssignModal({
  r,
  open,
  typeName,
  onClose,
  onDone,
}: {
  r: Reservation;
  open: boolean;
  typeName: (id: string) => string;
  onClose: () => void;
  onDone: (r: Reservation) => void;
}) {
  const { t } = useTranslation('reservations');
  const { message } = AntApp.useApp();
  const lines = r.rooms.filter((l) => l.status === 'PENDING' || l.status === 'CONFIRMED');
  const [lineId, setLineId] = useState<string | undefined>(lines[0]?.id);
  const [roomId, setRoomId] = useState<string>();
  const line = lines.find((l) => l.id === lineId);
  const rooms = useQuery({
    queryKey: ['ref', 'rooms', r.propertyId, line?.roomTypeId],
    queryFn: async () =>
      (
        await get<{ items: { id: string; number: string }[] }>(
          `/lodging/rooms${qs({ propertyId: r.propertyId, roomTypeId: line?.roomTypeId, limit: 500 })}`,
        )
      ).items,
    enabled: open && !!line,
  });
  const run = useMutation({
    mutationFn: () =>
      post<ReservationResult>(`/reservations/${r.id}/rooms/${lineId}/assign`, { roomId }),
    onSuccess: (res) => {
      void message.success(t('assign.done'));
      onDone(res.reservation);
    },
  });
  return (
    <Modal
      open={open}
      onCancel={onClose}
      destroyOnHidden
      title={t('assign.title')}
      okText={t('assign.confirm')}
      cancelText={t('close')}
      okButtonProps={{ disabled: !roomId, loading: run.isPending }}
      onOk={() => run.mutate()}
    >
      <Flex vertical gap={12}>
        <label>
          <div>{t('assign.line')}</div>
          <Select
            aria-label={t('assign.line')}
            style={{ width: '100%' }}
            value={lineId}
            onChange={(v) => (setLineId(v), setRoomId(undefined))}
            options={lines.map((l) => ({
              value: l.id,
              label: `${typeName(l.roomTypeId)} - ${l.roomNumber ?? t('unassigned')} (${l.arrival} → ${l.departure})`,
            }))}
          />
        </label>
        <label>
          <div>{t('assign.room')}</div>
          <Select
            aria-label={t('assign.room')}
            style={{ width: '100%' }}
            value={roomId}
            onChange={setRoomId}
            loading={rooms.isLoading}
            showSearch
            optionFilterProp="label"
            options={(rooms.data ?? []).map((x) => ({ value: x.id, label: x.number }))}
          />
        </label>
        <ErrorBlock err={run.error} />
      </Flex>
    </Modal>
  );
}
