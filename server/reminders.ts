import "dotenv/config";
import nodemailer, { type Transporter } from "nodemailer";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

let transporter: Transporter | null = null;
let hasWarnedAboutMissingSmtp = false;

function getTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    if (!hasWarnedAboutMissingSmtp) {
      console.warn("Overdue email reminders are disabled: configure SMTP_HOST and EMAIL_FROM.");
      hasWarnedAboutMissingSmtp = true;
    }
    return null;
  }
  if (transporter) return transporter;

  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT must be a valid TCP port.");
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD;
  if (Boolean(user) !== Boolean(pass)) throw new Error("Configure both SMTP_USER and SMTP_PASSWORD, or neither.");

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    ...(user && pass ? { auth: { user, pass } } : {}),
  });
  return transporter;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

export async function sendDailyOverdueReminders() {
  const mailer = getTransporter();
  if (!mailer) return { sent: 0, skipped: 0 };

  const now = new Date();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const reminderDay = today.toISOString().slice(0, 10);
  const items = await prisma.loanItem.findMany({
    where: {
      returnedAt: null,
      loan: { status: "ACTIVE", dueDate: { lt: today }, patron: { active: true } },
      reminders: { none: { reminderDay } },
    },
    include: {
      book: { select: { title: true } },
      loan: { include: { patron: { select: { id: true, name: true, email: true } } } },
    },
    orderBy: [{ loan: { patronId: "asc" } }, { loan: { dueDate: "asc" } }],
  });

  const recipients = new Map<string, typeof items>();
  for (const item of items) {
    const group = recipients.get(item.loan.patron.id) || [];
    group.push(item);
    recipients.set(item.loan.patron.id, group);
  }

  const sender = process.env.EMAIL_FROM?.trim();
  if (!sender) throw new Error("EMAIL_FROM is required when SMTP_HOST is configured.");
  let sent = 0;
  let skipped = 0;

  for (const borrowerItems of recipients.values()) {
    const patron = borrowerItems[0].loan.patron;
    const recipient = patron.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      console.error(`Unable to send overdue reminder: patron ${patron.id} has an invalid email address.`);
      skipped += 1;
      continue;
    }

    const list = borrowerItems.map((item) => {
      const due = item.loan.dueDate.toISOString().slice(0, 10);
      return `<li><strong>${escapeHtml(item.book.title)}</strong> — due ${due}</li>`;
    }).join("");
    const plainList = borrowerItems.map((item) =>
      `- ${item.book.title} (due ${item.loan.dueDate.toISOString().slice(0, 10)})`,
    ).join("\n");

    try {
      await mailer.sendMail({
        from: sender,
        to: recipient,
        subject: "Library overdue book reminder",
        text: `Hello ${patron.name},\n\nThe following library books are overdue:\n${plainList}\n\nPlease contact the library to arrange their return.`,
        html: `<p>Hello ${escapeHtml(patron.name)},</p><p>The following library books are overdue:</p><ul>${list}</ul><p>Please contact the library to arrange their return.</p>`,
      });
      await prisma.overdueReminder.createMany({
        data: borrowerItems.map((item) => ({ loanItemId: item.id, reminderDay })),
      });
      sent += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        console.warn(`Overdue reminders were already recorded for patron ${patron.id} on ${reminderDay}.`);
        continue;
      }
      console.error(`Unable to send overdue reminder for patron ${patron.id}:`, error);
      skipped += 1;
    }
  }

  if (sent || skipped) console.info(`Overdue reminder run complete: ${sent} sent, ${skipped} skipped.`);
  return { sent, skipped };
}
