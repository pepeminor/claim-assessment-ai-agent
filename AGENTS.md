# AGENTS.md - AI Challenge 11: Claim Assessment AI Agent

## Project Context

This project is for **AI Challenge 11 - Claim Assessment AI Agent**.

The goal is to build a conversational AI agent that performs an initial insurance claim assessment. The agent must use an LLM as the assessment agent, call explicit tools for policy lookup, benefit calculation, document verification, and medical necessity checking, then produce a structured report with traceable reasoning and policy citations.

The expected challenge difficulty is **Advanced** with an estimated implementation time of **6-8 hours**.

## Primary Objective

Build a working claim assessment agent that:

1. Accepts claim details, policy id, submitted documents, diagnosis, and procedures.
2. Uses an LLM API as the conversational agent runtime.
3. Lets the LLM call tools in the required logical sequence:
   1. Verify all submitted documents.
   2. Look up policy terms.
   3. Check medical necessity.
   4. Calculate benefits.
4. Validates coverage period, policy status, member coverage, claim type coverage, exclusions, waiting periods, limits, copay, and document requirements.
5. Produces a structured assessment report.
6. Logs every tool call with input and output.
7. Uses deterministic post-validation to reject malformed or unsafe LLM output before writing final results.
8. Correctly handles three provided test cases:
   1. Straightforward approval.
   2. Rejection because of exclusion or limit/coverage violation.
   3. Request-more-info because a required document is missing or incomplete.

## Recommended Implementation Plan

### Phase 1 - Project Setup

Create a small, focused project. Prefer a simple TypeScript or Python implementation over a heavy app unless the existing repository already uses another stack.

Recommended TypeScript structure:

```text
.
|-- AGENTS.md
|-- README.md
|-- package.json
|-- src
|   |-- agent.ts
|   |-- tools.ts
|   |-- llmClient.ts
|   |-- data.ts
|   |-- types.ts
|   |-- report.ts
|   |-- validation.ts
|   `-- runTestCases.ts
|-- test-cases
|   |-- approval.json
|   |-- rejection.json
|   `-- request-more-info.json
`-- outputs
    |-- approval-report.json
    |-- rejection-report.json
    |-- request-more-info-report.json
    `-- tool-call-logs.json
```

Alternative Python structure is acceptable if it stays equally clear and runnable.

### Phase 2 - Define Data Model

Define strict schemas or types for:

- Claim
- Policy
- Benefit
- Exclusion
- Waiting period
- Required document
- Submitted document
- Medical necessity rule
- Tool call log
- Assessment report

Keep policy clauses as explicit structured data with stable clause ids, for example:

```json
{
  "clauseId": "POL-001-BEN-HOSP",
  "title": "Inpatient Hospitalization Benefit",
  "text": "Inpatient hospitalization is covered up to USD 10,000 per policy year after applicable copay."
}
```

The report must cite these clause ids. Do not generate citations from memory or generic text.

### Phase 3 - Implement Required Tools

Implement exactly these four tools as callable functions:

1. `lookupPolicy(policyId)`
   - Returns policy terms: benefits, limits, exclusions, copay, waiting periods, coverage period, member coverage, required documents, and policy clauses.

2. `calculateBenefit(policyId, claimType, amount)`
   - Returns submitted amount, eligible amount, covered amount, copay, member responsibility, remaining limit, and clause ids used.
   - Must never approve an amount above the policy benefit limit.

3. `verifyDocument(documentId)`
   - Returns document id, expected or detected document type, completeness status, mismatch status, and issues.
   - Must support the case where a submitted document does not match the expected type.

4. `checkMedicalNecessity(diagnosis, procedures)`
   - Returns whether treatment is clinically appropriate for the diagnosis, supporting reason, and any rule id.

Every tool call must be logged with:

```json
{
  "toolName": "lookupPolicy",
  "input": {},
  "output": {},
  "timestamp": "ISO-8601"
}
```

### Phase 4 - Implement LLM Agent Orchestration

The agent must use an LLM API. The LLM should be responsible for the conversational assessment flow, deciding which required tool to call next, and drafting the structured assessment report. The code must still enforce guardrails after the LLM responds so the final answer cannot violate hard business rules.

Recommended model provider:

- Primary: OpenAI-compatible Chat Completions with function/tools calling and JSON output.
- Supported providers in this project: OpenAI and Groq.

Implementation target:

- `llmClient.ts`: wraps the provider API.
- `agent.ts`: manages the tool-calling loop.
- `validation.ts`: validates sequence, coverage, citations, report schema, and expected outcome safety.
- `report.ts`: writes final report only after validation passes.

