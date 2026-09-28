/**
 * Rexera HR Management System - Authentication, Session Guard & Inactivity Timeout
 */

const Auth = {
  _inactivityTimer: null,
  _warningTimer: null,
  _timeoutMs: 60 * 60 * 1000, // Default 1 hour; updated from server config
  _warningMs: 30 * 1000, // Show warning toast 30 seconds before logout
  _warningShown: false,

  checkAuth() {
    const token = API.getToken();
    const publicPages = ['/admin-login.html', '/joining-login.html', '/joining-form.html', '/index.html', '/'];
    const currentPath = window.location.pathname;

    const isPublic = publicPages.some(p => currentPath === p || (p === '/' && (currentPath === '' || currentPath === '/index.html')));

    if (!token && !isPublic) {
      window.location.href = '/admin-login.html';
    } else if (token && currentPath.includes('admin-login')) {
      window.location.href = '/dashboard.html';
    }
  },

  requireAuth() {
    const token = API.getToken();
    if (!token) {
      window.location.href = '/admin-login.html';
      return false;
    }
    return true;
  },

  initSidebarUser() {
    const admin = API.getAdmin();
    const userNameEl = document.getElementById('sidebar-user-name');
    const userRoleEl = document.getElementById('sidebar-user-role');
    const userAvatarEl = document.getElementById('sidebar-user-avatar');

    if (admin) {
      if (userNameEl) userNameEl.textContent = admin.admin_name || admin.email || 'Admin';
      if (userRoleEl) userRoleEl.textContent = (admin.role || 'Superadmin').toUpperCase();
      if (userAvatarEl) {
        const initial = (admin.admin_name || admin.email || 'A').charAt(0).toUpperCase();
        userAvatarEl.textContent = initial;
      }
    }
  },

  async logout(reason) {
    const token = API.getToken();
    if (token) {
      try {
        if (reason === 'timeout') {
          await API.post('/auth/session-timeout');
        } else {
          await API.post('/auth/logout');
        }
      } catch (e) {
        // Ignore errors during logout API call (token may already be expired)
      }
    }
    API.clearToken();
    if (reason === 'timeout') {
      Toast.warning('Session expired due to inactivity. Please log in again.');
    } else {
      Toast.info('Logged out successfully.');
    }
    setTimeout(() => {
      window.location.href = '/admin-login.html';
    }, 500);
  },

  // ─── Inactivity Timeout System ─────────────────────────────────────
  async initInactivityTracker() {
    const token = API.getToken();
    if (!token) return;

    // Fetch timeout config from server
    try {
      const config = await fetch(API.baseURL + '/auth/session-config').then(r => r.json());
      if (config.session_timeout_minutes) {
        this._timeoutMs = config.session_timeout_minutes * 60 * 1000;
      }
    } catch (e) {
      // Use default 60 min
    }

    // Track user activity events
    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    const resetFn = () => this._resetInactivityTimer();

    activityEvents.forEach(evt => {
      document.addEventListener(evt, resetFn, { passive: true });
    });

    // Store last activity timestamp
    this._updateLastActivity();
    this._resetInactivityTimer();
  },

  _updateLastActivity() {
    localStorage.setItem('rexera_last_activity', Date.now().toString());
  },

  _resetInactivityTimer() {
    this._updateLastActivity();

    // Clear existing timers
    if (this._inactivityTimer) clearTimeout(this._inactivityTimer);
    if (this._warningTimer) clearTimeout(this._warningTimer);
    this._warningShown = false;

    // Dismiss any existing warning toast
    const existingWarning = document.querySelector('.session-warning-toast');
    if (existingWarning) existingWarning.remove();

    // Set warning timer (fires 30s before actual timeout)
    const warningDelay = Math.max(0, this._timeoutMs - this._warningMs);
    this._warningTimer = setTimeout(() => {
      this._showTimeoutWarning();
    }, warningDelay);

    // Set main logout timer
    this._inactivityTimer = setTimeout(() => {
      this._handleTimeout();
    }, this._timeoutMs);
  },

  _showTimeoutWarning() {
    if (this._warningShown) return;
    this._warningShown = true;

    Toast.init();
    const toast = document.createElement('div');
    toast.className = 'toast toast-warning session-warning-toast';
    toast.style.cssText = 'animation: none; opacity: 1; border-left: 4px solid #f59e0b;';
    toast.innerHTML = `
      <div style="font-weight: 800; font-size: 16px; min-width: 20px;">⏱️</div>
      <div style="flex: 1; font-size: 13px;">
        <strong>Session expiring soon!</strong><br>
        You will be logged out in 30 seconds due to inactivity.
        <br><a href="#" onclick="Auth._resetInactivityTimer(); this.closest('.toast').remove(); return false;" 
               style="color: #2563eb; font-weight: 600; text-decoration: underline;">Stay logged in</a>
      </div>
      <button style="background: none; border: none; cursor: pointer; color: #94a3b8; font-size: 16px;" 
              onclick="Auth._resetInactivityTimer(); this.parentElement.remove()">✕</button>
    `;
    Toast.container.appendChild(toast);
  },

  _handleTimeout() {
    const token = API.getToken();
    if (!token) return; // Already logged out
    this.logout('timeout');
  },

  // Check on page load if session already timed out (e.g. tab was inactive)
  checkSessionExpiry() {
    const token = API.getToken();
    if (!token) return;

    const lastActivity = parseInt(localStorage.getItem('rexera_last_activity') || '0');
    if (lastActivity > 0) {
      const elapsed = Date.now() - lastActivity;
      if (elapsed >= this._timeoutMs) {
        this.logout('timeout');
        return;
      }
    }
  }
};

// Auto-run auth guard on DOM load
document.addEventListener('DOMContentLoaded', () => {
  Auth.checkAuth();
  Auth.initSidebarUser();
  Auth.checkSessionExpiry();
  Auth.initInactivityTracker();

  // Mobile menu toggle handler
  const menuToggleBtn = document.getElementById('menu-toggle');
  const sidebar = document.querySelector('.app-sidebar');
  if (menuToggleBtn && sidebar) {
    menuToggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('mobile-open');
    });
  }

  // Logout button bindings
  const logoutBtns = document.querySelectorAll('.btn-logout');
  logoutBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      Auth.logout('manual');
    });
  });
});

/**
 * Universal Show / Hide Password Toggle
 */
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerHTML = '🙈';
    btn.title = 'Hide Password';
  } else {
    input.type = 'password';
    btn.innerHTML = '👁️';
    btn.title = 'Show Password';
  }
}

window.Auth = Auth;
window.togglePasswordVisibility = togglePasswordVisibility;
