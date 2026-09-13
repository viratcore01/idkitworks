import { Post, Match, Conversation, Notification, SearchResults } from '@/types';

const NOW = new Date().toISOString();
const HOURS_AGO = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
const MINS_AGO = (m: number) => new Date(Date.now() - m * 60000).toISOString();

export const MOCK_POSTS: Post[] = [
  {
    id: 'p1',
    authorId: 'u2',
    content: "Who else is excited for the college fest next week? 🎉 The lineup looks insane this year!",
    mediaUrl: null,
    mediaType: 'NONE',
    type: 'NORMAL',
    visibility: 'PUBLIC',
    isAnonymous: false,
    isLikedByMe: true,
    createdAt: HOURS_AGO(1),
    updatedAt: HOURS_AGO(1),
    author: { id: 'u2', username: 'priya_sharma', displayName: 'Priya Sharma', avatarUrl: null, college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null }, course: 'ECE', year: 3 },
    _count: { comments: 12, likes: 47 },
  },
  {
    id: 'p2',
    authorId: 'u3',
    content: "Built a full-stack app this weekend using React + Node + PostgreSQL 💻\n\nHere's what I learned:\n1. Prisma is amazing for ORM\n2. Tailwind saves so much time\n3. Sleep is optional\n\nDrop your weekend projects below! 👇",
    mediaUrl: null,
    mediaType: 'NONE',
    type: 'NORMAL',
    visibility: 'PUBLIC',
    isAnonymous: false,
    isLikedByMe: false,
    createdAt: HOURS_AGO(3),
    updatedAt: HOURS_AGO(3),
    author: { id: 'u3', username: 'arnav_dev', displayName: 'Arnav Gupta', avatarUrl: null, college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null }, course: 'CSE', year: 2 },
    _count: { comments: 8, likes: 34 },
  },
  {
    id: 'p3',
    authorId: 'anon',
    content: "Is it just me or does the canteen food get worse every semester? 🍛💀",
    mediaUrl: null,
    mediaType: 'NONE',
    type: 'NORMAL',
    visibility: 'PUBLIC',
    isAnonymous: true,
    isLikedByMe: false,
    createdAt: HOURS_AGO(5),
    updatedAt: HOURS_AGO(5),
    author: { id: 'anon', username: 'anon', displayName: 'Anonymous', avatarUrl: null },
    _count: { comments: 23, likes: 89 },
  },
  {
    id: 'p4',
    authorId: 'u4',
    content: "Looking for a guitarist for our band 🎸 We're playing at the upcoming fest. DM if interested!",
    mediaUrl: null,
    mediaType: 'NONE',
    type: 'NORMAL',
    visibility: 'PUBLIC',
    isAnonymous: false,
    isLikedByMe: false,
    createdAt: HOURS_AGO(8),
    updatedAt: HOURS_AGO(8),
    author: { id: 'u4', username: 'vivek_music', displayName: 'Vivek Verma', avatarUrl: null, college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null }, course: 'IT', year: 3 },
    _count: { comments: 5, likes: 21 },
  },
  {
    id: 'p5',
    authorId: 'u5',
    content: "Tip for all 1st years: Start using GitHub from day one. Your future self will thank you. 🐙\n\nHere's a beginner guide I made:",
    mediaUrl: null,
    mediaType: 'NONE',
    type: 'NORMAL',
    visibility: 'PUBLIC',
    isAnonymous: false,
    isLikedByMe: true,
    createdAt: HOURS_AGO(12),
    updatedAt: HOURS_AGO(12),
    author: { id: 'u5', username: 'ishita_codes', displayName: 'Ishita Singh', avatarUrl: null, college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null }, course: 'CSE', year: 4 },
    _count: { comments: 15, likes: 72 },
  },
  {
    id: 'p_conf1',
    authorId: 'anon',
    content: "I have a massive crush on someone from my section but I'm too scared to say anything 😳",
    mediaUrl: null,
    mediaType: 'NONE',
    type: 'CONFESSION',
    visibility: 'PUBLIC',
    isAnonymous: true,
    isLikedByMe: false,
    createdAt: HOURS_AGO(2),
    updatedAt: HOURS_AGO(2),
    author: { id: 'anon', username: 'anon', displayName: 'Anonymous', avatarUrl: null },
    _count: { comments: 31, likes: 56 },
  },
  {
    id: 'p_conf2',
    authorId: 'anon',
    content: "Whoever keeps playing music at 2AM in hostel block C — I respect you but also please stop 😭",
    mediaUrl: null,
    mediaType: 'NONE',
    type: 'CONFESSION',
    visibility: 'PUBLIC',
    isAnonymous: true,
    isLikedByMe: true,
    createdAt: HOURS_AGO(6),
    updatedAt: HOURS_AGO(6),
    author: { id: 'anon', username: 'anon', displayName: 'Anonymous', avatarUrl: null },
    _count: { comments: 18, likes: 94 },
  },
  {
    id: 'p6',
    authorId: 'u6',
    content: "Study group forming for semester exams 📚 We meet in the library every evening 5-8pm. All branches welcome!",
    mediaUrl: null,
    mediaType: 'NONE',
    type: 'NORMAL',
    visibility: 'PUBLIC',
    isAnonymous: false,
    isLikedByMe: false,
    createdAt: HOURS_AGO(16),
    updatedAt: HOURS_AGO(16),
    author: { id: 'u6', username: 'rohit_study', displayName: 'Rohit Kumar', avatarUrl: null, college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null }, course: 'ECE', year: 2 },
    _count: { comments: 7, likes: 28 },
  },
];

