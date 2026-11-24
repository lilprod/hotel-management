import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, Input, Popconfirm, Select, Space, Table } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../../../auth/session';
import { useApiError } from '../../../auth/useApiError';
import { useCan } from '../../../auth/useCan';
import { bkKeys } from '../../billing/api';
import type { ExchangeRate } from '../../billing/api';

const today = () => new Date().toISOString().slice(0, 10);

/** Daily exchange rates (EX-21): "1 unit of base = rate units of quote" (XOF), one rate per day and currency. */
export function ExchangeRatesPage() {
  const { t } = useTranslation('billing');
  const { can } = useCan();
  const toMessage = useApiError();
  const qc = useQueryClient();
  const [base, setBase] = useState('EUR');
  const [rate, setRate] = useState('');
  const [day, setDay] = useState(today());
  const [failure, setFailure] = useState<string | null>(null);
  const manage = can('settings.manage');
  const list = useQuery({
    queryKey: bkKeys.rates,
    queryFn: () => apiClient.get<{ items: ExchangeRate[] }>('/exchange-rates?limit=200'),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: bkKeys.rates });
  const save = useMutation({
    mutationFn: () =>
      apiClient.put('/exchange-rates', { base, quote: 'XOF', rate: rate.trim(), validOn: day }),
    onSuccess: () => {
      setRate('');
      setFailure(null);
      refresh();
    },
    onError: (e) => setFailure(toMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/exchange-rates/${id}`),
    onSuccess: refresh,
    onError: (e) => setFailure(toMessage(e)),
  });
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Alert type="info" showIcon message={t('fx.help')} />
      {manage ? (
        <Form layout="inline" onFinish={() => save.mutate()} style={{ rowGap: 8 }}>
          <Select
            aria-label={t('fx.currency')}
            value={base}
            onChange={setBase}
            style={{ width: 100 }}
            options={['EUR', 'USD'].map((c) => ({ value: c, label: c }))}
          />
          <Input
            aria-label={t('fx.rate')}
            placeholder={t('fx.rate')}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            style={{ width: 160 }}
            inputMode="decimal"
          />
          <Input
            aria-label={t('fx.validOn')}
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            style={{ width: 160 }}
          />
          <Button
            type="primary"
            htmlType="submit"
            loading={save.isPending}
            disabled={!/^\d{1,10}(\.\d{1,8})?$/.test(rate.trim()) || !day}
          >
            {t('fx.save')}
          </Button>
        </Form>
      ) : null}
      {failure ? <Alert type="error" showIcon message={failure} /> : null}
      <Table<ExchangeRate>
        size="small"
        rowKey="id"
        loading={list.isLoading}
        dataSource={[...(list.data?.items ?? [])].sort((a, b) => b.validOn.localeCompare(a.validOn))}
        locale={{ emptyText: t('fx.empty') }}
        pagination={{ pageSize: 15, hideOnSinglePage: true }}
        columns={[
          { title: t('fx.validOn'), dataIndex: 'validOn' },
          { title: t('fx.currency'), dataIndex: 'base' },
          { title: t('fx.rate'), dataIndex: 'rate', render: (r: string, x) => `1 ${x.base} = ${r} ${x.quote}` },
          {
            title: '',
            key: 'a',
            render: (_: unknown, x) =>
              manage ? (
                <Popconfirm title={t('fx.confirmDelete')} onConfirm={() => remove.mutate(x.id)}>
                  <Button size="small" danger>
                    {t('fx.delete')}
                  </Button>
                </Popconfirm>
              ) : null,
          },
        ]}
      />
    </Space>
  );
}
