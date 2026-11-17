import type { ReactNode } from 'react';

import type { DemoPhotoKey } from '../media/photos';
import { Photo } from './Photo';

interface PageHeroProps {
  titleId: string;
  title: string;
  lead?: string;
  photo: DemoPhotoKey;
  uploadedUrl?: string | null;
  children?: ReactNode;
}

/** Banner at the top of every inner page: photo, readable gradient, title (the page's h1). */
export function PageHero({ titleId, title, lead, photo, uploadedUrl, children }: PageHeroProps) {
  return (
    <section className="page-hero" aria-labelledby={titleId}>
      <div className="page-hero-media" aria-hidden="true">
        <Photo uploadedUrl={uploadedUrl} demo={photo} alt="" sizes="100vw" priority />
      </div>
      <div className="container page-hero-inner">
        <h1 id={titleId}>{title}</h1>
        {lead ? <p className="page-hero-lead">{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}
