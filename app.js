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

const state = {
  typeId: null,
  periodMode: 'lastYear', // 'lastYear' | 'custom'
  selectedAthletes: JSON.parse(localStorage.getItem('oris_selected_athletes') || '[]'),
  clubMembers: [],
  chart: null,
  searchTimer: null,
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
const elSelectedChips = document.getElementById('selectedAthletes');
const elStatus = document.getElementById('statusBar');
const elBtnShareLink = document.getElementById('btnShareLink');
const elShareFeedback = document.getElementById('shareFeedback');

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
      .map(t => `<option value="${t.id}">${t.name}</option>`)
      .join('');

    const matched = urlType && data.types.some(t => String(t.id) === String(urlType));
    state.typeId = matched ? String(urlType) : String(data.types[0].id);
    elType.value = state.typeId;
  } catch (err) {
    showStatus('Nepodařilo se načíst typy rankingů.');
  }
}

function saveSelected() {
  localStorage.setItem('oris_selected_athletes', JSON.stringify(state.selectedAthletes));
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
      <span>${athlete.name} (${athlete.reg_no})</span>
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
    const res = await fetch(`api.php?action=search&type_id=${state.typeId}&q=${encodeURIComponent(q)}`);
    const data = await res.json();
    const list = data.athletes || [];

    if (list.length === 0) {
      elSearchResults.innerHTML = '<div class="dropdown-item">Nenalezen žádný závodník</div>';
    } else {
      elSearchResults.innerHTML = list.map(a => `
        <div class="dropdown-item" data-reg="${a.reg_no}" data-name="${a.name}">
          <span><strong>${a.name}</strong> (${a.reg_no})</span>
          <span style="color:#6b7280;font-size:0.85rem;">nejlépe ${a.best_rank}.</span>
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
  const res = await fetch(`api.php?action=search&type_id=${state.typeId}&club=${encodeURIComponent(club)}`);
  const data = await res.json();
  showStatus('');

  const list = data.athletes || [];
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
});

elBtnCloseClub.addEventListener('click', () => {
  elClubBox.classList.add('hidden');
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

// Vykreslení a aktualizace grafu
async function refreshChart() {
  syncUrlQuietly();

  const { from, to } = getPeriodRange();
  const regNos = state.selectedAthletes.map(a => a.reg_no).join(',');

  showStatus('Načítám data (pokud chybí v databázi, stahuji z ORISu)…');

  try {
    const url = `api.php?action=series&type_id=${state.typeId}&from=${from}&to=${to}&reg_nos=${encodeURIComponent(regNos)}`;
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

    // Doplníme případná plná jména ze série, pokud přišla z URL jen registračku
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

    // Spočítáme kolik závodníků má ve stejném měsíci stejné pořadí
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
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top',
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const actual = ctx.dataset._actualRanks?.[ctx.dataIndex];
              return actual !== null && actual !== undefined
                ? `${ctx.dataset.label}: ${actual}. místo`
                : `${ctx.dataset.label}: nehodnocen`;
            }
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
}

// Inicializace
(async function init() {
  initDefaultDates();
  applyUrlStateBeforeTypes();
  renderSelectedChips();
  await loadRankingTypes();
  await refreshChart();
})();
