import { useEffect, useRef, useState } from 'react';
import {
 Zap,
 Newspaper,
 Flame,
 MessagesSquare,
 BadgeCheck,
 Search,
 Bell,
 ShieldCheck,
 Lock,
 EyeOff,
 Check,
 X,
 ThumbsUp,
 MessageCircle,
 Bookmark,
 GraduationCap,
 UserPlus,
 PartyPopper,
 Gauge,
 ArrowRight,
 ArrowUp,
 ChevronDown,
 Send,
 Heart,
 Menu,
 Mail,
 Copy,
 Users,
 Target,
 Gift,
 Sparkles,
} from 'lucide-react';
import Logo from '@/components/common/Logo';
import toast from 'react-hot-toast';

/* ── Company constants — the single source of truth for every link ─────── */
const APP_URL = 'https://idkitworks.vercel.app';
const LOGIN_URL = `${APP_URL}/login`;
const SIGNUP_URL = `${APP_URL}/login`;
/** The one and only company contact — used everywhere, no other channels. */
const CONTACT_EMAIL = 'idkitworks01@gmail.com';

/** Build a prefilled mailto: link — professional, one-tap outreach. */
const mailto = (subject: string, body?: string) =>
 `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}${
 body ? `&body=${encodeURIComponent(body)}` : ''
 }`;

type ContactType = 'college' | 'moderator' | 'build' | 'plain';

/** Every outreach flow shares one inbox; the modal pre-fills these. */
const CONTACT_DATA: Record<ContactType, { title: string; blurb: string; subject: string; body: string }> = {
 college: {
 title: 'Add your college',
 blurb: 'Tell us about your campus — every request is reviewed by hand.',
 subject: 'Add my college to Zoclo',
 body: 'Hi Zoclo team,\n\nI would like to bring Zoclo to my college.\n\nCollege name:\nCity / State:\nApprox. number of students:\nMy role in the college:\n\nThanks!',
 },
 moderator: {
 title: 'Become a moderator',
 blurb: 'Run the verification queue and keep your campus community safe.',
 subject: 'Moderator application — Zoclo',
 body: 'Hi Zoclo team,\n\nI would like to moderate my college community.\n\nCollege:\nYear & course:\nWhy me:\n\nThanks!',
 },
 build: {
 title: 'Help build Zoclo',
 blurb: 'Design, building, ideas, or spreading the word — all of it counts.',
 subject: 'I want to help build Zoclo',
 body: 'Hi Zoclo team,\n\nI want to help build Zoclo.\n\nName:\nWhat I would love to help with (design / building / spreading the word / ideas):\n\nThanks!',
 },
 plain: {
 title: 'Contact Zoclo',
 blurb: 'One inbox for everything — questions, onboarding, safety, press.',
 subject: 'Hello Zoclo team',
 body: 'Hi Zoclo team,\n\n',
 },
};

/** Clipboard with a fallback for webviews that block the async API. */
async function copyToClipboard(text: string, successMsg: string) {
 try {
 await navigator.clipboard.writeText(text);
 toast.success(successMsg);
 } catch {
 try {
 const ta = document.createElement('textarea');
 ta.value = text;
 ta.style.position = 'fixed';
 ta.style.opacity = '0';
 document.body.appendChild(ta);
 ta.focus();
 ta.select();
 document.execCommand('copy');
 ta.remove();
 toast.success(successMsg);
 } catch {
 toast.error('Copy blocked — long-press the text to copy');
 }
 }
}

/* Anchors scroll smoothly below the sticky topbar */
const NAV_LINKS = [
 { label: 'Features', href: '#features' },
 { label: 'The Rule', href: '#rule' },
 { label: 'How it works', href: '#how' },
 { label: 'Why Zoclo', href: '#why' },
 { label: 'FAQ', href: '#faq' },
];

/** Every auth CTA on this page: real <a> → new tab, opener isolated. */
function NewTabLink({
 href,
 className,
 children,
 ariaLabel,
}: {
 href: string;
 className: string;
 children: React.ReactNode;
 ariaLabel: string;
}) {
 return (
 <a href={href} target="_blank" rel="noopener noreferrer" className={className} aria-label={ariaLabel}>
 {children}
 </a>
 );
}

/* ───────────────────────────────────────────────────────────────────────────
 Content
 ──────────────────────────────────────────────────────────────────────── */
const BIG_FEATURES = [
 {
 icon: Newspaper,
 chip: 'bg-nb-yellow',
 title: 'Community Feed',
 body: 'Posts, polls and anonymous confessions with Reddit-style threaded comments. Top replies preview right on the card — optimistic likes, infinite scroll, zero alumni.',
 footer: 'NORMAL · CONFESSION · POLL · QUESTION',
 },
 {
 icon: Flame,
 chip: 'bg-nb-pink',
 title: 'Campus Dating',
 body: 'A swipe deck scoped to your campus and nothing else. Gender & age preferences, passes that resurface after 30 days, and atomic mutual matching — no double-swipe glitches, ever.',
 footer: 'LIKE · PASS · MATCH',
 },
 {
 icon: MessagesSquare,
 chip: 'bg-nb-peri',
 title: 'Real-Time Chat',
 body: 'Conversations unlock only after you match. Live delivery over sockets, WhatsApp-style 15-minute edit window, and delete-tombstones everyone sees.',
 footer: 'SOCKETS · 15-MIN EDITS · TOMBSTONES',
 },
];

const MINI_FEATURES = [
 {
 icon: BadgeCheck,
 chip: 'bg-nb-yellow',
 title: 'Mod-verified students',
 body: 'Every student ID is reviewed by college moderators before anyone gets past the gate.',
 },
 {
 icon: Search,
 chip: 'bg-nb-peri',
 title: 'Hyperlocal search',
 body: 'People and posts from your college only — anonymous authors stay masked.',
 },
 {
 icon: Bell,
 chip: 'bg-nb-lilac',
 title: 'Live notifications',
 body: 'Likes, replies, matches and messages — from same-college people only.',
 },
 {
 icon: ShieldCheck,
 chip: 'bg-nb-mint',
 title: 'Safety by default',
 body: 'Block, report, takedown. Moderators see only their campus; super-admins override.',
 },
];

const STEPS = [
 {
 n: '01',
 icon: UserPlus,
 chip: 'bg-nb-violet text-white',
 title: 'Claim your handle',
 body: 'Sign up and pick your college. Your college locks in the moment you join — no switching, no carrying content across walls.',
 },
 {
 n: '02',
 icon: BadgeCheck,
 chip: 'bg-nb-yellow text-ink',
 title: 'Get verified',
 body: 'Upload your student ID. College moderators approve real students — fakes, lurkers and alumni never make it in.',
 },
 {
 n: '03',
 icon: PartyPopper,
 chip: 'bg-nb-pink text-white',
 title: "You're in",
 body: 'Post in the feed, swipe the campus deck, chat in real time. All of it — every pixel — stays inside your college.',
 },
];

