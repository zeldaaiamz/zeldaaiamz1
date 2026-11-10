/* API client for board server — with AbortController + strict wall-clock timeout + download helper */
window.BoardAPI = {
  get base() {
    return (typeof window.BOARD_API_BASE === "string" ? window.BOARD_API_BASE : "").replace(/\/+$/, "");
  },
  async _fetchJson(url, fetchOpts, opts) {
    const timeoutMs = (opts && opts.timeoutMs) || 35000;
    const extSignal = opts && opts.signal;
    const ctrl = new AbortController();
    let timedOut = false;
    let userCancelled = false;
    let rejectRace = null;

    const onExtAbort = () => {
      userCancelled = true;
      ctrl.abort("user");
      if (rejectRace) rejectRace(Object.assign(new Error("已取消请求"), { isCancelled: true }));
    };
    if (extSignal) {
      if (extSignal.aborted) onExtAbort();
      else extSignal.addEventListener("abort", onExtAbort, { once: true });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort("timeout");
      if (rejectRace) rejectRace(Object.assign(new Error("请求超时"), { isTimeout: true }));
    }, timeoutMs);

    const abortPromise = new Promise((_, rej) => {
      rejectRace = rej;
      if (userCancelled) rej(Object.assign(new Error("已取消请求"), { isCancelled: true }));
      else if (timedOut) rej(Object.assign(new Error("请求超时"), { isTimeout: true }));
    });

    try {
      const r = await Promise.race([fetch(url, { ...fetchOpts, signal: ctrl.signal }), abortPromise]);
      const rawText = await Promise.race([r.text(), abortPromise]);
      let data;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch (_) {
        data = { ok: false, error: r.statusText || `HTTP ${r.status}` };
      }
      if (!r.ok && !data.ok) {
        const err = new Error(data.error || r.statusText || `HTTP ${r.status}`);
        err.data = data;
        err.status = r.status;
        if (r.status === 504 || data.timeout) err.isTimeout = true;
        throw err;
      }
      this.rememberThumbnails(data);
      return data;
    } catch (e) {
      if (userCancelled || (e && e.isCancelled)) {
        const err = new Error("已取消请求");
        err.isCancelled = true;
        throw err;
      }
      if (timedOut || (e && (e.isTimeout || e.name === "AbortError"))) {
        const err = new Error("请求超时");
        err.isTimeout = true;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (extSignal) extSignal.removeEventListener("abort", onExtAbort);
    }
  },
  async get(path, opts) {
    return this._fetchJson(this.base + path, { method: "GET" }, { timeoutMs: 25000, ...(opts || {}) });
  },
  async post(path, body, opts) {
    return this._fetchJson(
      this.base + path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      },
      { timeoutMs: 45000, ...(opts || {}) }
    );
  },
  fileUrl(imageUrl) {
    if (!imageUrl) return "";
    if (imageUrl.startsWith("http") || imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) return imageUrl;
    return this.base + imageUrl;
  },
  _thumbnails: new Map(),
  rememberThumbnails(data, nested = false) {
    if (!data || typeof data !== "object") return;
    if (data.imageUrl && data.thumbnailUrl) {
      this._thumbnails.set(this.fileUrl(data.imageUrl), this.fileUrl(data.thumbnailUrl));
    }
    Object.values(data).forEach((value) => {
      if (value && typeof value === "object") this.rememberThumbnails(value, true);
    });
    if (!nested && this._thumbnails.size) {
      // Original URLs are append-only: new bytes require a new path. Never overwrite originals.
      // Immutable identities survive a reload; bounded, best-effort app metadata only.
      const entries = Array.from(this._thumbnails).slice(-512);
      this._thumbnails = new Map(entries);
      try { window.localStorage.setItem("ai-image-board-thumbnails-v1", JSON.stringify(entries)); } catch (_) {}
    }
  },
  loadThumbnails() {
    try {
      const entries = JSON.parse(window.localStorage.getItem("ai-image-board-thumbnails-v1") || "[]");
      if (!Array.isArray(entries)) return;
      const prefix = this.base + "/api/file/";
      this._thumbnails = new Map(entries.filter((entry) => Array.isArray(entry) && entry.length === 2 &&
        typeof entry[0] === "string" && typeof entry[1] === "string" && entry[0].startsWith(prefix) &&
        entry[1].startsWith(entry[0] + "?thumb=480&v=")).slice(-512));
    } catch (_) {}
  },
  thumbnailUrl(imageUrl) {
    const original = this.fileUrl(imageUrl);
    if (!original) return "";
    if (this._thumbnails.has(original)) return this._thumbnails.get(original);
    // Old localStorage/history remains compatible. No third-party proxy/fetch.
    const prefix = this.base + "/api/file/";
    if (!original.startsWith(prefix) || /[?&]thumb=/.test(original)) return original;
    return original + (original.includes("?") ? "&" : "?") + "thumb=480";
  },
  fallbackImage(image) {
    // Error capture is shared by all dynamic cards. Never loop on a failed original.
    if (!image || image.tagName !== "IMG" || image.dataset.thumbnailFallback) return false;
    const original = image.getAttribute("data-lightbox-src");
    const current = image.getAttribute("src") || "";
    if (!original || !/[?&]thumb=/.test(current) || /[?&]thumb=/.test(original)) return false;
    image.dataset.thumbnailFallback = "1";
    image.src = original;
    return true;
  },
  downloadUrl(imageUrl, suggestedName) {
    const u = this.fileUrl(imageUrl);
    if (!u) return "";
    const sep = u.includes("?") ? "&" : "?";
    return u + sep + "download=1" + (suggestedName ? "&name=" + encodeURIComponent(suggestedName) : "");
  },
  async triggerDownload(imageUrl, suggestedName) {
    const dlUrl = this.downloadUrl(imageUrl, suggestedName);
    if (!dlUrl) return;
    const fallbackName = suggestedName || "amazon-listing-2000x2000.png";
    try {
      const r = await fetch(dlUrl, { mode: "cors" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = fallbackName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    } catch (_) {
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = fallbackName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  },

  async _fetchBlob(url, fetchOpts, opts = {}) {
    const timeoutMs = opts.timeoutMs || 120000;
    const maxBytes = opts.maxBytes || (32 * 1024 * 1024 + 65536);
    const ctrl = new AbortController();
    const external = opts.signal;
    let timedOut = false, cancelled = false, rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const onCancel = () => {
      cancelled = true;
      ctrl.abort();
      rejectAbort(Object.assign(new Error("已取消请求"), { isCancelled: true }));
    };
    if (external) {
      if (external.aborted) onCancel();
      else external.addEventListener("abort", onCancel, { once: true });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
      rejectAbort(Object.assign(new Error("原图/ZIP 请求超时，请重试"), { isTimeout: true }));
    }, timeoutMs);
    let reader;
    try {
      // Race both headers AND every body read. Even a broken fetch implementation
      // ignoring abort cannot leave the UI locked forever.
      const response = await Promise.race([fetch(url, { ...fetchOpts, signal: ctrl.signal, mode: "cors" }), aborted]);
      const type = (response.headers.get("Content-Type") || "").toLowerCase();
      const isError = !response.ok || type.includes("application/json");
      const limit = isError ? Math.min(maxBytes, 65536) : maxBytes;
      if (Number(response.headers.get("Content-Length")) > limit) throw new Error("下载内容超过单包字节上限");
      if (!isError && opts.acceptImage && !/^image\/(png|jpeg)(;|$)/.test(type)) throw new Error("原图响应不是 PNG/JPG 图片");
      if (!response.body || typeof response.body.getReader !== "function") throw new Error("下载响应内容为空或浏览器不支持流式读取");
      reader = response.body.getReader();
      let size = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error("下载内容超过单包字节上限");
        chunks.push(value);
      }
      const blob = new Blob(chunks, { type });
      if (isError) {
        let data = {};
        try { data = JSON.parse(await blob.text()); } catch (_) {}
        throw Object.assign(new Error(data.error || `原图/ZIP 读取失败（HTTP ${response.status}）`), { status: response.status });
      }
      if (!size) throw new Error("原图/ZIP 内容为空");
      const count = response.headers.get("X-Zip-Count");
      return { blob, zipCount: count ? Number(count) : null,
        contentDisposition: response.headers.get("Content-Disposition") || "" };
    } catch (error) {
      ctrl.abort();
      if (reader) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) {} }
      if (cancelled) throw Object.assign(new Error("已取消请求"), { isCancelled: true });
      if (timedOut) throw Object.assign(new Error("原图/ZIP 请求超时，请重试"), { isTimeout: true });
      throw error;
    } finally {
      clearTimeout(timer);
      if (external) external.removeEventListener("abort", onCancel);
    }
  },
  async getOriginalBlob(url, opts) {
    const result = await this._fetchBlob(url, { method: "GET" }, { ...opts, acceptImage: true, maxBytes: 32 * 1024 * 1024 });
    return result.blob;
  },
  async postBlob(path, body, opts) {
    return this._fetchBlob(this.base + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {})
    }, opts);
  },
  async downloadZipBatches(items, opts = {}) {
    let count = 0;
    const checkCancelled = () => {
      if (opts.signal?.aborted) throw Object.assign(new Error("已取消"), { isCancelled: true });
    };
    try {
      checkCancelled();
      const plan = await this.post("/api/preview/zip-plan", { items }, { signal: opts.signal });
      if (!Array.isArray(plan.batches) || !plan.batches.length) throw new Error("打包规划为空");
      const baseName = (opts.zipName || "preview.zip").replace(/\.zip$/i, "");
      for (let i = 0; i < plan.batches.length; i++) {
        checkCancelled();
        const batch = plan.batches[i];
        const suffix = plan.batches.length > 1 ? `_分包${i + 1}共${plan.batches.length}` : "";
        const zipName = `${baseName}${suffix}.zip`;
        let result = await this.postBlob("/api/preview/zip", { ...opts.body, items: batch.items, zipName },
          { timeoutMs: 120000, signal: opts.signal, maxBytes: Math.min(plan.maxZipBytes || Infinity, 32 * 1024 * 1024 + 65536) });
        checkCancelled();
        if (result.zipCount !== batch.items.length) throw new Error("部分原图缺失，已取消不完整下载");
        await this.downloadBlob(result.blob, zipName, { releaseAfterMs: 1000 });
        result = null;
        count += batch.items.length;
        if (opts.onProgress) opts.onProgress({ count, packages: plan.batches.length, completedPackages: i + 1 });
      }
      checkCancelled();
      return { count, packages: plan.batches.length };
    } catch (error) {
      error.downloadedCount = count;
      throw error;
    }
  },
  downloadBlob(blob, suggestedName, opts = {}) {
    if (!blob) return Promise.resolve();
    const objUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = suggestedName || "preview.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (error) {
      URL.revokeObjectURL(objUrl);
      throw error;
    }
    // Batched callers await this release before fetching the next package; they
    // must not accumulate hundreds of live Blob URLs during automatic downloads.
    return new Promise(resolve => setTimeout(() => { URL.revokeObjectURL(objUrl); resolve(); }, opts.releaseAfterMs || 8000));
  },
};

window.BoardAPI.loadThumbnails();

if (typeof document !== "undefined") {
  document.addEventListener("error", (event) => window.BoardAPI.fallbackImage(event.target), true);
}
