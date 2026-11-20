import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Flex, Form, Input, List, Select, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { quotaOf } from '../api';
import type { StepProps } from './common';

interface Role {
  id: string;
  name: string;
  isSystem: boolean;
}
interface UserRow {
  id: string;
  name: string;
  email: string;
  status: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usersKey = ['wizard', 'users'] as const;

/** Step 6 (optional): invite team members with a role (IAM invitations). */
export function TeamStep({ propertyId, saveRef }: StepProps) {
  const { t } = useTranslation('onboarding');
  const message = useApiError();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    saveRef.current = () => Promise.resolve(true);
    return () => {
      saveRef.current = null;
    };
  }, [saveRef]);

  const roles = useQuery({
    queryKey: ['wizard', 'roles'],
    queryFn: () => apiClient.get<{ items: Role[] }>('/iam/roles'),
  });
  const users = useQuery({
    queryKey: usersKey,
    queryFn: () => apiClient.get<{ items: UserRow[] }>('/iam/users'),
  });
  // The owner role is never offered: there is one owner, created at signup.
  const options = (roles.data?.items ?? [])
    .filter((r) => !(r.isSystem && r.name === 'Propriétaire'))
    .map((r) => ({ value: r.id, label: r.name }));

  async function invite() {
    setNote(null);
    if (!name.trim()) return setFieldError(t('team.errors.name'));
    if (!EMAIL.test(email.trim())) return setFieldError(t('team.errors.email'));
    if (!roleId) return setFieldError(t('team.errors.role'));
    setFieldError(null);
    setBusy(true);
    try {
      await apiClient.post('/iam/users', {
        name: name.trim(),
        email: email.trim(),
        roleIds: [roleId],
        propertyIds: [propertyId],
      });
      setNote({ kind: 'success', text: t('team.invited', { email: email.trim() }) });
      setName('');
      setEmail('');
      await qc.invalidateQueries({ queryKey: usersKey });
    } catch (e) {
      const q = quotaOf(e);
      setNote({
        kind: 'error',
        text: q
          ? t('team.quotaExceeded', { used: q.used ?? '?', limit: q.limit ?? '?' })
          : e instanceof ApiError && e.reason === 'EMAIL_TAKEN'
            ? t('team.emailTaken')
            : message(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Form layout="vertical" component={false}>
        <Flex gap={12} wrap="wrap" align="flex-start">
          <Form.Item label={t('team.name')} htmlFor="tm-name" style={{ flex: '1 1 180px' }}>
            <Input
              id="tm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </Form.Item>
          <Form.Item label={t('team.email')} htmlFor="tm-email" style={{ flex: '1 1 220px' }}>
            <Input
              id="tm-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </Form.Item>
          <Form.Item label={t('team.role')} htmlFor="tm-role" style={{ flex: '1 1 180px' }}>
            <Select
              id="tm-role"
              value={roleId}
              onChange={setRoleId}
              options={options}
              loading={roles.isLoading}
            />
          </Form.Item>
        </Flex>
        {fieldError ? (
          <Alert
            role="alert"
            type="warning"
            showIcon
            message={fieldError}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Button type="primary" onClick={() => void invite()} loading={busy}>
          {t('team.invite')}
        </Button>
      </Form>
      {note ? (
        <Alert
          role={note.kind === 'error' ? 'alert' : 'status'}
          type={note.kind}
          showIcon
          message={note.text}
          style={{ marginTop: 12 }}
        />
      ) : null}
      <List
        size="small"
        header={t('team.list')}
        bordered
        style={{ marginTop: 16 }}
        loading={users.isLoading}
        dataSource={users.data?.items ?? []}
        renderItem={(u) => (
          <List.Item
            extra={
              <Tag color={u.status === 'ACTIVE' ? 'green' : 'gold'}>
                {u.status === 'ACTIVE' ? t('team.active') : t('team.pending')}
              </Tag>
            }
          >
            <List.Item.Meta title={u.name} description={u.email} />
          </List.Item>
        )}
      />
    </>
  );
}
