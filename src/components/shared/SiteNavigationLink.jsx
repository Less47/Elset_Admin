import { useState } from "react";
import { Navigation } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getNavigationLinks } from "@/lib/site-navigation";
import { cn } from "@/lib/utils";

const linkClass = "inline-flex min-h-6 max-lg:min-h-11 max-w-full items-center gap-1.5 rounded-sm text-left text-foreground underline underline-offset-4 hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export default function SiteNavigationLink({ destination, variant = "address" }) {
  const links = getNavigationLinks(destination);
  const [attemptedHref, setAttemptedHref] = useState(null);
  if (!links) return <span className="text-xs text-muted-foreground">Navigation unavailable</span>;

  return <span className="inline-flex min-w-0 max-w-full flex-col items-start">
    <a href={links.href} target="_blank" rel="noopener noreferrer"
      aria-label={`Navigate to ${links.label}`}
      title={`Directions in ${links.provider} (new tab or app)`}
      className={variant === "button" ? cn(buttonVariants({ variant: "outline", size: "sm" })) : linkClass}
      onClick={() => setAttemptedHref(links.href)}>
      <Navigation className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{variant === "button" ? "Navigate" : links.label}</span>
    </a>
    {/* Browsers cannot report whether an HTTPS link handed off to a native app.
        Keep a deliberate Google fallback after an Apple launch; no timed guesses. */}
    {links.fallbackHref && attemptedHref === links.href && <a href={links.fallbackHref} target="_blank" rel="noopener noreferrer"
      className={`${linkClass} mt-1 text-xs`} aria-label={`Use Google Maps instead for ${links.label}`}>
      Use Google Maps instead
    </a>}
  </span>;
}
