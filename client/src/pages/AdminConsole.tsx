import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck, LayoutDashboard, IdCard, Flag, Users, Newspaper,
  Check, X, Ban, Trash2, Search, GraduationCap, Inbox, ChevronDown,
} from 'lucide-react';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';
import { useAuthStore } from '@/store/auth.store';

type Tab = 'overview' | 'ids' | 'reports' | 'users' | 'content';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <LayoutDashboard size={15} /> },
  { key: 'ids', label: 'IDs', icon: <IdCard size={15} /> },
  { key: 'reports', label: 'Reports', icon: <Flag size={15} /> },
  { key: 'users', label: 'Users', icon: <Users size={15} /> },
  { key: 'content', label: 'Content', icon: <Newspaper size={15} /> },
];

/** One staffer, every campus they may touch: health overview, ID reviews,
 * report triage with one-click actions, user directory, content takedowns. */
export default function AdminConsole() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [collegeId, setCollegeId] = useState('');
  const isSuper = user?.role === 'super_admin';
  const isStaff = isSuper || user?.role === 'admin';

  const collegeParam = isSuper && collegeId ? `?collegeId=${collegeId}` : '';
  const withCollege = (path: string) =>
    path + (isSuper && collegeId ? `${path.includes('?') ? '&' : '?'}collegeId=${collegeId}` : '');

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-overview'] });
    queryClient.invalidateQueries({ queryKey: ['admin-ids'] });
    queryClient.invalidateQueries({ queryKey: ['admin-reports'] });
    queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    queryClient.invalidateQueries({ queryKey: ['admin-content'] });
  };

  if (!isStaff) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="nb-card p-8 text-center">
          <ShieldCheck size={36} className="mx-auto mb-3 text-nb-pink" />
          <h1 className="font-display font-bold text-xl mb-2">Moderators only</h1>
          <p className="text-sm opacity-70">This console is for college moderators and admins.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="w-11 h-11 bg-nb-violet/15 flex items-center justify-center shrink-0">
          <ShieldCheck size={22} className="text-nb-violet" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-bold">Moderator console</h1>
          <p className="text-sm opacity-60">
            {isSuper ? 'All colleges · pick one to narrow every tab' : `Your college · ${user?.college?.shortName || user?.college?.name || ''}`}
          </p>
        </div>
        {isSuper && (
          <label className="flex items-center gap-2 text-sm">
            <GraduationCap size={16} />
            <span className="relative inline-flex items-center">
              <select
                value={collegeId}
                onChange={(e) => { setCollegeId(e.target.value); invalidateAll(); }}
                className="nb-input pr-8 appearance-none text-sm max-w-[220px]"
                aria-label="Filter console to a college"
              >
                <option value="">All colleges</option>
                <CollegeOptions />
              </select>
              <ChevronDown size={14} className="absolute right-2 pointer-events-none" />
            </span>
          </label>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto mb-5 pb-1" role="tablist" aria-label="Moderator sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-display font-semibold border-2 border-ink shrink-0 transition-transform ${
              tab === t.key ? 'bg-ink text-white shadow-none translate-x-[2px] translate-y-[2px]' : 'bg-white shadow-[3px_3px_0px_0px_#0F172A] hover:-translate-y-0.5'
            }`}
          >
            {t.icon} {t.label}
            <TabBadge tab={t.key} collegeParam={collegeParam} />
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab collegeParam={collegeParam} onPickCollege={(id) => { setCollegeId(id); setTab('reports'); invalidateAll(); }} />}
      {tab === 'ids' && <IdsTab withCollege={withCollege} onDone={invalidateAll} />}
      {tab === 'reports' && <ReportsTab withCollege={withCollege} onDone={invalidateAll} />}
      {tab === 'users' && <UsersTab withCollege={withCollege} isSuper={isSuper} onDone={invalidateAll} />}
      {tab === 'content' && <ContentTab withCollege={withCollege} onDone={invalidateAll} />}
    </div>
  );
}

/** College options for the super-admin switcher (biggest colleges first). */
function CollegeOptions() {
  const { data } = useQuery({
    queryKey: ['admin-overview', ''],
    queryFn: () => api.get('/admin/overview').then((r) => r.data),
    staleTime: 60_000,
  });
  const biggest: any[] = data?.biggest || [];
  return (
    <>
      {biggest.map((c: any) => (
        <option key={c.id || 'none'} value={c.id || ''}>
          {c.shortName || c.name} ({c.users})
        </option>
      ))}
    </>
  );
}

/** Pending-count badges on the ID / Reports tabs. */
function TabBadge({ tab, collegeParam }: { tab: Tab; collegeParam: string }) {
  const { data } = useQuery({
    queryKey: ['admin-overview', collegeParam || 'all'],
    queryFn: () => api.get(`/admin/overview${collegeParam}`).then((r) => r.data),
    staleTime: 30_000,
  });
  const n = tab === 'ids' ? data?.totals?.pendingVerifications : tab === 'reports' ? data?.totals?.pendingReports : 0;
  if (!n) return null;
  return <span className="ml-1 min-w-[20px] h-5 px-1 text-[11px] font-bold bg-nb-pink text-white border border-current inline-flex items-center justify-center">{n}</span>;
}

/* ------------------------------- OVERVIEW ------------------------------- */

function OverviewTab({ collegeParam, onPickCollege }: { collegeParam: string; onPickCollege: (id: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-overview', collegeParam || 'all'],
    queryFn: () => api.get(`/admin/overview${collegeParam}`).then((r) => r.data),
  });
  if (isLoading) return <div className="p-10"><LoadingSpinner /></div>;
  const t = data?.totals || {};
  const cards = [
    { label: 'Users', value: t.users, sub: `${t.banned || 0} banned` },
    { label: 'Pending IDs', value: t.pendingVerifications, alert: (t.pendingVerifications || 0) > 0 },
    { label: 'Pending reports', value: t.pendingReports, alert: (t.pendingReports || 0) > 0 },
    { label: 'Posts', value: t.posts, sub: `${t.posts24h || 0} in 24h` },
    { label: 'Active matches', value: t.activeMatches },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {cards.map((c) => (
          <div key={c.label} className={`nb-card p-4 text-center ${c.alert ? 'border-nb-pink' : ''}`}>
            <p className={`font-display font-bold text-2xl ${c.alert ? 'text-nb-pink' : ''}`}>{c.value ?? 0}</p>
            <p className="text-xs font-semibold mt-1">{c.label}</p>
            {c.sub && <p className="text-[11px] opacity-60">{c.sub}</p>}
          </div>
        ))}
      </div>

      {(data?.colleges || []).map((c: any) => (
        <div key={c.id} className="nb-card p-4 mb-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[180px]">
            <p className="font-display font-bold">{c.shortName || c.name}</p>
            <p className="text-xs opacity-60">{c.users} users · {c.posts} posts · {c.activeMatches} matches</p>
          </div>
          {(c.needsAttention || 0) > 0 && (
            <span className="text-xs font-bold text-nb-pink">{c.needsAttention} need review</span>
          )}
        </div>
      ))}

      {(data?.attention?.verifications?.length || data?.attention?.reports?.length) ? (
        <div className="nb-card p-4 mb-3">
          <h2 className="font-display font-bold mb-3">Needs attention anywhere</h2>
          <div className="space-y-2 text-sm">
            {(data.attention.verifications || []).slice(0, 5).map((v: any) => (
              <p key={v.id}>🪪 <b>{v.user.displayName}</b> (@{v.user.username}) · {v.user.college?.shortName || v.user.college?.name}</p>
            ))}
            {(data.attention.reports || []).slice(0, 5).map((r: any) => (
              <p key={r.id}>🚩 {r.targetType} reported ({r.reason}) · {r.reporter.college?.shortName || r.reporter.college?.name}</p>
            ))}
          </div>
        </div>
      ) : null}

      {(data?.biggest || []).length > 0 && (
        <div className="nb-card p-4">
          <h2 className="font-display font-bold mb-3">Biggest colleges — tap to moderate</h2>
          <div className="flex flex-wrap gap-2">
            {(data.biggest || []).slice(0, 12).map((c: any) => (
              <button key={c.id || 'none'} onClick={() => c.id && onPickCollege(c.id)} className="nb-btn-ghost text-xs px-3 py-1.5" disabled={!c.id}>
                {c.shortName || c.name} · {c.users}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- IDs ---------------------------------- */

function IdsTab({ withCollege, onDone }: { withCollege: (p: string) => string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [imgs, setImgs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['admin-ids', withCollege('/verification/queue')],
    queryFn: () => api.get(withCollege('/verification/queue')).then((r) => r.data),
  });

  useQuery({
    queryKey: ['admin-id-images', (data?.items || []).map((i: any) => i.id).join(',')],
    enabled: !!data?.items?.length,
    queryFn: async () => {
      const entries: Record<string, string> = {};
      for (const item of data!.items) {
        try {
          const res = await api.get(item.imageUrl.replace('/api/', '/'), { responseType: 'blob' });
          entries[item.id] = URL.createObjectURL(res.data);
        } catch { /* already decided — card hides it */ }
      }
      setImgs(entries);
      return entries;
    },
  });

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => api.patch(`/verification/${id}/decide`, { approve }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-ids'] });
      onDone();
      setError('');
    },
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not save decision'),
  });

  if (isLoading) return <div className="p-10"><LoadingSpinner /></div>;
  const items = data?.items || [];
  return (
    <div>
      <p className="text-sm opacity-60 mb-4">{data?.total ?? 0} pending · photos are erased the moment you decide</p>
      {error && <p className="nb-card p-3 mb-4 text-sm">{error}</p>}
      {items.length === 0 ? (
        <EmptyState icon={<Inbox size={32} />} title="Queue is clear" description="No student IDs waiting for review." />
      ) : (
        <div className="space-y-4">
          {items.map((item: any) => (
            <div key={item.id} className="nb-card p-4 flex flex-col sm:flex-row gap-4">
              <div className="sm:w-52 shrink-0">
                {imgs[item.id]
                  ? <img src={imgs[item.id]} alt="Student ID" className="w-full object-contain max-h-40 bg-black/20" />
                  : <div className="w-full h-40 bg-black/20 flex items-center justify-center text-xs opacity-50 text-center px-2">Image unavailable — already decided</div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <Avatar name={item.user.displayName} photoId={item.user.avatarPhotoId || undefined} src={item.user.avatarUrl} color={null} size="sm" />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{item.user.displayName}</p>
                    <p className="text-xs opacity-60 truncate">@{item.user.username} · {item.user.college?.shortName || item.user.college?.name}</p>
                  </div>
                </div>
                <p className="text-xs opacity-60 mt-2">Submitted {new Date(item.submittedAt).toLocaleString()}</p>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => decide.mutate({ id: item.id, approve: true })} disabled={decide.isPending} className="nb-btn-primary flex-1 py-2 text-sm">
                    <Check size={16} className="inline mr-1" /> Verify
                  </button>
                  <button onClick={() => decide.mutate({ id: item.id, approve: false })} disabled={decide.isPending} className="nb-btn-ghost flex-1 py-2 text-sm">
                    <X size={16} className="inline mr-1" /> Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- REPORTS -------------------------------- */

function ReportsTab({ withCollege, onDone }: { withCollege: (p: string) => string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['admin-reports', withCollege(`/admin/reports?status=${status}`)],
    queryFn: () => api.get(withCollege(`/admin/reports${status ? `?status=${status}` : ''}`)).then((r) => r.data),
  });

  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.patch(`/admin/reports/${id}/resolve`, { action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-reports'] });
      onDone();
      setError('');
    },
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not resolve report'),
  });

  const act = (id: string, action: string, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    resolve.mutate({ id, action });
  };

  if (isLoading) return <div className="p-10"><LoadingSpinner /></div>;
  const items: any[] = Array.isArray(data) ? data : [];
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="nb-input text-sm max-w-[200px]" aria-label="Filter reports by status">
          <option value="">Pending + resolved</option>
          <option value="PENDING">Pending only</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        <p className="text-sm opacity-60">{items.length} reports</p>
      </div>
      {error && <p className="nb-card p-3 mb-4 text-sm">{error}</p>}
      {items.length === 0 ? (
        <EmptyState icon={<Inbox size={32} />} title="No reports" description="Nothing reported in scope." />
      ) : (
        <div className="space-y-3">
          {items.map((r: any) => (
            <div key={r.id} className={`nb-card p-4 ${r.status !== 'PENDING' ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-display font-bold px-2 py-0.5 border-2 border-ink text-xs">{r.targetType}</span>
                <span className="px-2 py-0.5 bg-nb-pink/15 text-xs font-semibold">{r.reason}</span>
                <span className="text-xs opacity-60">by @{r.reporter?.username} · {r.reporter?.college?.shortName || r.reporter?.college?.name || ''}</span>
                <span className="text-xs opacity-60 ml-auto">{new Date(r.createdAt).toLocaleString()}</span>
              </div>
              {r.description && <p className="text-sm mt-2">{r.description}</p>}
              <p className="text-xs opacity-60 mt-1 truncate">target: {r.targetId}</p>
              {r.status === 'PENDING' ? (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button onClick={() => act(r.id, 'dismiss')} disabled={resolve.isPending} className="nb-btn-ghost text-xs px-3 py-1.5">
                    <Check size={13} className="inline mr-1" /> Dismiss
                  </button>
                  {(r.targetType === 'POST' || r.targetType === 'COMMENT') && (
                    <button
                      onClick={() => act(r.id, 'delete_content', 'Take down this content? It disappears for everyone immediately.')}
                      disabled={resolve.isPending}
                      className="nb-btn-orange text-xs px-3 py-1.5"
                    >
                      <Trash2 size={13} className="inline mr-1" /> Delete content
                    </button>
                  )}
                  <button
                    onClick={() => act(r.id, 'ban_user', 'Ban this user? They lose access everywhere immediately (reversible in Users).')}
                    disabled={resolve.isPending}
                    className="nb-btn-danger text-xs px-3 py-1.5"
                  >
                    <Ban size={13} className="inline mr-1" /> Ban user
                  </button>
                </div>
              ) : (
                <p className="text-xs mt-2 opacity-60">Resolved {r.resolvedAt ? new Date(r.resolvedAt).toLocaleString() : ''}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- USERS --------------------------------- */

function UsersTab({ withCollege, isSuper, onDone }: { withCollege: (p: string) => string; isSuper: boolean; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  useState(() => undefined);
  const onSearch = (v: string) => {
    setQ(v);
    window.clearTimeout((onSearch as any)._t);
    (onSearch as any)._t = window.setTimeout(() => setDebounced(v), 400);
  };

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', withCollege(`/admin/users?q=${encodeURIComponent(debounced)}&filter=${filter}`)],
    queryFn: () => api.get(withCollege(`/admin/users${`?q=${encodeURIComponent(debounced)}${filter ? `&filter=${filter}` : ''}`}`)).then((r) => r.data),
  });

  const ban = useMutation({
    mutationFn: ({ id, banned }: { id: string; banned: boolean }) => api.post(`/admin/users/${id}/${banned ? 'unban' : 'ban'}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); onDone(); setError(''); },
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not update user'),
  });

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => api.patch(`/admin/users/${id}/role`, { role }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); onDone(); setError(''); },
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not change role'),
  });

  const users: any[] = data?.users || [];
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
          <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search name, @username, email…" className="nb-input pl-9 text-sm" aria-label="Search users" />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="nb-input text-sm max-w-[180px]" aria-label="Filter users">
          <option value="">Everyone</option>
          <option value="pending">ID pending</option>
          <option value="unverified">Unverified</option>
          <option value="banned">Banned</option>
          <option value="admins">Staff</option>
        </select>
      </div>
      {error && <p className="nb-card p-3 mb-4 text-sm">{error}</p>}
      {isLoading ? <div className="p-10"><LoadingSpinner /></div> : users.length === 0 ? (
        <EmptyState icon={<Users size={32} />} title="No users" description="Nobody matches this search in scope." />
      ) : (
        <div className="space-y-3">
          {users.map((u: any) => (
            <div key={u.id} className={`nb-card p-4 ${u.isActive ? '' : 'border-nb-pink'}`}>
              <div className="flex flex-wrap items-center gap-2.5">
                <Avatar name={u.displayName} src={null} color={null} size="sm" />
                <div className="flex-1 min-w-[160px]">
                  <p className="font-semibold text-sm truncate">{u.displayName} <span className="opacity-50 font-normal">@{u.username}</span></p>
                  <p className="text-xs opacity-60 truncate">{u.email} · {u.college?.shortName || u.college?.name || 'no college'} · {u._count?.posts || 0} posts</p>
                </div>
                <span className="text-[11px] font-bold px-2 py-0.5 border-2 border-ink">{u.role}</span>
                <span className={`text-[11px] font-bold px-2 py-0.5 border-2 border-ink ${u.isActive ? '' : 'bg-nb-pink text-white'}`}>
                  {u.isActive ? u.verificationStatus : 'BANNED'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {u.isActive ? (
                  <button
                    onClick={() => { if (window.confirm(`Ban @${u.username}? They lose access everywhere immediately.`)) ban.mutate({ id: u.id, banned: false }); }}
                    disabled={ban.isPending}
                    className="nb-btn-danger text-xs px-3 py-1.5"
                  >
                    <Ban size={13} className="inline mr-1" /> Ban
                  </button>
                ) : (
                  <button onClick={() => ban.mutate({ id: u.id, banned: true })} disabled={ban.isPending} className="nb-btn-primary text-xs px-3 py-1.5">
                    <Check size={13} className="inline mr-1" /> Unban
                  </button>
                )}
                {isSuper && u.role === 'user' && (
                  <button onClick={() => setRole.mutate({ id: u.id, role: 'admin' })} disabled={setRole.isPending} className="nb-btn-ghost text-xs px-3 py-1.5">
                    Make moderator
                  </button>
                )}
                {isSuper && u.role === 'admin' && (
                  <button onClick={() => setRole.mutate({ id: u.id, role: 'user' })} disabled={setRole.isPending} className="nb-btn-ghost text-xs px-3 py-1.5">
                    Remove moderator
                  </button>
                )}
              </div>
            </div>
          ))}
          <p className="text-xs opacity-60">{data?.total ?? 0} users in scope</p>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- CONTENT -------------------------------- */

function ContentTab({ withCollege, onDone }: { withCollege: (p: string) => string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState('post');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-content', withCollege(`/admin/content?type=${type}&q=${encodeURIComponent(q)}`)],
    queryFn: () => api.get(withCollege(`/admin/content?type=${type}${q ? `&q=${encodeURIComponent(q)}` : ''}`)).then((r) => r.data),
  });

  const remove = useMutation({
    mutationFn: (item: any) => api.delete(`/admin/content/${type}/${item.id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-content'] }); onDone(); setError(''); },
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not delete'),
  });

  const items: any[] = data?.items || [];
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex border-2 border-ink text-sm font-semibold">
          {(['post', 'comment'] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={`px-3 py-2 capitalize ${type === t ? 'bg-ink text-white' : 'bg-white'}`}>
              {t}s
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search content text…" className="nb-input pl-9 text-sm" aria-label="Search content" />
        </div>
      </div>
      {error && <p className="nb-card p-3 mb-4 text-sm">{error}</p>}
      {isLoading ? <div className="p-10"><LoadingSpinner /></div> : items.length === 0 ? (
        <EmptyState icon={<Newspaper size={32} />} title="Nothing here" description="No content matches in scope." />
      ) : (
        <div className="space-y-3">
          {items.map((item: any) => (
            <div key={item.id} className="nb-card p-4">
              <p className="text-sm whitespace-pre-wrap break-words">{item.content}</p>
              <p className="text-xs opacity-60 mt-2">
                @{item.author?.username} · {item.author?.college?.shortName || item.author?.college?.name || ''} · {new Date(item.createdAt).toLocaleString()}
                {type === 'post' ? ` · ${item._count?.likes || 0} likes · ${item._count?.comments || 0} comments` : ` · on post: ${(item.post?.content || '').slice(0, 60)}`}
              </p>
              <button
                onClick={() => { if (window.confirm('Take down this content? It disappears for everyone immediately.')) remove.mutate(item); }}
                disabled={remove.isPending}
                className="nb-btn-danger text-xs px-3 py-1.5 mt-3"
              >
                <Trash2 size={13} className="inline mr-1" /> Take down
              </button>
            </div>
          ))}
          <p className="text-xs opacity-60">{data?.total ?? 0} items in scope</p>
        </div>
      )}
    </div>
  );
}
