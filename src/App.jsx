import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  BriefcaseBusiness,
  CloudCog,
  Heart,
  House,
  MessageCircle,
  PlaneTakeoff,
  Search,
  SquareTerminal,
  TentTree,
} from "lucide-react";
import {
  requestCloudCoverImage,
  requestCloudDecision,
  requestCloudGeneration,
  requestLocalCliCoverImage,
  requestLocalCliDecision,
  requestLocalCliDetection,
  requestLocalCliGeneration,
  requestIntegrationCheck,
  requestXhsSearch,
} from "./codexClient.js";

const STORAGE_PREFIX = "mint-atelier-v2";

const defaultPersona = "26岁职场博主，分享AI产品经理的求职经验、工作plog、vlog。表达温柔具体，重点放在真实工作体验和可复用公式。";
const defaultKeyword = "职场日常";
const defaultBrief = "创作上班族可收藏实用plog、vlog内容，核心突出职场核心气质。吸引用户，口吻贴近朋友走心分享。";

const defaultModelConfig = {
  text: {
    provider: "cloud",
    cliId: "codex",
    cliCommand: "",
    modelName: "deepseek-v4-pro",
    apiKey: "",
    baseUrl: "https://api.deepseek.com",
  },
  image: {
    provider: "local",
    cliId: "codex",
    cliCommand: "",
    modelName: "Codex CLI / imagegen skill",
    apiKey: "",
    baseUrl: "",
  },
};

const defaultIntegrationHealth = {
  codex: { state: "idle", message: "尚未检查 Codex 登录与真实调用。", code: "" },
  "cloud-text": { state: "idle", message: "尚未检查 DeepSeek API。", code: "" },
  xhs: { state: "idle", message: "尚未检查小红书 CLI 与登录状态。", code: "" },
};

const defaultLocalClis = [
  {
    id: "codex",
    label: "Codex CLI",
    description: "Codex 原生非交互模式",
    capabilities: { text: true, image: true },
    available: null,
    commandPreview: "codex exec ...",
  },
  {
    id: "kimi",
    label: "Kimi CLI",
    description: "Kimi Code CLI stream-json 模式",
    capabilities: { text: true, image: false },
    available: null,
    commandPreview: "kimi --prompt ... --output-format stream-json",
  },
  {
    id: "claude",
    label: "Claude Code",
    description: "Claude Code 非交互 JSON 模式",
    capabilities: { text: true, image: false },
    available: null,
    commandPreview: "claude --print ... --output-format json",
  },
  {
    id: "custom",
    label: "自定义规范 CLI",
    description: "支持 --prompt、--model 与 stream-json 输出",
    capabilities: { text: true, image: false },
    available: null,
    commandPreview: "[cli] --prompt ... --output-format stream-json",
  },
];

const flowSteps = [
  { id: "input", label: "人设关键词", meta: "账号约束" },
  { id: "research", label: "热门搜索", meta: "手动触发" },
  { id: "rag", label: "RAG 入库", meta: "勾选确认" },
  { id: "topics", label: "生成选题", meta: "10 个候选" },
  { id: "drafts", label: "生成文案", meta: "5 篇草稿" },
  { id: "cover", label: "封面生成", meta: "Prompt 到图" },
];

const generationLabels = {
  topics: "选题",
  drafts: "文案",
  coverPrompts: "封面 Prompt",
};

const stageIconSources = {
  persona: "/assets/stage-icons/persona-3d-clean.png",
  search: "/assets/stage-icons/search-3d.png",
  rag: "/assets/stage-icons/rag-3d-clean.png",
  topics: "/assets/stage-icons/topics-3d-clean.png",
  writing: "/assets/stage-icons/writing-3d.png",
  preview: "/assets/stage-icons/preview-3d-clean.png",
  coverPrompt: "/assets/stage-icons/cover-prompt-3d-clean.png",
  coverResult: "/assets/stage-icons/cover-result-3d-clean.png",
};

const decisionLabels = {
  rag: "RAG 参考",
  topic: "选题",
  draft: "文案",
  coverPrompt: "封面 Prompt",
};

const sidebarProjects = [
  { title: "大厂日常分享", meta: "新版流程草稿", active: true, icon: BriefcaseBusiness, tone: "mint" },
  { title: "治愈系家居好物", meta: "待补参考", icon: House, tone: "pink" },
  { title: "露营装备红榜", meta: "选题阶段", icon: TentTree, tone: "lavender" },
  { title: "轻便出行搭配", meta: "封面待生成", icon: PlaneTakeoff, tone: "blue" },
];

const errorMessages = {
  search: "搜索失败：请确认关键词不为空，并检查 xhs CLI 登录状态或网络状态后重试。",
  rag: "RAG 加入失败：请先勾选至少一条搜索结果，再点击加入本地知识库。",
  topics: "选题生成失败：请补充人设、关键词，并至少加入一条参考内容。",
  drafts: "文案生成失败：请先选择一个选题，并补充必要的撰写思路。",
  prompts: "封面 Prompt 生成失败：请先选择一篇文案。",
  image: "封面图生成失败：已保留原始 Prompt，可以检查图片模型配置后重新生成。",
  config: "模型配置缺失：云端 API 需要填写 API Key、API Base URL 和模型名称。",
  key: "API Key 无效：请检查密钥是否完整，或切换到本地 CLI 运行方式。",
  cli: "本地 CLI 不可用：请先检测并选择已安装、已登录且支持当前能力的 CLI。",
  network: "网络请求失败：请检查代理、API Base URL 或稍后重试。",
};

function useStoredState(key, initialValue) {
  const storageKey = `${STORAGE_PREFIX}:${key}`;
  const [value, setValue] = useState(() => {
    try {
      const storedValue = window.localStorage.getItem(storageKey);
      return storedValue ? JSON.parse(storedValue) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Local storage can be unavailable in private or embedded contexts.
    }
  }, [storageKey, value]);

  return [value, setValue];
}

