import { useRef, useState } from "react";

export function useJobNoteEditor({ jobs, onSave }) {
  const [active, setActive] = useState(false);
  const [editor, setEditor] = useState(null);
  const [failures, setFailures] = useState({});
  const [pendingCount, setPendingCount] = useState(0);
  const pending = useRef(new Set());

  function open(job, event) {
    if (pending.current.has(job.id)) return;
    const anchor = event.currentTarget;
    const value = failures[job.id] ? failures[job.id].value ?? "" : job.serviceBoardNote ?? "";
    setEditor({ jobId: job.id, jobNumber: job.jobNumber, value, anchor });
  }

  async function save(value) {
    const current = editor;
    if (!current || pending.current.has(current.jobId)) return;
    pending.current.add(current.jobId);
    setPendingCount(pending.current.size);
    setEditor(null);
    setFailures((previous) => {
      const next = { ...previous };
      delete next[current.jobId];
      return next;
    });
    try {
      await onSave(current.jobId, value);
    } catch (error) {
      setFailures((previous) => ({ ...previous, [current.jobId]: { ...current, value, message: error.message || "Unable to save the job note." } }));
    } finally {
      pending.current.delete(current.jobId);
      setPendingCount(pending.current.size);
    }
  }

  return {
    active,
    toggle: () => { setActive((value) => !value); setEditor(null); },
    open,
    editor,
    close: () => setEditor(null),
    save,
    failures: Object.values(failures),
    pendingCount,
    retry: (failure, event) => {
      const job = jobs.find((entry) => entry.id === failure.jobId);
      if (job) { setActive(true); open(job, event); }
    },
  };
}
