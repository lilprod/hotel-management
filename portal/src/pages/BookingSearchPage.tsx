import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

// Messages are i18n keys, translated at render time.
export const searchSchema = z
  .object({
    checkIn: z.string().min(1, 'pages:booking.validation.dateRequired'),
    checkOut: z.string().min(1, 'pages:booking.validation.dateRequired'),
    adults: z
      .number({ error: 'pages:booking.validation.adultsInvalid' })
      .int('pages:booking.validation.adultsInvalid')
      .min(1, 'pages:booking.validation.adultsInvalid')
      .max(10, 'pages:booking.validation.adultsInvalid'),
    children: z
      .number({ error: 'pages:booking.validation.childrenInvalid' })
      .int('pages:booking.validation.childrenInvalid')
      .min(0, 'pages:booking.validation.childrenInvalid')
      .max(10, 'pages:booking.validation.childrenInvalid'),
  })
  .refine((v) => v.checkOut > v.checkIn, {
    path: ['checkOut'],
    message: 'pages:booking.validation.checkoutAfterCheckin',
  });

export type SearchValues = z.infer<typeof searchSchema>;

const DAY_MS = 86_400_000;

/** Number of nights: arrival night included, departure day excluded (ISO dates, UTC math). */
export function countNights(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY_MS);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function BookingSearchPage() {
  const { t } = useTranslation();
  const [result, setResult] = useState<SearchValues | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SearchValues>({
    resolver: zodResolver(searchSchema),
    defaultValues: { checkIn: '', checkOut: '', adults: 2, children: 0 },
  });

  const field = (name: keyof SearchValues) => ({
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
  });
  const error = (name: keyof SearchValues) => {
    const message = errors[name]?.message;
    return message ? (
      <p id={`${name}-error`} className="field-error" role="alert">
        {t(message)}
      </p>
    ) : null;
  };

  return (
    <section aria-labelledby="booking-title">
      <h1 id="booking-title">{t('pages:booking.title')}</h1>
      <p className="lead">{t('pages:booking.lead')}</p>
      <form className="search" noValidate onSubmit={handleSubmit(setResult)}>
        <div className="field">
          <label htmlFor="checkIn">{t('pages:booking.checkIn')}</label>
          <input
            id="checkIn"
            type="date"
            min={todayIso()}
            {...field('checkIn')}
            {...register('checkIn')}
          />
          {error('checkIn')}
        </div>
        <div className="field">
          <label htmlFor="checkOut">{t('pages:booking.checkOut')}</label>
          <input
            id="checkOut"
            type="date"
            min={todayIso()}
            {...field('checkOut')}
            {...register('checkOut')}
          />
          {error('checkOut')}
        </div>
        <div className="field">
          <label htmlFor="adults">{t('pages:booking.adults')}</label>
          <input
            id="adults"
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            {...field('adults')}
            {...register('adults', { valueAsNumber: true })}
          />
          {error('adults')}
        </div>
        <div className="field">
          <label htmlFor="children">{t('pages:booking.children')}</label>
          <input
            id="children"
            type="number"
            inputMode="numeric"
            min={0}
            max={10}
            {...field('children')}
            {...register('children', { valueAsNumber: true })}
          />
          {error('children')}
        </div>
        <button className="button" type="submit">
          {t('pages:booking.submit')}
        </button>
      </form>
      <div role="status" className="result">
        {result
          ? t('pages:booking.summary', {
              checkIn: result.checkIn,
              checkOut: result.checkOut,
              nights: t('pages:booking.nights', {
                count: countNights(result.checkIn, result.checkOut),
              }),
              adults: result.adults,
              children: result.children,
            })
          : null}
      </div>
    </section>
  );
}
