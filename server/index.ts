import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import bcrypt from "bcryptjs";
import cors from "cors";
import { Readable } from "node:stream";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import multer from "multer";
import { PDFDocument } from "pdf-lib";
import { FormEntity, Prisma, type PatronType } from "@prisma/client";
import { authenticate, requireAdmin, requireStaff, type AuthRequest } from "./auth.js";
import { prisma } from "./prisma.js";
import { sendDailyOverdueReminders } from "./reminders.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || "uploads");
const cloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET,
);
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "",
  api_key: process.env.CLOUDINARY_API_KEY || "",
  api_secret: process.env.CLOUDINARY_API_SECRET || "",
  secure: true,
});
const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  ...(process.env.CLIENT_ORIGIN || "").split(",").map((origin) => origin.trim()).filter(Boolean),
]);
const defaultFinePerDay = Number(process.env.FINE_PER_DAY || 5);
const asyncRoute = (handler: (req: AuthRequest, res: Response) => Promise<unknown>) =>
  (req: AuthRequest, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
const settingsRoute = (handler: (req: AuthRequest, res: Response) => Promise<unknown>) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    void handler(req, res).catch((error: unknown) => {
      if (res.headersSent) { next(error); return; }
      if (error instanceof ApiError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      console.error(`Library settings request failed (${req.method} ${req.path}).`, error);
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

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
app.get("/api/public/settings", settingsRoute(async (_req, res) => {
  const settings = await prisma.librarySetting.findUnique({ where: { id: "global" } });
  res.json({
    libraryName: settings?.libraryName || "Libra",
    appTitle: settings?.appTitle || "Library Management",
    defaultLanguage: settings?.defaultLanguage || "en",
    finePerDay: settings?.finePerDay ?? defaultFinePerDay,
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
  const normalizedEmail = loginIdentifier.toLowerCase();
  const candidates = mode === "member"
    ? (await prisma.patron.findMany({
      where: { active: true, account: { isNot: null }, OR: [
        { memberCode: loginIdentifier },
        { email: normalizedEmail },
        { phone: loginIdentifier },
      ] },
      include: { account: { include: { patron: { select: { id: true, name: true, type: true, active: true } } } } },
    })).flatMap((patron) => patron.account ? [patron.account] : [])
    : await prisma.user.findMany({
      where: { OR: [
        { email: normalizedEmail },
        { patron: { is: { phone: loginIdentifier } } },
      ] },
      include: { patron: { select: { id: true, name: true, type: true, active: true } } },
    });
  let user: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    if (candidate.active && await bcrypt.compare(password, candidate.passwordHash)) {
      user = candidate;
      break;
    }
  }
  if (!user) {
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
    ["/books", "/books/categories", "/exam-sheets", "/auth/me", "/portal/me", "/portal/loans", "/portal/reservations", "/media"].includes(req.path) ||
    /^\/(books|exam-sheets)\/[^/]+\/file$/.test(req.path) ||
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

const getAdminSettings = settingsRoute(async (_req, res) => {
  const settings = await prisma.librarySetting.findUnique({ where: { id: "global" } });
  res.json({
    libraryName: settings?.libraryName || "Libra",
    appTitle: settings?.appTitle || "Library Management",
    defaultLanguage: settings?.defaultLanguage || "en",
    finePerDay: settings?.finePerDay ?? defaultFinePerDay,
    englishText: settings ? JSON.parse(settings.englishText) : {},
    amharicText: settings ? JSON.parse(settings.amharicText) : {},
  });
});

const saveAdminSettings = settingsRoute(async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "A valid library settings object is required." });
    return;
  }
  const { libraryName, appTitle, finePerDay: requestedFinePerDay } = req.body as { libraryName?: unknown; appTitle?: unknown; finePerDay?: unknown };
  if (typeof libraryName !== "string" || !libraryName.trim() || libraryName.trim().length > 80 ||
      typeof appTitle !== "string" || !appTitle.trim() || appTitle.trim().length > 80) {
    res.status(400).json({ error: "Library name and app title must each contain 1–80 characters." });
    return;
  }
  const current = req.body.defaultLanguage === undefined
    ? await prisma.librarySetting.findUnique({ where: { id: "global" }, select: { defaultLanguage: true, finePerDay: true } })
    : null;
  const defaultLanguage = req.body.defaultLanguage ?? current?.defaultLanguage ?? "en";
  if (defaultLanguage !== "en" && defaultLanguage !== "am") {
    res.status(400).json({ error: "Default language must be either 'en' or 'am'." });
    return;
  }
  const currentFinePerDay = requestedFinePerDay === undefined
    ? (current?.finePerDay ?? (await prisma.librarySetting.findUnique({ where: { id: "global" }, select: { finePerDay: true } }))?.finePerDay ?? defaultFinePerDay)
    : requestedFinePerDay;
  if (typeof currentFinePerDay !== "number" || !Number.isFinite(currentFinePerDay) || currentFinePerDay < 0 || currentFinePerDay > 1_000_000) {
    res.status(400).json({ error: "Fine amount per day must be between 0 and 1,000,000." });
    return;
  }
  const englishText = validateTranslationMap(req.body.englishText);
  const amharicText = validateTranslationMap(req.body.amharicText);
  const settings = await prisma.librarySetting.upsert({
    where: { id: "global" },
    create: { id: "global", libraryName: libraryName.trim(), appTitle: appTitle.trim(), defaultLanguage, finePerDay: currentFinePerDay, englishText: JSON.stringify(englishText), amharicText: JSON.stringify(amharicText) },
    update: { libraryName: libraryName.trim(), appTitle: appTitle.trim(), defaultLanguage, finePerDay: currentFinePerDay, englishText: JSON.stringify(englishText), amharicText: JSON.stringify(amharicText) },
  });
  await audit(req, "UPDATE", "LIBRARY_SETTINGS", settings.id);
  res.json({ libraryName: settings.libraryName, appTitle: settings.appTitle, defaultLanguage: settings.defaultLanguage, finePerDay: settings.finePerDay, englishText, amharicText });
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
  const [totalBooks, totalExamSheets, available, activeStudents, borrowersThisMonth, activeItems, overdueItems, recent, popularItems, returnedRecent, paidFine, bookCategoryGroups] = await Promise.all([
    prisma.book.aggregate({ _sum: { copies: true } }),
    prisma.examSheet.aggregate({ _sum: { copies: true } }),
    prisma.book.aggregate({ _sum: { availableCopies: true } }),
    prisma.patron.count({ where: { type: "STUDENT", active: true } }),
    prisma.loan.groupBy({ by: ["patronId"], where: { issuedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } } }),
    prisma.loanItem.count({ where: { bookId: { not: null }, returnedAt: null } }),
    prisma.loanItem.count({ where: { bookId: { not: null }, returnedAt: null, loan: { dueDate: { lt: today } } } }),
    prisma.loanItem.findMany({
      take: 6, orderBy: { loan: { issuedAt: "desc" } },
      include: { book: { select: { title: true, author: true } }, examSheet: { select: { title: true, subject: true } }, loan: { include: { patron: { select: { name: true } } } } },
    }),
    prisma.loanItem.groupBy({
      by: ["bookId"], _count: { bookId: true }, where: { bookId: { not: null }, loan: { issuedAt: { gte: startMonth } } },
      orderBy: { _count: { bookId: "desc" } }, take: 500,
    }),
    prisma.loanItem.findMany({ where: { bookId: { not: null }, loan: { issuedAt: { gte: startMonth } } }, select: { loan: { select: { issuedAt: true } }, returnedAt: true } }),
    prisma.finePayment.aggregate({ _sum: { amount: true } }),
    prisma.book.groupBy({ by: ["category"], _sum: { copies: true } }),
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
  const popularBookIds = popularItems.flatMap((item) => item.bookId ? [item.bookId] : []);
  const popularBooks = await prisma.book.findMany({ where: { id: { in: popularBookIds } }, select: { id: true, category: true } });
  const categoryTotals = new Map<string, number>();
  for (const item of popularItems) {
    const category = popularBooks.find((book) => book.id === item.bookId)?.category || "Other";
    categoryTotals.set(category, (categoryTotals.get(category) || 0) + item._count.bookId);
  }
  const allCategoryLoans = [...categoryTotals.values()].reduce((sum, count) => sum + count, 0) || 1;
  const categories = [...categoryTotals.entries()].map(([name, count]) => ({ name, value: Math.round((count / allCategoryLoans) * 100) })).slice(0, 5);
  const bookCategoryTotals = new Map<string, number>();
  for (const group of bookCategoryGroups) {
    const name = group.category?.trim() || "Other";
    bookCategoryTotals.set(name, (bookCategoryTotals.get(name) || 0) + (group._sum.copies || 0));
  }
  const bookCategories = [...bookCategoryTotals.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  res.json({
    totalBooks: totalBooks._sum.copies || 0,
    totalExamSheets: totalExamSheets._sum.copies || 0,
    availableBooks: available._sum.availableCopies || 0,
    borrowedBooks: activeItems,
    activeStudents,
    borrowersThisMonth: borrowersThisMonth.length,
    overdueBooks: overdueItems,
    finesCollected: Number(paidFine._sum.amount || 0),
    borrowingTrends: months.map(({ month, borrowed, returned }) => ({ month, borrowed, returned })),
    categories,
    bookCategories,
    recentLoans: recent.map((item) => ({
      id: item.id, title: item.book?.title ?? item.examSheet?.title ?? "Unknown item", author: item.book?.author ?? item.examSheet?.subject ?? "", borrowerName: item.loan.patron?.name ?? "Unknown borrower",
      dueDate: item.loan.dueDate.toISOString(), status: item.returnedAt ? "RETURNED" : item.loan.dueDate < today ? "OVERDUE" : "CHECKED_OUT",
    })),
  });
}));

app.get("/api/books", asyncRoute(async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
  const where: Prisma.BookWhereInput = {
    ...(search ? { OR: [
      { title: { contains: search } }, { author: { contains: search } },
      { isbn: { contains: search } }, { category: { contains: search } },
    ] } : {}),
    ...(category ? { category: { contains: category } } : {}),
  };
  if (req.user?.role === "MEMBER") {
    const books = await prisma.book.findMany({
      where, orderBy: { title: "asc" },
      select: { id: true, title: true, author: true, category: true, isbn: true, description: true, publisher: true, publishedYear: true, shelfLocation: true, filePath: true, availableCopies: true },
    });
    res.json(books);
    return;
  }
  res.json(await prisma.book.findMany({ where, orderBy: { title: "asc" } }));
}));

app.get("/api/books/categories", asyncRoute(async (_req, res) => {
  const groups = await prisma.book.groupBy({ by: ["category"] });
  const categories = [...new Set(groups.flatMap(({ category }) => category?.trim() ? [category.trim()] : []))]
    .sort((left, right) => left.localeCompare(right));
  res.json(categories);
}));

app.post("/api/books", requireStaff, asyncRoute(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!requiredText(body.title) || !requiredText(body.author)) { res.status(400).json({ error: "Title and author are required." }); return; }
  const copies = body.copies === undefined ? 1 : positiveInteger(body.copies, NaN);
  if (!Number.isInteger(copies)) { res.status(400).json({ error: "Copies must be a positive whole number." }); return; }
  const publishedYear = optionalYear(body.publishedYear);
  if (body.filePath !== undefined && body.filePath !== null && body.filePath !== "" && !isSecureFileUrl(body.filePath)) {
    res.status(400).json({ error: "File URL must be a valid HTTPS URL." });
    return;
  }
  const customFields = await validateCustomFields(FormEntity.BOOK, body.customFields, true);
  const book = await prisma.book.create({ data: {
    title: String(body.title).trim(), author: String(body.author).trim(), isbn: optionalText(body.isbn),
    category: optionalText(body.category), description: optionalText(body.description), publisher: optionalText(body.publisher), publishedYear,
    shelfLocation: optionalText(body.shelfLocation), filePath: optionalText(body.filePath) || null, copies, availableCopies: copies,
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
  if ("filePath" in body) {
    if (body.filePath !== null && body.filePath !== "" && !isSecureFileUrl(body.filePath)) {
      res.status(400).json({ error: "File URL must be a valid HTTPS URL." });
      return;
    }
    data.filePath = optionalText(body.filePath) || null;
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

app.get("/api/exam-sheets", asyncRoute(async (req, res) => {
  if (req.user?.role !== "MEMBER" && req.user?.role !== "LIBRARIAN" && req.user?.role !== "ADMIN") {
    res.status(403).json({ error: "Library staff access is required." });
    return;
  }
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const where: Prisma.ExamSheetWhereInput = search ? { OR: [
    { title: { contains: search } }, { subject: { contains: search } }, { grade: { contains: search } },
  ] } : {};
  if (req.user.role === "MEMBER") {
    const examSheets = await prisma.examSheet.findMany({
      where, orderBy: { title: "asc" },
      select: { id: true, title: true, subject: true, grade: true, examYear: true, description: true, filePath: true, availableCopies: true },
    });
    res.json(examSheets);
    return;
  }
  res.json(await prisma.examSheet.findMany({ where, orderBy: { title: "asc" } }));
}));

app.post("/api/exam-sheets", requireStaff, asyncRoute(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!requiredText(body.title)) { res.status(400).json({ error: "Exam sheet title is required." }); return; }
  const copies = body.copies === undefined ? 1 : positiveInteger(body.copies, NaN);
  if (!Number.isInteger(copies)) { res.status(400).json({ error: "Copies must be a positive whole number." }); return; }
  if (body.filePath !== undefined && body.filePath !== null && body.filePath !== "" && !isSecureFileUrl(body.filePath)) {
    res.status(400).json({ error: "File URL must be a valid HTTPS URL." });
    return;
  }
  const examSheet = await prisma.examSheet.create({ data: {
    title: body.title.trim(), subject: optionalText(body.subject), grade: optionalText(body.grade),
    examYear: optionalYear(body.examYear), description: optionalText(body.description), filePath: optionalText(body.filePath) || null, copies, availableCopies: copies,
  } });
  await audit(req, "CREATE", "EXAM_SHEET", examSheet.id);
  res.status(201).json(examSheet);
}));

app.put("/api/exam-sheets/:id", requireStaff, asyncRoute(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const current = await prisma.examSheet.findUnique({ where: { id: req.params.id } });
  if (!current) { res.status(404).json({ error: "Exam sheet not found." }); return; }
  const data: Prisma.ExamSheetUpdateInput = {};
  for (const key of ["title", "subject", "grade", "description"] as const) {
    if (key in body) {
      if (key === "title" && !requiredText(body[key])) { res.status(400).json({ error: "Exam sheet title is required." }); return; }
      Object.assign(data, { [key]: optionalText(body[key]) });
    }
  }
  if ("filePath" in body) {
    if (body.filePath !== null && body.filePath !== "" && !isSecureFileUrl(body.filePath)) {
      res.status(400).json({ error: "File URL must be a valid HTTPS URL." });
      return;
    }
    data.filePath = optionalText(body.filePath) || null;
  }
  if ("examYear" in body) data.examYear = optionalYear(body.examYear);
  if ("copies" in body) {
    const copies = positiveInteger(body.copies, NaN);
    if (!Number.isInteger(copies) || copies < current.copies - current.availableCopies) {
      res.status(400).json({ error: "Total copies cannot be lower than the number currently on loan." });
      return;
    }
    data.copies = copies;
    data.availableCopies = current.availableCopies + copies - current.copies;
  }
  const examSheet = await prisma.examSheet.update({ where: { id: current.id }, data });
  await audit(req, "UPDATE", "EXAM_SHEET", examSheet.id);
  res.json(examSheet);
}));

app.delete("/api/exam-sheets/:id", requireStaff, asyncRoute(async (req, res) => {
  const examSheet = await prisma.examSheet.findUnique({ where: { id: req.params.id } });
  if (!examSheet) { res.status(404).json({ error: "Exam sheet not found." }); return; }
  if (examSheet.availableCopies !== examSheet.copies) { res.status(409).json({ error: "An exam sheet with active loans cannot be deleted." }); return; }
  if (await prisma.loanItem.count({ where: { examSheetId: examSheet.id } })) { res.status(409).json({ error: "An exam sheet with circulation history cannot be deleted." }); return; }
  await prisma.examSheet.delete({ where: { id: examSheet.id } });
  await audit(req, "DELETE", "EXAM_SHEET", examSheet.id);
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
  const gender = patronGender(body.gender);
  const memberCode = optionalText(body.memberCode) || generateMemberCode(type);
  const password = patronPortalPassword(body.password);
  const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
  const customFields = await validateCustomFields(FormEntity.PATRON, body.customFields, true);
  try {
    const patron = await prisma.$transaction(async (transaction) => {
      const created = await transaction.patron.create({ data: {
        name: String(body.name).trim(), email: String(body.email).trim().toLowerCase(), memberCode,
        type, gender, phone: optionalText(body.phone), grade: optionalText(body.grade),
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
  const gender = "gender" in body ? patronGender(body.gender) : undefined;
  const password = patronPortalPassword(body.password);
  const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;
  const data: Prisma.PatronUpdateInput = {};
  for (const key of ["name", "email", "memberCode", "phone", "grade", "department"] as const) {
    if (key in body) Object.assign(data, { [key]: key === "email" || key === "memberCode" ? String(body[key]).trim() : optionalText(body[key]) });
  }
  if ("gender" in body) data.gender = gender ?? null;
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

function getBorrowerTypeFilter(value: unknown): PatronType | "ALL" | null {
  if (value === undefined) return "STUDENT";
  return value === "STUDENT" || value === "TEACHER" || value === "ALL" ? value : null;
}

const LEGACY_BORROW_DATE = new Date("2026-09-15T00:00:00.000Z");

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

app.get("/api/loans", asyncRoute(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "ALL";
  if (!["ALL", "ACTIVE", "OVERDUE", "RETURNED"].includes(status)) { res.status(400).json({ error: "Invalid loan status filter." }); return; }
  const typeFilter = getBorrowerTypeFilter(req.query.type);
  if (!typeFilter) {
    res.status(400).json({ error: "Invalid patron type filter." });
    return;
  }
  const patronId = req.query.patronId === undefined ? undefined :
    typeof req.query.patronId === "string" ? req.query.patronId.trim() : "";
  if (req.query.patronId !== undefined && (!patronId || patronId.length > 128)) {
    res.status(400).json({ error: "A valid patron ID is required." });
    return;
  }
  const patronType: PatronType | undefined = typeFilter === "ALL" ? undefined : typeFilter;
  const borrowerWhere = patronType ? {
    borrowerType: patronType,
    patron: {
      is: {
        type: patronType,
        ...(patronType === "TEACHER" ? {
          memberCode: { not: { startsWith: "STU" } },
          id: { not: { startsWith: "STU" } },
        } : {}),
      },
    },
  } : {};
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const finePerDay = await getFinePerDay();
  const loans = await prisma.loan.findMany({
    where: {
      ...borrowerWhere,
      ...(patronId ? { patronId } : {}),
      ...(status === "OVERDUE" ? { status: "ACTIVE", dueDate: { lt: today } } :
        status === "ACTIVE" ? { status: "ACTIVE" } : {}),
    },
    include: { patron: { select: { name: true, memberCode: true } }, loanItems: { include: { book: { select: { title: true, author: true } }, examSheet: { select: { title: true, subject: true } }, payments: true } } },
    orderBy: { issuedAt: "desc" }, take: 500,
  });
  const items = loans.flatMap((loan) => loan.loanItems.map((item) => {
    const paid = item.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const fine = calculateCurrentFine(Number(item.fine), loan.dueDate, item.returnedAt, finePerDay, today);
    return {
      id: item.id, loanItemId: item.id, loanId: loan.id, itemType: item.bookId ? "BOOK" : "EXAM_SHEET",
      title: item.book?.title ?? item.examSheet?.title ?? "Unknown item", author: item.book?.author ?? item.examSheet?.subject ?? "",
      borrowerName: loan.patron?.name ?? "Unknown borrower", memberCode: loan.patron?.memberCode ?? "", borrowerType: loan.borrowerType,
      borrowDate: (loan.borrowDate ?? LEGACY_BORROW_DATE).toISOString(), dueDate: loan.dueDate.toISOString(),
      returnedAt: item.returnedAt?.toISOString() || null, status: item.returnedAt ? "RETURNED" : loan.dueDate < today ? "OVERDUE" : "CHECKED_OUT",
      fine, finePaid: paid, fineRemaining: Math.max(0, fine - paid),
    };
  }));
  res.json(status === "RETURNED" ? items.filter((item) => item.status === "RETURNED") :
    status === "ACTIVE" || status === "OVERDUE" ? items.filter((item) => item.status !== "RETURNED") : items);
}));

app.put("/api/loans/items/:id", requireStaff, asyncRoute(async (req, res) => {
  const typeFilter = getBorrowerTypeFilter(req.query.type);
  if (!typeFilter || typeFilter === "ALL") { res.status(400).json({ error: "A valid patron type is required." }); return; }
  const { borrowDate, dueDate } = req.body as { borrowDate?: unknown; dueDate?: unknown };
  const parsedDueDate = parseDateOnly(dueDate);
  const parsedBorrowDate = borrowDate === undefined ? undefined : parseDateOnly(borrowDate);
  if (!parsedDueDate) {
    res.status(400).json({ error: "Enter a valid due date." });
    return;
  }
  if (borrowDate !== undefined && !parsedBorrowDate) {
    res.status(400).json({ error: "Enter a valid borrow date." });
    return;
  }
  const loan = await prisma.$transaction(async (transaction) => {
    const item = await transaction.loanItem.findFirst({
      where: { id: req.params.id, loan: { borrowerType: typeFilter } },
      select: { id: true, loanId: true },
    });
    if (!item) throw new ApiError(404, "Borrowing record not found.");
    return transaction.loan.update({
      where: { id: item.loanId },
      data: { borrowDate: parsedBorrowDate ?? LEGACY_BORROW_DATE, dueDate: parsedDueDate },
      select: { id: true, borrowDate: true, dueDate: true },
    });
  });
  await audit(req, "UPDATE", "LOAN_ITEM", req.params.id, {
    loanId: loan.id,
    borrowDate: (loan.borrowDate ?? LEGACY_BORROW_DATE).toISOString(),
    dueDate: loan.dueDate.toISOString(),
  });
  res.json({ borrowDate: (loan.borrowDate ?? LEGACY_BORROW_DATE).toISOString(), dueDate: loan.dueDate.toISOString() });
}));

const clearResolvedBorrowings = asyncRoute(async (req, res) => {
  const typeFilter = getBorrowerTypeFilter(req.query.type);
  if (!typeFilter) { res.status(400).json({ error: "Invalid patron type filter." }); return; }
  const deletedCount = await prisma.$transaction(async (transaction) => {
    const candidates = await transaction.loanItem.findMany({
      where: {
        returnedAt: { not: null }, fine: { lte: 0 }, payments: { none: {} },
        ...(typeFilter === "ALL" ? {} : { loan: { borrowerType: typeFilter } }),
      },
      select: { id: true, loanId: true },
    });
    if (!candidates.length) return 0;
    await transaction.loanItem.deleteMany({ where: { id: { in: candidates.map((item) => item.id) } } });
    await transaction.loan.deleteMany({
      where: { id: { in: [...new Set(candidates.map((item) => item.loanId))] }, loanItems: { none: {} } },
    });
    return candidates.length;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(req, "CLEAR_HISTORY", "LOAN_ITEM", undefined, { deletedCount });
  res.json({ deletedCount });
});

app.delete("/api/borrowings/clear", requireStaff, clearResolvedBorrowings);
app.delete("/api/loans/clear", requireStaff, clearResolvedBorrowings);

const deleteResolvedBorrowing = asyncRoute(async (req, res) => {
  const typeFilter = getBorrowerTypeFilter(req.query.type);
  if (!typeFilter) { res.status(400).json({ error: "Invalid patron type filter." }); return; }
  const item = await prisma.$transaction(async (transaction) => {
    const current = await transaction.loanItem.findFirst({
      where: {
        id: req.params.id,
        ...(typeFilter === "ALL" ? {} : { loan: { borrowerType: typeFilter } }),
      },
      include: { payments: { select: { id: true } } },
    });
    if (!current) throw new ApiError(404, "Borrowing record not found.");
    if (Number(current.fine) > 0 || current.payments.length) {
      throw new ApiError(409, "Records with outstanding fines or payment history cannot be deleted.");
    }
    if (!current.returnedAt) {
      if (current.bookId) {
        await transaction.book.update({ where: { id: current.bookId }, data: { availableCopies: { increment: 1 } } });
      } else if (current.examSheetId) {
        await transaction.examSheet.update({ where: { id: current.examSheetId }, data: { availableCopies: { increment: 1 } } });
      }
    }
    await transaction.loanItem.delete({ where: { id: current.id } });
    if (!(await transaction.loanItem.count({ where: { loanId: current.loanId } }))) {
      await transaction.loan.delete({ where: { id: current.loanId } });
    }
    return current;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(req, "DELETE", "LOAN_ITEM", item.id, { loanId: item.loanId });
  res.status(204).end();
});

app.delete("/api/borrowings/:id", requireStaff, deleteResolvedBorrowing);
app.delete("/api/loans/items/:id", requireStaff, deleteResolvedBorrowing);

app.get("/api/portal/loans", asyncRoute(async (req, res) => {
  const patronId = req.user?.patronId;
  if (!patronId) { res.status(403).json({ error: "A linked patron account is required." }); return; }
  const loans = await prisma.loan.findMany({
    where: { patronId },
    include: { loanItems: { include: { book: { select: { title: true, author: true } }, examSheet: { select: { title: true, subject: true } }, payments: true } } },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const finePerDay = await getFinePerDay();
  res.json(loans.flatMap((loan) => loan.loanItems.map((item) => {
    const fine = calculateCurrentFine(Number(item.fine), loan.dueDate, item.returnedAt, finePerDay, today);
    const paid = item.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    return {
      id: item.id,
      loanId: loan.id,
      itemType: item.bookId ? "BOOK" : "EXAM_SHEET",
      title: item.book?.title ?? item.examSheet?.title ?? "Unknown item",
      author: item.book?.author ?? item.examSheet?.subject ?? "",
      issuedAt: loan.issuedAt.toISOString(),
      borrowDate: (loan.borrowDate ?? LEGACY_BORROW_DATE).toISOString(),
      dueDate: loan.dueDate.toISOString(),
      returnedAt: item.returnedAt?.toISOString() || null,
      status: item.returnedAt ? "RETURNED" : loan.dueDate < today ? "OVERDUE" : "CHECKED_OUT",
      fine,
      fineRemaining: Math.max(0, roundMoney(fine - paid)),
    };
  })));
}));

app.get("/api/portal/reservations", asyncRoute(async (req, res) => {
  const patronId = req.user?.patronId;
  if (!patronId) { res.status(403).json({ error: "A linked patron account is required." }); return; }
  const reservations = await prisma.bookReservation.findMany({
    where: { patronId },
    include: {
      book: { select: { id: true, title: true, author: true, availableCopies: true, category: true } },
      examSheet: { select: { id: true, title: true, subject: true, grade: true, examYear: true, availableCopies: true } },
    },
    orderBy: { requestedAt: "desc" },
    take: 200,
  });
  res.json(reservations);
}));

app.post("/api/portal/reservations", asyncRoute(async (req, res) => {
  const patronId = req.user?.patronId;
  const bookId = typeof req.body.bookId === "string" ? req.body.bookId.trim() : "";
  const examSheetId = typeof req.body.examSheetId === "string" ? req.body.examSheetId.trim() : "";
  if (!patronId) { res.status(403).json({ error: "A linked patron account is required." }); return; }
  if (Boolean(bookId) === Boolean(examSheetId)) {
    res.status(400).json({ error: "Choose one book or exam sheet to place a reservation request." });
    return;
  }
  const isBook = Boolean(bookId);
  const itemId = bookId || examSheetId;
  const [item, previousRequest] = isBook
    ? await Promise.all([
      prisma.book.findUnique({ where: { id: itemId }, select: { id: true } }),
      prisma.bookReservation.findFirst({
        where: { patronId, bookId: itemId, status: { in: ["REQUESTED", "RESERVED"] } },
        select: { id: true },
      }),
    ])
    : await Promise.all([
      prisma.examSheet.findUnique({ where: { id: itemId }, select: { id: true } }),
      prisma.bookReservation.findFirst({
        where: { patronId, examSheetId: itemId, status: { in: ["REQUESTED", "RESERVED"] } },
        select: { id: true },
      }),
    ]);
  if (!item) { res.status(404).json({ error: isBook ? "Book not found." : "Exam sheet not found." }); return; }
  if (previousRequest) { res.status(409).json({ error: "You already have an active request for this item." }); return; }
  const reservation = await prisma.bookReservation.create({
    data: { patronId, ...(isBook ? { bookId } : { examSheetId }) },
    include: {
      book: { select: { id: true, title: true, author: true } },
      examSheet: { select: { id: true, title: true, subject: true } },
    },
  });
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
    include: {
      patron: { select: { name: true, memberCode: true, email: true } },
      book: { select: { id: true, title: true, author: true } },
      examSheet: { select: { id: true, title: true, subject: true } },
    },
    orderBy: { requestedAt: "asc" },
    take: 500,
  }));
}));

app.delete("/api/reservations/clear", requireStaff, asyncRoute(async (req, res) => {
  const result = await prisma.bookReservation.deleteMany({
    where: { status: { in: ["FULFILLED", "CANCELLED"] } },
  });
  await audit(req, "CLEAR_HISTORY", "BOOK_RESERVATION", undefined, { deletedCount: result.count });
  res.json({ deletedCount: result.count });
}));

app.delete("/api/reservations/:id", requireStaff, asyncRoute(async (req, res) => {
  const reservation = await prisma.bookReservation.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true },
  });
  if (!reservation) { res.status(404).json({ error: "Reservation not found." }); return; }
  await prisma.bookReservation.delete({ where: { id: reservation.id } });
  await audit(req, "DELETE", "BOOK_RESERVATION", reservation.id, { status: reservation.status });
  res.status(204).end();
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
        include: {
          patron: { select: { id: true, name: true, memberCode: true, type: true, active: true } },
          book: { select: { id: true, title: true } },
          examSheet: { select: { id: true, title: true } },
        },
      });
      if (!existing) throw new ApiError(404, "Reservation not found.");
      if (existing.status !== "REQUESTED" && existing.status !== "RESERVED") {
        throw new ApiError(409, `Reservation cannot be issued from ${existing.status}.`);
      }
      if (!existing.patron.active) throw new ApiError(409, "An inactive patron cannot receive a loan.");
      const itemId = existing.bookId || existing.examSheetId;
      if (!itemId) throw new ApiError(409, "The reserved item is missing.");
      const isBook = Boolean(existing.bookId);
      const inventoryUpdate = isBook
        ? await transaction.book.updateMany({
          where: { id: itemId, availableCopies: { gt: 0 } },
          data: { availableCopies: { decrement: 1 } },
        })
        : await transaction.examSheet.updateMany({
          where: { id: itemId, availableCopies: { gt: 0 } },
          data: { availableCopies: { decrement: 1 } },
        });
      if (!inventoryUpdate.count) throw new ApiError(409, "This item is no longer available to issue.");
      const reservationUpdate = await transaction.bookReservation.updateMany({
        where: { id: existing.id, status: existing.status },
        data: { status: "FULFILLED" },
      });
      if (!reservationUpdate.count) throw new ApiError(409, "Reservation status changed; reload and try again.");
      const loan = await transaction.loan.create({
        data: {
          patronId: existing.patronId, borrowerType: existing.patron.type, dueDate,
          loanItems: { create: [isBook ? { bookId: itemId } : { examSheetId: itemId }] },
        },
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
    include: {
      patron: { select: { name: true, memberCode: true } },
      book: { select: { id: true, title: true, author: true } },
      examSheet: { select: { id: true, title: true, subject: true } },
    },
  });
  await audit(req, "UPDATE", "BOOK_RESERVATION", reservation.id, { status });
  res.json(reservation);
}));

app.post("/api/notifications/overdue/run", requireAdmin, asyncRoute(async (_req, res) => {
  res.json(await sendDailyOverdueReminders());
}));

app.post("/api/loans", asyncRoute(async (req, res) => {
  const { patronId, patronType, bookIds, borrowDate, dueDate } = req.body as { patronId?: unknown; patronType?: unknown; bookIds?: unknown; borrowDate?: unknown; dueDate?: unknown; items?: unknown };
  const rawItems: unknown = req.body.items;
  const requestedItems: { type: unknown; id: unknown }[] = Array.isArray(rawItems)
    ? rawItems.flatMap((rawItem: unknown) => {
      if (!rawItem || typeof rawItem !== "object") return [];
      const item = rawItem as Record<string, unknown>;
      return [{ type: item.type, id: item.id }];
    })
    : Array.isArray(bookIds) ? bookIds.map((id: unknown) => ({ type: "BOOK", id })) : [];
  const earliestDueDate = new Date();
  earliestDueDate.setUTCHours(0, 0, 0, 0);
  const parsedDueDate = parseDateOnly(dueDate);
  if (typeof patronId !== "string" || !patronId || requestedItems.length < 1 || requestedItems.length > 20 || !parsedDueDate || parsedDueDate < earliestDueDate) {
    res.status(400).json({ error: "A borrower, 1–20 items, and a valid due date are required." });
    return;
  }
  const parsedBorrowDate = borrowDate === undefined ? new Date() : parseDateOnly(borrowDate);
  if (!parsedBorrowDate) {
    res.status(400).json({ error: "Enter a valid borrow date." });
    return;
  }
  if (patronType !== "STUDENT" && patronType !== "TEACHER") {
    res.status(400).json({ error: "Invalid patron type." });
    return;
  }
  if (requestedItems.some((item) => (item.type !== "BOOK" && item.type !== "EXAM_SHEET") || typeof item.id !== "string" || !item.id)) {
    res.status(400).json({ error: "Each loan item must identify a valid book or exam sheet." });
    return;
  }
  const uniqueKeys = requestedItems.map((item) => `${item.type}:${item.id}`);
  if (new Set(uniqueKeys).size !== uniqueKeys.length) { res.status(400).json({ error: "An item may only be selected once per transaction." }); return; }
  const loan = await prisma.$transaction(async (transaction) => {
    const patron = await transaction.patron.findFirst({ where: { id: patronId, active: true } });
    if (!patron) throw new ApiError(404, "Active patron not found.");
    if (patron.type !== patronType) throw new ApiError(409, `This borrowing is restricted to ${patronType.toLowerCase()} patrons.`);
    for (const item of requestedItems) {
      if (item.type === "BOOK") {
        const updated = await transaction.book.updateMany({ where: { id: item.id as string, availableCopies: { gt: 0 } }, data: { availableCopies: { decrement: 1 } } });
        if (!updated.count) throw new ApiError(409, `Book ${item.id} is unavailable.`);
      } else {
        const updated = await transaction.examSheet.updateMany({ where: { id: item.id as string, availableCopies: { gt: 0 } }, data: { availableCopies: { decrement: 1 } } });
        if (!updated.count) throw new ApiError(409, `Exam sheet ${item.id} is unavailable.`);
      }
    }
    return transaction.loan.create({
      data: {
        patronId, borrowerType: patron.type, borrowDate: parsedBorrowDate, dueDate: parsedDueDate,
        loanItems: { create: requestedItems.map((item) => item.type === "BOOK" ? { bookId: item.id as string } : { examSheetId: item.id as string }) },
      }, include: { loanItems: true },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(req, "CREATE", "LOAN", loan.id, { itemCount: requestedItems.length });
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
  const amount = roundMoney(Number(req.body.amount));
  if (!Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: "Payment must be a positive amount." }); return; }
  const finePerDay = await getFinePerDay();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const payment = await prisma.$transaction(async (transaction) => {
    const item = await transaction.loanItem.findUnique({ where: { id: req.params.id }, include: { payments: true, loan: true } });
    if (!item) throw new ApiError(404, "Loan item not found.");
    const fine = calculateCurrentFine(Number(item.fine), item.loan.dueDate, item.returnedAt, finePerDay, today);
    if (fine > Number(item.fine)) await transaction.loanItem.update({ where: { id: item.id }, data: { fine } });
    const balance = fine - item.payments.reduce((sum, entry) => sum + Number(entry.amount), 0);
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

const cloudinaryFileTypes: Record<string, string[]> = {
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".gif": ["image/gif"],
  ".webp": ["image/webp"],
  ".pdf": ["application/pdf"],
  ".mp3": ["audio/mpeg", "audio/mp3"],
  ".wav": ["audio/wav", "audio/x-wav"],
  ".m4a": ["audio/mp4", "audio/x-m4a"],
  ".ogg": ["audio/ogg", "application/ogg"],
};
const cloudinaryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!cloudinaryFileTypes[extension]?.includes(file.mimetype.toLowerCase())) {
      callback(new ApiError(400, "Only supported image, PDF, and audio files can be uploaded."));
      return;
    }
    callback(null, true);
  },
});

function uploadToCloudinary(file: Express.Multer.File): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      resource_type: file.mimetype.toLowerCase() === "application/pdf" ? "image" : "auto",
      type: "upload",
      access_mode: "public",
    }, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      if (!result) {
        reject(new Error("Cloudinary did not return an upload result."));
        return;
      }
      resolve(result);
    });
    Readable.from([file.buffer]).pipe(stream);
  });
}

app.post("/api/upload", requireStaff, cloudinaryUpload.single("file"), asyncRoute(async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "A file is required." }); return; }
  const recordType = req.body.recordType;
  const recordId = optionalText(req.body.recordId);
  if ((recordType === undefined) !== (recordId === undefined) ||
      (recordType !== undefined && recordType !== "BOOK" && recordType !== "EXAM_SHEET")) {
    res.status(400).json({ error: "Provide a valid recordType and recordId together to attach the file." });
    return;
  }
  if (recordId && recordType === "BOOK" && !await prisma.book.findUnique({ where: { id: recordId }, select: { id: true } })) {
    res.status(404).json({ error: "Book not found." });
    return;
  }
  if (recordId && recordType === "EXAM_SHEET" && !await prisma.examSheet.findUnique({ where: { id: recordId }, select: { id: true } })) {
    res.status(404).json({ error: "Exam sheet not found." });
    return;
  }
  if (!cloudinaryConfigured) {
    throw new ApiError(503, "Cloudinary uploads are not configured. Set the Cloudinary environment variables.");
  }
  const uploaded = await uploadToCloudinary(req.file);
  if (!isSecureFileUrl(uploaded.secure_url)) {
    throw new Error("Cloudinary did not return a valid secure file URL.");
  }
  if (recordId && recordType === "BOOK") {
    await prisma.book.update({ where: { id: recordId }, data: { filePath: uploaded.secure_url } });
  } else if (recordId && recordType === "EXAM_SHEET") {
    await prisma.examSheet.update({ where: { id: recordId }, data: { filePath: uploaded.secure_url } });
  }
  res.status(201).json({
    secure_url: uploaded.secure_url,
    filePath: uploaded.secure_url,
    public_id: uploaded.public_id,
    resource_type: uploaded.resource_type,
  });
}));

function cloudinaryPrivatePdfDownloadUrl(filePath: string): string | null {
  let url: URL;
  try {
    url = new URL(filePath);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com") return null;
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new ApiError(503, "Cloudinary PDF delivery is not configured.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const resourceType = parts[1];
  const deliveryType = parts[2];
  if (parts[0] !== process.env.CLOUDINARY_CLOUD_NAME ||
      (resourceType !== "image" && resourceType !== "raw") ||
      deliveryType !== "upload") {
    throw new ApiError(502, "The stored Cloudinary PDF URL cannot be securely resolved.");
  }

  const versionIndex = parts.findIndex((part, index) => index > 2 && /^v\d+$/.test(part));
  if (versionIndex < 0 || versionIndex === parts.length - 1) {
    throw new ApiError(502, "The stored Cloudinary PDF URL does not include a valid asset version.");
  }
  const publicIdWithExtension = parts.slice(versionIndex + 1).join("/");
  const extension = path.extname(publicIdWithExtension).slice(1).toLowerCase();
  if (extension !== "pdf") throw new ApiError(415, "The stored Cloudinary asset is not a PDF.");
  const publicId = resourceType === "raw" ? publicIdWithExtension : publicIdWithExtension.slice(0, -4);

  return cloudinary.utils.private_download_url(publicId, resourceType === "raw" ? "" : extension, {
    resource_type: resourceType,
    type: deliveryType,
    expires_at: Math.floor(Date.now() / 1000) + 300,
    attachment: false,
  });
}

function isCloudinaryHost(filePath: string): boolean {
  try {
    return new URL(filePath).hostname === "res.cloudinary.com";
  } catch {
    return false;
  }
}

async function proxyCloudinaryPdf(filePath: string, res: Response): Promise<boolean> {
  const downloadUrl = cloudinaryPrivatePdfDownloadUrl(filePath);
  if (!downloadUrl) return false;

  let upstream: Awaited<ReturnType<typeof fetch>>;
  try {
    upstream = await fetch(downloadUrl);
  } catch {
    throw new ApiError(502, "Unable to retrieve the PDF from Cloudinary.");
  }
  if (!upstream.ok) {
    throw new ApiError(502, `Cloudinary refused PDF delivery (HTTP ${upstream.status}).`);
  }
  if (!upstream.body) throw new ApiError(502, "Cloudinary returned an empty PDF response.");
  res.type("application/pdf").set("Content-Disposition", "inline");
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) res.set("Content-Length", contentLength);
  await pipeline(Readable.fromWeb(upstream.body), res);
  return true;
}

app.get("/api/books/:id/file", asyncRoute(async (req, res) => {
  const book = await prisma.book.findUnique({ where: { id: req.params.id }, select: { filePath: true } });
  if (!book?.filePath) { res.status(404).json({ error: "Book file not found." }); return; }
  if (await proxyCloudinaryPdf(book.filePath, res)) return;
  if (isSecureFileUrl(book.filePath)) { res.redirect(302, book.filePath); return; }
  res.status(404).json({ error: "Book file is unavailable." });
}));

app.get("/api/exam-sheets/:id/file", asyncRoute(async (req, res) => {
  const examSheet = await prisma.examSheet.findUnique({ where: { id: req.params.id }, select: { filePath: true } });
  if (!examSheet?.filePath) { res.status(404).json({ error: "Exam sheet file not found." }); return; }
  if (await proxyCloudinaryPdf(examSheet.filePath, res)) return;
  if (isSecureFileUrl(examSheet.filePath)) { res.redirect(302, examSheet.filePath); return; }
  res.status(404).json({ error: "Exam sheet file is unavailable." });
}));

app.get("/api/media", asyncRoute(async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const records = await prisma.mediaAsset.findMany({
    where: search ? { OR: [
      { title: { contains: search, mode: "insensitive" } },
      { author: { contains: search, mode: "insensitive" } },
      { fileName: { contains: search, mode: "insensitive" } },
      { mediaType: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
    ] } : {},
    select: { id: true, title: true, author: true, mediaType: true, category: true, fileName: true, mimeType: true, filePath: true, fileSize: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(records.map((record) => ({
    ...record,
    filePath: isSecureFileUrl(record.filePath) ? record.filePath : null,
    url: isSecureFileUrl(record.filePath) ? record.filePath : `/api/media/${record.id}/file`,
  })));
}));

app.post("/api/media/upload", cloudinaryUpload.single("file"), asyncRoute(async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "A media file is required." }); return; }
  const extension = path.extname(req.file.originalname).toLowerCase();
  if (extension === ".pdf") {
    try {
      const pdf = await PDFDocument.load(req.file.buffer);
      if (pdf.getPageCount() > 2000) throw new ApiError(400, "PDFs are limited to 2,000 pages.");
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "The uploaded file is not a valid PDF.");
    }
  } else if (!req.file.mimetype.startsWith("audio/")) {
    throw new ApiError(400, "The uploaded file is not a supported audio file.");
  }
  const allowedCategories = ["Textbooks", "Reference", "Fiction", "Research Papers", "Course Material", "Other"];
  const category = typeof req.body.category === "string" ? req.body.category.trim() : "";
  if (category && !allowedCategories.includes(category)) {
    throw new ApiError(400, "Choose a valid media category.");
  }
  if (!cloudinaryConfigured) {
    throw new ApiError(503, "Cloudinary uploads are not configured. Set the Cloudinary environment variables.");
  }
  const uploaded = await uploadToCloudinary(req.file);
  if (!isSecureFileUrl(uploaded.secure_url)) {
    throw new Error("Cloudinary did not return a valid secure file URL.");
  }
  const media = await prisma.mediaAsset.create({ data: {
    title: optionalText(req.body.title) || req.file.originalname,
    mediaType: extension === ".pdf" ? "PDF" : "AUDIO",
    category: category || "Other",
    fileName: path.basename(req.file.originalname), mimeType: req.file.mimetype,
    filePath: uploaded.secure_url, fileSize: req.file.size,
  } });
  await audit(req, "UPLOAD", "MEDIA", media.id);
  res.status(201).json({ ...media, url: uploaded.secure_url });
}));

app.delete("/api/media/:id", requireStaff, asyncRoute(async (req, res) => {
  const media = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
  if (!media) { res.status(404).json({ error: "Media file not found." }); return; }
  await prisma.mediaAsset.delete({ where: { id: media.id } });
  if (!isSecureFileUrl(media.filePath)) {
    try {
      await unlink(path.resolve(uploadDirectory, path.basename(media.filePath)));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  await audit(req, "DELETE", "MEDIA", media.id);
  res.status(204).end();
}));

app.get("/api/media/:id/file", (req: AuthRequest, res: Response, next: NextFunction) => {
  void prisma.mediaAsset.findUnique({ where: { id: req.params.id } }).then((media) => {
    if (!media) { res.status(404).json({ error: "Media file not found." }); return; }
    const isPdf = media.mediaType.toUpperCase() === "PDF" || media.mimeType.toLowerCase() === "application/pdf" || media.fileName.toLowerCase().endsWith(".pdf");
    if (isPdf && isCloudinaryHost(media.filePath)) {
      void proxyCloudinaryPdf(media.filePath, res).catch(next);
      return;
    }
    if (isSecureFileUrl(media.filePath)) { res.redirect(302, media.filePath); return; }
    const fileName = path.basename(media.filePath);
    if (!fileName) { res.status(404).json({ error: "Media file is unavailable." }); return; }
    res.type(media.mimeType).sendFile(path.resolve(uploadDirectory, fileName), (error) => {
      if (!error || res.headersSent) return;
      if ("code" in error && error.code === "ENOENT") {
        res.status(404).json({ error: "Media file is unavailable." });
        return;
      }
      next(error);
    });
  }).catch(next);
});

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
function isSecureFileUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
function patronGender(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value !== "Male" && value !== "Female") {
    throw new ApiError(400, "Gender must be either 'Male' or 'Female'.");
  }
  return value;
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
async function getFinePerDay(): Promise<number> {
  const settings = await prisma.librarySetting.findUnique({ where: { id: "global" }, select: { finePerDay: true } });
  return settings?.finePerDay ?? defaultFinePerDay;
}
function calculateCurrentFine(recordedFine: number, dueDate: Date, returnedAt: Date | null, finePerDay: number, today: Date): number {
  if (returnedAt) return recordedFine;
  const dueDay = new Date(dueDate);
  dueDay.setUTCHours(0, 0, 0, 0);
  const overdueDays = Math.max(0, Math.floor((today.getTime() - dueDay.getTime()) / 86_400_000));
  return Math.max(recordedFine, roundMoney(overdueDays * finePerDay));
}
async function returnLoanItem(id: string) {
  const [returned] = await returnLoanItems([id]);
  return returned;
}
async function returnLoanItems(ids: string[]) {
  const finePerDay = await getFinePerDay();
  return prisma.$transaction(async (transaction) => {
    const returned = [];
    for (const id of ids) {
      const current = await transaction.loanItem.findUnique({ where: { id }, include: { loan: true } });
      if (!current) throw new ApiError(404, "Loan item not found.");
      if (current.returnedAt) throw new ApiError(409, "This item has already been returned.");
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
      if (current.bookId) {
        await transaction.book.update({ where: { id: current.bookId }, data: { availableCopies: { increment: 1 } } });
      } else if (current.examSheetId) {
        await transaction.examSheet.update({ where: { id: current.examSheetId }, data: { availableCopies: { increment: 1 } } });
      }
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

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ApiError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof multer.MulterError) { res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "File exceeds the 50 MB upload limit." : error.message }); return; }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") { res.status(409).json({ error: "A record with this unique value already exists." }); return; }
    if (error.code === "P2025") { res.status(404).json({ error: "Record not found." }); return; }
    if (error.code === "P2022") {
      console.error(`Database schema is behind the application (${req.method} ${req.path}).`, error);
      res.status(503).json({ error: "The database schema is not up to date. Apply pending database migrations and try again." });
      return;
    }
    if (error.code === "P2034") {
      res.status(409).json({ error: "The record changed during this operation. Reload and try again." });
      return;
    }
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    console.error(`Database is unavailable (${req.method} ${req.path}).`, error);
    res.status(503).json({ error: "The database is currently unavailable. Please try again shortly." });
    return;
  }
  console.error(`API request failed (${req.method} ${req.path}).`, error);
  res.status(500).json({ error: "An unexpected server error occurred." });
});

async function start() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("Set JWT_SECRET to a random secret of at least 32 characters.");
  if (!Number.isFinite(defaultFinePerDay) || defaultFinePerDay < 0) throw new Error("FINE_PER_DAY must be a non-negative number.");
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
