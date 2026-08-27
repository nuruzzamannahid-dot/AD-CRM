const state = {
  range: 'today',
  manager: 'all',
  tag: 'All',
  managers: [],
  tags: [],
  subtags: [],
  selectedSubTag: null
};

const $ = (id) => document.getElementById(id);

function initialsColorAvatar(initials) {
  const span = document.createElement('span');
  span.className = 'avatar';
  span.textContent = initials;
  return span;
}

function tagPillClass(tag) {
  if (tag === 'Dissatisfied') return 'tag-red';
  if (tag === 'FB Boost') return 'tag-green';
  if (tag === 'Newly Onboarded') return 'tag-yellow';
  return 'tag-neutral';
}

function fmtTime(iso) {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' }).format(d);
}

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${path} failed: ${r.status}`);
  return r.json();
}

function qs() {
  return `range=${state.range}&manager=${encodeURIComponent(state.manager)}`;
}

// ---- Loaders ------------------------------------------------------------

async function loadReferenceData() {
  const [managers, tags, subtags] = await Promise.all([
    api('/api/managers'), api('/api/tags'), api('/api/subtags')
  ]);
  state.managers = managers;
  state.tags = tags;
  state.subtags = subtags;

  const managerSelect = $('managerSelect');
  managers.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.name; opt.textContent = m.name;
    managerSelect.appendChild(opt);
  });

  const formManager = $('formManager');
  formManager.innerHTML = '';
  managers.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id; opt.textContent = m.name;
    formManager.appendChild(opt);
  });

  const formTag = $('formReasonTag');
  tags.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    formTag.appendChild(opt);
  });

  const chipRow = $('chipRow');
  tags.forEach((t) => {
    const chip = document.createElement('span');
    chip.className = 'chip'; chip.dataset.tag = t; chip.textContent = t;
    chip.onclick = () => { state.tag = t; refreshChips(); refreshCallLog(); };
    chipRow.appendChild(chip);
  });

  const subTagChips = $('subTagChips');
  subtags.forEach((s) => {
    const chip = document.createElement('span');
    chip.className = 'sub-chip'; chip.textContent = s;
    chip.onclick = () => {
      state.selectedSubTag = s;
      $('formSubTag').value = s;
      [...subTagChips.children].forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    };
    subTagChips.appendChild(chip);
  });
}

function refreshChips() {
  [...$('chipRow').children].forEach((c) => {
    c.classList.toggle('active', c.dataset.tag === state.tag);
  });
}

async function refreshTopbar() {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka' }).format(now);
  const managerLabel = state.manager === 'all' ? 'All AD managers' : state.manager;
  $('topbarSub').textContent = `${dateStr} · ${managerLabel}`;
}

async function refreshMetrics() {
  const m = await api(`/api/metrics?${qs()}`);
  $('mCalls').textContent = m.calls_logged.value;
  $('mCallsDelta').textContent = deltaText(m.calls_logged.delta, 'vs yesterday');
  $('mCallsDelta').className = 'delta ' + (m.calls_logged.delta >= 0 ? 'up' : 'down');

  $('mDissat').textContent = `${m.dissatisfaction_rate.value}%`;
  $('mDissatDelta').textContent = deltaText(m.dissatisfaction_rate.delta, 'pt vs yesterday');
  $('mDissatDelta').className = 'delta ' + (m.dissatisfaction_rate.delta > 0 ? 'down' : 'up');

  $('mOnboard').textContent = m.newly_onboarded.value;
  $('mOnboardDelta').textContent = deltaText(m.newly_onboarded.delta, 'vs yesterday');
  $('mOnboardDelta').className = 'delta ' + (m.newly_onboarded.delta >= 0 ? 'up' : 'down');

  $('mInactive').textContent = m.business_inactive.value;
  $('mInactiveDelta').textContent = deltaText(m.business_inactive.delta, 'vs yesterday');
  $('mInactiveDelta').className = 'delta ' + (m.business_inactive.delta > 0 ? 'down' : 'up');
}

function deltaText(n, suffix) {
  const arrow = n >= 0 ? '▲' : '▼';
  return `${arrow} ${Math.abs(n)} ${suffix}`;
}

async function refreshPerformance() {
  const rows = await api(`/api/performance?range=${state.range}`);
  const body = $('performanceBody');
  body.innerHTML = '';
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.manager_name}</td>
      <td>${r.calls}</td>
      <td>${r.reached}</td>
      <td>${r.reach_rate}%</td>
      <td>${r.dissatisfied}</td>
      <td>${r.resolved}</td>
      <td>${r.resolution_rate}%</td>
    `;
    body.appendChild(tr);
  });
}

