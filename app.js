const COLORS = [
  '#d97706', '#2563eb', '#059669', '#dc2626', '#7c3aed',
  '#0891b2', '#db2777', '#4f46e5', '#65a30d', '#ea580c'
];

const state = {
  typeId: null,
  periodMode: 'lastYear', // 'lastYear' | 'custom'
  selectedAthletes: JSON.parse(localStorage.getItem('oris_selected_athletes') || '[]'),
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

async function loadRankingTypes() {
  try {
    const res = await fetch('api.php?action=types');
    const data = await res.json();
    if (!data.types || data.types.length === 0) {
      elType.innerHTML = '<option value="1">Ranking OB (výchozí)</option>';
      state.typeId = 1;
      return;
    }

    elType.innerHTML = data.types
      .map(t => `<option value="${t.id}">${t.name}</option>`)
      .join('');
    state.typeId = data.types[0].id;
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

    const labels = (data.dates || []).map(d => d.slice(0, 7)); // YYYY-MM
    const datasets = (data.series || []).map((s, idx) => {
      const color = COLORS[idx % COLORS.length];
      return {
        label: `${s.name} (${s.reg_no})`,
        data: s.data,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2.5,
        tension: 0.2,
        spanGaps: true,
        pointRadius: 4,
        pointHoverRadius: 6,
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
              const val = ctx.parsed.y;
              return val !== null ? `${ctx.dataset.label}: ${val}. místo` : `${ctx.dataset.label}: nehodnocen`;
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
            callback: (val) => `${val}.`
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
  renderSelectedChips();
  await loadRankingTypes();
  await refreshChart();
})();
