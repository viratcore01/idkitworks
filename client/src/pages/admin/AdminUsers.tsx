import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Ban, Search, Download, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import api from '@/services/api';
import { ScopeSelect, InitialAvatar, downloadCsv, useOpsScope } from './_shared';

/** User directory + full inspect file per user. */
export default function AdminUsers() {
  const { withCollege, collegeId, isSuper } = useOpsScope();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const inspectId = params.get('inspect');

  const onSearch = (v: string) => {
    setQ(v);
    window.clearTimeout((onSearch as any)._t);
    (onSearch as any)._t = window.setTimeout(() => setDebounced(v), 400);
  };

  const listPath = withCollege(`/admin/users?q=${encodeURIComponent(debounced)}${filter ? `&filter=${filter}` : ''}`);
  const { data, isLoading } = useQuery({
    queryKey: ['ops-users', listPath],
    queryFn: () => api.get(listPath).then((r) => r.data),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['ops-users'] });
    queryClient.invalidateQueries({ queryKey: ['ops-user-detail'] });
    setError('');
  };

  const ban = useMutation({
    mutationFn: ({ id, banned }: { id: string; banned: boolean }) => api.post(`/admin/users/${id}/${banned ? 'unban' : 'ban'}`),
    onSuccess: refresh,
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not update user'),
  });

  const setRole = useMutation({
    mutationFn: ({ id, role, collegeId }: { id: string; role: string; collegeId?: string }) =>
      api.patch(`/admin/users/${id}/role`, collegeId ? { role, collegeId } : { role }),
    onSuccess: refresh,
    onError: (e: any) => setError(e?.response?.data?.error || 'Could not change role'),
  });

  const closeInspect = () => {
    const next = new URLSearchParams(params);
    next.delete('inspect');
    setParams(next, { replace: true });
  };

  const users: any[] = data?.users || [];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <h1 className="font-display font-black text-2xl tracking-tight text-white">Users</h1>
          <p className="text-sm text-slate-400">{data?.total ?? 0} in scope · click anyone for their file</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ScopeSelect />
          <button
            onClick={() => downloadCsv('users.csv', users.map((u: any) => ({ id: u.id, username: u.username, email: u.email, role: u.role, verificationStatus: u.verificationStatus, isActive: u.isActive, college: u.college?.shortName || u.college?.name, posts: u._count?.posts, createdAt: u.createdAt })))}
            className="text-xs px-3 py-2 border border-white/20 text-slate-200 hover:border-[#FBBF24]"
            title="Export visible users to CSV"
          >
            <Download size={13} className="inline mr-1" /> CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search name, @username, email…" className="w-full bg-[#151D31] border border-white/20 pl-9 pr-3 py-2 text-sm outline-none focus:border-[#FBBF24] placeholder:text-slate-500" aria-label="Search users" />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-[#151D31] border border-white/20 px-3 py-2 text-sm outline-none focus:border-[#FBBF24]" aria-label="Filter users">
          <option value="">Everyone</option>
          <option value="pending">ID pending</option>
          <option value="unverified">Unverified</option>
          <option value="banned">Banned</option>
          <option value="admins">Staff</option>
        </select>
      </div>

      {error && <p className="bg-[#151D31] border border-[#F43F5E] text-[#F43F5E] p-3 mb-4 text-sm">{error}</p>}

      {isLoading ? <p className="text-slate-400 text-sm p-8">Searching…</p> : users.length === 0 ? (
        <p className="text-slate-400 text-sm bg-[#151D31] border border-white/10 p-8 text-center">Nobody matches in scope.</p>
      ) : (
        <div className="space-y-2">
          {users.map((u: any) => (
            <button
              key={u.id}
              onClick={() => { const next = new URLSearchParams(params); next.set('inspect', u.id); setParams(next, { replace: true }); }}
              className={`w-full text-left bg-[#151D31] border p-3.5 flex flex-wrap items-center gap-2.5 hover:border-[#FBBF24] ${u.isActive ? 'border-white/10' : 'border-[#F43F5E]'}`}
            >
              <InitialAvatar name={u.displayName} size="sm" />
              <span className="flex-1 min-w-[160px]">
                <span className="block font-semibold text-sm truncate text-white">{u.displayName} <span className="opacity-50 font-normal">@{u.username}</span></span>
                <span className="block text-xs text-slate-400 truncate">{u.college?.shortName || u.college?.name || 'no college'} · {u._count?.posts || 0} posts</span>
              </span>
              <span className="text-[11px] font-bold px-2 py-0.5 bg-white/10 text-slate-200">{u.role}</span>
              {u.role === 'admin' && (
                <span className="text-[11px] font-bold px-2 py-0.5 bg-[#6D28D9] text-white" title="Assigned moderation campus">
                  MOD → {u.moderatedCollege?.shortName || u.moderatedCollege?.name || u.college?.shortName || '?'}
                </span>
              )}
              <span className={`text-[11px] font-bold px-2 py-0.5 ${u.isActive ? 'bg-white/10 text-slate-200' : 'bg-[#F43F5E] text-white'}`}>
                {u.isActive ? u.verificationStatus : 'BANNED'}
              </span>
            </button>
          ))}
        </div>
      )}

      {inspectId && (
        <InspectDrawer
          id={inspectId}
          isSuper={isSuper}
          onClose={closeInspect}
          onBan={(banned) => ban.mutate({ id: inspectId, banned })}
          onRole={(role, collegeId) => setRole.mutate({ id: inspectId, role, collegeId })}
          busy={ban.isPending || setRole.isPending}
        />
      )}
    </div>
  );
}

