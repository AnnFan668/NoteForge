import { buildCoverImagePrompt, publishGeneratedPng } from "./coverImage.mjs";
import { buildCodexPrompt, buildDecisionPrompt } from "./prompts.mjs";
import {
  CodexApiError,
  normalizeDecisionResult,
  normalizeCodexItems,
  parseJsonFromCodex,
} from "./validation.mjs";

const CHAT_ENDPOINT = "/chat/completions";
const IMAGE_ENDPOINT = "/images/generations";
const TEXT_TIMEOUT_MS = 180_000;
const IMAGE_TIMEOUT_MS = 300_000;

function compactText(value, maxLength = 800) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isLocalPlaceholderModel(value) {
  const text = String(value ?? "").trim();
  return !text || /codex\s*cli|imagegen\s*skill|本地\s*cli/i.test(text);
}

function sanitizeDetails(value, apiKey) {
  let text = String(value ?? "");
  if (apiKey) {
    text = text.split(apiKey).join("[redacted]");
  }
  return text.slice(0, 900);
}

function extractUpstreamError(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  try {
    const parsed = JSON.parse(text);
    return compactText(
      parsed?.error?.message ??
      parsed?.error?.detail ??
      parsed?.message ??
      parsed?.detail,
      360,
    );
  } catch {
    return /^\s*</.test(text) ? "" : compactText(text, 360);
  }
}

function isOfficialKimiApi(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return hostname === "api.moonshot.cn" ||
      hostname === "api.moonshot.ai" ||
      (hostname === "api.kimi.com" && /^\/coding(?:\/|$)/i.test(url.pathname));
  } catch {
    return false;
  }
}

export function isOfficialDeepSeekApi(value) {
  try {
    return new URL(value).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
}

export function buildUpstreamHttpError({ status, text, apiKey }) {
  const upstreamError = sanitizeDetails(extractUpstreamError(text), apiKey);
  return new CodexApiError(
    "API_HTTP_ERROR",
    `云端 API 请求失败：HTTP ${status}${upstreamError ? ` · ${upstreamError}` : ""}。`,
    502,
    sanitizeDetails(text, apiKey),
  );
}

function requireCloudConfig(payload) {
  const modelName = String(payload.modelName ?? "").trim();
  const apiKey = String(payload.apiKey ?? "").trim();
  const baseUrl = String(payload.baseUrl ?? "").trim();

  if (isLocalPlaceholderModel(modelName) || !apiKey || !baseUrl) {
    throw new CodexApiError(
      "API_CONFIG_MISSING",
      "模型配置缺失：云端 API 需要填写 API Key、API Base URL 和可用模型名称。",
      400,
    );
  }

  return { modelName, apiKey, baseUrl };
}

function resolveEndpointUrl(baseUrl, endpointPath) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new CodexApiError("API_BAD_BASE_URL", "API Base URL 不是合法 URL。", 400);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new CodexApiError("API_BAD_BASE_URL", "API Base URL 只支持 http 或 https。", 400);
  }

  const endpoint = endpointPath.replace(/^\/+/, "");
  const endpointSuffix = `/${endpoint}`.toLowerCase();
  const currentPath = url.pathname.replace(/\/+$/, "");

  if (!currentPath.toLowerCase().endsWith(endpointSuffix)) {
    url.pathname = `${currentPath}/${endpoint}`.replace(/\/{2,}/g, "/");
  } else {
    url.pathname = currentPath;
  }

  url.hash = "";
  url.search = "";
  url.username = "";
  url.password = "";
  return url;
}

function endpointPreview(url) {
  const displayUrl = new URL(url);
  displayUrl.search = "";
  displayUrl.username = "";
  displayUrl.password = "";
  return `POST ${displayUrl.toString()}`;
}

export function buildCloudNetworkError(error) {
  const causeCode = String(error?.cause?.code ?? error?.code ?? "").toUpperCase();
  const causeMessage = String(error?.cause?.message ?? error?.message ?? "");
  if (causeCode === "EACCES" || causeCode === "EPERM" || /access.*socket|访问.*套接字/i.test(causeMessage)) {
    return new CodexApiError(
      "API_NETWORK_RESTRICTED",
      "当前 Node 服务没有外网访问权限。请关闭开发工具启动的旧服务，再双击 NoteForge.bat 启动。",
      502,
    );
  }
  return new CodexApiError(
    "API_HTTP_ERROR",
    `无法连接云端 API：${error?.message || "未知网络错误"}`,
    502,
  );
}

