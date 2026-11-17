import { DownloadOutlined } from '@ant-design/icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Flex, Input, Select, Table, Tag } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { saveBlob } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { useCan } from '../../auth/useCan';
import type { AuditEntry, Page } from './api';
import { fmtDate } from './SessionsPanel';

export interface AuditFilters {
  action: string;
  entity: string;
  userId: string;
  impersonated: '' | 'true' | 'false';
  range: [string, string] | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function auditQuery(f: AuditFilters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams(extra);
  if (f.action.trim()) p.set('action', f.action.trim());
  if (f.entity.trim()) p.set('entity', f.entity.trim());
  if (UUID.test(f.userId.trim())) p.set('userId', f.userId.trim());
  if (f.impersonated) p.set('impersonated', f.impersonated);
  if (f.range) {
    p.set('from', f.range[0]);
    p.set('to', f.range[1]);
  }
  return p.toString();
}

const EMPTY: AuditFilters = { action: '', entity: '', userId: '', impersonated: '', range: null };

/** Immutable audit log: filters, cursor pagination, JSON before/after and CSV export. */
export function AuditTab() {
  const { t, i18n } = useTranslation('security');
  const message = useApiError();
  const { can } = useCan();
  const [draft, setDraft] = useState<AuditFilters>(EMPTY);
  const [applied, setApplied] = useState<AuditFilters>(EMPTY);
  const [exportError, setExportError] = useState<string | null>(null);

  const log = useInfiniteQuery({
    queryKey: ['audit', applied],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      apiClient.get<Page<AuditEntry>>(
        `/audit?${auditQuery(applied, { limit: '50', ...(pageParam ? { cursor: pageParam } : {}) })}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = log.data?.pages.flatMap((p) => p.items) ?? [];

  const exportCsv = async () => {
    setExportError(null);
    try {
      const { blob, filename } = await apiClient.download(`/audit/export?${auditQuery(applied)}`);
      saveBlob(blob, filename);
    } catch (e) {
      setExportError(message(e));
    }
  };

  return (
    <>
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
          <Select
            aria-label={t('audit.impersonated')}
            value={draft.impersonated}
            onChange={(v) => setDraft({ ...draft, impersonated: v })}
            style={{ width: 190 }}
            options={[
              { value: '', label: t('audit.impersonatedAny') },
              { value: 'true', label: t('audit.impersonatedYes') },
              { value: 'false', label: t('audit.impersonatedNo') },
            ]}
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
          {can('audit.export') ? (
            <Button icon={<DownloadOutlined />} onClick={() => void exportCsv()}>
              {t('audit.export')}
            </Button>
          ) : null}
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
            render: (v: string) => fmtDate(v, i18n.language),
          },
          {
            title: t('audit.action'),
            dataIndex: 'action',
            render: (v: string, r) => (
              <>
                <code>{v}</code>
                {r.impersonatedBy ? (
                  <Tag color="orange" style={{ marginInlineStart: 6 }}>
                    {t('audit.support')}
                  </Tag>
                ) : null}
              </>
            ),
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
