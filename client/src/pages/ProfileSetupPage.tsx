import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, PartyPopper, Hourglass, Camera, Plus, X, GraduationCap, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { nextStep, hasCollege } from '@/utils/funnel';
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
 const [formData, setFormData] = useState({
 collegeId: user?.college?.id || '',
 course: user?.course || '',
 year: user?.year || 1,
 bio: user?.bio || '',
 gender: (user as any)?.gender || 'UNKNOWN',
 dateOfBirth: '',
 interestIds: user?.interests?.map((i) => i.id) || [],
 });
 const [isLoading, setIsLoading] = useState(false);
 const [slots, setSlots] = useState<{ id: string; slot: number }[]>(
 ((user as any)?.photos as any) || [],
 );
 const [busySlot, setBusySlot] = useState<number | null>(null);
 const [editing, setEditing] = useState<{ slot: number; file: File } | null>(null);

 /** Photos unlock matching — upload right here so new users aren't gated later. */
 const handleUpload = async (slot: number, file: File | undefined) => {
 if (!file) return;
 if (!file.type.startsWith('image/')) return toast.error('Pick an image file');
 if (file.size > 5 * 1024 * 1024) return toast.error('Image must be under 5 MB');
 setBusySlot(slot);
 try {
 const fd = new FormData();
 fd.append('photo', file);
 fd.append('slot', String(slot));
 await api.post('/users/me/photos', fd);
 const { data } = await api.get('/auth/me');
 setSlots(data.photos || []);
 // New avatar propagates to Topbar/Sidebar/MobileNav immediately.
 await refreshUser();
 toast.success(slot === 0 ? 'Profile picture set' : 'Photo added');
 } catch (e: any) {
 toast.error(e.response?.data?.error || 'Upload failed');
 } finally {
 setBusySlot(null);
 }
 };

 const handleRemove = async (photo: { id: string; slot: number }) => {
 setBusySlot(photo.slot);
 try {
 await api.delete(`/users/me/photos/${photo.id}`);
 setSlots((s) => s.filter((p) => p.id !== photo.id));
 await refreshUser(); // keep the shell avatar in sync with the removal
 } catch {
 /* non-fatal */
 } finally {
 setBusySlot(null);
 }
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
  // No collegeId is ever sent from here: the college was locked at signup and
  // the server refuses a move (403) — it can only be set by the wizard, which
  // is why the no-college case sends the user back there.
  await updateProfile({
    course: formData.course,
    year: formData.year,
    bio: formData.bio,
    gender: formData.gender,
    dateOfBirth: formData.dateOfBirth,
    interestIds: formData.interestIds,
  });
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
  <label htmlFor="setup-dob" className="block font-display text-sm font-semibold mb-1.5">Birth date *</label>
  <input
  id="setup-dob"
  type="date"
  className="nb-input text-sm"
  required
  max={new Date(Date.now() - 16 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10)}
  value={formData.dateOfBirth}
  onChange={(e) => setFormData((d) => ({ ...d, dateOfBirth: e.target.value }))}
  />
  <p className="text-xs text-gray-500 mt-1">Must be 16+. Only your age is shown.</p>
  </div>
  <div>
  <label htmlFor="setup-gender" className="block font-display text-sm font-semibold mb-1.5">Gender *</label>
  <select
  id="setup-gender"
  className="nb-input text-sm"
  required
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
 const photo = slots.find((s) => s.slot === slot) || null;
 const src = photo ? photoSrc(photo.id) + `&v=${photoVersion}` : null;
 return (
 <div key={slot} className="relative">
  {photo && (
  <button
  type="button"
  onClick={() => handleRemove(photo)}
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
  <p className="text-xs text-gray-500 font-body mb-1">JPG / PNG / WebP · max 5 MB each.</p>
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
  disabled={isLoading || needsCollege}
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
 onCancel={() => setEditing(null)}
 onDone={(f) => {
 const slot = editing.slot;
 setEditing(null);
 handleUpload(slot, f);
 }}
 />
 )}
 </div>
 );
}