function nowText() {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function isCloudPlaceholderModel(value) {
  return /codex\s*cli|imagegen\s*skill|本地\s*cli/i.test(String(value ?? ""));
}

function SoftIcon({ children, tone = "mint" }) {
  return <span className={`soft-icon ${tone}`}>{children}</span>;
}

function StageBadge({ children, tone = "mint" }) {
  return <span className={`stage-badge ${tone}`}>{children}</span>;
}

function StageIcon({ name }) {
  return <img className="stage-icon-image" src={stageIconSources[name]} alt="" aria-hidden="true" />;
}

function SectionHeader({ icon, tone = "mint", title, meta, action }) {
  return (
    <header className="section-header">
      <div>
        <SoftIcon tone={tone}>{icon}</SoftIcon>
        <span>
          <h2>{title}</h2>
          {meta ? <p>{meta}</p> : null}
        </span>
      </div>
      {action}
    </header>
  );
}

function ProviderSwitch({ value, onChange }) {
  return (
    <div className="provider-switch">
      {[
        ["local", "本地 CLI"],
        ["cloud", "云端 API"],
      ].map(([provider, label]) => (
        <button
          key={provider}
          className={value === provider ? "selected" : ""}
          onClick={() => onChange(provider)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SearchThumbnail({ src, title }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className="search-thumbnail fallback" aria-hidden="true">图</span>;
  }

  return (
    <span className="search-thumbnail">
      <img
        src={src}
        alt={`${title} 搜索封面`}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

function IntegrationHealthPanel({ health, checkingTarget, onCheck }) {
  const integrations = [
    { id: "xhs", label: "小红书搜索", icon: Search, tone: "yellow" },
    { id: "codex", label: "Codex CLI", icon: SquareTerminal, tone: "mint" },
    { id: "cloud-text", label: "DeepSeek API", icon: CloudCog, tone: "lavender" },
  ];

  return (
    <section className="integration-card clay-panel">
      <header className="integration-card-header">
        <div>
          <h2>三路连接检查</h2>
          <p>仅在点击时检查。</p>
        </div>
        <StageBadge tone="mint">主动检测</StageBadge>
      </header>
      <div className="integration-list">
        {integrations.map((integration) => {
          const result = health[integration.id] || defaultIntegrationHealth[integration.id];
          const checking = checkingTarget === integration.id;
          const IntegrationIcon = integration.icon;
          return (
            <article className={`integration-item ${result.state}`} key={integration.id}>
              <SoftIcon tone={integration.tone}><IntegrationIcon aria-hidden="true" /></SoftIcon>
              <div>
                <strong>{integration.label}</strong>
                <p>{checking ? "正在进行真实连接检查..." : result.message}</p>
                {result.version ? <small>{result.version}</small> : null}
                {result.code ? <code>{result.code}</code> : null}
              </div>
              <button type="button" onClick={() => onCheck(integration.id)} disabled={Boolean(checkingTarget)}>
                {checking ? "检查中" : "检查"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ModelConfig({
  channel,
  title,
  tone,
  icon,
  value,
  onChange,
  localClis,
  detectionState,
  onDetect,
}) {
  const update = (field, nextValue) => onChange({ ...value, [field]: nextValue });
  const selectedCliId = value.cliId || "codex";
  const selectedCli = localClis.find((item) => item.id === selectedCliId) || localClis[0];
  const availableClis = localClis.filter((item) => item.capabilities?.[channel]);
  const localDescription = selectedCli
    ? `${selectedCli.label} · ${selectedCli.description}`
    : "本地 CLI 路线";
  const cloudDescription = title === "图片生成"
    ? "云端 Images API 路线"
    : "云端 Chat Completions 路线";

  const changeCli = (cliId) => {
    const defaults = {
      codex: channel === "image" ? "Codex CLI / imagegen skill" : "Codex CLI / gpt-5-codex",
      kimi: "",
      claude: "",
      custom: "",
    };
    onChange({
      ...value,
      cliId,
      cliCommand: value.cliCommand || "",
      modelName: defaults[cliId] ?? "",
    });
  };

  const changeProvider = (provider) => {
    const switchingToCloudText = provider === "cloud" && channel === "text";
    const switchingToLocal = provider === "local";
    onChange({
      ...value,
      provider,
      modelName: switchingToCloudText
        ? (/codex\s*cli|imagegen\s*skill/i.test(value.modelName || "") ? "deepseek-v4-pro" : value.modelName || "deepseek-v4-pro")
        : switchingToLocal && /deepseek/i.test(value.modelName || "")
          ? (channel === "image" ? "Codex CLI / imagegen skill" : "Codex CLI / gpt-5-codex")
          : value.modelName,
      baseUrl: switchingToCloudText ? value.baseUrl || "https://api.deepseek.com" : value.baseUrl,
    });
  };

  return (
    <article className="model-config-block">
      <header>
        <SoftIcon tone={tone}>{icon}</SoftIcon>
        <div>
          <h3>{title}</h3>
          <p>{value.provider === "local" ? localDescription : cloudDescription}</p>
        </div>
      </header>
      <ProviderSwitch value={value.provider} onChange={changeProvider} />
      {value.provider === "local" ? (
        <>
          <label className="mini-field">
            <span>本机 CLI</span>
            <select value={selectedCliId} onChange={(event) => changeCli(event.target.value)}>
              {availableClis.map((cli) => (
                <option key={cli.id} value={cli.id} disabled={cli.available === false}>
                  {cli.label}{cli.available === true ? " · 可用" : cli.available === false ? " · 不可用" : ""}
                </option>
              ))}
            </select>
          </label>
          {selectedCliId === "custom" ? (
            <label className="mini-field">
              <span>CLI 命令或绝对路径</span>
              <input
                value={value.cliCommand || ""}
                onChange={(event) => update("cliCommand", event.target.value)}
                placeholder="例如 my-agent-cli 或 /opt/bin/my-agent-cli"
              />
            </label>
          ) : null}
          <label className="mini-field">
            <span>模型别名（可留空使用 CLI 默认值）</span>
            <input
              value={value.modelName || ""}
              onChange={(event) => update("modelName", event.target.value)}
              placeholder={
                selectedCliId === "kimi"
                  ? "例如 kimi-code/k3"
                  : selectedCliId === "claude"
                    ? "例如 sonnet 或 opus"
                    : "留空使用 CLI 当前默认模型"
              }
            />
          </label>
          <div className="cli-detection-row">
            <button type="button" onClick={onDetect} disabled={detectionState === "running"}>
              {detectionState === "running" ? "检测中..." : "检测本机 CLI"}
            </button>
            <span className={selectedCli?.available === true ? "ready" : selectedCli?.available === false ? "missing" : ""}>
              {selectedCli?.available === true
                ? `${selectedCli.version || "已安装"}`
                : selectedCli?.available === false
                  ? "当前不可用"
                  : "点击检测安装状态"}
            </span>
          </div>
        </>
      ) : (
        <>
          <label className="mini-field">
            <span>模型名称</span>
            <input value={value.modelName} onChange={(event) => update("modelName", event.target.value)} />
          </label>
          <label className="mini-field">
            <span>API Key</span>
            <input
              value={value.apiKey}
              onChange={(event) => update("apiKey", event.target.value)}
              placeholder="必填"
              type="password"
            />
          </label>
          <label className="mini-field">
            <span>API Base URL</span>
            <input
              value={value.baseUrl}
              onChange={(event) => update("baseUrl", event.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </label>
        </>
      )}
    </article>
  );
}

export function App() {
  const personaRef = useRef(null);
  const keywordRef = useRef(null);
  const writingBriefRef = useRef(null);
  const [persona, setPersona] = useStoredState("persona", defaultPersona);
  const [keyword, setKeyword] = useStoredState("keyword", defaultKeyword);
  const [writingBrief, setWritingBrief] = useStoredState("writingBrief", defaultBrief);
  const [modelConfig, setModelConfig] = useStoredState("modelConfig", defaultModelConfig);
  const [localClis, setLocalClis] = useState(defaultLocalClis);
  const [cliDetectionState, setCliDetectionState] = useState("idle");
  const [integrationHealth, setIntegrationHealth] = useState(defaultIntegrationHealth);
  const [checkingIntegration, setCheckingIntegration] = useState("");
  const [activeStep, setActiveStep] = useState("input");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedSearchIds, setSelectedSearchIds] = useState([]);
  const [ragItems, setRagItems] = useState([]);
  const [topics, setTopics] = useState([]);
  const [selectedTopicId, setSelectedTopicId] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [selectedDraftId, setSelectedDraftId] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const [selectedPromptId, setSelectedPromptId] = useState(null);
  const [coverImage, setCoverImage] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [generatingKind, setGeneratingKind] = useState("");
  const [automationRunning, setAutomationRunning] = useState(false);
  const [automationStage, setAutomationStage] = useState("");
  const [cliStatus, setCliStatus] = useState({
    state: "idle",
    label: "生成通道",
    text: "尚未调用生成服务。",
    commandPreview: "",
    durationMs: null,
    generatedAt: "",
    code: "",
  });
  const [notice, setNotice] = useState({
    type: "ready",
    text: "已加载新版阶段式工作台，支持手动逐步确认或一次点击自动化生成。",
  });

  const selectedTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedTopicId),
    [selectedTopicId, topics],
  );
  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === selectedDraftId),
    [drafts, selectedDraftId],
  );
  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === selectedPromptId),
    [prompts, selectedPromptId],
  );

  const progress = useMemo(() => {
    const checks = [
      persona.trim().length > 0,
      keyword.trim().length > 0,
      searchResults.length > 0,
      ragItems.length > 0,
      topics.length > 0 && selectedTopic,
      drafts.length > 0 && selectedDraft,
      prompts.length > 0 && selectedPrompt,
      Boolean(coverImage),
    ];

    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [
    coverImage,
    drafts.length,
    keyword,
    persona,
    prompts.length,
    ragItems.length,
    searchResults.length,
    selectedDraft,
    selectedPrompt,
    selectedTopic,
    topics.length,
  ]);

  const setError = (key) => {
    setNotice({ type: "error", text: errorMessages[key] });
  };

  const setSuccess = (text) => {
    setNotice({ type: "success", text });
  };

  const setCustomError = (text) => {
    setNotice({ type: "error", text });
  };

  const isBusy = Boolean(generatingKind) || automationRunning;

  const updateModelConfig = (channel, value) => {
    setModelConfig((current) => ({ ...current, [channel]: value }));
  };

  const channelConfig = (channel) => ({
    ...defaultModelConfig[channel],
    ...(modelConfig[channel] || {}),
    cliId: modelConfig[channel]?.cliId || "codex",
    cliCommand: modelConfig[channel]?.cliCommand || "",
  });

  const checkIntegrationHealth = async (target) => {
    const textConfig = channelConfig("text");
    if (target === "cloud-text" && (!textConfig.modelName?.trim() || !textConfig.apiKey?.trim() || !textConfig.baseUrl?.trim())) {
      const message = "请先在文案生成中选择云端 API，并填写 DeepSeek 模型、API Key 和 Base URL。";
      setIntegrationHealth((current) => ({
        ...current,
        [target]: { state: "error", message, code: "API_CONFIG_MISSING" },
      }));
      setCustomError(message);
      return;
    }

    setCheckingIntegration(target);
    setIntegrationHealth((current) => ({
      ...current,
      [target]: { ...current[target], state: "running", code: "" },
    }));

    try {
      const result = await requestIntegrationCheck({
        target,
        ...(target === "cloud-text" ? {
          modelName: textConfig.modelName,
          apiKey: textConfig.apiKey,
          baseUrl: textConfig.baseUrl,
        } : {}),
      });
      const next = {
        ...result,
        state: result.healthy ? "success" : "error",
      };
      setIntegrationHealth((current) => ({ ...current, [target]: next }));
      if (result.healthy) setSuccess(result.message);
      else setCustomError(result.message);
    } catch (error) {
      const message = error?.message || "集成连接检查失败。";
      setIntegrationHealth((current) => ({
        ...current,
        [target]: { state: "error", message, code: error?.code || "INTEGRATION_CHECK_FAILED" },
      }));
      setCustomError(message);
    } finally {
      setCheckingIntegration("");
    }
  };

  const detectConfiguredClis = async () => {
    const textConfig = channelConfig("text");
    setCliDetectionState("running");
    setCliStatus({
      state: "running",
      label: "本机 CLI 检测",
      text: "正在检测 Codex、Kimi、Claude 与当前自定义规范 CLI...",
      commandPreview: "[cli] --version",
      durationMs: null,
      generatedAt: "",
      code: "",
    });
    try {
      const result = await requestLocalCliDetection({
        customCommand: textConfig.cliId === "custom" ? textConfig.cliCommand : "",
      });
      const nextClis = defaultLocalClis.map((fallback) => (
        result.clis.find((item) => item.id === fallback.id) || fallback
      ));
      setLocalClis(nextClis);
      setCliDetectionState("success");
      const availableLabels = nextClis
        .filter((item) => item.available)
        .map((item) => `${item.label}${item.version ? ` ${item.version}` : ""}`);
      const text = availableLabels.length
        ? `检测完成：${availableLabels.join("、")} 可用。`
        : "未检测到可用的本机生成 CLI。";
      setCliStatus({
        state: availableLabels.length ? "success" : "error",
        label: "本机 CLI 检测",
        text,
        commandPreview: "[cli] --version",
        durationMs: null,
        generatedAt: result.generatedAt,
        code: availableLabels.length ? "" : "LOCAL_CLI_UNAVAILABLE",
      });
      if (availableLabels.length) setSuccess(text);
      else setCustomError(text);
    } catch (error) {
      const message = error?.message || "本机 CLI 检测失败。";
      setCliDetectionState("error");
      setCliStatus({
        state: "error",
        label: "本机 CLI 检测",
        text: message,
        commandPreview: "",
        durationMs: null,
        generatedAt: "",
        code: error?.code || "LOCAL_CLI_UNAVAILABLE",
      });
      setCustomError(message);
    }
  };

  const requireModelConfig = (channel) => {
    const config = channelConfig(channel);
    if (config.provider === "cloud") {
      if (!config.modelName.trim() || !config.apiKey.trim() || !config.baseUrl.trim() || isCloudPlaceholderModel(config.modelName)) {
        setError("config");
        return false;
      }
      try {
        const baseUrl = new URL(config.baseUrl.trim());
        if (!["http:", "https:"].includes(baseUrl.protocol)) {
          setCustomError("API Base URL 只支持 http 或 https。");
          return false;
        }
      } catch {
        setCustomError("API Base URL 不是合法 URL。");
        return false;
      }
    } else {
      if (config.cliId === "custom" && !config.cliCommand.trim()) {
        setCustomError("请填写自定义规范 CLI 的命令名或绝对路径。");
        return false;
      }
      const selectedCli = localClis.find((item) => item.id === config.cliId);
      if (selectedCli?.available === false) {
        setCustomError(`${selectedCli.label} 当前不可用，请重新检测或选择其他 CLI。`);
        return false;
      }
      if (selectedCli && !selectedCli.capabilities?.[channel]) {
        setCustomError(`${selectedCli.label} 不支持${channel === "image" ? "图片" : "文本"}生成。`);
        return false;
      }
    }
    return true;
  };

  const requireTextModel = () => requireModelConfig("text");

  const requireImageModel = () => requireModelConfig("image");

  const providerLabel = (channel) => {
    const config = channelConfig(channel);
    if (config.provider === "cloud") {
      return channel === "image" ? "云端图片 API" : "云端文本 API";
    }
    const cli = localClis.find((item) => item.id === config.cliId);
    return `本地 ${cli?.label || "CLI"}`;
  };

  const providerPreview = (channel) => {
    const config = channelConfig(channel);
    if (config.provider === "local") {
      const cli = localClis.find((item) => item.id === config.cliId);
      return cli?.commandPreview || "[cli] --prompt ...";
    }
    const endpoint = channel === "image" ? "/images/generations" : "/chat/completions";
    try {
      const url = new URL(config.baseUrl.trim());
      const currentPath = url.pathname.replace(/\/+$/, "");
      if (!currentPath.toLowerCase().endsWith(endpoint.toLowerCase())) {
        url.pathname = `${currentPath}/${endpoint.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
      }
      url.search = "";
      url.hash = "";
      return `POST ${url.toString()}`;
    } catch {
      return `POST ${endpoint}`;
    }
  };

  const requestPayloadConfig = (channel) => {
    const config = channelConfig(channel);
    if (config.provider !== "cloud") {
      return {
        cliId: config.cliId,
        cliCommand: config.cliCommand,
        modelName: config.modelName,
      };
    }

    return {
      modelName: config.modelName,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    };
  };

  const workflowContext = (overrides = {}) => ({
    persona: overrides.persona ?? persona,
    keyword: overrides.keyword ?? keyword,
    ragItems: overrides.ragItems ?? ragItems,
    writingBrief: overrides.writingBrief ?? writingBrief,
  });

  const requestTextItems = async (kind, payload = {}, contextOverrides = {}) => {
    const requestGeneration =
      channelConfig("text").provider === "cloud" ? requestCloudGeneration : requestLocalCliGeneration;
    const context = workflowContext(contextOverrides);
    const result = await requestGeneration({
      kind,
      persona: context.persona,
      keyword: context.keyword,
      ragItems: context.ragItems,
      writingBrief: context.writingBrief,
      ...requestPayloadConfig("text"),
      ...payload,
    });

    return {
      items: result.items,
      routeLabel: providerLabel("text"),
      commandPreview: result.commandPreview,
      durationMs: result.durationMs,
      generatedAt: result.generatedAt,
    };
  };

  const requestDecision = async (decisionKind, options, contextOverrides = {}, payload = {}) => {
    const routeLabel = providerLabel("text");
    const decisionLabel = decisionLabels[decisionKind] ?? "候选项";
    const requestModelDecision =
      channelConfig("text").provider === "cloud" ? requestCloudDecision : requestLocalCliDecision;
    const context = workflowContext(contextOverrides);

    setGeneratingKind(`decision-${decisionKind}`);
    setCliStatus({
      state: "running",
      label: routeLabel,
      text: `正在通过 ${routeLabel} 选择${decisionLabel}...`,
      commandPreview: providerPreview("text"),
      durationMs: null,
      generatedAt: "",
      code: "",
    });

    const result = await requestModelDecision({
      decisionKind,
      persona: context.persona,
      keyword: context.keyword,
      ragItems: context.ragItems,
      writingBrief: context.writingBrief,
      options,
      ...requestPayloadConfig("text"),
      ...payload,
    });

    setCliStatus({
      state: "success",
      label: routeLabel,
      text: `${routeLabel} 已选择${decisionLabel}：${result.reason}`,
      commandPreview: result.commandPreview,
      durationMs: result.durationMs,
      generatedAt: result.generatedAt,
      code: "",
    });

    return { ...result, routeLabel };
  };

  const requestCoverImageResult = async (prompt, selectedDraftValue, contextOverrides = {}) => {
    const requestCoverImage =
      channelConfig("image").provider === "cloud" ? requestCloudCoverImage : requestLocalCliCoverImage;
    const context = workflowContext(contextOverrides);

    return requestCoverImage({
      persona: context.persona,
      keyword: context.keyword,
      selectedDraft: selectedDraftValue,
      selectedPrompt: prompt,
      prompt: prompt.prompt,
      ...requestPayloadConfig("image"),
    });
  };

  const runTextGeneration = async (kind, payload) => {
    const label = generationLabels[kind];
    const routeLabel = providerLabel("text");
    setGeneratingKind(kind);
    setCliStatus({
      state: "running",
      label: routeLabel,
      text: `正在通过 ${routeLabel} 生成${label}...`,
      commandPreview: providerPreview("text"),
      durationMs: null,
      generatedAt: "",
      code: "",
    });

    try {
      const result = await requestTextItems(kind, payload);

      setCliStatus({
        state: "success",
        label: routeLabel,
        text: `${routeLabel} 已生成 ${result.items.length} 条${label}。`,
        commandPreview: result.commandPreview,
        durationMs: result.durationMs,
        generatedAt: result.generatedAt,
        code: "",
      });
      return { items: result.items, routeLabel };
    } catch (error) {
      const message = error?.message || `${routeLabel}生成失败。`;
      setCliStatus({
        state: "error",
        label: routeLabel,
        text: message,
        commandPreview: "",
        durationMs: null,
        generatedAt: "",
        code: error?.code || "GENERATION_FAILED",
      });
      setCustomError(message);
      return false;
    } finally {
      setGeneratingKind("");
    }
  };

  const runSearch = async () => {
    if (!keyword.trim()) {
      setError("search");
      return;
    }

    const trimmedKeyword = keyword.trim();
    setGeneratingKind("search");
    setCliStatus({
      state: "running",
      label: "小红书 CLI 搜索",
      text: `正在通过本机 xhs 搜索「${trimmedKeyword}」...`,
      commandPreview: `xhs --cookie-source none search "${trimmedKeyword}" --sort popular --type all --page 1 --json`,
      durationMs: null,
      generatedAt: "",
      code: "",
    });

    try {
      const result = await requestXhsSearch({
        keyword: trimmedKeyword,
        sort: "popular",
        type: "all",
        page: 1,
      });

      setSearchResults(result.items);
      setSelectedSearchIds([]);
      setActiveStep("research");
      setCliStatus({
        state: "success",
        label: "小红书 CLI 搜索",
        text: `xhs 已返回 ${result.items.length} 条热门内容，结果尚未自动入库。`,
        commandPreview: result.commandPreview,
        durationMs: result.durationMs,
        generatedAt: result.generatedAt,
        code: "",
      });
      setSuccess(`已通过本机 xhs 搜索「${trimmedKeyword}」，结果尚未自动入库。`);
    } catch (error) {
      const message = error?.message || "小红书热门内容搜索失败。";
      setSearchResults([]);
      setSelectedSearchIds([]);
      setActiveStep("research");
      setCliStatus({
        state: "error",
        label: "小红书 CLI 搜索",
        text: message,
        commandPreview: "",
        durationMs: null,
        generatedAt: "",
        code: error?.code || "XHS_FAILED",
      });
      setCustomError(message);
    } finally {
      setGeneratingKind("");
    }
  };

  const resetGeneratedState = () => {
    setSearchResults([]);
    setSelectedSearchIds([]);
    setRagItems([]);
    setTopics([]);
    setSelectedTopicId(null);
    setDrafts([]);
    setSelectedDraftId(null);
    setPrompts([]);
    setSelectedPromptId(null);
    setCoverImage(null);
  };

  const toggleSearchResult = (id) => {
    setSelectedSearchIds((current) =>
      current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id],
    );
  };

  const addToRag = () => {
    if (selectedSearchIds.length === 0) {
      setError("rag");
      return;
    }

    const selectedItems = searchResults.filter((result) => selectedSearchIds.includes(result.id));
    setRagItems((current) => {
      const existingIds = new Set(current.map((item) => item.id));
      return [...current, ...selectedItems.filter((item) => !existingIds.has(item.id))];
    });
    setActiveStep("rag");
    setSuccess(`已加入 ${selectedItems.length} 条参考内容到本地 RAG。`);
  };

  const generateTopics = async () => {
    if (!persona.trim() || !keyword.trim() || ragItems.length === 0) {
      setError("topics");
      return;
    }
    if (!requireTextModel()) return;

    const result = await runTextGeneration("topics", {});
    if (!result) return;
    const nextTopics = result.items;

    setTopics(nextTopics);
    setSelectedTopicId(nextTopics[0].id);
    setDrafts([]);
    setSelectedDraftId(null);
    setPrompts([]);
    setSelectedPromptId(null);
    setCoverImage(null);
    setActiveStep("topics");
    setSuccess(`已通过 ${result.routeLabel} 生成 10 个选题。`);
  };

  const generateDrafts = async () => {
    if (!selectedTopic) {
      setError("drafts");
      return;
    }
    if (!requireTextModel()) return;

    const result = await runTextGeneration("drafts", { selectedTopic });
    if (!result) return;
    const nextDrafts = result.items;

    setDrafts(nextDrafts);
    setSelectedDraftId(nextDrafts[0].id);
    setPrompts([]);
    setSelectedPromptId(null);
    setCoverImage(null);
    setActiveStep("drafts");
    setSuccess(`已通过 ${result.routeLabel} 生成 5 篇文案，可选择一篇继续生成封面 Prompt。`);
  };

  const generatePrompts = async () => {
    if (!selectedDraft) {
      setError("prompts");
      return;
    }
    if (!requireTextModel()) return;

    const result = await runTextGeneration("coverPrompts", {
      selectedTopic,
      selectedDraft,
    });
    if (!result) return;
    const nextPrompts = result.items;

    setPrompts(nextPrompts);
    setSelectedPromptId(nextPrompts[0].id);
    setCoverImage(null);
    setActiveStep("cover");
    setSuccess(`已通过 ${result.routeLabel} 生成 5 份封面 Prompt，默认不包含真人、脸、手和动物。`);
  };

  const generateCoverImage = async (promptId = selectedPromptId) => {
    const prompt = prompts.find((item) => item.id === promptId);
    if (!prompt) {
      setError("image");
      return;
    }
    if (!requireImageModel()) return;

    const routeLabel = providerLabel("image");
    setSelectedPromptId(promptId);
    setGeneratingKind("coverImage");
    setCliStatus({
      state: "running",
      label: routeLabel,
      text: `正在通过 ${routeLabel} 生成封面图...`,
      commandPreview: providerPreview("image"),
      durationMs: null,
      generatedAt: "",
      code: "",
    });

    try {
      const result = await requestCoverImageResult(prompt, selectedDraft);

      setCoverImage({
        promptId,
        src: result.image.src,
        alt: result.image.alt,
        title: result.image.title,
        createdAt: nowText(),
        generatedAt: result.generatedAt,
      });
      setCliStatus({
        state: "success",
        label: routeLabel,
        text: `${routeLabel} 已生成封面图。`,
        commandPreview: result.commandPreview,
        durationMs: result.durationMs,
        generatedAt: result.generatedAt,
        code: "",
      });
      setActiveStep("cover");
      setSuccess(`已通过 ${routeLabel} 生成封面图，原始 Prompt 已保留。`);
    } catch (error) {
      const message = error?.message || `${routeLabel}封面图生成失败。`;
      setCliStatus({
        state: "error",
        label: routeLabel,
        text: message,
        commandPreview: "",
        durationMs: null,
        generatedAt: "",
        code: error?.code || "CODEX_FAILED",
      });
      setCustomError(message);
    } finally {
      setGeneratingKind("");
    }
  };

  const runAutomation = async () => {
    let currentAutomationStage = "";
    const moveAutomationStage = (stage) => {
      currentAutomationStage = stage;
      setAutomationStage(stage);
    };
    const context = {
      persona: (personaRef.current?.value ?? persona).trim(),
      keyword: (keywordRef.current?.value ?? keyword).trim(),
      writingBrief: (writingBriefRef.current?.value ?? writingBrief).trim(),
      ragItems: [],
    };

    if (!context.persona || !context.keyword || !context.writingBrief) {
      setCustomError("自动化生成需要先填写账号人设、创作关键词和补充撰写思路。");
      return;
    }
    if (!requireTextModel() || !requireImageModel()) return;

    setAutomationRunning(true);
    resetGeneratedState();
    setNotice({ type: "success", text: "自动化生成已开始：本次点击授权搜索、模型决策入库、生成和封面图生成。" });

    try {
      moveAutomationStage("搜索热门内容");
      setGeneratingKind("search");
      setActiveStep("research");
      setCliStatus({
        state: "running",
        label: "小红书 CLI 搜索",
        text: `自动化正在通过本机 xhs 搜索「${context.keyword}」...`,
        commandPreview: `xhs --cookie-source none search "${context.keyword}" --sort popular --type all --page 1 --json`,
        durationMs: null,
        generatedAt: "",
        code: "",
      });
      const searchResult = await requestXhsSearch({
        keyword: context.keyword,
        sort: "popular",
        type: "all",
        page: 1,
      });
      const nextSearchResults = searchResult.items;
      if (nextSearchResults.length === 0) {
        throw Object.assign(new Error("xhs 没有返回可用于自动化生成的热门内容。"), {
          code: "XHS_EMPTY",
        });
      }
      setSearchResults(nextSearchResults);
      setCliStatus({
        state: "success",
        label: "小红书 CLI 搜索",
        text: `xhs 已返回 ${nextSearchResults.length} 条热门内容，自动化将交给文案模型筛选参考。`,
        commandPreview: searchResult.commandPreview,
        durationMs: searchResult.durationMs,
        generatedAt: searchResult.generatedAt,
        code: "",
      });

      moveAutomationStage("选择并加入 RAG");
      const ragDecision = await requestDecision("rag", nextSearchResults, context);
      const nextSelectedSearchIds = ragDecision.selectedIds;
      const nextRagItems = nextSearchResults.filter((item) => nextSelectedSearchIds.includes(item.id));
      setSelectedSearchIds(nextSelectedSearchIds);
      setRagItems(nextRagItems);
      setActiveStep("rag");
      context.ragItems = nextRagItems;

      moveAutomationStage("生成 10 个选题");
      setGeneratingKind("topics");
      setCliStatus({
        state: "running",
        label: providerLabel("text"),
        text: `自动化正在通过 ${providerLabel("text")} 生成选题...`,
        commandPreview: providerPreview("text"),
        durationMs: null,
        generatedAt: "",
        code: "",
      });
      const topicResult = await requestTextItems("topics", {}, context);
      const nextTopics = topicResult.items;
      setTopics(nextTopics);
      setActiveStep("topics");
      setCliStatus({
        state: "success",
        label: topicResult.routeLabel,
        text: `${topicResult.routeLabel} 已生成 ${nextTopics.length} 条选题，自动化将选择 1 条继续。`,
        commandPreview: topicResult.commandPreview,
        durationMs: topicResult.durationMs,
        generatedAt: topicResult.generatedAt,
        code: "",
      });

      moveAutomationStage("选择选题");
      const topicDecision = await requestDecision("topic", nextTopics, context);
      const nextSelectedTopic = nextTopics.find((topic) => topic.id === topicDecision.selectedIds[0]);
      setSelectedTopicId(nextSelectedTopic.id);

      moveAutomationStage("生成 5 篇文案");
      setGeneratingKind("drafts");
      setCliStatus({
        state: "running",
        label: providerLabel("text"),
        text: `自动化正在通过 ${providerLabel("text")} 生成文案...`,
        commandPreview: providerPreview("text"),
        durationMs: null,
        generatedAt: "",
        code: "",
      });
      const draftResult = await requestTextItems("drafts", { selectedTopic: nextSelectedTopic }, context);
      const nextDrafts = draftResult.items;
      setDrafts(nextDrafts);
      setActiveStep("drafts");
      setCliStatus({
        state: "success",
        label: draftResult.routeLabel,
        text: `${draftResult.routeLabel} 已生成 ${nextDrafts.length} 篇文案，自动化将选择 1 篇继续。`,
        commandPreview: draftResult.commandPreview,
        durationMs: draftResult.durationMs,
        generatedAt: draftResult.generatedAt,
        code: "",
      });

      moveAutomationStage("选择文案");
      const draftDecision = await requestDecision("draft", nextDrafts, context, {
        selectedTopic: nextSelectedTopic,
      });
      const nextSelectedDraft = nextDrafts.find((draft) => draft.id === draftDecision.selectedIds[0]);
      setSelectedDraftId(nextSelectedDraft.id);

      moveAutomationStage("生成 5 份封面 Prompt");
      setGeneratingKind("coverPrompts");
      setCliStatus({
        state: "running",
        label: providerLabel("text"),
        text: `自动化正在通过 ${providerLabel("text")} 生成封面 Prompt...`,
        commandPreview: providerPreview("text"),
        durationMs: null,
        generatedAt: "",
        code: "",
      });
      const promptResult = await requestTextItems(
        "coverPrompts",
        { selectedTopic: nextSelectedTopic, selectedDraft: nextSelectedDraft },
        context,
      );
      const nextPrompts = promptResult.items;
      setPrompts(nextPrompts);
      setActiveStep("cover");
      setCliStatus({
        state: "success",
        label: promptResult.routeLabel,
        text: `${promptResult.routeLabel} 已生成 ${nextPrompts.length} 份封面 Prompt，自动化将选择 1 份生成封面图。`,
        commandPreview: promptResult.commandPreview,
        durationMs: promptResult.durationMs,
        generatedAt: promptResult.generatedAt,
        code: "",
      });

      moveAutomationStage("选择封面 Prompt");
      const promptDecision = await requestDecision("coverPrompt", nextPrompts, context, {
        selectedTopic: nextSelectedTopic,
        selectedDraft: nextSelectedDraft,
      });
      const nextSelectedPrompt = nextPrompts.find((prompt) => prompt.id === promptDecision.selectedIds[0]);
      setSelectedPromptId(nextSelectedPrompt.id);

      moveAutomationStage("生成封面图");
      setGeneratingKind("coverImage");
      const imageRouteLabel = providerLabel("image");
      setCliStatus({
        state: "running",
        label: imageRouteLabel,
        text: `自动化正在通过${imageRouteLabel}生成封面图...`,
        commandPreview: providerPreview("image"),
        durationMs: null,
        generatedAt: "",
        code: "",
      });
      const coverResult = await requestCoverImageResult(nextSelectedPrompt, nextSelectedDraft, context);
      setCoverImage({
        promptId: nextSelectedPrompt.id,
        src: coverResult.image.src,
        alt: coverResult.image.alt,
        title: coverResult.image.title,
        createdAt: nowText(),
        generatedAt: coverResult.generatedAt,
      });
      setCliStatus({
        state: "success",
        label: imageRouteLabel,
        text: `${imageRouteLabel}已生成封面图。`,
        commandPreview: coverResult.commandPreview,
        durationMs: coverResult.durationMs,
        generatedAt: coverResult.generatedAt,
        code: "",
      });
      setSuccess("自动化生成已完成：热门参考、RAG、选题、文案、封面 Prompt 和封面图均已生成并保留可见选择。");
    } catch (error) {
      const message = error?.message || "自动化生成失败。";
      setCliStatus({
        state: "error",
        label: currentAutomationStage ? `自动化：${currentAutomationStage}` : "自动化生成",
        text: message,
        commandPreview: "",
        durationMs: null,
        generatedAt: "",
        code: error?.code || "AUTOMATION_FAILED",
      });
      setCustomError(`自动化生成中断：${message}`);
    } finally {
      setAutomationRunning(false);
      setAutomationStage("");
      setGeneratingKind("");
    }
  };

  const saveDraft = () => {
    const savedAt = nowText();
    setLastSavedAt(savedAt);
    setSuccess(`草稿已保存到本地状态，保存时间 ${savedAt}。`);
  };

  return (
    <main className="app-shell" aria-label="NoteForge小红书工坊">
      <aside className="sidebar clay-panel">
        <div className="brand">
          <img className="brand-mark" src="/assets/noteforge-brand-icon-3d.png" alt="" />
          <div>
            <h1>笔记工坊</h1>
            <p>NoteForge</p>
          </div>
        </div>

        <section className="profile-card">
          <img src="/assets/avatar-creator.png" alt="小助理头像" />
          <div>
            <h2>小助理</h2>
            <span>内容创作助理</span>
          </div>
        </section>

        <div className="sidebar-scroll">
        <section className="flow-nav" aria-label="创作流程">
          <header>
            <h3>创作流程</h3>
            <strong>{progress}%</strong>
          </header>
          <div className="progress-track">
            <i style={{ "--progress": `${progress}%` }} />
          </div>
          {flowSteps.map((step, index) => (
            <button
              key={step.id}
              className={activeStep === step.id ? "active" : ""}
              onClick={() => setActiveStep(step.id)}
              type="button"
            >
              <SoftIcon tone={["pink", "yellow", "mint", "blue", "lavender", "rose"][index]}>
                {index + 1}
              </SoftIcon>
              <span>
                <strong>{step.label}</strong>
                <small>{step.meta}</small>
              </span>
            </button>
          ))}
        </section>

        <section className="project-list">
          <header>
            <h3>草稿项目</h3>
            <button type="button" onClick={saveDraft}>保存</button>
          </header>
          {sidebarProjects.map((project) => {
            const ProjectIcon = project.icon;
            return (
              <button key={project.title} className={project.active ? "project active" : "project"} type="button">
                <SoftIcon tone={project.tone}><ProjectIcon aria-hidden="true" /></SoftIcon>
                <span>
                  <strong>{project.title}</strong>
                  <small>{project.meta}</small>
                </span>
                <span className="project-remove" aria-hidden="true">×</span>
              </button>
            );
          })}
        </section>

        <button className="settings-button" type="button" onClick={() => setActiveStep("cover")}>
          <span>{lastSavedAt ? `已保存 ${lastSavedAt}` : "保存与继续编辑"}</span>
        </button>
        </div>
      </aside>

      <section className="workspace-shell column-bottom-fade" aria-label="阶段式创作工作台">
        <div className="workspace">
        <section className="overview clay-panel">
          <div className="overview-copy">
            <StageBadge tone="mint">新版流程</StageBadge>
            <h2>一键生成创作图文</h2>
            <p>人设、热门参考、选题、文案、封面 Prompt 和封面图支持手动逐步推进，也可以一次点击自动化生成。</p>
            <div className="metric-grid">
              <div className="metric">
                <span>搜索结果</span>
                <strong>{searchResults.length}</strong>
                <em>条</em>
              </div>
              <div className="metric">
                <span>RAG 参考</span>
                <strong>{ragItems.length}</strong>
                <em>条</em>
              </div>
              <div className="metric">
                <span>选题候选</span>
                <strong>{topics.length}</strong>
                <em>个</em>
              </div>
              <div className="metric">
                <span>文案草稿</span>
                <strong>{drafts.length}</strong>
                <em>篇</em>
              </div>
            </div>
          </div>
          <img className="hero-asset" src="/assets/notebook-pencil-aurora.png" alt="霓虹光环上的粉紫色笔记本和铅笔" />
        </section>

        <div className="workspace-scroll">
        <section className="input-panel clay-panel mint-glow">
          <SectionHeader
            icon={<StageIcon name="persona" />}
            tone="mint"
            title="账号人设与创作关键词"
            meta="人设最多 1000 字，关键词用于搜索和生成"
            action={
              <div className="section-actions">
                <button
                  className="soft-button automation-button"
                  disabled={isBusy}
                  type="button"
                  onClick={runAutomation}
                >
                  {automationRunning ? "自动化中..." : "自动化生成"}
                </button>
                <button
                  className="primary-button"
                  disabled={isBusy}
                  type="button"
                  onClick={runSearch}
                >
                  {generatingKind === "search" ? "搜索中..." : "搜索热门内容"}
                </button>
              </div>
            }
          />
          <div className="input-grid">
            <label className="field persona-field">
              <span>账号人设</span>
              <textarea
                ref={personaRef}
                maxLength={1000}
                value={persona}
                onChange={(event) => setPersona(event.target.value)}
              />
              <small>{persona.length} / 1000</small>
            </label>
            <label className="field keyword-field">
              <span>创作关键词</span>
              <input ref={keywordRef} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
              <small>自动缓存</small>
            </label>
          </div>
        </section>

        <section className="stage-grid">
          <article className="stage-card clay-panel">
            <SectionHeader
              icon={<StageIcon name="search" />}
              tone="yellow"
              title="热门内容搜索"
              meta="搜索只在点击后执行，结果不会自动入库"
              action={
                <button
                  className="soft-button yellow"
                  disabled={isBusy}
                  type="button"
                  onClick={runSearch}
                >
                  {generatingKind === "search" ? "搜索中..." : "重新搜索"}
                </button>
              }
            />
            <div className="result-list">
              {searchResults.length === 0 ? (
                <div className="empty-state">
                  <SoftIcon tone="yellow">待</SoftIcon>
                  <p>输入关键词后点击搜索，热门内容会显示在这里。</p>
                </div>
              ) : (
                searchResults.map((result) => (
                  <label
                    key={result.id}
                    className={selectedSearchIds.includes(result.id) ? "search-result selected" : "search-result"}
                  >
                    <input
                      checked={selectedSearchIds.includes(result.id)}
                      onChange={() => toggleSearchResult(result.id)}
                      type="checkbox"
                    />
                    <SearchThumbnail src={result.imageUrl} title={result.title} />
                    <span className="search-result-copy">
                      <strong>{result.title}</strong>
                      <p>{result.excerpt}</p>
                      <em>{result.metrics}</em>
                      <small>{result.source} | {result.keyword} | {result.lookupTime}</small>
                      <b>
                        {result.tags.map((tag) => (
                          <i key={tag}>#{tag}</i>
                        ))}
                      </b>
                    </span>
                  </label>
                ))
              )}
            </div>
          </article>

          <article className="stage-card clay-panel">
            <SectionHeader
              icon={<StageIcon name="rag" />}
              tone="mint"
              title="本地 RAG 知识库"
              meta="只保存用户勾选并确认的参考内容"
              action={<button className="soft-button mint" disabled={isBusy} type="button" onClick={addToRag}>加入 RAG</button>}
            />
            <div className="rag-stack">
              {ragItems.length === 0 ? (
                <div className="empty-state">
                  <SoftIcon tone="mint">选</SoftIcon>
                  <p>勾选搜索结果后，点击加入本地 RAG。</p>
                </div>
              ) : (
                ragItems.map((item) => (
                  <article key={item.id} className="rag-item">
                    <strong>{item.title}</strong>
                    <p>{item.excerpt}</p>
                    <small>{item.tags.join(" / ")}</small>
                  </article>
                ))
              )}
            </div>
          </article>
        </section>

        <section className="stage-card clay-panel wide-card">
          <SectionHeader
            icon={<StageIcon name="topics" />}
            tone="blue"
            title="生成 10 个选题"
            meta="参考人设、关键词与本地 RAG"
            action={
              <button
                className="primary-button"
                disabled={isBusy}
                type="button"
                onClick={generateTopics}
              >
                {generatingKind === "topics" ? "生成中..." : "生成选题"}
              </button>
            }
          />
          <div className="topic-grid">
            {topics.length === 0 ? (
              <div className="empty-state inline">
                <SoftIcon tone="blue">10</SoftIcon>
                <p>完成搜索和 RAG 入库后，生成选题会出现在这里。</p>
              </div>
            ) : (
              topics.map((topic, index) => (
                <button
                  key={topic.id}
                  className={selectedTopicId === topic.id ? "topic-card selected" : "topic-card"}
                  onClick={() => setSelectedTopicId(topic.id)}
                  type="button"
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{topic.title}</strong>
                  <p>{topic.angle}</p>
                  <small>{topic.audience}</small>
                  <em>{topic.hook}</em>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="copy-grid">
          <article className="stage-card clay-panel">
            <SectionHeader
              icon={<StageIcon name="writing" />}
              tone="lavender"
              title="撰写思路与 5 篇文案"
              meta={selectedTopic ? selectedTopic.title : "先选择一个选题"}
              action={
                <button
                  className="primary-button"
                  disabled={isBusy}
                  type="button"
                  onClick={generateDrafts}
                >
                  {generatingKind === "drafts" ? "生成中..." : "生成文案"}
                </button>
              }
            />
            <label className="field brief-field">
              <span>补充撰写思路</span>
              <textarea
                ref={writingBriefRef}
                value={writingBrief}
                onChange={(event) => setWritingBrief(event.target.value)}
              />
            </label>
            <div className="draft-list">
              {drafts.length === 0 ? (
                <div className="empty-state">
                  <SoftIcon tone="lavender">5</SoftIcon>
                  <p>选题确认后生成 5 篇文案。</p>
                </div>
              ) : (
                drafts.map((draft, index) => (
                  <button
                    key={draft.id}
                    className={selectedDraftId === draft.id ? "draft-card selected" : "draft-card"}
                    onClick={() => setSelectedDraftId(draft.id)}
                    type="button"
                  >
                    <span>文案 {index + 1}</span>
                    <strong>{draft.title}</strong>
                    <p>{draft.body}</p>
                  </button>
                ))
              )}
            </div>
          </article>

          <article className="preview clay-panel">
            <SectionHeader icon={<StageIcon name="preview" />} tone="pink" title="小红书预览" meta="选择文案后实时查看草稿" />
            <div className="post-card">
              <div className="post-author">
                <img src="/assets/avatar-creator.png" alt="" />
                <strong>小助理</strong>
                <button type="button">关注</button>
              </div>
              <div className="post-cover-wrap">
                <img
                  className="post-cover"
                  src={coverImage?.src ?? "/assets/outfit.png"}
                  alt={coverImage?.alt ?? "封面预览"}
                />
                <span className="cover-count">{coverImage ? "已生成" : "预览"}</span>
              </div>
              <h3>{selectedDraft?.title ?? "选择一篇文案后，这里显示小红书标题"}</h3>
              <p>{selectedDraft?.body ?? "正文预览会保留话题标签格式，例如 #夏日通勤[话题]#。"}</p>
              <footer>
                <span><b className="post-icon like"><Heart aria-hidden="true" /></b>1289</span>
                <span><b className="post-icon star"><Bookmark aria-hidden="true" /></b>965</span>
                <span><b className="post-icon chat"><MessageCircle aria-hidden="true" /></b>213</span>
              </footer>
            </div>
          </article>
        </section>

        <section className="cover-grid">
          <article className="stage-card clay-panel">
            <SectionHeader
              icon={<StageIcon name="coverPrompt" />}
              tone="rose"
              title="封面 Prompt 与封面图"
              meta="Prompt 默认禁真人、脸、手和动物，允许植物花材"
              action={
                <button
                  className="primary-button"
                  disabled={isBusy}
                  type="button"
                  onClick={generatePrompts}
                >
                  {generatingKind === "coverPrompts" ? "生成中..." : "生成 Prompt"}
                </button>
              }
            />
            <div className="prompt-list">
              {prompts.length === 0 ? (
                <div className="empty-state inline">
                  <SoftIcon tone="rose">P</SoftIcon>
                  <p>选择文案后生成 5 份封面 Prompt。</p>
                </div>
              ) : (
                prompts.map((prompt) => (
                  <button
                    key={prompt.id}
                    className={selectedPromptId === prompt.id ? "prompt-card selected" : "prompt-card"}
                    disabled={isBusy}
                    onClick={() => generateCoverImage(prompt.id)}
                    type="button"
                  >
                    <strong>{prompt.title}</strong>
                    <p>{prompt.prompt}</p>
                  </button>
                ))
              )}
            </div>
          </article>

          <article className="cover-result clay-panel">
            <SectionHeader
              icon={<StageIcon name="coverResult" />}
              tone="mint"
              title="封面结果"
              meta={generatingKind === "coverImage" ? "正在生成封面图" : coverImage ? `生成于 ${coverImage.createdAt}` : "点击 Prompt 后生成"}
            />
            <div className="cover-frame">
              {generatingKind === "coverImage" ? (
                <div className="cover-placeholder">
                  <SoftIcon tone="mint">成</SoftIcon>
                  <p>正在生成封面图...</p>
                </div>
              ) : coverImage ? (
                <img src={coverImage.src} alt={coverImage.alt} />
              ) : (
                <div className="cover-placeholder">
                  <SoftIcon tone="mint">图</SoftIcon>
                  <p>封面图会展示在这里。</p>
                </div>
              )}
            </div>
            <div className="prompt-keeper">
              <span>原始 Prompt</span>
              <p>{selectedPrompt?.prompt ?? "尚未选择封面 Prompt。"}</p>
              <button
                className="soft-button mint"
                disabled={isBusy}
                type="button"
                onClick={() => generateCoverImage()}
              >
                {generatingKind === "coverImage" ? "生成中..." : "重新生成"}
              </button>
            </div>
          </article>
        </section>
        </div>
        </div>
      </section>

      <aside className="config-shell column-bottom-fade" aria-label="右侧配置栏">
        <div className="config-rail">
          <section className="model-card clay-panel">
            <h2>模型配置</h2>
            <p>文案生成与图片生成分开配置，字段会自动缓存。</p>
            <div className="model-route-list">
              <ModelConfig
                channel="text"
                title="文案生成"
                icon="文"
                tone="mint"
                value={channelConfig("text")}
                onChange={(value) => updateModelConfig("text", value)}
                localClis={localClis}
                detectionState={cliDetectionState}
                onDetect={detectConfiguredClis}
              />
              <ModelConfig
                channel="image"
                title="图片生成"
                icon="图"
                tone="pink"
                value={channelConfig("image")}
                onChange={(value) => updateModelConfig("image", value)}
                localClis={localClis}
                detectionState={cliDetectionState}
                onDetect={detectConfiguredClis}
              />
            </div>
          </section>

          <IntegrationHealthPanel
            health={integrationHealth}
            checkingTarget={checkingIntegration}
            onCheck={checkIntegrationHealth}
          />

        <section className={`notice-card clay-panel ${notice.type}`}>
          <header>
            <h2>状态与错误提示</h2>
            <StageBadge tone={notice.type === "error" ? "rose" : "mint"}>
              {notice.type === "error" ? "需处理" : "提示"}
            </StageBadge>
          </header>
          <p>{notice.text}</p>
          <div className="manual-boundary">
            <span>搜索</span>
            <span>入库</span>
            <span>生成</span>
            <span>封面</span>
            <strong>{automationRunning ? `自动化：${automationStage}` : "手动逐步或自动化一次确认"}</strong>
          </div>
          <div className={`cli-status ${cliStatus.state}`}>
            <span>{cliStatus.label}</span>
            <p>{cliStatus.text}</p>
            {cliStatus.commandPreview ? <code>{cliStatus.commandPreview}</code> : null}
            {cliStatus.durationMs ? (
              <small>{Math.round(cliStatus.durationMs / 1000)}s · {new Date(cliStatus.generatedAt).toLocaleString("zh-CN")}</small>
            ) : null}
            {cliStatus.code ? <small>{cliStatus.code}</small> : null}
          </div>
        </section>

        <section className="error-lab clay-panel">
          <h2>错误覆盖</h2>
          <div>
            {Object.entries({
              search: "搜索失败",
              rag: "RAG 失败",
              topics: "选题失败",
              drafts: "文案失败",
              prompts: "Prompt 失败",
              image: "封面失败",
              config: "配置缺失",
              key: "Key 无效",
              cli: "CLI 不可用",
              network: "网络失败",
            }).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setError(key)}>
                {label}
              </button>
            ))}
          </div>
        </section>
        </div>
      </aside>
    </main>
  );
}
