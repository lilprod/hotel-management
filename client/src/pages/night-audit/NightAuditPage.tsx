import {
  CheckCircleOutlined,
  FilePdfOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Skeleton,
  Space,
  Statistic,
  Steps,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { ApiError, EmptyState, PageHeader } from '@hm/ui';

import { useApiError } from '../../auth/useApiError';
import { useCan } from '../../auth/useCan';
import { addDays, formatDayLong, get, post } from '../../reservations/api';
import { PropertySelect, useActiveProperty } from '../../reservations/property';
import { useRealtimeEvent } from '../../reservations/realtime';
import { money } from '../billing/model';
import {
  defaultDecisions,
  naKeys,
  stepStatuses,
  STEPS,
  useHistory,
  usePrecheck,
} from './api';
import type { Audit, Check, CheckItem, Decision, Precheck, Progress, RunResult, Step } from './api';

const { Text, Paragraph } = Typography;

const SEVERITY_COLOR = { DECISION: 'blue', WARNING: 'orange', BLOCKING: 'red' } as const;

/** Business reason of a failed call (`meta.reason`) in this screen's words, else the generic message. */
function useNaError() {
  const { t } = useTranslation('nightAudit');
  const generic = useApiError();
  return (err: unknown): string => {
    if (err instanceof ApiError && err.reason) {
      const text = t(`errors.${err.reason}`, { defaultValue: '' });
      if (text) return text;
    }
    return generic(err);
  };
}

interface PrecheckListProps {
  precheck: Precheck;
  decisions: Record<string, Decision>;
  onDecision: (d: Decision) => void;
  onExtend: (item: CheckItem) => void;
}

/** Pre-check sections with the actions that resolve them (OP-24). */
export function PrecheckList({ precheck, decisions, onDecision, onExtend }: PrecheckListProps) {
  const { t, i18n } = useTranslation('nightAudit');
  const { can } = useCan();
  const day = (d?: string) => (d ? formatDayLong(d, i18n.language) : '—');
  const amount = (i: CheckItem, v?: number) => (v === undefined ? '—' : money(v, i.currency ?? 'XOF'));

  const base = [
    { title: t('col.reservation'), dataIndex: 'number', key: 'number' },
    { title: t('col.guest'), dataIndex: 'guestName', key: 'guest' },
    { title: t('col.room'), key: 'room', render: (_: unknown, i: CheckItem) => i.roomNumber ?? '—' },
  ];
  const columns: Record<Check['code'], object[]> = {
    PENDING_ARRIVALS: [
      ...base,
      { title: t('col.arrival'), key: 'arrival', render: (_: unknown, i: CheckItem) => day(i.arrival) },
      {
        title: t('col.penalty'),
        key: 'penalty',
        render: (_: unknown, i: CheckItem) =>
          i.penalty && i.penalty.amount > 0 ? money(i.penalty.amount, i.penalty.currency) : t('decision.noPenalty'),
      },
      {
        title: t('col.decision'),
        key: 'decision',
        render: (_: unknown, i: CheckItem) => {
          const d = decisions[i.reservationId!] ?? { reservationId: i.reservationId!, action: 'KEEP' as const };
          return (
            <Space wrap>
              <Radio.Group
                size="small"
                optionType="button"
                aria-label={`${t('col.decision')} ${i.number}`}
                value={d.action}
                onChange={(e) => onDecision({ ...d, action: e.target.value as Decision['action'] })}
                options={[
                  { value: 'NO_SHOW', label: t('decision.NO_SHOW'), disabled: !i.canNoShow },
                  { value: 'KEEP', label: t('decision.KEEP') },
                ]}
              />
              {d.action === 'NO_SHOW' && i.penalty && i.penalty.amount > 0 ? (
                <Checkbox
                  checked={!!d.waivePenalty}
                  onChange={(e) => onDecision({ ...d, waivePenalty: e.target.checked })}
                >
                  {t('decision.waive')}
                </Checkbox>
              ) : null}
              {can('front_desk.check_in') ? (
                <Link to="/front-desk?tab=arrivals">{t('actions.checkIn')}</Link>
              ) : null}
            </Space>
          );
        },
      },
    ],
    PENDING_DEPARTURES: [
      ...base,
      { title: t('col.departure'), key: 'departure', render: (_: unknown, i: CheckItem) => day(i.departure) },
      { title: t('col.balance'), key: 'balance', render: (_: unknown, i: CheckItem) => amount(i, i.balance) },
      {
        title: t('col.actions'),
        key: 'actions',
        render: (_: unknown, i: CheckItem) => (
          <Space wrap>
            <Link to="/front-desk?tab=departures">{t('actions.checkout')}</Link>
            {can('reservations.update') ? (
              <Button size="small" onClick={() => onExtend(i)}>
                {t('actions.extend')}
              </Button>
            ) : null}
          </Space>
        ),
      },
    ],
    OPEN_CASH_SESSIONS: [
      { title: t('col.cashier'), dataIndex: 'userName', key: 'user' },
      {
        title: t('col.openedAt'),
        key: 'openedAt',
        render: (_: unknown, i: CheckItem) => (i.openedAt ? new Date(i.openedAt).toLocaleString(i18n.language) : '—'),
      },
      {
        title: t('col.actions'),
        key: 'actions',
        render: () => <Link to="/cash">{t('actions.closeCash')}</Link>,
      },
    ],
    NEGATIVE_BALANCES: [
      { title: t('col.folio'), dataIndex: 'number', key: 'number' },
      { title: t('col.balance'), key: 'balance', render: (_: unknown, i: CheckItem) => amount(i, i.balance) },
      {
        title: t('col.actions'),
        key: 'actions',
        render: (_: unknown, i: CheckItem) => <Link to={`/folios/${i.folioId}`}>{t('actions.openFolio')}</Link>,
      },
    ],
    UNASSIGNED_IN_HOUSE: [
      ...base,
      {
        title: t('col.actions'),
        key: 'actions',
        render: () => <Link to="/front-desk?tab=in-house">{t('actions.assign')}</Link>,
      },
    ],
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {precheck.checks.map((c) => (
        <Card
          key={c.code}
          size="small"
          data-testid={`check-${c.code}`}
          title={
            <Space>
              {c.count ? null : <CheckCircleOutlined style={{ color: '#52c41a' }} />}
              <span>{t(`checks.${c.code}`)}</span>
              {c.count ? <Tag color={SEVERITY_COLOR[c.severity]}>{t(`severity.${c.severity}`)}</Tag> : null}
              {c.count ? <Tag>{c.count}</Tag> : null}
            </Space>
          }
        >
          {c.count ? (
            <>
              <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                {t(`hints.${c.code}`)}
              </Paragraph>
              <Table<CheckItem>
                size="small"
                pagination={false}
                rowKey={(i) => i.reservationId ?? i.reservationRoomId ?? i.cashSessionId ?? i.folioId ?? ''}
                columns={columns[c.code]}
                dataSource={c.items}
                scroll={{ x: true }}
              />
            </>
          ) : (
            <Text type="secondary">{t('ok')}</Text>
          )}
        </Card>
      ))}
    </Space>
  );
}

/** Steps of a run with their live status (realtime `night_audit.progress`). */
export function RunProgress({ statuses }: { statuses: Record<Step, 'wait' | 'process' | 'finish' | 'error'> }) {
  const { t } = useTranslation('nightAudit');
  return (
    <Steps
      size="small"
      direction="vertical"
      data-testid="run-progress"
      items={STEPS.map((s) => ({ title: t(`steps.${s}`), status: statuses[s] }))}
    />
  );
}

/** KPIs of a closed day, its breakdowns and the PDF report. */
export function AuditSummary({ audit, onPdf }: { audit: Audit; onPdf: (a: Audit) => void }) {
  const { t, i18n } = useTranslation('nightAudit');
  const k = audit.kpis;
  if (!k) return null;
  const m = (v: number) => money(v, k.currency);
  return (
    <Card
      title={t('summary.title', { date: formatDayLong(audit.businessDate, i18n.language) })}
      extra={
        <Button icon={<FilePdfOutlined />} onClick={() => onPdf(audit)}>
          {t('summary.pdf')}
        </Button>
      }
      data-testid="audit-summary"
    >
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Statistic title={t('summary.occupancy')} value={`${k.occupancy} %`} />
        </Col>
        <Col xs={12} md={6}>
          <Statistic title={t('summary.roomsSold')} value={`${k.roomsSold} / ${k.roomsAvailable}`} />
        </Col>
        <Col xs={12} md={6}>
          <Statistic title={t('summary.adr')} value={m(k.adr)} />
        </Col>
        <Col xs={12} md={6}>
          <Statistic title={t('summary.revpar')} value={m(k.revpar)} />
        </Col>
        <Col xs={12} md={6}>
          <Statistic title={t('summary.roomRevenue')} value={m(k.roomRevenue)} />
        </Col>
        <Col xs={12} md={6}>
          <Statistic title={t('summary.totalRevenue')} value={m(k.totalRevenue)} />
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title={`${t('summary.arrivals')} / ${t('summary.departures')}`}
            value={`${k.arrivals} / ${k.departures}`}
          />
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title={`${t('summary.inHouse')} / ${t('summary.noShows')}`}
            value={`${k.inHouse} / ${k.noShows}`}
          />
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <Descriptions size="small" column={1} bordered title={t('summary.byDept')}>
            {Object.entries(k.revenueByDept).map(([code, v]) => (
              <Descriptions.Item key={code} label={t(`depts.${code}`, { defaultValue: code })}>
                {m(v)}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Col>
        <Col xs={24} md={8}>
          <Descriptions size="small" column={1} bordered title={t('summary.payments')}>
            {k.payments.map((p) => (
              <Descriptions.Item key={p.method} label={t(`billing:methods.${p.method}`, { defaultValue: p.method })}>
                {m(p.amount)}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Col>
        <Col xs={24} md={8}>
          <Descriptions size="small" column={1} bordered title={t('summary.taxes')}>
            {k.taxes.map((x) => (
              <Descriptions.Item
                key={x.code}
                label={`${x.name} (${x.kind === 'VAT' ? t('summary.vat') : t('summary.tourist')})`}
              >
                {m(x.amount)}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Col>
      </Row>
    </Card>
  );
}

export function NightAuditPage() {
  const { t, i18n } = useTranslation('nightAudit');
  const { can } = useCan();
  const { message } = AntApp.useApp();
  const toMessage = useNaError();
  const qc = useQueryClient();
  const { propertyId } = useActiveProperty();
  const pre = usePrecheck(propertyId);
  const history = useHistory(propertyId);
  const [picked, setPicked] = useState<Record<string, Decision>>({});
  const [live, setLive] = useState<Partial<Record<Step, Progress['status']>>>({});
  const [last, setLast] = useState<Audit | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [extend, setExtend] = useState<CheckItem | null>(null);
  const [departure, setDeparture] = useState('');

  const refresh = () => void qc.invalidateQueries({ queryKey: naKeys.all });
  useRealtimeEvent<Progress>('night_audit.progress', propertyId, (p) =>
    setLive((cur) => ({ ...cur, [p.step]: p.status })),
  );
  useRealtimeEvent<{ propertyId: string }>('night_audit.completed', propertyId, refresh);

  const decisions = useMemo(() => ({ ...defaultDecisions(pre.data), ...picked }), [pre.data, picked]);
  const failedAudit = history.data?.items.find((a) => a.status === 'FAILED' || a.status === 'RUNNING') ?? null;

  const run = useMutation({
    mutationFn: () =>
      post<RunResult>('/night-audit/run', {
        propertyId,
        businessDate: pre.data!.businessDate,
        decisions: Object.values(decisions),
      }),
    onMutate: () => {
      setLive({});
      setFailure(null);
      setLast(null);
    },
    onSuccess: (r) => {
      setLast(r.audit);
      setPicked({});
      void message.success(
        r.alreadyCompleted ? t('run.already') : t('run.done', { date: formatDayLong(r.audit.businessDate, i18n.language) }),
      );
      refresh();
    },
    onError: (e) => {
      setFailure(toMessage(e));
      refresh();
    },
  });

  const extendStay = useMutation({
    mutationFn: () => post(`/reservations/${extend!.reservationId}/extend`, { departure }),
    onSuccess: () => {
      void message.success(t('actions.extended'));
      setExtend(null);
      refresh();
    },
    onError: (e) => void message.error(toMessage(e)),
  });

  const pdf = useMutation({
    mutationFn: (a: Audit) => get<{ url: string }>(`/night-audit/${a.id}/report`),
    onSuccess: (r) => void window.open(r.url, '_blank', 'noopener'),
    onError: (e) => void message.error(toMessage(e)),
  });

  if (!propertyId) return <EmptyState title={t('noProperty')} />;

  const p = pre.data;
  const noShows = Object.values(decisions).filter((d) => d.action === 'NO_SHOW').length;
  const showProgress = run.isPending || Object.keys(live).length > 0 || !!failedAudit;
  const statuses = stepStatuses(last ?? failedAudit, live);

  return (
    <>
      <PageHeader title={t('title')} actions={<PropertySelect />} />
      {pre.isLoading || !p ? (
        <Skeleton active />
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={16}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Card>
                <Space direction="vertical" size={4}>
                  <Text type="secondary">{t('businessDate')}</Text>
                  <Typography.Title level={3} style={{ margin: 0 }} data-testid="business-date">
                    {formatDayLong(p.businessDate, i18n.language)}
                  </Typography.Title>
                  <Text type="secondary">
                    {p.closedDate
                      ? t('lastClosed', { date: formatDayLong(p.closedDate, i18n.language) })
                      : t('neverClosed')}
                  </Text>
                </Space>
              </Card>
              {failedAudit && !run.isPending ? (
                <Alert
                  type="warning"
                  showIcon
                  message={t('failedAlert', { date: formatDayLong(failedAudit.businessDate, i18n.language) })}
                  description={failedAudit.error ?? undefined}
                />
              ) : null}
              {failure ? (
                <Alert type="error" showIcon closable message={failure} onClose={() => setFailure(null)} />
              ) : null}
              <Card
                title={t('prechecks')}
                extra={
                  <Button icon={<ReloadOutlined />} onClick={refresh}>
                    {t('refresh')}
                  </Button>
                }
              >
                <PrecheckList
                  precheck={p}
                  decisions={decisions}
                  onDecision={(d) => setPicked((cur) => ({ ...cur, [d.reservationId]: d }))}
                  onExtend={(i) => {
                    setExtend(i);
                    setDeparture(i.departure ? addDays(i.departure, 1) : '');
                  }}
                />
              </Card>
              {last ? <AuditSummary audit={last} onPdf={(a) => pdf.mutate(a)} /> : null}
            </Space>
          </Col>
          <Col xs={24} lg={8}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Card>
                {!can('night_audit.run') ? (
                  <Alert type="info" showIcon message={t('run.forbidden')} />
                ) : !p.canRun ? (
                  <Alert type="error" showIcon message={t('run.blocked')} style={{ marginBottom: 12 }} />
                ) : null}
                <Popconfirm
                  title={t('run.confirmTitle', { date: formatDayLong(p.businessDate, i18n.language) })}
                  description={
                    <div style={{ maxWidth: 320 }}>
                      <Paragraph style={{ marginBottom: 4 }}>
                        {t('run.confirmBody', { next: formatDayLong(addDays(p.businessDate, 1), i18n.language) })}
                      </Paragraph>
                      {noShows ? <Text strong>{t('run.noShows', { count: noShows })}</Text> : null}
                    </div>
                  }
                  okText={t('actions.confirm')}
                  cancelText={t('actions.cancel')}
                  onConfirm={() => run.mutate()}
                  disabled={!can('night_audit.run') || !p.canRun || run.isPending}
                >
                  <Button
                    type="primary"
                    size="large"
                    block
                    icon={<PlayCircleOutlined />}
                    loading={run.isPending}
                    disabled={!can('night_audit.run') || !p.canRun}
                  >
                    {failedAudit ? t('run.resume') : t('run.button')}
                  </Button>
                </Popconfirm>
                {showProgress ? (
                  <div style={{ marginTop: 16 }}>
                    <Text type="secondary">{t('run.progress')}</Text>
                    <RunProgress statuses={statuses} />
                  </div>
                ) : null}
              </Card>
            </Space>
          </Col>
          <Col span={24}>
            <Card title={t('history.title')}>
              <Table<Audit>
                size="small"
                rowKey="id"
                loading={history.isLoading}
                dataSource={history.data?.items ?? []}
                locale={{ emptyText: t('history.empty') }}
                scroll={{ x: true }}
                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                columns={[
                  {
                    title: t('history.date'),
                    key: 'date',
                    render: (_, a) => formatDayLong(a.businessDate, i18n.language),
                  },
                  {
                    title: t('history.status'),
                    key: 'status',
                    render: (_, a) => (
                      <Tag color={a.status === 'COMPLETED' ? 'green' : a.status === 'FAILED' ? 'red' : 'blue'}>
                        {t(`status.${a.status}`)}
                      </Tag>
                    ),
                  },
                  { title: t('history.trigger'), key: 'trigger', render: (_, a) => t(`history.${a.trigger}`) },
                  { title: t('summary.occupancy'), key: 'occ', render: (_, a) => (a.kpis ? `${a.kpis.occupancy} %` : '—') },
                  { title: t('summary.adr'), key: 'adr', render: (_, a) => (a.kpis ? money(a.kpis.adr, a.kpis.currency) : '—') },
                  {
                    title: t('summary.revpar'),
                    key: 'revpar',
                    render: (_, a) => (a.kpis ? money(a.kpis.revpar, a.kpis.currency) : '—'),
                  },
                  {
                    title: t('summary.totalRevenue'),
                    key: 'rev',
                    render: (_, a) => (a.kpis ? money(a.kpis.totalRevenue, a.kpis.currency) : '—'),
                  },
                  {
                    title: t('history.completedAt'),
                    key: 'completedAt',
                    render: (_, a) => (a.completedAt ? new Date(a.completedAt).toLocaleString(i18n.language) : '—'),
                  },
                  {
                    title: '',
                    key: 'pdf',
                    render: (_, a) =>
                      a.kpis ? (
                        <Button
                          size="small"
                          icon={<FilePdfOutlined />}
                          aria-label={`${t('summary.pdf')} ${a.businessDate}`}
                          onClick={() => pdf.mutate(a)}
                        >
                          PDF
                        </Button>
                      ) : null,
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}
      <Modal
        open={!!extend}
        title={t('actions.extendTitle', { number: extend?.number ?? '' })}
        okText={t('actions.confirm')}
        cancelText={t('actions.cancel')}
        confirmLoading={extendStay.isPending}
        okButtonProps={{ disabled: !departure }}
        onOk={() => extendStay.mutate()}
        onCancel={() => setExtend(null)}
      >
        <Input
          type="date"
          aria-label={t('actions.newDeparture')}
          value={departure}
          min={extend?.departure ? addDays(extend.departure, 1) : undefined}
          onChange={(e) => setDeparture(e.target.value)}
        />
      </Modal>
    </>
  );
}
