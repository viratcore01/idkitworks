import Logo from '@/components/common/Logo';

interface BrandLoaderProps {
  /** Logo height in px */
  logoSize?: number;
  /** Show the "Loading..." label (full-screen usage). Inline tab loaders hide it. */
  label?: string | null;
  className?: string;
}

/**
 * The one and only Zoclo loader — an original mark, not a stock icon.
 *
 * Design: the graffiti wordmark (our own asset) floating over three
 * neo-brutalist dots in brand colors (violet / pink / yellow) plus a
 * sliding ink bar. Nothing here resembles another company's logo:
 * no lightning bolt, no generic ring spinner.
 */
export default function BrandLoader({ logoSize = 64, label = 'Loading...', className = '' }: BrandLoaderProps) {
  return (
    <div className={`flex flex-col items-center justify-center ${className}`} role="status" aria-label={label ?? 'Loading'}>
      <div className="zoclo-logo-float">
        <Logo size={logoSize} />
      </div>
      <div className="mt-5 flex items-center gap-2" aria-hidden="true">
        <span className="zoclo-dot zoclo-dot-1" />
        <span className="zoclo-dot zoclo-dot-2" />
        <span className="zoclo-dot zoclo-dot-3" />
      </div>
      <div className="zoclo-bar mt-4" aria-hidden="true">
        <span className="zoclo-bar-fill" />
      </div>
      {label && <p className="mt-4 font-display font-semibold text-lg">{label}</p>}
    </div>
  );
}