Recommended flow:

1. Read the claim test case.
2. Send the claim facts to the LLM with the system prompt and tool definitions.
3. Run an LLM tool-calling loop. The LLM must call:
   - `verifyDocument(documentId)` once for every submitted document.
   - `lookupPolicy(policyId)` after document verification.
   - `checkMedicalNecessity(diagnosis, procedures)` after policy lookup.
   - `calculateBenefit(policyId, claimType, amount)` after medical necessity check.
4. For every LLM tool call, execute the local tool implementation and append the tool output back into the LLM conversation.
5. Ask the LLM to produce the final structured report after all required tools have returned.
6. Run deterministic validation against the LLM report:
   - Policy exists.
   - Policy is active.
   - Claim date or treatment dates are within coverage period.
   - Member is covered.
   - Claim type is included in benefits.
   - Waiting period has been satisfied.
   - No exclusion applies.
   - Required documents are submitted, complete, and match expected types.
   - Tool call sequence is correct.
   - All submitted documents were verified.
   - Every recommendation reason has a policy clause citation.
   - Report values match tool outputs.
7. If validation fails because the LLM made a correctable formatting or citation mistake, run one repair prompt using the validation errors and original tool outputs.
8. If validation still fails, throw an error and do not write a misleading report.
9. Decide or validate recommendation:
   - `REQUEST_MORE_INFO` if any required document is missing, incomplete, unreadable, or mismatched.
   - `REJECT` if policy is inactive, member not covered, claim outside coverage period, claim type not covered, exclusion applies, waiting period not satisfied, medical necessity fails, or no payable benefit remains.
   - `APPROVE` only if documents are complete, policy checks pass, medical necessity passes, and payable covered amount is greater than zero within limits.
10. Generate structured report.

Important: The agent may mention that a claim exceeds a limit, but it must not approve an amount above the calculated covered amount. If the submitted amount exceeds the limit but a partial benefit is allowed by policy, approve only the covered amount and cite the limit clause. If the policy says exceeding a limit makes the claim non-payable, reject and cite that clause.

### Phase 5 - Create Three Complete Test Cases

Create three complete cases with claim details, policy data, documents, and expected outcome.

#### Case 1 - Straightforward Approval

Purpose: prove the happy path.

Suggested scenario:

- Claim type: inpatient hospitalization
- Submitted amount: USD 4,000
- Diagnosis: acute appendicitis
- Procedure: appendectomy
- Treatment dates: inside active policy coverage period
- Policy: inpatient hospitalization covered up to USD 10,000 per year, 10% copay, no relevant exclusion, waiting period satisfied
- Documents: claim form, itemized bill, discharge summary, medical report; all complete and matching expected types
- Expected outcome: `APPROVE`
- Expected benefit: covered amount USD 3,600 if 10% copay applies to USD 4,000; member responsibility USD 400

#### Case 2 - Rejection

Purpose: prove exclusion or policy limit handling.

Suggested scenario:

- Claim type: cosmetic surgery
- Submitted amount: USD 3,000
- Diagnosis: elective cosmetic enhancement
- Procedure: rhinoplasty for cosmetic purposes
- Treatment dates: inside active policy coverage period
- Policy: cosmetic or elective procedures are excluded
- Documents: all required documents complete
- Expected outcome: `REJECT`
- Reason: excluded treatment, citing the cosmetic exclusion clause

Alternative rejection scenario: claim is outside coverage period or waiting period is not satisfied. If using that route, make the policy clause explicit.

#### Case 3 - Request More Info

Purpose: prove missing/incomplete document behavior.

Suggested scenario:

- Claim type: outpatient specialist consultation
- Submitted amount: USD 500
- Diagnosis: chronic knee pain
- Procedure: orthopedic consultation and X-ray
- Treatment dates: inside active policy coverage period
- Policy: outpatient specialist consult covered up to USD 1,000 per year with 20% copay
- Documents: claim form complete, invoice complete, medical report missing or incomplete, one submitted file may have a mismatched type such as receipt submitted where referral letter is expected
- Expected outcome: `REQUEST_MORE_INFO`
- Reason: missing or incomplete required document, not claim rejection

### Phase 6 - Report Format

The report must be structured and easy for a human assessor to review.

Required sections:

1. `documentReview`
   - List every submitted document.
   - Include status: `complete`, `incomplete`, `missing`, or `mismatched`.
   - Include issues.

