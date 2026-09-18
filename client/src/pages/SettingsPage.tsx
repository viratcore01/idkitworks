import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Save, Hourglass, LogOut, BadgeCheck, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { user, logout, updateProfile } = useAuthStore();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateProfile({ displayName, bio });
      toast.success('Profile updated!');
    } catch {
      toast.error('Failed to update');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div>
      <h1 className="font-display font-bold text-2xl text-nb-black mb-6 flex items-center gap-2">
        <Settings size={22} strokeWidth={2.5} /> Settings
      </h1>

      {/* Edit Profile */}
      <div className="nb-card p-6 mb-4">
        <h2 className="font-display font-bold text-lg mb-4">Edit Profile</h2>
        <div className="space-y-4">
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">Display Name</label>
            <input
              type="text"
              className="nb-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div>
            <label className="block font-display text-sm font-semibold mb-1.5">Bio</label>
            <textarea
              className="nb-input min-h-[80px] resize-none"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="nb-btn-orange text-sm disabled:opacity-50"
          >
            {isSaving ? (
              <><Hourglass size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Saving...</>
            ) : (
              <><Save size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Save Changes</>
            )}
          </button>
        </div>
      </div>

      {/* Account Info */}
      <div className="nb-card p-6 mb-4">
        <h2 className="font-display font-bold text-lg mb-4">Account</h2>
        <div className="space-y-2 text-sm font-body">
          <p><span className="font-semibold">Email:</span> {user?.email}</p>
          <p><span className="font-semibold">Username:</span> @{user?.username}</p>
        </div>
      </div>

      {/* Student verification */}
      <div className="nb-card p-6 mb-4">
        <h2 className="font-display font-bold text-lg mb-4 flex items-center gap-2">Student Verification</h2>
        {user?.verificationStatus === 'VERIFIED' ? (
          <p className="text-sm flex items-center gap-2">
            <BadgeCheck size={18} className="text-nb-orange" /> Verified student of {user.college?.shortName || user.college?.name || 'your college'}
          </p>
        ) : (
          <div>
            <p className="text-sm opacity-70 mb-3">
              {user?.verificationStatus === 'PENDING'
                ? 'Your ID is in review — a moderator will confirm it shortly.'
                : 'Verify your college ID to unlock matching and chat.'}
            </p>
            <button onClick={() => navigate('/verify')} className="nb-btn-orange text-sm">Verify now</button>
          </div>
        )}
        {(user?.role === 'admin' || user?.role === 'super_admin') && (
          <button onClick={() => navigate('/admin/verify')} className="nb-btn-ghost text-sm mt-4 w-full">
            <ShieldCheck size={16} className="inline mr-1.5" /> Open ID review queue
          </button>
        )}
      </div>

      {/* Danger Zone */}
      <div className="nb-card p-6 border-nb-red">
        <h2 className="font-display font-bold text-lg text-nb-red mb-4">Danger Zone</h2>
        <button onClick={handleLogout} className="nb-btn-danger text-sm inline-flex items-center gap-1.5">
          <LogOut size={14} strokeWidth={2.5} /> Logout
        </button>
      </div>
    </div>
  );
}
