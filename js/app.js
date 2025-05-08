// js/app.js (Para Smart Move Pro - App del Chofer)

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('SmartMovePro: ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(error => {
                console.log('SmartMovePro: ServiceWorker registration failed: ', error);
            });
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
const MAX_DISTANCE_TO_EXPECTED_NEXT_STOP_METERS = 5000;

let settingPointType = null;

const currentLocationIcon = L.divIcon({ className: 'current-location-icon', html: '', iconSize: [12, 12], iconAnchor: [6, 6] });
function createStopIcon(number, type = 'intermediate') { /* ... (sin cambios) ... */
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
function initMap() { /* ... (sin cambios) ... */
    map = L.map('map').setView([-34.6037, -58.3816], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    map.on('click', onMapClick); startGeolocation();
}
function startGeolocation() { /* ... (sin cambios) ... */
    if (navigator.geolocation) { navigator.geolocation.watchPosition(updateCurrentPosition, handleLocationError, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }); }
    else { alert("Geolocalización no es soportada por este navegador."); }
}
function updateCurrentPosition(position) { /* ... (sin cambios) ... */
    const lat = position.coords.latitude; const lng = position.coords.longitude; lastKnownPosition = { lat, lng };
    if (!currentPositionMarker) { currentPositionMarker = L.marker([lat, lng], { icon: currentLocationIcon }).addTo(map); map.setView([lat, lng], 16); }
    else { currentPositionMarker.setLatLng([lat, lng]); }
    if (isTracking && !trackingInterval) { calculateTimeDifference(); }
}
function handleLocationError(error) { /* ... (sin cambios) ... */ console.warn(`SmartMovePro: ERROR(${error.code}): ${error.message}`); }

// --- LÓGICA DE CREACIÓN DE RUTA ---
// ... (Todas las funciones de creación/edición/guardado/carga de rutas SIN CAMBIOS desde la respuesta anterior)
function resetRouteCreationState() { /* ... */ 
    currentTempRoute = { name: "", startPoint: null, endPoint: null, intermediateStops: [] }; document.getElementById('route-name-input').value = "";
    document.getElementById('start-point-info').style.display = 'none'; document.getElementById('start-time-input').value = ""; document.getElementById('start-point-name-display').textContent = "Inicio Ruta";
    document.getElementById('end-point-info').style.display = 'none'; document.getElementById('end-time-input').value = ""; document.getElementById('end-point-name-display').textContent = "Fin Ruta";
    document.getElementById('set-start-point-btn').disabled = false; document.getElementById('set-end-point-btn').disabled = true;
    settingPointType = null; renderCurrentStopsList(); clearMapStopMarkersAndPolyline();
}
function onMapClick(e) { /* ... */ 
    if (isTracking) return; 
    if (settingPointType) { 
        const { lat, lng } = e.latlng;
        if (settingPointType === 'start') { currentTempRoute.startPoint = { lat, lng, name: "Inicio Ruta", departureTime: document.getElementById('start-time-input').value || "", type: 'start' }; document.getElementById('start-point-info').style.display = 'block'; document.getElementById('start-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`; document.getElementById('set-start-point-btn').disabled = true; document.getElementById('set-end-point-btn').disabled = false; settingPointType = null; renderCurrentStopsList(); }
        else if (settingPointType === 'end') { if (!currentTempRoute.startPoint) { alert("Error: Punto de inicio no definido."); settingPointType = null; return; } currentTempRoute.endPoint = { lat, lng, name: "Fin Ruta", arrivalTime: document.getElementById('end-time-input').value || "", type: 'end' }; document.getElementById('end-point-info').style.display = 'block'; document.getElementById('end-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`; document.getElementById('set-end-point-btn').disabled = true; settingPointType = null; renderCurrentStopsList(); recalculateIntermediateStopTimes(); }
        settingPointType = null;
    } else if (currentTempRoute.startPoint && currentTempRoute.endPoint) {
        const { lat, lng } = e.latlng; const newIntermediateStop = { lat, lng, name: "", type: 'intermediate', arrivalTime: "" };
        let insertAtIndex = currentTempRoute.intermediateStops.length; currentTempRoute.intermediateStops.splice(insertAtIndex, 0, newIntermediateStop);
        if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); renderCurrentStopsList(); } else { openStopModal(newIntermediateStop, insertAtIndex); }
    } else { alert("Define primero el Punto de Inicio y el Punto Final antes de añadir paradas intermedias."); }
}
function openStopModal(stopData, index) { /* ... */ 
    document.getElementById('stop-lat-input').value = stopData.lat; document.getElementById('stop-lng-input').value = stopData.lng; document.getElementById('stop-index-input').value = index; document.getElementById('stop-name-input').value = stopData.name || "";
    const autoTime = document.getElementById('auto-time-intermediate-checkbox').checked; document.getElementById('manual-time-fields').style.display = autoTime ? 'none' : 'block'; document.getElementById('auto-time-info').style.display = autoTime ? 'block' : 'none';
    if (!autoTime) { document.getElementById('arrival-time-input').value = stopData.arrivalTime || ""; } document.getElementById('modal-title').textContent = `Parada Intermedia ${index + 1}`; document.getElementById('stop-modal').style.display = 'block';
}
function closeStopModal() { document.getElementById('stop-modal').style.display = 'none'; }
function saveStopModalAction() { /* ... */ 
    const index = parseInt(document.getElementById('stop-index-input').value); const stopToEdit = currentTempRoute.intermediateStops[index]; stopToEdit.name = document.getElementById('stop-name-input').value.trim();
    if (!document.getElementById('auto-time-intermediate-checkbox').checked) { const arrivalTime = document.getElementById('arrival-time-input').value; if (!arrivalTime) { alert("Por favor, ingresa la hora de paso/llegada."); return; } stopToEdit.arrivalTime = arrivalTime; stopToEdit.departureTime = arrivalTime; }
    if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); closeStopModal();
}
function startNewRouteAction() { /* ... */ if (isTracking) { alert("Detén el seguimiento."); return; } const routeName = document.getElementById('route-name-input').value.trim(); resetRouteCreationState(); currentTempRoute.name = routeName || "Ruta Sin Nombre"; document.getElementById('route-name-input').value = currentTempRoute.name; alert("Nueva ruta iniciada."); }
function recalculateIntermediateStopTimes() { /* ... (sin cambios) ... */ 
    if (!currentTempRoute.startPoint || !currentTempRoute.endPoint || !currentTempRoute.startPoint.departureTime || !currentTempRoute.endPoint.arrivalTime || currentTempRoute.intermediateStops.length === 0) { renderCurrentStopsList(); return; }
    const startTimeStr = currentTempRoute.startPoint.departureTime; const endTimeStr = currentTempRoute.endPoint.arrivalTime; let startDate = new Date(); startDate.setHours(parseInt(startTimeStr.split(':')[0]), parseInt(startTimeStr.split(':')[1]), 0, 0); let endDate = new Date(); endDate.setHours(parseInt(endTimeStr.split(':')[0]), parseInt(endTimeStr.split(':')[1]), 0, 0); if (endDate.getTime() < startDate.getTime()) { endDate.setDate(endDate.getDate() + 1); }
    const totalDurationMillis = endDate.getTime() - startDate.getTime(); if (totalDurationMillis <= 0) { console.warn("Duración cero/negativa."); currentTempRoute.intermediateStops.forEach(s => {s.arrivalTime = "Error"; s.departureTime = "Error";}); renderCurrentStopsList(); return; }
    const startLatLng = L.latLng(currentTempRoute.startPoint.lat, currentTempRoute.startPoint.lng); let fullPathCoords = [startLatLng]; currentTempRoute.intermediateStops.forEach(stop => fullPathCoords.push(L.latLng(stop.lat, stop.lng))); fullPathCoords.push(L.latLng(currentTempRoute.endPoint.lat, currentTempRoute.endPoint.lng)); let totalPathDistance = 0; for (let i = 0; i < fullPathCoords.length - 1; i++) { totalPathDistance += fullPathCoords[i].distanceTo(fullPathCoords[i+1]); }
    if (totalPathDistance === 0) { console.warn("Distancia cero."); currentTempRoute.intermediateStops.forEach(s => {s.arrivalTime = "Dist.0"; s.departureTime = "Dist.0";}); renderCurrentStopsList(); return; } let accumulatedDistance = 0;
    for (let i = 0; i < currentTempRoute.intermediateStops.length; i++) { const prevP = (i === 0) ? startLatLng : L.latLng(currentTempRoute.intermediateStops[i-1].lat, currentTempRoute.intermediateStops[i-1].lng); const currP = L.latLng(currentTempRoute.intermediateStops[i].lat, currentTempRoute.intermediateStops[i].lng); accumulatedDistance += prevP.distanceTo(currP); const prop = accumulatedDistance / totalPathDistance; const offset = Math.round(totalDurationMillis * prop); let iTime = new Date(startDate.getTime() + offset); const calcTime = `${String(iTime.getHours()).padStart(2, '0')}:${String(iTime.getMinutes()).padStart(2, '0')}`; currentTempRoute.intermediateStops[i].arrivalTime = calcTime; currentTempRoute.intermediateStops[i].departureTime = calcTime; }
    renderCurrentStopsList();
}
function getCombinedStopsForDisplayAndMap() { /* ... (sin cambios) ... */ 
    let combined = []; if (currentTempRoute.startPoint) combined.push(currentTempRoute.startPoint); combined = combined.concat(currentTempRoute.intermediateStops); if (currentTempRoute.endPoint) combined.push(currentTempRoute.endPoint); return combined;
}
function renderCurrentStopsList() { /* ... (sin cambios) ... */
    const listElement = document.getElementById('current-stops-list'); listElement.innerHTML = ''; const stopsToDisplay = getCombinedStopsForDisplayAndMap();
    stopsToDisplay.forEach((stop) => { const listItem = document.createElement('li'); let label = "", timeInfo = ""; if (stop.type === 'start') { label = `<strong>Inicio: ${stop.name || ''}</strong>`; timeInfo = `Salida: ${stop.departureTime || '--:--'}`; } else if (stop.type === 'end') { label = `<strong>Fin: ${stop.name || ''}</strong>`; timeInfo = `Llegada: ${stop.arrivalTime || '--:--'}`; } else { const idx = currentTempRoute.intermediateStops.indexOf(stop); label = `Parada ${idx + 1}: ${stop.name || ''}`; timeInfo = `Paso: ${stop.arrivalTime || '--:--'}`; } listItem.innerHTML = `<div class="stop-info">${label}<br><small>${timeInfo} (${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)})</small></div> ${ (stop.type === 'intermediate') ? `<div class="stop-actions"><button data-action="edit-intermediate" data-index="${currentTempRoute.intermediateStops.indexOf(stop)}">Editar</button><button data-action="remove-intermediate" data-index="${currentTempRoute.intermediateStops.indexOf(stop)}" class="danger">Eliminar</button></div>` : ''}`; listElement.appendChild(listItem); });
    drawRouteOnMap(stopsToDisplay);
}
function drawRouteOnMap(stops) { /* ... (sin cambios) ... */ 
    clearMapStopMarkersAndPolyline(); const latLngs = [];
    stops.forEach((stop, index) => { let icon, popupContent = `<b>${stop.name || `Punto ${index + 1}`}</b> (${stop.type})<br>`; if (stop.type === 'start') { icon = createStopIcon('I', 'start'); popupContent += `Salida: ${stop.departureTime || '--:--'}`; } else if (stop.type === 'end') { icon = createStopIcon('F', 'end'); popupContent += `Llegada: ${stop.arrivalTime || '--:--'}`; } else { const iIdx = currentTempRoute.intermediateStops.indexOf(stop) + 1; icon = createStopIcon(iIdx, 'intermediate'); popupContent += `Paso: ${stop.arrivalTime || '--:--'}`; } const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map); marker.bindPopup(popupContent); stopMarkers.push(marker); latLngs.push([stop.lat, stop.lng]); });
    if (latLngs.length > 1) { routePolyline = L.polyline(latLngs, { color: 'blue' }).addTo(map); }
}
function clearMapStopMarkersAndPolyline() { /* ... (sin cambios) ... */ stopMarkers.forEach(m => map.removeLayer(m)); stopMarkers = []; if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; } }
function saveRouteAction() { /* ... (sin cambios) ... */
    if (isTracking) { alert("Detén seguimiento."); return; } if (!currentTempRoute.startPoint || !currentTempRoute.endPoint || !currentTempRoute.startPoint.departureTime || !currentTempRoute.endPoint.arrivalTime) { alert("Define inicio/fin con horarios."); return; } if (!currentTempRoute.name || currentTempRoute.name === "Ruta Sin Nombre") { const n = prompt("Nombre para ruta:", currentTempRoute.name === "Ruta Sin Nombre" ? "" : currentTempRoute.name); if (!n || n.trim() === "") { alert("Se requiere nombre."); return; } currentTempRoute.name = n.trim(); document.getElementById('route-name-input').value = currentTempRoute.name; } if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } for (const s of currentTempRoute.intermediateStops) { if (!s.arrivalTime || s.arrivalTime.includes("Error") || s.arrivalTime.includes("Dist.0")) { alert(`Problema horario parada "${s.name || 'Intermedia'}".`); return; } }
    const routeToSave = JSON.parse(JSON.stringify(currentTempRoute)); const idx = allSavedRoutes.findIndex(r => r.name === routeToSave.name); if (idx > -1) { if (confirm(`Sobrescribir ruta "${routeToSave.name}"?`)) { allSavedRoutes[idx] = routeToSave; } else { return; } } else { allSavedRoutes.push(routeToSave); }
    saveRoutesToLocalStorage(); populateSavedRoutesSelect(); alert(`Ruta "${routeToSave.name}" guardada.`);
}
function saveRoutesToLocalStorage() { localStorage.setItem('smartMoveProRoutes', JSON.stringify(allSavedRoutes)); }
function loadRoutesFromLocalStorage() { const s = localStorage.getItem('smartMoveProRoutes'); if (s) { allSavedRoutes = JSON.parse(s); } }
function populateSavedRoutesSelect() { /* ... (sin cambios) ... */ const sel = document.getElementById('saved-routes-select'); const cur = sel.value; sel.innerHTML = '<option value="">-- Selecciona ruta --</option>'; allSavedRoutes.forEach((r, i) => { const o = document.createElement('option'); o.value = i; o.textContent = r.name; sel.appendChild(o); }); if (allSavedRoutes[parseInt(cur)]) { sel.value = cur; } else { sel.value = ""; } }
function loadRouteForEditingAction() { /* ... (sin cambios) ... */ if (isTracking) { alert("Detén seguimiento."); return; } const idx = document.getElementById('saved-routes-select').value; if (idx === "") { alert("Selecciona ruta."); return; } resetRouteCreationState(); currentTempRoute = JSON.parse(JSON.stringify(allSavedRoutes[parseInt(idx)])); document.getElementById('route-name-input').value = currentTempRoute.name; if (currentTempRoute.startPoint) { document.getElementById('start-point-info').style.display = 'block'; document.getElementById('start-point-name-display').textContent = currentTempRoute.startPoint.name; document.getElementById('start-time-input').value = currentTempRoute.startPoint.departureTime; document.getElementById('start-point-coords').textContent = `(${currentTempRoute.startPoint.lat.toFixed(4)}, ${currentTempRoute.startPoint.lng.toFixed(4)})`; document.getElementById('set-start-point-btn').disabled = true; document.getElementById('set-end-point-btn').disabled = !currentTempRoute.endPoint; } if (currentTempRoute.endPoint) { document.getElementById('end-point-info').style.display = 'block'; document.getElementById('end-point-name-display').textContent = currentTempRoute.endPoint.name; document.getElementById('end-time-input').value = currentTempRoute.endPoint.arrivalTime; document.getElementById('end-point-coords').textContent = `(${currentTempRoute.endPoint.lat.toFixed(4)}, ${currentTempRoute.endPoint.lng.toFixed(4)})`; document.getElementById('set-end-point-btn').disabled = true; } renderCurrentStopsList(); alert(`Ruta "${currentTempRoute.name}" cargada.`); }
function deleteSelectedRouteAction() { /* ... (sin cambios) ... */ if (isTracking) { alert("Detén seguimiento."); return; } const sel = document.getElementById('saved-routes-select'); const idx = sel.value; if (idx === "") { alert("Selecciona ruta."); return; } const name = allSavedRoutes[parseInt(idx)].name; if (confirm(`Eliminar ruta "${name}"?`)) { allSavedRoutes.splice(parseInt(idx), 1); saveRoutesToLocalStorage(); populateSavedRoutesSelect(); if (currentTempRoute.name === name) { resetRouteCreationState(); } alert(`Ruta "${name}" eliminada.`); } }
function addToTrackingQueueAction() { /* ... (sin cambios) ... */ const idx = document.getElementById('saved-routes-select').value; if (idx === "") { alert("Selecciona ruta."); return; } const d = allSavedRoutes[parseInt(idx)]; if (!d.startPoint || !d.endPoint || !d.startPoint.departureTime || !d.endPoint.arrivalTime) { alert("Ruta incompleta."); return; } let flat = []; flat.push({ lat: d.startPoint.lat, lng: d.startPoint.lng, name: d.startPoint.name, arrivalTime: d.startPoint.departureTime, departureTime: d.startPoint.departureTime, type: 'start' }); d.intermediateStops.forEach(s => { flat.push({ lat: s.lat, lng: s.lng, name: s.name || "Parada", arrivalTime: s.arrivalTime, departureTime: s.departureTime, type: 'intermediate' }); }); flat.push({ lat: d.endPoint.lat, lng: d.endPoint.lng, name: d.endPoint.name, arrivalTime: d.endPoint.arrivalTime, departureTime: d.endPoint.arrivalTime, type: 'end' }); const route = { name: d.name, stops: flat }; trackingQueue.push(JSON.parse(JSON.stringify(route))); renderTrackingQueue(); }
function clearTrackingQueueAction() { /* ... (sin cambios) ... */ trackingQueue = []; renderTrackingQueue(); }
function renderTrackingQueue() { /* ... (sin cambios) ... */ const list = document.getElementById('tracking-queue-list'); list.innerHTML = ''; trackingQueue.forEach((r, i) => { const li = document.createElement('li'); li.textContent = `${i + 1}. ${r.name} (${r.stops.length} paradas)`; list.appendChild(li); }); }


