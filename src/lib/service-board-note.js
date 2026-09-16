export const SERVICE_BOARD_NOTE_MAX_LENGTH = 25;

// Match the input's maxlength (UTF-16 code units), including on API/import writes.
export function normalizeServiceBoardNote(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw Object.assign(new Error("Job note must be text or null."), { statusCode: 400 });
  }
  const note = value.trim().replace(/[\r\n\t\u2028\u2029]+/g, " ");
  if (note.length > SERVICE_BOARD_NOTE_MAX_LENGTH || note.includes("\0")) {
    throw Object.assign(new Error("Job note must be at most 25 characters and contain no null characters."), { statusCode: 400 });
  }
  return note || null;
}
