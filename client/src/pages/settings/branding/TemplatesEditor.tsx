import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, api, type TemplateCatalog, type TemplateView } from './api';

const CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
const LOCALES = ['fr', 'en'] as const;

interface Draft {
  id: string | null;
  channel: TemplateView['channel'];
  code: string;
  locale: string;
  subject: string;
  body: string;
}
const NEW: Draft = { id: null, channel: 'EMAIL', code: '', locale: 'fr', subject: '', body: '' };

/** Message templates per channel / code / locale with whitelisted variables and live preview. */
export function TemplatesEditor() {
  const { t } = useTranslation('branding');
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string | null; body: string } | null>(null);

  const list = useQuery({
    queryKey: ['branding-templates'],
    queryFn: () => api<{ items: TemplateView[] }>('GET', '/branding/templates'),
  });
  const catalog = useQuery({
    queryKey: ['branding-template-catalog'],
    queryFn: () => api<TemplateCatalog>('GET', '/branding/templates/catalog'),
  });
  const entry = catalog.data?.items.find((c) => c.code === draft?.code);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : t('error'));
  const save = useMutation({
    mutationFn: (d: Draft) =>
      d.id
        ? api('PUT', `/branding/templates/${d.id}`, { subject: d.subject || null, body: d.body })
        : api('POST', '/branding/templates', {
            channel: d.channel,
            code: d.code,
            locale: d.locale,
            subject: d.subject || null,
            body: d.body,
          }),
    onSuccess: async () => {
      setDraft(null);
      setError(null);
      await qc.invalidateQueries({ queryKey: ['branding-templates'] });
    },
    onError: fail,
  });
  const del = useMutation({
    mutationFn: (id: string) => api('DELETE', `/branding/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branding-templates'] }),
    onError: fail,
  });
  const render = useMutation({
    mutationFn: (d: Draft) =>
      api<{ subject: string | null; body: string }>('POST', '/branding/templates/preview', {
        channel: d.channel,
        code: d.code,
        subject: d.subject || null,
        body: d.body,
      }),
    onSuccess: (r) => {
      setError(null);
      setPreview(r);
    },
    onError: (e) => {
      setPreview(null);
      fail(e);
    },
  });

  // Debounced server preview (the whitelist and escaping live on the server).
  useEffect(() => {
    if (!draft || !draft.code || !draft.body) {
      setPreview(null);
      return;
    }
    const id = setTimeout(() => render.mutate(draft), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.code, draft?.channel, draft?.subject, draft?.body]);

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <section aria-label={t('templates.title')}>
      <Space style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          onClick={() => {
            setError(null);
            setPreview(null);
            setDraft(NEW);
          }}
        >
          {t('templates.add')}
        </Button>
      </Space>
      {!draft && error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}
      <Table<TemplateView>
        rowKey="id"
        size="small"
        loading={list.isLoading}
        dataSource={list.data?.items ?? []}
        pagination={false}
        columns={[
          { title: t('templates.code'), dataIndex: 'code' },
          {
            title: t('templates.channel'),
            dataIndex: 'channel',
            render: (v: string) => t(`channels.${v}`, { defaultValue: v }),
          },
          { title: t('templates.locale'), dataIndex: 'locale' },
          {
            key: 'a',
            title: t('actions'),
            render: (_: unknown, r) => (
              <Space>
                <Button
                  size="small"
                  onClick={() => {
                    setError(null);
                    setDraft({
                      id: r.id,
                      channel: r.channel,
                      code: r.code,
                      locale: r.locale,
                      subject: r.subject ?? '',
                      body: r.body,
                    });
                  }}
                >
                  {t('edit')}
                </Button>
                <Popconfirm title={t('templates.confirmDelete')} onConfirm={() => del.mutate(r.id)}>
                  <Button size="small" danger>
                    {t('delete')}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {draft && (
        <Card
          size="small"
          style={{ marginTop: 16 }}
          title={draft.id ? t('edit') : t('templates.add')}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form layout="vertical">
                <Form.Item label={t('templates.code')}>
                  <Select
                    aria-label={t('templates.code')}
                    disabled={!!draft.id}
                    value={draft.code || undefined}
                    onChange={(code) => set({ code })}
                    options={(catalog.data?.items ?? []).map((c) => ({
                      value: c.code,
                      label: c.code,
                    }))}
                  />
                </Form.Item>
                <Space>
                  <Form.Item label={t('templates.channel')}>
                    <Select
                      aria-label={t('templates.channel')}
                      disabled={!!draft.id}
                      value={draft.channel}
                      onChange={(channel) => set({ channel })}
                      options={CHANNELS.map((c) => ({ value: c, label: c }))}
                      style={{ minWidth: 140 }}
                    />
                  </Form.Item>
                  <Form.Item label={t('templates.locale')}>
                    <Select
                      aria-label={t('templates.locale')}
                      disabled={!!draft.id}
                      value={draft.locale}
                      onChange={(locale) => set({ locale })}
                      options={LOCALES.map((l) => ({ value: l, label: l }))}
                      style={{ minWidth: 100 }}
                    />
                  </Form.Item>
                </Space>
                {draft.channel === 'EMAIL' && (
                  <Form.Item label={t('templates.subject')}>
                    <Input
                      aria-label={t('templates.subject')}
                      value={draft.subject}
                      onChange={(e) => set({ subject: e.target.value })}
                    />
                  </Form.Item>
                )}
                <Form.Item label={t('templates.body')}>
                  <Input.TextArea
                    rows={6}
                    aria-label={t('templates.body')}
                    value={draft.body}
                    onChange={(e) => set({ body: e.target.value })}
                  />
                </Form.Item>
                {entry && (
                  <div aria-label={t('templates.variables')}>
                    <span>{t('templates.variables')} </span>
                    {entry.variables.map((v) => (
                      <Tag
                        key={v.key}
                        style={{ cursor: 'pointer' }}
                        onClick={() => set({ body: `${draft.body}{{${v.key}}}` })}
                      >
                        {`{{${v.key}}}`}
                      </Tag>
                    ))}
                  </div>
                )}
              </Form>
            </Col>
            <Col xs={24} md={12}>
              <Card size="small" title={t('templates.preview')} data-testid="template-preview">
                {error && (
                  <Alert role="alert" type="error" message={error} style={{ marginBottom: 8 }} />
                )}
                {preview?.subject && (
                  <p>
                    <strong>{preview.subject}</strong>
                  </p>
                )}
                <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{preview?.body ?? ''}</pre>
              </Card>
            </Col>
          </Row>
          <Space style={{ marginTop: 12 }}>
            <Button
              type="primary"
              loading={save.isPending}
              disabled={!draft.code || !draft.body}
              onClick={() => save.mutate(draft)}
            >
              {t('save')}
            </Button>
            <Button onClick={() => setDraft(null)}>{t('cancel')}</Button>
          </Space>
        </Card>
      )}
    </section>
  );
}
