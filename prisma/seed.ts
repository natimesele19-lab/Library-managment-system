import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be configured before initializing Prisma.");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.LIBRARY_ADMIN_EMAIL;
  const password = process.env.LIBRARY_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error("Set LIBRARY_ADMIN_EMAIL and LIBRARY_ADMIN_PASSWORD (at least 12 characters) before seeding.");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email: email.toLowerCase().trim() },
    update: { name: "Library Administrator", passwordHash, role: "ADMIN", active: true },
    create: { name: "Library Administrator", email: email.toLowerCase().trim(), passwordHash, role: "ADMIN" },
  });
  console.log(`Admin account is ready for ${email.toLowerCase().trim()}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
