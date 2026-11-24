import { UploadOutlined } from '@ant-design/icons';
import { Button, Checkbox, Flex, Form, Input, InputNumber, Select, Space, Tag, Upload } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useApiError } from '../../auth/useApiError';
import type { CustomFieldDef } from '../../reservations/api';
import { useCustomFieldDefs, useLabel } from '../../reservations/refs';
import { uploadFdFile } from './api';
import type { Identity } from './api';
import type { IdentityErrors } from './model';

/** Form parts shared by the check-in and walk-in drawers (police form, uploads, deposit). */

export const ID_TYPES = ['CNI', 'PASSPORT', 'RESIDENCE_PERMIT', 'DRIVING_LICENCE', 'OTHER'] as const;
export const DEPOSIT_METHODS = ['CASH', 'CARD', 'MIXX', 'MOOV_MONEY', 'BANK_TRANSFER'] as const;

interface IdentityProps {
  id: string;
  value: Identity;
  onChange: (v: Identity) => void;
  errors: IdentityErrors;
  /** The profile already stores a document number (masked): leaving the field empty keeps it. */
  storedNumber?: string | null | undefined;
  /** Name fields are locked when the guest profile is the reservation booker. */
  lockNames?: boolean;
}

/** Identity block of the police form (doc 09 §4): one per guest of the room. */
export function IdentityFields({ id, value, onChange, errors, storedNumber, lockNames }: IdentityProps) {
  const { t } = useTranslation('frontDesk');
  const set = (patch: Partial<Identity>) => onChange({ ...value, ...patch });
  const item = (key: keyof Identity, label: string, node: React.ReactNode, required = true) => (
    <Form.Item
      key={key}
      label={label}
      required={required}
      validateStatus={errors[key] ? 'error' : ''}
      help={errors[key] ? <span role="alert">{t(errors[key]!)}</span> : undefined}
      style={{ flex: '1 1 220px', minWidth: 200, marginBottom: 12 }}
    >
      {node}
    </Form.Item>
  );
  const text = (key: keyof Identity, label: string, extra: Record<string, unknown> = {}) =>
    item(
      key,
      label,
      <Input
        id={`${id}-${key}`}
        aria-label={label}
        value={(value[key] as string) ?? ''}
        onChange={(e) => set({ [key]: e.target.value })}
        {...extra}
      />,
      key !== 'profession' && key !== 'idIssuedOn' && key !== 'idIssuedPlace',
    );
  return (
    <Flex gap="0 12px" wrap>
      {text('lastName', t('fields.lastName'), { disabled: lockNames })}
      {text('firstName', t('fields.firstName'), { disabled: lockNames })}
      {text('birthDate', t('fields.birthDate'), { type: 'date' })}
      {text('birthPlace', t('fields.birthPlace'))}
      {item(
        'nationality',
        t('fields.nationality'),
        <Input
          id={`${id}-nationality`}
          aria-label={t('fields.nationality')}
          maxLength={2}
          placeholder="TG"
          value={value.nationality}
          onChange={(e) => set({ nationality: e.target.value.toUpperCase() })}
        />,
      )}
      {text('profession', t('fields.profession'))}
      {text('address', t('fields.address'))}
      {item(
        'idDocType',
        t('fields.idDocType'),
        <Select
          id={`${id}-idDocType`}
          aria-label={t('fields.idDocType')}
          value={value.idDocType || undefined}
          onChange={(v) => set({ idDocType: v })}
          options={ID_TYPES.map((x) => ({ value: x, label: t(`idTypes.${x}`) }))}
        />,
      )}
      {item(
        'idDocNumber',
        t('fields.idDocNumber'),
        <Input
          id={`${id}-idDocNumber`}
          aria-label={t('fields.idDocNumber')}
          autoComplete="off"
          placeholder={storedNumber ? `${storedNumber} (${t('fields.kept')})` : ''}
          value={value.idDocNumber}
          onChange={(e) => set({ idDocNumber: e.target.value })}
        />,
        !storedNumber,
      )}
      {text('idIssuedOn', t('fields.idIssuedOn'), { type: 'date' })}
      {text('idIssuedPlace', t('fields.idIssuedPlace'))}
    </Flex>
  );
}

export interface PoliceStay {
  provenance: string;
  destination: string;
  purpose: string;
}

