import { Form } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** aria wiring for an input rendered inside {@link Field}. */
export function a11y(id: string, error?: unknown) {
  return {
    id,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
  };
}

interface FieldProps {
  id: string;
  label: ReactNode;
  /** i18n key (zod message) or already translated text. */
  error?: string | undefined;
  extra?: ReactNode;
  required?: boolean;
  children: ReactNode;
}

/** Label + control + accessible error message (RHF + Zod errors carry i18n keys). */
export function Field({ id, label, error, extra, required, children }: FieldProps) {
  const { t } = useTranslation();
  return (
    <Form.Item
      label={label}
      htmlFor={id}
      required={required}
      validateStatus={error ? 'error' : ''}
      extra={extra}
      help={
        error ? (
          <span id={`${id}-error`} role="alert">
            {t(error)}
          </span>
        ) : undefined
      }
    >
      {children}
    </Form.Item>
  );
}
