import BrandLoader from '@/components/common/BrandLoader';

/**
 * Inline / tab-switch loader — same original Zoclo mark as the full-screen
 * loader (wordmark + three brand-color dots + sliding bar). No lightning
 * bolt, no generic ring spinner.
 */
export default function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const logoSize = size === 'sm' ? 40 : size === 'lg' ? 64 : 52;
  return (
    <div className={`flex items-center justify-center ${size === 'sm' ? 'py-3' : 'py-8'}`}>
      <BrandLoader logoSize={logoSize} label={null} />
    </div>
  );
}
