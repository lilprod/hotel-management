import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@hm/ui';

import { useApiError } from '../auth/useApiError';
import { useCan } from '../auth/useCan';
import { addDays, formatDayLong, get, keys, post, qs } from './api';
import type { Group } from './api';
import { PropertySelect, useActiveProperty } from './property';
import { useRatePlans, useRoomTypes } from './refs';
import { ReservationStatusTag } from './status';

interface GroupRow {
  id: string;
  name: string;
  companyId: string | null;
  createdAt: string;
}

/** Groups (OP-17, feature `groups`): room block, release date, rooming list pick-up. */
export function GroupsPage() {
  const { t } = useTranslation('reservations');
  const { can } = useCan();
  const toMessage = useApiError();
  const { propertyId } = useActiveProperty();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: [...keys.groups, propertyId],
    queryFn: () => get<{ items: GroupRow[] }>(`/groups${qs({ propertyId })}`),
    enabled: !!propertyId,
  });
  const manage = can('groups.manage');
  return (
    <>
      <PageHeader
        title={t('groups.title')}
        subtitle={t('groups.subtitle')}
        actions={
          manage ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {t('groups.create')}
            </Button>
          ) : null
        }
      />
      <Flex style={{ marginBottom: 16 }}>
        <PropertySelect />
      </Flex>
      {list.isError ? (
        <Alert type="error" showIcon message={toMessage(list.error)} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<GroupRow>
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data?.items ?? []}
        pagination={false}
        locale={{ emptyText: t('groups.empty') }}
        columns={[
          {
            title: t('groups.name'),
            dataIndex: 'name',
            render: (n: string, g) => (
              <Button type="link" style={{ padding: 0 }} onClick={() => setOpenId(g.id)}>
                {n}
              </Button>
            ),
          },
          {
            title: t('groups.createdAt'),
            dataIndex: 'createdAt',
            render: (d: string) => d.slice(0, 10),
          },
        ]}
      />
      {creating && propertyId ? (
        <CreateGroupModal
          propertyId={propertyId}
          onClose={() => setCreating(false)}
          onDone={(g) => {
            setCreating(false);
            void qc.invalidateQueries({ queryKey: keys.groups });
            setOpenId(g.id);
          }}
        />
      ) : null}
      <GroupDrawer id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function CreateGroupModal({
  propertyId,
  onClose,
  onDone,
}: {
  propertyId: string;
  onClose: () => void;
  onDone: (g: Group) => void;
}) {
  const { t } = useTranslation('reservations');
  const { message } = AntApp.useApp();
  const toMessage = useApiError();
  const types = useRoomTypes(propertyId);
  const plans = useRatePlans(propertyId);
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState('');
  const [arrival, setArrival] = useState(addDays(today, 30));
  const [departure, setDeparture] = useState(addDays(today, 33));
  const [release, setRelease] = useState(addDays(today, 16));
  const [ratePlanId, setRatePlanId] = useState<string>();
  const [blocks, setBlocks] = useState<{ roomTypeId?: string; count: number; adults: number }[]>([
    { count: 5, adults: 2 },
  ]);
  const valid =
    name.trim() &&
    ratePlanId &&
    departure > arrival &&
    release <= arrival &&
    blocks.length > 0 &&
    blocks.every((b) => b.roomTypeId && b.count >= 1);
  const run = useMutation({
    mutationFn: () =>
      post<Group>('/groups', {
        propertyId,
        name: name.trim(),
        arrival,
        departure,
        releaseDate: release,
        ratePlanId,
        blocks,
      }),
    onSuccess: (g) => {
      void message.success(t('groups.created'));
      onDone(g);
    },
  });
  return (
    <Modal
      open
      width={680}
      title={t('groups.create')}
      onCancel={onClose}
      okText={t('groups.createConfirm')}
      cancelText={t('close')}
      okButtonProps={{ disabled: !valid, loading: run.isPending }}
      onOk={() => run.mutate()}
    >
      <Form layout="vertical">
        <Form.Item label={t('groups.name')} required>
          <Input
            aria-label={t('groups.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Form.Item>
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
          <Form.Item label={t('groups.releaseDate')} extra={t('groups.releaseHelp')}>
            <Input
              type="date"
              aria-label={t('groups.releaseDate')}
              value={release}
              onChange={(e) => setRelease(e.target.value)}
            />
          </Form.Item>
        </Flex>
        <Form.Item label={t('waitlist.ratePlan')} required>
          <Select
            aria-label={t('waitlist.ratePlan')}
            value={ratePlanId}
            onChange={setRatePlanId}
            options={(plans.data ?? [])
              .filter((p) => p.isActive)
              .map((p) => ({ value: p.id, label: p.name }))}
          />
        </Form.Item>
        <Typography.Text strong>{t('groups.block')}</Typography.Text>
        {blocks.map((b, i) => (
          <Flex key={i} gap={8} style={{ marginTop: 8 }} align="center">
            <Select
              aria-label={t('waitlist.roomType')}
              placeholder={t('waitlist.roomType')}
              style={{ flex: 1 }}
              value={b.roomTypeId}
              onChange={(v) =>
                setBlocks(blocks.map((x, j) => (j === i ? { ...x, roomTypeId: v } : x)))
              }
              options={(types.data ?? []).map((x) => ({ value: x.id, label: x.name }))}
            />
            <InputNumber
              aria-label={t('groups.count')}
              min={1}
              max={200}
              value={b.count}
              onChange={(v) =>
                setBlocks(blocks.map((x, j) => (j === i ? { ...x, count: v ?? 1 } : x)))
              }
            />
            <Button
              aria-label={t('groups.removeBlock')}
              icon={<DeleteOutlined />}
              disabled={blocks.length === 1}
              onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}
            />
          </Flex>
        ))}
        <Button
          style={{ marginTop: 8 }}
          onClick={() => setBlocks([...blocks, { count: 1, adults: 2 }])}
        >
          {t('groups.addBlock')}
        </Button>
      </Form>
      {run.error ? (
        <Alert type="error" showIcon message={toMessage(run.error)} style={{ marginTop: 12 }} />
      ) : null}
    </Modal>
  );
}

function GroupDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t, i18n } = useTranslation('reservations');
  const { message } = AntApp.useApp();
  const toMessage = useApiError();
  const { can } = useCan();
  const qc = useQueryClient();
  const [pickUp, setPickUp] = useState(false);
  const q = useQuery({
    queryKey: ['group', id],
    queryFn: () => get<Group>(`/groups/${id}`),
    enabled: !!id,
  });
  const g = q.data;
  const types = useRoomTypes(g?.propertyId ?? null);
  const typeName = (tid: string) => types.data?.find((x) => x.id === tid)?.name ?? '';
  const changed = (res?: Group) => {
    if (res) qc.setQueryData(['group', id], res);
    void qc.invalidateQueries({ queryKey: ['group', id] });
    void qc.invalidateQueries({ queryKey: keys.reservations });
    void qc.invalidateQueries({ queryKey: keys.planningAll });
  };
  const release = useMutation({
    mutationFn: (roomTypeId: string) => post<Group>(`/groups/${id}/release`, { roomTypeId }),
    onSuccess: (res) => {
      void message.success(t('groups.released'));
      changed(res);
    },
    onError: (e) => void message.error(toMessage(e)),
  });
  const manage = can('groups.manage');
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      width={760}
      destroyOnHidden
      title={g?.name ?? t('groups.title')}
    >
      {q.isError ? <Alert type="error" showIcon message={toMessage(q.error)} /> : null}
      {g ? (
        <Flex vertical gap={20}>
          <Descriptions size="small" bordered column={2}>
            <Descriptions.Item label={t('detail.dates')} span={2}>
              {g.arrival ? formatDayLong(g.arrival, i18n.language) : '-'} →{' '}
              {g.departure ? formatDayLong(g.departure, i18n.language) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label={t('groups.releaseDate')} span={2}>
              {g.releaseDate ? formatDayLong(g.releaseDate, i18n.language) : '-'}
            </Descriptions.Item>
          </Descriptions>
          <div>
            <Typography.Title level={5}>{t('groups.block')}</Typography.Title>
            <Table
              size="small"
              rowKey="roomTypeId"
              pagination={false}
              dataSource={g.block}
              columns={[
                {
                  title: t('waitlist.roomType'),
                  key: 'type',
                  render: (_: unknown, b) => typeName(b.roomTypeId),
                },
                { title: t('groups.held'), dataIndex: 'held' },
                { title: t('groups.pickedUp'), dataIndex: 'pickedUp' },
                {
                  title: t('list.actions'),
                  key: 'a',
                  render: (_: unknown, b) =>
                    manage && b.held > 0 ? (
                      <Button size="small" onClick={() => release.mutate(b.roomTypeId)}>
                        {t('groups.release')}
                      </Button>
                    ) : null,
                },
              ]}
            />
          </div>
          <div>
            <Flex justify="space-between" align="center">
              <Typography.Title level={5} style={{ margin: 0 }}>
                {t('groups.roomingList')}
              </Typography.Title>
              {manage && can('reservations.create') ? (
                <Button type="primary" onClick={() => setPickUp(true)}>
                  {t('groups.pickUp')}
                </Button>
              ) : null}
            </Flex>
            <Table
              size="small"
              style={{ marginTop: 8 }}
              rowKey="reservationRoomId"
              pagination={false}
              dataSource={g.roomingList}
              locale={{ emptyText: t('groups.roomingEmpty') }}
              columns={[
                { title: t('list.number'), dataIndex: 'number' },
                { title: t('list.guest'), dataIndex: 'guestName' },
                {
                  title: t('detail.room'),
                  key: 'room',
                  render: (_: unknown, r) => r.roomNumber ?? typeName(r.roomTypeId),
                },
                {
                  title: t('status.label'),
                  key: 's',
                  render: (_: unknown, r) => <ReservationStatusTag status={r.status} />,
                },
              ]}
            />
          </div>
          {pickUp ? (
            <PickUpModal
              group={g}
              typeName={typeName}
              onClose={() => setPickUp(false)}
              onDone={(res) => {
                setPickUp(false);
                changed(res);
              }}
            />
          ) : null}
        </Flex>
      ) : null}
    </Drawer>
  );
}

