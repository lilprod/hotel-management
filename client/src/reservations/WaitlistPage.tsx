import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@hm/ui';

import { useApiError } from '../auth/useApiError';
import { useCan } from '../auth/useCan';
import { GuestStep } from './NewReservationWizard';
import type { GuestChoice } from './NewReservationWizard';
import { addDays, formatDayShort, get, keys, post, qs } from './api';
import type { WaitlistEntry } from './api';
import { PropertySelect, useActiveProperty } from './property';
import { useRatePlans, useRoomTypes } from './refs';

const STATUSES = ['WAITING', 'OFFERED', 'ACCEPTED', 'EXPIRED', 'CANCELLED'] as const;
const COLORS: Record<string, string> = {
  WAITING: 'default',
  OFFERED: 'gold',
  ACCEPTED: 'green',
  EXPIRED: 'default',
  CANCELLED: 'red',
};

/** Waitlist (OP-15): list, add, accept / decline an offer, cancel. */
export function WaitlistPage() {
  const { t, i18n } = useTranslation('reservations');
  const { message } = AntApp.useApp();
  const toMessage = useApiError();
  const { can } = useCan();
  const qc = useQueryClient();
  const { propertyId } = useActiveProperty();
  const [status, setStatus] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [accepting, setAccepting] = useState<WaitlistEntry | null>(null);
  const roomTypes = useRoomTypes(propertyId);
  const typeName = (id: string | null) =>
    roomTypes.data?.find((x) => x.id === id)?.name ?? t('waitlist.anyType');
  const manage = can('waitlist.manage');

  const list = useQuery({
    queryKey: [...keys.waitlist, propertyId, status],
    queryFn: () =>
      get<{ items: WaitlistEntry[] }>(`/waitlist${qs({ propertyId, status, limit: 200 })}`),
    enabled: !!propertyId,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.waitlist });
  const act = useMutation({
    mutationFn: ({ id, op }: { id: string; op: 'cancel' | 'decline' }) =>
      post(`/waitlist/${id}/${op}`),
    onSuccess: (_d, v) => {
      void message.success(t(`waitlist.${v.op}Done`));
      refresh();
    },
    onError: (e) => void message.error(toMessage(e)),
  });

  return (
    <>
      <PageHeader
        title={t('waitlist.title')}
        subtitle={t('waitlist.subtitle')}
        actions={
          manage ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {t('waitlist.add')}
            </Button>
          ) : null
        }
      />
      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <PropertySelect />
        <Select
          allowClear
          aria-label={t('filters.status')}
          placeholder={t('filters.status')}
          value={status}
          onChange={setStatus}
          options={STATUSES.map((s) => ({ value: s, label: t(`waitlist.status.${s}`) }))}
          style={{ minWidth: 180 }}
        />
      </Flex>
      {list.isError ? (
        <Alert type="error" showIcon message={toMessage(list.error)} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<WaitlistEntry>
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data?.items ?? []}
        pagination={false}
        locale={{ emptyText: t('waitlist.empty') }}
        columns={[
          { title: t('waitlist.guest'), dataIndex: 'guestName' },
          {
            title: t('list.stay'),
            key: 'stay',
            render: (_: unknown, e) =>
              `${formatDayShort(e.arrival, i18n.language)} → ${formatDayShort(e.departure, i18n.language)}`,
          },
          {
            title: t('waitlist.roomType'),
            key: 'type',
            render: (_: unknown, e) => typeName(e.roomTypeId),
          },
          {
            title: t('detail.guests'),
            key: 'occ',
            render: (_: unknown, e) => t('guestsCount', { adults: e.adults, children: e.children }),
          },
          { title: t('waitlist.priority'), dataIndex: 'priority' },
          {
            title: t('status.label'),
            key: 'status',
            render: (_: unknown, e) => (
              <Space direction="vertical" size={0}>
                <Tag color={COLORS[e.status]}>{t(`waitlist.status.${e.status}`)}</Tag>
                {e.status === 'OFFERED' && e.offerExpiresAt ? (
                  <small>
                    {t('waitlist.offerUntil', {
                      date: new Date(e.offerExpiresAt).toLocaleString(i18n.language),
                    })}
                  </small>
                ) : null}
              </Space>
            ),
          },
          {
            title: t('list.actions'),
            key: 'actions',
            render: (_: unknown, e) =>
              manage ? (
                <Space wrap>
                  {e.status === 'OFFERED' ? (
                    <>
                      <Button size="small" type="primary" onClick={() => setAccepting(e)}>
                        {t('waitlist.accept')}
                      </Button>
                      <Button size="small" onClick={() => act.mutate({ id: e.id, op: 'decline' })}>
                        {t('waitlist.decline')}
                      </Button>
                    </>
                  ) : null}
                  {e.status === 'WAITING' || e.status === 'OFFERED' ? (
                    <Button
                      size="small"
                      danger
                      onClick={() => act.mutate({ id: e.id, op: 'cancel' })}
                    >
                      {t('waitlist.cancel')}
                    </Button>
                  ) : null}
                </Space>
              ) : null,
          },
        ]}
      />
      {creating && propertyId ? (
        <CreateEntryModal
          propertyId={propertyId}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
        />
      ) : null}
      {accepting ? (
        <AcceptModal
          entry={accepting}
          onClose={() => setAccepting(null)}
          onDone={() => {
            setAccepting(null);
            refresh();
            void qc.invalidateQueries({ queryKey: keys.reservations });
          }}
        />
      ) : null}
    </>
  );
}

