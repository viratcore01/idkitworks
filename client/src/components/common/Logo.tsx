interface LogoProps {
  /** Height of the mark in px (lockup scales with it) */
  size?: number;
  /** Hide the wordmark, mark only (no-op today: the asset IS the wordmark) */
  markOnly?: boolean;
  className?: string;
}

/**
 * The Zoclo brand: the official graffiti wordmark with its transparent
 * background (single source of truth, generated from
 * public/zoclo-logo-raw.png via scripts/build-brand-assets.ps1).
 * Renders crisp on any surface — cream, white, or dark.
 */
export default function Logo({ size = 32, className = '' }: LogoProps) {
  return (
    <img
      src="/zoclo-logo.png"
      alt="Zoclo"
      style={{
        height: size,
        width: 'auto',
        // ink outline that hugs the letters' alpha shape — keeps the white
        // graffiti strokes readable on cream/white surfaces
        filter:
          'drop-shadow(1px 0 0 #0F172A) drop-shadow(-1px 0 0 #0F172A) drop-shadow(0 1px 0 #0F172A) drop-shadow(0 -1px 0 #0F172A)',
      }}
      className={`object-contain select-none ${className}`}
      draggable={false}
    />
  );
}
