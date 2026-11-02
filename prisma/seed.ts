import "dotenv/config";
import { randomBytes } from "node:crypto";
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
  const platformEmail = (process.env.PLATFORM_OWNER_EMAIL || "admin@library.com").toLowerCase().trim();
  const platformPassword = process.env.PLATFORM_OWNER_PASSWORD;
  if (platformPassword && platformPassword.length < 12) {
    throw new Error("PLATFORM_OWNER_PASSWORD must contain at least 12 characters.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(platformEmail)) {
    throw new Error("PLATFORM_OWNER_EMAIL must be a valid email address.");
  }
  if (platformEmail === email.toLowerCase().trim()) {
    throw new Error("The platform owner email must differ from the school administrator email.");
  }
  await prisma.tenant.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", slug: "default", name: "Yeka D/M/K/Mihret School Library" },
  });
  await prisma.librarySetting.upsert({
    where: { tenantId: "default" },
    update: {},
    create: { tenantId: "default", libraryName: "Yeka D/M/K/Mihret School Library", appTitle: "Library Management" },
  });
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: "default", email: email.toLowerCase().trim() } },
    update: { name: "Library Administrator", passwordHash, role: "ADMIN", active: true, tenantId: "default" },
    create: { name: "Library Administrator", email: email.toLowerCase().trim(), passwordHash, role: "ADMIN", tenantId: "default" },
  });
  console.log(`Admin account is ready for ${email.toLowerCase().trim()}.`);
  const platformOwner = await prisma.user.findFirst({ where: { email: platformEmail, tenantId: null } });
  if (platformPassword) {
    const platformPasswordHash = await bcrypt.hash(platformPassword, 12);
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
  } else if (platformOwner) {
    if (platformOwner.role !== "SUPER_ADMIN") {
      throw new Error(`Cannot provision the platform owner: ${platformEmail} is already assigned to a non-platform account.`);
    }
    console.log(`Platform owner account already exists for ${platformEmail}; its password was not changed.`);
  } else {
    const generatedPassword = randomBytes(32).toString("base64url");
    const generatedPasswordHash = await bcrypt.hash(generatedPassword, 12);
    await prisma.user.create({
      data: {
        name: "Platform Owner", email: platformEmail, passwordHash: generatedPasswordHash,
        role: "SUPER_ADMIN", active: true, tenantId: null,
      },
    });
    console.log(`\nNew Super Admin account created.\nEmail: ${platformEmail}\nTemporary password (shown only once): ${generatedPassword}\nStore it securely and change it after signing in.\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
