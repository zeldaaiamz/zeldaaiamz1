/* Real White-Background Retouch + Product Identity Lock + Finalize (最终版本/) module */
window.BoardWhitebg = {
  create(ctx) {
    const {
      state,
      API,
      DEMO,
      GEN_PROVIDERS,
      MODEL_MAP,
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
    } = ctx;

    let boardPickerOpen = false;
    let previewSyncing = false;
    const runtime = {
      busy: false,
      text: "",
      startedAt: 0,
      controller: null,
      lastError: null,
    };

    function getSelectedSource() {
      if (!state.whitebgSources || !state.whitebgSources.length) return null;
      return (
        state.whitebgSources.find((u) => u.id === state.whitebgSelectedSourceId) ||
        state.whitebgSources[state.whitebgSources.length - 1]
      );
    }

    function getActiveRef() {
      if (!state.whitebgResults || !state.whitebgResults.length) return null;
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
          <span>点击任意已入库图片作为待修原图：</span>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-close-board-picker">收起</button>
        </div>
        <div class="picker-list">` +
        candidates
          .map(
            (c, i) => `<div class="picker-item" data-pick-board-idx="${i}" title="${escapeHtml(c.label)}">
              <img src="${escapeHtml(API.fileUrl(c.imageUrl))}" alt="" />
              <div class="p-meta">${escapeHtml(c.label)}</div>
            </div>`
          )
          .join("") +
        `</div>`;
    }

    function renderUploads() {
      const root = document.getElementById("whitebg-uploads");
      if (!root) return;
      const instEl = document.getElementById("whitebg-instruction");
      if (instEl && document.activeElement !== instEl) {
        instEl.value = state.whitebgInstruction || "";
      }
      const fixBtn = document.getElementById("btn-fix-whitebg");
      if (fixBtn) {
        fixBtn.disabled = runtime.busy;
        fixBtn.innerHTML = runtime.busy ? `<span class="spinner"></span> 白底真修中…` : "开始白底真修";
      }
      if (!state.whitebgSources.length) {
        root.innerHTML = `<div class="empty-msg" style="width:100%;padding:16px 12px;border:1px dashed var(--line);border-radius:10px;background:#fff;">
          尚未添加待修原图 · 请点上方 <strong>「+ 上传待修原图」</strong> 选择产品实拍图/样品图（支持 PNG / JPG / WebP）
        </div>`;
        return;
      }
      const activeSrc = getSelectedSource();
      root.innerHTML = state.whitebgSources
        .map((u) => {
          const sel = activeSrc && activeSrc.id === u.id;
          return `<div class="src-card ${sel ? "selected" : ""}" data-src-id="${escapeHtml(u.id)}" title="${escapeHtml(u.label)}">
            ${sel ? `<span class="src-badge">待修原图</span>` : ""}
            <button type="button" class="src-remove" data-remove-src="${escapeHtml(u.id)}" title="移除">×</button>
            <img src="${escapeHtml(API.fileUrl(u.imageUrl))}" alt="${escapeHtml(u.label)}" />
            <div class="src-meta">${escapeHtml(u.label)}</div>
          </div>`;
        })
        .join("");
    }

    function syncModelLabels() {
      document.querySelectorAll("#whitebg-models label[data-model]").forEach((lab) => {
        const input = lab.querySelector("input");
        const checked = state.whitebgSelectedModels.includes(input.value);
        input.checked = checked;
        lab.classList.toggle("checked", checked);
        input.disabled = runtime.busy;
      });
    }

    function renderRuntime() {
      const slot = document.getElementById("whitebg-runtime-slot");
      if (!slot) return;
      if (runtime.busy) {
        const sec = Math.max(0, Math.floor((Date.now() - runtime.startedAt) / 1000));
        slot.innerHTML = `<div class="gen-loading-bar" style="margin-bottom:12px;">
          <div class="lhs">
            <span class="spinner"></span>
            <span>${escapeHtml(runtime.text || "正在执行白底真修…")}</span>
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
      if (ref) {
        el.className = "whitebg-lock-banner locked";
        el.innerHTML = `
          <div class="lock-lhs">
            <img src="${escapeHtml(API.fileUrl(ref.imageUrl))}" alt="" />
            <div>
              <strong>产品本体强约束已生效</strong> · 当前绑定白底图：${escapeHtml(ref.label)}
              <div style="font-size:11.5px;opacity:.9;">所有主图 / 细节 / 尺寸 / 场景 / 精改均强制传此白底参考图进行 i2i 生图，严禁空想外形或魔改结构/颜色/比例/材质。</div>
            </div>
          </div>
          <span class="spec-pill">输出 2000×2000 PNG/JPG</span>`;
      } else {
        el.className = "whitebg-lock-banner missing";
        el.innerHTML = `
          <div class="lock-lhs">
            <span>⚠ <strong>尚未锁定精修白底产品图</strong>：根据防魔改永久规则，无白底基准图时阻断所有 AI 生图，请先完成第 1 层「白底真修」。</span>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="btn-banner-goto-whitebg">去完成白底真修 ↑</button>`;
      }
    }

    function renderResults() {
      renderRuntime();
      const root = document.getElementById("whitebg-results");
      const savedBar = document.getElementById("whitebg-saved");
      if (!root || !savedBar) return;

      const cols = ["doubao", "banana", "chatgpt"];
      const activeRef = getActiveRef();

      root.innerHTML = cols
        .map((mid) => {
          const m = MODEL_MAP[mid] || { name: mid };
          const items = state.whitebgResults.filter((r) => r.model === mid);
          const isChecked = state.whitebgSelectedModels.includes(mid);
          if (!items.length) {
            return `<div class="model-col ${isChecked ? "" : "empty"}">
              <h4><span>${escapeHtml(m.name)}</span>${isChecked ? `<span class="tag">已勾选</span>` : `<span style="font-size:11px;color:var(--muted);">未勾选</span>`}</h4>
              <div class="empty-msg">${isChecked ? "上传原图后点「开始白底真修」生成" : "勾选后可参与对比真修"}</div>
            </div>`;
          }
          const cards = items
            .map((item) => {
              const sel = activeRef && activeRef.id === item.id;
              const fullUrl = API.fileUrl(item.imageUrl);
              return `<div class="wb-result-card ${sel ? "selected" : ""}" data-wb-id="${escapeHtml(item.id)}">
                <img src="${escapeHtml(fullUrl)}" alt="${escapeHtml(item.label)}" />
                <div class="wb-meta">
                  <div><strong>${escapeHtml(m.name)} v${item.version}</strong> · <span style="color:var(--green);">真实</span></div>
                  <div>2000×2000 · ${(item.ext || "png").toUpperCase()}</div>
                  <a class="wb-zoom" href="${escapeHtml(fullUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">查看原图 ↗</a>
                </div>
                <span class="check">✓</span>
              </div>`;
            })
            .join("");
          return `<div class="model-col">
            <h4><span>${escapeHtml(m.name)}</span><span class="tag tag-real">真实 · 白底图/</span></h4>
            <div class="result-thumbs">${cards}</div>
          </div>`;
        })
        .join("");

      if (activeRef) {
        const plans = currentPlans();
        const boxOpts = plans
          .map((p) => `<option value="${escapeHtml(p.id)}" ${p.id.startsWith("qs-main") ? "selected" : ""}>${escapeHtml(p.title || p.id)}</option>`)
          .join("");
        savedBar.classList.add("show");
        savedBar.innerHTML = `
          <div class="lhs">
            <img src="${escapeHtml(API.fileUrl(activeRef.imageUrl))}" alt="" />
            <div>
              <div><strong>🔒 已锁定白底产品基准图：${escapeHtml(activeRef.label)}</strong>（2000×2000 ${(activeRef.ext || "png").toUpperCase()}）</div>
              <div style="font-size:11.5px;opacity:.9;">落盘：${escapeHtml(activeRef.productDir || displayProductFolder())}/白底图/${escapeHtml(activeRef.filename || "")} · 后续所有 AI 出图严格以此图作为唯一产品本体</div>
            </div>
          </div>
          <div class="rhs">
            <select id="whitebg-attach-box">${boxOpts}</select>
            <button type="button" class="btn btn-sm" id="btn-whitebg-to-box">挂入规划框</button>
            <button type="button" class="btn btn-success btn-sm" id="btn-whitebg-to-preview1">直接设为预览 #1 主图</button>
          </div>`;
      } else {
        savedBar.classList.remove("show");
        savedBar.innerHTML = "";
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
              asin: state.asin || DEMO.product.asin,
              productName: state.productName || "",
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
      saveState();
      setModeUI();
      renderUploads();
      refreshStatusQuiet();
      if (st) {
        st.className = added ? "voc-status ok" : "voc-status err";
        st.textContent = added ? `✓ 已载入 ${added} 张原图（2000×2000），点下方「开始白底真修」即可` : "原图上传失败";
      }
      if (added) toast(`已添加 ${added} 张待修原图，点「开始白底真修」即可抠白底`);
    }

    function addSourceItem(label, imageUrl, filename) {
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
      state.whitebgSelectedSourceId = existing.id;
      return existing;
    }

    async function runRetouch() {
      if (runtime.busy) return;
      const src = getSelectedSource();
      if (!src || !src.imageUrl) {
        toast("请先点「+ 上传待修原图」上传产品图，或从已入库图片选一张作为原图", { duration: 4500 });
        return;
      }
      if (!state.whitebgSelectedModels.length) {
        toast("请至少勾选一个白底真修模型（推荐豆包）");
        return;
      }
      const instEl = document.getElementById("whitebg-instruction");
      if (instEl) state.whitebgInstruction = instEl.value.trim();

      const ctrl = new AbortController();
      runtime.busy = true;
      runtime.startedAt = Date.now();
      runtime.controller = ctrl;
      runtime.lastError = null;

      const models = [...state.whitebgSelectedModels];
      const okNames = [];
      const errMsgs = [];
      let cancelled = false;

      try {
        for (let i = 0; i < models.length; i++) {
          const mid = models[i];
          const mName = modelDisplayName(mid);
          runtime.text = models.length > 1
            ? `白底真修 (${i + 1}/${models.length})：${mName} 抠白底与 2000×2000 纯白校准中…`
            : `${mName} 正在进行白底真修与纯白背景校准…`;
          renderUploads();
          syncModelLabels();
          renderResults();
          toast(runtime.text, { duration: 4000 });

          try {
            const nextVer = Math.max(0, ...state.whitebgResults.filter((r) => r.model === mid).map((r) => r.version || 1)) + 1;
            const res = await API.post(
              "/api/whitebg",
              {
                provider: mid,
                asin: state.asin || DEMO.product.asin,
                productName: state.productName || "",
                sourceImageUrl: src.imageUrl,
                instruction: state.whitebgInstruction || "",
                version: nextVer,
              },
              { timeoutMs: 105000, signal: ctrl.signal }
            );
            const item = {
              id: `wb-${mid}-v${nextVer}-${Date.now()}`,
              model: mid,
              version: nextVer,
              label: `${mName} 白底真修 v${nextVer}`,
              imageUrl: res.imageUrl,
              filename: res.saved && res.saved.filename,
              macPath: res.saved && res.saved.macPath,
              productDir: res.productDir,
              stageDir: res.stageDir,
              ext: res.ext || "png",
              mock: false,
            };
            state.whitebgResults.push(item);
            state.activeWhitebgId = item.id;
            if (res.productDir) state.productDir = res.productDir;
            if (res.saved) state.lastSavePath = res.saved.category + "/" + res.saved.filename;
            okNames.push(mName);
            saveState();
            setModeUI();
            renderResults();
            renderPlans();
          } catch (e) {
            if (e && e.isCancelled) {
              cancelled = true;
              break;
            }
            const msg = humanizeError(e, mid);
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
        syncModelLabels();
        renderResults();
        renderPlans();
        refreshStatusQuiet();
      }

      if (cancelled) {
        toast("已取消白底真修");
      } else if (okNames.length && !errMsgs.length) {
        toast(`白底真修完成（${okNames.join("、")}）· 已存入「白底图/」并自动锁定为产品本体参考图`, { duration: 4800 });
      } else if (okNames.length && errMsgs.length) {
        toast(`已完成 ${okNames.join("、")}；其余提示：${errMsgs.join("；")}`, { duration: 5500 });
      } else if (errMsgs.length) {
        toast("白底真修失败：" + errMsgs.join("；"), { duration: 5500 });
      }
    }

    async function syncPreviewToFinal(opts) {
      const silent = !!(opts && opts.silent);
      const items = [];
      (state.preview || []).forEach((it, idx) => {
        if (it && it.imageUrl) {
          items.push({
            slot: idx + 1,
            boxId: it.boxId,
            model: it.model,
            version: it.version || 1,
            imageUrl: it.imageUrl,
          });
        }
      });
      const stEl = document.getElementById("preview-sync-status");
      if (!items.length) {
        if (!silent) toast("预览框中暂无可定稿的图片");
        if (stEl) stEl.textContent = "";
        return;
      }
      if (previewSyncing) return;
      previewSyncing = true;
      const btn = document.getElementById("btn-sync-final");
      if (btn) btn.disabled = true;
      if (stEl) {
        stEl.className = "voc-status";
        stEl.innerHTML = `<span class="spinner"></span> 正在同步至「最终版本/」…`;
      }
      try {
        const res = await API.post(
          "/api/preview/save",
          {
            asin: state.asin || DEMO.product.asin,
            productName: state.productName || "",
            items,
          },
          { timeoutMs: 45000 }
        );
        if (res.productDir) state.productDir = res.productDir;
        if (res.lastSavePath) state.lastSavePath = res.lastSavePath;
        saveState();
        setModeUI();
        refreshStatusQuiet();
        if (stEl) {
          stEl.className = "voc-status ok";
          stEl.textContent = `✓ 已写入「${res.productDir || displayProductFolder()}/最终版本/」共 ${res.count} 张（2000×2000）`;
        }
        if (!silent) {
          toast(`已定稿 ${res.count} 张图片至「${res.productDir || displayProductFolder()}/最终版本/」`);
        }
      } catch (e) {
        if (stEl) {
          stEl.className = "voc-status err";
          stEl.textContent = "定稿写入失败：" + humanizeError(e, "preview");
        }
        if (!silent) toast("定稿同步失败：" + humanizeError(e, "preview"));
      } finally {
        previewSyncing = false;
        if (btn) btn.disabled = false;
      }
    }

    function attachToBox(targetBoxId, alsoPreviewSlot1) {
      const ref = getActiveRef();
      if (!ref) {
        toast("请先完成白底真修");
        return;
      }
      const plans = currentPlans();
      let boxId = targetBoxId || "qs-main";
      if (!plans.find((p) => p.id === boxId) && plans.length) {
        const mainPlan = plans.find((p) => p.id.startsWith("qs-main")) || plans[0];
        boxId = mainPlan.id;
      }
      const box = ensureBox(boxId);
      let existing = box.results.find((r) => r.imageUrl === ref.imageUrl);
      if (!existing) {
        const nextVer = Math.max(0, ...box.results.filter((r) => r.model === "whitebg").map((r) => r.version || 1)) + 1;
        existing = {
          id: `wbattach-${boxId}-${Date.now()}`,
          model: "whitebg",
          version: nextVer,
          label: `${ref.label} · 2000×2000`,
          imageUrl: ref.imageUrl,
          macPath: ref.macPath,
          mock: false,
        };
        box.results.push(existing);
      }
      box.selectedResultId = existing.id;
      box.refineProvider = GEN_PROVIDERS.includes(ref.model) ? ref.model : "doubao";

      if (alsoPreviewSlot1) {
        const plan = findPlan(boxId);
        state.preview = state.preview.map((p, idx) => (idx !== 0 && p && p.boxId === boxId ? null : p));
        state.preview[0] = {
          boxId,
          title: plan ? plan.title : "主图（白底）",
          model: existing.model,
          version: existing.version,
          resultId: existing.id,
          imageUrl: existing.imageUrl,
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
      toast(`已将「${ref.label}」挂入规划框「${(findPlan(boxId) || {}).title || boxId}」`);
    }

    function hydrateExisting(existingList) {
      if (!Array.isArray(existingList) || !existingList.length) return;
      const mapped = existingList
        .filter((it) => it && it.imageUrl)
        .map((it, idx) => ({
          id: `wb-disk-${idx}-${it.filename}`,
          model: GEN_PROVIDERS.includes(it.model) ? it.model : "doubao",
          version: idx + 1,
          label: `${modelDisplayName(it.model || "doubao")} 已存白底图`,
          imageUrl: it.imageUrl,
          filename: it.filename,
          macPath: it.macPath,
          productDir: it.productDir,
          stageDir: it.stageDir || "白底图",
          ext: it.ext || "png",
          mock: false,
        }));
      if (mapped.length) {
        state.whitebgResults = mapped;
        state.activeWhitebgId = mapped[0].id;
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
      document.getElementById("btn-whitebg-pick-board").addEventListener("click", () => {
        boardPickerOpen = !boardPickerOpen;
        renderBoardPicker();
      });
      document.getElementById("whitebg-board-picker").addEventListener("click", (e) => {
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
        toast(`已选定「${picked.label}」作为待修原图`);
      });

      document.getElementById("whitebg-uploads").addEventListener("click", (e) => {
        const rm = e.target.closest("[data-remove-src]");
        if (rm) {
          e.stopPropagation();
          const id = rm.dataset.removeSrc;
          state.whitebgSources = state.whitebgSources.filter((u) => u.id !== id);
          if (state.whitebgSelectedSourceId === id) {
            state.whitebgSelectedSourceId = state.whitebgSources.length ? state.whitebgSources[state.whitebgSources.length - 1].id : null;
          }
          saveState();
          renderUploads();
          return;
        }
        const card = e.target.closest("[data-src-id]");
        if (card) {
          state.whitebgSelectedSourceId = card.dataset.srcId;
          saveState();
          renderUploads();
        }
      });

      document.getElementById("whitebg-instruction").addEventListener("input", (e) => {
        state.whitebgInstruction = e.target.value;
        saveStateDebounced();
      });

      document.getElementById("whitebg-models").addEventListener("change", (e) => {
        if (e.target.type !== "checkbox") return;
        state.whitebgSelectedModels = [...document.querySelectorAll("#whitebg-models input:checked")].map((i) => i.value);
        saveState();
        syncModelLabels();
        renderResults();
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
        const card = e.target.closest("[data-wb-id]");
        if (!card) return;
        state.activeWhitebgId = card.dataset.wbId;
        saveState();
        setModeUI();
        renderResults();
        toast("已切换当前锁定的白底产品基准图");
      });

      document.getElementById("whitebg-saved").addEventListener("click", (e) => {
        if (e.target.closest("#btn-whitebg-to-box")) {
          const sel = document.getElementById("whitebg-attach-box");
          attachToBox(sel ? sel.value : "qs-main", false);
        }
        if (e.target.closest("#btn-whitebg-to-preview1")) {
          attachToBox("qs-main", true);
        }
      });

      document.getElementById("whitebg-lock-banner").addEventListener("click", (e) => {
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
    };
  },
};
