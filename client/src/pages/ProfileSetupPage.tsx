import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, PartyPopper, Hourglass, Camera, Plus, X, GraduationCap, ArrowLeft, Lock, Check, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { nextStep, hasCollege } from '@/utils/funnel';
import { canSignOut, clearWizardDraft } from '@/utils/signupFlow';
import { sanitizeUsernameInput, localUsernameStatus, usernameFeedback, blocksSubmit, type UsernameStatus } from '@/utils/username';
import { checkUsername } from '@/services/username';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { type CollegeOption } from '@/components/common/CollegeSelect';
import { photoSrc, usePhotoVersion } from '@/utils/photo';
import ImageEditorModal from '@/components/common/ImageEditorModal';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import toast from 'react-hot-toast';

export default function ProfileSetupPage() {
 const { user, updateProfile, fetchMe, refreshUser, logout } = useAuthStore();
 const navigate = useNavigate();
 const photoVersion = usePhotoVersion(); // token rotation → thumbnails reload
 // College is the account's permanent home (locked like name/DOB/gender —
 // see ProfileEditModal). It arrives from the signup step (or Google) and is
 // shown read-only here so it can't be quietly swapped mid-onboarding.
 const college: CollegeOption | null = user?.college
   ? { id: user.college.id, name: user.college.name, shortName: user.college.shortName, city: user.college.city, state: user.college.state }
   : null;
 // College is NEVER editable here — not for a new signup, not for anyone.
 // It was chosen in the wizard, before the account existed, and the server
 // locks it the moment the account does. Offering a picker on this screen
 // would let someone silently land in a different campus than the one they
 // signed up for, which is the one thing the college boundary must prevent.
 //
 // An account with NO college at all ("Sign in with Google" from the login
 // page creates exactly that) does not get a picker either: it goes back to the
 // wizard and redoes the college step — see the blocked screen below.
 const needsCollege = !hasCollege(user);
 // PRODUCT RULE: what the account already HAS is locked; what it is MISSING is
 // filled exactly once, here. nameLocked matters most — a Google token with no
 // `name` claim now parks an empty string (no invented "viratcore01"), and this
 // is the one screen where that gap can be filled.
  const nameLocked = !!(user?.displayName && user.displayName.trim().length > 0);
  const dobLocked = !!user?.dateOfBirth;
  const genderLocked = !!user?.gender && user.gender !== 'UNKNOWN';
  // The handle is chosen ONCE, here, by every path (email + Google signup mint
  // a placeholder). After the choice it locks exactly like the name.
  const needsUsername = user?.usernameChosen === false;
  const [username, setUsername] = useState(user?.username || '');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const usernameSeqRef = useRef(0);
  // Keeping the generated placeholder COUNTS as choosing: saving it flips the
  // lock without renaming, so it must never read as "taken" (it is taken — by
  // this very account, which the server's self-excluding check knows).
  const usernameUnchanged = username.trim().toLowerCase() === String(user?.username || '').trim().toLowerCase();
 const [formData, setFormData] = useState({
 collegeId: user?.college?.id || '',
 displayName: user?.displayName || '',
 course: user?.course || '',
 year: user?.year || 1,
 bio: user?.bio || '',
 gender: (user?.gender || 'UNKNOWN') as string,
 // Prefilled when already set: the field is then read-only, and an empty
 // required box for data we already hold forced a retype that the write-once
 // lock answered with "Birth date is locked once set".
 dateOfBirth: user?.dateOfBirth ? String(user.dateOfBirth).slice(0, 10) : '',
 interestIds: user?.interests?.map((i) => i.id) || [],
 });
 const [isLoading, setIsLoading] = useState(false);
 const [slots, setSlots] = useState<{ id: string; slot: number }[]>(
 (user?.photos as any) || [],
 );
 const [staged, setStaged] = useState<{ slot: number; file: File; url: string }[]>([]);
 const stagedRef = useRef(staged);
 stagedRef.current = staged;
 const [busySlot, setBusySlot] = useState<number | null>(null);
 const [editing, setEditing] = useState<{ slot: number; file: File } | null>(null);
 const [confirmLeave, setConfirmLeave] = useState(false);

 // One tile per slot: a STAGED pick overrides the saved photo in the same slot.
 const tiles = new Map<number, { slot: number; id?: string; src: string; staged: boolean }>();
 for (const p of slots) tiles.set(p.slot, { slot: p.slot, id: p.id, src: photoSrc(p.id) + `&v=${photoVersion}`, staged: false });
 for (const s of staged) tiles.set(s.slot, { slot: s.slot, src: s.url, staged: true });

 /**
 * Photos unlock matching — so they are STAGED here and uploaded on save.
 *
 * Uploading on pick meant "leave without saving" still left pictures on the
 * account, which quietly broke the rule that leaving this screen discards
 * everything. Staging also means a wrong pick costs one tap, not an upload
 * plus a delete. Removing a photo that IS saved stays immediate: that is a
 * deliberate act on stored data, not an unsaved form field.
 */
 const stage = (slot: number, file: File | undefined) => {
 if (!file) return;
 if (!file.type.startsWith('image/')) return toast.error('Pick an image file');
 if (file.size > 5 * 1024 * 1024) return toast.error('Image must be under 5 MB');
 setStaged((prev) => {
 const replaced = prev.find((s) => s.slot === slot);
 if (replaced) URL.revokeObjectURL(replaced.url);
 return [...prev.filter((s) => s.slot !== slot), { slot, file, url: URL.createObjectURL(file) }];
 });
 };

 const handleRemove = async (tile: { slot: number; id?: string }) => {
 // A staged pick is only state — dropping it IS the removal.
 if (!tile.id) {
 setStaged((prev) => {
 const hit = prev.find((s) => s.slot === tile.slot);
 if (hit) URL.revokeObjectURL(hit.url);
 return prev.filter((s) => s.slot !== tile.slot);
 });
 return;
 }
 setBusySlot(tile.slot);
 try {
 await api.delete(`/users/me/photos/${tile.id}`);
 setSlots((s) => s.filter((p) => p.id !== tile.id));
 await refreshUser(); // keep the shell avatar in sync with the removal
 } catch {
 /* non-fatal */
 } finally {
 setBusySlot(null);
 }
 };

  // Preview URLs are memory: release them when the screen goes away.
  useEffect(() => () => { for (const s of stagedRef.current) URL.revokeObjectURL(s.url); }, []);

  /**
   * Live handle availability — same rules as the old wizard field, now owned
   * by this screen. Shape and reserved words are answered locally (instant);
   * only "is it claimed?" needs the server, debounced, with stale answers
   * dropped (the sequence guard). An UNCHANGED placeholder skips the check
   * entirely: it belongs to this account, so "taken" would be a lie.
   */
  useEffect(() => {
    if (!needsUsername || usernameUnchanged) return;
    const typed = username.trim().toLowerCase();
    const local = localUsernameStatus(typed);
    if (local !== 'ok') {
      setUsernameStatus(local === 'empty' ? 'idle' : local);
      return;
    }
    setUsernameStatus('checking');
    const seq = ++usernameSeqRef.current;
    const timer = setTimeout(async () => {
      try {
        const result = await checkUsername(typed);
        if (seq !== usernameSeqRef.current) return;
        if (result.available) setUsernameStatus('available');
        else setUsernameStatus(result.reason === 'reserved' ? 'reserved' : 'taken');
      } catch {
        if (seq !== usernameSeqRef.current) return;
        // A failed CHECK is not a verdict: keep going and let the save (whose
        // unique index is the truth) decide.
        setUsernameStatus('unavailable');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [username, needsUsername, usernameUnchanged]);

  const usernameOk = !needsUsername || usernameUnchanged ||
    (localUsernameStatus(username) === 'ok' && !blocksSubmit(usernameStatus));
  const usernameHandle = usernameFeedback(usernameStatus, username);

 /**
 * Leave the profile form. Nothing on it is written — staged picks are dropped
 * with their previews and the wizard's remembered draft goes with them.
 *
 * Signing out is only safe when something else can sign the account back IN (a
 * password, or Google): a verified account with neither would be stranded
 * forever, so that case is sent to the password step instead of the exit.
 */
 const leaveSetup = async () => {
 for (const s of staged) URL.revokeObjectURL(s.url);
 setStaged([]);
 clearWizardDraft(sessionStorage);
 if (!canSignOut(user)) {
 toast.error("Set a password first — it's the only way back into your account", { duration: 6000 });
 navigate('/setup-password', { replace: true });
 return;
 }
 await logout();
 navigate('/login', { replace: true });
 };

 const { data: interests } = useQuery({
 queryKey: ['interests'],
 queryFn: () => api.get('/users/interests').then((r) => r.data),
 });

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 // No college → this screen is not the place to fix it (see the blocked state).
 if (needsCollege) return;
 setIsLoading(true);
 try {
  // 1. Upload the staged picks first (slot order — slot 0 is the avatar), so a
  //    failure here aborts before any profile field is written.
  const pending = [...staged].sort((a, b) => a.slot - b.slot);
  for (const item of pending) {
    const fd = new FormData();
    fd.append('photo', item.file);
    fd.append('slot', String(item.slot));
    await api.post('/users/me/photos', fd);
  }
  // 2. The profile itself. Locked fields are NOT sent: the server refuses any
  //    change to them (403), so echoing them back is at best a no-op and at
  //    worst a confusing failure. No collegeId either — the wizard owns that.
   await updateProfile({
     course: formData.course,
     year: formData.year,
     bio: formData.bio,
     // The one-time handle choice (this screen owns it now): sent even when
     // unchanged, so keeping the placeholder still flips the lock.
     ...(needsUsername ? { username: username.trim().toLowerCase() } : {}),
     ...(genderLocked ? {} : { gender: formData.gender }),
    ...(dobLocked ? {} : { dateOfBirth: formData.dateOfBirth }),
    ...(nameLocked ? {} : { displayName: formData.displayName.trim() }),
    interestIds: formData.interestIds,
  });
  for (const item of pending) URL.revokeObjectURL(item.url);
  setStaged([]);
  // Refresh the user so the gates re-evaluate immediately
  await fetchMe();
  toast.success('Profile updated!');
  // Funnel order: college → verification → password → profile → feed.
  // (Fresh signups arrive verified; legacy no-college Google users may still
  // need /verify next — nextStep decides, never a hardcoded route.)
  navigate(nextStep(useAuthStore.getState().user), { replace: true });
 } catch (err: any) {
 toast.error(err.response?.data?.error || 'Update failed');
 } finally {
 setIsLoading(false);
 }
 };

 // ── Blocked: no college on the account ────────────────────
 //
 // This state only exists for accounts that reached us WITHOUT going through
 // the wizard's college step ("Sign in with Google" on the login page is the
 // common one). The college is never chosen outside the wizard, so the answer
 // is to go back and start over — not to bolt a picker onto the last screen of
 // onboarding, which is how someone could quietly end up in the wrong campus.
 if (needsCollege) {
 return (
 <div className="min-h-screen nb-canvas-surface flex items-center justify-center p-4">
 <div className="w-full max-w-lg">
 <div className="nb-card p-6 text-center">
 <div className="mx-auto w-16 h-16 bg-nb-violet/15 flex items-center justify-center">
 <GraduationCap size={30} strokeWidth={2.5} className="text-nb-violet" />
 </div>
 <h1 className="mt-4 text-2xl font-display font-bold">Pick your college first</h1>
 <p className="mt-2 font-body text-sm text-gray-500">
 Your account doesn&apos;t have a college yet, and your college is what decides everything you see — the feed,
 matches and chats never cross campuses. So it&apos;s chosen in the first step of signup, once, before the rest of
 the profile.
 </p>
 <p className="mt-3 font-body text-sm text-gray-500">
 Go back to signup, choose your college and continue — you&apos;ll land right back here.
 </p>
 <button
 onClick={() => navigate('/signup')}
 className="nb-btn-primary w-full mt-6"
 >
 <ArrowLeft size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" /> Go back to choose my college
 </button>
 <button
 onClick={async () => { await logout(); navigate('/login', { replace: true }); }}
 className="nb-btn-ghost w-full mt-2 text-sm"
 >
 Sign out
 </button>
 </div>
 </div>
 </div>
 );
 }

 return (
 <div className="min-h-screen nb-canvas-surface flex items-center justify-center p-4">
 <div className="w-full max-w-lg">
 {/* Leaving is ONE tap and it is honest about it — but it asks first,
 because this screen is a full page of work with nothing saved yet. */}
 <div className="flex items-center justify-between mb-3">
 <button
 type="button"
 onClick={() => setConfirmLeave(true)}
 className="text-sm font-body opacity-60 hover:opacity-100 inline-flex items-center gap-1"
 >
 <ArrowLeft size={14} /> Back to start
 </button>
 <span className="text-xs font-body text-gray-400">Step 4 of 4</span>
 </div>

 {confirmLeave && (
 <div role="dialog" aria-modal="true" aria-labelledby="leave-setup-title" className="nb-card p-4 mb-4">
 <h2 id="leave-setup-title" className="font-display font-bold text-lg">Leave setup?</h2>
 <p className="font-body text-sm text-gray-500 mt-1">
 Nothing typed here is saved — the form and any photos you picked are discarded. Your account, verified
 college email and password stay exactly as they are.
 </p>
 {!canSignOut(user) && (
 <p className="font-body text-xs text-nb-pink font-semibold mt-2 flex items-start gap-1.5">
 <Lock size={12} className="mt-0.5 shrink-0" />
 You haven&apos;t set a password yet, so we&apos;ll take you to set one first — otherwise there&apos;d be no way back into
 your account.
 </p>
 )}
 <div className="flex flex-col sm:flex-row gap-2 mt-4">
 <button type="button" onClick={leaveSetup} className="nb-btn-primary flex-1 text-center">
 Leave without saving
 </button>
 <button type="button" onClick={() => setConfirmLeave(false)} className="nb-btn-ghost flex-1 text-center">
 Keep editing
 </button>
 </div>
 </div>
 )}

 <div className="text-center mb-6">
 <h1 className="text-3xl font-display font-bold text-ink">
 <span className="inline-flex items-center gap-2">
 <Sparkles size={24} strokeWidth={2.5} className="text-nb-violet" /> Complete Your Profile
 </span>
 </h1>
 <p className="mt-2 font-body text-sm text-gray-500">
 Let people know where you study and what you're into
 </p>
 </div>

   <form onSubmit={handleSubmit} className="nb-card p-4 sm:p-6 space-y-4 min-w-0">
   {needsUsername ? (
   <div>
   <label htmlFor="setup-username" className="block font-display text-sm font-semibold mb-1.5">Username * <span className="font-normal text-gray-500">(choose once)</span></label>
   <div className="relative">
   <span aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-display">@</span>
   <input
   id="setup-username"
   type="text"
   className="nb-input pl-8 pr-9"
   placeholder="coolstudent"
   value={username}
   onChange={(e) => setUsername(sanitizeUsernameInput(e.target.value))}
   required
   autoComplete="username"
   aria-invalid={blocksSubmit(usernameStatus) || undefined}
   aria-describedby="setup-username-status"
   />
   {usernameStatus === 'checking' && (
   <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" aria-hidden="true" />
   )}
   {usernameStatus === 'available' && (
   <Check size={15} strokeWidth={3} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-600" aria-hidden="true" />
   )}
   {blocksSubmit(usernameStatus) && (
   <X size={15} strokeWidth={3} className="absolute right-3 top-1/2 -translate-y-1/2 text-nb-pink" aria-hidden="true" />
   )}
   </div>
   <p
   id="setup-username-status"
   role="status"
   aria-live="polite"
   className={`text-xs mt-1 ${
   usernameHandle?.tone === 'bad' ? 'text-nb-pink font-semibold'
   : usernameHandle?.tone === 'ok' ? 'text-green-700 font-semibold'
   : 'text-gray-500'
   }`}
   >
   {usernameUnchanged
   ? <>This temporary handle is reserved for you — keep it or pick a new one. Either way it locks forever once you save.</>
   : (usernameHandle?.text ?? <>Your public handle — permanent. We check it as you type.</>)}
   </p>
   </div>
   ) : (
   <div>
   <label htmlFor="setup-username-locked" className="block font-display text-sm font-semibold mb-1.5">Username (locked)</label>
   <input
   id="setup-username-locked"
   type="text"
   className="nb-input bg-gray-50 text-gray-500"
   value={user?.username || ''}
   readOnly
   disabled
   aria-readonly="true"
   />
   <p className="text-xs text-gray-500 mt-1">
   Chosen once here to finish setup — you can change it anytime later from Edit profile.
   </p>
   </div>
   )}
   <div>
  <label htmlFor="setup-college" className="block font-display text-sm font-semibold mb-1.5">College (locked)</label>
  <input
  id="setup-college"
  type="text"
  className="nb-input bg-gray-50 text-gray-500"
  value={college ? `${college.name}${college.shortName ? ` (${college.shortName})` : ''}` : ''}
  placeholder="Not set"
  readOnly
  disabled
  aria-readonly="true"
  />
  <p className="text-xs text-gray-500 mt-1">
  Chosen in step 1 of signup and fixed for the life of the account — posts, matches and chats never cross campuses.
  </p>
  </div>

  <div>
  <label htmlFor="setup-name" className="block font-display text-sm font-semibold mb-1.5">
  {nameLocked ? 'Name (locked)' : 'Display name *'}
  </label>
  <input
  id="setup-name"
  type="text"
  className={`nb-input ${nameLocked ? 'bg-gray-50 text-gray-500' : ''}`}
  value={formData.displayName}
  onChange={(e) => setFormData((d) => ({ ...d, displayName: e.target.value }))}
  readOnly={nameLocked}
  disabled={nameLocked}
  required={!nameLocked}
  maxLength={50}
  autoComplete="off"
  />
  <p className="text-xs text-gray-500 mt-1">
  {nameLocked
  ? 'Fixed for the life of the account.'
  : 'You get to set this once — it is fixed the moment you save.'}
  </p>
  </div>

  <div>
  <label htmlFor="setup-course" className="block font-display text-sm font-semibold mb-1.5">Course / Branch *</label>
  <input
  id="setup-course"
  type="text"
  className="nb-input"
  placeholder="e.g. CSE, ECE"
  value={formData.course}
  onChange={(e) => setFormData((d) => ({ ...d, course: e.target.value }))}
  required
  autoComplete="off"
  />
  </div>

  <fieldset>
  <legend className="block font-display text-sm font-semibold mb-1.5">Year</legend>
  <div className="flex gap-2" role="radiogroup" aria-label="Year">
  {[1, 2, 3, 4].map((y) => (
  <button
  key={y}
  type="button"
  role="radio"
  aria-checked={formData.year === y}
  onClick={() => setFormData((d) => ({ ...d, year: y }))}
  className={`nb-btn flex-1 text-center text-sm ${
  formData.year === y ? 'bg-nb-violet text-white' : ''
  }`}
  >
  {y === 1 ? '1st' : y === 2 ? '2nd' : y === 3 ? '3rd' : '4th'}
  </button>
  ))}
  </div>
  </fieldset>

  <div>
  <label htmlFor="setup-bio" className="block font-display text-sm font-semibold mb-1.5">Bio</label>
  <textarea
  id="setup-bio"
  className="nb-input min-h-[80px] resize-none"
  placeholder="Tell us about yourself..."
  value={formData.bio}
  onChange={(e) => setFormData((d) => ({ ...d, bio: e.target.value }))}
  />
  </div>

  <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 min-w-0">
 <div>
  <label htmlFor="setup-dob" className="block font-display text-sm font-semibold mb-1.5">
  {dobLocked ? 'Birth date (locked)' : 'Birth date *'}
  </label>
  <input
  id="setup-dob"
  type="date"
  className={`nb-input text-sm ${dobLocked ? 'bg-gray-50 text-gray-500' : ''}`}
  required={!dobLocked}
  readOnly={dobLocked}
  disabled={dobLocked}
  max={new Date(Date.now() - 16 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10)}
  value={formData.dateOfBirth}
  onChange={(e) => setFormData((d) => ({ ...d, dateOfBirth: e.target.value }))}
  />
  <p className="text-xs text-gray-500 mt-1">
  {dobLocked ? 'Locked once saved. Only your age is shown.' : 'Must be 16+. Only your age is shown.'}
  </p>
  </div>
  <div>
  <label htmlFor="setup-gender" className="block font-display text-sm font-semibold mb-1.5">
  {genderLocked ? 'Gender (locked)' : 'Gender *'}
  </label>
  <select
  id="setup-gender"
  className={`nb-input text-sm ${genderLocked ? 'bg-gray-50 text-gray-500' : ''}`}
  required={!genderLocked}
  disabled={genderLocked}
  value={formData.gender}
  onChange={(e) => setFormData((d) => ({ ...d, gender: e.target.value }))}
  >
 <option value="FEMALE">Female</option>
 <option value="MALE">Male</option>
 <option value="OTHER">Other</option>
 <option value="UNKNOWN">Prefer not to say</option>
 </select>
 </div>
 </div>

 <div>
 <label className="block font-display text-sm font-semibold mb-2">
 Photos <span className="font-normal text-gray-500">(first one unlocks matching)</span>
 </label>
 <div className="grid grid-cols-4 gap-2 mb-1">
 {Array.from({ length: 4 }).map((_, slot) => {
 const tile = tiles.get(slot) || null;
 const src = tile?.src || null;
 return (
 <div key={slot} className="relative">
  {tile && (
  <button
  type="button"
  onClick={() => handleRemove(tile)}
  aria-label={`Remove photo ${slot + 1}`}
  className="absolute -top-1 -right-1 z-10 w-7 h-7 bg-nb-pink text-white border-nb-2 border-ink flex items-center justify-center"
  title="Remove"
  >
  <X size={11} strokeWidth={3} />
  </button>
  )}
  <label className={`block cursor-pointer focus-within:ring-2 focus-within:ring-nb-violet focus-within:ring-offset-2 ${busySlot === slot ? 'opacity-50 pointer-events-none' : ''}`} aria-label={slot === 0 ? 'Upload profile picture' : `Upload photo ${slot + 1}`}>
  <input
  type="file"
  accept="image/*"
  aria-label={slot === 0 ? 'Upload profile picture' : `Upload photo ${slot + 1}`}
  className="sr-only focus:not-sr-only focus:w-px focus:h-px"
  onChange={(e) => {
  const f = e.target.files?.[0];
  e.currentTarget.value = '';
  if (f) setEditing({ slot, file: f });
  }}
  />
 {src ? (
 <img src={src} alt="" className={`w-full aspect-square object-cover nb-avatar ! ${slot === 0 ? 'ring-2 ring-nb-violet ring-offset-2' : ''}`} />
 ) : (
 <div className={`w-full aspect-square border-nb-2 border-dashed border-gray-400 bg-white flex flex-col items-center justify-center text-gray-500 hover:border-nb-violet hover:text-nb-violet transition-colors ${slot === 0 ? 'ring-2 ring-nb-violet ring-offset-2' : ''}`}>
 {slot === 0 ? <Camera size={16} strokeWidth={2.5} /> : <Plus size={14} strokeWidth={2.5} />}
 <span className="text-[9px] font-display font-semibold mt-0.5">{slot === 0 ? 'Profile pic' : 'Add'}</span>
 </div>
 )}
 </label>
 </div>
 );
 })}
  </div>
  <p className="text-xs text-gray-500 font-body mb-1">
  JPG / PNG / WebP · max 5 MB each.{' '}
  {staged.length > 0 && <span className="font-semibold text-nb-violet">New picks upload when you save.</span>}
  </p>
  </div>

  <fieldset>
  <legend className="block font-display text-sm font-semibold mb-2">Interests</legend>
  {!interests ? (
  <LoadingSpinner size="sm" />
  ) : interests.length === 0 ? (
  <p className="text-sm font-body text-gray-500">No interests to show right now — you can add them later from your profile.</p>
  ) : (
  <div className="flex flex-wrap gap-2" role="group" aria-label="Interests">
  {interests?.map((i: any) => (
  <button
  key={i.id}
  type="button"
  aria-pressed={formData.interestIds.includes(i.id)}
  onClick={() =>
  setFormData((d) => ({
  ...d,
  interestIds: d.interestIds.includes(i.id)
  ? d.interestIds.filter((id) => id !== i.id)
  : [...d.interestIds, i.id],
  }))
  }
  className={`nb-tag cursor-pointer transition-all ${
  formData.interestIds.includes(i.id)
  ? 'bg-nb-violet text-white'
  : 'bg-white'
  }`}
  >
  {i.name}
  </button>
  ))}
  </div>
  )}
  </fieldset>

  <button
  type="submit"
  disabled={isLoading || needsCollege || !usernameOk}
  aria-busy={isLoading}
  className="nb-btn-primary w-full text-center disabled:opacity-50 disabled:cursor-not-allowed"
  >
 {isLoading ? (
 <><Hourglass size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Saving...</>
 ) : (
 <><PartyPopper size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Complete Setup</>
 )}
 </button>
 </form>
 </div>
 {editing && (
 <ImageEditorModal
 file={editing.file}
 title="Edit photo"
 aspects={[
 { label: 'Original', value: null },
 { label: '1:1', value: 1 },
 { label: '4:5', value: 4 / 5 },
 ]}
  maxOutputPx={1080}
 onCancel={() => setEditing(null)}  onDone={(f) => {
 const slot = editing.slot;
 setEditing(null);
 stage(slot, f);
 }}
 />
 )}
 </div>
 );
}
