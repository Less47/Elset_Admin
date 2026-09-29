export function EmailDeliveryDetails({ delivery }) {
  if (!delivery) return null;
  return <dl className="document-email-delivery text-xs">
    {[["acceptedRecipients", "Accepted"], ["rejectedRecipients", "Rejected"], ["unconfirmedRecipients", "Unconfirmed"]].map(([key, label]) => delivery[key]?.length ? <div key={key}><dt className="font-semibold">{label}</dt><dd>{delivery[key].join(", ")}</dd></div> : null)}
  </dl>;
}

export default function DocumentEmailHistory({ entries }) {
  if (!entries?.length) return null;
  return <details className="document-email-history mt-4">
    <summary>View sent emails ({entries.length})</summary>
    {[...entries].reverse().map((entry, index) => <details key={entry.id || index} className="mt-3 border-t border-border pt-3">
      <summary>{entry.sentAt ? new Date(entry.sentAt).toLocaleString("en-AU") : "Previous send"} · {entry.subject || "Sent document"}</summary>
      <dl className="mt-2 text-xs">
        <div><dt>To</dt><dd>{entry.to?.join(", ") || entry.toEmail || "Not recorded"}</dd></div>
        {[["cc", "CC"], ["bcc", "BCC (private)"]].map(([key, label]) => entry[key]?.length ? <div key={key}><dt>{label}</dt><dd>{entry[key].join(", ")}</dd></div> : null)}
        <div><dt>From</dt><dd>{entry.fromEmail || "Not recorded"}</dd></div>
        {entry.replyToEmail ? <div><dt>Reply-To</dt><dd>{entry.replyToEmail}</dd></div> : null}
        <div><dt>Subject</dt><dd>{entry.subject || "Not recorded"}</dd></div>
      </dl>
      {entry.warning ? <p className="mt-2 text-xs">{entry.warning}</p> : null}
      <EmailDeliveryDetails delivery={entry} />
      <p className="mt-3 whitespace-pre-wrap text-sm">{typeof entry.message === "string" ? entry.message : "Message content was not recorded for this older send."}</p>
    </details>)}
  </details>;
}
