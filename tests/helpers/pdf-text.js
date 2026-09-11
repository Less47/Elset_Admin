import { PDFArray, PDFDict, PDFDocument, PDFName, decodePDFRawStream } from "pdf-lib";

// Inspect pdf-lib's unencrypted standard-font output for our ASCII test fixtures.
export async function readPdfTextRuns(bytes) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray
      ? contents.asArray().map((ref) => pdf.context.lookup(ref))
      : [contents];
    const source = streams.map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")).join("\n");
    return [...source.matchAll(/BT\s([\s\S]*?)ET/g)].map(([, block]) => {
      const [, font, size] = /\/([^\s]+) ([\d.]+) Tf/.exec(block);
      const matrix = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm/.exec(block);
      const text = [...block.matchAll(/<([\da-f]+)> Tj/gi)]
        .map(([, hex]) => Buffer.from(hex, "hex").toString("latin1")).join("");
      const fontDictionary = page.node.Resources().lookup(PDFName.of("Font"), PDFDict)
        .lookup(PDFName.of(font), PDFDict);
      const baseFont = fontDictionary.get(PDFName.of("BaseFont")).decodeText();
      return { text, font: baseFont, size: Number(size), x: Number(matrix[5]), y: Number(matrix[6]) };
    });
  });
}
