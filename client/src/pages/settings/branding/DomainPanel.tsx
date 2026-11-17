import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Descriptions, Form, Input, Popconfirm, Space, Tag } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, api, type DomainView } from './api';

/** Whether the tenant plan includes custom domains (the API answers 402 otherwise). */
export function useCustomDomainEnabled() {
  const q = useQuery({
    queryKey: ['branding-domain'],
    queryFn: () => api<DomainView>('GET', '/branding/domain'),
    retry: false,
  });
  const gated = q.error instanceof ApiError && (q.error.status === 402 || q.error.status === 403);
  return { ...q, enabled: q.isSuccess, gated };
}

/** Custom domain (feature `branding.custom_domain`): add, TXT verification, status, remove. */
export function DomainPanel({ domain }: { domain: DomainView }) {
  const { t } = useTranslation('branding');
  const qc = useQueryClient();
  const [hostname, setHostname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = (data?: DomainView) => {
    setError(null);
    if (data) qc.setQueryData(['branding-domain'], data);
    else void qc.invalidateQueries({ queryKey: ['branding-domain'] });
  };
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : t('error'));
  const add = useMutation({
    mutationFn: () => api<DomainView>('POST', '/branding/domain', { hostname }),
    onSuccess: (d) => {
      setHostname('');
      done(d);
    },
    onError: fail,
  });
  const verify = useMutation({
    mutationFn: () => api<DomainView>('POST', '/branding/domain/verify'),
    onSuccess: done,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', '/branding/domain'),
    onSuccess: () => done(),
    onError: fail,
  });
  const c = domain.custom;

  return (
    <section aria-label={t('domain.title')}>
      {domain.subdomain && (
        <p>
          {t('domain.subdomain')} <strong>{domain.subdomain.hostname}</strong>
        </p>
      )}
      {error && <Alert role="alert" type="error" message={error} style={{ marginBottom: 12 }} />}
      {!c ? (
        <Form layout="inline" onFinish={() => add.mutate()}>
          <Form.Item label={t('domain.hostname')}>
            <Input
              aria-label={t('domain.hostname')}
              placeholder="www.mon-hotel.com"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={add.isPending} disabled={!hostname}>
            {t('domain.add')}
          </Button>
        </Form>
      ) : (
        <>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label={t('domain.hostname')}>{c.hostname}</Descriptions.Item>
            <Descriptions.Item label={t('domain.status')}>
              <Tag color={c.status === 'VERIFIED' ? 'green' : 'orange'}>
                {t(`domain.statuses.${c.status}`)}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="TLS">{c.tlsStatus}</Descriptions.Item>
            {c.status !== 'VERIFIED' && (
              <Descriptions.Item label={t('domain.txt')}>
                <div>
                  <code>{c.txtRecord.name}</code>
                </div>
                <div>
                  <code>{c.txtRecord.value}</code>
                </div>
              </Descriptions.Item>
            )}
          </Descriptions>
          {domain.check && !domain.check.matched && c.status !== 'VERIFIED' && (
            <Alert type="warning" message={t('domain.notFound')} style={{ marginTop: 12 }} />
          )}
          <Space style={{ marginTop: 12 }}>
            {c.status !== 'VERIFIED' && (
              <Button type="primary" loading={verify.isPending} onClick={() => verify.mutate()}>
                {t('domain.verify')}
              </Button>
            )}
            <Popconfirm title={t('domain.confirmRemove')} onConfirm={() => remove.mutate()}>
              <Button danger>{t('domain.remove')}</Button>
            </Popconfirm>
          </Space>
        </>
      )}
    </section>
  );
}
