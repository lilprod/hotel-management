import { PlusOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Dropdown, Form, Input, Modal, Select, Table, Tag } from 'antd';
import { useState } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { PageHeader } from '@hm/ui';

import { PLATFORM_ROLES, apiClient, useMeStore } from '../../auth/session';
import type { PlatformRole } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { Field, a11y, bind } from '../../components/Field';

interface PlatformUser {
  id: string;
  email: string;
  name: string;
  role: PlatformRole;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const createSchema = z.object({
  email: z.email('validation.emailInvalid'),
  name: z.string().trim().min(1, 'validation.required'),
  role: z.enum(PLATFORM_ROLES),
  password: z.string().min(12, 'validation.passwordMin12').max(256),
});
type CreateValues = z.infer<typeof createSchema>;

function UserModal({ user, onClose }: { user: PlatformUser | 'new'; onClose: () => void }) {
  const { t } = useTranslation('platform');
  const message = useApiError();
  const qc = useQueryClient();
  const isNew = user === 'new';
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateValues>({
    resolver: zodResolver(
      isNew ? createSchema : createSchema.partial({ email: true, password: true }),
    ) as Resolver<CreateValues>,
    defaultValues: isNew
      ? { email: '', name: '', role: 'SUPPORT', password: '' }
      : { email: user.email, name: user.name, role: user.role, password: '' },
  });
  const errors = form.formState.errors;
  const save = form.handleSubmit(async (v) => {
    setError(null);
    try {
      if (isNew) await apiClient.post('/platform-users', v);
      else await apiClient.patch(`/platform-users/${user.id}`, { name: v.name, role: v.role });
      await qc.invalidateQueries({ queryKey: ['platform-users'] });
      onClose();
    } catch (e) {
      setError(message(e));
    }
  });
  return (
    <Modal
      open
      title={isNew ? t('users.create') : t('users.edit')}
      okText={t('save')}
      cancelText={t('cancel')}
      confirmLoading={form.formState.isSubmitting}
      onOk={() => void save()}
      onCancel={onClose}
    >
      <form noValidate onSubmit={(e) => void save(e)}>
        <Form layout="vertical" component={false}>
          <Field id="pu-email" label={t('users.email')} error={errors.email?.message}>
            <Input
              {...a11y('pu-email', errors.email)}
              type="email"
              disabled={!isNew}
              {...bind(form.register('email'))}
            />
          </Field>
          <Field id="pu-name" label={t('users.name')} error={errors.name?.message}>
            <Input {...a11y('pu-name', errors.name)} {...bind(form.register('name'))} />
          </Field>
          <Field id="pu-role" label={t('users.role')}>
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <Select
                  id="pu-role"
                  value={field.value}
                  onChange={field.onChange}
                  options={PLATFORM_ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
                />
              )}
            />
          </Field>
          {isNew ? (
            <Field
              id="pu-password"
              label={t('users.password')}
              extra={t('users.passwordHint')}
              error={errors.password?.message}
            >
              <Input.Password
                {...a11y('pu-password', errors.password)}
                autoComplete="new-password"
                {...bind(form.register('password'))}
              />
            </Field>
          ) : null}
          {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}
        </Form>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Platform users (SUPER_ADMIN only): create, change role, (de)activate, reset the TOTP. */
export function PlatformUsersPage() {
  const { t, i18n } = useTranslation('platform');
  const message = useApiError();
  const qc = useQueryClient();
  const me = useMeStore((s) => s.me);
  const [editing, setEditing] = useState<PlatformUser | 'new' | null>(null);

  const list = useQuery({
    queryKey: ['platform-users'],
    queryFn: () => apiClient.get<{ items: PlatformUser[] }>('/platform-users'),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' | 'mfa' }) =>
      action === 'mfa'
        ? apiClient.post(`/platform-users/${id}/mfa/reset`)
        : apiClient.patch(`/platform-users/${id}`, { isActive: action === 'activate' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-users'] }),
  });
  const confirm = (u: PlatformUser, action: 'deactivate' | 'mfa') =>
    Modal.confirm({
      title: t(`users.confirm.${action}`, { name: u.name }),
      okText: t('confirm'),
      cancelText: t('cancel'),
      okButtonProps: { danger: true },
      onOk: () => act.mutateAsync({ id: u.id, action }),
    });

  return (
    <>
      <PageHeader
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            {t('users.create')}
          </Button>
        }
      />
      {list.isError ? (
        <Alert type="error" showIcon message={message(list.error)} style={{ marginBottom: 12 }} />
      ) : null}
      {act.isError ? (
        <Alert type="error" showIcon message={message(act.error)} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<PlatformUser>
        rowKey="id"
        loading={list.isPending}
        dataSource={list.data?.items ?? []}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('users.name'),
            dataIndex: 'name',
            render: (n: string, u) => (
              <>
                <strong>{n}</strong>
                <div style={{ opacity: 0.7 }}>{u.email}</div>
              </>
            ),
          },
          {
            title: t('users.role'),
            dataIndex: 'role',
            render: (r: PlatformRole) => <Tag color="geekblue">{t(`roles.${r}`)}</Tag>,
          },
          {
            title: t('users.status'),
            dataIndex: 'isActive',
            render: (a: boolean) => (
              <Tag color={a ? 'green' : 'default'}>
                {a ? t('users.active') : t('users.inactive')}
              </Tag>
            ),
          },
          {
            title: 'TOTP',
            dataIndex: 'mfaEnabled',
            render: (v: boolean) =>
              v ? <Tag color="green">{t('users.enrolled')}</Tag> : <Tag>{t('users.pending')}</Tag>,
          },
          {
            title: t('users.lastLogin'),
            dataIndex: 'lastLoginAt',
            render: (v: string | null) =>
              v
                ? new Intl.DateTimeFormat(i18n.language, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(v))
                : '—',
          },
          {
            title: t('users.actions'),
            key: 'actions',
            render: (_: unknown, u) => (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    { key: 'edit', label: t('users.edit') },
                    u.isActive
                      ? {
                          key: 'deactivate',
                          label: t('users.deactivate'),
                          danger: true,
                          disabled: u.id === me?.id,
                        }
                      : { key: 'activate', label: t('users.activate') },
                    { key: 'mfa', label: t('users.resetMfa'), danger: true },
                  ],
                  onClick: ({ key }) => {
                    if (key === 'edit') setEditing(u);
                    else if (key === 'activate') act.mutate({ id: u.id, action: 'activate' });
                    else confirm(u, key as 'deactivate' | 'mfa');
                  },
                }}
              >
                <Button size="small" aria-label={`${t('users.actions')} ${u.name}`}>
                  {t('users.actions')}
                </Button>
              </Dropdown>
            ),
          },
        ]}
      />
      {editing ? <UserModal user={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
