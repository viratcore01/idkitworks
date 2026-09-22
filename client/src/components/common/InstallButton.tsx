import { useState, useEffect } from 'react';
import { Download, Smartphone, Menu } from 'lucide-react';

/** Type for the beforeinstallprompt event (not in standard TS lib) */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * Install as App button — uses the browser's native PWA install prompt when available.
 * Shows proactively on landing page; falls back to manual instructions if prompt isn't ready.
 */
export default function InstallButton({
  className = '',
  variant = 'primary',
  forceVisible = false, // force show on landing page even before beforeinstallprompt fires
}: { className?: string; variant?: 'primary' | 'secondary' | 'ghost'; forceVisible?: boolean } = {}) {
  const [canInstall, setCanInstall] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    // Detect iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(iOS);

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setCanInstall(true);
      setShowInstructions(false); // native prompt available, no need for manual instructions
    };

    const handleAppInstalled = () => {
      setCanInstall(false);
      setDeferredPrompt(null);
      setShowInstructions(false);
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
      // Native prompt available - use it
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setCanInstall(false);
        setDeferredPrompt(null);
      }
      return;
    }
    // No native prompt yet - show manual instructions
    setShowInstructions(true);
  };

  const closeInstructions = () => setShowInstructions(false);

  // Check if already in standalone mode (already installed)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  // Don't render if already installed
  if (isStandalone) return null;

  // On landing page (forceVisible), always show the button
  // Otherwise only show when native prompt is ready or iOS
  const shouldRender = forceVisible || canInstall || isIOS;
  if (!shouldRender) return null;

  const baseStyles = 'inline-flex items-center gap-2 font-display font-semibold rounded-lg transition-all';
  const variants = {
    primary: 'bg-nb-violet text-white hover:bg-nb-violet/90 px-4 py-2.5',
    secondary: 'bg-nb-yellow text-ink hover:bg-nb-yellow/90 px-4 py-2.5 border-2 border-ink',
    ghost: 'bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 border border-white/20',
  };

  // Instruction modal for manual install
  if (showInstructions) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowInstructions(false)}
          className="fixed inset-0 z-50 bg-black/60"
          aria-label="Close install instructions"
        />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowInstructions(false)}>
          <div className="nb-card bg-white max-w-sm w-full p-6 relative" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-lg">Install Zoclo</h3>
              <button onClick={() => setShowInstructions(false)} className="text-gray-400 hover:text-ink" aria-label="Close">
                <Menu size={20} strokeWidth={2.5} />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">Your browser hasn't offered the install prompt yet. Here's how to install manually:</p>
            {isIOS ? (
              <div className="space-y-3 text-sm text-gray-700">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 bg-nb-violet/10 rounded flex items-center justify-center">
                    <Smartphone size={16} strokeWidth={2.5} className="text-nb-violet" />
                  </span>
                  <span>Tap the <strong>Share</strong> button (□↑) in Safari</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 bg-nb-violet/10 rounded flex items-center justify-center">2</span>
                  <span>Select <strong>"Add to Home Screen"</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 bg-nb-violet/10 rounded flex items-center justify-center">3</span>
                  <span>Tap <strong>"Add"</strong> — Zoclo will appear like a native app</span>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-gray-700">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 bg-nb-violet/10 rounded flex items-center justify-center">1</span>
                  <span>Open Chrome/Edge menu (<strong>⋮</strong> or <strong>⋯</strong>)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 bg-nb-violet/10 rounded flex items-center justify-center">2</span>
                  <span>Select <strong>"Install Zoclo"</strong> or <strong>"Add to Home Screen"</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 bg-nb-violet/10 rounded flex items-center justify-center">3</span>
                  <span>Confirm — Zoclo will install like a native app</span>
                </div>
              </div>
            )}
            <button onClick={() => setShowInstructions(false)} className="nb-btn-primary w-full mt-4">
              <Download size={16} className="inline mr-2" /> Got it
            </button>
          </div>
        </div>
      </>
    );
  }

  if (isIOS && !canInstall) {
    // iOS fallback: show "Add to Home Screen" guide button
    return (
      <button
        type="button"
        onClick={() => setShowInstructions(true)}
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