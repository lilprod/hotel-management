import { useEffect, useState } from 'react';

import { resolvePhoto } from '../media/photos';
import type { DemoPhotoKey } from '../media/photos';

interface PhotoProps {
  /** Photo uploaded by the hotel (takes precedence over the demo photo). */
  uploadedUrl?: string | null;
  demo: DemoPhotoKey;
  alt: string;
  sizes: string;
  /** Hero image: eager, high fetch priority. Everything else is lazy. */
  priority?: boolean;
  className?: string;
}

/**
 * Responsive photo with explicit width/height (no layout shift). When the image cannot be
 * loaded, a CSS/SVG visual built from the tenant colors takes its place.
 */
export function Photo({ uploadedUrl, demo, alt, sizes, priority = false, className }: PhotoProps) {
  const photo = resolvePhoto(uploadedUrl, demo);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo.src]);

  if (failed) return <PhotoFallback alt={alt} className={className} />;
  return (
    <img
      className={`photo${className ? ` ${className}` : ''}`}
      src={photo.src}
      {...(photo.srcSet ? { srcSet: photo.srcSet, sizes } : {})}
      width={photo.width}
      height={photo.height}
      alt={alt}
      data-demo={photo.isDemo ? 'true' : 'false'}
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      {...(priority ? { fetchPriority: 'high' as const } : {})}
      onError={() => setFailed(true)}
    />
  );
}

/** Tenant-colored placeholder: soft gradient with a wave motif, no external asset. */
export function PhotoFallback({ alt, className }: { alt: string; className?: string }) {
  return (
    <div
      className={`photo photo-fallback${className ? ` ${className}` : ''}`}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
    >
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <circle cx="300" cy="86" r="34" className="fb-sun" />
        <path
          className="fb-wave fb-wave-1"
          d="M0 190 C60 170 120 210 200 190 S340 170 400 192 V300 H0Z"
        />
        <path
          className="fb-wave fb-wave-2"
          d="M0 224 C70 206 130 246 210 226 S340 206 400 228 V300 H0Z"
        />
        <path
          className="fb-wave fb-wave-3"
          d="M0 258 C80 242 140 276 220 260 S350 244 400 262 V300 H0Z"
        />
      </svg>
    </div>
  );
}
