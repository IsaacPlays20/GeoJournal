let storage = JSON.parse(localStorage.getItem('geojournal_v11')) || { pins: [], walks: [], theme: 'light', mapStyle: 'voyager' };
let currentMode = 'explore', tempPath = [], pendingCoords = null, activeSelectionId = null, currentRating = 0, isEditing = false;
let activeFilters = { type: 'all', sort: 'rating' };
let mapItems = new L.FeatureGroup(), userPos = null, userMarker = null, nodeHandles = [], chartInstance = null;

const map = L.map('map', { zoomControl: false }).setView([51.505, -0.09], 13);
mapItems.addTo(map);

const mapStyles = { 
    voyager: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', 
    sat: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' 
};

let baseLayer = L.tileLayer(mapStyles[storage.mapStyle]).addTo(map);
let tempPoly = L.polyline([], {color: '#10b981', weight: 4, dashArray: '5, 10'}).addTo(map);

// Initial State
document.body.className = storage.theme + '-theme';
document.getElementById('themeToggle').checked = (storage.theme === 'dark');
document.getElementById('mapToggle').checked = (storage.mapStyle === 'sat');

map.on('locationfound', (e) => {
    userPos = e.latlng;
    if (!userMarker) userMarker = L.marker(e.latlng, { icon: L.divIcon({ className: '', html: '<div class="gps-indicator-wrapper"><div class="gps-indicator"></div><div class="gps-pulse"></div></div>', iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(map);
    else userMarker.setLatLng(e.latlng);
    updateHighlights();
});
map.locate({ setView: true, maxZoom: 15, watch: true });

function toggleSettings() {
    const menu = document.getElementById('settingsMenu');
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function goBack() {
    document.getElementById('backBtn').style.display = 'none';
    document.getElementById('mainTabs').style.display = 'flex';
    document.getElementById('detail-view').style.display = 'none';
    switchTab('explore');
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tab + 'Tab').classList.add('active');
    document.getElementById('explore-panel').style.display = (tab === 'explore' ? 'block' : 'none');
    document.getElementById('add-panel').style.display = (tab === 'add' ? 'block' : 'none');
    document.getElementById('detail-view').style.display = 'none';
    setMode(tab === 'explore' ? 'explore' : 'ready');
}

function setFilter(category, value, btn) {
    activeFilters[category] = value;
    btn.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateHighlights();
}

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.btn-main').forEach(b => b.classList.remove('active-mode'));
    if (document.getElementById(mode + 'ModeBtn')) document.getElementById(mode + 'ModeBtn').classList.add('active-mode');
    document.getElementById('route-stats').style.display = (mode === 'walk' ? 'block' : 'none');
    isEditing = false; nodeHandles.forEach(h => map.removeLayer(h)); closeElevation();
    if(mode !== 'walk' && mode !== 'pin') { tempPath = []; tempPoly.setLatLngs([]); }
}

document.getElementById('pinModeBtn').onclick = () => setMode('pin');
document.getElementById('walkModeBtn').onclick = () => setMode('walk');

function updateHighlights() {
    const list = document.getElementById('highlights-list');
    if (document.getElementById('explore-panel').style.display === 'none' || document.getElementById('detail-view').style.display === 'flex') return;
    let all = [...storage.pins.map(p => ({...p, type:'PIN'})), ...storage.walks.map(w => ({...w, type:'WALK', lat:w.path[0][0], lng:w.path[0][1]}))];
    if (activeFilters.type !== 'all') all = all.filter(i => i.type === activeFilters.type);
    if (userPos) all.forEach(i => i.d = L.latLng(i.lat, i.lng).distanceTo(userPos) / 1000);
    if (activeFilters.sort === 'rating') all.sort((a,b) => b.rating - a.rating);
    else all.sort((a,b) => (a.d || 0) - (b.d || 0));
    list.innerHTML = all.length ? '' : '<p style="font-size:12px;opacity:0.5;text-align:center;">Empty library.</p>';
    all.forEach(i => {
        const div = document.createElement('div'); div.className = 'highlight-item';
        div.innerHTML = `<img class="highlight-thumb" src="${i.photo || 'https://placehold.co/100?text=No+Photo'}">
            <div style="flex:1"><span class="type-label">${i.type}</span><p style="font-weight:bold;font-size:13px;margin:0;">${i.name}</p><div style="font-size:11px;color:#fbbf24;">${'★'.repeat(i.rating)} <span style="color:var(--text);opacity:0.5;">${i.d?i.d.toFixed(1)+'km away':''}</span></div></div>`;
        div.onclick = () => {
            const obj = i.type === 'PIN' ? storage.pins.find(p=>p.id===i.id) : storage.walks.find(w=>w.id===i.id);
            map.flyTo([i.lat, i.lng], 15);
            const layer = mapItems.getLayers().find(l => (i.type === 'WALK' && l instanceof L.Polyline && JSON.stringify(l.getLatLngs()[0]) === JSON.stringify(L.latLng(i.lat, i.lng))) || (i.type === 'PIN' && l instanceof L.Marker && l.getLatLng().equals(L.latLng(i.lat, i.lng))));
            showDetails(obj, i.type==='WALK', layer);
        };
        list.appendChild(div);
    });
}

map.on('click', (e) => {
    if (isEditing && window.currentActiveLayer instanceof L.Polyline) {
        const lls = window.currentActiveLayer.getLatLngs(); lls.push(e.latlng);
        window.currentActiveLayer.setLatLngs(lls); updateWalkStats(); createNodes(window.currentActiveLayer); return;
    }
    if (currentMode === 'pin') { pendingCoords = e.latlng; currentRating = 0; document.getElementById('modal-overlay').style.display = 'flex'; }
    if (currentMode === 'walk') { tempPath.push([e.latlng.lat, e.latlng.lng]); tempPoly.setLatLngs(tempPath); let d = 0; for(let i=1; i<tempPath.length; i++) d += L.latLng(tempPath[i-1]).distanceTo(L.latLng(tempPath[i])); document.getElementById('liveDist').innerText = `${(d/1000).toFixed(2)} km`; fetchElevation(tempPath); }
});

document.getElementById('confirmSaveBtn').onclick = async () => {
    const id = Date.now(), name = document.getElementById('itemName').value || "Untitled", desc = document.getElementById('itemDesc').value || "", rat = currentRating;
    let flat, flon;
    if (currentMode === 'pin') {
        flat = pendingCoords.lat; flon = pendingCoords.lng;
        const p = { id, name, desc, rating: rat, lat: flat, lng: flon };
        storage.pins.push(p); addPin(p);
    } else {
        if (tempPath.length < 2) return;
        let d = 0; for(let i=1; i<tempPath.length; i++) d += L.latLng(tempPath[i-1]).distanceTo(L.latLng(tempPath[i]));
        flat = tempPath[0][0]; flon = tempPath[0][1];
        const w = { id, name, desc, rating: rat, path: [...tempPath], dist: (d/1000).toFixed(2), lat: flat, lng: flon };
        storage.walks.push(w); addWalk(w);
    }
    saveData(); document.getElementById('modal-overlay').style.display = 'none'; goBack();
    fetchPhoto(flat, flon, id);
};

async function fetchPhoto(lat, lon, id) {
    try {
        const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gsradius=500&gscoord=${lat}|${lon}&format=json&origin=*`).then(r=>r.json());
        if(res.query?.geosearch?.length) {
            const title = res.query.geosearch[0].title;
            const imgRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&format=json&piprop=original&titles=${encodeURIComponent(title)}&pithumbsize=500&origin=*`).then(r=>r.json());
            const pg = Object.values(imgRes.query.pages)[0];
            if(pg.original) {
                let entry = storage.pins.find(x=>x.id===id) || storage.walks.find(x=>x.id===id);
                if(entry && !entry.photo) { entry.photo = pg.original.source; saveData(); updateHighlights(); }
            }
        }
    } catch(e){}
}

document.getElementById('photoInput').onchange = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
        const item = storage.pins.find(p=>p.id===activeSelectionId) || storage.walks.find(w=>w.id===activeSelectionId);
        if (item) {
            item.photo = event.target.result;
            saveData(); document.getElementById('detPhoto').src = item.photo;
            document.getElementById('detPhoto').style.display = 'block';
            updateHighlights();
        }
    };
    reader.readAsDataURL(file);
};

