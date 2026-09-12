import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import api from '@/services/api';
import Avatar from '@/components/common/Avatar';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { formatDistanceToNow } from '@/utils/date';
import { useAuthStore } from '@/store/auth.store';

export default function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { user } = useAuthStore();
  const [message, setMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => api.get(`/messages/${conversationId}`).then((r) => r.data),
    refetchInterval: 5000,
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post(`/messages/${conversationId}`, { content: message }),
    onSuccess: () => {
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages]);

  const messages = data?.messages || [];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {isLoading ? (
          <LoadingSpinner />
        ) : (
          messages.map((msg: any) => {
            const isMe = msg.senderId === user?.id;
            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] nb-card px-4 py-2.5 ${
                    isMe ? 'bg-nb-orange text-white' : 'bg-white'
                  }`}
                >
                  <p className="font-body text-sm">{msg.content}</p>
                  <p className={`text-[10px] mt-1 ${isMe ? 'text-white/60' : 'text-gray-400'}`}>
                    {formatDistanceToNow(msg.createdAt)}
                  </p>
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