// --- LÓGICA DE SEGUIMIENTO (MODIFICADA) ---
function startTrackingAction() {
    if (isTracking) { alert("El seguimiento ya está activo."); return; }
    if (trackingQueue.length === 0) { alert("Añade al menos una ruta a la cola."); return; }
    if (!lastKnownPosition) { alert("Esperando GPS..."); return; }

    isTracking = true;
    currentTrackingRouteIndex = 0;
    currentTrackingStopIndex = -1; // Inicia antes de la primera parada

    document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
    clearMapStopMarkersAndPolyline();
    drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);

    findAndSetCurrentLeg(); // Sincronizar con la posición inicial

    updateTrackingButtonsState();
    updateManualControlsState();

    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(() => {
        calculateTimeDifference();
    }, 1000);

    updatePassengerTrackingStatus(true); // Informar a pasajeros
    alert("Seguimiento iniciado.");
}

function drawTrackingRouteOnMap(stops) { /* ... (sin cambios) ... */ 
    clearMapStopMarkersAndPolyline(); const latLngs = [];
    stops.forEach((stop, index) => { let icon, popupContent = `<b>${stop.name || `Punto ${index + 1}`}</b><br>`; if (stop.type === 'start') { icon = createStopIcon('I', 'start'); popupContent += `Salida: ${stop.departureTime || '--:--'}`; } else if (stop.type === 'end') { icon = createStopIcon('F', 'end'); popupContent += `Llegada: ${stop.arrivalTime || '--:--'}`; } else { icon = createStopIcon(index, 'intermediate'); popupContent += `Paso: ${stop.arrivalTime || '--:--'}`; } const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map); marker.bindPopup(popupContent); stopMarkers.push(marker); latLngs.push([stop.lat, stop.lng]); });
    if (latLngs.length > 1) { routePolyline = L.polyline(latLngs, { color: 'green', weight: 5 }).addTo(map); }
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
function updateManualControlsState() { /* ... (sin cambios) ... */
    const manualCheckbox = document.getElementById('manual-mode-checkbox'); const prevBtn = document.getElementById('prev-stop-btn'); const nextBtn = document.getElementById('next-stop-btn');
    if (isTracking && manualCheckbox.checked) { prevBtn.disabled = false; nextBtn.disabled = false; } else { prevBtn.disabled = true; nextBtn.disabled = true; }
}

