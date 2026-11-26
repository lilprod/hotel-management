import { PlusOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Dropdown, Flex, Form, Input, Modal, Select, Table, Tag } from 'antd';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { apiClient, useMeStore } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { useCan } from '../../auth/useCan';
import { Field, a11y, bind } from '../../components/Field';
import type { IamUser, Role, UserStatus } from './api';
import { fmtDate } from './SessionsPanel';

const STATUS_COLOR: Record<UserStatus, string> = {
  ACTIVE: 'green',
  INVITED: 'blue',
  PENDING_VERIFICATION: 'gold',
  DISABLED: 'default',
};

const userSchema = z.object({
  email: z.email('validation.emailInvalid'),
  name: z.string().trim().min(1, 'validation.required'),
  phone: z.string().trim().max(30).optional(),
  roleIds: z.array(z.string()).min(1, 'validation.required'),
  propertyIds: z.array(z.string()),
});
type UserValues = z.infer<typeof userSchema>;

function UserModal({
  user,
  roles,
  onClose,
}: {
  user: IamUser | 'new';
  roles: Role[];
  onClose: () => void;
}) {
  const { t } = useTranslation('security');
  const message = useApiError();
  const qc = useQueryClient();
  const me = useMeStore((s) => s.me);
  const isNew = user === 'new';
  const [error, setError] = useState<string | null>(null);
  const form = useForm<UserValues>({
    resolver: zodResolver(userSchema),
    defaultValues: isNew
      ? { email: '', name: '', phone: '', roleIds: [], propertyIds: [] }
      : {
          email: user.email,
          name: user.name,
          phone: user.phone ?? '',
          roleIds: user.roles.map((r) => r.id),
          propertyIds: user.propertyIds,
        },
  });
  const errors = form.formState.errors;

  const save = form.handleSubmit(async (v) => {
    setError(null);
    try {
      if (isNew) {
        await apiClient.post('/iam/users', {
          email: v.email,
          name: v.name,
          ...(v.phone ? { phone: v.phone } : {}),
          roleIds: v.roleIds,
          propertyIds: v.propertyIds,
        });
      } else {
        await apiClient.patch(`/iam/users/${user.id}`, {
          name: v.name,
          phone: v.phone ? v.phone : null,
          roleIds: v.roleIds,
        });
        const before = [...user.propertyIds].sort().join();
        if (before !== [...v.propertyIds].sort().join())
          await apiClient.put(`/iam/users/${user.id}/properties`, { propertyIds: v.propertyIds });
      }
      await qc.invalidateQueries({ queryKey: ['iam-users'] });
      onClose();
    } catch (e) {
      setError(message(e));
    }
  });

  return (
    <Modal
      open
      title={isNew ? t('users.invite') : t('users.edit')}
      okText={isNew ? t('users.sendInvite') : t('save')}
      cancelText={t('cancel')}
      confirmLoading={form.formState.isSubmitting}
      onOk={() => void save()}
      onCancel={onClose}
      destroyOnHidden
    >
      <form noValidate onSubmit={(e) => void save(e)}>
        <Form layout="vertical" component={false}>
          <Field id="user-email" label={t('users.email')} error={errors.email?.message}>
            <Input
              {...a11y('user-email', errors.email)}
              type="email"
              disabled={!isNew}
              {...bind(form.register('email'))}
            />
          </Field>
          <Field id="user-name" label={t('users.name')} error={errors.name?.message}>
            <Input {...a11y('user-name', errors.name)} {...bind(form.register('name'))} />
          </Field>
          <Field id="user-phone" label={t('users.phone')} error={errors.phone?.message}>
            <Input
              {...a11y('user-phone', errors.phone)}
              type="tel"
              {...bind(form.register('phone'))}
            />
          </Field>
          <Field id="user-roles" label={t('users.roles')} error={errors.roleIds?.message}>
            <Controller
              control={form.control}
              name="roleIds"
              render={({ field }) => (
                <Select
                  {...a11y('user-roles', errors.roleIds)}
                  mode="multiple"
                  value={field.value}
                  onChange={field.onChange}
                  options={roles.map((r) => ({ value: r.id, label: r.name }))}
                  optionFilterProp="label"
                />
              )}
            />
          </Field>
          <Field
            id="user-properties"
            label={t('users.properties')}
            extra={t('users.propertiesHint')}
          >
            <Controller
              control={form.control}
              name="propertyIds"
              render={({ field }) => (
                <Select
                  id="user-properties"
                  mode="multiple"
                  value={field.value}
                  onChange={field.onChange}
                  options={(me?.properties ?? []).map((p) => ({ value: p.id, label: p.name }))}
                  optionFilterProp="label"
                />
              )}
            />
          </Field>
          {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}
        </Form>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Users of the hotel: invite, edit roles / properties, activate, deactivate, revoke sessions, reset 2FA. */
export function UsersTab() {
  const { t, i18n } = useTranslation('security');
  const message = useApiError();
  const { can } = useCan();
  const qc = useQueryClient();
  const me = useMeStore((s) => s.me);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<UserStatus | undefined>();
  const [editing, setEditing] = useState<IamUser | 'new' | null>(null);
  const manage = can('users.manage');

  const users = useQuery({
    queryKey: ['iam-users', q, status],
    queryFn: () =>
      apiClient.get<{ items: IamUser[] }>(
        `/iam/users?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) })}`,
      ),
  });
  const roles = useQuery({
    queryKey: ['iam-roles'],
    queryFn: () => apiClient.get<{ items: Role[] }>('/iam/roles'),
    enabled: can('roles.read'),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => {
      switch (action) {
        case 'activate':
        case 'deactivate':
          return apiClient.post(`/iam/users/${id}/${action}`);
        case 'invite':
          return apiClient.post(`/iam/users/${id}/invitation`);
        case 'sessions':
          return apiClient.delete(`/iam/users/${id}/sessions`);
        default:
          return apiClient.post(`/iam/users/${id}/mfa/reset`);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['iam-users'] }),
  });

  const confirmAction = (u: IamUser, action: string, danger = false) => {
    const run = () => act.mutateAsync({ id: u.id, action });
    if (!danger) return void run();
    Modal.confirm({
      title: t(`users.confirm.${action}`, { name: u.name }),
      okText: t('confirm'),
      cancelText: t('cancel'),
      okButtonProps: { danger: true },
      onOk: run,
    });
  };

  const propertyName = (id: string) => me?.properties.find((p) => p.id === id)?.name ?? id;

  return (
    <>
      <Flex gap={12} wrap style={{ marginBottom: 16 }} justify="space-between">
        <Flex gap={8} wrap>
          <Input.Search
            allowClear
            aria-label={t('users.search')}
            placeholder={t('users.search')}
            onSearch={setQ}
            style={{ width: 260 }}
          />
          <Select
            allowClear
            aria-label={t('users.status')}
            placeholder={t('users.status')}
            style={{ minWidth: 150 }}
            value={status}
            onChange={setStatus}
            options={(['ACTIVE', 'INVITED', 'PENDING_VERIFICATION', 'DISABLED'] as const).map((s) => ({
              value: s,
              label: t(`users.statuses.${s}`),
            }))}
          />
        </Flex>
        {manage ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            {t('users.invite')}
          </Button>
        ) : null}
      </Flex>
      {users.isError ? (
        <Alert type="error" showIcon message={message(users.error)} style={{ marginBottom: 12 }} />
      ) : null}
      {act.isError ? (
        <Alert type="error" showIcon message={message(act.error)} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<IamUser>
        rowKey="id"
        loading={users.isPending}
        dataSource={users.data?.items ?? []}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('users.empty') }}
        columns={[
          {
            title: t('users.name'),
            dataIndex: 'name',
            render: (name: string, u) => (
              <>
                <strong>{name}</strong>
                <div style={{ opacity: 0.7 }}>{u.email}</div>
              </>
            ),
          },
          {
            title: t('users.roles'),
            dataIndex: 'roles',
            render: (rs: IamUser['roles']) =>
              rs.map((r) => (
                <Tag key={r.id} color={r.isSystem ? 'geekblue' : 'purple'}>
                  {r.name}
                </Tag>
              )),
          },
          {
            title: t('users.properties'),
            dataIndex: 'propertyIds',
            render: (ids: string[]) =>
              ids.length ? ids.map(propertyName).join(', ') : t('users.allOrNone'),
          },
          {
            title: t('users.status'),
            dataIndex: 'status',
            render: (s: UserStatus) => (
              <Tag color={STATUS_COLOR[s]}>{t(`users.statuses.${s}`)}</Tag>
            ),
          },
          {
            title: t('users.twoFactor'),
            dataIndex: 'mfaEnabled',
            render: (v: boolean) => (v ? <Tag color="green">{t('account.enabled')}</Tag> : '—'),
          },
          {
            title: t('users.lastLogin'),
            dataIndex: 'lastLoginAt',
            render: (v: string | null) => fmtDate(v, i18n.language),
          },
          {
            title: t('users.actions'),
            key: 'actions',
            render: (_: unknown, u) => {
              const items = [
                ...(manage
                  ? [
                      { key: 'edit', label: t('users.edit') },
                      ...(u.status === 'INVITED'
                        ? [{ key: 'invite', label: t('users.resend') }]
                        : []),
                      ...(u.status === 'DISABLED'
                        ? [{ key: 'activate', label: t('users.activate') }]
                        : []),
                      ...(u.status === 'ACTIVE'
                        ? [
                            { key: 'deactivate', label: t('users.deactivate'), danger: true },
                            { key: 'sessions', label: t('users.revokeSessions'), danger: true },
                          ]
                        : []),
                    ]
                  : []),
                ...(can('security.manage') && u.mfaEnabled
                  ? [{ key: 'mfa-reset', label: t('users.resetMfa'), danger: true }]
                  : []),
              ];
              if (!items.length) return null;
              return (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items,
                    onClick: ({ key }) => {
                      if (key === 'edit') setEditing(u);
                      else
                        confirmAction(
                          u,
                          key === 'mfa-reset' ? 'mfa' : key,
                          ['deactivate', 'sessions', 'mfa-reset'].includes(key),
                        );
                    },
                  }}
                >
                  <Button size="small" aria-label={`${t('users.actions')} ${u.name}`}>
                    {t('users.actions')}
                  </Button>
                </Dropdown>
              );
            },
          },
        ]}
      />
      {editing ? (
        <UserModal
          user={editing}
          roles={roles.data?.items ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
