import { useEffect, useState } from "react";
import {
  ArrowRight, ArrowUpRight, BookOpen, Globe2, LibraryBig, Mail, Menu, Phone,
  QrCode, Repeat2, Search, ShieldCheck, Sparkles, X,
} from "lucide-react";
import { api } from "./api";
import type { LibrarySettings } from "./SettingsContext";

type PublicBook = {
  id: string;
  title: string;
  author: string;
  category: string | null;
  publishedYear: number | null;
  availableCopies: number;
};

const features = [
  { icon: QrCode, number: "01", title: "QR-ready circulation", description: "Create scannable IDs and move checkouts and returns along in moments." },
  { icon: Search, number: "02", title: "Find it fast", description: "Search titles, authors, and subjects to get straight to the right book." },
  { icon: BookOpen, number: "03", title: "One digital catalog", description: "Keep books and learning resources organized in one easy-to-browse place." },
  { icon: Repeat2, number: "04", title: "Loans made clear", description: "See what is borrowed, what is due, and what is ready for its next reader." },
];

export function LandingPage({ settings, onLogin }: { settings: LibrarySettings; onLogin: () => void }) {
  const [books, setBooks] = useState<PublicBook[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.get<PublicBook[]>("/public/catalog").then((records) => {
      if (!cancelled) setBooks(records);
    }).catch((cause: unknown) => {
      if (!cancelled) setCatalogError(cause instanceof Error ? cause.message : "The catalog is temporarily unavailable.");
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

  return <main className="landing-page">
    {settings.announcement && <div className="landing-announcement"><Sparkles size={14} /><span>{settings.announcement}</span></div>}
    <header className="landing-nav">
      <a className="landing-brand" href="#home" aria-label={`${settings.libraryName} home`} onClick={closeMenu}>
        <span className="landing-brand-mark">{settings.logoUrl ? <img src={settings.logoUrl} alt="" /> : <LibraryBig size={21} />}</span>
        <span><strong>{settings.libraryName}</strong><small>READ · DISCOVER · GROW</small></span>
      </a>
      <button className="landing-menu-toggle" type="button" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
        {menuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      <nav className={`landing-nav-links ${menuOpen ? "is-open" : ""}`} aria-label="Main navigation">
        <a href="#about" onClick={closeMenu}>About</a>
        <a href="#features" onClick={closeMenu}>Features</a>
        <a href="#catalog" onClick={closeMenu}>Catalog</a>
        <a href="#contact" onClick={closeMenu}>Contact</a>
        <button type="button" className="landing-nav-login" onClick={() => { closeMenu(); onLogin(); }}>Go to Login <ArrowUpRight size={15} /></button>
      </nav>
    </header>

    <section className="landing-hero" id="home">
      <div className="landing-hero-glow landing-glow-one" />
      <div className="landing-hero-glow landing-glow-two" />
      <div className="landing-hero-inner">
        <div className="landing-hero-copy landing-reveal">
          <div className="landing-eyebrow"><span className="landing-eyebrow-dot" /> YOUR COMMUNITY. YOUR LIBRARY.</div>
          <h1>{settings.landingTitle}</h1>
          <p className="landing-hero-subtitle">{settings.heroSubtitle}</p>
          <div className="landing-hero-actions">
            <button type="button" className="landing-button landing-button-primary" onClick={onLogin}>Get started <ArrowRight size={17} /></button>
            <a className="landing-button landing-button-secondary" href="#catalog">Explore the catalog <BookOpen size={16} /></a>
          </div>
          <div className="landing-hero-proof"><span className="landing-proof-icon"><ShieldCheck size={16} /></span><span>Thoughtful tools for readers and library teams</span></div>
        </div>
        <div className="landing-showcase landing-reveal" aria-label="A preview of the library catalog">
          <div className="landing-showcase-top"><span className="landing-live-dot" /> LIBRARY, IN A NEW LIGHT <span className="landing-showcase-menu">···</span></div>
          <div className="landing-showcase-heading"><div><span className="landing-showcase-overline">YOUR NEXT CHAPTER</span><h2>Make room<br />for wonder.</h2></div><div className="landing-showcase-orbit"><BookOpen size={38} strokeWidth={1.2} /></div></div>
          <div className="landing-showcase-books">
            <div className="landing-book-art landing-book-art-one"><span>THE ART OF<br />SLOW LIVING</span><small>FIELD NOTES</small></div>
            <div className="landing-book-art landing-book-art-two"><span>GROWING<br />TOGETHER</span><small>A NEW BEGINNING</small></div>
            <div className="landing-book-art landing-book-art-three"><span>THE<br />WILDERNESS<br />WITHIN</span><small>ESSAYS · VOL. 02</small></div>
          </div>
          <div className="landing-showcase-footer"><span><span className="landing-live-dot" /> A world of knowledge, always within reach</span><ArrowUpRight size={15} /></div>
          <div className="landing-float-note"><span className="landing-float-check">✓</span><span><strong>Good things are growing</strong><small>One more book found its reader</small></span></div>
        </div>
      </div>
      <a className="landing-scroll-cue" href="#about"><span /> SCROLL TO EXPLORE</a>
    </section>

    <section className="landing-about landing-section" id="about">
      <div className="landing-about-decoration" aria-hidden="true"><span>LIBRARY</span><span>EST. FOR EVERYONE</span></div>
      <div className="landing-about-inner landing-reveal">
        <div><p className="landing-eyebrow">MORE THAN BOOKSHELVES</p><h2>{settings.aboutTitle}</h2></div>
        <div className="landing-about-copy"><p>{settings.aboutText}</p><p>From the first search to the final return, every detail is designed to make learning feel a little more open and a lot more connected.</p><a href="#features" className="landing-text-link">See what you can do <ArrowRight size={15} /></a></div>
      </div>
      <div className="landing-values">
        <div><span className="landing-value-icon"><Globe2 size={18} /></span><span><strong>Open to everyone</strong><small>Knowledge without barriers</small></span></div>
        <div><span className="landing-value-icon"><Sparkles size={18} /></span><span><strong>Made for discovery</strong><small>Find something unexpected</small></span></div>
        <div><span className="landing-value-icon"><ShieldCheck size={18} /></span><span><strong>Thoughtfully organized</strong><small>Less admin, more reading</small></span></div>
      </div>
    </section>

    <section className="landing-features landing-section" id="features">
      <div className="landing-section-heading landing-reveal"><div><p className="landing-eyebrow">A BETTER WAY TO LIBRARY</p><h2>{settings.featuresTitle}</h2></div><p>Built around the real moments that make a library work beautifully.</p></div>
      <div className="landing-feature-grid">
        {features.map(({ icon: Icon, number, title, description }, index) => <article className="landing-feature-card landing-reveal" key={number} style={{ transitionDelay: `${index * 75}ms` }}>
          <div className="landing-feature-card-top"><span className="landing-feature-icon"><Icon size={20} /></span><span>{number}</span></div>
          <h3>{title}</h3><p>{description}</p><span className="landing-feature-arrow"><ArrowUpRight size={16} /></span>
        </article>)}
      </div>
    </section>

    <section className="landing-catalog landing-section" id="catalog">
      <div className="landing-catalog-heading landing-reveal"><div><p className="landing-eyebrow">A LITTLE PREVIEW</p><h2>{settings.catalogTitle}</h2><p>Take a look at what’s waiting on the shelves.</p></div><span className="landing-catalog-stamp"><BookOpen size={17} /> OPEN SHELVES</span></div>
      {catalogLoading ? <div className="landing-catalog-state" role="status">Finding a few good reads…</div>
        : catalogError ? <div className="landing-catalog-state landing-catalog-error" role="alert">{catalogError}</div>
          : books.length ? <div className="landing-catalog-grid">{books.map((book, index) => <article className={`landing-catalog-card landing-cover-${index % 4}`} key={book.id}>
            <span className="landing-catalog-category">{book.category || "A good read"}</span><div className="landing-catalog-cover"><BookOpen size={24} strokeWidth={1.4} /></div>
            <h3>{book.title}</h3><p>by {book.author}</p><div className="landing-catalog-meta"><span>{book.publishedYear || "From the collection"}</span><span className={book.availableCopies > 0 ? "is-available" : ""}>{book.availableCopies > 0 ? `${book.availableCopies} available` : "Currently borrowed"}</span></div>
          </article>)}</div>
            : <div className="landing-catalog-state">The catalog is ready for its first titles. Check back soon.</div>}
      <div className="landing-catalog-cta"><p>Found something you love?</p><button type="button" className="landing-button landing-button-primary" onClick={onLogin}>Visit your library <ArrowRight size={16} /></button></div>
    </section>

    <section className="landing-contact landing-section" id="contact">
      <div className="landing-contact-card landing-reveal">
        <div className="landing-contact-copy"><p className="landing-eyebrow">HERE TO HELP</p><h2>{settings.contactTitle}</h2><p>Have a question, an idea, or just want to say hello? Our library team would love to hear from you.</p></div>
        <div className="landing-contact-links">
          {settings.contactEmail && <a href={`mailto:${settings.contactEmail}`}><span><Mail size={18} /></span><span><small>EMAIL US</small><strong>{settings.contactEmail}</strong></span><ArrowUpRight size={15} /></a>}
          {settings.contactPhone && <a href={`tel:${settings.contactPhone.replace(/[^\d+]/g, "")}`}><span><Phone size={18} /></span><span><small>GIVE US A CALL</small><strong>{settings.contactPhone}</strong></span><ArrowUpRight size={15} /></a>}
          {!settings.contactEmail && !settings.contactPhone && <p className="landing-contact-empty">Contact details will be shared here soon.</p>}
        </div>
        <div className="landing-contact-orb" aria-hidden="true"><LibraryBig size={95} strokeWidth={.7} /></div>
      </div>
    </section>

    <footer className="landing-footer">
      <a className="landing-brand" href="#home"><span className="landing-brand-mark">{settings.logoUrl ? <img src={settings.logoUrl} alt="" /> : <LibraryBig size={21} />}</span><span><strong>{settings.libraryName}</strong><small>READ · DISCOVER · GROW</small></span></a>
      <p>Made for curious minds and the people who help them grow.</p>
      <span className="landing-copyright">{settings.footerCopyright}</span>
    </footer>
  </main>;
}
