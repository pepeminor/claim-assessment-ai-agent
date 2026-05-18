const state = {
  templates: {},
  policies: [],
  documents: [],
  medicalRules: [],
  currentClaim: null,
  inputMode: "form", // "form" | "json"
};

const config = window.CLAIM_UI_CONFIG ?? {
  assessmentEndpoint: "/api/assess",
  assessmentLabel: "LLM report",
};

const els = {
  status: document.querySelector("#status"),
  templateSelect: document.querySelector("#templateSelect"),
  runAssessment: document.querySelector("#runAssessment"),
  claimInput: document.querySelector("#claimInput"),
  reportOutput: document.querySelector("#reportOutput"),
  logsOutput: document.querySelector("#logsOutput"),
  formContainer: document.querySelector("#formContainer"),
  jsonContainer: document.querySelector("#jsonContainer"),
  toggleInputMode: document.querySelector("#toggleInputMode"),
};

init().catch(showError);

async function init() {
  const [templates, data] = await Promise.all([
    fetchJson("/api/templates"),
    fetchJson("/api/data"),
  ]);

  state.templates = templates;
  state.policies = data.policies;
  state.documents = data.submittedDocuments;
  state.medicalRules = data.medicalNecessityRules || [];

  wireEvents();
  loadSelectedTemplate();
}

function wireEvents() {
  els.templateSelect.addEventListener("change", loadSelectedTemplate);
  els.runAssessment.addEventListener("click", () => runAssessment("assess").catch(showError));
  els.toggleInputMode.addEventListener("click", toggleInputMode);

  els.claimInput.addEventListener("input", () => {
    try {
      state.currentClaim = JSON.parse(els.claimInput.value);
      renderSmartForm();
    } catch (e) {
      // Invalid JSON, don't update form yet
    }
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      document.querySelector(`#${tab.dataset.tab}`).classList.add("active");
    });
  });
}

function toggleInputMode() {
  state.inputMode = state.inputMode === "form" ? "json" : "form";
  els.toggleInputMode.textContent = state.inputMode === "form" ? "Switch to JSON" : "Switch to Form";

  if (state.inputMode === "form") {
    els.formContainer.classList.add("active");
    els.jsonContainer.classList.remove("active");
  } else {
    els.formContainer.classList.remove("active");
    els.jsonContainer.classList.add("active");
  }
}

function loadSelectedTemplate() {
  const template = state.templates[els.templateSelect.value];
  state.currentClaim = JSON.parse(JSON.stringify(template)); // Deep clone
  els.claimInput.value = JSON.stringify(state.currentClaim, null, 2);
  renderSmartForm();
  setStatus("Template loaded");
  renderResult(null);
}

