import { useEffect, useRef, useState } from 'react';
import { Camera, X, SwitchCamera, AlertTriangle } from 'lucide-react';

/**
 * Real in-app camera for ID capture: live viewfinder + capture button.
 *
 * Why this exists instead of `<input capture="environment">`: the capture
 * attribute is a HINT — desktop browsers always ignore it (file dialog),
 * and some mobile browsers/WebViews do too. getUserMedia opens the actual
 * camera stream on any device that has one, so "Open camera" genuinely
 * opens the camera everywhere. Gallery stays as the separate fallback.
 *
 * Requires a secure context (HTTPS or localhost) — without it
 * navigator.mediaDevices is undefined and the caller falls back to the
 * file input (same UX as before, no crash).
 */
export default function CameraCaptureModal({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      setError('');
      setStarting(true);
      stop();
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setError("Couldn't open the camera (permission denied or no camera found). Close this and use the gallery instead.");
      } finally {
        if (!cancelled) setStarting(false);
      }
    };
    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [facing]);

  // Escape closes (camera tracks stop via the cleanup above).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError('Camera is not ready yet — wait a second and try again.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('Capture failed — try again.');
          return;
        }
        onCapture(new File([blob], `id-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 overflow-y-auto overscroll-contain" onClick={onClose}>
      <div className="min-h-full flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
        <div
          className="nb-card bg-white p-4 sm:p-6 max-w-md w-full min-w-0 text-center"
          role="dialog"
          aria-modal="true"
          aria-label="Take a photo of your college ID"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-bold text-lg">Take ID photo</h2>
            <button onClick={onClose} aria-label="Close camera" className="p-2 min-w-[44px] min-h-[44px] grid place-items-center text-gray-500 hover:text-ink">
              <X size={18} strokeWidth={2.5} />
            </button>
          </div>

          <div className="relative nb-card overflow-hidden !p-0 bg-black">
            {error ? (
              <div className="aspect-[4/3] w-full grid place-items-center p-6 bg-white">
                <p role="alert" className="text-sm font-body text-nb-pink font-semibold flex items-center justify-center gap-1.5">
                  <AlertTriangle size={16} /> {error}
                </p>
              </div>
            ) : (
              <>
                {/* Single always-mounted video: the stream attaches to this
                stable ref whenever it arrives, even mid-"starting". */}
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className="w-full aspect-[4/3] object-cover"
                  // Mirror only the front-camera preview (selfie expectation);
                  // the captured file itself is never mirrored.
                  style={facing === 'user' ? { transform: 'scaleX(-1)' } : undefined}
                />
                {starting && (
                  <div className="absolute inset-0 grid place-items-center bg-black/60 text-white/80 text-sm font-body">
                    Starting camera…
                  </div>
                )}
              </>
            )}
          </div>

          <p className="text-xs text-gray-500 font-body mt-3">Fit your whole college ID in the frame — name and college must be readable.</p>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
              disabled={starting || !!error}
              aria-label="Switch camera"
              title="Switch camera"
              className="nb-btn bg-white px-4 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 min-h-[44px]"
            >
              <SwitchCamera size={16} strokeWidth={2.5} />
            </button>
            <button
              onClick={capture}
              disabled={starting || !!error}
              className="nb-btn-pink flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Camera size={16} strokeWidth={2.5} /> Capture
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
