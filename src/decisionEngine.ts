import type {
  BenefitCalculationResult,
  ClaimCase,
  DocumentVerificationResult,
  MedicalNecessityResult,
  Policy,
  PolicyClause,
  Recommendation,
} from "./types.js";

export type DecisionReasonCode =
  | "DOCUMENT_ISSUE"
  | "POLICY_INACTIVE"
  | "MEMBER_NOT_COVERED"
  | "OUTSIDE_COVERAGE_PERIOD"
  | "CLAIM_TYPE_NOT_COVERED"
  | "EXCLUSION_APPLIES"
  | "WAITING_PERIOD_NOT_MET"
  | "MEDICAL_NECESSITY_FAILED"
  | "NO_PAYABLE_BENEFIT"
  | "APPROVAL_READY";

export interface DecisionReason {
  code: DecisionReasonCode;
  message: string;
  clauseIds: string[];
}

export interface DecisionResult {
  recommendation: Recommendation;
  reasons: DecisionReason[];
  requiredClauseIds: string[];
  findings: {
    requiredDocuments: Array<{
      documentType: string;
      status: "complete" | "missing" | "incomplete" | "mismatched";
      clauseId: string;
    }>;
    applicableExclusionIds: string[];
    treatmentDatesWithinCoverage: boolean;
    waitingPeriodSatisfied: boolean;
    memberCovered: boolean;
    policyActive: boolean;
    benefitFound: boolean;
  };
}

export interface DecisionInput {
  claimCase: ClaimCase;
  policy: Policy;
  documentResults: DocumentVerificationResult[];
  medicalNecessity: MedicalNecessityResult;
  benefitCalculation: BenefitCalculationResult;
}

export function evaluateDecision(input: DecisionInput): DecisionResult {
  const { claimCase, policy, documentResults, medicalNecessity, benefitCalculation } = input;
  const claim = claimCase.claim;
  const benefit = policy.benefits.find((candidate) => candidate.claimType === claim.claimType);
  const waitingPeriod = policy.waitingPeriods.find(
    (period) => period.claimType === claim.claimType,
  );
  const requiredDocs = policy.requiredDocuments.filter(
    (document) => document.claimType === claim.claimType,
  );
  const documentFindings = requiredDocs.map((requiredDocument) => {
    const matchingDocument = documentResults.find(
      (document) =>
        document.expectedType === requiredDocument.documentType &&
        document.claimId === claim.claimId,
    );
    return {
      documentType: requiredDocument.documentType,
      status: matchingDocument
        ? matchingDocument.documentType === requiredDocument.documentType
          ? matchingDocument.status
          : "mismatched"
        : "missing",
      clauseId: requiredDocument.clauseId,
    };
  });
  const documentIssues = documentFindings.filter((document) => document.status !== "complete");
  const applicableExclusions = getApplicableExclusions(claimCase, policy);
  const policyActive = policy.status === "active";
  const memberCovered = policy.memberIds.includes(claim.memberId);
  const treatmentDatesWithinCoverage = areTreatmentDatesWithinCoverage(claimCase, policy);
  const waitingPeriodSatisfied = isWaitingPeriodSatisfied(claimCase, policy, waitingPeriod);
  const reasons: DecisionReason[] = [];

  if (documentIssues.length > 0) {
    reasons.push({
      code: "DOCUMENT_ISSUE",
      message: "One or more required documents are missing, incomplete, or mismatched.",
      clauseIds: unique(documentIssues.map((document) => document.clauseId)),
    });
    return buildResult("REQUEST_MORE_INFO", reasons, input, {
      requiredDocuments: documentFindings,
      applicableExclusionIds: applicableExclusions.map((exclusion) => exclusion.exclusionId),
      treatmentDatesWithinCoverage,
      waitingPeriodSatisfied,
      memberCovered,
      policyActive,
      benefitFound: Boolean(benefit),
    });
  }

  if (!policyActive) {
    reasons.push({
      code: "POLICY_INACTIVE",
      message: "The policy is not active.",
      clauseIds: optionalClauseId(findClauseByRole(policy, "eligibility")),
    });
  }

  if (!memberCovered) {
    reasons.push({
      code: "MEMBER_NOT_COVERED",
      message: "The member is not covered by this policy.",
      clauseIds: optionalClauseId(findClauseByRole(policy, "eligibility")),
    });
  }

  if (!treatmentDatesWithinCoverage) {
    reasons.push({
      code: "OUTSIDE_COVERAGE_PERIOD",
      message: "The treatment dates are outside the policy coverage period.",
      clauseIds: optionalClauseId(findClauseByRole(policy, "eligibility")),
    });
  }

  if (!benefit) {
    reasons.push({
      code: "CLAIM_TYPE_NOT_COVERED",
      message: "The policy does not include a benefit for this claim type.",
      clauseIds: optionalClauseId(findClauseByRole(policy, "benefit")),
    });
  }

  if (!waitingPeriodSatisfied) {
    reasons.push({
      code: "WAITING_PERIOD_NOT_MET",
      message: "The claim was incurred before the waiting period was satisfied.",
      clauseIds: waitingPeriod ? [waitingPeriod.clauseId] : optionalClauseId(findClauseByRole(policy, "waiting_period")),
    });
  }

  if (applicableExclusions.length > 0) {
    reasons.push({
      code: "EXCLUSION_APPLIES",
      message: "A policy exclusion applies to this claim.",
      clauseIds: unique(applicableExclusions.map((exclusion) => exclusion.clauseId)),
    });
  }

  if (!medicalNecessity.clinicallyAppropriate) {
    reasons.push({
      code: "MEDICAL_NECESSITY_FAILED",
      message: "The treatment is not clinically appropriate for the diagnosis.",
      clauseIds: benefit ? [benefit.clauseId] : optionalClauseId(findClauseByRole(policy, "benefit")),
    });
  }

  if (benefitCalculation.coveredAmount <= 0) {
    reasons.push({
      code: "NO_PAYABLE_BENEFIT",
      message: "The calculated covered amount is zero.",
      clauseIds: benefit ? [benefit.clauseId] : optionalClauseId(findClauseByRole(policy, "benefit")),
    });
  }

  if (reasons.length > 0) {
    return buildResult("REJECT", reasons, input, {
      requiredDocuments: documentFindings,
      applicableExclusionIds: applicableExclusions.map((exclusion) => exclusion.exclusionId),
      treatmentDatesWithinCoverage,
      waitingPeriodSatisfied,
      memberCovered,
      policyActive,
      benefitFound: Boolean(benefit),
    });
  }

  const approvalReasons: DecisionReason[] = [
    {
      code: "APPROVAL_READY",
      message: "All required assessment checks passed.",
      clauseIds: getApprovalClauseIds(policy, requiredDocs, benefit, waitingPeriod),
    },
  ];

  return buildResult("APPROVE", approvalReasons, input, {
    requiredDocuments: documentFindings,
    applicableExclusionIds: [],
    treatmentDatesWithinCoverage,
    waitingPeriodSatisfied,
    memberCovered,
    policyActive,
    benefitFound: Boolean(benefit),
  });
}

