import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Flex, Input, Select, Table, Tag } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { PageHeader } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { SUB_STATUSES, money, qs, useAbilities, useFormatDate } from '../../billing/common';
import type { Paged } from '../../billing/common';
import { useDebounced, usePaging } from '../../billing/hooks';
import type { Plan, TenantListItem } from '../../billing/models';
import { SubStatusTag } from '../../billing/ui';

export function usePlans(includeDeleted = false) {
  return useQuery({
    queryKey: ['plans', includeDeleted],
    queryFn: () =>
      apiClient.get<{ items: Plan[] }>(
        `/plans${qs({ includeDeleted: includeDeleted || undefined })}`,
      ),
  });
}

/** SA-20: tenants table with search and filters (subscription status, plan, tenant status, tag). */
export function TenantsPage() {
  const { t } = useTranslation('ten');
  const { t: tb } = useTranslation('billing');
  const message = useApiError();
  const can = useAbilities();
  const fmt = useFormatDate();
  const navigate = useNavigate();
  const paging = usePaging();
  const plans = usePlans();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [status, setStatus] = useState<string | undefined>();
  const [tenantStatus, setTenantStatus] = useState<string | undefined>();
  const [planId, setPlanId] = useState<string | undefined>();
  const [tag, setTag] = useState('');
  const tagQ = useDebounced(tag);

  const filters = { q, status, tenantStatus, planId, tag: tagQ };
  const list = useQuery({
    queryKey: ['tenants', filters, paging.limit, paging.offset],
    queryFn: () =>
      apiClient.get<Paged<TenantListItem>>(
        `/tenants${qs({ ...filters, limit: paging.limit, offset: paging.offset })}`,
      ),
  });
  const onFilter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      paging.reset();
    };

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          can.admin ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/tenants/new')}>
              {t('create')}
            </Button>
          ) : null
        }
      />
      <Flex gap={12} wrap style={{ marginBottom: 16 }} role="search" aria-label={t('filters')}>
        <Input.Search
          allowClear
          placeholder={t('searchPlaceholder')}
          aria-label={tb('search')}
          style={{ width: 260 }}
          value={search}
          onChange={(e) => onFilter(setSearch)(e.target.value)}
        />
        <Select
          allowClear
          placeholder={t('subscriptionStatus')}
          aria-label={t('subscriptionStatus')}
          style={{ width: 190 }}
          value={status}
          onChange={onFilter(setStatus)}
          options={SUB_STATUSES.map((s) => ({ value: s, label: tb(`subStatus.${s}`) }))}
        />
        <Select
          allowClear
          placeholder={t('accountStatus')}
          aria-label={t('accountStatus')}
          style={{ width: 170 }}
          value={tenantStatus}
          onChange={onFilter(setTenantStatus)}
          options={(['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const).map((s) => ({
            value: s,
            label: t(`accountStatuses.${s}`),
          }))}
        />
        <Select
          allowClear
          placeholder={t('plan')}
          aria-label={t('plan')}
          style={{ width: 190 }}
          value={planId}
          onChange={onFilter(setPlanId)}
          options={(plans.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))}
        />
        <Input
          allowClear
          placeholder={t('tag')}
          aria-label={t('tag')}
          style={{ width: 150 }}
          value={tag}
          onChange={(e) => onFilter(setTag)(e.target.value)}
        />
      </Flex>
      {list.isError ? (
        <Alert type="error" showIcon message={message(list.error)} style={{ marginBottom: 12 }} />
      ) : null}
      <Table<TenantListItem>
        rowKey="id"
        loading={list.isPending}
        dataSource={list.data?.items ?? []}
        pagination={paging.table(list.data?.total ?? 0)}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: tb('tenant'),
            render: (_: unknown, r) => (
              <>
                <Link to={`/tenants/${r.id}`}>
                  <strong>{r.name}</strong>
                </Link>
                <div style={{ opacity: 0.7 }}>{r.host ?? r.slug}</div>
              </>
            ),
          },
          {
            title: t('subscriptionStatus'),
            render: (_: unknown, r) =>
              r.subscription ? <SubStatusTag status={r.subscription.status} /> : '—',
          },
          {
            title: t('plan'),
            render: (_: unknown, r) =>
              r.subscription
                ? `${r.subscription.plan.name} · ${tb(`cycle.${r.subscription.billingCycle}`)}`
                : '—',
          },
          {
            title: t('periodEnd'),
            render: (_: unknown, r) => fmt.day(r.subscription?.currentPeriodEnd),
          },
          {
            title: t('amountDue'),
            dataIndex: 'amountDue',
            align: 'right',
            render: (a: number) => (a > 0 ? <strong>{money(a)}</strong> : money(0)),
          },
          {
            title: t('tags'),
            dataIndex: 'tags',
            render: (tags: string[]) => tags.map((x) => <Tag key={x}>{x}</Tag>),
          },
          { title: t('createdAt'), dataIndex: 'createdAt', render: (d: string) => fmt.day(d) },
        ]}
      />
    </>
  );
}
