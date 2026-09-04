import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildDocumentReference,
  buildDocumentTemplateContext,
  calculateDocTotal,
  calculateInvoiceBalanceDue,
  calculateInvoiceGst,
  calculateInvoicePaidAmount,
  calculateInvoiceSubtotal,
  calculateInvoiceTotal,
  calculateQuoteGst,
  calculateQuoteSubtotal,
  calculateQuoteTotal,
  fillTemplateText,
  money,
  normalizeDocumentTemplate,
} from "./src/lib/quote-template.js";

export const DOCUMENT_LAYOUT = Object.freeze({
  format: "A4 portrait",
  pageWidth: 595.28,
  pageHeight: 841.89,
  margin: 34,
  pageBackground: "#FFFFFF",
  outerBorder: false,
  tableHeaderBackground: "#F1F1F1",
  tableCellBorders: false,
});

const PAGE_WIDTH = DOCUMENT_LAYOUT.pageWidth;
const PAGE_HEIGHT = DOCUMENT_LAYOUT.pageHeight;
const PAGE_MARGIN = DOCUMENT_LAYOUT.margin;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const CONTENT_RIGHT = PAGE_WIDTH - PAGE_MARGIN;
const CONTENT_BOTTOM = 54;
const PAYMENT_ANCHOR_Y = 184;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATH = path.join(__dirname, "public", "elset-logo.png");

const COLORS = Object.freeze({
  black: "#0A0A0A",
  body: "#171717",
  muted: "#666666",
  line: "#E5E5E5",
  tableHeader: DOCUMENT_LAYOUT.tableHeaderBackground,
  highlight: "#EFEFEF",
  white: DOCUMENT_LAYOUT.pageBackground,
  stamp: "#D90B0B",
});

const LEGACY_INVOICE_NOTE_TEXT = new Set([
  "Payment due within 7 days.",
  "Payment due within 7 days. Please reference the invoice number when remitting payment.",
]);

let pdfLibPromise = null;
let degrees = null;
let PDFDocument = null;
let StandardFonts = null;
let rgb = null;

async function ensurePdfLib() {
  if (!pdfLibPromise) pdfLibPromise = import("pdf-lib");
  const pdfLib = await pdfLibPromise;
  degrees = pdfLib.degrees;
  PDFDocument = pdfLib.PDFDocument;
  StandardFonts = pdfLib.StandardFonts;
  rgb = pdfLib.rgb;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizePdfText(value) {
  const normalized = String(value ?? "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");

  return [...normalized].filter((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint >= 32 || character === "\n" || character === "\r" || character === "\t";
  }).join("");
}

function parseDateInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanText(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function ordinalSuffix(day) {
  const remainder100 = day % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return "th";
  if (day % 10 === 1) return "st";
  if (day % 10 === 2) return "nd";
  if (day % 10 === 3) return "rd";
  return "th";
}

export function formatDocumentDate(value) {
  const parsed = parseDateInput(value);
  if (!parsed) return cleanText(value);
  const monthName = new Intl.DateTimeFormat("en-AU", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)));
  return `${parsed.day}${ordinalSuffix(parsed.day)} ${monthName} ${parsed.year}`;
}

