ALTER TABLE "LibrarySetting"
ADD COLUMN "logoUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN "landingTitle" TEXT NOT NULL DEFAULT 'A brighter way to discover your next favorite book.',
ADD COLUMN "heroSubtitle" TEXT NOT NULL DEFAULT 'One welcoming place to explore, borrow, and manage your library.',
ADD COLUMN "aboutTitle" TEXT NOT NULL DEFAULT 'A library that moves with you.',
ADD COLUMN "aboutText" TEXT NOT NULL DEFAULT 'Bring your collection, readers, and everyday library work together in one thoughtful digital space.',
ADD COLUMN "featuresTitle" TEXT NOT NULL DEFAULT 'Everything your library needs.',
ADD COLUMN "catalogTitle" TEXT NOT NULL DEFAULT 'Find your next read.',
ADD COLUMN "contactTitle" TEXT NOT NULL DEFAULT 'Let’s stay in touch.',
ADD COLUMN "contactPhone" TEXT NOT NULL DEFAULT '',
ADD COLUMN "contactEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN "announcement" TEXT NOT NULL DEFAULT '',
ADD COLUMN "footerCopyright" TEXT NOT NULL DEFAULT 'MADE BY NATNAEL MESELE';
