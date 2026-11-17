import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, apiErrorKeys, fieldIssueKeys } from '@hm/ui';

/** Translates an API failure (RFC 7807 `code` / `meta.reason`) into a user-facing message. */
export function useApiError() {
  const { t } = useTranslation();
  return useCallback(
    (err: unknown): string => {
      // password-policy violations: list the translated rules
      if (err instanceof ApiError && err.errors.some((e) => e.code)) {
        return err.errors.map((e) => t(fieldIssueKeys(e))).join(' ');
      }
      return t(apiErrorKeys(err));
    },
    [t],
  );
}
