import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding users and posts...');

  const passwordHash = await bcrypt.hash('password123', 12);

  const ipec = await prisma.college.findFirst({ where: { shortName: 'IPEC' } });
  const dtu = await prisma.college.findFirst({ where: { shortName: 'DTU' } });

  const users = await Promise.all([
    prisma.user.upsert({
      where: { username: 'viratcore01' },
      update: {},
      create: {
        email: 'virat@skola.app', passwordHash, username: 'viratcore01',
        displayName: 'Virat Shishodia', collegeId: ipec?.id, course: 'CSE', year: 2,
        bio: 'Building things that matter. Coffee > Sleep.',
      },
    }),
    prisma.user.upsert({
      where: { username: 'priya_sharma' },
      update: {},
      create: {
        email: 'priya@skola.app', passwordHash, username: 'priya_sharma',
        displayName: 'Priya Sharma', collegeId: ipec?.id, course: 'ECE', year: 3,
        bio: 'Analog circuits by day, Bollywood dance by night.',
      },
    }),
    prisma.user.upsert({
      where: { username: 'arnav_dev' },
      update: {},
      create: {
        email: 'arnav@skola.app', passwordHash, username: 'arnav_dev',
        displayName: 'Arnav Gupta', collegeId: ipec?.id, course: 'CSE', year: 2,
        bio: 'Full-stack dev. Currently mass-producing side projects.',
      },
    }),
    prisma.user.upsert({
      where: { username: 'ishita_codes' },
      update: {},
      create: {
        email: 'ishita@skola.app', passwordHash, username: 'ishita_codes',
        displayName: 'Ishita Singh', collegeId: ipec?.id, course: 'CSE', year: 4,
        bio: 'Final year. Surviving placement season.',
      },
    }),
    prisma.user.upsert({
      where: { username: 'rohit_k' },
      update: {},
      create: {
        email: 'rohit@skola.app', passwordHash, username: 'rohit_k',
        displayName: 'Rohit Kumar', collegeId: ipec?.id, course: 'ECE', year: 2,
        bio: 'I sleep 4 hours a day. Just kidding, I don\'t top either.',
      },
    }),
    prisma.user.upsert({
      where: { username: 'sneha_travels' },
      update: {},
      create: {
        email: 'sneha@skola.app', passwordHash, username: 'sneha_travels',
        displayName: 'Sneha Agarwal', collegeId: dtu?.id, course: 'IT', year: 3,
        bio: 'Weekend backpacker. 12 states in 2 years.',
      },
    }),
  ]);

  const [virat, priya, arnav, ishita, rohit, sneha] = users;
  console.log(`✅ Created ${users.length} users`);

  // Posts use real user IDs — anonymous posts still have a real authorId but isAnonymous=true
  const posts = await Promise.all([
    prisma.post.create({
      data: {
        authorId: virat.id, content: "Alright hear me out — the mess food this semester isn't just bad, it's actively trying to eliminate us. The rajma yesterday had a survival rate of about 30%. Who's filing a PIL?", type: 'NORMAL', isAnonymous: false,
      },
    }),
    prisma.post.create({
      data: {
        authorId: priya.id, content: "PSA: The Wi-Fi in Block B has been down since 6 AM. IT department says 'we're looking into it.' They've been 'looking into it' since October.", type: 'NORMAL', isAnonymous: false,
      },
    }),
    prisma.post.create({
      data: {
        authorId: arnav.id, content: "Built a full-stack app this weekend using React + Prisma + SQLite.\n\nThings I learned:\n1. Prisma migrations are addictive\n2. Tailwind makes you forget CSS exists\n3. Sleep is a social construct\n\nDrop your weekend projects below 👇", type: 'NORMAL', isAnonymous: false,
      },
    }),
    prisma.post.create({
      data: {
        authorId: ishita.id, content: "I have a massive crush on someone from my section but I'm too scared to say anything. If you sit in the 3rd row of Room 204... yeah it's you.", type: 'CONFESSION', isAnonymous: true,
      },
    }),
    prisma.post.create({
      data: {
        authorId: ishita.id, content: "Final year tip: Start applying for internships in your 2nd year. Seriously. I waited till 3rd year and nearly had a mental breakdown during placement season.\n\nAlso, your GitHub profile matters more than your CGPA. Fight me.", type: 'NORMAL', isAnonymous: false,
      },
    }),
    prisma.post.create({
      data: {
        authorId: rohit.id, content: "Whoever keeps playing Punjabi bass at 2 AM in hostel block C — I respect the commitment but some of us have a quiz at 8 AM. Please. I'm begging.", type: 'CONFESSION', isAnonymous: true,
      },
    }),
    prisma.post.create({
      data: {
        authorId: rohit.id, content: "Study group forming for mid-sem exams 📚 We meet in the library every evening 5-8 PM. All branches welcome. Bring your own chai though, I'm not funding this operation.", type: 'NORMAL', isAnonymous: false,
      },
    }),
    prisma.post.create({
      data: {
        authorId: virat.id, content: "Confession: I've been pretending to take notes on my laptop but actually I'm watching Formula 1 highlights. This has been going on for 3 weeks.", type: 'CONFESSION', isAnonymous: true,
      },
    }),
    prisma.post.create({
      data: {
        authorId: sneha.id, content: "Just got back from a solo trip to Himachal. 4 days, ₹3,200 total. If anyone wants the budget breakdown and itinerary, DM me. Happy to share!", type: 'NORMAL', isAnonymous: false,
      },
    }),
    prisma.post.create({
      data: {
        authorId: priya.id, content: "The fest committee is looking for volunteer performers for the annual fest. Singers, dancers, bands — anyone interested, fill this form. Let's make this year insane.", type: 'NORMAL', isAnonymous: false,
      },
    }),
  ]);

  console.log(`✅ Created ${posts.length} posts`);

  // Likes
  const likes = [
    { userId: priya.id, postId: posts[0].id },
    { userId: arnav.id, postId: posts[0].id },
    { userId: ishita.id, postId: posts[0].id },
    { userId: rohit.id, postId: posts[1].id },
    { userId: virat.id, postId: posts[2].id },
    { userId: priya.id, postId: posts[2].id },
    { userId: virat.id, postId: posts[3].id },
    { userId: arnav.id, postId: posts[3].id },
    { userId: sneha.id, postId: posts[4].id },
    { userId: virat.id, postId: posts[5].id },
    { userId: priya.id, postId: posts[5].id },
    { userId: arnav.id, postId: posts[5].id },
    { userId: ishita.id, postId: posts[6].id },
    { userId: virat.id, postId: posts[8].id },
  ];
  for (const like of likes) {
    await prisma.postLike.create({ data: like }).catch(() => {});
  }

  // Comments
  await prisma.comment.createMany({
    data: [
      { postId: posts[0].id, authorId: priya.id, content: "The rajma had me questioning my life choices fr" },
      { postId: posts[0].id, authorId: arnav.id, content: "I survived the dal fry. Barely." },
      { postId: posts[1].id, authorId: virat.id, content: "They said the same thing last month. Nothing changed." },
      { postId: posts[2].id, authorId: virat.id, content: "Prisma is cracked. Once you go Prisma you never go back." },
      { postId: posts[2].id, authorId: ishita.id, content: "Sleep is optional is so real 😭" },
      { postId: posts[3].id, authorId: arnav.id, content: "Shoot your shot anon, life's too short" },
      { postId: posts[5].id, authorId: rohit.id, content: "Block C always going hard at 2 AM 💀" },
      { postId: posts[6].id, authorId: ishita.id, content: "I'll bring the coffee, you bring the notes" },
      { postId: posts[8].id, authorId: sneha.id, content: "DM sent! Himachal looks gorgeous" },
    ],
  });

  console.log('✅ Added likes and comments');
  console.log('🎉 All seeded!');
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