function addDaysToDateInput(value, days) {
  const parsed = parseDateInput(value);
  if (!parsed) return "";
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function uniqueTextLines(values) {
  const seen = new Set();
  const lines = [];
  for (const value of values) {
    const normalized = cleanText(value);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase("en-AU");
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(normalized);
  }
  return lines;
}

function splitAddressLines(value) {
  return cleanText(value)
    .split(/\r?\n|,\s*/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getDocumentNotes(type, notes) {
  const normalized = cleanText(notes);
  if (!normalized) return "";
  if (type === "invoice" && LEGACY_INVOICE_NOTE_TEXT.has(normalized)) return "";
  return normalized;
}

function buildCustomerLines(job) {
  return uniqueTextLines([
    cleanText(job?.billingContact?.name),
    cleanText(job?.customerName),
    ...splitAddressLines(job?.jobAddress),
  ]);
}

function fallbackWorkText(job, document) {
  const jobDescription = cleanText(job?.description);
  if (jobDescription) return jobDescription;
  return (document?.items || [])
    .map((item) => cleanText(item?.description))
    .filter(Boolean)
    .join("\n");
}

function buildFinancialRows(type, document) {
  const items = document?.items || [];
  if (type === "invoice") {
    const subtotal = calculateInvoiceSubtotal(items);
    const gst = calculateInvoiceGst(items);
    const total = calculateInvoiceTotal(items);
    const paid = calculateInvoicePaidAmount(document?.payments || []);
    const balanceDue = calculateInvoiceBalanceDue(items, document?.payments || []);
    return {
      subtotal,
      gst,
      total,
      paid,
      balanceDue,
      rows: [
        { key: "subtotal", label: "Subtotal", value: money(subtotal) },
        { key: "gst", label: "GST", value: money(gst) },
        { key: "total", label: "Total", value: money(total), strong: true },
        { key: "paid", label: "Paid", value: money(paid) },
        { key: "balance", label: "Balance Due", value: money(balanceDue), highlight: true },
      ],
    };
  }
  if (type === "quote") {
    const subtotal = calculateQuoteSubtotal(items);
    const gst = calculateQuoteGst(items);
    const total = calculateQuoteTotal(items);
    return {
      subtotal,
      gst,
      total,
      paid: 0,
      balanceDue: total,
      rows: [
        { key: "subtotal", label: "Subtotal", value: money(subtotal) },
        { key: "gst", label: "GST", value: money(gst) },
        { key: "total", label: "Total", value: money(total), highlight: true },
      ],
    };
  }
  const total = calculateDocTotal(items);
  return {
    subtotal: total,
    gst: 0,
    total,
    paid: 0,
    balanceDue: total,
    rows: [{ key: "total", label: "Total", value: money(total), highlight: true }],
  };
}

export function buildDocumentPresentationModel({ job = {}, document = {}, template, type = "quote" }) {
  const documentType = type === "invoice" ? "invoice" : "quote";
  const normalizedTemplate = normalizeDocumentTemplate(template, documentType);
  const context = buildDocumentTemplateContext({
    job,
    document,
    template: normalizedTemplate,
    type: documentType,
  });
  const reference = buildDocumentReference(job, documentType);
  const documentLabel = documentType === "invoice" ? "Tax Invoice" : "Quote";
  const title = cleanText(normalizedTemplate.quoteHeading) || documentLabel;
  const issueDate = cleanText(document?.issueDate);
  const dueDate = documentType === "invoice" ? cleanText(document?.dueDate) : "";
  const quoteValidUntil = documentType === "quote"
    ? cleanText(context.quoteValidUntil) || addDaysToDateInput(issueDate, 30)
    : "";
  const notes = getDocumentNotes(documentType, document?.notes);
  const expandedIntro = cleanText(fillTemplateText(normalizedTemplate.introText, context));
  const fallbackText = fallbackWorkText(job, document);
  let introText = "";
  let workText = "";
  if (documentType === "invoice") {
    workText = notes || fallbackText || expandedIntro;
    introText = expandedIntro && expandedIntro !== workText ? expandedIntro : "";
  } else {
    workText = uniqueTextLines([expandedIntro || fallbackText, notes]).join("\n\n");
  }

  const financials = buildFinancialRows(documentType, document);
  const bankRows = [
    normalizedTemplate.bankAccountName
      ? { label: "Name", value: cleanText(normalizedTemplate.bankAccountName) }
      : null,
    normalizedTemplate.bankBsb
      ? { label: "BSB", value: cleanText(normalizedTemplate.bankBsb) }
      : null,
    normalizedTemplate.bankAccountNumber
      ? { label: "Account Number", value: cleanText(normalizedTemplate.bankAccountNumber) }
      : null,
  ].filter(Boolean);
  const workHeading = cleanText(normalizedTemplate.notesHeading)
    || (documentType === "invoice" ? "Work Completed" : "Scope of Work");
  const termsText = cleanText(fillTemplateText(normalizedTemplate.termsText, context));

  return {
    type: documentType,
    layout: DOCUMENT_LAYOUT,
    title,
    documentLabel,
    reference,
    ocNumber: cleanText(job?.ocNumber),
    issueDate,
    issueDateDisplay: cleanText(context.issueDateDisplay) || formatDocumentDate(issueDate),
    dueDate,
    dueDateDisplay: cleanText(context.dueDateDisplay) || formatDocumentDate(dueDate),
    quoteValidUntil,
    quoteValidUntilDisplay:
      cleanText(context.quoteValidUntilDisplay) || formatDocumentDate(quoteValidUntil),
    business: {
      name: cleanText(normalizedTemplate.companyName) || "ELSET",
      address: cleanText(normalizedTemplate.companyAddress),
      email: cleanText(normalizedTemplate.companyEmail),
      phone: cleanText(normalizedTemplate.companyPhone),
      abn: cleanText(normalizedTemplate.companyAbn),
      acn: cleanText(normalizedTemplate.companyAcn),
    },
    customerLines: buildCustomerLines(job),
    introText,
    work: { heading: workHeading, text: workText },
    table: {
      headers: ["Description", "Qty", "Unit Price", "Total Price"],
      items: (document?.items || []).map((item) => ({
        description: cleanText(item?.description) || `${documentLabel} item`,
        qty: item?.qty ?? 0,
        rate: Number(item?.rate || 0),
        total: Number(item?.qty || 0) * Number(item?.rate || 0),
      })),
    },
    financials,
    terms: {
      heading: cleanText(normalizedTemplate.termsHeading)
        || (documentType === "invoice" ? "How to Pay" : "Quote Terms"),
      text: termsText,
    },
    payment: documentType === "invoice"
      ? {
          bankRows,
          chequeAddress: cleanText(normalizedTemplate.companyAddress),
          remittanceEmail: cleanText(normalizedTemplate.companyEmail),
          summaryReference: `${documentLabel} # ${reference}`,
          summaryDue: dueDate
            ? `${money(financials.balanceDue)} due by ${formatDocumentDate(dueDate)}`
            : `${money(financials.balanceDue)} balance due`,
        }
      : null,
    quoteSummary: documentType === "quote"
      ? {
          reference: `Quote # ${reference}`,
          validity: quoteValidUntil
            ? `Valid until ${formatDocumentDate(quoteValidUntil)}`
            : "",
        }
      : null,
    footerText: cleanText(fillTemplateText(normalizedTemplate.footerText, context)),
    accentColor: cleanText(normalizedTemplate.accentColor) || "#2095C7",
    sections: documentType === "invoice"
      ? ["header", "customer", "work-completed", "line-items", "totals", "payment", "footer"]
      : ["header", "customer", "scope", "line-items", "totals", "terms", "footer"],
  };
}

function hexToRgb(hex) {
  const cleaned = cleanText(hex).replace("#", "");
  const expanded = cleaned.length === 3
    ? cleaned.split("").map((character) => `${character}${character}`).join("")
    : cleaned;
  const normalized = /^[0-9a-fA-F]{6}$/.test(expanded) ? expanded : "2095C7";
  const value = Number.parseInt(normalized, 16);
  return rgb(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255
  );
}

function textWidth(font, text, size) {
  return font.widthOfTextAtSize(normalizePdfText(text), size);
}

function fitTextSize(text, font, maxWidth, preferredSize, minSize = 7) {
  let size = preferredSize;
  while (size > minSize && textWidth(font, text, size) > maxWidth) size -= 0.5;
  return size;
}

function truncateTextToWidth(text, font, size, maxWidth) {
  const suffix = "...";
  let value = normalizePdfText(text).trim();
  if (!value || textWidth(font, value, size) <= maxWidth) return value;
  while (value.length > 0 && textWidth(font, `${value}${suffix}`, size) > maxWidth) {
    value = value.slice(0, -1).trimEnd();
  }
  return value ? `${value}${suffix}` : suffix;
}

function splitLongWord(word, font, size, maxWidth) {
  const chunks = [];
  let chunk = "";
  for (const character of normalizePdfText(word)) {
    const candidate = `${chunk}${character}`;
    if (chunk && textWidth(font, candidate, size) > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function wrapText(text, font, size, maxWidth) {
  const content = normalizePdfText(text).trim();
  if (!content) return [];
  const lines = [];
  for (const paragraph of content.split(/\r?\n/)) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    const words = paragraph.trim().split(/\s+/).flatMap((word) => (
      textWidth(font, word, size) > maxWidth
        ? splitLongWord(word, font, size, maxWidth)
        : [word]
    ));
    let currentLine = "";
    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (!currentLine || textWidth(font, candidate, size) <= maxWidth) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

function formatQuantity(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return "0";
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 6 }).format(numericValue);
}

function headingText(value) {
  const normalized = cleanText(value).toUpperCase();
  if (!normalized) return "";
  return /[:!?]$/.test(normalized) ? normalized : `${normalized}:`;
}

export async function generateDocumentPdf({ job, document, template, type = "quote", stampText = "" }) {
  await ensurePdfLib();
  const model = buildDocumentPresentationModel({ job, document, template, type });
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoImage = fs.existsSync(LOGO_PATH)
    ? await pdfDoc.embedPng(fs.readFileSync(LOGO_PATH))
    : null;
  const color = Object.fromEntries(
    Object.entries(COLORS).map(([key, value]) => [key, hexToRgb(value)])
  );
  const accent = hexToRgb(model.accentColor);
  const normalizedStampText = cleanText(stampText).toUpperCase();
  const pages = [];
  const state = { page: null, pageIndex: -1, y: 0 };

  pdfDoc.setTitle(`${model.documentLabel} ${model.reference}`);
  pdfDoc.setAuthor(model.business.name);
  pdfDoc.setSubject(`${model.documentLabel} for ${cleanText(job?.customerName) || "customer"}`);
  pdfDoc.setCreator("ELSET Admin");
  pdfDoc.setProducer("ELSET Admin");

  const drawText = (text, options) => {
    const normalizedText = normalizePdfText(text);
    if (normalizedText) state.page.drawText(normalizedText, options);
  };

  const drawRightText = (text, { right = CONTENT_RIGHT, y, font = regularFont, size = 9, ...options }) => {
    const normalizedText = normalizePdfText(text);
    if (!normalizedText) return;
    drawText(normalizedText, {
      x: right - textWidth(font, normalizedText, size),
      y,
      font,
      size,
      ...options,
    });
  };

  const drawCenteredText = (text, { center, y, font = regularFont, size = 9, ...options }) => {
    const normalizedText = normalizePdfText(text);
    if (!normalizedText) return;
    drawText(normalizedText, {
      x: center - textWidth(font, normalizedText, size) / 2,
      y,
      font,
      size,
      ...options,
    });
  };

  const drawRightAlignedLines = (lines, {
    right = CONTENT_RIGHT,
    y,
    font = regularFont,
    size = 9,
    lineHeight = 11,
    textColor = color.body,
  }) => {
    let cursor = y;
    for (const line of lines) {
      if (line) drawRightText(line, { right, y: cursor, font, size, color: textColor });
      cursor -= lineHeight;
    }
    return cursor;
  };

  const drawFirstPageHeader = () => {
    const topY = PAGE_HEIGHT - 29;
    const rightColumnX = PAGE_MARGIN + 341;
    const rightColumnWidth = CONTENT_RIGHT - rightColumnX;
    let logoBottom = topY - 82;
    if (logoImage) {
      const dimensions = logoImage.scaleToFit(324, 110);
      logoBottom = topY - dimensions.height;
      state.page.drawImage(logoImage, {
        x: PAGE_MARGIN,
        y: logoBottom,
        width: dimensions.width,
        height: dimensions.height,
      });
    } else {
      const companySize = fitTextSize(model.business.name, boldFont, 320, 30, 18);
      drawText(model.business.name, {
        x: PAGE_MARGIN,
        y: topY - companySize,
        font: boldFont,
        size: companySize,
        color: accent,
      });
      logoBottom = topY - companySize - 12;
    }

    let rightY = topY - 7;
    const addressLines = splitAddressLines(model.business.address)
      .flatMap((line) => wrapText(line, regularFont, 9.1, rightColumnWidth))
      .slice(0, 4);
    if (addressLines.length) {
      rightY = drawRightAlignedLines(addressLines, {
        y: rightY,
        size: 9.1,
        lineHeight: 11,
      }) - 5;
    }
    for (const contactLine of [model.business.email, model.business.phone].filter(Boolean)) {
      drawRightText(contactLine, {
        y: rightY,
        font: regularFont,
        size: 9.1,
        color: color.body,
      });
      rightY -= 11;
    }
    if (model.business.email || model.business.phone) rightY -= 9;

    const titleSize = fitTextSize(model.title, boldFont, rightColumnWidth, 16.5, 12);
    drawRightText(model.title, {
      y: rightY,
      font: boldFont,
      size: titleSize,
      color: color.black,
    });
    rightY -= titleSize + 5;
    if (model.business.abn) {
      drawRightText(`ABN: ${model.business.abn}`, {
        y: rightY,
        font: boldFont,
        size: 9.1,
        color: color.black,
      });
      rightY -= 11;
    }
    if (model.business.acn) {
      drawRightText(`ACN: ${model.business.acn}`, {
        y: rightY,
        font: regularFont,
        size: 8.8,
        color: color.body,
      });
      rightY -= 10.5;
    }
    rightY -= 9;
    drawRightText(`${model.documentLabel} # ${model.reference}`, {
      y: rightY,
      font: regularFont,
      size: 9.2,
      color: color.body,
    });
    rightY -= 11;
    if (model.ocNumber) {
      drawRightText(`Client reference: ${model.ocNumber}`, {
        y: rightY,
        font: regularFont,
        size: 9.2,
        color: color.body,
      });
      rightY -= 11;
    }
    if (model.issueDateDisplay) {
      drawRightText(model.issueDateDisplay, {
        y: rightY,
        font: regularFont,
        size: 9.2,
        color: color.body,
      });
      rightY -= 11;
    }
    if (model.type === "quote" && model.quoteValidUntilDisplay) {
      drawRightText(`Valid until ${model.quoteValidUntilDisplay}`, {
        y: rightY,
        font: regularFont,
        size: 8.6,
        color: color.muted,
      });
      rightY -= 10;
    }

    let customerY = Math.min(logoBottom, rightY) - 27;
    const customerX = PAGE_MARGIN + 84;
    const customerLines = model.customerLines.flatMap((line) => (
      wrapText(line, regularFont, 10.1, 310)
    ));
    for (const line of customerLines) {
      drawText(line, {
        x: customerX,
        y: customerY,
        font: regularFont,
        size: 10.1,
        color: color.black,
      });
      customerY -= 12.3;
    }
    return customerY - (customerLines.length ? 32 : 12);
  };

  const drawContinuationHeader = () => {
    const topY = PAGE_HEIGHT - 27;
    let logoBottom = topY - 45;
    if (logoImage) {
      const dimensions = logoImage.scaleToFit(166, 57);
      logoBottom = topY - dimensions.height;
      state.page.drawImage(logoImage, {
        x: PAGE_MARGIN,
        y: logoBottom,
        width: dimensions.width,
        height: dimensions.height,
      });
    } else {
      drawText(model.business.name, {
        x: PAGE_MARGIN,
        y: topY - 22,
        font: boldFont,
        size: 20,
        color: accent,
      });
    }
    drawRightText(model.title, {
      y: topY - 17,
      font: boldFont,
      size: 13,
      color: color.black,
    });
    drawRightText(`${model.documentLabel} # ${model.reference}`, {
      y: topY - 32,
      font: regularFont,
      size: 8.7,
      color: color.body,
    });
    drawRightText("Continued", {
      y: topY - 44,
      font: regularFont,
      size: 8.2,
      color: color.muted,
    });
    const ruleY = Math.min(logoBottom, topY - 49) - 7;
    state.page.drawLine({
      start: { x: PAGE_MARGIN, y: ruleY },
      end: { x: CONTENT_RIGHT, y: ruleY },
      thickness: 1.1,
      color: accent,
      opacity: 0.8,
    });
    return ruleY - 19;
  };

  const startPage = ({ first = false } = {}) => {
    state.page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(state.page);
    state.pageIndex = pages.length - 1;
    state.y = first ? drawFirstPageHeader() : drawContinuationHeader();
  };

  let drawTableHeader = null;
  const ensureSpace = (heightNeeded, { repeatTableHeader = false } = {}) => {
    if (state.y - heightNeeded >= CONTENT_BOTTOM) return false;
    startPage();
    if (repeatTableHeader && drawTableHeader) drawTableHeader({ ensure: false });
    return true;
  };

  const drawFlowingLines = (lines, {
    x = PAGE_MARGIN,
    font = regularFont,
    size = 9.6,
    lineHeight = 12,
    textColor = color.body,
    gapAfter = 0,
  } = {}) => {
    for (const line of lines) {
      ensureSpace(lineHeight);
      if (line) drawText(line, { x, y: state.y, font, size, color: textColor });
      state.y -= lineHeight;
    }
    state.y -= gapAfter;
  };

  const drawParagraph = (text, {
    x = PAGE_MARGIN,
    width = CONTENT_WIDTH,
    font = regularFont,
    size = 9.6,
    lineHeight = 12,
    textColor = color.body,
    gapAfter = 0,
  } = {}) => {
    const lines = wrapText(text, font, size, width);
    drawFlowingLines(lines, { x, font, size, lineHeight, textColor, gapAfter });
    return lines.length;
  };

  const drawWorkSection = () => {
    if (model.introText) {
      const introLines = wrapText(model.introText, regularFont, 9.4, CONTENT_WIDTH);
      ensureSpace(Math.min(introLines.length, 2) * 12 + 12);
      drawFlowingLines(introLines, {
        size: 9.4,
        lineHeight: 12,
        textColor: color.body,
        gapAfter: 12,
      });
    }
    if (!model.work.text) return;
    const bodyLines = wrapText(model.work.text, regularFont, 9.6, CONTENT_WIDTH);
    ensureSpace(19 + Math.min(bodyLines.length, 2) * 12);
    drawText(headingText(model.work.heading), {
      x: PAGE_MARGIN,
      y: state.y,
      font: boldFont,
      size: 10.2,
      color: color.black,
    });
    state.y -= 17;
    drawFlowingLines(bodyLines, {
      size: 9.6,
      lineHeight: 12,
      textColor: color.body,
      gapAfter: 15,
    });
  };

  const descriptionWidth = CONTENT_WIDTH * 0.59;
  const qtyWidth = CONTENT_WIDTH * 0.08;
  const unitWidth = CONTENT_WIDTH * 0.16;
  const totalWidth = CONTENT_WIDTH - descriptionWidth - qtyWidth - unitWidth;
  const columns = [
    { label: model.table.headers[0], x: PAGE_MARGIN + 7, width: descriptionWidth - 13, align: "left" },
    { label: model.table.headers[1], x: PAGE_MARGIN + descriptionWidth, width: qtyWidth, align: "center" },
    { label: model.table.headers[2], x: PAGE_MARGIN + descriptionWidth + qtyWidth, width: unitWidth - 7, align: "right" },
    { label: model.table.headers[3], x: PAGE_MARGIN + descriptionWidth + qtyWidth + unitWidth, width: totalWidth - 7, align: "right" },
  ];

  const drawColumnText = (text, column, y, { font = regularFont, size = 8.7, textColor = color.body } = {}) => {
    const normalizedText = normalizePdfText(text);
    let x = column.x;
    if (column.align === "right") x = column.x + column.width - textWidth(font, normalizedText, size);
    if (column.align === "center") x = column.x + (column.width - textWidth(font, normalizedText, size)) / 2;
    drawText(normalizedText, { x, y, font, size, color: textColor });
  };

  drawTableHeader = ({ ensure = true } = {}) => {
    if (ensure) ensureSpace(27);
    const topY = state.y;
    state.page.drawRectangle({
      x: PAGE_MARGIN,
      y: topY - 24,
      width: CONTENT_WIDTH,
      height: 24,
      color: color.tableHeader,
    });
    for (const column of columns) {
      drawColumnText(column.label.toUpperCase(), column, topY - 16, {
        font: boldFont,
        size: 8.2,
        textColor: color.black,
      });
    }
    state.y = topY - 24;
  };

  const drawLineItem = (item) => {
    let remainingLines = wrapText(item.description, regularFont, 8.9, columns[0].width);
    if (!remainingLines.length) remainingLines = [`${model.documentLabel} item`];
    let firstChunk = true;
    while (remainingLines.length) {
      if (state.y - 25 < CONTENT_BOTTOM) {
        startPage();
        drawTableHeader({ ensure: false });
      }
      const availableHeight = state.y - CONTENT_BOTTOM;
      const maximumLines = Math.max(1, Math.floor((availableHeight - 14) / 10.6));
      const chunkLines = remainingLines.splice(0, maximumLines);
      const rowHeight = Math.max(27, chunkLines.length * 10.6 + 14);
      if (state.y - rowHeight < CONTENT_BOTTOM) {
        remainingLines.unshift(...chunkLines);
        startPage();
        drawTableHeader({ ensure: false });
        continue;
      }
      const topY = state.y;
      let descriptionY = topY - 13;
      for (const line of chunkLines) {
        drawText(line, {
          x: columns[0].x,
          y: descriptionY,
          font: regularFont,
          size: 8.9,
          color: color.body,
        });
        descriptionY -= 10.6;
      }
      if (firstChunk) {
        drawColumnText(formatQuantity(item.qty), columns[1], topY - 13, { size: 8.9 });
        drawColumnText(money(item.rate), columns[2], topY - 13, { size: 8.9 });
        drawColumnText(money(item.total), columns[3], topY - 13, { size: 8.9 });
      }
      state.page.drawLine({
        start: { x: PAGE_MARGIN, y: topY - rowHeight },
        end: { x: CONTENT_RIGHT, y: topY - rowHeight },
        thickness: 0.55,
        color: color.line,
      });
      state.y = topY - rowHeight;
      firstChunk = false;
    }
  };

  const drawTotals = () => {
    const rows = model.financials.rows;
    const blockHeight = 20 + rows.reduce((height, row) => height + (row.highlight ? 27 : 17), 0) + 8;
    ensureSpace(blockHeight);
    state.y -= 13;
    state.page.drawLine({
      start: { x: PAGE_MARGIN, y: state.y },
      end: { x: CONTENT_RIGHT, y: state.y },
      thickness: 0.7,
      color: color.line,
    });
    state.y -= 15;
    const boxWidth = 216;
    const boxX = CONTENT_RIGHT - boxWidth;
    const labelRight = boxX + 108;
    for (const row of rows) {
      const rowHeight = row.highlight ? 27 : 17;
      const topY = state.y;
      const labelSize = row.highlight ? 11.2 : 9.2;
      const valueSize = row.highlight ? 11.2 : 9.2;
      const rowFont = row.highlight || row.strong ? boldFont : regularFont;
      const baselineY = topY - rowHeight + (row.highlight ? 8.5 : 5.5);
      const label = `${row.label.toUpperCase()}:`;
      if (row.highlight) {
        state.page.drawRectangle({
          x: boxX - 7,
          y: topY - rowHeight,
          width: boxWidth + 7,
          height: rowHeight,
          color: color.highlight,
        });
      }
      drawText(label, {
        x: labelRight - textWidth(rowFont, label, labelSize),
        y: baselineY,
        font: rowFont,
        size: labelSize,
        color: color.black,
      });
      drawRightText(row.value, {
        right: CONTENT_RIGHT - 5,
        y: baselineY,
        font: rowFont,
        size: valueSize,
        color: color.black,
      });
      state.y -= rowHeight;
    }
    state.y -= 8;
  };

  const measureClosingSection = () => {
    const termsLines = wrapText(model.terms.text, regularFont, 9.2, CONTENT_WIDTH);
    let height = 45 + Math.max(termsLines.length, 1) * 11.5 + (model.type === "invoice" ? 10 : 4);
    if (model.type === "invoice") {
      const addressLines = splitAddressLines(model.payment?.chequeAddress)
        .flatMap((line) => wrapText(line, regularFont, 8.8, 190));
      height += 18 + Math.max(model.payment?.bankRows?.length || 0, addressLines.length, 1) * 11;
      if (model.payment?.remittanceEmail) height += 10;
    }
    return height + 1;
  };

  const positionClosingSection = () => {
    const estimatedHeight = measureClosingSection();
    if (
      state.pageIndex === 0
      && state.y > PAYMENT_ANCHOR_Y
      && PAYMENT_ANCHOR_Y - estimatedHeight >= CONTENT_BOTTOM
    ) {
      state.y = PAYMENT_ANCHOR_Y;
      return;
    }
    if (state.y - estimatedHeight < CONTENT_BOTTOM) startPage();
  };

  const drawClosingHeader = () => {
    state.page.drawLine({
      start: { x: PAGE_MARGIN, y: state.y },
      end: { x: CONTENT_RIGHT, y: state.y },
      thickness: 0.7,
      color: color.line,
    });
    state.y -= 25;
    drawText(model.terms.heading, {
      x: PAGE_MARGIN,
      y: state.y,
      font: regularFont,
      size: 14.5,
      color: color.black,
    });
    if (model.type === "invoice") {
      drawRightText(model.payment.summaryReference, {
        y: state.y + 3,
        font: regularFont,
        size: 8.8,
        color: color.body,
      });
      drawRightText(model.payment.summaryDue, {
        y: state.y - 8,
        font: regularFont,
        size: 8.8,
        color: color.body,
      });
    } else if (model.quoteSummary) {
      drawRightText(model.quoteSummary.reference, {
        y: state.y + 3,
        font: regularFont,
        size: 8.8,
        color: color.body,
      });
      if (model.quoteSummary.validity) {
        drawRightText(model.quoteSummary.validity, {
          y: state.y - 8,
          font: regularFont,
          size: 8.8,
          color: color.body,
        });
      }
    }
    state.y -= 20;
  };

  const drawBankAndChequeDetails = () => {
    const bankRows = model.payment?.bankRows || [];
    const chequeLines = splitAddressLines(model.payment?.chequeAddress)
      .flatMap((line) => wrapText(line, regularFont, 8.8, 190));
    if (!bankRows.length && !chequeLines.length) return;
    const blockHeight = 18 + Math.max(bankRows.length, chequeLines.length, 1) * 11;
    ensureSpace(blockHeight + 8);
    const leftHeadingX = PAGE_MARGIN + 40;
    const leftContentX = PAGE_MARGIN + 105;
    const rightHeadingX = PAGE_MARGIN + 328;
    const rightContentX = PAGE_MARGIN + 373;
    if (bankRows.length) {
      drawText("Bank Details", {
        x: leftHeadingX,
        y: state.y,
        font: boldFont,
        size: 9.1,
        color: color.black,
      });
    }
    if (chequeLines.length) {
      drawText("Cheque", {
        x: rightHeadingX,
        y: state.y,
        font: boldFont,
        size: 9.1,
        color: color.black,
      });
    }
    let bankY = state.y;
    for (const row of bankRows) {
      const label = `${row.label}:`;
      drawText(label, {
        x: leftContentX,
        y: bankY,
        font: boldFont,
        size: 8.8,
        color: color.black,
      });
      drawText(row.value, {
        x: leftContentX + Math.max(58, textWidth(boldFont, label, 8.8) + 7),
        y: bankY,
        font: regularFont,
        size: 8.8,
        color: color.body,
      });
      bankY -= 11;
    }
    let chequeY = state.y;
    for (const line of chequeLines) {
      drawText(line, {
        x: rightContentX,
        y: chequeY,
        font: regularFont,
        size: 8.8,
        color: color.body,
      });
      chequeY -= 11;
    }
    state.y -= blockHeight;
  };

  const drawClosingSection = () => {
    positionClosingSection();
    const firstTermsLineHeight = model.terms.text ? 11.5 : 0;
    ensureSpace(45 + firstTermsLineHeight);
    drawClosingHeader();
    if (model.terms.text) {
      drawParagraph(model.terms.text, {
        size: 9.2,
        lineHeight: 11.5,
        textColor: color.body,
        gapAfter: model.type === "invoice" ? 10 : 4,
      });
    }
    if (model.type === "invoice") {
      drawBankAndChequeDetails();
      if (model.payment?.remittanceEmail) {
        ensureSpace(10);
        const remittanceText = `Please email remittance advice to ${model.payment.remittanceEmail}`;
        const remittanceSize = fitTextSize(remittanceText, regularFont, CONTENT_WIDTH, 8.7, 7.5);
        drawCenteredText(remittanceText, {
          center: PAGE_WIDTH / 2,
          y: state.y,
          font: regularFont,
          size: remittanceSize,
          color: color.body,
        });
        state.y -= 10;
      }
    }
  };

  const drawPageFooters = () => {
    pages.forEach((targetPage, index) => {
      const footerText = normalizePdfText(model.footerText);
      const hasPageNumber = pages.length > 1;
      if (!footerText && !hasPageNumber) return;
      targetPage.drawLine({
        start: { x: PAGE_MARGIN, y: 43 },
        end: { x: CONTENT_RIGHT, y: 43 },
        thickness: 0.55,
        color: color.line,
      });
      if (footerText) {
        const availableWidth = hasPageNumber ? CONTENT_WIDTH - 80 : CONTENT_WIDTH;
        const fittedFooter = truncateTextToWidth(footerText, regularFont, 7.5, availableWidth);
        targetPage.drawText(fittedFooter, {
          x: PAGE_MARGIN,
          y: 26,
          font: regularFont,
          size: 7.5,
          color: color.muted,
        });
      }
      if (hasPageNumber) {
        const pageText = `Page ${index + 1} of ${pages.length}`;
        targetPage.drawText(pageText, {
          x: CONTENT_RIGHT - textWidth(regularFont, pageText, 7.5),
          y: 26,
          font: regularFont,
          size: 7.5,
          color: color.muted,
        });
      }
    });
  };

  const drawReceiptStamp = () => {
    if (model.type !== "invoice" || !normalizedStampText) return;
    const stampSize = fitTextSize(normalizedStampText, boldFont, PAGE_WIDTH * 0.8, 84, 36);
    const stampWidth = textWidth(boldFont, normalizedStampText, stampSize);
    for (const targetPage of pages) {
      targetPage.drawText(normalizePdfText(normalizedStampText), {
        x: (PAGE_WIDTH - stampWidth) / 2,
        y: PAGE_HEIGHT * 0.48,
        font: boldFont,
        size: stampSize,
        color: color.stamp,
        rotate: degrees(32),
        opacity: 0.28,
      });
    }
  };

  startPage({ first: true });
  drawWorkSection();
  drawTableHeader();
  for (const item of model.table.items) drawLineItem(item);
  drawTotals();
  drawClosingSection();
  drawPageFooters();
  drawReceiptStamp();

  return {
    bytes: await pdfDoc.save(),
    filename: `${model.reference}.pdf`,
  };
}

export async function generateQuotePdf({ job, quote, template }) {
  return generateDocumentPdf({ job, document: quote, template, type: "quote" });
}
