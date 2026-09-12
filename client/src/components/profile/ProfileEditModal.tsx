import { useState } from 'react';
import { X, Save, Hourglass, Image as ImageIcon, Calendar } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import toast from 'react-hot-toast';

const AVATAR_COLORS = [
  '#FF6B35', '#FF69B4', '#FFD700', '#00D4AA', '#4B9CD3', '#9B59B6',
  '#2ECC71', '#FF4757', '#8C7AE6', '#FFA3DD',
];

const GENDERS = [
  { value: 'FEMALE', label: 'Female' },
  { value: 'MALE', label: 'Male' },
  { value: 'OTHER', label: 'Other' },
  { value: 'UNKNOWN', label: 'Prefer not to say' },
];

export default function ProfileEditModal({ profile, onClose, onSaved }: {
  profile: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    displayName: profile.displayName || '',
    bio: profile.bio || '',
    avatarUrl: profile.avatarUrl || '',
    avatarColor: profile.avatarColor || AVATAR_COLORS[0],
    gender: profile.gender || 'UNKNOWN',
    dateOfBirth: profile.dateOfBirth ? String(profile.dateOfBirth).slice(0, 10) : '',
    collegeId: profile.college?.id || '',
    course: profile.course || '',
    year: profile.year || 1,
    interestIds: (profile.interests || []).map((i: any) => i.id),
  });
  const [isSaving, setIsSaving] = useState(false);

  const { data: interests } = useQuery({
    queryKey: ['interests'],
    queryFn: () => api.get('/users/interests').then((r) => r.data),
  });

  // Client mirrors of server rules — instant feedback, server still enforces
  const validate = (): string | null => {
    if (form.displayName.trim().length < 2 || form.displayName.trim().length > 50) return 'Name must be 2-50 characters';
    if (form.bio.length > 300) return 'Bio must be under 300 characters';
    if (form.avatarUrl && !/^https:\/\//.test(form.avatarUrl.trim())) return 'Photo URL must start with https://';
    if (form.dateOfBirth) {
      const age = (Date.now() - new Date(form.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000);
      if (age < 16) return 'You must be at least 16';
      if (age > 100) return 'Invalid birth date';
    }
    return null;
  };

  const handleSave = async () => {
    const problem = validate();
    if (problem) return toast.error(problem);
    setIsSaving(true);
    try {
      await api.patch('/auth/me', {
        ...form,
        avatarUrl: form.avatarUrl.trim() || null,
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

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="nb-card bg-white p-6 max-w-lg w-full my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-xl">Edit profile</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-nb-black">
            <X size={20} strokeWidth={2.5} />
          </button>
        </div>

        {/* Avatar preview + photo URL + color picker */}
        <div className="flex items-center gap-4 mb-5">
          <Avatar src={form.avatarUrl || null} name={form.displayName} size="lg" color={form.avatarColor} />
          <div className="flex-1 min-w-0">
            <label className="block font-display text-xs font-semibold mb-1 flex items-center gap-1">
              <ImageIcon size={12} strokeWidth={2.5} /> Photo URL (https)
            </label>
            <input
              type="url"
              className="nb-input text-sm py-1.5"
              placeholder="https://example.com/me.jpg"
              value={form.avatarUrl}
              onChange={(e) => setForm((f) => ({ ...f, avatarUrl: e.target.value }))}
            />
            <label className="block font-display text-xs font-semibold mt-2 mb-1">Avatar color</label>
            <div className="flex gap-1.5 flex-wrap">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, avatarColor: c }))}
                  className={`w-6 h-6 rounded-full border-nb-2 transition-transform ${form.avatarColor === c ? 'border-nb-black scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
        </div>

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

        <div className="grid grid-cols-2 gap-3 mb-3">
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

        <div className="grid grid-cols-2 gap-3 mb-3">
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
        <div className="flex flex-wrap gap-1.5 mb-5 max-h-32 overflow-y-auto">
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
                form.interestIds.includes(i.id) ? 'bg-nb-orange text-white' : 'bg-white'
              }`}
            >
              {i.name}
            </button>
          ))}
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="nb-btn bg-white text-sm">Cancel</button>
          <button onClick={handleSave} disabled={isSaving} className="nb-btn-orange text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            {isSaving ? <><Hourglass size={14} strokeWidth={2.5} /> Saving...</> : <><Save size={14} strokeWidth={2.5} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}
