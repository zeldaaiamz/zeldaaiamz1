/* API client for board server */
window.BoardAPI = {
  get base() {
    return (typeof window.BOARD_API_BASE === "string" ? window.BOARD_API_BASE : "").replace(/\/+$/, "");
  },
  async get(path) {
    const r = await fetch(this.base + path);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(this.base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({ ok: false, error: r.statusText }));
    if (!r.ok && !data.ok) throw Object.assign(new Error(data.error || r.statusText), { data, status: r.status });
    return data;
  },
  fileUrl(imageUrl) {
    if (!imageUrl) return "";
    if (imageUrl.startsWith("http")) return imageUrl;
    return this.base + imageUrl;
  },
};
