import { useEffect, useRef } from "react";
import { statuses } from "@/lib/job-status";
import { getMobileBoardPanelId } from "./service-board-utils";

export default function MobileStatusTabs({ counts, selectedView, onSelect }) {
  const tabRefs = useRef([]);
  const views = statuses.map((status) => ({ id: status, label: status, count: counts[status] || 0 }));
  const selectedIndex = views.findIndex((view) => view.id === selectedView);

  useEffect(() => {
    tabRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedIndex]);

  const focusAndSelect = (index) => {
    const safeIndex = (index + views.length) % views.length;
    onSelect(views[safeIndex].id);
    tabRefs.current[safeIndex]?.focus();
    tabRefs.current[safeIndex]?.scrollIntoView({ block: "nearest", inline: "center" });
  };

  const handleKeyDown = (event, index) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusAndSelect(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusAndSelect(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAndSelect(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAndSelect(views.length - 1);
    }
  };

  return (
    <div
      className="mobile-status-tabs sticky z-30 min-w-0 overflow-hidden -mx-[var(--content-padding-x-mobile)] border-b bg-white/92 px-[var(--content-padding-x-mobile)] py-2 shadow-sm backdrop-blur sm:-mx-[var(--content-padding-x-sm)] sm:px-[var(--content-padding-x-sm)]"
      style={{ top: "calc(3.5rem + env(safe-area-inset-top))" }}
    >
      <div
        role="tablist"
        aria-label="Board status"
        className="flex w-full min-w-0 max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {views.map((view, index) => {
          const isSelected = selectedView === view.id;

          return (
            <button
              key={view.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold outline-none transition focus-visible:ring-3 focus-visible:ring-sky-500/35 ${
                isSelected
                  ? "border-sky-700 bg-slate-900 text-white shadow-sm"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              aria-selected={isSelected}
              aria-controls={isSelected ? getMobileBoardPanelId(view.id) : undefined}
              tabIndex={isSelected || (selectedIndex < 0 && index === 0) ? 0 : -1}
              onClick={() => onSelect(view.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span>{view.label}</span>
              <span
                className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                  isSelected ? "bg-white/18 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {view.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