function addPin(p) { L.marker([p.lat, p.lng]).addTo(mapItems).on('click', (e) => { L.DomEvent.stopPropagation(e); showDetails(p, false, e.target); }); }
function addWalk(w) { L.polyline(w.path, {color:'#2563eb', weight:5}).addTo(mapItems).on('click', (e) => { L.DomEvent.stopPropagation(e); showDetails(w, true, e.target); }); }

function showDetails(item, isWalk, layer) {
    if (!item) return;
    activeSelectionId = item.id; isEditing = false;
    document.getElementById('explore-panel').style.display = 'none';
    document.getElementById('add-panel').style.display = 'none';
    document.getElementById('mainTabs').style.display = 'none';
    document.getElementById('backBtn').style.display = 'block';
    const dv = document.getElementById('detail-view'); dv.style.display = 'flex';
    const toggleBtn = document.getElementById('toggleEditBtn');
    toggleBtn.innerText = '✏️ EDIT ENTRY'; toggleBtn.classList.remove('active-saving');
    document.getElementById('deleteItemBtn').style.display = 'none';
    document.getElementById('uploadContainer').style.display = 'none';
    const img = document.getElementById('detPhoto'); img.src = item.photo || ""; img.style.display = item.photo ? 'block' : 'none';
    document.getElementById('editTitle').value = item.name; document.getElementById('editDesc').value = item.desc || "";
    document.querySelectorAll('.edit-input').forEach(i=>i.classList.remove('active'));
    renderStars(item);
    if (isWalk) { updateStatsDisplay(item); fetchElevation(item.path); window.currentActiveLayer = layer; } 
    else { document.getElementById('detStats').innerText = `📍 Saved Pin`; closeElevation(); window.currentActiveLayer = null; }
    nodeHandles.forEach(h=>map.removeLayer(h));
}

