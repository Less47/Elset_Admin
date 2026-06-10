export function EmptyState({ title, text, action }) {
  return (
    <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-2">{text}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
