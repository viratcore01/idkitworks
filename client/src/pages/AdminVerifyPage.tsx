import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, X, Check, Inbox, GraduationCap } from 'lucide-react';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import EmptyState from '@/components/common/EmptyState';

interface QueueItem {
 id: string;
 user: { id: string; username: string; displayName: string; avatarUrl: string | null; avatarPhotoId?: string | null; college?: { name: string; shortName?: string } | null };
 submittedAt: string;
 autoNote?: string | null;
 imageUrl: string;
}

/** College-scoped review queue: moderators confirm or reject student IDs. */
export default function AdminVerifyPage() {
 const queryClient = useQueryClient();
 const [imgUrls, setImgUrls] = useState<Record<string, string>>({});
 const [error, setError] = useState('');

 const { data, isLoading } = useQuery({
 queryKey: ['verify-queue'],
 queryFn: async () => (await api.get('/verification/queue')).data as { total: number; items: QueueItem[] },
 });

 // Load each ID image as an authenticated blob URL (never raw GETs — admin only)
 useQuery({
 queryKey: ['verify-images', data?.items?.map((i) => i.id).join(',')],
 enabled: !!data?.items?.length,
 queryFn: async () => {
 const entries: Record<string, string> = {};
 for (const item of data!.items) {
 try {
 const res = await api.get(item.imageUrl.replace('/api/', '/'), { responseType: 'blob' });
 entries[item.id] = URL.createObjectURL(res.data);
 } catch { /* image may already be resolved — card just hides it */ }
 }
 setImgUrls(entries);
 return entries;
 },
 });

 const decide = useMutation({
 mutationFn: async ({ id, approve }: { id: string; approve: boolean }) =>
 api.patch(`/verification/${id}/decide`, { approve }),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ['verify-queue'] });
 setError('');
 },
 onError: (e: any) => setError(e?.response?.data?.error || 'Could not save decision'),
 });

 if (isLoading) return <div className="p-10"><LoadingSpinner /></div>;

 const items = data?.items || [];

 return (
 <div className="max-w-3xl mx-auto p-4 sm:p-6">
 <div className="flex items-center gap-3 mb-6">
 <div className="w-11 h-11 bg-nb-violet/15 flex items-center justify-center shrink-0">
 <GraduationCap size={22} className="text-nb-violet" />
 </div>
 <div>
 <h1 className="font-display text-xl font-bold">Student ID review</h1>
 <p className="text-sm opacity-60">{data?.total ?? 0} pending in your college · photos are deleted after every decision</p>
 </div>
 </div>

 {error && <p className="nb-card p-3 mb-4 text-sm text-nb-violet">{error}</p>}

 {items.length === 0 ? (
 <EmptyState
 icon={<Inbox size={32} />}
 title="Queue is clear"
 description="No student IDs waiting for review right now."
 />
 ) : (
 <div className="space-y-4">
 {items.map((item) => (
 <div key={item.id} className="nb-card p-4 flex flex-col sm:flex-row gap-4">
 <div className="sm:w-52 shrink-0">
 {imgUrls[item.id]
 ? <img src={imgUrls[item.id]} alt="Student ID" className="w-full object-contain max-h-40 bg-black/20" />
 : <div className="w-full h-40 bg-black/20 flex items-center justify-center text-xs opacity-50 px-2 text-center">Image unavailable — it was already decided</div>}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2.5">
 <Avatar
 name={item.user.displayName}
 photoId={item.user.avatarPhotoId || undefined}
 src={item.user.avatarUrl}
 color={null}
 size="sm"
 />
 <div className="min-w-0">
 <p className="font-semibold text-sm truncate">{item.user.displayName}</p>
 <p className="text-xs opacity-60 truncate">@{item.user.username} · {item.user.college?.shortName || item.user.college?.name}</p>
 </div>
 </div>
 <p className="text-xs opacity-60 mt-2">Submitted {new Date(item.submittedAt).toLocaleString()}</p>
 {item.autoNote && <p className="text-xs italic opacity-70 mt-1">Auto-check: “{item.autoNote}”</p>}
 <div className="flex gap-2 mt-3">
 <button
 onClick={() => decide.mutate({ id: item.id, approve: true })}
 disabled={decide.isPending}
 className="nb-btn-primary flex-1 py-2 text-sm"
 >
 <Check size={16} className="inline mr-1" /> Verify
 </button>
 <button
 onClick={() => decide.mutate({ id: item.id, approve: false })}
 disabled={decide.isPending}
 className="nb-btn-ghost flex-1 py-2 text-sm"
 >
 <X size={16} className="inline mr-1" /> Reject
 </button>
 </div>
 </div>
 </div>
 ))}
 </div>
 )}

 <p className="text-xs opacity-50 mt-6 flex items-center gap-1.5">
 <ShieldCheck size={14} /> Decisions are final — the ID image is erased the moment you decide.
 </p>
 </div>
 );
}