// *** MODIFICADO: Transición de Ruta (Automática o Manual) ***
function transitionToNextRoute() {
    if (!isTracking) return;
    console.log("SmartMovePro: Intentando transición a la siguiente ruta...");

    if (currentTrackingRouteIndex + 1 < trackingQueue.length) {
        const oldRouteName = trackingQueue[currentTrackingRouteIndex].name;
        currentTrackingRouteIndex++;
        currentTrackingStopIndex = -1; // Reiniciar para la nueva ruta
        const newRouteName = trackingQueue[currentTrackingRouteIndex].name;

        alert(`Ruta "${oldRouteName}" completada. Iniciando ruta "${newRouteName}".`);
        document.getElementById('current-route-info').textContent = newRouteName;
        drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);

        findAndSetCurrentLeg(); // Sincronizar con el inicio de la nueva ruta
        calculateTimeDifference(); // Calcular tiempo inicial para la nueva ruta
        updatePassengerTrackingStatus(true); // Actualizar pasajeros con la nueva info

    } else {
        alert("¡Todas las rutas completadas!");
        stopTrackingAction();
    }
}

function manualAdvanceStop(direction) {
    if (!isTracking) return;
    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;

    if (direction > 0) { // Avanzando
        const isLastLeg = (currentTrackingStopIndex + 1 === currentRouteStops.length - 1);
        if (isLastLeg) {
            // Si estamos en el último tramo y se presiona "siguiente", transicionar
            transitionToNextRoute();
        } else if (currentTrackingStopIndex + 1 < currentRouteStops.length -1) { // Si no es el último tramo
             currentTrackingStopIndex++;
             updateNextStopDisplay();
             calculateTimeDifference();
        }
        // Si ya está en el índice de la última parada, no hacer nada más al avanzar.
    } else { // Retrocediendo
        let newProposedStopIndex = currentTrackingStopIndex + direction;
        if (newProposedStopIndex >= -1) {
            currentTrackingStopIndex = newProposedStopIndex;
        } else { // Intentar ir a ruta anterior
            currentTrackingRouteIndex--;
            if (currentTrackingRouteIndex >= 0) {
                const prevRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
                currentTrackingStopIndex = prevRouteStops.length - 2;
                document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
                drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
            } else {
                alert("Ya estás al inicio de la primera ruta.");
                currentTrackingRouteIndex = 0;
                currentTrackingStopIndex = -1;
            }
        }
        updateNextStopDisplay();
        calculateTimeDifference();
    }
}

