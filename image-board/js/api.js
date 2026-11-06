/* API client for board server — with AbortController + timeout protection */
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

    const onExtAbort = () => {
      userCancelled = true;
      ctrl.abort("user");
    };
    if (extSignal) {
      if (extSignal.aborted) onExtAbort();
      else extSignal.addEventListener("abort", onExtAbort, { once: true });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort("timeout");
    }, timeoutMs);

    try {
      const r = await fetch(url, { ...fetchOpts, signal: ctrl.signal });
      const data = await r.json().catch(() => ({ ok: false, error: r.statusText || `HTTP ${r.status}` }));
      if (!r.ok && !data.ok) {
        const err = new Error(data.error || r.statusText || `HTTP ${r.status}`);
        err.data = data;
        err.status = r.status;
        if (r.status === 504 || data.timeout) err.isTimeout = true;
        throw err;
      }
      return data;
    } catch (e) {
      if (userCancelled) {
        const err = new Error("已取消请求");
        err.isCancelled = true;
        throw err;
      }
      if (timedOut || (e && e.name === "AbortError")) {
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
    if (imageUrl.startsWith("http")) return imageUrl;
    return this.base + imageUrl;
  },
};