async function fetchJson({ url, apiKey, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();

    if (!response.ok) {
      throw buildUpstreamHttpError({ status: response.status, text, apiKey });
    }

    if (/^\s*</.test(text)) {
      throw new CodexApiError(
        "API_BAD_JSON",
        "云端 API 返回了 HTML 页面，请检查 API Base URL 是否指向接口地址。",
        502,
        sanitizeDetails(text, apiKey),
      );
    }

    try {
      return { json: JSON.parse(text), rawText: text };
    } catch {
      throw new CodexApiError(
        "API_BAD_JSON",
        "云端 API 返回内容不是合法 JSON。",
        502,
        sanitizeDetails(text, apiKey),
      );
    }
  } catch (error) {
    if (error instanceof CodexApiError) {
      throw error;
    }
    if (error?.name === "AbortError") {
      throw new CodexApiError("API_TIMEOUT", "云端 API 请求超时，请稍后重试。", 504);
    }
    throw buildCloudNetworkError(error);
  } finally {
    clearTimeout(timer);
  }
}

function textFromContentPart(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  if (Array.isArray(part.content)) return part.content.map(textFromContentPart).join("");
  return "";
}

function extractGeneratedText(json) {
  if (Array.isArray(json?.items)) {
    return JSON.stringify(json);
  }

  if (typeof json?.output_text === "string") {
    return json.output_text;
  }

  const choice = Array.isArray(json?.choices) ? json.choices[0] : null;
  const content = choice?.message?.content ?? choice?.text;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const text = content.map(textFromContentPart).join("").trim();
    if (text) return text;
  }

  throw new CodexApiError(
    "API_UNSUPPORTED_RESPONSE",
    "云端 API 返回结构不受支持：未找到 choices[0].message.content。",
    502,
  );
}

function mapCloudJsonError(error) {
  if (error instanceof CodexApiError && error.code === "CODEX_BAD_JSON") {
    throw new CodexApiError(
      "API_BAD_JSON",
      error.message.replaceAll("Codex", "云端 API"),
      error.status,
      error.details,
    );
  }
  throw error;
}

function parseCloudItems(kind, raw, payload) {
  try {
    const parsed = parseJsonFromCodex(raw);
    return normalizeCodexItems(kind, parsed, payload);
  } catch (error) {
    mapCloudJsonError(error);
  }
}

function parseCloudDecision(raw, payload) {
  try {
    const parsed = parseJsonFromCodex(raw);
    return normalizeDecisionResult(parsed, payload);
  } catch (error) {
    mapCloudJsonError(error);
  }
}

