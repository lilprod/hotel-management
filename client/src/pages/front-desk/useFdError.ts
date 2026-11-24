import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@hm/ui';

import { useApiError } from '../../auth/useApiError';

/**
 * Message of a failed desk operation: the business reason of a 409 (`meta.reason`: ROOM_NOT_CLEAN,
 * CHECKOUT_BLOCKED…) gets its own sentence, anything else falls back to the generic API message.
 */
export function useFdError() {
  const { t } = useTranslation('frontDesk');
  const generic = useApiError();
  return useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError && err.reason) {
        const key = `errors.${err.reason}`;
        const text = t(key, { defaultValue: '' });
        if (text) return text;
      }
      return generic(err);
    },
    [t, generic],
  );
}
