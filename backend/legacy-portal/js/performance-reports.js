document.addEventListener('DOMContentLoaded', async () => {
  if (typeof Auth !== 'undefined' && !Auth.requireAuth()) return;
  const token = API.getToken();

  let chartInstances = {};

  async function loadEmployees() {
    try {
      const res = await fetch('/api/employees?limit=2000', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      const list = data.data || data.employees || [];
      const select = document.getElementById('report-emp-select');
      select.innerHTML = list.map(e => `
        <option value="${e.employee_code || e.employee_id || e._id}">${e.full_name || e.name} (${e.employee_code || e.employee_id})</option>
      `).join('');
    } catch (e) {
      console.error('Error loading employees:', e);
    }
  }

  document.getElementById('report-scope-select').addEventListener('change', (e) => {
    const isInd = e.target.value === 'INDIVIDUAL';
    document.getElementById('emp-select-wrapper').style.display = isInd ? 'block' : 'none';
    document.getElementById('individual-view-wrapper').style.display = isInd ? 'block' : 'none';
    document.getElementById('company-view-wrapper').style.display = isInd ? 'none' : 'block';
  });

  async function loadAnalyticsReport() {
    const scope = document.getElementById('report-scope-select').value;
    const preset = document.getElementById('report-preset-select').value;
    const empId = document.getElementById('report-emp-select').value;

    if (scope === 'INDIVIDUAL') {
      try {
        const res = await fetch(`/api/reports/preview/individual/${empId}?preset=${preset}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const rep = await res.json();

        document.getElementById('ind-emp-name').textContent = rep.employee_name;
        document.getElementById('ind-emp-meta').textContent = `${rep.department} • ${rep.designation} (${rep.employee_id})`;
        document.getElementById('ind-score-num').textContent = Math.round(rep.score_card.overall_score);
        document.getElementById('ind-grade-badge').textContent = rep.score_card.grade;

        const trend = rep.productivity_trend;
        const trendSymbol = trend.direction === 'UP' ? '▲' : (trend.direction === 'DOWN' ? '▼' : '►');
        document.getElementById('ind-trend-badge').textContent = 
          `${trendSymbol} ${trend.delta_percentage > 0 ? '+' : ''}${trend.delta_percentage}% vs Prior Period (${trend.previous_value}h → ${trend.current_value}h)`;

        // Render Charts
        renderLineChart('dailyHoursChart', rep.daily_hours_chart.labels, rep.daily_hours_chart.datasets[0].data);
        renderDoughnutChart('taskDistChart', rep.task_distribution_chart.labels, rep.task_distribution_chart.datasets[0].data);

      } catch (e) {
        alert('Error loading individual report: ' + e.message);
      }
    } else {
      try {
        const res = await fetch(`/api/reports/preview/company?preset=${preset}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const comp = await res.json();

        document.getElementById('comp-period-label').textContent = comp.date_range_label;
        document.getElementById('comp-hours-total').textContent = `${comp.total_hours_billed_clients} hrs`;

        renderBarChart('clientBillingChart', comp.client_billing_chart.labels, comp.client_billing_chart.datasets[0].data);
        renderBarChart('blockerCatChart', comp.blocker_categories_chart.labels, comp.blocker_categories_chart.datasets[0].data, '#ef4444');

      } catch (e) {
        alert('Error loading company report: ' + e.message);
      }
    }
  }

  function renderLineChart(canvasId, labels, data) {
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
    const ctx = document.getElementById(canvasId).getContext('2d');
    chartInstances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Client Hours Logged',
          data: data,
          borderColor: '#007bff',
          backgroundColor: 'rgba(0,123,255,0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: { responsive: true, scales: { y: { beginAtZero: true } } }
    });
  }

  function renderDoughnutChart(canvasId, labels, data) {
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
    const ctx = document.getElementById(canvasId).getContext('2d');
    chartInstances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: ['#10b981', '#f59e0b', '#ef4444']
        }]
      },
      options: { responsive: true }
    });
  }

  function renderBarChart(canvasId, labels, data, color = '#3b82f6') {
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
    const ctx = document.getElementById(canvasId).getContext('2d');
    chartInstances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Hours / Count',
          data: data,
          backgroundColor: color
        }]
      },
      options: { responsive: true, scales: { y: { beginAtZero: true } } }
    });
  }

  document.getElementById('btn-load-report').addEventListener('click', loadAnalyticsReport);

  // Export handlers: queue the job, wait for it, then download the file with the session token.
  const errorText = (body, fallback) => {
    const d = body && body.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d[0] && d[0].msg) return String(d[0].msg).replace(/^Value error, /, '');
    return fallback;
  };

  async function exportReport(format) {
    const scope = document.getElementById('report-scope-select').value;
    const preset = document.getElementById('report-preset-select').value;
    const empId = document.getElementById('report-emp-select').value;
    const auth = { 'Authorization': `Bearer ${token}` };

    try {
      const res = await fetch('/api/reports/export-async', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, export_format: format, employee_id: scope === 'INDIVIDUAL' ? empId : null, preset })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(data, 'Could not start the export.'));

      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        const job = await (await fetch(`/api/reports/jobs/${data.job_id}`, { headers: auth })).json();
        if (job.status === 'FAILED') throw new Error(`Report generation failed: ${job.error || 'unknown error'}`);
        if (job.status !== 'COMPLETED') continue;
        const file = await fetch(`/api/reports/download/${data.job_id}`, { headers: auth });
        if (!file.ok) throw new Error(errorText(await file.json().catch(() => ({})), 'Download failed.'));
        const name = (file.headers.get('content-disposition') || '').match(/filename="?([^";]+)"?/);
        const url = URL.createObjectURL(await file.blob());
        const a = Object.assign(document.createElement('a'), { href: url, download: name ? name[1] : `report.${format === 'PDF' ? 'pdf' : 'xlsx'}` });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      alert('The report is taking longer than expected. You will be emailed when it is ready.');
    } catch (e) {
      alert(e.message);
    }
  }

  document.getElementById('btn-export-pdf').addEventListener('click', () => exportReport('PDF'));
  document.getElementById('btn-export-excel').addEventListener('click', () => exportReport('EXCEL'));

  await loadEmployees();
  await loadAnalyticsReport();
});
