// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION — edit these to match your repo and categories
// ═══════════════════════════════════════════════════════════════════
const CONFIG = {
  // Path to GeoJSON, relative to this HTML file in the same repo
  geojsonPath: './data/pois.geojson',

  // Berlin centre
  // mapCenter: [38.9072, -77.0369],
  // mapZoom: 13,

  // DC Center
  mapCenter: [38.9072, -77.0369],
  mapZoom: 13,

  // Default alert radius (metres) per category — override per-feature with "radius" property
  categoryDefaults: {
    landmark:     200,
    building:     180,
    museum:       150,
    neighbourhood:120,
    cafe:          80,
    restaurant:    80,
    bar:           70,
    shop:          60,
    park:         150,
    artwork:       40,
    other:        100
  },

  // Emoji + colour per category
  categoryStyle: {
    landmark:     { emoji: '🏛', color: '#d4a84b' },
    building:     { emoji: '🏢', color: '#a0a0c0' },
    museum:       { emoji: '🖼', color: '#b06090' },
    neighbourhood:{ emoji: '🏘', color: '#70b080' },
    cafe:         { emoji: '☕', color: '#c8a070' },
    restaurant:   { emoji: '🍽', color: '#d07060' },
    bar:          { emoji: '🍸', color: '#8060b0' },
    shop:         { emoji: '🛍', color: '#60a0c0' },
    park:         { emoji: '🌿', color: '#50a060' },
    artwork:      { emoji: '🎨', color: '#c05080' },
    other:        { emoji: '📍', color: '#8a8070' }
  }
};

// ═══════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════
let allFeatures   = [];
let activeFilters = new Set(['all']);
let leafletLayers = {};   // id → { marker, circle }
let tracking      = false;
let watchId       = null;
let userMarker    = null;
let alerted       = new Set();
let drawerOpen    = false;

// ═══════════════════════════════════════════════════════════════════
// Map
// ═══════════════════════════════════════════════════════════════════
const map = L.map('map', { zoomControl: false })
  .setView(CONFIG.mapCenter, CONFIG.mapZoom);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

L.control.zoom({ position: 'topright' }).addTo(map);
map.on('click', () => { if (drawerOpen) closeDrawer(); });

