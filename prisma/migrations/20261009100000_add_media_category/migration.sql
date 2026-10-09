ALTER TABLE "MediaAsset" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'Other';

CREATE INDEX "MediaAsset_category_idx" ON "MediaAsset"("category");
