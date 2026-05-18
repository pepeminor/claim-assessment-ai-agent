# Claim Assessment AI Agent

This project is the solution for **AI Challenge 11: Claim Assessment AI Agent**. 

It provides a robust, conversational AI assessment system that integrates LLM reasoning with deterministic business logic. 

> **Note to Assessors**: This submission includes both technical implementation and independent responses to the challenge's logical reasoning questions. Please review the **`Logical_Answers/`** directory for these specific theoretical responses.

## Project Overview

The project implements an LLM tool-calling agent for initial claim assessment.

Required tools:

- `lookupPolicy(policyId)`
- `calculateBenefit(policyId, claimType, amount)`
- `verifyDocument(documentId)`
- `checkMedicalNecessity(diagnosis, procedures)`

The LLM must call tools in a logical, step-by-step sequence, culminating in a structured assessment report. All outputs are validated against deterministic business rules, ensuring that the agent's recommendations are reliable, traceable, and fully cited with specific policy clauses.

The three test scenarios are assessed against one shared standard health policy (`POL-HEALTH-STANDARD-001`). This avoids test-case-shaped policy data: the approval, rejection, and request-more-info outcomes come from claim facts, exclusions, benefit terms, and document status rather than from separate policies designed for each outcome.

## Challenge Responses

In addition to the code, the **`Logical_Answers/`** directory contains the independent written responses required by the challenge. Please review these documents for my detailed answers to the theoretical questions posed in the challenge.

## Setup

```bash
npm install
cp .env.example .env
```

Add an API key to `.env` or export it in your shell.

OpenAI:

```bash
export OPENAI_API_KEY=your_key_here
export LLM_PROVIDER=openai
export LLM_MODEL=gpt-4.1-mini
```

Groq:

```bash
export GROQ_API_KEY=your_key_here
export LLM_PROVIDER=groq
export LLM_MODEL=openai/gpt-oss-120b
```

Gemini:

```bash
export GEMINI_API_KEY=your_key_here
export LLM_PROVIDER=gemini
export LLM_MODEL=gemini-2.5-flash-lite
```

For the fullest challenge demo, use agentic mode. This lets the LLM request the required tools turn by turn:

```bash
export LLM_REPORT_MODE=agentic
```

For Gemini or Groq free-tier development, use quota-friendly single-call report mode:

```bash
export LLM_REPORT_MODE=single
```

`agentic` is the recommended evaluation mode because it demonstrates the LLM tool-calling loop directly. `single` mode executes the required tools locally in the mandated sequence, then uses one LLM request to write the report from the tool outputs. Both modes keep deterministic validation enabled.

No real API keys should be committed.

## How to Test

You can verify the agent's performance using the CLI or the Web UI.

### CLI Testing (Recommended for Evaluation)

1.  **Single Case**: Run a specific test case file. For final evaluation, use **LLM_REPORT_MODE=agentic**. For free-tier quota checks, **LLM_REPORT_MODE=single** is available.
    ```bash
    npm run case -- test-cases/approval.json
    ```
    ```bash
    npm run case -- test-cases/rejection.json
    ```
    ```bash
    npm run case -- test-cases/request-more-info.json
    ```
2.  **Smoke Test**: Verify the data loading and tool logic locally without making API calls.
    ```bash
    npm run cases:smoke
    ```
3.  **Unit Tests**: Verify the deterministic decision engine logic (benefit calculation, eligibility, etc.).
    ```bash
    npm run test:unit
    ```
4.  **Full LLM Assessment**: Run all 3 test cases using the configured LLM provider. This will generate the final reports and tool logs in the `outputs/` folder.
    ```bash
    npm run cases
    ```

### Web UI Testing

1.  Start the local server:
    ```bash
    npm run ui
    ```
