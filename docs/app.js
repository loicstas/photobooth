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

const PIXEL_ROTATE_SVG = `<svg class="pixel-icon" viewBox="0 0 10 8" width="13" height="10" shape-rendering="crispEdges" aria-hidden="true" fill="currentColor"><rect x="2" y="0" width="4" height="1"/><rect x="1" y="1" width="1" height="1"/><rect x="6" y="1" width="1" height="1"/><rect x="0" y="2" width="1" height="1"/><rect x="7" y="2" width="1" height="1"/><rect x="0" y="3" width="1" height="1"/><rect x="5" y="3" width="5" height="1"/><rect x="0" y="4" width="1" height="1"/><rect x="6" y="4" width="3" height="1"/><rect x="0" y="5" width="1" height="1"/><rect x="7" y="5" width="1" height="1"/><rect x="1" y="6" width="1" height="1"/><rect x="2" y="7" width="5" height="1"/></svg>`;

// ==========================================================================
// 2. API & Application State
// ==========================================================================
// ⚠️ VUL HIER JE ONLINE BACK-END URL IN WANNEER JE DIE HEBT GEHOST (bijv. op Render, Railway of ngrok):
// Voorbeeld: const PRODUCTION_BACKEND_URL = 'https://jouw-backend-naam.onrender.com';
const PRODUCTION_BACKEND_URL = 'http://localhost:10000';

const isGitHubPages = window.location.hostname.endsWith('github.io');
const isPort3000 = location.port === '3000';

const API = isPort3000
  ? ''
  : (isGitHubPages
    ? (PRODUCTION_BACKEND_URL ? PRODUCTION_BACKEND_URL.replace(/\/$/, '') : '')
    : (location.protocol.startsWith('http') ? `${location.protocol}//${location.hostname}:3000` : 'http://localhost:3000'));

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
  rotateBtn: document.getElementById('rotate-btn'),
  downloadBtn: document.getElementById('download-btn'),
  copyLinkBtn: document.getElementById('copy-link-btn'),
  closeBtn: document.getElementById('close-btn'),

  // Toast Container
  toastContainer: document.getElementById('toast-container'),
};

