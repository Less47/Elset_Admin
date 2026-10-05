import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { DOCUMENT_LAYOUT } from "./quote-pdf.js";
import { MAINTENANCE_SEVERITIES } from "./src/lib/maintenance-checklist.js";

const { pageWidth: W, pageHeight: H, margin: M } = DOCUMENT_LAYOUT;
const INK = rgb(.08, .12, .16), MUTED = rgb(.35, .4, .45), GREEN = rgb(.02, .39, .29);
const safeText = value => [...String(value ?? "").replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, "...")].filter(character => character.codePointAt(0) >= 32 || character === "\n")
  .map(character => character.codePointAt(0) < 256 ? character : "?").join("");

export async function generateMaintenanceServicePdf(report) {
  if (report.status !== "completed") throw new Error("Complete the service before generating its report.");
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const snapshot = report.snapshot, branding = snapshot.branding || {};
  pdf.setTitle(`Maintenance Service Report - Job ${snapshot.jobNumber}`);
  pdf.setAuthor(branding.companyName || "ELSET PTY LTD");
  async function embed(data) {
    if (typeof data !== "string" || data.length > 8_000_000 || !/^data:image\/(png|jpeg|webp);base64,/.test(data)) return null;
    try {
      const bytes = Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
      const normalized = await sharp(bytes, { limitInputPixels: 16_000_000 }).rotate().resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      return await pdf.embedPng(normalized);
    } catch { return null; }
  }
  const logo = await embed(branding.logo);
  let page, y;
  const width = W - M * 2;
  function draw(text, x, baseline, size = 10, font = regular, color = INK) {
    // WinAnsi has a small number of gaps even within Latin-1.
    const supported = [...safeText(text)].map(char => { try { font.encodeText(char); return char; } catch { return "?"; } }).join("");
    page.drawText(supported, { x, y: baseline, size, font, color });
  }
  function wrap(text, available = width, size = 10, font = regular) {
    const lines = [];
    for (const paragraph of safeText(text).split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        let token = word;
        const measure = value => { try { return font.widthOfTextAtSize(value, size); } catch { return value.length * size * .6; } };
        if (line && measure(`${line} ${token}`) > available) { lines.push(line); line = ""; }
        while (measure(token) > available) {
          let split = Math.max(1, Math.floor(available / (size * .65)));
          while (split > 1 && measure(token.slice(0, split)) > available) split--;
          lines.push(token.slice(0, split)); token = token.slice(split);
        }
        line = line ? `${line} ${token}` : token;
      }
      lines.push(line);
    }
    return lines;
  }
  function newPage(first = false) {
    page = pdf.addPage([W, H]); y = H - M;
    if (logo) {
      const dimensions = logo.scaleToFit(first ? 180 : 110, first ? 62 : 36);
      page.drawImage(logo, { x: M, y: y - dimensions.height, ...dimensions });
    } else draw(branding.companyName || "ELSET PTY LTD", M, y - 18, first ? 19 : 12, bold, GREEN);
    if (first) {
      const details = [branding.companyName, branding.abn && `ABN ${branding.abn}`, branding.phone, branding.email, branding.address].filter(Boolean);
      let detailY = y - 9;
      details.flatMap(text => wrap(text, 260, 8)).forEach(line => { draw(line, W - M - 260, detailY, 8, regular, MUTED); detailY -= 11; });
      y = Math.min(y - 85, detailY - 16);
      draw("MAINTENANCE SERVICE REPORT", M, y, 19, bold, GREEN); y -= 30;
    } else {
      draw(`SERVICE REPORT - JOB ${snapshot.jobNumber}`, W - M - 240, y - 18, 10, bold, GREEN); y -= 54;
    }
    page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: .7, color: rgb(.8, .84, .82) });
  }
  function room(height) { if (y - height < 58) newPage(); }
  function paragraph(text, { x = M, available = width, size = 10, font = regular, color = INK, gap = 6 } = {}) {
    for (const line of wrap(text, available, size, font)) { room(size + 5); draw(line, x, y, size, font, color); y -= size + 5; }
    y -= gap;
  }
  function heading(text) { room(55); y -= 10; draw(text.toUpperCase(), M, y, 11, bold, GREEN); y -= 24; }
  newPage(true);
  for (const [label, value] of [["Customer", snapshot.customerName], ["Site", snapshot.siteAddress], ["Plan", snapshot.planName],
    ["Job", `#${snapshot.jobNumber}`], ["Service date", report.serviceDate], ["Technician", report.technicianName], ["Client/site reference", snapshot.clientReference]]) {
    if (value) paragraph(`${label}: ${value}`, { size: 10, gap: 3 });
  }
  paragraph(`Report: ${report.id}`, { size: 8, color: MUTED });
  heading("Checklist");
  paragraph(`${report.counts.completed} PASS   ${report.counts.defects} DEFECT   ${report.counts.na} N/A`, { font: bold });
  const outcomes = { completed: "PASS", defect: "DEFECT", na: "N/A" };
  for (const item of report.items) {
    room(36);
    draw(outcomes[item.result], M, y, 9, bold, item.result === "defect" ? rgb(.65, .15, .1) : GREEN);
    paragraph(`${item.position}. ${item.text}`, { x: M + 60, available: width - 60, gap: 2 });
    if (item.notes) paragraph(`Notes: ${item.notes}`, { x: M + 60, available: width - 60, size: 9, color: MUTED });
  }
  heading("Defects");
  if (!report.defects.length) paragraph("No defects recorded.");
  for (const defect of report.defects) {
    const item = report.items.find(item => item.id === defect.resultId);
    room(70);
    paragraph(`${MAINTENANCE_SEVERITIES[defect.severity]} - ${item?.text || "Checklist item"}`, { font: bold });
    paragraph(defect.description);
    if (defect.recommendedAction) paragraph(`Recommended action: ${defect.recommendedAction}`);
    for (const ref of defect.photoRefs) {
      const photo = report.photos.find(photo => photo.id === ref);
      const image = await embed(photo?.url);
      if (!image) { paragraph(`${photo?.name || "Linked photo"}: image unavailable.`, { size: 8, color: MUTED }); continue; }
      const dimensions = image.scaleToFit(width, 210);
      room(dimensions.height + 32);
      page.drawImage(image, { x: M, y: y - dimensions.height, ...dimensions }); y -= dimensions.height + 14;
      paragraph(photo.name || "Defect photo", { size: 8, color: MUTED });
    }
  }
  heading("Service notes"); paragraph(report.serviceNotes || "No additional service notes.");
  const completionText = `${report.technicianName}\nCompleted: ${report.completedAt}`;
  room(34 + wrap(completionText).length * 15);
  heading("Technician completion"); paragraph(completionText);
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawLine({ start: { x: M, y: 41 }, end: { x: W - M, y: 41 }, thickness: .5, color: rgb(.84, .86, .85) });
    const footer = `Maintenance Service Report | Job ${snapshot.jobNumber} | ${index + 1} / ${pages.length}`;
    sheet.drawText(footer, { x: M, y: 26, size: 8, font: regular, color: MUTED });
  });
  return { bytes: await pdf.save(), filename: `maintenance-service-job-${String(snapshot.jobNumber || report.id).replace(/[^a-z0-9-]/gi, "-")}.pdf` };
}
