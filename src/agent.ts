import { LlmClient } from "./llmClient.js";
import type { ChatMessage, ChatTool, ChatToolCall } from "./llmClient.js";
import { ToolRuntime } from "./tools.js";
import type {
  AssessmentReport,
  BenefitCalculationResult,
  ClaimCase,
  ClaimType,
  DocumentVerificationResult,
  MedicalNecessityResult,
  PolicyLookupResult,
} from "./types.js";

type DraftAssessmentReport = Omit<AssessmentReport, "toolCallLog">;

export interface AgentRunResult {
  report: AssessmentReport;
}

const systemPrompt = [
  "You are a claim assessment assistant.",
  "Assess claims only from provided claim data and tool outputs.",
  "Do not invent policy terms, exclusions, limits, waiting periods, copays, or clause citations.",
  "Call tools in this exact sequence: verifyDocument for every submitted document, lookupPolicy, checkMedicalNecessity, calculateBenefit.",
  "Do not skip submitted documents.",
  "After all tools return, produce only a JSON object matching the requested report shape.",
  "If any required document is missing, incomplete, unreadable, or mismatched, recommend REQUEST_MORE_INFO rather than REJECT.",
  "If policy coverage, exclusions, waiting periods, medical necessity, or benefit availability fail, recommend REJECT with exact policy citations.",
  "Approve only when all checks pass and the calculated covered amount is within policy limits.",
  "Every reasoning item must include at least one specific policy clause id from lookupPolicy.",
  "Medical necessity rule ids such as MED-* may be mentioned, but they are not policy citations. If a medical necessity point appears in reasoning, it must also cite the relevant policy benefit clause id.",
  "For approvals, focus reasoning on positive eligibility, document, waiting period, and benefit clauses. Put 'no exclusions apply' in policyVerification, not as a standalone recommendation reason unless an exclusion clause directly affects the decision.",
  "If tool outputs do not support a statement, do not include that statement.",
].join(" ");

const finalReportInstruction = JSON.stringify({
  task: "All required tools have returned. Produce the final assessment report now.",
  outputRules: [
    "Return one JSON object only.",
    "Do not wrap the report in another key such as report or assessmentReport.",
    "Use exactly these top-level keys: claimId, recommendation, documentReview, policyVerification, medicalNecessity, benefitCalculation, reasoning, policyCitations.",
    "claimId must be the claim id string.",
    "recommendation must be APPROVE, REJECT, or REQUEST_MORE_INFO.",
    "documentReview must be an array copied from verifyDocument tool outputs.",
    "medicalNecessity must be copied from checkMedicalNecessity tool output.",
    "benefitCalculation must be copied from calculateBenefit tool output.",
    "reasoning must be an array of objects containing 'text' and 'clauseIds'.",
    "Each reasoning object must include at least one clauseId in its 'clauseIds' array that also appears in policyCitations.",
    "If a reasoning point mentions a MED-* rule id, its 'clauseIds' must include the relevant POL-* benefit clause id.",
    "policyCitations must be an array of exact clause objects returned by lookupPolicy.",
  ],
});

