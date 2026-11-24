import { PrinterOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, PageHeader } from '@hm/ui';

import { useApiError } from '../../auth/useApiError';
import { useCan } from '../../auth/useCan';
import { PropertySelect, useActiveProperty } from '../../reservations/property';
import { bkKeys, get, post, qs } from './api';
import type { CashReport, CashSession } from './api';
import { money, toMinor, varianceRows } from './model';

const { Text } = Typography;

const PRINT_CSS = `@media print { body * { visibility: hidden; } .hm-print, .hm-print * { visibility: visible; } .hm-print { position: absolute; inset: 0; padding: 16px; background: #fff; color: #000; } }`;

/** X / Z report: totals per tender, movements, expected and (Z) counted with the variance. Printable. */
export function CashReportView({ report }: { report: CashReport }) {
  const { t } = useTranslation('billing');
  const cur = report.session.currency;
  return (
    <div className="hm-print">
      <style>{PRINT_CSS}</style>
      <Descriptions size="small" column={2} title={t(`cash.report.${report.kind}`)}>
        <Descriptions.Item label={t('cash.openedAt')}>
          {report.session.openedAt.slice(0, 16).replace('T', ' ')}
        </Descriptions.Item>
        <Descriptions.Item label={t('cash.generatedAt')}>
          {report.generatedAt.slice(0, 16).replace('T', ' ')}
        </Descriptions.Item>
        <Descriptions.Item label={t('cash.float')}>
          {money(report.session.openingFloat, cur)}
        </Descriptions.Item>
        {report.session.closedAt ? (
          <Descriptions.Item label={t('cash.closedAt')}>
            {report.session.closedAt.slice(0, 16).replace('T', ' ')}
          </Descriptions.Item>
        ) : null}
      </Descriptions>
      <Table
        size="small"
        pagination={false}
        rowKey={(r) => `${r.method}:${r.currency}`}
        dataSource={report.totals}
        columns={[
          {
            title: t('pay.method'),
            dataIndex: 'method',
            render: (m: string) => t(`methods.${m}`, { defaultValue: m }),
          },
          { title: t('cash.count'), dataIndex: 'count', align: 'right' },
          {
            title: t('cash.received'),
            dataIndex: 'received',
            align: 'right',
            render: (v: number, r) => money(v, r.currency),
          },
          {
            title: t('cash.paidOut'),
            dataIndex: 'paidOut',
            align: 'right',
            render: (v: number, r) => money(v, r.currency),
          },
          {
            title: t('cash.net'),
            dataIndex: 'net',
            align: 'right',
            render: (v: number, r) => money(v, r.currency),
          },
        ]}
      />
      <Divider plain>{t('cash.movements')}</Divider>
      <Space direction="vertical" size={2}>
        {report.movements.in.map((m) => (
          <Text key={`in${m.currency}`}>
            {t('cash.movementIn', { amount: money(m.amount, m.currency), count: m.count })}
          </Text>
        ))}
        {report.movements.out.map((m) => (
          <Text key={`out${m.currency}`}>
            {t('cash.movementOut', { amount: money(m.amount, m.currency), count: m.count })}
          </Text>
        ))}
        {report.movements.in.length + report.movements.out.length === 0 ? (
          <Text type="secondary">{t('cash.noMovements')}</Text>
        ) : null}
      </Space>
      <Divider plain>{t('cash.expected')}</Divider>
      <Table
        size="small"
        pagination={false}
        rowKey={(r) => `${r.method}:${r.currency}`}
        dataSource={
          report.counted ??
          report.expected.map((e) => ({
            ...e,
            counted: null as number | null,
            variance: null as number | null,
          }))
        }
        columns={[
          {
            title: t('pay.method'),
            dataIndex: 'method',
            render: (m: string) => t(`methods.${m}`, { defaultValue: m }),
          },
          {
            title: t('cash.expected'),
            dataIndex: 'expected',
            align: 'right',
            render: (v: number, r) => money(v, r.currency),
          },
          {
            title: t('cash.counted'),
            dataIndex: 'counted',
            align: 'right',
            render: (v: number | null, r) => (v === null ? '-' : money(v, r.currency)),
          },
          {
            title: t('cash.variance'),
            dataIndex: 'variance',
            align: 'right',
            render: (v: number | null, r) =>
              v === null ? (
                '-'
              ) : (
                <Text type={v === 0 ? 'success' : 'danger'}>{money(v, r.currency)}</Text>
              ),
          },
        ]}
      />
    </div>
  );
}

