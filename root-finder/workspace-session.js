/* Share the main site's Supabase session; never store a separate password. */
window.RootFinderAuth = (() => {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const config = window.APP_CONFIG;
  const client = local ? null : window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  sessionStorage.removeItem('rootFinderToken');
  async function getAccessToken() {
    if (local) return '';
    const {data, error} = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      const home = new URL('../', location.href);
      home.searchParams.set('returnTo', location.pathname + location.search);
      location.replace(home.href);
      throw new Error('请先登录总网站，登录后将返回当前页面');
    }
    return data.session.access_token;
  }
  return Object.freeze({getAccessToken});
})();
