import type {
  AssessmentReport,
  PolicyClause,
  PolicyLookupResult,
  ReasoningItem,
  ToolCallLog,
} from "./types.js";

export function normalizeAssessmentReport(report: AssessmentReport): AssessmentReport {
  const clauses = extractPolicyClauses(report.toolCallLog);
  const benefitClauseIds = extractBenefitClauseIds(report.toolCallLog);
  const normalized = report as unknown as Record<string, unknown>;
  const nested = unwrapReport(normalized);

  return {
    ...(nested as unknown as AssessmentReport),
    claimId: readString(nested.claimId),
    recommendation: readString(nested.recommendation) as AssessmentReport["recommendation"],
    documentReview: normalizeArrayField(nested, "documentReview", [
      "documents",
      "document_review",
      "Document Review",
    ]) as AssessmentReport["documentReview"],
    policyVerification: normalizeObjectField(nested, "policyVerification", [
      "policy_verification",
      "Policy Verification",
    ]),
    medicalNecessity: normalizeObjectField(nested, "medicalNecessity", [
      "medical_necessity",
      "Medical Necessity",
    ]) as unknown as AssessmentReport["medicalNecessity"],
    benefitCalculation: normalizeObjectField(nested, "benefitCalculation", [
      "benefit_calculation",
      "Benefit Calculation",
    ]) as unknown as AssessmentReport["benefitCalculation"],
    reasoning: normalizeReasoning(nested.reasoning, benefitClauseIds),
    policyCitations: normalizePolicyCitations(nested.policyCitations, clauses),
    toolCallLog: report.toolCallLog,
  };
}

function unwrapReport(value: Record<string, unknown>): Record<string, unknown> {
  for (const key of [
    "report",
    "assessmentReport",
    "assessment_report",
    "claimAssessmentReport",
    "claim_assessment_report",
  ]) {
    if (isRecord(value[key])) {
      return value[key];
    }
  }

  return value;
}

function extractPolicyClauses(logs: ToolCallLog[]): PolicyClause[] {
  const lookup = logs.find((entry) => entry.toolName === "lookupPolicy")
    ?.output as PolicyLookupResult | undefined;
  return lookup?.policy?.clauses ?? [];
}

function normalizeArrayField(
  source: Record<string, unknown>,
  preferredKey: string,
  alternateKeys: string[],
): unknown[] {
  const value = readField(source, preferredKey, alternateKeys);
  if (Array.isArray(value)) {
    return value;
  }

  return [];
}

function normalizeObjectField(
  source: Record<string, unknown>,
  preferredKey: string,
  alternateKeys: string[],
): Record<string, unknown> {
  const value = readField(source, preferredKey, alternateKeys);
  if (isRecord(value)) {
    return value;
  }

  return {};
}

function readField(
  source: Record<string, unknown>,
  preferredKey: string,
  alternateKeys: string[],
): unknown {
  if (source[preferredKey] !== undefined) {
    return source[preferredKey];
  }

  for (const key of alternateKeys) {
    if (source[key] !== undefined) {
      return source[key];
    }
  }

  return undefined;
}

function normalizeReasoning(value: unknown, benefitClauseIds: string[]): ReasoningItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): ReasoningItem => {
      if (typeof item === "string") {
        return {
          text: item,
          clauseIds: extractClauseIdsFromText(item),
        };
      }

      if (isRecord(item)) {
        const text = readString(item.text) || readString(item.reason) || "";
        let clauseIds: string[] = [];

        if (Array.isArray(item.clauseIds)) {
          clauseIds = item.clauseIds.filter((id): id is string => typeof id === "string");
        } else if (Array.isArray(item.citations)) {
          clauseIds = item.citations.filter((id): id is string => typeof id === "string");
        } else {
          clauseIds = extractClauseIdsFromText(text);
        }

        return { text, clauseIds };
      }

      return { text: "", clauseIds: [] };
    })
    .filter((item) => item.text.length > 0)
    .map((item) => addPolicyClauseToMedicalReason(item, benefitClauseIds));
}

function extractClauseIdsFromText(text: string): string[] {
  const matches = text.match(/\bPOL-[A-Z0-9-]+\b/g);
  return matches ? [...new Set(matches)] : [];
}

function addPolicyClauseToMedicalReason(
  item: ReasoningItem,
  benefitClauseIds: string[],
): ReasoningItem {
  const hasMedicalRule = /\bMED-[A-Z0-9-]+\b/.test(item.text);
  const hasPolicyClause = item.clauseIds.some(id => id.startsWith("POL-"));
  
  if (!hasMedicalRule || hasPolicyClause || benefitClauseIds.length === 0) {
    return item;
  }

  const benefitClauseId = benefitClauseIds[0];
  return {
    text: item.text.includes(benefitClauseId) ? item.text : `${item.text} (${benefitClauseId})`,
    clauseIds: [...new Set([...item.clauseIds, benefitClauseId])],
  };
}

function normalizePolicyCitations(
  value: unknown,
  clauses: PolicyClause[],
): PolicyClause[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byId = new Map(clauses.map((clause) => [clause.clauseId, clause]));
  return value.flatMap((item) => {
    if (typeof item === "string") {
      const clause = byId.get(item);
      return clause ? [clause] : [];
    }

    if (isRecord(item) && typeof item.clauseId === "string") {
      const clause = byId.get(item.clauseId);
      return clause ?? (item as unknown as PolicyClause);
    }

    return [];
  });
}

function extractBenefitClauseIds(logs: ToolCallLog[]): string[] {
  const benefit = logs.find((entry) => entry.toolName === "calculateBenefit")
    ?.output as { clauseIds?: unknown } | undefined;
  if (!Array.isArray(benefit?.clauseIds)) {
    return [];
  }

  return benefit.clauseIds.filter((clauseId): clauseId is string => typeof clauseId === "string");
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
