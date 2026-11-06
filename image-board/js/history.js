/* Product analysis history + 「给新产品做图」 workspace clear */
window.BoardHistory = (function () {
  const HISTORY_KEY = "ai-image-board-history-v1";
  const MAX_LOCAL = 80;

  function loadLocal() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveLocal(items) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify((items || []).slice(0, MAX_LOCAL)));
    } catch (_) {}
  }

  function upsertLocal(report) {
    if (!report || !report.id) return;
    const items = loadLocal().filter((x) => x && x.id !== report.id);
    items.unshift(report);
    saveLocal(items);
  }

  function hasMeaningfulWork(state, DEMO) {
    if (!state) return false;
    const asin = (state.asin || "").trim();
    const demoAsin = DEMO && DEMO.product ? DEMO.product.asin : "";
    const named = !!(state.productName || "").trim() && state.productName !== (DEMO && DEMO.product && DEMO.product.name);
    const hasWb = Array.isArray(state.whitebgResults) && state.whitebgResults.length > 0;
    const hasPreview = Array.isArray(state.preview) && state.preview.some((p) => p && p.imageUrl);
    const hasGen = Object.values(state.boxes || {}).some((b) => (b.results || []).some((r) => r && r.imageUrl && !r.mock));
    const hasArchive = !!(state.archiveOverride);
    const hasSummary = !!(state.productSummary || "").trim();
    const hasSeven = Array.isArray(state.sevenImagePlan) && state.sevenImagePlan.length > 0;
    if (hasWb || hasPreview || hasGen || hasArchive || hasSummary || hasSeven) return true;
    if (asin && asin !== demoAsin) return true;
    if (named) return true;
    return false;
  }

  function collectGenerated(state) {
    const out = [];
    Object.entries(state.boxes || {}).forEach(([boxId, box]) => {
      (box.results || []).forEach((r) => {
        if (!r || !r.imageUrl) return;
        out.push({
          id: r.id,
          label: r.label || "",
          imageUrl: r.imageUrl,
          boxId,
          model: r.model,
          version: r.version,
          productDir: r.productDir || state.productDir,
          stageDir: r.stageDir || "",
        });
      });
    });
    return out;
  }

  function buildReportFromState(state, opts) {
    const o = opts || {};
    const archive = state.archiveOverride || {};
    const finals = (state.preview || [])
      .map((it, idx) =>
        it && it.imageUrl
          ? {
              id: it.id || `preview-${idx + 1}`,
              label: `定稿 #${idx + 1}`,
              imageUrl: it.imageUrl,
              boxId: it.boxId,
              model: it.model,
              version: it.version,
              slot: idx + 1,
              stageDir: "最终版本",
              productDir: state.productDir,
            }
          : null
      )
      .filter(Boolean);
    const whitebg = (state.whitebgResults || []).map((r) => ({
      id: r.id,
      label: r.label || r.filename || "",
      imageUrl: r.imageUrl,
      model: r.model,
      version: r.version,
      stageDir: "白底图",
      productDir: r.productDir || state.productDir,
    }));
    return {
      id: o.id || undefined,
      status: o.status || "saved",
      note: o.note || "",
      asin: state.asin || "",
      productName: state.productName || state.productDir || "",
      productDir: state.productDir || "",
      taskId: state.taskId || null,
      productSummary: state.productSummary || "",
      sevenPlanStatus: state.sevenPlanStatus,
      sevenPlanStatusLabel: state.sevenPlanStatusLabel,
      sevenPlanAuthor: state.sevenPlanAuthor,
      sevenImagePlan: state.sevenImagePlan || [],
      archive: {
        itch: archive.itch || [],
        pain: archive.pain || [],
        delight: archive.delight || [],
        reason: archive.reason || [],
      },
      whitebg,
      finals,
      generated: collectGenerated(state),
      createdAt: o.createdAt,
    };
  }

  async function persistReport(API, state, opts) {
    const payload = buildReportFromState(state, opts);
    let report = payload;
    let summary = null;
    try {
      if (API && typeof API.post === "function") {
        const res = await API.post("/api/history/save", payload, { timeoutMs: 20000 });
        if (res && res.report) report = res.report;
        if (res && res.summary) summary = res.summary;
      }
    } catch (_) {
      // offline / no server — keep local
      if (!report.id) {
        report.id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      }
      if (!report.createdAt) report.createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, "+08:00");
      if (!report.savedAt) report.savedAt = report.createdAt;
      report.counts = {
        whitebg: (report.whitebg || []).length,
        finals: (report.finals || []).length,
        generated: (report.generated || []).length,
        themes: (report.sevenImagePlan || []).length,
      };
      report.macLayout = `~/Desktop/亚马逊产品图片/${report.productDir || report.productName || "未命名产品"}/{白底图|最终版本|报告}`;
    }
    upsertLocal(report);
    return { report, summary };
  }

  async function listReports(API) {
    const local = loadLocal();
    let remote = [];
    try {
      if (API && typeof API.get === "function") {
        const res = await API.get("/api/history/list?limit=50", { timeoutMs: 12000 });
        if (res && Array.isArray(res.items)) remote = res.items;
      }
    } catch (_) {}
    const byId = new Map();
    remote.forEach((it) => {
      if (it && it.id) byId.set(it.id, { ...it, _source: "server" });
    });
    local.forEach((it) => {
      if (!it || !it.id) return;
      if (!byId.has(it.id)) byId.set(it.id, { ...it, _source: "local" });
      else {
        // prefer richer local body if remote is summary-only
        const cur = byId.get(it.id);
        byId.set(it.id, { ...cur, ...it, _source: cur._source || "local" });
      }
    });
    return Array.from(byId.values()).sort((a, b) =>
      String(b.savedAt || b.createdAt || "").localeCompare(String(a.savedAt || a.createdAt || ""))
    );
  }

  async function getReport(API, id) {
    const local = loadLocal().find((x) => x && x.id === id);
    try {
      if (API && typeof API.get === "function") {
        const res = await API.get(`/api/history/${encodeURIComponent(id)}`, { timeoutMs: 12000 });
        if (res && res.report) {
          upsertLocal(res.report);
          return res.report;
        }
      }
    } catch (_) {}
    return local || null;
  }

  function emptyWorkspaceState(DEMO) {
    return {
      mode: "real",
      source: "amazon",
      asin: "",
      productName: "",
      productDir: "",
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
      sevenThemeChat: {},
      sevenThemeBusy: {},
    };
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(iso) {
    if (!iso) return "—";
    const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (m) return `${m[1]} ${m[2]}（上海）`;
    return String(iso);
  }

  function renderList(items, host) {
    if (!host) return;
    if (!items.length) {
      host.innerHTML = `<div class="history-empty">暂无历史报告。完成定稿同步或点「给新产品做图」前会自动留存分析流程。</div>`;
      return;
    }
    host.innerHTML = items
      .map((it) => {
        const counts = it.counts || {};
        const title = escapeHtml(it.title || `${it.productName || it.productDir || "未命名"} · ${it.asin || "无ASIN"}`);
        return `<button type="button" class="history-item" data-history-id="${escapeHtml(it.id)}">
          <div class="history-item-title">${title}</div>
          <div class="history-item-meta">${escapeHtml(formatTime(it.savedAt || it.createdAt))} · 白底 ${counts.whitebg || 0} · 定稿 ${counts.finals || 0} · 过程图 ${counts.generated || 0}</div>
        </button>`;
      })
      .join("");
  }

  function renderDetail(report, host) {
    if (!host) return;
    if (!report) {
      host.innerHTML = `<div class="history-empty">请选择左侧一条历史报告。</div>`;
      return;
    }
    const arch = report.archiveSummary || report.archive || {};
    const themes = report.themes || (report.sevenImagePlan || []).map((r, i) => ({
      index: r.index || i + 1,
      theme: r.theme || r.title || "",
      owner: r.owner || r.who || "",
      badge: r.badge || "",
    }));
    const imgs = []
      .concat(report.finals || [])
      .concat(report.whitebg || [])
      .concat((report.generated || []).slice(0, 12));
    host.innerHTML = `
      <div class="history-detail-head">
        <h3>${escapeHtml(report.productName || report.productDir || "未命名产品")}</h3>
        <div class="history-item-meta">ASIN ${escapeHtml(report.asin || "—")} · ${escapeHtml(formatTime(report.savedAt || report.createdAt))}</div>
        <div class="history-item-meta">落盘：${escapeHtml(report.macLayout || `~/Desktop/亚马逊产品图片/${report.productDir || "产品名"}/{白底图|最终版本|报告}`)}</div>
        ${report.sevenPlanStatusLabel ? `<div class="history-pill">${escapeHtml(report.sevenPlanStatusLabel)}</div>` : ""}
        ${report.note ? `<p class="history-note">${escapeHtml(report.note)}</p>` : ""}
      </div>
      <div class="history-section"><h4>VOC 摘要</h4>
        <ul>
          <li>在意点：${escapeHtml((arch.itch || []).slice(0, 6).join("；") || "—")}</li>
          <li>痛点：${escapeHtml((arch.pain || []).slice(0, 6).join("；") || "—")}</li>
          <li>delight：${escapeHtml((arch.delight || []).slice(0, 4).join("；") || "—")}</li>
        </ul>
      </div>
      <div class="history-section"><h4>七图主题</h4>
        <ol class="history-themes">${themes
          .map((t) => `<li><strong>图${escapeHtml(t.index)}</strong> ${escapeHtml(t.theme || "（无主题）")} <span class="muted">${escapeHtml(t.owner || "")}</span></li>`)
          .join("")}</ol>
      </div>
      ${report.productSummary ? `<div class="history-section"><h4>产品数据</h4><pre class="history-pre">${escapeHtml(report.productSummary.slice(0, 1200))}</pre></div>` : ""}
      <div class="history-section"><h4>关键图引用</h4>
        <div class="history-thumbs">${imgs.length ? imgs
          .map((im) =>
            im.imageUrl
              ? `<figure><img src="${escapeHtml(im.imageUrl)}" alt="" data-lightbox-src="${escapeHtml(im.imageUrl)}" data-lightbox-title="${escapeHtml(im.label || "")}" /><figcaption>${escapeHtml(im.label || im.stageDir || "")}</figcaption></figure>`
              : ""
          )
          .join("") : "<div class='history-empty'>本报告无图引用（可能中途放弃）</div>"}</div>
      </div>`;
  }

  function create(ctx) {
    const {
      state,
      API,
      DEMO,
      toast,
      saveState,
      setModeUI,
      renderArchive,
      renderPlans,
      renderPreview,
      renderUploadLib,
      WB,
      escapeHtml: esc,
    } = ctx;

    let busyNew = false;
    let panelOpen = false;

    const panel = document.getElementById("history-panel");
    const listHost = document.getElementById("history-list");
    const detailHost = document.getElementById("history-detail");
    const btnHistory = document.getElementById("btn-history");
    const btnClose = document.getElementById("btn-history-close");
    const btnNew = document.getElementById("btn-new-product");
    const btnSaveReport = document.getElementById("btn-save-history");

    async function refreshList(selectId) {
      const items = await listReports(API);
      renderList(items, listHost);
      if (selectId) {
        const full = await getReport(API, selectId);
        renderDetail(full, detailHost);
      } else if (items[0]) {
        const full = await getReport(API, items[0].id);
        renderDetail(full, detailHost);
      } else {
        renderDetail(null, detailHost);
      }
    }

    async function openPanel() {
      panelOpen = true;
      if (panel) {
        panel.removeAttribute("hidden");
        panel.setAttribute("aria-hidden", "false");
      }
      await refreshList();
    }

    function closePanel() {
      panelOpen = false;
      if (panel) {
        panel.setAttribute("hidden", "");
        panel.setAttribute("aria-hidden", "true");
      }
    }

    async function saveCurrent(opts) {
      if (!hasMeaningfulWork(state, DEMO)) {
        if (!(opts && opts.silent)) toast("当前工作台几乎是空的，无需留存报告");
        return null;
      }
      const res = await persistReport(API, state, opts || {});
      if (!(opts && opts.silent)) {
        const name = (res.report && (res.report.productName || res.report.productDir)) || "产品";
        toast(`已保存分析报告到历史记录（${name}）`);
      }
      return res;
    }

    function applyEmptyWorkspace() {
      const next = emptyWorkspaceState(DEMO);
      Object.keys(state).forEach((k) => {
        delete state[k];
      });
      Object.assign(state, next);
      saveState();
      setModeUI();
      renderArchive();
      if (WB) {
        WB.renderUploads();
        WB.syncModelLabels();
        WB.renderResults();
      }
      renderPlans();
      renderPreview();
      if (renderUploadLib) renderUploadLib();
      const st = document.getElementById("voc-import-status");
      if (st) {
        st.className = "voc-status ok";
        st.textContent = "已清空工作台，可导入新产品 ASIN / 粘贴产品数据";
      }
      const pd = document.getElementById("product-data-panel");
      if (pd) pd.setAttribute("hidden", "");
      const ta = document.getElementById("product-data-text");
      if (ta) ta.value = "";
      const pss = document.getElementById("product-data-status");
      if (pss) pss.textContent = "";
      const previewSt = document.getElementById("preview-sync-status");
      if (previewSt) previewSt.textContent = "";
    }

    async function startNewProduct() {
      if (busyNew) return;
      busyNew = true;
      try {
        if (hasMeaningfulWork(state, DEMO)) {
          const ok = window.confirm(
            "开始新产品前，将把当前产品的分析流程写入「历史记录」，并清空工作台（白底图/最终版本仍留在产品名文件夹）。确定？"
          );
          if (!ok) return;
          await saveCurrent({ status: "archived-on-new-product", note: "给新产品做图前自动留存", silent: true });
        }
        applyEmptyWorkspace();
        toast("已开始新产品 · 历史记录可回看之前生成");
        closePanel();
      } finally {
        busyNew = false;
      }
    }

    if (btnHistory) btnHistory.addEventListener("click", () => (panelOpen ? closePanel() : openPanel()));
    if (btnClose) btnClose.addEventListener("click", closePanel);
    if (btnNew) btnNew.addEventListener("click", startNewProduct);
    if (btnSaveReport) {
      btnSaveReport.addEventListener("click", async () => {
        const res = await saveCurrent({ status: "manual-save", note: "手动保存分析报告" });
        if (res && panelOpen) await refreshList(res.report.id);
      });
    }
    if (listHost) {
      listHost.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-history-id]");
        if (!btn) return;
        const full = await getReport(API, btn.getAttribute("data-history-id"));
        renderDetail(full, detailHost);
      });
    }
    if (panel) {
      panel.addEventListener("click", (e) => {
        if (e.target === panel) closePanel();
      });
    }

    return {
      saveCurrent,
      startNewProduct,
      openPanel,
      closePanel,
      hasMeaningfulWork: () => hasMeaningfulWork(state, DEMO),
      HISTORY_KEY,
    };
  }

  return { create, hasMeaningfulWork, buildReportFromState, persistReport, emptyWorkspaceState, HISTORY_KEY };
})();
