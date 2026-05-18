import type {
  AssessmentReport,
  BenefitCalculationResult,
  ClaimCase,
  DocumentVerificationResult,
  MedicalNecessityResult,
  PolicyClause,
  PolicyLookupResult,
  ToolCallLog,
} from "../domain/types.js";
import { evaluateDecision } from "../domain/decisionEngine.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateAssessmentReport(
  claimCase: ClaimCase,
  report: AssessmentReport,
): ValidationResult {
  const errors: string[] = [];
  const policyLookup = getSingleToolOutput<PolicyLookupResult>(
    report.toolCallLog,
    "lookupPolicy",
    errors,
  );
  const medicalNecessity = getSingleToolOutput<MedicalNecessityResult>(
    report.toolCallLog,
    "checkMedicalNecessity",
    errors,
  );
  const benefitCalculation = getSingleToolOutput<BenefitCalculationResult>(
    report.toolCallLog,
    "calculateBenefit",
    errors,
  );
  const documentResults = report.toolCallLog
    .filter((entry) => entry.toolName === "verifyDocument")
    .map((entry) => entry.output as DocumentVerificationResult);

  validateToolSequence(claimCase, report.toolCallLog, errors);

  if (report.claimId !== claimCase.claim.claimId) {
    errors.push(`Report claimId '${report.claimId}' does not match claim.`);
  }

  const policy = policyLookup?.policy ?? null;
  if (!policy) {
    errors.push("lookupPolicy did not return a policy.");
  }

  if (benefitCalculation) {
    compareBenefitCalculation(report, benefitCalculation, errors);
  }

  if (medicalNecessity && isRecord(report.medicalNecessity)) {
    if (
      report.medicalNecessity.clinicallyAppropriate !==
      medicalNecessity.clinicallyAppropriate
    ) {
      errors.push("Report medical necessity does not match tool output.");
    }
  } else {
    errors.push("Report medicalNecessity must be an object.");
  }

  if (policy && medicalNecessity && benefitCalculation) {
    const decision = evaluateDecision({
      claimCase,
      policy,
      documentResults,
      medicalNecessity,
      benefitCalculation,
    });
    if (report.recommendation !== decision.recommendation) {
      errors.push(
        `Report recommendation '${report.recommendation}' should be '${decision.recommendation}'.`,
      );
    }
    if (claimCase.expectedOutcome !== undefined && claimCase.expectedOutcome !== decision.recommendation) {
      errors.push(
        `Test case expected '${claimCase.expectedOutcome}' but deterministic rules derived '${decision.recommendation}'.`,
      );
    }
    compareDocumentReview(report, documentResults, decision.findings.requiredDocuments, errors);
    validateOutcomeCitations(report, decision.requiredClauseIds, decision.recommendation, errors);
  }

  if (policy) {
    validateCitations(report, policy.clauses, errors);
  }

  return { ok: errors.length === 0, errors };
}

function validateOutcomeCitations(
  report: AssessmentReport,
  requiredClauseIds: string[],
  recommendation: string,
  errors: string[],
): void {
  const citedClauseIds = new Set(
    Array.isArray(report.policyCitations)
      ? report.policyCitations
          .filter((citation) => isRecord(citation) && typeof citation.clauseId === "string")
          .map((citation) => citation.clauseId as string)
      : [],
  );
  for (const clauseId of requiredClauseIds) {
    if (!citedClauseIds.has(clauseId)) {
      errors.push(
        `Recommendation '${recommendation}' must cite required policy clause '${clauseId}'.`,
      );
    }
  }
}

function validateToolSequence(
  claimCase: ClaimCase,
  logs: ToolCallLog[],
  errors: string[],
): void {
  const submittedIds = claimCase.claim.submittedDocumentIds;
  const expectedLength = submittedIds.length + 3;
  if (logs.length !== expectedLength) {
    errors.push(`Expected ${expectedLength} tool calls but found ${logs.length}.`);
  }

  const documentCalls = logs.slice(0, submittedIds.length);
  if (documentCalls.some((entry) => entry.toolName !== "verifyDocument")) {
    errors.push("All submitted documents must be verified before other tools.");
  }

  const verifiedIds = documentCalls.map((entry) => entry.input.documentId);
  for (const documentId of submittedIds) {
    if (!verifiedIds.includes(documentId)) {
      errors.push(`Submitted document '${documentId}' was not verified.`);
    }
  }

  const afterDocuments = logs.slice(submittedIds.length).map((entry) => entry.toolName);
  const expectedAfterDocuments = [
    "lookupPolicy",
    "checkMedicalNecessity",
    "calculateBenefit",
  ];
  if (afterDocuments.join(",") !== expectedAfterDocuments.join(",")) {
    errors.push(
      `Tool sequence after document verification was '${afterDocuments.join(",")}'.`,
    );
  }
}

