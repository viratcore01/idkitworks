import { useState } from 'react';
import { photoSrc } from '@/utils/photo';

interface AvatarProps {
  src?: string | null;
  /** Stored photo id (uploaded in-app) — resolved to an authenticated URL */
  photoId?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Discord-style personalization: any hex color for the fallback tile */
  color?: string | null;
}

const sizeClasses = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-16 h-16 text-xl',
  xl: 'w-24 h-24 text-3xl',
};

export default function Avatar({ src, photoId, name, size = 'md', className = '', color }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const resolved = photoSrc(photoId) || src;

  if (resolved && !broken) {
    return (
      <img
        src={resolved}
        alt={name}
        onError={() => setBroken(true)}
        className={`nb-avatar ${sizeClasses[size]} ${className}`}
      />
    );
  }

  const style = color && /^#[0-9A-Fa-f]{6}$/.test(color) ? { backgroundColor: color } : undefined;

  return (
    <div
      style={style}
      className={`rounded-full border-nb-2 border-nb-black bg-nb-orange text-white font-bold flex items-center justify-center ${sizeClasses[size]} ${className}`}
    >
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}
