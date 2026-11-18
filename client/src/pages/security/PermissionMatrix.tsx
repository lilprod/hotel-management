import { Checkbox, Table, Tag } from 'antd';
import { useTranslation } from 'react-i18next';

import type { PermissionCatalog } from './api';

interface Props {
  catalog: PermissionCatalog;
  /** Concrete permissions held by the role (wildcards already expanded). */
  value: ReadonlySet<string>;
  /** System roles are read-only: clone them to customise. */
  readOnly: boolean;
  onChange: (next: Set<string>) => void;
  sensitive?: readonly string[];
}

/** i18n key (security namespace) of an action: `rates.manage` becomes `actions.rates_manage`. */
export function actionLabelKey(module: string, permission: string): string {
  return `actions.${permission.slice(module.length + 1).replace(/\./g, '_')}`;
}

/** Roles × permissions editor: one row per module, with a "whole module" toggle and one checkbox per action. */
export function PermissionMatrix({ catalog, value, readOnly, onChange, sensitive = [] }: Props) {
  const { t } = useTranslation('security');

  const toggle = (perm: string, on: boolean) => {
    const next = new Set(value);
    if (on) next.add(perm);
    else next.delete(perm);
    onChange(next);
  };
  const toggleModule = (perms: string[], on: boolean) => {
    const next = new Set(value);
    for (const p of perms) {
      if (on) next.add(p);
      else next.delete(p);
    }
    onChange(next);
  };

  return (
    <Table<PermissionCatalog['modules'][number]>
      rowKey="module"
      size="small"
      pagination={false}
      dataSource={catalog.modules}
      scroll={{ x: 'max-content' }}
      columns={[
        {
          title: t('roles.module'),
          dataIndex: 'module',
          width: 200,
          render: (m: string) => <strong>{t(`modules.${m}`, { defaultValue: m })}</strong>,
        },
        {
          title: t('roles.all'),
          key: 'all',
          width: 80,
          render: (_: unknown, row) => {
            const held = row.permissions.filter((p) => value.has(p)).length;
            const label = t('roles.allOf', {
              module: t(`modules.${row.module}`, { defaultValue: row.module }),
            });
            return (
              <Checkbox
                aria-label={label}
                disabled={readOnly}
                checked={held === row.permissions.length}
                indeterminate={held > 0 && held < row.permissions.length}
                onChange={(e) => toggleModule(row.permissions, e.target.checked)}
              />
            );
          },
        },
        {
          title: t('roles.permissions'),
          key: 'permissions',
          render: (_: unknown, row) => (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
              {row.permissions.map((p) => (
                <Checkbox
                  key={p}
                  title={p}
                  disabled={readOnly}
                  checked={value.has(p)}
                  onChange={(e) => toggle(p, e.target.checked)}
                >
                  {t(actionLabelKey(row.module, p), {
                    defaultValue: p.slice(row.module.length + 1),
                  })}
                  {sensitive.includes(p) ? (
                    <Tag color="red" style={{ marginInlineStart: 4 }}>
                      {t('roles.sensitive')}
                    </Tag>
                  ) : null}
                </Checkbox>
              ))}
            </div>
          ),
        },
      ]}
    />
  );
}
