ALTER TABLE "Loan"
ADD COLUMN "borrowerType" "PatronType" NOT NULL DEFAULT 'STUDENT';

UPDATE "Loan" AS loan
SET "borrowerType" = patron."type"
FROM "Patron" AS patron
WHERE patron."id" = loan."patronId";

CREATE INDEX "Loan_borrowerType_status_idx" ON "Loan"("borrowerType", "status");
