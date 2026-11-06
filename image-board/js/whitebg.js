/* Real White-Background Retouch (Doubao-only, batch all selected sources, single/multi-select attach, backend delete) */
window.BoardWhitebg = {
  create(ctx) {
    const {
      state,
      API,
      DEMO,
      GEN_PROVIDERS,
      toast,
      humanizeError,
      escapeHtml,
      modelDisplayName,
      saveState,
      saveStateDebounced,
      setModeUI,
      renderPlans,
      renderPreview,
      ensureBox,
      currentPlans,
      findPlan,
      reconcilePreviewFlags,
      refreshStatusQuiet,
      displayProductFolder,
      readFileAsDataURL,
      onFinalArchived,
      effectiveAsin,
    } = ctx;
    const getAsin = typeof effectiveAsin === "function" ? effectiveAsin : () => (state.mode === "demo" ? DEMO.product.asin : (state.asin || "").trim());

    let boardPickerOpen = false;
    let previewSyncing = false;
    const runtime = {
      busy: false,
      text: "",
      startedAt: 0,
      controller: null,
      lastError: null,
    };

    function ensureSelectionArrays() {
      if (!Array.isArray(state.whitebgSources)) state.whitebgSources = [];
      if (!Array.isArray(state.whitebgSelectedSourceIds)) state.whitebgSelectedSourceIds = [];
      const validSrcIds = new Set(state.whitebgSources.map((u) => u.id));
      state.whitebgSelectedSourceIds = state.whitebgSelectedSourceIds.filter((id) => validSrcIds.has(id));

      if (!Array.isArray(state.whitebgResults)) state.whitebgResults = [];
      if (!Array.isArray(state.selectedWhitebgIds)) state.selectedWhitebgIds = [];
      const validWbIds = new Set(state.whitebgResults.map((r) => r.id));
      state.selectedWhitebgIds = state.selectedWhitebgIds.filter((id) => validWbIds.has(id));

      if (state.selectedWhitebgIds.length) {
        if (!state.activeWhitebgId || !state.selectedWhitebgIds.includes(state.activeWhitebgId)) {
          state.activeWhitebgId = state.selectedWhitebgIds[0];
        }
      } else if (state.whitebgResults.length) {
        if (!state.activeWhitebgId || !validWbIds.has(state.activeWhitebgId)) {
          state.activeWhitebgId = state.whitebgResults[state.whitebgResults.length - 1].id;
        }
      } else {
        state.activeWhitebgId = null;
      }
    }

    function getSelectedSources() {
      ensureSelectionArrays();
      const set = new Set(state.whitebgSelectedSourceIds);
      return state.whitebgSources.filter((u) => set.has(u.id));
    }

    function getSelectedSource() {
      const list = getSelectedSources();
      return list[0] || state.whitebgSources[state.whitebgSources.length - 1] || null;
    }

    function getSelectedRefs() {
      ensureSelectionArrays();
      const byId = new Map(state.whitebgResults.map((r) => [r.id, r]));
      return state.selectedWhitebgIds.map((id) => byId.get(id)).filter(Boolean);
    }

    function getActiveRef() {
      ensureSelectionArrays();
      if (!state.whitebgResults.length) return null;
      const selected = getSelectedRefs();
      if (selected.length) {
        return selected.find((r) => r.id === state.activeWhitebgId) || selected[0];
      }
      return (
        state.whitebgResults.find((r) => r.id === state.activeWhitebgId) ||
        state.whitebgResults[state.whitebgResults.length - 1]
      );
    }

    function focusSection(msg) {
      if (msg) toast(msg, { duration: 5000 });
      const sec = document.getElementById("whitebg-section");
      if (sec) {
        sec.scrollIntoView({ behavior: "smooth", block: "center" });
        sec.classList.remove("flash-highlight");
        void sec.offsetWidth;
        sec.classList.add("flash-highlight");
      }
    }

    function collectBoardImages() {
      const out = [];
      const seen = new Set();
      Object.entries(state.boxes || {}).forEach(([bid, b]) => {
        (b.results || []).forEach((r) => {
          if (r && r.imageUrl && !r.mock && !seen.has(r.imageUrl)) {
            seen.add(r.imageUrl);
            out.push({
              boxId: bid,
              label: r.label || `${bid} v${r.version || 1}`,
              imageUrl: r.imageUrl,
            });
          }
        });
      });
      return out;
    }

    function renderBoardPicker() {
      const wrap = document.getElementById("whitebg-board-picker");
      if (!wrap) return;
      if (!boardPickerOpen) {
        wrap.style.display = "none";
        return;
      }
      wrap.style.display = "block";
      const candidates = collectBoardImages();
      if (!candidates.length) {
        wrap.innerHTML = `<div style="font-size:12px;color:var(--muted);">看板规划框中暂无已上传图片。请点左侧「+ 上传待修原图」选择本地产品图。</div>`;
        return;
      }
      wrap.innerHTML =
        `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--ink-soft);">
          <span>点图片放大 · 点名称加入待修原图（默认自动勾选）：</span>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-close-board-picker">收起</button>
        </div>
        <div class="picker-list">` +
        candidates
          .map((c, i) => {
            const full = API.fileUrl(c.imageUrl);
            return `<div class="picker-item" data-pick-board-idx="${i}" title="${escapeHtml(c.label)} · 点图放大 · 点名称加入待修">
              <div class="picker-thumb-wrap">
                <img src="${escapeHtml(full)}" alt="${escapeHtml(c.label)}" data-lightbox-src="${escapeHtml(full)}" data-lightbox-title="${escapeHtml(c.label)}" />
              </div>
              <div class="p-meta">${escapeHtml(c.label)}</div>
            </div>`;
          })
          .join("") +
        `</div>`;
    }

    function renderUploads() {
      ensureSelectionArrays();
      const root = document.getElementById("whitebg-uploads");
      if (!root) return;
      const instEl = document.getElementById("whitebg-instruction");
      if (instEl && document.activeElement !== instEl) {
        instEl.value = state.whitebgInstruction || "";
      }

      const selAllBtn = document.getElementById("btn-whitebg-select-all-src");
      const clrSrcBtn = document.getElementById("btn-whitebg-clear-src");
      const hasSources = state.whitebgSources.length > 0;
      const selCount = state.whitebgSelectedSourceIds.length;
      if (selAllBtn) {
        selAllBtn.style.display = hasSources ? "inline-flex" : "none";
        selAllBtn.disabled = runtime.busy || selCount === state.whitebgSources.length;
      }
      if (clrSrcBtn) {
        clrSrcBtn.style.display = hasSources ? "inline-flex" : "none";
        clrSrcBtn.disabled = runtime.busy || selCount === 0;
      }

      const fixBtn = document.getElementById("btn-fix-whitebg");
      if (fixBtn) {
        fixBtn.disabled = runtime.busy;
        if (runtime.busy) {
          fixBtn.innerHTML = `<span class="spinner"></span> 白底真修中…`;
        } else if (selCount > 0) {
          fixBtn.textContent = `开始白底真修（已选 ${selCount} 张原图）`;
        } else {
          fixBtn.textContent = "开始白底真修";
        }
      }

      if (!hasSources) {
        root.innerHTML = `<div class="empty-msg" style="width:100%;padding:16px 12px;border:1px dashed var(--line);border-radius:10px;background:#fff;">
          尚未添加待修原图 · 请点上方 <strong>「+ 上传待修原图」</strong> 选择产品实拍图/样品图（支持多选上传，默认全部勾选，一键批量修成纯白底）
        </div>`;
        return;
      }

      const selSet = new Set(state.whitebgSelectedSourceIds);
      root.innerHTML = state.whitebgSources
        .map((u, idx) => {
          const sel = selSet.has(u.id);
          const fullUrl = API.fileUrl(u.imageUrl);
          return `<div class="src-card ${sel ? "selected" : ""}" data-src-id="${escapeHtml(u.id)}" title="${escapeHtml(u.label)}">
            <button type="button" class="src-check" data-toggle-src="${escapeHtml(u.id)}" title="勾选/取消待修">${sel ? "✓ 待修" : `原图${idx + 1}`}</button>
            <button type="button" class="src-remove" data-remove-src="${escapeHtml(u.id)}" title="移除此原图">×</button>
            <img src="${escapeHtml(fullUrl)}" alt="${escapeHtml(u.label)}" data-lightbox-src="${escapeHtml(fullUrl)}" data-lightbox-title="待修原图 · ${escapeHtml(u.label)}" />
            <div class="src-meta" data-toggle-src="${escapeHtml(u.id)}">${escapeHtml(u.label)}</div>
          </div>`;
        })
        .join("");
    }

    function syncModelLabels() {
      state.whitebgSelectedModels = ["doubao"];
    }

    function renderRuntime() {
      const slot = document.getElementById("whitebg-runtime-slot");
      if (!slot) return;
      if (runtime.busy) {
        const sec = Math.max(0, Math.floor((Date.now() - runtime.startedAt) / 1000));
        slot.innerHTML = `<div class="gen-loading-bar" style="margin-bottom:12px;">
          <div class="lhs">
            <span class="spinner"></span>
            <span>${escapeHtml(runtime.text || "豆包正在执行白底真修…")}</span>
            <span class="elapsed" id="whitebg-elapsed">已等待 ${sec}s</span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-cancel-whitebg">取消</button>
        </div>`;
      } else if (runtime.lastError) {
        slot.innerHTML = `<div class="box-inline-notice" style="margin-bottom:12px;">
          <span>⚠ ${escapeHtml(runtime.lastError)}</span>
          <button type="button" id="btn-dismiss-whitebg-err" title="关闭提示">×</button>
        </div>`;
      } else {
        slot.innerHTML = "";
      }
    }

    function renderLockBanner() {
      const el = document.getElementById("whitebg-lock-banner");
      if (!el) return;
      const ref = getActiveRef();
      const selectedRefs = getSelectedRefs();
      if (ref) {
        const fullRefUrl = API.fileUrl(ref.imageUrl);
        const multiTip = selectedRefs.length > 1
          ? `（当前已多选 ${selectedRefs.length} 张白底图：${selectedRefs.map((r) => "v" + r.version).join("、")}，可在提示词中直接写 v${selectedRefs[0].version}/v${selectedRefs[1].version} 指定位置）`
          : `（支持在提示词中写 v1/v3/v6 引用对应版本白底图）`;
        el.className = "whitebg-lock-banner locked";
        el.innerHTML = `
          <div class="lock-lhs">
            <img src="${escapeHtml(fullRefUrl)}" alt="${escapeHtml(ref.label)}" data-lightbox-src="${escapeHtml(fullRefUrl)}" data-lightbox-title="当前锁定白底基准图 · ${escapeHtml(ref.label)}" />
            <div>
              <strong>产品本体强约束已生效</strong> · 当前主基准：${escapeHtml(ref.label)} ${escapeHtml(multiTip)}
              <div style="font-size:11.5px;opacity:.9;">所有主图 / 细节 / 尺寸 / 场景 / 精改均强制传白底参考图进行 i2i 生图，严禁空想外形或魔改结构/颜色/比例/材质。</div>
            </div>
          </div>
          <span class="spec-pill">输出 2000×2000 PNG/JPG</span>`;
      } else {
        el.className = "whitebg-lock-banner missing";
        el.innerHTML = `
          <div class="lock-lhs">
            <span>⚠ <strong>尚未生成精修白底产品图</strong>：根据防魔改永久规则，无白底基准图时阻断所有 AI 生图，请先完成第 1 层「白底真修」。</span>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="btn-banner-goto-whitebg">去完成白底真修 ↑</button>`;
      }
    }

    function renderResults() {
      ensureSelectionArrays();
      renderRuntime();
      const root = document.getElementById("whitebg-results");
      const savedBar = document.getElementById("whitebg-saved");
      if (!root || !savedBar) return;

      const items = state.whitebgResults;
      const selectedRefs = getSelectedRefs();
      const selSet = new Set(state.selectedWhitebgIds);

      if (!items.length) {
        root.innerHTML = `<div class="model-col wb-single-col empty">
          <h4><span>豆包 · 白底真修结果</span><span class="tag">待生成</span></h4>
          <div class="empty-msg">上传产品原图（默认全选）后，点上方「开始白底真修」将全部所选原图抠成 2000×2000 纯白底图</div>
        </div>`;
        savedBar.classList.remove("show");
        savedBar.innerHTML = "";
        renderLockBanner();
        return;
      }

      const cards = items
        .map((item) => {
          const mName = modelDisplayName(item.model || "doubao");
          const selIdx = state.selectedWhitebgIds.indexOf(item.id);
          const sel = selSet.has(item.id);
          const fullUrl = API.fileUrl(item.imageUrl);
          const verTag = `v${item.version || 1}`;
          const titleStr = `${mName} 白底真修 ${verTag}（2000×2000 ${(item.ext || "png").toUpperCase()}）`;
          return `<div class="wb-result-card ${sel ? "selected" : ""}" data-wb-id="${escapeHtml(item.id)}">
            <button type="button" class="wb-check-pill ${sel ? "checked" : ""}" data-toggle-wb="${escapeHtml(item.id)}" title="勾选/取消勾选（支持单选或多选）">
              ${sel ? `✓ 已选${ state.selectedWhitebgIds.length > 1 ? "#" + (selIdx + 1) : "" }` : "☐ 勾选"} · <strong>${escapeHtml(verTag)}</strong>
            </button>
            <button type="button" class="wb-delete-btn" data-delete-wb="${escapeHtml(item.id)}" title="直接删除此白底图">×</button>
            <img src="${escapeHtml(fullUrl)}" alt="${escapeHtml(item.label)}" data-lightbox-src="${escapeHtml(fullUrl)}" data-lightbox-title="${escapeHtml(titleStr)}" />
            <div class="wb-meta" data-toggle-wb="${escapeHtml(item.id)}">
              <div><strong>${escapeHtml(mName)} ${escapeHtml(verTag)}</strong> · <span style="color:var(--green);">真实</span></div>
              <div>2000×2000 · ${(item.ext || "png").toUpperCase()}</div>
              <div class="wb-card-links">
                <button type="button" class="link-btn" data-only-wb="${escapeHtml(item.id)}" title="仅单选这一张">单选此张</button>
              </div>
            </div>
          </div>`;
        })
        .join("");

      root.innerHTML = `<div class="model-col wb-single-col">
        <div class="wb-col-head">
          <div>
            <strong>豆包 · 白底真修图库（共 ${items.length} 张）</strong>
            <span class="tag tag-real" style="margin-left:6px;">真实 · 白底图/</span>
            <span style="font-size:11.5px;color:var(--muted);margin-left:8px;">点图片放大 · 点左上角名称勾选 · 点 × 删除</span>
          </div>
          <div class="wb-sel-tools">
            <span style="font-size:12px;color:var(--green);font-weight:600;">已勾选 ${selectedRefs.length} 张</span>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-wb-select-all" ${selectedRefs.length === items.length ? "disabled" : ""}>全选 (${items.length})</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-wb-clear-sel" ${selectedRefs.length === 0 ? "disabled" : ""}>清空勾选</button>
          </div>
        </div>
        <div class="result-thumbs">${cards}</div>
      </div>`;

      const plans = currentPlans();
      const boxOpts = plans
        .map((p) => `<option value="${escapeHtml(p.id)}" ${p.id.startsWith("qs-main") ? "selected" : ""}>${escapeHtml(p.title || p.id)}</option>`)
        .join("");

      savedBar.classList.add("show");
      if (selectedRefs.length > 0) {
        const thumbs = selectedRefs
          .slice(0, 6)
          .map((r) => {
            const u = API.fileUrl(r.imageUrl);
            return `<img src="${escapeHtml(u)}" alt="${escapeHtml(r.label)}" data-lightbox-src="${escapeHtml(u)}" data-lightbox-title="${escapeHtml(r.label)}" title="${escapeHtml(r.label)}" />`;
          })
          .join("");
        const verSummary = selectedRefs.map((r) => `v${r.version}`).join("、");
        const attachLabel = selectedRefs.length > 1 ? `一键挂入规划框（${selectedRefs.length}张）` : "一键挂入规划框（1张）";
        savedBar.innerHTML = `
          <div class="lhs">
            <div class="saved-thumbs">${thumbs}</div>
            <div>
              <div><strong>🔒 已勾选 ${selectedRefs.length} 张白底图（${escapeHtml(verSummary)}）</strong> · 主基准：${escapeHtml(selectedRefs[0].label)}</div>
              <div style="font-size:11.5px;opacity:.9;">落盘：${escapeHtml(selectedRefs[0].productDir || displayProductFolder())}/白底图/ · 可单张或多张一键挂入下方任意规划框，生图时也可写 ${escapeHtml(verSummary)} 指定各图位置</div>
            </div>
          </div>
          <div class="rhs">
            <select id="whitebg-attach-box">${boxOpts}</select>
            <button type="button" class="btn btn-primary btn-sm" id="btn-whitebg-to-box">${escapeHtml(attachLabel)}</button>
            <button type="button" class="btn btn-success btn-sm" id="btn-whitebg-to-preview1">设为预览 #1 主图</button>
          </div>`;
      } else {
        const fallbackRef = getActiveRef();
        savedBar.innerHTML = `
          <div class="lhs">
            <div>
              <div><strong>当前未勾选白底图卡片</strong>（默认防魔改基准仍锁定：${escapeHtml(fallbackRef ? fallbackRef.label : "—")}）</div>
              <div style="font-size:11.5px;opacity:.9;">请点击上方白底图左上角「☐ 勾选」（支持单选或多选），即可一键批量挂入下方规划框。</div>
            </div>
          </div>
          <div class="rhs">
            <select id="whitebg-attach-box" disabled>${boxOpts}</select>
            <button type="button" class="btn btn-sm" id="btn-whitebg-to-box" disabled>请先勾选白底图</button>
          </div>`;
      }
      renderLockBanner();
    }

    async function uploadSourceFiles(files) {
      const list = [...files].filter((f) => f && (f.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(f.name)));
      if (!list.length) {
        toast("请选择 PNG / JPG / WebP 产品图片");
        return;
      }
      const st = document.getElementById("whitebg-src-status");
      if (st) {
        st.className = "voc-status";
        st.innerHTML = `<span class="spinner"></span> 原图上传规范化中 0/${list.length}…`;
      }
      let added = 0;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (st) st.innerHTML = `<span class="spinner"></span> 原图上传中 ${i + 1}/${list.length}…`;
        try {
          const dataUrl = await readFileAsDataURL(f);
          const res = await API.post(
            "/api/upload",
            {
              asin: getAsin() || "UPLOAD",
              productName: state.mode === "demo" ? (state.productName || "") : (state.productName || ""),
              boxId: "whitebg-src",
              kind: "whitebg-upload",
              filename: f.name,
              mime: f.type,
              dataBase64: dataUrl,
            },
            { timeoutMs: 45000 }
          );
          addSourceItem(f.name || `原图 ${state.whitebgSources.length + 1}`, res.imageUrl, res.saved && res.saved.filename);
          if (res.productDir) state.productDir = res.productDir;
          if (res.saved) state.lastSavePath = res.saved.category + "/" + res.saved.filename;
          added++;
        } catch (e) {
          toast("原图上传失败：" + humanizeError(e, "upload"), { duration: 4500 });
        }
      }
      // Ensure ALL uploaded source images are selected by default (Requirement #1)
      if (added > 0) {
        state.whitebgSelectedSourceIds = state.whitebgSources.map((u) => u.id);
      }
      saveState();
      setModeUI();
      renderUploads();
      refreshStatusQuiet();
      if (st) {
        st.className = added ? "voc-status ok" : "voc-status err";
        st.textContent = added
          ? `✓ 已载入并默认全选 ${state.whitebgSelectedSourceIds.length} 张原图（2000×2000），点「开始白底真修」一键全部修成白底`
          : "原图上传失败";
      }
      if (added) toast(`已添加 ${added} 张原图（已默认全选 ${state.whitebgSelectedSourceIds.length} 张），点「开始白底真修」即可全部修白底`);
    }

    function addSourceItem(label, imageUrl, filename) {
      ensureSelectionArrays();
      let existing = state.whitebgSources.find((u) => u.imageUrl === imageUrl);
      if (!existing) {
        existing = {
          id: `wbsrc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          label: label || "待修原图",
          imageUrl,
          filename: filename || "",
        };
        state.whitebgSources.push(existing);
      }
      if (!state.whitebgSelectedSourceIds.includes(existing.id)) {
        state.whitebgSelectedSourceIds.push(existing.id);
      }
      state.whitebgSelectedSourceId = existing.id;
      return existing;
    }

    async function deleteWhitebgResult(wbId) {
      const target = state.whitebgResults.find((r) => r.id === wbId);
      if (!target) return;
      state.whitebgResults = state.whitebgResults.filter((r) => r.id !== wbId);
      state.selectedWhitebgIds = (state.selectedWhitebgIds || []).filter((id) => id !== wbId);
      ensureSelectionArrays();
      saveState();
      setModeUI();
      renderResults();
      renderPlans();

      if (target.imageUrl) {
        try {
          await API.post("/api/file/delete", { imageUrl: target.imageUrl }, { timeoutMs: 15000 });
          refreshStatusQuiet();
        } catch (e) {
          toast("本地已移除，服务端文件清理提示：" + humanizeError(e, "delete"));
          return;
        }
      }
      toast(`已删除「${target.label || "白底图"}」`);
    }

    async function runRetouch() {
      if (runtime.busy) return;
      if (!state.whitebgSources.length) {
        toast("请先点「+ 上传待修原图」上传产品图，或从已入库图片选原图", { duration: 4500 });
        return;
      }
      const selectedSources = getSelectedSources();
      if (!selectedSources.length) {
        toast("请至少勾选一张待修原图（可点上方「全选原图」）", { duration: 4000 });
        return;
      }
      const instEl = document.getElementById("whitebg-instruction");
      if (instEl) state.whitebgInstruction = instEl.value.trim();

      const ctrl = new AbortController();
      runtime.busy = true;
      runtime.startedAt = Date.now();
      runtime.controller = ctrl;
      runtime.lastError = null;

      const createdIds = [];
      const errMsgs = [];
      let cancelled = false;

      try {
        for (let i = 0; i < selectedSources.length; i++) {
          const src = selectedSources[i];
          runtime.text =
            selectedSources.length > 1
              ? `豆包批量白底真修 (${i + 1}/${selectedSources.length})：${src.label}…`
              : `豆包正在对「${src.label}」进行白底真修与 2000×2000 纯白校准…`;
          renderUploads();
          renderResults();
          if (i === 0 || selectedSources.length <= 3) {
            toast(runtime.text, { duration: 3500 });
          }

          try {
            const nextVer =
              Math.max(0, ...state.whitebgResults.map((r) => Number(r.version) || 0)) + 1;
            const res = await API.post(
              "/api/whitebg",
              {
                provider: "doubao",
                asin: getAsin() || "NOASIN",
                productName: state.productName || "",
                sourceImageUrl: src.imageUrl,
                instruction: state.whitebgInstruction || "",
                version: nextVer,
              },
              { timeoutMs: 95000, signal: ctrl.signal }
            );
            const item = {
              id: `wb-doubao-v${nextVer}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              model: "doubao",
              version: nextVer,
              label: `豆包 白底真修 v${nextVer}`,
              sourceId: src.id,
              sourceLabel: src.label,
              imageUrl: res.imageUrl,
              filename: res.saved && res.saved.filename,
              macPath: res.saved && res.saved.macPath,
              productDir: res.productDir,
              stageDir: res.stageDir,
              ext: res.ext || "png",
              mock: false,
            };
            state.whitebgResults.push(item);
            if (!state.selectedWhitebgIds.includes(item.id)) {
              state.selectedWhitebgIds.push(item.id);
            }
            state.activeWhitebgId = item.id;
            createdIds.push(item.id);
            if (res.productDir) state.productDir = res.productDir;
            if (res.saved) state.lastSavePath = res.saved.category + "/" + res.saved.filename;
            saveState();
            setModeUI();
            renderResults();
            renderPlans();
          } catch (e) {
            if (e && e.isCancelled) {
              cancelled = true;
              break;
            }
            const msg = `${src.label}：${humanizeError(e, "doubao")}`;
            errMsgs.push(msg);
            runtime.lastError = msg;
          }
        }
      } finally {
        runtime.busy = false;
        runtime.controller = null;
        runtime.text = "";
        saveState();
        setModeUI();
        renderUploads();
        renderResults();
        renderPlans();
        refreshStatusQuiet();
      }

      if (cancelled) {
        toast("已取消白底真修");
      } else if (createdIds.length && !errMsgs.length) {
        toast(
          `已完成 ${createdIds.length} 张白底真修 · 存入「白底图/」并自动勾选，可一键挂入规划框`,
          { duration: 4800 }
        );
      } else if (createdIds.length && errMsgs.length) {
        toast(`成功修好 ${createdIds.length} 张；其余提示：${errMsgs.join("；")}`, { duration: 5500 });
      } else if (errMsgs.length) {
        toast("白底真修失败：" + errMsgs.join("；"), { duration: 5500 });
      }
    }

    function classifyPreviewKind(it) {
      if (!it) return "final";
      const model = String(it.model || "").toLowerCase();
      const stage = String(it.stageDir || "").trim();
      const label = String(it.label || it.title || "");
      // 明确白底基准图 → 白底图/；其余预览定稿 → 最终版本/（绝不塞过程图）
      if (stage === "白底图") return "whitebg-pick";
      if (model === "whitebg" || model === "whitebg-pick" || model === "whitebg-retouch") return "whitebg-pick";
      if (/白底真修|精修白底|纯白底/.test(label)) return "whitebg-pick";
      return "final";
    }

    async function syncPreviewToFinal(opts) {
      const silent = !!(opts && opts.silent);
      const skipArchive = !!(opts && opts.skipArchive);
      const reason = (opts && opts.reason) || "";
      const items = [];
      const kindCounts = { final: 0, whitebg: 0 };
      (state.preview || []).forEach((it, idx) => {
        if (it && it.imageUrl) {
          const kind = classifyPreviewKind(it);
          if (kind === "whitebg-pick") kindCounts.whitebg += 1;
          else kindCounts.final += 1;
          items.push({
            slot: idx + 1,
            boxId: it.boxId,
            model: it.model,
            version: it.version || 1,
            imageUrl: it.imageUrl,
            kind,
          });
        }
      });
      const stEl = document.getElementById("preview-sync-status");
      if (!items.length) {
        if (!silent) toast("预览框中暂无可定稿的图片");
        if (stEl) stEl.textContent = "";
        return { ok: false, empty: true, count: 0, reason: "empty" };
      }
      if (previewSyncing) return { ok: false, busy: true, count: 0, reason: "busy" };
      previewSyncing = true;
      const btn = document.getElementById("btn-sync-final");
      if (btn) btn.disabled = true;
      if (stEl) {
        stEl.className = "voc-status";
        const destHint = kindCounts.whitebg && !kindCounts.final
          ? "白底图/"
          : kindCounts.whitebg
            ? "最终版本/ + 白底图/"
            : "最终版本/";
        stEl.innerHTML = `<span class="spinner"></span> 正在同步至「${destHint}」…`;
      }
      try {
        const res = await API.post(
          "/api/preview/save",
          {
            asin: getAsin() || "NOASIN",
            productName: state.productName || "",
            items,
            reason: reason || undefined,
          },
          { timeoutMs: 45000 }
        );
        if (res.productDir) state.productDir = res.productDir;
        if (res.lastSavePath) state.lastSavePath = res.lastSavePath;
        saveState();
        setModeUI();
        refreshStatusQuiet();
        const finalN = (res.finalCount != null) ? res.finalCount : kindCounts.final;
        const wbN = (res.whitebgCount != null) ? res.whitebgCount : kindCounts.whitebg;
        let destText = `${res.productDir || displayProductFolder()}/最终版本/`;
        if (wbN && finalN) destText = `${res.productDir || displayProductFolder()}/{最终版本 ${finalN} · 白底图 ${wbN}}`;
        else if (wbN && !finalN) destText = `${res.productDir || displayProductFolder()}/白底图/`;
        if (stEl) {
          stEl.className = "voc-status ok";
          stEl.textContent = `✓ 已写入「${destText}」共 ${res.count} 张（2000×2000 · 已入 Mac 同步队列）`;
        }
        if (!silent) {
          toast(`已定稿 ${res.count} 张至桌面产品文件夹「${destText}」`);
        }
        // Only archive on explicit「同步定稿」; silent / new-product skipArchive 由调用方自行写历史
        if (!silent && !skipArchive && typeof onFinalArchived === "function") {
          try {
            await onFinalArchived({ silent: false, count: res.count, productDir: res.productDir });
          } catch (_) {}
        }
        return {
          ok: true,
          count: res.count || 0,
          productDir: res.productDir,
          queuedNew: res.queuedNew || 0,
          finalCount: finalN,
          whitebgCount: wbN,
          items: res.items || [],
        };
      } catch (e) {
        if (stEl) {
          stEl.className = "voc-status err";
          stEl.textContent = "定稿写入失败：" + humanizeError(e, "preview");
        }
        if (!silent) toast("定稿同步失败：" + humanizeError(e, "preview"));
        return { ok: false, error: humanizeError(e, "preview"), count: 0 };
      } finally {
        previewSyncing = false;
        if (btn) btn.disabled = false;
      }
    }

    function attachToBox(targetBoxId, alsoPreviewSlot1) {
      const selectedRefs = getSelectedRefs();
      const refsToAttach = alsoPreviewSlot1
        ? [selectedRefs[0] || getActiveRef()].filter(Boolean)
        : selectedRefs;

      if (!refsToAttach.length) {
        toast("请先勾选至少一张白底图");
        return;
      }
      const plans = currentPlans();
      let boxId = targetBoxId || "qs-main";
      if (!plans.find((p) => p.id === boxId) && plans.length) {
        const mainPlan = plans.find((p) => p.id.startsWith("qs-main")) || plans[0];
        boxId = mainPlan.id;
      }
      const box = ensureBox(boxId);
      let lastItem = null;

      refsToAttach.forEach((ref) => {
        let existing = box.results.find((r) => r.imageUrl === ref.imageUrl);
        const wbVer = Number(ref.version) || 1;
        if (!existing) {
          existing = {
            id: `wbattach-${boxId}-v${wbVer}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            model: "whitebg",
            version: wbVer,
            refVersion: wbVer,
            versionTag: `v${wbVer}`,
            label: `${ref.label || `豆包 白底真修 v${wbVer}`} · 2000×2000`,
            imageUrl: ref.imageUrl,
            macPath: ref.macPath,
            mock: false,
          };
          box.results.push(existing);
        } else {
          existing.refVersion = wbVer;
          existing.versionTag = `v${wbVer}`;
        }
        lastItem = existing;
      });

      if (lastItem) {
        box.selectedResultId = lastItem.id;
        box.refineProvider = "doubao";
      }

      if (alsoPreviewSlot1 && lastItem) {
        const plan = findPlan(boxId);
        state.preview = state.preview.map((p, idx) => (idx !== 0 && p && p.boxId === boxId ? null : p));
        state.preview[0] = {
          boxId,
          title: plan ? plan.title : "主图（白底）",
          model: lastItem.model,
          version: lastItem.version,
          resultId: lastItem.id,
          imageUrl: lastItem.imageUrl,
        };
        reconcilePreviewFlags();
        saveState();
        renderPlans();
        renderPreview();
        syncPreviewToFinal({ silent: false });
        return;
      }

      saveState();
      renderPlans();
      const boxTitle = (findPlan(boxId) || {}).title || boxId;
      const verStr = refsToAttach.map((r) => `v${r.version}`).join("、");
      toast(`已将 ${refsToAttach.length} 张白底图（${verStr}）一键挂入「${boxTitle}」`);
    }

    function hydrateExisting(existingList) {
      if (!Array.isArray(existingList) || !existingList.length) return;
      // Sort ascending by version / filename so v1, v3, v4, v5, v6 appear in natural order
      const sorted = [...existingList]
        .filter((it) => it && it.imageUrl)
        .sort((a, b) => (Number(a.version) || 0) - (Number(b.version) || 0));
      const usedVers = new Set();
      const mapped = sorted.map((it, idx) => {
        let ver = Number(it.version) || 0;
        if (!ver) {
          const m = /_v(\d+)_/i.exec(it.filename || "");
          ver = m ? Number(m[1]) : idx + 1;
        }
        while (usedVers.has(ver)) ver++;
        usedVers.add(ver);
        const mod = GEN_PROVIDERS.includes(it.model) ? it.model : "doubao";
        return {
          id: `wb-disk-v${ver}-${it.filename}`,
          model: mod,
          version: ver,
          label: `${modelDisplayName(mod)} 白底真修 v${ver}`,
          imageUrl: it.imageUrl,
          filename: it.filename,
          macPath: it.macPath,
          productDir: it.productDir,
          stageDir: it.stageDir || "白底图",
          ext: it.ext || "png",
          mock: false,
        };
      });
      if (mapped.length) {
        state.whitebgResults = mapped;
        const lastId = mapped[mapped.length - 1].id;
        state.activeWhitebgId = lastId;
        state.selectedWhitebgIds = [lastId];
      }
    }

    function bindEvents() {
      const wbFileInput = document.getElementById("whitebg-file-input");
      if (wbFileInput) {
        wbFileInput.addEventListener("change", () => {
          uploadSourceFiles(wbFileInput.files);
          wbFileInput.value = "";
        });
      }

      const selAllSrcBtn = document.getElementById("btn-whitebg-select-all-src");
      if (selAllSrcBtn) {
        selAllSrcBtn.addEventListener("click", () => {
          state.whitebgSelectedSourceIds = state.whitebgSources.map((u) => u.id);
          saveState();
          renderUploads();
          toast(`已全选 ${state.whitebgSelectedSourceIds.length} 张待修原图`);
        });
      }

      const clrSrcBtn = document.getElementById("btn-whitebg-clear-src");
      if (clrSrcBtn) {
        clrSrcBtn.addEventListener("click", () => {
          state.whitebgSelectedSourceIds = [];
          saveState();
          renderUploads();
        });
      }

      document.getElementById("btn-whitebg-pick-board").addEventListener("click", () => {
        boardPickerOpen = !boardPickerOpen;
        renderBoardPicker();
      });

      document.getElementById("whitebg-board-picker").addEventListener("click", (e) => {
        if (e.target.closest("[data-lightbox-src]")) return;
        if (e.target.closest("#btn-close-board-picker")) {
          boardPickerOpen = false;
          renderBoardPicker();
          return;
        }
        const card = e.target.closest("[data-pick-board-idx]");
        if (!card) return;
        const picked = collectBoardImages()[Number(card.dataset.pickBoardIdx)];
        if (!picked) return;
        addSourceItem(picked.label, picked.imageUrl);
        boardPickerOpen = false;
        saveState();
        renderBoardPicker();
        renderUploads();
        toast(`已加入待修原图并自动勾选：「${picked.label}」`);
      });

      document.getElementById("whitebg-uploads").addEventListener("click", (e) => {
        if (e.target.closest("[data-lightbox-src]")) return;
        const rm = e.target.closest("[data-remove-src]");
        if (rm) {
          e.stopPropagation();
          const id = rm.dataset.removeSrc;
          const removed = state.whitebgSources.find((u) => u.id === id);
          state.whitebgSources = state.whitebgSources.filter((u) => u.id !== id);
          state.whitebgSelectedSourceIds = (state.whitebgSelectedSourceIds || []).filter((x) => x !== id);
          saveState();
          renderUploads();
          if (removed && removed.imageUrl && removed.imageUrl.includes("whitebg-src")) {
            API.post("/api/file/delete", { imageUrl: removed.imageUrl }, { timeoutMs: 12000 }).catch(() => {});
          }
          return;
        }
        const toggleEl = e.target.closest("[data-toggle-src]") || e.target.closest("[data-src-id]");
        if (toggleEl) {
          const id = toggleEl.dataset.toggleSrc || toggleEl.dataset.srcId;
          if (!id) return;
          ensureSelectionArrays();
          if (state.whitebgSelectedSourceIds.includes(id)) {
            state.whitebgSelectedSourceIds = state.whitebgSelectedSourceIds.filter((x) => x !== id);
          } else {
            state.whitebgSelectedSourceIds.push(id);
          }
          saveState();
          renderUploads();
        }
      });

      document.getElementById("whitebg-instruction").addEventListener("input", (e) => {
        state.whitebgInstruction = e.target.value;
        saveStateDebounced();
      });

      document.getElementById("btn-fix-whitebg").addEventListener("click", runRetouch);

      document.getElementById("whitebg-runtime-slot").addEventListener("click", (e) => {
        if (e.target.closest("#btn-cancel-whitebg") && runtime.controller) {
          runtime.controller.abort("user");
        }
        if (e.target.closest("#btn-dismiss-whitebg-err")) {
          runtime.lastError = null;
          renderRuntime();
        }
      });

      document.getElementById("whitebg-results").addEventListener("click", (e) => {
        if (e.target.closest("[data-lightbox-src]")) return;

        const delBtn = e.target.closest("[data-delete-wb]");
        if (delBtn) {
          e.stopPropagation();
          deleteWhitebgResult(delBtn.dataset.deleteWb);
          return;
        }

        if (e.target.closest("#btn-wb-select-all")) {
          state.selectedWhitebgIds = state.whitebgResults.map((r) => r.id);
          if (state.selectedWhitebgIds.length) state.activeWhitebgId = state.selectedWhitebgIds[0];
          saveState();
          renderResults();
          return;
        }

        if (e.target.closest("#btn-wb-clear-sel")) {
          state.selectedWhitebgIds = [];
          saveState();
          renderResults();
          return;
        }

        const onlyBtn = e.target.closest("[data-only-wb]");
        if (onlyBtn) {
          e.stopPropagation();
          const id = onlyBtn.dataset.onlyWb;
          state.selectedWhitebgIds = [id];
          state.activeWhitebgId = id;
          saveState();
          setModeUI();
          renderResults();
          toast("已单选该白底基准图");
          return;
        }

        const toggleTarget = e.target.closest("[data-toggle-wb]") || e.target.closest("[data-wb-id]");
        if (!toggleTarget) return;
        const wbId = toggleTarget.dataset.toggleWb || toggleTarget.dataset.wbId;
        if (!wbId) return;
        ensureSelectionArrays();
        if (state.selectedWhitebgIds.includes(wbId)) {
          state.selectedWhitebgIds = state.selectedWhitebgIds.filter((id) => id !== wbId);
        } else {
          state.selectedWhitebgIds.push(wbId);
          state.activeWhitebgId = wbId;
        }
        ensureSelectionArrays();
        saveState();
        setModeUI();
        renderResults();
      });

      document.getElementById("whitebg-saved").addEventListener("click", (e) => {
        if (e.target.closest("[data-lightbox-src]")) return;
        if (e.target.closest("#btn-whitebg-to-box")) {
          const sel = document.getElementById("whitebg-attach-box");
          attachToBox(sel ? sel.value : "qs-main", false);
        }
        if (e.target.closest("#btn-whitebg-to-preview1")) {
          attachToBox("qs-main", true);
        }
      });

      document.getElementById("whitebg-lock-banner").addEventListener("click", (e) => {
        if (e.target.closest("[data-lightbox-src]")) return;
        if (e.target.closest("#btn-banner-goto-whitebg")) focusSection();
      });
    }

    function tickElapsed() {
      const wbEl = document.getElementById("whitebg-elapsed");
      if (wbEl && runtime.busy) {
        const sec = Math.max(0, Math.floor((Date.now() - runtime.startedAt) / 1000));
        wbEl.textContent = `已等待 ${sec}s`;
      }
    }

    return {
      getSelectedSource,
      getSelectedSources,
      getSelectedRefs,
      getActiveRef,
      focusSection,
      addSourceItem,
      hydrateExisting,
      renderBoardPicker,
      renderUploads,
      syncModelLabels,
      renderResults,
      renderLockBanner,
      syncPreviewToFinal,
      bindEvents,
      tickElapsed,
      abortInFlight() {
        if (runtime.controller) {
          try { runtime.controller.abort("user"); } catch (_) {}
        }
        runtime.busy = false;
        runtime.controller = null;
        runtime.text = "";
        runtime.lastError = null;
        boardPickerOpen = false;
      },
    };
  },
};
