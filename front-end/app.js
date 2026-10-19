/**
 * Pixel Photobooth - Modern Front-End Engine
 * Standalone gallery with filtering, search, interactive lightbox, and instant downloads.
 */

// ==========================================================================
// 1. Pixel Art SVG Sprites
// ==========================================================================
function createSprite(rows, palette, pixelSize = 6) {
  let rects = '';
  rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      if (palette[char]) {
        rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[char]}"/>`;
      }
    });
  });
  return `<svg viewBox="0 0 ${rows[0].length} ${rows.length}" width="${rows[0].length * pixelSize}" height="${rows.length * pixelSize}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

const SPRITES = {
  CAM: [
    "......KKKK......",
    ".KKKKKBBBBKKKKK.",
    "KBBBBBBBBBBBBPPK",
    "KBBBKKKKKKBBBBBK",
    "KBBKLLLLLLKBBBBK",
    "KBBKLGGGGLKBBBBK",
    "KBBKLGWGGLKBBBBK",
    "KBBKLGGGGLKBBBBK",
    "KBBKLLLLLLKBBBBK",
    "KBBBKKKKKKBBBBBK",
    "KDDDDDDDDDDDDDDK",
    ".KKKKKKKKKKKKKK."
  ],
  PALETTE: {
    K: '#0d0710',
    B: '#ff3b8d',
    D: '#4d3363',
    L: '#fcf1f3',
    G: '#3cd4ff',
    W: '#ffffff',
    P: '#ffc436'
  }
};

// ==========================================================================
// 2. API & Application State
// ==========================================================================
const isPort3000 = location.port === '3000';
const API = isPort3000
  ? ''
  : (location.protocol.startsWith('http') ? `${location.protocol}//${location.hostname}:3000` : 'http://localhost:3000');

// App state
const state = {
  rawPhotos: [],
  sessions: new Map(),
  filter: 'all',
  search: '',
  currentGroup: null,
  currentIndex: 0,
  isLoading: false,
  lastKnownPhotoCount: -1,
};

// DOM references
const elements = {
  grid: document.getElementById('grid'),
  count: document.getElementById('count'),
  refreshBtn: document.getElementById('refresh-btn'),
  searchInput: document.getElementById('search-input'),
  filterButtons: document.querySelectorAll('.filter-btn'),
  
  // Lightbox
  lightbox: document.getElementById('lightbox'),
  lightboxTitle: document.getElementById('lightbox-title'),
  lightboxImg: document.getElementById('lightbox-img'),
  lightboxFilmstrip: document.getElementById('lightbox-filmstrip'),
  prevBtn: document.getElementById('prev-btn'),
  nextBtn: document.getElementById('next-btn'),
  downloadBtn: document.getElementById('download-btn'),
  copyLinkBtn: document.getElementById('copy-link-btn'),
  closeBtn: document.getElementById('close-btn'),

  // Toast Container
  toastContainer: document.getElementById('toast-container'),
};

// URL Helpers
const getImgSrc = (p) => (p.url && p.url.startsWith('http') ? p.url : API + p.url);
const getDownloadUrl = (p) => `${API}/api/download/${encodeURIComponent(p.bestand)}`;
const getFullUrl = (relative) => {
  const base = isPort3000 ? window.location.origin : (API || window.location.origin);
  return `${base}${relative}`;
};

