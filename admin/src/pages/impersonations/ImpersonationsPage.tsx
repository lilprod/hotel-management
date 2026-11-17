import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, Input, InputNumber, Modal, Table, Tag } from 'antd';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { PageHeader, hasPermission, useSessionStore } from '@hm/ui';

import { apiClient, useMeStore } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { Field, a11y, bind } from '../../components/Field';

interface ImpersonationEvent {
  id: string;
  action: string;
  at: string;
  actorId: string | null;
  tenantId: string | null;
  details: {
    reason?: string;
    sessionId?: string;
    expiresAt?: string;
    platformUser?: { name?: string };
  } | null;
}

interface StartResult {
  accessToken: string;
  sessionId: string;
  expiresAt: string;
  tenant: { id: string; slug: string; name: string; host: string | null };
  user: { id: string; name: string; email: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const startSchema = z.object({
  tenantId: z.string().trim().regex(UUID, 'validation.uuid'),
  reason: z.string().trim().min(10, 'validation.reasonMin').max(500),
  durationMinutes: z
    .number({ error: 'validation.required' })
    .int()
    .min(1, 'validation.range')
    .max(30, 'validation.range'),
  userId: z
    .string()
    .trim()
    .refine((v) => v === '' || UUID.test(v), 'validation.uuid'),
});
type StartValues = z.infer<typeof startSchema>;

const base64url = (o: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * URL of the tenant staff app carrying the support token in the FRAGMENT (never sent to a
 * server, consumed and erased by the staff app; the token is non refreshable and ≤ 30 min).
 */
export function handoffUrl(
  r: StartResult,
  reason: string,
  by: { id: string; name: string },
): string | null {
  if (!r.tenant.host) return null;
  const payload = base64url({
    accessToken: r.accessToken,
    reason,
    expiresAt: r.expiresAt,
    by: by.id,
    byName: by.name,
  });
  return `${window.location.protocol}//${r.tenant.host}/#impersonate=${payload}`;
}

/** Support impersonation: start a ≤ 30 min "act as" session (reason mandatory) and follow the trail. */
export function ImpersonationsPage() {
  const { t, i18n } = useTranslation('platform');
  const message = useApiError();
  const qc = useQueryClient();
  const me = useMeStore((s) => s.me);
  const canStart = useSessionStore((s) =>
    hasPermission(s.permissions, 'platform.impersonations.start'),
  );
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<{ url: string | null; tenant: string } | null>(null);

  const list = useQuery({
    queryKey: ['impersonations'],
    queryFn: () => apiClient.get<{ items: ImpersonationEvent[] }>('/impersonations'),
  });
  const end = useMutation({
    mutationFn: (id: string) => apiClient.post(`/impersonations/${id}/end`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['impersonations'] }),
  });

  const form = useForm<StartValues>({
    resolver: zodResolver(startSchema),
    defaultValues: { tenantId: '', reason: '', durationMinutes: 30, userId: '' },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await apiClient.post<StartResult>('/impersonations', {
        tenantId: v.tenantId,
        reason: v.reason,
        durationMinutes: v.durationMinutes,
        ...(v.userId ? { userId: v.userId } : {}),
      });
      const url = handoffUrl(r, v.reason, { id: me?.id ?? '', name: me?.name ?? '' });
      setStarted({ url, tenant: r.tenant.name });
      setOpen(false);
      form.reset();
      await qc.invalidateQueries({ queryKey: ['impersonations'] });
    } catch (e) {
      setError(message(e));
    }
  });

  return (
    <>
      <PageHeader
        title={t('imp.title')}
        subtitle={t('imp.subtitle')}
        actions={
          canStart ? (
            <Button type="primary" onClick={() => setOpen(true)}>
              {t('imp.start')}
            </Button>
          ) : null
        }
      />
      {started ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="success"
          showIcon
          closable
          onClose={() => setStarted(null)}
          message={t('imp.started', { tenant: started.tenant })}
          description={
            started.url ? (
              <a href={started.url} target="_blank" rel="noopener noreferrer">
                {t('imp.open')}
              </a>
            ) : (
              t('imp.noHost')
            )
          }
        />
      ) : null}
      {list.isError ? (
        <Alert type="error" showIcon message={message(list.error)} style={{ marginBottom: 12 }} />
      ) : null}
      {end.isError ? (
        <Alert type="error" showIcon message={message(end.error)} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<ImpersonationEvent>
        rowKey="id"
        loading={list.isPending}
        dataSource={list.data?.items ?? []}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('imp.empty') }}
        columns={[
          {
            title: t('imp.at'),
            dataIndex: 'at',
            render: (v: string) =>
              new Intl.DateTimeFormat(i18n.language, {
                dateStyle: 'short',
                timeStyle: 'short',
              }).format(new Date(v)),
          },
          {
            title: t('imp.action'),
            dataIndex: 'action',
            render: (a: string) => (
              <Tag color={a.endsWith('started') ? 'orange' : 'default'}>
                {t(`imp.actions.${a.replace('impersonation.', '')}`, { defaultValue: a })}
              </Tag>
            ),
          },
          {
            title: t('imp.tenant'),
            dataIndex: 'tenantId',
            render: (v: string | null) => (v ? <code>{v.slice(0, 8)}</code> : '—'),
          },
          {
            title: t('imp.reason'),
            key: 'reason',
            render: (_: unknown, r) => r.details?.reason ?? '—',
          },
          {
            title: t('users.actions'),
            key: 'actions',
            render: (_: unknown, r) =>
              canStart && r.action === 'impersonation.started' && r.details?.sessionId ? (
                <Button
                  size="small"
                  danger
                  loading={end.isPending}
                  onClick={() => end.mutate(r.details!.sessionId!)}
                >
                  {t('imp.end')}
                </Button>
              ) : null,
          },
        ]}
      />
      <Modal
        open={open}
        title={t('imp.start')}
        okText={t('imp.confirmStart')}
        cancelText={t('cancel')}
        confirmLoading={form.formState.isSubmitting}
        onOk={() => void submit()}
        onCancel={() => setOpen(false)}
      >
        <form noValidate onSubmit={(e) => void submit(e)}>
          <Form layout="vertical" component={false}>
            <Field id="imp-tenant" label={t('imp.tenantId')} error={errors.tenantId?.message}>
              <Input
                {...a11y('imp-tenant', errors.tenantId)}
                {...bind(form.register('tenantId'))}
              />
            </Field>
            <Field
              id="imp-reason"
              label={t('imp.reason')}
              extra={t('imp.reasonHint')}
              error={errors.reason?.message}
            >
              <Input.TextArea
                rows={3}
                maxLength={500}
                {...a11y('imp-reason', errors.reason)}
                {...form.register('reason')}
              />
            </Field>
            <Field
              id="imp-duration"
              label={t('imp.duration')}
              error={errors.durationMinutes?.message}
            >
              <Controller
                control={form.control}
                name="durationMinutes"
                render={({ field }) => (
                  <InputNumber
                    {...a11y('imp-duration', errors.durationMinutes)}
                    min={1}
                    max={30}
                    addonAfter="min"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </Field>
            <Field
              id="imp-user"
              label={t('imp.userId')}
              extra={t('imp.userHint')}
              error={errors.userId?.message}
            >
              <Input {...a11y('imp-user', errors.userId)} {...bind(form.register('userId'))} />
            </Field>
            {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}
          </Form>
          <button type="submit" hidden />
        </form>
      </Modal>
    </>
  );
}
