import { useQuery } from '@tanstack/react-query';
import { Select } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../auth/session';
import { qs } from './common';
import type { Paged, TenantRef } from './common';

/** Server-side pagination state for antd tables (limit / offset). */
export function usePaging(initialSize = 20) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(initialSize);
  return {
    limit: size,
    offset: (page - 1) * size,
    reset: () => setPage(1),
    table: (total: number) => ({
      current: page,
      pageSize: size,
      total,
      showSizeChanger: true,
      onChange: (p: number, s: number) => {
        setPage(p);
        setSize(s);
      },
    }),
  };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

interface TenantSelectProps {
  id?: string;
  value?: string | undefined;
  onChange?: (id: string | undefined, tenant?: TenantRef) => void;
  allowClear?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/** Server-side tenant search (name, slug, e-mail). */
export function TenantSelect({
  id,
  value,
  onChange,
  allowClear,
  disabled,
  placeholder,
}: TenantSelectProps) {
  const { t } = useTranslation('billing');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const list = useQuery({
    queryKey: ['tenant-search', q],
    queryFn: () => apiClient.get<Paged<TenantRef>>(`/tenants${qs({ q, limit: 20 })}`),
  });
  const known = list.data?.items ?? [];
  const selected = useQuery({
    queryKey: ['tenant-ref', value],
    enabled: Boolean(value) && !known.some((x) => x.id === value),
    queryFn: () => apiClient.get<TenantRef>(`/tenants/${value}`),
  });
  const options = [
    ...known,
    ...(selected.data && !known.some((x) => x.id === selected.data.id) ? [selected.data] : []),
  ];
  return (
    <Select<string>
      id={id}
      showSearch
      allowClear={allowClear ?? false}
      disabled={disabled ?? false}
      filterOption={false}
      value={value}
      placeholder={placeholder ?? t('searchTenant')}
      loading={list.isFetching}
      onSearch={setSearch}
      onChange={(v) =>
        onChange?.(
          v,
          options.find((o) => o.id === v),
        )
      }
      onClear={() => onChange?.(undefined)}
      notFoundContent={t('noTenant')}
      options={options.map((x) => ({ value: x.id, label: `${x.name} (${x.slug})` }))}
      style={{ minWidth: 240, width: '100%' }}
    />
  );
}