const RULE_LEFT = ['Your campus feed', 'Your campus people', 'Your campus chats', 'Your campus events'];
const RULE_RIGHT = [
 { label: "Other colleges' posts", verdict: '404' },
 { label: "Other colleges' people", verdict: 'invisible' },
 { label: 'Cross-college DMs', verdict: 'impossible' },
];

/** Honest, factual numbers — straight from the product, nothing invented. */
const STATS = [
 { value: '3', label: 'apps fused into one' },
 { value: '48', label: 'hardened API endpoints' },
 { value: '17', label: 'tables, all college-scoped' },
 { value: '₹0', label: 'forever for students' },
];

const FAQS = [
 {
 q: 'Is it really only my college?',
 a: "Yes — and not as a UI filter. Every query is scoped at the database level to your college. A post from another college doesn't get hidden; it 404s. Even its existence is not confirmable from your account.",
 },
 {
 q: 'Who can join?',
 a: 'Verified students only. You sign up, pick your college, and a college moderator reviews your student ID. No college on file? Every main-app route returns 403 — there is no backdoor.',
 },
 {
 q: 'What about the dating side — is it creepy?',
 a: 'The deck only ever contains classmates your preferences allow, chat unlocks only after a mutual match, exact birthdates never leave the server, and passes resurface after 30 days. Blocks and reports are honored everywhere: feed, deck, search and chat.',
 },
 {
 q: 'How much does it cost?',
 a: '₹0. Free for students, forever. No ads, no paywalled features, no data selling — your email and exact birthdate are never exposed to other users.',
 },
 {
 q: 'What happens when I graduate?',
 a: 'Your college is locked to your account, so alumni cannot drift into other campuses. Your content stays in your college’s history — the wall never gets weaker.',
 },
 {
 q: 'My college isn’t on Zoclo yet. Can I add it?',
 a: 'Yes — that’s exactly what the “Bring Zoclo to your campus” section below is for. One email is all it takes; we review every request by hand.',
 },
 {
 q: 'How do I reach the team?',
 a: 'One inbox for everything — questions, college onboarding, moderator applications, contributions or press: idkitworks01@gmail.com. A real human replies.',
 },
];

const MARQUEE = [
 'YOUR COLLEGE ONLY',
 'FEED',
 'DATING',
 'REAL-TIME CHAT',
 'CONFESSIONS',
 'VERIFIED STUDENTS',
 'ZERO OUTSIDERS',
 'FREE FOREVER',
];

/* ───────────────────────────────────────────────────────────────────────────
 Page-scoped styles — professional motion, all reduced-motion aware
 ──────────────────────────────────────────────────────────────────────── */
const PAGE_CSS = `
 html { scroll-behavior: smooth; }
 @keyframes lp-float {
 0%, 100% { transform: translateY(0); }
 50% { transform: translateY(-9px); }
 }
 .lp-float { animation: lp-float 5.5s ease-in-out infinite; }
 .lp-float-late { animation: lp-float 7s ease-in-out 1s infinite; }
 @keyframes lp-marquee {
 from { transform: translateX(0); }
 to { transform: translateX(-50%); }
 }
 .lp-marquee { animation: lp-marquee 30s linear infinite; }
 .lp-marquee-paused:hover .lp-marquee { animation-play-state: paused; }

 /* Scroll reveals — gentle, once, and instant when reduced motion is set */
 [data-reveal] {
 opacity: 0;
 transform: translateY(16px);
 transition: opacity 0.55s cubic-bezier(0.22, 1, 0.36, 1),
 transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
 will-change: opacity, transform;
 }
 [data-reveal].lp-in { opacity: 1; transform: translateY(0); }

 /* FAQ accordion: animated purely with grid rows — smooth, no JS measuring */
 .lp-faq-body {
 display: grid;
 grid-template-rows: 0fr;
 transition: grid-template-rows 0.3s cubic-bezier(0.22, 1, 0.36, 1);
 }
 .lp-faq-body.lp-open { grid-template-rows: 1fr; }
 .lp-faq-body > div { overflow: hidden; }

 /* Consistent, on-brand keyboard focus everywhere */
 a:focus-visible, button:focus-visible {
 outline: 3px solid #0F172A;
 outline-offset: 3px;
 border-radius: 10px;
 }
 footer a:focus-visible, footer button:focus-visible {
 outline-color: #FAF7F2;
 }
 .on-dark a:focus-visible, .on-dark button:focus-visible { outline-color: #FAF7F2; }

 @keyframes lp-modal-in {
 from { opacity: 0; transform: translateY(12px) scale(0.97); }
 to { opacity: 1; transform: translateY(0) scale(1); }
 }
 .lp-modal-card { animation: lp-modal-in 0.18s cubic-bezier(0.22, 1, 0.36, 1); }
 @keyframes lp-fade { from { opacity: 0; } to { opacity: 1; } }
 .lp-modal-backdrop { animation: lp-fade 0.15s ease-out; }

 @media (prefers-reduced-motion: reduce) {
 html { scroll-behavior: auto; }
 .lp-float, .lp-float-late, .lp-marquee { animation: none !important; }
 [data-reveal] { opacity: 1 !important; transform: none !important; transition: none !important; }
 .lp-faq-body { transition: none !important; }
 .lp-modal-card, .lp-modal-backdrop { animation: none !important; }
 * { scroll-behavior: auto !important; }
 }
`;

/* ───────────────────────────────────────────────────────────────────────────
 Hooks
 ──────────────────────────────────────────────────────────────────────── */