export async function assessClaimCase(
  claimCase: ClaimCase,
  client = new LlmClient(),
): Promise<AgentRunResult> {
  const mode = process.env.LLM_REPORT_MODE ?? "agentic";
  console.log(`\n\x1b[36m[Agent]\x1b[0m \x1b[1mMode: ${mode.toUpperCase()}\x1b[0m (Strategic tool-calling loop)`);
  
  if (mode === "single") {
    return assessClaimCaseSingleCall(claimCase, client);
  }

  const tools = new ToolRuntime();
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Assess this claim and produce the required structured report.",
        requiredReportShape: {
          claimId: "string",
          recommendation: "APPROVE | REJECT | REQUEST_MORE_INFO",
          documentReview: "array of exact verifyDocument results",
          policyVerification:
            "object with policy status, member coverage, date coverage, claim type coverage, waiting period, exclusions",
          medicalNecessity: "exact checkMedicalNecessity result",
          benefitCalculation: "exact calculateBenefit result",
          reasoning:
            "array of objects with { text: string, clauseIds: string[] }; each item must be a specific assessor reason and its clauseIds must contain at least one policy clause id",
          policyCitations:
            "array of exact policy clause objects from lookupPolicy that support the reasoning",
        },
        claimCase,
      }),
    },
  ];

  let stepCount = 1;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const response = await client.createChatCompletion({
      messages,
      tools: chatTools,
      requireJson: true,
    });

    messages.push(response.message);

    const toolCalls = response.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      const draftReport = parseDraftReport(response.message.content);
      return {
        report: {
          ...draftReport,
          toolCallLog: tools.getToolCallLog(),
        },
      };
    }

    for (const call of toolCalls) {
      console.log(`\x1b[33m[Step ${stepCount++}]\x1b[0m \x1b[1mCalling Tool:\x1b[0m \x1b[32m${call.function.name}\x1b[0m`);
      const args = JSON.parse(call.function.arguments);
      console.log(`         \x1b[90m>\x1b[0m Args: ${Object.entries(args).map(([k, v]) => `${k}=${v}`).join(", ")}`);
      
      const output = executeToolCall(tools, call);
      
      let readableResult = "";
      if (call.function.name === "verifyDocument") {
        const res = output as DocumentVerificationResult;
        readableResult = `Status: ${res.status.toUpperCase()}, Type: ${res.documentType}`;
      } else if (call.function.name === "lookupPolicy") {
        const res = output as PolicyLookupResult;
        readableResult = `Policy: ${res.policy?.policyNumber ?? "Not Found"} (${res.policy?.status ?? "N/A"})`;
      } else if (call.function.name === "checkMedicalNecessity") {
        const res = output as MedicalNecessityResult;
        readableResult = `Appropriate: ${res.clinicallyAppropriate ? "YES" : "NO"}`;
      } else if (call.function.name === "calculateBenefit") {
        const res = output as BenefitCalculationResult;
        readableResult = `Covered: ${res.coveredAmount}, Copay: ${res.copay}`;
      } else {
        readableResult = JSON.stringify(output).slice(0, 100);
      }
      
      console.log(`         \x1b[90m<\x1b[0m Result: \x1b[1m${readableResult}\x1b[0m`);
      
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(output),
      });
    }

    if (hasRequiredToolCallSequence(claimCase, tools.getToolCallLog())) {
      console.log(`\x1b[36m[Agent]\x1b[0m Sequence validated. \x1b[1mSynthesizing final assessment report...\x1b[0m`);
      messages.push({
        role: "user",
        content: finalReportInstruction,
      });
      const finalResponse = await client.createChatCompletion({
        messages,
        tools: [],
        requireJson: true,
      });
      const draftReport = parseDraftReport(finalResponse.message.content);
      return {
        report: {
          ...draftReport,
          toolCallLog: tools.getToolCallLog(),
        },
      };
    }
  }

  throw new Error("LLM agent exceeded the maximum tool-calling iterations.");
}