function CreateEntryModal({
  propertyId,
  onClose,
  onDone,
}: {
  propertyId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation('reservations');
  const { message } = AntApp.useApp();
  const toMessage = useApiError();
  const roomTypes = useRoomTypes(propertyId);
  const today = new Date().toISOString().slice(0, 10);
  const [arrival, setArrival] = useState(today);
  const [departure, setDeparture] = useState(addDays(today, 1));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [roomTypeId, setRoomTypeId] = useState<string>();
  const [priority, setPriority] = useState(0);
  const [notes, setNotes] = useState('');
  const [guest, setGuest] = useState<GuestChoice | null>(null);
  const run = useMutation({
    mutationFn: () => {
      const g = guest!;
      return post('/waitlist', {
        propertyId,
        guest:
          g.kind === 'existing'
            ? { id: g.guest.id }
            : {
                firstName: g.firstName.trim(),
                lastName: g.lastName.trim(),
                ...(g.phone.trim() ? { phone: g.phone.trim() } : {}),
                ...(g.email.trim() ? { email: g.email.trim() } : {}),
              },
        arrival,
        departure,
        adults,
        children,
        priority,
        ...(roomTypeId ? { roomTypeId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
    },
    onSuccess: () => {
      void message.success(t('waitlist.added'));
      onDone();
    },
  });
  const ready =
    !!guest &&
    (guest.kind === 'existing' || (guest.firstName.trim() && guest.lastName.trim())) &&
    departure > arrival;
  return (
    <Modal
      open
      width={720}
      title={t('waitlist.add')}
      onCancel={onClose}
      okText={t('waitlist.addConfirm')}
      cancelText={t('close')}
      okButtonProps={{ disabled: !ready, loading: run.isPending }}
      onOk={() => run.mutate()}
    >
      <Form layout="vertical">
        <Flex gap={12} wrap>
          <Form.Item label={t('wizard.arrival')}>
            <Input
              type="date"
              aria-label={t('wizard.arrival')}
              value={arrival}
              onChange={(e) => setArrival(e.target.value)}
            />
          </Form.Item>
          <Form.Item label={t('wizard.departure')}>
            <Input
              type="date"
              aria-label={t('wizard.departure')}
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
            />
          </Form.Item>
          <Form.Item label={t('wizard.adults')}>
            <InputNumber
              aria-label={t('wizard.adults')}
              min={1}
              value={adults}
              onChange={(v) => setAdults(v ?? 1)}
            />
          </Form.Item>
          <Form.Item label={t('wizard.children')}>
            <InputNumber
              aria-label={t('wizard.children')}
              min={0}
              value={children}
              onChange={(v) => setChildren(v ?? 0)}
            />
          </Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item label={t('waitlist.roomType')} style={{ minWidth: 220 }}>
            <Select
              allowClear
              aria-label={t('waitlist.roomType')}
              placeholder={t('waitlist.anyType')}
              value={roomTypeId}
              onChange={setRoomTypeId}
              options={(roomTypes.data ?? []).map((x) => ({ value: x.id, label: x.name }))}
            />
          </Form.Item>
          <Form.Item label={t('waitlist.priority')}>
            <InputNumber
              aria-label={t('waitlist.priority')}
              min={0}
              max={100}
              value={priority}
              onChange={(v) => setPriority(v ?? 0)}
            />
          </Form.Item>
        </Flex>
        <Form.Item label={t('wizard.notes')}>
          <Input.TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Form.Item>
      </Form>
      <GuestStep guest={guest} onChange={setGuest} />
      {run.error ? (
        <Alert type="error" showIcon message={toMessage(run.error)} style={{ marginTop: 12 }} />
      ) : null}
    </Modal>
  );
}

function AcceptModal({
  entry,
  onClose,
  onDone,
}: {
  entry: WaitlistEntry;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation('reservations');
  const { message } = AntApp.useApp();
  const toMessage = useApiError();
  const plans = useRatePlans(entry.propertyId);
  const [ratePlanId, setRatePlanId] = useState<string>();
  const [status, setStatus] = useState<'CONFIRMED' | 'PENDING'>('CONFIRMED');
  const run = useMutation({
    mutationFn: () => post(`/waitlist/${entry.id}/accept`, { ratePlanId, status }),
    onSuccess: () => {
      void message.success(t('waitlist.acceptDone'));
      onDone();
    },
  });
  return (
    <Modal
      open
      title={t('waitlist.acceptTitle', { guest: entry.guestName })}
      onCancel={onClose}
      okText={t('waitlist.acceptConfirm')}
      cancelText={t('close')}
      okButtonProps={{ disabled: !ratePlanId, loading: run.isPending }}
      onOk={() => run.mutate()}
    >
      <Flex vertical gap={12}>
        <label>
          <div>{t('waitlist.ratePlan')}</div>
          <Select
            aria-label={t('waitlist.ratePlan')}
            style={{ width: '100%' }}
            value={ratePlanId}
            onChange={setRatePlanId}
            loading={plans.isLoading}
            options={(plans.data ?? [])
              .filter((p) => p.isActive)
              .map((p) => ({ value: p.id, label: p.name }))}
          />
        </label>
        <Select
          aria-label={t('wizard.statusLabel')}
          value={status}
          onChange={setStatus}
          options={[
            { value: 'CONFIRMED', label: t('status.CONFIRMED') },
            { value: 'PENDING', label: t('status.PENDING') },
          ]}
        />
        {run.error ? <Alert type="error" showIcon message={toMessage(run.error)} /> : null}
      </Flex>
    </Modal>
  );
}