export function getApplicableExclusions(claimCase: ClaimCase, policy: Policy): Policy["exclusions"] {
  const diagnosis = claimCase.claim.diagnosis.toLowerCase();
  const procedures = claimCase.claim.procedures.join(" ").toLowerCase();

  return policy.exclusions.filter((exclusion) => {
    const claimTypeMatches = exclusion.claimTypes.includes(claimCase.claim.claimType);
    const diagnosisMatches = exclusion.diagnosisKeywords.some((keyword) =>
      diagnosis.includes(keyword.toLowerCase()),
    );
    const procedureMatches = exclusion.procedureKeywords.some((keyword) =>
      procedures.includes(keyword.toLowerCase()),
    );
    return claimTypeMatches || diagnosisMatches || procedureMatches;
  });
}

export function findClauseByRole(
  policy: Policy,
  role: NonNullable<PolicyClause["role"]>,
): PolicyClause | undefined {
  return policy.clauses.find((clause) => clause.role === role);
}

function buildResult(
  recommendation: Recommendation,
  reasons: DecisionReason[],
  _input: DecisionInput,
  findings: DecisionResult["findings"],
): DecisionResult {
  return {
    recommendation,
    reasons,
    requiredClauseIds: unique(reasons.flatMap((reason) => reason.clauseIds)),
    findings,
  };
}

function getApprovalClauseIds(
  policy: Policy,
  requiredDocs: Policy["requiredDocuments"],
  benefit: Policy["benefits"][number] | undefined,
  waitingPeriod: Policy["waitingPeriods"][number] | undefined,
): string[] {
  return unique([
    ...optionalClauseId(findClauseByRole(policy, "eligibility")),
    ...(benefit ? [benefit.clauseId] : []),
    ...(waitingPeriod ? [waitingPeriod.clauseId] : []),
    ...requiredDocs.map((document) => document.clauseId),
  ]);
}

function areTreatmentDatesWithinCoverage(claimCase: ClaimCase, policy: Policy): boolean {
  const claimStart = new Date(claimCase.claim.treatmentStartDate).getTime();
  const claimEnd = new Date(claimCase.claim.treatmentEndDate).getTime();
  const coverageStart = new Date(policy.coverageStartDate).getTime();
  const coverageEnd = new Date(policy.coverageEndDate).getTime();

  return (
    claimStart >= coverageStart &&
    claimStart <= coverageEnd &&
    claimEnd >= coverageStart &&
    claimEnd <= coverageEnd &&
    claimEnd >= claimStart
  );
}

function isWaitingPeriodSatisfied(
  claimCase: ClaimCase,
  policy: Policy,
  waitingPeriod: Policy["waitingPeriods"][number] | undefined,
): boolean {
  if (!waitingPeriod) {
    return true;
  }

  const claimStart = new Date(claimCase.claim.treatmentStartDate).getTime();
  const effectiveDate = new Date(policy.effectiveDate).getTime();
  const daysSinceEffective = Math.floor(
    (claimStart - effectiveDate) / (24 * 60 * 60 * 1000),
  );
  return daysSinceEffective >= waitingPeriod.days;
}

function optionalClauseId(clause: PolicyClause | undefined): string[] {
  return clause ? [clause.clauseId] : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
