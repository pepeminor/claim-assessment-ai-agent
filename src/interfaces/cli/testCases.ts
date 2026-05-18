import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertClaimCase } from "../../domain/contracts.js";
import type { ClaimCase } from "../../domain/types.js";

const caseFiles = ["approval.json", "rejection.json", "request-more-info.json"];

export async function loadClaimCases(): Promise<ClaimCase[]> {
  const cases = await Promise.all(
    caseFiles.map(async (fileName) => {
      const content = await readFile(join("test-cases", fileName), "utf8");
      const parsed = JSON.parse(content) as unknown;
      assertClaimCase(parsed, `test-cases/${fileName}`);
      return parsed;
    }),
  );

  return cases;
}

export async function loadClaimCaseFile(filePath: string): Promise<ClaimCase> {
  const content = await readFile(filePath, "utf8");
  const parsed = JSON.parse(content) as unknown;
  assertClaimCase(parsed, filePath);
  return parsed;
}
