/* AI 做图看板 v5 (imgboard-17) — 新产品彻底隔离 + 秋霜/安然自动协同规划七图 + 自动留稿 */
(function () {
  const STORAGE_KEY = "ai-image-board-v3";
  const LEGACY_KEY = "ai-image-board-v2";
  const GEN_PROVIDERS = ["doubao", "banana", "grok", "chatgpt"];
  const MODEL_MAP = Object.fromEntries(DEMO.models.map((m) => [m.id, m]));
  const API = window.BoardAPI;

  const MAIN_FORBIDDEN_CLIENT_RE = /(明确标注|标注\s*\d+|卖点文字|卖点文案|说明性?文字|添加.*文字|elegantly\s+crafted|add\s+callout)/i;

  function newSessionId() {
    return "prod-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  }

  function buildOwnerSig(asin, productName, productSummary) {
    const a = String(asin || "").trim().toUpperCase();
    const n = String(productName || "").trim();
    const p = String(productSummary || "").trim().slice(0, 80);
    return `${a}|${n}|${p}`;
  }

  const state = normalizeState(loadState() || defaultState());
  let serverStatus = null;
  let vocImporting = false;
  const boxRuntime = {};
  const chatRuntime = {};
  const sevenCollabRuntime = { busy: false, startedAt: 0, controller: null, sessionId: null };
  let WB = null;
  let WorkspaceArchive = null;
  let lastDragEndAt = 0;

  function defaultState() {
    return {
      mode: "demo",
      source: "amazon",
      productSessionId: newSessionId(),
      planOwnerSig: "",
      asin: DEMO.product.asin,
      productName: DEMO.product.name,
      productDir: DEMO.product.name,
      taskId: null,
      archiveOverride: null,
      productSummary: "",
      whitebgSources: [],
      whitebgSelectedSourceIds: [],
      whitebgSelectedSourceId: null,
      whitebgInstruction: "",
      whitebgSelectedModels: ["doubao"],
      whitebgResults: [],
      selectedWhitebgIds: [],
      activeWhitebgId: null,
      boxes: {},
      preview: [null, null, null, null, null, null, null],
      genTargetBoxId: null,
      lastSavePath: null,
      planBoxes: null,
      sevenImagePlan: null,
      sevenPlanSource: null,
      sevenPlanAuthor: null,
      sevenPlanFile: null,
      sevenPlanStatus: null,
      sevenPlanStatusLabel: null,
      sevenPlanStatusHint: null,
      sevenThemeChat: {},
      sevenThemeBusy: {},
    };
  }

  function sanitizeCachedMainPlanBox(b, asin, prodName) {
    if (!b || typeof b !== "object") return b;
    const isMain = b.badge === "主图" || String(b.id || "").startsWith("qs-main");
    if (!isMain) return b;
    const prod = prodName || asin || "本产品";
    const dirtyBrief = !String(b.brief || "").includes("RGB(255,255,255)") || MAIN_FORBIDDEN_CLIENT_RE.test(b.brief || "");
    const dirtyPrompt = MAIN_FORBIDDEN_CLIENT_RE.test(b.prompt || "") || !/no\s+(explanatory\s+)?text/i.test(b.prompt || "");
    if (!dirtyBrief && !dirtyPrompt) return b;
    return {
      ...b,
      who: "秋霜",
      badge: "主图",
      brief:
        "【主图硬性规范（亚马逊美国站）】\n" +
        "1. 纯白背景 RGB(255,255,255)\n" +
        "2. 只展示在售商品本身，专业实拍，产品占画面 ≥85%，完整入框、不被裁切\n" +
        "3. 禁止任何说明性文字、Logo、水印、色块、边框、插图/多角度拼图\n" +
        "4. 一般不要包装盒（除非包装本身是卖点）；不要任何道具/配件误导\n" +
        "5. 建议尺寸 ≥1600px（看板统一 2000×2000）\n" +
        `传达目标（只能靠产品本体构图呈现）：突出 ${prod} 真实形态、原生版式与材质细节；数量规格与卖点文案一律移至副图。`,
      prompt:
        `Amazon US compliant main listing photo (2000x2000 px, >=1600px standard). Pure solid white background RGB(255,255,255). Show ONLY the physical product for sale (${prod}), professional studio photography, product occupying >=85% of the square frame, centered, fully in frame and never cropped. STRICTLY NO explanatory text, NO text overlay, NO callouts, NO logos, NO watermarks, NO badges, NO color blocks, NO borders, and NO non-included props. Strictly use the retouched white-background product image as the exact physical product subject.`,
    };
  }

  function normalizeState(raw) {
    const s = Object.assign(defaultState(), raw || {});
    // Archive source UI only keeps 亚马逊 VOC; migrate legacy etsy/demo tabs
    if (s.source !== "amazon") {
      s.source = "amazon";
    }
    if (typeof s.productSummary !== "string") s.productSummary = "";
    if (!Array.isArray(s.whitebgSources)) s.whitebgSources = [];
    if (!Array.isArray(s.whitebgResults)) s.whitebgResults = [];
    s.whitebgResults = s.whitebgResults.filter((r) => r && r.imageUrl && !r.mock);

    s.whitebgSelectedModels = ["doubao"];

    const validSrcIds = new Set(s.whitebgSources.map((u) => u.id));
    if (!Array.isArray(raw && raw.whitebgSelectedSourceIds)) {
      s.whitebgSelectedSourceIds = s.whitebgSources.map((u) => u.id);
    } else {
      s.whitebgSelectedSourceIds = s.whitebgSelectedSourceIds.filter((id) => validSrcIds.has(id));
    }

    const validWbIds = new Set(s.whitebgResults.map((r) => r.id));
    if (!Array.isArray(raw && raw.selectedWhitebgIds)) {
      if (s.activeWhitebgId && validWbIds.has(s.activeWhitebgId)) {
        s.selectedWhitebgIds = [s.activeWhitebgId];
      } else if (s.whitebgResults.length) {
        s.selectedWhitebgIds = [s.whitebgResults[s.whitebgResults.length - 1].id];
      } else {
        s.selectedWhitebgIds = [];
      }
    } else {
      s.selectedWhitebgIds = s.selectedWhitebgIds.filter((id) => validWbIds.has(id));
    }

    if (s.selectedWhitebgIds.length) {
      if (!s.activeWhitebgId || !s.selectedWhitebgIds.includes(s.activeWhitebgId)) {
        s.activeWhitebgId = s.selectedWhitebgIds[0];
      }
    } else if (s.whitebgResults.length) {
      if (!s.activeWhitebgId || !validWbIds.has(s.activeWhitebgId)) {
        s.activeWhitebgId = s.whitebgResults[s.whitebgResults.length - 1].id;
      }
    } else {
      s.activeWhitebgId = null;
    }

    if (!s.productSessionId) s.productSessionId = newSessionId();
    if (!s.sevenThemeChat || typeof s.sevenThemeChat !== "object") s.sevenThemeChat = {};
    s.sevenThemeBusy = {};

    // Demo mode must never hold real/previous product sevenImagePlan or chat
    if (s.mode === "demo") {
      s.archiveOverride = null;
      s.sevenImagePlan = null;
      s.planBoxes = null;
      s.sevenPlanSource = null;
      s.sevenPlanAuthor = null;
      s.sevenPlanFile = null;
      s.sevenPlanStatus = null;
      s.sevenPlanStatusLabel = null;
      s.sevenThemeChat = {};
      s.productSummary = "";
    } else {
      // Real mode: never keep DEMO product ASIN/name placeholders
      if (s.asin === DEMO.product.asin) s.asin = "";
      if (s.productName === DEMO.product.name && !(s.productSummary || "").toLowerCase().includes("sincerez")) {
        s.productName = "";
        if (s.productDir === DEMO.product.name) s.productDir = "";
      }
      // Guard 1: archiveOverride ASIN mismatch with current state.asin -> drop stale plan
      const archAsin = String((s.archiveOverride && s.archiveOverride.meta && s.archiveOverride.meta.asin) || "").trim().toUpperCase();
      const curAsin = String(s.asin || "").trim().toUpperCase();
      if (archAsin && curAsin && archAsin !== curAsin) {
        s.archiveOverride = null;
        s.sevenImagePlan = [];
        s.planBoxes = [];
        s.sevenPlanSource = null;
        s.sevenPlanAuthor = null;
        s.sevenPlanStatus = null;
        s.sevenPlanStatusLabel = null;
        s.sevenThemeChat = {};
      }
      // Guard 2: planOwnerSig ASIN prefix mismatch -> drop stale sevenImagePlan
      if (s.planOwnerSig && typeof s.planOwnerSig === "string") {
        const sigAsin = (s.planOwnerSig.split("|")[0] || "").trim().toUpperCase();
        if (sigAsin && curAsin && sigAsin !== curAsin) {
          s.sevenImagePlan = [];
          s.planBoxes = [];
          s.sevenThemeChat = {};
        }
      }
      // Guard 3: Self-heal legacy B0GVDS8X33 hardcoded template pollution on non-therapy products
      const isB0G = curAsin === "B0GVDS8X33" || /艺术治疗|art\s*therapy/i.test((s.productName || "") + " " + (s.productSummary || ""));
      if (!isB0G && Array.isArray(s.sevenImagePlan) && s.sevenImagePlan.some((r) => r && (r.focusDisplay === "辅助艺术治疗" || (r.primaryTheme && r.primaryTheme.en === "Guided Art Therapy")))) {
        s.sevenImagePlan = [];
        s.planBoxes = [];
        s.sevenThemeChat = {};
        s.sevenPlanSource = "auto";
        s.sevenPlanStatus = "draft_pending";
        s.sevenPlanStatusLabel = "待秋霜+安然规划";
        if ((s.productSummary || "").trim()) {
          s._needsRefreshFromSummary = true;
        }
      }
    }

    if (Array.isArray(s.planBoxes)) {
      s.planBoxes = s.planBoxes.map((b) => sanitizeCachedMainPlanBox(b, s.asin, s.productName));
    }

    if (!Array.isArray(s.preview) || s.preview.length !== 7) {
      s.preview = [null, null, null, null, null, null, null];
    }
    if (!s.boxes || typeof s.boxes !== "object") s.boxes = {};
    Object.keys(s.boxes).forEach((bid) => {
      const b = s.boxes[bid] || {};
      if (!Array.isArray(b.results)) b.results = [];
      if (!Array.isArray(b.promptChat)) b.promptChat = [];
      if (b.promptOverride === undefined) b.promptOverride = null;
      if (b.briefOverride === undefined) b.briefOverride = null;
      if ((bid === "qs-main" || bid.startsWith("qs-main")) && b.briefOverride && MAIN_FORBIDDEN_CLIENT_RE.test(b.briefOverride)) {
        b.briefOverride = null;
      }
      if ((bid === "qs-main" || bid.startsWith("qs-main")) && b.promptOverride && MAIN_FORBIDDEN_CLIENT_RE.test(b.promptOverride)) {
        b.promptOverride = null;
      }
      s.boxes[bid] = b;
    });

    delete s.whitebgGenerated;
    delete s.whitebgPicks;
    delete s.whitebgSaved;
    return s;
  }

  function loadState() {
    try {
      const v3 = localStorage.getItem(STORAGE_KEY);
      if (v3) {
        localStorage.removeItem(LEGACY_KEY);
        return JSON.parse(v3);
      }
      const leg = localStorage.getItem(LEGACY_KEY);
      if (leg) {
        localStorage.removeItem(LEGACY_KEY);
        return JSON.parse(leg);
      }
      return null;
    } catch {
      return null;
    }
  }

  let _saveDebounce = null;
  function saveState() {
    const toSave = { ...state };
    delete toSave.genTargetBoxId;
    delete toSave._needsRefreshFromSummary;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (_) {}
  }
  function saveStateDebounced() {
    clearTimeout(_saveDebounce);
    _saveDebounce = setTimeout(saveState, 250);
  }

  function isRealMode() {
    return state.mode === "real" && state.source !== "demo";
  }

  function isProviderConfigured(id) {
    const list = (serverStatus && serverStatus.providers) || null;
    if (list) {
      const found = list.find((p) => p.id === id);
      return !!(found && found.configured);
    }
    return id !== "grok";
  }

  function providerMissingKey(id) {
    const list = (serverStatus && serverStatus.providers) || [];
    const found = list.find((p) => p.id === id);
    if (found && found.missingKey) return found.missingKey;
    if (id === "grok") return "XAI_API_KEY";
    return "API_KEY";
  }

  function effectiveAsin() {
    if (state.mode === "demo") return DEMO.product.asin;
    return (state.asin || "").trim();
  }

  function abortAllInFlight() {
    if (sevenCollabRuntime.controller) {
      try { sevenCollabRuntime.controller.abort("user"); } catch (_) {}
    }
    sevenCollabRuntime.busy = false;
    sevenCollabRuntime.controller = null;
    sevenCollabRuntime.sessionId = null;

    Object.keys(boxRuntime).forEach((k) => {
      if (boxRuntime[k] && boxRuntime[k].controller) {
        try { boxRuntime[k].controller.abort("user"); } catch (_) {}
      }
      delete boxRuntime[k];
    });
    Object.keys(chatRuntime).forEach((k) => {
      if (chatRuntime[k] && chatRuntime[k].controller) {
        try { chatRuntime[k].controller.abort("user"); } catch (_) {}
      }
      delete chatRuntime[k];
    });
    if (WB && typeof WB.abortInFlight === "function") {
      WB.abortInFlight();
    }
  }

  function isBlankNewProduct() {
    return (
      state.mode === "real" &&
      !state.archiveOverride &&
      !(state.productSummary || "").trim() &&
      !(Array.isArray(state.sevenImagePlan) && state.sevenImagePlan.length > 0) &&
      !(Array.isArray(state.planBoxes) && state.planBoxes.length > 0)
    );
  }

  function displayProductFolder() {
    if (state.mode === "demo") return DEMO.product.name;
    if (state.productDir) return state.productDir;
    const raw = (state.productName || state.asin || "待填新产品名").trim();
    const clean = raw.replace(/[/\\:*?"<>|#%]+/g, " ").replace(/\s+/g, " ").trim();
    return clean.length > 64 ? clean.slice(0, 64).trim() : clean;
  }

  function toast(msg, opts) {
    const el = document.getElementById("toast");
    if (!el) return;
    const duration = (opts && opts.duration) || 3800;
    const sticky = !!(opts && opts.sticky);
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    if (!sticky) toast._t = setTimeout(() => el.classList.remove("show"), duration);
  }

  function modelDisplayName(mid) {
    return (MODEL_MAP[mid] && MODEL_MAP[mid].name) || mid || "模型";
  }

  function humanizeError(err, providerId) {
    if (err && err.isCancelled) return "已取消操作";
    const data = (err && err.data) || null;
    const rawMsg = (data && data.error) || (err && err.message) || String(err || "");
    const s = String(rawMsg);
    const pName = modelDisplayName(providerId);
    if (data && data.code === "MISSING_WHITEBG_REF") return s;
    if ((err && err.isTimeout) || (data && data.timeout) || /超时|timed?\s*out|AbortError/i.test(s)) {
      if (providerId === "banana") return "Banana 超时，请重试或改用豆包";
      return `${pName} 超时，请重试或改用豆包`;
    }
    if ((data && data.quota) || /429|insufficient_quota|额度不足|billing_hard_limit|resource_exhausted/i.test(s)) {
      if (providerId === "banana") return "Banana 配额繁忙（429），请稍后重试或改用豆包";
      if (providerId === "chatgpt") return "ChatGPT 额度不足（需 API Credits，与 Pro 无关）。请改用豆包或 Banana。";
      return `${pName} 配额繁忙（429），请稍后重试`;
    }
    return s;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureBox(boxId) {
    if (!state.boxes[boxId]) {
      state.boxes[boxId] = {
        results: [],
        selectedResultId: null,
        refineOpen: false,
        refineDraft: "",
        refineProvider: null,
        inPreview: false,
        promptChat: [],
        promptOverride: null,
        briefOverride: null,
      };
    } else {
      if (!Array.isArray(state.boxes[boxId].results)) state.boxes[boxId].results = [];
      if (!Array.isArray(state.boxes[boxId].promptChat)) state.boxes[boxId].promptChat = [];
    }
    return state.boxes[boxId];
  }

  function getRuntime(boxId) {
    if (!boxRuntime[boxId]) {
      boxRuntime[boxId] = { busy: false, text: "", startedAt: 0, controller: null, lastError: null };
    }
    return boxRuntime[boxId];
  }

  function getChatRuntime(boxId) {
    if (!chatRuntime[boxId]) {
      chatRuntime[boxId] = { busy: false, controller: null, draft: "" };
    }
    return chatRuntime[boxId];
  }

  function currentPlans() {
    if (isRealMode() && state.planBoxes && state.planBoxes.length) return state.planBoxes;
    if (state.planBoxes && state.planBoxes.length && state.mode === "real") return state.planBoxes;
    if (state.planBoxes && state.planBoxes.length && state.productSummary) return state.planBoxes;
    if (isBlankNewProduct()) return [];
    return [...DEMO.qiushuang, ...DEMO.anran];
  }

  function findPlan(boxId) {
    return currentPlans().find((b) => b.id === boxId);
  }

  function ensureProductSummaryInText(text, isMain) {
    const summary = (state.productSummary || "").trim();
    if (!summary) return text || "";
    const marker = "【产品总结·人工导入】";
    let body = (text || "").trim();
    if (body.includes(marker)) {
      body = body.split(marker)[0].trim();
    }
    const block = isMain
      ? `${marker}\n以下消费者在意点只能靠产品本体构图传达（主图零叠字，禁止写成画面文字）：\n${summary}`
      : `${marker}\n下游出图 AI 必须分析并呼应以下人工产品总结（卖点/在意点）：\n${summary}`;
    return body ? `${body}\n\n${block}` : block;
  }

  function getEffectiveBrief(plan, box) {
    let base = box && typeof box.briefOverride === "string" && box.briefOverride.trim()
      ? box.briefOverride
      : (plan && plan.brief) || "";
    const isMain = (plan && plan.badge === "主图") || (plan && String(plan.id || "").startsWith("qs-main"));
    return ensureProductSummaryInText(base, !!isMain);
  }

  function getEffectivePrompt(plan, box) {
    let base = box && typeof box.promptOverride === "string" && box.promptOverride.trim()
      ? box.promptOverride
      : (plan && plan.prompt) || "";
    const isMain = (plan && plan.badge === "主图") || (plan && String(plan.id || "").startsWith("qs-main"));
    return ensureProductSummaryInText(base, !!isMain);
  }

  function setPlanPrompt(boxId, nextPrompt) {
    const box = ensureBox(boxId);
    box.promptOverride = nextPrompt;
    const plan = findPlan(boxId);
    if (plan) plan.prompt = nextPrompt;
  }

  function setPlanBrief(boxId, nextBrief) {
    const box = ensureBox(boxId);
    box.briefOverride = nextBrief;
    const plan = findPlan(boxId);
    if (plan) plan.brief = nextBrief;
  }

  function inferOwnerWho(plan) {
    if (!plan) return "秋霜";
    if (plan.who === "秋霜" || plan.who === "安然") return plan.who;
    if ((plan.id || "").startsWith("qs-") || ["主图", "细节图", "尺寸图"].includes(plan.badge)) return "秋霜";
    return "安然";
  }

  function extractVersionNumbers(text) {
    const s = String(text || "");
    const hits = [];
    const reV = /(?<![A-Za-z0-9])[vV]\s*(\d{1,3})(?!\d)/g;
    let m;
    while ((m = reV.exec(s)) !== null) {
      hits.push({ pos: m.index, ver: Number(m[1]) });
    }
    const reZh = /第\s*(\d{1,2})\s*版/g;
    while ((m = reZh.exec(s)) !== null) {
      hits.push({ pos: m.index, ver: Number(m[1]) });
    }
    hits.sort((a, b) => a.pos - b.pos);
    const seen = new Set();
    const out = [];
    hits.forEach((h) => {
      if (h.ver > 0 && !seen.has(h.ver)) {
        seen.add(h.ver);
        out.push(h.ver);
      }
    });
    return out;
  }

  function cardEffectiveVersion(r) {
    if (!r) return 0;
    if (r.refVersion) return Number(r.refVersion);
    const m = /(?:白底真修|豆包|Banana|Grok|ChatGPT)?[^0-9]*[vV](\d{1,3})(?!\d)/.exec(r.label || "");
    if (m) return Number(m[1]);
    return Number(r.version) || 1;
  }

  function resolvePromptVersionRefs(promptText, boxId) {
    const mentioned = extractVersionNumbers(promptText);
    const box = ensureBox(boxId);
    const boxCards = (box.results || []).filter((r) => r && r.imageUrl && !r.mock);
    const wbCards = (state.whitebgResults || []).filter((r) => r && r.imageUrl && !r.mock);
    const matched = [];
    const missing = [];

    mentioned.forEach((ver) => {
      const vLabelRe = new RegExp(`(?<![A-Za-z0-9])[vV]\\s*${ver}(?!\\d)`);
      let found =
        boxCards.find((r) => Number(r.refVersion) === ver) ||
        boxCards.find((r) => vLabelRe.test(r.label || "")) ||
        boxCards.find((r) => Number(r.version) === ver);
      if (!found) {
        found =
          wbCards.find((r) => Number(r.version) === ver) ||
          wbCards.find((r) => vLabelRe.test(r.label || ""));
      }
      if (found) {
        matched.push({
          tag: `v${ver}`,
          version: ver,
          label: found.label || `参考图 v${ver}`,
          imageUrl: found.imageUrl,
        });
      } else {
        missing.push(ver);
      }
    });

    return { mentioned, matched, missing };
  }

  function reconcilePreviewFlags() {
    const inPrevSet = new Set((state.preview || []).filter(Boolean).map((p) => p.boxId));
    Object.entries(state.boxes || {}).forEach(([bid, box]) => {
      box.inPreview = inPrevSet.has(bid);
    });
  }

  function setModeUI() {
    const real = isRealMode();
    const hasRealWb = !!(WB && WB.getActiveRef());
    const banner = document.getElementById("top-banner");
    banner.classList.toggle("banner-real", real || hasRealWb);
    document.getElementById("banner-mode").textContent = real ? "真实 VOC / 受控图生图模式" : "演示档案模式（支持白底真修与受控生图）";
    document.getElementById("banner-detail").textContent =
      "· 目录：亚马逊产品图片/" + displayProductFolder() + "/{过程图|白底图|最终版本|报告} · 全量 2000×2000 PNG/JPG · 强制锁定白底本体";

    const modeTag = document.getElementById("mode-tag");
    if (modeTag) {
      modeTag.textContent = real ? "真实VOC" : "演示档案";
      modeTag.classList.toggle("tag-demo", !real);
      modeTag.classList.toggle("tag-real", real);
    }

    document.querySelectorAll("[data-mode-tag]").forEach((el) => {
      el.textContent = real ? "真实" : "演示档案";
      el.classList.toggle("tag-demo", !real);
      el.classList.toggle("tag-real", real);
    });

    const whitebgTag = document.getElementById("whitebg-mode-tag");
    if (whitebgTag) {
      whitebgTag.textContent = hasRealWb ? "真实 · 已锁定" : "豆包真修";
      whitebgTag.className = "tag tag-real";
    }

    const mac = (serverStatus && serverStatus.macImageRoot) || "/Users/lhy/Desktop/亚马逊产品图片";
    const sq = serverStatus && serverStatus.syncQueue;
    let syncSummary = "";
    if (sq) {
      syncSummary = sq.pending > 0 ? ` · 待同步 Mac ${sq.pending} 项` : sq.syncedCount > 0 ? ` · 已同步 Mac ${sq.syncedCount} 项` : "";
    }
    document.getElementById("save-path").textContent =
      `落盘：${mac}/${displayProductFolder()}/{过程图 | 白底图 | 最终版本 | 报告}（2000×2000 .png/.jpg）` +
      (state.lastSavePath ? ` · 最近：${state.lastSavePath}` : "") +
      syncSummary;

    const emptyNew = isBlankNewProduct();
    document.getElementById("product-sub").textContent = emptyNew
      ? "新产品工作台（已清空）· 请导入 ASIN / 粘贴产品数据；已留稿文件继续保留"
      : real
      ? `亚马逊 7 图 · ASIN ${state.asin || "—"} · 产品目录「${displayProductFolder()}」`
      : `亚马逊 7 图 Listing · 当前演示档案：${DEMO.product.name}（可导入真实 ASIN 如 B0GVDS8X33）`;
  }

  function activeArchive() {
    if (state.archiveOverride) return state.archiveOverride;
    if (isBlankNewProduct()) {
      return { itch: [], pain: [], delight: [], reason: [], sevenImagePlan: [] };
    }
    return DEMO.archives.amazon;
  }

  function activeSevenPlan() {
    if (Array.isArray(state.sevenImagePlan) && state.sevenImagePlan.length) return state.sevenImagePlan;
    if (isBlankNewProduct()) return null;
    const arch = activeArchive();
    if (arch && Array.isArray(arch.sevenImagePlan) && arch.sevenImagePlan.length) return arch.sevenImagePlan;
    return null;
  }

  function syncPlanBoxesFromSeven() {
    const seven = state.sevenImagePlan;
    if (!Array.isArray(seven) || !seven.length || !Array.isArray(state.planBoxes)) return;
    seven.forEach((row) => {
      const box = state.planBoxes.find((b) => Number(b.imageIndex) === Number(row.imageIndex) || b.id === row.boxId);
      if (!box) return;
      box.focusDisplay = row.focusDisplay;
      box.vocEvidence = row.vocEvidence;
      box.visualNotes = row.visualNotes;
      box.primaryTheme = row.primaryTheme;
      box.secondaryThemes = row.secondaryThemes || [];
      if (row.allowOverlay === false || row.imageIndex === 1) {
        // main: keep sanitized prompt; only refresh focus note inside brief tip is handled server-side on reimport
        return;
      }
      const pt = row.primaryTheme || {};
      const secs = row.secondaryThemes || [];
      const exact = [pt.en].concat(secs.map((s) => s && s.en).filter(Boolean)).filter(Boolean);
      const secLines = secs
        .map((s, i) => `${i + 1}. ${s.zh || ""} → 英文: "${s.en || ""}"；画面：${s.panel || ""}`)
        .join("\n");
      box.brief =
        `【图号/槽位】图${row.imageIndex} · ${row.slot || row.badge || ""}\n` +
        `【主主题·重点展示】${pt.zh || row.focusDisplay || ""} → 英文大标题: "${pt.en || ""}"\n` +
        `【次主题】\n${secLines}\n` +
        `【VOC 依据】${row.vocEvidence || ""}\n` +
        `【画面英文叠字 exact】${exact.map((e) => `"${e}"`).join("; ")}\n` +
        `【配图说明】${row.visualNotes || ""}`;
      const support = secs.map((s) => s && s.en).filter(Boolean);
      const supportLine = support.length
        ? `Supporting on-image callouts / panel labels (exact): ${support.map((e) => `"${e}"`).join("; ")}`
        : "";
      const primaryLine = pt.en ? `Primary on-image headline (exact): "${pt.en}"` : "";
      // Replace or append theme block in prompt
      let prompt = box.prompt || "";
      prompt = prompt.replace(/Primary on-image headline \(exact\):[^\n]*/i, "").replace(/Supporting on-image callouts \/ panel labels \(exact\):[^\n]*/i, "").replace(/Layout: one visual center[^\n]*/i, "");
      prompt = prompt.replace(/\n{3,}/g, "\n\n").trim();
      box.prompt = `${prompt}\n${primaryLine}\n${supportLine}\nLayout: one visual center for the primary theme; supporting panels only illustrate that theme.`.replace(/\n{3,}/g, "\n\n").trim();
      box.vocCallouts = exact;
      box.title = `图${row.imageIndex} · ${row.slot || row.badge || ""} · ${pt.zh || row.focusDisplay || ""}`;
    });
  }

  function renderSevenImagePlan(isRealCard) {
    const seven = activeSevenPlan();
    const blankNew = isBlankNewProduct();
    const src = state.sevenPlanSource || (activeArchive() && activeArchive().sevenPlanSource) || "";
    const author = state.sevenPlanAuthor || (activeArchive() && activeArchive().sevenPlanAuthor) || "";
    const status = state.sevenPlanStatus || (activeArchive() && activeArchive().sevenPlanStatus) || (src === "authored" ? "final" : "draft_pending");
    const statusLabel =
      state.sevenPlanStatusLabel ||
      (activeArchive() && activeArchive().sevenPlanStatusLabel) ||
      (status === "final"
        ? "定稿"
        : status === "authored_pending_final"
          ? "定稿优先（待终审）"
          : status === "ai_planned_pending_confirm"
            ? "秋霜+安然已规划（待确认）"
            : "待秋霜+安然规划");
    const isAuthored = src === "authored";
    const isDraft = status === "draft_pending";
    const isCollabDone = status === "ai_planned_pending_confirm";
    const tagClass = isDraft ? "tag-demo" : isCollabDone ? "tag-collab" : "tag-real";
    const collabBusy = !!sevenCollabRuntime.busy;
    const collabSec = collabBusy ? Math.max(0, Math.floor((Date.now() - sevenCollabRuntime.startedAt) / 1000)) : 0;

    if (!seven || !seven.length) {
      return `<div class="seven-plan seven-plan-empty-wrap" style="grid-column:1/-1">
        <div class="seven-plan-head">
          <h3>VOC → 七图主题规划</h3>
          <span class="tag ${blankNew ? "tag-mock" : "tag-demo"}">${blankNew ? "新产品待填入信息" : "待秋霜+安然规划"}</span>
        </div>
        <div class="seven-plan-empty">${
          blankNew
            ? "旧产品内容已彻底清空。请在上方填写新产品名称 / 导入 VOC 或点「导入产品数据」粘贴产品总结，秋霜（图1–3）与安然（图4–7）将立即围绕新产品协同规划七图主题。"
            : "导入真实 VOC 或粘贴产品数据后，将按图1→图7横向展示当前产品主题卡片（可左右滚动），并由秋霜+安然针对当前产品完成规划。"
        }</div>
      </div>`;
    }

    const cards = seven
      .map((row) => {
        const idx = row.imageIndex;
        const isMain = idx === 1 || row.allowOverlay === false;
        const who = row.owner || (idx <= 3 ? "秋霜" : "安然");
        const pt = row.primaryTheme || {};
        const secs = row.secondaryThemes || [];
        const chat = (state.sevenThemeChat && state.sevenThemeChat[idx]) || [];
        const busy = !!(state.sevenThemeBusy && state.sevenThemeBusy[idx]);
        const themeView = isMain
          ? `<div class="seven-theme-main"><span class="seven-label">重点展示（构图）</span><textarea class="seven-input" data-seven-idx="${idx}" data-seven-field="focusDisplay" rows="3">${escapeHtml(row.focusDisplay || "")}</textarea><div class="seven-hint">主图零叠字：只写实物构图，不出现画面大标题编辑</div></div>`
          : `<div class="seven-theme">
              <div><span class="seven-label">主主题 · 重点展示</span>
                <input class="seven-input" data-seven-idx="${idx}" data-seven-field="primaryZh" value="${escapeHtml(pt.zh || row.focusDisplay || "")}" />
                <input class="seven-input seven-en" data-seven-idx="${idx}" data-seven-field="primaryEn" value="${escapeHtml(pt.en || "")}" placeholder="英文大标题 ≤6 words" />
              </div>
              <div class="seven-sec-list"><span class="seven-label">次主题</span>
                <textarea class="seven-input" data-seven-idx="${idx}" data-seven-field="secondaryText" rows="3" placeholder="每行：中文 | 英文 | 画面说明">${escapeHtml(
                  secs.map((s) => `${s.zh || ""} | ${s.en || ""} | ${s.panel || ""}`).join("\n")
                )}</textarea>
              </div>
            </div>`;
        const chatLog =
          chat.length > 0
            ? `<div class="seven-theme-chat-log">${chat
                .map(
                  (m) =>
                    `<div class="seven-chat-bubble ${m.role === "user" ? "is-user" : "is-bot"}"><b>${escapeHtml(
                      m.role === "user" ? "Hongyan" : m.who || who
                    )}</b>：${escapeHtml(m.content || "")}</div>`
                )
                .join("")}</div>`
            : `<div class="seven-theme-chat-empty">向${escapeHtml(who)}说重点展示怎么改（不自动生图）</div>`;
        return `<article class="seven-card ${isMain ? "is-main" : ""}" data-seven-idx="${idx}">
          <header class="seven-card-head">
            <div class="seven-idx">图${idx}</div>
            <div class="seven-slot">${escapeHtml(row.slot || row.badge || "")}</div>
            <span class="seven-owner">负责人 · ${escapeHtml(who)}</span>
          </header>
          <div class="seven-card-body">
            ${themeView}
            <div class="seven-field"><span class="seven-label">VOC 依据</span>
              <textarea class="seven-input" data-seven-idx="${idx}" data-seven-field="vocEvidence" rows="2">${escapeHtml(row.vocEvidence || "")}</textarea>
            </div>
            <div class="seven-field"><span class="seven-label">配图说明</span>
              <textarea class="seven-input" data-seven-idx="${idx}" data-seven-field="visualNotes" rows="2">${escapeHtml(row.visualNotes || "")}</textarea>
            </div>
            <div class="seven-theme-chat" data-seven-chat="${idx}">
              <div class="seven-theme-chat-head">和${escapeHtml(who)}改重点展示</div>
              ${chatLog}
              <div class="seven-theme-chat-input-row">
                <input type="text" class="seven-input seven-theme-chat-input" data-seven-chat-input="${idx}" placeholder="例如：重点展示改成……" ${busy ? "disabled" : ""} />
                <button type="button" class="btn btn-sm btn-outline-accent" data-action="send-seven-theme-chat" data-seven-idx="${idx}" ${busy ? "disabled" : ""}>${
                  busy ? "发送中…" : "发给" + who
                }</button>
              </div>
            </div>
          </div>
        </article>`;
      })
      .join("");

    const curProdTitle = state.productName || state.asin || "当前产品";
    const sub = isDraft
      ? `当前为「${escapeHtml(curProdTitle)}」自动归纳草稿，状态「待秋霜+安然规划」——可点右上角「让秋霜+安然立即规划」，或在卡片内分别找秋霜（图1–3）/安然（图4–7）微调。`
      : isCollabDone
        ? `秋霜（图1–3）与安然（图4–7）已针对「${escapeHtml(curProdTitle)}」完成协同规划；可在卡片内继续对话调整，满意后点右上角「确认七图定稿」。`
        : isAuthored
          ? `定稿优先已载入（${escapeHtml(author || "秋霜+安然")} · ${escapeHtml(curProdTitle)}）。横向图1→图7；卡片内可与负责人对话改重点展示（不自动生图）。`
          : "七图主题横向排布；放不下请左右滑动。";

    const collabBanner = collabBusy
      ? `<div class="seven-collab-banner">
          <div class="lhs">
            <span class="spinner"></span>
            <span><strong>秋霜（图1–3 主图/细节/尺寸）+ 安然（图4–7 场景/对比/收口）正在工作：</strong>围绕「${escapeHtml(curProdTitle)}」协同规划七图主题… <span data-collab-elapsed>已用 ${collabSec}s</span></span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-action="cancel-seven-collab">取消</button>
        </div>`
      : "";

    const actionButtons = `
      <div class="seven-plan-actions">
        <button type="button" class="btn ${isDraft ? "btn-primary" : ""} btn-sm" data-action="run-seven-collab" ${collabBusy ? "disabled" : ""}>
          ${collabBusy ? '<span class="spinner"></span> 秋霜+安然规划中…' : isDraft ? "✨ 让秋霜+安然立即规划" : "↻ 让秋霜+安然重新规划"}
        </button>
        ${status !== "final" ? `<button type="button" class="btn btn-success btn-sm" data-action="confirm-seven-final" ${collabBusy ? "disabled" : ""}>✓ 确认七图定稿</button>` : ""}
      </div>`;

    return `<div class="seven-plan" style="grid-column:1/-1">
      <div class="seven-plan-head">
        <h3>VOC → 七图主题规划</h3>
        <span class="tag ${tagClass}" data-seven-status="${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
        ${isDraft ? `<span class="tag tag-demo">待确认草稿</span>` : ""}
        ${isAuthored && !isDraft ? `<span class="tag tag-real">定稿优先</span>` : ""}
        ${actionButtons}
      </div>
      <p class="seven-plan-sub">${sub}</p>
      ${collabBanner}
      <div class="seven-hscroll" tabindex="0" aria-label="七图主题横向滚动">
        <div class="seven-track">${cards}</div>
      </div>
    </div>`;
  }

  async function runCollaborativeSevenPlan(opts) {
    const autoTrigger = !!(opts && opts.auto);
    if (sevenCollabRuntime.busy) {
      if (!autoTrigger) toast("秋霜+安然正在协同规划中，请稍候…");
      return;
    }
    if (!state.archiveOverride && !(state.productSummary || "").trim() && !(state.sevenImagePlan && state.sevenImagePlan.length)) {
      if (!autoTrigger) toast("请先导入 VOC 或粘贴新产品数据，再让秋霜+安然规划");
      return;
    }

    const sessionAtStart = state.productSessionId || (state.productSessionId = newSessionId());
    const ctrl = new AbortController();
    sevenCollabRuntime.busy = true;
    sevenCollabRuntime.startedAt = Date.now();
    sevenCollabRuntime.controller = ctrl;
    sevenCollabRuntime.sessionId = sessionAtStart;
    renderArchive();

    try {
      const res = await API.post(
        "/api/seven-plan/collaborate",
        {
          asin: effectiveAsin() || undefined,
          productName: state.productName || undefined,
          archive: state.archiveOverride || undefined,
          productSummary: state.productSummary || undefined,
          sevenImagePlan: state.sevenImagePlan || undefined,
        },
        { timeoutMs: 85000, signal: ctrl.signal }
      );
      if (state.productSessionId !== sessionAtStart) {
        return; // Switched to another product while in-flight — strictly discard!
      }
      if (!res || res.ok === false) {
        throw new Error((res && res.error) || "秋霜+安然协同规划失败");
      }
      if (res.productName && (!state.productName || state.productName === "新产品")) {
        state.productName = res.productName;
      }
      if (res.productDir && (!state.productDir || state.productDir === "新产品")) {
        state.productDir = res.productDir;
      }
      state.archiveOverride = res.archive || state.archiveOverride;
      state.sevenImagePlan = res.sevenImagePlan || state.sevenImagePlan;
      state.sevenPlanSource = res.sevenPlanSource || "ai_collaborated";
      state.sevenPlanAuthor = res.sevenPlanAuthor || "秋霜（图1–3）+ 安然（图4–7）协同规划";
      state.sevenPlanStatus = res.sevenPlanStatus || "ai_planned_pending_confirm";
      state.sevenPlanStatusLabel = res.sevenPlanStatusLabel || "秋霜+安然已规划（待确认）";
      state.sevenPlanStatusHint = res.sevenPlanStatusHint || null;
      state.planOwnerSig = buildOwnerSig(state.asin, state.productName, state.productSummary);

      state.planBoxes = (res.planBoxes || state.planBoxes || []).map((b) =>
        sanitizeCachedMainPlanBox(
          {
            ...b,
            who: b.who || (["主图", "细节图", "尺寸图"].includes(b.badge) ? "秋霜" : "安然"),
          },
          state.asin,
          state.productName
        )
      );
      Object.keys(state.boxes || {}).forEach((bid) => {
        const b = state.boxes[bid];
        if (!b) return;
        b.briefOverride = null;
        b.promptOverride = null;
      });

      state.sevenThemeChat = state.sevenThemeChat || {};
      if (res.qiushuangReply) {
        state.sevenThemeChat[1] = state.sevenThemeChat[1] || [];
        state.sevenThemeChat[1].push({ role: "assistant", who: "秋霜", content: res.qiushuangReply });
      }
      if (res.anranReply) {
        state.sevenThemeChat[4] = state.sevenThemeChat[4] || [];
        state.sevenThemeChat[4].push({ role: "assistant", who: "安然", content: res.anranReply });
      }

      saveState();
      syncProductIdentityInputs();
      setModeUI();
      renderArchive();
      renderPlans();
      toast(
        res.mock
          ? "已按当前产品资料生成七图结构化草稿（可逐卡微调或点确认定稿）"
          : `秋霜+安然已完成「${state.productName || state.asin || "新产品"}」七图主题规划！请审阅后点「确认七图定稿」`,
        { duration: 4800 }
      );
    } catch (err) {
      if (state.productSessionId !== sessionAtStart) return;
      if (err && err.isCancelled) {
        toast("已取消秋霜+安然协同规划");
      } else if (!autoTrigger) {
        toast("秋霜+安然规划请求提示：" + humanizeError(err, "doubao"), { duration: 4500 });
      }
    } finally {
      if (sevenCollabRuntime.sessionId === sessionAtStart) {
        sevenCollabRuntime.busy = false;
        sevenCollabRuntime.controller = null;
        sevenCollabRuntime.sessionId = null;
        renderArchive();
      }
    }
  }

  async function confirmSevenPlanFinal() {
    if (!state.sevenImagePlan || state.sevenImagePlan.length < 7) {
      toast("当前暂无完整七图主题可确认");
      return;
    }
    try {
      const res = await API.post(
        "/api/seven-plan/confirm",
        {
          asin: effectiveAsin() || undefined,
          productName: state.productName || undefined,
          productSummary: state.productSummary || undefined,
          sevenImagePlan: state.sevenImagePlan,
        },
        { timeoutMs: 25000 }
      );
      state.sevenImagePlan = res.sevenImagePlan || state.sevenImagePlan;
      state.sevenPlanSource = "authored";
      state.sevenPlanAuthor = res.sevenPlanAuthor || "秋霜+安然 · 看板确认终审通过";
      state.sevenPlanFile = res.sevenPlanFile || null;
      state.sevenPlanStatus = "final";
      state.sevenPlanStatusLabel = "定稿";
      if (state.archiveOverride && typeof state.archiveOverride === "object") {
        state.archiveOverride.sevenImagePlan = state.sevenImagePlan;
        state.archiveOverride.sevenPlanSource = "authored";
        state.archiveOverride.sevenPlanAuthor = state.sevenPlanAuthor;
        state.archiveOverride.sevenPlanStatus = "final";
        state.archiveOverride.sevenPlanStatusLabel = "定稿";
      }
      if (Array.isArray(res.planBoxes) && res.planBoxes.length) {
        state.planBoxes = res.planBoxes.map((b) =>
          sanitizeCachedMainPlanBox(
            {
              ...b,
              who: b.who || (["主图", "细节图", "尺寸图"].includes(b.badge) ? "秋霜" : "安然"),
            },
            state.asin,
            state.productName
          )
        );
      }
      saveState();
      renderArchive();
      renderPlans();
      refreshStatusQuiet();
      toast(`✓ 已确认「${state.productName || state.asin || "当前产品"}」七图主题为「定稿」`);
    } catch (err) {
      toast("确认定稿失败：" + humanizeError(err, "voc"), { duration: 4200 });
    }
  }

  function onSevenPlanEdit(e) {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.sevenIdx) return;
    const idx = Number(el.dataset.sevenIdx);
    const field = el.dataset.sevenField;
    if (!state.sevenImagePlan) return;
    const row = state.sevenImagePlan.find((r) => Number(r.imageIndex) === idx);
    if (!row) return;
    const val = el.value;
    if (field === "focusDisplay") row.focusDisplay = val;
    else if (field === "vocEvidence") row.vocEvidence = val;
    else if (field === "visualNotes") row.visualNotes = val;
    else if (field === "primaryZh") {
      row.primaryTheme = row.primaryTheme || {};
      row.primaryTheme.zh = val;
      row.focusDisplay = val;
    } else if (field === "primaryEn") {
      row.primaryTheme = row.primaryTheme || {};
      row.primaryTheme.en = val;
    } else if (field === "secondaryText") {
      row.secondaryThemes = val
        .split("\n")
        .map((ln) => ln.trim())
        .filter(Boolean)
        .map((ln) => {
          const parts = ln.split("|").map((x) => x.trim());
          return { zh: parts[0] || "", en: parts[1] || "", panel: parts[2] || "", kind: "edit" };
        });
    }
    syncPlanBoxesFromSeven();
    saveStateDebounced();
    if (typeof renderPlans === "function") renderPlans();
  }

  async function sendSevenThemeChat(idx) {
    idx = Number(idx);
    if (!idx || !state.sevenImagePlan) return;
    const row = state.sevenImagePlan.find((r) => Number(r.imageIndex) === idx);
    if (!row) return;
    const input = document.querySelector(`[data-seven-chat-input="${idx}"]`);
    const userMsg = ((input && input.value) || "").trim();
    if (!userMsg) {
      if (input) input.focus();
      toast("请先输入重点展示修改意见");
      return;
    }
    const sessionAtStart = state.productSessionId;
    const who = row.owner || (idx <= 3 ? "秋霜" : "安然");
    state.sevenThemeChat = state.sevenThemeChat || {};
    state.sevenThemeChat[idx] = state.sevenThemeChat[idx] || [];
    state.sevenThemeChat[idx].push({ role: "user", content: userMsg, who: "Hongyan" });
    state.sevenThemeBusy = state.sevenThemeBusy || {};
    state.sevenThemeBusy[idx] = true;
    if (input) input.value = "";
    renderArchive();
    try {
      const box = (state.planBoxes || []).find((b) => Number(b.imageIndex) === idx) || {};
      const res = await API.post(
        "/api/seven-theme-chat",
        {
          imageIndex: idx,
          userMessage: userMsg,
          slot: row.slot || row.badge,
          row,
          asin: effectiveAsin(),
          productName: state.productName,
          prompt: box.prompt || "",
          messages: (state.sevenThemeChat[idx] || []).slice(-8).map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          })),
        },
        { timeoutMs: 60000 }
      );
      if (state.productSessionId !== sessionAtStart) return;
      if (!res || res.ok === false) throw new Error((res && res.error) || "主题对话失败");
      if (res.autoGenerate) {
        console.warn("seven-theme-chat ignored autoGenerate");
      }
      const next = res.row || {};
      Object.assign(row, {
        focusDisplay: res.focusDisplay != null ? res.focusDisplay : next.focusDisplay,
        primaryTheme: res.primaryTheme !== undefined ? res.primaryTheme : next.primaryTheme,
        secondaryThemes: res.secondaryThemes || next.secondaryThemes || row.secondaryThemes,
        vocEvidence: res.vocEvidence != null ? res.vocEvidence : next.vocEvidence,
        visualNotes: res.visualNotes != null ? res.visualNotes : next.visualNotes,
        owner: who,
      });
      if (Array.isArray(state.planBoxes)) {
        const b = state.planBoxes.find((x) => Number(x.imageIndex) === idx);
        if (b) {
          if (res.brief) b.brief = res.brief;
          if (res.prompt && idx !== 1) b.prompt = res.prompt;
          b.focusDisplay = row.focusDisplay;
          b.primaryTheme = row.primaryTheme;
          b.secondaryThemes = row.secondaryThemes;
          b.vocEvidence = row.vocEvidence;
          b.visualNotes = row.visualNotes;
          if (idx !== 1) {
            b.title = `图${idx} · ${row.slot || row.badge || ""} · ${(row.primaryTheme && row.primaryTheme.zh) || row.focusDisplay || ""}`;
          }
        }
      }
      syncPlanBoxesFromSeven();
      state.sevenThemeChat[idx].push({ role: "assistant", content: res.reply || "已更新主题", who });
      saveState();
      toast(`${who}已更新图${idx}主题（未生图）`);
    } catch (err) {
      if (state.productSessionId !== sessionAtStart) return;
      state.sevenThemeChat[idx].push({
        role: "assistant",
        content: "对话失败：" + (err.message || String(err)),
        who,
      });
      saveState();
      toast("主题对话失败：" + (err.message || String(err)), { duration: 4000 });
    } finally {
      if (state.productSessionId === sessionAtStart) {
        state.sevenThemeBusy[idx] = false;
        renderArchive();
        if (typeof renderPlans === "function") renderPlans();
      }
    }
  }

  function renderArchive() {
    const data = activeArchive();
    const blankNew = isBlankNewProduct();
    const isRealCard = isRealMode() && state.source === "amazon" && !!state.archiveOverride;
    document.getElementById("source-label").textContent = blankNew
      ? "新产品工作台（待导入 VOC 或粘贴新产品数据）"
      : (data.label || "") + (isRealCard ? " · 真实导入" : " · 演示数据");
    document.querySelectorAll("#source-toggle button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.source === state.source);
    });
    const badgeCls = blankNew ? "tag-mock" : isRealCard ? "tag-real" : "tag-demo";
    const badgeTxt = blankNew ? "待导入" : isRealCard ? "真实" : "演示";
    const cards = [
      { key: "pain", title: "痛点", cls: "pain", items: data.pain || [] },
      { key: "itch", title: "痒点", cls: "itch", items: data.itch || [] },
      { key: "delight", title: "惊喜点", cls: "delight", items: data.delight || [] },
      { key: "reason", title: "选择理由", cls: "reason", items: data.reason || [] },
    ];
    document.getElementById("archive-grid").innerHTML =
      renderSevenImagePlan(isRealCard) +
      cards
        .map(
          (c) => `
      <article class="archive-card ${c.cls}">
        <h3><span class="dot"></span>${c.title} <span class="tag ${badgeCls}">${badgeTxt}</span></h3>
        <ul>${
          c.items.length
            ? c.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")
            : `<li style="color:var(--muted);list-style:none;">（待导入新产品数据）</li>`
        }</ul>
      </article>`
        )
        .join("") +
      `<div class="archive-map" style="grid-column:1/-1">字段映射：${escapeHtml(
        blankNew ? "已彻底清空旧产品，新产品数据导入后自动映射" : data.note || ""
      )} · 七图规划见上方（规范：amazon_secondary_image_voc_callout_rules.md）</div>`;
    const grid = document.getElementById("archive-grid");
    if (grid && !grid._sevenBound) {
      grid.addEventListener("change", onSevenPlanEdit);
      grid.addEventListener("blur", onSevenPlanEdit, true);
      grid.addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-action]");
        if (!btn) return;
        const act = btn.getAttribute("data-action");
        if (act === "send-seven-theme-chat") {
          ev.preventDefault();
          sendSevenThemeChat(btn.getAttribute("data-seven-idx"));
        } else if (act === "run-seven-collab") {
          ev.preventDefault();
          runCollaborativeSevenPlan({ auto: false });
        } else if (act === "cancel-seven-collab") {
          ev.preventDefault();
          if (sevenCollabRuntime.controller) {
            try { sevenCollabRuntime.controller.abort("user"); } catch (_) {}
          }
        } else if (act === "confirm-seven-final") {
          ev.preventDefault();
          confirmSevenPlanFinal();
        }
      });
      grid.addEventListener("keydown", (ev) => {
        const t = ev.target;
        if (!t || !t.dataset || !t.dataset.sevenChatInput) return;
        if (ev.key === "Enter" && !ev.isComposing) {
          ev.preventDefault();
          sendSevenThemeChat(t.dataset.sevenChatInput);
        }
      });
      grid._sevenBound = true;
    }
  }

  function plansByWho() {
    const all = currentPlans();
    const qs = all.filter((b) => b.who === "秋霜" || (b.id || "").startsWith("qs-") || ["主图", "细节图", "尺寸图"].includes(b.badge));
    const qsIds = new Set(qs.map((b) => b.id));
    const ar = all.filter((b) => !qsIds.has(b.id));
    if (!qs.length && !ar.length) {
      if (state.mode === "demo") return { qs: DEMO.qiushuang, ar: DEMO.anran };
      return { qs: [], ar: [] };
    }
    return { qs, ar };
  }

  function resolveRefineProvider(box, selected) {
    if (box.refineProvider && GEN_PROVIDERS.includes(box.refineProvider) && isProviderConfigured(box.refineProvider)) {
      return box.refineProvider;
    }
    if (selected && GEN_PROVIDERS.includes(selected.model) && isProviderConfigured(selected.model)) {
      return selected.model;
    }
    return "doubao";
  }

  function renderPlanBox(plan) {
    const box = ensureBox(plan.id);
    const rt = getRuntime(plan.id);
    const crt = getChatRuntime(plan.id);
    const who = inferOwnerWho(plan);
    const isMain = plan.badge === "主图" || (plan.id || "").startsWith("qs-main");
    const effBrief = getEffectiveBrief(plan, box);
    const effPrompt = getEffectivePrompt(plan, box);

    const selected = box.results.find((r) => r.id === box.selectedResultId);
    const isNonGenSelected = !!(selected && !GEN_PROVIDERS.includes(selected.model));
    const refineProv = resolveRefineProvider(box, selected);

    const elapsedSec = rt.busy ? Math.max(0, Math.floor((Date.now() - rt.startedAt) / 1000)) : 0;
    const loadingHtml = rt.busy
      ? `<div class="gen-loading-bar">
          <div class="lhs">
            <span class="spinner"></span>
            <span>${escapeHtml(rt.text || "正在处理…")}</span>
            <span class="elapsed" data-elapsed-box="${escapeHtml(plan.id)}">已等待 ${elapsedSec}s</span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-action="cancel-box" data-box="${escapeHtml(plan.id)}">取消</button>
        </div>`
      : "";

    const noticeHtml = !rt.busy && rt.lastError
      ? `<div class="box-inline-notice">
          <span>⚠ ${escapeHtml(rt.lastError)}</span>
          <button type="button" title="关闭提示" data-action="dismiss-error" data-box="${escapeHtml(plan.id)}">×</button>
        </div>`
      : "";

    const resultsHtml =
      box.results.length === 0
        ? (rt.busy ? "" : `<div style="font-size:11px;color:var(--muted);margin-top:8px;">尚未生图/挂图 · 可从第 1 层勾选白底图「一键挂入规划框」或点「生成图片」</div>`)
        : `<div class="gen-results">${box.results
            .map((r) => {
              const m = MODEL_MAP[r.model] || { name: r.model, cls: "model-generic" };
              const sel = r.id === box.selectedResultId;
              const vNum = cardEffectiveVersion(r);
              const vTag = `v${vNum}`;
              const fullUrl = r.imageUrl ? API.fileUrl(r.imageUrl) : "";
              const zoomTitle = `${plan.title || plan.id} · ${r.label || `${m.name} ${vTag}`}`;
              const img = fullUrl
                ? `<img src="${escapeHtml(API.thumbnailUrl(fullUrl))}" decoding="async" loading="eager" alt="${escapeHtml(m.name)}" data-lightbox-src="${escapeHtml(fullUrl)}" data-lightbox-title="${escapeHtml(zoomTitle)}" />`
                : `<div class="ph-img ${m.cls}">${escapeHtml(m.name)}<br/>${escapeHtml(vTag)}</div>`;
              return `<div class="gen-card ${sel ? "selected" : ""}" data-box="${escapeHtml(plan.id)}" data-rid="${escapeHtml(r.id)}">
                <button type="button" class="gen-ver-pill ${sel ? "checked" : ""}" data-select-gen="${escapeHtml(r.id)}" data-box="${escapeHtml(plan.id)}" title="点击勾选此图（提示词可用 ${escapeHtml(vTag)} 引用）">
                  ${sel ? "✓ " : ""}${escapeHtml(vTag)}
                </button>
                <button type="button" class="gen-del-btn" data-action="delete-gen-result" data-box="${escapeHtml(plan.id)}" data-rid="${escapeHtml(r.id)}" title="删除此图">×</button>
                ${img}
                <div class="meta" data-select-gen="${escapeHtml(r.id)}" data-box="${escapeHtml(plan.id)}">
                  <div class="meta-line">${escapeHtml(r.label || `${m.name} ${vTag}`)}</div>
                  <div class="gen-card-ops">
                    <span class="pick-txt">${sel ? "✓ 已选" : "未选"}</span>
                  </div>
                </div>
              </div>`;
            })
            .join("")}</div>`;

    const chatMessagesHtml = (box.promptChat || []).length
      ? `<div class="prompt-chat-log" data-chat-log="${escapeHtml(plan.id)}">` +
        box.promptChat
          .map((msg) => {
            const isUser = msg.role === "user";
            const sender = isUser ? "我" : (msg.who || who);
            return `<div class="pchat-msg ${isUser ? "pchat-user" : "pchat-agent"}">
              <span class="pchat-who">${escapeHtml(sender)}：</span>
              <span class="pchat-body">${escapeHtml(msg.content || "")}</span>
            </div>`;
          })
          .join("") +
        `</div>`
      : "";

    const whoBadgeCls = who === "秋霜" ? "badge-qiushuang" : "badge-anran";
    const chatPlaceholder = isMain
      ? `跟${who}说主图提示词怎么改（自动遵守亚马逊主图5条规范，支持如“左侧放v3右上放v6”，回车发送不自动生图）…`
      : `跟${who}沟通优化提示词（如：增加暖光桌面细节 / 突出材质微距，回车发送，仅更新上方提示词不自动生图）…`;

    const promptChatHtml = `
      <div class="prompt-chat-panel">
        <div class="prompt-chat-head">
          <div class="lhs">
            <span class="badge ${whoBadgeCls}">${escapeHtml(who)}</span>
            <strong>与${escapeHtml(who)}对话改提示词</strong>
            ${isMain ? `<span class="main-rule-chip" title="纯白底RGB255 · 占比≥85%不裁切 · 严禁任何说明文字/Logo/水印/边框 · 禁不在售道具 · 2000×2000">亚马逊主图5条规范把关</span>` : ""}
          </div>
          <div class="rhs">
            <span class="pchat-tip">仅改词 · 不自动生图</span>
            ${(box.promptChat || []).length ? `<button type="button" class="link-btn" data-action="clear-prompt-chat" data-box="${escapeHtml(plan.id)}">清空记录</button>` : ""}
          </div>
        </div>
        ${chatMessagesHtml}
        <div class="prompt-chat-input-row">
          <input
            type="text"
            class="pchat-input"
            data-chat-input="${escapeHtml(plan.id)}"
            value="${escapeHtml(crt.draft || "")}"
            placeholder="${escapeHtml(chatPlaceholder)}"
            ${crt.busy ? "disabled" : ""}
          />
          ${
            crt.busy
              ? `<button type="button" class="btn btn-ghost btn-sm" data-action="cancel-prompt-chat" data-box="${escapeHtml(plan.id)}"><span class="spinner"></span> 取消</button>`
              : `<button type="button" class="btn btn-sm btn-outline-accent" data-action="send-prompt-chat" data-box="${escapeHtml(plan.id)}">发给${escapeHtml(who)}优化</button>`
          }
        </div>
      </div>`;

    const refineTitle = isNonGenSelected
      ? `精改支线 · 基于锁定白底图用 ${modelDisplayName(refineProv)} 生成新版`
      : `精改支线 · ${selected ? modelDisplayName(selected.model) : "所选模型"}（严格保持白底基准产品一致）`;

    const refineModelDefs = [
      { id: "doubao", label: "豆包（推荐 · 支持多图参考）" },
      { id: "banana", label: "Banana（Gemini Flash 图生图）" },
      { id: "grok", label: "Grok（xAI Imagine 修图）" },
      { id: "chatgpt", label: "ChatGPT" },
    ];
    const refineModelOptions = refineModelDefs
      .map((opt) => {
        const cfg = isProviderConfigured(opt.id);
        const text = cfg ? opt.label : `${opt.label} — 未配置 ${providerMissingKey(opt.id)}`;
        return `<option value="${opt.id}" ${refineProv === opt.id ? "selected" : ""} ${cfg ? "" : "disabled"}>${escapeHtml(text)}</option>`;
      })
      .join("");

    const refineHtml = `
      <div class="refine-panel ${box.refineOpen ? "open" : ""}">
        <h5>${escapeHtml(refineTitle)}</h5>
        <div class="refine-model-bar">
          <span class="${isNonGenSelected ? "refine-upload-tip" : ""}">精改出图模型（强制锚定白底产品基准图）：</span>
          <select data-refine-provider="${escapeHtml(plan.id)}" ${rt.busy ? "disabled" : ""}>${refineModelOptions}</select>
        </div>
        <div class="refine-row">
          <textarea rows="2" placeholder="输入构图/光线/场景修改意见（禁止修改产品自身形状/结构/颜色/材质）…" data-refine-input="${escapeHtml(plan.id)}" ${rt.busy ? "disabled" : ""}>${escapeHtml(box.refineDraft || "")}</textarea>
        </div>
        <div class="refine-row">
          <button type="button" class="btn btn-sm" data-action="rewrite-prompt" data-box="${escapeHtml(plan.id)}" ${rt.busy ? "disabled" : ""}>暂存意见</button>
          <button type="button" class="btn btn-primary btn-sm" data-action="optimize" data-box="${escapeHtml(plan.id)}" ${!selected || rt.busy ? "disabled" : ""}>
            ${rt.busy ? '<span class="spinner"></span> 处理中…' : `优化 → 生成新版（${escapeHtml(modelDisplayName(refineProv))}）`}
          </button>
        </div>
        <div style="font-size:11px;color:var(--muted);">先优化提示词，再附带「锁定白底产品图」调用模型输出 2000×2000 新版存入「过程图/」</div>
      </div>`;

    return `
      <article class="img-box ${box.inPreview ? "picked-for-preview" : ""}" data-box-id="${escapeHtml(plan.id)}">
        <div class="img-box-head">
          <span class="slot-chip">${escapeHtml(plan.slotHint || plan.badge || "")}</span>
          <div>
            <div class="img-box-title">${escapeHtml(plan.title)}</div>
            <div class="img-box-meta">${escapeHtml(plan.role || "")}</div>
          </div>
        </div>
        <div class="label-sm">文字版策划</div>
        <div class="brief-text" contenteditable="true" id="brief-${escapeHtml(plan.id)}" data-brief="${escapeHtml(plan.id)}">${escapeHtml(effBrief)}</div>
        <div class="label-sm">生图提示词（服务端自动注入白底本体防魔改锁 · 支持写 v1/v3/v6 自动绑定多张参考图）</div>
        <div class="prompt-text" contenteditable="true" id="prompt-${escapeHtml(plan.id)}" data-prompt="${escapeHtml(plan.id)}">${escapeHtml(effPrompt)}</div>
        ${promptChatHtml}
        <div class="box-actions">
          <button type="button" class="btn btn-primary btn-sm" data-action="generate" data-box="${escapeHtml(plan.id)}" ${rt.busy ? "disabled" : ""}>
            ${rt.busy ? '<span class="spinner"></span> 生成中…' : "生成图片"}
          </button>
          <button type="button" class="btn btn-sm" data-action="upload-box" data-box="${escapeHtml(plan.id)}" ${rt.busy ? "disabled" : ""}>上传图片</button>
          <button type="button" class="btn btn-sm" data-action="toggle-refine" data-box="${escapeHtml(plan.id)}" ${box.results.length ? "" : "disabled"}>精改支线</button>
          <button type="button" class="btn btn-success btn-sm" data-action="add-preview" data-box="${escapeHtml(plan.id)}" ${selected ? "" : "disabled"}>
            ${box.inPreview ? "已在预览（更新）" : "加入预览"}
          </button>
          ${selected ? `<span style="font-size:11px;color:var(--green);">已选：${escapeHtml(modelDisplayName(selected.model))} v${cardEffectiveVersion(selected)}</span>` : `<span style="font-size:11px;color:var(--muted);">请勾选一张</span>`}
        </div>
        ${loadingHtml}
        ${noticeHtml}
        ${resultsHtml}
        ${refineHtml}
      </article>`;
  }

  function renderPlans() {
    if (WB) WB.renderLockBanner();
    const { qs, ar } = plansByWho();
    const qsWhoEl = document.getElementById("qs-track-who");
    if (qsWhoEl) {
      const badges = [...new Set(qs.map((b) => b.badge || (b.id.startsWith("qs-main") ? "主图" : b.id.startsWith("qs-size") ? "尺寸图" : "细节图")).filter(Boolean))];
      qsWhoEl.textContent = badges.length ? badges.join(" · ") : "主图 · 细节图 · 尺寸图";
    }
    const emptyPlanMsg = isBlankNewProduct() ? "<div class='empty-msg'>新产品待规划 · 请在第 1 层导入 VOC 或粘贴新产品数据，秋霜与安然将按新产品生成规划框</div>" : "<div class='empty-msg'>暂无规划框</div>";
    document.getElementById("boxes-qiushuang").innerHTML = qs.map(renderPlanBox).join("") || emptyPlanMsg;
    document.getElementById("boxes-anran").innerHTML = ar.map(renderPlanBox).join("") || emptyPlanMsg;
  }

  async function sendPromptChat(boxId) {
    const crt = getChatRuntime(boxId);
    if (crt.busy) return;
    const inputEl = document.querySelector(`input[data-chat-input="${boxId}"]`);
    const userMessage = ((inputEl ? inputEl.value : crt.draft) || "").trim();
    if (!userMessage) {
      if (inputEl) inputEl.focus();
      toast("请先输入要对负责人说的提示词修改需求");
      return;
    }

    const plan = findPlan(boxId);
    const box = ensureBox(boxId);
    const who = inferOwnerWho(plan);
    const promptEl = document.getElementById(`prompt-${boxId}`);
    const briefEl = document.getElementById(`brief-${boxId}`);
    const curPrompt = (promptEl ? promptEl.innerText : getEffectivePrompt(plan, box)).trim();
    const curBrief = (briefEl ? briefEl.innerText : getEffectiveBrief(plan, box)).trim();

    const ctrl = new AbortController();
    crt.busy = true;
    crt.controller = ctrl;
    crt.draft = userMessage;
    renderPlans();

    try {
      const res = await API.post(
        "/api/prompt-chat",
        {
          boxId,
          who,
          badge: (plan && plan.badge) || (boxId.startsWith("qs-main") ? "主图" : ""),
          title: (plan && plan.title) || boxId,
          asin: effectiveAsin() || "",
          productName: state.productName || "",
          brief: curBrief,
          prompt: curPrompt,
          messages: (box.promptChat || []).slice(-8),
          userMessage,
        },
        { timeoutMs: 38000, signal: ctrl.signal }
      );

      box.promptChat.push({ role: "user", content: userMessage, ts: Date.now() });
      box.promptChat.push({
        role: "assistant",
        who: res.who || who,
        content: res.reply || "已优化提示词。",
        ts: Date.now(),
      });

      if (res.newPrompt && res.newPrompt.trim()) {
        setPlanPrompt(boxId, res.newPrompt.trim());
      }
      if (res.newBrief && res.newBrief.trim()) {
        setPlanBrief(boxId, res.newBrief.trim());
      }

      crt.draft = "";
      saveState();
      renderPlans();

      const updatedPromptEl = document.getElementById(`prompt-${boxId}`);
      if (updatedPromptEl) {
        updatedPromptEl.classList.remove("flash-highlight");
        void updatedPromptEl.offsetWidth;
        updatedPromptEl.classList.add("flash-highlight");
      }
      const chatLog = document.querySelector(`[data-chat-log="${boxId}"]`);
      if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
      toast(`${res.who || who}已优化并更新生图提示词（未自动生图，确认后点「生成图片」）`, { duration: 4200 });
    } catch (e) {
      if (e && e.isCancelled) {
        toast("已取消对话请求");
      } else {
        toast(`与${who}对话失败：` + humanizeError(e, "doubao"), { duration: 4500 });
      }
    } finally {
      crt.busy = false;
      crt.controller = null;
      renderPlans();
    }
  }

  async function deleteBoxResult(boxId, rid) {
    const box = ensureBox(boxId);
    const target = (box.results || []).find((r) => r.id === rid);
    if (!target) return;

    box.results = box.results.filter((r) => r.id !== rid);
    if (box.selectedResultId === rid) {
      box.selectedResultId = box.results.length ? box.results[box.results.length - 1].id : null;
    }

    let previewChanged = false;
    state.preview = state.preview.map((p) => {
      if (p && p.boxId === boxId && (p.resultId === rid || p.imageUrl === target.imageUrl)) {
        previewChanged = true;
        return null;
      }
      return p;
    });
    reconcilePreviewFlags();
    saveState();
    renderPlans();
    if (previewChanged) renderPreview();
    renderUploadLib();

    const stillInWhitebg = (state.whitebgResults || []).some((w) => w.imageUrl === target.imageUrl);
    if (target.imageUrl && !stillInWhitebg) {
      try {
        await API.post("/api/file/delete", { imageUrl: target.imageUrl }, { timeoutMs: 15000 });
        refreshStatusQuiet();
      } catch (_) {}
    }
    toast(`已删除「${target.label || "生图结果"}」`);
  }

  function buildPreviewFilename(item, slotIdx) {
    const asinPart = (state.asin || "PRODUCT").replace(/[^A-Za-z0-9_-]/g, "");
    const extMatch = /\.([a-zA-Z0-9]{3,4})(?:\?|$)/.exec(item.imageUrl || "");
    const ext = extMatch ? extMatch[1].toLowerCase() : "png";
    const cleanTitle = String(item.title || `slot${slotIdx + 1}`)
      .replace(/[/\\:*?"<>|#%\s]+/g, "_")
      .slice(0, 32);
    return `${asinPart}_Listing_${slotIdx + 1}_${cleanTitle}.${ext}`;
  }

  async function downloadPreviewSlot(idx) {
    const item = state.preview[idx];
    if (!item || !item.imageUrl) {
      toast("该预览槽位暂无可下载的图片");
      return;
    }
    const fname = buildPreviewFilename(item, idx);
    toast(`正在下载 #${idx + 1}：${fname}`);
    await API.triggerDownload(item.imageUrl, fname);
  }

  let previewDownloading = false;

  async function downloadAllPreview() {
    if (previewDownloading) return;
    const filled = state.preview
      .map((item, idx) => (item && item.imageUrl ? { item, idx } : null))
      .filter(Boolean);
    if (!filled.length) {
      toast("预览框中暂无图片可下载");
      return;
    }
    const dlAllBtn = document.getElementById("btn-download-all-preview");
    previewDownloading = true;
    if (dlAllBtn) dlAllBtn.disabled = true;
    const asinPart = (state.asin || "PRODUCT").replace(/[^A-Za-z0-9_-]/g, "") || "PRODUCT";
    const zipName = `${asinPart}_Listing_preview_${filled.length}imgs.zip`;
    toast(`正在打包 ${filled.length} 张预览图为压缩包…`);
    try {
      const items = filled.map(({ item, idx }) => ({
        imageUrl: item.imageUrl,
        filename: buildPreviewFilename(item, idx),
        slot: idx + 1,
        title: item.title || `slot${idx + 1}`,
      }));
      const result = await API.downloadZipBatches(items, {
        zipName, body: { asin: state.asin || asinPart, productName: state.productName || "" }
      });
      toast(`已发起 ${result.count} 张预览原图、${result.packages} 个 ZIP 下载 · 多包请允许连续下载`);
    } catch (e) {
      toast(`打包下载失败：${(e && e.message) || e}（已发起下载 ${e.downloadedCount || 0}/${filled.length} 张）`);
    } finally {
      previewDownloading = false;
      if (dlAllBtn) {
        const hasFilled = state.preview.some((it) => it && it.imageUrl);
        dlAllBtn.disabled = !hasFilled;
      }
    }
  }

  function renderPreview() {
    const root = document.getElementById("preview-slots");
    const dlAllBtn = document.getElementById("btn-download-all-preview");
    const hasFilled = state.preview.some((it) => it && it.imageUrl);
    if (dlAllBtn) dlAllBtn.disabled = previewDownloading || !hasFilled;

    root.innerHTML = state.preview
      .map((item, idx) => {
        if (!item) {
          return `<div class="preview-slot" data-slot="${idx}"><span class="slot-num">#${idx + 1}</span>
            <div class="slot-body" data-slot-body="${idx}"><div class="empty-hint">空槽 · 从上层「加入预览」或一键填入</div></div></div>`;
        }
        const m = MODEL_MAP[item.model] || { name: item.model, cls: "model-generic" };
        const fullUrl = item.imageUrl ? API.fileUrl(item.imageUrl) : "";
        const zoomTitle = `预览槽 #${idx + 1} · ${item.title}（${modelDisplayName(item.model)} v${item.version} · 2000×2000）`;
        const ph = fullUrl
          ? `<img class="slot-ph" style="object-fit:cover" src="${escapeHtml(API.thumbnailUrl(fullUrl))}" decoding="async" loading="eager" alt="${escapeHtml(item.title)}" data-lightbox-src="${escapeHtml(fullUrl)}" data-lightbox-title="${escapeHtml(zoomTitle)}" />`
          : `<div class="slot-ph ${m.cls}">${escapeHtml(m.name)} v${item.version}</div>`;
        return `<div class="preview-slot filled" data-slot="${idx}">
          <span class="slot-num">#${idx + 1}</span>
          <div class="slot-body" draggable="true" data-slot-body="${idx}">
            ${ph}
            <div class="slot-title">${escapeHtml(item.title)}</div>
            <div class="slot-src">${escapeHtml(modelDisplayName(item.model))} v${item.version} · 2000×2000</div>
          </div>
          <div class="slot-ops">
            <button type="button" data-action="preview-up" data-slot="${idx}">前移</button>
            <button type="button" data-action="preview-down" data-slot="${idx}">后移</button>
            <button type="button" class="primary-op" data-action="preview-download" data-slot="${idx}" title="下载 2000×2000 原图">下载</button>
            <button type="button" class="danger" data-action="preview-remove" data-slot="${idx}">移除</button>
          </div>
        </div>`;
      })
      .join("");
  }

  function openGenModal(boxId) {
    const rt = getRuntime(boxId);
    if (rt.busy) {
      toast("该规划框正在生成中，请稍候或点框内「取消」");
      return;
    }
    const wbRef = WB && WB.getActiveRef();
    if (!wbRef || !wbRef.imageUrl) {
      rt.lastError = "已阻断生图：请先在第 1 层完成「白底真修」（永久规则：禁止无白底参考图纯文生空想产品）";
      renderPlans();
      if (WB) WB.focusSection("请先完成第 1 层「白底真修」锁定产品本体后再生成图片");
      return;
    }
    state.genTargetBoxId = boxId;
    const plan = findPlan(boxId);
    const box = ensureBox(boxId);
    const promptEl = document.getElementById(`prompt-${boxId}`);
    const curPrompt = (promptEl ? promptEl.innerText : getEffectivePrompt(plan, box)).trim();
    const vInfo = resolvePromptVersionRefs(curPrompt, boxId);

    document.getElementById("gen-modal-desc").textContent =
      `为「${plan ? plan.title : boxId}」勾选图生图模型（输出 2000×2000 存入「过程图/」）。`;

    const refCard = document.getElementById("gen-modal-ref");
    if (refCard) {
      if (vInfo.matched.length > 0) {
        const thumbs = vInfo.matched
          .map((it, idx) => {
            const u = API.fileUrl(it.imageUrl);
            return `<div class="modal-multi-item">
              <img src="${escapeHtml(API.thumbnailUrl(u))}" decoding="async" loading="eager" alt="${escapeHtml(it.tag)}" data-lightbox-src="${escapeHtml(u)}" data-lightbox-title="多图参考 图${idx + 1} (${escapeHtml(it.tag)}) · ${escapeHtml(it.label)}" />
              <span>图${idx + 1} ← ${escapeHtml(it.tag)}</span>
            </div>`;
          })
          .join("");
        const warnMissing = vInfo.missing.length
          ? `<div style="color:var(--danger);font-size:11px;margin-top:4px;">⚠ 未找到版本：${vInfo.missing.map((v) => "v" + v).join("、")}（请确认对应版本图尚未删除）</div>`
          : "";
        refCard.innerHTML = `<div style="width:100%;">
          <div><strong>🔗 已自动识别提示词中的 ${vInfo.matched.length} 张版本参考图（将按多图融合传入豆包/模型）：</strong></div>
          <div class="modal-multi-thumbs">${thumbs}</div>
          ${warnMissing}
        </div>`;
      } else {
        const u = API.fileUrl(wbRef.imageUrl);
        refCard.innerHTML = `<img src="${escapeHtml(API.thumbnailUrl(u))}" decoding="async" loading="eager" alt="${escapeHtml(wbRef.label)}" data-lightbox-src="${escapeHtml(u)}" data-lightbox-title="绑定白底产品基准图 · ${escapeHtml(wbRef.label)}" />
          <div>
            <div><strong>🔒 强制绑定产品本体：${escapeHtml(wbRef.label)}</strong></div>
            <div style="font-size:11px;opacity:.9;">严格保持原产品外形/结构/颜色/比例/材质不变；提示词写 v1/v3/v6 可自动传多张参考图</div>
          </div>`;
      }
    }

    document.querySelectorAll("#gen-modal-models label").forEach((lab) => {
      const input = lab.querySelector("input");
      const id = input.value;
      const cfg = isProviderConfigured(id);
      const missKey = providerMissingKey(id);
      let tip = lab.querySelector(".cfg-tip");
      if (!tip) {
        tip = document.createElement("span");
        tip.className = "cfg-tip";
        tip.style.marginLeft = "auto";
        tip.style.fontSize = "11px";
        lab.style.display = "flex";
        lab.appendChild(tip);
      }
      if (!cfg) {
        input.checked = false;
        input.disabled = true;
        lab.classList.remove("checked");
        lab.classList.add("disabled-unconfigured");
        tip.textContent = `○ 未配置（缺 ${missKey}）`;
        tip.style.color = "var(--muted)";
      } else {
        input.disabled = false;
        lab.classList.remove("disabled-unconfigured");
        lab.classList.toggle("checked", input.checked);
        if (id === "chatgpt") {
          tip.textContent = "● 已配置 · 额度可能不足";
          tip.style.color = "var(--orange, #a95832)";
        } else {
          tip.textContent = "● 已配置";
          tip.style.color = "var(--green)";
        }
      }
    });
    document.getElementById("gen-modal").classList.add("open");
  }

  function closeGenModal() {
    state.genTargetBoxId = null;
    document.getElementById("gen-modal").classList.remove("open");
  }

  async function refreshStatusQuiet() {
    try {
      serverStatus = await API.get("/api/status", { timeoutMs: 12000 });
      renderProviderStatus();
      setModeUI();
    } catch (_) {}
  }

  function inferKind(boxId) {
    if ((boxId || "").startsWith("qs-main")) return "main";
    if ((boxId || "").startsWith("qs-detail")) return "detail";
    if ((boxId || "").startsWith("qs-size")) return "size";
    const m = /ar-scene-(\d+)/.exec(boxId || "");
    if (m) return "scene-" + m[1];
    if ((boxId || "").startsWith("ar-")) return "scene";
    return "raw";
  }

  async function runGenerate() {
    const boxId = state.genTargetBoxId;
    if (!boxId) return;
    const wbRef = WB && WB.getActiveRef();
    if (!wbRef || !wbRef.imageUrl) {
      closeGenModal();
      if (WB) WB.focusSection("缺少精修白底产品图，已阻断生图");
      return;
    }
    const checked = [...document.querySelectorAll("#gen-modal-models input:checked")]
      .filter((i) => !i.disabled)
      .map((i) => i.value);
    if (!checked.length) {
      toast("请至少勾选一个已配置的生图模型");
      return;
    }
    const plan = findPlan(boxId);
    const box = ensureBox(boxId);
    const promptEl = document.getElementById(`prompt-${boxId}`);
    const prompt = (promptEl ? promptEl.innerText.trim() : getEffectivePrompt(plan, box)).trim();
    if (!prompt) {
      toast("生图提示词不能为空，请填写提示词");
      return;
    }
    setPlanPrompt(boxId, prompt);

    const vInfo = resolvePromptVersionRefs(prompt, boxId);
    if (vInfo.missing.length) {
      toast(`注意：提示词中的 ${vInfo.missing.map((v) => "v" + v).join("、")} 未找到对应卡片，已按现有参考图生图`, { duration: 4200 });
    }
    closeGenModal();

    const rt = getRuntime(boxId);
    const ctrl = new AbortController();
    rt.busy = true;
    rt.startedAt = Date.now();
    rt.controller = ctrl;
    rt.lastError = null;

    const okNames = [];
    const errMsgs = [];
    let cancelled = false;

    try {
      for (let i = 0; i < checked.length; i++) {
        const mid = checked[i];
        const mName = modelDisplayName(mid);
        const multiLabel = vInfo.matched.length > 0 ? `（绑定 ${vInfo.matched.map((x) => x.tag).join("+")} 多图参考）` : "（锚定白底基准图）";
        rt.text = checked.length > 1
          ? `生成 (${i + 1}/${checked.length})：${mName}${multiLabel}…`
          : `${mName} 图生图中${multiLabel} · 输出 2000×2000…`;
        renderPlans();
        toast(rt.text, { duration: 4000 });

        try {
          const nextVer = Math.max(0, ...box.results.map((r) => cardEffectiveVersion(r))) + 1;
          const perModelTimeout = mid === "banana" ? 100000 : 180000;
          const res = await API.post(
            "/api/generate",
            {
              provider: mid,
              prompt,
              boxId,
              asin: effectiveAsin() || "NOASIN",
              productName: state.productName || "",
              whitebgImageUrl: wbRef.imageUrl,
              refImages: vInfo.matched,
              version: nextVer,
              kind: inferKind(boxId),
            },
            { timeoutMs: perModelTimeout, signal: ctrl.signal }
          );
          const id = `${boxId}-${mid}-v${nextVer}-${Date.now()}`;
          box.results.push({
            id,
            model: mid,
            version: nextVer,
            label: `${mName} · v${nextVer} · 真实`,
            imageUrl: res.imageUrl,
            macPath: res.saved && res.saved.macPath,
            mock: false,
          });
          box.selectedResultId = id;
          box.refineProvider = mid;
          if (res.productDir) state.productDir = res.productDir;
          if (res.saved && res.saved.category) state.lastSavePath = res.saved.category + "/" + res.saved.filename;
          okNames.push(mName);
          saveState();
          renderPlans();
        } catch (e) {
          if (e && e.isCancelled) {
            cancelled = true;
            break;
          }
          const msg = humanizeError(e, mid);
          errMsgs.push(msg);
          rt.lastError = msg;
        }
      }
    } finally {
      rt.busy = false;
      rt.controller = null;
      rt.text = "";
      saveState();
      setModeUI();
      renderPlans();
      refreshStatusQuiet();
    }

    if (cancelled) toast("已取消生成", { duration: 3000 });
    else if (okNames.length > 0 && !errMsgs.length) toast(`生成完成（${okNames.join("、")}）· 2000×2000 已存入「过程图/」`, { duration: 4200 });
    else if (okNames.length > 0 && errMsgs.length) toast(`已完成 ${okNames.join("、")}；${errMsgs.join("；")}`, { duration: 5500 });
    else if (errMsgs.length) toast(errMsgs.join("；"), { duration: 5500 });
  }

  async function optimizeBox(boxId) {
    const box = ensureBox(boxId);
    const rt = getRuntime(boxId);
    if (rt.busy) return toast("当前规划框正在处理中，请稍候");
    const wbRef = WB && WB.getActiveRef();
    if (!wbRef || !wbRef.imageUrl) {
      rt.lastError = "请先在第 1 层完成「白底真修」锁定产品本体后再执行精改生图";
      renderPlans();
      if (WB) WB.focusSection("请先完成「白底真修」锁定产品本体后再执行精改");
      return;
    }
    const selected = box.results.find((r) => r.id === box.selectedResultId);
    if (!selected) return toast("请先勾选一张图");

    const ta = document.querySelector(`textarea[data-refine-input="${boxId}"]`);
    if (ta) box.refineDraft = ta.value;
    const selEl = document.querySelector(`select[data-refine-provider="${boxId}"]`);
    if (selEl && GEN_PROVIDERS.includes(selEl.value) && isProviderConfigured(selEl.value)) {
      box.refineProvider = selEl.value;
    }
    const targetProvider = resolveRefineProvider(box, selected);
    const targetName = modelDisplayName(targetProvider);

    const plan = findPlan(boxId);
    const promptEl = document.getElementById(`prompt-${boxId}`);
    const prompt = (promptEl ? promptEl.innerText.trim() : getEffectivePrompt(plan, box)).trim();
    const instruction = (box.refineDraft || "").trim() || "优化画面构图与光影层次，严格保持产品外观结构材质一致";

    const ctrl = new AbortController();
    rt.busy = true;
    rt.startedAt = Date.now();
    rt.controller = ctrl;
    rt.lastError = null;
    rt.text = "正在优化提示词（保留白底本体硬约束）…";
    renderPlans();
    toast("正在优化提示词并基于白底基准图生成精改新版…", { duration: 3500 });

    let newPrompt = prompt;
    const nextVer = Math.max(1, ...box.results.map((r) => cardEffectiveVersion(r))) + 1;

    try {
      try {
        const chat = await API.post(
          "/api/refine",
          { provider: targetProvider, boxId, kind: inferKind(boxId), prompt, instruction },
          { timeoutMs: 45000, signal: ctrl.signal }
        );
        newPrompt = chat.newPrompt || prompt;
        setPlanPrompt(boxId, newPrompt);
      } catch (e) {
        if (e && e.isCancelled) throw e;
        newPrompt = prompt + "\n\nRefinement: " + instruction;
        setPlanPrompt(boxId, newPrompt);
      }

      const vInfo = resolvePromptVersionRefs(newPrompt + " " + instruction, boxId);
      rt.text = `${targetName} 正在基于白底基准图生成精改版 v${nextVer}（2000×2000）…`;
      renderPlans();

      const res = await API.post(
        "/api/generate",
        {
          provider: targetProvider,
          prompt: newPrompt,
          boxId,
          asin: effectiveAsin() || "",
          productName: state.productName || "",
          whitebgImageUrl: wbRef.imageUrl,
          refImages: vInfo.matched,
          version: nextVer,
          kind: inferKind(boxId) === "main" ? "main" : "refine",
        },
        { timeoutMs: targetProvider === "banana" ? 100000 : 180000, signal: ctrl.signal }
      );
      const id = `${boxId}-${targetProvider}-v${nextVer}-${Date.now()}`;
      box.results.push({
        id,
        model: targetProvider,
        version: nextVer,
        label: `${targetName} · v${nextVer} · 精改`,
        imageUrl: res.imageUrl,
        macPath: res.saved && res.saved.macPath,
        mock: false,
      });
      box.selectedResultId = id;
      box.refineProvider = targetProvider;
      if (res.productDir) state.productDir = res.productDir;
      if (res.saved) state.lastSavePath = res.saved.category + "/" + res.saved.filename;
      toast(`精改完成：已生成 ${targetName} v${nextVer}（2000×2000）`, { duration: 4200 });
    } catch (e) {
      if (e && e.isCancelled) toast("已取消精改生成", { duration: 3000 });
      else {
        const msg = humanizeError(e, targetProvider);
        rt.lastError = "精改失败：" + msg;
        toast("精改生图失败：" + msg, { duration: 5500 });
      }
    } finally {
      rt.busy = false;
      rt.controller = null;
      rt.text = "";
      saveState();
      setModeUI();
      renderPlans();
      refreshStatusQuiet();
    }
  }

  function addToPreview(boxId) {
    const box = ensureBox(boxId);
    const selected = box.results.find((r) => r.id === box.selectedResultId);
    if (!selected || !selected.imageUrl) return toast("请先在框内生成或上传并勾选一张真实图片");
    const plan = findPlan(boxId);
    const entry = {
      boxId,
      title: plan ? plan.title : boxId,
      model: selected.model,
      version: cardEffectiveVersion(selected),
      resultId: selected.id,
      imageUrl: selected.imageUrl,
    };
    const existing = state.preview.findIndex((p) => p && p.boxId === boxId);
    if (existing >= 0) state.preview[existing] = entry;
    else {
      const empty = state.preview.findIndex((p) => !p);
      if (empty < 0) return toast("预览已满 7 槽，请先移除一个槽位");
      state.preview[empty] = entry;
    }
    box.inPreview = true;
    saveState();
    renderPlans();
    renderPreview();
    if (WB) WB.syncPreviewToFinal({ silent: true });
    toast("已加入预览框并同步写入「最终版本/」");
  }

  async function autoFillPreview() {
    const plans = currentPlans();
    const readyPlans = plans.filter((p) => {
      const b = state.boxes[p.id];
      return b && b.results && b.results.some((r) => r && r.imageUrl && !r.mock);
    });
    if (!readyPlans.length) {
      return toast("请先完成白底真修并在上方规划框生成或上传图片，再一键填入预览");
    }
    state.preview = [null, null, null, null, null, null, null];
    Object.values(state.boxes).forEach((b) => (b.inPreview = false));
    readyPlans.slice(0, 7).forEach((plan, idx) => {
      const box = ensureBox(plan.id);
      const validResults = box.results.filter((r) => r && r.imageUrl && !r.mock);
      const selected = validResults.find((r) => r.id === box.selectedResultId) || validResults[validResults.length - 1];
      box.selectedResultId = selected.id;
      state.preview[idx] = {
        boxId: plan.id,
        title: plan.title,
        model: selected.model,
        version: cardEffectiveVersion(selected),
        resultId: selected.id,
        imageUrl: selected.imageUrl,
      };
      box.inPreview = true;
    });
    saveState();
    renderPlans();
    renderPreview();
    if (WB) await WB.syncPreviewToFinal({ silent: false });
  }

  const KIND_TO_BOX = {
    main: "qs-main", detail: "qs-detail", size: "qs-size",
    "scene-1": "ar-scene-1", "scene-2": "ar-scene-2", "scene-3": "ar-scene-3",
    "scene-4": "ar-scene-4", "scene-5": "ar-scene-5", "scene-6": "ar-scene-6", "scene-7": "ar-scene-7",
    refine: null, preview: null,
  };

  function renderUploadLib() {
    const root = document.getElementById("upload-lib-thumbs");
    if (!root) return;
    const uploads = [];
    Object.values(state.boxes || {}).forEach((b) => {
      (b.results || []).forEach((r) => {
        if ((r.model === "upload" || r.uploaded) && r.imageUrl) uploads.push(r);
      });
    });
    if (!uploads.length) {
      root.innerHTML = `<div class="empty-msg" style="padding:10px 4px;">尚未上传自有图 · 支持 PNG / JPG / WebP（自动转存 2000×2000 PNG/JPG）</div>`;
      return;
    }
    root.innerHTML = uploads
      .slice(-12)
      .reverse()
      .map((r, idx) => {
        const fullUrl = API.fileUrl(r.imageUrl);
        return `<div class="upload-lib-card" title="${escapeHtml(r.label || "")}">
          <img src="${escapeHtml(API.thumbnailUrl(fullUrl))}" decoding="async" loading="eager" alt="${escapeHtml(r.label || "upload")}" data-lightbox-src="${escapeHtml(fullUrl)}" data-lightbox-title="${escapeHtml(r.label || "自有上传图")}" />
          <div class="meta">${escapeHtml(r.label || "upload")}</div>
          <button type="button" class="btn btn-ghost btn-sm" style="width:100%;border:none;border-top:1px solid var(--line);border-radius:0;padding:3px 4px;font-size:10px;" data-use-as-wbsrc="${idx}">设为白底原图</button>
        </div>`;
      })
      .join("");
  }

  function attachUploadResult(res, boxId, kind) {
    let targetBox = boxId || KIND_TO_BOX[kind] || "qs-main";
    const plans = currentPlans();
    if (!plans.find((p) => p.id === targetBox) && plans.length) {
      const byPrefix = plans.find((p) => p.id.startsWith(targetBox)) || (targetBox.startsWith("ar-") ? plans.find((p) => p.who === "安然") : null);
      if (byPrefix) targetBox = byPrefix.id;
    }
    const box = ensureBox(targetBox);
    const hadPrior = box.results.length > 0;
    const nextVer = Math.max(0, ...box.results.map((r) => cardEffectiveVersion(r))) + 1;
    const id = `upload-${targetBox}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const item = {
      id, model: "upload", uploaded: true, version: nextVer,
      label: `自有上传 v${nextVer} · ${kind || targetBox}`,
      imageUrl: res.imageUrl, macPath: res.saved && res.saved.macPath, mock: false,
    };
    box.results.push(item);
    box.selectedResultId = id;
    box.refineProvider = "doubao";
    if (res.productDir) state.productDir = res.productDir;
    if (res.saved && res.saved.category) state.lastSavePath = res.saved.category + "/" + res.saved.filename;
    return { item, hadPrior, targetBox };
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error("读取图片文件失败"));
      fr.readAsDataURL(file);
    });
  }

  async function uploadOwnFiles(files, kind, boxId) {
    const list = [...files].filter((f) => f && (f.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(f.name)));
    if (!list.length) return toast("请选择 PNG / JPG / WebP 图片文件");
    const st = document.getElementById("upload-status");
    const btnUp = document.getElementById("btn-upload-own");
    if (btnUp) btnUp.disabled = true;
    if (st) { st.className = "voc-status"; st.innerHTML = `<span class="spinner"></span> 上传规范化中 0/${list.length}…`; }
    let ok = 0;
    let switchedFromPrior = false;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (st) st.innerHTML = `<span class="spinner"></span> 上传规范化中 ${i + 1}/${list.length}…`;
      try {
        const dataUrl = await readFileAsDataURL(file);
        const res = await API.post(
          "/api/upload",
          {
            asin: effectiveAsin() || "UPLOAD",
            productName: state.productName || "",
            boxId: boxId || KIND_TO_BOX[kind] || "",
            kind,
            filename: file.name,
            mime: file.type,
            dataBase64: dataUrl,
          },
          { timeoutMs: 45000 }
        );
        const attached = attachUploadResult(res, res.boxId || boxId, kind);
        if (attached.hadPrior) switchedFromPrior = true;
        if (!state.whitebgSources.length && WB) {
          WB.addSourceItem(file.name || "已上传原图", res.imageUrl, res.saved && res.saved.filename);
        }
        ok++;
      } catch (e) {
        toast(humanizeError(e, "upload"), { duration: 4500 });
      }
    }
    if (btnUp) btnUp.disabled = false;
    saveState();
    setModeUI();
    if (WB) { WB.renderUploads(); WB.renderBoardPicker(); }
    renderPlans();
    renderUploadLib();
    refreshStatusQuiet();
    if (st) {
      st.className = ok ? "voc-status ok" : "voc-status err";
      st.textContent = ok ? `✓ 已入库 ${ok} 张（2000×2000 PNG/JPG）→ ${displayProductFolder()}/过程图/` : "上传失败";
    }
    if (ok) {
      toast(switchedFromPrior ? `已上传 ${ok} 张（2000×2000）并选中（旧图仍保留在框内）` : `已上传 ${ok} 张自有图（2000×2000）至「过程图/」`, { duration: 4200 });
    }
  }

  function pickFilesForBox(boxId) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.multiple = true;
    input.onchange = () => uploadOwnFiles(input.files, inferKind(boxId), boxId);
    input.click();
  }

  function syncProductIdentityInputs() {
    const pni = document.getElementById("product-name-input");
    if (pni && document.activeElement !== pni) {
      pni.value = state.mode === "demo" ? "" : (state.productName || "");
    }
    const vq = document.getElementById("voc-query");
    if (vq && document.activeElement !== vq) {
      vq.value = state.mode === "demo" ? "" : (state.asin || "");
    }
  }

  function syncProductDataPanel() {
    const ta = document.getElementById("product-data-text");
    if (ta && document.activeElement !== ta) {
      ta.value = state.productSummary || "";
    }
  }

  function peekPastedIdentity(text) {
    const s = String(text || "");
    const mAsin = /\b(B0[A-Z0-9]{8})\b/i.exec(s);
    const asin = mAsin && !mAsin[1].toUpperCase().startsWith("B0DEMO") ? mAsin[1].toUpperCase() : "";
    let name = "";
    const mLbl = /^(?:产品名称|产品名|商品名称|品名|Product(?:\s*Name)?)\s*[:：]\s*(.+)$/im.exec(s.replace(/\*\*/g, ""));
    const mBold = /这款\s*\*\*([^*]{2,56})\*\*/.exec(s);
    if (mLbl) name = mLbl[1].trim();
    else if (mBold) name = mBold[1].trim();
    return { asin, name };
  }

  async function applyProductData(opts) {
    const silent = !!(opts && opts.silent);
    const ta = document.getElementById("product-data-text");
    const st = document.getElementById("product-data-status");
    const btn = document.getElementById("btn-product-data-apply");
    const pni = document.getElementById("product-name-input");
    const vq = document.getElementById("voc-query");
    const text = ((ta && ta.value) || state.productSummary || "").trim();
    if (!text) {
      if (st) { st.className = "voc-status err"; st.textContent = "请先粘贴产品总结"; }
      if (!silent) toast("请先粘贴产品总结", { duration: 2500 });
      return;
    }
    if (btn) btn.disabled = true;
    if (st) { st.className = "voc-status"; st.textContent = "正在解析当前产品资料并唤醒秋霜+安然…"; }

    try {
      const typedName = ((pni && pni.value) || "").trim();
      const typedAsin = ((vq && vq.value) || "").trim();
      const hinted = peekPastedIdentity(text);
      const wasDemo = state.mode === "demo";
      const wasBlank = isBlankNewProduct();

      const prevRealAsin = wasDemo ? "" : (state.asin || "").trim();
      const prevRealName = wasDemo ? "" : (state.productName || "").trim();

      // Only merge with existing VOC archive when it is genuinely the SAME real VOC task!
      const hasSameRealVoc =
        !wasDemo &&
        !!(state.archiveOverride && state.archiveOverride.source === "amazon-voc" && !state.archiveOverride.fromProductSummary) &&
        (!typedAsin || typedAsin.toUpperCase() === prevRealAsin.toUpperCase()) &&
        (!hinted.asin || !prevRealAsin || hinted.asin.toUpperCase() === prevRealAsin.toUpperCase()) &&
        (!typedName || !prevRealName || typedName === prevRealName) &&
        (!hinted.name || !prevRealName || hinted.name === prevRealName);

      if (!hasSameRealVoc) {
        const hadPriorProductWork = !wasDemo && !wasBlank && !!(state.archiveOverride || (state.sevenImagePlan && state.sevenImagePlan.length));
        const isSwitchingProduct =
          hadPriorProductWork &&
          ((hinted.name && prevRealName && hinted.name !== prevRealName) ||
            (typedName && prevRealName && typedName !== prevRealName) ||
            (hinted.asin && prevRealAsin && hinted.asin !== prevRealAsin));

        if (sevenCollabRuntime.controller) {
          try { sevenCollabRuntime.controller.abort("user"); } catch (_) {}
          sevenCollabRuntime.busy = false;
        }
        state.productSessionId = newSessionId();
        state.archiveOverride = null;
        state.sevenImagePlan = [];
        state.sevenPlanSource = "auto";
        state.sevenPlanAuthor = null;
        state.sevenPlanFile = null;
        state.sevenPlanStatus = "draft_pending";
        state.sevenPlanStatusLabel = "待秋霜+安然规划";
        state.sevenThemeChat = {};
        state.sevenThemeBusy = {};
        state.taskId = null;

        if (wasDemo || isSwitchingProduct) {
          state.boxes = {};
          state.preview = [null, null, null, null, null, null, null];
          state.whitebgSources = [];
          state.whitebgSelectedSourceIds = [];
          state.whitebgSelectedSourceId = null;
          state.whitebgResults = [];
          state.selectedWhitebgIds = [];
          state.activeWhitebgId = null;
          Object.keys(boxRuntime).forEach((k) => delete boxRuntime[k]);
          Object.keys(chatRuntime).forEach((k) => delete chatRuntime[k]);
        }
      }

      const candidateAsin = typedAsin || hinted.asin || (hasSameRealVoc ? prevRealAsin : "") || undefined;
      const candidateName = typedName || hinted.name || (hasSameRealVoc ? prevRealName : "") || undefined;

      const body = {
        text,
        asin: candidateAsin,
        productName: candidateName,
      };
      if (hasSameRealVoc && state.archiveOverride) {
        body.archive = state.archiveOverride;
      }

      const res = await API.post("/api/product-data/import", body, { timeoutMs: 30000 });
      state.productSummary = res.productSummary || text;
      state.mode = "real";
      state.source = "amazon";
      state.asin = res.asin || candidateAsin || "";
      state.productName = res.productName || candidateName || state.asin || "新产品";
      state.productDir = res.productDir || state.productName;
      state.archiveOverride = res.archive || null;
      state.sevenImagePlan = res.sevenImagePlan || [];
      state.sevenPlanSource = res.sevenPlanSource || "auto";
      state.sevenPlanAuthor = res.sevenPlanAuthor || null;
      state.sevenPlanFile = res.sevenPlanFile || null;
      state.sevenPlanStatus = res.sevenPlanStatus || "draft_pending";
      state.sevenPlanStatusLabel = res.sevenPlanStatusLabel || "待秋霜+安然规划";
      state.sevenPlanStatusHint = res.sevenPlanStatusHint || null;
      state.planOwnerSig = buildOwnerSig(state.asin, state.productName, state.productSummary);

      state.planBoxes = (res.planBoxes || []).map((b) =>
        sanitizeCachedMainPlanBox(
          {
            ...b,
            who: b.who || (["主图", "细节图", "尺寸图"].includes(b.badge) ? "秋霜" : "安然"),
          },
          state.asin,
          state.productName
        )
      );
      if (res.saved) state.lastSavePath = res.saved.category + "/" + res.saved.filename;
      Object.keys(state.boxes || {}).forEach((bid) => {
        const b = state.boxes[bid];
        if (!b) return;
        b.briefOverride = null;
        b.promptOverride = null;
      });
      saveState();
      syncProductIdentityInputs();
      setModeUI();
      renderArchive();
      renderPlans();
      renderPreview();
      if (WB) { WB.renderUploads(); WB.renderResults(); }

      const n = (state.planBoxes || []).length;
      const parsed = res.parsed || {};
      const itchN = (parsed.itch || []).length;
      const painN = (parsed.pain || []).length;
      if (st) {
        st.className = "voc-status ok";
        st.textContent = `✓ 已按「${state.productName}」生成 ${n} 框初稿（在意点 ${itchN} · 痛点 ${painN}）· 秋霜+安然正在协同精修七图主题…`;
      }
      if (!silent) {
        toast(`已载入「${state.productName}」产品数据 · 秋霜（图1–3）与安然（图4–7）开始协同规划七图`);
      }

      // Immediately dispatch 秋霜+安然 collaborative LLM pass for this new product!
      runCollaborativeSevenPlan({ auto: true });
    } catch (e) {
      const msg = humanizeError(e, "voc");
      if (st) { st.className = "voc-status err"; st.textContent = "失败：" + msg; }
      if (!silent) toast("导入产品数据失败：" + msg, { duration: 4500 });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function importVoc() {
    if (vocImporting) return;
    const inputEl = document.getElementById("voc-query");
    const btnEl = document.getElementById("btn-voc-import");
    const q = inputEl.value.trim();
    if (!q) { inputEl.focus(); return toast("请输入 ASIN（如 B0GVDS8X33）或 taskId"); }
    vocImporting = true;
    if (sevenCollabRuntime.controller) {
      try { sevenCollabRuntime.controller.abort("user"); } catch (_) {}
      sevenCollabRuntime.busy = false;
    }
    const st = document.getElementById("voc-import-status");
    const origBtnHtml = btnEl.innerHTML;
    btnEl.disabled = true;
    inputEl.disabled = true;
    btnEl.innerHTML = `<span class="spinner"></span> 导入中…`;
    const started = Date.now();
    st.className = "voc-status";
    st.innerHTML = `<span class="spinner"></span> 正在从 VOC 拉取档案与规划框（0s）…`;
    const tick = setInterval(() => {
      st.innerHTML = `<span class="spinner"></span> 正在从 VOC 拉取档案与规划框（${Math.floor((Date.now() - started) / 1000)}s）…`;
    }, 1000);

    try {
      const prevMode = state.mode;
      const prevAsin = prevMode === "demo" ? "" : (state.asin || "").trim();
      const res = await API.post("/api/voc/import", { asin: q }, { timeoutMs: 45000 });
      const nextAsin = res.asin || q;
      const isDifferentAsin = prevMode === "demo" || prevAsin.toUpperCase() !== String(nextAsin).toUpperCase();

      state.productSessionId = newSessionId();
      state.mode = "real";
      state.source = "amazon";
      state.asin = nextAsin;
      state.taskId = res.taskId;
      state.productName = res.productName || nextAsin;
      state.productDir = res.productDir || res.productName || nextAsin;
      state.archiveOverride = res.archive;
      state.sevenImagePlan = res.sevenImagePlan || (res.archive && res.archive.sevenImagePlan) || [];
      state.sevenPlanSource = res.sevenPlanSource || (res.archive && res.archive.sevenPlanSource) || "auto";
      state.sevenPlanAuthor = res.sevenPlanAuthor || (res.archive && res.archive.sevenPlanAuthor) || null;
      state.sevenPlanFile = res.sevenPlanFile || null;
      state.sevenPlanStatus = res.sevenPlanStatus || (res.archive && res.archive.sevenPlanStatus) || "draft_pending";
      state.sevenPlanStatusLabel = res.sevenPlanStatusLabel || (res.archive && res.archive.sevenPlanStatusLabel) || "待秋霜+安然规划";
      state.sevenPlanStatusHint = res.sevenPlanStatusHint || null;
      // Always reset per-card theme chat when importing VOC so prior product dialogue never leaks
      state.sevenThemeChat = {};
      state.sevenThemeBusy = {};

      // Never carry over a previous product's pasted summary into a different ASIN!
      if (isDifferentAsin) {
        state.productSummary = "";
        const taPd = document.getElementById("product-data-text");
        if (taPd) taPd.value = "";
        const stPd = document.getElementById("product-data-status");
        if (stPd) stPd.textContent = "";
      }

      state.planBoxes = (res.planBoxes || []).map((b) =>
        sanitizeCachedMainPlanBox(
          {
            ...b,
            who: b.who || (["主图", "细节图", "尺寸图"].includes(b.badge) ? "秋霜" : "安然"),
          },
          nextAsin,
          state.productName
        )
      );

      // Only merge same-ASIN productSummary when NOT an authored gold plan (never overwrite 定稿优先!)
      if (!isDifferentAsin && (state.productSummary || "").trim() && state.sevenPlanSource !== "authored") {
        try {
          const merged = await API.post(
            "/api/product-data/import",
            {
              text: state.productSummary,
              asin: nextAsin,
              productName: state.productName,
              archive: state.archiveOverride,
            },
            { timeoutMs: 30000 }
          );
          state.archiveOverride = merged.archive || state.archiveOverride;
          state.sevenImagePlan = merged.sevenImagePlan || state.sevenImagePlan;
          state.planBoxes = (merged.planBoxes || state.planBoxes).map((b) =>
            sanitizeCachedMainPlanBox(
              {
                ...b,
                who: b.who || (["主图", "细节图", "尺寸图"].includes(b.badge) ? "秋霜" : "安然"),
              },
              nextAsin,
              state.productName
            )
          );
        } catch (_) {}
      }

      state.planOwnerSig = buildOwnerSig(state.asin, state.productName, state.productSummary);
      state.boxes = {};
      state.preview = [null, null, null, null, null, null, null];
      if (isDifferentAsin) {
        state.whitebgSources = [];
        state.whitebgSelectedSourceIds = [];
        state.whitebgSelectedSourceId = null;
        state.whitebgResults = [];
        state.selectedWhitebgIds = [];
        state.activeWhitebgId = null;
      }
      if (WB && res.existingWhitebg && res.existingWhitebg.length) {
        WB.hydrateExisting(res.existingWhitebg);
      }
      Object.keys(boxRuntime).forEach((k) => delete boxRuntime[k]);
      Object.keys(chatRuntime).forEach((k) => delete chatRuntime[k]);
      if (res.saved) state.lastSavePath = res.saved.category + "/" + res.saved.filename;
      saveState();
      syncProductIdentityInputs();
      st.className = "voc-status ok";
      st.textContent = `✓ 已导入 ${nextAsin} → 目录「${state.productDir}」（${state.planBoxes.length} 个规划框 · ${state.sevenPlanStatusLabel || "已就绪"}）`;
      setModeUI();
      renderArchive();
      if (WB) { WB.renderUploads(); WB.syncModelLabels(); WB.renderResults(); }
      renderPlans();
      renderPreview();
      renderUploadLib();
      refreshStatusQuiet();
      toast(`已导入 ${nextAsin} 真实 VOC 档案 → 产品目录「${state.productDir}」`);

      // When no authored gold plan exists, automatically dispatch 秋霜+安然 collaborative planning!
      if (state.sevenPlanSource !== "authored") {
        runCollaborativeSevenPlan({ auto: true });
      }
    } catch (e) {
      st.className = "voc-status err";
      const errMsg = humanizeError(e, "voc");
      st.textContent = "导入失败：" + errMsg;
      toast("VOC 导入失败：" + errMsg, { duration: 5000 });
    } finally {
      clearInterval(tick);
      vocImporting = false;
      btnEl.disabled = false;
      inputEl.disabled = false;
      btnEl.innerHTML = origBtnHtml;
    }
  }

  function backToDemo() {
    abortAllInFlight();
    Object.keys(state).forEach((k) => delete state[k]);
    Object.assign(state, defaultState());
    saveState();
    syncProductIdentityInputs();
    syncProductDataPanel();
    setModeUI();
    renderArchive();
    if (WB) { WB.renderUploads(); WB.syncModelLabels(); WB.renderResults(); }
    renderPlans();
    renderPreview();
    renderUploadLib();
    toast("已切回演示档案模式");
  }

  const lb = {
    open: false,
    src: "",
    title: "",
    scale: 1,
    tx: 0,
    ty: 0,
    dragging: false,
    moved: false,
    sx: 0,
    sy: 0,
  };

  function applyLightboxTransform() {
    const imgEl = document.getElementById("lightbox-img");
    const valEl = document.getElementById("lb-zoom-val");
    if (imgEl) {
      imgEl.style.transform = `translate(${lb.tx}px, ${lb.ty}px) scale(${lb.scale})`;
      imgEl.style.cursor = lb.scale > 1.02 ? (lb.dragging ? "grabbing" : "grab") : "zoom-in";
    }
    if (valEl) valEl.textContent = `${Math.round(lb.scale * 100)}%`;
  }

  function openLightbox(src, title) {
    if (!src) return;
    const root = document.getElementById("img-lightbox");
    const imgEl = document.getElementById("lightbox-img");
    const capEl = document.getElementById("lightbox-caption");
    if (!root || !imgEl) return;
    lb.open = true;
    lb.src = src;
    lb.title = title || "查看原图（2000×2000）";
    lb.scale = 1;
    lb.tx = 0;
    lb.ty = 0;
    lb.dragging = false;
    lb.moved = false;
    imgEl.src = src;
    imgEl.alt = lb.title;
    if (capEl) capEl.textContent = lb.title;
    applyLightboxTransform();
    root.classList.add("open");
    root.setAttribute("aria-hidden", "false");
  }

  function closeLightbox() {
    const root = document.getElementById("img-lightbox");
    if (!root || !lb.open) return;
    lb.open = false;
    lb.dragging = false;
    root.classList.remove("open");
    root.setAttribute("aria-hidden", "true");
  }

  function stepLightboxZoom(delta) {
    const next = Math.min(4, Math.max(0.5, Number((lb.scale + delta).toFixed(2))));
    lb.scale = next;
    if (next <= 1) { lb.tx = 0; lb.ty = 0; }
    applyLightboxTransform();
  }

  function bindLightbox() {
    const root = document.getElementById("img-lightbox");
    const stage = document.getElementById("lightbox-stage");
    const imgEl = document.getElementById("lightbox-img");
    if (!root || !stage || !imgEl) return;

    document.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-lightbox-src]");
      if (!trigger) return;
      if (Date.now() - lastDragEndAt < 180) return;
      const src = trigger.dataset.lightboxSrc;
      if (!src) return;
      e.preventDefault();
      e.stopPropagation();
      openLightbox(src, trigger.dataset.lightboxTitle || trigger.getAttribute("alt") || "查看原图");
    });

    document.getElementById("lb-close").addEventListener("click", closeLightbox);
    document.getElementById("lb-zoom-in").addEventListener("click", () => stepLightboxZoom(0.25));
    document.getElementById("lb-zoom-out").addEventListener("click", () => stepLightboxZoom(-0.25));
    document.getElementById("lb-zoom-reset").addEventListener("click", () => {
      lb.scale = 1; lb.tx = 0; lb.ty = 0; applyLightboxTransform();
    });
    document.getElementById("lb-download").addEventListener("click", () => {
      if (!lb.src) return;
      const cleanName = String(lb.title || "product-image")
        .replace(/[/\\:*?"<>|#%\s]+/g, "_")
        .slice(0, 48) + ".png";
      API.triggerDownload(lb.src, cleanName);
    });

    stage.addEventListener("wheel", (e) => {
      if (!lb.open) return;
      e.preventDefault();
      stepLightboxZoom(e.deltaY < 0 ? 0.2 : -0.2);
    }, { passive: false });

    imgEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (lb.scale > 1.05) { lb.scale = 1; lb.tx = 0; lb.ty = 0; }
      else { lb.scale = 2; }
      applyLightboxTransform();
    });

    imgEl.addEventListener("pointerdown", (e) => {
      if (lb.scale <= 1.02) return;
      lb.dragging = true;
      lb.moved = false;
      lb.sx = e.clientX - lb.tx;
      lb.sy = e.clientY - lb.ty;
      imgEl.setPointerCapture(e.pointerId);
      applyLightboxTransform();
    });
    imgEl.addEventListener("pointermove", (e) => {
      if (!lb.dragging) return;
      const nx = e.clientX - lb.sx;
      const ny = e.clientY - lb.sy;
      if (Math.abs(nx - lb.tx) > 3 || Math.abs(ny - lb.ty) > 3) lb.moved = true;
      lb.tx = nx;
      lb.ty = ny;
      applyLightboxTransform();
    });
    imgEl.addEventListener("pointerup", () => {
      lb.dragging = false;
      applyLightboxTransform();
    });
    imgEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!lb.moved && lb.scale <= 1.02) {
        lb.scale = 1.8;
        applyLightboxTransform();
      }
      lb.moved = false;
    });

    stage.addEventListener("click", (e) => {
      if (e.target === stage) closeLightbox();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (lb.open) {
          e.preventDefault();
          closeLightbox();
          return;
        }
        const gm = document.getElementById("gen-modal");
        if (gm && gm.classList.contains("open")) {
          closeGenModal();
        }
      } else if (lb.open && (e.key === "+" || e.key === "=")) {
        stepLightboxZoom(0.25);
      } else if (lb.open && e.key === "-") {
        stepLightboxZoom(-0.25);
      } else if (lb.open && e.key === "0") {
        lb.scale = 1; lb.tx = 0; lb.ty = 0; applyLightboxTransform();
      }
    });
  }

  let dragFrom = null;
  function bindPreviewDnD() {
    const root = document.getElementById("preview-slots");
    root.addEventListener("dragstart", (e) => {
      const body = e.target.closest("[data-slot-body]");
      if (!body) return;
      dragFrom = Number(body.dataset.slotBody);
      e.dataTransfer.effectAllowed = "move";
    });
    root.addEventListener("dragend", () => {
      lastDragEndAt = Date.now();
    });
    root.addEventListener("dragover", (e) => {
      const slot = e.target.closest(".preview-slot");
      if (!slot) return;
      e.preventDefault();
      slot.classList.add("drag-over");
    });
    root.addEventListener("dragleave", (e) => {
      const slot = e.target.closest(".preview-slot");
      if (slot) slot.classList.remove("drag-over");
    });
    root.addEventListener("drop", (e) => {
      lastDragEndAt = Date.now();
      const slot = e.target.closest(".preview-slot");
      if (!slot) return;
      e.preventDefault();
      slot.classList.remove("drag-over");
      const to = Number(slot.dataset.slot);
      const from = dragFrom;
      if (from == null || from === to) return;
      const t = state.preview[from];
      state.preview[from] = state.preview[to];
      state.preview[to] = t;
      saveState();
      renderPreview();
      if (WB) WB.syncPreviewToFinal({ silent: true });
    });
  }

  function bindGlobal() {
    bindLightbox();

    document.getElementById("source-toggle").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-source]");
      if (!btn) return;
      // Only 亚马逊 VOC remains in the archive-source tabs
      state.source = "amazon";
      state.mode = state.archiveOverride ? "real" : "demo";
      saveState();
      setModeUI();
      renderArchive();
      if (WB) { WB.renderUploads(); WB.renderResults(); }
      renderPlans();
      renderPreview();
    });

    document.getElementById("btn-voc-import").addEventListener("click", importVoc);
    document.getElementById("voc-query").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); importVoc(); }
    });
    const pniEl = document.getElementById("product-name-input");
    if (pniEl) {
      pniEl.addEventListener("input", () => {
        const val = pniEl.value.trim();
        if (state.mode === "demo" && val) {
          state.mode = "real";
          state.asin = "";
          state.archiveOverride = null;
          state.sevenImagePlan = [];
          state.planBoxes = [];
          state.sevenThemeChat = {};
        }
        state.productName = val;
        state.productDir = val;
        setModeUI();
        saveStateDebounced();
      });
    }
    syncProductIdentityInputs();

    const btnPd = document.getElementById("btn-product-data");
    const panelPd = document.getElementById("product-data-panel");
    const taPd = document.getElementById("product-data-text");
    if (btnPd && panelPd) {
      btnPd.addEventListener("click", () => {
        const open = !panelPd.hasAttribute("hidden");
        if (open) panelPd.setAttribute("hidden", "");
        else {
          panelPd.removeAttribute("hidden");
          syncProductDataPanel();
          if (taPd) taPd.focus();
        }
      });
    }
    const btnApply = document.getElementById("btn-product-data-apply");
    if (btnApply) btnApply.addEventListener("click", () => applyProductData());
    const btnClear = document.getElementById("btn-product-data-clear");
    if (btnClear) {
      btnClear.addEventListener("click", () => {
        state.productSummary = "";
        if (taPd) taPd.value = "";
        const st = document.getElementById("product-data-status");
        if (st) { st.className = "voc-status"; st.textContent = "已清空粘贴内容（规划框需重新点「应用到规划框」才会改）"; }
        saveState();
      });
    }
    const btnClose = document.getElementById("btn-product-data-close");
    if (btnClose && panelPd) {
      btnClose.addEventListener("click", () => panelPd.setAttribute("hidden", ""));
    }
    if (taPd) {
      taPd.addEventListener("change", () => {
        state.productSummary = taPd.value;
        saveStateDebounced();
      });
    }
    syncProductDataPanel();
    if (state.productSummary && panelPd) {
      panelPd.removeAttribute("hidden");
    }

    const btnUpload = document.getElementById("btn-upload-own");
    const fileUpload = document.getElementById("upload-files");
    if (btnUpload && fileUpload) {
      btnUpload.addEventListener("click", () => fileUpload.click());
      fileUpload.addEventListener("change", () => {
        const kind = document.getElementById("upload-kind").value;
        uploadOwnFiles(fileUpload.files, kind, KIND_TO_BOX[kind]);
        fileUpload.value = "";
      });
    }
    document.getElementById("upload-lib-thumbs").addEventListener("click", (e) => {
      if (e.target.closest("[data-lightbox-src]")) return;
      const btn = e.target.closest("[data-use-as-wbsrc]");
      if (!btn || !WB) return;
      const uploads = [];
      Object.values(state.boxes || {}).forEach((b) => {
        (b.results || []).forEach((r) => {
          if ((r.model === "upload" || r.uploaded) && r.imageUrl) uploads.push(r);
        });
      });
      const picked = uploads.slice(-12).reverse()[Number(btn.dataset.useAsWbsrc)];
      if (!picked) return;
      WB.addSourceItem(picked.label || "自有上传图", picked.imageUrl);
      saveState();
      WB.renderUploads();
      WB.focusSection("已选为白底待修原图（默认勾选），点「开始白底真修」即可");
    });

    document.getElementById("btn-demo-mode").addEventListener("click", backToDemo);
    if (WB) WB.bindEvents();

    document.getElementById("layer-plan").addEventListener("click", (e) => {
      if (e.target.closest("[data-lightbox-src]")) return;

      const btn = e.target.closest("[data-action]");
      if (btn) {
        const action = btn.dataset.action;
        const boxId = btn.dataset.box;
        if (action === "delete-gen-result") {
          e.stopPropagation();
          deleteBoxResult(boxId, btn.dataset.rid);
          return;
        }
        if (action === "send-seven-theme-chat") {
          const idx = btn.getAttribute("data-seven-idx");
          sendSevenThemeChat(idx);
          return;
        }
        if (action === "send-prompt-chat") {
          sendPromptChat(boxId);
          return;
        }
        if (action === "cancel-prompt-chat") {
          const crt = chatRuntime[boxId];
          if (crt && crt.controller) crt.controller.abort("user");
          return;
        }
        if (action === "clear-prompt-chat") {
          const box = ensureBox(boxId);
          box.promptChat = [];
          saveState();
          renderPlans();
          return;
        }
        if (action === "generate") openGenModal(boxId);
        if (action === "upload-box") pickFilesForBox(boxId);
        if (action === "cancel-box" && boxRuntime[boxId] && boxRuntime[boxId].controller) boxRuntime[boxId].controller.abort("user");
        if (action === "dismiss-error") { getRuntime(boxId).lastError = null; renderPlans(); }
        if (action === "toggle-refine") { ensureBox(boxId).refineOpen = !ensureBox(boxId).refineOpen; saveState(); renderPlans(); }
        if (action === "optimize") optimizeBox(boxId);
        if (action === "rewrite-prompt") {
          const box = ensureBox(boxId);
          const ta = document.querySelector(`textarea[data-refine-input="${boxId}"]`);
          if (ta) box.refineDraft = ta.value;
          toast(box.refineDraft.trim() ? "已暂存修改意见，点右侧「优化 → 生成新版」即可生图" : "请先填写修改说明");
          saveState();
        }
        if (action === "add-preview") addToPreview(boxId);
        return;
      }

      const selGen = e.target.closest("[data-select-gen]") || e.target.closest(".gen-card");
      if (selGen) {
        const boxId = selGen.dataset.box || (selGen.closest(".gen-card") && selGen.closest(".gen-card").dataset.box);
        const rid = selGen.dataset.selectGen || selGen.dataset.rid || (selGen.closest(".gen-card") && selGen.closest(".gen-card").dataset.rid);
        if (!boxId || !rid) return;
        const box = ensureBox(boxId);
        box.selectedResultId = rid;
        const picked = box.results.find((r) => r.id === rid);
        box.refineProvider = picked && GEN_PROVIDERS.includes(picked.model) && isProviderConfigured(picked.model) ? picked.model : "doubao";
        saveState();
        renderPlans();
      }
    });

    document.getElementById("layer-plan").addEventListener("keydown", (e) => {
      const chatInput = e.target.closest("input[data-chat-input]");
      if (chatInput && e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        sendPromptChat(chatInput.dataset.chatInput);
      }
    });

    document.getElementById("layer-plan").addEventListener("change", (e) => {
      const sel = e.target.closest("select[data-refine-provider]");
      if (sel) { ensureBox(sel.dataset.refineProvider).refineProvider = sel.value; saveState(); renderPlans(); }
    });

    document.getElementById("layer-plan").addEventListener("input", (e) => {
      const chatIn = e.target.closest("input[data-chat-input]");
      if (chatIn) { getChatRuntime(chatIn.dataset.chatInput).draft = chatIn.value; }
      const ta = e.target.closest("textarea[data-refine-input]");
      if (ta) { ensureBox(ta.dataset.refineInput).refineDraft = ta.value; saveStateDebounced(); }
      const brief = e.target.closest("[data-brief]");
      if (brief) { setPlanBrief(brief.dataset.brief, brief.innerText); saveStateDebounced(); }
      const prompt = e.target.closest("[data-prompt]");
      if (prompt) { setPlanPrompt(prompt.dataset.prompt, prompt.innerText); saveStateDebounced(); }
    });

    document.getElementById("gen-modal-cancel").addEventListener("click", closeGenModal);
    document.getElementById("gen-modal-ok").addEventListener("click", runGenerate);
    document.getElementById("gen-modal").addEventListener("click", (e) => { if (e.target.id === "gen-modal") closeGenModal(); });
    document.getElementById("gen-modal-models").addEventListener("change", () => {
      document.querySelectorAll("#gen-modal-models label").forEach((lab) => {
        const inp = lab.querySelector("input");
        lab.classList.toggle("checked", inp.checked && !inp.disabled);
      });
    });

    document.getElementById("btn-auto-fill").addEventListener("click", autoFillPreview);
    document.getElementById("btn-sync-final").addEventListener("click", () => WB && WB.syncPreviewToFinal({ silent: false }));
    const dlAllBtn = document.getElementById("btn-download-all-preview");
    if (dlAllBtn) dlAllBtn.addEventListener("click", downloadAllPreview);

    document.getElementById("btn-clear-preview").addEventListener("click", () => {
      state.preview = [null, null, null, null, null, null, null];
      Object.values(state.boxes).forEach((b) => (b.inPreview = false));
      const stEl = document.getElementById("preview-sync-status");
      if (stEl) stEl.textContent = "";
      saveState();
      renderPlans();
      renderPreview();
      toast("已清空预览框");
    });
    document.getElementById("preview-slots").addEventListener("click", (e) => {
      if (e.target.closest("[data-lightbox-src]")) return;
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const idx = Number(btn.dataset.slot);
      const action = btn.dataset.action;
      if (action === "preview-download") {
        downloadPreviewSlot(idx);
        return;
      }
      if (action === "preview-remove") {
        const item = state.preview[idx];
        state.preview[idx] = null;
        if (item && state.boxes[item.boxId]) state.boxes[item.boxId].inPreview = state.preview.some((p) => p && p.boxId === item.boxId);
        saveState();
        renderPlans();
        renderPreview();
      }
      if (action === "preview-up" && idx > 0) {
        const t = state.preview[idx - 1]; state.preview[idx - 1] = state.preview[idx]; state.preview[idx] = t;
        saveState(); renderPreview(); if (WB) WB.syncPreviewToFinal({ silent: true });
      }
      if (action === "preview-down" && idx < 6) {
        const t = state.preview[idx + 1]; state.preview[idx + 1] = state.preview[idx]; state.preview[idx] = t;
        saveState(); renderPreview(); if (WB) WB.syncPreviewToFinal({ silent: true });
      }
    });
    document.getElementById("btn-reset").addEventListener("click", () => {
      if (!window.confirm("清空当前工作台本机状态？已留稿文件不会删除。")) return;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
      // keep HISTORY_KEY
      location.reload();
    });
    document.getElementById("btn-jump-preview").addEventListener("click", () => {
      document.getElementById("layer-preview").scrollIntoView({ behavior: "smooth" });
    });
    bindPreviewDnD();

    setInterval(() => {
      document.querySelectorAll("[data-elapsed-box]").forEach((el) => {
        const rt = boxRuntime[el.dataset.elapsedBox];
        if (rt && rt.busy) el.textContent = `已等待 ${Math.max(0, Math.floor((Date.now() - rt.startedAt) / 1000))}s`;
      });
      const cEl = document.querySelector("[data-collab-elapsed]");
      if (cEl && sevenCollabRuntime.busy) {
        cEl.textContent = `已用 ${Math.max(0, Math.floor((Date.now() - sevenCollabRuntime.startedAt) / 1000))}s`;
      }
      if (WB) WB.tickElapsed();
    }, 1000);
  }

  function renderProviderStatus() {
    const ps = document.getElementById("provider-status");
    if (!ps || !serverStatus) return;
    const sq = serverStatus.syncQueue;
    const syncText = sq ? (sq.pending > 0 ? `待同步 ${sq.pending}` : sq.syncedCount > 0 ? `已同步 ${sq.syncedCount}` : "就绪") : "就绪";
    ps.innerHTML =
      (serverStatus.providers || [])
        .map((p) => {
          let cls = p.configured ? "live" : "unconfigured";
          let label = p.configured ? "已配置" : `未配置（缺 ${p.missingKey}）`;
          if (p.id === "chatgpt" && p.configured) { cls = "warn"; label = "已配置 · 额度可能不足"; }
          const tip = p.note ? ` title="${escapeHtml(p.note)}"` : "";
          return `<span class="provider-pill ${cls}"${tip}>${escapeHtml(p.name)}：${escapeHtml(label)}</span>`;
        })
        .join("") +
      `<span class="provider-pill live">白底真修：豆包专用</span>` +
      `<span class="provider-pill live">规格：2000×2000 PNG/JPG</span>` +
      `<span class="provider-pill">目录 → ~/Desktop/亚马逊产品图片/{产品名}/{过程图|白底图|最终版本|报告}（${escapeHtml(syncText)}）</span>`;
  }

  async function bootServer() {
    try {
      const [status, list] = await Promise.all([API.get("/api/status"), API.get("/api/voc/list")]);
      serverStatus = status;
      const dl = document.getElementById("voc-fixtures");
      dl.innerHTML = "";
      (list.fixtures || []).forEach((t) => {
        const o = document.createElement("option");
        o.value = t.asin || t.taskId;
        o.label = `${t.asin || ""} ${t.product || t.taskId || ""}`;
        dl.appendChild(o);
      });
      if (isRealMode() && state.asin && !state.whitebgResults.length && WB) {
        try {
          const requested = {
            session: state.productSessionId, asin: state.asin, name: state.productName,
          };
          const wb = await API.get(
            `/api/whitebg/list?asin=${encodeURIComponent(requested.asin)}&productName=${encodeURIComponent(requested.name || "")}`,
            { timeoutMs: 10000 }
          );
          const stillCurrent = isRealMode() && state.productSessionId === requested.session &&
            state.asin === requested.asin && state.productName === requested.name && !state.whitebgResults.length;
          if (stillCurrent) {
            if (wb && wb.productDir) state.productDir = wb.productDir;
            if (wb && wb.items && wb.items.length) {
              WB.hydrateExisting(wb.items);
              WB.renderResults();
              WB.renderBoardPicker();
              saveState();
            }
          }
        } catch (_) {}
      }
      renderProviderStatus();
    } catch (_) {
      document.getElementById("provider-status").innerHTML =
        `<span class="provider-pill missing">后端未连接 · 本机请跑 python3 server/app.py；线上走 /image-board-api</span>`;
    }
  }

  async function init() {
    const needsSummaryRefresh = !!state._needsRefreshFromSummary;
    delete state._needsRefreshFromSummary;

    WB = window.BoardWhitebg.create({
      state, API, DEMO, GEN_PROVIDERS, MODEL_MAP,
      toast, humanizeError, escapeHtml, modelDisplayName,
      saveState, saveStateDebounced, setModeUI, renderPlans, renderPreview,
      ensureBox, currentPlans, findPlan, reconcilePreviewFlags, refreshStatusQuiet,
      displayProductFolder, readFileAsDataURL, effectiveAsin,
      onFinalArchived: async (meta) => {
        if (!WorkspaceArchive) return;
        try {
          await WorkspaceArchive.saveCurrent({
            status: "final-synced",
            note: (meta && meta.note) || "定稿同步后自动留存分析报告",
            silent: !!(meta && meta.silent),
          });
        } catch (error) {
          toast(error.message || "分析报告留稿失败，当前工作台仍保留。", { duration: 6500 });
        }
      },
    });
    WorkspaceArchive = window.BoardWorkspace.create({
      state, API, DEMO, toast, saveState, setModeUI,
      renderArchive, renderPlans, renderPreview, renderUploadLib, WB,
      abortAllInFlight,
    });
    reconcilePreviewFlags();
    // Cached workspace images must render before any metadata round-trip.
    setModeUI();
    renderArchive();
    WB.renderUploads();
    WB.syncModelLabels();
    WB.renderResults();
    renderPlans();
    renderPreview();
    renderUploadLib();
    bindGlobal();
    bootServer().then(() => { renderPlans(); });

    if (needsSummaryRefresh && (state.productSummary || "").trim()) {
      applyProductData({ silent: true });
    }
  }

  init();
})();
