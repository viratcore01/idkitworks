import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Save, Hourglass, LogOut, BadgeCheck, ShieldCheck, KeyRound, UserX } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { user, logout, updateProfile, changePassword, deactivateAccount } = useAuthStore();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [isSaving, setIsSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPw, setIsChangingPw] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

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

  const handleChangePassword = async () => {
  if (newPassword.length < 6) {
  toast.error('New password must be at least 6 characters');
  return;
  }
  setIsChangingPw(true);
  try {
  await changePassword(currentPassword, newPassword);
  toast.success('Password changed — please log in again');
  navigate('/login');
  } catch (e: any) {
  toast.error(e?.response?.data?.error || 'Failed to change password');
  } finally {
  setIsChangingPw(false);
  }
  };

  const handleDeactivate = async () => {
  if (!confirmDeactivate) {
  setConfirmDeactivate(true);
  return;
  }
  try {
  await deactivateAccount();
  toast.success('Account deactivated');
  navigate('/login');
  } catch {
  toast.error('Failed to deactivate account');
  setConfirmDeactivate(false);
  }
  };

 return (
 <div>
 <h1 className="font-display font-bold text-2xl text-ink mb-6 flex items-center gap-2">
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
 <BadgeCheck size={18} className="text-nb-violet" /> Verified student of {user.college?.shortName || user.college?.name || 'your college'}
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
  <div className="nb-card p-6 border-nb-pink">
  <h2 className="font-display font-bold text-lg text-nb-pink mb-4">Danger Zone</h2>
  <div className="flex flex-wrap gap-3">
  <button onClick={handleLogout} className="nb-btn-danger text-sm inline-flex items-center gap-1.5">
  <LogOut size={14} strokeWidth={2.5} /> Logout
  </button>
  <button
  onClick={handleDeactivate}
  className="nb-btn-ghost text-sm inline-flex items-center gap-1.5"
  aria-label={confirmDeactivate ? 'Confirm account deactivation' : 'Deactivate account'}
  >
  <UserX size={14} strokeWidth={2.5} />
  {confirmDeactivate ? 'Click again to confirm deactivation' : 'Deactivate account'}
  </button>
  </div>
  {confirmDeactivate && (
  <p className="text-sm mt-3 opacity-70">Deactivation locks you out immediately on all devices. Your posts stay for safety review.</p>
  )}
  </div>

  {/* Change Password */}
  <div className="nb-card p-6 mb-4">
  <h2 className="font-display font-bold text-lg mb-4 flex items-center gap-2">
  <KeyRound size={18} strokeWidth={2.5} /> Change Password
  </h2>
  <div className="space-y-4">
  <div>
  <label htmlFor="current-password" className="block font-display text-sm font-semibold mb-1.5">Current password</label>
  <input
  id="current-password"
  type="password"
  autoComplete="current-password"
  className="nb-input"
  value={currentPassword}
  onChange={(e) => setCurrentPassword(e.target.value)}
  />
  </div>
  <div>
  <label htmlFor="new-password" className="block font-display text-sm font-semibold mb-1.5">New password</label>
  <input
  id="new-password"
  type="password"
  autoComplete="new-password"
  className="nb-input"
  value={newPassword}
  onChange={(e) => setNewPassword(e.target.value)}
  />
  </div>
  <button
  onClick={handleChangePassword}
  disabled={isChangingPw || !currentPassword || !newPassword}
  className="nb-btn-orange text-sm disabled:opacity-50"
  >
  {isChangingPw ? 'Changing...' : 'Change password (logs out all devices)'}
  </button>
  </div>
  </div>
  </div>
  );
}
