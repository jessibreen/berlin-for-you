// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION — edit these to match your repo and categories
// ═══════════════════════════════════════════════════════════════════
const CONFIG = {
  // Path to GeoJSON, relative to this HTML file in the same repo
  geojsonPath: './data/pois.geojson',

  enableFilters: false,

  // Fallback centre if GeoJSON cannot be loaded or is empty
  mapCenter: [52.52, 13.405],
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
    neighborhood:{ emoji: '🏘', color: '#70b080' },
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

function getFeatureName(feature) {
  return feature.properties.name || feature.properties.Name || 'Unnamed';
}

function getFeatureNotes(feature) {
  return feature.properties.notes || feature.properties.Notes || '';
}

// ═══════════════════════════════════════════════════════════════════
// Map
// ═══════════════════════════════════════════════════════════════════
const map = L.map('map', { zoomControl: false })
  .setView(CONFIG.mapCenter, CONFIG.mapZoom);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 20
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
    fitMapToFeatures();
  } catch (e) {
    toast(`⚠️ Could not load POI data.<br><small>${e.message}</small>`, true);
    console.error(e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Filters
// ═══════════════════════════════════════════════════════════════════
function buildFilters() {
  if (!CONFIG.enableFilters) {
    const container = document.getElementById('filters');
    container.innerHTML = '';
    container.classList.add('hidden');
    activeFilters = new Set(['all']);
    return;
  }

  const cats = [...new Set(allFeatures.map(f => f.properties.category || 'other'))];
  const container = document.getElementById('filters');
  container.classList.remove('hidden');

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
  if (!CONFIG.enableFilters) return;

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
  if (!CONFIG.enableFilters) return true;
  if (activeFilters.has('all')) return true;
  return activeFilters.has(feature.properties.category || 'other');
}

function applyFilters() {
  if (!CONFIG.enableFilters) return;

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
  return getFeatureName(f) + '_' + f.geometry.coordinates.join('_');
}

function getRadius(f) {
  const p = f.properties;
  if (p.radius) return p.radius;
  return CONFIG.categoryDefaults[p.category] || CONFIG.categoryDefaults.other;
}

function getMarkerPalette() {
  const theme = document.body?.dataset?.theme || 'cyan';
  if (theme === 'rust') {
    return {
      marker: '#b65a34',
      markerAlert: '#7b3418',
      halo: 'rgba(182,90,52,0.28)',
      ring: 'rgba(182,90,52,0.42)',
      ringFill: 'rgba(182,90,52,0.08)',
      cardBg: 'rgba(182,90,52,0.12)',
      cardBorder: 'rgba(182,90,52,0.28)'
    };
  }

  return {
    marker: '#0f95ad',
    markerAlert: '#0b5d6d',
    halo: 'rgba(15,149,173,0.28)',
    ring: 'rgba(15,149,173,0.44)',
    ringFill: 'rgba(15,149,173,0.08)',
    cardBg: 'rgba(15,149,173,0.12)',
    cardBorder: 'rgba(15,149,173,0.28)'
  };
}

function makeIcon(triggered = false) {
  const palette = getMarkerPalette();
  const fill = triggered ? palette.markerAlert : palette.marker;
  return L.divIcon({
    className: '',
    html: `<div style="
      width:18px;height:18px;
      border-radius:50%;
      background:${fill};
      border:3px solid rgba(255,255,255,0.95);
      box-shadow:0 3px 12px ${palette.halo};
    "></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12]
  });
}

function makePopup(f) {
  const name = getFeatureName(f);
  const notes = getFeatureNotes(f);

  return `<div class="popup-inner">
    <div class="popup-name">${name}</div>
    ${notes ? `<div class="popup-note">${notes}</div>` : ''}
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
    const id  = featureId(f);
    const r   = getRadius(f);
    const palette = getMarkerPalette();

    const marker = L.marker([lat, lng], { icon: makeIcon(alerted.has(id)) })
      .bindPopup(makePopup(f), { maxWidth: 280 });

    const circle = L.circle([lat, lng], {
      radius: r,
      color: palette.ring,
      fillColor: palette.ringFill,
      fillOpacity: 1,
      weight: 1,
      dashArray: '3 5'
    });

    if (isVisible(f)) { marker.addTo(map); circle.addTo(map); }

    leafletLayers[id] = { marker, circle };
  });
}

function fitMapToFeatures() {
  const points = allFeatures
    .filter(f => f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates))
    .map(f => {
      const [lng, lat] = f.geometry.coordinates;
      return [lat, lng];
    })
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

  if (points.length === 0) {
    map.setView(CONFIG.mapCenter, CONFIG.mapZoom);
    return;
  }

  if (points.length === 1) {
    map.setView(points[0], 15);
    return;
  }

  map.fitBounds(points, {
    padding: [28, 28],
    maxZoom: 13
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
        const palette = getMarkerPalette();
        const id = featureId(f);
        return `<div class="poi-card" onclick="flyTo('${id}')">
          <div class="poi-card-icon" style="background:${palette.cardBg};border-color:${palette.cardBorder};color:${palette.marker}">
            ●
          </div>
          <div class="poi-card-body">
            <strong>${getFeatureName(f)}</strong>
            <small>${getFeatureNotes(f) || ''}</small>
          </div>
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
  const name = getFeatureName(f);
  const notes = getFeatureNotes(f);

  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(name, {
      body: notes ? notes.slice(0, 100) : `You are ${dist}m away`,
      silent: false
    });
  }

  // Vibrate
  if ('vibrate' in navigator) navigator.vibrate([150, 80, 150, 80, 300]);

  // In-app toast
  toast(`<strong>${name}</strong> — ${dist}m away!${notes ? `<br><em style="opacity:0.75;font-size:0.78rem">${notes.slice(0,80)}${notes.length > 80 ? '…' : ''}</em>` : ''}`, true);

  // Update marker colour & fly
  const [lng, lat] = f.geometry.coordinates;
  map.flyTo([lat, lng], 17, { duration: 1 });
  setTimeout(() => leafletLayers[id]?.marker.openPopup(), 1100);

  // Refresh icon to show triggered state
  leafletLayers[id]?.marker.setIcon(makeIcon(true));
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
