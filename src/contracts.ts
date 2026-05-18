import type {
  AssessmentReport,
  ClaimCase,
  MedicalNecessityRule,
  Policy,
  SubmittedDocument,
} from "./types.js";

export function assertAssessmentReportShape(
  value: unknown,
  label = "assessment report",
): asserts value is AssessmentReport {
  const report = expectRecord(value, label);
  expectString(report.claimId, `${label}.claimId`);
  expectRecommendation(report.recommendation, `${label}.recommendation`);
  expectArray(report.documentReview, `${label}.documentReview`);
  expectRecord(report.policyVerification, `${label}.policyVerification`);
  expectRecord(report.medicalNecessity, `${label}.medicalNecessity`);
  expectRecord(report.benefitCalculation, `${label}.benefitCalculation`);
  const reasoning = expectArray(report.reasoning, `${label}.reasoning`);
  for (const [index, itemValue] of reasoning.entries()) {
    const itemLabel = `${label}.reasoning[${index}]`;
    const item = expectRecord(itemValue, itemLabel);
    expectString(item.text, `${itemLabel}.text`);
    expectStringArray(item.clauseIds, `${itemLabel}.clauseIds`);
  }
  expectArray(report.policyCitations, `${label}.policyCitations`);
  expectArray(report.toolCallLog, `${label}.toolCallLog`);
}

export function assertClaimCase(value: unknown, label = "claim case"): asserts value is ClaimCase {
  const object = expectRecord(value, label);
  expectString(object.caseId, `${label}.caseId`);
  if (object.expectedOutcome !== undefined) {
    expectRecommendation(object.expectedOutcome, `${label}.expectedOutcome`);
  }
  const claim = expectRecord(object.claim, `${label}.claim`);

  expectString(claim.claimId, `${label}.claim.claimId`);
  expectString(claim.policyId, `${label}.claim.policyId`);
  expectString(claim.memberId, `${label}.claim.memberId`);
  expectString(claim.claimType, `${label}.claim.claimType`);
  expectNumber(claim.amount, `${label}.claim.amount`);
  expectEqual(claim.currency, "USD", `${label}.claim.currency`);
  expectString(claim.diagnosis, `${label}.claim.diagnosis`);
  expectStringArray(claim.procedures, `${label}.claim.procedures`);
  expectIsoDateString(claim.treatmentStartDate, `${label}.claim.treatmentStartDate`);
  expectIsoDateString(claim.treatmentEndDate, `${label}.claim.treatmentEndDate`);
  expectStringArray(claim.submittedDocumentIds, `${label}.claim.submittedDocumentIds`);
}

export function assertPolicyData(policies: unknown): asserts policies is Policy[] {
  if (!Array.isArray(policies)) {
    throw new Error("policies must be an array.");
  }

  for (const [index, policyValue] of policies.entries()) {
    const label = `policies[${index}]`;
    const policy = expectRecord(policyValue, label);
    expectString(policy.policyId, `${label}.policyId`);
    expectString(policy.policyNumber, `${label}.policyNumber`);
    expectStringArray(policy.memberIds, `${label}.memberIds`);
    expectOneOf(policy.status, ["active", "inactive"], `${label}.status`);
    expectIsoDateString(policy.coverageStartDate, `${label}.coverageStartDate`);
    expectIsoDateString(policy.coverageEndDate, `${label}.coverageEndDate`);
    expectIsoDateString(policy.effectiveDate, `${label}.effectiveDate`);

    const benefits = expectArray(policy.benefits, `${label}.benefits`);
    const exclusions = expectArray(policy.exclusions, `${label}.exclusions`);
    const waitingPeriods = expectArray(policy.waitingPeriods, `${label}.waitingPeriods`);
    const requiredDocuments = expectArray(policy.requiredDocuments, `${label}.requiredDocuments`);
    const clauses = expectArray(policy.clauses, `${label}.clauses`);
    const clauseIds = new Set<string>();

    for (const [clauseIndex, clauseValue] of clauses.entries()) {
      const clauseLabel = `${label}.clauses[${clauseIndex}]`;
      const clause = expectRecord(clauseValue, clauseLabel);
      const clauseId = expectString(clause.clauseId, `${clauseLabel}.clauseId`);
      expectString(clause.title, `${clauseLabel}.title`);
      expectString(clause.text, `${clauseLabel}.text`);
      if (clause.role !== undefined) {
        expectOneOf(
          clause.role,
          ["eligibility", "benefit", "waiting_period", "required_document", "exclusion", "general"],
          `${clauseLabel}.role`,
        );
      }
      clauseIds.add(clauseId);
    }

    requireClauseRole(policyValue, "eligibility", label);

    for (const [benefitIndex, benefitValue] of benefits.entries()) {
      const benefitLabel = `${label}.benefits[${benefitIndex}]`;
      const benefit = expectRecord(benefitValue, benefitLabel);
      expectString(benefit.claimType, `${benefitLabel}.claimType`);
      expectNumber(benefit.annualLimit, `${benefitLabel}.annualLimit`);
      expectNumber(benefit.usedAmount, `${benefitLabel}.usedAmount`);
      expectNumber(benefit.copayPercent, `${benefitLabel}.copayPercent`);
      requireKnownClause(expectString(benefit.clauseId, `${benefitLabel}.clauseId`), clauseIds, benefitLabel);
    }

    for (const [exclusionIndex, exclusionValue] of exclusions.entries()) {
      const exclusionLabel = `${label}.exclusions[${exclusionIndex}]`;
      const exclusion = expectRecord(exclusionValue, exclusionLabel);
      expectString(exclusion.exclusionId, `${exclusionLabel}.exclusionId`);
      expectStringArray(exclusion.claimTypes, `${exclusionLabel}.claimTypes`);
      expectStringArray(exclusion.diagnosisKeywords, `${exclusionLabel}.diagnosisKeywords`);
      expectStringArray(exclusion.procedureKeywords, `${exclusionLabel}.procedureKeywords`);
      requireKnownClause(expectString(exclusion.clauseId, `${exclusionLabel}.clauseId`), clauseIds, exclusionLabel);
    }

    for (const [periodIndex, periodValue] of waitingPeriods.entries()) {
      const periodLabel = `${label}.waitingPeriods[${periodIndex}]`;
      const period = expectRecord(periodValue, periodLabel);
      expectString(period.claimType, `${periodLabel}.claimType`);
      expectNumber(period.days, `${periodLabel}.days`);
      requireKnownClause(expectString(period.clauseId, `${periodLabel}.clauseId`), clauseIds, periodLabel);
    }

    for (const [documentIndex, documentValue] of requiredDocuments.entries()) {
      const documentLabel = `${label}.requiredDocuments[${documentIndex}]`;
      const document = expectRecord(documentValue, documentLabel);
      expectString(document.claimType, `${documentLabel}.claimType`);
      expectString(document.documentType, `${documentLabel}.documentType`);
      requireKnownClause(expectString(document.clauseId, `${documentLabel}.clauseId`), clauseIds, documentLabel);
    }
  }
}

