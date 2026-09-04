async function requestJson(endpoint, payload, fallbackMessage, badJsonCode) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Object.assign(new Error(fallbackMessage.nonJson), {
      code: badJsonCode,
      details: text.slice(0, 400),
    });
  }

  if (!response.ok || !data.ok) {
    throw Object.assign(new Error(data.error || fallbackMessage.failed), {
      code: data.code || badJsonCode,
      details: data.details,
    });
  }

  return data;
}

export async function requestCodexGeneration(payload) {
  return requestJson(
    "/api/codex/generate",
    payload,
    {
      nonJson: "本地生成服务返回了非 JSON 内容。",
      failed: "Codex CLI 生成失败。",
    },
    "CODEX_BAD_JSON",
  );
}

export async function requestLocalCliDetection(payload = {}) {
  return requestJson(
    "/api/local-cli/detect",
    payload,
    {
      nonJson: "本地 CLI 检测服务返回了非 JSON 内容。",
      failed: "本地 CLI 检测失败。",
    },
    "LOCAL_CLI_BAD_JSON",
  );
}

export async function requestLocalCliGeneration(payload) {
  return requestJson(
    "/api/local-cli/generate",
    payload,
    {
      nonJson: "本地 CLI 生成服务返回了非 JSON 内容。",
      failed: "本地 CLI 生成失败。",
    },
    "LOCAL_CLI_BAD_JSON",
  );
}

export async function requestCloudGeneration(payload) {
  return requestJson(
    "/api/cloud/generate",
    payload,
    {
      nonJson: "云端文本 API 返回了非 JSON 内容。",
      failed: "云端文本 API 生成失败。",
    },
    "API_BAD_JSON",
  );
}

export async function requestCodexDecision(payload) {
  return requestJson(
    "/api/codex/decide",
    payload,
    {
      nonJson: "本地决策服务返回了非 JSON 内容。",
      failed: "Codex CLI 决策失败。",
    },
    "CODEX_BAD_JSON",
  );
}

export async function requestLocalCliDecision(payload) {
  return requestJson(
    "/api/local-cli/decide",
    payload,
    {
      nonJson: "本地 CLI 决策服务返回了非 JSON 内容。",
      failed: "本地 CLI 决策失败。",
    },
    "LOCAL_CLI_BAD_JSON",
  );
}

export async function requestCloudDecision(payload) {
  return requestJson(
    "/api/cloud/decide",
    payload,
    {
      nonJson: "云端文本 API 返回了非 JSON 内容。",
      failed: "云端文本 API 决策失败。",
    },
    "API_BAD_JSON",
  );
}

export async function requestCodexCoverImage(payload) {
  return requestJson(
    "/api/codex/cover-image",
    payload,
    {
      nonJson: "本地封面图服务返回了非 JSON 内容。",
      failed: "Codex CLI 封面图生成失败。",
    },
    "CODEX_BAD_JSON",
  );
}

export async function requestLocalCliCoverImage(payload) {
  return requestJson(
    "/api/local-cli/cover-image",
    payload,
    {
      nonJson: "本地 CLI 封面图服务返回了非 JSON 内容。",
      failed: "本地 CLI 封面图生成失败。",
    },
    "LOCAL_CLI_BAD_JSON",
  );
}

export async function requestCloudCoverImage(payload) {
  return requestJson(
    "/api/cloud/cover-image",
    payload,
    {
      nonJson: "云端图片 API 返回了非 JSON 内容。",
      failed: "云端图片 API 生成失败。",
    },
    "API_BAD_JSON",
  );
}

export async function requestXhsSearch(payload) {
  return requestJson(
    "/api/xhs/search",
    payload,
    {
      nonJson: "小红书搜索服务返回了非 JSON 内容。",
      failed: "小红书热门内容搜索失败。",
    },
    "XHS_BAD_JSON",
  );
}

export async function requestIntegrationCheck(payload) {
  return requestJson(
    "/api/integrations/check",
    payload,
    {
      nonJson: "集成检查服务返回了非 JSON 内容。",
      failed: "集成连接检查失败。",
    },
    "INTEGRATION_BAD_JSON",
  );
}
