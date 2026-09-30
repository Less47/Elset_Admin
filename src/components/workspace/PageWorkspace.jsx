import { cn } from "@/lib/utils";
import { useLayoutEffect, useRef } from "react";

// The shell supplies the sidebar boundary. Keep chrome in normal flow and put
// padding on the body, so sticky never needs a guessed header-height spacer.
export function PageWorkspace({ children, className, ...props }) {
  return <section className={cn("page-workspace", className)} {...props}>{children}</section>;
}

export function PageTopBar({ children, className, innerClassName, maxWidth, ...props }) {
  const headerRef = useRef(null);
  useLayoutEffect(() => {
    const header = headerRef.current;
    const workspace = header.closest(".page-workspace");
    if (!workspace) return; // Calendar owns its independent scrolling panes.
    const update = () => workspace.style.setProperty("--page-top-bar-height", `${header.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => { observer.disconnect(); workspace.style.removeProperty("--page-top-bar-height"); };
  }, []);
  return (
    <header ref={headerRef} className={cn("page-top-bar", className)} data-page-top-bar {...props}>
      <div className={cn("page-top-bar__inner", maxWidth && `mx-auto ${maxWidth}`, innerClassName)}>{children}</div>
    </header>
  );
}

export function PageBody({ children, className, ...props }) {
  return <div className={cn("page-workspace-body", className)} data-page-body {...props}>{children}</div>;
}
