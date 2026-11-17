import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { formatMoney, money } from '@hm/shared';

import { pick } from '../demo-content';
import type { DemoAccommodation } from '../demo-content';
import { Icon } from './Icon';
import { Photo } from './Photo';
import './accommodation.css';

interface Props {
  unit: DemoAccommodation;
  /** Large variant used on the accommodations page. */
  featured?: boolean;
}

export function AccommodationCard({ unit, featured = false }: Props) {
  const { t, i18n } = useTranslation();
  const name = pick(unit.name, i18n.language);
  return (
    <article className={featured ? 'unit-card is-featured' : 'unit-card'}>
      <div className="unit-media">
        <Photo
          uploadedUrl={unit.photoUrl}
          demo={unit.photo}
          alt=""
          sizes={
            featured
              ? '(min-width: 64rem) 50vw, 100vw'
              : '(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw'
          }
        />
      </div>
      <div className="unit-body">
        <h3>
          <Link to="/booking" className="stretched">
            {name}
          </Link>
        </h3>
        <p className="unit-meta">
          {t('home:accommodations.sleeps', { count: unit.sleeps })}
          {' · '}
          {t('home:accommodations.surface', { n: unit.surface })}
        </p>
        <p className="unit-blurb">{pick(unit.blurb, i18n.language)}</p>
        <ul className="amenities">
          {unit.amenities.map((a) => (
            <li key={a} title={t(`home:amenities.${a}`)}>
              <Icon name={a} size={20} />
              <span className="visually-hidden">{t(`home:amenities.${a}`)}</span>
            </li>
          ))}
        </ul>
        <p className="unit-price">
          <span>{t('home:accommodations.from')}</span>{' '}
          <strong>{formatMoney(money(unit.priceFrom, unit.currency))}</strong>{' '}
          <span>{t('home:accommodations.perNight')}</span>
        </p>
      </div>
    </article>
  );
}
