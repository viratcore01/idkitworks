import { useEffect, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import {
  isInstallAvailable,
  onInstallAvailability,
  promptInstall,
} from '@/utils/installPrompt';

/**
 * Install as App button — ONE CLICK triggers the browser's real install
 * dialog (Chrome/Brave/Edge native PWA prompt). Requirements for that
 * dialog are site-level: manifest with 192px+ icons + a service worker
 * (public/sw.js). They're in place, so on Chromium the click calls
 * promptInstall() and the OS dialog appears — no instructions box.
 *
 * Graceful wait: the event can arrive a beat after the page paints (it
 * races the SW registration), so a click within the first ~1.5s waits for
 * it instead of instantly falling back.
 *
 * Fallbacks, only when the browser genuinely can't prompt:
 *  - iOS Safari → "Add to Home Screen" steps (Apple offers no API)
 *  - Firefox desktop → same, no install prompt API
 *  - Android Firefox → its menu does offer "Install" as PWA
 */
export default function InstallButton({
  className = '',
  variant = 'primary',
  forceVisible = false,
}: {
  className?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  forceVisible?: boolean;
} = {}) {
  const [canInstall, setCanInstall] = useState(isInstallAvailable());
  const [busy, setBusy] = useState(false);
  const [showIos, setShowIos] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const isIOS =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      // iPadOS 13+ masquerades as desktop Safari
      (/Macintosh/.test(navigator.userAgent) && 'ontouchend' in document));

  useEffect(() => onInstallAvailability(setCanInstall), []);

  // Already installed → nothing to offer.
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true);
  if (isStandalone) return null;

  const shouldRender = forceVisible || canInstall || isIOS;
  if (!shouldRender) return null;

  const handleInstall = async () => {
    if (busy) return;
    if (isIOS && !canInstall) {
      setShowIos(true);
      return;
    }
    setBusy(true);
    try {
      let outcome = await promptInstall();
      if (outcome === 'unavailable') {
        // The event may still be in flight — give it up to 1.5s to land.
        const arrived = await new Promise<boolean>((resolve) => {
          if (isInstallAvailable()) return resolve(true);
          const unsub = onInstallAvailability((ok) => {
            if (ok) resolve(true);
          });
          setTimeout(() => {
            unsub();
            resolve(false);
          }, 1500);
        });
        outcome = arrived ? await promptInstall() : 'unavailable';
      }
      if (outcome === 'unavailable') setShowManual(true);
    } finally {
      setBusy(false);
    }
  };

  const baseStyles =
    'inline-flex items-center gap-2 font-display font-semibold rounded-lg transition-all';
  const variants = {
    primary: 'bg-nb-violet text-white hover:bg-nb-violet/90 px-4 py-2.5',
    secondary: 'bg-nb-yellow text-ink hover:bg-nb-yellow/90 px-4 py-2.5 border-2 border-ink',
    ghost: 'bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 border border-white/20',
  };

  const label = canInstall ? 'Install App' : isIOS ? 'Add to Home Screen' : 'Install App';

  return (
    <>
      <button
        type="button"
        onClick={handleInstall}
        disabled={busy}
        className={`${baseStyles} ${variants[variant]} ${className} disabled:opacity-70`}
        aria-label="Install Zoclo as an app"
      >
        {isIOS && !canInstall ? (
          <Smartphone size={18} strokeWidth={2.5} />
        ) : (
          <Download size={18} strokeWidth={2.5} />
        )}
        <span>{busy ? 'Opening…' : label}</span>
      </button>

      {showIos && (
        <Sheet
          onClose={() => setShowIos(false)}
          title="Add Zoclo to your Home Screen"
          steps={[
            <>Tap the <strong>Share</strong> button (□↑) in Safari's toolbar</>,
            <>Scroll and tap <strong>"Add to Home Screen"</strong></>,
            <>Tap <strong>"Add"</strong> — Zoclo opens fullscreen from your home screen</>,
          ]}
        />
      )}

      {showManual && (
        <Sheet
          onClose={() => setShowManual(false)}
          title="One more step"
          steps={[
            <>Your browser installed apps from its menu — tap <strong>⋮</strong> / <strong>⋯</strong></>,
            <>Choose <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong></>,
            <>Confirm — done, Zoclo now lives on your home screen</>,
          ]}
        />
      )}
    </>
  );
}

function Sheet({
  title,
  steps,
  onClose,
}: {
  title: string;
  steps: React.ReactNode[];
  onClose: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/60"
        aria-label="Close"
      />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="nb-card bg-white max-w-sm w-full p-6 relative"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-bold text-lg">{title}</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-ink"
              aria-label="Close"
            >
              <X size={20} strokeWidth={2.5} />
            </button>
          </div>
          <div className="space-y-3 text-sm text-gray-700">
            {steps.map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="w-8 h-8 shrink-0 bg-nb-violet/10 rounded flex items-center justify-center font-semibold text-nb-violet">
                  {i + 1}
                </span>
                <span className="pt-1.5">{s}</span>
              </div>
            ))}
          </div>
          <button onClick={onClose} className="nb-btn-primary w-full mt-4">
            Got it
          </button>
        </div>
      </div>
    </>
  );
}
