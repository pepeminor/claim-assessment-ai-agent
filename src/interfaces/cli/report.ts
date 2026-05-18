import type { ClaimCase } from "../../domain/types.js";

export function reportFileNameForCase(claimCase: ClaimCase): string {
  if (claimCase.caseId.startsWith("CASE-MANUAL")) {
    return `${claimCase.caseId}.report.json`;
  }

  if (claimCase.expectedOutcome === "APPROVE") {
    return "approval-report.json";
  }

  if (claimCase.expectedOutcome === "REJECT") {
    return "rejection-report.json";
  }

  return "request-more-info-report.json";
}