function PickUpModal({
  group,
  typeName,
  onClose,
  onDone,
}: {
  group: Group;
  typeName: (id: string) => string;
  onClose: () => void;
  onDone: (g: Group) => void;
}) {
  const { t } = useTranslation('reservations');
  const { message } = AntApp.useApp();
  const toMessage = useApiError();
  const open = group.block.filter((b) => b.held > 0);
  const [entries, setEntries] = useState<
    { firstName: string; lastName: string; roomTypeId?: string | undefined }[]
  >([{ firstName: '', lastName: '', roomTypeId: open[0]?.roomTypeId }]);
  const valid = entries.every((e) => e.firstName.trim() && e.lastName.trim() && e.roomTypeId);
  const run = useMutation({
    mutationFn: () =>
      post<{ group: Group }>(`/groups/${group.id}/pick-up`, {
        entries: entries.map((e) => ({
          guest: { firstName: e.firstName.trim(), lastName: e.lastName.trim() },
          roomTypeId: e.roomTypeId,
          adults: 1,
        })),
      }),
    onSuccess: (res) => {
      void message.success(t('groups.pickedUpDone', { count: entries.length }));
      onDone(res.group);
    },
  });
  return (
    <Modal
      open
      width={640}
      title={t('groups.pickUp')}
      onCancel={onClose}
      okText={t('groups.pickUpConfirm')}
      cancelText={t('close')}
      okButtonProps={{ disabled: !valid, loading: run.isPending }}
      onOk={() => run.mutate()}
    >
      <Flex vertical gap={8}>
        {entries.map((e, i) => (
          <Space key={i} wrap>
            <Input
              aria-label={t('guest.firstName')}
              placeholder={t('guest.firstName')}
              value={e.firstName}
              onChange={(ev) =>
                setEntries(
                  entries.map((x, j) => (j === i ? { ...x, firstName: ev.target.value } : x)),
                )
              }
            />
            <Input
              aria-label={t('guest.lastName')}
              placeholder={t('guest.lastName')}
              value={e.lastName}
              onChange={(ev) =>
                setEntries(
                  entries.map((x, j) => (j === i ? { ...x, lastName: ev.target.value } : x)),
                )
              }
            />
            <Select
              aria-label={t('waitlist.roomType')}
              style={{ minWidth: 160 }}
              value={e.roomTypeId}
              onChange={(v) =>
                setEntries(entries.map((x, j) => (j === i ? { ...x, roomTypeId: v } : x)))
              }
              options={open.map((b) => ({
                value: b.roomTypeId,
                label: `${typeName(b.roomTypeId)} (${b.held})`,
              }))}
            />
            <Button
              aria-label={t('groups.removeBlock')}
              icon={<DeleteOutlined />}
              disabled={entries.length === 1}
              onClick={() => setEntries(entries.filter((_, j) => j !== i))}
            />
          </Space>
        ))}
        <Button
          onClick={() =>
            setEntries([
              ...entries,
              { firstName: '', lastName: '', roomTypeId: open[0]?.roomTypeId },
            ])
          }
        >
          {t('groups.addEntry')}
        </Button>
        {run.error ? <Alert type="error" showIcon message={toMessage(run.error)} /> : null}
      </Flex>
    </Modal>
  );
}