/** One-shot scroll reveal for every [data-reveal] element on the page. */
function useReveal() {
 useEffect(() => {
 const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
 if (!('IntersectionObserver' in window)) {
 els.forEach((el) => el.classList.add('lp-in'));
 return;
 }
 const io = new IntersectionObserver(
 (entries) => {
 entries.forEach((e) => {
 if (e.isIntersecting) {
 e.target.classList.add('lp-in');
 io.unobserve(e.target);
 }
 });
 },
 { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
 );
 els.forEach((el) => io.observe(el));
 return () => io.disconnect();
 }, []);
}

/** Highlights the nav link of the section currently in view. */
function useScrollSpy(ids: string[]) {
 const [active, setActive] = useState<string>('');
 useEffect(() => {
 if (!('IntersectionObserver' in window)) return;
 const io = new IntersectionObserver(
 (entries) => {
 entries.forEach((e) => {
 if (e.isIntersecting) setActive(`#${e.target.id}`);
 });
 },
 { rootMargin: '-40% 0px -55% 0px' }
 );
 ids.forEach((id) => {
 const el = document.getElementById(id);
 if (el) io.observe(el);
 });
 return () => io.disconnect();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);
 return active;
}

/* ───────────────────────────────────────────────────────────────────────────
 Small components
 ──────────────────────────────────────────────────────────────────────── */

/** Mock feed post — mirrors the real app's post card styling. */
function FeedMockCard() {
 return (
 <div className="nb-card p-5 sm:p-6">
 <div className="flex items-start justify-between gap-3">
 <div className="flex items-center gap-3 min-w-0">
 <div className="w-11 h-11 shrink-0 bg-nb-pink border-2 border-ink grid place-items-center font-display font-bold text-white select-none">
 AR
 </div>
 <div className="min-w-0">
 <div className="flex items-center gap-1.5">
 <span className="font-display font-semibold text-sm truncate">Aarav Raina</span>
 <BadgeCheck size={15} strokeWidth={2.5} className="text-nb-peri shrink-0" />
 </div>
 <p className="text-xs text-gray-400 font-body truncate">CSE '26 · 2h · your college</p>
 </div>
 </div>
 <span className="nb-badge bg-nb-yellow text-[10px] gap-1.5 shrink-0">
 <span className="w-1.5 h-1.5 bg-nb-mint border border-ink inline-block" />
 LIVE
 </span>
 </div>

 <p className="mt-4 text-[15px] font-body leading-relaxed">
 Mess canteen queue at 1 PM is literally a boss fight. Whoever built the second counter —
 campus legend. 🛡️
 </p>

 <div className="mt-4 bg-cream border-2 border-ink px-4 py-2 flex items-center gap-2">
 <MessageCircle size={13} strokeWidth={2.5} className="text-nb-violet shrink-0" />
 <span className="text-xs font-body truncate">
 <span className="font-display font-semibold">Priya:</span> honestly same 💀 47 people deep rn
 </span>
 </div>

 <div className="mt-4 pt-3 border-t-2 border-gray-100 flex items-center gap-5 text-gray-400">
 <span className="flex items-center gap-1.5 text-xs font-display font-semibold text-ink">
 <ThumbsUp size={15} strokeWidth={2.5} className="text-nb-violet" fill="currentColor" /> 247
 </span>
 <span className="flex items-center gap-1.5 text-xs font-display font-semibold text-ink">
 <MessageCircle size={15} strokeWidth={2.5} className="text-nb-peri" /> 58
 </span>
 <span className="ml-auto">
 <Bookmark size={15} strokeWidth={2.5} />
 </span>
 </div>
 </div>
 );
}

function MatchMockCard() {
 return (
 <div className="nb-card bg-white px-4 py-3 flex items-center gap-3">
 <div className="flex -space-x-2.5">
 <span className="w-9 h-9 bg-nb-pink border-2 border-ink grid place-items-center text-white">
 <Heart size={14} strokeWidth={2.5} fill="currentColor" />
 </span>
 <span className="w-9 h-9 bg-nb-peri border-2 border-ink grid place-items-center text-white">
 <Zap size={14} strokeWidth={2.5} fill="currentColor" />
 </span>
 </div>
 <div className="min-w-0">
 <p className="font-display font-bold text-sm leading-tight">It's a match!</p>
 <p className="text-[11px] font-body text-gray-400 truncate">same college · say hi →</p>
 </div>
 <Send size={16} strokeWidth={2.5} className="ml-1 text-nb-violet shrink-0" />
 </div>
 );
}

function ChatMockCard() {
 return (
 <div className="nb-card bg-nb-yellow px-4 py-3 flex items-center gap-3">
 <span className="w-9 h-9 shrink-0 bg-white border-2 border-ink grid place-items-center">
 <MessagesSquare size={15} strokeWidth={2.5} />
 </span>
 <div className="min-w-0">
 <p className="font-display font-bold text-sm leading-tight">3 unread</p>
 <p className="text-[11px] font-body text-ink/75 truncate">all from your campus</p>
 </div>
 </div>
 );
}

/* ───────────────────────────────────────────────────────────────────────────
 Contact modal — outreach that works EVERYWHERE (mail apps can no-op in
 embedded browsers), with pre-filled, editable message + copy fallbacks.
 ──────────────────────────────────────────────────────────────────────── */
function ContactModal({ contact, onClose }: { contact: ContactType; onClose: () => void }) {
 const data = CONTACT_DATA[contact];
 const [message, setMessage] = useState(data.body);
 const cardRef = useRef<HTMLDivElement>(null);

 /* ESC to close + basic focus trap + scroll lock */
 useEffect(() => {
 const el = cardRef.current;
 el?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
 document.body.style.overflow = 'hidden';
 const onKey = (e: KeyboardEvent) => {
 if (e.key === 'Escape') {
 onClose();
 return;
 }
 if (e.key === 'Tab' && el) {
 const focusables = Array.from(
 el.querySelectorAll<HTMLElement>('button, textarea, a[href]')
 ).filter((n) => !n.hasAttribute('disabled'));
 if (focusables.length === 0) return;
 const first = focusables[0];
 const last = focusables[focusables.length - 1];
 if (e.shiftKey && document.activeElement === first) {
 e.preventDefault();
 last.focus();
 } else if (!e.shiftKey && document.activeElement === last) {
 e.preventDefault();
 first.focus();
 }
 }
 };
 document.addEventListener('keydown', onKey);
 return () => {
 document.removeEventListener('keydown', onKey);
 document.body.style.overflow = '';
 };
 }, [onClose]);

 const openMail = () => {
 window.location.href = mailto(data.subject, message);
 toast.success('Opening your mail app…', { duration: 2500 });
 };

 return (
 <div
 className="lp-modal-backdrop fixed inset-0 z-[60] bg-ink/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-6"
 onClick={onClose}
 >
 <div
 ref={cardRef}
 role="dialog"
 aria-modal="true"
 aria-labelledby="contact-modal-title"
 className="lp-modal-card nb-card w-full max-w-lg p-5 sm:p-7 max-h-[92dvh] overflow-y-auto"
 onClick={(e) => e.stopPropagation()}
 >
 <div className="flex items-start justify-between gap-3">
 <div>
 <h3 id="contact-modal-title" className="font-display font-bold text-xl">
 {data.title}
 </h3>
 <p className="mt-1 text-sm text-gray-500">{data.blurb}</p>
 </div>
 <button
 type="button"
 onClick={onClose}
 aria-label="Close"
 className="shrink-0 w-9 h-9 grid place-items-center bg-white border-2 border-ink shadow-nb-sm active:translate-x-[1px] active:translate-y-[1px] active:shadow-nb-active"
 >
 <X size={16} strokeWidth={2.75} />
 </button>
 </div>

 {/* To — with copy fallback */}
 <div className="mt-5 flex items-center justify-between gap-3 bg-cream border-2 border-ink pl-4 pr-2 py-2">
 <span className="text-sm font-body truncate">To: {CONTACT_EMAIL}</span>
 <button
 type="button"
 onClick={() => copyToClipboard(CONTACT_EMAIL, 'Email copied!')}
 aria-label={`Copy ${CONTACT_EMAIL} to clipboard`}
 className="shrink-0 w-8 h-8 grid place-items-center bg-white border-2 border-ink hover:bg-nb-yellow transition-colors"
 >
 <Copy size={13} strokeWidth={2.5} />
 </button>
 </div>

 {/* Editable pre-filled message */}
 <label className="block mt-4 font-display text-sm font-semibold mb-1.5" htmlFor="contact-message">
 Message (edit freely)
 </label>
 <textarea
 id="contact-message"
 value={message}
 onChange={(e) => setMessage(e.target.value)}
 rows={8}
 className="w-full px-4 py-3 border-2 border-ink bg-white font-body text-sm focus:outline-none focus:ring-2 focus:ring-nb-yellow focus:ring-offset-2 resize-y"
 />

 {/* Actions */}
 <button
 type="button"
 data-autofocus
 onClick={openMail}
 className="mt-5 nb-btn-orange w-full text-center text-base py-3 inline-flex items-center justify-center gap-2"
 >
 <Mail size={17} strokeWidth={2.5} /> Open mail app
 </button>
 <button
 type="button"
 onClick={() => copyToClipboard(message, 'Message copied!')}
 className="mt-3 w-full text-center font-display font-semibold text-sm text-gray-500 hover:text-ink underline underline-offset-4 decoration-2"
 >
 or copy the message instead
 </button>
 <p className="mt-3 text-center text-xs text-gray-400">
 Goes straight to our team inbox — a real human replies.
 </p>
 </div>
 </div>
 );
}

/* Tiny "3 layers" glyph for the hero trust row, drawn with spans. */
function LayersGlyph() {
 return (
 <span className="relative inline-block w-[17px] h-[15px]" aria-hidden>
 <span className="absolute inset-x-0 top-0 h-[5px] bg-nb-pink border-2 border-ink rounded-[3px]" />
 <span className="absolute inset-x-0 top-[5px] h-[4px] bg-nb-peri border-2 border-ink rounded-[3px]" />
 <span className="absolute inset-x-0 top-[8px] h-[5px] bg-nb-yellow border-2 border-ink rounded-[3px]" />
 </span>
 );
}

/* ───────────────────────────────────────────────────────────────────────────
 Landing page
 ──────────────────────────────────────────────────────────────────────── */
export default function LandingPage() {
 const [openFaq, setOpenFaq] = useState<number | null>(0);
 const [menuOpen, setMenuOpen] = useState(false);
 const [showTop, setShowTop] = useState(false);
 const [contact, setContact] = useState<ContactType | null>(null);
 const activeSection = useScrollSpy(NAV_LINKS.map((l) => l.href.slice(1)));
 useReveal();
 const menuRef = useRef<HTMLDivElement>(null);

 /* Back-to-top visibility */
 useEffect(() => {
 const onScroll = () => setShowTop(window.scrollY > 700);
 onScroll();
 window.addEventListener('scroll', onScroll, { passive: true });
 return () => window.removeEventListener('scroll', onScroll);
 }, []);

 /* Mobile menu: ESC to close + scroll lock while open */
 useEffect(() => {
 if (!menuOpen) return;
 const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
 document.addEventListener('keydown', onKey);
 document.body.style.overflow = 'hidden';
 return () => {
 document.removeEventListener('keydown', onKey);
 document.body.style.overflow = '';
 };
 }, [menuOpen]);

 return (
 <div className="min-h-screen bg-cream text-ink font-body overflow-x-hidden">
 <style>{PAGE_CSS}</style>

 {/* Skip link — first tab stop for keyboard users */}
 <a
 href="#features"
 className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-3 focus:left-3 focus:nb-btn focus:bg-white focus:text-sm focus:px-4 focus:py-2"
 >
 Skip to content
 </a>

 {/* ══════════════════ TOP BAR ══════════════════ */}
 <header className="sticky top-0 z-50 bg-nb-canvas/95 backdrop-blur border-b-[3px] border-ink">
 <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
 <a href="/" className="flex items-center select-none shrink-0" aria-label="Zoclo home">
 <Logo size={30} />
 </a>

 <nav className="hidden lg:flex items-center gap-1 font-display font-medium text-sm" aria-label="Primary">
 {NAV_LINKS.map((l) => {
 const active = activeSection === l.href;
 return (
 <a
 key={l.href}
 href={l.href}
 aria-current={active ? 'true' : undefined}
 className={`px-3 py-1.5 border-2 transition-all duration-100 ${
 active
 ? 'bg-nb-yellow border-ink shadow-nb-sm font-semibold'
 : 'border-transparent hover:border-ink hover:bg-white hover:shadow-nb-sm'
 }`}
 >
 {l.label}
 </a>
 );
 })}
 </nav>

 {/* Auth — opens the live app in a NEW TAB */}
 <div className="hidden sm:flex items-center gap-2.5 shrink-0">
 <NewTabLink
 href={LOGIN_URL}
 ariaLabel="Log in to Zoclo (opens in a new tab)"
 className="nb-btn bg-white text-sm px-4"
 >
 Login
 </NewTabLink>
 <NewTabLink
 href={SIGNUP_URL}
 ariaLabel="Sign up for Zoclo (opens in a new tab)"
 className="nb-btn-orange text-sm px-4"
 >
 Sign Up
 </NewTabLink>
 </div>

 {/* Mobile hamburger */}
 <button
 type="button"
 className="lg:hidden nb-btn bg-white !px-3 !py-2 shrink-0"
 aria-expanded={menuOpen}
 aria-controls="mobile-nav"
 aria-label={menuOpen ? 'Close menu' : 'Open menu'}
 onClick={() => setMenuOpen((v) => !v)}
 >
 {menuOpen ? <X size={18} strokeWidth={2.75} /> : <Menu size={18} strokeWidth={2.75} />}
 </button>
 </div>

 {/* Mobile menu panel */}
 <div
 id="mobile-nav"
 ref={menuRef}
 className={`lg:hidden absolute top-full inset-x-0 border-b-[3px] border-ink bg-white shadow-nb-lg transition-all duration-200 origin-top ${
 menuOpen ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-95 pointer-events-none'
 }`}
 >
 <nav className="px-4 py-4 flex flex-col gap-1" aria-label="Mobile">
 {NAV_LINKS.map((l) => (
 <a
 key={l.href}
 href={l.href}
 onClick={() => setMenuOpen(false)}
 className="nb-sidebar-link"
 >
 {l.label}
 </a>
 ))}
 <div className="mt-3 pt-3 border-t-2 border-gray-100 grid grid-cols-2 gap-3">
 <NewTabLink
 href={LOGIN_URL}
 ariaLabel="Log in to Zoclo (opens in a new tab)"
 className="nb-btn bg-white text-center text-sm"
 // note: keeps new-tab contract on mobile too
 >
 Login
 </NewTabLink>
 <NewTabLink
 href={SIGNUP_URL}
 ariaLabel="Sign up for Zoclo (opens in a new tab)"
 className="nb-btn-orange text-center text-sm"
 >
 Sign Up
 </NewTabLink>
 </div>
 </nav>
 </div>
 </header>

 <main>
 {/* ══════════════════ HERO ══════════════════ */}
 <section className="nb-canvas-surface">
 <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-14 sm:pt-20 sm:pb-24 grid lg:grid-cols-2 gap-12 lg:gap-10 items-center">
 {/* Left: pitch */}
 <div data-reveal>
 <span className="nb-badge bg-nb-yellow gap-1.5">
 <Zap size={12} strokeWidth={2.5} fill="currentColor" />
 LIVE ON CAMPUS · 100% FREE
 </span>

 <h1 className="mt-5 font-display font-bold text-4xl sm:text-5xl lg:text-6xl leading-[1.06] tracking-tight">
 Your entire college.{' '}
 <span className="inline-block bg-nb-yellow px-2 border-2 border-ink shadow-nb-sm -rotate-1 ">
 One app.
 </span>{' '}
 Zero outsiders.
 </h1>

 <p className="mt-5 text-base sm:text-lg text-ink/85 max-w-xl leading-relaxed">
 Zoclo fuses a Reddit-style <span className="font-semibold">feed</span>, a Tinder-style{' '}
 <span className="font-semibold">dating deck</span> and real-time{' '}
 <span className="font-semibold">chat</span> into one hyperlocal app — locked to your
 college at the database level. If they're not on your campus, they don't exist.
 </p>

 <div className="mt-7 flex flex-wrap items-center gap-3.5">
 <NewTabLink
 href={LOGIN_URL}
 ariaLabel="Open Zoclo (opens in a new tab)"
 className="nb-btn-orange text-base px-6 py-3 inline-flex items-center gap-2"
 >
 Join your campus <ArrowRight size={17} strokeWidth={2.75} />
 </NewTabLink>
 <a href="#features" className="nb-btn bg-white text-base px-6 py-3">
 See what's inside
 </a>
 </div>

 <p className="mt-3 text-xs font-display font-semibold tracking-wide text-ink/55">
 Opens the app in a new tab · No credit card · Verified students only
 </p>

 <div className="mt-6 flex flex-wrap gap-x-7 gap-y-2.5 font-display font-semibold text-sm">
 <span className="flex items-center gap-2">
 <GraduationCap size={17} strokeWidth={2.5} className="text-ink" /> 1 college · 1 feed
 </span>
 <span className="flex items-center gap-2">
 <LayersGlyph /> 3 apps in 1
 </span>
 <span className="flex items-center gap-2">
 <Zap size={16} strokeWidth={2.5} className="text-nb-violet" fill="currentColor" /> ₹0 forever
 </span>
 </div>
 </div>

 {/* Right: product collage.
 Mobile/tablet: cards flow BELOW the post card — zero overlap.
 Desktop (lg+): the two mini cards float, positioned to never
 cover the post card's text. */}
 <div className="relative mx-auto w-full max-w-md lg:max-w-none" data-reveal>
 {/* backdrop blocks — decorative only, desktop screens wide enough */}
 <div className="hidden lg:block absolute -top-7 -right-5 w-40 h-40 bg-nb-yellow border-2 border-ink rotate-6" aria-hidden />
 <div className="hidden lg:block absolute -bottom-3 right-14 w-24 h-24 bg-nb-peri border-2 border-ink rotate-[-8deg]" aria-hidden />

 <div className="relative rotate-[1.5deg]">
 <FeedMockCard />
 </div>

  {/* mini cards: stacked on phones, side-by-side from sm, floating on lg */}
  <div className="mt-5 lg:mt-0 flex flex-col min-[420px]:flex-row gap-4 sm:gap-5 justify-center items-stretch min-[420px]:items-start lg:block lg:static min-w-0">
 <div className="lg:absolute lg:-left-4 lg:bottom-14 lp-float">
 <div className="rotate-[-2.5deg] lg:rotate-[-3deg]">
 <MatchMockCard />
 </div>
 </div>
 <div className="lg:absolute lg:-right-3 lg:top-10 lp-float-late">
 <div className="rotate-[2.5deg] lg:rotate-[3deg]">
 <ChatMockCard />
 </div>
 </div>
 </div>
 </div>
 </div>
 </section>

 {/* ══════════════════ MARQUEE ══════════════════ */}
 <div className="bg-cream py-6 overflow-hidden lp-marquee-paused" aria-hidden>
 <div className="bg-ink border-2 border-ink py-3.5 -rotate-1 w-[104%] -ml-[2%] overflow-hidden shadow-nb">
 <div className="flex w-max lp-marquee">
 {[0, 1].map((copy) => (
 <div key={copy} className="flex items-center gap-8 pr-8">
 {MARQUEE.map((item, i) => (
 <span
 key={`${copy}-${i}`}
 className="font-display font-bold text-sm sm:text-base tracking-widest whitespace-nowrap text-cream"
 >
 {item} <span className="text-nb-yellow ml-6">★</span>
 </span>
 ))}
 </div>
 ))}
 </div>
 </div>
 </div>

 {/* ══════════════════ STATS ══════════════════ */}
 <section className="bg-cream pb-14 sm:pb-20">
 <div className="max-w-6xl mx-auto px-4 sm:px-6" data-reveal>
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 {STATS.map((s) => (
 <div
 key={s.label}
 className="bg-white border-2 border-ink shadow-nb px-4 py-5 text-center hover:-translate-x-[3px] hover:-translate-y-[3px] hover:shadow-nb-hover transition-all duration-150"
 >
 <p className="font-display font-bold text-3xl sm:text-4xl">{s.value}</p>
 <p className="mt-1 text-xs sm:text-[13px] text-gray-500 font-display font-medium">{s.label}</p>
 </div>
 ))}
 </div>
 </div>
 </section>

 {/* ══════════════════ FEATURES ══════════════════ */}
 <section id="features" className="bg-cream pb-16 sm:pb-24 scroll-mt-24">
 <div className="max-w-6xl mx-auto px-4 sm:px-6">
 <div className="text-center max-w-2xl mx-auto" data-reveal>
 <span className="nb-badge bg-nb-lilac">WHAT'S INSIDE</span>
 <h2 className="mt-4 font-display font-bold text-3xl sm:text-5xl tracking-tight">
 Three apps in one neon box
 </h2>
 <p className="mt-4 text-gray-500 text-base sm:text-lg">
 Everything your campus life runs on — without a single person from outside your college
 ever touching it.
 </p>
 </div>

 {/* big three */}
 <div className="mt-12 grid md:grid-cols-3 gap-6">
 {BIG_FEATURES.map((f, i) => (
 <div
 key={f.title}
 data-reveal
 style={{ transitionDelay: `${i * 70}ms` }}
 className="nb-card-hover p-6 flex flex-col"
 >
 <span
 className={`w-12 h-12 ${f.chip} border-2 border-ink grid place-items-center shadow-nb-sm`}
 >
 <f.icon size={22} strokeWidth={2.5} />
 </span>
 <h3 className="mt-5 font-display font-bold text-xl">{f.title}</h3>
 <p className="mt-2.5 text-sm text-gray-500 leading-relaxed flex-1">{f.body}</p>
 <p className="mt-5 font-display font-semibold text-[11px] tracking-widest text-gray-300">
 {f.footer}
 </p>
 </div>
 ))}
 </div>

 {/* mini four */}
 <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
 {MINI_FEATURES.map((f, i) => (
 <div
 key={f.title}
 data-reveal
 style={{ transitionDelay: `${i * 60}ms` }}
 className="nb-card-hover p-5"
 >
 <span
 className={`w-10 h-10 ${f.chip} border-2 border-ink grid place-items-center shadow-nb-sm`}
 >
 <f.icon size={18} strokeWidth={2.5} />
 </span>
 <h3 className="mt-4 font-display font-bold text-base">{f.title}</h3>
 <p className="mt-1.5 text-[13px] text-gray-500 leading-relaxed">{f.body}</p>
 </div>
 ))}
 </div>
 </div>
 </section>

 {/* ══════════════════ THE ONE RULE ══════════════════ */}
 <section id="rule" className="nb-canvas-surface py-16 sm:py-24 scroll-mt-24">
 <div className="max-w-5xl mx-auto px-4 sm:px-6">
 <div className="text-center max-w-2xl mx-auto" data-reveal>
 <span className="nb-badge bg-nb-violet text-white">THE ONE RULE</span>
 <h2 className="mt-4 font-display font-bold text-3xl sm:text-5xl tracking-tight">
 Everything stays inside your college.
 </h2>
 <p className="mt-4 text-ink/85 text-base sm:text-lg">
 Not a filter. A wall. Scope is enforced server-side on every request — your college is
 resolved from the live database, so it can't be spoofed, widened or bypassed.
 </p>
 </div>

 <div className="mt-12 grid md:grid-cols-2 gap-6" data-reveal>
 {/* allowed */}
 <div className="nb-card p-6 sm:p-7 rotate-[-0.5deg]">
 <div className="flex items-center gap-3">
 <span className="w-10 h-10 bg-nb-yellow border-2 border-ink grid place-items-center shadow-nb-sm">
 <Check size={20} strokeWidth={3} />
 </span>
 <h3 className="font-display font-bold text-lg">Your college</h3>
 </div>
 <ul className="mt-5 space-y-3">
 {RULE_LEFT.map((item) => (
 <li key={item} className="flex items-center gap-3 font-body text-sm">
 <span className="w-5 h-5 bg-nb-yellow border-2 border-ink grid place-items-center shrink-0">
 <Check size={11} strokeWidth={3.5} />
 </span>
 {item}
 </li>
 ))}
 </ul>
 </div>

 {/* blocked */}
 <div className="on-dark bg-ink text-cream border-2 border-ink shadow-nb p-6 sm:p-7 rotate-[0.5deg]">
 <div className="flex items-center gap-3">
 <span className="w-10 h-10 bg-nb-pink border-2 border-cream grid place-items-center shadow-[3px_3px_0px_0px_#FAF7F2]">
 <X size={20} strokeWidth={3} />
 </span>
 <h3 className="font-display font-bold text-lg">Everything else</h3>
 </div>
 <ul className="mt-5 space-y-3">
 {RULE_RIGHT.map((item) => (
 <li key={item.label} className="flex items-center justify-between gap-3 font-body text-sm">
 <span className="flex items-center gap-3 min-w-0">
 <span className="w-5 h-5 bg-nb-pink border-2 border-cream grid place-items-center shrink-0">
 <X size={11} strokeWidth={3.5} />
 </span>
 <span className="truncate">{item.label}</span>
 </span>
 <span className="font-display font-bold text-[11px] tracking-widest text-nb-pink border-2 border-cream px-2.5 py-0.5 whitespace-nowrap shrink-0">
 {item.verdict.toUpperCase()}
 </span>
 </li>
 ))}
 </ul>
 <p className="mt-5 pt-4 border-t-2 border-cream/20 text-[13px] text-cream/70 flex items-center gap-2">
 <Lock size={14} strokeWidth={2.5} className="text-nb-yellow shrink-0" />
 A cross-college post 404s — its existence isn't even confirmable.
 </p>
 </div>
 </div>

 {/* the query, literally */}
 <div className="mt-8 flex justify-center" data-reveal>
 <div className="bg-ink text-nb-yellow font-mono text-[11px] sm:text-xs px-5 py-3.5 border-2 border-ink shadow-nb rotate-[-1deg] overflow-x-auto max-w-full">
 <span className="text-gray-300">// every. single. query.</span>
 <br />
 WHERE author.collegeId = viewer.collegeId
 </div>
 </div>

 {/* safety chips */}
 <div className="mt-10 grid sm:grid-cols-3 gap-4">
 {[
 { icon: Lock, label: 'Rotating refresh tokens', sub: 'sessions die on logout' },
 { icon: Gauge, label: 'Rate-limited everything', sub: 'bots and scrapers hit walls' },
 { icon: EyeOff, label: 'Zero data leaks', sub: 'errors sanitized at one choke point' },
 ].map((s, i) => (
 <div
 key={s.label}
 data-reveal
 style={{ transitionDelay: `${i * 60}ms` }}
 className="bg-white border-2 border-ink shadow-nb px-4 py-3.5 flex items-center gap-3"
 >
 <s.icon size={18} strokeWidth={2.5} className="text-nb-violet shrink-0" />
 <div className="min-w-0">
 <p className="font-display font-bold text-sm truncate">{s.label}</p>
 <p className="text-xs text-gray-400 truncate">{s.sub}</p>
 </div>
 </div>
 ))}
 </div>
 </div>
 </section>

 {/* ══════════════════ HOW IT WORKS ══════════════════ */}
 <section id="how" className="bg-cream py-16 sm:py-24 scroll-mt-24">
 <div className="max-w-6xl mx-auto px-4 sm:px-6">
 <div className="text-center max-w-2xl mx-auto" data-reveal>
 <span className="nb-badge bg-nb-peri text-ink">HOW IT WORKS</span>
 <h2 className="mt-4 font-display font-bold text-3xl sm:text-5xl tracking-tight">
 In before your next lecture
 </h2>
 </div>

 <div className="mt-12 grid md:grid-cols-3 gap-6">
 {STEPS.map((s, i) => (
 <div
 key={s.n}
 data-reveal
 style={{ transitionDelay: `${i * 80}ms` }}
 className="relative nb-card-hover p-6 sm:p-7"
 >
 <span className="absolute top-5 right-6 font-display font-bold text-4xl text-nb-yellow select-none" aria-hidden>
 {s.n}
 </span>
 <span
 className={`w-12 h-12 ${s.chip} border-2 border-ink grid place-items-center shadow-nb-sm`}
 >
 <s.icon size={22} strokeWidth={2.5} />
 </span>
 <h3 className="mt-5 font-display font-bold text-xl">{s.title}</h3>
 <p className="mt-2.5 text-sm text-gray-500 leading-relaxed">{s.body}</p>
 {i < STEPS.length - 1 && (
 <span
 className="hidden md:grid place-items-center absolute top-1/2 -right-[23px] w-[22px] h-[22px] bg-cream z-10"
 aria-hidden
 >
 <ArrowRight size={20} strokeWidth={2.5} className="text-ink" />
 </span>
 )}
 </div>
 ))}
 </div>

 <div className="mt-10 text-center" data-reveal>
 <NewTabLink
 href={LOGIN_URL}
 ariaLabel="Start on Zoclo (opens in a new tab)"
 className="nb-btn-orange inline-flex items-center gap-2 text-base px-7 py-3"
 >
 Start now — it's free <Zap size={16} strokeWidth={2.75} fill="currentColor" />
 </NewTabLink>
 </div>
 </div>
 </section>

 {/* ══════════════════ WHY ZOCLO ══════════════════ */}
 <section id="why" className="bg-ink text-cream py-16 sm:py-24 scroll-mt-24 on-dark">
 <div className="max-w-6xl mx-auto px-4 sm:px-6">
 <div className="text-center max-w-2xl mx-auto" data-reveal>
 <span className="nb-badge bg-nb-yellow">WHY ZOCLO EXISTS</span>
 <h2 className="mt-4 font-display font-bold text-3xl sm:text-5xl tracking-tight">
 College life already happens in three apps.
 </h2>
 <p className="mt-4 text-cream/70 text-base sm:text-lg">
 So we stopped juggling. One app, one campus, everything in its place.
 </p>
 </div>

 <div className="mt-12 grid md:grid-cols-3 gap-6">
 {[
 {
 icon: Target,
 title: 'One place, not five',
 body: 'The group chat, the swipe deck, the confession page — today they live in three different apps with three different crowds. Zoclo puts them under one roof, so your campus feels like one campus again.',
 },
 {
 icon: Gift,
 title: 'Only real students',
 body: 'Every single person is verified with a student ID and approved by a moderator before they can post, swipe or message. No lurkers, no fakes, no randoms from the internet.',
 },
 {
 icon: Sparkles,
 title: 'Small-campus feeling',
 body: 'Because everyone is from your college, conversations stay relevant and people treat each other like neighbours — the way a campus community should feel, online.',
 },
 ].map((c, i) => (
 <div
 key={c.title}
 data-reveal
 style={{ transitionDelay: `${i * 70}ms` }}
 className="bg-[#0F172A] border-2 border-cream/10 hover:border-cream/40 p-6 sm:p-7 transition-all duration-150 hover:-translate-y-[3px] hover:shadow-[6px_6px_0px_0px_#FBBF24]"
 >
 <span className="w-12 h-12 bg-nb-yellow text-ink border-2 border-cream grid place-items-center">
 <c.icon size={22} strokeWidth={2.5} />
 </span>
 <h3 className="mt-5 font-display font-bold text-xl">{c.title}</h3>
 <p className="mt-2.5 text-sm text-cream/70 leading-relaxed">{c.body}</p>
 </div>
 ))}
 </div>

 <div className="mt-10 text-center" data-reveal>
 <NewTabLink
 href={LOGIN_URL}
 ariaLabel="Try Zoclo (opens in a new tab)"
 className="nb-btn-lime inline-flex items-center gap-2 text-base px-7 py-3"
 >
 Try it with your campus <ArrowRight size={17} strokeWidth={2.75} />
 </NewTabLink>
 </div>
 </div>
 </section>

 {/* ══════════════════ BRING ZOCLO TO YOUR CAMPUS ══════════════════ */}
 <section className="bg-cream py-16 sm:py-24">
 <div className="max-w-6xl mx-auto px-4 sm:px-6">
 <div className="text-center max-w-2xl mx-auto" data-reveal>
 <span className="nb-badge bg-nb-yellow">GET INVOLVED</span>
 <h2 className="mt-4 font-display font-bold text-3xl sm:text-5xl tracking-tight">
 Bring Zoclo to your campus
 </h2>
 <p className="mt-4 text-gray-500 text-base sm:text-lg">
 One inbox, real humans. Pick the mail that fits you — it opens pre-filled, you just hit
 send.
 </p>
 </div>

 <div className="mt-12 grid md:grid-cols-3 gap-6"> {[
 {
 icon: GraduationCap,
 chip: 'bg-nb-violet text-white',
 title: 'Add your college',
 body: "Your campus isn't here yet? Request it — we verify colleges by hand and set up your community.",
 type: 'college' as ContactType,
 cta: 'Request your college',
 },
 {
 icon: Users,
 chip: 'bg-nb-pink text-white',
 title: 'Become a moderator',
 body: 'Know every corner of your campus? Run the verification queue and keep your community safe.',
 type: 'moderator' as ContactType,
 cta: 'Apply as moderator',
 },
 {
 icon: Sparkles,
 chip: 'bg-nb-peri text-ink',
 title: 'Help build Zoclo',
 body: 'Design, building, ideas, or spreading the word on your campus — every kind of help moves Zoclo forward.',
 type: 'build' as ContactType,
 cta: 'Start contributing',
 },
 ].map((c, i) => (
 <div
 key={c.title}
 data-reveal
 style={{ transitionDelay: `${i * 70}ms` }}
 className="nb-card-hover p-6 flex flex-col"
 >
 <span className={`w-12 h-12 ${c.chip} border-2 border-ink grid place-items-center shadow-nb-sm`}>
 <c.icon size={22} strokeWidth={2.5} />
 </span>
 <h3 className="mt-5 font-display font-bold text-xl">{c.title}</h3>
 <p className="mt-2.5 text-sm text-gray-500 leading-relaxed flex-1">{c.body}</p>
 <button
 type="button"
 onClick={() => setContact(c.type)}
 aria-label={`${c.cta} — opens a pre-filled message form`}
 className="mt-5 inline-flex items-center gap-2 font-display font-semibold text-sm text-ink hover:text-nb-violet underline underline-offset-4 decoration-2 cursor-pointer"
 >
 <Mail size={15} strokeWidth={2.5} />
 {c.cta}
 </button>
 </div>
 ))}
 </div>
 </div>
 </section>

 {/* ══════════════════ FAQ ══════════════════ */}
 <section id="faq" className="bg-cream pb-16 sm:pb-24 scroll-mt-24">
 <div className="max-w-3xl mx-auto px-4 sm:px-6">
 <div className="text-center" data-reveal>
 <span className="nb-badge bg-nb-yellow">FAQ</span>
 <h2 className="mt-4 font-display font-bold text-3xl sm:text-5xl tracking-tight">
 Asked in every group chat
 </h2>
 </div>

 <div className="mt-10 space-y-4" data-reveal>
 {FAQS.map((f, i) => {
 const open = openFaq === i;
 return (
 <div key={f.q} className="bg-white border-2 border-ink shadow-nb">
 <button
 type="button"
 onClick={() => setOpenFaq(open ? null : i)}
 aria-expanded={open}
 aria-controls={`faq-body-${i}`}
 className="w-full flex items-center justify-between gap-4 text-left px-5 py-4 font-display font-semibold text-sm sm:text-base"
 >
 {f.q}
 <ChevronDown
 size={18}
 strokeWidth={2.75}
 className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
 />
 </button>
 <div id={`faq-body-${i}`} className={`lp-faq-body ${open ? 'lp-open' : ''}`}>
 <div>
 <p className="px-5 pb-5 text-sm text-gray-500 leading-relaxed">{f.a}</p>
 </div>
 </div>
 </div>
 );
 })}
 </div>
 </div>
 </section>

 {/* ══════════════════ FINAL CTA ══════════════════ */}
 <section className="nb-canvas-surface border-t-[3px] border-ink">
 <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center" data-reveal>
 <div className="inline-block rotate-[-1deg]">
 <Logo size={56} />
 </div>
 <h2 className="mt-6 font-display font-bold text-3xl sm:text-5xl tracking-tight leading-tight">
 Your campus is already talking.
 </h2>
 <p className="mt-4 text-ink/85 text-base sm:text-lg max-w-xl mx-auto">
 Feed. Dating. Chat. One college-only app — verified humans, free forever.
 </p>
 <div className="mt-8 flex justify-center">
 <NewTabLink
 href={LOGIN_URL}
 ariaLabel="Open Zoclo — it's free (opens in a new tab)"
 className="nb-btn-orange text-lg px-8 py-3.5 inline-flex items-center gap-2"
 >
 Open Zoclo — it's free <ArrowRight size={18} strokeWidth={2.75} />
 </NewTabLink>
 </div>
 <p className="mt-4 text-xs font-display font-semibold tracking-widest text-ink/75 uppercase">
 Opens the app in a new tab · No credit card · No alumni
 </p>
 </div>
 </section>
 </main>

 {/* ══════════════════ FOOTER ══════════════════ */}
 <footer className="on-dark bg-ink text-cream border-t-[3px] border-ink">
 <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid gap-10 md:grid-cols-4">
 <div className="md:col-span-2">
 <div className="inline-block bg-white border-2 border-cream shadow-[4px_4px_0px_0px_#FBBF24] p-1.5 rotate-[-1deg]">
 <Logo size={30} />
 </div>
 <p className="mt-4 text-sm text-cream/70 max-w-sm leading-relaxed">
 The hyperlocal social network for college students. Feed · Dating · Chat — all inside
 your college, nothing outside it.
 </p>
 <button
 type="button"
 onClick={() => setContact('plain')}
 className="mt-4 inline-flex items-center gap-2 text-sm text-cream/90 hover:text-nb-yellow underline underline-offset-4 decoration-2 break-all cursor-pointer"
 aria-label="Contact us — opens a pre-filled message form"
 >
 <Mail size={15} strokeWidth={2.5} className="shrink-0" />
 {CONTACT_EMAIL}
 </button>
 <p className="mt-3 text-xs text-cream/50 max-w-sm leading-relaxed">
 Colleges onboarding · moderator applications · contributions · press — one inbox for
 everything.
 </p>
 <p className="mt-4 text-xs font-display font-semibold tracking-widest text-nb-yellow uppercase flex items-center gap-1.5">
 Made with <Zap size={11} strokeWidth={2.5} fill="currentColor" className="text-nb-violet" /> for students, by students
 </p>
 </div>

 <div>
 <h4 className="font-display font-bold text-sm tracking-widest uppercase text-nb-yellow">Explore</h4>
 <ul className="mt-4 space-y-2.5 text-sm text-cream/80">
 {NAV_LINKS.map((l) => (
 <li key={l.href}>
 <a href={l.href} className="hover:text-nb-yellow hover:underline underline-offset-4">
 {l.label}
 </a>
 </li>
 ))}
 </ul>
 </div>

 <div>
 <h4 className="font-display font-bold text-sm tracking-widest uppercase text-nb-yellow">The App</h4>
 <ul className="mt-4 space-y-2.5 text-sm text-cream/80">
 <li>
 <NewTabLink
 href={LOGIN_URL}
 ariaLabel="Log in (opens in a new tab)"
 className="hover:text-nb-yellow hover:underline underline-offset-4"
 >
 Login ↗
 </NewTabLink>
 </li>
 <li>
 <NewTabLink
 href={SIGNUP_URL}
 ariaLabel="Sign up (opens in a new tab)"
 className="hover:text-nb-yellow hover:underline underline-offset-4"
 >
 Sign Up ↗
 </NewTabLink>
 </li>
 <li>
 <NewTabLink
 href={APP_URL}
 ariaLabel="Open the app (opens in a new tab)"
 className="hover:text-nb-yellow hover:underline underline-offset-4"
 >
 Open App ↗
 </NewTabLink>
 </li>
 </ul>
 </div>
 </div>

 <div className="border-t-2 border-cream/15">
 <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-cream/60">
 <p>© {new Date().getFullYear()} Zoclo · Built on campus, for campus.</p>
 <p className="font-display font-semibold tracking-widest uppercase">College-only by design 🔒</p>
 </div>
 </div>
 </footer>

 {/* ══════════════════ CONTACT MODAL ══════════════════ */}
 {contact && <ContactModal contact={contact} onClose={() => setContact(null)} />}

 {/* ══════════════════ BACK TO TOP ══════════════════ */}
 <button
 type="button"
 onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
 aria-label="Back to top"
 className={`fixed bottom-5 right-5 z-40 w-11 h-11 bg-nb-violet text-white border-2 border-ink shadow-nb grid place-items-center transition-all duration-200 hover:bg-nb-violet/90 active:translate-x-[2px] active:translate-y-[2px] active:shadow-nb-active ${
 showTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
 }`}
 >
 <ArrowUp size={18} strokeWidth={2.75} />
 </button>
 </div>
 );
}
