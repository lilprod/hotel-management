export interface PortalRoute {
  key: string;
  path: string;
  /** i18next key in the `nav` namespace. */
  labelKey: string;
}

export const portalRoutes: readonly PortalRoute[] = [
  { key: 'home', path: '/', labelKey: 'nav:home' },
  { key: 'accommodations', path: '/accommodations', labelKey: 'nav:accommodations' },
  { key: 'spa', path: '/spa', labelKey: 'nav:spa' },
  { key: 'restaurant', path: '/restaurant', labelKey: 'nav:restaurant' },
  { key: 'activities', path: '/activities', labelKey: 'nav:activities' },
  { key: 'booking', path: '/booking', labelKey: 'nav:booking' },
  { key: 'account', path: '/account', labelKey: 'nav:account' },
];