/** Stay part of the police form + tenant custom fields (entity `police_record`). */
export function PoliceStayFields({
  value,
  onChange,
  custom,
  onCustomChange,
  customErrors,
}: {
  value: PoliceStay;
  onChange: (v: PoliceStay) => void;
  custom: Record<string, unknown>;
  onCustomChange: (v: Record<string, unknown>) => void;
  customErrors?: Record<string, string>;
}) {
  const { t } = useTranslation('frontDesk');
  const label = useLabel();
  const defs = useCustomFieldDefs('police_record');
  const input = (key: keyof PoliceStay) => (
    <Form.Item label={t(`fields.${key}`)} style={{ flex: '1 1 220px', minWidth: 200, marginBottom: 12 }}>
      <Input
        aria-label={t(`fields.${key}`)}
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </Form.Item>
  );
  return (
    <>
      <Flex gap="0 12px" wrap>
        {input('provenance')}
        {input('destination')}
        {input('purpose')}
      </Flex>
      {(defs.data ?? []).map((d) => (
        <Form.Item
          key={d.key}
          label={label(d.label)}
          required={d.required}
          validateStatus={customErrors?.[d.key] ? 'error' : ''}
          help={customErrors?.[d.key]}
        >
          <CustomInput
            def={d}
            value={custom[d.key]}
            onChange={(v) => onCustomChange({ ...custom, [d.key]: v })}
          />
        </Form.Item>
      ))}
    </>
  );
}

function CustomInput({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = useLabel();
  const opts = (def.options ?? []).map((o) => ({ value: o.value, label: label(o.label) }));
  switch (def.type) {
    case 'NUMBER':
      return (
        <InputNumber aria-label={label(def.label)} value={value as number | null} onChange={onChange} />
      );
    case 'BOOLEAN':
      return <Checkbox checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case 'DATE':
      return (
        <Input
          type="date"
          aria-label={label(def.label)}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'SELECT':
      return (
        <Select
          aria-label={label(def.label)}
          allowClear
          value={value as string | undefined}
          onChange={onChange}
          options={opts}
        />
      );
    case 'MULTI_SELECT':
      return (
        <Select
          aria-label={label(def.label)}
          mode="multiple"
          value={(value as string[]) ?? []}
          onChange={onChange}
          options={opts}
        />
      );
    default:
      return (
        <Input
          aria-label={label(def.label)}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** Optional uploads: handwritten signature image and ID scan (private bucket). */
export function UploadFields({
  signatureId,
  scanId,
  onSignature,
  onScan,
}: {
  signatureId: string | null;
  scanId: string | null;
  onSignature: (id: string | null) => void;
  onScan: (id: string | null) => void;
}) {
  const { t } = useTranslation('frontDesk');
  const toMessage = useApiError();
  const [error, setError] = useState<string | null>(null);
  const one = (kind: 'signature' | 'id_scan', id: string | null, set: (v: string | null) => void) => (
    <Form.Item
      label={t(kind === 'signature' ? 'fields.signature' : 'fields.idScan')}
      style={{ flex: '1 1 260px', marginBottom: 8 }}
    >
      <Upload
        accept={kind === 'signature' ? 'image/png,image/jpeg' : 'image/png,image/jpeg,application/pdf'}
        maxCount={1}
        showUploadList={false}
        beforeUpload={(file) => {
          setError(null);
          uploadFdFile(kind, file)
            .then(set)
            .catch((e: unknown) => setError(toMessage(e)));
          return false;
        }}
      >
        <Space>
          <Button icon={<UploadOutlined />}>{t('fields.choosFile')}</Button>
          {id ? <Tag color="success">{t('fields.uploaded')}</Tag> : null}
          {id ? (
            <Button type="link" size="small" onClick={() => set(null)}>
              {t('fields.remove')}
            </Button>
          ) : null}
        </Space>
      </Upload>
    </Form.Item>
  );
  return (
    <>
      <Flex gap="0 12px" wrap>
        {one('signature', signatureId, onSignature)}
        {one('id_scan', scanId, onScan)}
      </Flex>
      {error ? (
        <div role="alert" style={{ color: 'var(--ant-color-error, #cf1322)' }}>
          {error}
        </div>
      ) : null}
    </>
  );
}

export interface DepositValue {
  method: (typeof DEPOSIT_METHODS)[number];
  amount: number | null;
  reference: string;
}

/** Optional deposit taken through the folio payment API (minimal form). */
export function DepositFields({
  value,
  onChange,
  currency,
}: {
  value: DepositValue;
  onChange: (v: DepositValue) => void;
  currency: string;
}) {
  const { t } = useTranslation('frontDesk');
  return (
    <Flex gap="0 12px" wrap>
      <Form.Item label={t('deposit.method')} style={{ flex: '1 1 200px' }}>
        <Select
          aria-label={t('deposit.method')}
          value={value.method}
          onChange={(m) => onChange({ ...value, method: m })}
          options={DEPOSIT_METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) }))}
        />
      </Form.Item>
      <Form.Item label={`${t('deposit.amount')} (${currency})`} style={{ flex: '1 1 200px' }}>
        <InputNumber
          aria-label={t('deposit.amount')}
          min={0}
          step={1000}
          precision={0}
          style={{ width: '100%' }}
          value={value.amount}
          onChange={(a) => onChange({ ...value, amount: a })}
        />
      </Form.Item>
      <Form.Item label={t('deposit.reference')} style={{ flex: '1 1 200px' }}>
        <Input
          aria-label={t('deposit.reference')}
          value={value.reference}
          onChange={(e) => onChange({ ...value, reference: e.target.value })}
        />
      </Form.Item>
    </Flex>
  );
}