function ReportModal({
  session,
  kind,
  onClose,
}: {
  session: CashSession | null;
  kind: 'X' | 'Z';
  onClose: () => void;
}) {
  const { t } = useTranslation('billing');
  const q = useQuery({
    queryKey: bkKeys.cashReport(session?.id ?? '', kind),
    queryFn: () =>
      get<CashReport>(`/cash-sessions/${session!.id}/${kind === 'X' ? 'x-report' : 'z-report'}`),
    enabled: !!session,
    gcTime: 0,
  });
  return (
    <Modal
      open={!!session}
      onCancel={onClose}
      width={720}
      destroyOnHidden
      title={t(`cash.report.${kind}`)}
      footer={
        <Space>
          <Button icon={<PrinterOutlined />} onClick={() => window.print()} disabled={!q.data}>
            {t('cash.print')}
          </Button>
          <Button type="primary" onClick={onClose}>
            {t('close')}
          </Button>
        </Space>
      }
    >
      {q.isLoading ? (
        <Skeleton active />
      ) : q.data ? (
        <CashReportView report={q.data} />
      ) : (
        <Alert type="error" showIcon message={t('cash.reportError')} />
      )}
    </Modal>
  );
}

/**
 * Close form: amount counted per tender, variance shown live. A non-zero variance needs
 * `cash.close_with_variance` (the API enforces it too): without it the button stays disabled.
 */