async function assessClaimCaseSingleCall(
  claimCase: ClaimCase,
  client: LlmClient,
): Promise<AgentRunResult> {
  const tools = new ToolRuntime();

  console.log(`\x1b[36m[Agent]\x1b[0m Executing deterministic tool chain...`);

  let stepCount = 1;
  for (const documentId of claimCase.claim.submittedDocumentIds) {
    console.log(`\x1b[33m[Step ${stepCount++}]\x1b[0m \x1b[1mVerifying Document:\x1b[0m \x1b[32m${documentId}\x1b[0m`);
    const output = tools.verifyDocument(documentId);
    console.log(`         \x1b[90m<\x1b[0m Status: \x1b[1m${output.status.toUpperCase()}\x1b[0m, Detected: ${output.documentType}`);
  }

  console.log(`\x1b[33m[Step ${stepCount++}]\x1b[0m \x1b[1mRetrieving Policy:\x1b[0m \x1b[32m${claimCase.claim.policyId}\x1b[0m`);
  const policyOutput = tools.lookupPolicy(claimCase.claim.policyId);
  console.log(`         \x1b[90m<\x1b[0m Policy: ${policyOutput.policy?.policyNumber ?? "Not Found"} (${policyOutput.policy?.status ?? "N/A"})`);

  console.log(`\x1b[33m[Step ${stepCount++}]\x1b[0m \x1b[1mChecking Medical Necessity\x1b[0m`);
  const medicalOutput = tools.checkMedicalNecessity(
    claimCase.claim.diagnosis,
    claimCase.claim.procedures,
  );
  console.log(`         \x1b[90m<\x1b[0m Appropriate: \x1b[1m${medicalOutput.clinicallyAppropriate ? "YES" : "NO"}\x1b[0m`);

  console.log(`\x1b[33m[Step ${stepCount++}]\x1b[0m \x1b[1mCalculating Benefit Coverage\x1b[0m`);
  const benefitOutput = tools.calculateBenefit(
    claimCase.claim.policyId,
    claimCase.claim.claimType,
    claimCase.claim.amount,
  );
  console.log(`         \x1b[90m<\x1b[0m Covered: \x1b[32m${benefitOutput.coveredAmount}\x1b[0m, Copay: ${benefitOutput.copay}`);

  console.log(`\x1b[36m[Agent]\x1b[0m All context gathered. \x1b[1mRequesting LLM assessment report...\x1b[0m`);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        systemPrompt,
        "The required tools have already been executed by the runtime in the mandated sequence.",
        "Use the supplied toolCallLog as authoritative tool output.",
        "Do not claim to have called additional tools.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Produce the final assessment report from this claim and toolCallLog.",
        claimCase,
        toolCallLog: tools.getToolCallLog(),
        finalReportInstruction: JSON.parse(finalReportInstruction) as unknown,
      }),
    },
  ];

  const response = await client.createChatCompletion({
    messages,
    tools: [],
    requireJson: true,
  });
  const draftReport = parseDraftReport(response.message.content);

  return {
    report: {
      ...draftReport,
      toolCallLog: tools.getToolCallLog(),
    },
  };
}

export async function repairAssessmentReport(
  claimCase: ClaimCase,
  report: AssessmentReport,
  validationErrors: string[],
  client = new LlmClient(),
): Promise<AssessmentReport> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You repair claim assessment JSON reports.",
        "Use only the supplied claim case, tool-call log, validation errors, and original report.",
        "Do not invent policy clauses or tool outputs.",
        "Return only corrected JSON for the report, excluding toolCallLog.",
        "Every reasoning item must include at least one policy clause id from policyCitations.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        claimCase,
        validationErrors,
        originalReport: report,
        toolCallLog: report.toolCallLog,
      }),
    },
  ];

  const response = await client.createChatCompletion({
    messages,
    tools: [],
    requireJson: true,
  });
  const repaired = parseDraftReport(response.message.content);
  return {
    ...repaired,
    toolCallLog: report.toolCallLog,
  };
}

function executeToolCall(
  tools: ToolRuntime,
  call: ChatToolCall,
):
  | PolicyLookupResult
  | BenefitCalculationResult
  | DocumentVerificationResult
  | MedicalNecessityResult {
  const args = parseToolArguments(call);
  const toolName = call.function.name;

  if (toolName === "lookupPolicy") {
    return tools.lookupPolicy(readStringArg(args, "policyId"));
  }

  if (toolName === "calculateBenefit") {
    return tools.calculateBenefit(
      readStringArg(args, "policyId"),
      readClaimTypeArg(args, "claimType"),
      readNumberArg(args, "amount"),
    );
  }

  if (toolName === "verifyDocument") {
    return tools.verifyDocument(readStringArg(args, "documentId"));
  }

  if (toolName === "checkMedicalNecessity") {
    return tools.checkMedicalNecessity(
      readStringArg(args, "diagnosis"),
      readStringArrayArg(args, "procedures"),
    );
  }

  throw new Error(`Unsupported tool call '${toolName}'.`);
}

