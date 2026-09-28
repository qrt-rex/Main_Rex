/**
 * Rexera HR Management System - API Client & Toast Notification Hub
 */

const API = {
  // Base URL is relative to origin for full-stack integration
  baseURL: window.location.origin + '/api',

  getToken() {
    return localStorage.getItem('rexera_token');
  },

  setToken(token) {
    localStorage.setItem('rexera_token', token);
  },

  clearToken() {
    localStorage.removeItem('rexera_token');
    localStorage.removeItem('rexera_admin');
  },

  getAdmin() {
    try {
      return JSON.parse(localStorage.getItem('rexera_admin') || 'null');
    } catch (e) {
      return null;
    }
  },

  setAdmin(adminData) {
    localStorage.setItem('rexera_admin', JSON.stringify(adminData));
  },

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      // Handle 401 Unauthorized
      if (response.status === 401) {
        // If not on login page, redirect
        if (!window.location.pathname.includes('admin-login') && 
            !window.location.pathname.includes('joining') && 
            !window.location.pathname.endsWith('index.html') &&
            window.location.pathname !== '/') {
          this.clearToken();
          window.location.href = '/admin-login.html';
        }
      }

      const contentType = response.headers.get('content-type');
      let data;
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        const errorDetail = (data && data.detail) || (data && data.message) || 'An unexpected error occurred';
        throw new Error(errorDetail);
      }

      return data;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  },

  get(endpoint, params = {}) {
    const query = new URLSearchParams(params).toString();
    const url = query ? `${endpoint}?${query}` : endpoint;
    return this.request(url, { method: 'GET' });
  },

  post(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  put(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  },

  patch(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
};

/**
 * Toast Notification System
 */
const Toast = {
  container: null,

  init() {
    if (!this.container) {
      let el = document.getElementById('toast-container');
      if (!el) {
        el = document.createElement('div');
        el.id = 'toast-container';
        document.body.appendChild(el);
      }
      this.container = el;
    }
  },

  show(message, type = 'info', duration = 4000) {
    this.init();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const iconMap = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };

    toast.innerHTML = `
      <div style="font-weight: 800; font-size: 16px; min-width: 20px;">${iconMap[type] || 'ℹ'}</div>
      <div style="flex: 1; font-size: 13px;">${message}</div>
      <button style="background: none; border: none; cursor: pointer; color: #94a3b8; font-size: 16px;" onclick="this.parentElement.remove()">✕</button>
    `;

    this.container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error'); },
  warning(msg) { this.show(msg, 'warning'); },
  info(msg) { this.show(msg, 'info'); }
};

/**
 * Confirm Dialog System (replaces native window.confirm, which can be
 * silently blocked by browsers/extensions and gives no branding control)
 */
const Confirm = {
  show(message, options = {}) {
    const { title = 'Please Confirm', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = options;

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay active';
      overlay.innerHTML = `
        <div class="modal-box" style="max-width: 440px;">
          <div class="modal-header">
            <h3 style="margin: 0; font-size: 16px;">${title}</h3>
          </div>
          <div class="modal-body" style="font-size: 14px; color: var(--text-muted); line-height: 1.5;">${message}</div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline" data-action="cancel">${cancelText}</button>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${confirmText}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const cleanup = (result) => {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        resolve(result);
      };

      const onKeydown = (e) => {
        if (e.key === 'Escape') cleanup(false);
      };

      overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => cleanup(false));
      overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => cleanup(true));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup(false);
      });
      document.addEventListener('keydown', onKeydown);
    });
  }
};

// Convenience alias so callers can use API.toast(message, type) interchangeably with Toast.show
API.toast = (message, type = 'info') => Toast.show(message, type);

window.API = API;

// Escapes text before it is placed into an HTML template (prevents stored XSS from user-entered data).
window.escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.Toast = Toast;
window.Confirm = Confirm;

// Keep the sidebar menu steady between pages: restore its scroll position and keep the active item in view.
document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return;
  const KEY = 'rexera_nav_scroll';
  const save = () => { try { sessionStorage.setItem(KEY, String(nav.scrollTop)); } catch (e) { /* storage unavailable */ } };
  try {
    const saved = sessionStorage.getItem(KEY);
    if (saved !== null) nav.scrollTop = parseInt(saved, 10) || 0;
  } catch (e) { /* storage unavailable */ }
  const active = nav.querySelector('.nav-link.active');
  if (active) {
    const a = active.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    if (a.top < n.top || a.bottom > n.bottom) active.scrollIntoView({ block: 'center' });
  }
  nav.addEventListener('click', save);
  window.addEventListener('pagehide', save);
});