export function CloseSessionModal({
  session,
  open,
  onClose,
  onClosed,
}: {
  session: CashSession;
  open: boolean;
  onClose: () => void;
  onClosed: (s: CashSession) => void;
}) {
  const { t } = useTranslation('billing');
  const { can } = useCan();
  const toMessage = useApiError();
  const qc = useQueryClient();
  const expected = session.expected ?? [];
  const [counted, setCounted] = useState<Record<string, number | null>>({});
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const rows = varianceRows(
    expected,
    Object.fromEntries(
      expected.map((e) => {
        const k = `${e.method}:${e.currency}`;
        return [k, toMinor(counted[k] ?? null, e.currency)];
      }),
    ),
  );
  const hasVariance = rows.some((r) => r.variance !== 0);
  const allowed = !hasVariance || can('cash.close_with_variance');

  const close = useMutation({
    mutationFn: () =>
      post<CashReport>(`/cash-sessions/${session.id}/close`, {
        counted: rows.map((r) => ({ method: r.method, currency: r.currency, amount: r.counted })),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (rep) => {
      void qc.invalidateQueries({ queryKey: bkKeys.all });
      onClosed(rep.session);
    },
    onError: (e) => setFailure(toMessage(e)),
  });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      destroyOnHidden
      width={640}
      title={t('cash.closeTitle')}
      okText={t('cash.close')}
      cancelText={t('cancel')}
      okButtonProps={{ disabled: !allowed, loading: close.isPending, danger: hasVariance }}
      onOk={() => close.mutate()}
    >
      <Table
        size="small"
        pagination={false}
        rowKey="key"
        dataSource={rows}
        columns={[
          {
            title: t('pay.method'),
            dataIndex: 'method',
            render: (m: string) => t(`methods.${m}`, { defaultValue: m }),
          },
          {
            title: t('cash.expected'),
            dataIndex: 'expected',
            align: 'right',
            render: (v: number, r) => money(v, r.currency),
          },
          {
            title: t('cash.counted'),
            key: 'c',
            width: 170,
            render: (_: unknown, r) => (
              <InputNumber
                aria-label={t('cash.countedFor', {
                  method: t(`methods.${r.method}`, { defaultValue: r.method }),
                })}
                min={0}
                style={{ width: '100%' }}
                value={counted[r.key] ?? null}
                onChange={(v) => setCounted((c) => ({ ...c, [r.key]: v }))}
                precision={r.currency === 'XOF' ? 0 : 2}
              />
            ),
          },
          {
            title: t('cash.variance'),
            key: 'v',
            align: 'right',
            render: (_: unknown, r) => (
              <Text
                type={r.variance === 0 ? 'success' : 'danger'}
                data-testid={`variance-${r.key}`}
              >
                {money(r.variance, r.currency)}
              </Text>
            ),
          },
        ]}
      />
      {hasVariance ? (
        <Alert
          style={{ marginTop: 12 }}
          type={allowed ? 'warning' : 'error'}
          showIcon
          message={allowed ? t('cash.varianceWarning') : t('cash.varianceDenied')}
        />
      ) : null}
      <Input.TextArea
        style={{ marginTop: 12 }}
        aria-label={t('cash.note')}
        placeholder={t('cash.note')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={500}
      />
      {failure ? <Alert style={{ marginTop: 12 }} type="error" showIcon message={failure} /> : null}
    </Modal>
  );
}

/** "Ma caisse" (OP-93): open with a float, current expected per tender, movements in/out, X report, close, Z report. */
export function CashPage() {
  const { t } = useTranslation('billing');
  const { can } = useCan();
  const toMessage = useApiError();
  const qc = useQueryClient();
  const { propertyId } = useActiveProperty();
  const [float, setFloat] = useState<number | null>(0);
  const [openNote, setOpenNote] = useState('');
  const [mvType, setMvType] = useState<'IN' | 'OUT'>('OUT');
  const [mvAmount, setMvAmount] = useState<number | null>(null);
  const [mvReason, setMvReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [report, setReport] = useState<{ session: CashSession; kind: 'X' | 'Z' } | null>(null);
  const [closing, setClosing] = useState(false);

  const current = useQuery({
    queryKey: bkKeys.cashCurrent(propertyId),
    queryFn: () =>
      get<(CashSession & { expected: NonNullable<CashSession['expected']> }) | null>(
        `/cash-sessions/current${qs({ propertyId })}`,
      ),
    enabled: !!propertyId,
  });
  const session = current.data ?? null;
  const cur = session?.currency ?? 'XOF';
  const refresh = () => void qc.invalidateQueries({ queryKey: bkKeys.all });

  const open = useMutation({
    mutationFn: () =>
      post<CashSession>('/cash-sessions', {
        propertyId,
        openingFloat: toMinor(float ?? 0, 'XOF') ?? 0,
        ...(openNote.trim() ? { note: openNote.trim() } : {}),
      }),
    onSuccess: () => {
      setFailure(null);
      refresh();
    },
    onError: (e) => setFailure(toMessage(e)),
  });
  const movement = useMutation({
    mutationFn: () =>
      post(`/cash-sessions/${session!.id}/movements`, {
        type: mvType,
        amount: toMinor(mvAmount, cur),
        currency: cur,
        reason: mvReason.trim(),
      }),
    onSuccess: () => {
      setMvAmount(null);
      setMvReason('');
      setFailure(null);
      refresh();
    },
    onError: (e) => setFailure(toMessage(e)),
  });

  if (!propertyId) return <EmptyState title={t('cash.noProperty')} />;

  return (
    <>
      <PageHeader title={t('cash.title')} actions={<PropertySelect />} />
      {failure ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={failure}
          closable
          onClose={() => setFailure(null)}
        />
      ) : null}
      {current.isLoading ? (
        <Skeleton active />
      ) : !session ? (
        <Card title={t('cash.openTitle')} style={{ maxWidth: 520 }}>
          <Form layout="vertical" onFinish={() => open.mutate()}>
            <Form.Item label={t('cash.floatLabel')}>
              <InputNumber
                aria-label={t('cash.floatLabel')}
                min={0}
                precision={0}
                style={{ width: '100%' }}
                value={float}
                onChange={setFloat}
              />
            </Form.Item>
            <Form.Item label={t('cash.note')}>
              <Input
                aria-label={t('cash.note')}
                value={openNote}
                onChange={(e) => setOpenNote(e.target.value)}
                maxLength={500}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={open.isPending}>
              {t('cash.open')}
            </Button>
          </Form>
        </Card>
      ) : (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Card
            title={
              <Space>
                {t('cash.current')}
                <Tag color="green">{t('cash.statuses.OPEN')}</Tag>
              </Space>
            }
            extra={
              <Space>
                <Button onClick={() => setReport({ session, kind: 'X' })}>
                  {t('cash.xReport')}
                </Button>
                {can('cash.close') ? (
                  <Button type="primary" danger onClick={() => setClosing(true)}>
                    {t('cash.close')}
                  </Button>
                ) : null}
              </Space>
            }
          >
            <Descriptions size="small" column={{ xs: 1, md: 3 }}>
              <Descriptions.Item label={t('cash.openedAt')}>
                {session.openedAt.slice(0, 16).replace('T', ' ')}
              </Descriptions.Item>
              <Descriptions.Item label={t('cash.float')}>
                {money(session.openingFloat, cur)}
              </Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              pagination={false}
              rowKey={(r) => `${r.method}:${r.currency}`}
              dataSource={session.expected}
              columns={[
                {
                  title: t('pay.method'),
                  dataIndex: 'method',
                  render: (m: string) => t(`methods.${m}`, { defaultValue: m }),
                },
                {
                  title: t('cash.expected'),
                  dataIndex: 'expected',
                  align: 'right',
                  render: (v: number, r) => money(v, r.currency),
                },
              ]}
            />
          </Card>
          {can('cash.movements') ? (
            <Card title={t('cash.movements')} size="small">
              <Form layout="inline" onFinish={() => movement.mutate()} style={{ rowGap: 8 }}>
                <Radio.Group
                  value={mvType}
                  onChange={(e) => setMvType(e.target.value as 'IN' | 'OUT')}
                  optionType="button"
                  options={[
                    { value: 'IN', label: t('cash.in') },
                    { value: 'OUT', label: t('cash.out') },
                  ]}
                />
                <InputNumber
                  aria-label={t('cash.mvAmount')}
                  placeholder={t('cash.mvAmount')}
                  min={1}
                  precision={0}
                  value={mvAmount}
                  onChange={setMvAmount}
                />
                <Input
                  aria-label={t('cash.mvReason')}
                  placeholder={t('cash.mvReason')}
                  value={mvReason}
                  onChange={(e) => setMvReason(e.target.value)}
                  style={{ width: 260 }}
                  maxLength={200}
                />
                <Button
                  htmlType="submit"
                  type="primary"
                  loading={movement.isPending}
                  disabled={!mvAmount || mvReason.trim().length < 3}
                >
                  {t('cash.record')}
                </Button>
              </Form>
            </Card>
          ) : null}
        </Space>
      )}

      {can('cash.read') ? (
        <ManagerSessions
          propertyId={propertyId}
          onReport={(s, kind) => setReport({ session: s, kind })}
        />
      ) : null}

      {session ? (
        <CloseSessionModal
          session={session}
          open={closing}
          onClose={() => setClosing(false)}
          onClosed={(s) => {
            setClosing(false);
            setReport({ session: s, kind: 'Z' });
          }}
        />
      ) : null}
      <ReportModal
        session={report?.session ?? null}
        kind={report?.kind ?? 'X'}
        onClose={() => setReport(null)}
      />
    </>
  );
}

/** Manager view: every session of the property, filtered by status and day, with its X / Z report. */
function ManagerSessions({
  propertyId,
  onReport,
}: {
  propertyId: string;
  onReport: (s: CashSession, kind: 'X' | 'Z') => void;
}) {
  const { t } = useTranslation('billing');
  const [status, setStatus] = useState<'OPEN' | 'CLOSED' | undefined>(undefined);
  const [day, setDay] = useState<string | null>(null);
  const q = useQuery({
    queryKey: bkKeys.cashList({ propertyId, status }),
    queryFn: () =>
      get<{ items: CashSession[] }>(`/cash-sessions${qs({ propertyId, status, limit: 200 })}`),
  });
  const items = (q.data?.items ?? []).filter((s) => !day || s.openedAt.slice(0, 10) === day);
  return (
    <Card
      title={t('cash.managerTitle')}
      style={{ marginTop: 24 }}
      extra={
        <Space>
          <DatePicker
            aria-label={t('cash.day')}
            onChange={(d) => setDay(d ? d.format('YYYY-MM-DD') : null)}
            allowClear
          />
          <Select
            allowClear
            placeholder={t('cash.status')}
            style={{ width: 140 }}
            onChange={(v) => setStatus(v)}
            options={[
              { value: 'OPEN', label: t('cash.statuses.OPEN') },
              { value: 'CLOSED', label: t('cash.statuses.CLOSED') },
            ]}
          />
        </Space>
      }
    >
      <Table<CashSession>
        size="small"
        rowKey="id"
        loading={q.isLoading}
        dataSource={items}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{ emptyText: t('cash.noSessions') }}
        columns={[
          {
            title: t('cash.openedAt'),
            dataIndex: 'openedAt',
            render: (v: string) => v.slice(0, 16).replace('T', ' '),
          },
          {
            title: t('cash.closedAt'),
            dataIndex: 'closedAt',
            render: (v: string | null) => (v ? v.slice(0, 16).replace('T', ' ') : '-'),
          },
          {
            title: t('cash.status'),
            dataIndex: 'status',
            render: (v: string) => (
              <Tag color={v === 'OPEN' ? 'green' : 'default'}>{t(`cash.statuses.${v}`)}</Tag>
            ),
          },
          {
            title: t('cash.expected'),
            dataIndex: 'expectedAmount',
            align: 'right',
            render: (v: number | null, s) => (v === null ? '-' : money(v, s.currency)),
          },
          {
            title: t('cash.variance'),
            dataIndex: 'variance',
            align: 'right',
            render: (v: number | null, s) =>
              v === null ? (
                '-'
              ) : (
                <Text type={v === 0 ? 'success' : 'danger'}>{money(v, s.currency)}</Text>
              ),
          },
          {
            title: '',
            key: 'a',
            render: (_: unknown, s) => (
              <Button size="small" onClick={() => onReport(s, s.status === 'CLOSED' ? 'Z' : 'X')}>
                {s.status === 'CLOSED' ? t('cash.zReport') : t('cash.xReport')}
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
}
