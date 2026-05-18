import { writeFile, mkdir } from "node:fs/promises";
import "dotenv/config";
import { policies, submittedDocuments } from "./data.js";
import { runLlmAssessment } from "./assessmentRunner.js";
import { reportFileNameForCase } from "./report.js";
import { loadClaimCaseFile, loadClaimCases } from "./testCases.js";
import { ToolRuntime } from "./tools.js";
import type { AssessmentReport, ClaimCase } from "./types.js";

export async function main(): Promise<void> {
  const manualFile = readFlagValue("--file");
  const cases = manualFile ? [await loadClaimCaseFile(manualFile)] : await loadClaimCases();
  if (process.argv.includes("--llm")) {
    await runLlmCases(cases);
    return;
  }

  runSmokeCases(cases);
}

function readFlagValue(flagName: string): string | null {
  const index = process.argv.indexOf(flagName);
  if (index === -1) {
    return null;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flagName}.`);
  }

  return value;
}

function runSmokeCases(cases: ClaimCase[]): void {
  const totalToolCalls = cases.reduce((count, claimCase) => {
    const tools = new ToolRuntime();
    for (const documentId of claimCase.claim.submittedDocumentIds) {
      tools.verifyDocument(documentId);
    }
    tools.lookupPolicy(claimCase.claim.policyId);
    tools.checkMedicalNecessity(
      claimCase.claim.diagnosis,
      claimCase.claim.procedures,
    );
    tools.calculateBenefit(
      claimCase.claim.policyId,
      claimCase.claim.claimType,
      claimCase.claim.amount,
    );
    return count + tools.getToolCallLog().length;
  }, 0);

  console.log(
    `Loaded ${cases.length} claim cases, ${policies.length} policies, ${submittedDocuments.length} submitted documents, and ${totalToolCalls} smoke-test tool calls.`,
  );
}

async function runLlmCases(cases: ClaimCase[]): Promise<void> {
  const provider = process.env.LLM_PROVIDER ?? "openai";
  const hasApiKey =
    provider === "openai"
      ? Boolean(process.env.OPENAI_API_KEY)
      : provider === "groq"
        ? Boolean(process.env.GROQ_API_KEY)
        : provider === "gemini"
          ? Boolean(process.env.GEMINI_API_KEY)
          : false;

  if (!hasApiKey) {
    throw new Error(
      "An LLM API key is required for npm run cases. Use OPENAI_API_KEY for LLM_PROVIDER=openai, GROQ_API_KEY for LLM_PROVIDER=groq, or GEMINI_API_KEY for LLM_PROVIDER=gemini. Use npm run cases:smoke for local non-LLM verification.",
    );
  }

  await mkdir("outputs", { recursive: true });
  const reports: AssessmentReport[] = [];
  for (const [index, claimCase] of cases.entries()) {
    if (index > 0) {
      await sleep(Number(process.env.LLM_CASE_DELAY_MS ?? 1500));
    }

    const report = await runLlmAssessment(claimCase);
    reports.push(report);
    const reportPath = `outputs/${reportFileNameForCase(claimCase)}`;
    await writeFile(
      reportPath,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    console.log(`\x1b[32m[Done]\x1b[0m Report generated: \x1b[34m${reportPath}\x1b[0m`);
    console.log(`\x1b[32m[Done]\x1b[0m Recommendation: \x1b[1m${report.recommendation}\x1b[0m`);
  }

  const logsPath = "outputs/tool-call-logs.json";
  await writeFile(
    logsPath,
    `${JSON.stringify(
      reports.map((report) => ({
        claimId: report.claimId,
        toolCallLog: report.toolCallLog,
      })),
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`\n\x1b[32m[Success]\x1b[0m All reports and tool logs written to \x1b[34moutputs/\x1b[0m.`);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
