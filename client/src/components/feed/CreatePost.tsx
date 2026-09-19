import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ghost, Zap, FileText } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/services/api';
import toast from 'react-hot-toast';

const POST_TYPES = [
  { value: 'NORMAL', label: 'Post', icon: Zap },
  { value: 'CONFESSION', label: 'Confess', icon: Ghost },
  { value: 'QUESTION', label: 'Question', icon: FileText },
] as const;

type PostType = (typeof POST_TYPES)[number]['value'];

interface Props {
  type?: PostType;
}

export default function CreatePost({ type: initialType = 'NORMAL' }: Props) {
  const [content, setContent] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [type, setType] = useState<PostType>(initialType);
 const { user, isIncognito } = useAuthStore();
 const queryClient = useQueryClient();

 const effectiveAnonymous = type === 'CONFESSION' ? true : isIncognito || isAnonymous;

 const mutation = useMutation({
 mutationFn: () =>
 api.post('/posts', {
 content,
 type,
 isAnonymous: effectiveAnonymous,
 }),
 onSuccess: () => {
 setContent('');
 setIsAnonymous(false);
 queryClient.invalidateQueries({ queryKey: ['feed'] });
 // Anonymous posts surface on your own profile (owner-only section).
 queryClient.invalidateQueries({ queryKey: ['anonymous-posts'] });
 queryClient.invalidateQueries({ queryKey: ['profile-posts'] });
 toast.success(type === 'CONFESSION' ? 'Confession posted!' : 'Posted!');
 },
 onError: () => toast.error('Failed to post'),
 });

 const handleSubmit = () => {
 if (!content.trim()) return;
 mutation.mutate();
 };

return (
  <div className="nb-card p-4 mb-4 animate-slide-up">
  <div className="flex flex-col gap-3">
    {/* Type selector */}
    <div className="flex gap-2 overflow-x-auto pb-1">
      {POST_TYPES.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => setType(t.value as PostType)}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-nb-2 font-display text-xs font-bold transition-colors ${
            type === t.value ? 'bg-ink text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
          }`}
        >
          <t.icon size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />
          {t.label}
        </button>
      ))}
    </div>

    <div className="flex gap-3">
 {!effectiveAnonymous && (
 <div className="w-10 h-10 bg-nb-violet border-nb-2 border-ink flex items-center justify-center text-white font-bold text-sm shrink-0">
 {user?.displayName?.[0]?.toUpperCase() || '?'}
 </div>
 )}
 {effectiveAnonymous && (
 <div className="w-10 h-10 bg-nb-lilac border-nb-2 border-ink flex items-center justify-center text-white shrink-0">
 <Ghost size={20} strokeWidth={2.5} />
 </div>
 )}

 <div className="flex-1">
 <textarea
 className="w-full border-nb-2 border-ink p-3 font-body text-sm resize-none focus:outline-none focus:ring-2 focus:ring-nb-violet min-h-[80px] bg-white"
placeholder={
    type === 'CONFESSION'
      ? 'Confess something anonymously...'
      : type === 'QUESTION'
      ? 'Ask a question...'
      : effectiveAnonymous
      ? 'Posting anonymously...'
      : "What's happening?"
  }
 value={content}
 onChange={(e) => setContent(e.target.value)}
 />

 <div className="flex items-center justify-between mt-3">
 <div className="flex items-center gap-2">
 {type !== 'CONFESSION' && (
 <button
 onClick={() => setIsAnonymous(!isAnonymous)}
 className={`nb-badge cursor-pointer transition-all ${
 effectiveAnonymous ? 'bg-nb-lilac text-ink' : 'bg-gray-100'
 }`}
 >
 <Ghost size={12} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />
 Anonymous
 </button>
 )}
 {effectiveAnonymous && (
 <span className="text-xs font-body text-nb-violet font-semibold inline-flex items-center gap-1">
 <Ghost size={12} strokeWidth={2.5} /> Posting as Anonymous Student
 </span>
 )}
 </div>

 <button
 onClick={handleSubmit}
 disabled={!content.trim() || mutation.isPending}
 className="nb-btn-orange text-sm px-4 py-1.5 disabled:opacity-50"
 >
 {mutation.isPending ? (
 '...'
 ) : type === 'CONFESSION' ? (
 <><Ghost size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Confess</>
 ) : (
 <><Zap size={14} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />Post</>
 )}
 </button>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
}
