import fs from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fileURLToPath } from "url";
import {
  buildDocumentReference,
  buildDocumentTemplateContext,
  calculateDocTotal,
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

const HEADER_RECT = rectFromTemplate(77, 155, 1086, 220);
const CONTENT_RECT = rectFromTemplate(77, 435, 1086, 990);
const FOOTER_RECT = rectFromTemplate(77, 1465, 1086, 130);
const TOP_STRIP_CLEAR_RECT = rectFromTemplate(0, 0, 1240, 92);
const HEADER_CONTENT_CLEAR_RECT = insetRect(HEADER_RECT, 3);
const HEADER_CLEAR_NAME_RECT = HEADER_CONTENT_CLEAR_RECT;
const HEADER_CLEAR_TITLE_RECT = HEADER_CONTENT_CLEAR_RECT;

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

export async function generateDocumentPdf({ job, document, template, type = "quote" }) {
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

  let page;
  let y = 0;

  const contentInnerRect = insetRect(CONTENT_RECT, 18);
  const footerInnerRect = insetRect(FOOTER_RECT, 16);
  const contentBottom = contentInnerRect.y + 6;

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

    for (const rect of [HEADER_RECT, CONTENT_RECT, FOOTER_RECT]) {
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
      const logoDimensions = logoImage.scaleToFit(headerInnerRect.width * 0.74, headerInnerRect.height - 20);
      page.drawImage(logoImage, {
        x: headerInnerRect.x,
        y: headerInnerRect.y + (headerInnerRect.height - logoDimensions.height) / 2,
        width: logoDimensions.width,
        height: logoDimensions.height,
      });
      return;
    }

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

    if (baseTemplateImage) {
      page.drawRectangle({
        ...HEADER_CLEAR_NAME_RECT,
        color: panelFill,
      });
      page.drawRectangle({
        ...HEADER_CLEAR_TITLE_RECT,
        color: panelFill,
      });
    }

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
    y = contentInnerRect.y + contentInnerRect.height - 18;
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
    size = 11,
    lineHeight = 15,
    color = rgb(0.15, 0.15, 0.15),
    gapAfter = 10,
  }) => {
    const lines = wrapText(text, font, size, width);
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

  const drawKeyValue = (label, value, x, width, topY) => {
    const labelSize = 9;
    const valueSize = 10.5;
    let cursorY = topY;

    page.drawText(label.toUpperCase(), {
      x,
      y: cursorY,
      font: boldFont,
      size: labelSize,
      color: rgb(0.45, 0.45, 0.45),
    });
    cursorY -= 14;
    const valueLines = wrapText(value || "-", regularFont, valueSize, width);
    for (const line of valueLines) {
      page.drawText(line, {
        x,
        y: cursorY,
        font: regularFont,
        size: valueSize,
        color: rgb(0.1, 0.1, 0.1),
      });
      cursorY -= 13;
    }
    return cursorY - 6;
  };

  const drawTableHeader = () => {
    ensureSpace(30);
    page.drawRectangle({
      x: contentInnerRect.x,
      y: y - 18,
      width: contentInnerRect.width,
      height: 22,
      color: lightAccent,
    });

    for (const column of columns) {
      page.drawText(column.label, {
        x: column.x,
        y: y - 11,
        font: boldFont,
        size: 9.5,
        color: accent,
      });
    }
    y -= 28;
  };

  const drawFooter = () => {
    const footerText = fillTemplateText(normalizedTemplate.footerText, context);
    const footerLines = wrapText(footerText, regularFont, 9.5, footerInnerRect.width).slice(0, 4);
    let footerY = footerInnerRect.y + footerInnerRect.height - 12;

    for (const line of footerLines) {
      page.drawText(line, {
        x: footerInnerRect.x,
        y: footerY,
        font: regularFont,
        size: 9.5,
        color: rgb(0.18, 0.18, 0.18),
      });
      footerY -= 11;
    }
  };

  const columns = (() => {
    const width = contentInnerRect.width;
    const descriptionWidth = width * 0.53;
    const qtyWidth = width * 0.11;
    const rateWidth = width * 0.16;
    const totalWidth = width - descriptionWidth - qtyWidth - rateWidth;

    return [
      { label: "Description", x: contentInnerRect.x + 10, width: descriptionWidth - 10, align: "left" },
      { label: "Qty", x: contentInnerRect.x + descriptionWidth, width: qtyWidth, align: "right" },
      { label: "Rate", x: contentInnerRect.x + descriptionWidth + qtyWidth, width: rateWidth, align: "right" },
      { label: "Line Total", x: contentInnerRect.x + descriptionWidth + qtyWidth + rateWidth, width: totalWidth - 10, align: "right" },
    ];
  })();

  startNewPage();

  ensureSpace(150);
  const leftColumnX = contentInnerRect.x;
  const rightColumnX = contentInnerRect.x + contentInnerRect.width / 2 + 12;
  const columnWidth = contentInnerRect.width / 2 - 12;
  const metaTopY = y;

  let leftColumnEnd = drawKeyValue(`${documentLabel} for`, job.customerName, leftColumnX, columnWidth, metaTopY);
  leftColumnEnd = drawKeyValue("Customer email", job.customerEmail || "Not provided", leftColumnX, columnWidth, leftColumnEnd);
  leftColumnEnd = drawKeyValue("Service address", job.jobAddress || "Not provided", leftColumnX, columnWidth, leftColumnEnd);

  let rightColumnEnd = drawKeyValue("Reference", context.documentReference, rightColumnX, columnWidth, metaTopY);
  rightColumnEnd = drawKeyValue("Issue date", document.issueDate || "-", rightColumnX, columnWidth, rightColumnEnd);
  rightColumnEnd = drawKeyValue("Job title", job.title || "-", rightColumnX, columnWidth, rightColumnEnd);

  y = Math.min(leftColumnEnd, rightColumnEnd) - 8;

  drawParagraph({
    text: fillTemplateText(normalizedTemplate.introText, context),
    size: 11,
    lineHeight: 16,
    gapAfter: 18,
  });

  drawTableHeader();

  for (const item of document.items || []) {
    const descriptionLines = wrapText(item.description || `${documentLabel} item`, regularFont, 10, columns[0].width);
    const rowHeight = Math.max(22, descriptionLines.length * 12 + 10);
    ensureSpace(rowHeight + 6, { keepTableHeader: true });

    page.drawRectangle({
      x: contentInnerRect.x,
      y: y - rowHeight + 4,
      width: contentInnerRect.width,
      height: rowHeight,
      borderWidth: 1,
      borderColor: rgb(0.84, 0.88, 0.92),
      color: rgb(1, 1, 1),
    });

    let descriptionY = y - 10;
    for (const line of descriptionLines) {
      page.drawText(line, {
        x: columns[0].x,
        y: descriptionY,
        font: regularFont,
        size: 10,
        color: rgb(0.12, 0.12, 0.12),
      });
      descriptionY -= 12;
    }

    const qty = Number(item.qty || 0);
    const rate = Number(item.rate || 0);
    const lineTotal = qty * rate;

    const qtyText = String(qty);
    const rateText = money(rate);
    const totalText = money(lineTotal);

    page.drawText(qtyText, {
      x: columns[1].x + columns[1].width - regularFont.widthOfTextAtSize(qtyText, 10),
      y: y - 10,
      font: regularFont,
      size: 10,
      color: rgb(0.12, 0.12, 0.12),
    });
    page.drawText(rateText, {
      x: columns[2].x + columns[2].width - regularFont.widthOfTextAtSize(rateText, 10),
      y: y - 10,
      font: regularFont,
      size: 10,
      color: rgb(0.12, 0.12, 0.12),
    });
    page.drawText(totalText, {
      x: columns[3].x + columns[3].width - boldFont.widthOfTextAtSize(totalText, 10),
      y: y - 10,
      font: boldFont,
      size: 10,
      color: rgb(0.12, 0.12, 0.12),
    });

    y -= rowHeight + 6;
  }

  ensureSpace(44);
  const totalBoxWidth = Math.min(220, contentInnerRect.width * 0.42);
  const totalBoxX = contentInnerRect.x + contentInnerRect.width - totalBoxWidth;
  page.drawRectangle({
    x: totalBoxX,
    y: y - 24,
    width: totalBoxWidth,
    height: 28,
    color: lightAccent,
    borderWidth: 1,
    borderColor: accent,
  });
  page.drawText(`${documentLabel} Total`, {
    x: totalBoxX + 12,
    y: y - 15,
    font: boldFont,
    size: 10.5,
    color: accent,
  });
  const grandTotal = money(calculateDocTotal(document.items || []));
  page.drawText(grandTotal, {
    x: totalBoxX + totalBoxWidth - 12 - boldFont.widthOfTextAtSize(grandTotal, 11),
    y: y - 15,
    font: boldFont,
    size: 11,
    color: rgb(0.08, 0.08, 0.08),
  });
  y -= 40;

  drawParagraph({
    text: normalizedTemplate.notesHeading,
    font: boldFont,
    size: 12,
    lineHeight: 15,
    color: accent,
    gapAfter: 6,
  });
  drawParagraph({
    text: document.notes?.trim() || "No additional notes.",
    size: 10.5,
    lineHeight: 14,
    gapAfter: 16,
  });

  drawParagraph({
    text: normalizedTemplate.termsHeading,
    font: boldFont,
    size: 12,
    lineHeight: 15,
    color: accent,
    gapAfter: 6,
  });
  drawParagraph({
    text: fillTemplateText(normalizedTemplate.termsText, context),
    size: 10.5,
    lineHeight: 14,
    gapAfter: 16,
  });

  drawFooter();

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