// Ya no se necesita esta función separada, la lógica está en calculateTimeDifference y transitionToNextRoute
// function advanceToNextLogicalStop() { ... }

function updateNextStopDisplay() {
    if (!isTracking || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        document.getElementById('next-stop-info').textContent = "Ninguna";
        document.getElementById('time-difference-display').textContent = "--:--";
        return;
    }
    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    const nextStopTargetIndex = currentTrackingStopIndex + 1;

    if (nextStopTargetIndex < currentRouteStops.length) {
        const nextStop = currentRouteStops[nextStopTargetIndex];
        document.getElementById('next-stop-info').textContent = `${nextStop.name || `Parada ${nextStopTargetIndex + 1}`} (Lleg. ${nextStop.arrivalTime})`;
    } else {
        document.getElementById('next-stop-info').textContent = "Fin de ruta";
    }
}

// --- RE-SINCRONIZACIÓN Y CÁLCULO DE TIEMPO (MODIFICADO) ---
function findAndSetCurrentLeg() { // Intenta encontrar el tramo actual y ajustar currentTrackingStopIndex
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0) return false;
    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    if (currentRouteStops.length < 2) return false;

    const currentDriverLatLng = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);
    let bestLegFromIndex = -1;
    let minDistanceToCandidate = Infinity;

    // Encontrar la próxima parada más cercana *que no haya sido pasada*
    let candidateNextStopIndex = -1;
    for (let i = currentTrackingStopIndex + 1; i < currentRouteStops.length; i++) {
         const stopLatLng = L.latLng(currentRouteStops[i].lat, currentRouteStops[i].lng);
         const dist = currentDriverLatLng.distanceTo(stopLatLng);
         if (dist < minDistanceToCandidate) {
             minDistanceToCandidate = dist;
             candidateNextStopIndex = i;
         }
    }

    if (candidateNextStopIndex !== -1) {
         // Si la parada más cercana encontrada es diferente de la esperada, ajustar
         const expectedNextStopIndex = currentTrackingStopIndex + 1;
         if (candidateNextStopIndex !== expectedNextStopIndex) {
             console.log(`SmartMovePro: Re-sincronizando. Parada más cercana adelante es ${candidateNextStopIndex}. Ajustando 'desde' a ${candidateNextStopIndex - 1}`);
             currentTrackingStopIndex = candidateNextStopIndex - 1; // La parada "desde" es la anterior a la más cercana
         }
         // Si la más cercana ES la esperada, no hacemos nada, ya está sincronizado.
         updateNextStopDisplay();
         return true;
    } else {
         // No se encontró ninguna parada adecuada adelante (quizás ya pasó la última)
         // Mantener el índice actual si es válido, o indicar fin si ya pasó la penúltima.
         if (currentTrackingStopIndex >= currentRouteStops.length - 2) { // Ya pasó la penúltima
             currentTrackingStopIndex = currentRouteStops.length - 1; // Marcar como en la última
              console.log("SmartMovePro: findAndSetCurrentLeg - Parece estar en o después de la última parada.");
         }
          updateNextStopDisplay();
          // Podría retornar false si no hay próximo candidato, pero mantenemos el índice si es posible
          return currentTrackingStopIndex < currentRouteStops.length -1;
    }
}


