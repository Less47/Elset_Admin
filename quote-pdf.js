import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildDocumentReference,
  buildDocumentTemplateContext,
  calculateInvoiceBalanceDue,
  calculateDocTotal,
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

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 48;
const TEMPLATE_WIDTH = 1240;
const TEMPLATE_HEIGHT = 1754;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATH = path.join(__dirname, "public", "elset-logo.png");
let pdfLibPromise = null;
let degrees = null;
let PDFDocument = null;
let StandardFonts = null;
let rgb = null;

async function ensurePdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = import("pdf-lib");
  }

  const pdfLib = await pdfLibPromise;
  degrees = pdfLib.degrees;
  PDFDocument = pdfLib.PDFDocument;
  StandardFonts = pdfLib.StandardFonts;
  rgb = pdfLib.rgb;
}

function rectFromTemplate(left, top, width, height) {
  const scaleX = PAGE_WIDTH / TEMPLATE_WIDTH;
  const scaleY = PAGE_HEIGHT / TEMPLATE_HEIGHT;

  return {
    x: left * scaleX,
    y: PAGE_HEIGHT - (top + height) * scaleY,
    width: width * scaleX,
    height: height * scaleY,
  };
}

function insetRect(rect, inset) {
  return {
    x: rect.x + inset,
    y: rect.y + inset,
    width: rect.width - inset * 2,
    height: rect.height - inset * 2,
  };
}

function fitTextSize(text, font, maxWidth, preferredSize, minSize = 10) {
  let size = preferredSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 1;
  }
  return size;
}

function truncateTextToWidth(text, font, size, maxWidth) {
  const suffix = "...";
  let value = String(text || "").trim();
  if (!value || font.widthOfTextAtSize(value, size) <= maxWidth) {
    return value;
  }

  while (value.length > 0 && font.widthOfTextAtSize(`${value}${suffix}`, size) > maxWidth) {
    value = value.slice(0, -1).trimEnd();
  }

  return value ? `${value}${suffix}` : suffix;
}

function getVisibleDocumentNotes(type, notes = "") {
  if (type === "quote") return "";

  const normalizedNotes = String(notes || "").trim();
  const legacyDueDateNotes = [
    "Payment due within 7 days.",
    "Payment due within 7 days. Please reference the invoice number when remitting payment.",
  ];

  return legacyDueDateNotes.includes(normalizedNotes) ? "" : normalizedNotes;
}

const HEADER_RECT = rectFromTemplate(77, 155, 1086, 220);
const CONTENT_RECT = rectFromTemplate(77, 395, 1086, 1230);
const TOP_STRIP_CLEAR_RECT = rectFromTemplate(0, 0, 1240, 92);
const HEADER_CONTENT_CLEAR_RECT = insetRect(HEADER_RECT, 3);

function hexToRgb(hex) {
  const value = String(hex || "").replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((char) => `${char}${char}`).join("")
    : value.padEnd(6, "0").slice(0, 6);

  const int = Number.parseInt(normalized, 16);

  return rgb(
    ((int >> 16) & 255) / 255,
    ((int >> 8) & 255) / 255,
    (int & 255) / 255
  );
}

function wrapText(text, font, size, maxWidth) {
  const content = String(text || "").trim();
  if (!content) return [];

  const lines = [];
  for (const paragraph of content.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let currentLine = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${currentLine} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
  }

  return lines;
}

