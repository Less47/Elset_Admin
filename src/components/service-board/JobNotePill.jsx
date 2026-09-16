export default function JobNotePill({ note, variant = "edge", withFloatingPrice = false }) {
  if (!note) return null;
  const placement = variant === "inline"
    ? "min-w-6 max-w-32"
    : variant === "floating"
      ? "service-board-floating-pill left-0 z-20 max-w-[calc(100%-0.5rem)]"
      : "absolute bottom-0 left-1 z-20 max-w-[calc(100%-1rem)] translate-y-1/2";
  return (
    <span
      data-service-board-note
      title={note}
      aria-label={`Job note: ${note}`}
      className={`${placement} truncate rounded-full border border-board-note-border bg-board-note px-1.5 py-px text-[10px] font-semibold leading-4 text-board-note-foreground shadow-sm`}
      style={variant === "floating" && withFloatingPrice ? {
        maxWidth: "calc(100% - var(--job-price-width, 5rem) - 0.5rem)",
        paddingInline: "clamp(0px, calc((100% - var(--job-price-width, 5rem) - 0.5rem - 12px) / 2), 0.375rem)",
      } : undefined}
    >
      {note}
    </span>
  );
}