function calculateTimeDifference() {
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        updatePassengerTrackingStatus(isTracking);
        return;
    }

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    const currentDriverLatLng = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);
    const manualMode = document.getElementById('manual-mode-checkbox').checked;

    // 1. Determinar la próxima parada objetivo (toStopIndex)
    let toStopIndex = currentTrackingStopIndex + 1;

    // 2. Check de Proximidad y Avance Automático / Transición
    if (toStopIndex < currentRouteStops.length && !manualMode) { // Si hay una próxima parada válida y estamos en modo auto
        const nextStopTarget = currentRouteStops[toStopIndex];
        const distanceToNextStopTarget = currentDriverLatLng.distanceTo(L.latLng(nextStopTarget.lat, nextStopTarget.lng));

        if (distanceToNextStopTarget < PROXIMITY_THRESHOLD_METERS) {
            const isFinalStopOfCurrentRoute = (toStopIndex === currentRouteStops.length - 1);
            if (isFinalStopOfCurrentRoute) {
                transitionToNextRoute(); // Llegó al final de la ruta
            } else {
                // Avanzar al siguiente tramo DENTRO de la misma ruta
                currentTrackingStopIndex++; // Ahora "desde" la parada a la que llegamos
                updateNextStopDisplay();    // Actualizar UI
                // No llamar a calculateTimeDifference recursivamente, el intervalo lo hará.
                // Sí actualizar pasajeros inmediatamente
                updatePassengerTrackingStatus(true);
            }
            return; // Salir ya que el estado cambió y el intervalo recalculará pronto
        }
         // Check si está muy lejos (Podríamos llamar findAndSetCurrentLeg aquí si es necesario)
         else if (distanceToNextStopTarget > MAX_DISTANCE_TO_EXPECTED_NEXT_STOP_METERS) {
             console.log("SmartMovePro: Lejos de parada esperada. Re-sincronizando...");
             if (!findAndSetCurrentLeg()) { // Si falla la re-sincronización
                 document.getElementById('time-difference-display').textContent = "Fuera Ruta?";
                 updatePassengerTrackingStatus(true, true, "Fuera de Ruta");
                 return;
             }
             // Si re-sincronizó, recalculamos toStopIndex para el cálculo de tiempo actual
             toStopIndex = currentTrackingStopIndex + 1;
             // Continuar con el cálculo de tiempo para el *nuevo* tramo identificado...
         }
    }
     // Si está en modo manual o no está cerca, no avanza automáticamente. Procede a calcular tiempo para el tramo actual.


    // 3. Cálculo de Tiempo para el tramo actual (si es válido)
    const fromStopIndex = currentTrackingStopIndex;
    // Recalcular toStopIndex por si findAndSetCurrentLeg lo cambió
    toStopIndex = currentTrackingStopIndex + 1;

    if (fromStopIndex < 0 || toStopIndex >= currentRouteStops.length) {
        document.getElementById('time-difference-display').textContent = (fromStopIndex < 0) ? "Iniciando..." : "FIN";
        document.getElementById('time-difference-display').className = "";
        updatePassengerTrackingStatus(true);
        return;
    }

    const fromStop = currentRouteStops[fromStopIndex];
    const toStop = currentRouteStops[toStopIndex];

    // ... (resto del cálculo de proporción y diferencia de tiempo - SIN CAMBIOS) ...
    const [depH, depM] = fromStop.departureTime.split(':').map(Number);
    let departureDateTime = new Date(); departureDateTime.setHours(depH, depM, 0, 0);
    const [arrH, arrM] = toStop.arrivalTime.split(':').map(Number);
    let scheduledArrivalDateTimeAtNextStop = new Date(); scheduledArrivalDateTimeAtNextStop.setHours(arrH, arrM, 0, 0);
    if (scheduledArrivalDateTimeAtNextStop.getTime() < departureDateTime.getTime()) { scheduledArrivalDateTimeAtNextStop.setDate(scheduledArrivalDateTimeAtNextStop.getDate() + 1); }
    const totalLegScheduledTimeMillis = scheduledArrivalDateTimeAtNextStop.getTime() - departureDateTime.getTime();
    if (totalLegScheduledTimeMillis < 0 ) { console.warn("Tiempo tramo inválido.", fromStop, toStop); document.getElementById('time-difference-display').textContent = "Error Hor."; updatePassengerTrackingStatus(true, true, "Error Hor. Tramo"); return; }
    const coordA = L.latLng(fromStop.lat, fromStop.lng); const coordB = L.latLng(toStop.lat, toStop.lng);
    const totalLegDistance = coordA.distanceTo(coordB); const distanceFromStartOfLeg = currentDriverLatLng.distanceTo(coordA);
    let proportionOfDistanceCovered = 0;
    if (totalLegDistance > 1) { proportionOfDistanceCovered = distanceFromStartOfLeg / totalLegDistance; }
    else if (distanceFromStartOfLeg > 1 && totalLegDistance <=1) { proportionOfDistanceCovered = 1; }
    const scheduledTimeAtCurrentPositionMillis = departureDateTime.getTime() + (proportionOfDistanceCovered * totalLegScheduledTimeMillis);
    const currentTimeMillis = new Date().getTime();
    lastCalculatedDiffMillis = scheduledTimeAtCurrentPositionMillis - currentTimeMillis;
    const diffInTotalMinutes = lastCalculatedDiffMillis / (1000 * 60);
    document.getElementById('time-difference-display').textContent = formatMinutesToTimeDiff(diffInTotalMinutes);
    const displayElement = document.getElementById('time-difference-display');
    if (diffInTotalMinutes < -0.1) displayElement.className = 'late'; else if (diffInTotalMinutes > 0.1) displayElement.className = 'early'; else displayElement.className = 'on-time';
    // --- Fin del cálculo de tiempo ---


    updatePassengerTrackingStatus(true); // Actualizar pasajeros con el resultado del cálculo
}