// ═══════════════════════════════════════════════════════════════════
// Load GeoJSON
// ═══════════════════════════════════════════════════════════════════
async function loadPOIs() {
  try {
    const res = await fetch(CONFIG.geojsonPath);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const gj = await res.json();
    allFeatures = gj.features || [];
    buildFilters();
    renderMarkers();
  } catch (e) {
    toast(`⚠️ Could not load POI data.<br><small>${e.message}</small>`, true);
    console.error(e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Filters
// ═══════════════════════════════════════════════════════════════════
function buildFilters() {
  const cats = [...new Set(allFeatures.map(f => f.properties.category || 'other'))];
  const container = document.getElementById('filters');

  const allChip = makeChip('all', 'All', true);
  container.appendChild(allChip);

  cats.forEach(cat => {
    const style = CONFIG.categoryStyle[cat] || CONFIG.categoryStyle.other;
    container.appendChild(makeChip(cat, `${style.emoji} ${cap(cat)}`, false));
  });
}

function makeChip(cat, label, active) {
  const btn = document.createElement('button');
  btn.className = 'filter-chip' + (active ? ' on' : '');
  btn.innerHTML = `<span class="chip-dot"></span>${label}`;
  btn.onclick = () => toggleFilter(cat, btn);
  return btn;
}

function toggleFilter(cat, btn) {
  if (cat === 'all') {
    activeFilters = new Set(['all']);
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('on'));
    btn.classList.add('on');
  } else {
    activeFilters.delete('all');
    document.querySelector('.filter-chip').classList.remove('on'); // "All" chip
    if (activeFilters.has(cat)) {
      activeFilters.delete(cat);
      btn.classList.remove('on');
      if (activeFilters.size === 0) {
        activeFilters.add('all');
        document.querySelector('.filter-chip').classList.add('on');
      }
    } else {
      activeFilters.add(cat);
      btn.classList.add('on');
    }
  }
  applyFilters();
}

function isVisible(feature) {
  if (activeFilters.has('all')) return true;
  return activeFilters.has(feature.properties.category || 'other');
}

function applyFilters() {
  allFeatures.forEach(f => {
    const id = featureId(f);
    const layers = leafletLayers[id];
    if (!layers) return;
    const show = isVisible(f);
    if (show) { layers.marker.addTo(map); layers.circle.addTo(map); }
    else { map.removeLayer(layers.marker); map.removeLayer(layers.circle); }
  });
  if (drawerOpen) renderDrawer();
}

// ═══════════════════════════════════════════════════════════════════
// Markers
// ═══════════════════════════════════════════════════════════════════
function featureId(f) {
  return f.properties.name + '_' + f.geometry.coordinates.join('_');
}

function getRadius(f) {
  const p = f.properties;
  if (p.radius) return p.radius;
  return CONFIG.categoryDefaults[p.category] || CONFIG.categoryDefaults.other;
}

function makeIcon(cat, triggered = false) {
  const style = CONFIG.categoryStyle[cat] || CONFIG.categoryStyle.other;
  const bg    = triggered ? '#c8705f' : style.color;
  return L.divIcon({
    className: '',
    html: `<div style="
      width:34px;height:34px;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${bg};
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 3px 12px rgba(0,0,0,0.5);
      border:1.5px solid rgba(255,255,255,0.15);
    "><span style="transform:rotate(45deg);font-size:0.95rem">${(CONFIG.categoryStyle[cat]||CONFIG.categoryStyle.other).emoji}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -36]
  });
}

function makePopup(f) {
  const p = f.properties;
  const style = CONFIG.categoryStyle[p.category] || CONFIG.categoryStyle.other;
  const photos = (p.photos || []).filter(Boolean);
  const radius = getRadius(f);

  return `<div class="popup-inner">
    <div class="popup-cat">${style.emoji} ${cap(p.category || 'place')}</div>
    <div class="popup-name">${p.name || 'Unnamed'}</div>
    ${p.address ? `<div class="popup-addr">📍 ${p.address}</div>` : ''}
    ${p.note    ? `<div class="popup-note">${p.note}</div>` : ''}
    ${photos.length ? `<div class="popup-photos">${photos.map(src =>
      `<img src="${src}" alt="" loading="lazy"/>`).join('')}</div>` : ''}
    <div class="popup-radius">Alert within ${radius}m</div>
  </div>`;
}

function renderMarkers() {
  // Clear existing
  Object.values(leafletLayers).forEach(l => {
    map.removeLayer(l.marker);
    map.removeLayer(l.circle);
  });
  leafletLayers = {};

  allFeatures.forEach(f => {
    const [lng, lat] = f.geometry.coordinates;
    const p   = f.properties;
    const cat = p.category || 'other';
    const id  = featureId(f);
    const r   = getRadius(f);
    const style = CONFIG.categoryStyle[cat] || CONFIG.categoryStyle.other;

    const marker = L.marker([lat, lng], { icon: makeIcon(cat, alerted.has(id)) })
      .bindPopup(makePopup(f), { maxWidth: 280 });

    const circle = L.circle([lat, lng], {
      radius: r,
      color: style.color,
      fillColor: style.color,
      fillOpacity: 0.05,
      weight: 1,
      dashArray: '3 5'
    });

    if (isVisible(f)) { marker.addTo(map); circle.addTo(map); }

    leafletLayers[id] = { marker, circle };
  });
}

// ═══════════════════════════════════════════════════════════════════
// Drawer (list view)
// ═══════════════════════════════════════════════════════════════════
function toggleDrawer() {
  drawerOpen ? closeDrawer() : openDrawer();
}

function openDrawer() {
  drawerOpen = true;
  renderDrawer();
  document.getElementById('drawer').classList.add('open');
}

function closeDrawer() {
  drawerOpen = false;
  document.getElementById('drawer').classList.remove('open');
}

function renderDrawer() {
  const visible = allFeatures.filter(isVisible);
  const body = document.getElementById('drawerBody');

  if (visible.length === 0) {
    body.innerHTML = `<h2>Places</h2><p class="sub" style="text-align:center;padding:24px 0">No places in this category.</p>`;
    return;
  }

  body.innerHTML = `
    <h2>Places</h2>
    <p class="sub">${visible.length} spot${visible.length !== 1 ? 's' : ''} to discover</p>
    <div class="poi-list">
      ${visible.map(f => {
        const p = f.properties;
        const style = CONFIG.categoryStyle[p.category] || CONFIG.categoryStyle.other;
        const id = featureId(f);
        return `<div class="poi-card" onclick="flyTo('${id}')">
          <div class="poi-card-icon" style="background:${style.color}18;border-color:${style.color}44">
            ${style.emoji}
          </div>
          <div class="poi-card-body">
            <strong>${p.name || 'Unnamed'}</strong>
            <small>${p.address || cap(p.category || 'place')}</small>
          </div>
          <span class="poi-badge">${cap(p.category || 'other')}</span>
        </div>`;
      }).join('')}
    </div>`;
}

function flyTo(id) {
  const f = allFeatures.find(f => featureId(f) === id);
  if (!f) return;
  const [lng, lat] = f.geometry.coordinates;
  map.flyTo([lat, lng], 17, { duration: 0.9 });
  setTimeout(() => leafletLayers[id]?.marker.openPopup(), 950);
  closeDrawer();
}

// ═══════════════════════════════════════════════════════════════════
// Location tracking
// ═══════════════════════════════════════════════════════════════════
function toggleTracking() {
  tracking ? stopTracking() : startTracking();
}

function startTracking() {
  if (!('geolocation' in navigator)) {
    toast('⚠️ Geolocation not supported on this device.', true); return;
  }
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  watchId = navigator.geolocation.watchPosition(onPosition, onPosError, {
    enableHighAccuracy: true, maximumAge: 5000, timeout: 15000
  });

  tracking = true;
  const btn = document.getElementById('trackBtn');
  btn.classList.add('tracking');
  document.getElementById('trackLabel').textContent = 'Tracking';
  setStatus('on', 'Searching for GPS…');
  showStatus();
}

function stopTracking() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  tracking = false;
  if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
  const btn = document.getElementById('trackBtn');
  btn.classList.remove('tracking');
  document.getElementById('trackLabel').textContent = 'Track me';
  hideStatus();
}

function onPosition(pos) {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  setStatus('on', `±${Math.round(accuracy)}m accuracy`);

  const userIcon = L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:#4caf82;border:2.5px solid white;box-shadow:0 0 0 5px rgba(76,175,130,0.2),0 2px 8px rgba(0,0,0,0.4)"></div>`,
    iconSize: [16,16], iconAnchor: [8,8]
  });

  if (!userMarker) {
    userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 2000 }).addTo(map);
    map.flyTo([lat, lng], 15, { duration: 1.2 });
  } else {
    userMarker.setLatLng([lat, lng]);
  }

  // Proximity check
  allFeatures.forEach(f => {
    if (!isVisible(f)) return;
    const [flng, flat] = f.geometry.coordinates;
    const dist = haversine(lat, lng, flat, flng);
    const id   = featureId(f);
    const r    = getRadius(f);

    if (dist <= r && !alerted.has(id)) {
      alerted.add(id);
      triggerAlert(f, Math.round(dist), id);
    }
  });
}

