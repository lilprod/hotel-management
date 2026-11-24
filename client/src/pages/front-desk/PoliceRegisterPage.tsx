import { DownloadOutlined, FilePdfOutlined } from '@ant-design/icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Alert, App as AntApp, Button, Flex, Form, Input, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { EmptyState, PageHeader, saveBlob } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { addDays, get, qs } from '../../reservations/api';
import { PropertySelect, useActiveProperty } from '../../reservations/property';
import { useBusinessDate } from '../../reservations/refs';
import { fdKeys } from './api';
import type { PoliceRecord, PolicePage } from './api';
import { useFdError } from './useFdError';

/**
 * Registre des voyageurs (OP-25, doc 09 §4): police records of a period, printable and exportable
 * (CSV / PDF). Sensitive fields are masked by the server unless the user holds `guests.export`;
 * every read and export is audited.
 */
export function PoliceRegisterPage() {
  const { t } = useTranslation('frontDesk');
  const { message } = AntApp.useApp();
  const toMessage = useFdError();
  const { propertyId } = useActiveProperty();
  const bd = useBusinessDate(propertyId);
  const [fromInput, setFromInput] = useState<string | null>(null);
  const [toInput, setToInput] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const to = toInput ?? bd.data ?? '';
  const from = fromInput ?? (bd.data ? addDays(bd.data, -6) : '');
  const ready = !!propertyId && !!from && !!to && from <= to;

  const query = useInfiniteQuery({
    queryKey: fdKeys.police(propertyId, from, to, search),
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      get<PolicePage>(
        `/front-desk/police-records${qs({ propertyId, from, to, search, cursor: pageParam || undefined })}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: ready,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const masked = query.data?.pages[0]?.masked ?? false;

  const exportCsv = async () => {
    try {
      const { blob, filename } = await apiClient.download(
        `/front-desk/police-records/export${qs({ propertyId, from, to, search, format: 'csv' })}`,
      );
      saveBlob(blob, filename);
    } catch (e) {
      void message.error(toMessage(e));
    }
  };
  const exportPdf = async () => {
    try {
      const { url } = await get<{ url: string }>(
        `/front-desk/police-records/export${qs({ propertyId, from, to, search, format: 'pdf' })}`,
      );
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      void message.error(toMessage(e));
    }
  };

  if (!propertyId) return <EmptyState title={t('noProperty')} />;
  const dash = (v: string | null) => v ?? '—';
  return (
    <>
      <PageHeader
        title={t('police.title')}
        subtitle={t('police.subtitle')}
        breadcrumb={[{ title: <Link to="/front-desk">{t('title')}</Link> }, { title: t('police.title') }]}
        actions={<PropertySelect />}
      />
      <Flex gap={12} wrap align="flex-end" style={{ marginBottom: 12 }}>
        <Form.Item label={t('police.from')} style={{ marginBottom: 0 }}>
          <Input type="date" aria-label={t('police.from')} value={from} onChange={(e) => setFromInput(e.target.value)} />
        </Form.Item>
        <Form.Item label={t('police.to')} style={{ marginBottom: 0 }}>
          <Input type="date" aria-label={t('police.to')} value={to} onChange={(e) => setToInput(e.target.value)} />
        </Form.Item>
        <Input.Search allowClear aria-label={t('search')} placeholder={t('search')} style={{ maxWidth: 280 }} onSearch={setSearch} />
        <Space>
          <Button icon={<DownloadOutlined />} disabled={!ready} onClick={() => void exportCsv()}>
            {t('police.exportCsv')}
          </Button>
          <Button icon={<FilePdfOutlined />} disabled={!ready} onClick={() => void exportPdf()}>
            {t('police.exportPdf')}
          </Button>
        </Space>
      </Flex>
      {masked ? <Alert type="info" showIcon message={t('police.masked')} style={{ marginBottom: 12 }} /> : null}
      {query.isError ? (
        <Alert type="error" showIcon message={toMessage(query.error)} />
      ) : (
        <Table<PoliceRecord>
          size="small"
          rowKey="id"
          loading={query.isLoading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 'max-content' }}
          aria-label={t('police.title')}
          locale={{ emptyText: t('police.empty') }}
          columns={[
            { title: t('columns.guest'), render: (_, r) => `${r.lastName.toUpperCase()} ${r.firstName}` },
            { title: t('fields.birthDate'), render: (_, r) => dash(r.birthDate) },
            { title: t('fields.nationality'), render: (_, r) => dash(r.nationality) },
            { title: t('fields.profession'), render: (_, r) => dash(r.profession) },
            { title: t('fields.address'), render: (_, r) => dash(r.address) },
            {
              title: t('fields.idDoc'),
              render: (_, r) => `${r.idDocType ? t(`idTypes.${r.idDocType}`, { defaultValue: r.idDocType }) : ''} ${r.idDocNumber ?? ''}`.trim() || '—',
            },
            { title: t('fields.provenance'), render: (_, r) => dash(r.provenance) },
            { title: t('fields.destination'), render: (_, r) => dash(r.destination) },
            { title: t('fields.purpose'), render: (_, r) => dash(r.purpose) },
            { title: t('police.arrival'), render: (_, r) => r.arrival },
            { title: t('police.departure'), render: (_, r) => r.departure },
            { title: t('fields.room'), render: (_, r) => dash(r.roomNumber) },
            {
              title: t('police.signature'),
              render: (_, r) => (r.hasSignature ? <Tag color="success">{t('police.signed')}</Tag> : '—'),
            },
          ]}
        />
      )}
      {query.hasNextPage ? (
        <Flex justify="center" style={{ marginTop: 12 }}>
          <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {t('police.more')}
          </Button>
        </Flex>
      ) : null}
    </>
  );
}
