CREATE TABLE "ExamSheet" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "grade" TEXT,
    "examYear" INTEGER,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "availableCopies" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExamSheet_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExamSheet_title_idx" ON "ExamSheet"("title");
CREATE INDEX "ExamSheet_subject_idx" ON "ExamSheet"("subject");

ALTER TABLE "LoanItem" ALTER COLUMN "bookId" DROP NOT NULL;
ALTER TABLE "LoanItem" ADD COLUMN "examSheetId" TEXT;
CREATE INDEX "LoanItem_examSheetId_returnedAt_idx" ON "LoanItem"("examSheetId", "returnedAt");
ALTER TABLE "LoanItem" ADD CONSTRAINT "LoanItem_examSheetId_fkey"
    FOREIGN KEY ("examSheetId") REFERENCES "ExamSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanItem" ADD CONSTRAINT "LoanItem_item_type_check"
    CHECK (("bookId" IS NOT NULL AND "examSheetId" IS NULL) OR ("bookId" IS NULL AND "examSheetId" IS NOT NULL));

ALTER TABLE "LibrarySetting" ADD COLUMN "finePerDay" DOUBLE PRECISION NOT NULL DEFAULT 5;