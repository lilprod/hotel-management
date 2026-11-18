import { PERMISSION_CATALOG } from '@hm/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import enSecurity from '../../i18n/locales/en/security.json';
import frSecurity from '../../i18n/locales/fr/security.json';
import i18n from '../../i18n';
import { PermissionMatrix, actionLabelKey } from './PermissionMatrix';

const entries = Object.entries(PERMISSION_CATALOG).flatMap(([module, actions]) =>
  (actions as readonly string[]).map((a) => ({ module, perm: `${module}.${a}` })),
);

describe('permission action labels', () => {
  it('has a FR and EN label for every permission of the shared catalog', () => {
    for (const { module, perm } of entries) {
      const key = actionLabelKey(module, perm).replace('actions.', '');
      const fr = (frSecurity.actions as Record<string, string>)[key];
      const en = (enSecurity.actions as Record<string, string>)[key];
      expect(fr, `fr label for ${perm}`).toBeTruthy();
      expect(en, `en label for ${perm}`).toBeTruthy();
    }
  });

  it('has no orphan label', () => {
    const used = new Set(
      entries.map((e) => actionLabelKey(e.module, e.perm).replace('actions.', '')),
    );
    for (const key of Object.keys(frSecurity.actions)) expect(used.has(key), key).toBe(true);
    expect(Object.keys(enSecurity.actions).sort()).toEqual(Object.keys(frSecurity.actions).sort());
  });

  it('renders translated labels instead of raw codes in the matrix', async () => {
    await i18n.changeLanguage('fr');
    render(
      <PermissionMatrix
        catalog={
          {
            modules: [{ module: 'cash', permissions: ['cash.read', 'cash.close_with_variance'] }],
          } as never
        }
        value={new Set<string>()}
        readOnly
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText('Consulter')).toBeInTheDocument();
    expect(screen.getByText('Clôturer avec écart')).toBeInTheDocument();
    expect(screen.queryByText('close_with_variance')).not.toBeInTheDocument();
  });
});
