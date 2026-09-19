import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, PartyPopper, Hourglass, Camera, Plus, X } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import CollegeSelect, { CollegeOption } from '@/components/common/CollegeSelect';
import { photoSrc, usePhotoVersion } from '@/utils/photo';
import ImageEditorModal from '@/components/common/ImageEditorModal';
import toast from 'react-hot-toast';

export default function ProfileSetupPage() {
 const { user, updateProfile, fetchMe } = useAuthStore();
 const navigate = useNavigate();
 const photoVersion = usePhotoVersion(); // token rotation → thumbnails reload
 const [college, setCollege] = useState<CollegeOption | null>(
 user?.college ? { id: user.college.id, name: user.college.name, shortName: user.college.shortName, city: user.college.city, state: user.college.state } : null,
 );
 const [formData, setFormData] = useState({
 collegeId: user?.college?.id || '',
 course: user?.course || '',
 year: user?.year || 1,
 bio: user?.bio || '',
 gender: (user as any)?.gender || 'UNKNOWN',
 dateOfBirth: '',
 avatarColor: '#6D28D9',
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
 // PRODUCT RULE: college-only app — setup cannot be completed without one
 if (!formData.collegeId) {
 toast.error('Please select your college to continue');
 return;
 }
 setIsLoading(true);
 try {
 await updateProfile(formData);
 // Refresh the user so the college gate re-evaluates immediately
 await fetchMe();
 toast.success('Profile updated!');
 // Onboarding order: profile → student ID verification → feed
 navigate('/verify');
 } catch (err: any) {
 toast.error(err.response?.data?.error || 'Update failed');
 } finally {
 setIsLoading(false);
 }
 };

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

 <form onSubmit={handleSubmit} className="nb-card p-6 space-y-4">
 <div>
 <label className="block font-display text-sm font-semibold mb-1.5">College *</label>
 <CollegeSelect
 value={college}
 onChange={(c) => {
 setCollege(c);
 setFormData((d) => ({ ...d, collegeId: c?.id || '' }));
 }}
 />
 <p className="text-[11px] text-gray-500 mt-1">Search by name, short name or city — worldwide.</p>
 </div>

 <div>
 <label className="block font-display text-sm font-semibold mb-1.5">Course / Branch *</label>
 <input
 type="text"
 className="nb-input"
 placeholder="e.g. CSE, ECE"
 value={formData.course}
 onChange={(e) => setFormData((d) => ({ ...d, course: e.target.value }))}
 required
 />
 </div>

 <div>
 <label className="block font-display text-sm font-semibold mb-1.5">Year</label>
 <div className="flex gap-2">
 {[1, 2, 3, 4].map((y) => (
 <button
 key={y}
 type="button"
 onClick={() => setFormData((d) => ({ ...d, year: y }))}
 className={`nb-btn flex-1 text-center text-sm ${
 formData.year === y ? 'bg-nb-violet text-white' : ''
 }`}
 >
 {y === 1 ? '1st' : y === 2 ? '2nd' : y === 3 ? '3rd' : '4th'}
 </button>
 ))}
 </div>
 </div>

 <div>
 <label className="block font-display text-sm font-semibold mb-1.5">Bio</label>
 <textarea
 className="nb-input min-h-[80px] resize-none"
 placeholder="Tell us about yourself..."
 value={formData.bio}
 onChange={(e) => setFormData((d) => ({ ...d, bio: e.target.value }))}
 />
 </div>

 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block font-display text-sm font-semibold mb-1.5">Birth date *</label>
 <input
 type="date"
 className="nb-input text-sm"
 required
 max={new Date(Date.now() - 16 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10)}
 value={formData.dateOfBirth}
 onChange={(e) => setFormData((d) => ({ ...d, dateOfBirth: e.target.value }))}
 />
 <p className="text-[10px] text-gray-500 mt-1">Must be 16+. Only your age is shown.</p>
 </div>
 <div>
 <label className="block font-display text-sm font-semibold mb-1.5">Gender *</label>
 <select
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
 className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 bg-nb-pink text-white border-nb-2 border-ink flex items-center justify-center"
 title="Remove"
 >
 <X size={11} strokeWidth={3} />
 </button>
 )}
 <label className={`block cursor-pointer ${busySlot === slot ? 'opacity-50 pointer-events-none' : ''}`}>
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
 <p className="text-[11px] text-gray-500 font-body mb-1">JPG / PNG / WebP · max 5 MB each.</p>
 </div>

 <div>
 <label className="block font-display text-sm font-semibold mb-2">Avatar color</label>
 <div className="flex gap-2 flex-wrap">
 {['#6D28D9', '#F43F5E', '#FBBF24', '#10B981', '#60A5FA', '#C4B5FD', '#10B981', '#F43F5E', '#6D28D9', '#C4B5FD'].map((c) => (
 <button
 key={c}
 type="button"
 onClick={() => setFormData((d) => ({ ...d, avatarColor: c }))}
 className={`w-7 h-7 border-nb-2 transition-transform ${
 formData.avatarColor === c ? 'border-ink scale-110' : 'border-transparent'
 }`}
 style={{ backgroundColor: c }}
 />
 ))}
 </div>
 </div>

 <div>
 <label className="block font-display text-sm font-semibold mb-2">Interests</label>
 <div className="flex flex-wrap gap-2">
 {interests?.map((i: any) => (
 <button
 key={i.id}
 type="button"
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
 </div>

 <button
 type="submit"
 disabled={isLoading}
 className="nb-btn-orange w-full text-center disabled:opacity-50"
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
