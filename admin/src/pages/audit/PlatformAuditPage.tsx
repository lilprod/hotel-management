import { DownloadOutlined } from '@ant-design/icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Flex, Input, Table } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader, saveBlob } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';

interface AuditEntry {
  id: string;
  at: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}
interface Page {
  items: AuditEntry[];
  nextCursor: string | null;
}

export interface PlatformAuditFilters {
  action: string;
  entity: string;
  userId: string;
  range: [string, string] | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY: PlatformAuditFilters = { action: '', entity: '', userId: '', range: null };

/** Builds the `/audit` query string (only valid, non-empty filters are sent). */
export function platformAuditQuery(f: PlatformAuditFilters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams(extra);
  if (f.action.trim()) p.set('action', f.action.trim());
  if (f.entity.trim()) p.set('entity', f.entity.trim());
  if (UUID.test(f.userId.trim())) p.set('userId', f.userId.trim());
  if (f.range) {
    p.set('from', f.range[0]);
    p.set('to', f.range[1]);
  }
  return p.toString();
}

/** Platform audit trail: filters, cursor pagination, before/after JSON and CSV export. */
export function PlatformAuditPage() {
  const { t, i18n } = useTranslation('platform');
  const message = useApiError();
  const [draft, setDraft] = useState<PlatformAuditFilters>(EMPTY);
  const [applied, setApplied] = useState<PlatformAuditFilters>(EMPTY);
  const [exportError, setExportError] = useState<string | null>(null);

  const log = useInfiniteQuery({
    queryKey: ['platform-audit', applied],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiClient.get<Page>(
        `/audit?${platformAuditQuery(applied, { limit: '50', ...(pageParam ? { cursor: pageParam } : {}) })}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = log.data?.pages.flatMap((p) => p.items) ?? [];

  const exportCsv = async () => {
    setExportError(null);
    try {
      const { blob, filename } = await apiClient.download(
        `/audit/export?${platformAuditQuery(applied)}`,
      );
      saveBlob(blob, filename);
    } catch (e) {
      setExportError(message(e));
    }
  };

  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />
      <form
        role="search"
        aria-label={t('audit.filters')}
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(draft);
        }}
      >
        <Flex gap={8} wrap align="flex-end" style={{ marginBottom: 16 }}>
          <Input
            aria-label={t('audit.action')}
            placeholder={t('audit.actionHint')}
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            style={{ width: 200 }}
          />
          <Input
            aria-label={t('audit.entity')}
            placeholder={t('audit.entity')}
            value={draft.entity}
            onChange={(e) => setDraft({ ...draft, entity: e.target.value })}
            style={{ width: 140 }}
          />
          <Input
            aria-label={t('audit.user')}
            placeholder={t('audit.userHint')}
            value={draft.userId}
            onChange={(e) => setDraft({ ...draft, userId: e.target.value })}
            style={{ width: 240 }}
          />
          <DatePicker.RangePicker
            aria-label={t('audit.period')}
            onChange={(_, s) => setDraft({ ...draft, range: s[0] && s[1] ? [s[0], s[1]] : null })}
          />
          <Button type="primary" htmlType="submit">
            {t('audit.apply')}
          </Button>
          <Button
            onClick={() => {
              setDraft(EMPTY);
              setApplied(EMPTY);
            }}
          >
            {t('audit.reset')}
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => void exportCsv()}>
            {t('audit.export')}
          </Button>
        </Flex>
      </form>
      {log.isError ? (
        <Alert type="error" showIcon message={message(log.error)} style={{ marginBottom: 12 }} />
      ) : null}
      {exportError ? (
        <Alert type="error" showIcon message={exportError} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<AuditEntry>
        rowKey="id"
        size="small"
        loading={log.isPending}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('audit.empty') }}
        expandable={{
          expandedRowRender: (r) => (
            <Flex gap={16} wrap>
              {(['before', 'after'] as const).map((k) => (
                <div key={k} style={{ flex: 1, minWidth: 240 }}>
                  <strong>{t(`audit.${k}`)}</strong>
                  <pre style={{ maxHeight: 220, overflow: 'auto', margin: 0 }}>
                    {r[k] == null ? '—' : JSON.stringify(r[k], null, 2)}
                  </pre>
                </div>
              ))}
            </Flex>
          ),
          rowExpandable: (r) => r.before != null || r.after != null,
        }}
        columns={[
          {
            title: t('audit.at'),
            dataIndex: 'at',
            render: (v: string) =>
              new Intl.DateTimeFormat(i18n.language, {
                dateStyle: 'short',
                timeStyle: 'medium',
              }).format(new Date(v)),
          },
          {
            title: t('audit.action'),
            dataIndex: 'action',
            render: (v: string) => <code>{v}</code>,
          },
          { title: t('audit.entity'), dataIndex: 'entity' },
          {
            title: t('audit.user'),
            dataIndex: 'userId',
            render: (v: string | null) => (v ? <code>{v.slice(0, 8)}</code> : '—'),
          },
          { title: 'IP', dataIndex: 'ip', render: (v: string | null) => v ?? '—' },
        ]}
      />
      {log.hasNextPage ? (
        <Flex justify="center" style={{ marginTop: 16 }}>
          <Button loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
            {t('audit.more')}
          </Button>
        </Flex>
      ) : null}
    </>
  );
}
