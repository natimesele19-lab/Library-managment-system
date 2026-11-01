ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Tenant" ("id", "slug", "name", "updatedAt")
SELECT 'default', 'default', COALESCE(
    (SELECT "libraryName" FROM "LibrarySetting" WHERE "id" = 'global' LIMIT 1),
    'Libra'
), CURRENT_TIMESTAMP
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "User" ADD COLUMN "tenantId" TEXT DEFAULT 'default';
ALTER TABLE "Book" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "ExamSheet" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "Patron" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "Loan" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "LoanItem" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "BookReservation" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "InventoryAsset" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "MediaAsset" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "FinePayment" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "OverdueReminder" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "LibrarySetting" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "CustomField" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "AuditLog" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE UNIQUE INDEX "LibrarySetting_tenantId_key" ON "LibrarySetting"("tenantId");
DROP INDEX "User_email_key";
DROP INDEX "Book_isbn_key";
DROP INDEX "Patron_memberCode_key";
DROP INDEX "Patron_email_key";
DROP INDEX "CustomField_key_entity_key";
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");
CREATE UNIQUE INDEX "User_platform_email_key" ON "User"("email") WHERE "tenantId" IS NULL;
CREATE UNIQUE INDEX "Book_tenantId_isbn_key" ON "Book"("tenantId", "isbn");
CREATE UNIQUE INDEX "Patron_tenantId_memberCode_key" ON "Patron"("tenantId", "memberCode");
CREATE UNIQUE INDEX "Patron_tenantId_email_key" ON "Patron"("tenantId", "email");
CREATE UNIQUE INDEX "CustomField_tenantId_key_entity_key" ON "CustomField"("tenantId", "key", "entity");
CREATE INDEX "User_tenantId_role_active_idx" ON "User"("tenantId", "role", "active");
CREATE INDEX "Book_tenantId_title_idx" ON "Book"("tenantId", "title");
CREATE INDEX "ExamSheet_tenantId_title_idx" ON "ExamSheet"("tenantId", "title");
CREATE INDEX "Patron_tenantId_type_active_idx" ON "Patron"("tenantId", "type", "active");
CREATE INDEX "Loan_tenantId_status_idx" ON "Loan"("tenantId", "status");
CREATE INDEX "LoanItem_tenantId_loanId_idx" ON "LoanItem"("tenantId", "loanId");
CREATE INDEX "BookReservation_tenantId_status_idx" ON "BookReservation"("tenantId", "status");
CREATE INDEX "InventoryAsset_tenantId_category_idx" ON "InventoryAsset"("tenantId", "category");
CREATE INDEX "MediaAsset_tenantId_createdAt_idx" ON "MediaAsset"("tenantId", "createdAt");
CREATE INDEX "FinePayment_tenantId_paidAt_idx" ON "FinePayment"("tenantId", "paidAt");
CREATE INDEX "OverdueReminder_tenantId_reminderDay_idx" ON "OverdueReminder"("tenantId", "reminderDay");
CREATE INDEX "CustomField_tenantId_entity_idx" ON "CustomField"("tenantId", "entity");
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Book" ADD CONSTRAINT "Book_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExamSheet" ADD CONSTRAINT "ExamSheet_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Patron" ADD CONSTRAINT "Patron_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanItem" ADD CONSTRAINT "LoanItem_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookReservation" ADD CONSTRAINT "BookReservation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAsset" ADD CONSTRAINT "InventoryAsset_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinePayment" ADD CONSTRAINT "FinePayment_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OverdueReminder" ADD CONSTRAINT "OverdueReminder_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LibrarySetting" ADD CONSTRAINT "LibrarySetting_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
