interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Discord-style personalization: any hex color for the fallback tile */
  color?: string | null;
}

const sizeClasses = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-16 h-16 text-xl',
};

export default function Avatar({ src, name, size = 'md', className = '', color }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
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
