import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Camera, ScanLine, ShieldCheck, RefreshCw, Clock3, AlertTriangle, Check } from 'lucide-react';
import Logo from '@/components/common/Logo';
import ImageEditorModal from '@/components/common/ImageEditorModal';
import { verificationApi, VerificationStatus } from '@/services/verification';

type Phase = 'intro' | 'capture' | 'checking' | 'done';

/**
 * "Prove you're a student" step. The user photographs their college ID;
 * the server runs the auto-check chain (Ollama → Gemini → human review).
 * While checking, we poll /verification/status until it resolves.
 */
export default function VerificationPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [editing, setEditing] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: status, refetch } = useQuery<VerificationStatus>({
    queryKey: ['verification-status'],
    queryFn: async () => (await verificationApi.status()).data,
    refetchInterval: phase === 'checking' ? 2000 : false,
  });

  // While checking: the moment status leaves PENDING, show the result.
  useEffect(() => {
    if (phase === 'checking' && status && status.status !== 'PENDING') {
      setPhase('done');
      queryClient.invalidateQueries({ queryKey: ['me'] });
    }
  }, [phase, status, queryClient]);

  const submit = async (file: File) => {
    setError('');
    setPreview(URL.createObjectURL(file));
    setPhase('checking');
    try {
      await verificationApi.submit(file);
      refetch();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Upload failed — try again');
      setPhase('capture');
    }
  };

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = ''; // allow re-picking the same file later
    if (file) setEditing(file);
  };

  const openCamera = () => {
    // The file input is the single entry point: on mobile it offers the native
    // camera AND gallery; on desktop it opens the file dialog. (The old
    // capture="environment" attribute forced camera-only and greyed out
    // gallery files — that's why picking an image appeared broken.)
    fileRef.current?.click();
  };

  // ── CHECKING ──────────────────────────────────────────────
  if (phase === 'checking') {
    return (
      <Shell>
        <div className="nb-card max-w-md w-full mx-auto p-8 text-center">
          {preview && (
            <div className="relative mx-auto w-44 h-28 rounded-xl overflow-hidden mb-6 ring-2 ring-nb-purple/40">
              <img src={preview} alt="Your student ID" className="w-full h-full object-cover" />
              <ScanLine size={112} className="absolute inset-0 m-auto text-nb-orange animate-pulse" strokeWidth={1.2} />
            </div>
          )}
          <h1 className="font-display text-2xl font-bold">Checking your student ID…</h1>
          <p className="text-sm opacity-70 mt-2">This usually takes a few seconds. Keep this page open.</p>
          <div className="mt-6 flex items-center justify-center gap-2 text-sm">
            <RefreshCw size={16} className="animate-spin" /> verifying in real time
          </div>
          {status?.pending?.note && (
            <p className="mt-4 text-xs opacity-60 italic">“{status.pending.note}”</p>
          )}
        </div>
      </Shell>
    );
  }

  // ── DONE ──────────────────────────────────────────────────
  if (phase === 'done' && status) {
    const verified = status.status === 'VERIFIED';
    return (
      <Shell>
        <div className="nb-card max-w-md w-full mx-auto p-8 text-center">
          <div className={`mx-auto w-20 h-20 rounded-full flex items-center justify-center ${verified ? 'bg-nb-orange/15' : 'bg-nb-purple/15'}`}>
            {verified
              ? <ShieldCheck size={40} className="text-nb-orange" />
              : <Clock3 size={40} className="text-nb-purple" />}
          </div>
          <h1 className="font-display text-2xl font-bold mt-5">
            {verified ? "You're verified! 🎓" : 'One more step'}
          </h1>
          <p className="text-sm opacity-70 mt-2">
            {verified
              ? 'Welcome to Skola. Your college community is waiting.'
              : status.status === 'REJECTED'
                ? (status.lastRejection || 'We could not confirm your ID automatically — a moderator will review it.')
                : 'Your ID is in the review queue. A moderator from your college will confirm it shortly.'}
          </p>
          <button
            onClick={() => { queryClient.invalidateQueries({ queryKey: ['me'] }); navigate('/home'); }}
            className="nb-btn-primary w-full mt-6"
          >
            {verified ? 'Enter Skola' : 'Continue to Skola'}
          </button>
          {!verified && (
            <button onClick={() => { setPreview(null); setPhase('capture'); }} className="nb-btn-ghost w-full mt-2">
              <Camera size={16} className="inline mr-1" /> Retake photo
            </button>
          )}
        </div>
      </Shell>
    );
  }

  // ── CAPTURE ───────────────────────────────────────────────
  if (phase === 'capture') {
    return (
      <Shell>
        <div className="nb-card max-w-md w-full mx-auto p-8">
          <button onClick={() => setPhase('intro')} className="text-sm opacity-60 hover:opacity-100 mb-4">← Back</button>
          <h1 className="font-display text-2xl font-bold text-center">Take a photo of your college ID</h1>
          <p className="text-sm opacity-70 text-center mt-2">
            Your college name and your name must be clearly readable — we check them against your profile. The photo is deleted once you're verified.
          </p>
          <div className="mt-6 rounded-2xl border-2 border-dashed border-nb-purple/40 p-8 text-center">
            <Camera size={44} className="mx-auto text-nb-purple" />
            <p className="text-xs opacity-60 mt-3">JPG, PNG or WebP · up to 8 MB</p>
          </div>
          {error && (
            <p className="text-sm text-nb-orange mt-4 text-center flex items-center justify-center gap-1">
              <AlertTriangle size={14} /> {error}
            </p>
          )}
          <button onClick={openCamera} className="nb-btn-primary w-full mt-6">
            <Camera size={18} className="inline mr-2" /> Open camera
          </button>
          <label className="nb-btn-ghost w-full mt-2 cursor-pointer text-center block">
            Upload from gallery
            <input ref={fileRef} type="file" accept="image/*,.heic,.heif" onChange={pickFile} className="hidden" />
          </label>
          {editing && (
            <ImageEditorModal
              file={editing}
              title="Position your ID"
              aspects={[
                { label: 'Original', value: null },
                { label: 'Card 3:2', value: 3 / 2 },
                { label: 'Card 4:3', value: 4 / 3 },
              ]}
              maxOutputPx={2000}
              onCancel={() => setEditing(null)}
              onDone={(f) => {
                setEditing(null);
                submit(f);
              }}
            />
          )}
        </div>
      </Shell>
    );
  }

  // ── INTRO ─────────────────────────────────────────────────
  return (
    <Shell>
      <div className="nb-card max-w-md w-full mx-auto p-8 text-center">
        <div className="mx-auto w-20 h-20 rounded-full bg-nb-orange/15 flex items-center justify-center">
          <GraduationCap size={40} className="text-nb-orange" />
        </div>
        <h1 className="font-display text-2xl font-bold mt-5">Verify you're a student</h1>
        <p className="text-sm opacity-70 mt-2">
          Skola is college-only. Snap a photo of your college ID —
          a quick automatic check confirms you belong, and the photo is deleted right after.
        </p>
        <ul className="text-left text-sm mt-6 space-y-3">
          <Li><Check size={16} className="text-nb-orange mt-0.5 shrink-0" /> Your college name and your name readable on the card</Li>
          <Li><Check size={16} className="text-nb-orange mt-0.5 shrink-0" /> Deleted instantly once you're verified</Li>
          <Li><Check size={16} className="text-nb-orange mt-0.5 shrink-0" /> Unclear photo? A moderator from your college reviews it</Li>
        </ul>
        <button onClick={() => setPhase('capture')} className="nb-btn-primary w-full mt-8">
          <Camera size={18} className="inline mr-2" /> Verify my student ID
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 nb-canvas-surface">
      <div className="mb-8"><Logo size={40} /></div>
      {children}
    </div>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <li className="flex items-start gap-2">{children}</li>;
}
