interface LogoProps {
 /** Height of the S mark in px (wordmark scales with it) */
 size?: number;
 /** Hide the wordmark, S mark only */
 markOnly?: boolean;
 className?: string;
}

/**
 * The Zoclo brand: the violet S mark (chat bubble + heart) from the logo
 * sheet, with the ZOCLO wordmark rendered as solid violet + deep-violet
 * 3D shadow — matching the brand's extruded-letter style.
 */
export default function Logo({ size = 32, markOnly = false, className = '' }: LogoProps) {
 return (
 <span className={`inline-flex items-center gap-2.5 ${className}`}>
 <img
 src="/logo-s.png"
 alt="Zoclo"
 style={{ height: size, width: size }}
 className="object-contain select-none"
 draggable={false}
 />
 {!markOnly && (
 <span
 className="font-display font-bold leading-none tracking-wide select-none"
 style={{
 fontSize: size * 0.82,
 color: '#6D28D9',
 textShadow: `${size * 0.055}px ${size * 0.055}px 0 #4C1D95`,
 }}
 >
 ZOCLO
 </span>
 )}
 </span>
 );
}
