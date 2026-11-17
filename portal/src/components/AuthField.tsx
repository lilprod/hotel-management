import type { ReactNode } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

interface AuthFieldProps {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
  /** i18n key (zod message). */
  error?: string | undefined;
  register: UseFormRegisterReturn;
  children?: ReactNode;
}

/** Label + input + accessible error (RHF registers a ref and a name; zod messages are i18n keys). */
export function AuthField({
  id,
  label,
  type = 'text',
  autoComplete,
  hint,
  error,
  register,
}: AuthFieldProps) {
  const { t } = useTranslation();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        {...(autoComplete ? { autoComplete } : {})}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...register}
      />
      {hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="field-error" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}
