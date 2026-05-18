import { evaluateDecision } from "./decisionEngine.js";
import type {
  AssessmentReport,
  BenefitCalculationResult,
  ClaimCase,
  DocumentType,
  DocumentVerificationResult,
  MedicalNecessityResult,
  Policy,
  PolicyClause,
  PolicyLookupResult,
} from "./types.js";

export function finalizeAssessmentReport(
  claimCase: ClaimCase,
  report: AssessmentReport,
): AssessmentReport {
  const policyLookup = report.toolCallLog.find((entry) => entry.toolName === "lookupPolicy")
    ?.output as PolicyLookupResult | undefined;
  const policy = policyLookup?.policy;
  const medicalNecessity = report.toolCallLog.find(
    (entry) => entry.toolName === "checkMedicalNecessity",
  )?.output as MedicalNecessityResult | undefined;
  const benefitCalculation = report.toolCallLog.find(
    (entry) => entry.toolName === "calculateBenefit",
  )?.output as BenefitCalculationResult | undefined;
  const documentReview = report.toolCallLog
    .filter((entry) => entry.toolName === "verifyDocument")
    .map((entry) => entry.output as DocumentVerificationResult);

  if (!policy || !medicalNecessity || !benefitCalculation) {
    return report;
  }

  const decision = evaluateDecision({
    claimCase,
    policy,
    documentResults: documentReview,
    medicalNecessity,
    benefitCalculation,
  });
  const policyCitations = getPolicyCitations(policy, decision.requiredClauseIds);
  const finalizedDocumentReview = appendMissingRequiredDocuments(
    claimCase,
    documentReview,
    decision.findings.requiredDocuments,
  );

  return {
    ...report,
    claimId: claimCase.claim.claimId,
    recommendation: decision.recommendation,
    documentReview: finalizedDocumentReview,
    medicalNecessity,
    benefitCalculation,
    reasoning: decision.reasons.map((reason) => {
      const clauseIds = reason.clauseIds.length > 0
        ? reason.clauseIds
        : decision.requiredClauseIds;
      return {
        text: reason.message,
        clauseIds,
      };
    }),
    policyCitations,
    policyVerification: {
      policyId: policy.policyId,
      policyNumber: policy.policyNumber,
      status: policy.status,
      memberCovered: decision.findings.memberCovered,
      treatmentDatesWithinCoverage: decision.findings.treatmentDatesWithinCoverage,
      waitingPeriodSatisfied: decision.findings.waitingPeriodSatisfied,
      claimTypeCovered: decision.findings.benefitFound,
      applicableExclusionIds: decision.findings.applicableExclusionIds,
    },
  };
}

function appendMissingRequiredDocuments(
  claimCase: ClaimCase,
  submittedReview: DocumentVerificationResult[],
  requiredDocuments: Array<{ documentType: string; status: string }>,
): DocumentVerificationResult[] {
  const reviewedRequiredTypes = new Set(
    submittedReview
      .filter((document) => document.claimId === claimCase.claim.claimId)
      .map((document) => document.expectedType),
  );
  const missingDocuments = requiredDocuments
    .filter(
      (document) =>
        document.status === "missing" &&
        !reviewedRequiredTypes.has(document.documentType as DocumentType),
    )
    .map((document): DocumentVerificationResult => ({
      documentId: `MISSING-${String(document.documentType).toUpperCase()}`,
      claimId: claimCase.claim.claimId,
      documentType: "unknown",
      expectedType: document.documentType as DocumentType,
      status: "missing",
      issues: [`Required document '${document.documentType}' was not submitted.`],
    }));

  return [...submittedReview, ...missingDocuments];
}

function getPolicyCitations(policy: Policy, clauseIds: string[]): PolicyClause[] {
  const byId = new Map(policy.clauses.map((clause) => [clause.clauseId, clause]));
  return [...new Set(clauseIds)].flatMap((clauseId) => {
    const clause = byId.get(clauseId);
    return clause ? [clause] : [];
  });
}
