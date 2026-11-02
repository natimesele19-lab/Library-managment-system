import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight, ArrowUpRight, BookOpen, Globe2, Languages, LibraryBig, Mail, Menu, Moon, Phone,
  QrCode, Repeat2, Search, ShieldCheck, Sparkles, Sun, X,
} from "lucide-react";
import { api } from "./api";
import i18n from "./i18n";
import { PLATFORM_NAME, type LibrarySettings } from "./SettingsContext";

type PublicBook = {
  id: string;
  title: string;
  author: string;
  category: string | null;
  publishedYear: number | null;
  availableCopies: number;
};

const features = [
  { icon: QrCode, number: "01", title: "landingFeatureQr", description: "landingFeatureQrDetail" },
  { icon: Search, number: "02", title: "landingFeatureSearch", description: "landingFeatureSearchDetail" },
  { icon: BookOpen, number: "03", title: "landingFeatureCatalog", description: "landingFeatureCatalogDetail" },
  { icon: Repeat2, number: "04", title: "landingFeatureLoans", description: "landingFeatureLoansDetail" },
];

export function LandingPage({ settings, onLogin, darkMode, onToggleTheme }: {
  settings: LibrarySettings; onLogin: () => void; darkMode: boolean; onToggleTheme: () => void;
}) {
  const { t } = useTranslation();
  const [books, setBooks] = useState<PublicBook[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.get<PublicBook[]>("/public/catalog").then((records) => {
      if (!cancelled) setBooks(records);
    }).catch(() => {
      if (!cancelled) setCatalogError(t("catalogUnavailable"));
    }).finally(() => {
      if (!cancelled) setCatalogLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const revealItems = document.querySelectorAll<HTMLElement>(".landing-reveal");
    if (!("IntersectionObserver" in window)) {
      revealItems.forEach((item) => item.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealItems.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  const closeMenu = () => setMenuOpen(false);
  const localizeSetting = (key: string, value: string, defaultValue: string) => {
    if (value === defaultValue) return t(key);
    return i18n.language === "am"
      ? settings.amharicText[key] || value
      : settings.englishText[key] || value;
  };

  return <main className="landing-page">
    {settings.announcement && <div className="landing-announcement"><Sparkles size={14} /><span>{localizeSetting("announcement", settings.announcement, "")}</span></div>}
    <header className="landing-nav">
      <a className="landing-brand" href="#home" aria-label={t("landingHome", { name: PLATFORM_NAME })} onClick={closeMenu}>
        <span className="landing-brand-mark">{settings.logoUrl ? <img src={settings.logoUrl} alt="" /> : <LibraryBig size={21} />}</span>
        <span><strong>{PLATFORM_NAME}</strong><small>{t("landingBrandTagline")}</small></span>
      </a>
      <button className="landing-menu-toggle" type="button" aria-label={menuOpen ? t("closeNavigation") : t("openNavigation")} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
        {menuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      <nav className={`landing-nav-links ${menuOpen ? "is-open" : ""}`} aria-label={t("mainNavigation")}>
        <a href="#features" onClick={closeMenu}>{t("features")}</a>
        <a href="#about" onClick={closeMenu}>{t("about")}</a>
        <a href="#catalog" onClick={closeMenu}>{t("catalog")}</a>
        <a href="#contact" onClick={closeMenu}>{t("contact")}</a>
        <button type="button" className="landing-language-toggle" aria-label={t("language")} title={t("language")} onClick={() => { void i18n.changeLanguage(i18n.language === "en" ? "am" : "en"); closeMenu(); }}>
          <Languages size={14} />{i18n.language === "en" ? t("amharic") : t("english")}
        </button>
        <button type="button" className="landing-language-toggle landing-theme-toggle" aria-label={t(darkMode ? "lightMode" : "darkMode")} title={t(darkMode ? "lightMode" : "darkMode")} onClick={onToggleTheme}>
          {darkMode ? <Sun size={14} /> : <Moon size={14} />}<span>{t(darkMode ? "lightMode" : "darkMode")}</span>
        </button>
        <button type="button" className="landing-nav-login" onClick={() => { closeMenu(); onLogin(); }}>{t("goToLogin")} <ArrowUpRight size={15} /></button>
      </nav>
    </header>

    <section className="landing-hero" id="home">
      <div className="landing-hero-glow landing-glow-one" />
      <div className="landing-hero-glow landing-glow-two" />
      <div className="landing-hero-inner">
        <div className="landing-hero-copy landing-reveal">
          <div className="landing-eyebrow"><span className="landing-eyebrow-dot" /> {t("landingHeroEyebrow")}</div>
          <h1>{localizeSetting("landingTitle", settings.landingTitle, "A brighter way to discover your next favorite book.")}</h1>
          <p className="landing-hero-subtitle">{localizeSetting("heroSubtitle", settings.heroSubtitle, "One welcoming place to explore, borrow, and manage your library.")}</p>
          <div className="landing-hero-actions">
            <button type="button" className="landing-button landing-button-primary" onClick={onLogin}>{t("getStarted")} <ArrowRight size={17} /></button>
            <a className="landing-button landing-button-secondary" href="#catalog">{t("exploreCatalog")} <BookOpen size={16} /></a>
          </div>
          <div className="landing-hero-proof"><span className="landing-proof-icon"><ShieldCheck size={16} /></span><span>{t("landingHeroProof")}</span></div>
        </div>
        <div className="landing-showcase landing-reveal" aria-label={t("catalogPreview")}>
          <div className="landing-showcase-top"><span className="landing-live-dot" /> {t("landingShowcaseLabel")} <span className="landing-showcase-menu">···</span></div>
          <div className="landing-showcase-heading"><div><span className="landing-showcase-overline">{t("landingShowcaseOverline")}</span><h2>{t("landingShowcaseTitle")}</h2></div><div className="landing-showcase-orbit"><BookOpen size={38} strokeWidth={1.2} /></div></div>
          <div className="landing-showcase-books">
            <div className="landing-book-art landing-book-art-one"><span>{t("coverSlowLiving")}</span><small>{t("coverFieldNotes")}</small></div>
            <div className="landing-book-art landing-book-art-two"><span>{t("coverGrowingTogether")}</span><small>{t("coverNewBeginning")}</small></div>
            <div className="landing-book-art landing-book-art-three"><span>{t("coverWilderness")}</span><small>{t("coverEssays")}</small></div>
          </div>
          <div className="landing-showcase-footer"><span><span className="landing-live-dot" /> {t("landingShowcaseFooter")}</span><ArrowUpRight size={15} /></div>
          <div className="landing-float-note"><span className="landing-float-check">✓</span><span><strong>{t("landingFloatTitle")}</strong><small>{t("landingFloatDetail")}</small></span></div>
        </div>
      </div>
      <a className="landing-scroll-cue" href="#about"><span /> {t("scrollToExplore")}</a>
    </section>

    <section className="landing-about landing-section" id="about">
      <div className="landing-about-decoration" aria-hidden="true"><span>{t("library")}</span><span>{t("landingOpenToAll")}</span></div>
      <div className="landing-about-inner landing-reveal">
        <div><p className="landing-eyebrow">{t("landingAboutEyebrow")}</p><h2>{localizeSetting("aboutTitle", settings.aboutTitle, "A library that moves with you.")}</h2></div>
        <div className="landing-about-copy"><p>{localizeSetting("aboutText", settings.aboutText, "Bring your collection, readers, and everyday library work together in one thoughtful digital space.")}</p><p>{t("landingAboutDetail")}</p><a href="#features" className="landing-text-link">{t("seeWhatYouCanDo")} <ArrowRight size={15} /></a></div>
      </div>
      <div className="landing-values">
        <div><span className="landing-value-icon"><Globe2 size={18} /></span><span><strong>{t("landingValueOpen")}</strong><small>{t("landingValueOpenDetail")}</small></span></div>
        <div><span className="landing-value-icon"><Sparkles size={18} /></span><span><strong>{t("landingValueDiscovery")}</strong><small>{t("landingValueDiscoveryDetail")}</small></span></div>
        <div><span className="landing-value-icon"><ShieldCheck size={18} /></span><span><strong>{t("landingValueOrganized")}</strong><small>{t("landingValueOrganizedDetail")}</small></span></div>
      </div>
    </section>

    <section className="landing-features landing-section" id="features">
      <div className="landing-section-heading landing-reveal"><div><p className="landing-eyebrow">{t("landingFeaturesEyebrow")}</p><h2>{localizeSetting("featuresTitle", settings.featuresTitle, "Everything your library needs.")}</h2></div><p>{t("landingFeaturesDetail")}</p></div>
      <div className="landing-feature-grid">
        {features.map(({ icon: Icon, number, title, description }, index) => <article className="landing-feature-card landing-reveal" key={number} style={{ transitionDelay: `${index * 75}ms` }}>
          <div className="landing-feature-card-top"><span className="landing-feature-icon"><Icon size={20} /></span><span>{number}</span></div>
          <h3>{t(title)}</h3><p>{t(description)}</p><span className="landing-feature-arrow"><ArrowUpRight size={16} /></span>
        </article>)}
      </div>
    </section>

    <section className="landing-catalog landing-section" id="catalog">
      <div className="landing-catalog-heading landing-reveal"><div><p className="landing-eyebrow">{t("landingCatalogEyebrow")}</p><h2>{localizeSetting("catalogTitle", settings.catalogTitle, "Find your next read.")}</h2><p>{t("landingCatalogDetail")}</p></div><span className="landing-catalog-stamp"><BookOpen size={17} /> {t("openShelves")}</span></div>
      {catalogLoading ? <div className="landing-catalog-state" role="status">{t("findingBooks")}</div>
        : catalogError ? <div className="landing-catalog-state landing-catalog-error" role="alert">{catalogError}</div>
          : books.length ? <div className="landing-catalog-grid">{books.map((book, index) => <article className={`landing-catalog-card landing-cover-${index % 4}`} key={book.id}>
            <span className="landing-catalog-category">{book.category || t("goodRead")}</span><div className="landing-catalog-cover"><BookOpen size={24} strokeWidth={1.4} /></div>
            <h3>{book.title}</h3><p>{t("byAuthor", { author: book.author })}</p><div className="landing-catalog-meta"><span>{book.publishedYear || t("fromCollection")}</span><span className={book.availableCopies > 0 ? "is-available" : ""}>{book.availableCopies > 0 ? t("copiesAvailable", { count: book.availableCopies }) : t("currentlyBorrowed")}</span></div>
          </article>)}</div>
            : <div className="landing-catalog-state">{t("catalogEmpty")}</div>}
          <div className="landing-catalog-cta"><p>{t("catalogCtaQuestion")}</p><button type="button" className="landing-button landing-button-primary" onClick={onLogin}>{t("visitLibrary")} <ArrowRight size={16} /></button></div>
    </section>

    <section className="landing-contact landing-section" id="contact">
      <div className="landing-contact-card landing-reveal">
        <div className="landing-contact-copy"><p className="landing-eyebrow">{t("landingContactEyebrow")}</p><h2>{localizeSetting("contactTitle", settings.contactTitle, "Let’s stay in touch.")}</h2><p>{t("landingContactDetail")}</p></div>
        <div className="landing-contact-links">
          {settings.contactEmail && <a href={`mailto:${settings.contactEmail}`}><span><Mail size={18} /></span><span><small>{t("emailUs")}</small><strong>{settings.contactEmail}</strong></span><ArrowUpRight size={15} /></a>}
          {settings.contactPhone && <a href={`tel:${settings.contactPhone.replace(/[^\d+]/g, "")}`}><span><Phone size={18} /></span><span><small>{t("giveUsCall")}</small><strong>{settings.contactPhone}</strong></span><ArrowUpRight size={15} /></a>}
          {!settings.contactEmail && !settings.contactPhone && <p className="landing-contact-empty">{t("contactDetailsSoon")}</p>}
        </div>
        <div className="landing-contact-orb" aria-hidden="true"><LibraryBig size={95} strokeWidth={.7} /></div>
      </div>
    </section>

    <footer className="landing-footer">
      <a className="landing-brand" href="#home"><span className="landing-brand-mark">{settings.logoUrl ? <img src={settings.logoUrl} alt="" /> : <LibraryBig size={21} />}</span><span><strong>{PLATFORM_NAME}</strong><small>{t("landingBrandTagline")}</small></span></a>
      <p>{t("landingFooterDescription")}</p>
      <span className="landing-copyright">{localizeSetting("footerCopyright", settings.footerCopyright, "MADE BY NATNAEL MESELE")}</span>
    </footer>
  </main>;
}