function updateStatsDisplay(item) {
    if (!item.elevData) { document.getElementById('detStats').innerText = `📏 ${item.dist} km Walk`; return; }
    const max = Math.max(...item.elevData);
    let ascent = 0; for(let i=1; i<item.elevData.length; i++) { let diff = item.elevData[i] - item.elevData[i-1]; if(diff > 0) ascent += diff; }
    document.getElementById('detStats').innerHTML = `📏 ${item.dist} km Walk | ⛰️ Ascent: ${Math.round(ascent)}m | Max: ${Math.round(max)}m`;
}

function renderStars(item) {
    const rDiv = document.getElementById('detRating'); rDiv.innerHTML = "";
    for(let i=1; i<=5; i++) {
        const s = document.createElement('span'); s.innerText = i <= item.rating ? '★' : '☆';
        s.onclick = () => { if(isEditing) { item.rating = i; renderStars(item); saveData(); } };
        rDiv.appendChild(s);
    }
}

document.getElementById('toggleEditBtn').onclick = function() {
    isEditing = !isEditing;
    this.innerText = isEditing ? '✔️ SAVE CHANGES' : '✏️ EDIT ENTRY';
    this.classList.toggle('active-saving', isEditing);
    document.getElementById('deleteItemBtn').style.display = isEditing ? 'block' : 'none';
    document.getElementById('uploadContainer').style.display = isEditing ? 'block' : 'none';
    document.querySelectorAll('.edit-input').forEach(inp => inp.classList.toggle('active', isEditing));
    const item = storage.pins.find(p=>p.id===activeSelectionId) || storage.walks.find(w=>w.id===activeSelectionId);
    if(isEditing && storage.walks.some(w=>w.id===activeSelectionId) && window.currentActiveLayer) createNodes(window.currentActiveLayer);
    else nodeHandles.forEach(h=>map.removeLayer(h));
    document.getElementById('editTitle').oninput = () => { item.name = document.getElementById('editTitle').value; saveData(); };
    document.getElementById('editDesc').oninput = () => { item.desc = document.getElementById('editDesc').value; saveData(); };
};

function createNodes(layer) {
    nodeHandles.forEach(h => map.removeLayer(h)); nodeHandles = [];
    const latlngs = layer.getLatLngs();
    latlngs.forEach((ll, i) => {
        const m = L.marker(ll, { draggable: true, icon: L.divIcon({ className:'node-handle', iconSize:[12,12], iconAnchor:[6,6] }) }).addTo(map);
        m.on('drag', (e) => { const currentLls = layer.getLatLngs(); currentLls[i] = e.target.getLatLng(); layer.setLatLngs(currentLls); updateWalkStats(); });
        m.on('click', (e) => { if (!isEditing) return; L.DomEvent.stopPropagation(e); const lls = layer.getLatLngs(); if (lls.length > 2) { lls.splice(i, 1); layer.setLatLngs(lls); updateWalkStats(); createNodes(layer); } });
        nodeHandles.push(m);
        if (i < latlngs.length - 1) {
            const mid = L.latLng((ll.lat + latlngs[i+1].lat) / 2, (ll.lng + latlngs[i+1].lng) / 2);
            const midH = L.marker(mid, { draggable: true, icon: L.divIcon({ className:'mid-handle', iconSize:[8,8], iconAnchor:[4,4] }) }).addTo(map);
            midH.on('dragstart', (e) => { const currentLls = layer.getLatLngs(); currentLls.splice(i + 1, 0, e.target.getLatLng()); layer.setLatLngs(currentLls); });
            midH.on('drag', (e) => { const currentLls = layer.getLatLngs(); currentLls[i + 1] = e.target.getLatLng(); layer.setLatLngs(currentLls); updateWalkStats(); });
            midH.on('dragend', () => createNodes(layer));
            nodeHandles.push(midH);
        }
    });
}

