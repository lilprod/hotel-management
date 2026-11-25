import { PlusOutlined, PrinterOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Descriptions,
  Dropdown,
  Row,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { EmptyState, PageHeader } from '@hm/ui';

import { useApiError } from '../../auth/useApiError';
import { useCan } from '../../auth/useCan';
import { formatDayLong, get, keys, post } from '../../reservations/api';
import type { Reservation } from '../../reservations/api';
import { useFolioRealtime } from '../../reservations/realtime';
import { bkKeys, openDocument, useFolio, useFolioSiblings, useProducts } from './api';
import type { Folio, FolioLine, FolioPayment, Invoice, Page } from './api';
import { ChargeDialog, DiscountDialog, ReasonModal } from './FolioDialogs';
import { CreditNoteDialog, InvoiceDialog } from './InvoiceDialogs';
import { groupLines, isLiveCharge, isReversed, money, taxLabel } from './model';
import type { LineNode } from './model';
import { PaymentForm } from './PaymentForm';

const { Text } = Typography;

type Row =
  | { kind: 'day'; key: string; date: string; total: number }
  | { kind: 'charge'; key: string; node: LineNode }
  | { kind: 'child'; key: string; line: FolioLine };

/** Route `/folios/by-room/:rrId`: resolves (creates if needed) the main folio of a stay, then opens it. */
export function FolioByRoomPage() {
  const { rrId } = useParams();
  const nav = useNavigate();
  const { t } = useTranslation('billing');
  const resolve = useQuery({
    queryKey: ['billing', 'resolve', rrId],
    queryFn: () => post<{ id: string }>('/folios/resolve', { reservationRoomId: rrId }),
    enabled: !!rrId,
    gcTime: 0,
  });
  if (resolve.data) {
    nav(`/folios/${resolve.data.id}`, { replace: true });
    return null;
  }
  if (resolve.isError) return <Alert type="error" showIcon message={t('folio.loadError')} />;
  return <Skeleton active />;
}

/**
 * Folio (OP-90…OP-92): header, one tab per folio of the stay (split), lines by business date with
 * their taxes nested under the charge, payments, "Encaisser", "Facturer". Refreshed live on `folio.changed`.
 */
export function FolioPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation('billing');
  const nav = useNavigate();
  const { can } = useCan();
  const toMessage = useApiError();
  const qc = useQueryClient();
  const { message } = AntApp.useApp();
  const folioQ = useFolio(id ?? null);
  const folio = folioQ.data;
  const siblings = useFolioSiblings(folio?.reservationRoomId ?? null);
  const reservation = useQuery({
    queryKey: keys.reservation(folio?.reservationId ?? ''),
    queryFn: () => get<Reservation>(`/reservations/${folio!.reservationId}`),
    enabled: !!folio?.reservationId && can('reservations.read'),
  });
  const invoices = useQuery({
    queryKey: bkKeys.invoices({ folioId: id }),
    queryFn: () => get<Page<Invoice>>(`/invoices?folioId=${id}`),
    enabled: !!id && can('invoices.read'),
  });
  const products = useProducts(folio?.propertyId ?? null, can('settings.read'));

  const [selected, setSelected] = useState<string[]>([]);
  const [discountLine, setDiscountLine] = useState<FolioLine | null>(null);
  const [reverseLine, setReverseLine] = useState<FolioLine | null>(null);
  const [reversePay, setReversePay] = useState<FolioPayment | null>(null);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [creditNote, setCreditNote] = useState<Invoice | null>(null);
  const [lastPayment, setLastPayment] = useState<{ change: number; currency: string } | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: bkKeys.all });
    void qc.invalidateQueries({ queryKey: ['front-desk'] });
  };
  // Live refresh: any change of a folio of the property refetches this page.
  useFolioRealtime(folio?.propertyId ?? null, (c) => {
    if (c.folioId === id || (siblings.data?.items ?? []).some((f) => f.id === c.folioId)) refresh();
  });

  const moveTo = useMutation({
    mutationFn: (v: { lineIds: string[]; targetFolioId: string }) =>
      post(`/folios/${id}/lines/move`, { ...v, reason: t('folio.moveReason') }),
    onSuccess: () => {
      setSelected([]);
      refresh();
      void message.success(t('folio.moved'));
    },
    onError: (e) => void message.error(toMessage(e)),
  });
  const split = useMutation({
    mutationFn: () => post<Folio>('/folios', { reservationRoomId: folio!.reservationRoomId }),
    onSuccess: (f) => {
      refresh();
      nav(`/folios/${f.id}`);
    },
    onError: (e) => void message.error(toMessage(e)),
  });

  const groups = useMemo(() => groupLines(folio?.lines ?? []), [folio?.lines]);
  const rows: Row[] = useMemo(
    () =>
      groups.flatMap((g) => [
        { kind: 'day' as const, key: `d:${g.date}`, date: g.date, total: g.total },
        ...g.nodes.flatMap((n) => [
          { kind: 'charge' as const, key: n.line.id, node: n },
          ...n.children.map((c) => ({ kind: 'child' as const, key: c.id, line: c })),
        ]),
      ]),
    [groups],
  );

  if (folioQ.isLoading) return <Skeleton active />;
  if (folioQ.isError || !folio)
    return (
      <EmptyState
        title={t('folio.loadError')}
        action={<Link to="/front-desk">{t('folio.backToDesk')}</Link>}
      />
    );

  const open = folio.status === 'OPEN';
  const cur = folio.currency;
  const res = reservation.data;
  const room = res?.rooms.find((r) => r.id === folio.reservationRoomId) ?? res?.rooms[0];
  const guest = res?.booker ? `${res.booker.firstName} ${res.booker.lastName}` : null;
  const others = (siblings.data?.items ?? []).filter(
    (f) => f.id !== folio.id && f.status === 'OPEN',
  );
  const departments = [
    ...new Set([
      ...(products.data?.items ?? []).map((p) => p.departmentCode),
      ...folio.lines.map((l) => l.departmentCode),
    ]),
  ].filter((d): d is string => !!d);

  const columns = [
    {
      title: t('folio.label'),
      key: 'label',
      render: (_: unknown, r: Row) => {
        if (r.kind === 'day') return <Text strong>{formatDayLong(r.date, i18n.language)}</Text>;
        const l = r.kind === 'charge' ? r.node.line : r.line;
        const text = (
          <span
            style={{
              paddingInlineStart: r.kind === 'child' ? 24 : 0,
              textDecoration: l.reversedById ? 'line-through' : undefined,
              color:
                r.kind === 'child' || l.reversedById
                  ? 'var(--ant-color-text-secondary)'
                  : undefined,
            }}
          >
            {l.label}
            {l.reversalOfId ? (
              <Tag style={{ marginInlineStart: 8 }}>{t('folio.reversal')}</Tag>
            ) : null}
          </span>
        );
        return text;
      },
      onCell: (r: Row) => (r.kind === 'day' ? { colSpan: 4 } : {}),
    },
    {
      title: t('folio.department'),
      key: 'dept',
      width: 110,
      render: (_: unknown, r: Row) => (r.kind === 'charge' ? r.node.line.departmentCode : null),
      onCell: (r: Row) => (r.kind === 'day' ? { colSpan: 0 } : {}),
    },
    {
      title: t('folio.qty'),
      key: 'qty',
      width: 70,
      align: 'right' as const,
      render: (_: unknown, r: Row) => (r.kind === 'charge' ? r.node.line.qty : null),
      onCell: (r: Row) => (r.kind === 'day' ? { colSpan: 0 } : {}),
    },
    {
      title: t('folio.amount'),
      key: 'amount',
      width: 150,
      align: 'right' as const,
      render: (_: unknown, r: Row) =>
        r.kind === 'day' ? (
          <Text strong>{money(r.total, cur)}</Text>
        ) : (
          money((r.kind === 'charge' ? r.node.line : r.line).amount, cur)
        ),
      onCell: (r: Row) => (r.kind === 'day' ? { colSpan: 1 } : {}),
    },
    {
      title: '',
      key: 'actions',
      width: 210,
      render: (_: unknown, r: Row) => {
        if (r.kind !== 'charge' || !open || !isLiveCharge(r.node.line)) return null;
        const l = r.node.line;
        return (
          <Space size={4}>
            {can('folio.discount') ? (
              <Button size="small" onClick={() => setDiscountLine(l)}>
                {t('folio.discount')}
              </Button>
            ) : null}
            {can('folio.reverse') ? (
              <Button size="small" danger onClick={() => setReverseLine(l)}>
                {t('folio.reverse')}
              </Button>
            ) : null}
          </Space>
        );
      },
      onCell: (r: Row) => (r.kind === 'day' ? { colSpan: 0 } : {}),
    },
  ];

  const tabs = (siblings.data?.items.length ? siblings.data.items : [folio]).map((f) => ({
    key: f.id,
    label: (
      <span
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const lineId = e.dataTransfer.getData('text/plain');
          if (lineId && f.id !== folio.id && f.status === 'OPEN')
            moveTo.mutate({ lineIds: [lineId], targetFolioId: f.id });
        }}
      >
        {f.number}
        {f.status === 'CLOSED' ? (
          <Tag style={{ marginInlineStart: 6 }}>{t('folio.closed')}</Tag>
        ) : null}
      </span>
    ),
  }));

  return (
    <>
      <PageHeader
        title={t('folio.title', { number: folio.number })}
        actions={
          <Space wrap>
            {can('invoices.issue') && open ? (
              <Button type="primary" onClick={() => setInvoiceOpen(true)}>
                {t('folio.invoice')}
              </Button>
            ) : null}
            {can('folio.post') && open ? (
              <Button icon={<PlusOutlined />} onClick={() => setChargeOpen(true)}>
                {t('folio.addCharge')}
              </Button>
            ) : null}
          </Space>
        }
      />
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={16}>
            <Descriptions size="small" column={{ xs: 1, md: 2 }}>
              <Descriptions.Item label={t('folio.guest')}>{guest ?? '-'}</Descriptions.Item>
              <Descriptions.Item label={t('folio.room')}>
                {room?.roomNumber ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('folio.stay')}>
                {room
                  ? `${formatDayLong(room.arrival, i18n.language)} - ${formatDayLong(room.departure, i18n.language)}`
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('folio.reservation')}>
                {folio.reservationNumber ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('folio.number')}>{folio.number}</Descriptions.Item>
              <Descriptions.Item label={t('folio.status')}>
                <Tag color={open ? 'green' : 'default'}>{t(`folio.statuses.${folio.status}`)}</Tag>
              </Descriptions.Item>
            </Descriptions>
          </Col>
          <Col xs={24} md={8}>
            <Statistic
              title={t('folio.balance')}
              value={money(folio.balance, cur)}
              valueStyle={{
                color: folio.balance > 0 ? '#cf1322' : folio.balance < 0 ? '#d46b08' : '#389e0d',
              }}
            />
            <Text type="secondary">
              {t('folio.totals', {
                charges: money(folio.chargesTotal, cur),
                payments: money(folio.paymentsTotal, cur),
              })}
            </Text>
          </Col>
        </Row>
      </Card>

      <Tabs
        activeKey={folio.id}
        onChange={(k) => nav(`/folios/${k}`)}
        items={tabs}
        tabBarExtraContent={
          can('folio.post') && folio.reservationRoomId ? (
            <Button size="small" loading={split.isPending} onClick={() => split.mutate()}>
              {t('folio.split')}
            </Button>
          ) : null
        }
      />

      {selected.length > 0 && others.length > 0 ? (
        <Alert
          style={{ marginBottom: 8 }}
          type="info"
          message={t('folio.selected', { count: selected.length })}
          action={
            <Dropdown
              menu={{
                items: others.map((f) => ({ key: f.id, label: f.number })),
                onClick: ({ key }) => moveTo.mutate({ lineIds: selected, targetFolioId: key }),
              }}
            >
              <Button size="small">{t('folio.moveTo')}</Button>
            </Dropdown>
          }
        />
      ) : null}

      <Table<Row>
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={rows}
        columns={columns}
        locale={{ emptyText: t('folio.noLines') }}
        rowSelection={
          open && can('folio.post') && others.length > 0
            ? {
                selectedRowKeys: selected,
                onChange: (k) => setSelected(k as string[]),
                getCheckboxProps: (r) => ({
                  disabled: r.kind !== 'charge' || !isLiveCharge(r.node.line),
                  style:
                    r.kind === 'charge' && isLiveCharge(r.node.line)
                      ? undefined
                      : { display: 'none' },
                }),
              }
            : undefined
        }
        onRow={(r) =>
          r.kind === 'charge' && open && isLiveCharge(r.node.line) && others.length > 0
            ? {
                draggable: true,
                onDragStart: (e) => e.dataTransfer.setData('text/plain', r.node.line.id),
              }
            : {}
        }
        rowClassName={(r) => (r.kind === 'day' ? 'ant-table-row-day' : '')}
        style={{ marginBottom: 16 }}
      />
      <Table
        size="small"
        pagination={false}
        rowKey="label"
        showHeader={false}
        dataSource={[
          ...folio.taxBreakdown.rows.map((r) => ({
            label: taxLabel(r.name, r.rate),
            amount: r.amount,
          })),
          { label: t('folio.totalTtc'), amount: folio.chargesTotal },
        ]}
        columns={[
          { dataIndex: 'label' },
          { dataIndex: 'amount', align: 'right', width: 150, render: (v: number) => money(v, cur) },
        ]}
        style={{ marginBottom: 24, maxWidth: 520, marginInlineStart: 'auto' }}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title={t('folio.payments')} size="small">
            <Table<FolioPayment>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={folio.payments}
              locale={{ emptyText: t('folio.noPayments') }}
              columns={[
                {
                  title: t('folio.date'),
                  dataIndex: 'paidAt',
                  render: (v: string) => v.slice(0, 16).replace('T', ' '),
                },
                {
                  title: t('pay.method'),
                  dataIndex: 'method',
                  render: (m: string) => t(`methods.${m}`, { defaultValue: m }),
                },
                { title: t('pay.reference'), dataIndex: 'reference' },
                {
                  title: t('folio.amount'),
                  dataIndex: 'amount',
                  align: 'right',
                  render: (v: number, p) => (
                    <span style={{ textDecoration: isReversed(p) ? 'line-through' : undefined }}>
                      {money(v, p.currency)}
                      {p.tenderedCurrency && p.tenderedAmount !== null ? (
                        <div>
                          <Text type="secondary">
                            {money(p.tenderedAmount, p.tenderedCurrency)}
                          </Text>
                        </div>
                      ) : null}
                    </span>
                  ),
                },
                {
                  title: '',
                  key: 'a',
                  width: 190,
                  render: (_: unknown, p) => (
                    <Space size={4}>
                      <Dropdown
                        menu={{
                          items: [
                            { key: 'ticket', label: t('receipt.ticket') },
                            { key: 'a4', label: t('receipt.a4') },
                          ],
                          onClick: ({ key }) =>
                            void openDocument(
                              `/folios/${folio.id}/payments/${p.id}/receipt?format=${key}`,
                              'post',
                            ).catch((e) => void message.error(toMessage(e))),
                        }}
                      >
                        <Button
                          size="small"
                          icon={<PrinterOutlined />}
                          aria-label={t('receipt.print')}
                        />
                      </Dropdown>
                      {can('folio.reverse') && !isReversed(p) && p.amount > 0 && open ? (
                        <Button size="small" danger onClick={() => setReversePay(p)}>
                          {t('folio.reverse')}
                        </Button>
                      ) : null}
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
          {can('invoices.read') && (invoices.data?.items.length ?? 0) > 0 ? (
            <Card title={t('folio.invoices')} size="small" style={{ marginTop: 16 }}>
              <Table<Invoice>
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={invoices.data!.items}
                columns={[
                  { title: t('invoices.number'), dataIndex: 'number' },
                  {
                    title: t('invoices.total'),
                    dataIndex: 'total',
                    align: 'right',
                    render: (v: number, i) => money(v, i.currency),
                  },
                  {
                    title: '',
                    key: 'a',
                    render: (_: unknown, i) => (
                      <Space size={4}>
                        <Button
                          size="small"
                          onClick={() => void openDocument(`/invoices/${i.id}/pdf`)}
                        >
                          PDF
                        </Button>
                        {can('invoices.credit_note') && i.kind === 'INVOICE' ? (
                          <Button size="small" danger onClick={() => setCreditNote(i)}>
                            {t('invoices.creditNote')}
                          </Button>
                        ) : null}
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}
        </Col>
        <Col xs={24} lg={10}>
          {can('folio.pay') && open ? (
            <Card title={t('pay.title')} size="small">
              {lastPayment && lastPayment.change > 0 ? (
                <Alert
                  type="success"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={t('pay.changeGiven', {
                    amount: money(lastPayment.change, lastPayment.currency),
                  })}
                />
              ) : null}
              <PaymentForm
                key={folio.payments.length}
                folio={folio}
                onPaid={(r) => {
                  setLastPayment({ change: r.change, currency: r.changeCurrency });
                  refresh();
                  void message.success(t('pay.done'));
                }}
              />
            </Card>
          ) : !open ? (
            <Alert type="info" showIcon message={t('folio.closedInfo')} />
          ) : (
            <Tooltip title={t('noPermission')}>
              <Alert type="warning" showIcon message={t('pay.noPermission')} />
            </Tooltip>
          )}
        </Col>
      </Row>

      <DiscountDialog
        folio={folio}
        line={discountLine}
        onClose={() => setDiscountLine(null)}
        onDone={() => {
          setDiscountLine(null);
          refresh();
        }}
      />
      <ReasonModal
        open={!!reverseLine}
        title={t('reverse.title', { label: reverseLine?.label ?? '' })}
        okText={t('folio.reverse')}
        danger
        onCancel={() => setReverseLine(null)}
        onSubmit={async (reason) => {
          await post(`/folios/${folio.id}/lines/${reverseLine!.id}/reverse`, { reason });
          setReverseLine(null);
          refresh();
        }}
      >
        <Text type="secondary">{t('reverse.hint')}</Text>
      </ReasonModal>
      <ReasonModal
        open={!!reversePay}
        title={t('reverse.payTitle')}
        okText={t('folio.reverse')}
        danger
        onCancel={() => setReversePay(null)}
        onSubmit={async (reason) => {
          await post(`/folios/${folio.id}/payments/${reversePay!.id}/reverse`, { reason });
          setReversePay(null);
          refresh();
        }}
      />
      <ChargeDialog
        folio={folio}
        open={chargeOpen}
        products={products.data?.items ?? []}
        departments={departments}
        onClose={() => setChargeOpen(false)}
        onDone={() => {
          setChargeOpen(false);
          refresh();
        }}
      />
      <InvoiceDialog
        folio={folio}
        open={invoiceOpen}
        guestName={guest ?? undefined}
        onClose={() => setInvoiceOpen(false)}
      />
      <CreditNoteDialog invoice={creditNote} onClose={() => setCreditNote(null)} />
    </>
  );
}
