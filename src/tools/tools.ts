import {
  medicalNecessityRules,
  policies,
  submittedDocuments,
} from "../infrastructure/data.js";
import type {
  BenefitCalculationResult,
  ClaimType,
  DocumentVerificationResult,
  MedicalNecessityResult,
  PolicyLookupResult,
  ToolCallLog,
} from "../domain/types.js";

export class ToolRuntime {
  private readonly logs: ToolCallLog[] = [];

  getToolCallLog(): ToolCallLog[] {
    return [...this.logs];
  }

  lookupPolicy(policyId: string): PolicyLookupResult {
    const output: PolicyLookupResult = {
      policy: policies.find((policy) => policy.policyId === policyId) ?? null,
    };
    this.log("lookupPolicy", { policyId }, output);
    return output;
  }

  calculateBenefit(
    policyId: string,
    claimType: ClaimType,
    amount: number,
  ): BenefitCalculationResult {
    const policy = policies.find((candidate) => candidate.policyId === policyId);
    const benefit = policy?.benefits.find(
      (candidate) => candidate.claimType === claimType,
    );

    if (!policy || !benefit) {
      const output: BenefitCalculationResult = {
        policyId,
        claimType,
        submittedAmount: amount,
        eligibleAmount: 0,
        coveredAmount: 0,
        copay: 0,
        memberResponsibility: amount,
        remainingLimitBeforeClaim: 0,
        remainingLimitAfterClaim: 0,
        clauseIds: [],
        issues: ["No matching policy benefit was found for this claim type."],
      };
      this.log("calculateBenefit", { policyId, claimType, amount }, output);
      return output;
    }

    const remainingLimitBeforeClaim = Math.max(
      benefit.annualLimit - benefit.usedAmount,
      0,
    );
    const eligibleAmount = Math.min(amount, remainingLimitBeforeClaim);
    const copay = roundCurrency(eligibleAmount * (benefit.copayPercent / 100));
    const coveredAmount = roundCurrency(eligibleAmount - copay);
    const memberResponsibility = roundCurrency(amount - coveredAmount);
    const remainingLimitAfterClaim = roundCurrency(
      remainingLimitBeforeClaim - eligibleAmount,
    );
    const issues =
      amount > remainingLimitBeforeClaim
        ? ["Submitted amount exceeds the remaining policy limit."]
        : [];

    const output: BenefitCalculationResult = {
      policyId,
      claimType,
      submittedAmount: amount,
      eligibleAmount,
      coveredAmount,
      copay,
      memberResponsibility,
      remainingLimitBeforeClaim,
      remainingLimitAfterClaim,
      clauseIds: [benefit.clauseId],
      issues,
    };
    this.log("calculateBenefit", { policyId, claimType, amount }, output);
    return output;
  }

  verifyDocument(documentId: string): DocumentVerificationResult {
    const document = submittedDocuments.find(
      (candidate) => candidate.documentId === documentId,
    );

    const output: DocumentVerificationResult = document
      ? {
          documentId: document.documentId,
          claimId: document.claimId,
          documentType: document.detectedType,
          expectedType: document.expectedType,
          status:
            document.status === "complete" &&
            document.detectedType !== document.expectedType
              ? "mismatched"
              : document.status,
          issues: document.issues,
        }
      : {
          documentId,
          claimId: undefined,
          documentType: "unknown",
          expectedType: "unknown",
          status: "missing",
          issues: ["Document id was not found in submitted document storage."],
        };

    this.log("verifyDocument", { documentId }, output);
    return output;
  }

  checkMedicalNecessity(
    diagnosis: string,
    procedures: string[],
  ): MedicalNecessityResult {
    const normalizedDiagnosis = diagnosis.toLowerCase();
    const normalizedProcedures = procedures
      .map((procedure) => procedure.toLowerCase())
      .join(" ");
    const matchingRule = medicalNecessityRules.find((rule) => {
      const diagnosisMatches = rule.diagnosisKeywords.some((keyword) =>
        normalizedDiagnosis.includes(keyword.toLowerCase()),
      );
      const procedureMatches = rule.procedureKeywords.some((keyword) =>
        normalizedProcedures.includes(keyword.toLowerCase()),
      );
      return diagnosisMatches && procedureMatches;
    });

    const output: MedicalNecessityResult = matchingRule
      ? {
          diagnosis,
          procedures,
          clinicallyAppropriate: matchingRule.clinicallyAppropriate,
          reason: matchingRule.reason,
          ruleId: matchingRule.ruleId,
        }
      : {
          diagnosis,
          procedures,
          clinicallyAppropriate: false,
          reason:
            "No medical necessity rule matched the submitted diagnosis and procedures.",
          ruleId: null,
        };

    this.log("checkMedicalNecessity", { diagnosis, procedures }, output);
    return output;
  }

  private log(
    toolName: ToolCallLog["toolName"],
    input: Record<string, unknown>,
    output: unknown,
  ): void {
    this.logs.push({
      toolName,
      input,
      output,
      timestamp: new Date().toISOString(),
    });
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
