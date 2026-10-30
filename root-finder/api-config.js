window.ROOT_FINDER_API_BASE = ['127.0.0.1','localhost'].includes(location.hostname) ? '' : 'https://47.98.137.124';

// Persist only the server-issued credential; passwords are never stored.
window.RootFinderAuth = {
  get(){
    let token='';
    try { token=localStorage.getItem('rootFinderToken')||''; } catch (_) {}
    if(!token)try { token=sessionStorage.getItem('rootFinderToken')||''; } catch (_) {}
    if(token)this.set(token);
    return token;
  },
  set(token){
    try { localStorage.setItem('rootFinderToken',token); } catch (_) {}
    try { sessionStorage.setItem('rootFinderToken',token); } catch (_) {}
  },
  clear(){
    try { localStorage.removeItem('rootFinderToken'); } catch (_) {}
    try { sessionStorage.removeItem('rootFinderToken'); } catch (_) {}
  }
};
