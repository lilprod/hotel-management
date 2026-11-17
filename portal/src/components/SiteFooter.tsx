import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useTenantBranding } from '../branding';
import { demoAddress, demoHours, pick } from '../demo-content';
import { portalRoutes } from '../routes';
import { Icon } from './Icon';

const exploreRoutes = portalRoutes.filter((r) =>
  ['accommodations', 'spa', 'restaurant', 'activities'].includes(r.key),
);
const stayRoutes = portalRoutes.filter((r) => ['booking', 'account'].includes(r.key));

export function SiteFooter() {
  const { t, i18n } = useTranslation();
  const branding = useTenantBranding();
  const contact = branding.contact;
  const address = contact?.address || pick(demoAddress, i18n.language);

  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <p className="footer-name">{branding.name}</p>
          <p className="footer-about">{t('site:footer.about')}</p>
        </div>

        <nav aria-label={t('site:footer.navLabel')} className="footer-nav">
          <div>
            <h2 className="footer-title">{t('site:footer.explore')}</h2>
            <ul>
              {exploreRoutes.map((r) => (
                <li key={r.key}>
                  <Link to={r.path}>{t(r.labelKey)}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="footer-title">{t('site:footer.stay')}</h2>
            <ul>
              {stayRoutes.map((r) => (
                <li key={r.key}>
                  <Link to={r.path}>{t(r.labelKey)}</Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="footer-contact">
          <h2 className="footer-title">{t('site:footer.contact')}</h2>
          <ul>
            <li>
              <Icon name="pin" size={18} />
              <span>{address}</span>
            </li>
            {contact?.phone ? (
              <li>
                <Icon name="phone" size={18} />
                <a href={`tel:${contact.phone.replace(/\s+/g, '')}`}>{contact.phone}</a>
              </li>
            ) : null}
            {contact?.email ? (
              <li>
                <Icon name="mail" size={18} />
                <a href={`mailto:${contact.email}`}>{contact.email}</a>
              </li>
            ) : null}
            <li>
              <Icon name="clock" size={18} />
              <span>{pick(demoHours, i18n.language)}</span>
            </li>
          </ul>
        </div>
      </div>
      <div className="container footer-bottom">
        <p>
          © {new Date().getFullYear()} {branding.name}. {t('footer')}
        </p>
      </div>
    </footer>
  );
}
