import { buildInfo, formatBuildTime } from "@/lib/build-info";

export default function BuildIndicator({ compact = false, style }) {
  const { version, commit, sha, buildTime } = buildInfo;
  const builtAt = formatBuildTime(buildTime, { compact });
  const details = ["ELSET Admin build", sha ? `Git: ${sha}` : "Local development", buildTime ? `Build time (UTC): ${buildTime}` : "No production build timestamp", version ? `Package: v${version}` : ""].filter(Boolean).join("\n");

  return (
    <div
      data-build-indicator
      title={details}
      className={`min-w-0 text-[11px] leading-4 ${compact ? "text-center" : ""}`}
      style={style}
    >
      <p>ELSET Admin</p>
      <p className={compact ? "flex flex-col" : "flex flex-wrap items-baseline gap-x-1"}>
        {sha ? <span>{commit}</span> : null}
        {sha && !compact ? <span aria-hidden="true">·</span> : null}
        {builtAt ? (
          <time dateTime={buildTime} className={compact ? "flex flex-col" : "flex flex-wrap gap-x-1"}>
            <span>{builtAt.date}</span><span>{builtAt.time}</span>
          </time>
        ) : <span>{compact ? "dev" : "Local development"}</span>}
      </p>
    </div>
  );
}
