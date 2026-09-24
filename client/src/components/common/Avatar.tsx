import { useEffect, useState } from 'react';
import { photoSrc, refreshTokenFor, usePhotoVersion } from '@/utils/photo';

interface AvatarProps {
 src?: string | null;
 /** Stored photo id (uploaded in-app) — resolved to an authenticated URL */
 photoId?: string | null;
 name: string;
 size?: 'sm' | 'md' | 'lg' | 'xl';
 className?: string;
}

const sizeClasses = {
 sm: 'w-8 h-8 text-sm',
 md: 'w-10 h-10 text-base',
 lg: 'w-16 h-16 text-xl',
 xl: 'w-24 h-24 text-3xl',
};

const isInternal = (u: string) => u.includes('/users/photos/');

/**
 * The app avatar. Self-healing: if the photo fails to load (expired/missing
 * token), it fetches a fresh long-lived photo token ONCE and re-renders —
 * instead of silently flipping to the letter tile forever ("image not
 * available"). Also re-renders whenever the photo token rotates.
 */
export default function Avatar({ src, photoId, name, size = 'md', className = '' }: AvatarProps) {
 const version = usePhotoVersion();
 const [broken, setBroken] = useState(false);
 const [healed, setHealed] = useState(false);
 const external = photoId ? null : src || null;
 // version in the deps: a token rotation rebuilds the URL with a fresh ?v=
 const resolved = photoId ? photoSrc(photoId) : external;

 useEffect(() => {
 setBroken(false);
 setHealed(false);
 }, [resolved]);

 if (resolved && !broken) {
 const onError = () => {
 if (!healed && resolved && isInternal(resolved)) {
 setHealed(true);
 refreshTokenFor(resolved).then((ok) => {
 if (ok) return; // rotation re-renders with the new URL
 setBroken(true); // genuinely gone / logged out — fall back to the tile
 });
 } else {
 setBroken(true);
 }
 };
 return (
 <img
 key={`${resolved}`}
 src={resolved}
 alt={name}
 loading="lazy"
 decoding="async"
 onError={onError}
 className={`nb-avatar ${sizeClasses[size]} ${className}`}
 />
 );
 }

 return (
 <div
 className={`border-nb-2 border-ink bg-nb-violet text-white font-bold flex items-center justify-center ${sizeClasses[size]} ${className}`}
 >
 {name?.[0]?.toUpperCase() || '?'}
 </div>
 );
}