export const MOCK_MATCH_USERS = [
  {
    id: 'm1', username: 'ananya_art', displayName: 'Ananya Reddy', avatarUrl: null,
    college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null },
    course: 'CSE', year: 2, bio: 'Designer by day, coder by night 🎨💻',
    interests: [{ id: 'i1', name: 'Art & Design', category: 'Creative' }, { id: 'i2', name: 'Coding', category: 'Tech' }],
  },
  {
    id: 'm2', username: 'karan_fit', displayName: 'Karan Patel', avatarUrl: null,
    college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null },
    course: 'ME', year: 3, bio: 'Fitness enthusiast 🏋️ Football player ⚽',
    interests: [{ id: 'i3', name: 'Gym & Fitness', category: 'Health' }, { id: 'i4', name: 'Football', category: 'Sports' }],
  },
  {
    id: 'm3', username: 'neha_writes', displayName: 'Neha Joshi', avatarUrl: null,
    college: { id: 'c2', name: 'DTU', shortName: 'DTU', city: 'New Delhi', state: 'Delhi', logoUrl: null },
    course: 'ECE', year: 2, bio: 'Aspiring writer ✍️ Bookworm 📚',
    interests: [{ id: 'i5', name: 'Writing', category: 'Creative' }, { id: 'i6', name: 'Movies & TV', category: 'Entertainment' }],
  },
  {
    id: 'm4', username: 'raj_gamer', displayName: 'Raj Malhotra', avatarUrl: null,
    college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null },
    course: 'CSE', year: 1, bio: 'FPS games > everything 🎮',
    interests: [{ id: 'i7', name: 'Gaming', category: 'Entertainment' }, { id: 'i8', name: 'Anime', category: 'Entertainment' }],
  },
];

export const MOCK_MATCHES: Match[] = [
  {
    id: 'match1',
    partner: { id: 'u7', username: 'sneha_travels', displayName: 'Sneha Agarwal', avatarUrl: null, bio: 'Wanderlust 🌍 | Photographer 📸' },
    type: 'DATING',
    createdAt: HOURS_AGO(24),
  },
];

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 'conv1',
    otherUser: { id: 'u7', username: 'sneha_travels', displayName: 'Sneha Agarwal', avatarUrl: null },
    lastMessage: { content: 'Hey! Saw you like travel too! Where was your last trip?', senderId: 'u7', createdAt: HOURS_AGO(2) },
    updatedAt: HOURS_AGO(2),
  },
];

export const MOCK_NOTIFICATIONS: Notification[] = [
  { id: 'n1', recipientId: 'mock-001', actorId: 'u2', type: 'LIKE', postId: 'p1', commentId: null, matchId: null, isRead: false, createdAt: MINS_AGO(15), actor: { id: 'u2', username: 'priya_sharma', displayName: 'Priya Sharma', avatarUrl: null } },
  { id: 'n2', recipientId: 'mock-001', actorId: 'u3', type: 'COMMENT', postId: 'p2', commentId: 'c1', matchId: null, isRead: false, createdAt: MINS_AGO(45), actor: { id: 'u3', username: 'arnav_dev', displayName: 'Arnav Gupta', avatarUrl: null } },
  { id: 'n3', recipientId: 'mock-001', actorId: 'u7', type: 'MATCH', postId: null, commentId: null, matchId: 'match1', isRead: true, createdAt: HOURS_AGO(24), actor: { id: 'u7', username: 'sneha_travels', displayName: 'Sneha Agarwal', avatarUrl: null } },
  { id: 'n4', recipientId: 'mock-001', actorId: 'u5', type: 'LIKE', postId: 'p5', commentId: null, matchId: null, isRead: true, createdAt: HOURS_AGO(25), actor: { id: 'u5', username: 'ishita_codes', displayName: 'Ishita Singh', avatarUrl: null } },
];

export const MOCK_SEARCH: SearchResults = {
  users: [
    { id: 'u2', email: '', username: 'priya_sharma', displayName: 'Priya Sharma', avatarUrl: null, bio: 'ECE student', college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null }, course: 'ECE', year: 3, isVerified: false, verificationStatus: 'VERIFIED' as const, interests: [] },
    { id: 'u3', email: '', username: 'arnav_dev', displayName: 'Arnav Gupta', avatarUrl: null, bio: 'Full-stack developer', college: { id: 'c1', name: 'IPEC', shortName: 'IPEC', city: 'Ghaziabad', state: 'UP', logoUrl: null }, course: 'CSE', year: 2, isVerified: false, verificationStatus: 'VERIFIED' as const, interests: [] },
  ],
  posts: MOCK_POSTS.slice(0, 2),
  colleges: [
    { id: 'c1', name: 'Institute of Professional Education and Communication', shortName: 'IPEC', city: 'Ghaziabad', state: 'Uttar Pradesh', logoUrl: null },
  ],
};