function parseToolArguments(call: ChatToolCall): Record<string, unknown> {
  const parsed = JSON.parse(call.function.arguments) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Tool arguments for '${call.function.name}' must be an object.`);
  }
  return parsed;
}

function parseDraftReport(content: string | null): DraftAssessmentReport {
  if (!content) {
    throw new Error("LLM response did not contain final report JSON.");
  }

  const parsed = JSON.parse(extractJsonObject(content)) as unknown;
  return unwrapDraftReport(parsed);
}

function extractJsonObject(content: string): string {
  const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1];
  }

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return content.slice(start, end + 1);
  }

  return content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapDraftReport(value: unknown): DraftAssessmentReport {
  if (!isRecord(value)) {
    throw new Error("Final report JSON must be an object.");
  }

  for (const key of ["report", "assessmentReport", "assessment_report"]) {
    if (isRecord(value[key])) {
      return value[key] as DraftAssessmentReport;
    }
  }

  return value as DraftAssessmentReport;
}

function hasRequiredToolCallSequence(
  claimCase: ClaimCase,
  logs: Array<{ toolName: string; input: Record<string, unknown> }>,
): boolean {
  const submittedIds = claimCase.claim.submittedDocumentIds;
  if (logs.length !== submittedIds.length + 3) {
    return false;
  }

  const documentCalls = logs.slice(0, submittedIds.length);
  const verifiedIds = documentCalls.map((entry) => entry.input.documentId);
  const allDocumentsVerified =
    documentCalls.every((entry) => entry.toolName === "verifyDocument") &&
    submittedIds.every((documentId) => verifiedIds.includes(documentId));

  const tail = logs.slice(submittedIds.length).map((entry) => entry.toolName);
  return (
    allDocumentsVerified &&
    tail[0] === "lookupPolicy" &&
    tail[1] === "checkMedicalNecessity" &&
    tail[2] === "calculateBenefit"
  );
}

function readStringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new Error(`Tool argument '${key}' must be a string.`);
  }
  return value;
}

function readNumberArg(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number") {
    throw new Error(`Tool argument '${key}' must be a number.`);
  }
  return value;
}

function readStringArrayArg(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Tool argument '${key}' must be a string array.`);
  }
  return value;
}

function readClaimTypeArg(args: Record<string, unknown>, key: string): ClaimType {
  const value = readStringArg(args, key);
  if (
    value !== "inpatient_hospitalization" &&
    value !== "cosmetic_surgery" &&
    value !== "outpatient_specialist"
  ) {
    throw new Error(`Tool argument '${key}' has unsupported claim type '${value}'.`);
  }
  return value;
}

export const chatTools: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "lookupPolicy",
      description:
        "Return policy terms including benefits, limits, exclusions, copay, waiting periods, coverage period, required documents, and clauses.",
      parameters: {
        type: "object",
        properties: {
          policyId: { type: "string" },
        },
        required: ["policyId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculateBenefit",
      description:
        "Calculate covered amount, copay, member responsibility, and remaining limit for a claim.",
      parameters: {
        type: "object",
        properties: {
          policyId: { type: "string" },
          claimType: {
            type: "string",
            enum: [
              "inpatient_hospitalization",
              "cosmetic_surgery",
              "outpatient_specialist",
            ],
          },
          amount: { type: "number" },
        },
        required: ["policyId", "claimType", "amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "verifyDocument",
      description:
        "Verify one submitted document and return type, completeness status, mismatch status, and issues.",
      parameters: {
        type: "object",
        properties: {
          documentId: { type: "string" },
        },
        required: ["documentId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "checkMedicalNecessity",
      description:
        "Check whether submitted procedures are clinically appropriate for the diagnosis.",
      parameters: {
        type: "object",
        properties: {
          diagnosis: { type: "string" },
          procedures: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["diagnosis", "procedures"],
        additionalProperties: false,
      },
    },
  },
];
