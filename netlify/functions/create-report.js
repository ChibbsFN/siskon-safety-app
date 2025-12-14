const { PDFDocument, StandardFonts } = require("pdf-lib");

const MAX_TEXT = 4000;

function clean(s, max = MAX_TEXT) {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

function isIsoLikeDatetimeLocal(s) {
  // Accept datetime-local format: YYYY-MM-DDTHH:mm (seconds optional)
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s);
}

function must(v, name) {
  if (!v || !String(v).trim()) {
    const err = new Error(`Missing required field: ${name}`);
    err.statusCode = 400;
    throw err;
  }
}

function wrapText(text, maxCharsPerLine) {
  const words = String(text || "").split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxCharsPerLine) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function buildPdf(report) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Safety Report");
  pdf.setSubject("Safety Report");
  pdf.setCreator("Siskon Safety Report Generator");
  pdf.setProducer("Siskon Safety Report Generator");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = pdf.addPage([612, 792]); // US Letter
  const { width, height } = page.getSize();

  const margin = 48;
  let y = height - margin;

  const lineGap = 14;
  const sectionGap = 16;

  function text(str, size = 11, opts = {}) {
    page.drawText(String(str), {
      x: opts.x ?? margin,
      y: opts.y ?? y,
      size,
      font: opts.bold ? fontBold : font,
      maxWidth: opts.maxWidth ?? (width - margin * 2),
      lineHeight: opts.lineHeight ?? (size + 3)
    });
  }

  function hr() {
    y -= 10;
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 1,
      opacity: 0.25
    });
    y -= 8;
  }

  function heading(str) {
    text(str, 16, { bold: true });
    y -= 22;
  }

  function subheading(str) {
    y -= 2;
    text(str, 12, { bold: true });
    y -= 18;
  }

  function field(label, value) {
    const v = value ? String(value) : "—";
    text(label, 10, { bold: true });
    y -= 13;

    const lines = wrapText(v, 92);
    for (const ln of lines) {
      text(ln, 11);
      y -= lineGap;
      if (y < margin + 80) break; // simple overflow guard
    }
    y -= 4;
  }

  const title = clean(report.title, 120);
  const reportType = clean(report.reportType, 40);
  const occurredAt = clean(report.occurredAt, 40);
  const location = clean(report.location, 120);
  const confidential = !!report.confidential;

  // Header
  heading(`${reportType || "Safety"} Report`);
  if (confidential) {
    text("CONFIDENTIAL", 10, { bold: true, x: width - margin - 92 });
  }

  text(title || "Untitled", 12, { bold: true });
  y -= 18;

  hr();

  // Basics
  subheading("Basics");
  field("Date & time", occurredAt || "—");
  field("Location", location || "—");
  field("Category", clean(report.category, 40) || "—");
  field("Risk level", clean(report.riskLevel, 20) || "—");

  y -= 6;
  hr();

  // Details
  subheading("Details");
  field("What happened / observed", clean(report.description, 4000) || "—");
  field("Immediate actions / controls", clean(report.immediateActions, 2000) || "—");
  field("Recommendations", clean(report.recommendations, 2000) || "—");

  y -= 6;
  hr();

  // People
  subheading("People");
  field("Reporter", clean(report.reporterName, 120) || "—");
  field("Reporter role/team", clean(report.reporterRole, 120) || "—");
  field("Reporter email", clean(report.reporterEmail, 180) || "—");
  field("Reporter phone", clean(report.reporterPhone, 60) || "—");
  field("Witness / involved", clean(report.witnessName, 120) || "—");
  field("Witness contact", clean(report.witnessContact, 180) || "—");

  // Footer
  const footer = `Generated ${new Date().toLocaleString()} • Siskon Safety Report Generator`;
  page.drawText(footer, {
    x: margin,
    y: 22,
    size: 9,
    font,
    opacity: 0.6
  });

  const bytes = await pdf.save();
  return bytes;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const body = event.body ? JSON.parse(event.body) : null;
    const report = body?.report || {};

    // Required fields (match frontend requirements)
    must(report.reportType, "reportType");
    must(report.occurredAt, "occurredAt");
    must(report.location, "location");
    must(report.description, "description");
    must(report.reporterName, "reporterName");

    if (!isIsoLikeDatetimeLocal(String(report.occurredAt))) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: false, error: "occurredAt must be datetime-local format (YYYY-MM-DDTHH:mm)" })
      };
    }

    const bytes = await buildPdf(report);
    const pdfBase64 = Buffer.from(bytes).toString("base64");

    const safeType = clean(report.reportType, 40).replace(/[^\w\-]+/g, "-").toLowerCase() || "report";
    const safeDate = clean(report.occurredAt, 40).replace(/[:]/g, "-");
    const fileName = `siskon-${safeType}-${safeDate}.pdf`;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, fileName, pdfBase64 })
    };
  } catch (err) {
    const status = err.statusCode || 500;
    return {
      statusCode: status,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: status === 500 ? "Server error generating PDF" : String(err.message || "Bad request")
      })
    };
  }
};