function renderSmartForm() {
  if (!state.currentClaim) return;

  const claim = state.currentClaim.claim;
  const policy = state.policies.find((p) => p.policyId === claim.policyId);

  els.formContainer.innerHTML = `
    <div class="smart-form">
      <div class="form-row">
        <div class="form-group">
          <label>Policy ID</label>
          <select onchange="updateClaim('claim.policyId', this.value)">
            ${state.policies.map((p) => `<option value="${p.policyId}" ${p.policyId === claim.policyId ? "selected" : ""}>${p.policyId}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label>Member ID</label>
          <select onchange="updateClaim('claim.memberId', this.value)">
            ${(policy?.memberIds || []).map((m) => `<option value="${m}" ${m === claim.memberId ? "selected" : ""}>${m}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label>Claim Type</label>
        <select onchange="updateClaim('claim.claimType', this.value)">
          <option value="inpatient_hospitalization" ${claim.claimType === "inpatient_hospitalization" ? "selected" : ""}>Inpatient Hospitalization</option>
          <option value="outpatient_specialist" ${claim.claimType === "outpatient_specialist" ? "selected" : ""}>Outpatient Specialist</option>
          <option value="cosmetic_surgery" ${claim.claimType === "cosmetic_surgery" ? "selected" : ""}>Cosmetic Surgery</option>
        </select>
      </div>

      ${renderPolicyInspector(policy, claim.claimType)}

      <div class="form-row">
        <div class="form-group">
          <label>Amount (USD)</label>
          <input type="number" value="${claim.amount}" oninput="updateClaim('claim.amount', parseFloat(this.value))">
        </div>
        <div class="form-group">
          <label>Diagnosis (Select one)</label>
          <div class="badge-cloud">
            ${renderDiagnosisBadges(claim.diagnosis)}
          </div>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Start Date</label>
          <input type="date" value="${claim.treatmentStartDate}" oninput="updateClaim('claim.treatmentStartDate', this.value)">
        </div>
        <div class="form-group">
          <label>End Date</label>
          <input type="date" value="${claim.treatmentEndDate}" oninput="updateClaim('claim.treatmentEndDate', this.value)">
        </div>
      </div>

      <div class="form-group">
        <label>Procedures (Click to toggle multiple)</label>
        <div class="badge-cloud">
          ${renderProcedureBadges(claim.procedures)}
        </div>
      </div>

      <div class="form-group">
        <label>Submitted Documents (Click to toggle)</label>
        <div class="badge-cloud">
          ${renderDocumentBadges(policy, claim.claimType, claim.submittedDocumentIds)}
        </div>
      </div>
    </div>
  `;
}

function renderPolicyInspector(policy, claimType) {
  if (!policy) return "";

  const benefit = policy.benefits.find((b) => b.claimType === claimType);
  const exclusion = policy.exclusions.find((e) => e.claimTypes.includes(claimType));
  const waitingPeriod = policy.waitingPeriods.find((w) => w.claimType === claimType);

  return `
    <div class="policy-inspector">
      <h4>Policy Inspector: ${policy.policyNumber}</h4>
      <div class="inspector-grid">
        <div class="inspector-item">
          <label>Status</label>
          <strong style="color: ${policy.status === "active" ? "var(--accent)" : "var(--danger)"}">${policy.status.toUpperCase()}</strong>
        </div>
        <div class="inspector-item">
          <label>Benefit Limit</label>
          <strong>${benefit ? money(benefit.annualLimit) : "Not Covered"}</strong>
        </div>
        <div class="inspector-item">
          <label>Waiting Period</label>
          <strong>${waitingPeriod ? `${waitingPeriod.days} Days` : "None"}</strong>
        </div>
        <div class="inspector-item">
          <label>Copay</label>
          <strong>${benefit ? `${benefit.copayPercent}%` : "-"}</strong>
        </div>
        <div class="inspector-item" style="grid-column: span 2;">
          <label>Known Exclusion</label>
          <strong style="color: ${exclusion ? "var(--danger)" : "inherit"}">${exclusion ? exclusion.exclusionId : "None applicable to this type"}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderDiagnosisBadges(currentDiagnosis) {
  const allDiagnosis = [...new Set(state.medicalRules.flatMap(r => r.diagnosisKeywords))];
  
  // To respect "Select one", we find the single most relevant active badge.
  // 1. Try to find an exact match first.
  // 2. Fallback to the first partial match found in the diagnosis string.
  const exactMatch = allDiagnosis.find(diag => diag.toLowerCase() === currentDiagnosis.toLowerCase());
  const firstPartialMatch = allDiagnosis.find(diag => currentDiagnosis.toLowerCase().includes(diag.toLowerCase()));
  const activeDiag = exactMatch || firstPartialMatch;

  return allDiagnosis.map(diag => {
    const isActive = diag === activeDiag;
    return `
      <div class="document-badge ${isActive ? "active" : ""}" 
           onclick="updateClaim('claim.diagnosis', '${diag}')">
        ${diag}
      </div>
    `;
  }).join("");
}

function renderProcedureBadges(currentProcedures) {
  // Extract common procedure keywords from rules
  const allProcedures = [...new Set(state.medicalRules.flatMap(r => r.procedureKeywords))];
  const normalizedCurrent = currentProcedures.map(p => p.toLowerCase());

  return allProcedures.map(proc => {
    const isActive = normalizedCurrent.some(p => p.includes(proc.toLowerCase()));
    return `
      <div class="document-badge ${isActive ? "active" : ""}" 
           onclick="toggleProcedure('${proc}')">
        ${proc}
      </div>
    `;
  }).join("");
}

function renderDocumentBadges(policy, claimType, submittedIds) {
  const requiredDocs = policy?.requiredDocuments
    .filter((d) => d.claimType === claimType)
    .map((d) => d.documentType) || [];

  // Get all unique document IDs available in the system
  const allDocIds = [...new Set(state.documents.map((d) => d.documentId))];

  return allDocIds.map((docId) => {
    const docData = state.documents.find((d) => d.documentId === docId);
    const isRequired = requiredDocs.includes(docData?.expectedType);
    const isActive = submittedIds.includes(docId);
    
    return `
      <div class="document-badge ${isActive ? "active" : ""} ${isRequired ? "required" : ""}" 
           onclick="toggleDocument('${docId}')"
           title="Type: ${docData?.expectedType}">
        ${docId}
      </div>
    `;
  }).join("");
}

// Global scope functions for event handlers
window.updateClaim = (path, value) => {
  const parts = path.split(".");
  let target = state.currentClaim;
  for (let i = 0; i < parts.length - 1; i++) {
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = value;

  // When user updates the form, it's no longer a "Pure Template Test"
  // so we remove the expectedOutcome to let the AI decide.
  delete state.currentClaim.expectedOutcome;

  // Sync to JSON textarea
  els.claimInput.value = JSON.stringify(state.currentClaim, null, 2);
  
  // Re-render form only if needed
  renderSmartForm();
};

window.toggleProcedure = (proc) => {
  const procedures = state.currentClaim.claim.procedures;
  const index = procedures.findIndex(p => p.toLowerCase().includes(proc.toLowerCase()));
  if (index === -1) {
    procedures.push(proc);
  } else {
    procedures.splice(index, 1);
  }
  
  delete state.currentClaim.expectedOutcome;
  els.claimInput.value = JSON.stringify(state.currentClaim, null, 2);
  renderSmartForm();
};

window.toggleDocument = (docId) => {
  const submittedIds = state.currentClaim.claim.submittedDocumentIds;
  const index = submittedIds.indexOf(docId);
  if (index === -1) {
    submittedIds.push(docId);
  } else {
    submittedIds.splice(index, 1);
  }
  
  // Clear expectedOutcome on manual document change
  delete state.currentClaim.expectedOutcome;

  els.claimInput.value = JSON.stringify(state.currentClaim, null, 2);
  renderSmartForm();
};

async function runAssessment(mode = "assess") {
  const isPreview = mode === "preview";
  const label = isPreview ? "Preview" : config.assessmentLabel;
  const endpoint = isPreview ? "/api/preview" : config.assessmentEndpoint;

  setRunning(true, isPreview);
  setStatus(`Running ${label}...`);
  renderRunning();

  try {
    const claimCase = state.currentClaim;
    const result = await fetchJson(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(claimCase),
    });
    renderResult(result);
    setStatus(`${label} complete`);
  } catch (error) {
    showError(error);
  } finally {
    setRunning(false);
  }
}

function renderResult(result) {
  if (!result) {
    els.reportOutput.innerHTML = emptyReportMarkup();
    els.logsOutput.innerHTML = formatConsoleLog([]);
    return;
  }

  // Handle both LLM Report and Deterministic Decision result
  const isReport = Boolean(result.recommendation);
  const report = toReportModel(result);
  const logs = result.toolCallLog;

  els.reportOutput.innerHTML = renderProfessionalReport(report, result);
  els.logsOutput.innerHTML = formatConsoleLog(logs ?? []);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error ?? `Request failed with ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function setStatus(text) {
  els.status.textContent = text;
  els.status.classList.remove("error");
}

function showError(error) {
  els.status.textContent = "Assessment failed. See report.";
  els.status.classList.add("error");
  els.reportOutput.innerHTML = renderErrorReport(error);
  els.logsOutput.innerHTML = formatErrorLog(error);
  console.error(error);
}

function setRunning(isRunning) {
  els.runAssessment.disabled = isRunning;
  els.runAssessment.textContent = isRunning ? "Running..." : "Run Assessment";
}

function renderRunning() {
  els.reportOutput.innerHTML = `
    <article class="report-page empty-report">
      <header class="report-header">
        <div>
          <span class="report-kicker">Claim Assessment Report</span>
          <h2>Assessment in progress</h2>
          <p>The LLM agent is reviewing documents, policy terms, medical necessity, and benefits.</p>
        </div>
      </header>
    </article>
  `;
  els.logsOutput.innerHTML = [
    '<span class="log-info">$ run-assessment --mode llm-report</span>',
    '<span class="log-dim">[pending] waiting for assessment response...</span>',
  ].join("\n");
}

function formatReason(reason) {
  if (typeof reason === "string") {
    return { text: reason, clauseIds: [] };
  }

  return {
    text: reason.text ?? reason.message ?? reason.code ?? JSON.stringify(reason),
    clauseIds: reason.clauseIds ?? [],
  };
}

function toReportModel(result) {
  if (result.recommendation) {
    const policy = findPolicyFromLogs(result.toolCallLog);
    return {
      claimCase: null,
      claim: {
        claimId: result.claimId,
        policyId: result.benefitCalculation?.policyId,
        claimType: result.benefitCalculation?.claimType,
        amount: result.benefitCalculation?.submittedAmount,
        currency: "USD",
      },
      policy,
      recommendation: result.recommendation,
      documentReview: result.documentReview ?? [],
      policyVerification: result.policyVerification ?? {},
      medicalNecessity: result.medicalNecessity,
      benefitCalculation: result.benefitCalculation,
      reasoning: (result.reasoning ?? []).map(formatReason),
      policyCitations: result.policyCitations ?? [],
      toolCallLog: result.toolCallLog ?? [],
    };
  }

  return {
    claimCase: result.claimCase,
    claim: result.claimCase?.claim,
    policy: result.policy,
    recommendation: result.decision?.recommendation,
    documentReview: result.documentReview ?? [],
    policyVerification: result.decision?.findings ?? {},
    medicalNecessity: result.medicalNecessity,
    benefitCalculation: result.benefitCalculation,
    reasoning: (result.decision?.reasons ?? []).map(formatReason),
    policyCitations: citationsForDecision(result.policy, result.decision?.requiredClauseIds ?? []),
    toolCallLog: result.toolCallLog ?? [],
  };
}

function findPolicyFromLogs(logs = []) {
  return logs.find((entry) => entry.toolName === "lookupPolicy")?.output?.policy ?? null;
}

function citationsForDecision(policy, clauseIds) {
  if (!policy?.clauses) {
    return [];
  }

  const wanted = new Set(clauseIds);
  return policy.clauses.filter((clause) => wanted.has(clause.clauseId));
}

function renderProfessionalReport(report, rawResult) {
  const claim = report.claim ?? {};
  const policy = report.policy ?? {};
  const benefit = report.benefitCalculation ?? {};
  const medical = report.medicalNecessity ?? {};
  const generatedAt = new Date().toLocaleString();

  return `
    <article class="report-page">
      <header class="report-header">
        <div>
          <span class="report-kicker">Claim Assessment Report</span>
          <h2>${escapeHtml(claim.claimId ?? report.claimCase?.caseId ?? "Unsubmitted Claim")}</h2>
          <p>Initial AI-assisted assessment for human assessor review.</p>
        </div>
        <div class="report-stamp ${statusClass(report.recommendation)}">
          <span>Recommendation</span>
          <strong>${escapeHtml(formatRecommendation(report.recommendation))}</strong>
        </div>
      </header>

      <section class="report-section">
        <h3>Claim And Policy Summary</h3>
        <div class="field-grid">
          ${field("Policy", policy.policyNumber ?? claim.policyId)}
          ${field("Member", claim.memberId ?? policy.memberIds?.join(", "))}
          ${field("Claim Type", claim.claimType)}
          ${field("Submitted Amount", money(claim.amount ?? benefit.submittedAmount))}
          ${field("Treatment Dates", dateRange(claim.treatmentStartDate, claim.treatmentEndDate))}
          ${field("Generated", generatedAt)}
        </div>
      </section>

      <section class="report-section">
        <h3>Decision Basis</h3>
        <ol class="reason-list">
          ${(report.reasoning ?? []).map(renderReasonItem).join("")}
        </ol>
      </section>

      <section class="report-section">
        <h3>Document Review</h3>
        ${documentTable(report.documentReview)}
      </section>

      <section class="report-section two-column-section">
        <div>
          <h3>Medical Necessity</h3>
          <dl class="definition-list">
            ${definition("Diagnosis", medical.diagnosis)}
            ${definition("Procedures", medical.procedures?.join(", "))}
            ${definition("Appropriate", medical.clinicallyAppropriate === undefined ? "-" : medical.clinicallyAppropriate ? "Yes" : "No")}
            ${definition("Rule", medical.ruleId)}
            ${definition("Reason", medical.reason)}
          </dl>
        </div>
        <div>
          <h3>Benefit Calculation</h3>
          <dl class="definition-list">
            ${definition("Submitted", money(benefit.submittedAmount))}
            ${definition("Eligible", money(benefit.eligibleAmount))}
            ${definition("Covered", money(benefit.coveredAmount))}
            ${definition("Copay", money(benefit.copay))}
            ${definition("Member Responsibility", money(benefit.memberResponsibility))}
            ${definition("Remaining Limit", money(benefit.remainingLimitAfterClaim))}
          </dl>
        </div>
      </section>

      <section class="report-section">
        <h3>Policy Citations</h3>
        <div class="citation-list">
          ${(report.policyCitations ?? []).map(renderCitation).join("")}
        </div>
      </section>

      <details class="raw-json">
        <summary>Raw JSON For Debugging</summary>
        <pre>${escapeHtml(JSON.stringify(rawResult, null, 2))}</pre>
      </details>
    </article>
  `;
}

function renderReasonItem(item) {
  const badges = (item.clauseIds ?? [])
    .map(id => `<span class="clause-badge">${escapeHtml(id)}</span>`)
    .join(" ");

  return `
    <li>
      <div class="reason-item">
        <span class="reason-text">${escapeHtml(item.text)}</span>
        <div class="reason-badges">${badges}</div>
      </div>
    </li>
  `;
}

function documentTable(documents = []) {
  if (documents.length === 0) {
    return `<p class="empty-copy">No document verification results yet.</p>`;
  }

  return `
    <table class="report-table">
      <thead>
        <tr>
          <th>Document ID</th>
          <th>Detected</th>
          <th>Expected</th>
          <th>Status</th>
          <th>Issues</th>
        </tr>
      </thead>
      <tbody>
        ${documents.map((document) => `
          <tr>
            <td>${escapeHtml(document.documentId)}</td>
            <td>${escapeHtml(document.documentType)}</td>
            <td>${escapeHtml(document.expectedType)}</td>
            <td><span class="status-pill ${statusClass(document.status)}">${escapeHtml(document.status)}</span></td>
            <td>${escapeHtml(document.issues?.join("; ") || "None")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderCitation(citation) {
  return `
    <div class="citation-item">
      <strong>${escapeHtml(citation.clauseId)}</strong>
      <span>${escapeHtml(citation.title)}</span>
      <p>${escapeHtml(citation.text)}</p>
    </div>
  `;
}

function emptyReportMarkup() {
  return `
    <article class="report-page empty-report">
      <header class="report-header">
        <div>
          <span class="report-kicker">Claim Assessment Report</span>
          <h2>No assessment run yet</h2>
          <p>Run an assessment to generate a human-readable report.</p>
        </div>
      </header>
    </article>
  `;
}

function renderErrorReport(error) {
  const details = describeAssessmentError(error);

  return `
    <article class="report-page error-report">
      <header class="report-header">
        <div>
          <span class="report-kicker">Claim Assessment Report</span>
          <h2>Assessment Failed</h2>
          <p>The claim was not accepted as a final report because validation or provider execution failed.</p>
        </div>
        <div class="report-stamp reject">
          <span>Status</span>
          <strong>FAILED</strong>
        </div>
      </header>

      <section class="report-section">
        <h3>Failure Summary</h3>
        <p class="error-message">${escapeHtml(details.summary)}</p>
      </section>

      <section class="report-section">
        <h3>Required Fix</h3>
        <ul class="error-list">
          ${details.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
    </article>
  `;
}

function parseErrorLines(message) {
  const lines = String(message)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const items = lines
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));

  return {
    summary: lines.find((line) => !line.startsWith("- ")) ?? "Assessment failed.",
    items: items.length > 0 ? items : [message],
  };
}

function describeAssessmentError(error) {
  const message = error?.message ?? "Unknown assessment error.";
  const providerError = extractProviderError(message);

  if (providerError?.code === 503 || providerError?.status === "UNAVAILABLE") {
    return {
      summary: "LLM provider is temporarily unavailable or under high demand.",
      items: [
        "Try Run Assessment again after a short wait.",
        "If this keeps happening, switch to a less busy model/provider in .env.",
        "The claim was not approved or rejected because the LLM provider did not return a validated report.",
      ],
    };
  }

  if (providerError?.code === 429 || /quota|rate limit/i.test(message)) {
    return {
      summary: "LLM provider quota or rate limit was reached.",
      items: [
        "Wait for the provider quota window to reset or use a paid project/key with quota.",
        "Try a lower traffic model in .env.",
        "The deterministic policy engine still protects final decisions when a report is produced.",
      ],
    };
  }

  return parseErrorLines(message);
}

function extractProviderError(message) {
  const jsonStart = message.indexOf("[");
  if (jsonStart < 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(message.slice(jsonStart));
    return Array.isArray(parsed) ? parsed[0]?.error ?? null : parsed?.error ?? null;
  } catch {
    return null;
  }
}

function formatConsoleLog(logs) {
  if (!logs.length) {
    return [
      '<span class="log-info">$ claim-assessment logs</span>',
      '<span class="log-dim">[idle] Run an assessment to inspect tool calls.</span>',
    ].join("\n");
  }

  const lines = ['<span class="log-info">$ claim-assessment logs --verbose</span>'];
  logs.forEach((entry, index) => {
    const id = String(index + 1).padStart(2, "0");
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const icon = getToolIcon(entry.toolName);
    
    lines.push("");
    lines.push(`[${id}] <span class="log-highlight">${icon} ${entry.toolName.toUpperCase()}</span> <span class="log-dim">@ ${timestamp}</span>`);
    lines.push(`     <span class="log-info">INPUT</span>  <span class="log-dim">-></span> ${JSON.stringify(entry.input)}`);
    
    const summary = getToolSummary(entry.toolName, entry.output);
    const statusClass = summary.isError ? "log-error" : summary.isWarn ? "log-warn" : "log-success";
    
    lines.push(`     <span class="log-info">STATUS</span> <span class="log-dim">-></span> <span class="${statusClass}">${summary.status}</span>`);
    if (summary.message) {
      lines.push(`     <span class="log-info">DETAIL</span> <span class="log-dim">-></span> ${summary.message}`);
    }
  });
  return lines.join("\n");
}

function getToolIcon(name) {
  const icons = {
    verifyDocument: "🔍",
    lookupPolicy: "📋",
    checkMedicalNecessity: "⚕️",
    calculateBenefit: "💰"
  };
  return icons[name] || "⚙️";
}

function getToolSummary(name, output) {
  switch (name) {
    case "verifyDocument":
      const isComplete = output.status === "complete";
      return { 
        status: isComplete ? "COMPLETE ✅" : `${output.status.toUpperCase()} ⚠️`, 
        message: output.issues?.length ? `<span class="log-warn">${output.issues.join("; ")}</span>` : "Document verified successfully.",
        isWarn: !isComplete
      };
    case "lookupPolicy":
      const isActive = output.policy?.status === "active";
      return { 
        status: isActive ? "ACTIVE ✅" : "INACTIVE ❌", 
        message: `Policy: <span class="log-highlight">${output.policy?.policyNumber || "N/A"}</span>`,
        isError: !isActive
      };
    case "checkMedicalNecessity":
      return { 
        status: output.clinicallyAppropriate ? "APPROPRIATE ✅" : "INAPPROPRIATE ❌", 
        message: output.reason,
        isError: !output.clinicallyAppropriate
      };
    case "calculateBenefit":
      const hasBenefit = output.coveredAmount > 0;
      return { 
        status: hasBenefit ? "CALCULATED 💰" : "NO PAYABLE BENEFIT ❌", 
        message: `Covered: <span class="log-success">${money(output.coveredAmount)}</span> | Member: <span class="log-warn">${money(output.memberResponsibility)}</span>`,
        isWarn: !hasBenefit
      };
    default:
      return { status: "EXECUTED", message: "" };
  }
}

function formatErrorLog(error) {
  return [
    '<span class="log-error">$ claim-assessment logs --error</span>',
    `<span class="log-info">status:</span> <span class="log-highlight">${error?.status ?? "n/a"}</span>`,
    '<span class="log-info">message:</span>',
    `<span class="log-error">${indent(escapeHtml(error?.message ?? "Unknown error"))}</span>`,
    "",
    '<span class="log-info">raw_output:</span>',
    `<span class="log-dim">${indent(escapeHtml(JSON.stringify(error?.body ?? { error: error?.message }, null, 2)))}</span>`,
  ].join("\n");
}

function indent(value) {
  return String(value)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function field(label, value) {
  return `
    <div class="field-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? "-")}</strong>
    </div>
  `;
}

function definition(label, value) {
  return `
    <dt>${escapeHtml(label)}</dt>
    <dd>${escapeHtml(value ?? "-")}</dd>
  `;
}

function money(value) {
  if (typeof value !== "number") {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function dateRange(start, end) {
  if (!start && !end) {
    return "-";
  }
  return `${start ?? "-"} to ${end ?? "-"}`;
}

function formatRecommendation(value) {
  return value ? value.replaceAll("_", " ") : "Pending";
}

function statusClass(value = "") {
  return value.toLowerCase().replaceAll("_", "-");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
