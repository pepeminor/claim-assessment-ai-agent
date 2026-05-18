import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import "dotenv/config";
import { runDeterministicAssessment, runLlmAssessment, getUiData } from "./assessmentRunner.js";
import { assertClaimCase } from "./contracts.js";
import { loadClaimCaseFile } from "./testCases.js";

const port = Number(process.env.PORT ?? 3000);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/data") {
      return sendJson(response, getUiData());
    }

    if (request.method === "GET" && url.pathname === "/api/templates") {
      return sendJson(response, {
        approval: await loadClaimCaseFile("test-cases/manual-template.json"),
        reject: await loadClaimCaseFile("test-cases/manual-reject-template.json"),
        requestMoreInfo: await loadClaimCaseFile("test-cases/manual-request-more-info-template.json"),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/preview") {
      const claimCase = await readClaimCaseBody(request);
      return sendJson(response, runDeterministicAssessment(claimCase));
    }

    if (request.method === "POST" && url.pathname === "/api/assess") {
      const claimCase = await readClaimCaseBody(request);
      return sendJson(response, await runLlmAssessment(claimCase));
    }

    return serveStatic(response, url.pathname);
  } catch (error) {
    return sendJson(
      response,
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Claim Assessment UI running at http://127.0.0.1:${port}`);
});

async function readClaimCaseBody(request: IncomingMessage) {
  const body = JSON.parse(await readRequestBody(request)) as unknown;
  assertClaimCase(body, "request body");
  return body;
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve());
    request.on("error", reject);
  });
  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(response: ServerResponse, pathname: string) {
  if (pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalizedPath = normalize(relativePath);

  if (normalizedPath.startsWith("..")) {
    return sendText(response, "Not found", 404);
  }

  const filePath = join(process.cwd(), "public", normalizedPath);

  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentType(filePath) });
    response.end(content);
  } catch (error) {
    if (isMissingFileError(error)) {
      return sendText(response, "Not found", 404);
    }
    throw error;
  }
}

function sendJson(
  response: ServerResponse,
  body: unknown,
  statusCode = 200,
) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendText(response: ServerResponse, body: string, statusCode = 200) {
  response.writeHead(statusCode, { "Content-Type": "text/plain" });
  response.end(`${body}\n`);
}

function isMissingFileError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function contentType(filePath: string): string {
  if (extname(filePath) === ".css") {
    return "text/css";
  }
  if (extname(filePath) === ".js") {
    return "text/javascript";
  }
  return "text/html";
}