async function refreshBreakdown() {
  const b = await api(`/api/breakdown?manager=${encodeURIComponent(state.manager)}`);
  const containers = document.querySelectorAll('.js-breakdown');
  containers.forEach((container) => {
    container.innerHTML = '';
    if (!b.rows.length) {
      container.innerHTML = '<div class="panel-sub">No dissatisfaction tags logged yet.</div>';
      return;
    }
    b.rows.forEach((row, i) => {
      const div = document.createElement('div');
      div.className = 'bar-row';
      div.innerHTML = `
        <div class="bar-top"><span>${row.sub_tag}</span><span>${row.pct}%</span></div>
        <div class="bar-track"><div class="bar-fill ${i === 0 ? 'yellow' : ''}" style="width:${row.pct}%;"></div></div>
      `;
      container.appendChild(div);
    });
  });
}

async function refreshCallLog() {
  const params = new URLSearchParams({ range: state.range, manager: state.manager, tag: state.tag });
  const rows = await api(`/api/calls?${params.toString()}`);
  const bodies = document.querySelectorAll('.js-call-log-body');
  bodies.forEach((body) => {
    body.innerHTML = '';
    if (!rows.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="5">No calls logged for this filter yet.</td></tr>';
      return;
    }
    rows.forEach((c) => {
      const tr = document.createElement('tr');

      const tdMerchant = document.createElement('td');
      tdMerchant.innerHTML = `<span class="merchant">${c.merchant_name}</span><br><span class="merchant-sub">${c.mid}</span>`;

      const tdManager = document.createElement('td');
      tdManager.appendChild(initialsColorAvatar(c.manager_initials));
      tdManager.appendChild(document.createTextNode(c.manager_name));

      const tdTag = document.createElement('td');
      tdTag.innerHTML = `<span class="tag-pill ${tagPillClass(c.reason_tag)}">${c.reason_tag}</span>`;

      const tdSub = document.createElement('td');
      tdSub.innerHTML = c.sub_tag ? `<span class="tag-pill tag-neutral">${c.sub_tag}</span>` : '—';

      const tdTime = document.createElement('td');
      tdTime.textContent = fmtTime(c.created_at);

      tr.append(tdMerchant, tdManager, tdTag, tdSub, tdTime);
      body.appendChild(tr);
    });
  });
}

async function refreshFunnel() {
  const f = await api(`/api/funnel?manager=${encodeURIComponent(state.manager)}`);
  $('funnelAssigned').textContent = f.assigned;
  $('funnelCalled').textContent = f.called;
  $('funnelReached').textContent = f.reached;
  $('funnelDissatisfied').textContent = f.dissatisfied;
  $('funnelResolved').textContent = f.resolved;
}

