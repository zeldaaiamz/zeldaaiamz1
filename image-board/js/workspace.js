/* Automatic report archiving + 「给新产品做图」. No history browsing UI. */
window.BoardWorkspace = (function () {
  const HISTORY_KEY = "ai-image-board-history-v1";

  function loadLocal() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  // Keep the legacy key and every existing record; removing the UI is not a purge.
  function saveLocal(items) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items || []));
      return true;
    } catch (_) { return false; }
  }

  function upsertLocal(report) {
    if (!report || !report.id) return false;
    const items = loadLocal().filter((x) => x && x.id !== report.id);
    items.unshift(report);
    return saveLocal(items);
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
      workflowSnapshot: window.BoardWorkflow ? window.BoardWorkflow.snapshot(state) : (state.workflowSnapshot || null),
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
    let remoteSaved = false;
    try {
      if (API && typeof API.post === "function") {
        const res = await API.post("/api/history/save", payload, { timeoutMs: 20000 });
        if (res && res.ok && res.report && res.report.id) {
          report = res.report;
          remoteSaved = true;
        }
        if (res && res.summary) summary = res.summary;
      }
    } catch (_) {}
    if (!remoteSaved) {
      // offline / no server — keep local
      if (!report.id) {
        report.id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      }
      if (!report.createdAt) report.createdAt = new Date().toISOString();
      if (!report.savedAt) report.savedAt = report.createdAt;
      report.counts = {
        whitebg: (report.whitebg || []).length,
        finals: (report.finals || []).length,
        generated: (report.generated || []).length,
        themes: (report.sevenImagePlan || []).length,
      };
      report.macLayout = `~/Desktop/亚马逊产品图片/${report.productDir || report.productName || "未命名产品"}/{白底图|最终版本|报告}`;
    }
    const localSaved = upsertLocal(report);
    if (!remoteSaved && !localSaved) {
      throw new Error("分析报告留稿失败：后端未确认且本机存储写入失败，已保留当前工作台（未清空）。");
    }
    return { report, summary };
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
      workflowSnapshot: null,
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
      productSessionId: "prod-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
      planOwnerSig: "",
      planBoxes: [],
      sevenImagePlan: [],
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
    } = ctx;

    let busyNew = false;
    const btnNew = document.getElementById("btn-new-product");
    const btnSaveReport = document.getElementById("btn-save-report");

    async function saveCurrent(opts) {
      if (!hasMeaningfulWork(state, DEMO)) {
        if (!(opts && opts.silent)) toast("当前工作台几乎是空的，无需留存报告");
        return null;
      }
      const res = await persistReport(API, state, opts || {});
      if (!(opts && opts.silent)) {
        const name = (res.report && (res.report.productName || res.report.productDir)) || "产品";
        toast(`分析报告已留稿（${name}）`);
      }
      return res;
    }

    function applyEmptyWorkspace() {
      if (typeof ctx.abortAllInFlight === "function") {
        ctx.abortAllInFlight();
      } else if (WB && typeof WB.abortInFlight === "function") {
        WB.abortInFlight();
      }
      const next = emptyWorkspaceState(DEMO);
      Object.keys(state).forEach((k) => {
        delete state[k];
      });
      Object.assign(state, next);
      try {
        localStorage.removeItem("ai-image-board-v2");
      } catch (_) {}
      saveState();

      // Clear all input fields & stale status messages in DOM
      const vq = document.getElementById("voc-query");
      if (vq) vq.value = "";
      const pni = document.getElementById("product-name-input");
      if (pni) pni.value = "";
      const ta = document.getElementById("product-data-text");
      if (ta) ta.value = "";
      const wbInst = document.getElementById("whitebg-instruction");
      if (wbInst) wbInst.value = "";
      ["product-data-status", "preview-sync-status", "whitebg-src-status", "upload-status"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = "";
      });
      const pd = document.getElementById("product-data-panel");
      if (pd) pd.removeAttribute("hidden");

      setModeUI();
      renderArchive();
      if (WB) {
        WB.renderBoardPicker();
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
        st.textContent = "已彻底清空旧产品内容 · 请填入新产品名称 / ASIN 或粘贴新产品数据";
      }
    }

    function countPreviewImages() {
      return (state.preview || []).filter((p) => p && p.imageUrl).length;
    }

    function resolveProductFolderHint() {
      const pni = document.getElementById("product-name-input");
      const typedName = ((pni && pni.value) || "").trim();
      const demoName = (DEMO && DEMO.product && DEMO.product.name) || "";
      const demoAsin = (DEMO && DEMO.product && DEMO.product.asin) || "";
      const name = typedName || ((state.productName || "").trim());
      const dir = (state.productDir || "").trim();
      const asin = (state.asin || "").trim();
      if (state.mode !== "demo") {
        const cleanName = name === demoName ? "" : name;
        const cleanDir = dir === demoName ? "" : dir;
        const cleanAsin = asin === demoAsin ? "" : asin;
        return cleanName || cleanDir || cleanAsin || "";
      }
      return name || dir || asin || "";
    }

    async function startNewProduct() {
      if (busyNew) return;
      busyNew = true;
      try {
        const previewN = countPreviewImages();
        const folderHint = resolveProductFolderHint();
        const meaningful = hasMeaningfulWork(state, DEMO);

        if (meaningful) {
          const ok = window.confirm(
            previewN > 0
              ? `开始新产品前：\n1) 自动把预览框 ${previewN} 张图写入桌面「亚马逊产品图片/${folderHint || "{产品名}"}/{最终版本|白底图}/」\n2) 分析流程自动留稿\n3) 清空工作台\n确定？`
              : "开始新产品前，将把当前产品的分析流程自动留稿，并清空工作台。当前预览框无图，不会写入桌面定稿。确定？"
          );
          if (!ok) return;

          // 有预览图时必须先落到桌面产品文件夹，失败则不清空，避免静默丢图
          if (previewN > 0) {
            if (!folderHint) {
              toast("预览框有图，但缺少产品名/ASIN，无法写入桌面文件夹。请先导入 ASIN 或填写产品名后再点「给新产品做图」。", { duration: 6500 });
              return;
            }
            if (!WB || typeof WB.syncPreviewToFinal !== "function") {
              toast("无法同步预览图到桌面（白底/定稿模块未就绪）。已取消清空，请刷新后重试。", { duration: 5500 });
              return;
            }
            const syncRes = await WB.syncPreviewToFinal({
              silent: true,
              skipArchive: true,
              reason: "new-product",
            });
            if (!syncRes || !syncRes.ok) {
              if (syncRes && syncRes.empty) {
                toast("预览图未能识别为可落盘图片，已取消清空。请确认预览槽有真实图片后再试。", { duration: 5500 });
              } else {
                toast("预览图写入桌面失败，已取消清空工作台。请修好网络/后端后再点「给新产品做图」。", { duration: 6500 });
              }
              return;
            }
            const parts = [];
            if (syncRes.finalCount) parts.push(`最终版本 ${syncRes.finalCount}`);
            if (syncRes.whitebgCount) parts.push(`白底图 ${syncRes.whitebgCount}`);
            toast(
              `已自动留稿到桌面「${syncRes.productDir || folderHint}/{${parts.join(" · ") || "最终版本"}}」共 ${syncRes.count} 张`,
              { duration: 4800 }
            );
          } else {
            toast("当前预览框无图，跳过桌面定稿留稿；仅保存分析报告留稿。", { duration: 4200 });
          }

          await saveCurrent({
            status: "archived-on-new-product",
            note: previewN > 0
              ? `给新产品做图前自动留存（已同步预览 ${previewN} 张至桌面产品文件夹）`
              : "给新产品做图前自动留存（预览无图，未写桌面定稿）",
            silent: true,
          });
        } else if (previewN > 0 && !folderHint) {
          toast("预览框有图，但缺少产品名/ASIN，无法写入桌面。请先导入 ASIN 或填写产品名。", { duration: 5500 });
          return;
        }

        applyEmptyWorkspace();
        toast(previewN > 0
          ? "已开始新产品 · 预览图已留到桌面产品文件夹 · 分析流程已留稿"
          : "已开始新产品 · 分析流程已留稿");
      } catch (error) {
        toast(error.message || "分析报告留稿失败，工作台未清空。", { duration: 6500 });
      } finally {
        busyNew = false;
      }
    }

    if (btnNew) btnNew.addEventListener("click", startNewProduct);
    if (btnSaveReport) btnSaveReport.addEventListener("click", async () => {
      try {
        await saveCurrent({ status: "manual-save", note: "手动保存分析报告" });
      } catch (error) {
        toast(error.message || "分析报告留稿失败，当前工作台仍保留。", { duration: 6500 });
      }
    });

    return {
      saveCurrent,
      startNewProduct,
      hasMeaningfulWork: () => hasMeaningfulWork(state, DEMO),
      HISTORY_KEY,
    };
  }

  return { create, hasMeaningfulWork, buildReportFromState, persistReport, emptyWorkspaceState, HISTORY_KEY };
})();
