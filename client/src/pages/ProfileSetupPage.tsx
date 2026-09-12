import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, PartyPopper, Hourglass } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import toast from 'react-hot-toast';

export default function ProfileSetupPage() {
  const { user, updateProfile, fetchMe } = useAuthStore();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    collegeId: user?.college?.id || '',
    course: user?.course || '',
    year: user?.year || 1,
    bio: user?.bio || '',
    gender: (user as any)?.gender || 'UNKNOWN',
    dateOfBirth: '',
    avatarColor: '#FF6B35',
    interestIds: user?.interests?.map((i) => i.id) || [],
  });
  const [isLoading, setIsLoading] = useState(false);

  const { data: colleges } = useQuery({
    queryKey: ['colleges'],
    queryFn: () => api.get('/users/colleges').then((r) => r.data),
  });

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
      navigate('/home');
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
          <h1 className="text-3xl font-display font-bold text-nb-black">
            <span className="inline-flex items-center gap-2">
              <Sparkles size={24} strokeWidth={2.5} className="text-nb-orange" /> Complete Your Profile
            </span>
          </h1>
          <p className="mt-2 font-body text-sm text-gray-500">
            Let people know where you study and what you're into
          </p>
        </div>

        <form onSubmit={handleSubmit} className="nb-card p-6 space-y-4">
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">College *</label>
            <select
              className="nb-input"
              value={formData.collegeId}
              onChange={(e) => setFormData((d) => ({ ...d, collegeId: e.target.value }))}
              required
            >
              <option value="">Select your college</option>
              {colleges?.map((c: any) => (
                <option key={c.id} value={c.id}>{c.shortName || c.name}</option>
              ))}
            </select>
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
                    formData.year === y ? 'bg-nb-orange text-white' : ''
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
            <label className="block font-display text-sm font-semibold mb-2">Avatar color</label>
            <div className="flex gap-2 flex-wrap">
              {['#FF6B35', '#FF69B4', '#FFD700', '#00D4AA', '#4B9CD3', '#9B59B6', '#2ECC71', '#FF4757', '#8C7AE6', '#FFA3DD'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFormData((d) => ({ ...d, avatarColor: c }))}
                  className={`w-7 h-7 rounded-full border-nb-2 transition-transform ${
                    formData.avatarColor === c ? 'border-nb-black scale-110' : 'border-transparent'
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
                      ? 'bg-nb-orange text-white'
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
    </div>
  );
}
