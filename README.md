# ⚡ SKOLA — Student Social Network

A student-only social network where students can scroll posts, interact, discover people, find matches, post confessions, and switch into anonymous/Incognito mode.

## 🏗️ Tech Stack

| Layer | Tech |
|-------|------|
| **Frontend** | React, Vite, TypeScript, Tailwind CSS, React Router |
| **Backend** | Node.js, Express, TypeScript |
| **Database** | PostgreSQL + Prisma ORM |
| **Auth** | JWT + Refresh Tokens |
| **State** | Zustand + TanStack Query |
| **Realtime** | Socket.IO |

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL running locally

### 1. Setup Environment
```bash
cp .env.example .env
# Edit .env with your PostgreSQL credentials
```

### 2. Install Dependencies
```bash
npm install
cd server && npm install
cd ../client && npm install
```

### 3. Setup Database
```bash
# Generate Prisma client
cd server && npx prisma generate --schema=../prisma/schema.prisma

# Push schema to database
npx prisma db push --schema=../prisma/schema.prisma

# Seed colleges and interests
cd .. && npm run db:seed
```

### 4. Start Development
```bash
npm run dev
```
This runs both client (http://localhost:5173) and server (http://localhost:5000).

## 📁 Project Structure

```
student-network/
├── client/          # React + Vite frontend
│   └── src/
│       ├── components/  # UI components (auth, feed, layout, etc.)
│       ├── pages/       # Route pages
│       ├── store/       # Zustand state
│       ├── services/    # API client
│       └── types/       # TypeScript types
├── server/          # Express + TypeScript backend
│   └── src/
│       ├── config/      # Env, Prisma client
│       ├── controllers/ # HTTP handlers
│       ├── middleware/   # Auth middleware
│       ├── routes/      # API routes
│       ├── services/    # Business logic
│       └── utils/       # JWT, password helpers
├── prisma/          # Schema + seed
│   ├── schema.prisma
│   └── seed.ts
└── .env.example
```

## 🎯 Features (V1)

### ✅ Auth
- Multi-step signup (email → name → college → profile)
- Login with JWT + refresh tokens
- Profile setup flow

### ✅ Feed
- Create posts (text, media)
- Like/unlike posts
- Comment on posts
- Infinite scroll with cursor pagination
- Post visibility (Public / College-only)

### ✅ Incognito Mode
- Toggle incognito in the topbar
- Posts & comments are anonymous when incognito is on
- Confessions section (always anonymous)

### ✅ Matching
- Discover students
- Like/Pass mechanism
- Mutual match detection
- Match preferences

### ✅ Social
- User profiles with interests
- Search (people, posts, colleges)
- Notifications (likes, comments, matches, messages)
- Direct messaging
- Block users

### ✅ Moderation
- Report system (posts, comments, users, messages)
- Admin dashboard
- Ban/warn users

## 🎨 Design

**Neobrutalism** — bold, playful, unapologetic.

- Thick black borders (3px)
- Solid shadows (4px 4px 0px)
- Bright accent colors: Orange, Pink, Cyan, Yellow, Purple
- Cream (#FFF8EE) background
- Space Grotesk (headings) + DM Sans (body) fonts
- Responsive: desktop sidebar + mobile bottom nav

## 📡 API Routes

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/auth` | POST signup, login, refresh, logout; GET/PATCH me | Authentication |
| `/api/users` | GET profile, posts; POST block | User management |
| `/api/posts` | GET feed, POST create, PATCH/DELETE | Posts CRUD |
| `/api/posts/:id/like` | POST toggle | Like/unlike |
| `/api/posts/:id/comments` | GET, POST | Comments |
| `/api/search` | GET | Search people, posts, colleges |
| `/api/notifications` | GET, PATCH read | Notifications |
| `/api/matches` | GET discover/matches, POST like/pass | Matching |
| `/api/messages` | GET conversations, POST conversation/message | Messaging |
| `/api/admin` | Reports, moderation, stats | Admin |
