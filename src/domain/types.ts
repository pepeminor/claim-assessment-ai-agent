export type Recommendation = "APPROVE" | "REJECT" | "REQUEST_MORE_INFO";

export type ClaimType =
  | "inpatient_hospitalization"
  | "cosmetic_surgery"
  | "outpatient_specialist"
  | (string & {});

export type DocumentType =
  | "unknown"
  | "claim_form"
  | "itemized_bill"
  | "discharge_summary"
  | "medical_report"
  | "invoice"
  | "referral_letter"
  | "receipt"
  | (string & {});

export type DocumentStatus = "complete" | "incomplete" | "missing" | "mismatched";

export interface ClaimCase {
  caseId: string;
  expectedOutcome?: Recommendation;
  claim: Claim;
}

export interface Claim {
  claimId: string;
  policyId: string;
  memberId: string;
  claimType: ClaimType;
  amount: number;
  currency: "USD";
  diagnosis: string;
  procedures: string[];
  treatmentStartDate: string;
  treatmentEndDate: string;
  submittedDocumentIds: string[];
}

export interface PolicyClause {
  clauseId: string;
  title: string;
  text: string;
  role?: "eligibility" | "benefit" | "waiting_period" | "required_document" | "exclusion" | "general";
}

export interface Benefit {
  claimType: ClaimType;
  annualLimit: number;
  usedAmount: number;
  copayPercent: number;
  clauseId: string;
}

export interface Exclusion {
  exclusionId: string;
  claimTypes: ClaimType[];
  diagnosisKeywords: string[];
  procedureKeywords: string[];
  clauseId: string;
}

export interface WaitingPeriod {
  claimType: ClaimType;
  days: number;
  clauseId: string;
}

export interface RequiredDocument {
  claimType: ClaimType;
  documentType: DocumentType;
  clauseId: string;
}

export interface Policy {
  policyId: string;
  policyNumber: string;
  memberIds: string[];
  status: "active" | "inactive";
  coverageStartDate: string;
  coverageEndDate: string;
  effectiveDate: string;
  benefits: Benefit[];
  exclusions: Exclusion[];
  waitingPeriods: WaitingPeriod[];
  requiredDocuments: RequiredDocument[];
  clauses: PolicyClause[];
}

export interface SubmittedDocument {
  documentId: string;
  claimId: string;
  expectedType: DocumentType;
  detectedType: DocumentType;
  status: DocumentStatus;
  issues: string[];
}

export interface MedicalNecessityRule {
  ruleId: string;
  diagnosisKeywords: string[];
  procedureKeywords: string[];
  clinicallyAppropriate: boolean;
  reason: string;
}

export interface ToolCallLog {
  toolName:
    | "verifyDocument"
    | "lookupPolicy"
    | "checkMedicalNecessity"
    | "calculateBenefit";
  input: Record<string, unknown>;
  output: unknown;
  timestamp: string;
}

export interface PolicyLookupResult {
  policy: Policy | null;
}

export interface BenefitCalculationResult {
  policyId: string;
  claimType: ClaimType;
  submittedAmount: number;
  eligibleAmount: number;
  coveredAmount: number;
  copay: number;
  memberResponsibility: number;
  remainingLimitBeforeClaim: number;
  remainingLimitAfterClaim: number;
  clauseIds: string[];
  issues: string[];
}

export interface DocumentVerificationResult {
  documentId: string;
  claimId?: string;
  documentType: DocumentType;
  expectedType: DocumentType;
  status: DocumentStatus;
  issues: string[];
}

export interface MedicalNecessityResult {
  diagnosis: string;
  procedures: string[];
  clinicallyAppropriate: boolean;
  reason: string;
  ruleId: string | null;
}

export interface ReasoningItem {
  text: string;
  clauseIds: string[];
}

export interface AssessmentReport {
  claimId: string;
  recommendation: Recommendation;
  documentReview: DocumentVerificationResult[];
  policyVerification: Record<string, unknown>;
  medicalNecessity: MedicalNecessityResult;
  benefitCalculation: BenefitCalculationResult;
  reasoning: ReasoningItem[];
  policyCitations: PolicyClause[];
  toolCallLog: ToolCallLog[];
}
