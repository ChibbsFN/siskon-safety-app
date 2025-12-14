const STORAGE_KEY = "siskon.report.draft.v2";
const THEME_KEY = "siskon.theme";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const form = $("#reportForm");
const steps = $$("[data-step]");
const stepDots = $$("[data-step-dot]");
const toastEl = $("#toast");

const draftBadge = $("#draftBadge");
const kpiDraft = $("#kpiDraft");
const kpiHealth = $("#kpiHealth");
const pdfHint = $("#pdfHint");

let currentStep = 0;
let lastSavedAt = null;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => (toastEl.hidden = true), 2800);
}

function setTheme(theme) {
  // theme: "auto" | "dark" | "light"
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
  const t = localStorage.getItem(THEME_KEY) || "auto";
  const next = t === "auto" ? "dark" : t === "dark" ? "light" : "auto";
  setTheme(next);
  toast(`Theme: ${next}`);
}

function defaultDraft() {
  const now = new Date();
  // Local datetime-local format (YYYY-MM-DDTHH:mm)
  const pad = (n) => String(n).padStart(2, "0");
  const dt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return {
    reportType: "",
    occurredAt: dt,
    location: "",
    title: "",
    description: "",
    immediateActions: "",
    recommendations: "",
    riskLevel: "",
    category: "",
    reporterName: "",
    reporterRole: "",
    reporterEmail: "",
    reporterPhone: "",
    witnessName: "",
    witnessContact: "",
    confidential: false,
    _meta: {
      id: crypto?.randomUUID?.() ?? `rpt_${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };
}

function getDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setDraft(d) {
  d._meta = d._meta || {};
  d._meta.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  lastSavedAt = new Date();
  updateDraftBadge();
}

function clearDraft() {
  localStorage.removeItem(STORAGE_KEY);
  lastSavedAt = null;
  updateDraftBadge();
}

function readFormIntoDraft(base) {
  const fd = new FormData(form);
  const d = structuredClone(base);

  for (const [k, v] of fd.entries()) {
    d[k] = v;
  }
  d.confidential = $("#confidential")?.checked ?? false;

  // Normalize empty strings
  for (const k of Object.keys(d)) {
    if (typeof d[k] === "string") d[k] = d[k].trim();
  }
  return d;
}

function writeDraftToForm(d) {
  for (const el of $$("input, select, textarea", form)) {
    if (!el.name) continue;
    if (el.type === "checkbox") continue;
    el.value = d[el.name] ?? "";
  }
  $("#confidential").checked = !!d.confidential;
}

function disableInactiveInputs(activeIndex) {
  steps.forEach((fs, idx) => {
    const disabled = idx !== activeIndex;
    $$("input, select, textarea, button", fs).forEach((el) => {
      // keep navigation buttons enabled on the active step only
      el.disabled = disabled;
    });
  });
}

function showStep(i) {
  currentStep = Math.max(0, Math.min(steps.length - 1, i));
  steps.forEach((fs, idx) => {
    fs.hidden = idx !== currentStep;
  });
  stepDots.forEach((li, idx) => {
    li.classList.toggle("is-active", idx === currentStep);
  });
  disableInactiveInputs(currentStep);

  if (currentStep === 3) renderReview();

  // focus first input for accessibility
  const focusTarget = steps[currentStep].querySelector("input, select, textarea");
  focusTarget?.focus?.();
}

function validateStep(i) {
  const fs = steps[i];
  const inputs = $$("input, select, textarea", fs);
  let ok = true;

  for (const el of inputs) {
    if (el.disabled) continue;
    // custom email help
    if (el.type === "email" && el.value.trim() && !/^\S+@\S+\.\S+$/.test(el.value.trim())) {
      el.setCustomValidity("Please enter a valid email address.");
    } else {
      el.setCustomValidity("");
    }

    if (!el.checkValidity()) {
      ok = false;
      el.reportValidity();
      break;
    }
  }
  return ok;
}

function updateDraftBadge() {
  const d = getDraft();
  if (!d) {
    draftBadge.textContent = "Draft: not saved";
    kpiDraft.textContent = "No draft";
    return;
  }
  const updated = d._meta?.updatedAt ? new Date(d._meta.updatedAt) : null;
  const pretty = updated ? updated.toLocaleString() : "saved";
  draftBadge.textContent = `Draft: saved (${pretty})`;
  kpiDraft.textContent = "Saved";
}

function renderReview() {
  const base = getDraft() || defaultDraft();
  const d = readFormIntoDraft(base);

  const pairs = [
    ["Report type", d.reportType || "—"],
    ["Date & time", d.occurredAt || "—"],
    ["Location", d.location || "—"],
    ["Title", d.title || "—"],
    ["Category", d.category || "—"],
    ["Risk level", d.riskLevel || "—"],
    ["Description", d.description || "—"],
    ["Immediate actions", d.immediateActions || "—"],
    ["Recommendations", d.recommendations || "—"],
    ["Reporter", `${d.reporterName || "—"}${d.reporterRole ? ` (${d.reporterRole})` : ""}`],
    ["Reporter email", d.reporterEmail || "—"],
    ["Reporter phone", d.reporterPhone || "—"],
    ["Witness / involved", d.witnessName || "—"],
    ["Witness contact", d.witnessContact || "—"],
    ["Confidential", d.confidential ? "Yes" : "No"]
  ];

  $("#reviewBody").innerHTML = pairs
    .map(
      ([k, v]) => `
      <div class="kv">
        <div class="kv__k">${escapeHtml(k)}</div>
        <div class="kv__v">${escapeHtml(String(v))}</div>
      </div>`
    )
    .join("");

  // Save snapshot of review into draft
  setDraft(d);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const base = getDraft() || defaultDraft();
    const d = readFormIntoDraft(base);
    setDraft(d);
  }, 250);
}

async function checkHealth() {
  try {
    const res = await fetch("/.netlify/functions/health", { cache: "no-store" });
    if (!res.ok) throw new Error("not ok");
    const data = await res.json();
    kpiHealth.textContent = data?.ok ? "Online" : "Offline";
  } catch {
    kpiHealth.textContent = "Offline";
  }
}

async function generatePdf() {
  pdfHint.textContent = "";
  const base = getDraft() || defaultDraft();
  const d = readFormIntoDraft(base);

  // Final validation pass across required fields (basics + details + reporter)
  // (Ensures people didn’t skip by loading a draft)
  const required = ["reportType", "occurredAt", "location", "description", "reporterName"];
  for (const name of required) {
    if (!String(d[name] || "").trim()) {
      toast(`Missing required field: ${name}`);
      return;
    }
  }

  try {
    $("#btnGeneratePdf").disabled = true;
    pdfHint.textContent = "Generating PDF…";

    const res = await fetch("/.netlify/functions/create-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report: d })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`PDF service error (${res.status}). ${errText}`);
    }

    const { ok, fileName, pdfBase64 } = await res.json();
    if (!ok || !pdfBase64) throw new Error("Malformed PDF response.");

    const bytes = base64ToBytes(pdfBase64);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    // Download
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "safety-report.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Share (if available)
    if (navigator.canShare && navigator.share) {
      const file = new File([blob], a.download, { type: "application/pdf" });
      if (navigator.canShare({ files: [file] })) {
        pdfHint.innerHTML = `PDF downloaded. You can also <button class="btn btn--ghost" id="btnShareNow" type="button">share it</button>.`;
        $("#btnShareNow").addEventListener("click", async () => {
          try {
            await navigator.share({ title: "Safety Report", files: [file] });
          } catch {}
        }, { once: true });
      } else {
        pdfHint.textContent = "PDF downloaded.";
      }
    } else {
      pdfHint.textContent = "PDF downloaded.";
    }

    toast("PDF generated.");
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    pdfHint.textContent = "Failed to generate PDF. Check Netlify function logs.";
    toast("PDF generation failed.");
  } finally {
    $("#btnGeneratePdf").disabled = false;
  }
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function exportDraft() {
  const d = getDraft();
  if (!d) return toast("No draft to export.");
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `siskon-draft-${(d._meta?.id || "report").slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
  toast("Draft exported.");
}

async function copyJson() {
  const d = getDraft();
  if (!d) return toast("No draft to copy.");
  await navigator.clipboard.writeText(JSON.stringify(d, null, 2));
  toast("Draft JSON copied.");
}

async function importDraft(file) {
  try {
    const text = await file.text();
    const d = JSON.parse(text);
    if (!d || typeof d !== "object") throw new Error("bad json");
    setDraft(d);
    writeDraftToForm(d);
    showStep(0);
    toast("Draft imported.");
  } catch {
    toast("Import failed (invalid JSON).");
  }
}

function newReport() {
  const d = defaultDraft();
  setDraft(d);
  writeDraftToForm(d);
  showStep(0);
  toast("New report created.");
}

function init() {
  // Theme
  const savedTheme = localStorage.getItem(THEME_KEY) || "auto";
  setTheme(savedTheme);
  $("#btnTheme").addEventListener("click", toggleTheme);

  // Load draft or create default
  const d = getDraft() || defaultDraft();
  setDraft(d);
  writeDraftToForm(d);

  // Autosave on changes
  form.addEventListener("input", () => {
    scheduleAutosave();
    updateDraftBadge();
  });

  // Nav buttons
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    if (t.matches("[data-next]")) {
      if (!validateStep(currentStep)) return;
      showStep(currentStep + 1);
    }
    if (t.matches("[data-prev]")) {
      showStep(currentStep - 1);
    }
  });

  $("#btnGeneratePdf").addEventListener("click", generatePdf);
  $("#btnExportDraft").addEventListener("click", exportDraft);
  $("#btnCopyJson").addEventListener("click", copyJson);

  $("#btnClearDraft").addEventListener("click", () => {
    clearDraft();
    const d2 = defaultDraft();
    setDraft(d2);
    writeDraftToForm(d2);
    showStep(0);
    toast("Draft cleared.");
  });

  $("#btnNew").addEventListener("click", newReport);

  $("#importFile").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importDraft(file);
    e.target.value = "";
  });

  updateDraftBadge();
  checkHealth();

  showStep(0);

  // Service worker (optional, safe)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

init();
