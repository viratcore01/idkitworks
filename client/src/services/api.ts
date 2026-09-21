import axios from 'axios';

// Production: VITE_API_URL is the bare API host (e.g. https://zoclo-api.onrender.com)
// — all Express routes live under /api, so the prefix is appended here.
// Dev: same-origin '/api' via the Vite proxy.
const API_BASE = import.meta.env.VITE_API_URL
  ? `${String(import.meta.env.VITE_API_URL).replace(/\/+$/, '')}/api`
  : '/api';

const api = axios.create({
  baseURL: API_BASE,
  // Render's free tier sleeps when idle; the request that wakes it can take
  // 30-50s. Warm-server calls finish in <1s, so this ceiling only matters on
  // cold starts — the first visitor of the day must succeed, not time out.
  timeout: 45000,
  // NOTE: no default 'Content-Type' here. A hard-coded application/json default
  // clobbers the browser's auto-generated multipart boundary on FormData
  // uploads — the server then sees an unparseable body and every photo
  // upload fails with "No photo provided". axios sets JSON automatically
  // for plain objects, and the browser sets multipart for FormData.
});

// Attach access token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh on 401
let isRefreshing = false;
let failedQueue: Array<{ resolve: (token: string) => void; reject: (error: any) => void }> = [];

function processQueue(error: any, token: string | null) {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token!);
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refreshToken');
      const onAuthPage = /^\/(login|signup)$/.test(window.location.pathname);
      if (!refreshToken) {
        localStorage.clear();
        // Never bounce people off the auth pages themselves — signup makes
        // pre-auth calls (interests/colleges) and must stay usable.
        // NOTE: client-side navigation only (see 'auth:expired' in App).
        // A window.location.href reload here re-downloads the whole bundle
        // and flashes the wrong screens for seconds — the #1 login UX bug.
        if (!onAuthPage) window.dispatchEvent(new CustomEvent('auth:expired'));
        return Promise.reject(error);
      }

      try {
        // Same base as everything else — a relative URL 404s on the SPA host in production
        const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        processQueue(null, data.accessToken);
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError: any) {
        // Rotation race: another tab may have just refreshed with this SAME
        // stored refresh token (localStorage is shared across tabs). If the
        // stored tokens changed while we were refreshing, ADOPT them and
        // retry — never rotate again, or the tabs will invalidate each
        // other forever (refresh ping-pong).
        const latestAccess = localStorage.getItem('accessToken');
        const latestRefresh = localStorage.getItem('refreshToken');
        if (
          refreshError?.response?.status === 401 &&
          latestRefresh && latestRefresh !== refreshToken &&
          latestAccess
        ) {
          processQueue(null, latestAccess);
          originalRequest.headers.Authorization = `Bearer ${latestAccess}`;
          return api(originalRequest);
        }
        processQueue(refreshError, null);
        localStorage.clear();
        if (!onAuthPage) window.dispatchEvent(new CustomEvent('auth:expired'));
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;

// ── Launch armor: retry idempotent GETs on transient failures ──
// 429/5xx/network blips are guaranteed at launch scale (bursts, deploys,
// pool saturation). Only GET is retried — never POST/PATCH/DELETE (a
// retried swipe could double-apply; the server is idempotent, but the UX
// must not depend on it). Honors Retry-After on 429, exponential backoff
// otherwise, max 2 retries. Registered AFTER the 401 interceptor above, so
// auth refresh still happens first (axios runs response interceptors in
// registration order, and a rejection here skips straight to the caller).
function retryableDelayMs(attempt: number, error: any): number {
  const ra = error?.response?.headers?.['retry-after'];
  if (ra) {
    const secs = Number(Array.isArray(ra) ? ra[0] : ra);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 5000);
  }
  return Math.min(500 * 2 ** attempt, 2000);
}

function isRetryable(error: any): boolean {
  const cfg = error?.config;
  if (!cfg || cfg.method?.toLowerCase() !== 'get') return false;
  if (cfg._retryCount != null && cfg._retryCount >= 2) return false;
  const status = error?.response?.status;
  if (status === 429) return true;
  if (status != null && status >= 500) return true;
  // No response at all = network blip / cold-start timeout.
  if (!error?.response && (error?.code === 'ECONNABORTED' || error?.code === 'ERR_NETWORK' || !error?.code)) return true;
  return false;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (isRetryable(error)) {
      const cfg = error.config;
      cfg._retryCount = (cfg._retryCount ?? 0) + 1;
      await new Promise((r) => setTimeout(r, retryableDelayMs(cfg._retryCount, error)));
      return api(cfg);
    }
    return Promise.reject(error);
  },
);