function updateWalkStats() {
    const layer = window.currentActiveLayer; if (!layer) return;
    const lls = layer.getLatLngs(); let d = 0; for(let j=1; j<lls.length; j++) d += lls[j-1].distanceTo(lls[j]);
    const item = storage.walks.find(w => w.id === activeSelectionId);
    item.dist = (d/1000).toFixed(2); item.path = lls.map(l => [l.lat, l.lng]);
    saveData(); fetchElevation(item.path);
}

async function fetchElevation(path) {
    try {
        let sampledPoints = [];
        for (let i = 0; i < path.length - 1; i++) {
            const start = L.latLng(path[i]);
            const end = L.latLng(path[i+1]);
            const dist = start.distanceTo(end);
            sampledPoints.push(start);
            const numSteps = Math.floor(dist / 100); 
            for (let j = 1; j <= numSteps; j++) {
                const ratio = (j * 100) / dist;
                sampledPoints.push(L.latLng(start.lat + (end.lat - start.lat) * ratio, start.lng + (end.lng - start.lng) * ratio));
            }
        }
        sampledPoints.push(L.latLng(path[path.length - 1]));
        const res = await fetch('https://api.open-elevation.com/api/v1/lookup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ locations: sampledPoints.map(p => ({ latitude: p.lat, longitude: p.lng })) }) }).then(r=>r.json());
        const elevs = res.results.map(r => r.elevation);
        const item = storage.walks.find(w => w.id === activeSelectionId);
        if(item) { item.elevData = elevs; saveData(); updateStatsDisplay(item); }
        let currentTotal = 0, distData = [0];
        for(let i = 1; i < sampledPoints.length; i++){ currentTotal += sampledPoints[i-1].distanceTo(sampledPoints[i]); distData.push(currentTotal / 1000); }
        let labels = distData.map(d => (Math.round(d * 10) / 10).toFixed(1));
        document.getElementById('elevation-dock').classList.add('active');
        const ctx = document.getElementById('elevChart').getContext('2d');
        if(chartInstance) chartInstance.destroy();
        chartInstance = new Chart(ctx, { 
            type:'line', data:{ labels: labels, datasets:[{ data:elevs, borderColor:'#2563eb', backgroundColor: 'rgba(37, 99, 235, 0.15)', fill:true, pointRadius:0, borderWidth: 2, tension:0.4, cubicInterpolationMode: 'monotone' }] }, 
            options:{ maintainAspectRatio:false, interaction: { intersect: false, mode: 'index' }, plugins:{ legend:{display:false} },
            scales:{ x:{ title: { display: true, text: 'Distance (km)', font: { size: 10, weight: 'bold' } }, ticks: { maxTicksLimit: 12, font: { size: 9 }, callback: (v, i) => labels[i] + 'km' } },
            y:{ title: { display: true, text: 'Height (m)', font: { size: 10, weight: 'bold' } }, ticks: { font: { size: 9 }, callback: (v) => v + 'm' } } } } 
        });
    } catch(e) {}
}

function closeElevation() { document.getElementById('elevation-dock').classList.remove('active'); }
function saveData() { localStorage.setItem('geojournal_v11', JSON.stringify(storage)); }

document.getElementById('themeToggle').onchange = (e) => { storage.theme = e.target.checked ? 'dark' : 'light'; document.body.className = storage.theme + '-theme'; saveData(); };
document.getElementById('mapToggle').onchange = (e) => { storage.mapStyle = e.target.checked ? 'sat' : 'voyager'; map.removeLayer(baseLayer); baseLayer = L.tileLayer(mapStyles[storage.mapStyle]).addTo(map); saveData(); };
document.getElementById('mainSearch').onkeypress = (e) => { if(e.key==='Enter') fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${e.target.value}`).then(r=>r.json()).then(d=>d.length && map.flyTo([d[0].lat, d[0].lon], 15)); };
document.getElementById('modalStars').onclick = (e) => { if(e.target.dataset.value) { currentRating = parseInt(e.target.dataset.value); document.querySelectorAll('#modalStars .star').forEach(s => s.style.color = s.dataset.value <= currentRating ? '#fbbf24' : '#cbd5e1'); } };
document.getElementById('deleteItemBtn').onclick = () => { if(confirm("Delete?")){ storage.pins = storage.pins.filter(p => p.id !== activeSelectionId); storage.walks = storage.walks.filter(w => w.id !== activeSelectionId); saveData(); mapItems.clearLayers(); storage.pins.forEach(addPin); storage.walks.forEach(addWalk); goBack(); } };
document.getElementById('finishWalkBtn').onclick = () => { if(tempPath.length < 2) return; document.getElementById('modalStars').querySelectorAll('.star').forEach(s=>s.style.color='#cbd5e1'); document.getElementById('modal-overlay').style.display = 'flex'; };

storage.pins.forEach(addPin); 
storage.walks.forEach(addWalk);
switchTab('explore');
