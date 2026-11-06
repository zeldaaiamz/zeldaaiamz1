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
};
