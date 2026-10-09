import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import multer from "multer";
import { PDFDocument } from "pdf-lib";
import { FormEntity, Prisma } from "@prisma/client";
import { authenticate, requireAdmin, requireStaff, type AuthRequest } from "./auth.js";
import { prisma } from "./prisma.js";
import { sendDailyOverdueReminders } from "./reminders.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || "uploads");
const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  ...(process.env.CLIENT_ORIGIN || "").split(",").map((origin) => origin.trim()).filter(Boolean),
]);
const finePerDay = Number(process.env.FINE_PER_DAY || 5);
const asyncRoute = (handler: (req: AuthRequest, res: Response) => Promise<unknown>) =>
  (req: AuthRequest, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed by CORS.`));
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.use("/api/admin/change-password", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/public/settings", asyncRoute(async (_req, res) => {
  const settings = await prisma.librarySetting.findUnique({ where: { id: "global" } });
  res.json({
    libraryName: settings?.libraryName || "Libra",
    appTitle: settings?.appTitle || "Library Management",
    defaultLanguage: settings?.defaultLanguage || "en",
    englishText: settings ? JSON.parse(settings.englishText) : {},
    amharicText: settings ? JSON.parse(settings.amharicText) : {},
  });
}));
app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const { identifier, email, password, mode } = req.body as { identifier?: unknown; email?: unknown; password?: unknown; mode?: unknown };
  const loginIdentifier = typeof identifier === "string" ? identifier.trim() : typeof email === "string" ? email.trim() : "";
  if (!loginIdentifier || typeof password !== "string" || !password ||
      (mode !== undefined && mode !== "member" && mode !== "staff")) {
    res.status(400).json({ error: "A valid login identifier and password are required." });
    return;
  }
  const user = mode === "member"
    ? (await prisma.patron.findFirst({
      where: { active: true, OR: [
        { memberCode: loginIdentifier },
        { email: loginIdentifier.toLowerCase() },
      ] },
      include: { account: { include: { patron: { select: { id: true, name: true, type: true, active: true } } } } },
    }))?.account
    : await prisma.user.findUnique({
      where: { email: loginIdentifier.toLowerCase() },
      include: { patron: { select: { id: true, name: true, type: true, active: true } } },
    });
  if (!user?.active || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  if ((mode === "member" && user.role !== "MEMBER") || (mode === "staff" && user.role === "MEMBER")) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  if (user.role === "MEMBER" && (!user.patron?.active || !user.patronId)) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters.");
  const token = jwt.sign({ role: user.role }, secret, { subject: user.id, expiresIn: "8h", issuer: "library-management" });
  res.json({ token, user: {
    id: user.id, name: user.patron?.name || user.name, email: user.email, role: user.role,
    patronId: user.patronId || undefined, patronType: user.patron?.type,
  } });
}));

app.use("/api", authenticate, (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== "MEMBER") { next(); return; }
  const memberRead = req.method === "GET" && (
    ["/books", "/auth/me", "/portal/me", "/portal/loans", "/portal/reservations", "/media"].includes(req.path) ||
    /^\/media\/[^/]+\/file$/.test(req.path)
  );
  const memberReservation = req.method === "POST" &&
    (req.path === "/portal/reservations" || /^\/portal\/reservations\/[^/]+\/cancel$/.test(req.path));
  if (memberRead || memberReservation) { next(); return; }
  res.status(403).json({ error: "This account cannot access staff library operations." });
});

app.get("/api/auth/me", asyncRoute(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id }, include: { patron: { select: { name: true, type: true } } },
  });
  if (!user) { res.status(401).json({ error: "Account not found." }); return; }
  res.json({ id: user.id, name: user.patron?.name || user.name, email: user.email, role: user.role, patronId: user.patronId || undefined, patronType: user.patron?.type });
}));

const changeAdminPassword = asyncRoute(async (req, res) => {
  try {
    const body: unknown = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "A valid password change request is required." });
      return;
    }
    const { currentPassword, newPassword } = body as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof currentPassword !== "string" || !currentPassword ||
        typeof newPassword !== "string" || newPassword.length < 12 ||
        Buffer.byteLength(newPassword, "utf8") > 72) {
      res.status(400).json({ error: "Enter your current password and a new password of at least 12 characters and no more than 72 UTF-8 bytes." });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, passwordHash: true },
    });
    if (!user) {
      res.status(404).json({ error: "Administrator account not found." });
      return;
    }
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      res.status(400).json({ error: "Current password is incorrect." });
      return;
    }
    if (currentPassword === newPassword) {
      res.status(400).json({ error: "The new password must differ from the current password." });
      return;
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await audit(req, "UPDATE", "ADMIN_PASSWORD", user.id);
    res.json({ message: "Password updated successfully." });
  } catch (error) {
    console.error(`Admin password change failed (${req.method} ${req.path}).`, error);
    res.status(500).json({ error: "Unable to change password. Please try again." });
  }
});

app.route("/api/admin/change-password")
  .post(requireAdmin, changeAdminPassword)
  .put(requireAdmin, changeAdminPassword);

const getAdminSettings = asyncRoute(async (_req, res) => {
  const settings = await prisma.librarySetting.findUnique({ where: { id: "global" } });
  res.json({
    libraryName: settings?.libraryName || "Libra",
    appTitle: settings?.appTitle || "Library Management",
    defaultLanguage: settings?.defaultLanguage || "en",
    englishText: settings ? JSON.parse(settings.englishText) : {},
    amharicText: settings ? JSON.parse(settings.amharicText) : {},
  });
});

const saveAdminSettings = asyncRoute(async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "A valid library settings object is required." });
    return;
  }
  const { libraryName, appTitle } = req.body as { libraryName?: unknown; appTitle?: unknown };
  if (typeof libraryName !== "string" || !libraryName.trim() || libraryName.trim().length > 80 ||
      typeof appTitle !== "string" || !appTitle.trim() || appTitle.trim().length > 80) {
    res.status(400).json({ error: "Library name and app title must each contain 1–80 characters." });
    return;
  }
  const current = req.body.defaultLanguage === undefined
    ? await prisma.librarySetting.findUnique({ where: { id: "global" }, select: { defaultLanguage: true } })
    : null;
  const defaultLanguage = req.body.defaultLanguage ?? current?.defaultLanguage ?? "en";
  if (defaultLanguage !== "en" && defaultLanguage !== "am") {
    res.status(400).json({ error: "Default language must be either 'en' or 'am'." });
    return;
  }
  const englishText = validateTranslationMap(req.body.englishText);
  const amharicText = validateTranslationMap(req.body.amharicText);
  const settings = await prisma.librarySetting.upsert({
    where: { id: "global" },
    create: { id: "global", libraryName: libraryName.trim(), appTitle: appTitle.trim(), defaultLanguage, englishText: JSON.stringify(englishText), amharicText: JSON.stringify(amharicText) },
    update: { libraryName: libraryName.trim(), appTitle: appTitle.trim(), defaultLanguage, englishText: JSON.stringify(englishText), amharicText: JSON.stringify(amharicText) },
  });
  await audit(req, "UPDATE", "LIBRARY_SETTINGS", settings.id);
  res.json({ libraryName: settings.libraryName, appTitle: settings.appTitle, defaultLanguage: settings.defaultLanguage, englishText, amharicText });
});

app.route("/api/admin/settings")
  .get(requireAdmin, getAdminSettings)
  .post(requireAdmin, saveAdminSettings)
  .put(requireAdmin, saveAdminSettings);
app.put("/api/settings", requireAdmin, saveAdminSettings);

app.get("/api/portal/me", asyncRoute(async (req, res) => {
  if (!req.user?.patronId) { res.status(403).json({ error: "A linked patron account is required." }); return; }
  const patron = await prisma.patron.findUnique({
    where: { id: req.user.patronId },
    select: { id: true, name: true, email: true, memberCode: true, type: true, grade: true, department: true },
  });
  if (!patron) { res.status(404).json({ error: "Patron record not found." }); return; }
  res.json(patron);
}));

app.get("/api/dashboard", requireStaff, asyncRoute(async (_req, res) => {
  const now = new Date();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const startMonth = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const [totalBooks, available, activeStudents, borrowersThisMonth, activeItems, overdueItems, recent, popularItems, returnedRecent, paidFine] = await Promise.all([
    prisma.book.aggregate({ _sum: { copies: true } }),
    prisma.book.aggregate({ _sum: { availableCopies: true } }),
    prisma.patron.count({ where: { type: "STUDENT", active: true } }),
    prisma.loan.groupBy({ by: ["patronId"], where: { issuedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } } }),
    prisma.loanItem.count({ where: { returnedAt: null } }),
    prisma.loanItem.count({ where: { returnedAt: null, loan: { dueDate: { lt: today } } } }),
    prisma.loanItem.findMany({
      take: 6, orderBy: { loan: { issuedAt: "desc" } },
      include: { book: { select: { title: true, author: true } }, loan: { include: { patron: { select: { name: true } } } } },
    }),
    prisma.loanItem.groupBy({
      by: ["bookId"], _count: { bookId: true }, where: { loan: { issuedAt: { gte: startMonth } } },
      orderBy: { _count: { bookId: "desc" } }, take: 500,
    }),
    prisma.loanItem.findMany({ where: { loan: { issuedAt: { gte: startMonth } } }, select: { loan: { select: { issuedAt: true } }, returnedAt: true } }),
    prisma.finePayment.aggregate({ _sum: { amount: true } }),
  ]);
  const months = Array.from({ length: 6 }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + offset, 1);
    return { date, month: date.toLocaleString("en", { month: "short" }), borrowed: 0, returned: 0 };
  });
  for (const item of returnedRecent) {
    const month = months.find((entry) => entry.date.getFullYear() === item.loan.issuedAt.getFullYear() && entry.date.getMonth() === item.loan.issuedAt.getMonth());
    if (month) {
      month.borrowed += 1;
      if (item.returnedAt) month.returned += 1;
    }
  }
  const popularBooks = await prisma.book.findMany({ where: { id: { in: popularItems.map((item) => item.bookId) } }, select: { id: true, category: true } });
  const categoryTotals = new Map<string, number>();
  for (const item of popularItems) {
    const category = popularBooks.find((book) => book.id === item.bookId)?.category || "Other";
    categoryTotals.set(category, (categoryTotals.get(category) || 0) + item._count.bookId);
  }
  const allCategoryLoans = [...categoryTotals.values()].reduce((sum, count) => sum + count, 0) || 1;
  const categories = [...categoryTotals.entries()].map(([name, count]) => ({ name, value: Math.round((count / allCategoryLoans) * 100) })).slice(0, 5);
  res.json({
    totalBooks: totalBooks._sum.copies || 0,
    availableBooks: available._sum.availableCopies || 0,
    borrowedBooks: activeItems,
    activeStudents,
    borrowersThisMonth: borrowersThisMonth.length,
    overdueBooks: overdueItems,
    finesCollected: Number(paidFine._sum.amount || 0),
    borrowingTrends: months.map(({ month, borrowed, returned }) => ({ month, borrowed, returned })),
    categories,
    recentLoans: recent.map((item) => ({
      id: item.id, title: item.book.title, author: item.book.author, borrowerName: item.loan.patron.name,
      dueDate: item.loan.dueDate.toISOString(), status: item.returnedAt ? "RETURNED" : item.loan.dueDate < today ? "OVERDUE" : "CHECKED_OUT",
    })),
  });
}));

app.get("/api/books", asyncRoute(async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const where: Prisma.BookWhereInput = search ? { OR: [
    { title: { contains: search } }, { author: { contains: search } },
    { isbn: { contains: search } }, { category: { contains: search } },
  ] } : {};
  if (req.user?.role === "MEMBER") {
    const books = await prisma.book.findMany({
      where, orderBy: { title: "asc" }, take: 500,
      select: { id: true, title: true, author: true, category: true, isbn: true, description: true, publisher: true, publishedYear: true, shelfLocation: true, availableCopies: true },
    });
    res.json(books);
    return;
  }
  res.json(await prisma.book.findMany({ where, orderBy: { title: "asc" }, take: 500 }));
}));

app.post("/api/books", requireStaff, asyncRoute(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!requiredText(body.title) || !requiredText(body.author)) { res.status(400).json({ error: "Title and author are required." }); return; }
  const copies = body.copies === undefined ? 1 : positiveInteger(body.copies, NaN);
  if (!Number.isInteger(copies)) { res.status(400).json({ error: "Copies must be a positive whole number." }); return; }
  const publishedYear = optionalYear(body.publishedYear);
  const customFields = await validateCustomFields(FormEntity.BOOK, body.customFields, true);
  const book = await prisma.book.create({ data: {
    title: String(body.title).trim(), author: String(body.author).trim(), isbn: optionalText(body.isbn),
    category: optionalText(body.category), description: optionalText(body.description), publisher: optionalText(body.publisher), publishedYear,
    shelfLocation: optionalText(body.shelfLocation), copies, availableCopies: copies,
    customFields,
  } });
  await audit(req, "CREATE", "BOOK", book.id);
  res.status(201).json(book);
}));

app.put("/api/books/:id", requireStaff, asyncRoute(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const current = await prisma.book.findUnique({ where: { id: req.params.id } });
  if (!current) { res.status(404).json({ error: "Book not found." }); return; }
  const data: Prisma.BookUpdateInput = {};
  for (const key of ["title", "author", "isbn", "category", "description", "publisher", "shelfLocation"] as const) {
    if (key in body) Object.assign(data, { [key]: optionalText(body[key]) });
  }
  if ("publishedYear" in body) data.publishedYear = optionalYear(body.publishedYear);
  if ("copies" in body) {
    const copies = positiveInteger(body.copies, NaN);
    if (!Number.isInteger(copies) || copies < current.copies - current.availableCopies) {
      res.status(400).json({ error: "Total copies cannot be lower than the number currently on loan." });
      return;
    }
    data.copies = copies;
    data.availableCopies = current.availableCopies + copies - current.copies;
  }
  if ("customFields" in body) data.customFields = await validateCustomFields(FormEntity.BOOK, body.customFields, false);
  const book = await prisma.book.update({ where: { id: current.id }, data });
  await audit(req, "UPDATE", "BOOK", book.id);
  res.json(book);
}));

app.delete("/api/books/:id", requireStaff, asyncRoute(async (req, res) => {
  const book = await prisma.book.findUnique({ where: { id: req.params.id } });
  if (!book) { res.status(404).json({ error: "Book not found." }); return; }
  if (book.availableCopies !== book.copies) { res.status(409).json({ error: "A book with active loans cannot be deleted." }); return; }
  if (await prisma.loanItem.count({ where: { bookId: book.id } })) { res.status(409).json({ error: "A book with circulation history cannot be deleted." }); return; }
  await prisma.book.delete({ where: { id: book.id } });
  await audit(req, "DELETE", "BOOK", book.id);
  res.status(204).end();
}));

app.get("/api/patrons", asyncRoute(async (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  if (type && !Object.hasOwn({ STUDENT: 1, TEACHER: 1 }, type)) { res.status(400).json({ error: "Invalid patron type." }); return; }
  const patrons = await prisma.patron.findMany({
    where: { ...(type ? { type: type as "STUDENT" | "TEACHER" } : {}), ...(search ? { OR: [
      { name: { contains: search } }, { memberCode: { contains: search } },
      { email: { contains: search } },
    ] } : {}) }, orderBy: { name: "asc" }, take: 500,
    include: { account: { select: { id: true } } },
  });
  res.json(patrons.map(({ account, ...patron }) => ({ ...patron, hasPortalAccount: Boolean(account) })));
}));

app.post("/api/patrons", asyncRoute(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!requiredText(body.name) || !requiredText(body.email) ||
      !["STUDENT", "TEACHER"].includes(String(body.type))) {
    res.status(400).json({ error: "Name, email, and a valid patron type are required." });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email))) { res.status(400).json({ error: "Enter a valid email address." }); return; }
  const type = body.type as "STUDENT" | "TEACHER";
  const memberCode = optionalText(body.memberCode) || generateMemberCode(type);
  const password = patronPortalPassword(body.password);
  const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
  const customFields = await validateCustomFields(FormEntity.PATRON, body.customFields, true);
  try {
    const patron = await prisma.$transaction(async (transaction) => {
      const created = await transaction.patron.create({ data: {
        name: String(body.name).trim(), email: String(body.email).trim().toLowerCase(), memberCode,
        type, phone: optionalText(body.phone), grade: optionalText(body.grade),
        department: optionalText(body.department), customFields,
      } });
      if (passwordHash) {
        await transaction.user.create({
          data: { name: created.name, email: created.email, passwordHash, role: "MEMBER", patronId: created.id },
        });
      }
      return created;
    });
    await audit(req, "CREATE", "PATRON", patron.id);
    res.status(201).json(patron);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "The email address or member code is already in use.");
    }
    throw error;
  }
}));

app.put("/api/patrons/:id", asyncRoute(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if ("email" in body && (!requiredText(body.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  if ("memberCode" in body && !requiredText(body.memberCode)) {
    res.status(400).json({ error: "Member code cannot be empty." });
    return;
  }
  const password = patronPortalPassword(body.password);
  const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
  const data: Prisma.PatronUpdateInput = {};
  for (const key of ["name", "email", "memberCode", "phone", "grade", "department"] as const) {
    if (key in body) Object.assign(data, { [key]: key === "email" || key === "memberCode" ? String(body[key]).trim() : optionalText(body[key]) });
  }
  if ("type" in body && ["STUDENT", "TEACHER"].includes(String(body.type))) data.type = body.type as "STUDENT" | "TEACHER";
  if ("customFields" in body) data.customFields = await validateCustomFields(FormEntity.PATRON, body.customFields, false);
  try {
    const patron = await prisma.$transaction(async (transaction) => {
      const current = await transaction.patron.findUnique({ where: { id: req.params.id }, include: { account: true } });
      if (!current) throw new ApiError(404, "Patron not found.");
      const updated = await transaction.patron.update({ where: { id: current.id }, data });
      if (current.account) {
        await transaction.user.update({
          where: { id: current.account.id },
          data: {
            name: updated.name,
            email: updated.email,
            ...(passwordHash ? { passwordHash, active: true, role: "MEMBER" as const } : {}),
          },
        });
      } else if (passwordHash) {
        const existing = await transaction.user.findUnique({ where: { email: updated.email } });
        if (existing) throw new ApiError(409, "This email address is already used by another account.");
        await transaction.user.create({
          data: { name: updated.name, email: updated.email, passwordHash, role: "MEMBER", patronId: updated.id },
        });
      }
      return updated;
    });
    await audit(req, "UPDATE", "PATRON", patron.id);
    res.json(patron);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") { res.status(404).json({ error: "Patron not found." }); return; }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "The email address or member code is already in use.");
    }
    throw error;
  }
}));

app.post("/api/patrons/:id/account", asyncRoute(async (req, res) => {
  const password = req.body.password;
  if (typeof password !== "string" || password.length < 12) {
    res.status(400).json({ error: "Portal passwords must contain at least 12 characters." });
    return;
  }
  const patron = await prisma.patron.findUnique({ where: { id: req.params.id }, include: { account: true } });
  if (!patron?.active) { res.status(404).json({ error: "Active patron not found." }); return; }
  if (patron.account && patron.account.email !== patron.email) {
    res.status(409).json({ error: "Resolve the account email conflict before resetting this password." });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const account = await prisma.$transaction(async (transaction) => {
    if (patron.account) {
      return transaction.user.update({
        where: { id: patron.account.id },
        data: { passwordHash, active: true, role: "MEMBER" },
        select: { id: true, email: true },
      });
    }
    const existing = await transaction.user.findUnique({ where: { email: patron.email } });
    if (existing) throw new ApiError(409, "This email address is already used by a staff account.");
    return transaction.user.create({
      data: { name: patron.name, email: patron.email, passwordHash, role: "MEMBER", patronId: patron.id },
      select: { id: true, email: true },
    });
  });
  await audit(req, patron.account ? "RESET_PORTAL_PASSWORD" : "CREATE_PORTAL_ACCOUNT", "PATRON", patron.id);
  res.status(patron.account ? 200 : 201).json({ id: account.id, email: account.email });
}));

app.delete("/api/patrons/:id", asyncRoute(async (req, res) => {
  const patron = await prisma.patron.findUnique({ where: { id: req.params.id } });
  if (!patron) { res.status(404).json({ error: "Patron not found." }); return; }
  if (await prisma.loan.count({ where: { patronId: patron.id } })) { res.status(409).json({ error: "A patron with circulation history cannot be deleted." }); return; }
  await prisma.patron.delete({ where: { id: patron.id } });
  await audit(req, "DELETE", "PATRON", patron.id);
  res.status(204).end();
}));

app.get("/api/loans", asyncRoute(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "ALL";
  if (!["ALL", "ACTIVE", "OVERDUE", "RETURNED"].includes(status)) { res.status(400).json({ error: "Invalid loan status filter." }); return; }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const loans = await prisma.loan.findMany({
    where: status === "OVERDUE" ? { status: "ACTIVE", dueDate: { lt: today } } :
      status === "ACTIVE" ? { status: "ACTIVE" } : {},
    include: { patron: { select: { name: true, memberCode: true } }, loanItems: { include: { book: { select: { title: true, author: true } }, payments: true } } },
    orderBy: { issuedAt: "desc" }, take: 500,
  });
  const items = loans.flatMap((loan) => loan.loanItems.map((item) => ({
    id: item.id, loanItemId: item.id, loanId: loan.id, title: item.book.title, author: item.book.author,
    borrowerName: loan.patron.name, memberCode: loan.patron.memberCode, dueDate: loan.dueDate.toISOString(),
    returnedAt: item.returnedAt?.toISOString() || null, status: item.returnedAt ? "RETURNED" : loan.dueDate < today ? "OVERDUE" : "CHECKED_OUT",
    fine: Number(item.fine),
    finePaid: item.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    fineRemaining: Math.max(0, Number(item.fine) - item.payments.reduce((sum, payment) => sum + Number(payment.amount), 0)),
  })));
  res.json(status === "RETURNED" ? items.filter((item) => item.status === "RETURNED") :
    status === "ACTIVE" || status === "OVERDUE" ? items.filter((item) => item.status !== "RETURNED") : items);
}));

app.get("/api/portal/loans", asyncRoute(async (req, res) => {
  const patronId = req.user?.patronId;
  if (!patronId) { res.status(403).json({ error: "A linked patron account is required." }); return; }
  const loans = await prisma.loan.findMany({
    where: { patronId },
    include: { loanItems: { include: { book: { select: { title: true, author: true } }, payments: true } } },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  res.json(loans.flatMap((loan) => loan.loanItems.map((item) => {
    const fine = Number(item.fine);
    const paid = item.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const overdueDays = item.returnedAt ? 0 : Math.max(0, Math.floor((today.getTime() - new Date(loan.dueDate).setUTCHours(0, 0, 0, 0)) / 86_400_000));
    const assessedFine = Math.max(fine, roundMoney(overdueDays * finePerDay));
    return {
      id: item.id,
      loanId: loan.id,
      title: item.book.title,
      author: item.book.author,
      issuedAt: loan.issuedAt.toISOString(),
      dueDate: loan.dueDate.toISOString(),
      returnedAt: item.returnedAt?.toISOString() || null,
      status: item.returnedAt ? "RETURNED" : loan.dueDate < today ? "OVERDUE" : "CHECKED_OUT",
      fine: assessedFine,
      fineRemaining: Math.max(0, roundMoney(assessedFine - paid)),
    };
  })));
}));

app.get("/api/portal/reservations", asyncRoute(async (req, res) => {
  const patronId = req.user?.patronId;
  if (!patronId) { res.status(403).json({ error: "A linked patron account is required." }); return; }
  const reservations = await prisma.bookReservation.findMany({
    where: { patronId },
    include: { book: { select: { id: true, title: true, author: true, availableCopies: true, category: true } } },
    orderBy: { requestedAt: "desc" },
    take: 200,
  });
  res.json(reservations);
}));

app.post("/api/portal/reservations", asyncRoute(async (req, res) => {
  const patronId = req.user?.patronId;
  const bookId = typeof req.body.bookId === "string" ? req.body.bookId.trim() : "";
  if (!patronId || !bookId) { res.status(400).json({ error: "A book is required to place a reservation request." }); return; }
  const [book, previousRequest] = await Promise.all([
    prisma.book.findUnique({ where: { id: bookId }, select: { id: true } }),
    prisma.bookReservation.findFirst({
      where: { patronId, bookId, status: { in: ["REQUESTED", "RESERVED"] } },
      select: { id: true },
    }),
  ]);
  if (!book) { res.status(404).json({ error: "Book not found." }); return; }
  if (previousRequest) { res.status(409).json({ error: "You already have an active request for this book." }); return; }
  const reservation = await prisma.bookReservation.create({ data: { patronId, bookId }, include: { book: { select: { title: true, author: true } } } });
  res.status(201).json(reservation);
}));

app.post("/api/portal/reservations/:id/cancel", asyncRoute(async (req, res) => {
  const patronId = req.user?.patronId;
  if (!patronId) { res.status(403).json({ error: "A linked patron account is required." }); return; }
  const result = await prisma.bookReservation.updateMany({
    where: { id: req.params.id, patronId, status: { in: ["REQUESTED", "RESERVED"] } },
    data: { status: "CANCELLED" },
  });
  if (!result.count) { res.status(404).json({ error: "Active reservation not found." }); return; }
  res.json({ id: req.params.id, status: "CANCELLED" });
}));

app.get("/api/reservations", requireStaff, asyncRoute(async (_req, res) => {
  res.json(await prisma.bookReservation.findMany({
    include: { patron: { select: { name: true, memberCode: true, email: true } }, book: { select: { title: true, author: true } } },
    orderBy: { requestedAt: "asc" },
    take: 500,
  }));
}));

app.put("/api/reservations/:id", requireStaff, asyncRoute(async (req, res) => {
  const allowedStatuses = ["RESERVED", "FULFILLED", "CANCELLED"] as const;
  const status = typeof req.body.status === "string"
    ? allowedStatuses.find((candidate) => candidate === req.body.status)
    : undefined;
  if (!status) {
    res.status(400).json({ error: "Reservation status must be RESERVED, FULFILLED, or CANCELLED." });
    return;
  }
  if (status === "FULFILLED") {
    const requestedDueDate = req.body.dueDate;
    const dueDate = requestedDueDate === undefined
      ? new Date(Date.now() + 14 * 86_400_000)
      : typeof requestedDueDate === "string" && !Number.isNaN(Date.parse(requestedDueDate))
        ? new Date(requestedDueDate)
        : null;
    const earliestDueDate = new Date();
    earliestDueDate.setUTCHours(0, 0, 0, 0);
    if (!dueDate || dueDate.getTime() < earliestDueDate.getTime()) {
      res.status(400).json({ error: "A valid due date on or after today is required to issue a reservation." });
      return;
    }
    const result = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.bookReservation.findUnique({
        where: { id: req.params.id },
        include: { patron: { select: { id: true, name: true, memberCode: true, active: true } }, book: { select: { id: true, title: true } } },
      });
      if (!existing) throw new ApiError(404, "Reservation not found.");
      if (existing.status !== "REQUESTED" && existing.status !== "RESERVED") {
        throw new ApiError(409, `Reservation cannot be issued from ${existing.status}.`);
      }
      if (!existing.patron.active) throw new ApiError(409, "An inactive patron cannot receive a loan.");
      const inventoryUpdate = await transaction.book.updateMany({
        where: { id: existing.bookId, availableCopies: { gt: 0 } },
        data: { availableCopies: { decrement: 1 } },
      });
      if (!inventoryUpdate.count) throw new ApiError(409, "This book is no longer available to issue.");
      const reservationUpdate = await transaction.bookReservation.updateMany({
        where: { id: existing.id, status: existing.status },
        data: { status: "FULFILLED" },
      });
      if (!reservationUpdate.count) throw new ApiError(409, "Reservation status changed; reload and try again.");
      const loan = await transaction.loan.create({
        data: { patronId: existing.patronId, dueDate, loanItems: { create: [{ bookId: existing.bookId }] } },
        include: { loanItems: true },
      });
      return { reservation: existing, loan };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await audit(req, "FULFILL_BOOK_RESERVATION", "BOOK_RESERVATION", result.reservation.id, { loanId: result.loan.id });
    await audit(req, "CREATE", "LOAN", result.loan.id, { reservationId: result.reservation.id, bookCount: 1 });
    res.json({ id: result.reservation.id, status: "FULFILLED", loanId: result.loan.id });
    return;
  }
  const existing = await prisma.bookReservation.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: "Reservation not found." }); return; }
  const validTransition =
    (existing.status === "REQUESTED" && (status === "RESERVED" || status === "CANCELLED")) ||
    (existing.status === "RESERVED" && status === "CANCELLED");
  if (!validTransition) {
    res.status(409).json({ error: `Reservation cannot transition from ${existing.status} to ${status}.` });
    return;
  }
  const update = await prisma.bookReservation.updateMany({
    where: { id: existing.id, status: existing.status },
    data: { status },
  });
  if (!update.count) { res.status(409).json({ error: "Reservation status changed; reload and try again." }); return; }
  const reservation = await prisma.bookReservation.findUniqueOrThrow({
    where: { id: existing.id },
    include: { patron: { select: { name: true, memberCode: true } }, book: { select: { title: true } } },
  });
  await audit(req, "UPDATE", "BOOK_RESERVATION", reservation.id, { status });
  res.json(reservation);
}));

app.post("/api/notifications/overdue/run", requireAdmin, asyncRoute(async (_req, res) => {
  res.json(await sendDailyOverdueReminders());
}));

app.post("/api/loans", asyncRoute(async (req, res) => {
  const { patronId, bookIds, dueDate } = req.body as { patronId?: string; bookIds?: string[]; dueDate?: string };
  const earliestDueDate = new Date();
  earliestDueDate.setUTCHours(0, 0, 0, 0);
  if (!patronId || !Array.isArray(bookIds) || bookIds.length < 1 || bookIds.length > 20 || !dueDate || Number.isNaN(Date.parse(dueDate)) || Date.parse(dueDate) < earliestDueDate.getTime()) {
    res.status(400).json({ error: "A borrower, 1–20 books, and a valid due date are required." });
    return;
  }
  if (new Set(bookIds).size !== bookIds.length) { res.status(400).json({ error: "A book may only be selected once per transaction." }); return; }
  const loan = await prisma.$transaction(async (transaction) => {
    const patron = await transaction.patron.findFirst({ where: { id: patronId, active: true } });
    if (!patron) throw new ApiError(404, "Active patron not found.");
    for (const bookId of bookIds) {
      const updated = await transaction.book.updateMany({ where: { id: bookId, availableCopies: { gt: 0 } }, data: { availableCopies: { decrement: 1 } } });
      if (!updated.count) throw new ApiError(409, `Book ${bookId} is unavailable.`);
    }
    return transaction.loan.create({ data: { patronId, dueDate: new Date(dueDate), loanItems: { create: bookIds.map((bookId) => ({ bookId })) } }, include: { loanItems: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(req, "CREATE", "LOAN", loan.id, { bookCount: bookIds.length });
  res.status(201).json(loan);
}));

app.post("/api/loans/items/:id/return", asyncRoute(async (req, res) => {
  const item = await returnLoanItem(req.params.id);
  await audit(req, "RETURN", "LOAN_ITEM", item.id, { fine: Number(item.fine) });
  res.json(item);
}));

app.post("/api/loans/return", asyncRoute(async (req, res) => {
  const itemIds = req.body.itemIds;
  if (!Array.isArray(itemIds) || itemIds.length < 1 || itemIds.length > 100 ||
      itemIds.some((id: unknown) => typeof id !== "string" || !id) ||
      new Set(itemIds).size !== itemIds.length) {
    res.status(400).json({ error: "Provide 1–100 unique loan item IDs to return." });
    return;
  }
  const returned = await returnLoanItems(itemIds);
  await Promise.all(returned.map((item) => audit(req, "RETURN", "LOAN_ITEM", item.id, { fine: Number(item.fine) })));
  res.json(returned);
}));

app.post("/api/loans/scan/return", asyncRoute(async (req, res) => {
  const code = typeof req.body.code === "string" ? req.body.code.trim() : "";
  if (!code || code.length > 128) { res.status(400).json({ error: "A valid book barcode or ISBN is required." }); return; }
  const book = await prisma.book.findFirst({
    where: { OR: [{ id: code }, { isbn: code }] },
    select: { id: true, title: true },
  });
  if (!book) { res.status(404).json({ error: "No book matches that barcode." }); return; }
  const loanItem = await prisma.loanItem.findFirst({
    where: { bookId: book.id, returnedAt: null, loan: { status: "ACTIVE" } },
    include: { loan: { include: { patron: { select: { name: true, memberCode: true } } } } },
    orderBy: { loan: { issuedAt: "asc" } },
  });
  if (!loanItem) { res.status(409).json({ error: "No active checkout was found for this book." }); return; }
  const returned = await returnLoanItem(loanItem.id);
  await audit(req, "SCAN_RETURN", "LOAN_ITEM", returned.id, { bookId: book.id, borrowerId: loanItem.loan.patronId });
  res.json({ id: returned.id, title: book.title, borrowerName: loanItem.loan.patron.name, memberCode: loanItem.loan.patron.memberCode, fine: Number(returned.fine) });
}));

app.post("/api/loans/items/:id/fines/pay", asyncRoute(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: "Payment must be a positive amount." }); return; }
  const payment = await prisma.$transaction(async (transaction) => {
    const item = await transaction.loanItem.findUnique({ where: { id: req.params.id }, include: { payments: true } });
    if (!item) throw new ApiError(404, "Loan item not found.");
    const balance = Number(item.fine) - item.payments.reduce((sum, entry) => sum + Number(entry.amount), 0);
    if (amount > balance) throw new ApiError(409, "Payment cannot exceed the outstanding fine.");
    return transaction.finePayment.create({ data: { loanItemId: item.id, amount: roundMoney(amount), receivedById: req.user!.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(req, "FINE_PAYMENT", "LOAN_ITEM", req.params.id, { amount });
  res.status(201).json(payment);
}));

app.get("/api/inventory", asyncRoute(async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  res.json(await prisma.inventoryAsset.findMany({
    where: search ? { OR: [{ name: { contains: search } }, { category: { contains: search } }] } : {},
    orderBy: { name: "asc" }, take: 500,
  }));
}));

app.post("/api/inventory", asyncRoute(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!requiredText(body.name) || !requiredText(body.category)) { res.status(400).json({ error: "Asset name and category are required." }); return; }
  const quantity = body.quantity === undefined ? 1 : positiveInteger(body.quantity, NaN);
  if (!Number.isInteger(quantity)) { res.status(400).json({ error: "Quantity must be a positive whole number." }); return; }
  const condition = optionalText(body.condition) || "GOOD";
  if (!["NEW", "GOOD", "NEEDS_REPAIR", "WRITTEN_OFF"].includes(condition)) { res.status(400).json({ error: "Invalid asset condition." }); return; }
  const customFields = await validateCustomFields(FormEntity.INVENTORY, body.customFields, true);
  const asset = await prisma.inventoryAsset.create({ data: {
    name: String(body.name).trim(), category: String(body.category).trim(), quantity,
    location: optionalText(body.location), condition, notes: optionalText(body.notes),
    value: optionalMoney(body.value), purchaseDate: optionalDate(body.purchaseDate),
    customFields,
  } });
  await audit(req, "CREATE", "INVENTORY", asset.id);
  res.status(201).json(asset);
}));

app.put("/api/inventory/:id", asyncRoute(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const data: Prisma.InventoryAssetUpdateInput = {};
  for (const key of ["name", "category", "location", "condition", "notes"] as const) {
    if (key in body) Object.assign(data, { [key]: optionalText(body[key]) });
  }
  if ("quantity" in body) {
    const quantity = positiveInteger(body.quantity, NaN);
    if (!Number.isInteger(quantity)) { res.status(400).json({ error: "Quantity must be a positive whole number." }); return; }
    data.quantity = quantity;
  }
  if ("value" in body) data.value = optionalMoney(body.value);
  if ("purchaseDate" in body) data.purchaseDate = optionalDate(body.purchaseDate);
  if ("condition" in body && !["NEW", "GOOD", "NEEDS_REPAIR", "WRITTEN_OFF"].includes(String(body.condition))) {
    res.status(400).json({ error: "Invalid asset condition." });
    return;
  }
  if ("customFields" in body) data.customFields = await validateCustomFields(FormEntity.INVENTORY, body.customFields, false);
  const asset = await prisma.inventoryAsset.update({ where: { id: req.params.id }, data });
  await audit(req, "UPDATE", "INVENTORY", asset.id);
  res.json(asset);
}));

app.delete("/api/inventory/:id", asyncRoute(async (req, res) => {
  await prisma.inventoryAsset.delete({ where: { id: req.params.id } });
  await audit(req, "DELETE", "INVENTORY", req.params.id);
  res.status(204).end();
}));

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage, limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowed = [".pdf", ".mp3", ".wav", ".m4a", ".ogg"];
    if (!allowed.includes(extension)) { callback(new ApiError(400, "Only PDF and supported audio files can be uploaded.")); return; }
    callback(null, true);
  },
});

app.get("/api/media", asyncRoute(async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  res.json(await prisma.mediaAsset.findMany({
    where: search ? { OR: [
      { title: { contains: search, mode: "insensitive" } },
      { author: { contains: search, mode: "insensitive" } },
      { fileName: { contains: search, mode: "insensitive" } },
      { mediaType: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
    ] } : {},
    select: { id: true, title: true, author: true, mediaType: true, category: true, fileName: true, mimeType: true, fileSize: true, createdAt: true },
    orderBy: { createdAt: "desc" }, take: 500,
  }));
}));

app.post("/api/media/upload", upload.single("file"), asyncRoute(async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "A media file is required." }); return; }
  const extension = path.extname(req.file.originalname).toLowerCase();
  if (extension === ".pdf") {
    try {
      const pdf = await PDFDocument.load(await readFile(req.file.path));
      if (pdf.getPageCount() > 2000) throw new ApiError(400, "PDFs are limited to 2,000 pages.");
    } catch (error) {
      await unlink(req.file.path);
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "The uploaded file is not a valid PDF.");
    }
  } else if (!req.file.mimetype.startsWith("audio/")) {
    await unlink(req.file.path);
    throw new ApiError(400, "The uploaded file is not a supported audio file.");
  }
  const allowedCategories = ["Textbooks", "Reference", "Fiction", "Research Papers", "Course Material", "Other"];
  const category = typeof req.body.category === "string" ? req.body.category.trim() : "";
  if (category && !allowedCategories.includes(category)) {
    await unlink(req.file.path);
    throw new ApiError(400, "Choose a valid media category.");
  }
  const media = await prisma.mediaAsset.create({ data: {
    title: optionalText(req.body.title) || req.file.originalname,
    mediaType: extension === ".pdf" ? "PDF" : "AUDIO",
    category: category || "Other",
    fileName: path.basename(req.file.originalname), mimeType: req.file.mimetype,
    filePath: req.file.filename, fileSize: req.file.size,
  } });
  await audit(req, "UPLOAD", "MEDIA", media.id);
  res.status(201).json({ ...media, url: `/api/media/${media.id}/file` });
}));

app.delete("/api/media/:id", requireStaff, asyncRoute(async (req, res) => {
  const media = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
  if (!media) { res.status(404).json({ error: "Media file not found." }); return; }
  await prisma.mediaAsset.delete({ where: { id: media.id } });
  try {
    await unlink(path.resolve(uploadDirectory, path.basename(media.filePath)));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await audit(req, "DELETE", "MEDIA", media.id);
  res.status(204).end();
}));

app.get("/api/media/:id/file", asyncRoute(async (req, res) => {
  const media = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
  if (!media) { res.status(404).json({ error: "Media file not found." }); return; }
  res.type(media.mimeType).sendFile(path.resolve(uploadDirectory, path.basename(media.filePath)));
}));

app.get("/api/custom-fields", asyncRoute(async (req, res) => {
  const entity = typeof req.query.entity === "string" ? req.query.entity : "";
  if (entity && !Object.values(FormEntity).includes(entity as FormEntity)) { res.status(400).json({ error: "Invalid custom field entity." }); return; }
  const fields = await prisma.customField.findMany({ where: entity ? { entity: entity as FormEntity } : {}, orderBy: { createdAt: "asc" } });
  res.json(fields.map((field) => ({ id: field.id, key: field.key, label: field.label, labelAm: field.labelAm, type: field.type, required: field.required, entity: field.entity })));
}));

app.post("/api/custom-fields", requireAdmin, asyncRoute(async (req, res) => {
  const { key, label, labelAm, type, entity, required } = req.body as { key?: string; label?: string; labelAm?: string; type?: string; entity?: FormEntity; required?: boolean };
  if (!requiredText(key) || !requiredText(label) || !entity || !Object.values(FormEntity).includes(entity) || !/^[a-z][a-z0-9_]{0,49}$/.test(key)) {
    res.status(400).json({ error: "A label, valid field key, and valid entity are required." });
    return;
  }
  if (!["text", "number", "date", "select", "email"].includes(type || "text")) { res.status(400).json({ error: "Invalid custom field type." }); return; }
  const field = await prisma.customField.create({ data: { key, label, labelAm: optionalText(labelAm), type: type || "text", entity, required: Boolean(required) } });
  res.status(201).json(field);
}));

app.put("/api/custom-fields/:id", requireAdmin, asyncRoute(async (req, res) => {
  const { label, labelAm, type, required } = req.body as { label?: string; labelAm?: string | null; type?: string; required?: boolean };
  if (!requiredText(label)) { res.status(400).json({ error: "A field label is required." }); return; }
  if (type && !["text", "number", "date", "select", "email"].includes(type)) { res.status(400).json({ error: "Invalid custom field type." }); return; }
  if (required !== undefined && typeof required !== "boolean") { res.status(400).json({ error: "Required must be a boolean." }); return; }
  const field = await prisma.customField.update({
    where: { id: req.params.id },
    data: { label: label.trim(), labelAm: labelAm === null ? null : optionalText(labelAm), type, required },
  });
  await audit(req, "UPDATE", "CUSTOM_FIELD", field.id);
  res.json(field);
}));

app.delete("/api/custom-fields/:id", requireAdmin, asyncRoute(async (req, res) => {
  await prisma.customField.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

app.get("/api/audit-logs", requireAdmin, asyncRoute(async (_req, res) => {
  const logs = await prisma.auditLog.findMany({ include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  res.json(logs);
}));

async function audit(req: AuthRequest, action: string, entity: string, entityId?: string, details?: Record<string, unknown>) {
  await prisma.auditLog.create({ data: {
    userId: req.user?.id, action, entity, entityId, details: details ? JSON.stringify(details) : undefined,
    ipAddress: req.ip,
  } });
}

function requiredText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function patronPortalPassword(value: unknown): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length < 12) {
    throw new ApiError(400, "Portal passwords must contain at least 12 characters.");
  }
  return value;
}
function generateMemberCode(type: "STUDENT" | "TEACHER"): string {
  return `${type === "STUDENT" ? "STU" : "TCH"}-${randomUUID().slice(0, 8).toUpperCase()}`;
}
function positiveInteger(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
function optionalYear(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1000 || year > new Date().getFullYear() + 1) throw new ApiError(400, "Enter a valid publication year.");
  return year;
}
function optionalMoney(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new ApiError(400, "Asset value must be a non-negative amount.");
  return roundMoney(amount);
}
function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
async function returnLoanItem(id: string) {
  const [returned] = await returnLoanItems([id]);
  return returned;
}
async function returnLoanItems(ids: string[]) {
  return prisma.$transaction(async (transaction) => {
    const returned = [];
    for (const id of ids) {
      const current = await transaction.loanItem.findUnique({ where: { id }, include: { loan: true } });
      if (!current) throw new ApiError(404, "Loan item not found.");
      if (current.returnedAt) throw new ApiError(409, "This book has already been returned.");
      const returnedAt = new Date();
      const today = new Date(returnedAt);
      const dueDay = new Date(current.loan.dueDate);
      today.setUTCHours(0, 0, 0, 0);
      dueDay.setUTCHours(0, 0, 0, 0);
      const daysLate = Math.max(0, Math.floor((today.getTime() - dueDay.getTime()) / 86_400_000));
      const updated = await transaction.loanItem.update({
        where: { id: current.id },
        data: { returnedAt, fine: roundMoney(daysLate * finePerDay) },
      });
      await transaction.book.update({ where: { id: current.bookId }, data: { availableCopies: { increment: 1 } } });
      const remaining = await transaction.loanItem.count({ where: { loanId: current.loanId, returnedAt: null } });
      if (!remaining) await transaction.loan.update({ where: { id: current.loanId }, data: { status: "RETURNED" } });
      returned.push(updated);
    }
    return returned;
  });
}
function validateTranslationMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "Interface text must be provided as a key/value object.");
  }
  const entries = Object.entries(value);
  if (entries.length > 300) throw new ApiError(400, "No more than 300 interface text overrides are allowed per language.");
  const translations: Record<string, string> = {};
  for (const [key, text] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || typeof text !== "string" || text.length > 500) {
      throw new ApiError(400, "Interface text keys must be valid identifiers and values must be at most 500 characters.");
    }
    translations[key] = text;
  }
  return translations;
}
function optionalDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new ApiError(400, "Enter a valid date.");
  return new Date(value);
}
function jsonObject(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || value === "") return {};
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new ApiError(400, "Custom fields must contain valid JSON.");
    }
  }
  if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
    throw new ApiError(400, "Custom fields must be a JSON object.");
  }
  try {
    return JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "Custom fields contain unsupported values.");
  }
}

async function validateCustomFields(entity: FormEntity, value: unknown, create: boolean): Promise<string> {
  const supplied = jsonObject(value);
  const fields = await prisma.customField.findMany({ where: { entity } });
  const permitted = new Set(fields.map((field) => field.key));
  const unknownKeys = Object.keys(supplied).filter((key) => !permitted.has(key));
  if (unknownKeys.length) throw new ApiError(400, `Unknown custom field: ${unknownKeys.join(", ")}.`);
  if (create) {
    const missing = fields.filter((field) => field.required && (supplied[field.key] === undefined || supplied[field.key] === null || supplied[field.key] === ""));
    if (missing.length) throw new ApiError(400, `Required custom field missing: ${missing.map((field) => field.label).join(", ")}.`);
  }
  return JSON.stringify(supplied);
}

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ApiError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof multer.MulterError) { res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "File exceeds the 50 MB upload limit." : error.message }); return; }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") { res.status(409).json({ error: "A record with this unique value already exists." }); return; }
    if (error.code === "P2025") { res.status(404).json({ error: "Record not found." }); return; }
  }
  console.error(error);
  res.status(500).json({ error: "An unexpected server error occurred." });
});

async function start() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("Set JWT_SECRET to a random secret of at least 32 characters.");
  if (!Number.isFinite(finePerDay) || finePerDay < 0) throw new Error("FINE_PER_DAY must be a non-negative number.");
  await mkdir(uploadDirectory, { recursive: true });
  app.listen(port, () => {
    console.log(`Library API listening on http://localhost:${port}`);
    const runReminders = () => { void sendDailyOverdueReminders().catch((error) => console.error("Overdue reminder job failed:", error)); };
    const startupTimer = setTimeout(runReminders, 15_000);
    startupTimer.unref();
    const reminderTimer = setInterval(runReminders, 60 * 60 * 1000);
    reminderTimer.unref();
  });
}

void start().catch((error) => {
  console.error("Unable to start library API:", error);
  process.exitCode = 1;
});
