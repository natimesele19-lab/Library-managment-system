UPDATE "Loan" AS loan
SET "borrowerType" = patron."type"
FROM "Patron" AS patron
WHERE patron."id" = loan."patronId"
  AND loan."borrowerType" IS DISTINCT FROM patron."type";
