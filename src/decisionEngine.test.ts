import { strict as assert } from "node:assert";
import { policies } from "./data.js";
import { evaluateDecision } from "./decisionEngine.js";
import { loadClaimCaseFile } from "./testCases.js";
import { ToolRuntime } from "./tools.js";
import type {
  BenefitCalculationResult,
  ClaimCase,
  DocumentVerificationResult,
  MedicalNecessityResult,
  Policy,
  PolicyLookupResult,
} from "./types.js";

async function main(): Promise<void> {
  await testApproval();
  await testRejectionByExclusion();
  await testRequestMoreInfoForDocuments();
  await testRequestMoreInfoForMissingRequiredDocument();
  await testRejectsDocumentsFromAnotherClaim();
  await testRejectWhenTreatmentEndsAfterCoverage();
  console.log("Decision engine unit tests passed.");
}

async function testApproval(): Promise<void> {
  const claimCase = await loadClaimCaseFile("test-cases/approval.json");
  const decision = evaluateDecision(buildDecisionInput(claimCase));

  assert.equal(decision.recommendation, "APPROVE");
  assert.ok(decision.requiredClauseIds.includes("POL-APP-001-ELIGIBILITY"));
  assert.ok(decision.requiredClauseIds.includes("POL-APP-001-BEN-INPATIENT"));
  assert.ok(decision.requiredClauseIds.includes("POL-APP-001-DOC-INPATIENT"));
  assert.ok(decision.requiredClauseIds.includes("POL-APP-001-WAIT-INPATIENT"));
}

async function testRejectionByExclusion(): Promise<void> {
  const claimCase = await loadClaimCaseFile("test-cases/rejection.json");
  const decision = evaluateDecision(buildDecisionInput(claimCase));

  assert.equal(decision.recommendation, "REJECT");
  assert.ok(decision.reasons.some((reason) => reason.code === "EXCLUSION_APPLIES"));
  assert.ok(decision.reasons.some((reason) => reason.code === "MEDICAL_NECESSITY_FAILED"));
  assert.ok(decision.reasons.some((reason) => reason.code === "NO_PAYABLE_BENEFIT"));
  assert.ok(decision.requiredClauseIds.includes("POL-REJ-001-EXC-COSMETIC"));
}

async function testRequestMoreInfoForDocuments(): Promise<void> {
  const claimCase = await loadClaimCaseFile("test-cases/request-more-info.json");
  const decision = evaluateDecision(buildDecisionInput(claimCase));

  assert.equal(decision.recommendation, "REQUEST_MORE_INFO");
  assert.deepEqual(decision.requiredClauseIds, ["POL-RMI-001-DOC-OUTPATIENT"]);
  assert.ok(decision.findings.requiredDocuments.some((document) => document.status === "incomplete"));
  assert.ok(decision.findings.requiredDocuments.some((document) => document.status === "mismatched"));
  assert.ok(decision.findings.requiredDocuments.some((document) => document.status === "missing"));
}

async function testRequestMoreInfoForMissingRequiredDocument(): Promise<void> {
  const claimCase = await loadClaimCaseFile("test-cases/request-more-info.json");
  const decision = evaluateDecision(buildDecisionInput(claimCase));

  assert.equal(decision.recommendation, "REQUEST_MORE_INFO");
  assert.ok(
    decision.findings.requiredDocuments.some(
      (document) =>
        document.documentType === "xray_report" && document.status === "missing",
    ),
  );
}

async function testRejectsDocumentsFromAnotherClaim(): Promise<void> {
  const baseCase = await loadClaimCaseFile("test-cases/approval.json");
  const claimCase: ClaimCase = {
    ...baseCase,
    caseId: "CASE-UNIT-WRONG-CLAIM-DOCS",
    expectedOutcome: "REQUEST_MORE_INFO",
    claim: {
      ...baseCase.claim,
      submittedDocumentIds: [
        "DOC-REJ-CLAIM-FORM",
        "DOC-REJ-ITEMIZED-BILL",
        "DOC-REJ-MEDICAL",
      ],
    },
  };
  const decision = evaluateDecision(buildDecisionInput(claimCase));

  assert.equal(decision.recommendation, "REQUEST_MORE_INFO");
  assert.ok(decision.findings.requiredDocuments.every((document) => document.status === "missing"));
}

async function testRejectWhenTreatmentEndsAfterCoverage(): Promise<void> {
  const baseCase = await loadClaimCaseFile("test-cases/approval.json");
  const claimCase: ClaimCase = {
    ...baseCase,
    caseId: "CASE-UNIT-END-AFTER-COVERAGE",
    expectedOutcome: "REJECT",
    claim: {
      ...baseCase.claim,
      treatmentStartDate: "2026-12-30",
      treatmentEndDate: "2027-01-02",
    },
  };
  const decision = evaluateDecision(buildDecisionInput(claimCase));

  assert.equal(decision.recommendation, "REJECT");
  assert.ok(decision.reasons.some((reason) => reason.code === "OUTSIDE_COVERAGE_PERIOD"));
  assert.equal(decision.findings.treatmentDatesWithinCoverage, false);
}

function buildDecisionInput(claimCase: ClaimCase): {
  claimCase: ClaimCase;
  policy: Policy;
  documentResults: DocumentVerificationResult[];
  medicalNecessity: MedicalNecessityResult;
  benefitCalculation: BenefitCalculationResult;
} {
  const tools = new ToolRuntime();
  const documentResults = claimCase.claim.submittedDocumentIds.map((documentId) =>
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
  const policy = policyLookup.policy ?? policies[0];

  return {
    claimCase,
    policy,
    documentResults,
    medicalNecessity,
    benefitCalculation,
  };
}

await main();