// --- FUNCIÓN PARA ACTUALIZAR DATOS PARA PASAJEROS (Incluye info de cola) ---
function updatePassengerTrackingStatus(isCurrentlyTracking, hasError = false, errorReason = "") {
    let statusPayload;
    if (!isCurrentlyTracking || hasError) {
        statusPayload = { isTracking: isCurrentlyTracking, hasError: hasError, errorReason: errorReason, lastUpdateTime: new Date().getTime() };
    } else {
        if (currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
            statusPayload = { isTracking: false, lastUpdateTime: new Date().getTime(), reason: "Invalid tracking route index" };
        } else {
            const currentRouteForPassenger = trackingQueue[currentTrackingRouteIndex];
            const currentRouteStopsForPassenger = currentRouteForPassenger.stops;
            let nextStopDataForPassengerObj = null, nextBusStopArrivalTime = null, nextBusStopDepartureTime = null;
            if (currentTrackingStopIndex + 1 < currentRouteStopsForPassenger.length) {
                 nextStopDataForPassengerObj = currentRouteStopsForPassenger[currentTrackingStopIndex + 1];
                 nextBusStopArrivalTime = nextStopDataForPassengerObj.arrivalTime;
                 nextBusStopDepartureTime = nextStopDataForPassengerObj.departureTime;
            }
            statusPayload = {
                isTracking: true, hasError: false,
                routeName: currentRouteForPassenger.name,
                currentRouteIndexInQueue: currentTrackingRouteIndex, // Índice actual
                trackingQueueNames: trackingQueue.map(route => route.name), // Nombres de todas en cola
                currentStopIndexFromWhichDeparted: currentTrackingStopIndex,
                nextStopIndexTowardsWhichHeading: currentTrackingStopIndex + 1,
                currentBusDelayOrAheadMillis: lastCalculatedDiffMillis,
                lastKnownPosition: lastKnownPosition,
                lastUpdateTime: new Date().getTime(),
                nextBusStopArrivalTime: nextBusStopArrivalTime,
                nextBusStopDepartureTime: nextBusStopDepartureTime,
                routeStops: currentRouteStopsForPassenger.map(s => ({ name: s.name, type: s.type, arrivalTime: s.arrivalTime, departureTime: s.departureTime }))
            };
        }
    }
    try { localStorage.setItem('smartMoveProTrackingStatus', JSON.stringify(statusPayload)); }
    catch (e) { console.error("SmartMovePro: Error saving tracking status", e); }
}

