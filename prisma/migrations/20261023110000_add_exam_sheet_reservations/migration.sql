ALTER TABLE "BookReservation" ALTER COLUMN "bookId" DROP NOT NULL;
ALTER TABLE "BookReservation" ADD COLUMN "examSheetId" TEXT;

CREATE INDEX "BookReservation_examSheetId_status_idx" ON "BookReservation"("examSheetId", "status");

ALTER TABLE "BookReservation" ADD CONSTRAINT "BookReservation_examSheetId_fkey"
    FOREIGN KEY ("examSheetId") REFERENCES "ExamSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookReservation" ADD CONSTRAINT "BookReservation_item_type_check"
    CHECK (("bookId" IS NOT NULL AND "examSheetId" IS NULL) OR ("bookId" IS NULL AND "examSheetId" IS NOT NULL));
