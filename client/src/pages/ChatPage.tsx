import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Zap, MoreVertical, Pencil, Trash2, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { getSocket, joinConversation } from '@/services/realtime';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { formatDistanceToNow } from '@/utils/date';
import { useAuthStore } from '@/store/auth.store';

/** "Today" / "Yesterday" / "12 Aug 2026" separators, WhatsApp-style. */
function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { user } = useAuthStore();
  const [message, setMessage] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => api.get(`/messages/${conversationId}`).then((r) => r.data),
    refetchInterval: 5000,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  }, [queryClient, conversationId]);

  const sendMutation = useMutation({
    mutationFn: () => api.post(`/messages/${conversationId}`, { content: message }),
    onSuccess: () => {
      setMessage('');
      invalidate();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not send — check your connection'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.patch(`/messages/${conversationId}/messages/${id}`, { content }),
    onSuccess: () => {
      setEditingId(null);
      setEditText('');
      invalidate();
    },
    onError: (e: any) => toast(e.response?.data?.error || 'Could not edit message'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/messages/${conversationId}/messages/${id}`),
    onSuccess: invalidate,
    onError: (e: any) => toast(e.response?.data?.error || 'Could not delete message'),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages?.length]);

  // Realtime: join the room, merge incoming messages instantly. Polling above
  // stays as the safety net for edits/deletes and any missed event.
  useEffect(() => {
    if (!conversationId) return;
    joinConversation(conversationId);
    const socket = getSocket();
    if (!socket) return;
    const onNew = (msg: any) => {
      if (msg?.conversationId && msg.conversationId !== conversationId) return;
      queryClient.setQueryData(['messages', conversationId], (old: any) => {
        if (!old?.messages?.some((m: any) => m.id === msg.id)) {
          return { ...old, messages: [...(old?.messages || []), msg] };
        }
        return old;
      });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };
    const onUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };
    socket.on('new-message', onNew);
    socket.on('message-updated', onUpdated);
    return () => {
      socket.off('new-message', onNew);
      socket.off('message-updated', onUpdated);
    };
  }, [conversationId, queryClient]);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  // Close the 3-dot menu on any outside click
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuFor]);

  const messages: any[] = data?.messages || [];

  const startEdit = (msg: any) => {
    setEditingId(msg.id);
    setEditText(msg.content);
    setMenuFor(null);
  };

  const saveEdit = () => {
    if (editingId && editText.trim() && editText !== messages.find((m) => m.id === editingId)?.content) {
      editMutation.mutate({ id: editingId, content: editText.trim() });
    } else {
      setEditingId(null);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-12rem)] min-h-[420px]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-1 pb-4 min-h-0">
        {isLoading ? (
          <LoadingSpinner />
        ) : (
          messages.map((msg: any, i: number) => {
            const isMe = msg.senderId === user?.id;
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(msg.createdAt).toDateString();
            const isEditing = editingId === msg.id;
            const isDeleted = !!msg.isDeleted;
            const canEdit = isMe && !isDeleted && Date.now() - new Date(msg.createdAt).getTime() < EDIT_WINDOW_MS;

            return (
              <div key={msg.id}>
                {newDay && (
                  <div className="flex justify-center my-3">
                    <span className="nb-badge bg-white text-nb-black text-[10px] font-semibold">
                      {dayLabel(new Date(msg.createdAt))}
                    </span>
                  </div>
                )}
                <div className={`group flex items-center gap-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                  {isMe && !isDeleted && !isEditing && (
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor(menuFor === msg.id ? null : msg.id);
                        }}
                        className="opacity-60 group-hover:opacity-100 focus:opacity-100 text-gray-700 hover:text-nb-black p-1 transition-opacity"
                        title="Message options"
                      >
                        <MoreVertical size={14} strokeWidth={2.5} />
                      </button>
                      {menuFor === msg.id && (
                        <div
                          className="absolute right-0 bottom-8 z-20 nb-card bg-white py-1 min-w-[140px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {canEdit && (
                            <button
                              onClick={() => startEdit(msg)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm font-body hover:bg-nb-lime/30 text-left"
                            >
                              <Pencil size={14} strokeWidth={2.5} /> Edit
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setMenuFor(null);
                              deleteMutation.mutate(msg.id);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-body hover:bg-nb-red/20 text-nb-red text-left"
                          >
                            <Trash2 size={14} strokeWidth={2.5} /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <div
                    className={`max-w-[75%] nb-card px-4 py-2.5 ${
                      isDeleted ? 'bg-gray-100 border-dashed opacity-70' : isMe ? 'bg-nb-orange text-white' : 'bg-white'
                    }`}
                  >
                    {isEditing ? (
                      <div className="flex items-center gap-2 min-w-[220px]">
                        <input
                          ref={editInputRef}
                          className="nb-input text-sm py-1 flex-1 !bg-white !text-nb-black"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <button onClick={saveEdit} title="Save" className="text-nb-black hover:scale-110 transition-transform">
                          <Check size={16} strokeWidth={2.5} />
                        </button>
                        <button onClick={() => setEditingId(null)} title="Cancel" className="text-gray-400 hover:text-nb-red transition-colors">
                          <X size={16} strokeWidth={2.5} />
                        </button>
                      </div>
                    ) : isDeleted ? (
                      <p className="font-body text-sm italic text-gray-500">This message was deleted</p>
                    ) : (
                      <>
                        <p className="font-body text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                        <p className={`text-[10px] mt-1 flex items-center gap-1 ${isMe ? 'text-white/90' : 'text-gray-500'}`}>
                          {timeLabel(new Date(msg.createdAt))}
                          {msg.editedAt && <span className="italic">· edited</span>}
                        </p>
                      </>
                    )}
                  </div>
                  {!isMe && (
                    <Avatar src={msg.sender?.avatarUrl} photoId={msg.sender?.avatarPhotoId} name={msg.sender?.displayName} size="sm" className="!w-6 !h-6 !text-[10px] shrink-0 self-end opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t-nb border-nb-black pt-3">
        <div className="flex gap-2">
          <input
            type="text"
            className="nb-input flex-1"
            placeholder="Type a message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && message.trim()) sendMutation.mutate();
            }}
          />
          <button
            onClick={() => {
              if (message.trim()) sendMutation.mutate();
            }}
            disabled={!message.trim()}
            className="nb-btn-orange disabled:opacity-50"
          >
            <Zap size={18} strokeWidth={2.5} fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  );
}
