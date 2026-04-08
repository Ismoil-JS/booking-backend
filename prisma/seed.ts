import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const SEED_ADMINS = [
  {
    fullName: 'Ismoil Turgunpulatov',
    email: 'ismoilturgunpulatov@gmail.com',
    password: 'password123',
    phone: '+998882512004',
  },
  {
    fullName: 'Ismoil',
    email: 'ismoil@gmail.com',
    password: 'ismoil',
    phone: '+998882512004',
  },
];

const SEED_CATEGORIES = [
  { name: 'IELTS', slug: 'ielts' },
  { name: 'Software Engineering', slug: 'software-engineering' },
  { name: 'Marketing', slug: 'marketing' },
  { name: 'Mathematics', slug: 'mathematics' },
  { name: 'Languages', slug: 'languages' },
];

async function main() {
  for (const cat of SEED_CATEGORIES) {
    await prisma.tutorCategory.upsert({
      where: { slug: cat.slug },
      create: cat,
      update: { name: cat.name },
    });
  }
  console.log('Tutor categories seeded');

  for (const admin of SEED_ADMINS) {
    const existing = await prisma.user.findUnique({ where: { email: admin.email } });
    if (existing) {
      console.log(`Admin already exists: ${admin.email}`);
      continue;
    }
    const passwordHash = await bcrypt.hash(admin.password, 10);
    await prisma.user.create({
      data: {
        fullName: admin.fullName,
        email: admin.email,
        passwordHash,
        phone: admin.phone,
        userType: 'ADMIN',
      },
    });
    console.log(`Created admin: ${admin.email}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