2. `policyVerification`
   - Confirm policy active status.
   - Confirm member coverage.
   - Confirm treatment dates are within coverage period.
   - Confirm claim type is included or excluded.
   - Include waiting period checks.

3. `medicalNecessity`
   - State whether the treatment is appropriate for the diagnosis.
   - Include reason.

4. `benefitCalculation`
   - Submitted amount.
   - Eligible amount.
   - Covered amount.
   - Copay.
   - Member responsibility.
   - Remaining limit.

5. `recommendation`
   - One of `APPROVE`, `REJECT`, or `REQUEST_MORE_INFO`.
   - Specific reasoning.

6. `policyCitations`
   - Every recommendation reason must cite the exact policy clause id and clause text used.

Suggested JSON shape:

```json
{
  "claimId": "CLM-001",
  "recommendation": "APPROVE",
  "documentReview": [],
  "policyVerification": {},
  "medicalNecessity": {},
  "benefitCalculation": {},
  "reasoning": [],
  "policyCitations": [],
  "toolCallLog": []
}
```

### Phase 7 - LLM Integration

LLM integration is mandatory for this challenge. The project should fail clearly with setup instructions if no API key is provided, rather than silently switching to a non-LLM rules engine.

Recommended approach:

- Use the LLM as the agent that performs tool calling and drafts the report.
- Keep deterministic validation in code as a safety layer.
- Never let the LLM invent policy terms, limits, exclusions, or citations.
- Pass only claim input, tool outputs, and policy clauses into the prompt.
- Validate the LLM output against the expected report schema before writing it.
- Validate the LLM recommendation against deterministic business rules before accepting it.
- Use low temperature for stable outputs.

Use environment variables for credentials:

```text
OPENAI_API_KEY=
GROQ_API_KEY=
LLM_PROVIDER=openai
LLM_MODEL=gpt-4.1-mini
```

Do not commit real API keys.

Recommended LLM loop:

1. Start conversation with the system prompt and claim payload.
2. Let the LLM request tool calls.
3. Execute each local tool call exactly as requested if valid.
4. Reject unknown tool names or invalid tool arguments.
5. Continue until the LLM returns final JSON report.
6. Validate the report.
7. Optionally run one repair attempt with validation errors.
8. Persist the final report and the full tool call log.

### Phase 8 - Tests and Verification

Minimum verification:

- A script runs all 3 cases and writes outputs.
- Each case matches expected recommendation.
- Tool logs prove all submitted documents were checked.
- Tool logs prove the LLM invoked the tools, rather than the code bypassing the agent.
- Tool logs show the required sequence:
  1. `verifyDocument`
  2. `lookupPolicy`
  3. `checkMedicalNecessity`
  4. `calculateBenefit`
- Reports include exact policy citations.
- Validation rejects reports with missing citations, skipped documents, wrong recommendation, wrong benefit math, or invented policy clauses.

Recommended commands:

```bash
npm test
npm run cases
```

or Python equivalents:

```bash
pytest
python -m src.run_test_cases
```

## Agent Decision Rules

These rules are mandatory:

1. Do not hallucinate policy terms. Use `lookupPolicy(policyId)`.
2. Do not skip any submitted document.
3. Do not approve if required documents are missing, incomplete, unreadable, or mismatched.
4. Missing or incomplete required documents lead to `REQUEST_MORE_INFO`, not `REJECT`.
5. Do not approve amounts exceeding policy benefit limits.
6. Verify claim dates are within policy coverage period.
7. Verify member is covered by the policy.
8. Verify claim type is included in benefits and not excluded.
9. Check medical necessity before final approval.
10. Cite specific policy clauses for every recommendation reason.
11. Log all tool calls and include or link logs in submission output.

## Suggested System Prompt

Use a concise system prompt like this:

```text
You are a claim assessment assistant. You must assess claims only from tool outputs and provided claim data. You must not invent policy terms, exclusions, limits, waiting periods, copays, or clause citations. You must call tools in this sequence: verifyDocument for every submitted document, lookupPolicy, checkMedicalNecessity, calculateBenefit. You must not skip submitted documents. After the tools return, produce only the requested structured JSON report. If any required document is missing, incomplete, unreadable, or mismatched, recommend REQUEST_MORE_INFO rather than REJECT. If policy coverage, exclusions, waiting periods, medical necessity, or benefit availability fail, recommend REJECT with exact policy citations. Approve only when all checks pass and the calculated covered amount is within policy limits. Every recommendation reason must cite a specific policy clause id from lookupPolicy. If the tool outputs do not support a statement, do not include that statement.
```