export async function generateDocumentPdf({ job, document, template, type = "quote", stampText = "" }) {
  await ensurePdfLib();

  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const normalizedTemplate = normalizeDocumentTemplate(template, type);
  const context = buildDocumentTemplateContext({
    job,
    document,
    template: normalizedTemplate,
    type,
  });
  const documentLabel = type === "invoice" ? "Invoice" : "Quote";
  const accent = hexToRgb(normalizedTemplate.accentColor);
  const logoImage = fs.existsSync(LOGO_PATH)
    ? await pdfDoc.embedPng(fs.readFileSync(LOGO_PATH))
    : null;
  const baseTemplateImage = null;
  const panelFill = rgb(0.93, 0.96, 1);
  const lightAccent = rgb(
    Math.min(accent.red + 0.82, 0.96),
    Math.min(accent.green + 0.82, 0.96),
    Math.min(accent.blue + 0.82, 0.96)
  );
  const normalizedStampText = String(stampText || "").trim().toUpperCase();

  let page;
  let y = 0;

  const contentInnerRect = insetRect(CONTENT_RECT, 12);
  const contentBottom = contentInnerRect.y + 4;

  const drawPageShell = (targetPage) => {
    if (baseTemplateImage) {
      targetPage.drawImage(baseTemplateImage, {
        x: 0,
        y: 0,
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
      });

      return;
    }

    targetPage.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 18,
      width: PAGE_WIDTH,
      height: 18,
      color: accent,
    });

    targetPage.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: 18,
      color: accent,
    });

    for (const rect of [HEADER_RECT, CONTENT_RECT]) {
      targetPage.drawRectangle({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        color: panelFill,
        borderWidth: 2,
        borderColor: accent,
      });
    }
  };

  const drawHeader = () => {
    const headerInnerRect = insetRect(HEADER_RECT, 18);

    {
      const companyName = normalizedTemplate.companyName || "Elset";
      const headingText = normalizedTemplate.quoteHeading || documentLabel;
      const companyDetailSize = 8;
      const companyDetailColor = rgb(0.25, 0.25, 0.25);
      const companyDetailSections = [
        normalizedTemplate.companyAddress,
        [
          normalizedTemplate.companyAbn ? `ABN ${normalizedTemplate.companyAbn}` : "",
          normalizedTemplate.companyAcn ? `ACN ${normalizedTemplate.companyAcn}` : "",
        ].filter(Boolean).join("  |  "),
        [
          normalizedTemplate.companyEmail,
          normalizedTemplate.companyPhone,
        ].filter(Boolean).join("  |  "),
      ].filter(Boolean);

      const buildCompanyDetailLines = (maxWidth, maxLines = 5) => {
        const lines = [];

        for (const section of companyDetailSections) {
          const wrappedLines = wrapText(section, regularFont, companyDetailSize, maxWidth);
          for (const line of wrappedLines) {
            if (!line) continue;
            lines.push(line);
            if (lines.length >= maxLines) {
              return lines;
            }
          }
        }

        return lines;
      };

      const drawAlignedText = (text, { x, y, width, font, size, color, align = "left" }) => {
        const textX = align === "right"
          ? x + width - font.widthOfTextAtSize(text, size)
          : x;

        page.drawText(text, {
          x: textX,
          y,
          font,
          size,
          color,
        });
      };

      if (baseTemplateImage) {
        page.drawRectangle({
          ...TOP_STRIP_CLEAR_RECT,
          color: rgb(1, 1, 1),
        });
        page.drawRectangle({
          ...HEADER_CONTENT_CLEAR_RECT,
          color: panelFill,
        });
      }

      if (logoImage) {
        const logoDimensions = logoImage.scaleToFit(
          Math.min(headerInnerRect.width * 0.42, 160),
          headerInnerRect.height - 10
        );
        const companyInfoX = headerInnerRect.x + logoDimensions.width + 24;
        const companyInfoWidth = headerInnerRect.x + headerInnerRect.width - companyInfoX;
        const companyNameSize = fitTextSize(companyName, boldFont, companyInfoWidth, 14, 11);
        const companyDetailLines = buildCompanyDetailLines(companyInfoWidth, 5);
        const logoMeta = [headingText, context.documentReference].filter(Boolean).join("  |  ");

        page.drawImage(logoImage, {
          x: headerInnerRect.x,
          y: headerInnerRect.y + (headerInnerRect.height - logoDimensions.height) / 2,
          width: logoDimensions.width,
          height: logoDimensions.height,
        });

        drawAlignedText(companyName, {
          x: companyInfoX,
          y: headerInnerRect.y + headerInnerRect.height - companyNameSize - 2,
          width: companyInfoWidth,
          font: boldFont,
          size: companyNameSize,
          color: accent,
          align: "right",
        });

        let infoY = headerInnerRect.y + headerInnerRect.height - companyNameSize - 14;
        for (const line of companyDetailLines) {
          drawAlignedText(line, {
            x: companyInfoX,
            y: infoY,
            width: companyInfoWidth,
            font: regularFont,
            size: companyDetailSize,
            color: companyDetailColor,
            align: "right",
          });
          infoY -= 9.5;
        }

        if (logoMeta && companyDetailLines.length <= 3) {
          drawAlignedText(logoMeta, {
            x: companyInfoX,
            y: headerInnerRect.y + 2,
            width: companyInfoWidth,
            font: regularFont,
            size: 7.5,
            color: companyDetailColor,
            align: "right",
          });
        }

        return;
      }

      const companyTextWidth = headerInnerRect.width - 220;
      const companyNameSize = fitTextSize(companyName, boldFont, companyTextWidth, 20, 14);
      const headingSize = fitTextSize(headingText, boldFont, 170, 16, 11);
      const companyDetailLines = buildCompanyDetailLines(Math.min(companyTextWidth, 260), 5);
      const referenceMeta = [context.documentReference, document.issueDate].filter(Boolean).join("  |  ");

      page.drawText(companyName, {
        x: headerInnerRect.x + 54,
        y: headerInnerRect.y + headerInnerRect.height - companyNameSize - 6,
        font: boldFont,
        size: companyNameSize,
        color: accent,
      });

      let infoY = headerInnerRect.y + headerInnerRect.height - companyNameSize - 20;
      for (const line of companyDetailLines) {
        page.drawText(line, {
          x: headerInnerRect.x + 54,
          y: infoY,
          font: regularFont,
          size: companyDetailSize,
          color: companyDetailColor,
        });
        infoY -= 10;
      }

      page.drawText(headingText, {
        x: headerInnerRect.x + headerInnerRect.width - boldFont.widthOfTextAtSize(headingText, headingSize),
        y: headerInnerRect.y + 24,
        font: boldFont,
        size: headingSize,
        color: accent,
      });

      if (referenceMeta) {
        page.drawText(referenceMeta, {
          x: headerInnerRect.x + headerInnerRect.width - regularFont.widthOfTextAtSize(referenceMeta, 8.5),
          y: headerInnerRect.y + 10,
          font: regularFont,
          size: 8.5,
          color: companyDetailColor,
        });
      }

      return;
    }

    // eslint-disable-next-line no-unreachable
    const companyTextWidth = headerInnerRect.width - 220;
    const companyName = normalizedTemplate.companyName || "Elset";
    const companyNameSize = fitTextSize(companyName, boldFont, companyTextWidth, 20, 14);
    const headingText = normalizedTemplate.quoteHeading || documentLabel;
    const headingSize = fitTextSize(headingText, boldFont, 170, 16, 11);
    const companyInfoLines = wrapText(
      [
        normalizedTemplate.companyEmail,
        normalizedTemplate.companyPhone,
        normalizedTemplate.companyAddress,
      ].filter(Boolean).join("  ·  "),
      regularFont,
      8.5,
      Math.min(companyTextWidth, 250)
    ).slice(0, 3);
    const referenceMeta = [context.documentReference, document.issueDate].filter(Boolean).join("  ·  ");

    let companyX = headerInnerRect.x + 54;
    if (!baseTemplateImage && logoImage) {
      const logoDimensions = logoImage.scaleToFit(90, 34);
      page.drawImage(logoImage, {
        x: headerInnerRect.x,
        y: headerInnerRect.y + headerInnerRect.height - logoDimensions.height - 6,
        width: logoDimensions.width,
        height: logoDimensions.height,
      });
      companyX = headerInnerRect.x + logoDimensions.width + 12;
    }

    page.drawText(companyName, {
      x: companyX,
      y: headerInnerRect.y + headerInnerRect.height - companyNameSize - 6,
      font: boldFont,
      size: companyNameSize,
      color: accent,
    });

    let infoY = headerInnerRect.y + headerInnerRect.height - companyNameSize - 20;
    for (const line of companyInfoLines) {
      page.drawText(line, {
        x: companyX,
        y: infoY,
        font: regularFont,
        size: 8.5,
        color: rgb(0.25, 0.25, 0.25),
      });
      infoY -= 10.5;
    }

    page.drawText(headingText, {
      x: headerInnerRect.x + headerInnerRect.width - boldFont.widthOfTextAtSize(headingText, headingSize),
      y: headerInnerRect.y + 24,
      font: boldFont,
      size: headingSize,
      color: accent,
    });

    if (referenceMeta) {
      page.drawText(referenceMeta, {
        x: headerInnerRect.x + headerInnerRect.width - regularFont.widthOfTextAtSize(referenceMeta, 8.5),
        y: headerInnerRect.y + 10,
        font: regularFont,
        size: 8.5,
        color: rgb(0.25, 0.25, 0.25),
      });
    }
  };

  const startNewPage = () => {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawPageShell(page);
    drawHeader();
    y = contentInnerRect.y + contentInnerRect.height - 12;
  };

  const ensureSpace = (heightNeeded, { keepTableHeader = false } = {}) => {
    if (y - heightNeeded < contentBottom) {
      startNewPage();
      if (keepTableHeader) {
        drawTableHeader();
      }
    }
  };

  const drawParagraph = ({
    text,
    x = contentInnerRect.x,
    width = contentInnerRect.width,
    font = regularFont,
    size = 10.2,
    lineHeight = 12.5,
    color = rgb(0.15, 0.15, 0.15),
    gapAfter = 6,
    maxLines = null,
  }) => {
    let lines = wrapText(text, font, size, width);
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[lines.length - 1] = truncateTextToWidth(lines[lines.length - 1], font, size, width);
    }
    if (lines.length === 0) {
      ensureSpace(gapAfter);
      y -= gapAfter;
      return;
    }

    for (const line of lines) {
      ensureSpace(lineHeight);
      if (line) {
        page.drawText(line, { x, y, font, size, color });
      }
      y -= lineHeight;
    }
    ensureSpace(gapAfter);
    y -= gapAfter;
  };

  const drawKeyValue = (label, value, x, width, topY, { maxValueLines = 2 } = {}) => {
    const labelSize = 7.8;
    const valueSize = 9.2;
    let cursorY = topY;

    page.drawText(label.toUpperCase(), {
      x,
      y: cursorY,
      font: boldFont,
      size: labelSize,
      color: rgb(0.45, 0.45, 0.45),
    });
    cursorY -= 11;
    let valueLines = wrapText(value || "-", regularFont, valueSize, width);
    if (maxValueLines && valueLines.length > maxValueLines) {
      valueLines = valueLines.slice(0, maxValueLines);
      valueLines[valueLines.length - 1] = truncateTextToWidth(valueLines[valueLines.length - 1], regularFont, valueSize, width);
    }
    for (const line of valueLines) {
      page.drawText(line, {
        x,
        y: cursorY,
        font: regularFont,
        size: valueSize,
        color: rgb(0.1, 0.1, 0.1),
      });
      cursorY -= 10.5;
    }
    return cursorY - 4;
  };

  const drawTableHeader = () => {
    ensureSpace(24);
    page.drawRectangle({
      x: contentInnerRect.x,
      y: y - 15,
      width: contentInnerRect.width,
      height: 18,
      color: lightAccent,
    });

    for (const column of columns) {
      page.drawText(column.label, {
        x: column.x,
        y: y - 10,
        font: boldFont,
        size: 8.4,
        color: accent,
      });
    }
    y -= 22;
  };

  const columns = (() => {
    const width = contentInnerRect.width;
    const descriptionWidth = width * 0.56;
    const qtyWidth = width * 0.09;
    const rateWidth = width * 0.15;
    const totalWidth = width - descriptionWidth - qtyWidth - rateWidth;

    return [
      { label: "Description", x: contentInnerRect.x + 10, width: descriptionWidth - 10, align: "left" },
      { label: "Qty", x: contentInnerRect.x + descriptionWidth, width: qtyWidth, align: "right" },
      { label: "Rate", x: contentInnerRect.x + descriptionWidth + qtyWidth, width: rateWidth, align: "right" },
      { label: "Line Total", x: contentInnerRect.x + descriptionWidth + qtyWidth + rateWidth, width: totalWidth - 10, align: "right" },
    ];
  })();

  startNewPage();

  ensureSpace(110);
  const leftColumnX = contentInnerRect.x;
  const rightColumnX = contentInnerRect.x + contentInnerRect.width / 2 + 10;
  const columnWidth = contentInnerRect.width / 2 - 10;
  const metaTopY = y;

  let leftColumnEnd = drawKeyValue(`${documentLabel} for`, job.customerName, leftColumnX, columnWidth, metaTopY, { maxValueLines: 1 });
  leftColumnEnd = drawKeyValue("Customer email", job.customerEmail || "Not provided", leftColumnX, columnWidth, leftColumnEnd, { maxValueLines: 1 });
  leftColumnEnd = drawKeyValue("Service address", job.jobAddress || "Not provided", leftColumnX, columnWidth, leftColumnEnd);

  let rightColumnEnd = drawKeyValue("Reference", context.documentReference, rightColumnX, columnWidth, metaTopY, { maxValueLines: 1 });
  rightColumnEnd = drawKeyValue("Issue date", document.issueDate || "-", rightColumnX, columnWidth, rightColumnEnd, { maxValueLines: 1 });
  if (type === "invoice" && job.ocNumber) {
    rightColumnEnd = drawKeyValue("OC number", job.ocNumber, rightColumnX, columnWidth, rightColumnEnd, { maxValueLines: 1 });
  }
  if (type !== "quote") {
    rightColumnEnd = drawKeyValue("Job title", job.title || "-", rightColumnX, columnWidth, rightColumnEnd);
  }

  y = Math.min(leftColumnEnd, rightColumnEnd) - 6;

  const introText = type === "quote"
    ? String(job.description || "").trim()
    : fillTemplateText(normalizedTemplate.introText, context).trim();

  if (introText) {
    drawParagraph({
      text: introText,
      size: 9.8,
      lineHeight: 12,
      gapAfter: 8,
    });
  }

  drawTableHeader();

  for (const item of document.items || []) {
    const descriptionLines = wrapText(item.description || `${documentLabel} item`, regularFont, 8.8, columns[0].width);
    const rowHeight = Math.max(17, descriptionLines.length * 10.2 + 7);
    ensureSpace(rowHeight + 3, { keepTableHeader: true });

    page.drawRectangle({
      x: contentInnerRect.x,
      y: y - rowHeight + 3,
      width: contentInnerRect.width,
      height: rowHeight,
      borderWidth: 1,
      borderColor: rgb(0.84, 0.88, 0.92),
      color: rgb(1, 1, 1),
    });

    let descriptionY = y - 8;
    for (const line of descriptionLines) {
      page.drawText(line, {
        x: columns[0].x,
        y: descriptionY,
        font: regularFont,
        size: 8.8,
        color: rgb(0.12, 0.12, 0.12),
      });
      descriptionY -= 10.2;
    }

    const qty = Number(item.qty || 0);
    const rate = Number(item.rate || 0);
    const lineTotal = qty * rate;

    const qtyText = String(qty);
    const rateText = money(rate);
    const totalText = money(lineTotal);

    page.drawText(qtyText, {
      x: columns[1].x + columns[1].width - regularFont.widthOfTextAtSize(qtyText, 8.8),
      y: y - 8,
      font: regularFont,
      size: 8.8,
      color: rgb(0.12, 0.12, 0.12),
    });
    page.drawText(rateText, {
      x: columns[2].x + columns[2].width - regularFont.widthOfTextAtSize(rateText, 8.8),
      y: y - 8,
      font: regularFont,
      size: 8.8,
      color: rgb(0.12, 0.12, 0.12),
    });
    page.drawText(totalText, {
      x: columns[3].x + columns[3].width - boldFont.widthOfTextAtSize(totalText, 8.8),
      y: y - 8,
      font: boldFont,
      size: 8.8,
      color: rgb(0.12, 0.12, 0.12),
    });

    y -= rowHeight + 3;
  }

  if (type === "invoice" || type === "quote") {
    const subtotal = type === "invoice"
      ? calculateInvoiceSubtotal(document.items || [])
      : calculateQuoteSubtotal(document.items || []);
    const gst = type === "invoice"
      ? calculateInvoiceGst(document.items || [])
      : calculateQuoteGst(document.items || []);
    const total = type === "invoice"
      ? calculateInvoiceTotal(document.items || [])
      : calculateQuoteTotal(document.items || []);
    const paid = type === "invoice" ? calculateInvoicePaidAmount(document.payments || []) : 0;
    const balanceDue = type === "invoice" ? calculateInvoiceBalanceDue(document.items || [], document.payments || []) : 0;
    const totalBoxWidth = Math.min(235, contentInnerRect.width * 0.44);
    const totalBoxX = contentInnerRect.x + contentInnerRect.width - totalBoxWidth;
    const totalRows = type === "invoice"
      ? [
          { label: "Subtotal", value: money(subtotal) },
          { label: "GST", value: money(gst) },
          { label: "Total", value: money(total), font: boldFont, size: 9.2 },
          { label: "Paid", value: money(paid) },
          {
            label: "Balance Due",
            value: money(balanceDue),
            highlight: true,
            font: boldFont,
            labelSize: 10,
            valueSize: 10,
          },
        ]
      : [
          { label: "Subtotal", value: money(subtotal) },
          { label: "GST", value: money(gst) },
          {
            label: "Quote Total",
            value: money(total),
            highlight: true,
            font: boldFont,
            labelSize: 10,
            valueSize: 10,
          },
        ];

    ensureSpace(totalRows.length * 16 + 18);

    totalRows.forEach((row, index) => {
      const rowTopY = y - index * 16;
      const labelFont = row.font || regularFont;
      const valueFont = row.font || regularFont;
      const labelSize = row.labelSize || 8.8;
      const valueSize = row.valueSize || 8.8;

      if (row.highlight) {
        page.drawRectangle({
          x: totalBoxX - 8,
          y: rowTopY - 12,
          width: totalBoxWidth + 8,
          height: 18,
          color: lightAccent,
          borderWidth: 1,
          borderColor: accent,
        });
      }

      page.drawText(row.label, {
        x: totalBoxX,
        y: rowTopY - 7,
        font: labelFont,
        size: labelSize,
        color: row.highlight ? accent : rgb(0.18, 0.18, 0.18),
      });

      page.drawText(row.value, {
        x: totalBoxX + totalBoxWidth - valueFont.widthOfTextAtSize(row.value, valueSize),
        y: rowTopY - 7,
        font: valueFont,
        size: valueSize,
        color: rgb(0.08, 0.08, 0.08),
      });
    });

    y -= totalRows.length * 16 + 8;
  } else {
    ensureSpace(34);
    const totalBoxWidth = Math.min(205, contentInnerRect.width * 0.4);
    const totalBoxX = contentInnerRect.x + contentInnerRect.width - totalBoxWidth;
    page.drawRectangle({
      x: totalBoxX,
      y: y - 21,
      width: totalBoxWidth,
      height: 24,
      color: lightAccent,
      borderWidth: 1,
      borderColor: accent,
    });
    const totalLabel = `${documentLabel} Total`;
    page.drawText(totalLabel, {
      x: totalBoxX + 12,
      y: y - 13,
      font: boldFont,
      size: 9.4,
      color: accent,
    });
    const grandTotal = money(calculateDocTotal(document.items || []));
    page.drawText(grandTotal, {
      x: totalBoxX + totalBoxWidth - 12 - boldFont.widthOfTextAtSize(grandTotal, 10),
      y: y - 13,
      font: boldFont,
      size: 10,
      color: rgb(0.08, 0.08, 0.08),
    });
    y -= 30;
  }

  const documentNotes = getVisibleDocumentNotes(type, document.notes);
  if (documentNotes) {
    drawParagraph({
      text: normalizedTemplate.notesHeading,
      font: boldFont,
      size: 10.6,
      lineHeight: 12,
      color: accent,
      gapAfter: 3,
    });
    drawParagraph({
      text: documentNotes,
      size: 9.2,
      lineHeight: 11.2,
      gapAfter: 8,
    });
  }

  drawParagraph({
    text: normalizedTemplate.termsHeading,
    font: boldFont,
    size: 10.6,
    lineHeight: 12,
    color: accent,
    gapAfter: 3,
  });
  drawParagraph({
    text: fillTemplateText(normalizedTemplate.termsText, context),
    size: 9.2,
    lineHeight: 11.2,
    gapAfter: 8,
  });

  if (type === "invoice" && normalizedStampText) {
    const stampSize = fitTextSize(normalizedStampText, boldFont, PAGE_WIDTH * 0.82, 92, 38);
    const stampWidth = boldFont.widthOfTextAtSize(normalizedStampText, stampSize);
    for (const targetPage of pdfDoc.getPages()) {
      targetPage.drawText(normalizedStampText, {
        x: (PAGE_WIDTH - stampWidth) / 2,
        y: PAGE_HEIGHT * 0.48,
        font: boldFont,
        size: stampSize,
        color: rgb(0.86, 0.05, 0.05),
        rotate: degrees(32),
        opacity: 0.34,
      });
    }
  }

  return {
    bytes: await pdfDoc.save(),
    filename: `${buildDocumentReference(job, type)}.pdf`,
  };
}

export async function generateQuotePdf({ job, quote, template }) {
  return generateDocumentPdf({
    job,
    document: quote,
    template,
    type: "quote",
  });
}
