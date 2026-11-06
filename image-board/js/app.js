/* AI 做图看板 — 演示 + 真实 VOC / 生图 */
(function () {
  const STORAGE_KEY = "ai-image-board-v2";
  const MODEL_MAP = Object.fromEntries(DEMO.models.map((m) => [m.id, m]));
  const API = window.BoardAPI;

  const state = loadState() || defaultState();
  let serverStatus = null;
  let dynamicPlans = null; // when VOC imported, replace plan boxes

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
  function saveState() {
    const toSave = { ...state };
    delete toSave.genTargetBoxId;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function humanizeError(msg, data) {
    const s = String(msg || "");
    if ((data && data.quota) || /429|insufficient_quota|额度不足|billing_hard_limit/i.test(s)) {
      return "ChatGPT 额度不足（需 API Credits，与 Pro 无关）。请改用豆包或 Banana。";
    }
    if (/未配置 API Key/i.test(s)) return s;
    return s;
  }

  function escapeHtml(s) {
    return String(s)
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
        inPreview: false,
      };
    }
    return state.boxes[boxId];
  }

  function currentPlans() {
    if (state.planBoxes && state.planBoxes.length) return state.planBoxes;
    return [...DEMO.qiushuang, ...DEMO.anran];
  }

  function findPlan(boxId) {
    return currentPlans().find((b) => b.id === boxId);
  }

  function setModeUI() {
    const real = state.mode === "real";
    const banner = document.getElementById("top-banner");
    banner.classList.toggle("banner-real", real);
    document.getElementById("banner-mode").textContent = real ? "真实 VOC / 生图预览" : "演示数据模式";
    document.getElementById("banner-detail").textContent = real
      ? "· 图写入 Mac「亚马逊产品图片」分类目录 · 豆包/Banana 生图"
      : "· 可导入真实 VOC / 上传自有图 · ChatGPT 额度不足会提示";
    document.getElementById("mode-tag").textContent = real ? "真实VOC" : "演示数据";
    document.querySelectorAll("[data-mode-tag]").forEach((el) => {
      el.textContent = real ? "真实VOC" : "演示数据";
      el.classList.toggle("tag-demo", !real);
    });
    const mac = (serverStatus && serverStatus.macImageRoot) || "/Users/lhy/Desktop/亚马逊产品图片";
    document.getElementById("save-path").textContent =
      "落盘：" + mac + "／{主图|细节图|尺寸图|场景图1-7|精改版本|预览选用|白底图…}" +
      (state.lastSavePath ? " · 最近：" + state.lastSavePath : "");
    document.getElementById("product-sub").textContent = real
      ? `亚马逊 7 图 · ASIN ${state.asin || "—"} · task ${state.taskId || "—"} · ${state.productName || ""}`
      : `亚马逊 7 图 Listing · 演示产品 ${DEMO.product.name}（${DEMO.product.asin}）`;
  }

  /* ---------- Archive ---------- */
  function activeArchive() {
    if (state.archiveOverride) return state.archiveOverride;
    if (state.source === "etsy") return DEMO.archives.etsy;
    if (state.source === "amazon") return DEMO.archives.amazon;
    return DEMO.archives.amazon;
  }

  function renderArchive() {
    const data = activeArchive();
    document.getElementById("source-label").textContent =
      (data.label || "") + (state.mode === "real" ? " · 真实导入" : " · 演示数据");
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
        <h3><span class="dot"></span>${c.title} <span class="tag ${state.mode === "real" ? "" : "tag-demo"}">${state.mode === "real" ? "真实" : "演示"}</span></h3>
        <ul>${c.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
      </article>`
        )
        .join("") +
      `<div class="archive-map" style="grid-column:1/-1">字段映射：${escapeHtml(data.note || "")}</div>`;
  }

  /* ---------- White-bg (still mock) ---------- */
  function renderWhitebgUploads() {
    document.getElementById("whitebg-uploads").innerHTML =
      DEMO.whitebgUploads
        .map(
          (u) => `
      <div class="upload-thumb"><div class="ph" style="background:${u.tone}">${u.label}</div><span class="label">演示</span></div>`
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
        return `<div class="model-col"><h4>${m.name}<span class="tag tag-demo">模拟</span></h4><div class="result-thumbs">${thumbs}</div></div>`;
      })
      .join("");
    document.getElementById("whitebg-saved").classList.toggle("show", state.whitebgSaved);
  }

  /* ---------- Plans ---------- */
  function plansByWho() {
    const all = currentPlans();
    const qs = all.filter((b) => b.who === "秋霜" || (b.id || "").startsWith("qs-"));
    const ar = all.filter((b) => !(b.who === "秋霜" || (b.id || "").startsWith("qs-")));
    // if VOC seeds didn't set who, use badge map
    if (!qs.length && !ar.length) return { qs: DEMO.qiushuang, ar: DEMO.anran };
    if (!all[0].who) {
      return {
        qs: all.filter((b) => ["主图", "细节图", "尺寸图"].includes(b.badge)),
        ar: all.filter((b) => !["主图", "细节图", "尺寸图"].includes(b.badge)),
      };
    }
    return { qs: qs.length ? qs : all.filter((b) => ["主图", "细节图", "尺寸图"].includes(b.badge)), ar: ar.length ? ar : all.filter((b) => !["主图", "细节图", "尺寸图"].includes(b.badge)) };
  }

  function renderPlanBox(plan) {
    const box = ensureBox(plan.id);
    const selected = box.results.find((r) => r.id === box.selectedResultId);
    const resultsHtml =
      box.results.length === 0
        ? `<div style="font-size:11px;color:var(--muted);margin-top:8px;">尚未生成 · 空态</div>`
        : `<div class="gen-results">${box.results
            .map((r) => {
              const m = MODEL_MAP[r.model] || { name: r.model, cls: "model-generic" };
              const sel = r.id === box.selectedResultId;
              const img = r.imageUrl
                ? `<img src="${escapeHtml(API.fileUrl(r.imageUrl))}" alt="${escapeHtml(m.name)}" />`
                : `<div class="ph-img ${m.cls}">${escapeHtml(m.name)}<br/>v${r.version}<br/><span style="font-weight:400;opacity:.85">${r.mock ? "占位" : "真实"}</span></div>`;
              return `<div class="gen-card ${sel ? "selected" : ""}" data-box="${plan.id}" data-rid="${r.id}">
                ${img}
                <div class="meta">${escapeHtml(r.label || "")}${r.macPath ? "<br/>→ Mac" : ""}</div>
                <span class="pick-mark">✓</span>
              </div>`;
            })
            .join("")}</div>`;

    const refineHtml = `
      <div class="refine-panel ${box.refineOpen ? "open" : ""}">
        <h5>精改支线 · ${selected ? (MODEL_MAP[selected.model] || {}).name || selected.model : "所选模型"}</h5>
        <div class="refine-row">
          <textarea rows="2" placeholder="改提示词 / 优化点…" data-refine-input="${plan.id}">${escapeHtml(box.refineDraft || "")}</textarea>
        </div>
        <div class="refine-row">
          <button class="btn btn-sm" data-action="rewrite-prompt" data-box="${plan.id}">改提示词</button>
          <button class="btn btn-primary btn-sm" data-action="optimize" data-box="${plan.id}" ${selected ? "" : "disabled"}>优化 → 新版本</button>
        </div>
        <div style="font-size:11px;color:var(--muted);">豆包/Chat 有 Key 时走真实对话改提示词，再触发生图；否则 mock</div>
      </div>`;

    return `
      <article class="img-box ${box.inPreview ? "picked-for-preview" : ""}" data-box-id="${plan.id}">
        <div class="img-box-head">
          <span class="slot-chip">${escapeHtml(plan.slotHint || plan.badge || "")}</span>
          <div>
            <div class="img-box-title">${escapeHtml(plan.title)}</div>
            <div class="img-box-meta">${escapeHtml(plan.role || "")}</div>
          </div>
        </div>
        <div class="label-sm">文字版策划</div>
        <div class="brief-text" contenteditable="true" data-brief="${plan.id}">${escapeHtml(plan.brief)}</div>
        <div class="label-sm">生图提示词</div>
        <div class="prompt-text" contenteditable="true" id="prompt-${plan.id}" data-prompt="${plan.id}">${escapeHtml(plan.prompt)}</div>
        <div class="box-actions">
          <button class="btn btn-primary btn-sm" data-action="generate" data-box="${plan.id}">生成图片</button>
          <button class="btn btn-sm" data-action="upload-box" data-box="${plan.id}">上传图片</button>
          <button class="btn btn-sm" data-action="toggle-refine" data-box="${plan.id}" ${box.results.length ? "" : "disabled"}>精改支线</button>
          <button class="btn btn-success btn-sm" data-action="add-preview" data-box="${plan.id}" ${selected ? "" : "disabled"}>
            ${box.inPreview ? "已在预览" : "加入预览"}
          </button>
          ${selected ? `<span style="font-size:11px;color:var(--green);">已选：${escapeHtml((MODEL_MAP[selected.model] || {}).name || selected.model)} v${selected.version}</span>` : `<span style="font-size:11px;color:var(--muted);">请勾选一张</span>`}
        </div>
        ${resultsHtml}
        ${refineHtml}
      </article>`;
  }

  function renderPlans() {
    const { qs, ar } = plansByWho();
    document.getElementById("boxes-qiushuang").innerHTML = qs.map(renderPlanBox).join("") || "<div class='empty-msg'>暂无秋霜框</div>";
    document.getElementById("boxes-anran").innerHTML = ar.map(renderPlanBox).join("") || "<div class='empty-msg'>暂无安然框</div>";
    updateGenSummary();
  }

  function updateGenSummary() {
    const plans = currentPlans();
    const chips = plans.map((p) => {
      const b = state.boxes[p.id];
      let cls = "", text = (p.title || p.id).slice(0, 18);
      if (!b || !b.results.length) text += " · 未生成";
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
            <div class="slot-src">${escapeHtml(item.boxId)}</div>
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
    state.genTargetBoxId = boxId;
    const plan = findPlan(boxId);
    document.getElementById("gen-modal-desc").textContent =
      `为「${plan.title}」勾选模型。已配置的走真实生图；未配置会提示缺 Key（可勾选下方允许占位）。`;
    // show which are live
    document.querySelectorAll("#gen-modal-models label").forEach((lab) => {
      const id = lab.querySelector("input").value;
      const st = (serverStatus && serverStatus.providers || []).find((p) => p.id === id);
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
      wrap.innerHTML = `<input type="checkbox" id="allow-mock-fallback" /> 未配置 Key 时允许占位图（并写入 Mac 目录，文件名含 DEMO）`;
      document.getElementById("gen-modal-models").after(wrap);
    }
    document.getElementById("gen-modal").classList.add("open");
  }
  function closeGenModal() {
    state.genTargetBoxId = null;
    document.getElementById("gen-modal").classList.remove("open");
  }

  async function runGenerate() {
    const boxId = state.genTargetBoxId;
    if (!boxId) return;
    const checked = [...document.querySelectorAll("#gen-modal-models input:checked")].map((i) => i.value);
    if (!checked.length) { toast("请至少勾选一个模型"); return; }
    const plan = findPlan(boxId);
    const promptEl = document.getElementById(`prompt-${boxId}`);
    const prompt = promptEl ? promptEl.innerText : plan.prompt;
    const box = ensureBox(boxId);
    const allowMock = !!(document.getElementById("allow-mock-fallback") || {}).checked;
    closeGenModal();
    toast(`正在生成 ${checked.length} 个模型…`);
    for (const mid of checked) {
      try {
        const res = await API.post("/api/generate", {
          provider: mid,
          prompt,
          boxId,
          asin: state.asin || DEMO.product.asin,
          version: 1,
          kind: inferKind(boxId),
          allowMockFallback: allowMock || state.mode === "demo",
          forceMock: state.mode === "demo" && mid !== "doubao" ? false : false,
        });
        // In demo mode still try real if configured
        const id = `${boxId}-${mid}-v1-${Date.now()}`;
        box.results.push({
          id,
          model: mid,
          version: 1,
          label: `${(MODEL_MAP[mid] || {}).name || mid} · v1 · ${res.mock ? "占位" : "真实"}`,
          imageUrl: res.imageUrl,
          macPath: res.saved && res.saved.macPath,
          mock: !!res.mock,
        });
        if (!box.selectedResultId) box.selectedResultId = id;
        if (res.saved && res.saved.category) {
          state.lastSavePath = res.saved.category + "/" + res.saved.filename;
        }
        if (res.warning) toast(res.warning);
      } catch (e) {
        const msg = humanizeError((e.data && e.data.error) || e.message, e.data);
        toast(`${mid}: ${msg}`);
        // auto placeholder on missing key if demo
        if (state.mode === "demo" || allowMock) {
          try {
            const res = await API.post("/api/generate", {
              provider: mid, prompt, boxId, asin: state.asin || DEMO.product.asin,
              version: 1, kind: inferKind(boxId), forceMock: true,
            });
            const id = `${boxId}-${mid}-v1-mock-${Date.now()}`;
            box.results.push({
              id, model: mid, version: 1,
              label: `${(MODEL_MAP[mid] || {}).name || mid} · v1 · 占位`,
              imageUrl: res.imageUrl, mock: true,
            });
            if (!box.selectedResultId) box.selectedResultId = id;
          } catch (_) {}
        }
      }
    }
    saveState();
    setModeUI();
    renderPlans();
    toast("生成完成（已请求写入 Mac 分类目录队列）");
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
    const selected = box.results.find((r) => r.id === box.selectedResultId);
    if (!selected) { toast("请先勾选一张图"); return; }
    const plan = findPlan(boxId);
    const promptEl = document.getElementById(`prompt-${boxId}`);
    const prompt = promptEl ? promptEl.innerText : plan.prompt;
    const instruction = box.refineDraft || "增强产品占比与清晰度";
    toast("精改中…");
    let newPrompt = prompt;
    try {
      const chat = await API.post("/api/refine", {
        provider: selected.model,
        prompt,
        instruction,
      });
      newPrompt = chat.newPrompt || prompt;
      if (promptEl) promptEl.innerText = newPrompt;
      plan.prompt = newPrompt;
      if (chat.mock) toast(chat.note || "精改使用 mock");
    } catch (e) {
      toast("精改对话失败，使用本地拼接");
      newPrompt = prompt + "\n\n[精改] " + instruction;
      if (promptEl) promptEl.innerText = newPrompt;
    }
    const nextVer = selected.version + 1;
    try {
      const res = await API.post("/api/generate", {
        provider: selected.model,
        prompt: newPrompt,
        boxId,
        asin: state.asin || DEMO.product.asin,
        version: nextVer,
        kind: "refine",
        allowMockFallback: true,
      });
      const id = `${boxId}-${selected.model}-v${nextVer}-${Date.now()}`;
      box.results.push({
        id,
        model: selected.model,
        version: nextVer,
        label: `${(MODEL_MAP[selected.model] || {}).name || selected.model} · v${nextVer} · ${res.mock ? "占位" : "真实"}`,
        imageUrl: res.imageUrl,
        macPath: res.saved && res.saved.macPath,
        mock: !!res.mock,
      });
      box.selectedResultId = id;
      if (res.saved) state.lastSavePath = res.saved.category + "/" + res.saved.filename;
    } catch (e) {
      toast("精改生图失败：" + humanizeError((e.data && e.data.error) || e.message, e.data));
    }
    saveState();
    setModeUI();
    renderPlans();
  }

  function addToPreview(boxId) {
    const box = ensureBox(boxId);
    const selected = box.results.find((r) => r.id === box.selectedResultId);
    if (!selected) { toast("请先勾选一张"); return; }
    const plan = findPlan(boxId);
    const entry = {
      boxId, title: plan.title, model: selected.model, version: selected.version,
      resultId: selected.id, imageUrl: selected.imageUrl,
    };
    const existing = state.preview.findIndex((p) => p && p.boxId === boxId);
    if (existing >= 0) state.preview[existing] = entry;
    else {
      const empty = state.preview.findIndex((p) => !p);
      if (empty < 0) { toast("预览已满 7 槽"); return; }
      state.preview[empty] = entry;
    }
    box.inPreview = true;
    saveState();
    renderPlans();
    renderPreview();
    toast("已加入预览");
  }

  async function autoFillPreview() {
    const preferred = currentPlans().slice(0, 7);
    for (let idx = 0; idx < 7; idx++) {
      const plan = preferred[idx];
      if (!plan) { state.preview[idx] = null; continue; }
      const box = ensureBox(plan.id);
      if (!box.results.length) {
        try {
          const res = await API.post("/api/generate", {
            provider: ["doubao", "chatgpt", "banana"][idx % 3],
            prompt: plan.prompt,
            boxId: plan.id,
            asin: state.asin || DEMO.product.asin,
            version: 1,
            kind: inferKind(plan.id),
            allowMockFallback: true,
          });
          const mid = res.provider || "doubao";
          box.results.push({
            id: `${plan.id}-autofill`,
            model: mid,
            version: 1,
            label: `自动 · v1`,
            imageUrl: res.imageUrl,
            mock: !!res.mock,
          });
          box.selectedResultId = box.results[0].id;
        } catch {
          box.results.push({ id: `${plan.id}-autofill`, model: "doubao", version: 1, label: "占位", mock: true });
          box.selectedResultId = box.results[0].id;
        }
      }
      if (!box.selectedResultId) box.selectedResultId = box.results[0].id;
      const selected = box.results.find((r) => r.id === box.selectedResultId);
      state.preview[idx] = {
        boxId: plan.id, title: plan.title, model: selected.model, version: selected.version,
        resultId: selected.id, imageUrl: selected.imageUrl,
      };
      box.inPreview = true;
    }
    saveState();
    renderPlans();
    renderPreview();
    toast("已填入预览（并尽量落盘）");
  }


  /* ---------- Own upload library ---------- */
  const KIND_TO_BOX = {
    main: "qs-main", detail: "qs-detail", size: "qs-size",
    "scene-1": "ar-scene-1", "scene-2": "ar-scene-2", "scene-3": "ar-scene-3",
    "scene-4": "ar-scene-4", "scene-5": "ar-scene-5", "scene-6": "ar-scene-6",
    "scene-7": "ar-scene-7", refine: null, preview: null,
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
          : `<div class="ph-img model-generic">上传</div>`;
        return `<div class="upload-lib-card" title="${escapeHtml(r.label || "")}">${img}<div class="meta">${escapeHtml(r.label || "upload")}</div></div>`;
      })
      .join("");
  }

  function attachUploadResult(res, boxId, kind) {
    const targetBox = boxId || KIND_TO_BOX[kind] || "qs-main";
    // ensure plan box exists for scene etc.
    const plans = currentPlans();
    if (!plans.find((p) => p.id === targetBox) && state.planBoxes) {
      // keep as-is; still store under boxes
    }
    const box = ensureBox(targetBox);
    const id = `upload-${targetBox}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const item = {
      id,
      model: "upload",
      uploaded: true,
      version: res.version || 1,
      label: `自有上传 · ${res.category || kind || targetBox}`,
      imageUrl: res.imageUrl,
      macPath: res.saved && res.saved.macPath,
      mock: false,
    };
    box.results.push(item);
    box.selectedResultId = id;
    if (res.saved && res.saved.category) {
      state.lastSavePath = res.saved.category + "/" + res.saved.filename;
    }
    return item;
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error("读文件失败"));
      fr.readAsDataURL(file);
    });
  }

  async function uploadOwnFiles(files, kind, boxId) {
    const list = [...files].filter((f) => f && f.type.startsWith("image/"));
    if (!list.length) { toast("请选择图片文件"); return; }
    const st = document.getElementById("upload-status");
    if (st) { st.className = "voc-status"; st.textContent = `上传中 0/${list.length}…`; }
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      if (st) st.textContent = `上传中 ${i + 1}/${list.length}…`;
      try {
        const dataUrl = await readFileAsDataURL(file);
        const res = await API.post("/api/upload", {
          asin: state.asin || DEMO.product.asin,
          boxId: boxId || KIND_TO_BOX[kind] || "",
          kind,
          filename: file.name,
          mime: file.type,
          dataBase64: dataUrl,
        });
        attachUploadResult(res, res.boxId || boxId, kind);
        ok++;
      } catch (e) {
        toast(humanizeError((e.data && e.data.error) || e.message, e.data));
      }
    }
    saveState();
    setModeUI();
    renderPlans();
    renderUploadLib();
    if (st) {
      st.className = ok ? "voc-status ok" : "voc-status err";
      st.textContent = ok ? `已入库 ${ok} 张 → Mac 分类目录` : "上传失败";
    }
    toast(ok ? `已上传 ${ok} 张自有图` : "没有成功上传");
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
    const q = document.getElementById("voc-query").value.trim();
    if (!q) { toast("请输入 ASIN 或 taskId"); return; }
    const st = document.getElementById("voc-import-status");
    st.className = "voc-status";
    st.textContent = "导入中…";
    try {
      const res = await API.post("/api/voc/import", { asin: q });
      state.mode = "real";
      state.source = "amazon";
      state.asin = res.asin;
      state.taskId = res.taskId;
      state.productName = res.productName;
      state.archiveOverride = res.archive;
      state.planBoxes = (res.planBoxes || []).map((b) => ({
        ...b,
        who: b.who || (["主图", "细节图", "尺寸图"].includes(b.badge) ? "秋霜" : "安然"),
      }));
      state.boxes = {};
      state.preview = [null, null, null, null, null, null, null];
      if (res.saved) state.lastSavePath = res.saved.category + "/" + res.saved.filename;
      saveState();
      st.className = "voc-status ok";
      st.textContent = `已导入 ${res.asin || res.taskId} · ${res.resolvedSource} · ${res.planBoxes.length} 个规划框`;
      setModeUI();
      renderArchive();
      renderPlans();
      renderPreview();
      toast("VOC 档案已替换演示数据");
    } catch (e) {
      st.className = "voc-status err";
      st.textContent = (e.data && e.data.error) || e.message;
      toast("导入失败");
    }
  }

  function backToDemo() {
    Object.assign(state, defaultState());
    saveState();
    setModeUI();
    renderArchive();
    renderWhitebgUploads();
    syncWhitebgModelLabels();
    renderWhitebgResults();
    renderPlans();
    renderPreview();
    toast("已切回演示数据");
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
      state.source = btn.dataset.source;
      if (state.source === "demo") {
        state.mode = "demo";
        state.archiveOverride = null;
        state.planBoxes = null;
      }
      saveState();
      setModeUI();
      renderArchive();
    });
    document.getElementById("btn-voc-import").addEventListener("click", importVoc);
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
      if (!state.whitebgSelectedModels.length) { toast("请勾选模型"); return; }
      state.whitebgGenerated = true;
      state.whitebgSelectedModels.forEach((mid) => { state.whitebgPicks[mid] = DEMO.whitebgUploads[0].id; });
      state.whitebgSaved = true;
      saveState();
      renderWhitebgResults();
      toast("白底修图仍为模拟（Phase B：生图打通后再接）");
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
        ensureBox(card.dataset.box).selectedResultId = card.dataset.rid;
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
        if (!box.refineDraft) toast("请先填写修改说明");
        else toast("已记录，点「优化」生成新版本");
        saveState();
      }
      if (action === "add-preview") addToPreview(boxId);
    });
    document.getElementById("layer-plan").addEventListener("input", (e) => {
      const ta = e.target.closest("textarea[data-refine-input]");
      if (ta) { ensureBox(ta.dataset.refineInput).refineDraft = ta.value; saveState(); }
      const brief = e.target.closest("[data-brief]");
      if (brief) {
        const plan = findPlan(brief.dataset.brief);
        if (plan) plan.brief = brief.innerText;
      }
      const prompt = e.target.closest("[data-prompt]");
      if (prompt) {
        const plan = findPlan(prompt.dataset.prompt);
        if (plan) plan.prompt = prompt.innerText;
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
    });
    document.getElementById("preview-slots").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const idx = Number(btn.dataset.slot);
      const action = btn.dataset.action;
      if (action === "preview-remove") {
        const item = state.preview[idx];
        if (item && state.boxes[item.boxId]) state.boxes[item.boxId].inPreview = false;
        state.preview[idx] = null;
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
  }

  async function bootServer() {
    try {
      serverStatus = await API.get("/api/status");
      const list = await API.get("/api/voc/list");
      const dl = document.getElementById("voc-fixtures");
      (list.fixtures || []).forEach((t) => {
        const o = document.createElement("option");
        o.value = t.asin || t.taskId;
        o.label = `${t.asin || ""} ${t.product || t.taskId || ""}`;
        dl.appendChild(o);
      });
      const ps = document.getElementById("provider-status");
      ps.innerHTML = (serverStatus.providers || [])
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
        `<span class="provider-pill">落盘 → ${escapeHtml((serverStatus.macImageRoot || "").replace("/Users/lhy/Desktop/", "~/Desktop/"))}</span>`;
    } catch (e) {
      document.getElementById("provider-status").innerHTML =
        `<span class="provider-pill missing">后端未连接 · 本机请跑 python3 server/app.py；线上走 /image-board-api</span>`;
    }
  }

  async function init() {
    if (!state.preview || state.preview.length !== 7) state.preview = [null, null, null, null, null, null, null];
    if (!state.boxes) state.boxes = {};
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
