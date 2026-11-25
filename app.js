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
  topGender: 'M', // 'M' | 'F'
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
  const pills = elClubList