async function refreshMerchantDirectory(query = '') {
  const body = $('merchantDirectoryBody');
  body.innerHTML = '<tr class="empty-row"><td colspan="2">Loading…</td></tr>';
  const results = await api(`/api/merchants?search=${encodeURIComponent(query)}`);
  body.innerHTML = '';
  if (!results.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="2">No merchants found.</td></tr>';
    return;
  }
  results.forEach((m) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${m.name}</td><td>${m.mid}</td>`;
    body.appendChild(tr);
  });
}

async function refreshAll() {
  await refreshTopbar();
  await Promise.all([refreshMetrics(), refreshPerformance(), refreshBreakdown(), refreshCallLog(), refreshFunnel()]);
}

// ---- Merchant search ------------------------------------------------------

let searchTimeout;
$('merchantSearch').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  $('merchantId').value = '';
  if (!q) { $('merchantDropdown').style.display = 'none'; return; }
  searchTimeout = setTimeout(async () => {
    const results = await api(`/api/merchants?search=${encodeURIComponent(q)}`);
    const dd = $('merchantDropdown');
    dd.innerHTML = '';
    if (!results.length) { dd.style.display = 'none'; return; }
    results.forEach((m) => {
      const div = document.createElement('div');
      div.textContent = `${m.name} — ${m.mid}`;
      div.onclick = () => {
        $('merchantSearch').value = `${m.name} (${m.mid})`;
        $('merchantId').value = m.id;
        dd.style.display = 'none';
      };
      dd.appendChild(div);
    });
    dd.style.display = 'block';
  }, 200);
});

// ---- Form: reason tag -> sub-tag box toggle -------------------------------

$('formReasonTag').addEventListener('change', (e) => {
  const isDissatisfied = e.target.value === 'Dissatisfied';
  $('subTagBox').classList.toggle('show', isDissatisfied);
  if (!isDissatisfied) {
    $('formSubTag').value = '';
    state.selectedSubTag = null;
    [...$('subTagChips').children].forEach((c) => c.classList.remove('active'));
  }
});

// ---- Form submit -----------------------------------------------------------

$('callForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const merchant_id = $('merchantId').value;
  if (!merchant_id) { alert('Pick a merchant from the search results first.'); return; }

  const payload = {
    merchant_id: Number(merchant_id),
    ad_manager_id: Number($('formManager').value),
    reason_tag: $('formReasonTag').value,
    sub_tag: $('formSubTag').value || null,
    follow_up_date: $('formFollowUp').value || null,
    notes: $('formNotes').value || null
  };

  await api('/api/calls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

  $('callForm').reset();
  $('merchantId').value = '';
  $('subTagBox').classList.remove('show');
  closeEntryForm();
  await refreshAll();
});

// ---- Top filters -----------------------------------------------------------

$('rangeSelect').addEventListener('change', (e) => { state.range = e.target.value; refreshAll(); });
$('managerSelect').addEventListener('change', (e) => { state.manager = e.target.value; refreshAll(); });

document.addEventListener('click', (e) => {
  if (!$('merchantResults').contains(e.target)) $('merchantDropdown').style.display = 'none';
});

// ---- Sidebar navigation -----------------------------------------------------

const VIEW_TITLES = {
  dashboard: 'Daily call tracking dashboard',
  calllog: 'Call log',
  adperf: 'AD performance',
  dissatisfaction: 'Dissatisfaction tags',
  merchants: 'Merchant directory',
  admanagerperf: 'AD manager performance'
};

let merchantDirectoryLoaded = false;

function showView(viewKey) {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === viewKey);
  });
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('active', view.id === `view-${viewKey}`);
  });
  $('pageTitle').textContent = VIEW_TITLES[viewKey] || VIEW_TITLES.dashboard;

  if (viewKey === 'merchants' && !merchantDirectoryLoaded) {
    merchantDirectoryLoaded = true;
    refreshMerchantDirectory('');
  }
}

$('sideNav').addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item');
  if (!item) return;
  showView(item.dataset.view);
});

// ---- Merchant directory search ----------------------------------------------

let directorySearchTimeout;
$('merchantDirectorySearch').addEventListener('input', (e) => {
  clearTimeout(directorySearchTimeout);
  const q = e.target.value.trim();
  directorySearchTimeout = setTimeout(() => refreshMerchantDirectory(q), 200);
});

// ---- New call entry modal ----------------------------------------------------

function openEntryForm() {
  $('entryFormWrap').classList.add('show');
}

function closeEntryForm() {
  $('entryFormWrap').classList.remove('show');
}

$('openFormBtn').addEventListener('click', openEntryForm);
$('closeFormBtn').addEventListener('click', closeEntryForm);
$('cancelFormBtn').addEventListener('click', closeEntryForm);

// Clicking the dimmed backdrop (outside the form card) closes the modal too
$('entryFormWrap').addEventListener('click', (e) => {
  if (e.target === $('entryFormWrap')) closeEntryForm();
});

// ---- Boot -----------------------------------------------------------------

(async function init() {
  await loadReferenceData();
  await refreshAll();
  setInterval(refreshAll, 60000); // keep the dashboard live without a manual refresh
})();
