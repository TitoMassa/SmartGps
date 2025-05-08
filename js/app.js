// js/app.js (Para Smart Move Pro - App del Chofer)

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => console.log('SmartMovePro: SW registered: ', registration.scope))
            .catch(error => console.log('SmartMovePro: SW registration failed: ', error));
    });
}

// Variables Globales
let map;
let currentPositionMarker;
let routePolyline;
let stopMarkers = [];

let currentTempRoute = { name: "", startPoint: null, endPoint: null, intermediateStops: [] };
let allSavedRoutes = [];
let trackingQueue = [];

let isTracking = false;
let currentTrackingRouteIndex = -1;
let currentTrackingStopIndex = -1;
let trackingInterval;
let lastKnownPosition = null;
let lastCalculatedDiffMillis = 0;

const PROXIMITY_THRESHOLD_METERS = 70;
const MAX_DISTANCE_TO_EXPECTED_NEXT_STOP_METERS = 5000; // Umbral para re-sincronizar

let settingPointType = null;

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
    map.on('click', onMapClick); startGeolocation();
}
function startGeolocation() {
    if (navigator.geolocation) { navigator.geolocation.watchPosition(updateCurrentPosition, handleLocationError, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }); }
    else { alert("Geolocalización no soportada."); }
}
function updateCurrentPosition(position) {
    const lat = position.coords.latitude; const lng = position.coords.longitude; lastKnownPosition = { lat, lng };
    if (!currentPositionMarker) { currentPositionMarker = L.marker([lat, lng], { icon: currentLocationIcon }).addTo(map); map.setView([lat, lng], 16); }
    else { currentPositionMarker.setLatLng([lat, lng]); }
    // No llamar a calculateTimeDifference aquí directamente, el intervalo lo hace.
}
function handleLocationError(error) { console.warn(`SmartMovePro: ERROR(${error.code}): ${error.message}`); }