export function buildCloudChatBody({ payload, modelName, baseUrl, prompt }) {
  const body = {
    model: modelName,
    messages: [
      {
        role: "system",
        content: "You generate structured Chinese Xiaohongshu content. Return only valid JSON, with no Markdown fences or commentary.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    stream: false,
  };

  if (isOfficialKimiApi(baseUrl)) {
    // Kimi families enforce different temperature values. Omitting the field
    // lets each model use its supported default instead of returning HTTP 400.
    body.max_completion_tokens = payload.kind === "drafts" ? 5200 : 3200;
    body.response_format = { type: "json_object" };
  } else if (isOfficialDeepSeekApi(baseUrl)) {
    body.max_tokens = payload.kind === "drafts" ? 5200 : 3200;
    body.response_format = { type: "json_object" };
    body.thinking = { type: "disabled" };
  } else {
    body.temperature = 0.7;
    body.max_tokens = payload.kind === "drafts" ? 5200 : 3200;
  }

  return body;
}

export async function runCloudHealthCheck(payload) {
  const { modelName, apiKey, baseUrl } = requireCloudConfig(payload);
  const endpointUrl = resolveEndpointUrl(baseUrl, CHAT_ENDPOINT);
  const startedAt = Date.now();
  const body = {
    model: modelName,
    messages: [
      { role: "system", content: "You are a connectivity checker." },
      { role: "user", content: "Reply with exactly OK." },
    ],
    stream: false,
    max_tokens: 16,
  };

  if (isOfficialDeepSeekApi(baseUrl)) {
    body.thinking = { type: "disabled" };
  }

  const result = await fetchJson({
    url: endpointUrl,
    apiKey,
    timeoutMs: 30_000,
    body,
  });
  const output = extractGeneratedText(result.json);

  return {
    modelName,
    commandPreview: endpointPreview(endpointUrl),
    durationMs: Date.now() - startedAt,
    output: compactText(output, 80),
  };
}

export async function runCloudGeneration(payload) {
  const { modelName, apiKey, baseUrl } = requireCloudConfig(payload);
  const endpointUrl = resolveEndpointUrl(baseUrl, CHAT_ENDPOINT);
  const prompt = buildCodexPrompt(payload);
  const startedAt = Date.now();
  const result = await fetchJson({
    url: endpointUrl,
    apiKey,
    timeoutMs: TEXT_TIMEOUT_MS,
    body: buildCloudChatBody({ payload, modelName, baseUrl, prompt }),
  });
  const raw = extractGeneratedText(result.json);
  const items = parseCloudItems(payload.kind, raw, payload);

  return {
    items,
    raw,
    commandPreview: endpointPreview(endpointUrl),
    durationMs: Date.now() - startedAt,
  };
}

export async function runCloudDecision(payload) {
  const { modelName, apiKey, baseUrl } = requireCloudConfig(payload);
  const endpointUrl = resolveEndpointUrl(baseUrl, CHAT_ENDPOINT);
  const prompt = buildDecisionPrompt(payload);
  const startedAt = Date.now();
  const result = await fetchJson({
    url: endpointUrl,
    apiKey,
    timeoutMs: TEXT_TIMEOUT_MS,
    body: buildCloudChatBody({ payload, modelName, baseUrl, prompt }),
  });
  const raw = extractGeneratedText(result.json);
  const decision = parseCloudDecision(raw, payload);

  return {
    ...decision,
    raw,
    commandPreview: endpointPreview(endpointUrl),
    durationMs: Date.now() - startedAt,
  };
}

function imageBody({ payload, modelName }) {
  return {
    model: modelName,
    prompt: buildCoverImagePrompt(payload),
    n: 1,
    size: "1024x1536",
    response_format: "b64_json",
    output_format: "png",
  };
}

function decodeBase64Image(value) {
  const stripped = String(value ?? "")
    .replace(/^data:image\/png;base64,/i, "")
    .replace(/\s+/g, "");

  if (!stripped) {
    throw new CodexApiError("API_BAD_IMAGE", "云端图片 API 返回了空的 base64 图片。", 502);
  }

  return Buffer.from(stripped, "base64");
}

async function fetchImageBytes(imageUrl) {
  let url;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new CodexApiError("API_UNSUPPORTED_RESPONSE", "云端图片 API 返回的图片 URL 无效。", 502);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new CodexApiError("API_HTTP_ERROR", `云端图片 URL 下载失败：HTTP ${response.status}。`, 502);
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof CodexApiError) throw error;
    if (error?.name === "AbortError") {
      throw new CodexApiError("API_TIMEOUT", "云端图片 URL 下载超时，请稍后重试。", 504);
    }
    throw new CodexApiError(
      "API_HTTP_ERROR",
      `云端图片 URL 下载失败：${error?.message || "未知网络错误"}`,
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function extractImageBytes(json) {
  const firstImage = Array.isArray(json?.data) ? json.data[0] : null;

  if (!firstImage || typeof firstImage !== "object") {
    throw new CodexApiError("API_UNSUPPORTED_RESPONSE", "云端图片 API 返回结构不受支持：缺少 data[0]。", 502);
  }

  if (typeof firstImage.b64_json === "string") {
    return decodeBase64Image(firstImage.b64_json);
  }

  if (typeof firstImage.url === "string") {
    return fetchImageBytes(firstImage.url);
  }

  throw new CodexApiError(
    "API_UNSUPPORTED_RESPONSE",
    "云端图片 API 返回结构不受支持：需要 b64_json 或 url。",
    502,
  );
}

function summarizeImageResponse(json) {
  const data = Array.isArray(json?.data)
    ? json.data.map((item) => ({
        ...item,
        b64_json: item?.b64_json ? `[base64 png ${String(item.b64_json).length} chars]` : item?.b64_json,
        revised_prompt: compactText(item?.revised_prompt, 500),
      }))
    : json?.data;

  return JSON.stringify({ ...json, data });
}

export async function runCloudCoverImage(payload) {
  const { modelName, apiKey, baseUrl } = requireCloudConfig(payload);
  const endpointUrl = resolveEndpointUrl(baseUrl, IMAGE_ENDPOINT);
  const startedAt = Date.now();
  const result = await fetchJson({
    url: endpointUrl,
    apiKey,
    timeoutMs: IMAGE_TIMEOUT_MS,
    body: imageBody({ payload, modelName }),
  });
  const imageBytes = await extractImageBytes(result.json);
  const image = await publishGeneratedPng({
    imageBytes,
    selectedPrompt: payload.selectedPrompt,
    sourceLabel: "云端图片 API",
    badImageCode: "API_BAD_IMAGE",
    badImageMessage: "云端图片 API 返回的文件不是合法 PNG。",
  });

  return {
    image,
    raw: summarizeImageResponse(result.json),
    commandPreview: endpointPreview(endpointUrl),
    durationMs: Date.now() - startedAt,
  };
}
