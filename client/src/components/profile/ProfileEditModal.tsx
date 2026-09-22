import { useState } from 'react';
import { X, Save, Hourglass, Camera, Plus, Calendar, Lock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import ImageEditorModal from '@/components/common/ImageEditorModal';
import { photoSrc, usePhotoVersion } from '@/utils/photo';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';

const AVATAR_COLORS = [
 '#6D28D9', '#F43F5E', '#FBBF24', '#10B981', '#60A5FA', '#C4B5FD',
 '#10B981', '#F43F5E', '#6D28D9', '#C4B5FD',
];

const GENDERS = [
 { value: 'FEMALE', label: 'Female' },
 { value: 'MALE', label: 'Male' },
 { value: 'OTHER', label: 'Other' },
 { value: 'UNKNOWN', label: 'Prefer not to say' },
];

/** Relationship goals (intent matching) — mirrors the server's VALID_GOALS. */
const GOALS = [
 { value: 'DATING', label: 'Dating' },
 { value: 'RELATIONSHIP', label: 'Relationship' },
 { value: 'HOOKUP', label: 'Hookup' },
 { value: 'CASUAL', label: 'Casual' },
 { value: 'NOT_SURE', label: 'Not sure yet' },
];

const MAX_PHOTOS = 4;
const MAX_MB = 5;

export default function ProfileEditModal({ profile, onClose, onSaved }: {
 profile: any;
 onClose: () => void;
 onSaved: () => void;
}) {
 const [form, setForm] = useState({
 displayName: profile.displayName || '',
 bio: profile.bio || '',
 avatarColor: profile.avatarColor || AVATAR_COLORS[0],
 gender: profile.gender || 'UNKNOWN',
 dateOfBirth: profile.dateOfBirth ? String(profile.dateOfBirth).slice(0, 10) : '',
 course: profile.course || '',
 year: profile.year || 1,
 relationshipGoals: (profile.relationshipGoals || []) as string[],
 interestIds: (profile.interests || []).map((i: any) => i.id),
 });
 const [slots, setSlots] = useState<{ id: string; slot: number }[]>(profile.photos || []);
 const [busySlot, setBusySlot] = useState<number | null>(null);
 const [editing, setEditing] = useState<{ slot: number; file: File } | null>(null);
 const [isSaving, setIsSaving] = useState(false);
 const photoVersion = usePhotoVersion(); // token rotation → thumbnails reload
 // Avatar changes must reach the whole shell (Topbar/Sidebar/MobileNav), not
 // just this modal — so photo add/remove re-syncs the logged-in user.
 const refreshUser = useAuthStore((s) => s.refreshUser);

 const { data: interests } = useQuery({
 queryKey: ['interests'],
 queryFn: () => api.get('/users/interests').then((r) => r.data),
 });

 const profilePic = slots.find((s) => s.slot === 0) || null;

 // Client mirrors of server rules — instant feedback, server still enforces
 const validate = (): string | null => {
 if (form.displayName.trim().length < 2 || form.displayName.trim().length > 50) return 'Name must be 2-50 characters';
 if (form.bio.length > 300) return 'Bio must be under 300 characters';
 if (form.dateOfBirth) {
 const age = (Date.now() - new Date(form.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000);
 if (age < 16) return 'You must be at least 16';
 if (age > 100) return 'Invalid birth date';
 }
 return null;
 };

 const refreshSlots = async () => {
 const { data } = await api.get('/auth/me');
 setSlots(data.photos || []);
 refreshUser(); // new profile pic → Topbar/Sidebar/MobileNav update too
 };

 const handleUpload = async (slot: number, file: File | undefined) => {
 if (!file) return;
 if (!file.type.startsWith('image/')) return toast.error('Pick an image file');
 if (file.size > MAX_MB * 1024 * 1024) return toast.error(`Image must be under ${MAX_MB} MB`);
 setBusySlot(slot);
 try {
 const fd = new FormData();
 fd.append('photo', file);
 fd.append('slot', String(slot));
 await api.post('/users/me/photos', fd);
 await refreshSlots();
 toast.success(slot === 0 ? 'Profile picture updated' : 'Photo added');
 onSaved();
 } catch (e: any) {
 toast.error(e.response?.data?.error || 'Upload failed');
 } finally {
 setBusySlot(null);
 }
 };

 const handleDelete = async (photo: { id: string; slot: number }) => {
 setBusySlot(photo.slot);
 try {
 await api.delete(`/users/me/photos/${photo.id}`);
 await refreshSlots();
 onSaved();
 } catch (e: any) {
 toast.error(e.response?.data?.error || 'Could not remove');
 } finally {
 setBusySlot(null);
 }
 };

 const handleSave = async () => {
 const problem = validate();
 if (problem) return toast.error(problem);
 setIsSaving(true);
 try {
 await api.patch('/auth/me', {
 ...form,
 dateOfBirth: form.dateOfBirth || null,
 });
 toast.success('Profile updated');
 onSaved();
 } catch (e: any) {
 toast.error(e.response?.data?.error || 'Could not save');
 } finally {
 setIsSaving(false);
 }
 };

 // Modal layout: the FIXED element is the scroll container; the inner wrapper
 // is min-h-full so `items-center` centers within the FULL content height.
 // (Centering a tall card directly inside a centering viewport clips its top
 // above the scroll origin — the header became unreachable.)
 return (
 <div className="fixed inset-0 z-[80] bg-black/60 overflow-y-auto overscroll-contain" onClick={onClose}>
  <div className="min-h-full flex items-center justify-center p-3 sm:p-4 pb-[calc(2rem+env(safe-area-inset-bottom))] my-2 sm:my-4" onClick={onClose}>
  <div className="nb-card bg-white p-4 sm:p-6 max-w-lg w-full min-w-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
  <div className="flex items-center justify-between gap-2 mb-4 min-w-0">
  <h2 className="font-display font-bold text-xl truncate">Edit profile</h2>
  <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-ink shrink-0 w-10 h-10 grid place-items-center">
  <X size={20} strokeWidth={2.5} />
  </button>
  </div>

 {/* Photos: profile pic + 3 extra — exactly what matching shows */}
 <label className="block font-display text-sm font-semibold mb-2">
 Photos <span className="font-normal text-gray-500">(up to {MAX_PHOTOS} — first one is your profile pic)</span>
 </label>
  <div className="grid grid-cols-4 gap-1.5 sm:gap-2 mb-1 min-w-0">
 {Array.from({ length: MAX_PHOTOS }).map((_, slot) => {
 const photo = slots.find((s) => s.slot === slot) || null;
 const src = photo ? photoSrc(photo.id) + `&v=${photoVersion}` : null;
 return (
 <div key={slot} className="relative">
 {photo && (
  <button
  onClick={() => handleDelete(photo)}
  disabled={busySlot === slot}
  aria-label="Remove photo"
  className="absolute -top-1 -right-1 z-10 w-7 h-7 bg-nb-pink text-white border-nb-2 border-ink flex items-center justify-center"
  title="Remove photo"
  >
 <X size={11} strokeWidth={3} />
 </button>
 )}
 <label
 className={`block cursor-pointer ${busySlot === slot ? 'opacity-50 pointer-events-none' : ''}`}
 title={slot === 0 ? 'Profile picture' : `Photo ${slot + 1}`}
 >
 <input
 type="file"
 accept="image/*"
 className="hidden"
 onChange={(e) => {
 const f = e.target.files?.[0];
 e.currentTarget.value = '';
 if (f) setEditing({ slot, file: f });
 }}
 />
  {src ? (
  <img
  src={src}
  alt=""
  className={`w-full aspect-square object-cover nb-avatar ! ${slot === 0 ? 'ring-2 ring-nb-violet ring-offset-2' : ''}`}
  />
  ) : (
 <div className={`w-full aspect-square border-nb-2 border-dashed border-gray-400 bg-nb-cream flex flex-col items-center justify-center text-gray-500 hover:border-nb-violet hover:text-nb-violet transition-colors ${slot === 0 ? 'ring-2 ring-nb-violet ring-offset-2' : ''}`}>
 {slot === 0 ? <Camera size={18} strokeWidth={2.5} /> : <Plus size={16} strokeWidth={2.5} />}
 <span className="text-[9px] font-display font-semibold mt-0.5">
 {slot === 0 ? 'Profile pic' : 'Add'}
 </span>
 </div>
 )}
 </label>
 </div>
 );
 })}
 </div>
  <p className="text-[11px] text-gray-500 font-body mb-4">
  People in Match see all your photos. JPG / PNG / WebP · max {MAX_MB} MB.
  </p>

 <div className="flex items-center gap-4 mb-5">
 <Avatar photoId={profilePic?.id} name={form.displayName} size="lg" color={form.avatarColor} />
 <div className="flex-1 min-w-0">
 <label className="block font-display text-xs font-semibold mb-1">Avatar color</label>
 <div className="flex gap-1.5 flex-wrap">
 {AVATAR_COLORS.map((c) => (
 <button
 key={c}
 type="button"
 onClick={() => setForm((f) => ({ ...f, avatarColor: c }))}
 className={`w-6 h-6 border-nb-2 transition-transform ${form.avatarColor === c ? 'border-ink scale-110' : 'border-transparent'}`}
 style={{ backgroundColor: c }}
 title={c}
 />
 ))}
 </div>
 </div>
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

 <label className="block font-display text-sm font-semibold mb-1.5">Name</label>
 <input
 className="nb-input mb-3"
 value={form.displayName}
 onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
 />

 <label className="block font-display text-sm font-semibold mb-1.5">
 Bio <span className="font-normal text-gray-500">({form.bio.length}/300)</span>
 </label>
 <textarea
 className="nb-input min-h-[70px] resize-none mb-3"
 value={form.bio}
 onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
 />

  <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 mb-3 min-w-0">
 <div>
 <label className="block font-display text-sm font-semibold mb-1.5">
 <Calendar size={12} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Birth date
 </label>
 <input
 type="date"
 className="nb-input text-sm"
 max={new Date(Date.now() - 16 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10)}
 value={form.dateOfBirth}
 onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
 />
 </div>
 <div>
 <label className="block font-display text-sm font-semibold mb-1.5">Gender</label>
 <select
 className="nb-input text-sm"
 value={form.gender}
 onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
 >
 {GENDERS.map((g) => (
 <option key={g.value} value={g.value}>{g.label}</option>
 ))}
 </select>
 </div>
 </div>

 {/* What I'm here for — MULTI-SELECT. Powers intent matching on other
 people's decks: a viewer's "Looking for" filter matches anyone whose
 selections overlap theirs. Empty = rather not say. */}
 <label className="block font-display text-sm font-semibold mb-1.5">
 Looking for <span className="font-normal text-gray-500">(select any that apply)</span>
 </label>
 <div className="flex gap-1.5 mb-1 flex-wrap">
 {GOALS.map((g) => {
 const on = form.relationshipGoals.includes(g.value);
 return (
 <button
 key={g.value}
 type="button"
 onClick={() =>
 setForm((f) => ({
 ...f,
 relationshipGoals: on
 ? f.relationshipGoals.filter((x) => x !== g.value)
 : [...f.relationshipGoals, g.value],
 }))
 }
 className={`nb-btn text-xs px-3 py-1.5 ${on ? 'bg-nb-pink text-white' : 'bg-white'}`}
 >
 {g.label}
 </button>
 );
 })}
 </div>
  <p className="text-xs text-gray-500 mb-4 font-body flex items-start gap-1">
 <Lock size={11} strokeWidth={2.5} className="mt-0.5 shrink-0" />
 <span>
 {form.relationshipGoals.length === 0
 ? 'Nothing picked — shown as "rather not say". '
 : ''}
 Only you can see this. We use it to match you with people looking for the same things — after you match, you both see what you have in common.
 </span>
 </p>

  <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 mb-3 min-w-0">
 <div>
 <label className="block font-display text-sm font-semibold mb-1.5">College</label>
 {/* PRODUCT RULE: college is permanent — it defines your entire world in the app */}
 <input
 type="text"
 className="nb-input text-sm"
 value={profile.college ? (profile.college.shortName || profile.college.name) : ''}
 disabled
 readOnly
 />
 </div>
 <div>
 <label className="block font-display text-sm font-semibold mb-1.5">Year</label>
 <select
 className="nb-input text-sm"
 value={form.year}
 onChange={(e) => setForm((f) => ({ ...f, year: Number(e.target.value) }))}
 >
 {[1, 2, 3, 4, 5].map((y) => (
 <option key={y} value={y}>{y}</option>
 ))}
 </select>
 </div>
 </div>

 <label className="block font-display text-sm font-semibold mb-1.5">Course</label>
 <input
 className="nb-input mb-3"
 placeholder="e.g. CSE"
 value={form.course}
 onChange={(e) => setForm((f) => ({ ...f, course: e.target.value }))}
 />

 <label className="block font-display text-sm font-semibold mb-2">
 Interests <span className="font-normal text-gray-500">({form.interestIds.length}/15)</span>
 </label>
  <div className="flex flex-wrap gap-1.5 mb-5 max-h-32 overflow-y-auto overscroll-contain">
 {interests?.map((i: any) => (
 <button
 key={i.id}
 type="button"
 onClick={() =>
 setForm((f) => ({
 ...f,
 interestIds: f.interestIds.includes(i.id)
 ? f.interestIds.filter((id: string) => id !== i.id)
 : f.interestIds.length >= 15
 ? f.interestIds
 : [...f.interestIds, i.id],
 }))
 }
 className={`nb-tag text-xs cursor-pointer transition-all ${
 form.interestIds.includes(i.id) ? 'bg-nb-violet text-white' : 'bg-white'
 }`}
 >
 {i.name}
 </button>
 ))}
 </div>

  <div className="flex gap-2 justify-end sticky bottom-0 bg-white pt-3 pb-1 -mb-1 flex-wrap">
 <button onClick={onClose} className="nb-btn bg-white text-sm">Cancel</button>
 <button onClick={handleSave} disabled={isSaving} className="nb-btn-orange text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
 {isSaving ? <><Hourglass size={14} strokeWidth={2.5} /> Saving...</> : <><Save size={14} strokeWidth={2.5} /> Save</>}
 </button>
 </div>
 </div>
 </div>
 </div>
 );
}
