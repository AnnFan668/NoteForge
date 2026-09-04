import { spawn } from "node:child_process";
import { readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodexApiError } from "../codex/validation.mjs";
import { resolveXhsCliCommand } from "../runtime/toolPaths.mjs";

const DEFAULT_COOKIE_SOURCE = "none";
const TIMEOUT_MS = 60_000;
const MAX_DETAILS_CHARS = 800;
const VALID_SORTS = new Set(["general", "popular", "latest"]);
const VALID_TYPES = new Set(["all", "video", "image"]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function assertObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clip(value, maxLength = 180) {
  const text = safeString(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function pickString(source, fieldNames) {
  if (!assertObject(source)) return "";
  for (const fieldName of fieldNames) {
    const value = source[fieldName];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function pickMetric(source, fieldNames) {
  if (!assertObject(source)) return undefined;
  for (const fieldName of fieldNames) {
    const value = source[fieldName];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function normalizeHttpUrl(value) {
  const text = safeString(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function imageUrlFromObject(value) {
  if (typeof value === "string") return normalizeHttpUrl(value);
  if (!assertObject(value)) return "";
  return normalizeHttpUrl(pickString(value, [
    "url_default",
    "url_pre",
    "url",
    "master_url",
    "original",
  ]));
}

export function extractSearchImageUrl(item) {
  const card = assertObject(item?.note_card) ? item.note_card : item;
  const candidates = [
    card?.cover,
    item?.cover,
    card?.image_list?.[0],
    card?.images?.[0],
    item?.image_list?.[0],
    item?.images?.[0],
  ];

  for (const candidate of candidates) {
    const direct = imageUrlFromObject(candidate);
    if (direct) return direct;
    if (Array.isArray(candidate?.info_list)) {
      for (const info of candidate.info_list) {
        const nested = imageUrlFromObject(info);
        if (nested) return nested;
      }
    }
  }
  return "";
}

function formatCount(value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
    if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
    return String(value);
  }

  const text = String(value).trim();
  const normalized = Number(text.replace(/,/g, ""));
  if (Number.isFinite(normalized) && /^\d[\d,]*$/.test(text)) {
    return formatCount(normalized);
  }
  return text;
}

function formatMetrics(interactInfo = {}) {
  const liked = formatCount(pickMetric(interactInfo, ["liked_count", "like_count", "liked", "likes"]));
  const collected = formatCount(pickMetric(interactInfo, ["collected_count", "collect_count", "collected", "collects"]));
  const comments = formatCount(pickMetric(interactInfo, ["comment_count", "comments"]));
  const parts = [];
  if (liked) parts.push(`赞 ${liked}`);
  if (collected) parts.push(`藏 ${collected}`);
  if (comments) parts.push(`评 ${comments}`);
  return parts.length ? parts.join(" | ") : "互动数据暂未返回";
}

function normalizeTags(card) {
  const rawTags = [card?.tag_list, card?.tags, card?.topic_list, card?.hash_tags]
    .find((value) => Array.isArray(value)) || [];

  return rawTags
    .map((tag) => {
      if (typeof tag === "string") return tag.trim();
      if (!assertObject(tag)) return "";
      return pickString(tag, ["name", "tag_name", "title", "text"]);
    })
    .filter(Boolean)
    .slice(0, 8);
}

function stripAnsi(value) {
  return String(value ?? "").replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

export function buildXhsProcessEnv(sourceEnv = process.env) {
  return {
    ...sourceEnv,
    OUTPUT: "json",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    TERM: "dumb",
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

export async function repairInvalidSearchSessionCache(configDir = path.join(homedir(), ".xiaohongshu-cli")) {
  const cachePath = path.join(configDir, "search_sessions.json");
  let bytes;
  try {
    bytes = await readFile(cachePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    JSON.parse(text);
    return null;
  } catch {
    const backupPath = path.join(configDir, `search_sessions.invalid-${Date.now()}.json.bak`);
    try {
      await rename(cachePath, backupPath);
      return backupPath;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
}

function sanitizeDetails(value) {
  let text = stripAnsi(value)
    .replace(/xsec_token=([^&\s"']+)/gi, "xsec_token=[redacted]")
    .replace(/("xsec_token"\s*:\s*")([^"]+)(")/gi, "$1[redacted]$3")
    .replace(/(\ba1=)([^;\s]+)/gi, "$1[redacted]")
    .replace(/("a1"\s*:\s*")([^"]+)(")/gi, "$1[redacted]$3")
    .trim();

  if (text.length > MAX_DETAILS_CHARS) {
    text = `${text.slice(0, MAX_DETAILS_CHARS - 1)}…`;
  }
  return text;
}

function quoteArg(value) {
  const text = String(value);
  if (!text) return "\"\"";
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `"${text.replace(/(["\\$`])/g, "\\$1")}"`;
}

function commandPreview(cliCommand, args) {
  return [cliCommand, ...args].map(quoteArg).join(" ");
}

function parseJsonOutput(stdout) {
  const text = stripAnsi(stdout).trim();
  if (!text) {
    throw new CodexApiError("XHS_BAD_JSON", "xhs CLI 没有返回 JSON 内容。", 502);
  }

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Fall through to the consistent error below.
      }
    }
  }

  throw new CodexApiError("XHS_BAD_JSON", "xhs CLI 返回内容不是合法 JSON。", 502, sanitizeDetails(text));
}

function mapCliError(cliError) {
  const code = safeString(cliError?.code);
  const message = safeString(cliError?.message) || "xhs CLI 执行失败。";
  const details = sanitizeDetails(cliError?.details ?? message);

  if (code === "not_authenticated") {
    throw new CodexApiError(
      "XHS_AUTH_REQUIRED",
      "小红书 CLI 未登录或登录已失效。请在终端手动运行 `xhs login` 后再回到页面点击搜索。",
      401,
      details,
    );
  }

  if (code === "verification_required") {
    throw new CodexApiError(
      "XHS_VERIFY_REQUIRED",
      "小红书要求完成验证。请打开小红书网页完成验证后，再回到页面重新搜索。",
      429,
      details,
    );
  }

  if (code === "ip_blocked") {
    throw new CodexApiError(
      "XHS_RATE_OR_IP_BLOCKED",
      "小红书暂时限制了当前网络或请求频率，请稍后换网络或降低搜索频率后重试。",
      429,
      details,
    );
  }

  throw new CodexApiError("XHS_FAILED", message, 502, details);
}

function formatLookupTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeSearchItem(item, index, payload, lookupTime) {
  const card = assertObject(item?.note_card) ? item.note_card : item;
  const user = assertObject(card?.user) ? card.user : assertObject(card?.user_info) ? card.user_info : {};
  const interactInfo = assertObject(card?.interact_info) ? card.interact_info : {};
  const noteId = pickString(item, ["id", "note_id"]) || pickString(card, ["note_id", "id"]);
  const title = clip(
    pickString(card, ["title", "display_title", "name"]) ||
      pickString(item, ["title", "display_title"]) ||
      `小红书搜索结果 ${index + 1}`,
    80,
  );
  const excerpt = clip(
    pickString(card, ["desc", "description", "content", "note_content", "summary"]) ||
      pickString(item, ["desc", "description", "content", "summary"]) ||
      title,
  );
  const rawType = pickString(card, ["type", "note_type"]) || pickString(item, ["type", "note_type"]);
  const noteType = /video/i.test(rawType) ? "video" : "image";

  return {
    id: `xhs-${payload.page}-${index + 1}-${noteId || "unknown"}`,
    title,
    excerpt,
    tags: normalizeTags(card),
    metrics: formatMetrics(interactInfo),
    source: noteId ? `search_result/${noteId}` : `search_result/${payload.page}-${index + 1}`,
    noteId,
    noteType,
    author: clip(pickString(user, ["nickname", "nick_name", "name"]) || "未知作者", 40),
    imageUrl: extractSearchImageUrl(item),
    keyword: payload.keyword,
    lookupTime,
  };
}

function normalizeSearchData(envelope, payload, startedAt) {
  if (!assertObject(envelope)) {
    throw new CodexApiError("XHS_BAD_JSON", "xhs CLI JSON 必须是对象。", 502);
  }

  if (envelope.ok === false) {
    mapCliError(envelope.error);
  }

  if (envelope.ok !== true || !assertObject(envelope.data)) {
    throw new CodexApiError("XHS_BAD_JSON", "xhs CLI JSON 缺少 ok/data 字段。", 502);
  }

  const items = Array.isArray(envelope.data.items) ? envelope.data.items : [];
  const lookupTime = formatLookupTime(startedAt);
  return {
    items: items
      .map((item, index) => normalizeSearchItem(item, index, payload, lookupTime))
      .filter((item) => item.title || item.noteId),
    hasMore: Boolean(envelope.data.has_more),
  };
}

export function validateXhsSearchRequest(payload) {
  if (!assertObject(payload)) {
    throw new CodexApiError("BAD_REQUEST", "请求体必须是 JSON 对象。");
  }

  const keyword = safeString(payload.keyword);
  if (!keyword) {
    throw new CodexApiError("BAD_REQUEST", "请先填写创作关键词。");
  }

  const sort = safeString(payload.sort) || "popular";
  if (!VALID_SORTS.has(sort)) {
    throw new CodexApiError("BAD_REQUEST", "搜索排序无效。");
  }

  const type = safeString(payload.type) || "all";
  if (!VALID_TYPES.has(type)) {
    throw new CodexApiError("BAD_REQUEST", "搜索类型无效。");
  }

  const rawPage = Number(payload.page ?? 1);
  const page = Number.isInteger(rawPage) ? rawPage : 1;
  if (page < 1 || page > 20) {
    throw new CodexApiError("BAD_REQUEST", "搜索页码必须在 1 到 20 之间。");
  }

  return { keyword, sort, type, page };
}

export async function runXhsSearch(payload) {
  const cliCommand = resolveXhsCliCommand();
  const cookieSource = process.env.XHS_COOKIE_SOURCE || DEFAULT_COOKIE_SOURCE;
  const args = [
    "--cookie-source",
    cookieSource,
    "search",
    payload.keyword,
    "--sort",
    payload.sort,
    "--type",
    payload.type,
    "--page",
    String(payload.page),
    "--json",
  ];
  const startedAt = new Date();
  const startedAtMs = Date.now();

  try {
    await repairInvalidSearchSessionCache();
  } catch (error) {
    throw new CodexApiError(
      "XHS_CACHE_UNAVAILABLE",
      "无法检查小红书搜索会话缓存，请确认当前用户对 xhs 配置目录有读写权限。",
      502,
      sanitizeDetails(error?.message),
    );
  }

  const result = await new Promise((resolve, reject) => {
    const child = spawn(cliCommand, args, {
      cwd: repoRoot,
      env: buildXhsProcessEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new CodexApiError("XHS_FAILED", "xhs CLI 搜索超时，请稍后重试。", 504));
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new CodexApiError(
          "XHS_CLI_UNAVAILABLE",
          `无法启动 xhs CLI：${error.message}`,
          503,
        ),
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      try {
        if (!stdout.trim()) {
          throw new CodexApiError(
            "XHS_FAILED",
            "xhs CLI 搜索失败，未产生结果。",
            502,
            sanitizeDetails(stderr || `xhs exited with code ${code}`),
          );
        }
        const envelope = parseJsonOutput(stdout);
        const normalized = normalizeSearchData(envelope, payload, startedAt);
        if (code !== 0 && envelope.ok !== true) {
          mapCliError(envelope.error);
        }
        if (code !== 0) {
          throw new CodexApiError(
            "XHS_FAILED",
            `xhs CLI 搜索失败，退出码 ${code}。`,
            502,
            sanitizeDetails(stderr || stdout),
          );
        }
        resolve(normalized);
      } catch (error) {
        reject(error);
      }
    });
  });

  return {
    ...result,
    commandPreview: commandPreview(cliCommand, args),
    durationMs: Date.now() - startedAtMs,
  };
}
