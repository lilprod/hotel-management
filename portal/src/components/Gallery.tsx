import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFocusTrap } from '../lib/useFocusTrap';
import { Reveal } from '../lib/Reveal';
import type { DemoPhotoKey } from '../media/photos';
import { Icon } from './Icon';
import { Photo } from './Photo';

export interface GalleryPhoto {
  demo: DemoPhotoKey;
  /** Photo uploaded by the hotel; takes precedence over the demo photo. */
  uploadedUrl?: string | null;
  alt: string;
}

function Lightbox({
  photos,
  index,
  onChange,
  onClose,
}: {
  photos: GalleryPhoto[];
  index: number;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const total = photos.length;
  const current = photos[index] as GalleryPhoto;

  useFocusTrap(ref, { active: true, onEscape: onClose });

  const move = useCallback(
    (step: number) => onChange((index + step + total) % total),
    [index, total, onChange],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [move]);

  return (
    <div
      ref={ref}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t('pages:lightbox.label')}
    >
      <button
        type="button"
        className="lb-close"
        onClick={onClose}
        aria-label={t('pages:lightbox.close')}
      >
        <Icon name="close" />
      </button>
      <button
        type="button"
        className="lb-nav lb-prev"
        onClick={() => move(-1)}
        aria-label={t('pages:lightbox.prev')}
      >
        <Icon name="chevronLeft" />
      </button>
      <figure className="lb-figure">
        <Photo
          key={`${current.demo}-${index}`}
          demo={current.demo}
          uploadedUrl={current.uploadedUrl}
          alt={current.alt}
          sizes="100vw"
          priority
          className="lb-photo"
        />
        <figcaption aria-live="polite">
          {current.alt}
          <span>{t('pages:lightbox.counter', { n: index + 1, total })}</span>
        </figcaption>
      </figure>
      <button
        type="button"
        className="lb-nav lb-next"
        onClick={() => move(1)}
        aria-label={t('pages:lightbox.next')}
      >
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}

/** Mosaic of photos; each opens a keyboard-accessible lightbox (arrows, Escape, focus trap). */
export function Gallery({ photos }: { photos: GalleryPhoto[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);

  return (
    <>
      <ul className="gallery">
        {photos.map((p, i) => (
          <li key={`${p.demo}-${i}`} className={`gallery-item g${i % 6}`}>
            <Reveal delay={(i % 3) * 90} className="gallery-reveal">
              <button
                type="button"
                className="gallery-open"
                aria-label={t('pages:sections.photoOpen', { alt: p.alt })}
                onClick={() => setOpen(i)}
              >
                <Photo
                  demo={p.demo}
                  uploadedUrl={p.uploadedUrl}
                  alt=""
                  sizes="(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw"
                />
                <span className="gallery-zoom" aria-hidden="true">
                  <Icon name="expand" size={20} />
                </span>
              </button>
            </Reveal>
          </li>
        ))}
      </ul>
      {open !== null ? (
        <Lightbox photos={photos} index={open} onChange={setOpen} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}