## Timeline Estimate

Total estimated time: **6-8 hours**.

Suggested breakdown:

- 0.5 hour: set up project structure, scripts, and schemas.
- 1.0 hour: define mock policy, claim, document, and medical necessity data.
- 1.0 hour: implement four tools and tool-call logging.
- 1.5 hours: implement LLM tool-calling orchestration.
- 1.0 hour: implement report generation and citation mapping.
- 1.0 hour: implement deterministic validation and repair flow.
- 1.0 hour: create 3 test cases and expected outputs.
- 1.0 hour: write README, run verification, clean output artifacts, prepare GitHub submission.

## README Requirements

The final `README.md` should include:

1. Project overview.
2. Setup instructions.
3. How to provide an API key for LLM integration.
4. How to run all test cases.
5. How to inspect output reports and tool logs.
6. Brief system prompt explanation.
7. Tool design decisions.
8. Known limitations.
9. Timeline estimate.

## Submission Checklist

Before submission, verify:

- [ ] GitHub repository exists and contains the project.
- [ ] `README.md` explains setup and execution.
- [ ] All 4 required tools are implemented.
- [ ] LLM API integration is implemented.
- [ ] The LLM performs the tool-calling loop.
- [ ] All 3 test cases are included.
- [ ] Generated output report exists for each test case.
- [ ] Tool call logs are included.
- [ ] Approval case returns `APPROVE`.
- [ ] Rejection case returns `REJECT`.
- [ ] Missing document case returns `REQUEST_MORE_INFO`.
- [ ] Report has all required sections.
- [ ] Recommendation reasons cite exact policy clauses.
- [ ] No real API keys are committed.

## Implementation Priorities

Prioritize correctness and traceability over UI polish.

Best submission shape:

1. A runnable CLI demo.
2. Real LLM tool-calling agent.
3. Clear JSON reports.
4. Human-readable README.
5. Deterministic validation layer guarding the LLM output.

Avoid building a complex frontend unless there is extra time after the core agent, reports, logs, and tests are complete.

## Current Implementation Context

This repository now contains a working TypeScript CLI implementation.

Current source layout:

```text
data/
|-- medical-necessity-rules.json
|-- policies.json
`-- submitted-documents.json

public/
|-- app.js
|-- index.html
`-- styles.css

src/
|-- application/
|   |-- agent.ts
|   |-- assessmentRunner.ts
|   |-- normalizeReport.ts
|   |-- reportFinalizer.ts
|   `-- validation.ts
|-- domain/
|   |-- contracts.ts
|   |-- decisionEngine.ts
|   `-- types.ts
|-- infrastructure/
|   |-- data.ts
|   `-- llmClient.ts
|-- interfaces/
|   |-- cli/
|   |   |-- report.ts
|   |   |-- runTestCases.ts
|   |   `-- testCases.ts
|   `-- http/
|       `-- server.ts
|-- tests/
|   `-- decisionEngine.test.ts
`-- tools/
    `-- tools.ts
```

Current test cases:

```text
test-cases/
|-- approval.json
|-- rejection.json
|-- request-more-info.json
|-- manual-template.json
|-- manual-reject-template.json
`-- manual-request-more-info-template.json
```

Current commands:

```bash
npm test
npm run test:unit
npm run cases
npm run cases:smoke
npm run case -- test-cases/manual-template.json
npm run case:smoke -- test-cases/manual-template.json
npm run ui
```

The local UI is served by `src/interfaces/http/server.ts` and static files in `public/`.

UI endpoints:

- `GET /api/templates`
- `GET /api/data`
- `POST /api/preview` for deterministic no-LLM assessment
- `POST /api/assess` for LLM assessment

The visible UI should keep one primary action only: `Run Assessment`.

By default the UI must run the LLM report path through `POST /api/assess`. UI runtime behavior is configured in `public/app-config.js`; edit that file if a future session needs to point the UI to a different assessment endpoint. Keep `/api/preview` available as a backend/debug endpoint, but do not expose a mode switch in the main UI unless the user asks for it.

The output UI should have two tabs only:

- `Report`: the main professional claim assessment document. It should also show validation/API/provider failures as a report-style failed assessment state.
- `Tool Logs`: terminal-style audit logs for tool calls and raw error details.

Do not put long provider or validation errors in the top status pill. The top status should stay short, for example `Assessment failed. See report.` Full details belong in the `Report` failed state and terminal-style `Tool Logs`.

Do not commit automatically. The user explicitly asked not to commit.

