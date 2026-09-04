const VALID_KINDS = new Set(["topics", "drafts", "coverPrompts"]);
const VALID_DECISION_KINDS = new Set(["rag", "topic", "draft", "coverPrompt"]);

export class CodexApiError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "CodexApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function validateRequest(payload) {
  if (!payload || typeof payload !== "object") {
    throw new CodexApiError("BAD_REQUEST", "请求体必须是 JSON 对象。");
  }

  if (!VALID_KINDS.has(payload.kind)) {
    throw new CodexApiError("BAD_REQUEST", "生成类型无效。");
  }

  if (!String(payload.persona ?? "").trim()) {
    throw new CodexApiError("BAD_REQUEST", "请先填写账号人设。");
  }

  if (!String(payload.keyword ?? "").trim()) {
    throw new CodexApiError("BAD_REQUEST", "请先填写创作关键词。");
  }

  if (!Array.isArray(payload.ragItems) || payload.ragItems.length === 0) {
    throw new CodexApiError("BAD_REQUEST", "请先将至少一条参考内容加入本地 RAG。");
  }

  if (payload.kind === "drafts" && !payload.selectedTopic?.title) {
    throw new CodexApiError("BAD_REQUEST", "请先选择一个选题。");
  }

  if (payload.kind === "coverPrompts" && !payload.selectedDraft?.title) {
    throw new CodexApiError("BAD_REQUEST", "请先选择一篇文案。");
  }
}

function validateBaseWorkflowPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new CodexApiError("BAD_REQUEST", "请求体必须是 JSON 对象。");
  }

  if (!String(payload.persona ?? "").trim()) {
    throw new CodexApiError("BAD_REQUEST", "请先填写账号人设。");
  }

  if (!String(payload.keyword ?? "").trim()) {
    throw new CodexApiError("BAD_REQUEST", "请先填写创作关键词。");
  }
}

export function validateDecisionRequest(payload) {
  validateBaseWorkflowPayload(payload);

  if (!VALID_DECISION_KINDS.has(payload.decisionKind)) {
    throw new CodexApiError("BAD_REQUEST", "决策类型无效。");
  }

  if (!Array.isArray(payload.options) || payload.options.length === 0) {
    throw new CodexApiError("BAD_REQUEST", "请提供可供模型决策的候选项。");
  }

  if (payload.options.length > 30) {
    throw new CodexApiError("BAD_REQUEST", "候选项过多，请控制在 30 条以内。");
  }

  const optionIds = new Set();
  for (const option of payload.options) {
    const id = typeof option?.id === "string" ? option.id.trim() : "";
    if (!id) {
      throw new CodexApiError("BAD_REQUEST", "每个候选项都必须包含 id。");
    }
    if (optionIds.has(id)) {
      throw new CodexApiError("BAD_REQUEST", `候选项 id 重复：${id}。`);
    }
    optionIds.add(id);
  }

  if (payload.decisionKind !== "rag" && (!Array.isArray(payload.ragItems) || payload.ragItems.length === 0)) {
    throw new CodexApiError("BAD_REQUEST", "请先将至少一条参考内容加入本地 RAG。");
  }

  if (payload.decisionKind === "draft" && !payload.selectedTopic?.title) {
    throw new CodexApiError("BAD_REQUEST", "请先选择一个选题。");
  }

  if (payload.decisionKind === "coverPrompt" && !payload.selectedDraft?.title) {
    throw new CodexApiError("BAD_REQUEST", "请先选择一篇文案。");
  }
}

function assertString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new CodexApiError("CODEX_BAD_JSON", `模型返回缺少字段：${fieldName}。`, 502);
  }
  return value.trim();
}

