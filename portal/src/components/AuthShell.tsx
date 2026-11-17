import type { ReactNode } from 'react';

import { useTenantBranding } from '../branding';
import { Photo } from './Photo';
import '../pages/auth.css';

interface AuthShellProps {
  titleId: string;
  title: string;
  lead?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Split layout of the account pages: hotel photo and name on one side, the form card on the other. */
export function AuthShell({ titleId, title, lead, children, footer }: AuthShellProps) {
  const branding = useTenantBranding();
  return (
    <section className="auth" aria-labelledby={titleId}>
      <div className="auth-aside" aria-hidden="true">
        <Photo uploadedUrl={branding.heroUrl} demo="garden" alt="" sizes="50vw" priority />
        <div className="auth-aside-inner">
          <p className="auth-aside-name">{branding.name}</p>
          {branding.loginMessage ? <p className="auth-aside-msg">{branding.loginMessage}</p> : null}
        </div>
      </div>
      <div className="auth-main">
        <div className="auth-card">
          <h1 id={titleId}>{title}</h1>
          {lead ? <p className="auth-lead">{lead}</p> : null}
          {children}
          {footer ? <div className="auth-footer">{footer}</div> : null}
        </div>
      </div>
    </section>
  );
}
