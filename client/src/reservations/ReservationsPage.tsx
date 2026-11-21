import { PlusOutlined } from '@ant-design/icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Alert, Button, Flex, Input, Select, Table, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@hm/ui';

import { useApiError } from '../auth/useApiError';
import { useCan } from '../auth/useCan';
import { formatMoney } from '../pages/settings/util';
import { NewReservationWizard } from './NewReservationWizard';
import { ReservationDrawer } from './ReservationDrawer';
import { RESERVATION_STATUSES, formatDayShort, get, keys, nightsBetween, qs } from './api';
import type { Page, Reservation } from './api';
import { PropertySelect, useActiveProperty } from './property';
import { useLabel, useLookup } from './refs';
import { ReservationStatusTag } from './status';

const { Text } = Typography;

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Reservations list (OP-13): filters, table with status tags, detail drawer. */
export function ReservationsPage() {
  const { t, i18n } = useTranslation('reservations');
  const toMessage = useApiError();
  const label = useLabel();
  const navigate = useNavigate();
  const { can } = useCan();
  const { propertyId } = useActiveProperty();
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [source, setSource] = useState<string>();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim());
  const sources = useLookup('reservation_source');

  const query = useInfiniteQuery({
    queryKey: [...keys.reservations, propertyId, from, to, statuses, source, debounced],
    queryFn: ({ pageParam }) =>
      get<Page<Reservation>>(
        `/reservations${qs({
          propertyId,
          from,
          to,
          status: statuses.join(','),
          source,
          search: debounced.length >= 2 ? debounced : undefined,
          limit: 50,
          cursor: pageParam,
        })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!propertyId,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title={t('list.title')}
        subtitle={t('list.subtitle')}
        actions={
          can('reservations.create') ? (
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
      <Flex wrap gap={12} align="center" style={{ marginBottom: 16 }}>
        <PropertySelect />
        <Input
          type="date"
          aria-label={t('filters.from')}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          style={{ width: 150 }}
        />
        <Input
          type="date"
          aria-label={t('filters.to')}
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          style={{ width: 150 }}
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          aria-label={t('filters.status')}
          placeholder={t('filters.status')}
          value={statuses}
          onChange={setStatuses}
          options={RESERVATION_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))}
          style={{ minWidth: 200 }}
        />
        <Select
          allowClear
          aria-label={t('filters.source')}
          placeholder={t('filters.source')}
          value={source}
          onChange={setSource}
          options={(sources.data ?? []).map((s) => ({ value: s.code, label: label(s.label) }))}
          style={{ minWidth: 160 }}
        />
        <Input.Search
          allowClear
          aria-label={t('filters.search')}
          placeholder={t('filters.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260 }}
        />
      </Flex>
      {query.isError ? (
        <Alert
          type="error"
          showIcon
          message={toMessage(query.error)}
          action={<Button onClick={() => void query.refetch()}>{t('retry')}</Button>}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Table<Reservation>
        rowKey="id"
        size="middle"
        loading={query.isLoading}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: t('list.empty') }}
        onRow={(r) => ({ onClick: () => setParams({ open: r.id }), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: t('list.number'),
            dataIndex: 'number',
            render: (n: string, r) => (
              <Button type="link" style={{ padding: 0 }} onClick={() => setParams({ open: r.id })}>
                {n}
              </Button>
            ),
          },
          {
            title: t('list.guest'),
            key: 'guest',
            render: (_: unknown, r) =>
              r.booker ? (
                `${r.booker.firstName} ${r.booker.lastName}`
              ) : (
                <Text type="secondary">{t('detail.allotment')}</Text>
              ),
          },
          {
            title: t('list.stay'),
            key: 'stay',
            render: (_: unknown, r) =>
              `${formatDayShort(r.arrival, i18n.language)} → ${formatDayShort(r.departure, i18n.language)} (${nightsBetween(r.arrival, r.departure)})`,
          },
          {
            title: t('list.rooms'),
            key: 'rooms',
            render: (_: unknown, r) =>
              r.rooms.map((x) => x.roomNumber ?? t('unassigned')).join(', '),
          },
          {
            title: t('status.label'),
            key: 'status',
            render: (_: unknown, r) => <ReservationStatusTag status={r.status} />,
          },
          { title: t('list.source'), dataIndex: 'source', render: (s: string | null) => s ?? '-' },
          {
            title: t('list.total'),
            key: 'total',
            align: 'end',
            render: (_: unknown, r) => formatMoney(r.roomTotal, r.currency),
          },
          {
            title: t('list.actions'),
            key: 'actions',
            render: (_: unknown, r) => (
              <Button
                size="small"
                onClick={(e) => (e.stopPropagation(), setParams({ open: r.id }))}
              >
                {t('list.view')}
              </Button>
            ),
          },
        ]}
      />
      {query.hasNextPage ? (
        <Flex justify="center" style={{ marginTop: 12 }}>
          <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {t('list.more')}
          </Button>
        </Flex>
      ) : null}
      <ReservationDrawer
        id={openId}
        onClose={() => setParams({})}
        onChanged={() => void query.refetch()}
      />
    </>
  );
}

/** `/reservations/new`: the wizard as a full page. */
export function NewReservationPage() {
  const { t } = useTranslation('reservations');
  return (
    <>
      <PageHeader
        title={t('wizard.title')}
        breadcrumb={[
          { title: t('list.title'), href: '/reservations' },
          { title: t('wizard.title') },
        ]}
      />
      <div style={{ maxWidth: 900 }}>
        <NewReservationWizard />
      </div>
    </>
  );
}
