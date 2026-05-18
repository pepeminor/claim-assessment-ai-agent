import { assessClaimCase, repairAssessmentReport } from "./agent.js";
import { assertAssessmentReportShape } from "./contracts.js";
import { medicalNecessityRules, policies, submittedDocuments } from "./data.js";
import { evaluateDecision } from "./decisionEngine.js";
import { normalizeAssessmentReport } from "./normalizeReport.js";
import { finalizeAssessmentReport } from "./reportFinalizer.js";
import { ToolRuntime } from "./tools.js";
import type {
  AssessmentReport,
  BenefitCalculationResult,
  ClaimCase,
  DocumentVerificationResult,
  MedicalNecessityResult,
  Policy,
  PolicyLookupResult,
  ToolCallLog,
} from "./types.js";
import { validateAssessmentReport } from "./validation.js";

export interface DeterministicAssessmentResult {
  claimCase: ClaimCase;
  policy: Policy | null;
  documentReview: DocumentVerificationResult[];
  medicalNecessity: MedicalNecessityResult;
  benefitCalculation: BenefitCalculationResult;
  decision: ReturnType<typeof evaluateDecision> | null;
  toolCallLog: ToolCallLog[];
}

export async function runLlmAssessment(claimCase: ClaimCase): Promise<AssessmentReport> {
  const result = await assessClaimCase(claimCase);
  let report = finalizeAssessmentReport(claimCase, normalizeAssessmentReport(result.report));
  assertAssessmentReportShape(report, `${claimCase.caseId} report`);
  let validation = validateAssessmentReport(claimCase, report);

  if (!validation.ok && canAttemptRepair(validation.errors)) {
    report = finalizeAssessmentReport(
      claimCase,
      normalizeAssessmentReport(
        await repairAssessmentReport(claimCase, report, validation.errors),
      ),
    );
    assertAssessmentReportShape(report, `${claimCase.caseId} repaired report`);
    validation = validateAssessmentReport(claimCase, report);
  }

  if (!validation.ok) {
    throw new Error(
      `Validation failed for ${claimCase.caseId}:\n- ${validation.errors.join("\n- ")}`,
    );
  }

  return report;
}

export function runDeterministicAssessment(
  claimCase: ClaimCase,
): DeterministicAssessmentResult {
  const tools = new ToolRuntime();
  const documentReview = claimCase.claim.submittedDocumentIds.map((documentId) =>
    tools.verifyDocument(documentId),
  );
  const policyLookup = tools.lookupPolicy(claimCase.claim.policyId) as PolicyLookupResult;
  const medicalNecessity = tools.checkMedicalNecessity(
    claimCase.claim.diagnosis,
    claimCase.claim.procedures,
  );
  const benefitCalculation = tools.calculateBenefit(
    claimCase.claim.policyId,
    claimCase.claim.claimType,
    claimCase.claim.amount,
  );
  const policy = policyLookup.policy;

  return {
    claimCase,
    policy,
    documentReview,
    medicalNecessity,
    benefitCalculation,
    decision: policy
      ? evaluateDecision({
          claimCase,
          policy,
          documentResults: documentReview,
          medicalNecessity,
          benefitCalculation,
        })
      : null,
    toolCallLog: tools.getToolCallLog(),
  };
}

export function getUiData(): {
  policies: Policy[];
  submittedDocuments: typeof submittedDocuments;
  medicalNecessityRules: typeof medicalNecessityRules;
} {
  return {
    policies,
    submittedDocuments,
    medicalNecessityRules,
  };
}

export function canAttemptRepair(errors: string[]): boolean {
  return errors.every(
    (error) =>
      !error.startsWith("Expected ") &&
      !error.includes("tool calls") &&
      !error.includes("Tool sequence") &&
      !error.includes("was not verified") &&
      !error.includes("lookupPolicy did not return a policy"),
  );
}