## Current LLM Modes

The app supports two report modes through `LLM_REPORT_MODE`.

`LLM_REPORT_MODE=single`:

- Runtime executes required tools in the mandated sequence.
- LLM receives claim + toolCallLog and writes the structured report.
- Uses far fewer API calls and is recommended for Gemini/Groq/free-tier development.
- Still keeps deterministic validation enabled.

`LLM_REPORT_MODE=agentic`:

- LLM requests tools turn by turn.
- This is the fuller agentic demo, but it burns more requests and is more likely to hit quota limits.
- Use only when quota is sufficient.

Supported providers:

```text
LLM_PROVIDER=openai
LLM_PROVIDER=groq
LLM_PROVIDER=gemini
```

Gemini is configured through the OpenAI-compatible endpoint. For quota-friendly testing prefer:

```text
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash-lite
LLM_REPORT_MODE=single
```

## Current Correctness Strategy

The LLM is not trusted for final correctness.

The correctness boundary is:

```text
claim input
-> deterministic tools
-> LLM report draft
-> normalizeReport
-> deterministic validation
-> output report only if validation passes
```

The validator must reject or fail reports that:

- skip submitted documents
- call tools out of sequence
- approve missing/incomplete/mismatched required documents
- approve outside policy coverage dates
- approve inactive policy or wrong member
- approve excluded claim types/procedures
- approve benefit values not matching `calculateBenefit`
- cite policy clauses not returned by `lookupPolicy`
- miss required outcome-specific citations

Important current fix: coverage validation must check both `treatmentStartDate` and `treatmentEndDate`, and reject `treatmentEndDate < treatmentStartDate`.

## Data Model Rules For Scaling

When adding a new policy or claim type, do not only add a claim JSON. Add all supporting mock data:

- policy with matching `policyId`
- member coverage with matching `memberId`
- benefit for the claim type
- required documents for the claim type
- submitted documents with matching document ids
- medical necessity rule for diagnosis/procedure
- policy clauses with stable clause ids and roles

Policy clauses should have `role` whenever possible:

```text
eligibility
benefit
waiting_period
required_document
exclusion
general
```

Do not rely on clause id naming such as `*-ELIGIBILITY` for logic. Prefer explicit `role`.

`src/domain/contracts.ts` contains runtime schema contracts for:

- claim cases
- policies
- submitted documents
- medical necessity rules

Keep these contracts updated whenever the model shape changes. They intentionally fail early with clear messages before the LLM runs.

`src/tests/decisionEngine.test.ts` contains LLM-independent tests for deterministic decision logic. Keep these tests broad because they are the fastest way to prove core assessment correctness without API quota.

For every recommendation:

- `APPROVE` should cite eligibility, benefit, required document, and waiting period clauses when applicable.
- `REJECT` should cite the exact blocking policy clause, usually exclusion or no-payable-benefit clause.
- `REQUEST_MORE_INFO` should cite required-document clauses.

Medical necessity rule ids such as `MED-*` are not policy citations. If mentioned in reasoning, also cite a relevant `POL-*` clause.

## Known Maintenance Risks

Current risks to avoid:

- LLM providers may emit slightly different JSON shapes. Keep `normalizeReport.ts` defensive.
- Free-tier providers may return quota errors. Prefer `single` mode during development.
- Invalid output artifacts such as `*.invalid-report.json` are local debugging artifacts and should not be treated as final submission outputs.
- The current medical necessity checker is keyword based and mock-only.
- Mock data lives in `data/*.json` and is loaded by `src/infrastructure/data.ts` with runtime schema contracts.

## Planned Hardening Roadmap

Proceed in small phases and verify after each phase:

1. Add explicit data/schema contracts.
2. Extract deterministic recommendation logic from `validation.ts` into `decisionEngine.ts`.
3. Add unit tests for decision logic independent of the LLM.
4. Move mock policies/documents/medical rules out of TypeScript fixtures into `data/*.json`. (Done)
5. Harden report schema so reasoning can become structured objects with `reason` and `clauseIds`.
6. Clean debug output artifacts and update README after each major change.

Current hardening status:

- `src/domain/contracts.ts` validates input data and normalized assessment reports.
- `src/domain/decisionEngine.ts` owns deterministic recommendation logic.
- `src/tests/decisionEngine.test.ts` covers approval, rejection, request-more-info, and treatment end date outside coverage.
- Mock data has been moved to `data/*.json`.
- `outputs/*.invalid-report.json` is ignored as a debug artifact.