function pickString(item, fieldNames) {
  for (const fieldName of fieldNames) {
    const value = item?.[fieldName];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function assertStringField(item, fieldNames, fieldName) {
  const value = pickString(item, fieldNames);
  if (!value) {
    throw new CodexApiError("CODEX_BAD_JSON", `模型返回缺少字段：${fieldName}。`, 502);
  }
  return value;
}

function normalizeTopic(item, index) {
  const title = assertStringField(item, ["title", "标题", "选题标题"], "title");
  const angle = assertStringField(item, ["angle", "选题角度", "角度", "内容角度", "contentAngle"], "angle");
  const audience = assertStringField(
    item,
    ["audience", "目标受众", "受众", "适合人群", "targetAudience"],
    "audience",
  );
  const hook = assertStringField(item, ["hook", "内容爆点", "爆点", "钩子", "开头钩子", "sellingPoint"], "hook");
  const reason =
    pickString(item, ["reason", "推荐理由", "理由", "rationale", "why", "recommendationReason"]) ||
    `基于「${angle}」展开，适合${audience}，爆点是「${hook}」。`;

  return {
    id: `topic-${index + 1}`,
    title,
    angle,
    audience,
    reason,
    hook,
  };
}

function normalizeDraft(item, index, topicTitle) {
  const title = assertStringField(item, ["title", "标题", "文案标题", "copyTitle"], "title");
  const body = assertStringField(
    item,
    ["body", "正文", "文案正文", "content", "copy", "copyBody"],
    "body",
  );
  if (!/#.+?\[话题\]#/.test(body)) {
    throw new CodexApiError("CODEX_BAD_JSON", "模型返回的文案正文缺少小红书话题标签。", 502);
  }

  const coverDirection = pickString(item, [
    "coverDirection",
    "cover_direction",
    "coverDirectionSuggestion",
    "cover_direction_suggestion",
    "coverSuggestion",
    "封面方向",
    "封面方向建议",
    "封面建议",
  ]) || `围绕「${title}」制作信息清晰的静物封面，突出核心方法与关键词。`;

  return {
    id: `draft-${index + 1}`,
    title,
    body,
    coverDirection,
    topicTitle,
  };
}

function normalizePrompt(item, index) {
  const title = assertStringField(item, ["title", "标题", "封面标题", "promptTitle"], "title");
  const prompt = assertStringField(
    item,
    ["prompt", "coverPrompt", "cover_prompt", "imagePrompt", "image_prompt", "封面Prompt", "封面提示词", "提示词"],
    "prompt",
  );
  const hasBoundary =
    /(真人|人物|人像|人类|模特|people|person|human|portrait)/i.test(prompt) &&
    /(脸|面部|面孔|五官|face|facial)/i.test(prompt) &&
    /(手|手部|手指|hand|finger)/i.test(prompt) &&
    /(动物|宠物|animal|pet)/i.test(prompt);

  if (!hasBoundary) {
    throw new CodexApiError("CODEX_BAD_JSON", "模型返回的封面 Prompt 未明确排除真人、脸、手和动物。", 502);
  }

  return {
    id: `prompt-${index + 1}`,
    title,
    prompt,
  };
}

export function parseJsonFromCodex(raw) {
  const text = String(raw ?? "").trim();
  if (!text) {
    throw new CodexApiError("CODEX_BAD_JSON", "模型没有返回内容。", 502);
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
        // Fall through to a consistent user-facing error.
      }
    }
  }

  throw new CodexApiError("CODEX_BAD_JSON", "模型返回内容不是合法 JSON。", 502, text.slice(0, 600));
}

export function normalizeDecisionResult(parsed, payload) {
  const rawSelectedIds = Array.isArray(parsed?.selectedIds)
    ? parsed.selectedIds
    : typeof parsed?.selectedId === "string"
      ? [parsed.selectedId]
      : [];

  const selectedIds = rawSelectedIds
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter(Boolean);

  const optionIds = new Set(payload.options.map((option) => String(option.id).trim()));
  const invalidIds = selectedIds.filter((id) => !optionIds.has(id));
  const uniqueSelectedIds = new Set(selectedIds);

  if (uniqueSelectedIds.size !== selectedIds.length) {
    throw new CodexApiError("CODEX_BAD_JSON", "模型决策返回了重复的候选项 id。", 502);
  }

  if (invalidIds.length > 0) {
    throw new CodexApiError(
      "CODEX_BAD_JSON",
      `模型决策返回了不存在的候选项 id：${invalidIds.join(", ")}。`,
      502,
    );
  }

  if (payload.decisionKind === "rag") {
    if (selectedIds.length < 1 || selectedIds.length > 8) {
      throw new CodexApiError("CODEX_BAD_JSON", "RAG 决策必须返回 1 到 8 个候选项 id。", 502);
    }
  } else if (selectedIds.length !== 1) {
    throw new CodexApiError("CODEX_BAD_JSON", "该决策必须且只能返回 1 个候选项 id。", 502);
  }

  return {
    selectedIds,
    reason: typeof parsed?.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : "模型已根据当前人设、关键词、撰写思路和候选内容完成选择。",
  };
}

export function normalizeCodexItems(kind, parsed, payload) {
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new CodexApiError("CODEX_BAD_JSON", "模型 JSON 必须包含 items 数组。", 502);
  }

  const expectedCount = kind === "topics" ? 10 : 5;
  if (parsed.items.length !== expectedCount) {
    throw new CodexApiError(
      "CODEX_BAD_JSON",
      `模型返回数量不正确：需要 ${expectedCount} 条，实际 ${parsed.items.length} 条。`,
      502,
    );
  }

  if (kind === "topics") {
    return parsed.items.map(normalizeTopic);
  }

  if (kind === "drafts") {
    return parsed.items.map((item, index) => normalizeDraft(item, index, payload.selectedTopic.title));
  }

  return parsed.items.map(normalizePrompt);
}