2.  Open [http://127.0.0.1:3000](http://127.0.0.1:3000) in your browser.
3.  Select a template, click **"Run Assessment"**, and switch between the **Report** and **Tool Logs** tabs to inspect the results.

## Test Cases

The project includes three complete cases in `test-cases/`:

- `approval.json`: inpatient hospitalization for acute appendicitis, expected `APPROVE`.
- `rejection.json`: elective cosmetic rhinoplasty, expected `REJECT`.
- `request-more-info.json`: outpatient specialist claim with incomplete, mismatched, and missing required documents, expected `REQUEST_MORE_INFO`.

All three cases use the same active policy, `POL-HEALTH-STANDARD-001`, with different claim facts and members.

Manual templates:

- `test-cases/manual-template.json`: approval template.
- `test-cases/manual-reject-template.json`: rejection template.
- `test-cases/manual-request-more-info-template.json`: request-more-info template.

Edit `caseId`, claim fields, document ids, and `expectedOutcome`, then run it with `npm run case -- <file>`.

## Outputs

When `npm run cases` succeeds, reports are written to:

- `outputs/approval-report.json`
- `outputs/rejection-report.json`
- `outputs/request-more-info-report.json`
- `outputs/tool-call-logs.json`

Each report contains:

- Document Review
- Policy Verification
- Medical Necessity
- Benefit Calculation
- Recommendation
- Policy Citations
- Tool Call Log

## Tool Design Decisions

- **Deterministic Core**: Tools are implemented as deterministic functions in `src/tools.ts`. This ensures that sensitive logic like benefit calculation (`calculateBenefit`) and document verification (`verifyDocument`) is handled by code, not by LLM "guessing".
- **Schema-First Data**: Mock policy, document, and medical necessity rule data are stored as JSON in `data/` and validated against TypeScript interfaces in `src/types.ts` using runtime contracts in `src/contracts.ts`. This prevents the LLM from processing malformed data.
- **Traceable Citations**: Every policy benefit or exclusion is linked to a stable `clauseId`. Tools return these IDs, and the LLM is mandated to use them in the report, ensuring every decision is legally traceable.
- **Stateful Tool Runtime**: `ToolRuntime` in `src/tools.ts` logs every call, including inputs, outputs, and timestamps. This log is appended to the final report for full auditability.
- **Post-Validation Finalization**: The LLM drafts the assessment report, then `normalizeReport` and `reportFinalizer` align the final recommendation, document review, benefit values, and citations with deterministic tool outputs before validation accepts the report. This keeps the LLM in the reporting loop without trusting it for hard business rules.

## System Prompt Design

The system prompt in `src/agent.ts` is designed for high-precision assessment:

- **Strict Sequence**: It mandates a specific tool-calling sequence: `verifyDocument` (all) -> `lookupPolicy` -> `checkMedicalNecessity` -> `calculateBenefit`. This ensures the agent has all context before making a recommendation.
- **Anti-Hallucination**: Explicitly forbids inventing policy terms, limits, or citations. It anchors the agent to the tool outputs.
- **Outcome Logic**: Clearly defines the difference between `REQUEST_MORE_INFO` (document issues) and `REJECT` (eligibility/policy issues), preventing premature rejections.
- **Citation Requirement**: Forces the LLM to link every reasoning point to at least one `clauseId` returned by the tools.
- **Data-Driven Reasoning**: Instructs the agent to only include statements supported by tool outputs, reducing "fluff" and errors.

## Validation

`src/validation.ts` acts as a deterministic guardrail for the LLM's output:

- Every submitted document was verified.
- Tool order is correct.
- Policy lookup, medical necessity, and benefit calculation were called exactly once.
- Recommendation matches deterministic business rules.
- Benefit values match `calculateBenefit`.
- Document review matches `verifyDocument`.
- Citations come from `lookupPolicy`.
- Each reasoning item includes a cited policy clause id.

If validation fails, the CLI throws an error and does not write a misleading final report.

`src/contracts.ts` also checks the normalized report shape before validation. Debug files matching `outputs/*.invalid-report.json` are ignored and should not be treated as submission artifacts.

## Timeline Estimate

Estimated implementation time: 6-8 hours.

- 0.5 hour: project setup and schemas.
- 1.0 hour: mock policy, document, claim, and medical necessity data.
- 1.0 hour: deterministic tools and audit logging.
- 1.5 hours: LLM orchestration and tool-calling loop.
- 1.0 hour: report normalization, validation, and repair flow.
- 1.0 hour: test cases, unit tests, and output generation.
- 1.0 hour: README, UI polish, and submission cleanup.

## Known Limitations

- The medical necessity checker is a mock rule matcher, not a clinical system.
- Policies and documents are local mock data for the challenge.
- The LLM must be run with an API key to generate final reports.
- The validator is intentionally strict; reports with missing citations or wrong tool order fail.
