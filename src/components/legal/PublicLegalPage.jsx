import { legalBusinessDetails, legalDocuments } from "@/lib/legal-documents";
import { themePresets } from "@/lib/theme-presets";
import { buildSemanticTheme } from "@/lib/theme-tokens";

// Public branding is independent of account preferences and workspace data.
const publicTheme = buildSemanticTheme(themePresets.find((preset) => preset.id === "elset").values);
const linkClass = "rounded-sm underline decoration-current/40 underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-status-info";

export default function PublicLegalPage({ document }) {
  return (
    <div style={publicTheme.vars} className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,144,205,0.12),_transparent_34%),linear-gradient(180deg,_#f8fbfd_0%,_#eef5f9_100%)] text-foreground">
      <title>{document.title}</title>
      <meta name="description" content={document.introduction} />
      <a href="#legal-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-lg focus:bg-white focus:p-3 focus:text-foreground">Skip to content</a>
      <header className="border-b border-border/15 bg-white/80 px-5 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 py-5">
          <a href="/" aria-label="ELSET home" className={linkClass}>
            <img src="/elset-logo.png" alt="ELSET" className="h-10 w-auto sm:h-12" />
          </a>
          <nav aria-label="Legal pages" className="flex items-center gap-5 text-sm font-medium">
            {Object.entries(legalDocuments).map(([path, entry]) => (
              <a key={path} href={path} aria-current={document === entry ? "page" : undefined} className={`${linkClass} ${document === entry ? "text-status-info" : "text-text-secondary"}`}>{entry.label}</a>
            ))}
            <a href="/" className={linkClass}>Sign in</a>
          </nav>
        </div>
      </header>
      <main id="legal-content" className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-status-info">ELSET / Legal</p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{document.title}</h1>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-text-secondary">
            <p>Effective: <time dateTime="2026-09-21">{document.effectiveDate}</time></p>
            <p>Last updated: <time dateTime="2026-09-21">{document.updatedDate}</time></p>
          </div>
          <p className="mt-6 text-base leading-7 text-text-secondary sm:text-lg sm:leading-8">{document.introduction}</p>
        </div>
        <div className="mt-10 grid items-start gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
          <nav aria-label="On this page" className="rounded-2xl border border-border/15 bg-card/60 p-5 text-sm leading-6">
            <h2 className="font-semibold">On this page</h2>
            <ol className="mt-3 space-y-2 text-text-secondary">
              {document.sections.map((section) => <li key={section.id}><a href={`#${section.id}`} className={linkClass}>{section.title}</a></li>)}
              <li><a href="#contact" className={linkClass}>Business details and contact</a></li>
            </ol>
          </nav>
          <article aria-label={document.title} className="min-w-0 space-y-9 text-base leading-7">
            {document.sections.map((section, index) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-6">
                <h2 id={`${section.id}-heading`} className="text-xl font-semibold leading-7 tracking-tight">{index + 1}. {section.title}</h2>
                {section.paragraphs?.map((paragraph) => <p key={paragraph} className="mt-3 text-text-secondary">{paragraph}</p>)}
                {section.items && <ul className="mt-3 list-disc space-y-3 pl-5 text-text-secondary">{section.items.map((item) => <li key={item} className="pl-1">{item}</li>)}</ul>}
              </section>
            ))}
            <section id="contact" aria-labelledby="contact-heading" className="scroll-mt-6 rounded-2xl border border-border/20 bg-card p-5 sm:p-6">
              <h2 id="contact-heading" className="text-xl font-semibold">Business details and contact</h2>
              <dl className="mt-5 space-y-4 text-sm leading-6">
                {legalBusinessDetails.map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd className="mt-1 break-words text-text-secondary">{value}</dd></div>)}
              </dl>
            </section>
          </article>
        </div>
      </main>
      <footer className="border-t border-border/15 px-5 py-7 text-sm text-text-secondary sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-4">
          <p>ELSET · Field-service and business-management software</p>
          <a href="#legal-content" className={linkClass}>Back to top</a>
        </div>
      </footer>
    </div>
  );
}