function onPosError(err) {
  const msgs = { 1:'Location permission denied.', 2:'Position unavailable.', 3:'Location timed out.' };
  toast(`⚠️ ${msgs[err.code] || 'Location error'}`, true);
  setStatus('', msgs[err.code] || 'Error');
}

function triggerAlert(f, dist, id) {
  const p = f.properties;
  const style = CONFIG.categoryStyle[p.category] || CONFIG.categoryStyle.other;

  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(`${style.emoji} ${p.name}`, {
      body: p.note ? p.note.slice(0, 100) : `You are ${dist}m away`,
      silent: false
    });
  }

  // Vibrate
  if ('vibrate' in navigator) navigator.vibrate([150, 80, 150, 80, 300]);

  // In-app toast
  toast(`${style.emoji} <strong>${p.name}</strong> — ${dist}m away!${p.note ? `<br><em style="opacity:0.75;font-size:0.78rem">${p.note.slice(0,80)}…</em>` : ''}`, true);

  // Update marker colour & fly
  const [lng, lat] = f.geometry.coordinates;
  map.flyTo([lat, lng], 17, { duration: 1 });
  setTimeout(() => leafletLayers[id]?.marker.openPopup(), 1100);

  // Refresh icon to show triggered state
  leafletLayers[id]?.marker.setIcon(makeIcon(p.category || 'other', true));
}

function centerOnUser() {
  if (userMarker) map.flyTo(userMarker.getLatLng(), 16, { duration: 0.8 });
  else toast('Start tracking first to see your location.');
}

// ═══════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2-lat1)*r, dLng = (lng2-lng1)*r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLng/2)**2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function toast(html, isAlert = false) {
  const c = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (isAlert ? ' alert' : '');
  t.innerHTML = html;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function setStatus(state, text) {
  document.getElementById('statusDot').className = 'status-dot' + (state ? ' ' + state : '');
  document.getElementById('statusText').textContent = text;
}
function showStatus() { document.getElementById('status').classList.remove('hidden'); }
function hideStatus() { document.getElementById('status').classList.add('hidden'); }

// ═══════════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════════
loadPOIs();