/** Slide-over file: identity, standing, content, reports, verification trail. */
function InspectDrawer({ id, isSuper, onClose, onBan, onRole, busy }: {
  id: string; isSuper: boolean; onClose: () => void;
  onBan: (banned: boolean) => void; onRole: (role: string, collegeId?: string) => void; busy: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['ops-user-detail', id],
    queryFn: () => api.get(`/admin/users/${id}`).then((r) => r.data),
  });
  const u = data?.user;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label="User file">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-[#0B1120] border-l-2 border-[#FBBF24] overflow-y-auto p-5">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="font-display font-black text-lg text-white">User file</h2>
          <button onClick={onClose} className="ml-auto p-1.5 border border-white/20 text-slate-300 hover:border-white" aria-label="Close user file">
            <X size={16} />
          </button>
        </div>
        {isLoading || !u ? <p className="text-slate-400 text-sm">Loading file…</p> : (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-3">
              <InitialAvatar name={u.displayName} />
              <div className="min-w-0">
                <p className="font-bold text-white truncate">{u.displayName} <span className="font-normal opacity-50">@{u.username}</span></p>
                <p className="text-xs text-slate-400 truncate">{u.email}</p>
                <p className="text-xs text-slate-400">{u.college?.shortName || u.college?.name || 'no college'} · {u.role} · {u.isActive ? u.verificationStatus : 'BANNED'} · {data?.activeMatches || 0} matches</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {u.isActive ? (
                <button onClick={() => { if (window.confirm(`Ban @${u.username}?`)) onBan(false); }} disabled={busy} className="text-xs px-3 py-1.5 bg-[#F43F5E] text-white font-bold">
                  <Ban size={13} className="inline mr-1" /> Ban
                </button>
              ) : (
                <button onClick={() => onBan(true)} disabled={busy} className="text-xs px-3 py-1.5 bg-[#10B981] text-[#0F172A] font-bold">
                  <Check size={13} className="inline mr-1" /> Unban
                </button>
              )}
              {isSuper && u.role === 'user' && <AssignModerator user={u} onAssign={(collegeId) => onRole('admin', collegeId)} busy={busy} />}
              {isSuper && u.role === 'admin' && (
                <>
                  <AssignModerator user={u} reassign onAssign={(collegeId) => onRole('admin', collegeId)} busy={busy} />
                  <button onClick={() => { if (window.confirm(`Remove @${u.username} as moderator? They lose all moderation access.`)) onRole('user'); }} disabled={busy} className="text-xs px-3 py-1.5 border border-white/25 text-slate-200 font-bold">Remove moderator</button>
                </>
              )}
            </div>

            <Section title={`Recent posts (${u._count?.posts || 0})`}>
              {(data?.posts || []).length === 0 ? <p className="text-slate-500 text-xs">No live posts.</p> : data.posts.map((p: any) => (
                <p key={p.id} className="text-xs text-slate-300 border-l-2 border-white/15 pl-2 mb-2 break-words">
                  {p.content.slice(0, 160)} <span className="text-slate-500">· {p._count?.likes || 0}♥ {p._count?.comments || 0}💬</span>
                </p>
              ))}
            </Section>

            <Section title={`Reports against (${(data?.reportsAgainst || []).length})`}>
              {(data?.reportsAgainst || []).length === 0 ? <p className="text-slate-500 text-xs">None.</p> : data.reportsAgainst.map((r: any) => (
                <p key={r.id} className="text-xs text-slate-300 mb-1">🚩 {r.targetType} · {r.reason} · <b className={r.status === 'PENDING' ? 'text-[#FBBF24]' : 'text-slate-500'}>{r.status}</b> · @{r.reporter?.username}</p>
              ))}
            </Section>

            <Section title="Verification trail">
              {(data?.verifications || []).length === 0 ? <p className="text-slate-500 text-xs">Never submitted an ID.</p> : data.verifications.map((v: any) => (
                <p key={v.id} className="text-xs text-slate-300 mb-1">{v.status} · {v.decidedBy || 'pending'} {v.decidedAt ? `· ${new Date(v.decidedAt).toLocaleDateString()}` : ''}</p>
              ))}
            </Section>

            <p className="text-[11px] text-slate-500 font-mono break-all">id: {u.id}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-widest text-slate-500 font-bold mb-2">{title}</h3>
      {children}
    </div>
  );
}

/**
 * Appoint-a-moderator: pick WHICH campus they rule. Defaults to the campus
 * they study in; the supreme admin may hand them any campus instead. That
 * campus — and only that campus — becomes their entire moderation world.
 */
function AssignModerator({ user, reassign, onAssign, busy }: {
  user: any; reassign?: boolean; onAssign: (collegeId: string) => void; busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string; shortName?: string | null } | null>(null);

  const { data } = useQuery({
    queryKey: ['ops-college-pick', q],
    queryFn: () => api.get(`/colleges?q=${encodeURIComponent(q)}&limit=8`).then((r) => r.data),
    enabled: open,
  });
  const options: any[] = Array.isArray(data) ? data : data?.colleges || [];

  const confirm = () => {
    const id = picked?.id || user.collegeId;
    if (!id) return;
    onAssign(id);
    setOpen(false);
    setPicked(null);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} disabled={busy} className="text-xs px-3 py-1.5 bg-[#6D28D9] text-white font-bold">
        {reassign ? 'Reassign campus' : 'Make moderator'}
      </button>
    );
  }
  return (
    <div className="w-full bg-black/30 border border-[#6D28D9] p-3 space-y-2">
      <p className="text-xs text-slate-300">
        {reassign ? `Move @${user.username}'s rule to…` : `Appoint @${user.username} as moderator of…`}
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search colleges…"
        className="w-full bg-[#0B1120] border border-white/20 px-2.5 py-1.5 text-xs outline-none focus:border-[#FBBF24] placeholder:text-slate-600"
        aria-label="Search colleges to assign"
      />
      <div className="max-h-32 overflow-y-auto space-y-1">
        {user.collegeId && (
          <button onClick={() => setPicked({ id: user.collegeId, name: 'Their own campus' })} className={`w-full text-left text-xs px-2 py-1.5 border ${picked?.id === user.collegeId ? 'border-[#FBBF24] text-white' : 'border-white/15 text-slate-300'}`}>
            Their own campus (default)
          </button>
        )}
        {options.filter((c: any) => c.id !== user.collegeId).map((c: any) => (
          <button key={c.id} onClick={() => setPicked(c)} className={`w-full text-left text-xs px-2 py-1.5 border ${picked?.id === c.id ? 'border-[#FBBF24] text-white' : 'border-white/15 text-slate-300'}`}>
            {c.shortName || c.name}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={confirm} disabled={busy || (!picked && !user.collegeId)} className="text-xs px-3 py-1.5 bg-[#FBBF24] text-[#0F172A] font-bold disabled:opacity-50">
          Confirm{picked ? `: ${picked.shortName || picked.name}` : ''}
        </button>
        <button onClick={() => { setOpen(false); setPicked(null); }} className="text-xs px-3 py-1.5 border border-white/25 text-slate-300">Cancel</button>
      </div>
    </div>
  );
}