// --- LÓGICA DE CREACIÓN DE RUTA ---
// ... (Sin cambios: resetRouteCreationState, onMapClick para creación, modales, saveStopModalAction, startNewRouteAction, recalculateIntermediateStopTimes, getCombinedStopsForDisplayAndMap, renderCurrentStopsList, drawRouteOnMap, clearMapStopMarkersAndPolyline) ...
function resetRouteCreationState() { /* ... */ currentTempRoute = { name: "", startPoint: null, endPoint: null, intermediateStops: [] }; document.getElementById('route-name-input').value = ""; document.getElementById('start-point-info').style.display = 'none'; document.getElementById('start-time-input').value = ""; document.getElementById('start-point-name-display').textContent = "Inicio Ruta"; document.getElementById('end-point-info').style.display = 'none'; document.getElementById('end-time-input').value = ""; document.getElementById('end-point-name-display').textContent = "Fin Ruta"; document.getElementById('set-start-point-btn').disabled = false; document.getElementById('set-end-point-btn').disabled = true; settingPointType = null; renderCurrentStopsList(); clearMapStopMarkersAndPolyline(); }
function onMapClick(e) { /* ... */ if (isTracking) return; if (settingPointType) { const { lat, lng } = e.latlng; if (settingPointType === 'start') { currentTempRoute.startPoint = { lat, lng, name: "Inicio Ruta", departureTime: document.getElementById('start-time-input').value || "", type: 'start' }; document.getElementById('start-point-info').style.display = 'block'; document.getElementById('start-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`; document.getElementById('set-start-point-btn').disabled = true; document.getElementById('set-end-point-btn').disabled = false; settingPointType = null; renderCurrentStopsList(); } else if (settingPointType === 'end') { if (!currentTempRoute.startPoint) { alert("Define Inicio."); settingPointType = null; return; } currentTempRoute.endPoint = { lat, lng, name: "Fin Ruta", arrivalTime: document.getElementById('end-time-input').value || "", type: 'end' }; document.getElementById('end-point-info').style.display = 'block'; document.getElementById('end-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`; document.getElementById('set-end-point-btn').disabled = true; settingPointType = null; renderCurrentStopsList(); recalculateIntermediateStopTimes(); } settingPointType = null; } else if (currentTempRoute.startPoint && currentTempRoute.endPoint) { const { lat, lng } = e.latlng; const newIS = { lat, lng, name: "", type: 'intermediate', arrivalTime: "" }; let idx = currentTempRoute.intermediateStops.length; currentTempRoute.intermediateStops.splice(idx, 0, newIS); if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); renderCurrentStopsList(); } else { openStopModal(newIS, idx); } } else { alert("Define Inicio y Fin primero."); } }
function openStopModal(stopData, index) { /* ... */ document.getElementById('stop-lat-input').value = stopData.lat; document.getElementById('stop-lng-input').value = stopData.lng; document.getElementById('stop-index-input').value = index; document.getElementById('stop-name-input').value = stopData.name || ""; const auto = document.getElementById('auto-time-intermediate-checkbox').checked; document.getElementById('manual-time-fields').style.display = auto ? 'none' : 'block'; document.getElementById('auto-time-info').style.display = auto ? 'block' : 'none'; if (!auto) { document.getElementById('arrival-time-input').value = stopData.arrivalTime || ""; } document.getElementById('modal-title').textContent = `Parada Intermedia ${index + 1}`; document.getElementById('stop-modal').style.display = 'block'; }
function closeStopModal() { document.getElementById('stop-modal').style.display = 'none'; }
function saveStopModalAction() { /* ... */ const idx = parseInt(document.getElementById('stop-index-input').value); const stop = currentTempRoute.intermediateStops[idx]; stop.name = document.getElementById('stop-name-input').value.trim(); if (!document.getElementById('auto-time-intermediate-checkbox').checked) { const arrival = document.getElementById('arrival-time-input').value; if (!arrival) { alert("Ingresa hora."); return; } stop.arrivalTime = arrival; stop.departureTime = arrival; } if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); closeStopModal(); }
function startNewRouteAction() { /* ... */ if (isTracking) { alert("Detén seguimiento."); return; } const name = document.getElementById('route-name-input').value.trim(); resetRouteCreationState(); currentTempRoute.name = name || "Ruta Sin Nombre"; document.getElementById('route-name-input').value = currentTempRoute.name; alert("Nueva ruta iniciada."); }
function recalculateIntermediateStopTimes() { /* ... (sin cambios) ... */ if (!currentTempRoute.startPoint || !currentTempRoute.endPoint || !currentTempRoute.startPoint.departureTime || !currentTempRoute.endPoint.arrivalTime || currentTempRoute.intermediateStops.length === 0) { renderCurrentStopsList(); return; } const startStr = currentTempRoute.startPoint.departureTime; const endStr = currentTempRoute.endPoint.arrivalTime; let startD = new Date(); startD.setHours(parseInt(startStr.split(':')[0]), parseInt(startStr.split(':')[1]), 0, 0); let endD = new Date(); endD.setHours(parseInt(endStr.split(':')[0]), parseInt(endStr.split(':')[1]), 0, 0); if (endD < startD) endD.setDate(endD.getDate() + 1); const totalDur = endD - startD; if (totalDur <= 0) { console.warn("Duración inválida."); currentTempRoute.intermediateStops.forEach(s => s.arrivalTime = s.departureTime = "Error"); renderCurrentStopsList(); return; } const startLL = L.latLng(currentTempRoute.startPoint.lat, currentTempRoute.startPoint.lng); let coords = [startLL]; currentTempRoute.intermediateStops.forEach(s => coords.push(L.latLng(s.lat, s.lng))); coords.push(L.latLng(currentTempRoute.endPoint.lat, currentTempRoute.endPoint.lng)); let totalDist = 0; for (let i = 0; i < coords.length - 1; i++) totalDist += coords[i].distanceTo(coords[i+1]); if (totalDist === 0) { console.warn("Distancia cero."); currentTempRoute.intermediateStops.forEach(s => s.arrivalTime = s.departureTime = "Dist.0"); renderCurrentStopsList(); return; } let accumDist = 0; for (let i = 0; i < currentTempRoute.intermediateStops.length; i++) { const prevLL = (i === 0) ? startLL : L.latLng(currentTempRoute.intermediateStops[i-1].lat, currentTempRoute.intermediateStops[i-1].lng); const currLL = L.latLng(currentTempRoute.intermediateStops[i].lat, currentTempRoute.intermediateStops[i].lng); accumDist += prevLL.distanceTo(currLL); const prop = accumDist / totalDist; const offset = Math.round(totalDur * prop); let iTime = new Date(startD.getTime() + offset); const calcTime = `${String(iTime.getHours()).padStart(2, '0')}:${String(iTime.getMinutes()).padStart(2, '0')}`; currentTempRoute.intermediateStops[i].arrivalTime = calcTime; currentTempRoute.intermediateStops[i].departureTime = calcTime; } renderCurrentStopsList(); }
function getCombinedStopsForDisplayAndMap() { /* ... (sin cambios) ... */ let c = []; if (currentTempRoute.startPoint) c.push(currentTempRoute.startPoint); c = c.concat(currentTempRoute.intermediateStops); if (currentTempRoute.endPoint) c.push(currentTempRoute.endPoint); return c; }
function renderCurrentStopsList() { /* ... (sin cambios) ... */ const list = document.getElementById('current-stops-list'); list.innerHTML = ''; const stops = getCombinedStopsForDisplayAndMap(); stops.forEach(s => { const li = document.createElement('li'); let lbl = "", time = ""; if (s.type === 'start') { lbl = `<strong>Inicio: ${s.name || ''}</strong>`; time = `Salida: ${s.departureTime || '--:--'}`; } else if (s.type === 'end') { lbl = `<strong>Fin: ${s.name || ''}</strong>`; time = `Llegada: ${s.arrivalTime || '--:--'}`; } else { const i = currentTempRoute.intermediateStops.indexOf(s); lbl = `Parada ${i + 1}: ${s.name || ''}`; time = `Paso: ${s.arrivalTime || '--:--'}`; } li.innerHTML = `<div class="stop-info">${lbl}<br><small>${time} (${s.lat.toFixed(4)}, ${s.lng.toFixed(4)})</small></div> ${ (s.type === 'intermediate') ? `<div class="stop-actions"><button data-action="edit-intermediate" data-index="${currentTempRoute.intermediateStops.indexOf(s)}">Editar</button><button data-action="remove-intermediate" data-index="${currentTempRoute.intermediateStops.indexOf(s)}" class="danger">Eliminar</button></div>` : ''}`; list.appendChild(li); }); drawRouteOnMap(stops); }
function drawRouteOnMap(stops) { /* ... (sin cambios) ... */ clearMapStopMarkersAndPolyline(); const lls = []; stops.forEach((s, i) => { let icon, pop = `<b>${s.name || `Punto ${i + 1}`}</b> (${s.type})<br>`; if (s.type === 'start') { icon = createStopIcon('I', 'start'); pop += `Salida: ${s.departureTime || '--:--'}`; } else if (s.type === 'end') { icon = createStopIcon('F', 'end'); pop += `Llegada: ${s.arrivalTime || '--:--'}`; } else { const iIdx = currentTempRoute.intermediateStops.indexOf(s) + 1; icon = createStopIcon(iIdx, 'intermediate'); pop += `Paso: ${s.arrivalTime || '--:--'}`; } const m = L.marker([s.lat, s.lng], { icon }).addTo(map); m.bindPopup(pop); stopMarkers.push(m); lls.push([s.lat, s.lng]); }); if (lls.length > 1) { routePolyline = L.polyline(lls, { color: 'blue' }).addTo(map); } }
function clearMapStopMarkersAndPolyline() { /* ... (sin cambios) ... */ stopMarkers.forEach(m => map.removeLayer(m)); stopMarkers = []; if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; } }

// --- GUARDAR/CARGAR/BORRAR RUTAS ---
// ... (Sin cambios: saveRouteAction, saveRoutesToLocalStorage, loadRoutesFromLocalStorage, populateSavedRoutesSelect, loadRouteForEditingAction, deleteSelectedRouteAction) ...
function saveRouteAction() { /* ... */ if (isTracking) { alert("Detén seguimiento."); return; } if (!currentTempRoute.startPoint || !currentTempRoute.endPoint || !currentTempRoute.startPoint.departureTime || !currentTempRoute.endPoint.arrivalTime) { alert("Define inicio/fin con horarios."); return; } if (!currentTempRoute.name || currentTempRoute.name === "Ruta Sin Nombre") { const n = prompt("Nombre ruta:", currentTempRoute.name === "Ruta Sin Nombre" ? "" : currentTempRoute.name); if (!n || n.trim() === "") { alert("Se requiere nombre."); return; } currentTempRoute.name = n.trim(); document.getElementById('route-name-input').value = currentTempRoute.name; } if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } for (const s of currentTempRoute.intermediateStops) { if (!s.arrivalTime || s.arrivalTime.includes("Error") || s.arrivalTime.includes("Dist.0")) { alert(`Problema horario parada "${s.name || 'Intermedia'}".`); return; } } const route = JSON.parse(JSON.stringify(currentTempRoute)); const idx = allSavedRoutes.findIndex(r => r.name === route.name); if (idx > -1) { if (confirm(`Sobrescribir ruta "${route.name}"?`)) { allSavedRoutes[idx] = route; } else { return; } } else { allSavedRoutes.push(route); } saveRoutesToLocalStorage(); populateSavedRoutesSelect(); alert(`Ruta "${route.name}" guardada.`); }
function saveRoutesToLocalStorage() { localStorage.setItem('smartMoveProRoutes', JSON.stringify(allSavedRoutes)); }
function loadRoutesFromLocalStorage() { const s = localStorage.getItem('smartMoveProRoutes'); if (s) { try { allSavedRoutes = JSON.parse(s); } catch(e) { console.error("Error parsing saved routes", e); allSavedRoutes = []; } } }
function populateSavedRoutesSelect() { /* ... */ const sel = document.getElementById('saved-routes-select'); const cur = sel.value; sel.innerHTML = '<option value="">-- Selecciona ruta --</option>'; allSavedRoutes.forEach((r, i) => { const o = document.createElement('option'); o.value = i; o.textContent = r.name; sel.appendChild(o); }); if (allSavedRoutes[parseInt(cur)]) { sel.value = cur; } else { sel.value = ""; } }
function loadRouteForEditingAction() { /* ... */ if (isTracking) { alert("Detén seguimiento."); return; } const idx = document.getElementById('saved-routes-select').value; if (idx === "") { alert("Selecciona ruta."); return; } resetRouteCreationState(); try { currentTempRoute = JSON.parse(JSON.stringify(allSavedRoutes[parseInt(idx)])); } catch(e) { alert("Error al cargar ruta."); return; } document.getElementById('route-name-input').value = currentTempRoute.name; if (currentTempRoute.startPoint) { document.getElementById('start-point-info').style.display = 'block'; document.getElementById('start-point-name-display').textContent = currentTempRoute.startPoint.name; document.getElementById('start-time-input').value = currentTempRoute.startPoint.departureTime; document.getElementById('start-point-coords').textContent = `(${currentTempRoute.startPoint.lat.toFixed(4)}, ${currentTempRoute.startPoint.lng.toFixed(4)})`; document.getElementById('set-start-point-btn').disabled = true; document.getElementById('set-end-point-btn').disabled = !currentTempRoute.endPoint; } if (currentTempRoute.endPoint) { document.getElementById('end-point-info').style.display = 'block'; document.getElementById('end-point-name-display').textContent = currentTempRoute.endPoint.name; document.getElementById('end-time-input').value = currentTempRoute.endPoint.arrivalTime; document.getElementById('end-point-coords').textContent = `(${currentTempRoute.endPoint.lat.toFixed(4)}, ${currentTempRoute.endPoint.lng.toFixed(4)})`; document.getElementById('set-end-point-btn').disabled = true; } renderCurrentStopsList(); alert(`Ruta "${currentTempRoute.name}" cargada.`); }
function deleteSelectedRouteAction() { /* ... */ if (isTracking) { alert("Detén seguimiento."); return; } const sel = document.getElementById('saved-routes-select'); const idx = sel.value; if (idx === "") { alert("Selecciona ruta."); return; } const name = allSavedRoutes[parseInt(idx)].name; if (confirm(`Eliminar ruta "${name}"?`)) { allSavedRoutes.splice(parseInt(idx), 1); saveRoutesToLocalStorage(); populateSavedRoutesSelect(); if (currentTempRoute.name === name) { resetRouteCreationState(); } alert(`Ruta "${name}" eliminada.`); } }

// --- GESTIÓN DE COLA DE SEGUIMIENTO ---
// ... (Sin cambios: addToTrackingQueueAction, clearTrackingQueueAction, renderTrackingQueue) ...
function addToTrackingQueueAction() { /* ... */ const idx = document.getElementById('saved-routes-select').value; if (idx === "") { alert("Selecciona ruta."); return; } const d = allSavedRoutes[parseInt(idx)]; if (!d.startPoint || !d.endPoint || !d.startPoint.departureTime || !d.endPoint.arrivalTime) { alert("Ruta incompleta."); return; } let flat = []; flat.push({ lat: d.startPoint.lat, lng: d.startPoint.lng, name: d.startPoint.name, arrivalTime: d.startPoint.departureTime, departureTime: d.startPoint.departureTime, type: 'start' }); (d.intermediateStops || []).forEach(s => { flat.push({ lat: s.lat, lng: s.lng, name: s.name || "Parada", arrivalTime: s.arrivalTime, departureTime: s.departureTime, type: 'intermediate' }); }); flat.push({ lat: d.endPoint.lat, lng: d.endPoint.lng, name: d.endPoint.name, arrivalTime: d.endPoint.arrivalTime, departureTime: d.endPoint.arrivalTime, type: 'end' }); const route = { name: d.name, stops: flat }; trackingQueue.push(JSON.parse(JSON.stringify(route))); renderTrackingQueue(); }
function clearTrackingQueueAction() { /* ... */ trackingQueue = []; renderTrackingQueue(); }
function renderTrackingQueue() { /* ... */ const list = document.getElementById('tracking-queue-list'); list.innerHTML = ''; trackingQueue.forEach((r, i) => { const li = document.createElement('li'); li.textContent = `${i + 1}. ${r.name} (${r.stops.length} paradas)`; list.appendChild(li); }); }


// --- LÓGICA DE SEGUIMIENTO (MODIFICADA) ---
function startTrackingAction() {
    if (isTracking) { alert("Seguimiento activo."); return; }
    if (trackingQueue.length === 0) { alert("Añade rutas a la cola."); return; }
    if (!lastKnownPosition) { alert("Esperando GPS..."); return; }

    isTracking = true;
    currentTrackingRouteIndex = 0;
    currentTrackingStopIndex = -1;

    document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
    clearMapStopMarkersAndPolyline();
    drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);

    findAndSetCurrentLeg(); // Sincronizar inicial

    updateTrackingButtonsState();
    updateManualControlsState(); // Asegurar estado correcto de botones manuales

    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(calculateTimeDifference, 1000); // calculateTimeDifference maneja ahora avance y re-sync

    updatePassengerTrackingStatus(true);
    alert("Seguimiento iniciado.");
}

function drawTrackingRouteOnMap(stops) { /* ... (sin cambios) ... */ 
    clearMapStopMarkersAndPolyline(); const lls = [];
    stops.forEach((s, i) => { let icon, pop = `<b>${s.name || `Punto ${i + 1}`}</b><br>`; if (s.type === 'start') { icon = createStopIcon('I', 'start'); pop += `Salida: ${s.departureTime || '--:--'}`; } else if (s.type === 'end') { icon = createStopIcon('F', 'end'); pop += `Llegada: ${s.arrivalTime || '--:--'}`; } else { icon = createStopIcon(i, 'intermediate'); pop += `Paso: ${s.arrivalTime || '--:--'}`; } const m = L.marker([s.lat, s.lng], { icon }).addTo(map); m.bindPopup(pop); stopMarkers.push(m); lls.push([s.lat, s.lng]); });
    if (lls.length > 1) { routePolyline = L.polyline(lls, { color: 'green', weight: 5 }).addTo(map); }
}

function stopTrackingAction() { /* ... (sin cambios) ... */
    if (!isTracking) return; isTracking = false; if (trackingInterval) clearInterval(trackingInterval); trackingInterval = null;
    currentTrackingRouteIndex = -1; currentTrackingStopIndex = -1; lastCalculatedDiffMillis = 0;
    document.getElementById('time-difference-display').textContent = "--:--"; document.getElementById('time-difference-display').className = "";
    document.getElementById('next-stop-info').textContent = "Ninguna"; document.getElementById('current-route-info').textContent = "Ninguna";
    updateTrackingButtonsState(); updateManualControlsState(); updatePassengerTrackingStatus(false);
    renderCurrentStopsList(); alert("Seguimiento detenido.");
}

function updateTrackingButtonsState() { /* ... (sin cambios) ... */
    const startBtn = document.getElementById('start-tracking-btn'); const stopBtn = document.getElementById('stop-tracking-btn'); const routeCreationElements = document.querySelectorAll('#route-name-input, #start-new-route-btn, #set-start-point-btn, #set-end-point-btn, #start-time-input, #end-time-input, #auto-time-intermediate-checkbox, #save-route-btn, .link-button[data-point-type]'); const stopsListActions = document.querySelectorAll('#stops-list-container button'); const loadRouteControls = document.querySelectorAll('#load-route-for-editing-btn, #delete-selected-route-btn, #add-to-tracking-queue-btn, #saved-routes-select, #clear-tracking-queue-btn');
    if (isTracking) { startBtn.disabled = true; stopBtn.disabled = false; routeCreationElements.forEach(el => el.disabled = true); stopsListActions.forEach(el => el.disabled = true); loadRouteControls.forEach(el => el.disabled = true); }
    else { startBtn.disabled = false; stopBtn.disabled = true; routeCreationElements.forEach(el => el.disabled = false); stopsListActions.forEach(el => el.disabled = false); loadRouteControls.forEach(el => el.disabled = false); document.getElementById('set-start-point-btn').disabled = !!currentTempRoute.startPoint; document.getElementById('set-end-point-btn').disabled = !currentTempRoute.startPoint || !!currentTempRoute.endPoint; }
}

function updateManualControlsState() {
    const manualCheckbox = document.getElementById('manual-mode-checkbox');
    const prevBtn = document.getElementById('prev-stop-btn');
    const nextBtn = document.getElementById('next-stop-btn');
    const isManual = manualCheckbox.checked;

    prevBtn.disabled = !(isTracking && isManual);
    nextBtn.disabled = !(isTracking && isManual);

    // *** NUEVO: Si se DESACTIVA el modo manual, re-sincronizar ***
    manualCheckbox.addEventListener('change', event => {
        const nowManual = event.target.checked;
        prevBtn.disabled = !(isTracking && nowManual);
        nextBtn.disabled = !(isTracking && nowManual);
        if (isTracking && !nowManual) { // Si se acaba de desactivar el modo manual
            console.log("SmartMovePro: Modo manual desactivado. Re-sincronizando...");
            findAndSetCurrentLeg(); // Intentar encontrar la parada correcta
            calculateTimeDifference(); // Calcular tiempo inmediatamente
        }
    });
}

// Función para cambiar a la siguiente ruta en la cola (llamada por proximidad o manualmente)
function transitionToNextRoute() {
    if (!isTracking) return false; // Solo transicionar si estamos en seguimiento
    console.log(`SmartMovePro: Transicionando desde ruta índice ${currentTrackingRouteIndex}`);

    if (currentTrackingRouteIndex + 1 < trackingQueue.length) {
        const oldRouteName = trackingQueue[currentTrackingRouteIndex].name;
        currentTrackingRouteIndex++;
        currentTrackingStopIndex = -1; // Inicia ANTES de la primera parada de la nueva ruta
        const newRouteName = trackingQueue[currentTrackingRouteIndex].name;
        const newRouteStops = trackingQueue[currentTrackingRouteIndex].stops;

        alert(`Ruta "${oldRouteName}" completada. Iniciando ruta "${newRouteName}".`);
        document.getElementById('current-route-info').textContent = newRouteName;
        clearMapStopMarkersAndPolyline(); // Limpiar marcadores antiguos
        drawTrackingRouteOnMap(newRouteStops); // Dibujar nueva ruta

        findAndSetCurrentLeg(); // Sincronizar con la posición actual al inicio de la nueva ruta
        // calculateTimeDifference() será llamado por el intervalo o si findAndSetCurrentLeg lo requiere.
        updateNextStopDisplay(); // Actualizar display de próxima parada
        updatePassengerTrackingStatus(true); // Actualizar estado para pasajeros con la nueva ruta activa
        return true; // Transición exitosa

    } else {
        alert("¡Todas las rutas completadas!");
        stopTrackingAction(); // Detener todo
        return false; // No hubo transición
    }
}

function manualAdvanceStop(direction) {
    if (!isTracking || !document.getElementById('manual-mode-checkbox').checked) return;

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;

    if (direction > 0) { // Avanzando
        const isCurrentlyAtLastStop = (currentTrackingStopIndex === currentRouteStops.length - 1);
        const isNextStopTheLastOne = (currentTrackingStopIndex + 1 === currentRouteStops.length - 1);

        if (isCurrentlyAtLastStop) { // Si YA estamos conceptualmente en la última parada, avanzar es ir a la siguiente ruta
            transitionToNextRoute();
        } else if (isNextStopTheLastOne) { // Si al avanzar llegamos a la última parada
            currentTrackingStopIndex++; // Mover el índice a la última parada
            updateNextStopDisplay(); // Mostrar "Fin de ruta"
            calculateTimeDifference(); // Calcular para la última parada
            // La próxima vez que se presione "siguiente", se llamará a transitionToNextRoute
        } else { // Avance normal dentro de la ruta
            currentTrackingStopIndex++;
            updateNextStopDisplay();
            calculateTimeDifference();
        }
    } else { // Retrocediendo
        let newProposedStopIndex = currentTrackingStopIndex - 1; // Dirección es -1
        if (newProposedStopIndex >= -1) {
            currentTrackingStopIndex = newProposedStopIndex;
        } else { // Intentar ir a ruta anterior
            if (currentTrackingRouteIndex > 0) { // Solo si hay ruta anterior
                currentTrackingRouteIndex--;
                const prevRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
                currentTrackingStopIndex = prevRouteStops.length - 2; // Apuntar al penúltimo tramo
                document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
                drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
            } else {
                alert("Ya estás al inicio de la primera ruta.");
                // No cambiar índices si ya está en el límite
            }
        }
        updateNextStopDisplay();
        calculateTimeDifference();
    }
}

function updateNextStopDisplay() { // Actualiza la UI con la info de la próxima parada
    if (!isTracking || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        document.getElementById('next-stop-info').textContent = "Ninguna";
        document.getElementById('time-difference-display').textContent = "--:--";
        return;
    }
    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    const nextStopTargetIndex = currentTrackingStopIndex + 1; // Parada a la que vamos

    if (nextStopTargetIndex < currentRouteStops.length) {
        const nextStop = currentRouteStops[nextStopTargetIndex];
        document.getElementById('next-stop-info').textContent = `${nextStop.name || `Parada ${nextStopTargetIndex + 1}`} (Lleg. ${nextStop.arrivalTime})`;
    } else {
        // Si no hay próxima parada (estamos en la última o ya terminamos)
        document.getElementById('next-stop-info').textContent = "Fin de ruta actual";
    }
}


// --- RE-SINCRONIZACIÓN Y CÁLCULO DE TIEMPO (Refinado) ---
function findAndSetCurrentLeg() {
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0) return false;
    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    if (currentRouteStops.length < 2) return false;

    const currentDriverLatLng = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);
    let bestCandidateNextStopIndex = -1;
    let minDistance = Infinity;
    const currentTargetIndex = currentTrackingStopIndex + 1;

    // Buscar la parada más cercana que esté *en o después* del objetivo actual
    // Esto prioriza seguir el orden establecido de la ruta
    for (let i = currentTargetIndex; i < currentRouteStops.length; i++) {
         const stopLatLng = L.latLng(currentRouteStops[i].lat, currentRouteStops[i].lng);
         const dist = currentDriverLatLng.distanceTo(stopLatLng);
         if (dist < minDistance) {
             minDistance = dist;
             bestCandidateNextStopIndex = i;
         }
    }

    // Si no se encontró ninguna candidata adelante, buscar la más cercana *antes*
    if (bestCandidateNextStopIndex === -1 && currentTargetIndex > 0) {
        for (let i = 0; i < currentTargetIndex; i++) {
            const stopLatLng = L.latLng(currentRouteStops[i].lat, currentRouteStops[i].lng);
            const dist = currentDriverLatLng.distanceTo(stopLatLng);
             if (dist < minDistance) {
                 minDistance = dist;
                 bestCandidateNextStopIndex = i; // Podría ser una parada ya pasada
             }
        }
    }


    if (bestCandidateNextStopIndex !== -1) {
         const newFromIndex = bestCandidateNextStopIndex - 1;
         // Solo actualizar si el nuevo índice "desde" es diferente al actual
         if (newFromIndex !== currentTrackingStopIndex) {
             console.log(`SmartMovePro: Re-sincronizando. Próxima parada más cercana es ${bestCandidateNextStopIndex}. Estableciendo 'desde' a ${newFromIndex}.`);
             currentTrackingStopIndex = newFromIndex;
         }
         updateNextStopDisplay();
         return true;
    }

    console.warn("SmartMovePro: No se pudo encontrar una parada cercana para sincronizar.");
    // Mantener el índice actual si no se encuentra nada mejor
    updateNextStopDisplay();
    return false;
}


function calculateTimeDifference() {
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        updatePassengerTrackingStatus(isTracking); return;
    }

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    const currentDriverLatLng = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);
    const manualMode = document.getElementById('manual-mode-checkbox').checked;

    // 1. Determinar próxima parada objetivo
    let toStopIndex = currentTrackingStopIndex + 1;

    // 2. Check de Proximidad y Avance/Transición Automática (Si no es manual)
    if (!manualMode && toStopIndex < currentRouteStops.length) {
        const nextStopTarget = currentRouteStops[toStopIndex];
        const distanceToNextStopTarget = currentDriverLatLng.distanceTo(L.latLng(nextStopTarget.lat, nextStopTarget.lng));

        if (distanceToNextStopTarget < PROXIMITY_THRESHOLD_METERS) {
            const isFinalStopOfCurrentRoute = (toStopIndex === currentRouteStops.length - 1);
            if (isFinalStopOfCurrentRoute) {
                // Llegó al final de la ruta -> Transicionar
                if (!transitionToNextRoute()) { // Si transitionToNextRoute retorna false (no hay más rutas), el seguimiento se detiene dentro.
                    return; // Salir si se detuvo el seguimiento
                }
                 // Si hubo transición, la nueva ruta está lista, el intervalo se encargará del cálculo.
            } else {
                // Llegó a una parada intermedia -> Avanzar índice
                currentTrackingStopIndex++; // Ahora "desde" la parada a la que llegamos
                console.log(`SmartMovePro: Avance automático a parada índice ${currentTrackingStopIndex}`);
                updateNextStopDisplay(); // Actualizar UI
                // No llamar a calculateTimeDifference recursivamente, el intervalo lo hará.
            }
             // Actualizar pasajeros inmediatamente después del avance o transición
            updatePassengerTrackingStatus(true);
            return; // Salir porque el estado cambió (índice o ruta)
        }
        // Check si está muy lejos (Opcional: Re-sincronizar)
        // else if (distanceToNextStopTarget > MAX_DISTANCE_TO_EXPECTED_NEXT_STOP_METERS) {
        //     if (findAndSetCurrentLeg()) {
        //         toStopIndex = currentTrackingStopIndex + 1; // Recalcular índice objetivo
        //     } else { /* Manejar fallo de re-sinc */ }
        // }
    }

    // 3. Cálculo de Tiempo para el tramo actual (currentTrackingStopIndex -> toStopIndex)
    const fromStopIndex = currentTrackingStopIndex;
    // Asegurarse que toStopIndex sea válido después de posibles re-sincs
    toStopIndex = fromStopIndex + 1;

    if (fromStopIndex < 0 || toStopIndex >= currentRouteStops.length) {
        document.getElementById('time-difference-display').textContent = (fromStopIndex < 0) ? "Iniciando..." : "FIN";
        document.getElementById('time-difference-display').className = "";
        updatePassengerTrackingStatus(true); // Informar estado (iniciando o fin)
        return;
    }

    const fromStop = currentRouteStops[fromStopIndex];
    const toStop = currentRouteStops[toStopIndex];

    // ... (Cálculo de tiempo proporcional - SIN CAMBIOS) ...
    const depTime = fromStop.departureTime; const arrTime = toStop.arrivalTime;
    if (!depTime || !arrTime) { console.warn("Horarios faltantes", fromStop, toStop); document.getElementById('time-difference-display').textContent = "Error Hor."; updatePassengerTrackingStatus(true, true, "Falta Horario"); return; }
    const [depH, depM] = depTime.split(':').map(Number); let depDT = new Date(); depDT.setHours(depH, depM, 0, 0);
    const [arrH, arrM] = arrTime.split(':').map(Number); let arrDT = new Date(); arrDT.setHours(arrH, arrM, 0, 0);
    if (arrDT < depDT) { arrDT.setDate(arrDT.getDate() + 1); }
    const legMillis = arrDT - depDT; if (legMillis < 0) { console.warn("Tiempo tramo inválido.", fromStop, toStop); document.getElementById('time-difference-display').textContent = "Error Hor."; updatePassengerTrackingStatus(true, true, "Error Hor. Tramo"); return; }
    const coordA = L.latLng(fromStop.lat, fromStop.lng); const coordB = L.latLng(toStop.lat, toStop.lng);
    const legDist = coordA.distanceTo(coordB); const distCovered = currentDriverLatLng.distanceTo(coordA);
    let prop = 0; if (legDist > 1) { prop = distCovered / legDist; } else if (distCovered > 1 && legDist <= 1) { prop = 1; }
    const schedMillis = depDT.getTime() + (prop * legMillis); const currentMillis = new Date().getTime();
    lastCalculatedDiffMillis = schedMillis - currentMillis;
    const diffMins = lastCalculatedDiffMillis / 60000;
    document.getElementById('time-difference-display').textContent = formatMinutesToTimeDiff(diffMins);
    const dispEl = document.getElementById('time-difference-display'); if (diffMins < -0.1) dispEl.className = 'late'; else if (diffMins > 0.1) dispEl.className = 'early'; else dispEl.className = 'on-time';
    // --- Fin cálculo ---

    updatePassengerTrackingStatus(true); // Actualizar pasajeros
}


// --- FUNCIÓN PARA ACTUALIZAR DATOS PARA PASAJEROS ---
function updatePassengerTrackingStatus(isCurrentlyTracking, hasError = false, errorReason = "") { /* ... (Sin cambios) ... */
    let statusPayload;
    if (!isCurrentlyTracking || hasError) { statusPayload = { isTracking: isCurrentlyTracking, hasError: hasError, errorReason: errorReason, lastUpdateTime: new Date().getTime() }; }
    else { if (currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) { statusPayload = { isTracking: false, lastUpdateTime: new Date().getTime(), reason: "Invalid tracking route index" }; }
    else { const currentRoute = trackingQueue[currentTrackingRouteIndex]; const currentStops = currentRoute.stops; let nextStopData = null, nextArr = null, nextDep = null; if (currentTrackingStopIndex + 1 < currentStops.length) { nextStopData = currentStops[currentTrackingStopIndex + 1]; nextArr = nextStopData.arrivalTime; nextDep = nextStopData.departureTime; }
    statusPayload = { isTracking: true, hasError: false, routeName: currentRoute.name, currentRouteIndexInQueue: currentTrackingRouteIndex, trackingQueueNames: trackingQueue.map(r => r.name), currentStopIndexFromWhichDeparted: currentTrackingStopIndex, nextStopIndexTowardsWhichHeading: currentTrackingStopIndex + 1, currentBusDelayOrAheadMillis: lastCalculatedDiffMillis, lastKnownPosition: lastKnownPosition, lastUpdateTime: new Date().getTime(), nextBusStopArrivalTime: nextArr, nextBusStopDepartureTime: nextDep, routeStops: currentStops.map(s => ({ name: s.name, type: s.type, arrivalTime: s.arrivalTime, departureTime: s.departureTime })) }; } }
    try { localStorage.setItem('smartMoveProTrackingStatus', JSON.stringify(statusPayload)); } catch (e) { console.error("SmartMovePro: Error saving tracking status", e); }
}

// --- UTILIDADES DE TIEMPO ---
function timeToMinutes(timeInput) { /* ... */ let h, m; if (typeof timeInput === 'string') { [h, m] = timeInput.split(':').map(Number); } else if (timeInput instanceof Date) { h = timeInput.getHours(); m = timeInput.getMinutes(); } else { return 0; } return h * 60 + m; }
function formatMinutesToTimeDiff(totalMinutesWithFraction) { /* ... */ const sign = totalMinutesWithFraction < 0 ? "-" : "+"; const absM = Math.abs(totalMinutesWithFraction); let mm = Math.floor(absM); let ss = Math.round((absM - mm) * 60); if (ss === 60) { mm += 1; ss = 0; } return `${sign}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; }

// --- BINDINGS INICIALES ---
function bindEventListeners() { /* ... (Sin cambios en los bindings, pero la lógica de updateManualControlsState cambió) ... */
    document.getElementById('cancel-stop-btn').addEventListener('click', closeStopModal); document.getElementById('start-new-route-btn').addEventListener('click', startNewRouteAction); document.getElementById('set-start-point-btn').addEventListener('click', () => { settingPointType = 'start'; alert("Toca mapa para Inicio."); }); document.getElementById('set-end-point-btn').addEventListener('click', () => { if (!currentTempRoute.startPoint) { alert("Fija Inicio primero."); return; } settingPointType = 'end'; alert("Toca mapa para Fin."); }); document.querySelectorAll('.link-button[data-point-type]').forEach(b => { b.addEventListener('click', (e) => { const pt = e.target.dataset.pointType; let cp = (pt === 'start') ? currentTempRoute.startPoint : currentTempRoute.endPoint; if (!cp) { alert(`Punto ${pt} no fijado.`); return; } const nn = prompt(`Nuevo nombre para Punto ${pt}:`, cp.name); if (nn && nn.trim() !== "") { cp.name = nn.trim(); document.getElementById(`${pt}-point-name-display`).textContent = cp.name; renderCurrentStopsList(); } }); }); document.getElementById('start-time-input').addEventListener('change', (e) => { if (currentTempRoute.startPoint) { currentTempRoute.startPoint.departureTime = e.target.value; if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } }); document.getElementById('end-time-input').addEventListener('change', (e) => { if (currentTempRoute.endPoint) { currentTempRoute.endPoint.arrivalTime = e.target.value; if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } }); document.getElementById('auto-time-intermediate-checkbox').addEventListener('change', () => { if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); }); document.getElementById('current-stops-list').addEventListener('click', (e) => { const t = e.target; if (t.tagName === 'BUTTON' && t.dataset.action) { const a = t.dataset.action; const i = parseInt(t.dataset.index); if (a === 'edit-intermediate') { openStopModal(currentTempRoute.intermediateStops[i], i); } else if (a === 'remove-intermediate') { if (isTracking) { alert("Detén seguimiento."); return; } currentTempRoute.intermediateStops.splice(i, 1); if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } } }); document.getElementById('save-stop-btn').addEventListener('click', saveStopModalAction); document.getElementById('save-route-btn').addEventListener('click', saveRouteAction); document.getElementById('load-route-for-editing-btn').addEventListener('click', loadRouteForEditingAction); document.getElementById('delete-selected-route-btn').addEventListener('click', deleteSelectedRouteAction); document.getElementById('add-to-tracking-queue-btn').addEventListener('click', addToTrackingQueueAction); document.getElementById('clear-tracking-queue-btn').addEventListener('click', clearTrackingQueueAction); document.getElementById('start-tracking-btn').addEventListener('click', startTrackingAction); document.getElementById('stop-tracking-btn').addEventListener('click', stopTrackingAction); document.getElementById('manual-mode-checkbox').addEventListener('change', (event) => { updateManualControlsState(); if (isTracking && !event.target.checked) { console.log("SmartMovePro: Modo manual desactivado via listener. Re-sincronizando..."); findAndSetCurrentLeg(); calculateTimeDifference(); } }); document.getElementById('prev-stop-btn').addEventListener('click', () => manualAdvanceStop(-1)); document.getElementById('next-stop-btn').addEventListener('click', () => manualAdvanceStop(1));
}
window.addEventListener('beforeunload', () => { /* ... */ });
