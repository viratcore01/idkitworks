import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Camera, ScanLine, ShieldCheck, RefreshCw, Clock3, AlertTriangle, Check } from 'lucide-react';
import Logo from '@/components/common/Logo';
import ImageEditorModal from '@/components/common/ImageEditorModal';
import { useAuthStore } from '@/store/auth.store';
import { useVerificationUnlock } from '@/hooks/useVerificationUnlock';
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
 const fetchMe = useAuthStore((s) => s.fetchMe);
 const checkStartRef = useRef(0);

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

 // Bounded wait: verification is human-only, so status stays PENDING until a
 // moderator acts — polling for a verdict would spin forever. After 30s stop
 // waiting and show the review-queue state instead. Never an infinite spinner.
 useEffect(() => {
 if (phase !== 'checking') return;
 if (!checkStartRef.current) checkStartRef.current = Date.now();
 const t = setInterval(() => {
 if (Date.now() - checkStartRef.current > 30_000) setPhase('done');
 }, 1000);
 return () => clearInterval(t);
 }, [phase]);

 // DONE: refresh the auth store so the route gates see the fresh status —
 // otherwise "Continue to Zoclo" bounces straight back to /verify.
 // (Hooks stay ABOVE every early return — a hook after one crashes React.)
 useEffect(() => {
 if (phase === 'done') fetchMe().catch(() => {});
 }, [phase, fetchMe]);

 // THE DEAD-SIMPLE RULE: when the moderator approves, the user is IN —
 // instantly, no reload, no button. The socket fires, the session refreshes,
 // and we navigate onto the feed ourselves.
 useVerificationUnlock(() => {
 setPhase('done');
 navigate('/home', { replace: true });
 });

 const submit = async (file: File) => {
 setError('');
 setPreview(URL.createObjectURL(file));
 checkStartRef.current = Date.now();
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
 <div className="relative mx-auto w-44 h-28 overflow-hidden mb-6 ring-2 ring-nb-lilac/40">
 <img src={preview} alt="Your student ID" className="w-full h-full object-cover" />
 <ScanLine size={112} className="absolute inset-0 m-auto text-nb-violet animate-pulse" strokeWidth={1.2} />
 </div>
 )}
 <h1 className="font-display text-2xl font-bold">Checking your student ID…</h1>
 <p className="text-sm opacity-70 mt-2">A moderator from your college is reviewing it. The moment they approve, you're in.</p>
 <div className="mt-6 flex items-center justify-center gap-2 text-sm">
 <RefreshCw size={16} className="animate-spin" /> waiting for review
 </div>
 <p className="text-xs opacity-50 mt-3">You can leave this page — the second it's approved, Zoclo opens by itself.</p>
 {status?.pending?.note && (
 <p className="mt-4 text-xs opacity-60 italic">“{status.pending.note}”</p>
 )}
 </div>
 </Shell>
 );
 }

 // ── DONE ──────────────────────────────────────────────────
 if (phase === 'done' && !status) {
 // Status query failed (e.g. cold server mid-refresh) — still give the user
 // a clear state instead of a blank card.
 return (
 <Shell>
 <div className="nb-card max-w-md w-full mx-auto p-8 text-center">
 <Clock3 size={40} className="mx-auto text-nb-violet" />
 <h1 className="font-display text-2xl font-bold mt-5">Your ID is submitted</h1>
 <p className="text-sm opacity-70 mt-2">A moderator from your college is checking it — you'll be let in automatically the moment it's approved.</p>
 </div>
 </Shell>
 );
 }

 if (phase === 'done' && status) {
 const verified = status.status === 'VERIFIED';
 return (
 <Shell>
 <div className="nb-card max-w-md w-full mx-auto p-8 text-center">
 <div className={`mx-auto w-20 h-20 flex items-center justify-center ${verified ? 'bg-nb-violet/15' : 'bg-nb-lilac/15'}`}>
 {verified
 ? <ShieldCheck size={40} className="text-nb-violet" />
 : <Clock3 size={40} className="text-nb-violet" />}
 </div>
 <h1 className="font-display text-2xl font-bold mt-5">
 {verified ? "You're verified! 🎓" : 'One more step'}
 </h1> <p className="text-sm opacity-70 mt-2">
 {verified
 ? 'Welcome to Zoclo. Your college community is waiting.'
 : status.status === 'REJECTED'
 ? (status.lastRejection || 'A moderator could not confirm your ID — retake a clearer photo.')
 : 'Your ID is with a moderator from your college. The moment they approve it, Zoclo opens automatically — no reload needed.'}
 </p>

 {verified && (
 <button
 onClick={() => navigate('/home')}
 className="nb-btn-primary w-full mt-6"
 >
 Enter Zoclo
 </button>
 )}
 {!verified && status.status === 'PENDING' && (
 <p className="text-xs opacity-50 mt-6 flex items-center justify-center gap-1.5">
 <RefreshCw size={13} className="animate-spin" /> You'll be let in automatically the moment it's approved
 </p>
 )}
 {!verified && status.status === 'REJECTED' && (
 <button onClick={() => { setPreview(null); setPhase('capture'); }} className="nb-btn-primary w-full mt-6">
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
 <div className="mt-6 border-2 border-dashed border-nb-lilac/40 p-8 text-center">
 <Camera size={44} className="mx-auto text-nb-violet" />
 <p className="text-xs opacity-60 mt-3">JPG, PNG or WebP · up to 8 MB</p>
 </div>
  {error && (
  <p role="alert" className="text-sm text-nb-pink font-semibold mt-4 text-center flex items-center justify-center gap-1">
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
 <div className="mx-auto w-20 h-20 bg-nb-violet/15 flex items-center justify-center">
 <GraduationCap size={40} className="text-nb-violet" />
 </div>
 <h1 className="font-display text-2xl font-bold mt-5">Verify you're a student</h1>
 <p className="text-sm opacity-70 mt-2">
 Zoclo is college-only. Snap a photo of your college ID —
 a moderator from your college checks it, and the photo is deleted right after the decision.
 </p>
 <ul className="text-left text-sm mt-6 space-y-3">
 <Li><Check size={16} className="text-nb-violet mt-0.5 shrink-0" /> Your college name and your name readable on the card</Li>
 <Li><Check size={16} className="text-nb-violet mt-0.5 shrink-0" /> Deleted instantly once a moderator decides</Li>
 <Li><Check size={16} className="text-nb-violet mt-0.5 shrink-0" /> Reviewed by a real moderator from your college</Li>
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