// Format Date/Time helper
function formatDate(isoStr) {
  if (!isoStr) return 'Onbekende datum';
  const d = new Date(isoStr);
  return d.toLocaleString('nl-BE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Toast notification
function showToast(text, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = text;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.2s ease forwards';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

// ==========================================================================
// 3. Data Fetching
// ==========================================================================
async function loadPhotos(isAutoPoll = false) {
  if (state.isLoading) return;
  state.isLoading = true;

  if (!isAutoPoll) {
    elements.refreshBtn.classList.add('loading');
  }

  try {
    const res = await fetch(`${API}/api/photos`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const photos = await res.json();
    
    // Check if new photos arrived
    if (state.lastKnownPhotoCount !== -1 && photos.length > state.lastKnownPhotoCount) {
      showToast('✨ Nieuwe foto\'s binnengekomen in de booth!', 'success');
    }
    state.lastKnownPhotoCount = photos.length;
    state.rawPhotos = photos;

    groupSessions(photos);
    renderGrid();
  } catch (err) {
    console.error('Fout bij ophalen foto\'s:', err);
    if (!isAutoPoll) {
      elements.count.textContent = 'Verbindingsfout';
      elements.grid.innerHTML = `
        <div class="empty-box">
          <h2>Kan geen verbinding maken</h2>
          <p>Controleer of de backend server actief is op poort 3000 en klik op Vernieuwen.</p>
        </div>
      `;
    }
  } finally {
    state.isLoading = false;
    elements.refreshBtn.classList.remove('loading');
  }
}

function groupSessions(photos) {
  const map = new Map();
  photos.forEach((p) => {
    const k = p.sessie || 'onbekend';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  });

  // Sort photos within each session: strip (0) first, then 1, 2, 3
  map.forEach((items) => {
    items.sort((a, b) => a.nummer - b.nummer);
  });

  state.sessions = map;
}

// ==========================================================================
// 4. UI Rendering
// ==========================================================================
function renderGrid() {
  const query = state.search.toLowerCase().trim();
  const sessions = [];

  state.sessions.forEach((photos, sessieId) => {
    const strip = photos.find((p) => p.nummer === 0);
    const singles = photos.filter((p) => p.nummer !== 0);
    const headPhoto = strip || singles[0] || photos[0];
    const dateFormatted = formatDate(headPhoto ? headPhoto.aangemaakt : null);

    // Apply filter
    if (state.filter === 'strips' && !strip) return;
    if (state.filter === 'singles' && singles.length === 0) return;

    // Apply search
    if (query) {
      const matchSessie = sessieId.toLowerCase().includes(query);
      const matchDatum = dateFormatted.toLowerCase().includes(query);
      if (!matchSessie && !matchDatum) return;
    }

    sessions.push({ sessieId, photos, strip, singles, headPhoto, dateFormatted });
  });

  // Update counter
  elements.count.textContent = `${sessions.length} ${sessions.length === 1 ? 'sessie' : 'sessies'}`;

  // Empty state
  if (sessions.length === 0) {
    elements.grid.innerHTML = `
      <div class="empty-box">
        ${createSprite(SPRITES.CAM, SPRITES.PALETTE, 6)}
        <h2>Geen foto's gevonden</h2>
        <p>${state.search ? 'Geen sessies die overeenkomen met je zoekopdracht.' : 'Maak een foto in de booth en hij verschijnt hier direct!'}</p>
      </div>
    `;
    return;
  }

  // Render cards
  elements.grid.innerHTML = '';
  sessions.forEach((s, index) => {
    const isNewest = index === 0 && !query;
    const card = document.createElement('article');
    card.className = 'card';
    card.setAttribute('aria-label', `Sessie van ${s.dateFormatted}`);

    const thumbsHtml = s.singles.slice(0, 3).map((f) => `
      <div class="thumb-item" data-nummer="${f.nummer}" title="Bekijk foto ${f.nummer}">
        <img src="${getImgSrc(f)}" alt="Foto ${f.nummer}" loading="lazy">
        <span class="thumb-number">${f.nummer}</span>
      </div>
    `).join('');

    card.innerHTML = `
      <div class="bar-title">
        <div class="session-name">
          <span>${s.dateFormatted}</span>
          ${isNewest ? '<span class="badge-new">NIEUW</span>' : ''}
        </div>
        <span class="dots"><i></i><i></i><i></i></span>
      </div>
      <div class="card-body">
        <div class="main-preview-wrap" title="Klik om sessie te bekijken">
          <img class="main-img" src="${getImgSrc(s.headPhoto)}" alt="Hoofdfoto sessie" loading="lazy">
        </div>
        ${thumbsHtml ? `<div class="card-thumbs">${thumbsHtml}</div>` : ''}
      </div>
      <div class="card-foot">
        <span class="tag ${s.strip ? 'strip' : ''}">${s.strip ? '★ Fotostrip' : s.singles.length + ' foto\'s'}</span>
        <div class="card-actions">
          <a class="btn pink small dl-btn" href="${getDownloadUrl(s.headPhoto)}" download="${s.headPhoto.bestand}" title="Download hoofdfoto">💾 Download</a>
        </div>
      </div>
    `;

    // Click listeners
    const mainWrap = card.querySelector('.main-preview-wrap');
    mainWrap.addEventListener('click', () => {
      openLightbox(s.photos, 0);
    });

    card.querySelectorAll('.thumb-item').forEach((thumb) => {
      thumb.addEventListener('click', (e) => {
        e.stopPropagation();
        const nr = Number(thumb.dataset.nummer);
        const idx = s.photos.findIndex((p) => p.nummer === nr);
        openLightbox(s.photos, idx !== -1 ? idx : 0);
      });
    });

    elements.grid.appendChild(card);
  });
}

// ==========================================================================
// 5. Lightbox Gallery Viewer
// ==========================================================================
function openLightbox(group, index = 0) {
  state.currentGroup = group;
  state.currentIndex = (index + group.length) % group.length;
  updateLightboxView();
  if (!elements.lightbox.open) {
    elements.lightbox.showModal();
  }
}

function updateLightboxView() {
  if (!state.currentGroup || state.currentGroup.length === 0) return;
  const photo = state.currentGroup[state.currentIndex];
  const isStrip = photo.nummer === 0;
  const label = isStrip ? 'Fotostrip' : `Foto ${photo.nummer}`;
  const total = state.currentGroup.length;

  elements.lightboxTitle.textContent = `${label}  (${state.currentIndex + 1}/${total})`;
  elements.lightboxImg.src = getImgSrc(photo);
  elements.lightboxImg.alt = label;

  elements.downloadBtn.href = getDownloadUrl(photo);
  elements.downloadBtn.setAttribute('download', photo.bestand);

  // Update Filmstrip
  elements.lightboxFilmstrip.innerHTML = state.currentGroup.map((p, idx) => `
    <div class="modal-filmstrip-thumb ${idx === state.currentIndex ? 'active' : ''}" data-idx="${idx}">
      <img src="${getImgSrc(p)}" alt="${p.nummer === 0 ? 'Strip' : 'Foto ' + p.nummer}">
      <span class="modal-filmstrip-tag">${p.nummer === 0 ? 'Strip' : '#' + p.nummer}</span>
    </div>
  `).join('');

  elements.lightboxFilmstrip.querySelectorAll('.modal-filmstrip-thumb').forEach((thumb) => {
    thumb.addEventListener('click', () => {
      state.currentIndex = Number(thumb.dataset.idx);
      updateLightboxView();
    });
  });

  // Preload neighboring images
  const nextIdx = (state.currentIndex + 1) % total;
  new Image().src = getImgSrc(state.currentGroup[nextIdx]);
}

function prevPhoto() {
  if (!state.currentGroup) return;
  state.currentIndex = (state.currentIndex - 1 + state.currentGroup.length) % state.currentGroup.length;
  updateLightboxView();
}

function nextPhoto() {
  if (!state.currentGroup) return;
  state.currentIndex = (state.currentIndex + 1) % state.currentGroup.length;
  updateLightboxView();
}

// ==========================================================================
// 6. Event Listeners & Initialization
// ==========================================================================
function setupEventListeners() {
  // Brand camera icon
  const brandCam = document.getElementById('brand-cam');
  if (brandCam) brandCam.innerHTML = createSprite(SPRITES.CAM, SPRITES.PALETTE, 8);

  // Manual refresh
  elements.refreshBtn.addEventListener('click', () => {
    loadPhotos(false);
  });

  // Search input
  elements.searchInput.addEventListener('input', (e) => {
    state.search = e.target.value;
    renderGrid();
  });

  // Filter pills
  elements.filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      elements.filterButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      renderGrid();
    });
  });

  // Lightbox Navigation
  elements.prevBtn.addEventListener('click', prevPhoto);
  elements.nextBtn.addEventListener('click', nextPhoto);
  elements.closeBtn.addEventListener('click', () => {
    elements.lightbox.close();
  });

  // Close when clicking modal backdrop
  elements.lightbox.addEventListener('click', (e) => {
    if (e.target === elements.lightbox) elements.lightbox.close();
  });

  // Copy Link Action
  elements.copyLinkBtn.addEventListener('click', () => {
    if (!state.currentGroup) return;
    const photo = state.currentGroup[state.currentIndex];
    const fullUrl = getFullUrl(photo.url);
    navigator.clipboard.writeText(fullUrl).then(() => {
      showToast('📋 Fotolink gekopieerd naar klembord!', 'success');
    });
  });

  // Keyboard controls
  document.addEventListener('keydown', (e) => {
    if (elements.lightbox.open) {
      if (e.key === 'ArrowLeft') prevPhoto();
      if (e.key === 'ArrowRight') nextPhoto();
      if (e.key === 'Escape') elements.lightbox.close();
    }
  });

  // Touch Swipe for mobile lightbox
  let touchStartX = 0;
  elements.lightbox.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  elements.lightbox.addEventListener('touchend', (e) => {
    const diff = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(diff) > 40) {
      if (diff < 0) nextPhoto();
      else prevPhoto();
    }
  });
}

// ==========================================================================
// 7. Start Application
// ==========================================================================
setupEventListeners();
loadPhotos(false);

// Auto-poll every 6 seconds if lightbox is not active
setInterval(() => {
  if (!elements.lightbox.open) {
    loadPhotos(true);
  }
}, 6000);
