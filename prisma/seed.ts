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
  const platformEmail = process.env.PLATFORM_OWNER_EMAIL?.toLowerCase().trim();
  const platformPassword = process.env.PLATFORM_OWNER_PASSWORD;
  if (Boolean(platformEmail) !== Boolean(platformPassword) || (platformPassword && platformPassword.length < 12)) {
    throw new Error("Set both PLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD (at least 12 characters) to provision the platform owner.");
  }
  if (platformEmail && platformEmail === email.toLowerCase().trim()) {
    throw new Error("The platform owner email must differ from the school administrator email.");
  }
  await prisma.tenant.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", slug: "default", name: "Libra" },
  });
  await prisma.librarySetting.upsert({
    where: { tenantId: "default" },
    update: {},
    create: { tenantId: "default", libraryName: "Libra", appTitle: "Library Management" },
  });
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: "default", email: email.toLowerCase().trim() } },
    update: { name: "Library Administrator", passwordHash, role: "ADMIN", active: true, tenantId: "default" },
    create: { name: "Library Administrator", email: email.toLowerCase().trim(), passwordHash, role: "ADMIN", tenantId: "default" },
  });
  console.log(`Admin account is ready for ${email.toLowerCase().trim()}.`);
  if (platformEmail && platformPassword) {
    const platformPasswordHash = await bcrypt.hash(platformPassword, 12);
    const platformOwner = await prisma.user.findFirst({ where: { email: platformEmail, tenantId: null } });
    if (platformOwner) {
      await prisma.user.update({
        where: { id: platformOwner.id },
        data: { name: "Platform Owner", passwordHash: platformPasswordHash, role: "SUPER_ADMIN", active: true, tenantId: null },
      });
    } else {
      await prisma.user.create({
        data: { name: "Platform Owner", email: platformEmail, passwordHash: platformPasswordHash, role: "SUPER_ADMIN", active: true, tenantId: null },
      });
    }
    console.log(`Platform owner account is ready for ${platformEmail}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
