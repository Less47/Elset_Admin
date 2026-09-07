/* global __ELSET_BUILD__ */

export default function BuildIndicator({ compact = false, style }) {
  const { version, commit } = __ELSET_BUILD__;

  return (
    <div
      data-build-indicator
      className={`min-w-0 text-[11px] leading-4 ${compact ? "text-center" : ""}`}
      style={style}
    >
      <p>ELSET Admin</p>
      <p className={compact ? "flex flex-col" : "flex flex-wrap gap-x-1"}>
        <span>v{version}</span>
        {!compact ? <span aria-hidden="true">·</span> : null}
        <span>{commit}</span>
      </p>
    </div>
  );
}
