import { Ghost, Megaphone, FileText, HelpCircle, type LucideIcon } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import toast from 'react-hot-toast';

type PostType = 'NORMAL' | 'CONFESSION' | 'QUESTION';

interface Props {
  /** The active feed tab decides what the composer creates — no picker needed. */
  type?: PostType;
}

const TYPE_META: Record<PostType, { label: string; icon: LucideIcon; toast: string }> = {
  NORMAL: { label: 'Post', icon: Megaphone, toast: 'Posted!' },
  CONFESSION: { label: 'Confession', icon: Ghost, toast: 'Confession posted!' },
  QUESTION: { label: 'Question', icon: FileText, toast: 'Question posted!' },
};

export default function CreatePost({ type = 'NORMAL' }: Props) {
  const [content, setContent] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const { user, isIncognito } = useAuthStore();
  const queryClient = useQueryClient();

  // Tab = composer type. If the user typed something under one tab and
  // switches to another, the draft stays but the new tab's rules apply.
  useEffect(() => {
    if (type !== 'CONFESSION') setIsAnonymous(false);
  }, [type]);

  const meta = TYPE_META[type];
  const Icon = meta.icon;

  // Anonymous BY DEFAULT on the Confessions tab, but the toggle is available —
  // a confession can go out under your name if you choose. (Incognito mode
  // forces it regardless.)
  const [confessionAnon, setConfessionAnon] = useState(true);
  const effectiveAnonymous = type === 'CONFESSION' ? confessionAnon || isIncognito : isIncognito || isAnonymous;

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
      toast.success(meta.toast);
    },
    onError: () => toast.error('Failed to post'),
  });

  const handleSubmit = () => {
    if (!content.trim()) return;
    mutation.mutate();
  };

  return (
    <div className="nb-card p-3 sm:p-4 mb-3 sm:mb-4 animate-slide-up min-w-0 overflow-hidden">
      <div className="flex flex-col gap-3 min-w-0">
        {/* Context line — shows which section you're posting into */}
        <div className="flex items-center gap-1.5 text-xs font-display font-bold text-gray-500 flex-wrap min-w-0">
          <Icon size={14} strokeWidth={2.5} className="text-ink" />
          Posting a {meta.label.toLowerCase()}
          {type === 'QUESTION' && (
            <span className="nb-badge bg-nb-yellow text-ink text-[10px]">
              <HelpCircle size={10} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />
              goes to Questions
            </span>
          )}
        </div>

        <div className="flex gap-2.5 sm:gap-3 min-w-0">
          {!effectiveAnonymous && (
            <Avatar
              src={user?.avatarUrl}
              photoId={user?.avatarPhotoId}
              name={user?.displayName || '?'}
              size="sm"
            />
          )}
          {effectiveAnonymous && (
            <div className="w-10 h-10 bg-nb-lilac border-nb-2 border-ink flex items-center justify-center text-white shrink-0">
              <Ghost size={20} strokeWidth={2.5} />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <textarea
              className="w-full border-nb-2 border-ink p-3 font-body text-base sm:text-sm resize-none focus:outline-none focus:ring-2 focus:ring-nb-violet min-h-[80px] max-h-[40vh] bg-white"
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

            <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <button
                  onClick={() => (type === 'CONFESSION' ? setConfessionAnon(!confessionAnon) : setIsAnonymous(!isAnonymous))}
                  className={`nb-badge cursor-pointer transition-all ${
                    effectiveAnonymous ? 'bg-nb-lilac text-ink' : 'bg-gray-100'
                  }`}
                  title={
                    type === 'CONFESSION'
                      ? 'Confessions are anonymous by default — click to post under your name'
                      : undefined
                  }
                >
                  <Ghost size={12} strokeWidth={2.5} className="inline mr-1 -mt-0.5" />
                  Anonymous
                </button>
                {effectiveAnonymous && (
                  <span className="text-xs font-body text-nb-violet font-semibold hidden min-[400px]:inline-flex items-center gap-1 truncate">
                    <Ghost size={12} strokeWidth={2.5} /> Posting as Anonymous
                  </span>
                )}
              </div>

              <button
                onClick={handleSubmit}
                disabled={!content.trim() || mutation.isPending}
                className="nb-btn-orange text-sm px-4 py-1.5 disabled:opacity-50 inline-flex items-center gap-1"
              >
                {mutation.isPending ? (
                  '...'
                ) : (
                  <>
                    <Icon size={14} strokeWidth={2.5} />
                    {type === 'CONFESSION' ? 'Confess' : type === 'QUESTION' ? 'Ask' : 'Post'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
