/* AI 做图看板 — 演示 + 真实 VOC / 生图 / 自有上传 / 精改与预览 */
(function () {
  const STORAGE_KEY = "ai-image-board-v2";
  const GEN_PROVIDERS = ["doubao", "banana", "chatgpt"];
  const MODEL_MAP = Object.fromEntries(DEMO.models.map((m) => [m.id, m]));
  const API = window.BoardAPI;

  const state = loadState() || defaultState();
  let serverStatus = null;
  let vocImporting = false;
  // Transient per-box runtime state (not persisted to localStorage)
  // boxId -> { busy: bool, text: string, startedAt: number, controller: AbortController, lastError: string|null }
  const boxRuntime = {};

  function defaultState() {
    return {
      mode: "demo", // demo | real
      source: "demo",
      asin: DEMO.product.asin,
      productName: DEMO.product.name,
      taskId: null,
      archiveOverride: null,
      whitebgSelectedModels: ["banana", "doubao"],
      whitebgGenerated: false,
      whitebgPicks: {},
      whitebgSaved: false,
      boxes: {},
      preview: [null, null, null, null, null, null, null],
      genTargetBoxId: null,
      lastSavePath: null,
      planBoxes: null,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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

  function toast(msg, opts) {
    const el = document.getElementById("toast");
    if (!el) return;
    const duration = (opts && opts.duration) || 3800;
    const sticky = !!(opts && opts.sticky);
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    if (!sticky) {
      toast._t = setTimeout(() => el.classList.remove("show"), duration);
    }
  }

  function modelDisplayName(mid) {
    return (MODEL_MAP[mid] && MODEL_MAP[mid].name) || mid || "模型";
  }

  function humanizeError(err, providerId) {
    if (err && err.isCancelled) return "已取消生成";
    const data = (err && err.data) || null;
    const rawMsg = (data && data.error) || (err && err.message) || String(err || "");
    const s = String(rawMsg);
    const pName = modelDisplayName(providerId);

    if (
      (err && err.isTimeout) ||
      (data && data.timeout) ||
      /超时|timed?\s*out|AbortError/i.test(s)
    ) {
      if (providerId === "banana") return "Banana 超时，请重试或改用豆包";
      return `${pName} 超时，请重试或改用豆包`;
    }
    if ((data && data.quota) || /429|insufficient_quota|额度不足|billing_hard_limit|resource_exhausted/i.test(s)) {
      if (providerId === "banana") return "Banana 配额繁忙（429），请稍后重试或改用豆包";
      return "ChatGPT 额度不足（需 API Credits，与 Pro 无关）。请改用豆包或 Banana。";
    }
    if (/未配置 API Key/i.test(s)) return s;
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
      boxRuntime[boxId] = {
        busy: false,
        text: "",
        startedAt: 0,
        controller: null,
        lastError: null,
      };
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
    const banner = document.getElementById("top-banner");
    banner.classList.toggle("banner-real", real);
    document.getElementById("banner-mode").textContent = real ? "真实 VOC / 生图模式" : "演示数据模式";
    document.getElementById("banner-detail").textContent = real
      ? "· 图落盘至 Mac「亚马逊产品图片」分类目录 · 豆包 / Banana 真实生图"
      : "· 可导入真实 VOC / 上传自有图 · ChatGPT 额度不足会提示";

    const modeTag = document.getElementById("mode-tag");
    if (modeTag) {
      modeTag.textContent = real ? "真实VOC" : "演示数据";
      modeTag.classList.toggle("tag-demo", !real);
      modeTag.classList.toggle("tag-real", real);
    }

    document.querySelectorAll("[data-mode-tag]").forEach((el) => {
      el.textContent = real ? "真实" : "演示数据";
      el.classList.toggle("tag-demo", !real);
      el.classList.toggle("tag-real", real);
    });

    const whitebgTag = document.getElementById("whitebg-mode-tag");
    if (whitebgTag) {
      whitebgTag.textContent = real ? "模拟（暂未接真修）" : "演示模拟";
      whitebgTag.classList.toggle("tag-demo", !real);
      whitebgTag.classList.toggle("tag-mock", real);
      whitebgTag.classList.remove("tag-real");
    }

    const autoFillBtn = document.getElementById("btn-auto-fill");
    if (autoFillBtn) {
      autoFillBtn.textContent = real ? "一键填入已选图" : "一键填入已选图（演示）";
    }

    const mac = (serverStatus && serverStatus.macImageRoot) || "/Users/lhy/Desktop/亚马逊产品图片";
    const sq = serverStatus && serverStatus.syncQueue;
    let syncSummary = "";
    if (sq) {
      syncSummary = sq.pending > 0
        ? ` · 待同步 Mac ${sq.pending} 项`
        : (sq.syncedCount > 0 ? ` · 已同步 Mac ${sq.syncedCount} 项` : "");
    }
    document.getElementById("save-path").textContent =
      "落盘：" + mac + "／{主图|细节图|尺寸图|场景图1-7|精改版本|预览选用…}" +
      (state.lastSavePath ? " · 最近：" + state.lastSavePath : "") +
      syncSummary;

    document.getElementById("product-sub").textContent = real
      ? `亚马逊 7 图 · ASIN ${state.asin || "—"} · task ${state.taskId || "—"}${state.productName ? " · " + state.productName : ""}`
      : `亚马逊 7 图 Listing · 演示产品 ${DEMO.product.name}（${DEMO.product.asin}）`;
  }

  /* ---------- Archive ---------- */
  function activeArchive() {
    if (state.source === "etsy") return DEMO.archives.etsy;
    if (state.source === "demo") return DEMO.archives.amazon;
    if (state.archiveOverride) return state.archiveOverride;
    return DEMO.archives.amazon;
  }

  function renderArchive() {
    const data = activeArchive();
    const isRealCard = isRealMode() && state.source === "amazon" && !!state.archiveOverride;
    document.getElementById("source-label").textContent =
      (data.label || "") + (isRealCard ? " · 真实导入" : " · 演示数据");
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

  /* ---------- White-bg (mock, clearly badged as 模拟) ---------- */
  function renderWhitebgUploads() {
    const subLabel = isRealMode() ? "示例" : "演示";
    document.getElementById("whitebg-uploads").innerHTML =
      DEMO.whitebgUploads
        .map(
          (u) => `
      <div class="upload-thumb"><div class="ph" style="background:${u.tone}">${u.label}</div><span class="label">${subLabel}</span></div>`
        )
        .join("") +
      `<div class="upload-thumb" style="border-style:solid;opacity:.6"><div class="ph">+ n</div></div>`;
  }
  function syncWhitebgModelLabels() {
    document.querySelectorAll("#whitebg-models label[data-model]").forEach((lab) => {
      const input = lab.querySelector("input");
      const checked = state.whitebgSelectedModels.includes(input.value);
      input.checked = checked;
      lab.classList.toggle("checked", checked);
    });
  }
  function renderWhitebgResults() {
    const root = document.getElementById("whitebg-results");
    const cols = ["chatgpt", "banana", "doubao"];
    root.innerHTML = cols
      .map((mid) => {
        const m = MODEL_MAP[mid];
        const selected = state.whitebgSelectedModels.includes(mid);
        if (!selected) return `<div class="model-col empty"><h4>${m.name}</h4><div class="empty-msg">未勾选，故无图</div></div>`;
        if (!state.whitebgGenerated) return `<div class="model-col"><h4>${m.name}</h4><div class="empty-msg">尚未生成 · 白底修图暂为模拟</div></div>`;
        const thumbs = DEMO.whitebgUploads
          .map((u) => {
            const isPick = state.whitebgPicks[mid] === u.id;
            return `<div class="result-thumb ${isPick ? "selected" : ""}" data-model="${mid}" data-uid="${u.id}">
              <div class="swatch ${m.cls}">${m.name}<br/>${u.label}</div><span class="check">✓</span></div>`;
          })
          .join("");
        return `<div class="model-col"><h4>${m.name}<span class="tag tag-mock">模拟</span></h4><div class="result-thumbs">${thumbs}</div></div>`;
      })
      .join("");
    document.getElementById("whitebg-saved").classList.toggle("show", state.whitebgSaved);
  }

  /* ---------- Plans ---------- */
  function plansByWho() {
    const all = currentPlans();
    const qs = all.filter((b) => b.who === "秋霜" || (b.id || "").startsWith("qs-") || ["主图", "细节图", "尺寸图"].includes(b.badge));
    const qsIds = new Set(qs.map((b) => b.id));
    const ar = all.filter((b) => !qsIds.has(b.id));
    if (!qs.length && !ar.length) return { qs: DEMO.qiushuang, ar: DEMO.anran };
    return { qs, ar };
  }

  function resolveRefineProvider(box, selected) {
    if (box.refineProvider && GEN_PROVIDERS.includes(box.refineProvider)) {
      return box.refineProvider;
    }
    if (selected && GEN_PROVIDERS.includes(selected.model)) {
      return selected.model;
    }
    return "doubao";
  }

  function renderPlanBox(plan) {
    const box = ensureBox(plan.id);
    const rt = getRuntime(plan.id);
    const selected = box.results.find((r) => r.id === box.selectedResultId);
    const isUploadSelected = !!(selected && !GEN_PROVIDERS.includes(selected.model));
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
        ? (rt.busy ? "" : `<div style="font-size:11px;color:var(--muted);margin-top:8px;">尚未生成 · 空态</div>`)
        : `<div class="gen-results">${box.results
            .map((r) => {
              const m = MODEL_MAP[r.model] || { name: r.model, cls: "model-generic" };
              const sel = r.id === box.selectedResultId;
              const img = r.imageUrl
                ? `<img src="${escapeHtml(API.fileUrl(r.imageUrl))}" alt="${escapeHtml(m.name)}" />`
                : `<div class="ph-img ${m.cls}">${escapeHtml(m.name)}<br/>v${r.version}<br/><span style="font-weight:400;opacity:.85">${r.mock ? "占位" : "真实"}</span></div>`;
              return `<div class="gen-card ${sel ? "selected" : ""}" data-box="${escapeHtml(plan.id)}" data-rid="${escapeHtml(r.id)}">
                ${img}
                <div class="meta">${escapeHtml(r.label || "")}${r.macPath ? "<br/>→ Mac" : ""}</div>
                <span class="pick-mark">✓</span>
              </div>`;
            })
            .join("")}</div>`;

    const refineTitle = isUploadSelected
      ? `精改支线 · 自有上传 → 用 ${modelDisplayName(refineProv)} 重新生成`
      : `精改支线 · ${selected ? modelDisplayName(selected.model) : "所选模型"}`;

    const refineModelOptions = [
      { id: "doubao", label: "豆包（推荐 · 快且稳）" },
      { id: "banana", label: "Banana（Gemini 生图）" },
      { id: "chatgpt", label: "ChatGPT" },
    ]
      .map((opt) => `<option value="${opt.id}" ${refineProv === opt.id ? "selected" : ""}>${opt.label}</option>`)
      .join("");

    const refineHtml = `
      <div class="refine-panel ${box.refineOpen ? "open" : ""}">
        <h5>${escapeHtml(refineTitle)}</h5>
        <div class="refine-model-bar">
          <span class="${isUploadSelected ? "refine-upload-tip" : ""}">
            ${isUploadSelected ? "自有上传无法直接重绘，将改用生图模型生成新版本：" : "精改出图模型："}
          </span>
          <select data-refine-provider="${escapeHtml(plan.id)}" ${rt.busy ? "disabled" : ""}>
            ${refineModelOptions}
          </select>
        </div>
        <div class="refine-row">
          <textarea rows="2" placeholder="输入修改意见，如：增强卡片质感、光线更温暖、主体占画面 85%…" data-refine-input="${escapeHtml(plan.id)}" ${rt.busy ? "disabled" : ""}>${escapeHtml(box.refineDraft || "")}</textarea>
        </div>
        <div class="refine-row">
          <button type="button" class="btn btn-sm" data-action="rewrite-prompt" data-box="${escapeHtml(plan.id)}" ${rt.busy ? "disabled" : ""}>暂存意见</button>
          <button type="button" class="btn btn-primary btn-sm" data-action="optimize" data-box="${escapeHtml(plan.id)}" ${!selected || rt.busy ? "disabled" : ""}>
            ${rt.busy ? '<span class="spinner"></span> 处理中…' : `优化 → 生成新版（${escapeHtml(modelDisplayName(refineProv))}）`}
          </button>
        </div>
        <div style="font-size:11px;color:var(--muted);">先由豆包对话优化英文生图提示词，再调用上方所选生图模型产出新版</div>
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
        <div class="label-sm">生图提示词</div>
        <div class="prompt-text" contenteditable="true" id="prompt-${escapeHtml(plan.id)}" data-prompt="${escapeHtml(plan.id)}">${escapeHtml(plan.prompt)}</div>
        <div class="box-actions">
          <button type="button" class="btn btn-primary btn-sm" data-action="generate" data-box="${escapeHtml(plan.id)}" ${rt.busy ? "disabled" : ""}>
            ${rt.busy ? '<span class="spinner"></span> 生成中…' : "生成图片"}
          </button>
          <button type="button" class="btn btn-sm" data-action="upload-box" data-box="${escapeHtml(plan.id)}" ${rt.busy ? "disabled" : ""}>上传图片</button>
          <button type="button" class="btn btn-sm" data-action="toggle-refine" data-box="${escapeHtml(plan.id)}" ${box.results.length ? "" : "disabled"}>精改支线</button>
          <button type="button" class="btn btn-success btn-sm" data-action="add-preview" data-box="${escapeHtml(plan.id)}" ${selected ? "" : "disabled"}>
            ${box.inPreview ? "已在预览" : "加入预览"}
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
    const plans = currentPlans();
    const chips = plans.map((p) => {
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

  /* ---------- Preview ---------- */
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
            <div class="slot-src">${escapeHtml(modelDisplayName(item.model))} v${item.version} · ${escapeHtml(item.boxId)}</div>
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

  /* ---------- Generate ---------- */
  function openGenModal(boxId) {
    const rt = getRuntime(boxId);
    if (rt.busy) {
      toast("该规划框正在生成中，请稍候或点框内「取消」");
      return;
    }
    state.genTargetBoxId = boxId;
    const plan = findPlan(boxId);
    document.getElementById("gen-modal-desc").textContent =
      `为「${plan ? plan.title : boxId}」勾选生图模型。豆包与 Banana 已配置可用；ChatGPT 若无额度会提示。`;
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
    let allow = document.getElementById("allow-mock-fallback");
    if (!allow) {
      const wrap = document.createElement("label");
      wrap.style.cssText = "display:flex;gap:8px;align-items:center;font-size:12px;margin:8px 0 12px;color:var(--muted)";
      wrap.innerHTML = `<input type="checkbox" id="allow-mock-fallback" /> 未配置 Key 时允许占位图（文件名含 DEMO）`;
      document.getElementById("gen-modal-models").after(wrap);
    }
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

  async function runGenerate() {
    const boxId = state.genTargetBoxId;
    if (!boxId) return;
    const checked = [...document.querySelectorAll("#gen-modal-models input:checked")].map((i) => i.value);
    if (!checked.length) {
      toast("请至少勾选一个模型");
      return;
    }
    const plan = findPlan(boxId);
    const promptEl = document.getElementById(`prompt-${boxId}`);
    const prompt = promptEl ? promptEl.innerText.trim() : (plan ? plan.prompt : "");
    if (plan && prompt) plan.prompt = prompt;
    const box = ensureBox(boxId);
    const allowMock = !!(document.getElementById("allow-mock-fallback") || {}).checked;
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
          ? `正在生成 (${i + 1}/${checked.length})：${mName}…`
          : `${mName} 生图中${mid === "banana" ? "（最长约 90s）" : ""}…`;
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
              version: nextVer,
              kind: inferKind(boxId),
              allowMockFallback: allowMock || !isRealMode(),
              forceMock: false,
            },
            { timeoutMs: 100000, signal: ctrl.signal }
          );
          const id = `${boxId}-${mid}-v${nextVer}-${Date.now()}`;
          box.results.push({
            id,
            model: mid,
            version: nextVer,
            label: `${mName} · v${nextVer} · ${res.mock ? "占位" : "真实"}`,
            imageUrl: res.imageUrl,
            macPath: res.saved && res.saved.macPath,
            mock: !!res.mock,
          });
          box.selectedResultId = id;
          box.refineProvider = mid;
          if (res.saved && res.saved.category) {
            state.lastSavePath = res.saved.category + "/" + res.saved.filename;
          }
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
          if ((!isRealMode() || allowMock) && !(e && e.isTimeout)) {
            try {
              const res = await API.post(
                "/api/generate",
                {
                  provider: mid,
                  prompt,
                  boxId,
                  asin: state.asin || DEMO.product.asin,
                  version: 1,
                  kind: inferKind(boxId),
                  forceMock: true,
                },
                { timeoutMs: 20000, signal: ctrl.signal }
              );
              const id = `${boxId}-${mid}-v1-mock-${Date.now()}`;
              box.results.push({
                id,
                model: mid,
                version: 1,
                label: `${mName} · v1 · 占位`,
                imageUrl: res.imageUrl,
                mock: true,
              });
              if (!box.selectedResultId) box.selectedResultId = id;
            } catch (_) {}
          }
        }
      }
    } finally {
      rt.busy = false;
      rt.controller = null;
      rt.text = "";
      saveState();
      renderPlans();
      refreshStatusQuiet();
    }

    if (cancelled) {
      toast("已取消生成", { duration: 3000 });
    } else if (okNames.length > 0 && errMsgs.length === 0) {
      toast(`生成完成（${okNames.join("、")}）· 已入库待同步 Mac`, { duration: 4000 });
    } else if (okNames.length > 0 && errMsgs.length > 0) {
      toast(`已完成 ${okNames.join("、")}；${errMsgs.join("；")}`, { duration: 5500 });
    } else if (errMsgs.length > 0) {
      toast(errMsgs.join("；"), { duration: 5500 });
    }
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

  async function optimizeBox(boxId) {
    const box = ensureBox(boxId);
    const rt = getRuntime(boxId);
    if (rt.busy) {
      toast("当前规划框正在处理中，请稍候");
      return;
    }
    const selected = box.results.find((r) => r.id === box.selectedResultId);
    if (!selected) {
      toast("请先勾选一张图");
      return;
    }
    // Sync latest textarea value if DOM exists
    const ta = document.querySelector(`textarea[data-refine-input="${boxId}"]`);
    if (ta) box.refineDraft = ta.value;
    const selEl = document.querySelector(`select[data-refine-provider="${boxId}"]`);
    if (selEl && GEN_PROVIDERS.includes(selEl.value)) {
      box.refineProvider = selEl.value;
    }
    const targetProvider = resolveRefineProvider(box, selected);
    const targetName = modelDisplayName(targetProvider);

    const plan = findPlan(boxId);
    const promptEl = document.getElementById(`prompt-${boxId}`);
    const prompt = promptEl ? promptEl.innerText.trim() : (plan ? plan.prompt : "");
    const instruction = (box.refineDraft || "").trim() || "增强产品主体占比、材质细节与光线质感";

    const ctrl = new AbortController();
    rt.busy = true;
    rt.startedAt = Date.now();
    rt.controller = ctrl;
    rt.lastError = null;
    rt.text = "正在优化生图提示词…";
    renderPlans();
    toast("正在优化提示词并生成精改新图…", { duration: 3500 });

    let newPrompt = prompt;
    const nextVer = Math.max(1, ...box.results.map((r) => r.version || 1)) + 1;

    try {
      try {
        const chat = await API.post(
          "/api/refine",
          {
            provider: targetProvider,
            prompt,
            instruction,
          },
          { timeoutMs: 65000, signal: ctrl.signal }
        );
        newPrompt = chat.newPrompt || prompt;
        if (plan) plan.prompt = newPrompt;
      } catch (e) {
        if (e && e.isCancelled) throw e;
        newPrompt = prompt + "\n\nRefinement: " + instruction;
        if (plan) plan.prompt = newPrompt;
      }

      rt.text = `${targetName} 正在生成精改版 v${nextVer}…`;
      renderPlans();

      const res = await API.post(
        "/api/generate",
        {
          provider: targetProvider,
          prompt: newPrompt,
          boxId,
          asin: state.asin || DEMO.product.asin,
          version: nextVer,
          kind: "refine",
          allowMockFallback: !isRealMode(),
        },
        { timeoutMs: 100000, signal: ctrl.signal }
      );
      const id = `${boxId}-${targetProvider}-v${nextVer}-${Date.now()}`;
      box.results.push({
        id,
        model: targetProvider,
        version: nextVer,
        label: `${targetName} · v${nextVer} · ${res.mock ? "占位" : "精改"}`,
        imageUrl: res.imageUrl,
        macPath: res.saved && res.saved.macPath,
        mock: !!res.mock,
      });
      box.selectedResultId = id;
      box.refineProvider = targetProvider;
      if (res.saved) state.lastSavePath = res.saved.category + "/" + res.saved.filename;
      toast(`精改完成：已生成 ${targetName} v${nextVer}`, { duration: 4000 });
    } catch (e) {
      if (e && e.isCancelled) {
        toast("已取消精改生成", { duration: 3000 });
      } else {
        const msg = humanizeError(e, targetProvider);
        rt.lastError = "精改失败：" + msg;
        toast("精改生图失败：" + msg, { duration: 5500 });
      }
    } finally {
      rt.busy = false;
      rt.controller = null;
      rt.text = "";
      saveState();
      renderPlans();
      refreshStatusQuiet();
    }
  }

  function addToPreview(boxId) {
    const box = ensureBox(boxId);
    const selected = box.results.find((r) => r.id === box.selectedResultId);
    if (!selected) {
      toast("请先勾选一张");
      return;
    }
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
      if (empty < 0) {
        toast("预览已满 7 槽，请先移除空位");
        return;
      }
      state.preview[empty] = entry;
    }
    box.inPreview = true;
    saveState();
    renderPlans();
    renderPreview();
    toast("已加入预览框");
  }

  async function autoFillPreview() {
    const plans = currentPlans();
    if (isRealMode()) {
      // Fill from boxes that already have generated/uploaded results
      const readyPlans = plans.filter((p) => {
        const b = state.boxes[p.id];
        return b && b.results && b.results.length > 0;
      });
      if (!readyPlans.length) {
        toast("请先在上方规划框生成或上传图片，再一键填入");
        return;
      }
      state.preview = [null, null, null, null, null, null, null];
      Object.values(state.boxes).forEach((b) => (b.inPreview = false));
      readyPlans.slice(0, 7).forEach((plan, idx) => {
        const box = ensureBox(plan.id);
        if (!box.selectedResultId) box.selectedResultId = box.results[box.results.length - 1].id;
        const selected = box.results.find((r) => r.id === box.selectedResultId) || box.results[0];
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
      toast(`已将 ${ Math.min(readyPlans.length, 7) } 张已选图片填入预览框`);
      return;
    }

    // Demo mode: fill 7 slots (using existing results or local demo placeholders)
    const preferred = plans.slice(0, 7);
    for (let idx = 0; idx < 7; idx++) {
      const plan = preferred[idx];
      if (!plan) {
        state.preview[idx] = null;
        continue;
      }
      const box = ensureBox(plan.id);
      if (!box.results.length) {
        const mid = ["doubao", "banana"][idx % 2];
        box.results.push({
          id: `${plan.id}-demo-${Date.now()}-${idx}`,
          model: mid,
          version: 1,
          label: `${modelDisplayName(mid)} · v1 · 演示占位`,
          mock: true,
        });
        box.selectedResultId = box.results[0].id;
      }
      if (!box.selectedResultId) box.selectedResultId = box.results[0].id;
      const selected = box.results.find((r) => r.id === box.selectedResultId);
      state.preview[idx] = {
        boxId: plan.id,
        title: plan.title,
        model: selected.model,
        version: selected.version,
        resultId: selected.id,
        imageUrl: selected.imageUrl,
      };
      box.inPreview = true;
    }
    saveState();
    renderPlans();
    renderPreview();
    toast("已填入 7 槽演示预览");
  }

  /* ---------- Own upload library ---------- */
  const KIND_TO_BOX = {
    main: "qs-main",
    detail: "qs-detail",
    size: "qs-size",
    "scene-1": "ar-scene-1",
    "scene-2": "ar-scene-2",
    "scene-3": "ar-scene-3",
    "scene-4": "ar-scene-4",
    "scene-5": "ar-scene-5",
    "scene-6": "ar-scene-6",
    "scene-7": "ar-scene-7",
    refine: null,
    preview: null,
  };

  function renderUploadLib() {
    const root = document.getElementById("upload-lib-thumbs");
    if (!root) return;
    const uploads = [];
    Object.values(state.boxes || {}).forEach((b) => {
      (b.results || []).forEach((r) => {
        if (r.model === "upload" || r.uploaded) uploads.push(r);
      });
    });
    if (!uploads.length) {
      root.innerHTML = `<div class="empty-msg">尚未上传自有图 · 空态</div>`;
      return;
    }
    root.innerHTML = uploads
      .slice(-12)
      .reverse()
      .map((r) => {
        const img = r.imageUrl
          ? `<img src="${escapeHtml(API.fileUrl(r.imageUrl))}" alt="" />`
          : `<div class="ph-img model-upload">上传</div>`;
        return `<div class="upload-lib-card" title="${escapeHtml(r.label || "")}">${img}<div class="meta">${escapeHtml(r.label || "upload")}</div></div>`;
      })
      .join("");
  }

  function attachUploadResult(res, boxId, kind) {
    let targetBox = boxId || KIND_TO_BOX[kind] || "qs-main";
    const plans = currentPlans();
    if (!plans.find((p) => p.id === targetBox) && plans.length) {
      // Match by prefix (e.g. qs-detail-1 or first ar-* scene)
      const byPrefix = plans.find((p) => p.id.startsWith(targetBox)) || (targetBox.startsWith("ar-") ? plans.find((p) => p.who === "安然") : null);
      if (byPrefix) targetBox = byPrefix.id;
    }
    const box = ensureBox(targetBox);
    const hadPrior = box.results.length > 0;
    const nextVer = Math.max(0, ...box.results.filter((r) => r.model === "upload").map((r) => r.version || 1)) + 1;
    const id = `upload-${targetBox}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const item = {
      id,
      model: "upload",
      uploaded: true,
      version: nextVer,
      label: `自有上传 · ${res.category || kind || targetBox}`,
      imageUrl: res.imageUrl,
      macPath: res.saved && res.saved.macPath,
      mock: false,
    };
    box.results.push(item);
    box.selectedResultId = id;
    box.refineProvider = "doubao";
    if (res.saved && res.saved.category) {
      state.lastSavePath = res.saved.category + "/" + res.saved.filename;
    }
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
    const list = [...files].filter((f) => f && f.type.startsWith("image/"));
    if (!list.length) {
      toast("请选择 PNG / JPG / WebP 图片文件");
      return;
    }
    const st = document.getElementById("upload-status");
    const btnUp = document.getElementById("btn-upload-own");
    if (btnUp) btnUp.disabled = true;
    if (st) {
      st.className = "voc-status";
      st.innerHTML = `<span class="spinner"></span> 上传中 0/${list.length}…`;
    }
    let ok = 0;
    let switchedFromPrior = false;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (st) st.innerHTML = `<span class="spinner"></span> 上传中 ${i + 1}/${list.length}…`;
      try {
        const dataUrl = await readFileAsDataURL(file);
        const res = await API.post(
          "/api/upload",
          {
            asin: state.asin || DEMO.product.asin,
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
        ok++;
      } catch (e) {
        toast(humanizeError(e, "upload"), { duration: 4500 });
      }
    }
    if (btnUp) btnUp.disabled = false;
    saveState();
    setModeUI();
    renderPlans();
    renderUploadLib();
    refreshStatusQuiet();
    if (st) {
      st.className = ok ? "voc-status ok" : "voc-status err";
      st.textContent = ok ? `已入库 ${ok} 张 → 待同步 Mac 分类目录` : "上传失败";
    }
    if (ok) {
      toast(
        switchedFromPrior
          ? `已上传 ${ok} 张并切换为自有上传（原生成图仍保留在框内可点选）`
          : `已上传 ${ok} 张自有图并入库`,
        { duration: 4200 }
      );
    } else {
      toast("没有成功上传的图片");
    }
  }

  function pickFilesForBox(boxId) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.multiple = true;
    input.onchange = () => {
      const kind = inferKind(boxId);
      uploadOwnFiles(input.files, kind, boxId);
    };
    input.click();
  }

  /* ---------- VOC import ---------- */
  async function importVoc() {
    if (vocImporting) return;
    const inputEl = document.getElementById("voc-query");
    const btnEl = document.getElementById("btn-voc-import");
    const q = inputEl.value.trim();
    if (!q) {
      toast("请输入 ASIN（如 B0GVDS8X33）或 taskId");
      inputEl.focus();
      return;
    }
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
      const sec = Math.floor((Date.now() - started) / 1000);
      st.innerHTML = `<span class="spinner"></span> 正在从 VOC 拉取档案与规划框（${sec}s）…`;
    }, 1000);

    try {
      const res = await API.post("/api/voc/import", { asin: q }, { timeoutMs: 45000 });
      state.mode = "real";
      state.source = "amazon";
      state.asin = res.asin || q;
      state.taskId = res.taskId;
      state.productName = res.productName;
      state.archiveOverride = res.archive;
      state.planBoxes = (res.planBoxes || []).map((b) => ({
        ...b,
        who: b.who || (["主图", "细节图", "尺寸图"].includes(b.badge) ? "秋霜" : "安然"),
      }));
      state.boxes = {};
      state.preview = [null, null, null, null, null, null, null];
      Object.keys(boxRuntime).forEach((k) => delete boxRuntime[k]);
      if (res.saved) state.lastSavePath = res.saved.category + "/" + res.saved.filename;
      saveState();
      st.className = "voc-status ok";
      st.textContent = `✓ 已导入 ${res.asin || res.taskId}（来源：${res.resolvedSource} · ${state.planBoxes.length} 个规划框）`;
      setModeUI();
      renderArchive();
      renderWhitebgUploads();
      renderWhitebgResults();
      renderPlans();
      renderPreview();
      renderUploadLib();
      refreshStatusQuiet();
      toast(`已导入 ${res.asin || res.taskId} 真实 VOC 档案（${state.planBoxes.length} 个规划框）`);
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
    renderWhitebgUploads();
    syncWhitebgModelLabels();
    renderWhitebgResults();
    renderPlans();
    renderPreview();
    renderUploadLib();
    toast("已切回演示数据模式");
  }

  /* ---------- DnD ---------- */
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
    });
  }

  function bindGlobal() {
    document.getElementById("source-toggle").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-source]");
      if (!btn) return;
      const nextSrc = btn.dataset.source;
      state.source = nextSrc;
      if (nextSrc === "demo") {
        state.mode = "demo";
      } else if (nextSrc === "amazon" && state.archiveOverride) {
        state.mode = "real";
      } else if (nextSrc === "etsy") {
        state.mode = "demo";
      }
      saveState();
      setModeUI();
      renderArchive();
      renderWhitebgUploads();
      renderWhitebgResults();
      renderPlans();
      renderPreview();
    });

    document.getElementById("btn-voc-import").addEventListener("click", importVoc);
    document.getElementById("voc-query").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        importVoc();
      }
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
    document.getElementById("btn-demo-mode").addEventListener("click", backToDemo);

    document.getElementById("whitebg-models").addEventListener("change", (e) => {
      if (e.target.type !== "checkbox") return;
      state.whitebgSelectedModels = [...document.querySelectorAll("#whitebg-models input:checked")].map((i) => i.value);
      state.whitebgGenerated = false;
      state.whitebgPicks = {};
      state.whitebgSaved = false;
      saveState();
      syncWhitebgModelLabels();
      renderWhitebgResults();
    });
    document.getElementById("btn-fix-whitebg").addEventListener("click", () => {
      if (!state.whitebgSelectedModels.length) {
        toast("请勾选至少一个白底修图模型");
        return;
      }
      state.whitebgGenerated = true;
      state.whitebgSelectedModels.forEach((mid) => {
        state.whitebgPicks[mid] = DEMO.whitebgUploads[0].id;
      });
      state.whitebgSaved = true;
      saveState();
      renderWhitebgResults();
      toast("白底修图当前为模拟结果（偏好已保存）");
    });
    document.getElementById("whitebg-results").addEventListener("click", (e) => {
      const thumb = e.target.closest(".result-thumb");
      if (!thumb) return;
      state.whitebgPicks[thumb.dataset.model] = thumb.dataset.uid;
      state.whitebgSaved = true;
      saveState();
      renderWhitebgResults();
    });

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
      if (action === "cancel-box") {
        const rt = boxRuntime[boxId];
        if (rt && rt.controller) rt.controller.abort("user");
      }
      if (action === "dismiss-error") {
        const rt = getRuntime(boxId);
        rt.lastError = null;
        renderPlans();
      }
      if (action === "toggle-refine") {
        ensureBox(boxId).refineOpen = !ensureBox(boxId).refineOpen;
        saveState();
        renderPlans();
      }
      if (action === "optimize") optimizeBox(boxId);
      if (action === "rewrite-prompt") {
        const box = ensureBox(boxId);
        const ta = document.querySelector(`textarea[data-refine-input="${boxId}"]`);
        if (ta) box.refineDraft = ta.value;
        if (!box.refineDraft.trim()) toast("请先填写修改说明");
        else toast("已暂存修改意见，点右侧「优化 → 生成新版」即可生图");
        saveState();
      }
      if (action === "add-preview") addToPreview(boxId);
    });

    document.getElementById("layer-plan").addEventListener("change", (e) => {
      const sel = e.target.closest("select[data-refine-provider]");
      if (sel) {
        const boxId = sel.dataset.refineProvider;
        ensureBox(boxId).refineProvider = sel.value;
        saveState();
        renderPlans();
      }
    });

    document.getElementById("layer-plan").addEventListener("input", (e) => {
      const ta = e.target.closest("textarea[data-refine-input]");
      if (ta) {
        ensureBox(ta.dataset.refineInput).refineDraft = ta.value;
        saveStateDebounced();
      }
      const brief = e.target.closest("[data-brief]");
      if (brief) {
        const plan = findPlan(brief.dataset.brief);
        if (plan) {
          plan.brief = brief.innerText;
          saveStateDebounced();
        }
      }
      const prompt = e.target.closest("[data-prompt]");
      if (prompt) {
        const plan = findPlan(prompt.dataset.prompt);
        if (plan) {
          plan.prompt = prompt.innerText;
          saveStateDebounced();
        }
      }
    });

    document.getElementById("gen-modal-cancel").addEventListener("click", closeGenModal);
    document.getElementById("gen-modal-ok").addEventListener("click", runGenerate);
    document.getElementById("gen-modal").addEventListener("click", (e) => {
      if (e.target.id === "gen-modal") closeGenModal();
    });
    document.getElementById("gen-modal-models").addEventListener("change", () => {
      document.querySelectorAll("#gen-modal-models label").forEach((lab) => {
        lab.classList.toggle("checked", lab.querySelector("input").checked);
      });
    });

    document.getElementById("btn-auto-fill").addEventListener("click", autoFillPreview);
    document.getElementById("btn-clear-preview").addEventListener("click", () => {
      state.preview = [null, null, null, null, null, null, null];
      Object.values(state.boxes).forEach((b) => (b.inPreview = false));
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
        if (item && state.boxes[item.boxId]) {
          state.boxes[item.boxId].inPreview = state.preview.some((p) => p && p.boxId === item.boxId);
        }
        saveState();
        renderPlans();
        renderPreview();
      }
      if (action === "preview-up" && idx > 0) {
        const t = state.preview[idx - 1];
        state.preview[idx - 1] = state.preview[idx];
        state.preview[idx] = t;
        saveState();
        renderPreview();
      }
      if (action === "preview-down" && idx < 6) {
        const t = state.preview[idx + 1];
        state.preview[idx + 1] = state.preview[idx];
        state.preview[idx] = t;
        saveState();
        renderPreview();
      }
    });
    document.getElementById("btn-reset").addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });
    document.getElementById("btn-jump-preview").addEventListener("click", () => {
      document.getElementById("layer-preview").scrollIntoView({ behavior: "smooth" });
    });
    bindPreviewDnD();

    // Update elapsed counters for any active box generation every 1s
    setInterval(() => {
      document.querySelectorAll("[data-elapsed-box]").forEach((el) => {
        const bid = el.dataset.elapsedBox;
        const rt = boxRuntime[bid];
        if (rt && rt.busy) {
          const sec = Math.max(0, Math.floor((Date.now() - rt.startedAt) / 1000));
          el.textContent = `已等待 ${sec}s`;
        }
      });
    }, 1000);
  }

  function renderProviderStatus() {
    const ps = document.getElementById("provider-status");
    if (!ps || !serverStatus) return;
    const sq = serverStatus.syncQueue;
    const syncText = sq
      ? (sq.pending > 0 ? `待同步 ${sq.pending}` : sq.syncedCount > 0 ? `已同步 ${sq.syncedCount}` : "就绪")
      : "就绪";
    ps.innerHTML =
      (serverStatus.providers || [])
        .map((p) => {
          let cls = p.configured ? "live" : "missing";
          let label = p.configured ? "已配置" : "缺 " + p.missingKey;
          if (p.id === "chatgpt" && p.configured) {
            cls = "warn";
            label = "已配置 · 额度可能不足";
          }
          const tip = p.note ? ` title="${escapeHtml(p.note)}"` : "";
          return `<span class="provider-pill ${cls}"${tip}>${escapeHtml(p.name)}：${escapeHtml(label)}</span>`;
        })
        .join("") +
      `<span class="provider-pill">落盘 → ${escapeHtml((serverStatus.macImageRoot || "").replace("/Users/lhy/Desktop/", "~/Desktop/"))}（${escapeHtml(syncText)}）</span>`;
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
      renderProviderStatus();
    } catch (_) {
      document.getElementById("provider-status").innerHTML =
        `<span class="provider-pill missing">后端未连接 · 本机请跑 python3 server/app.py；线上走 /image-board-api</span>`;
    }
  }

  async function init() {
    if (!state.preview || state.preview.length !== 7) state.preview = [null, null, null, null, null, null, null];
    if (!state.boxes) state.boxes = {};
    reconcilePreviewFlags();
    await bootServer();
    setModeUI();
    renderArchive();
    renderWhitebgUploads();
    syncWhitebgModelLabels();
    renderWhitebgResults();
    renderPlans();
    renderPreview();
    renderUploadLib();
    bindGlobal();
  }

  init();
})();
