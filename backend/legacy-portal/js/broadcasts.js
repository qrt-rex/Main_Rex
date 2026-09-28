document.addEventListener('DOMContentLoaded', async () => {
  if (typeof Auth !== 'undefined' && !Auth.requireAuth()) return;
  const token = API.getToken();
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function loadMyInAppNotifications() {
    const container = document.getElementById('in-app-feed-container');
    try {
      const res = await fetch('/api/broadcasts/in-app/my-notifications', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      const list = data.data || [];

      if (list.length === 0) {
        container.innerHTML = '<p style="color:#64748b; font-size:13px;">No unread broadcast notifications.</p>';
        return;
      }

      container.innerHTML = list.map(n => `
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:bold; font-size:14px; color:#09234b;">${esc(n.title)}</div>
            <div style="font-size:12px; color:#64748b; margin-top:2px;">${n.created_at ? n.created_at.split('T')[0] : 'Recent'}</div>
          </div>
          <div>
            ${n.requires_action ? `
              <button class="btn btn-gold btn-sm btn-ack-bcast" data-id="${n.reference_id}">
                ✓ Acknowledge Read
              </button>
            ` : '<span style="color:#10b981; font-size:12px;">Delivered</span>'}
          </div>
        </div>
      `).join('');

      document.querySelectorAll('.btn-ack-bcast').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            const bId = btn.dataset.id;
            const ackRes = await fetch(`/api/broadcasts/acknowledge/${bId}`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (ackRes.ok) {
              alert('Announcement acknowledged successfully!');
              loadMyInAppNotifications();
            }
          } catch (e) {
            alert('Error acknowledging: ' + e.message);
          }
        });
      });

    } catch (e) {
      container.innerHTML = `<p style="color:red; font-size:13px;">Error: ${e.message}</p>`;
    }
  }

  const AUDIENCE_LABELS = { ALL_EMPLOYEES: 'All Employees', DEPARTMENT: 'Department', CUSTOM_LIST: 'Custom List' };

  async function loadPublishedBroadcasts() {
    const tbody = document.getElementById('broadcasts-tbody');
    try {
      const res = await fetch('/api/broadcasts', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const list = res.ok ? ((await res.json()).data || []) : [];

      if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#64748b;">No broadcast history found.</td></tr>';
        return;
      }

      tbody.innerHTML = list.map((b) => {
        const readPct = b.read_percentage || 0;
        const ackPct = b.acknowledged_percentage || 0;
        let priorityClass = 'priority-badge-info';
        if (b.priority === 'IMPORTANT') priorityClass = 'priority-badge-important';
        else if (b.priority === 'POLICY_UPDATE') priorityClass = 'priority-badge-policy';
        else if (b.priority === 'CRITICAL_EMERGENCY') priorityClass = 'priority-badge-critical';

        return `
        <tr>
          <td><strong>${esc(b.title)}</strong></td>
          <td><span class="rule-badge ${priorityClass}">${esc(b.priority)}</span></td>
          <td>${esc(AUDIENCE_LABELS[b.audience_type] || 'All Employees')}</td>
          <td><strong>${b.total_recipients}</strong></td>
          <td><span style="color:#10b981; font-weight:bold;">${b.total_recipients} Sent</span></td>
          <td style="min-width:140px;">
            <div style="font-size:12px; font-weight:bold;">${b.read_count}/${b.total_recipients} (${readPct}%)</div>
            <div class="progress-bar-sm"><div class="progress-fill-sm" style="width:${readPct}%;"></div></div>
          </td>
          <td style="min-width:140px;">
            <div style="font-size:12px; font-weight:bold;">${b.acknowledged_count}/${b.total_recipients} (${ackPct}%)</div>
            <div class="progress-bar-sm"><div class="progress-fill-sm" style="width:${ackPct}%; background:#3b82f6;"></div></div>
          </td>
          <td style="font-size:12px; color:#64748b;">${b.created_at ? String(b.created_at).split('T')[0] : 'Recent'}</td>
        </tr>`;
      }).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:#64748b;">Ready for new broadcasts.</td></tr>`;
    }
  }

  // Toggle Department selector
  const audienceSelect = document.getElementById('bcast-audience');
  if (audienceSelect) {
    audienceSelect.addEventListener('change', (e) => {
      const deptGroup = document.getElementById('dept-select-group');
      if (deptGroup) deptGroup.style.display = (e.target.value === 'DEPARTMENT') ? 'block' : 'none';
    });
  }

  // Modal open
  const btnOpenBcast = document.getElementById('btn-open-create-broadcast');
  if (btnOpenBcast) {
    btnOpenBcast.addEventListener('click', () => {
      const modal = document.getElementById('create-broadcast-modal');
      if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
      }
    });
  }

  // Publish Form Submit
  const bcastForm = document.getElementById('create-broadcast-form');
  if (bcastForm) {
    bcastForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const audience = document.getElementById('bcast-audience').value;
      const dept = document.getElementById('bcast-dept')?.value;

      const payload = {
        title: document.getElementById('bcast-title').value,
        priority: document.getElementById('bcast-priority').value,
        audience_type: audience,
        target_departments: audience === 'DEPARTMENT' ? [dept] : [],
        rich_html_content: document.getElementById('bcast-content').value,
        requires_acknowledgment: document.getElementById('bcast-req-ack').checked,
        send_email: document.getElementById('bcast-send-email').checked
      };

      try {
        const data = await API.post('/broadcasts/publish', payload);
        if (typeof Toast !== 'undefined') Toast.success(data.message || 'Broadcast published successfully!');
        else alert(`[BROADCAST PUBLISHED] ${data.message}`);
        
        const modal = document.getElementById('create-broadcast-modal');
        if (modal) {
          modal.style.display = 'none';
          modal.classList.remove('active');
        }
        bcastForm.reset();
        loadMyInAppNotifications();
        loadPublishedBroadcasts();
      } catch (err) {
        if (typeof Toast !== 'undefined') Toast.error(err.message || 'Failed to publish broadcast');
        else alert(`[ERROR] ${err.message}`);
      }
    });
  }

  await loadMyInAppNotifications();
  await loadPublishedBroadcasts();
});
