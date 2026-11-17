import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Icon } from './Icon';

export interface StaySearch {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
}

const DAY_MS = 86_400_000;

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** `/booking?checkIn=…&checkOut=…&adults=…&children=…`: the query read by the booking page. */
export function buildBookingUrl(search: StaySearch): string {
  const params = new URLSearchParams({
    checkIn: search.checkIn,
    checkOut: search.checkOut,
    adults: String(search.adults),
    children: String(search.children),
  });
  return `/booking?${params.toString()}`;
}

/** Floating availability search shown over the hero. Navigates to the booking search page. */
export function SearchBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const uid = useId();
  const [checkIn, setCheckIn] = useState(() => isoDate(7));
  const [checkOut, setCheckOut] = useState(() => isoDate(9));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const onCheckIn = (value: string) => {
    setCheckIn(value);
    // Keep the departure after the arrival when the arrival moves forward.
    if (value && checkOut <= value) {
      setCheckOut(new Date(Date.parse(value) + DAY_MS).toISOString().slice(0, 10));
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      setError(t('home:search.checkoutAfterCheckin'));
      return;
    }
    setError(null);
    void navigate(buildBookingUrl({ checkIn, checkOut, adults, children }));
  };

  const id = (name: string) => `${uid}-${name}`;

  return (
    <form className="search-bar" onSubmit={onSubmit} aria-label={t('home:search.label')} noValidate>
      <div className="sb-field">
        <label htmlFor={id('in')}>
          <Icon name="calendar" size={18} />
          {t('home:search.checkIn')}
        </label>
        <input
          id={id('in')}
          type="date"
          value={checkIn}
          min={isoDate(0)}
          onChange={(e) => onCheckIn(e.target.value)}
          required
        />
      </div>
      <div className="sb-field">
        <label htmlFor={id('out')}>
          <Icon name="calendar" size={18} />
          {t('home:search.checkOut')}
        </label>
        <input
          id={id('out')}
          type="date"
          value={checkOut}
          min={checkIn || isoDate(0)}
          onChange={(e) => setCheckOut(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? id('error') : undefined}
          required
        />
      </div>
      <div className="sb-field sb-small">
        <label htmlFor={id('adults')}>
          <Icon name="users" size={18} />
          {t('home:search.adults')}
        </label>
        <select
          id={id('adults')}
          value={adults}
          onChange={(e) => setAdults(Number(e.target.value))}
        >
          {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="sb-field sb-small">
        <label htmlFor={id('children')}>
          <Icon name="user" size={18} />
          {t('home:search.children')}
        </label>
        <select
          id={id('children')}
          value={children}
          onChange={(e) => setChildren(Number(e.target.value))}
        >
          {Array.from({ length: 7 }, (_, i) => i).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="button sb-submit">
        {t('home:search.submit')}
      </button>
      {error ? (
        <p id={id('error')} className="sb-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
