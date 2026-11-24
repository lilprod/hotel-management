import {
  BookOutlined,
  LoginOutlined,
  LogoutOutlined,
  PlusOutlined,
  PrinterOutlined,
  SwapOutlined,
  CalendarOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Flex,
  Input,
  Popconfirm,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { EmptyState, PageHeader } from '@hm/ui';

import { useCan } from '../../auth/useCan';
import { formatDayShort, nightsBetween, post } from '../../reservations/api';
import { PropertySelect, useActiveProperty } from '../../reservations/property';
import { usePlanningRealtime } from '../../reservations/realtime';
import { ReservationDrawer } from '../../reservations/ReservationDrawer';
import { formatMoney } from '../settings/util';
import { CheckInDrawer, targetFromRow } from './CheckInDrawer';
import { CheckOutDrawer } from './CheckOutDrawer';
import { RoomChangeDialog, StayDatesDialog } from './StayDialogs';
import { WalkInDrawer } from './WalkInDrawer';
import { DAY_LISTS, fdKeys, openPoliceForm, useDayList, useSummary } from './api';
import type { DayListKind, DayRow } from './api';
import { useFdError } from './useFdError';

type Panel =
  | { kind: 'checkin'; row: DayRow }
  | { kind: 'checkout'; row: DayRow }
  | { kind: 'room'; row: DayRow }
  | { kind: 'dates'; row: DayRow }
  | { kind: 'walkin' }
  | { kind: 'reservation'; id: string }
  | null;

const TAB_BY_PARAM: Record<string, DayListKind> = {
  arrivals: 'arrivals',
  departures: 'departures',
  'in-house': 'in-house',
  'no-shows': 'no-shows',
};

const COUNT_KEY: Record<DayListKind, 'arrivals' | 'departures' | 'inHouse' | 'noShows'> = {
  arrivals: 'arrivals',
  departures: 'departures',
  'in-house': 'inHouse',
  'no-shows': 'noShows',
};

/**
 * Réception (OP-20): KPI header, tabs Arrivées / Départs / Présents / Non-présentations with
 * counts, search and quick actions (check-in, check-out, room change, extension, walk-in).
 */
export function FrontDeskPage() {
  const { t, i18n } = useTranslation('frontDesk');
  const { can } = useCan();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const toMessage = useFdError();
  const { propertyId } = useActiveProperty();
  const [params, setParams] = useSearchParams();
  const tab = TAB_BY_PARAM[params.get('tab') ?? ''] ?? 'arrivals';
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<Panel>(null);

  const summary = useSummary(propertyId);
  const list = useDayList(tab, propertyId, search);
  const refresh = () => void qc.invalidateQueries({ queryKey: fdKeys.all });
  usePlanningRealtime(propertyId, refresh);

  const noShow = useMutation({
    mutationFn: (row: DayRow) => post(`/reservations/${row.reservationId}/no-show`, { waivePenalty: false }),
    onSuccess: () => {
      void message.success(t('noShow.done'));
      refresh();
    },
    onError: (e) => void message.error(toMessage(e)),
  });

  const close = () => setPanel(null);
  const bd = summary.data?.businessDate;

  const actions = (row: DayRow) => {
    const out: React.ReactNode[] = [];
    if ((tab === 'arrivals' || tab === 'no-shows') && can('front_desk.check_in'))
      out.push(
        <Button
          key="in"
          type={tab === 'arrivals' ? 'primary' : 'default'}
          size="small"
          icon={<LoginOutlined />}
          onClick={() => setPanel({ kind: 'checkin', row })}
        >
          {t('actions.checkIn')}
        </Button>,
      );
    if (tab === 'no-shows' && can('reservations.cancel'))
      out.push(
        <Popconfirm
          key="ns"
          title={t('noShow.confirm', { number: row.number })}
          okText={t('noShow.action')}
          cancelText={t('close')}
          onConfirm={() => noShow.mutate(row)}
        >
          <Button size="small" danger>
            {t('noShow.action')}
          </Button>
        </Popconfirm>,
      );
    if ((tab === 'departures' || tab === 'in-house') && can('front_desk.check_out'))
      out.push(
        <Button
          key="out"
          type={tab === 'departures' ? 'primary' : 'default'}
          size="small"
          icon={<LogoutOutlined />}
          onClick={() => setPanel({ kind: 'checkout', row })}
        >
          {t('actions.checkOut')}
        </Button>,
      );
    if ((tab === 'departures' || tab === 'in-house') && can('front_desk.move')) {
      out.push(
        <Tooltip key="room" title={t('actions.roomChange')}>
          <Button
            size="small"
            icon={<SwapOutlined />}
            aria-label={t('actions.roomChange')}
            onClick={() => setPanel({ kind: 'room', row })}
          />
        </Tooltip>,
        <Tooltip key="dates" title={t('actions.dates')}>
          <Button
            size="small"
            icon={<CalendarOutlined />}
            aria-label={t('actions.dates')}
            onClick={() => setPanel({ kind: 'dates', row })}
          />
        </Tooltip>,
      );
    }
    if ((tab === 'in-house' || tab === 'departures') && can('folio.read'))
      out.push(
        <Tooltip key="folio" title={t('actions.folio')}>
          <Link to={`/folios/by-room/${row.reservationRoomId}`} aria-label={t('actions.folio')}>
            <Button size="small" icon={<FileTextOutlined />} />
          </Link>
        </Tooltip>,
      );
    if (tab === 'in-house' && can('front_desk.police_form'))
      out.push(
        <Tooltip key="police" title={t('actions.policeForm')}>
          <Button
            size="small"
            icon={<PrinterOutlined />}
            aria-label={t('actions.policeForm')}
            onClick={() => void openPoliceForm(row.reservationRoomId).catch((e: unknown) => void message.error(toMessage(e)))}
          />
        </Tooltip>,
      );
    return <Space size={4} wrap>{out}</Space>;
  };

  const rows = list.data?.items ?? [];
  const kpi = (key: string, value: number | undefined, tabKey?: DayListKind) => (
    <Col xs={12} md={8} xl={4} key={key}>
      <Card size="small" hoverable={!!tabKey} onClick={tabKey ? () => setParams({ tab: tabKey }) : undefined}>
        <Statistic title={t(`kpi.${key}`)} value={value ?? 0} loading={summary.isLoading} />
      </Card>
    </Col>
  );

  if (!propertyId) return <EmptyState title={t('noProperty')} />;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={bd ? t('subtitle', { date: bd }) : undefined}
        actions={
          <Space wrap>
            <PropertySelect />
            {can('front_desk.check_in') && can('reservations.create') ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setPanel({ kind: 'walkin' })}>
                {t('actions.walkIn')}
              </Button>
            ) : null}
            {can('front_desk.police_form') ? (
              <Link to="/front-desk/police-register">
                <Button icon={<BookOutlined />}>{t('actions.policeRegister')}</Button>
              </Link>
            ) : null}
          </Space>
        }
      />
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }} aria-label={t('kpi.title')}>
        {kpi('arrivals', summary.data?.arrivals, 'arrivals')}
        {kpi('departures', summary.data?.departures, 'departures')}
        {kpi('inHouse', summary.data?.inHouse, 'in-house')}
        {kpi('noShows', summary.data?.noShows, 'no-shows')}
        {kpi('cleanRooms', summary.data?.availableCleanRooms)}
      </Row>
      <Flex gap={12} wrap style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          aria-label={t('search')}
          placeholder={t('search')}
          style={{ maxWidth: 360 }}
          onSearch={setSearch}
        />
      </Flex>
      <Tabs
        activeKey={tab}
        onChange={(k) => setParams({ tab: k })}
        items={DAY_LISTS.map((k) => ({
          key: k,
          label: `${t(`tabs.${k}`)} (${summary.data?.[COUNT_KEY[k]] ?? 0})`,
        }))}
      />
      {list.isError ? (
        <Alert
          type="error"
          showIcon
          message={toMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>{t('retry')}</Button>}
        />
      ) : (
        <Table<DayRow>
          size="middle"
          rowKey="reservationRoomId"
          loading={list.isLoading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 'max-content' }}
          aria-label={t(`tabs.${tab}`)}
          locale={{ emptyText: t(`empty.${tab}`) }}
          columns={[
            {
              title: t('columns.reservation'),
              render: (_, r) => (
                <Space direction="vertical" size={0}>
                  <Button type="link" style={{ padding: 0 }} onClick={() => setPanel({ kind: 'reservation', id: r.reservationId })}>
                    {r.number}
                  </Button>
                  {r.late ? <Tag color="warning">{t(tab === 'departures' ? 'overdue' : 'late')}</Tag> : null}
                </Space>
              ),
            },
            {
              title: t('columns.guest'),
              render: (_, r) => (
                <Space direction="vertical" size={0}>
                  <strong>{r.guest.name}</strong>
                  {r.companyName ? <span>{r.companyName}</span> : null}
                </Space>
              ),
            },
            {
              title: t('columns.room'),
              render: (_, r) => (
                <Space direction="vertical" size={0}>
                  <span>{r.roomNumber ?? t('unassigned')}</span>
                  <span>{r.roomTypeName}</span>
                  {r.hkStatus && r.hkStatus !== 'CLEAN' && r.hkStatus !== 'INSPECTED' ? (
                    <Tag color="warning">{t(`hk.${r.hkStatus}`)}</Tag>
                  ) : null}
                </Space>
              ),
            },
            {
              title: t('columns.stay'),
              render: (_, r) =>
                `${formatDayShort(r.arrival, i18n.language)} → ${formatDayShort(r.departure, i18n.language)} (${t('nights', { count: nightsBetween(r.arrival, r.departure) })})`,
            },
            {
              title: t('columns.persons'),
              render: (_, r) => t('persons', { adults: r.adults, children: r.children }),
            },
            ...(tab === 'departures' || tab === 'in-house'
              ? [
                  {
                    title: t('columns.balance'),
                    align: 'right' as const,
                    render: (_: unknown, r: DayRow) =>
                      r.balance === null ? '—' : formatMoney(r.balance, r.currency),
                  },
                ]
              : []),
            { title: t('columns.actions'), render: (_, r) => actions(r) },
          ]}
        />
      )}

      <CheckInDrawer
        target={panel?.kind === 'checkin' ? targetFromRow(panel.row, propertyId) : null}
        onClose={close}
        onDone={refresh}
      />
      <CheckOutDrawer
        stayRef={panel?.kind === 'checkout' ? (panel.row.stayId ?? panel.row.reservationRoomId) : null}
        onClose={close}
        onDone={refresh}
      />
      <RoomChangeDialog row={panel?.kind === 'room' ? panel.row : null} propertyId={propertyId} onClose={close} onDone={refresh} />
      <StayDatesDialog row={panel?.kind === 'dates' ? panel.row : null} propertyId={propertyId} onClose={close} onDone={refresh} />
      <WalkInDrawer open={panel?.kind === 'walkin'} propertyId={propertyId} onClose={close} onDone={refresh} />
      <ReservationDrawer
        id={panel?.kind === 'reservation' ? panel.id : null}
        onClose={close}
        onChanged={refresh}
      />
    </>
  );
}
