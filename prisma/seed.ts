import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Colleges
  const colleges = await Promise.all(
    [
      { name: 'Indian Institute of Technology', shortName: 'IIT', city: 'Multiple', state: 'India' },
      { name: 'Institute of Professional Education and Communication', shortName: 'IPEC', city: 'Ghaziabad', state: 'Uttar Pradesh' },
      { name: 'Delhi Technological University', shortName: 'DTU', city: 'New Delhi', state: 'Delhi' },
      { name: 'Netaji Subhas University of Technology', shortName: 'NSUT', city: 'New Delhi', state: 'Delhi' },
      { name: 'Vellore Institute of Technology', shortName: 'VIT', city: 'Vellore', state: 'Tamil Nadu' },
      { name: 'SRM Institute of Science and Technology', shortName: 'SRM', city: 'Chennai', state: 'Tamil Nadu' },
      { name: 'Manipal Institute of Technology', shortName: 'MIT', city: 'Manipal', state: 'Karnataka' },
      { name: 'Birla Institute of Technology and Science', shortName: 'BITS', city: 'Pilani', state: 'Rajasthan' },
      { name: 'Amity University', shortName: 'Amity', city: 'Noida', state: 'Uttar Pradesh' },
      { name: 'Jaypee Institute of Information Technology', shortName: 'JIIT', city: 'Noida', state: 'Uttar Pradesh' },
    ].map((c) =>
      prisma.college.upsert({
        where: { name: c.name },
        update: {},
        create: c,
      })
    )
  );
  console.log(`✅ Created ${colleges.length} colleges`);

  // Interests
  const interests = await Promise.all(
    [
      { name: 'Filmmaking', category: 'Creative' },
      { name: 'Photography', category: 'Creative' },
      { name: 'Music', category: 'Creative' },
      { name: 'Writing', category: 'Creative' },
      { name: 'Art & Design', category: 'Creative' },
      { name: 'Coding', category: 'Tech' },
      { name: 'AI & ML', category: 'Tech' },
      { name: 'Web Development', category: 'Tech' },
      { name: 'Cybersecurity', category: 'Tech' },
      { name: 'Robotics', category: 'Tech' },
      { name: 'Gaming', category: 'Entertainment' },
      { name: 'Anime', category: 'Entertainment' },
      { name: 'Movies & TV', category: 'Entertainment' },
      { name: 'Cricket', category: 'Sports' },
      { name: 'Football', category: 'Sports' },
      { name: 'Basketball', category: 'Sports' },
      { name: 'Badminton', category: 'Sports' },
      { name: 'Gym & Fitness', category: 'Health' },
      { name: 'Yoga', category: 'Health' },
      { name: 'Running', category: 'Health' },
      { name: 'Cooking', category: 'Lifestyle' },
      { name: 'Travel', category: 'Lifestyle' },
      { name: 'Photography', category: 'Lifestyle' },
      { name: 'Startups', category: 'Career' },
      { name: 'Finance', category: 'Career' },
      { name: 'Marketing', category: 'Career' },
      { name: 'Public Speaking', category: 'Career' },
      { name: 'Debate', category: 'Academic' },
      { name: 'Research', category: 'Academic' },
      { name: 'Mathematics', category: 'Academic' },
    ].map((i) =>
      prisma.interest.upsert({
        where: { name: i.name },
        update: {},
        create: i,
      })
    )
  );
  console.log(`✅ Created ${interests.length} interests`);

  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
