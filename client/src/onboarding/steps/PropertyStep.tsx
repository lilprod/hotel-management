import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Col, Form, Input, Row, Skeleton } from 'antd';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { Field, a11y, bind } from '../../components/Field';
import { propertyKey, type PropertyDto, type StepProps } from './common';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'onboarding:property.errors.time');

export const propertySchema = z.object({
  name: z.string().trim().min(1, 'onboarding:property.errors.name').max(160),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  taxId: z.string().trim().max(60).optional(),
  rccm: z.string().trim().max(60).optional(),
  checkinTime: hhmm,
  checkoutTime: hhmm,
});
type Values = z.infer<typeof propertySchema>;

/** Step 1: establishment identity (name, address, NIF / RCCM, check-in and check-out times). */
export function PropertyStep({ propertyId, saveRef }: StepProps) {
  const { t } = useTranslation('onboarding');
  const message = useApiError();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const property = useQuery({
    queryKey: propertyKey(propertyId),
    queryFn: () => apiClient.get<PropertyDto>(`/lodging/properties/${propertyId}`),
  });
  const form = useForm<Values>({
    resolver: zodResolver(propertySchema),
    defaultValues: {
      name: '',
      address: '',
      city: '',
      phone: '',
      taxId: '',
      rccm: '',
      checkinTime: '14:00',
      checkoutTime: '12:00',
    },
  });
  const { register, reset, handleSubmit, formState } = form;
  const errors = formState.errors;

  useEffect(() => {
    const p = property.data;
    if (p)
      reset({
        name: p.name,
        address: p.address ?? '',
        city: p.city ?? '',
        phone: p.phone ?? '',
        taxId: p.taxId ?? '',
        rccm: p.rccm ?? '',
        checkinTime: p.checkinTime,
        checkoutTime: p.checkoutTime,
      });
  }, [property.data, reset]);

  useEffect(() => {
    saveRef.current = () =>
      new Promise<boolean>((resolve) => {
        void handleSubmit(
          async (v) => {
            setError(null);
            try {
              const body = Object.fromEntries(
                Object.entries(v).filter(([, x]) => x !== undefined && x !== ''),
              );
              await apiClient.patch(`/lodging/properties/${propertyId}`, body);
              await qc.invalidateQueries({ queryKey: propertyKey(propertyId) });
              await qc.invalidateQueries({ queryKey: ['properties'] });
              resolve(true);
            } catch (e) {
              setError(message(e));
              resolve(false);
            }
          },
          () => resolve(false),
        )();
      });
    return () => {
      saveRef.current = null;
    };
  }, [handleSubmit, propertyId, qc, message, saveRef]);

  if (property.isLoading) return <Skeleton active />;
  return (
    <>
      {error ? (
        <Alert role="alert" type="error" showIcon message={error} style={{ marginBottom: 16 }} />
      ) : null}
      <Form layout="vertical" component={false}>
        <Field id="p-name" label={t('property.name')} error={errors.name?.message} required>
          <Input {...a11y('p-name', errors.name)} {...bind(register('name'))} />
        </Field>
        <Field id="p-address" label={t('property.address')}>
          <Input {...a11y('p-address')} {...bind(register('address'))} />
        </Field>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Field id="p-city" label={t('property.city')}>
              <Input {...a11y('p-city')} {...bind(register('city'))} />
            </Field>
          </Col>
          <Col xs={24} md={12}>
            <Field id="p-phone" label={t('property.phone')}>
              <Input type="tel" {...a11y('p-phone')} {...bind(register('phone'))} />
            </Field>
          </Col>
          <Col xs={24} md={12}>
            <Field id="p-taxid" label={t('property.taxId')}>
              <Input {...a11y('p-taxid')} {...bind(register('taxId'))} />
            </Field>
          </Col>
          <Col xs={24} md={12}>
            <Field id="p-rccm" label={t('property.rccm')}>
              <Input {...a11y('p-rccm')} {...bind(register('rccm'))} />
            </Field>
          </Col>
          <Col xs={12}>
            <Field id="p-checkin" label={t('property.checkin')} error={errors.checkinTime?.message}>
              <Input
                {...a11y('p-checkin', errors.checkinTime)}
                {...bind(register('checkinTime'))}
              />
            </Field>
          </Col>
          <Col xs={12}>
            <Field
              id="p-checkout"
              label={t('property.checkout')}
              error={errors.checkoutTime?.message}
            >
              <Input
                {...a11y('p-checkout', errors.checkoutTime)}
                {...bind(register('checkoutTime'))}
              />
            </Field>
          </Col>
        </Row>
      </Form>
    </>
  );
}