// --- UTILIDADES DE TIEMPO ---
function timeToMinutes(timeInput) { /* ... */ let h, m; if (typeof timeInput === 'string') { [h, m] = timeInput.split(':').map(Number); } else if (timeInput instanceof Date) { h = timeInput.getHours(); m = timeInput.getMinutes(); } else { return 0; } return h * 60 + m; }
function formatMinutesToTimeDiff(totalMinutesWithFraction) { /* ... */ const sign = totalMinutesWithFraction < 0 ? "-" : "+"; const absM = Math.abs(totalMinutesWithFraction); let mm = Math.floor(absM); let ss = Math.round((absM - mm) * 60); if (ss === 60) { mm += 1; ss = 0; } return `${sign}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; }

// --- BINDINGS INICIALES ---
function bindEventListeners() { /* ... (sin cambios) ... */
    document.getElementById('cancel-stop-btn').addEventListener('click', closeStopModal); document.getElementById('start-new-route-btn').addEventListener('click', startNewRouteAction); document.getElementById('set-start-point-btn').addEventListener('click', () => { settingPointType = 'start'; alert("Toca mapa para Inicio."); }); document.getElementById('set-end-point-btn').addEventListener('click', () => { if (!currentTempRoute.startPoint) { alert("Fija Inicio primero."); return; } settingPointType = 'end'; alert("Toca mapa para Fin."); }); document.querySelectorAll('.link-button[data-point-type]').forEach(b => { b.addEventListener('click', (e) => { const pt = e.target.dataset.pointType; let cp = (pt === 'start') ? currentTempRoute.startPoint : currentTempRoute.endPoint; if (!cp) { alert(`Punto ${pt} no fijado.`); return; } const nn = prompt(`Nuevo nombre para Punto ${pt}:`, cp.name); if (nn && nn.trim() !== "") { cp.name = nn.trim(); document.getElementById(`${pt}-point-name-display`).textContent = cp.name; renderCurrentStopsList(); } }); }); document.getElementById('start-time-input').addEventListener('change', (e) => { if (currentTempRoute.startPoint) { currentTempRoute.startPoint.departureTime = e.target.value; if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } }); document.getElementById('end-time-input').addEventListener('change', (e) => { if (currentTempRoute.endPoint) { currentTempRoute.endPoint.arrivalTime = e.target.value; if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } }); document.getElementById('auto-time-intermediate-checkbox').addEventListener('change', () => { if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); }); document.getElementById('current-stops-list').addEventListener('click', (e) => { const t = e.target; if (t.tagName === 'BUTTON' && t.dataset.action) { const a = t.dataset.action; const i = parseInt(t.dataset.index); if (a === 'edit-intermediate') { openStopModal(currentTempRoute.intermediateStops[i], i); } else if (a === 'remove-intermediate') { if (isTracking) { alert("Detén seguimiento."); return; } currentTempRoute.intermediateStops.splice(i, 1); if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } } }); document.getElementById('save-stop-btn').addEventListener('click', saveStopModalAction); document.getElementById('save-route-btn').addEventListener('click', saveRouteAction); document.getElementById('load-route-for-editing-btn').addEventListener('click', loadRouteForEditingAction); document.getElementById('delete-selected-route-btn').addEventListener('click', deleteSelectedRouteAction); document.getElementById('add-to-tracking-queue-btn').addEventListener('click', addToTrackingQueueAction); document.getElementById('clear-tracking-queue-btn').addEventListener('click', clearTrackingQueueAction); document.getElementById('start-tracking-btn').addEventListener('click', startTrackingAction); document.getElementById('stop-tracking-btn').addEventListener('click', stopTrackingAction); document.getElementById('manual-mode-checkbox').addEventListener('change', updateManualControlsState); document.getElementById('prev-stop-btn').addEventListener('click', () => manualAdvanceStop(-1)); document.getElementById('next-stop-btn').addEventListener('click', () => manualAdvanceStop(1));
}
window.addEventListener('beforeunload', () => { /* ... */ });