// URL Helpers
const getImgSrc = (p) => (p.url && (p.url.startsWith('http') || p.url.startsWith('./') || p.url.startsWith('data:')) ? p.url : (API ? API + p.url : p.url));
const getDownloadUrl = (p) => (API ? `${API}/api/download/${encodeURIComponent(p.bestand)}` : (p.url || '#'));
const getFullUrl = (relative) => {
  if (relative && (relative.startsWith('http') || relative.startsWith('./'))) return relative;
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
// Rotation & Download Management
// ==========================================================================
function getRotation(bestand) {
  try {
    const map = JSON.parse(localStorage.getItem('photobooth_rotations') || '{}');
    return map[bestand] || 0;
  } catch {
    return 0;
  }
}

function setRotation(bestand, deg) {
  try {
    const map = JSON.parse(localStorage.getItem('photobooth_rotations') || '{}');
    const normalized = (deg % 360 + 360) % 360;
    if (normalized === 0) {
      delete map[bestand];
    } else {
      map[bestand] = normalized;
    }
    localStorage.setItem('photobooth_rotations', JSON.stringify(map));
  } catch { }
}

function rotatePhoto(bestand) {
  const current = getRotation(bestand);
  const next = (current + 90) % 360;
  setRotation(bestand, next);
  return next;
}

function getCardRotationTransform(deg, naturalWidth = 1280, naturalHeight = 720) {
  const normalized = (deg % 360 + 360) % 360;
  if (normalized === 0) return '';
  if (normalized === 180) return 'rotate(180deg)';
  const scale = naturalHeight && naturalWidth ? naturalHeight / naturalWidth : 0.5625;
  return `rotate(${normalized}deg) scale(${scale})`;
}

function applyLightboxRotation(deg) {
  if (!elements.lightboxImg) return;
  const normalized = (deg % 360 + 360) % 360;
  if (normalized === 0) {
    elements.lightboxImg.style.transform = '';
  } else if (normalized === 180) {
    elements.lightboxImg.style.transform = 'rotate(180deg)';
  } else {
    const scale = elements.lightboxImg.naturalHeight && elements.lightboxImg.naturalWidth
      ? elements.lightboxImg.naturalHeight / elements.lightboxImg.naturalWidth
      : 0.5625;
    elements.lightboxImg.style.transform = `rotate(${normalized}deg) scale(${scale})`;
  }
}

function downloadPhoto(photo, rotation = 0) {
  const rot = (rotation % 360 + 360) % 360;
  if (rot === 0) {
    const a = document.createElement('a');
    a.href = getDownloadUrl(photo);
    a.download = photo.bestand;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  showToast('💾 Bezig met draaien en downloaden...', 'info', 2000);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = getImgSrc(photo);
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const rad = rot * Math.PI / 180;
      const isSideways = rot % 180 !== 0;

      canvas.width = isSideways ? img.naturalHeight : img.naturalWidth;
      canvas.height = isSideways ? img.naturalWidth : img.naturalHeight;

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

      canvas.toBlob((blob) => {
        if (!blob) throw new Error('Blob conversie mislukt');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gedraaid-${photo.bestand}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showToast('✅ Gedraaide foto gedownload!', 'success');
      }, 'image/png');
    } catch (err) {
      console.warn('Canvas download fallback naar origineel:', err);
      const a = document.createElement('a');
      a.href = getDownloadUrl(photo);
      a.download = photo.bestand;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };
  img.onerror = () => {
    const a = document.createElement('a');
    a.href = getDownloadUrl(photo);
    a.download = photo.bestand;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
}

async function deleteSession(sessieId) {
  if (!confirm(`Weet je zeker dat je fotosessie "${sessieId}" wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`)) {
    return false;
  }

  try {
    const res = await fetch(`${API}/api/sessions/${encodeURIComponent(sessieId)}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.fout || `HTTP ${res.status}`);
    }

    showToast('🗑️ Fotosessie succesvol verwijderd!', 'success');

    // Close lightbox if currently open on this session
    if (elements.lightbox.open && state.currentGroup && state.currentGroup[0]?.sessie === sessieId) {
      elements.lightbox.close();
    }

    // Remove from state and refresh grid
    state.sessions.delete(sessieId);
    state.rawPhotos = state.rawPhotos.filter((p) => p.sessie !== sessieId);
    renderGrid();
    return true;
  } catch (err) {
    console.error('Fout bij verwijderen sessie:', err);
    showToast(`❌ Fout bij verwijderen: ${err.message}`, 'error');
    return false;
  }
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
      if (isGitHubPages && !PRODUCTION_BACKEND_URL) {
        elements.grid.innerHTML = `
          <div class="empty-box">
            <h2>Backend URL niet ingesteld</h2>
            <p>Deze website draait op GitHub Pages, maar heeft nog geen online backend URL.</p>
            <p>Host je <code>back-end</code> (bijv. op Render.com of via ngrok) en vul de URL in bij <code>PRODUCTION_BACKEND_URL</code> bovenin <code>docs/app.js</code>.</p>
          </div>
        `;
      } else {
        elements.grid.innerHTML = `
          <div class="empty-box">
            <h2>Kan geen verbinding maken</h2>
            <p>Controleer of de backend server actief is en klik op Vernieuwen.</p>
          </div>
        `;
      }
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
    const headPhoto = singles[0] || strip || photos[0];
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

    s.currentPreviewPhoto = s.headPhoto;
    const initRot = getRotation(s.headPhoto.bestand);
    const initTransform = getCardRotationTransform(initRot);

    const thumbsHtml = (s.singles.length > 0 ? s.singles.slice(0, 3) : s.photos.slice(0, 3)).map((f) => `
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
          <img class="main-img" src="${getImgSrc(s.headPhoto)}" alt="Foto 1 sessie" loading="lazy"${initTransform ? ` style="transform: ${initTransform};"` : ''}>
        </div>
        ${thumbsHtml ? `<div class="card-thumbs">${thumbsHtml}</div>` : ''}
      </div>
      <div class="card-foot">
        <span class="tag">${s.singles.length} foto's</span>
        <div class="card-actions">
          <button class="btn cyan small rotate-card-btn" type="button" title="Draai foto 90°">${PIXEL_ROTATE_SVG}</button>
          <button class="btn pink small dl-btn" type="button" title="Download foto">💾 Download</button>
        </div>
      </div>
    `;

    // Click listeners
    const mainWrap = card.querySelector('.main-preview-wrap');
    if (mainWrap) {
      mainWrap.addEventListener('click', () => {
        const firstIdx = s.photos.findIndex((p) => p.nummer !== 0);
        openLightbox(s.photos, firstIdx !== -1 ? firstIdx : 0);
      });
    }

    const mainImg = card.querySelector('.main-img');
    const rotateCardBtn = card.querySelector('.rotate-card-btn');
    const dlBtn = card.querySelector('.dl-btn');

    if (rotateCardBtn) {
      rotateCardBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const activePhoto = s.currentPreviewPhoto || s.headPhoto;
        const newRot = rotatePhoto(activePhoto.bestand);
        if (mainImg) {
          mainImg.style.transform = getCardRotationTransform(newRot, mainImg.naturalWidth, mainImg.naturalHeight);
        }
        showToast(`🔄 Foto 90° gedraaid (${newRot}°)`, 'info', 1500);
      });
    }

    if (dlBtn) {
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const activePhoto = s.currentPreviewPhoto || s.headPhoto;
        const rot = getRotation(activePhoto.bestand);
        downloadPhoto(activePhoto, rot);
      });
    }

    card.querySelectorAll('.thumb-item').forEach((thumb) => {
      thumb.addEventListener('mouseenter', () => {
        const nr = Number(thumb.dataset.nummer);
        const photo = s.photos.find((p) => p.nummer === nr);
        if (photo && mainImg) {
          s.currentPreviewPhoto = photo;
          mainImg.src = getImgSrc(photo);
          const rot = getRotation(photo.bestand);
          mainImg.style.transform = getCardRotationTransform(rot, mainImg.naturalWidth, mainImg.naturalHeight);
        }
      });
      thumb.addEventListener('mouseleave', () => {
        s.currentPreviewPhoto = s.headPhoto;
        if (mainImg) {
          mainImg.src = getImgSrc(s.headPhoto);
          const rot = getRotation(s.headPhoto.bestand);
          mainImg.style.transform = getCardRotationTransform(rot, mainImg.naturalWidth, mainImg.naturalHeight);
        }
      });
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

  // Apply saved rotation
  const rot = getRotation(photo.bestand);
  applyLightboxRotation(rot);

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

  // Lightbox Rotate Action
  if (elements.rotateBtn) {
    elements.rotateBtn.addEventListener('click', () => {
      if (!state.currentGroup) return;
      const photo = state.currentGroup[state.currentIndex];
      const newRot = rotatePhoto(photo.bestand);
      applyLightboxRotation(newRot);
      showToast(`🔄 Foto 90° gedraaid (${newRot}°)`, 'info', 1500);

      // Update matching card images if visible in gallery
      document.querySelectorAll(`img.main-img[src*="${encodeURIComponent(photo.bestand)}"]`).forEach((img) => {
        img.style.transform = getCardRotationTransform(newRot, img.naturalWidth, img.naturalHeight);
      });
    });
  }

  // Lightbox Download Action with Rotation
  if (elements.downloadBtn) {
    elements.downloadBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!state.currentGroup) return;
      const photo = state.currentGroup[state.currentIndex];
      const rot = getRotation(photo.bestand);
      downloadPhoto(photo, rot);
    });
  }

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
