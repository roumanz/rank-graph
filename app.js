const COLORS = [
  '#d97706', '#2563eb', '#059669', '#dc2626', '#7c3aed',
  '#0891b2', '#db2777', '#4f46e5', '#65a30d', '#ea580c'
];

const DASH_PATTERNS = [
  [],
  [6, 4],
  [2, 3],
  [10, 4, 2, 4],
  [8, 3, 2, 3, 2, 3]
];

function loadSavedAthletes() {
  try {
    const raw = localStorage.getItem('oris_selected_athletes');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

const state = {
  typeId: null,
  periodMode: 'lastYear', // 'lastYear' | 'custom'
  topGender: 'M', // 'M' | 'F'
  selectedAthletes: loadSavedAthletes(),
  clubMembers: [],
  chart: null,
  searchTimer: null,
  activeDatasetIndex: null,
  lastLabels: [],
  lastRawSeries: [],
};

// DOM prvky
const elType = document.getElementById('rankingType');
const elBtnLastYear = document.getElementById('btnLastYear');
const elBtnCustom = document.getElementById('btnCustomRange');
const elCustomBox = document.getElementById('customDatesBox');
const elDateFrom = document.getElementById('dateFrom');
const elDateTo = document.getElementById('dateTo');
const elSearch = document.getElementById('athleteSearch');
const elSearchResults = document.getElementById('searchResults');
const elClubCode = document.getElementById('clubCode');
const elBtnLoadClub = document.getElementById('btnLoadClub');
const elClubBox = document.getElementById('clubMembersBox');
const elClubTitle = document.getElementById('clubMembersTitle');
const elClubList = document.getElementById('clubMembersList');
const elBtnCloseClub = document.getElementById('btnCloseClub');
const elBtnAddAllClub = document.getElementById('btnAddAllClub');
const elBtnClearClub = document.getElementById('btnClearClub');
const elBtnGenderM = document.getElementById('btnGenderM');
const elBtnGenderF = document.getElementById('btnGenderF');
const elBtnLoadTop10 = document.getElementById('btnLoadTop10');
const elBtnAddTop10 = document.getElementById('btnAddTop10');
const elSelectedChips = document.getElementById('selectedAthletes');
const elStatus = document.getElementById('statusBar');
const elBtnShareLink = document.getElementById('btnShareLink');
const elShareFeedback = document.getElementById('shareFeedback');
const elSummaryCard = document.getElementById('summaryTableCard');
const elSummaryThead = document.querySelector('#rankingSummaryTable thead');
const elSummaryTbody = document.querySelector('#rankingSummaryTable tbody');

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showStatus(msg) {
  if (!msg) {
    elStatus.classList.add('hidden');
    return;
  }
  elStatus.textContent = msg;
  elStatus.classList.remove('hidden');
}

function getPeriodRange() {
  const now = new Date();
  const toStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  if (state.periodMode === 'lastYear') {
    const past = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const fromStr = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-01`;
    return { from: fromStr, to: toStr };
  }

  const fromVal = elDateFrom.value ? `${elDateFrom.value}-01` : toStr;
  const toVal = elDateTo.value ? `${elDateTo.value}-01` : toStr;
  return { from: fromVal, to: toVal };
}

function initDefaultDates() {
  const now = new Date();
  const past = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  elDateTo.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  elDateFrom.value = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}`;
}

function applyUrlStateBeforeTypes() {
  const params = new URLSearchParams(window.location.search);

  const period = params.get('period');
  if (period === 'custom') {
    state.periodMode = 'custom';
    elBtnCustom.classList.add('active');
    elBtnLastYear.classList.remove('active');
    elCustomBox.classList.remove('hidden');
  } else if (period === 'lastYear') {
    state.periodMode = 'lastYear';
    elBtnLastYear.classList.add('active');
    elBtnCustom.classList.remove('active');
    elCustomBox.classList.add('hidden');
  }

  const fromParam = params.get('from');
  const toParam = params.get('to');
  if (fromParam && /^\d{4}-\d{2}/.test(fromParam)) {
    elDateFrom.value = fromParam.slice(0, 7);
    if (!period) {
      state.periodMode = 'custom';
      elBtnCustom.classList.add('active');
      elBtnLastYear.classList.remove('active');
      elCustomBox.classList.remove('hidden');
    }
  }
  if (toParam && /^\d{4}-\d{2}/.test(toParam)) {
    elDateTo.value = toParam.slice(0, 7);
    if (!period) {
      state.periodMode = 'custom';
      elBtnCustom.classList.add('active');
      elBtnLastYear.classList.remove('active');
      elCustomBox.classList.remove('hidden');
    }
  }

  const regsParam = params.get('regs');
  if (regsParam !== null) {
    const regs = regsParam
      .split(',')
      .map(r => r.trim().toUpperCase())
      .filter(Boolean);

    state.selectedAthletes = regs.map(reg => {
      const existing = state.selectedAthletes.find(a => a.reg_no === reg);
      return existing || { reg_no: reg, name: reg };
    });
    saveSelected();
  }
}

function buildShareUrl() {
  const params = new URLSearchParams();
  if (state.typeId) {
    params.set('type', String(state.typeId));
  }
  params.set('period', state.periodMode);
  if (state.periodMode === 'custom') {
    if (elDateFrom.value) params.set('from', elDateFrom.value);
    if (elDateTo.value) params.set('to', elDateTo.value);
  }
  const regs = state.selectedAthletes.map(a => a.reg_no);
  if (regs.length > 0) {
    params.set('regs', regs.join(','));
  }
  const url = new URL(window.location.href);
  url.search = params.toString();
  return url.toString();
}

function syncUrlQuietly() {
  const shareUrl = buildShareUrl();
  window.history.replaceState(null, '', shareUrl);
}

async function loadRankingTypes() {
  const params = new URLSearchParams(window.location.search);
  const urlType = params.get('type');

  try {
    const res = await fetch('api.php?action=types');
    const data = await res.json();
    if (!data.types || data.types.length === 0) {
      elType.innerHTML = '<option value="1">Ranking OB (výchozí)</option>';
      state.typeId = urlType || '1';
      return;
    }

    elType.innerHTML = data.types
      .map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
      .join('');

    const matched = urlType && data.types.some(t => String(t.id) === String(urlType));
    state.typeId = matched ? String(urlType) : String(data.types[0].id);
    elType.value = state.typeId;
  } catch (err) {
    showStatus('Nepodařilo se načíst typy rankingů.');
  }
}

function saveSelected() {
  try {
    localStorage.setItem('oris_selected_athletes', JSON.stringify(state.selectedAthletes));
  } catch (_) {
    // Ignorovat chyby úložiště (např. privátní režim)
  }
}

function renderSelectedChips() {
  elSelectedChips.innerHTML = '';
  if (state.selectedAthletes.length === 0) {
    elSelectedChips.innerHTML = '<span style="color:#9ca3af;font-size:0.85rem;">Zatím nikdo nevybrán – vyhledejte závodníka výše.</span>';
    return;
  }

  state.selectedAthletes.forEach((athlete, idx) => {
    const color = COLORS[idx % COLORS.length];
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.backgroundColor = color;
    chip.innerHTML = `
      <span>${escapeHtml(athlete.name)} (${escapeHtml(athlete.reg_no)})</span>
      <button type="button" title="Odebrat">&times;</button>
    `;
    chip.querySelector('button').addEventListener('click', () => {
      removeAthlete(athlete.reg_no);
    });
    elSelectedChips.appendChild(chip);
  });
}

function toggleAthlete(athlete) {
  const exists = state.selectedAthletes.some(a => a.reg_no === athlete.reg_no);
  if (exists) {
    removeAthlete(athlete.reg_no);
  } else {
    state.selectedAthletes.push(athlete);
    saveSelected();
    renderSelectedChips();
    updateClubPillsState();
    refreshChart();
  }
}

function addAthletesBulk(list) {
  if (!Array.isArray(list) || !list.length) return false;
  const existingRegs = new Set(state.selectedAthletes.map(a => a.reg_no));
  let added = false;

  list.forEach(a => {
    if (a?.reg_no && !existingRegs.has(a.reg_no)) {
      state.selectedAthletes.push({
        reg_no: a.reg_no,
        name: a.name || a.reg_no,
      });
      existingRegs.add(a.reg_no);
      added = true;
    }
  });

  if (added) {
    saveSelected();
    renderSelectedChips();
    updateClubPillsState();
    refreshChart();
  }
  return added;
}

function removeAthlete(regNo) {
  state.selectedAthletes = state.selectedAthletes.filter(a => a.reg_no !== regNo);
  saveSelected();
  renderSelectedChips();
  updateClubPillsState();
  refreshChart();
}

function updateClubPillsState() {
  const pills = elClubList.querySelectorAll('.member-pill');
  pills.forEach(pill => {
    const reg = pill.dataset.regNo;
    const isSel = state.selectedAthletes.some(a => a.reg_no === reg);
    pill.classList.toggle('selected', isSel);
  });
}

// Sdílení odkazu
elBtnShareLink.addEventListener('click', async () => {
  const shareUrl = buildShareUrl();
  window.history.replaceState(null, '', shareUrl);

  try {
    await navigator.clipboard.writeText(shareUrl);
    elShareFeedback.textContent = 'Odkaz zkopírován';
  } catch (_) {
    window.prompt('Zkopírujte odkaz pro sdílení:', shareUrl);
    elShareFeedback.textContent = 'Odkaz připraven';
  }
  setTimeout(() => {
    elShareFeedback.textContent = '';
  }, 3000);
});

// Vyhledávání závodníků podle jména nebo registračky
elSearch.addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  const q = elSearch.value.trim();
  if (q.length < 2) {
    elSearchResults.classList.add('hidden');
    return;
  }

  state.searchTimer = setTimeout(async () => {
    try {
      const res = await fetch(`api.php?action=search&type_id=${encodeURIComponent(state.typeId)}&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      const list = data.athletes || [];

      if (list.length === 0) {
        elSearchResults.innerHTML = '<div class="dropdown-item">Nenalezen žádný závodník</div>';
      } else {
        elSearchResults.innerHTML = list.map(a => `
          <div class="dropdown-item" data-reg="${escapeHtml(a.reg_no)}" data-name="${escapeHtml(a.name)}">
            <span><strong>${escapeHtml(a.name)}</strong> (${escapeHtml(a.reg_no)})</span>
            <span style="color:#6b7280;font-size:0.85rem;">nejlépe ${escapeHtml(a.best_rank)}.</span>
          </div>
        `).join('');

        elSearchResults.querySelectorAll('.dropdown-item[data-reg]').forEach(item => {
          item.addEventListener('click', () => {
            toggleAthlete({
              reg_no: item.dataset.reg,
              name: item.dataset.name,
            });
            elSearch.value = '';
            elSearchResults.classList.add('hidden');
          });
        });
      }
      elSearchResults.classList.remove('hidden');
    } catch (_) {
      elSearchResults.classList.add('hidden');
    }
  }, 250);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrapper')) {
    elSearchResults.classList.add('hidden');
  }
});

// Načtení členů oddílu
elBtnLoadClub.addEventListener('click', async () => {
  const club = elClubCode.value.trim().toUpperCase();
  if (!club) return;

  showStatus(`Načítám členy oddílu ${club}…`);
  try {
    const res = await fetch(`api.php?action=search&type_id=${encodeURIComponent(state.typeId)}&club=${encodeURIComponent(club)}`);
    const data = await res.json();
    showStatus('');

    const list = data.athletes || [];
    state.clubMembers = list;
    elClubTitle.textContent = `Členové oddílu ${club} (${list.length})`;
    elClubList.innerHTML = '';

    if (list.length === 0) {
      elClubList.innerHTML = '<span>Pro tento oddíl nebyli v rankingu nalezeni žádní závodníci.</span>';
    } else {
      list.forEach(a => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'member-pill';
        btn.dataset.regNo = a.reg_no;
        btn.textContent = `${a.name} (${a.reg_no})`;
        if (state.selectedAthletes.some(s => s.reg_no === a.reg_no)) {
          btn.classList.add('selected');
        }
        btn.addEventListener('click', () => {
          toggleAthlete({ reg_no: a.reg_no, name: a.name });
        });
        elClubList.appendChild(btn);
      });
    }
    elClubBox.classList.remove('hidden');
  } catch (_) {
    showStatus('Nepodařilo se načíst členy oddílu.');
  }
});

elBtnCloseClub.addEventListener('click', () => {
  elClubBox.classList.add('hidden');
});

elBtnAddAllClub.addEventListener('click', () => {
  addAthletesBulk(state.clubMembers);
});

elBtnClearClub.addEventListener('click', () => {
  if (!state.clubMembers.length) return;

  const clubRegs = new Set(state.clubMembers.map(a => a.reg_no));
  const beforeCount = state.selectedAthletes.length;
  state.selectedAthletes = state.selectedAthletes.filter(a => !clubRegs.has(a.reg_no));

  if (state.selectedAthletes.length !== beforeCount) {
    saveSelected();
    renderSelectedChips();
    updateClubPillsState();
    refreshChart();
  }
});

// TOP 10 podle pohlaví
function setTopGender(gender) {
  state.topGender = gender === 'F' ? 'F' : 'M';
  elBtnGenderM.classList.toggle('active', state.topGender === 'M');
  elBtnGenderF.classList.toggle('active', state.topGender === 'F');
}

elBtnGenderM.addEventListener('click', () => setTopGender('M'));
elBtnGenderF.addEventListener('click', () => setTopGender('F'));

async function fetchTop10() {
  const labelGender = state.topGender === 'F' ? 'žen' : 'mužů';
  showStatus(`Načítám TOP 10 ${labelGender}…`);
  try {
    const res = await fetch(`api.php?action=top&type_id=${encodeURIComponent(state.typeId)}&gender=${state.topGender}&limit=10`);
    const data = await res.json();
    showStatus('');
    return Array.isArray(data.athletes) ? data.athletes : [];
  } catch (_) {
    showStatus('Nepodařilo se načíst TOP 10.');
    return [];
  }
}

elBtnLoadTop10.addEventListener('click', async () => {
  const topList = await fetchTop10();
  if (!topList.length) return;

  state.selectedAthletes = topList.map(a => ({ reg_no: a.reg_no, name: a.name }));
  saveSelected();
  renderSelectedChips();
  updateClubPillsState();
  refreshChart();
});

elBtnAddTop10.addEventListener('click', async () => {
  const topList = await fetchTop10();
  if (!topList.length) return;

  addAthletesBulk(topList);
});

// Přepínání období a typu rankingu
elType.addEventListener('change', () => {
  state.typeId = elType.value;
  refreshChart();
});

elBtnLastYear.addEventListener('click', () => {
  state.periodMode = 'lastYear';
  elBtnLastYear.classList.add('active');
  elBtnCustom.classList.remove('active');
  elCustomBox.classList.add('hidden');
  refreshChart();
});

elBtnCustom.addEventListener('click', () => {
  state.periodMode = 'custom';
  elBtnCustom.classList.add('active');
  elBtnLastYear.classList.remove('active');
  elCustomBox.classList.remove('hidden');
  refreshChart();
});

elDateFrom.addEventListener('change', refreshChart);
elDateTo.addEventListener('change', refreshChart);

// Zvýraznění aktivního závodníka (v grafu i v tabulce)
function setHighlightedAthlete(activeIdx) {
  if (state.activeDatasetIndex === activeIdx) return;
  state.activeDatasetIndex = activeIdx;

  if (state.chart) {
    state.chart.data.datasets.forEach((ds, idx) => {
      const baseWidth = ds._baseBorderWidth ?? 2.5;
      const baseRadii = ds._basePointRadii || [];

      if (activeIdx === null || activeIdx === undefined) {
        ds.borderWidth = baseWidth;
        ds.pointRadius = baseRadii;
      } else if (idx === activeIdx) {
        ds.borderWidth = 4.5;
        ds.pointRadius = baseRadii.map(r => (r > 0 ? Math.max(r, 6.5) : 0));
      } else {
        ds.borderWidth = baseWidth;
        ds.pointRadius = baseRadii;
      }
    });
    state.chart.update('none');
  }

  const rows = elSummaryTbody.querySelectorAll('tr[data-series-idx]');
  rows.forEach(tr => {
    const rowIdx = Number(tr.dataset.seriesIdx);
    tr.classList.toggle('highlighted', activeIdx !== null && rowIdx === activeIdx);
  });
}

function initSummaryTableEvents() {
  if (!elSummaryTbody) return;

  elSummaryTbody.addEventListener('mouseover', (e) => {
    const tr = e.target.closest('tr[data-series-idx]');
    if (tr) {
      setHighlightedAthlete(Number(tr.dataset.seriesIdx));
    }
  });

  elSummaryTbody.addEventListener('mouseleave', () => {
    if (state.activeDatasetIndex !== null) {
      setHighlightedAthlete(null);
    }
  });
}

// Vykreslení tabulky přehledu pod grafem
function renderSummaryTable(labels, rawSeries) {
  if (!rawSeries.length || !labels.length) {
    elSummaryCard.classList.add('hidden');
    elSummaryThead.innerHTML = '';
    elSummaryTbody.innerHTML = '';
    return;
  }

  elSummaryCard.classList.remove('hidden');

  elSummaryThead.innerHTML = `
    <tr>
      <th>Závodník</th>
      ${labels.map(m => `<th>${escapeHtml(m)}</th>`).join('')}
    </tr>
  `;

  elSummaryTbody.innerHTML = rawSeries.map((s, idx) => {
    const color = COLORS[idx % COLORS.length];
    const cells = labels.map((_m, mIdx) => {
      const rank = s.data?.[mIdx];
      return `<td>${rank !== null && rank !== undefined ? `${escapeHtml(rank)}.` : '–'}</td>`;
    }).join('');

    return `
      <tr data-series-idx="${idx}">
        <td><span class="color-dot" style="background:${color}"></span>${escapeHtml(s.name)} (${escapeHtml(s.reg_no)})</td>
        ${cells}
      </tr>
    `;
  }).join('');
}

// Plugin pro vykreslení pořadí přímo na puntících v grafu
const rankLabelsPlugin = {
  id: 'rankLabelsPlugin',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const datasets = chart.data.datasets || [];
    if (!datasets.length) return;

    const placedByPoint = {};

    datasets.forEach((ds, dsIdx) => {
      const meta = chart.getDatasetMeta(dsIdx);
      if (meta.hidden) return;

      const actualRanks = ds._actualRanks || [];
      meta.data.forEach((pt, idx) => {
        const rank = actualRanks[idx];
        if (rank === null || rank === undefined || !pt || pt.skip) return;

        const key = `${Math.round(pt.x)}:${Math.round(pt.y)}`;
        const stackIdx = placedByPoint[key] || 0;
        placedByPoint[key] = stackIdx + 1;

        const isActive = state.activeDatasetIndex === dsIdx;
        ctx.save();
        ctx.font = isActive
          ? 'bold 11px system-ui, -apple-system, sans-serif'
          : '600 10px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = ds._baseColor || '#1f2937';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const offsetY = stackIdx === 0 ? -9 : stackIdx * 11 - 9;
        ctx.fillText(`${rank}.`, pt.x + 6, pt.y + offsetY);
        ctx.restore();
      });
    });
  }
};

// Vykreslení a aktualizace grafu
async function refreshChart() {
  syncUrlQuietly();
  state.activeDatasetIndex = null;

  const { from, to } = getPeriodRange();
  const regNos = state.selectedAthletes.map(a => a.reg_no).join(',');

  showStatus('Načítám data (pokud chybí v databázi, stahuji z ORISu)…');

  try {
    const url = `api.php?action=series&type_id=${encodeURIComponent(state.typeId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&reg_nos=${encodeURIComponent(regNos)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      showStatus(data.error);
      return;
    }

    if (data.newly_fetched > 0) {
      showStatus(`Staženo ${data.newly_fetched} nových měsíčních žebříčků z ORISu a uloženo do databáze.`);
      setTimeout(() => showStatus(''), 4000);
    } else {
      showStatus('');
    }

    let namesUpdated = false;
    (data.series || []).forEach(s => {
      const sel = state.selectedAthletes.find(a => a.reg_no === s.reg_no);
      if (sel && sel.name === sel.reg_no && s.name && s.name !== s.reg_no) {
        sel.name = s.name;
        namesUpdated = true;
      }
    });
    if (namesUpdated) {
      saveSelected();
      renderSelectedChips();
    }

    const labels = (data.dates || []).map(d => d.slice(0, 7)); // YYYY-MM
    const rawSeries = data.series || [];
    state.lastLabels = labels;
    state.lastRawSeries = rawSeries;

    const groupsByMonthAndRank = {};
    rawSeries.forEach((s, sIdx) => {
      (s.data || []).forEach((val, mIdx) => {
        if (val !== null && val !== undefined) {
          const key = `${mIdx}:${val}`;
          if (!groupsByMonthAndRank[key]) groupsByMonthAndRank[key] = [];
          groupsByMonthAndRank[key].push(sIdx);
        }
      });
    });

    const POINT_STYLES = ['circle', 'rectRot', 'triangle', 'rect', 'star'];

    const datasets = rawSeries.map((s, idx) => {
      const color = COLORS[idx % COLORS.length];
      const dash = DASH_PATTERNS[idx % DASH_PATTERNS.length];

      const actualRanks = s.data || [];
      const visualData = actualRanks.map((val, mIdx) => {
        if (val === null || val === undefined) return null;
        const group = groupsByMonthAndRank[`${mIdx}:${val}`] || [idx];
        if (group.length <= 1) return val;

        const posInGroup = group.indexOf(idx);
        const centeredOffset = (posInGroup - (group.length - 1) / 2) * 0.35;
        return Number((val + centeredOffset).toFixed(2));
      });

      const pointRadii = actualRanks.map((val, mIdx) => {
        if (val === null || val === undefined) return 0;
        const group = groupsByMonthAndRank[`${mIdx}:${val}`] || [idx];
        return group.length > 1 ? 5.5 : 4;
      });

      const pointStyles = actualRanks.map((val, mIdx) => {
        if (val === null || val === undefined) return 'circle';
        const group = groupsByMonthAndRank[`${mIdx}:${val}`] || [idx];
        if (group.length <= 1) return 'circle';
        return POINT_STYLES[group.indexOf(idx) % POINT_STYLES.length];
      });

      return {
        label: `${s.name} (${s.reg_no})`,
        data: visualData,
        _actualRanks: actualRanks,
        _baseColor: color,
        _baseBorderWidth: 2.5,
        _basePointRadii: pointRadii.slice(),
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2.5,
        borderDash: dash,
        tension: 0,
        spanGaps: true,
        pointStyle: pointStyles,
        pointRadius: pointRadii,
        pointHoverRadius: 7,
      };
    });

    renderChart(labels, datasets);
    renderSummaryTable(labels, rawSeries);
  } catch (err) {
    showStatus('Chyba při komunikaci se serverem.');
  }
}

function renderChart(labels, datasets) {
  const ctx = document.getElementById('rankingChart').getContext('2d');

  if (state.chart) {
    state.chart.destroy();
  }

  state.chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    plugins: [rankLabelsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      onHover: (event, elements) => {
        const nearest = state.chart?.getElementsAtEventForMode(
          event,
          'nearest',
          { intersect: false },
          false
        );
        const hoveredIdx = nearest && nearest.length > 0
          ? nearest[0].datasetIndex
          : (elements && elements.length > 0 ? elements[0].datasetIndex : null);

        if (hoveredIdx !== state.activeDatasetIndex) {
          setHighlightedAthlete(hoveredIdx);
        }
      },
      plugins: {
        legend: {
          position: 'top',
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const actual = ctx.dataset._actualRanks?.[ctx.dataIndex];
              const prefix = ctx.datasetIndex === state.activeDatasetIndex ? '★ ' : '';
              return actual !== null && actual !== undefined
                ? `${prefix}${ctx.dataset.label}: ${actual}. místo`
                : `${prefix}${ctx.dataset.label}: nehodnocen`;
            },
            labelTextColor: (ctx) =>
              ctx.datasetIndex === state.activeDatasetIndex ? '#fef08a' : '#ffffff',
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Období (měsíc vydání rankingu)',
          }
        },
        y: {
          reverse: true, // 1. místo je nahoře
          beginAtZero: false,
          ticks: {
            precision: 0,
            callback: (val) => Number.isInteger(val) ? `${val}.` : ''
          },
          title: {
            display: true,
            text: 'Pořadí v rankingu',
          }
        }
      }
    }
  });

  const canvas = document.getElementById('rankingChart');
  canvas.onmouseleave = () => {
    if (state.activeDatasetIndex !== null) {
      setHighlightedAthlete(null);
    }
  };
}

// Inicializace
(async function init() {
  initSummaryTableEvents();
  initDefaultDates();
  applyUrlStateBeforeTypes();
  renderSelectedChips();
  await loadRankingTypes();
  await refreshChart();
})();
