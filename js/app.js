// js/app.js (Para Smart Move Pro - App del Chofer)

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js') // Asegúrate que la ruta sea correcta
            .then(registration => console.log('SmartMovePro: SW registered: ', registration.scope))
            .catch(error => console.log('SmartMovePro: SW registration failed: ', error));
    });
}

// --- Variables Globales ---
let map;
let currentPositionMarker;
let routePolyline;
let stopMarkers = [];
let startPointGeofenceCircle = null;
let endPointGeofenceCircle = null;

let currentTempRoute = { name: "", startPoint: null, endPoint: null, intermediateStops: [] };
let allSavedRoutes = [];
let trackingQueue = [];

let isTracking = false;
let currentTrackingRouteIndex = -1;
let currentTrackingStopIndex = -1; // -1 = antes del inicio
let trackingInterval;
let lastKnownPosition = null;
let lastCalculatedDiffMillis = 0;

// Constantes
const GEOFENCE_RADIUS_METERS = 100;
const PROXIMITY_THRESHOLD_METERS = 70;
const MAX_DISTANCE_TO_EXPECTED_NEXT_STOP_METERS = 5000;

let settingPointType = null;

// --- Iconos Leaflet ---
const currentLocationIcon = L.divIcon({ className: 'current-location-icon', html: '', iconSize: [12, 12], iconAnchor: [6, 6] });
function createStopIcon(number, type = 'intermediate') {
    let className = 'stop-marker-icon-content'; let content = number;
    if (type === 'start') { className = 'start-marker-icon-content'; content = 'I'; }
    else if (type === 'end') { className = 'end-marker-icon-content'; content = 'F'; }
    return L.divIcon({ className: 'custom-marker-icon', html: `<div class="${className}">${content}</div>`, iconSize: type === 'intermediate' ? [20, 20] : [24, 24], iconAnchor: type === 'intermediate' ? [10, 10] : [12, 12] });
}

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadRoutesFromLocalStorage();
    populateSavedRoutesSelect();
    bindEventListeners();
    updateTrackingButtonsState();
    updateManualControlsState();
    updatePassengerTrackingStatus(false);
    resetRouteCreationState();
});

function initMap() {
    map = L.map('map').setView([-34.6037, -58.3816], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    map.on('click', onMapClick);
    startGeolocation();
}
function startGeolocation() {
    if (navigator.geolocation) { navigator.geolocation.watchPosition(updateCurrentPosition, handleLocationError, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }); }
    else { alert("Geolocalización no soportada."); }
}
function updateCurrentPosition(position) {
    const lat = position.coords.latitude; const lng = position.coords.longitude; lastKnownPosition = { lat, lng };
    if (!currentPositionMarker) { currentPositionMarker = L.marker([lat, lng], { icon: currentLocationIcon }).addTo(map); map.setView([lat, lng], 16); }
    else { currentPositionMarker.setLatLng([lat, lng]); }
}
function handleLocationError(error) { console.warn(`SmartMovePro: Geo Error(${error.code}): ${error.message}`); }

