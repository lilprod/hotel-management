import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Progress,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import type { QuotaUsage, SubscriptionOverview } from '../../billing/common';
import { quotaOf } from '../api';
import {
  quotaKey,
  roomsKey,
  roomTypesKey,
  type Items,
  type RoomDto,
  type RoomTypeDto,
  type StepProps,
} from './common';

interface Draft {
  prefix: string;
  from: number | null;
  to: number | null;
  floor: string;
}

const MAX_BULK = 500;

function rangeError(d: Draft): boolean {
  return d.from === null || d.to === null || d.to < d.from || d.to - d.from + 1 > MAX_BULK;
}

/** Step 3: bulk creation of numbered rooms per type, aware of the `units` quota. */
export function RoomsStep({ propertyId, saveRef }: StepProps) {
  const { t } = useTranslation('onboarding');
  const message = useApiError();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, { kind: 'success' | 'error'; text: string }>>(
    {},
  );

  useEffect(() => {
    saveRef.current = () => Promise.resolve(true);
    return () => {
      saveRef.current = null;
    };
  }, [saveRef]);

  const types = useQuery({
    queryKey: roomTypesKey(propertyId),
    queryFn: () =>
      apiClient.get<Items<RoomTypeDto>>(`/lodging/room-types?propertyId=${propertyId}&limit=200`),
  });
  const rooms = useQuery({
    queryKey: roomsKey(propertyId),
    queryFn: () =>
      apiClient.get<Items<RoomDto>>(`/lodging/rooms?propertyId=${propertyId}&limit=500`),
  });
  const overview = useQuery({
    queryKey: quotaKey,
    queryFn: () => apiClient.get<SubscriptionOverview>('/billing/subscription'),
  });
  const quota: QuotaUsage | undefined = overview.data?.quotas.find((q) => q.key === 'units');
  const perType = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rooms.data?.items ?? []) m.set(r.roomTypeId, (m.get(r.roomTypeId) ?? 0) + 1);
    return m;
  }, [rooms.data]);

  const draftOf = (id: string): Draft =>
    drafts[id] ?? { prefix: '', from: null, to: null, floor: '' };
  const patch = (id: string, p: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...draftOf(id), ...p } }));

  async function create(rt: RoomTypeDto) {
    const d = draftOf(rt.id);
    if (rangeError(d)) {
      setNotes((n) => ({ ...n, [rt.id]: { kind: 'error', text: t('rooms.errors.range') } }));
      return;
    }
    setBusy(rt.id);
    setNotes((n) => Object.fromEntries(Object.entries(n).filter(([k]) => k !== rt.id)));
    try {
      const r = await apiClient.post<{ created: number }>('/lodging/rooms/bulk', {
        propertyId,
        roomTypeId: rt.id,
        ...(d.prefix.trim() ? { prefix: d.prefix.trim() } : {}),
        from: d.from,
        to: d.to,
        ...(d.floor.trim() ? { floor: d.floor.trim() } : {}),
      });
      setNotes((n) => ({
        ...n,
        [rt.id]: { kind: 'success', text: t('rooms.created', { count: r.created }) },
      }));
      setDrafts((all) => ({
        ...all,
        [rt.id]: { prefix: d.prefix, from: null, to: null, floor: d.floor },
      }));
      await Promise.all([
        qc.invalidateQueries({ queryKey: roomsKey(propertyId) }),
        qc.invalidateQueries({ queryKey: quotaKey }),
      ]);
    } catch (e) {
      const q = quotaOf(e);
      const text = q
        ? t('rooms.quotaExceeded', { limit: q.limit ?? '?', used: q.used ?? '?' })
        : e instanceof ApiError && e.status === 409
          ? t('rooms.exists')
          : message(e);
      setNotes((n) => ({ ...n, [rt.id]: { kind: 'error', text } }));
      if (q) await qc.invalidateQueries({ queryKey: quotaKey });
    } finally {
      setBusy(null);
    }
  }

  const items = types.data?.items ?? [];
  if (!types.isLoading && items.length === 0)
    return <Alert type="info" showIcon message={t('rooms.needTypes')} />;

  const remaining = quota && quota.limit !== null ? Math.max(quota.limit - quota.used, 0) : null;
  return (
    <>
      {quota ? (
        <div style={{ marginBottom: 16 }} data-testid="units-quota">
          <Flex justify="space-between">
            <Typography.Text id="units-quota-label">{t('rooms.quota')}</Typography.Text>
            <Typography.Text>
              {quota.used} / {quota.limit === null ? t('rooms.quotaUnlimited') : quota.limit}
            </Typography.Text>
          </Flex>
          {quota.limit !== null ? (
            <Progress
              aria-labelledby="units-quota-label"
              percent={Math.min(100, Math.round((quota.used / Math.max(quota.limit, 1)) * 100))}
              showInfo={false}
              status={quota.used >= quota.limit ? 'exception' : 'normal'}
            />
          ) : null}
          {remaining !== null ? (
            <Typography.Text type="secondary">
              {t('rooms.remaining', { count: remaining })}
            </Typography.Text>
          ) : null}
        </div>
      ) : null}
      {items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : null}
      <Flex vertical gap={12}>
        {items.map((rt) => {
          const d = draftOf(rt.id);
          const note = notes[rt.id];
          const count = d.from !== null && d.to !== null && d.to >= d.from ? d.to - d.from + 1 : 0;
          return (
            <Card
              size="small"
              key={rt.id}
              title={rt.name}
              extra={
                <Typography.Text type="secondary">
                  {t('rooms.count', { count: perType.get(rt.id) ?? 0 })}
                </Typography.Text>
              }
            >
              <Form layout="vertical" component={false}>
                <Flex gap={12} wrap="wrap" align="flex-end">
                  <Form.Item
                    label={t('rooms.prefix')}
                    htmlFor={`pre-${rt.id}`}
                    style={{ flex: '1 1 110px', marginBottom: 8 }}
                  >
                    <Input
                      id={`pre-${rt.id}`}
                      value={d.prefix}
                      maxLength={10}
                      onChange={(e) => patch(rt.id, { prefix: e.target.value })}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('rooms.from')}
                    htmlFor={`from-${rt.id}`}
                    style={{ flex: '1 1 90px', marginBottom: 8 }}
                  >
                    <InputNumber
                      id={`from-${rt.id}`}
                      min={0}
                      max={99999}
                      precision={0}
                      style={{ width: '100%' }}
                      value={d.from}
                      onChange={(v) => patch(rt.id, { from: v })}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('rooms.to')}
                    htmlFor={`to-${rt.id}`}
                    style={{ flex: '1 1 90px', marginBottom: 8 }}
                  >
                    <InputNumber
                      id={`to-${rt.id}`}
                      min={0}
                      max={99999}
                      precision={0}
                      style={{ width: '100%' }}
                      value={d.to}
                      onChange={(v) => patch(rt.id, { to: v })}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('rooms.floor')}
                    htmlFor={`floor-${rt.id}`}
                    style={{ flex: '1 1 90px', marginBottom: 8 }}
                  >
                    <Input
                      id={`floor-${rt.id}`}
                      value={d.floor}
                      maxLength={20}
                      onChange={(e) => patch(rt.id, { floor: e.target.value })}
                    />
                  </Form.Item>
                  <Button
                    type="primary"
                    style={{ marginBottom: 8 }}
                    loading={busy === rt.id}
                    onClick={() => void create(rt)}
                    aria-label={`${t('rooms.create')} ${rt.name}`}
                  >
                    {t('rooms.create')}
                  </Button>
                </Flex>
              </Form>
              {count > 0 ? (
                <Typography.Text type="secondary">
                  {t('rooms.preview', {
                    count,
                    first: `${d.prefix}${d.from}`,
                    last: `${d.prefix}${d.to}`,
                  })}
                </Typography.Text>
              ) : null}
              {note ? (
                <Alert
                  role={note.kind === 'error' ? 'alert' : 'status'}
                  type={note.kind}
                  showIcon
                  message={note.text}
                  style={{ marginTop: 8 }}
                />
              ) : null}
            </Card>
          );
        })}
      </Flex>
    </>
  );
}