function compareBenefitCalculation(
  report: AssessmentReport,
  expected: BenefitCalculationResult,
  errors: string[],
): void {
  const actual = report.benefitCalculation;
  if (!isRecord(actual)) {
    errors.push("Report benefitCalculation must be an object.");
    return;
  }

  const keys: Array<keyof BenefitCalculationResult> = [
    "submittedAmount",
    "eligibleAmount",
    "coveredAmount",
    "copay",
    "memberResponsibility",
    "remainingLimitBeforeClaim",
    "remainingLimitAfterClaim",
  ];

  for (const key of keys) {
    if (actual[key] !== expected[key]) {
      errors.push(`Benefit calculation field '${key}' does not match tool output.`);
    }
  }
}

function compareDocumentReview(
  report: AssessmentReport,
  verifiedDocuments: DocumentVerificationResult[],
  requiredDocuments: Array<{ documentType: string; status: string }>,
  errors: string[],
): void {
  if (!Array.isArray(report.documentReview)) {
    errors.push("Report documentReview must be an array.");
    return;
  }

  for (const expectedDocument of verifiedDocuments) {
    const actual = report.documentReview.find(
      (document) =>
        isRecord(document) && document.documentId === expectedDocument.documentId,
    );
    if (!actual) {
      errors.push(`Report is missing document review for ${expectedDocument.documentId}.`);
      continue;
    }
    if (actual.status !== expectedDocument.status) {
      errors.push(`Document ${expectedDocument.documentId} status does not match tool output.`);
    }
  }

  for (const requiredDocument of requiredDocuments) {
    if (requiredDocument.status !== "missing") {
      continue;
    }

    const actual = report.documentReview.find(
      (document) =>
        isRecord(document) &&
        document.expectedType === requiredDocument.documentType &&
        document.status === "missing",
    );
    if (!actual) {
      errors.push(`Report is missing required document row for ${requiredDocument.documentType}.`);
    }
  }
}

function validateCitations(
  report: AssessmentReport,
  clauses: PolicyClause[],
  errors: string[],
): void {
  if (!Array.isArray(report.policyCitations)) {
    errors.push("Report policyCitations must be an array.");
    return;
  }

  if (!Array.isArray(report.reasoning)) {
    errors.push("Report reasoning must be an array of objects.");
    return;
  }

  const knownClauseIds = new Set(clauses.map((clause) => clause.clauseId));
  const citedClauseIds = new Set<string>();

  if (report.policyCitations.length === 0) {
    errors.push("Report must include policy citations.");
  }

  for (const citation of report.policyCitations) {
    if (!isRecord(citation) || typeof citation.clauseId !== "string") {
      errors.push("Each policy citation must be an object with a string clauseId.");
      continue;
    }

    citedClauseIds.add(citation.clauseId);
    if (!knownClauseIds.has(citation.clauseId)) {
      errors.push(`Citation '${citation.clauseId}' was not returned by lookupPolicy.`);
    }
  }

  for (const item of report.reasoning) {
    if (!isRecord(item) || typeof item.text !== "string" || !Array.isArray(item.clauseIds)) {
      errors.push("Each reasoning item must be an object with text and clauseIds.");
      continue;
    }

    if (item.clauseIds.length === 0) {
      errors.push(`Reasoning item '${item.text}' must include at least one policy clause ID.`);
      continue;
    }

    for (const clauseId of item.clauseIds) {
      if (!citedClauseIds.has(clauseId)) {
        errors.push(`Reasoning item mentions clause '${clauseId}' which is not in policyCitations.`);
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSingleToolOutput<T>(
  logs: ToolCallLog[],
  toolName: ToolCallLog["toolName"],
  errors: string[],
): T | null {
  const matches = logs.filter((entry) => entry.toolName === toolName);
  if (matches.length !== 1) {
    errors.push(`Expected exactly one ${toolName} call but found ${matches.length}.`);
    return null;
  }
  return matches[0]?.output as T;
}
