/* AI 做图看板 v4 — 真实 VOC + 白底真修锁定本体 + 2000x2000 PNG/JPG + 产品三级目录 */
(function () {
  const STORAGE_KEY = "ai-image-board-v3";
  const LEGACY_KEY = "ai-image-board-v2";
  const GEN_PROVIDERS = ["doubao", "banana", "chatgpt"];
  const MODEL_MAP = Object.fromEntries(DEMO.models.map((m) => [m.id, m]));
  const API = window.BoardAPI;

  const state = normalizeState(loadState() || defaultState());
  let serverStatus = null;
  let vocImporting = false;
  const boxRuntime = {};
  let WB = null;

  function defaultState() {
    return {
      mode: "demo",
      source: "demo",
      asin: DEMO.product.asin,
      productName: DEMO.product.name,
      productDir: DEMO.product.name,
      taskId: null,
      archiveOverride: null,
      whitebgSources: [],
      whitebgSelectedSourceId: null,
      whitebgInstruction: "",
      whitebgSelectedModels: ["doubao"],
      whitebgResults: [],
      activeWhitebgId: null,
      boxes: {},
      preview: [null, null, null, null, null, null, null],
      genTargetBoxId: null,
      lastSavePath: null,
      planBoxes: null,
    };
  }

  function normalizeState(raw) {
    const s = Object.assign(defaultState(), raw || {});
    if (!Array.isArray(s.whitebgSources)) s.whitebgSources = [];
    if (!Array.isArray(s.whitebgResults)) s.whitebgResults = [];
    s.whitebgResults = s.whitebgResults.filter((r) => r && r.imageUrl && !r.mock);
    if (!Array.isArray(s.whitebgSelectedModels) || !s.whitebgSelectedModels.length) {
      s.whitebgSelectedModels = ["doubao"];
    } else {
      s.whitebgSelectedModels = s.whitebgSelectedModels.filter((m) => GEN_PROVIDERS.includes(m));
      if (!s.whitebgSelectedModels.length) s.whitebgSelectedModels = ["doubao"];
    }
    if (s.whitebgSources.length && !s.whitebgSources.some((u) => u.id === s.whitebgSelectedSourceId)) {
      s.whitebgSelectedSourceId = s.whitebgSources[s.whitebgSources.length - 1].id;
    }
    if (s.whitebgResults.length && !s.whitebgResults.some((r) => r.id === s.activeWhitebgId)) {
      s.activeWhitebgId = s.whitebgResults[s.whitebgResults.length - 1].id;
    }
    if (!s.whitebgResults.length) s.activeWhitebgId = null;
    if (!Array.isArray(s.preview) || s.preview.length !== 7) {
      s.preview = [null, null, null, null, null, null, null];
    }
    if (!s.boxes || typeof s.boxes !== "object") s.boxes = {};
    delete s.whitebgGenerated;
    delete s.whitebgPicks;
    delete s.whitebgSaved;
    return s;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  let _saveDebounce = null;
  function saveState() {
    const toSave = { ...state };
    delete toSave.genTargetBoxId;
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

  function displayProductFolder() {
    if (state.productDir) return state.productDir;
    const raw = (state.productName || state.asin || DEMO.product.name || "未命名产品").trim();
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
      };
    }
    return state.boxes[boxId];
  }

  function getRuntime(boxId) {
    if (!boxRuntime[boxId]) {
      boxRuntime[boxId] = { busy: false, text: "", startedAt: 0, controller: null, lastError: null };
    }
    return boxRuntime[boxId];
  }

  function currentPlans() {
    if (isRealMode() && state.planBoxes && state.planBoxes.length) return state.planBoxes;
    if (state.planBoxes && state.planBoxes.length && state.mode === "real") return state.planBoxes;
    return [...DEMO.qiushuang, ...DEMO.anran];
  }

  function findPlan(boxId) {
    return currentPlans().find((b) => b.id === boxId);
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
      "· 目录：亚马逊产品图片/" + displayProductFolder() + "/{过程图|白底图|最终版本} · 全量 2000×2000 PNG/JPG · 强制锁定白底本体";

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
      whitebgTag.textContent = hasRealWb ? "真实 · 已锁定" : "真实真修";
      whitebgTag.className = "tag tag-real";
    }

    const mac = (serverStatus && serverStatus.macImageRoot) || "/Users/lhy/Desktop/亚马逊产品图片";
    const sq = serverStatus && serverStatus.syncQueue;
    let syncSummary = "";
    if (sq) {
      syncSummary = sq.pending > 0 ? ` · 待同步 Mac ${sq.pending} 项` : sq.syncedCount > 0 ? ` · 已同步 Mac ${sq.syncedCount} 项` : "";
    }
    document.getElementById("save-path").textContent =
      `落盘：${mac}/${displayProductFolder()}/{过程图 | 白底图 | 最终版本}（2000×2000 .png/.jpg）` +
      (state.lastSavePath ? ` · 最近：${state.lastSavePath}` : "") +
      syncSummary;

    document.getElementById("product-sub").textContent = real
      ? `亚马逊 7 图 · ASIN ${state.asin || "—"} · 产品目录「${displayProductFolder()}」`
      : `亚马逊 7 图 Listing · 当前演示档案：${DEMO.product.name}（可导入真实 ASIN 如 B0GVDS8X33）`;
  }

  function activeArchive() {
    if (state.source === "etsy") return DEMO.archives.etsy;
    if (state.source === "demo") return DEMO.archives.amazon;
    if (state.archiveOverride) return state.archiveOverride;
    return DEMO.archives.amazon;
  }

  function renderArchive() {
    const data = activeArchive();
    const isRealCard = isRealMode() && state.source === "amazon" && !!state.archiveOverride;
    document.getElementById("source-label").textContent = (data.label || "") + (isRealCard ? " · 真实导入" : " · 演示数据");
    document.querySelectorAll("#source-toggle button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.source === state.source);
    });
    const cards = [
      { key: "pain", title: "痛点", cls: "pain", items: data.pain || [] },
      { key: "itch", title: "痒点", cls: "itch", items: data.itch || [] },
      { key: "delight", title: "惊喜点", cls: "delight", items: data.delight || [] },
      { key: "reason", title: "选择理由", cls: "reason", items: data.reason || [] },
    ];
    document.getElementById("archive-grid").innerHTML =
      cards
        .map(
          (c) => `
      <article class="archive-card ${c.cls}">
        <h3><span class="dot"></span>${c.title} <span class="tag ${isRealCard ? "tag-real" : "tag-demo"}">${isRealCard ? "真实" : "演示"}</span></h3>
        <ul>${c.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
      </article>`
        )
        .join("") +
      `<div class="archive-map" style="grid-column:1/-1">字段映射：${escapeHtml(data.note || "")}</div>`;
  }

  function plansByWho() {
    const all = currentPlans();
    const qs = all.filter((b) => b.who === "秋霜" || (b.id || "").startsWith("qs-") || ["主图", "细节图", "尺寸图"].includes(b.badge));
    const qsIds = new Set(qs.map((b) => b.id));
    const ar = all.filter((b) => !qsIds.has(b.id));
    if (!qs.length && !ar.length) return { qs: DEMO.qiushuang, ar: DEMO.anran };
    return { qs, ar };
  }

  function resolveRefineProvider(box, selected) {
    if (box.refineProvider && GEN_PROVIDERS.includes(box.refineProvider)) return box.refineProvider;
    if (selected && GEN_PROVIDERS.includes(selected.model)) return selected.model;
    return "doubao";
  }

  function renderPlanBox(plan) {
    const box = ensureBox(plan.id);
    const rt = getRuntime(plan.id);
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
        ? (rt.busy ? "" : `<div style="font-size:11px;color:var(--muted);margin-top:8px;">尚未生成 · 需先完成上方白底真修再点「生成图片」</div>`)
        : `<div class="gen-results">${box.results
            .map((r) => {
              const m = MODEL_MAP[r.model] || { name: r.model, cls: "model-generic" };
              const sel = r.id === box.selectedResultId;
              const img = r.imageUrl
                ? `<img src="${escapeHtml(API.fileUrl(r.imageUrl))}" alt="${escapeHtml(m.name)}" />`
                : `<div class="ph-img ${m.cls}">${escapeHtml(m.name)}<br/>v${r.version}</div>`;
              return `<div class="gen-card ${sel ? "selected" : ""}" data-box="${escapeHtml(plan.id)}" data-rid="${escapeHtml(r.id)}">
                ${img}
                <div class="meta">${escapeHtml(r.label || "")}${r.macPath ? "<br/>2000×2000" : ""}</div>
                <span class="pick-mark">✓</span>
              </div>`;
            })
            .join("")}</div>`;

    const refineTitle = isNonGenSelected
      ? `精改支线 · 基于锁定白底图用 ${modelDisplayName(refineProv)} 生成新版`
      : `精改支线 · ${selected ? modelDisplayName(selected.model) : "所选模型"}（严格保持白底基准产品一致）`;

    const refineModelOptions = [
      { id: "doubao", label: "豆包（推荐 · 2K图生图快且稳）" },
      { id: "banana", label: "Banana（Gemini 图生图）" },
      { id: "chatgpt", label: "ChatGPT" },
    ]
      .map((opt) => `<option value="${opt.id}" ${refineProv === opt.id ? "selected" : ""}>${opt.label}</option>`)
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
        <div class="brief-text" contenteditable="true" data-brief="${escapeHtml(plan.id)}">${escapeHtml(plan.brief)}</div>
        <div class="label-sm">生图提示词（服务端自动注入白底本体防魔改锁）</div>
        <div class="prompt-text" contenteditable="true" id="prompt-${escapeHtml(plan.id)}" data-prompt="${escapeHtml(plan.id)}">${escapeHtml(plan.prompt)}</div>
        <div class="box-actions">
          <button type="button" class="btn btn-primary btn-sm" data-action="generate" data-box="${escapeHtml(plan.id)}" ${rt.busy ? "disabled" : ""}>
            ${rt.busy ? '<span class="spinner"></span> 生成中…' : "生成图片"}
          </button>
          <button type="button" class="btn btn-sm" data-action="upload-box" data-box="${escapeHtml(plan.id)}" ${rt.busy ? "disabled" : ""}>上传图片</button>
          <button type="button" class="btn btn-sm" data-action="toggle-refine" data-box="${escapeHtml(plan.id)}" ${box.results.length ? "" : "disabled"}>精改支线</button>
          <button type="button" class="btn btn-success btn-sm" data-action="add-preview" data-box="${escapeHtml(plan.id)}" ${selected ? "" : "disabled"}>
            ${box.inPreview ? "已在预览（更新）" : "加入预览"}
          </button>
          ${selected ? `<span style="font-size:11px;color:var(--green);">已选：${escapeHtml(modelDisplayName(selected.model))} v${selected.version}</span>` : `<span style="font-size:11px;color:var(--muted);">请勾选一张</span>`}
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
    document.getElementById("boxes-qiushuang").innerHTML = qs.map(renderPlanBox).join("") || "<div class='empty-msg'>暂无秋霜框</div>";
    document.getElementById("boxes-anran").innerHTML = ar.map(renderPlanBox).join("") || "<div class='empty-msg'>暂无安然框</div>";
    updateGenSummary();
  }

  function updateGenSummary() {
    const chips = currentPlans().map((p) => {
      const b = state.boxes[p.id];
      const rt = boxRuntime[p.id];
      let cls = "";
      let text = (p.title || p.id).slice(0, 18);
      if (rt && rt.busy) text += " · 生成中…";
      else if (!b || !b.results.length) text += " · 未生成";
      else if (!b.selectedResultId) text += " · 待勾选";
      else if (b.inPreview) { text += " · 已入预览"; cls = "ok"; }
      else { text += " · 已选图"; cls = "ok"; }
      return `<span class="status-chip ${cls}">${escapeHtml(text)}</span>`;
    });
    document.getElementById("gen-summary").innerHTML = `<div class="status-chips">${chips.join("")}</div>`;
  }

  function renderPreview() {
    const root = document.getElementById("preview-slots");
    root.innerHTML = state.preview
      .map((item, idx) => {
        if (!item) {
          return `<div class="preview-slot" data-slot="${idx}"><span class="slot-num">#${idx + 1}</span>
            <div class="slot-body" data-slot-body="${idx}"><div class="empty-hint">空槽 · 从上层「加入预览」或一键填入</div></div></div>`;
        }
        const m = MODEL_MAP[item.model] || { name: item.model, cls: "model-generic" };
        const ph = item.imageUrl
          ? `<img class="slot-ph" style="object-fit:cover" src="${escapeHtml(API.fileUrl(item.imageUrl))}" alt="" />`
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
      rt.lastError = "已阻断生图：请先在第 1 层完成「白底真修」并锁定白底产品图（永久规则：禁止无白底参考图纯文生空想产品）";
      renderPlans();
      if (WB) WB.focusSection("请先完成第 1 层「白底真修」锁定产品本体后再生成图片");
      return;
    }
    state.genTargetBoxId = boxId;
    const plan = findPlan(boxId);
    document.getElementById("gen-modal-desc").textContent =
      `为「${plan ? plan.title : boxId}」勾选图生图模型（输出 2000×2000 存入「过程图/」）。`;
    const refCard = document.getElementById("gen-modal-ref");
    if (refCard) {
      refCard.innerHTML = `<img src="${escapeHtml(API.fileUrl(wbRef.imageUrl))}" alt="" />
        <div>
          <div><strong>🔒 强制绑定产品本体：${escapeHtml(wbRef.label)}</strong></div>
          <div style="font-size:11px;opacity:.9;">严格保持原产品外形/结构/颜色/比例/材质不变</div>
        </div>`;
    }
    document.querySelectorAll("#gen-modal-models label").forEach((lab) => {
      const id = lab.querySelector("input").value;
      const st = ((serverStatus && serverStatus.providers) || []).find((p) => p.id === id);
      let tip = lab.querySelector(".cfg-tip");
      if (!tip) {
        tip = document.createElement("span");
        tip.className = "cfg-tip";
        tip.style.marginLeft = "auto";
        tip.style.fontSize = "11px";
        lab.style.display = "flex";
        lab.appendChild(tip);
      }
      if (st && st.configured && id === "chatgpt") {
        tip.textContent = "● 已配置 · 额度可能不足";
        tip.style.color = "var(--orange, #a95832)";
      } else {
        tip.textContent = st ? (st.configured ? "● 已配置" : `○ 缺 ${st.missingKey}`) : "";
        tip.style.color = st && st.configured ? "var(--green)" : "var(--danger)";
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
    const checked = [...document.querySelectorAll("#gen-modal-models input:checked")].map((i) => i.value);
    if (!checked.length) {
      toast("请至少勾选一个模型");
      return;
    }
    const plan = findPlan(boxId);
    const promptEl = document.getElementById(`prompt-${boxId}`);
    const prompt = (promptEl ? promptEl.innerText.trim() : (plan ? plan.prompt : "")).trim();
    if (!prompt) {
      toast("生图提示词不能为空，请填写提示词");
      return;
    }
    if (plan) plan.prompt = prompt;
    const box = ensureBox(boxId);
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
        rt.text = checked.length > 1
          ? `基于白底基准图生成 (${i + 1}/${checked.length})：${mName}…`
          : `${mName} 图生图中（锚定白底基准图 · 输出 2000×2000）…`;
        renderPlans();
        toast(rt.text, { duration: 4000 });

        try {
          const nextVer = Math.max(0, ...box.results.filter((r) => r.model === mid).map((r) => r.version || 1)) + 1;
          const res = await API.post(
            "/api/generate",
            {
              provider: mid,
              prompt,
              boxId,
              asin: state.asin || DEMO.product.asin,
              productName: state.productName || "",
              whitebgImageUrl: wbRef.imageUrl,
              version: nextVer,
              kind: inferKind(boxId),
            },
            { timeoutMs: 105000, signal: ctrl.signal }
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
    if (selEl && GEN_PROVIDERS.includes(selEl.value)) box.refineProvider = selEl.value;
    const targetProvider = resolveRefineProvider(box, selected);
    const targetName = modelDisplayName(targetProvider);

    const plan = findPlan(boxId);
    const promptEl = document.getElementById(`prompt-${boxId}`);
    const prompt = (promptEl ? promptEl.innerText.trim() : (plan ? plan.prompt : "")).trim();
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
    const nextVer = Math.max(1, ...box.results.map((r) => r.version || 1)) + 1;

    try {
      try {
        const chat = await API.post("/api/refine", { provider: targetProvider, prompt, instruction }, { timeoutMs: 65000, signal: ctrl.signal });
        newPrompt = chat.newPrompt || prompt;
        if (plan) plan.prompt = newPrompt;
      } catch (e) {
        if (e && e.isCancelled) throw e;
        newPrompt = prompt + "\n\nRefinement: " + instruction;
        if (plan) plan.prompt = newPrompt;
      }

      rt.text = `${targetName} 正在基于白底基准图生成精改版 v${nextVer}（2000×2000）…`;
      renderPlans();

      const res = await API.post(
        "/api/generate",
        {
          provider: targetProvider,
          prompt: newPrompt,
          boxId,
          asin: state.asin || DEMO.product.asin,
          productName: state.productName || "",
          whitebgImageUrl: wbRef.imageUrl,
          version: nextVer,
          kind: "refine",
        },
        { timeoutMs: 105000, signal: ctrl.signal }
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
      version: selected.version,
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
        version: selected.version,
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
      .map((r, idx) => `<div class="upload-lib-card" title="${escapeHtml(r.label || "")}">
          <img src="${escapeHtml(API.fileUrl(r.imageUrl))}" alt="" />
          <div class="meta">${escapeHtml(r.label || "upload")}</div>
          <button type="button" class="btn btn-ghost btn-sm" style="width:100%;border:none;border-top:1px solid var(--line);border-radius:0;padding:3px 4px;font-size:10px;" data-use-as-wbsrc="${idx}">设为白底原图</button>
        </div>`)
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
    const nextVer = Math.max(0, ...box.results.filter((r) => r.model === "upload").map((r) => r.version || 1)) + 1;
    const id = `upload-${targetBox}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const item = {
      id, model: "upload", uploaded: true, version: nextVer,
      label: `自有上传 · ${kind || targetBox}`,
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
            asin: state.asin || DEMO.product.asin,
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
      toast(switchedFromPrior ? `已上传 ${ok} 张（2000×2000）并选中（原图仍保留在框内）` : `已上传 ${ok} 张自有图（2000×2000）至「过程图/」`, { duration: 4200 });
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

  async function importVoc() {
    if (vocImporting) return;
    const inputEl = document.getElementById("voc-query");
    const btnEl = document.getElementById("btn-voc-import");
    const q = inputEl.value.trim();
    if (!q) { inputEl.focus(); return toast("请输入 ASIN（如 B0GVDS8X33）或 taskId"); }
    vocImporting = true;
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
      const res = await API.post("/api/voc/import", { asin: q }, { timeoutMs: 45000 });
      const prevAsin = state.asin;
      const nextAsin = res.asin || q;
      state.mode = "real";
      state.source = "amazon";
      state.asin = nextAsin;
      state.taskId = res.taskId;
      state.productName = res.productName || nextAsin;
      state.productDir = res.productDir || res.productName || nextAsin;
      state.archiveOverride = res.archive;
      state.planBoxes = (res.planBoxes || []).map((b) => ({
        ...b,
        who: b.who || (["主图", "细节图", "尺寸图"].includes(b.badge) ? "秋霜" : "安然"),
      }));
      state.boxes = {};
      state.preview = [null, null, null, null, null, null, null];
      if (prevAsin !== nextAsin) {
        state.whitebgSources = [];
        state.whitebgSelectedSourceId = null;
        state.whitebgResults = [];
        state.activeWhitebgId = null;
      }
      if (WB && res.existingWhitebg && res.existingWhitebg.length) {
        WB.hydrateExisting(res.existingWhitebg);
      }
      Object.keys(boxRuntime).forEach((k) => delete boxRuntime[k]);
      if (res.saved) state.lastSavePath = res.saved.category + "/" + res.saved.filename;
      saveState();
      st.className = "voc-status ok";
      st.textContent = `✓ 已导入 ${nextAsin} → 目录「${state.productDir}」（${state.planBoxes.length} 个规划框${state.activeWhitebgId ? " · 已载入历史白底图" : " · 请接着做白底真修"}）`;
      setModeUI();
      renderArchive();
      if (WB) { WB.renderUploads(); WB.syncModelLabels(); WB.renderResults(); }
      renderPlans();
      renderPreview();
      renderUploadLib();
      refreshStatusQuiet();
      toast(`已导入 ${nextAsin} 真实 VOC 档案 → 产品目录「${state.productDir}」`);
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
    Object.assign(state, defaultState());
    Object.keys(boxRuntime).forEach((k) => delete boxRuntime[k]);
    saveState();
    setModeUI();
    renderArchive();
    if (WB) { WB.renderUploads(); WB.syncModelLabels(); WB.renderResults(); }
    renderPlans();
    renderPreview();
    renderUploadLib();
    toast("已切回演示档案模式");
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
    document.getElementById("source-toggle").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-source]");
      if (!btn) return;
      const nextSrc = btn.dataset.source;
      state.source = nextSrc;
      state.mode = nextSrc === "amazon" && state.archiveOverride ? "real" : "demo";
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
      WB.focusSection("已选为白底待修原图，点「开始白底真修」即可");
    });

    document.getElementById("btn-demo-mode").addEventListener("click", backToDemo);
    if (WB) WB.bindEvents();

    document.getElementById("layer-plan").addEventListener("click", (e) => {
      const card = e.target.closest(".gen-card");
      if (card) {
        const box = ensureBox(card.dataset.box);
        box.selectedResultId = card.dataset.rid;
        const picked = box.results.find((r) => r.id === card.dataset.rid);
        box.refineProvider = picked && GEN_PROVIDERS.includes(picked.model) ? picked.model : "doubao";
        saveState();
        renderPlans();
        return;
      }
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const boxId = btn.dataset.box;
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
    });

    document.getElementById("layer-plan").addEventListener("change", (e) => {
      const sel = e.target.closest("select[data-refine-provider]");
      if (sel) { ensureBox(sel.dataset.refineProvider).refineProvider = sel.value; saveState(); renderPlans(); }
    });

    document.getElementById("layer-plan").addEventListener("input", (e) => {
      const ta = e.target.closest("textarea[data-refine-input]");
      if (ta) { ensureBox(ta.dataset.refineInput).refineDraft = ta.value; saveStateDebounced(); }
      const brief = e.target.closest("[data-brief]");
      if (brief && findPlan(brief.dataset.brief)) { findPlan(brief.dataset.brief).brief = brief.innerText; saveStateDebounced(); }
      const prompt = e.target.closest("[data-prompt]");
      if (prompt && findPlan(prompt.dataset.prompt)) { findPlan(prompt.dataset.prompt).prompt = prompt.innerText; saveStateDebounced(); }
    });

    document.getElementById("gen-modal-cancel").addEventListener("click", closeGenModal);
    document.getElementById("gen-modal-ok").addEventListener("click", runGenerate);
    document.getElementById("gen-modal").addEventListener("click", (e) => { if (e.target.id === "gen-modal") closeGenModal(); });
    document.getElementById("gen-modal-models").addEventListener("change", () => {
      document.querySelectorAll("#gen-modal-models label").forEach((lab) => lab.classList.toggle("checked", lab.querySelector("input").checked));
    });

    document.getElementById("btn-auto-fill").addEventListener("click", autoFillPreview);
    document.getElementById("btn-sync-final").addEventListener("click", () => WB && WB.syncPreviewToFinal({ silent: false }));
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
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const idx = Number(btn.dataset.slot);
      const action = btn.dataset.action;
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
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
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
          let cls = p.configured ? "live" : "missing";
          let label = p.configured ? "已配置" : "缺 " + p.missingKey;
          if (p.id === "chatgpt" && p.configured) { cls = "warn"; label = "已配置 · 额度可能不足"; }
          const tip = p.note ? ` title="${escapeHtml(p.note)}"` : "";
          return `<span class="provider-pill ${cls}"${tip}>${escapeHtml(p.name)}：${escapeHtml(label)}</span>`;
        })
        .join("") +
      `<span class="provider-pill live">规格：2000×2000 PNG/JPG</span>` +
      `<span class="provider-pill">目录 → ~/Desktop/亚马逊产品图片/{产品名}/{过程图|白底图|最终版本}（${escapeHtml(syncText)}）</span>`;
  }

  async function bootServer() {
    try {
      serverStatus = await API.get("/api/status");
      const list = await API.get("/api/voc/list");
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
          const wb = await API.get(
            `/api/whitebg/list?asin=${encodeURIComponent(state.asin)}&productName=${encodeURIComponent(state.productName || "")}`,
            { timeoutMs: 10000 }
          );
          if (wb && wb.productDir) state.productDir = wb.productDir;
          if (wb && wb.items && wb.items.length) { WB.hydrateExisting(wb.items); saveState(); }
        } catch (_) {}
      }
      renderProviderStatus();
    } catch (_) {
      document.getElementById("provider-status").innerHTML =
        `<span class="provider-pill missing">后端未连接 · 本机请跑 python3 server/app.py；线上走 /image-board-api</span>`;
    }
  }

  async function init() {
    WB = window.BoardWhitebg.create({
      state, API, DEMO, GEN_PROVIDERS, MODEL_MAP,
      toast, humanizeError, escapeHtml, modelDisplayName,
      saveState, saveStateDebounced, setModeUI, renderPlans, renderPreview,
      ensureBox, currentPlans, findPlan, reconcilePreviewFlags, refreshStatusQuiet,
      displayProductFolder, readFileAsDataURL,
    });
    reconcilePreviewFlags();
    await bootServer();
    setModeUI();
    renderArchive();
    WB.renderUploads();
    WB.syncModelLabels();
    WB.renderResults();
    renderPlans();
    renderPreview();
    renderUploadLib();
    bindGlobal();
  }

  init();
})();
