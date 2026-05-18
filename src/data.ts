import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertMedicalNecessityRules,
  assertPolicyData,
  assertSubmittedDocuments,
} from "./contracts.js";
import type {
  MedicalNecessityRule,
  Policy,
  SubmittedDocument,
} from "./types.js";

const rawPolicies = readJson("data/policies.json");
const rawSubmittedDocuments = readJson("data/submitted-documents.json");
const rawMedicalNecessityRules = readJson("data/medical-necessity-rules.json");

assertPolicyData(rawPolicies);
assertSubmittedDocuments(rawSubmittedDocuments);
assertMedicalNecessityRules(rawMedicalNecessityRules);

export const policies: Policy[] = rawPolicies;
export const submittedDocuments: SubmittedDocument[] = rawSubmittedDocuments;
export const medicalNecessityRules: MedicalNecessityRule[] = rawMedicalNecessityRules;

function readJson(path: string): unknown {
  const content = readFileSync(join(process.cwd(), path), "utf8");
  return JSON.parse(content) as unknown;
}
