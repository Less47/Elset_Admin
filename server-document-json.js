import express from "express";

// Compact PDF requests are normally a few KB. Allow substantial editable text
// and item lists while bounding memory independently of workspace saves.
export const DOCUMENT_JSON_LIMIT_BYTES = 5 * 1024 * 1024;

export function createDocumentJsonParser({ logger = console } = {}) {
  const parse = express.json({ limit: DOCUMENT_JSON_LIMIT_BYTES });
  return (req, res, next) => parse(req, res, (error) => {
    if (error?.type !== "entity.too.large") return next(error);
    const contentLength = Number(req.get("content-length"));
    logger.warn("[document-json] Request exceeded size limit", {
      endpoint: req.route.path,
      contentLength: Number.isSafeInteger(contentLength) && contentLength >= 0 ? contentLength : null,
      limitBytes: DOCUMENT_JSON_LIMIT_BYTES,
      exceededAllowedSize: true,
    });
    return res.status(413).json({
      error: req.route.path === "/api/quotes/preview-pdf"
        ? "PDF preview payload is too large."
        : "Document email payload is too large.",
    });
  });
}