// --- LÓGICA DE CREACIÓN/EDICIÓN DE RUTA ---
function resetRouteCreationState() { currentTempRoute = { name: "", startPoint: null, endPoint: null, intermediateStops: [] }; document.getElementById('route-name-input').value = ""; document.getElementById('start-point-info').style.display = 'none'; document.getElementById('start-time-input').value = ""; document.getElementById('start-point-name-display').textContent = "Inicio Ruta"; document.getElementById('end-point-info').style.display = 'none'; document.getElementById('end-time-input').value = ""; document.getElementById('end-point-name-display').textContent = "Fin Ruta"; document.getElementById('set-start-point-btn').disabled = false; document.getElementById('set-end-point-btn').disabled = true; settingPointType = null; renderCurrentStopsList(); clearMapElements(); }
function onMapClick(e) { if (isTracking) return; if (settingPointType) { const { lat, lng } = e.latlng; if (settingPointType === 'start') { currentTempRoute.startPoint = { lat, lng, name: "Inicio Ruta", departureTime: document.getElementById('start-time-input').value || "", type: 'start' }; document.getElementById('start-point-info').style.display = 'block'; document.getElementById('start-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`; document.getElementById('set-start-point-btn').disabled = true; document.getElementById('set-end-point-btn').disabled = false; settingPointType = null; renderCurrentStopsList(); } else if (settingPointType === 'end') { if (!currentTempRoute.startPoint) { alert("Define Inicio."); settingPointType = null; return; } currentTempRoute.endPoint = { lat, lng, name: "Fin Ruta", arrivalTime: document.getElementById('end-time-input').value || "", type: 'end' }; document.getElementById('end-point-info').style.display = 'block'; document.getElementById('end-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`; document.getElementById('set-end-point-btn').disabled = true; settingPointType = null; renderCurrentStopsList(); recalculateIntermediateStopTimes(); } settingPointType = null; } else if (currentTempRoute.startPoint && currentTempRoute.endPoint) { const { lat, lng } = e.latlng; const newIS = { lat, lng, name: "", type: 'intermediate', arrivalTime: "" }; let idx = currentTempRoute.intermediateStops.length; currentTempRoute.intermediateStops.splice(idx, 0, newIS); if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); renderCurrentStopsList(); } else { openStopModal(newIS, idx); } } else { alert("Define Inicio y Fin primero."); } }
function openStopModal(stopData, index) { document.getElementById('stop-lat-input').value = stopData.lat; document.getElementById('stop-lng-input').value = stopData.lng; document.getElementById('stop-index-input').value = index; document.getElementById('stop-name-input').value = stopData.name || ""; const auto = document.getElementById('auto-time-intermediate-checkbox').checked; document.getElementById('manual-time-fields').style.display = auto ? 'none' : 'block'; document.getElementById('auto-time-info').style.display = auto ? 'block' : 'none'; if (!auto) { document.getElementById('arrival-time-input').value = stopData.arrivalTime || ""; } document.getElementById('modal-title').textContent = `Parada Intermedia ${index + 1}`; document.getElementById('stop-modal').style.display = 'block'; }
function closeStopModal() { document.getElementById('stop-modal').style.display = 'none'; }
function saveStopModalAction() { const idx = parseInt(document.getElementById('stop-index-input').value); const stop = currentTempRoute.intermediateStops[idx]; stop.name = document.getElementById('stop-name-input').value.trim(); if (!document.getElementById('auto-time-intermediate-checkbox').checked) { const arrival = document.getElementById('arrival-time-input').value; if (!arrival) { alert("Ingresa hora."); return; } stop.arrivalTime = arrival; stop.departureTime = arrival; } if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); closeStopModal(); }
function startNewRouteAction() { if (isTracking) { alert("Detén seguimiento."); return; } const name = document.getElementById('route-name-input').value.trim(); resetRouteCreationState(); currentTempRoute.name = name || "Ruta Sin Nombre"; document.getElementById('route-name-input').value = currentTempRoute.name; alert("Nueva ruta iniciada."); }
function recalculateIntermediateStopTimes() { if (!currentTempRoute.startPoint || !currentTempRoute.endPoint || !currentTempRoute.startPoint.departureTime || !currentTempRoute.endPoint.arrivalTime || currentTempRoute.intermediateStops.length === 0) { renderCurrentStopsList(); return; } const startStr = currentTempRoute.startPoint.departureTime; const endStr = currentTempRoute.endPoint.arrivalTime; let startD = new Date(); startD.setHours(parseInt(startStr.split(':')[0]), parseInt(startStr.split(':')[1]), 0, 0); let endD = new Date(); endD.setHours(parseInt(endStr.split(':')[0]), parseInt(endStr.split(':')[1]), 0, 0); if (endD < startD) endD.setDate(endD.getDate() + 1); const totalDur = endD - startD; if (totalDur <= 0) { console.warn("Duración inválida."); currentTempRoute.intermediateStops.forEach(s => {s.arrivalTime = s.departureTime = "Error";}); renderCurrentStopsList(); return; } const startLL = L.latLng(currentTempRoute.startPoint.lat, currentTempRoute.startPoint.lng); let coords = [startLL]; currentTempRoute.intermediateStops.forEach(s => coords.push(L.latLng(s.lat, s.lng))); coords.push(L.latLng(currentTempRoute.endPoint.lat, currentTempRoute.endPoint.lng)); let totalDist = 0; for (let i = 0; i < coords.length - 1; i++) totalDist += coords[i].distanceTo(coords[i+1]); if (totalDist === 0) { console.warn("Distancia cero."); currentTempRoute.intermediateStops.forEach(s => {s.arrivalTime = s.departureTime = "Dist.0";}); renderCurrentStopsList(); return; } let accumDist = 0; for (let i = 0; i < currentTempRoute.intermediateStops.length; i++) { const prevP = (i === 0) ? startLL : L.latLng(currentTempRoute.intermediateStops[i-1].lat, currentTempRoute.intermediateStops[i-1].lng); const currP = L.latLng(currentTempRoute.intermediateStops[i].lat, currentTempRoute.intermediateStops[i].lng); accumDist += prevP.distanceTo(currP); const prop = accumDist / totalDist; const offset = Math.round(totalDur * prop); let iTime = new Date(startD.getTime() + offset); const calcTime = `${String(iTime.getHours()).padStart(2, '0')}:${String(iTime.getMinutes()).padStart(2, '0')}`; currentTempRoute.intermediateStops[i].arrivalTime = calcTime; currentTempRoute.intermediateStops[i].departureTime = calcTime; } renderCurrentStopsList(); }
function getCombinedStopsForDisplayAndMap() { let c = []; if (currentTempRoute.startPoint) c.push(currentTempRoute.startPoint); c = c.concat(currentTempRoute.intermediateStops); if (currentTempRoute.endPoint) c.push(currentTempRoute.endPoint); return c; }
function renderCurrentStopsList() { const list = document.getElementById('current-stops-list'); list.innerHTML = ''; const stops = getCombinedStopsForDisplayAndMap(); stops.forEach(s => { const li = document.createElement('li'); let lbl = "", time = ""; if (s.type === 'start') { lbl = `<strong>Inicio: ${s.name || ''}</strong>`; time = `Salida: ${s.departureTime || '--:--'}`; } else if (s.type === 'end') { lbl = `<strong>Fin: ${s.name || ''}</strong>`; time = `Llegada: ${s.arrivalTime || '--:--'}`; } else { const i = currentTempRoute.intermediateStops.indexOf(s); lbl = `Parada ${i + 1}: ${s.name || ''}`; time = `Paso: ${s.arrivalTime || '--:--'}`; } li.innerHTML = `<div class="stop-info">${lbl}<br><small>${time} (${s.lat.toFixed(4)}, ${s.lng.toFixed(4)})</small></div> ${ (s.type === 'intermediate') ? `<div class="stop-actions"><button data-action="edit-intermediate" data-index="${currentTempRoute.intermediateStops.indexOf(s)}">Editar</button><button data-action="remove-intermediate" data-index="${currentTempRoute.intermediateStops.indexOf(s)}" class="danger">Eliminar</button></div>` : ''}`; list.appendChild(li); }); drawRouteOnMap(stops); }
function drawRouteOnMap(stops) { clearMapElements(); const lls = []; stops.forEach((s, i) => { let icon, pop = `<b>${s.name || `Punto ${i + 1}`}</b> (${s.type})<br>`; if (s.type === 'start') { icon = createStopIcon('I', 'start'); pop += `Salida: ${s.departureTime || '--:--'}`; } else if (s.type === 'end') { icon = createStopIcon('F', 'end'); pop += `Llegada: ${s.arrivalTime || '--:--'}`; } else { const iIdx = currentTempRoute.intermediateStops.indexOf(s) + 1; icon = createStopIcon(iIdx, 'intermediate'); pop += `Paso: ${s.arrivalTime || '--:--'}`; } const m = L.marker([s.lat, s.lng], { icon }).addTo(map); m.bindPopup(pop); stopMarkers.push(m); lls.push([s.lat, s.lng]); }); if (lls.length > 1) { routePolyline = L.polyline(lls, { color: 'blue' }).addTo(map); } }
function clearMapElements() { stopMarkers.forEach(m => map.removeLayer(m)); stopMarkers = []; if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; } if (startPointGeofenceCircle) { map.removeLayer(startPointGeofenceCircle); startPointGeofenceCircle = null; } if (endPointGeofenceCircle) { map.removeLayer(endPointGeofenceCircle); endPointGeofenceCircle = null; } }

// --- GUARDAR/CARGAR/BORRAR RUTAS ---
function saveRouteAction() { if (isTracking) { alert("Detén seguimiento."); return; } if (!currentTempRoute.startPoint || !currentTempRoute.endPoint || !currentTempRoute.startPoint.departureTime || !currentTempRoute.endPoint.arrivalTime) { alert("Define inicio/fin con horarios."); return; } if (!currentTempRoute.name || currentTempRoute.name === "Ruta Sin Nombre") { const n = prompt("Nombre ruta:", currentTempRoute.name === "Ruta Sin Nombre" ? "" : currentTempRoute.name); if (!n || n.trim() === "") { alert("Se requiere nombre."); return; } currentTempRoute.name = n.trim(); document.getElementById('route-name-input').value = currentTempRoute.name; } if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } for (const s of currentTempRoute.intermediateStops) { if (!s.arrivalTime || s.arrivalTime.includes("Error") || s.arrivalTime.includes("Dist.0")) { alert(`Problema horario parada "${s.name || 'Intermedia'}".`); return; } } const route = JSON.parse(JSON.stringify(currentTempRoute)); const idx = allSavedRoutes.findIndex(r => r.name === route.name); if (idx > -1) { if (confirm(`Sobrescribir ruta "${route.name}"?`)) { allSavedRoutes[idx] = route; } else { return; } } else { allSavedRoutes.push(route); } saveRoutesToLocalStorage(); populateSavedRoutesSelect(); alert(`Ruta "${route.name}" guardada.`); }
function saveRoutesToLocalStorage() { localStorage.setItem('smartMoveProRoutes', JSON.stringify(allSavedRoutes)); }
function loadRoutesFromLocalStorage() { const s = localStorage.getItem('smartMoveProRoutes'); if (s) { try { allSavedRoutes = JSON.parse(s); } catch(e){ console.error("Error loading routes", e); allSavedRoutes = []; }} }
function populateSavedRoutesSelect() { const sel = document.getElementById('saved-routes-select'); const cur = sel.value; sel.innerHTML = '<option value="">-- Selecciona ruta --</option>'; allSavedRoutes.forEach((r, i) => { const o = document.createElement('option'); o.value = i; o.textContent = r.name; sel.appendChild(o); }); if (allSavedRoutes[parseInt(cur)]) { sel.value = cur; } else { sel.value = ""; } }
function loadRouteForEditingAction() { if (isTracking) { alert("Detén seguimiento."); return; } const idx = document.getElementById('saved-routes-select').value; if (idx === "") { alert("Selecciona ruta."); return; } resetRouteCreationState(); try { currentTempRoute = JSON.parse(JSON.stringify(allSavedRoutes[parseInt(idx)])); } catch(e) { alert("Error al cargar ruta."); return; } document.getElementById('route-name-input').value = currentTempRoute.name; if (currentTempRoute.startPoint) { document.getElementById('start-point-info').style.display = 'block'; document.getElementById('start-point-name-display').textContent = currentTempRoute.startPoint.name; document.getElementById('start-time-input').value = currentTempRoute.startPoint.departureTime; document.getElementById('start-point-coords').textContent = `(${currentTempRoute.startPoint.lat.toFixed(4)}, ${currentTempRoute.startPoint.lng.toFixed(4)})`; document.getElementById('set-start-point-btn').disabled = true; document.getElementById('set-end-point-btn').disabled = !currentTempRoute.endPoint; } if (currentTempRoute.endPoint) { document.getElementById('end-point-info').style.display = 'block'; document.getElementById('end-point-name-display').textContent = currentTempRoute.endPoint.name; document.getElementById('end-time-input').value = currentTempRoute.endPoint.arrivalTime; document.getElementById('end-point-coords').textContent = `(${currentTempRoute.endPoint.lat.toFixed(4)}, ${currentTempRoute.endPoint.lng.toFixed(4)})`; document.getElementById('set-end-point-btn').disabled = true; } renderCurrentStopsList(); alert(`Ruta "${currentTempRoute.name}" cargada.`); }
function deleteSelectedRouteAction() { if (isTracking) { alert("Detén seguimiento."); return; } const sel = document.getElementById('saved-routes-select'); const idx = sel.value; if (idx === "") { alert("Selecciona ruta."); return; } const name = allSavedRoutes[parseInt(idx)].name; if (confirm(`Eliminar ruta "${name}"?`)) { allSavedRoutes.splice(parseInt(idx), 1); saveRoutesToLocalStorage(); populateSavedRoutesSelect(); if (currentTempRoute.name === name) { resetRouteCreationState(); } alert(`Ruta "${name}" eliminada.`); } }

// --- GESTIÓN DE COLA DE SEGUIMIENTO ---
function addToTrackingQueueAction() { const idx = document.getElementById('saved-routes-select').value; if (idx === "") { alert("Selecciona ruta."); return; } const d = allSavedRoutes[parseInt(idx)]; if (!d.startPoint || !d.endPoint || !d.startPoint.departureTime || !d.endPoint.arrivalTime) { alert("Ruta incompleta."); return; } let flat = []; flat.push({ lat: d.startPoint.lat, lng: d.startPoint.lng, name: d.startPoint.name, arrivalTime: d.startPoint.departureTime, departureTime: d.startPoint.departureTime, type: 'start' }); (d.intermediateStops || []).forEach(s => { flat.push({ lat: s.lat, lng: s.lng, name: s.name || "Parada", arrivalTime: s.arrivalTime, departureTime: s.departureTime, type: 'intermediate' }); }); flat.push({ lat: d.endPoint.lat, lng: d.endPoint.lng, name: d.endPoint.name, arrivalTime: d.endPoint.arrivalTime, departureTime: d.endPoint.arrivalTime, type: 'end' }); const route = { name: d.name, stops: flat }; trackingQueue.push(JSON.parse(JSON.stringify(route))); renderTrackingQueue(); }
function clearTrackingQueueAction() { trackingQueue = []; renderTrackingQueue(); }
function renderTrackingQueue() { const list = document.getElementById('tracking-queue-list'); list.innerHTML = ''; trackingQueue.forEach((r, i) => { const li = document.createElement('li'); li.textContent = `${i + 1}. ${r.name} (${r.stops.length} paradas)`; list.appendChild(li); }); }


// --- LÓGICA DE SEGUIMIENTO (MODIFICADA) ---
function startTrackingAction() {
    if (isTracking) { alert("Seguimiento activo."); return; }
    if (trackingQueue.length === 0) { alert("Añade rutas a la cola."); return; }
    if (!lastKnownPosition) { alert("Esperando GPS..."); return; }

    isTracking = true;
    currentTrackingRouteIndex = 0;
    currentTrackingStopIndex = -1; // Siempre inicia ANTES de la primera parada

    document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
    clearMapElements(); // Limpiar antes de dibujar
    drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops); // Dibuja ruta activa Y geofences

    // No llamar a findAndSetCurrentLeg aquí, el estado inicial -1 se maneja en calculateTimeDifference
    updateNextStopDisplay(); // Mostrar info inicial ("Salida de...")

    updateTrackingButtonsState();
    updateManualControlsState();

    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(calculateTimeDifference, 1000); // Intervalo principal

    updatePassengerTrackingStatus(true);
    alert("Seguimiento iniciado.");
}

function drawTrackingRouteOnMap(stops) { // Dibuja ruta y geofences en modo SEGUIMIENTO
    clearMapElements(); const lls = []; if (stops.length === 0) return;
    stops.forEach((s, i) => { let icon, pop = `<b>${s.name || `Punto ${i + 1}`}</b><br>`; if (s.type === 'start') { icon = createStopIcon('I', 'start'); pop += `Salida: ${s.departureTime || '--:--'}`; } else if (s.type === 'end') { icon = createStopIcon('F', 'end'); pop += `Llegada: ${s.arrivalTime || '--:--'}`; } else { icon = createStopIcon(i, 'intermediate'); pop += `Paso: ${s.arrivalTime || '--:--'}`; } const m = L.marker([s.lat, s.lng], { icon }).addTo(map); m.bindPopup(pop); stopMarkers.push(m); lls.push([s.lat, s.lng]); });
    if (lls.length > 1) { routePolyline = L.polyline(lls, { color: 'green', weight: 5 }).addTo(map); try {const startLL = L.latLng(stops[0].lat, stops[0].lng); startPointGeofenceCircle = L.circle(startLL, { radius: GEOFENCE_RADIUS_METERS, color: 'blue', fillOpacity: 0.1, weight: 1 }).addTo(map); const endLL = L.latLng(stops[stops.length - 1].lat, stops[stops.length - 1].lng); endPointGeofenceCircle = L.circle(endLL, { radius: GEOFENCE_RADIUS_METERS, color: 'red', fillOpacity: 0.1, weight: 1 }).addTo(map);} catch (e) { console.error("Error drawing geofences:", e)}}
}

function stopTrackingAction() {
    if (!isTracking) return; isTracking = false; if (trackingInterval) clearInterval(trackingInterval); trackingInterval = null;
    currentTrackingRouteIndex = -1; currentTrackingStopIndex = -1; lastCalculatedDiffMillis = 0;
    document.getElementById('time-difference-display').textContent = "--:--"; document.getElementById('time-difference-display').className = "";
    document.getElementById('next-stop-info').textContent = "Ninguna"; document.getElementById('current-route-info').textContent = "Ninguna";
    updateTrackingButtonsState(); updateManualControlsState(); updatePassengerTrackingStatus(false);
    clearMapElements(); // Limpiar todo, incluyendo geofences
    renderCurrentStopsList(); // Volver a mostrar ruta en edición
    alert("Seguimiento detenido.");
}

function updateTrackingButtonsState() { /* ... (sin cambios) ... */ }

function updateManualControlsState() { // Solo habilita/deshabilita botones
    const manualCheckbox = document.getElementById('manual-mode-checkbox');
    const prevBtn = document.getElementById('prev-stop-btn');
    const nextBtn = document.getElementById('next-stop-btn');
    const isManual = manualCheckbox.checked;
    prevBtn.disabled = !(isTracking && isManual);
    nextBtn.disabled = !(isTracking && isManual);
}

// Transición a la siguiente ruta en cola
function transitionToNextRoute() {
    if (!isTracking) return false;
    console.log(`SmartMovePro: Transicionando desde ruta índice ${currentTrackingRouteIndex}`);
    if (currentTrackingRouteIndex + 1 < trackingQueue.length) {
        const oldRouteName = trackingQueue[currentTrackingRouteIndex].name;
        currentTrackingRouteIndex++;
        currentTrackingStopIndex = -1; // Iniciar ANTES de la primera parada de la nueva ruta
        const newRouteName = trackingQueue[currentTrackingRouteIndex].name;
        const newRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
        alert(`Ruta "${oldRouteName}" completada. Iniciando "${newRouteName}".`);
        document.getElementById('current-route-info').textContent = newRouteName;
        clearMapElements(); // Limpiar elementos de la ruta anterior
        drawTrackingRouteOnMap(newRouteStops); // Dibujar la nueva ruta y geofences
        // No llamar a findAndSetCurrentLeg, el estado -1 es el correcto inicial
        updateNextStopDisplay();       // Mostrar "Salida de..."
        updatePassengerTrackingStatus(true); // Informar nueva ruta a pasajeros
        // El intervalo llamará a calculateTimeDifference para el estado inicial -1
        return true; // Transición exitosa
    } else {
        alert("¡Todas las rutas completadas!");
        stopTrackingAction(); // Detener si no hay más rutas
        return false; // No hubo transición
    }
}

// Avance manual entre paradas/rutas
function manualAdvanceStop(direction) {
    if (!isTracking || !document.getElementById('manual-mode-checkbox').checked) return;
    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    if (direction > 0) { // Avanzando
        const nextStopIndex = currentTrackingStopIndex + 1;
        if (nextStopIndex < currentRouteStops.length) { // Si hay una siguiente parada en esta ruta
            currentTrackingStopIndex = nextStopIndex; // Avanzar el índice
        } else { // Si no hay más paradas (estaba en la última o más allá), transicionar
            transitionToNextRoute();
        }
    } else { // Retrocediendo
        let newIdx = currentTrackingStopIndex - 1;
        if (newIdx >= -1) { // Si el nuevo índice es válido (o -1 para antes del inicio)
            currentTrackingStopIndex = newIdx;
        } else { // Intentar ir a ruta anterior si estaba en -1
            if (currentTrackingRouteIndex > 0) {
                currentTrackingRouteIndex--;
                const prevStops = trackingQueue[currentTrackingRouteIndex].stops;
                currentTrackingStopIndex = prevStops.length - 2; // Ir a la penúltima parada de la anterior
                document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
                drawTrackingRouteOnMap(prevStops);
            } else {
                alert("Inicio de la primera ruta.");
            }
        }
    }
    updateNextStopDisplay();    // Actualizar UI
    calculateTimeDifference(); // Recalcular tiempo para el nuevo estado
}

// Actualiza la información de la próxima parada en la UI
function updateNextStopDisplay() {
    const nextStopInfoElement = document.getElementById('next-stop-info');
    const timeDisplayElement = document.getElementById('time-difference-display');

    if (!isTracking || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        nextStopInfoElement.textContent = "Ninguna";
        if (!isTracking) { timeDisplayElement.textContent = "--:--"; timeDisplayElement.className = ""; }
        return;
    }
    const stops = trackingQueue[currentTrackingRouteIndex].stops;
    const nextIdx = currentTrackingStopIndex + 1;

    if (currentTrackingStopIndex === -1 && stops.length > 0) { // En inicio
        const start = stops[0];
        nextStopInfoElement.textContent = `Salida de ${start.name || 'Inicio'} a las ${start.departureTime || '--:--'}`;
    } else if (nextIdx < stops.length) { // En tramo intermedio o hacia el final
        const next = stops[nextIdx];
        // Usar el índice `nextIdx` que es correcto (empieza en 1 para la primera parada después del inicio)
        nextStopInfoElement.textContent = `${next.name || `Parada ${nextIdx}`} (Lleg. ${next.arrivalTime})`;
    } else { // Ya pasó la última parada
        nextStopInfoElement.textContent = "Fin de ruta actual";
    }
}


// --- RE-SINCRONIZACIÓN (cuando se pierde o vuelve a modo auto) ---
function findAndSetCurrentLeg() {
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0) return false;
    const stops = trackingQueue[currentTrackingRouteIndex].stops; if (stops.length < 2) return false;
    const driverLL = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng); let bestNextIdx = -1; let minDist = Infinity;
    // Buscar la parada MÁS CERCANA en general
    for (let i = 0; i < stops.length; i++) {
        const stopLL = L.latLng(stops[i].lat, stops[i].lng); const dist = driverLL.distanceTo(stopLL);
        if (dist < minDist) { minDist = dist; bestNextIdx = i; }
    }
    if (bestNextIdx !== -1) {
        // Determinar si estamos "antes" o "después" de la parada más cercana
        // Lógica simple: Si estamos más cerca del nodo `bestNextIdx` que de `bestNextIdx-1` (si existe),
        // asumimos que nuestra parada "desde" es `bestNextIdx-1`.
        let newFromIdx = bestNextIdx - 1; // Asumir que estamos yendo HACIA la parada más cercana

        // Check si estamos aún en el geofence de inicio
        const startLL = L.latLng(stops[0].lat, stops[0].lng);
        if (driverLL.distanceTo(startLL) <= GEOFENCE_RADIUS_METERS) {
            newFromIdx = -1; // Forzar estado inicial si está en el geofence de inicio
        }

        if (newFromIdx !== currentTrackingStopIndex) {
            console.log(`SmartMovePro: Re-sincronizando. Parada más cercana ${bestNextIdx}. Estableciendo 'desde' a ${newFromIdx}.`);
            currentTrackingStopIndex = newFromIdx;
        }
        updateNextStopDisplay();
        return true;
    }
    console.warn("SmartMovePro: No se pudo encontrar parada para sincronizar.");
    updateNextStopDisplay(); return false;
}

// --- CÁLCULO PRINCIPAL Y LÓGICA DE AVANCE ---
function calculateTimeDifference() {
    const timeDisplayElement = document.getElementById('time-difference-display'); // Referencia al display
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        timeDisplayElement.textContent = "--:--"; timeDisplayElement.className = ""; updatePassengerTrackingStatus(isTracking); return;
    }

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    if (currentRouteStops.length < 2) { timeDisplayElement.textContent = "Error Ruta"; updatePassengerTrackingStatus(true, true, "Ruta inválida"); return; }
    const currentDriverLatLng = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);
    const manualMode = document.getElementById('manual-mode-checkbox').checked;

    // --- Lógica de Avance/Transición Automática ---
    if (!manualMode) {
        const endStopIndex = currentRouteStops.length - 1;
        const endStop = currentRouteStops[endStopIndex];
        const endStopLatLng = L.latLng(endStop.lat, endStop.lng);

        // 1. Check de llegada al FINAL -> Transición (Solo si aún no estamos en la última parada)
        if (currentTrackingStopIndex < endStopIndex && currentDriverLatLng.distanceTo(endStopLatLng) < GEOFENCE_RADIUS_METERS) {
            console.log("SmartMovePro: Dentro de geofence final. Transicionando...");
            if (transitionToNextRoute()) return; // Salir si hubo transición
            else { timeDisplayElement.textContent = "FIN"; timeDisplayElement.className = ""; return; } // Salir si se detuvo
        }
        // 2. Check salida geofence INICIO (si índice es -1)
        else if (currentTrackingStopIndex === -1) {
            const startStopLatLng = L.latLng(currentRouteStops[0].lat, currentRouteStops[0].lng);
            if (currentDriverLatLng.distanceTo(startStopLatLng) > GEOFENCE_RADIUS_METERS) {
                console.log("SmartMovePro: Salió de geofence de inicio.");
                currentTrackingStopIndex = 0; // Marcar inicio del primer tramo
                updateNextStopDisplay();
                updatePassengerTrackingStatus(true); // Notificar cambio de estado
                // Continuar abajo para calcular tiempo del tramo 0 -> 1...
            }
            // Si sigue dentro, el cálculo especial se hará abajo.
        }
        // 3. Check llegada a parada INTERMEDIA (si no aplica lo anterior)
        else if (currentTrackingStopIndex < endStopIndex -1) { // Si no es la penúltima parada
             const nextStopIndex = currentTrackingStopIndex + 1;
             const nextStopTarget = currentRouteStops[nextStopIndex];
             const distanceToNext = currentDriverLatLng.distanceTo(L.latLng(nextStopTarget.lat, nextStopTarget.lng));
             if (distanceToNext < PROXIMITY_THRESHOLD_METERS) {
                 currentTrackingStopIndex++;
                 console.log(`SmartMovePro: Avance automático a parada índice ${currentTrackingStopIndex}`);
                 updateNextStopDisplay();
                 updatePassengerTrackingStatus(true);
                 // Salir, cálculo en el próximo ciclo
                 return;
             }
        }
    } // Fin Avance Automático

    // --- Cálculo de Tiempo ---
    const fromStopIndex = currentTrackingStopIndex;

    // Calcular y mostrar diferencia en el Punto de Inicio (estado -1)
    if (fromStopIndex === -1) {
        const startStop = currentRouteStops[0]; const departureTimeStr = startStop.departureTime;
        if (departureTimeStr) {
            let depDT = new Date(); const [h, m] = departureTimeStr.split(':').map(Number); depDT.setHours(h, m, 0, 0);
            const nowMillis = new Date().getTime();
            const diffMillis = depDT.getTime() - nowMillis; lastCalculatedDiffMillis = diffMillis; const diffMins = diffMillis / 60000;
            timeDisplayElement.textContent = formatMinutesToTimeDiff(diffMins);
            if (diffMins < -0.1) timeDisplayElement.className = 'late'; else if (diffMins > 0.1) timeDisplayElement.className = 'early'; else timeDisplayElement.className = 'on-time';
        } else { timeDisplayElement.textContent = "Falta Hora"; timeDisplayElement.className = ""; }
        updatePassengerTrackingStatus(true); return; // Salir
    }

    // Cálculo para tramos normales (fromStopIndex >= 0)
    const toStopIndex = fromStopIndex + 1;
    if (toStopIndex >= currentRouteStops.length) { // Ya pasó la última parada
        timeDisplayElement.textContent = "FIN"; timeDisplayElement.className = ""; updatePassengerTrackingStatus(true); return;
    }

    const fromStop = currentRouteStops[fromStopIndex]; const toStop = currentRouteStops[toStopIndex];
    const depTime = fromStop.departureTime; const arrTime = toStop.arrivalTime; if (!depTime || !arrTime) { timeDisplayElement.textContent = "Error Hor."; timeDisplayElement.className = ""; updatePassengerTrackingStatus(true, true, "Falta Horario"); return; } const [depH, depM] = depTime.split(':').map(Number); let depDT = new Date(); depDT.setHours(depH, depM, 0, 0); const [arrH, arrM] = arrTime.split(':').map(Number); let arrDT = new Date(); arrDT.setHours(arrH, arrM, 0, 0); if (arrDT < depDT) { arrDT.setDate(arrDT.getDate() + 1); } const legMillis = arrDT - depDT; if (legMillis < 0 ) { timeDisplayElement.textContent = "Error Hor."; timeDisplayElement.className = ""; updatePassengerTrackingStatus(true, true, "Error Hor. Tramo"); return; } const coordA = L.latLng(fromStop.lat, fromStop.lng); const coordB = L.latLng(toStop.lat, toStop.lng); const legDist = coordA.distanceTo(coordB); const distCovered = currentDriverLatLng.distanceTo(coordA); let prop = 0; if (legDist > 1) { prop = distCovered / legDist; } else if (distCovered > 1 && legDist <= 1) { prop = 1; } const schedMillis = depDT.getTime() + (prop * legMillis); const currentMillis = new Date().getTime(); lastCalculatedDiffMillis = schedMillis - currentMillis; const diffMins = lastCalculatedDiffMillis / 60000;
    timeDisplayElement.textContent = formatMinutesToTimeDiff(diffMins); // <-- Actualización del display
    if (diffMins < -0.1) timeDisplayElement.className = 'late'; else if (diffMins > 0.1) timeDisplayElement.className = 'early'; else timeDisplayElement.className = 'on-time'; // <-- Actualización de clase
    // --- Fin cálculo ---

    updatePassengerTrackingStatus(true); // Actualizar pasajeros
}


// --- FUNCIÓN PARA ACTUALIZAR DATOS PARA PASAJEROS ---
function updatePassengerTrackingStatus(isCurrentlyTracking, hasError = false, errorReason = "") { /* ... (Sin cambios) ... */ }

// --- UTILIDADES DE TIEMPO ---
function timeToMinutes(timeInput) { /* ... */ }
function formatMinutesToTimeDiff(totalMinutesWithFraction) { /* ... */ }

// --- BINDINGS INICIALES ---
function bindEventListeners() {
    // Asegura que el listener de cambio de modo manual se añade una sola vez
    document.getElementById('manual-mode-checkbox').addEventListener('change', (event) => {
        updateManualControlsState(); // Actualiza botones prev/next
        if (isTracking && !event.target.checked) { // Si se DESACTIVA modo manual mientras trackea
            console.log("SmartMovePro: Modo manual desactivado. Re-sincronizando...");
            findAndSetCurrentLeg();
            // El intervalo se encargará de llamar a calculateTimeDifference
        }
    });
    // Asignar resto de listeners...
    document.getElementById('cancel-stop-btn').addEventListener('click', closeStopModal);
    document.getElementById('start-new-route-btn').addEventListener('click', startNewRouteAction);
    document.getElementById('set-start-point-btn').addEventListener('click', () => { settingPointType = 'start'; alert("Toca mapa para Inicio."); });
    document.getElementById('set-end-point-btn').addEventListener('click', () => { if (!currentTempRoute.startPoint) { alert("Fija Inicio primero."); return; } settingPointType = 'end'; alert("Toca mapa para Fin."); });
    document.querySelectorAll('.link-button[data-point-type]').forEach(b => { b.addEventListener('click', (e) => { const pt = e.target.dataset.pointType; let cp = (pt === 'start') ? currentTempRoute.startPoint : currentTempRoute.endPoint; if (!cp) { alert(`Punto ${pt} no fijado.`); return; } const nn = prompt(`Nuevo nombre para Punto ${pt}:`, cp.name); if (nn && nn.trim() !== "") { cp.name = nn.trim(); document.getElementById(`${pt}-point-name-display`).textContent = cp.name; renderCurrentStopsList(); } }); });
    document.getElementById('start-time-input').addEventListener('change', (e) => { if (currentTempRoute.startPoint) { currentTempRoute.startPoint.departureTime = e.target.value; if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } });
    document.getElementById('end-time-input').addEventListener('change', (e) => { if (currentTempRoute.endPoint) { currentTempRoute.endPoint.arrivalTime = e.target.value; if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } });
    document.getElementById('auto-time-intermediate-checkbox').addEventListener('change', () => { if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); });
    document.getElementById('current-stops-list').addEventListener('click', (e) => { const t = e.target; if (t.tagName === 'BUTTON' && t.dataset.action) { const a = t.dataset.action; const i = parseInt(t.dataset.index); if (a === 'edit-intermediate') { openStopModal(currentTempRoute.intermediateStops[i], i); } else if (a === 'remove-intermediate') { if (isTracking) { alert("Detén seguimiento."); return; } currentTempRoute.intermediateStops.splice(i, 1); if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } } });
    document.getElementById('save-stop-btn').addEventListener('click', saveStopModalAction);
    document.getElementById('save-route-btn').addEventListener('click', saveRouteAction);
    document.getElementById('load-route-for-editing-btn').addEventListener('click', loadRouteForEditingAction);
    document.getElementById('delete-selected-route-btn').addEventListener('click', deleteSelectedRouteAction);
    document.getElementById('add-to-tracking-queue-btn').addEventListener('click', addToTrackingQueueAction);
    document.getElementById('clear-tracking-queue-btn').addEventListener('click', clearTrackingQueueAction);
    document.getElementById('start-tracking-btn').addEventListener('click', startTrackingAction);
    document.getElementById('stop-tracking-btn').addEventListener('click', stopTrackingAction);
    document.getElementById('prev-stop-btn').addEventListener('click', () => manualAdvanceStop(-1));
    document.getElementById('next-stop-btn').addEventListener('click', () => manualAdvanceStop(1));
}
window.addEventListener('beforeunload', () => { /* Intento de limpiar estado */ });
