import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, Save, Hourglass, LogOut, BadgeCheck, ShieldCheck, KeyRound } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import PasswordInput from '@/components/common/PasswordInput';
import GoogleButton from '@/components/common/GoogleButton';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { user, logout, updateProfile, changePassword, setPasswordViaGoogle, deleteAccount } = useAuthStore();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [isSaving, setIsSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPw, setIsChangingPw] = useState(false);
  // Google-only accounts have no password to change — they SET their first
  // one, authorized by a fresh Google verification (not the current-password
  // field, which they could never fill).
  const isGoogleOnly = user?.hasGoogle === true && user?.hasPassword === false;
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [setPw, setSetPw] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

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
  if (newPassword.length < 8) {
  toast.error('New password must be at least 8 characters');
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

  const handleSetPassword = async () => {
  if (!googleToken) {
  toast.error('Verify with Google first');
  return;
  }
  if (setPw.length < 8) {
  toast.error('New password must be at least 8 characters');
  return;
  }
  setIsChangingPw(true);
  try {
  await setPasswordViaGoogle(googleToken, setPw);
  toast.success('Password set — please log in again');
  navigate('/login');
  } catch (e: any) {
  // Fresh again, instantly: drop the spent token so the Google button comes
  // straight back. Otherwise a wrong-account verification (server 403) would
  // leave "Google verified" on screen with every retry doomed — stuck until
  // a manual page reload. The typed password is kept; only proof re-runs.
  setGoogleToken(null);
  toast.error(e?.response?.data?.error || 'Failed to set password');
  } finally {
  setIsChangingPw(false);
  }
  };

  const handleDelete = async () => {
  if (deleteConfirm.trim().toUpperCase() !== 'DELETE') {
  toast.error('Type DELETE to confirm');
  return;
  }
  setIsDeleting(true);
  try {
  await deleteAccount();
  toast.success('Account permanently deleted');
  navigate('/login');
  } catch (e: any) {
  toast.error(e?.response?.data?.error || 'Failed to delete account');
  } finally {
  setIsDeleting(false);
  }
  };

 return (
 <div>
 <h1 className="font-display font-bold text-2xl text-ink mb-6 flex items-center gap-2">
 <Settings size={22} strokeWidth={2.5} /> Settings
 </h1>

  {/* Edit Profile */}
  <div className="nb-card p-4 sm:p-6 mb-4 min-w-0">
  <h2 className="font-display font-bold text-lg mb-4">Edit Profile</h2>
  <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
  <div>
  <label htmlFor="settings-displayname" className="block font-display text-sm font-semibold mb-1.5">Display Name</label>
  <input
  id="settings-displayname"
  type="text"
  className="nb-input"
  value={displayName}
  onChange={(e) => setDisplayName(e.target.value)}
  autoComplete="name"
  required
  />
  </div>
  <div>
  <label htmlFor="settings-bio" className="block font-display text-sm font-semibold mb-1.5">Bio</label>
  <textarea
  id="settings-bio"
  className="nb-input min-h-[80px] resize-none"
  value={bio}
  onChange={(e) => setBio(e.target.value)}
  />
  </div>
  <button
  type="submit"
  disabled={isSaving}
  aria-busy={isSaving}
  className="nb-btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
  >
 {isSaving ? (
 <><Hourglass size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Saving...</>
 ) : (
 <><Save size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Save Changes</>
  )}
  </button>
  </form>
  </div>

  {/* Account Info */}
  <div className="nb-card p-4 sm:p-6 mb-4 min-w-0">
  <h2 className="font-display font-bold text-lg mb-4">Account</h2>
  <div className="space-y-2 text-sm font-body">
  <p><span className="font-semibold">Email:</span> {user?.email}</p>
  <p><span className="font-semibold">Username:</span> @{user?.username}</p>
  {user?.isFounder && (
  <p><span className="font-semibold">Rank:</span> <span className="nb-badge bg-nb-violet text-white text-xs px-2 py-0.5"><span aria-hidden="true">👑 </span>Founder — supreme admin</span></p>
  )}
  {user?.role === 'admin' && (
  <p><span className="font-semibold">Moderates:</span> {user?.moderatedCollegeId ? 'assigned campus (see console)' : (user?.college?.shortName || user?.college?.name || 'your campus')}</p>
  )}
  </div>
  </div>

  {/* Student verification */}
  <div className="nb-card p-4 sm:p-6 mb-4 min-w-0">
  <h2 className="font-display font-bold text-lg mb-4 flex items-center gap-2">Student Verification</h2>
  {user?.verificationStatus === 'VERIFIED' ? (
  <div>
  <p className="text-sm flex items-center gap-2">
  <BadgeCheck size={18} className="text-nb-violet" /> Verified student of {user.college?.shortName || user.college?.name || 'your college'}
  </p>
  {user?.collegeEmail && (
  <p className="text-xs text-gray-500 mt-1">College email {user.collegeEmail} is locked to this account.</p>
  )}
  </div>
  ) : (
  <div>
  <p className="text-sm text-gray-600 mb-3">
  Verify with a code sent to your college email to unlock matching and chat.
  </p>
  <button onClick={() => navigate('/verify')} className="nb-btn-primary text-sm">Verify now</button>
  </div>
  )}
  {(user?.role === 'admin' || user?.role === 'super_admin') && (
  <button onClick={() => navigate('/admin')} className="nb-btn-ghost text-sm mt-4 w-full">
  <ShieldCheck size={16} className="inline mr-1.5" /> Open moderator console
  </button>
  )}
 </div>

  {/* Danger Zone */}
  <div className="nb-card p-4 sm:p-6 border-nb-pink min-w-0">
  <h2 className="font-display font-bold text-lg text-nb-pink mb-4">Danger Zone</h2>
  <div className="flex flex-wrap gap-3">
  <button onClick={handleLogout} className="nb-btn-danger text-sm inline-flex items-center gap-1.5">
  <LogOut size={14} strokeWidth={2.5} /> Logout
  </button>
  </div>
  {user?.isFounder && (
  <p className="text-sm mt-3 text-gray-600"><span aria-hidden="true">👑 </span>The founder account cannot be deleted — the network always has its creator.</p>
  )}
  {!user?.isFounder && (
  <div className="mt-4 pt-4 border-t-2 border-dashed border-nb-pink/40">
  {!showDelete ? (
  <button
  onClick={() => setShowDelete(true)}
  className="text-sm font-semibold text-nb-pink underline underline-offset-2"
  >
  Delete my account permanently…
  </button>
  ) : (
  <div>
  <p className="text-sm font-semibold mb-1">This permanently deletes your profile, photos, posts, messages, matches and likes. This cannot be undone.</p>
  <p className="text-sm text-gray-600 mb-3">Type <span className="font-bold">DELETE</span> to confirm:</p>
  <div className="flex flex-wrap gap-2">
  <input
  type="text"
  aria-label="Type DELETE to confirm account deletion"
  placeholder="DELETE"
  className="nb-input max-w-[180px]"
  value={deleteConfirm}
  onChange={(e) => setDeleteConfirm(e.target.value)}
  />
  <button
  onClick={handleDelete}
  disabled={isDeleting || deleteConfirm.trim().toUpperCase() !== 'DELETE'}
  className="nb-btn-danger text-sm disabled:opacity-50"
  >
  {isDeleting ? 'Deleting…' : 'Delete forever'}
  </button>
  <button
  onClick={() => { setShowDelete(false); setDeleteConfirm(''); }}
  className="nb-btn-ghost text-sm"
  >
  Keep my account
  </button>
  </div>
  </div>
  )}
  </div>
  )}
  </div>

  {/* Password: Google-only accounts SET their first password (verified by
  fresh Google ownership) instead of changing one they never had. */}
  {isGoogleOnly ? (
  <div className="nb-card p-4 sm:p-6 mb-4 min-w-0">
  <h2 className="font-display font-bold text-lg mb-4 flex items-center gap-2">
  <KeyRound size={18} strokeWidth={2.5} /> Set a password
  </h2>
  <p className="text-sm text-gray-600 mb-4">
  You signed up with Google, so there's no password on this account yet. Verify with Google, then choose one — it becomes a backup way to log in.
  </p>
  <div className="space-y-4">
  {!googleToken ? (
  <GoogleButton
  mode="verify"
  onCredential={async (token) => {
  setGoogleToken(token);
  toast.success('Google verified — now choose your password');
  }}
  />
  ) : (
  <div className="flex items-center justify-between gap-2">
  <p className="text-sm font-semibold text-nb-violet">Google verified — now choose your password.</p>
  <button onClick={() => setGoogleToken(null)} className="text-xs font-body text-gray-500 underline underline-offset-2 shrink-0">
  Wrong account?
  </button>
  </div>
  )}
  <div>
  <label htmlFor="set-password" className="block font-display text-sm font-semibold mb-1.5">New password (min 8 characters)</label>
  <PasswordInput
  id="set-password"
  value={setPw}
  onChange={setSetPw}
  autoComplete="new-password"
  required
  minLength={8}
  placeholder="Min 8 characters"
  />
  </div>
  <button
  onClick={handleSetPassword}
  disabled={isChangingPw || !googleToken || !setPw}
  aria-busy={isChangingPw}
  className="nb-btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
  >
  {isChangingPw ? 'Setting...' : 'Set password (logs out all devices)'}
  </button>
  </div>
  </div>
  ) : (
  <div className="nb-card p-4 sm:p-6 mb-4 min-w-0">
  <h2 className="font-display font-bold text-lg mb-4 flex items-center gap-2">
  <KeyRound size={18} strokeWidth={2.5} /> Change Password
  </h2>
  <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleChangePassword(); }}>
  <div>
  <label htmlFor="current-password" className="block font-display text-sm font-semibold mb-1.5">Current password</label>
  <PasswordInput
  id="current-password"
  value={currentPassword}
  onChange={setCurrentPassword}
  autoComplete="current-password"
  required
  placeholder="Current password"
  />
  </div>
  <div>
  <label htmlFor="new-password" className="block font-display text-sm font-semibold mb-1.5">New password (min 8 characters)</label>
  <PasswordInput
  id="new-password"
  value={newPassword}
  onChange={setNewPassword}
  autoComplete="new-password"
  required
  minLength={8}
  placeholder="Min 8 characters"
  />
  </div>
  <button
  type="submit"
  disabled={isChangingPw || !currentPassword || !newPassword}
  aria-busy={isChangingPw}
  className="nb-btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
  >
  {isChangingPw ? 'Changing...' : 'Change password (logs out all devices)'}
  </button>
  </form>
  </div>
  )}
  </div>
  );
}