export function assertSubmittedDocuments(value: unknown): asserts value is SubmittedDocument[] {
  if (!Array.isArray(value)) {
    throw new Error("submittedDocuments must be an array.");
  }

  for (const [index, documentValue] of value.entries()) {
    const label = `submittedDocuments[${index}]`;
    const document = expectRecord(documentValue, label);
    expectString(document.documentId, `${label}.documentId`);
    expectString(document.claimId, `${label}.claimId`);
    expectString(document.expectedType, `${label}.expectedType`);
    expectString(document.detectedType, `${label}.detectedType`);
    expectOneOf(document.status, ["complete", "incomplete", "missing", "mismatched"], `${label}.status`);
    expectStringArray(document.issues, `${label}.issues`);
  }
}

export function assertMedicalNecessityRules(value: unknown): asserts value is MedicalNecessityRule[] {
  if (!Array.isArray(value)) {
    throw new Error("medicalNecessityRules must be an array.");
  }

  for (const [index, ruleValue] of value.entries()) {
    const label = `medicalNecessityRules[${index}]`;
    const rule = expectRecord(ruleValue, label);
    expectString(rule.ruleId, `${label}.ruleId`);
    expectStringArray(rule.diagnosisKeywords, `${label}.diagnosisKeywords`);
    expectStringArray(rule.procedureKeywords, `${label}.procedureKeywords`);
    expectBoolean(rule.clinicallyAppropriate, `${label}.clinicallyAppropriate`);
    expectString(rule.reason, `${label}.reason`);
  }
}

function requireClauseRole(policyValue: unknown, role: string, label: string): void {
  const policy = policyValue as Policy;
  if (!policy.clauses.some((clause) => clause.role === role)) {
    throw new Error(`${label} must include a policy clause with role '${role}'.`);
  }
}

function requireKnownClause(clauseId: string, clauseIds: Set<string>, label: string): void {
  if (!clauseIds.has(clauseId)) {
    throw new Error(`${label} references unknown clauseId '${clauseId}'.`);
  }
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value;
}

function expectRecommendation(value: unknown, label: string): void {
  expectOneOf(value, ["APPROVE", "REJECT", "REQUEST_MORE_INFO"], label);
}

function expectOneOf(value: unknown, allowed: string[], label: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }
}

function expectEqual(value: unknown, expected: string, label: string): void {
  if (value !== expected) {
    throw new Error(`${label} must be '${expected}'.`);
  }
}

function expectIsoDateString(value: unknown, label: string): void {
  const text = expectString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(text).getTime())) {
    throw new Error(`${label} must be a YYYY-MM-DD date string.`);
  }
}
