import { useState, useEffect } from 'react';
import { Download, Smartphone } from 'lucide-react';

/** Type for the beforeinstallprompt event (not in standard TS lib) */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * Install as App button — uses the browser's native PWA install prompt.
 * Shows only when the app is installable (beforeinstallprompt has fired).
 * On iOS Safari, shows a fallback "Add to Home Screen" guide.
 */
export default function InstallButton({
  className = '',
  variant = 'primary',
}: { className?: string; variant?: 'primary' | 'secondary' | 'ghost' } = {}) {
  const [canInstall, setCanInstall] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Detect iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(iOS);

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setCanInstall(true);
    };

    const handleAppInstalled = () => {
      setCanInstall(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Check if already in standalone mode (already installed)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) {
      setCanInstall(false);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setCanInstall(false);
        setDeferredPrompt(null);
      }
    }
  };

  // Don't render if already installed, not installable, and not iOS (iOS shows guide)
  if (!canInstall && !isIOS) return null;

  const baseStyles = 'inline-flex items-center gap-2 font-display font-semibold rounded-lg transition-all';
  const variants = {
    primary: 'bg-nb-violet text-white hover:bg-nb-violet/90 px-4 py-2.5',
    secondary: 'bg-nb-yellow text-ink hover:bg-nb-yellow/90 px-4 py-2.5 border-2 border-ink',
    ghost: 'bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 border border-white/20',
  };

  if (isIOS && !canInstall) {
    // iOS fallback: show "Add to Home Screen" guide button
    return (
      <button
        type="button"
        onClick={() => alert('To install: tap the Share button (□↑) → "Add to Home Screen"')}
        className={`${baseStyles} ${variants[variant]} ${className}`}
        aria-label="How to install on iOS"
      >
        <Smartphone size={18} strokeWidth={2.5} />
        <span>Add to Home Screen</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleInstall}
      className={`${baseStyles} ${variants[variant]} ${className}`}
      aria-label="Install Zoclo as an app"
    >
      <Download size={18} strokeWidth={2.5} />
      <span>Install App</span>
    </button>
  );
}