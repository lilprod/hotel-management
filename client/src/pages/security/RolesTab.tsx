import { CopyOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Flex, Input, List, Modal, Space, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { useCan } from '../../auth/useCan';
import { expandPermissions } from './api';
import type { PermissionCatalog, Role } from './api';
import { PermissionMatrix } from './PermissionMatrix';

/** Permissions the doc flags as sensitive (always audited, possibly 2FA-gated). */
const SENSITIVE = [
  'folio.discount',
  'folio.reverse',
  'invoices.credit_note',
  'cash.close_with_variance',
  'pos.void',
  'night_audit.run',
  'loyalty.adjust',
  'spa.records.read',
  'hr.timeclock.edit',
  'users.manage',
  'security.manage',
  'billing.manage',
  'guests.export',
];

/** Roles: system roles are read-only ("Cloner"), custom roles are edited in the matrix (feature security.custom_roles). */
export function RolesTab() {
  const { t } = useTranslation('security');
  const message = useApiError();
  const { can, has } = useCan();
  const qc = useQueryClient();
  const customRoles = has('security.custom_roles');
  const manage = can('roles.manage') && customRoles;

  const roles = useQuery({
    queryKey: ['iam-roles'],
    queryFn: () => apiClient.get<{ items: Role[] }>('/iam/roles'),
  });
  const catalog = useQuery({
    queryKey: ['iam-permissions'],
    queryFn: () => apiClient.get<PermissionCatalog>('/iam/permissions'),
    staleTime: 10 * 60_000,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = roles.data?.items.find((r) => r.id === selectedId) ?? roles.data?.items[0];
  const allPerms = useMemo(
    () => catalog.data?.modules.flatMap((m) => m.permissions) ?? [],
    [catalog.data],
  );
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'create' | 'clone' | 'rename' | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selected) setDraft(expandPermissions(selected.permissions, allPerms));
  }, [selected, allPerms]);

  const dirty =
    !!selected &&
    !selected.isSystem &&
    (() => {
      const base = expandPermissions(selected.permissions, allPerms);
      return base.size !== draft.size || [...draft].some((p) => !base.has(p));
    })();

  const refresh = () => qc.invalidateQueries({ queryKey: ['iam-roles'] });
  const wrap = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(message(e));
    }
  };

  const save = useMutation({
    mutationFn: () =>
      apiClient.put(`/iam/roles/${selected?.id}/permissions`, { permissions: [...draft].sort() }),
    onSuccess: refresh,
    onError: (e) => setError(message(e)),
  });

  const submitDialog = async () => {
    const body = {
      name: form.name,
      ...(form.description ? { description: form.description } : {}),
    };
    await wrap(async () => {
      if (dialog === 'create') {
        const r = await apiClient.post<Role>('/iam/roles', body);
        setSelectedId(r.id);
      } else if (dialog === 'clone' && selected) {
        const r = await apiClient.post<Role>(`/iam/roles/${selected.id}/clone`, body);
        setSelectedId(r.id);
      } else if (dialog === 'rename' && selected) {
        await apiClient.patch(`/iam/roles/${selected.id}`, body);
      }
      setDialog(null);
    });
  };

  const remove = () =>
    Modal.confirm({
      title: t('roles.deleteConfirm', { name: selected?.name }),
      okText: t('roles.delete'),
      cancelText: t('cancel'),
      okButtonProps: { danger: true },
      onOk: () =>
        wrap(async () => {
          await apiClient.delete(`/iam/roles/${selected?.id}`);
          setSelectedId(null);
        }),
    });

  const openDialog = (kind: 'create' | 'clone' | 'rename') => {
    setForm({
      name:
        kind === 'clone' && selected
          ? `${selected.name} (${t('roles.copy')})`
          : kind === 'rename' && selected
            ? selected.name
            : '',
      description: kind === 'rename' ? (selected?.description ?? '') : '',
    });
    setDialog(kind);
  };

  return (
    <Flex gap={16} wrap align="flex-start">
      <Card
        size="small"
        title={t('roles.list')}
        style={{ width: 280, flex: '0 0 280px' }}
        extra={
          manage ? (
            <Button size="small" icon={<PlusOutlined />} onClick={() => openDialog('create')}>
              {t('roles.new')}
            </Button>
          ) : null
        }
      >
        <List
          loading={roles.isPending}
          dataSource={roles.data?.items ?? []}
          renderItem={(r) => (
            <List.Item style={{ padding: 0 }}>
              <button
                type="button"
                aria-pressed={r.id === selected?.id}
                onClick={() => setSelectedId(r.id)}
                style={{
                  all: 'unset',
                  boxSizing: 'border-box',
                  width: '100%',
                  cursor: 'pointer',
                  padding: '8px 4px',
                  fontWeight: r.id === selected?.id ? 600 : 400,
                  borderInlineStart: `3px solid ${r.id === selected?.id ? 'var(--ant-color-primary, #1677ff)' : 'transparent'}`,
                  paddingInlineStart: 8,
                }}
              >
                {r.name}{' '}
                <Tag color={r.isSystem ? 'geekblue' : 'purple'}>
                  {r.isSystem ? t('roles.system') : t('roles.custom')}
                </Tag>
                <div style={{ opacity: 0.65, fontSize: 12 }}>
                  {t('roles.users', { count: r.userCount })}
                </div>
              </button>
            </List.Item>
          )}
        />
      </Card>

      <div style={{ flex: '1 1 480px', minWidth: 0 }}>
        {!customRoles ? (
          <Alert style={{ marginBottom: 12 }} type="info" showIcon message={t('roles.notInPlan')} />
        ) : null}
        {error ? (
          <Alert style={{ marginBottom: 12 }} type="error" showIcon message={error} role="alert" />
        ) : null}
        {selected ? (
          <>
            <Flex
              justify="space-between"
              align="flex-start"
              wrap
              gap={8}
              style={{ marginBottom: 12 }}
            >
              <div>
                <Typography.Title level={2} style={{ fontSize: 18, margin: 0 }}>
                  {selected.name}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {selected.isSystem ? t('roles.systemHint') : (selected.description ?? '')}
                </Typography.Text>
              </div>
              <Space wrap>
                {manage ? (
                  <Button icon={<CopyOutlined />} onClick={() => openDialog('clone')}>
                    {t('roles.clone')}
                  </Button>
                ) : null}
                {manage && !selected.isSystem ? (
                  <>
                    <Button onClick={() => openDialog('rename')}>{t('roles.rename')}</Button>
                    <Button danger disabled={selected.userCount > 0} onClick={remove}>
                      {t('roles.delete')}
                    </Button>
                    <Button
                      type="primary"
                      disabled={!dirty}
                      loading={save.isPending}
                      onClick={() => save.mutate()}
                    >
                      {t('save')}
                    </Button>
                  </>
                ) : null}
              </Space>
            </Flex>
            {catalog.data ? (
              <PermissionMatrix
                catalog={catalog.data}
                value={draft}
                readOnly={selected.isSystem || !manage}
                onChange={setDraft}
                sensitive={SENSITIVE}
              />
            ) : (
              <Alert
                type={catalog.isError ? 'error' : 'info'}
                message={catalog.isError ? message(catalog.error) : '…'}
              />
            )}
          </>
        ) : null}
      </div>

      <Modal
        open={dialog !== null}
        title={t(`roles.dialog.${dialog ?? 'create'}`)}
        okText={t('save')}
        cancelText={t('cancel')}
        okButtonProps={{ disabled: form.name.trim().length === 0 }}
        onOk={() => void submitDialog()}
        onCancel={() => setDialog(null)}
      >
        <Flex vertical gap={8}>
          <label htmlFor="role-name">{t('roles.name')}</label>
          <Input
            id="role-name"
            value={form.name}
            maxLength={80}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <label htmlFor="role-desc">{t('roles.description')}</label>
          <Input.TextArea
            id="role-desc"
            rows={2}
            maxLength={500}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Flex>
      </Modal>
    </Flex>
  );
}
