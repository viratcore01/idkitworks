export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarPhotoId?: string | null;
  avatarColor?: string | null;
  photos?: { id: string; slot: number }[];
  bio: string | null;
  college: College | null;
  course: string | null;
  year: number | null;
  isVerified: boolean;
  verificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  role?: string;
  interests: Interest[];
  postCount?: number;
  createdAt?: string;
}

export interface College {
  id: string;
  name: string;
  shortName: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
}

export interface Interest {
  id: string;
  name: string;
  category: string | null;
}

export interface Post {
  id: string;
  /** PRIVACY: masked to 'anonymous' by the server when isAnonymous — never a real user id. */
  authorId: string;
  content: string;
  mediaUrl: string | null;
  mediaType: 'IMAGE' | 'VIDEO' | 'NONE';
  type: 'NORMAL' | 'CONFESSION' | 'POLL' | 'QUESTION';
  visibility: 'PUBLIC' | 'COLLEGE_ONLY';
  isAnonymous: boolean;
  isLikedByMe?: boolean;
  isSavedByMe?: boolean;
  /** Viewer is the author — enables delete in the ⋯ menu. Computed server-side. */
  isMine?: boolean;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    avatarPhotoId?: string | null;
    avatarColor?: string | null;
    college?: College | null;
    course?: string | null;
    year?: number | null;
  };
  _count: {
    comments: number;
    likes: number;
  };
  /** Newest top-level comments, attached to feed posts for inline previews */
  topComments?: Comment[];
}

export interface Comment {
  id: string;
  postId: string;
  /** PRIVACY: masked to 'anonymous' by the server when isAnonymous — never a real user id. */
  authorId: string;
  parentCommentId?: string | null;
  content: string;
  isAnonymous: boolean;
  createdAt: string;
  editedAt?: string | null;
  isDeleted?: boolean;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    avatarPhotoId?: string | null;
    avatarColor?: string | null;
  } | null;
  _count?: { replies: number };
  /** Viewer is the author — enables edit/delete. Computed server-side (authorId is masked on anonymous comments). */
  isMine?: boolean;
}

export interface Match {
  id: string;
  partner: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    avatarPhotoId?: string | null;
    avatarColor?: string | null;
    bio: string | null;
  };
  type: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  otherUser: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    avatarPhotoId?: string | null;
    avatarColor?: string | null;
  } | null;
  lastMessage: {
    content: string;
    senderId: string;
    createdAt: string;
  } | null;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  mediaUrl: string | null;
  createdAt: string;
  editedAt?: string | null;
  isDeleted?: boolean;
  sender: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    avatarPhotoId?: string | null;
    avatarColor?: string | null;
  };
}

export interface Notification {
  id: string;
  recipientId: string;
  actorId: string | null;
  type: string;
  postId: string | null;
  commentId: string | null;
  matchId: string | null;
  isRead: boolean;
  createdAt: string;
  actor: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    avatarPhotoId?: string | null;
    avatarColor?: string | null;
  } | null;
}

export interface PaginatedResponse<T> {
  nextCursor: string | null;
  [key: string]: any;
}

export interface FeedResponse extends PaginatedResponse<any> {
  posts: Post[];
}

export interface SearchResults {
  users: User[];
  posts: Post[];
  colleges: College[];
}
