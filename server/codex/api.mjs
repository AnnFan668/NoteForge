import {
  runCoverImagegen,
  serveGeneratedCover,
  validateCoverImageRequest,
} from "./coverImage.mjs";
import {
  runCloudCoverImage,
  runCloudDecision,
  runCloudGeneration,
} from "./cloudProvider.mjs";
import { buildCodexPrompt, buildDecisionPrompt } from "./prompts.mjs";
import { runCodex } from "./runCodex.mjs";
import {
  CodexApiError,
  normalizeDecisionResult,
  normalizeCodexItems,
  parseJsonFromCodex,
  validateDecisionRequest,
  validateRequest,
} from "./validation.mjs";
import {
  runXhsSearch,
  validateXhsSearchRequest,
} from "../xhs/runXhs.mjs";
import {
  assertLocalImageCli,
  detectLocalClis,
  runLocalTextCli,
} from "../localCli/registry.mjs";
import { checkIntegration } from "../integrations/health.mjs";

const MAX_BODY_BYTES = 128 * 1024;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString("utf8");
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      throw new CodexApiError("BAD_REQUEST", "请求体过大。");
    }
  }

  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new CodexApiError("BAD_REQUEST", "请求体不是合法 JSON。");
  }
}

function serializeError(error) {
  if (error instanceof CodexApiError) {
    return {
      status: error.status,
      payload: {
        ok: false,
        code: error.code,
        error: error.message,
        details: error.details,
      },
    };
  }

  return {
    status: 500,
    payload: {
      ok: false,
      code: "INTERNAL_ERROR",
      error: error?.message || "本地生成服务发生未知错误。",
    },
  };
}

export function codexGenerateMiddleware() {
  return async (req, res, next) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    const handledGeneratedCover = await serveGeneratedCover(requestUrl, res, next);
    if (handledGeneratedCover) {
      return;
    }

    const handledPath = new Set([
      "/api/codex/generate",
      "/api/codex/decide",
      "/api/codex/cover-image",
      "/api/local-cli/detect",
      "/api/local-cli/generate",
      "/api/local-cli/decide",
      "/api/local-cli/cover-image",
      "/api/cloud/generate",
      "/api/cloud/decide",
      "/api/cloud/cover-image",
      "/api/xhs/search",
      "/api/integrations/check",
    ]);

    if (!handledPath.has(requestUrl.pathname)) {
      next();
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, {
        ok: false,
        code: "METHOD_NOT_ALLOWED",
        error: "Only POST is supported.",
      });
      return;
    }

    try {
      const payload = await readJsonBody(req);

      if (requestUrl.pathname === "/api/local-cli/detect") {
        const clis = await detectLocalClis(payload);
        sendJson(res, 200, {
          ok: true,
          kind: "localCliDetection",
          clis,
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      if (requestUrl.pathname === "/api/integrations/check") {
        const health = await checkIntegration(payload);
        sendJson(res, 200, {
          ok: true,
          kind: "integrationHealth",
          ...health,
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      if (requestUrl.pathname === "/api/xhs/search") {
        const searchPayload = validateXhsSearchRequest(payload);
        const searchResult = await runXhsSearch(searchPayload);

        sendJson(res, 200, {
          ok: true,
          kind: "xhsSearch",
          items: searchResult.items,
          hasMore: searchResult.hasMore,
          commandPreview: searchResult.commandPreview,
          durationMs: searchResult.durationMs,
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      if (
        requestUrl.pathname === "/api/codex/cover-image" ||
        requestUrl.pathname === "/api/local-cli/cover-image"
      ) {
        validateCoverImageRequest(payload);
        if (requestUrl.pathname === "/api/local-cli/cover-image") {
          assertLocalImageCli(payload);
        }
        const codexResult = await runCoverImagegen(payload);

        sendJson(res, 200, {
          ok: true,
          kind: "coverImage",
          image: codexResult.image,
          raw: codexResult.raw,
          commandPreview: codexResult.commandPreview,
          durationMs: codexResult.durationMs,
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      if (requestUrl.pathname === "/api/cloud/cover-image") {
        validateCoverImageRequest(payload);
        const cloudResult = await runCloudCoverImage(payload);

        sendJson(res, 200, {
          ok: true,
          kind: "coverImage",
          image: cloudResult.image,
          raw: cloudResult.raw,
          commandPreview: cloudResult.commandPreview,
          durationMs: cloudResult.durationMs,
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      if (requestUrl.pathname === "/api/cloud/decide") {
        validateDecisionRequest(payload);
        const cloudResult = await runCloudDecision(payload);

        sendJson(res, 200, {
          ok: true,
          kind: "decision",
          decisionKind: payload.decisionKind,
          selectedIds: cloudResult.selectedIds,
          reason: cloudResult.reason,
          raw: cloudResult.raw,
          commandPreview: cloudResult.commandPreview,
          durationMs: cloudResult.durationMs,
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      if (
        requestUrl.pathname === "/api/codex/decide" ||
        requestUrl.pathname === "/api/local-cli/decide"
      ) {
        validateDecisionRequest(payload);
        const prompt = buildDecisionPrompt(payload);
        const localResult = requestUrl.pathname === "/api/local-cli/decide"
          ? await runLocalTextCli({
              prompt,
              modelName: payload.modelName,
              cliId: payload.cliId,
              cliCommand: payload.cliCommand,
            })
          : await runCodex({ prompt, modelName: payload.modelName });
        const parsed = parseJsonFromCodex(localResult.raw);
        const decision = normalizeDecisionResult(parsed, payload);

        sendJson(res, 200, {
          ok: true,
          kind: "decision",
          decisionKind: payload.decisionKind,
          selectedIds: decision.selectedIds,
          reason: decision.reason,
          raw: localResult.raw,
          commandPreview: localResult.commandPreview,
          durationMs: localResult.durationMs,
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      validateRequest(payload);

      if (requestUrl.pathname === "/api/cloud/generate") {
        const cloudResult = await runCloudGeneration(payload);

        sendJson(res, 200, {
          ok: true,
          kind: payload.kind,
          items: cloudResult.items,
          raw: cloudResult.raw,
          commandPreview: cloudResult.commandPreview,
          durationMs: cloudResult.durationMs,
          generatedAt: new Date().toISOString(),
        });
        return;
      }

      const prompt = buildCodexPrompt(payload);
      const localResult = requestUrl.pathname === "/api/local-cli/generate"
        ? await runLocalTextCli({
            prompt,
            modelName: payload.modelName,
            cliId: payload.cliId,
            cliCommand: payload.cliCommand,
          })
        : await runCodex({ prompt, modelName: payload.modelName });
      const parsed = parseJsonFromCodex(localResult.raw);
      const items = normalizeCodexItems(payload.kind, parsed, payload);

      sendJson(res, 200, {
        ok: true,
        kind: payload.kind,
        items,
        raw: localResult.raw,
        commandPreview: localResult.commandPreview,
        durationMs: localResult.durationMs,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const normalizedError = requestUrl.pathname.startsWith("/api/local-cli/") && error?.code === "CODEX_BAD_JSON"
        ? new CodexApiError("LOCAL_CLI_BAD_JSON", error.message, error.status, error.details)
        : error;
      const { status, payload } = serializeError(normalizedError);
      sendJson(res, status, payload);
    }
  };
}
