// js/app.js (Para Smart Move Pro - App del Chofer)

// Service Worker Registration
if ('serviceWorker' in navigator) { /* ... (sin cambios) ... */ }

// Variables Globales
let map;
let currentPositionMarker;
let routePolyline;
let stopMarkers = [];
let startPointGeofenceCircle = null; // Para el círculo visual
let endPointGeofenceCircle = null;   // Para el círculo visual

let currentTempRoute = { name: "", startPoint: null, endPoint: null, intermediateStops: [] };
let allSavedRoutes = [];
let trackingQueue = [];

let isTracking = false;
let currentTrackingRouteIndex = -1;
let currentTrackingStopIndex = -1;
let trackingInterval;
let lastKnownPosition = null;
let lastCalculatedDiffMillis = 0;

const GEOFENCE_RADIUS_METERS = 100; // Radio para geofence de inicio/fin
const PROXIMITY_THRESHOLD_METERS = 70; // Proximidad para paradas intermedias
const MAX_DISTANCE_TO_EXPECTED_NEXT_STOP_METERS = 5000;

let settingPointType = null;

const currentLocationIcon = L.divIcon({ className: 'current-location-icon', html: '', iconSize: [12, 12], iconAnchor: [6, 6] });
function createStopIcon(number, type = 'intermediate') { /* ... (sin cambios) ... */ }

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => { /* ... (sin cambios) ... */
    initMap(); loadAllRoutesDefinitionsFromStorage(); populateSavedRoutesSelect(); bindEventListeners();
    updateTrackingButtonsState(); updateManualControlsState(); updatePassengerTrackingStatus(false); resetRouteCreationState();
});
function initMap() { /* ... (sin cambios) ... */ }
function startGeolocation() { /* ... (sin cambios) ... */ }
function updateCurrentPosition(position) { /* ... (sin cambios) ... */ }
function handleLocationError(error) { /* ... (sin cambios) ... */ }

// --- LÓGICA DE CREACIÓN DE RUTA ---
// ... (Sin cambios: resetRouteCreationState, onMapClick para creación, modales, saveStopModalAction, startNewRouteAction, recalculateIntermediateStopTimes, getCombinedStopsForDisplayAndMap, renderCurrentStopsList, drawRouteOnMap, clearMapStopMarkersAndPolyline) ...
function resetRouteCreationState() { /* ... */ currentTempRoute = { name: "", startPoint: null, endPoint: null, intermediateStops: [] }; document.getElementById('route-name-input').value = ""; document.getElementById('start-point-info').style.display = 'none'; document.getElementById('start-time-input').value = ""; document.getElementById('start-point-name-display').textContent = "Inicio Ruta"; document.getElementById('end-point-info').style.display = 'none'; document.getElementById('end-time-input').value = ""; document.getElementById('end-point-name-display').textContent = "Fin Ruta"; document.getElementById('set-start-point-btn').disabled = false; document.getElementById('set-end-point-btn').disabled = true; settingPointType = null; renderCurrentStopsList(); clearMapStopMarkersAndPolyline(); }
function onMapClick(e) { /* ... */ if (isTracking) return; if (settingPointType) { const { lat, lng } = e.latlng; if (settingPointType === 'start') { currentTempRoute.startPoint = { lat, lng, name: "Inicio Ruta", departureTime: document.getElementById('start-time-input').value || "", type: 'start' }; document.getElementById('start-point-info').style.display = 'block'; document.getElementById('start-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`; document.getElementById('set-start-point-btn').disabled = true; document.getElementById('set-end-point-btn').disabled = false; settingPointType = null; renderCurrentStopsList(); } else if (settingPointType === 'end') { if (!currentTempRoute.startPoint) { alert("Define Inicio."); settingPointType = null; return; } currentTempRoute.endPoint = { lat, lng, name: "Fin Ruta", arrivalTime: document.getElementById('end-time-input').value || "", type: 'end' }; document.getElementById('end-point-info').style.display = 'block'; document.getElementById('end-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`; document.getElementById('set-end-point-btn').disabled = true; settingPointType = null; renderCurrentStopsList(); recalculateIntermediateStopTimes(); } settingPointType = null; } else if (currentTempRoute.startPoint && currentTempRoute.endPoint) { const { lat, lng } = e.latlng; const newIS = { lat, lng, name: "", type: 'intermediate', arrivalTime: "" }; let idx = currentTempRoute.intermediateStops.length; currentTempRoute.intermediateStops.splice(idx, 0, newIS); if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); renderCurrentStopsList(); } else { openStopModal(newIS, idx); } } else { alert("Define Inicio y Fin primero."); } }
function openStopModal(stopData, index) { /* ... */ document.getElementById('stop-lat-input').value = stopData.lat; document.getElementById('stop-lng-input').value = stopData.lng; document.getElementById('stop-index-input').value = index; document.getElementById('stop-name-input').value = stopData.name || ""; const auto = document.getElementById('auto-time-intermediate-checkbox').checked; document.getElementById('manual-time-fields').style.display = auto ? 'none' : 'block'; document.getElementById('auto-time-info').style.display = auto ? 'block' : 'none'; if (!auto) { document.getElementById('arrival-time-input').value = stopData.arrivalTime || ""; } document.getElementById('modal-title').textContent = `Parada Intermedia ${index + 1}`; document.getElementById('stop-modal').style.display = 'block'; }
function closeStopModal() { document.getElementById('stop-modal').style.display = 'none'; }
function saveStopModalAction() { /* ... */ const idx = parseInt(document.getElementById('stop-index-input').value); const stop = currentTempRoute.intermediateStops[idx]; stop.name = document.getElementById('stop-name-input').value.trim(); if (!document.getElementById('auto-time-intermediate-checkbox').checked) { const arrival = document.getElementById('arrival-time-input').value; if (!arrival) { alert("Ingresa hora."); return; } stop.arrivalTime = arrival; stop.departureTime = arrival; } if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); closeStopModal(); }
function startNewRouteAction() { /* ... */ if (isTracking) { alert("Detén seguimiento."); return; } const name = document.getElementById('route-name-input').value.trim(); resetRouteCreationState(); currentTempRoute.name = name || "Ruta Sin Nombre"; document.getElementById('route-name-input').value = currentTempRoute.name; alert("Nueva ruta iniciada."); }
function recalculateIntermediateStopTimes() { /* ... (sin cambios) ... */ }
function getCombinedStopsForDisplayAndMap() { /* ... (sin cambios) ... */ }
function renderCurrentStopsList() { /* ... (sin cambios) ... */ }
function drawRouteOnMap(stops) { /* ... (sin cambios) ... */ }
function clearMapStopMarkersAndPolyline() {
    stopMarkers.forEach(marker => map.removeLayer(marker));
    stopMarkers = [];
    if (routePolyline) {
        map.removeLayer(routePolyline);
        routePolyline = null;
    }
    // Limpiar también los círculos de geofence
    if (startPointGeofenceCircle) {
        map.removeLayer(startPointGeofenceCircle);
        startPointGeofenceCircle = null;
    }
    if (endPointGeofenceCircle) {
        map.removeLayer(endPointGeofenceCircle);
        endPointGeofenceCircle = null;
    }
}

// --- GUARDAR/CARGAR/BORRAR RUTAS ---
// ... (Sin cambios: saveRouteAction, saveRoutesToLocalStorage, loadRoutesFromLocalStorage, populateSavedRoutesSelect, loadRouteForEditingAction, deleteSelectedRouteAction) ...
function saveRouteAction() { /* ... */ }
function saveRoutesToLocalStorage() { localStorage.setItem('smartMoveProRoutes', JSON.stringify(allSavedRoutes)); }
function loadRoutesFromLocalStorage() { const s = localStorage.getItem('smartMoveProRoutes'); if (s) { try { allSavedRoutes = JSON.parse(s); } catch(e){ console.error("Error loading routes", e); allSavedRoutes = []; }} }
function populateSavedRoutesSelect() { /* ... */ }
function loadRouteForEditingAction() { /* ... */ }
function deleteSelectedRouteAction() { /* ... */ }

// --- GESTIÓN DE COLA DE SEGUIMIENTO ---
// ... (Sin cambios: addToTrackingQueueAction, clearTrackingQueueAction, renderTrackingQueue) ...
function addToTrackingQueueAction() { /* ... */ const idx = document.getElementById('saved-routes-select').value; if (idx === "") { alert("Selecciona ruta."); return; } const d = allSavedRoutes[parseInt(idx)]; if (!d.startPoint || !d.endPoint || !d.startPoint.departureTime || !d.endPoint.arrivalTime) { alert("Ruta incompleta."); return; } let flat = []; flat.push({ lat: d.startPoint.lat, lng: d.startPoint.lng, name: d.startPoint.name, arrivalTime: d.startPoint.departureTime, departureTime: d.startPoint.departureTime, type: 'start' }); (d.intermediateStops || []).forEach(s => { flat.push({ lat: s.lat, lng: s.lng, name: s.name || "Parada", arrivalTime: s.arrivalTime, departureTime: s.departureTime, type: 'intermediate' }); }); flat.push({ lat: d.endPoint.lat, lng: d.endPoint.lng, name: d.endPoint.name, arrivalTime: d.endPoint.arrivalTime, departureTime: d.endPoint.arrivalTime, type: 'end' }); const route = { name: d.name, stops: flat }; trackingQueue.push(JSON.parse(JSON.stringify(route))); renderTrackingQueue(); }
function clearTrackingQueueAction() { /* ... */ trackingQueue = []; renderTrackingQueue(); }
function renderTrackingQueue() { /* ... */ }

// --- LÓGICA DE SEGUIMIENTO (MODIFICADA) ---
function startTrackingAction() {
    if (isTracking) { alert("Seguimiento activo."); return; }
    if (trackingQueue.length === 0) { alert("Añade rutas a la cola."); return; }
    if (!lastKnownPosition) { alert("Esperando GPS..."); return; }

    isTracking = true;
    currentTrackingRouteIndex = 0;
    currentTrackingStopIndex = -1; // Inicia antes de la primera parada

    document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
    clearMapStopMarkersAndPolyline(); // Asegura limpiar geofences viejos
    drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops); // Dibuja ruta y geofences

    findAndSetCurrentLeg(); // Sincronizar inicial

    updateTrackingButtonsState();
    updateManualControlsState();

    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(calculateTimeDifference, 1000);

    updatePassengerTrackingStatus(true);
    alert("Seguimiento iniciado.");
}

function drawTrackingRouteOnMap(stops) {
    clearMapStopMarkersAndPolyline(); // Limpiar todo antes de dibujar
    const latLngs = [];
    if (stops.length === 0) return;

    stops.forEach((stop, index) => {
        let icon, popupContent = `<b>${stop.name || `Punto ${index + 1}`}</b><br>`;
        if (stop.type === 'start') { icon = createStopIcon('I', 'start'); popupContent += `Salida: ${stop.departureTime || '--:--'}`; }
        else if (stop.type === 'end') { icon = createStopIcon('F', 'end'); popupContent += `Llegada: ${stop.arrivalTime || '--:--'}`; }
        else { icon = createStopIcon(index, 'intermediate'); popupContent += `Paso: ${stop.arrivalTime || '--:--'}`; }
        const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map); marker.bindPopup(popupContent); stopMarkers.push(marker); latLngs.push([stop.lat, stop.lng]);
    });

    if (latLngs.length > 1) {
        routePolyline = L.polyline(latLngs, { color: 'green', weight: 5 }).addTo(map);
        // Dibujar Geofences
        const startLatLng = L.latLng(stops[0].lat, stops[0].lng);
        startPointGeofenceCircle = L.circle(startLatLng, {
            radius: GEOFENCE_RADIUS_METERS,
            color: 'blue', fillOpacity: 0.1, weight: 1
        }).addTo(map);
        const endLatLng = L.latLng(stops[stops.length - 1].lat, stops[stops.length - 1].lng);
        endPointGeofenceCircle = L.circle(endLatLng, {
            radius: GEOFENCE_RADIUS_METERS,
            color: 'red', fillOpacity: 0.1, weight: 1
        }).addTo(map);
    }
}


function stopTrackingAction() {
    if (!isTracking) return; isTracking = false; if (trackingInterval) clearInterval(trackingInterval); trackingInterval = null;
    currentTrackingRouteIndex = -1; currentTrackingStopIndex = -1; lastCalculatedDiffMillis = 0;
    document.getElementById('time-difference-display').textContent = "--:--"; document.getElementById('time-difference-display').className = "";
    document.getElementById('next-stop-info').textContent = "Ninguna"; document.getElementById('current-route-info').textContent = "Ninguna";
    updateTrackingButtonsState(); updateManualControlsState(); updatePassengerTrackingStatus(false);
    clearMapStopMarkersAndPolyline(); // Limpiar también geofences al detener
    renderCurrentStopsList(); // Volver a mostrar la ruta en edición
    alert("Seguimiento detenido.");
}

function updateTrackingButtonsState() { /* ... (sin cambios) ... */ }

function updateManualControlsState() {
    const manualCheckbox = document.getElementById('manual-mode-checkbox');
    const prevBtn = document.getElementById('prev-stop-btn');
    const nextBtn = document.getElementById('next-stop-btn');
    const isManual = manualCheckbox.checked;

    prevBtn.disabled = !(isTracking && isManual);
    nextBtn.disabled = !(isTracking && isManual);

    // Listener para cambio de modo manual (se asigna una sola vez en bindEventListeners)
}


function transitionToNextRoute() {
    if (!isTracking) return false;
    console.log(`SmartMovePro: Transicionando desde ruta índice ${currentTrackingRouteIndex}`);

    if (currentTrackingRouteIndex + 1 < trackingQueue.length) {
        const oldRouteName = trackingQueue[currentTrackingRouteIndex].name;
        currentTrackingRouteIndex++;
        currentTrackingStopIndex = -1;
        const newRouteName = trackingQueue[currentTrackingRouteIndex].name;
        const newRouteStops = trackingQueue[currentTrackingRouteIndex].stops;

        alert(`Ruta "${oldRouteName}" completada. Iniciando "${newRouteName}".`);
        document.getElementById('current-route-info').textContent = newRouteName;
        clearMapStopMarkersAndPolyline(); // Limpiar marcadores y geofences viejos
        drawTrackingRouteOnMap(newRouteStops); // Dibujar nueva ruta y geofences

        findAndSetCurrentLeg();
        updateNextStopDisplay();
        updatePassengerTrackingStatus(true); // Actualizar pasajeros
        // NO llamar a calculateTimeDifference aquí, el intervalo lo hará.
        return true;

    } else {
        alert("¡Todas las rutas completadas!");
        stopTrackingAction();
        return false;
    }
}

function manualAdvanceStop(direction) { /* ... (sin cambios respecto a versión anterior) ... */
    if (!isTracking || !document.getElementById('manual-mode-checkbox').checked) return; const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    if (direction > 0) { const isCurrentlyAtLastStop = (currentTrackingStopIndex === currentRouteStops.length - 1); const isNextStopTheLastOne = (currentTrackingStopIndex + 1 === currentRouteStops.length - 1); if (isCurrentlyAtLastStop) { transitionToNextRoute(); } else if (isNextStopTheLastOne) { currentTrackingStopIndex++; updateNextStopDisplay(); calculateTimeDifference(); } else { currentTrackingStopIndex++; updateNextStopDisplay(); calculateTimeDifference(); } }
    else { let newIdx = currentTrackingStopIndex - 1; if (newIdx >= -1) { currentTrackingStopIndex = newIdx; } else { if (currentTrackingRouteIndex > 0) { currentTrackingRouteIndex--; const prevStops = trackingQueue[currentTrackingRouteIndex].stops; currentTrackingStopIndex = prevStops.length - 2; document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name; drawTrackingRouteOnMap(prevStops); } else { alert("Inicio de la primera ruta."); } } updateNextStopDisplay(); calculateTimeDifference(); }
}

function updateNextStopDisplay() { // Muestra próxima parada O salida de inicio
    if (!isTracking || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        document.getElementById('next-stop-info').textContent = "Ninguna";
        document.getElementById('time-difference-display').textContent = "--:--";
        return;
    }
    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    const nextStopTargetIndex = currentTrackingStopIndex + 1;

    if (currentTrackingStopIndex === -1 && currentRouteStops.length > 0) { // Caso especial: En inicio
        const startStop = currentRouteStops[0];
        document.getElementById('next-stop-info').textContent = `Salida de ${startStop.name || 'Inicio'} a las ${startStop.departureTime || '--:--'}`;
    } else if (nextStopTargetIndex < currentRouteStops.length) {
        const nextStop = currentRouteStops[nextStopTargetIndex];
        document.getElementById('next-stop-info').textContent = `${nextStop.name || `Parada ${nextStopTargetIndex + 1}`} (Lleg. ${nextStop.arrivalTime})`;
    } else {
        document.getElementById('next-stop-info').textContent = "Fin de ruta actual";
    }
}


// --- RE-SINCRONIZACIÓN Y CÁLCULO DE TIEMPO (Refinado) ---
function findAndSetCurrentLeg() { /* ... (sin cambios respecto a versión anterior) ... */
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0) return false; const stops = trackingQueue[currentTrackingRouteIndex].stops; if (stops.length < 2) return false; const driverLL = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng); let bestNextIdx = -1; let minDist = Infinity; const currentTargetIdx = currentTrackingStopIndex + 1;
    for (let i = currentTargetIdx; i < stops.length; i++) { const stopLL = L.latLng(stops[i].lat, stops[i].lng); const dist = driverLL.distanceTo(stopLL); if (dist < minDist) { minDist = dist; bestNextIdx = i; } }
    if (bestNextIdx === -1 && currentTargetIdx > 0) { for (let i = 0; i < currentTargetIdx; i++) { const stopLL = L.latLng(stops[i].lat, stops[i].lng); const dist = driverLL.distanceTo(stopLL); if (dist < minDist) { minDist = dist; bestNextIdx = i; } } }
    if (bestNextIdx !== -1) { const newFromIdx = bestNextIdx - 1; if (newFromIdx !== currentTrackingStopIndex) { console.log(`SmartMovePro: Re-sinc. Próxima más cercana ${bestNextIdx}. 'Desde' = ${newFromIdx}.`); currentTrackingStopIndex = newFromIdx; } updateNextStopDisplay(); return true; }
    console.warn("SmartMovePro: No se pudo sincronizar."); updateNextStopDisplay(); return false;
}

function calculateTimeDifference() {
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        updatePassengerTrackingStatus(isTracking); return;
    }

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    const currentDriverLatLng = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);
    const manualMode = document.getElementById('manual-mode-checkbox').checked;

    // --- Lógica de Avance/Transición Automática (Si aplica) ---
    if (!manualMode) {
        // Check 1: Proximidad al Punto FINAL de la ruta actual para TRANSICIÓN
        const endStop = currentRouteStops[currentRouteStops.length - 1];
        const endStopLatLng = L.latLng(endStop.lat, endStop.lng);
        if (currentDriverLatLng.distanceTo(endStopLatLng) < GEOFENCE_RADIUS_METERS) {
            console.log("SmartMovePro: Cerca del punto final. Intentando transición...");
             if (!transitionToNextRoute()) { // Si transition falla (no hay más rutas), se detiene dentro.
                 return; // Salir si el seguimiento se detuvo.
             }
             // Si hubo transición, salir y esperar el próximo intervalo para calcular tiempo en la nueva ruta.
             return;
        }

        // Check 2: Proximidad a la SIGUIENTE parada INTERMEDIA esperada
        const nextStopIndex = currentTrackingStopIndex + 1;
        if (nextStopIndex < currentRouteStops.length - 1) { // Si no es la última parada
             const nextStopTarget = currentRouteStops[nextStopIndex];
             const distanceToNextStopTarget = currentDriverLatLng.distanceTo(L.latLng(nextStopTarget.lat, nextStopTarget.lng));
             if (distanceToNextStopTarget < PROXIMITY_THRESHOLD_METERS) {
                 currentTrackingStopIndex++; // Avanzar al siguiente tramo
                 console.log(`SmartMovePro: Avance automático a parada índice ${currentTrackingStopIndex}`);
                 updateNextStopDisplay();
                 updatePassengerTrackingStatus(true); // Notificar cambio de parada a pasajeros
                 // Salir, el cálculo se hará en el próximo ciclo con el nuevo índice
                 return;
             }
        }

        // Check 3: ¿Salió del GEOFENCE de Inicio? (Solo si aún no había salido)
        if (currentTrackingStopIndex === -1 && currentRouteStops.length > 0) {
            const startStopLatLng = L.latLng(currentRouteStops[0].lat, currentRouteStops[0].lng);
            if (currentDriverLatLng.distanceTo(startStopLatLng) > GEOFENCE_RADIUS_METERS) {
                console.log("SmartMovePro: Salió del geofence de inicio.");
                currentTrackingStopIndex = 0; // Marcar como que ya salió del inicio
                updateNextStopDisplay();
                updatePassengerTrackingStatus(true);
                // Continuar para calcular el tiempo del primer tramo...
            }
            // Si sigue dentro del geofence de inicio, no avanza de -1 a 0 automáticamente.
        }
    } // Fin Lógica de Avance Automático


    // --- Cálculo de Tiempo ---
    const fromStopIndex = currentTrackingStopIndex;
    const toStopIndex = currentTrackingStopIndex + 1;

    // Caso especial: Cálculo en el Punto de Inicio (índice -1)
    if (fromStopIndex === -1) {
        if (currentRouteStops.length > 0) {
            const startStop = currentRouteStops[0];
            const departureTimeStr = startStop.departureTime;
            if (departureTimeStr) {
                let departureDateTime = new Date();
                const [depH, depM] = departureTimeStr.split(':').map(Number);
                departureDateTime.setHours(depH, depM, 0, 0);
                // Asegurarse que la fecha de salida sea hoy o mañana si ya pasó la hora
                if (departureDateTime.getTime() < new Date().getTime() - 60000) { // Margen de 1 min
                   // Si la hora programada ya pasó bastante, ¿asumimos que es para mañana? O error?
                   // Por ahora, calcular diferencia con la hora pasada.
                }
                const currentTimeMillis = new Date().getTime();
                // Diferencia respecto a la SALIDA programada
                const diffMillis = departureDateTime.getTime() - currentTimeMillis;
                lastCalculatedDiffMillis = diffMillis; // Guardar la diferencia real (puede ser positiva/adelantado)
                const diffMins = diffMillis / 60000;

                document.getElementById('time-difference-display').textContent = formatMinutesToTimeDiff(diffMins);
                const displayElement = document.getElementById('time-difference-display');
                if (diffMins < -0.1) displayElement.className = 'late';
                else if (diffMins > 0.1) displayElement.className = 'early'; // Mostrar early aunque en "cuando llega" no se use
                else displayElement.className = 'on-time';
            } else {
                document.getElementById('time-difference-display').textContent = "Falta Hora";
            }
        } else {
            document.getElementById('time-difference-display').textContent = "Error Ruta";
        }
        updatePassengerTrackingStatus(true); // Actualizar estado (está en inicio)
        return; // No hay cálculo de tramo que hacer
    }

    // Cálculo normal para tramos entre paradas (fromStopIndex >= 0)
    if (toStopIndex >= currentRouteStops.length) { // Ya pasó la última parada teóricamente
        document.getElementById('time-difference-display').textContent = "FIN";
        document.getElementById('time-difference-display').className = "";
        updatePassengerTrackingStatus(true); // Actualizar estado (está al final)
        return;
    }

    const fromStop = currentRouteStops[fromStopIndex];
    const toStop = currentRouteStops[toStopIndex];

    // ... (Cálculo de tiempo proporcional - SIN CAMBIOS) ...
    const depTime = fromStop.departureTime; const arrTime = toStop.arrivalTime;
    if (!depTime || !arrTime) { /* ... (manejo de error) ... */ document.getElementById('time-difference-display').textContent = "Error Hor."; updatePassengerTrackingStatus(true, true, "Falta Horario"); return; }
    const [depH, depM] = depTime.split(':').map(Number); let depDT = new Date(); depDT.setHours(depH, depM, 0, 0);
    const [arrH, arrM] = arrTime.split(':').map(Number); let arrDT = new Date(); arrDT.setHours(arrH, arrM, 0, 0);
    if (arrDT < depDT) { arrDT.setDate(arrDT.getDate() + 1); }
    const legMillis = arrDT - depDT; if (legMillis < 0 ) { /* ... (manejo de error) ... */ document.getElementById('time-difference-display').textContent = "Error Hor."; updatePassengerTrackingStatus(true, true, "Error Hor. Tramo"); return; }
    const coordA = L.latLng(fromStop.lat, fromStop.lng); const coordB = L.latLng(toStop.lat, toStop.lng);
    const legDist = coordA.distanceTo(coordB); const distCovered = currentDriverLatLng.distanceTo(coordA);
    let prop = 0; if (legDist > 1) { prop = distCovered / legDist; } else if (distCovered > 1 && legDist <= 1) { prop = 1; }
    const schedMillis = depDT.getTime() + (prop * legMillis); const currentMillis = new Date().getTime();
    lastCalculatedDiffMillis = schedMillis - currentMillis;
    const diffMins = lastCalculatedDiffMillis / 60000;
    document.getElementById('time-difference-display').textContent = formatMinutesToTimeDiff(diffMins);
    const displayElement = document.getElementById('time-difference-display'); if (diffMins < -0.1) displayElement.className = 'late'; else if (diffMins > 0.1) displayElement.className = 'early'; else displayElement.className = 'on-time';
    // --- Fin cálculo ---

    updatePassengerTrackingStatus(true); // Actualizar pasajeros
}


// --- FUNCIÓN PARA ACTUALIZAR DATOS PARA PASAJEROS ---
function updatePassengerTrackingStatus(isCurrentlyTracking, hasError = false, errorReason = "") { /* ... (Sin cambios) ... */
    let statusPayload; if (!isCurrentlyTracking || hasError) { statusPayload = { isTracking: isCurrentlyTracking, hasError: hasError, errorReason: errorReason, lastUpdateTime: new Date().getTime() }; } else { if (currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) { statusPayload = { isTracking: false, lastUpdateTime: new Date().getTime(), reason: "Invalid tracking route index" }; } else { const currentRoute = trackingQueue[currentTrackingRouteIndex]; const currentStops = currentRoute.stops; let nextStopData = null, nextArr = null, nextDep = null; if (currentTrackingStopIndex + 1 < currentStops.length) { nextStopData = currentStops[currentTrackingStopIndex + 1]; nextArr = nextStopData.arrivalTime; nextDep = nextStopData.departureTime; } statusPayload = { isTracking: true, hasError: false, routeName: currentRoute.name, currentRouteIndexInQueue: currentTrackingRouteIndex, trackingQueueNames: trackingQueue.map(r => r.name), currentStopIndexFromWhichDeparted: currentTrackingStopIndex, nextStopIndexTowardsWhichHeading: currentTrackingStopIndex + 1, currentBusDelayOrAheadMillis: lastCalculatedDiffMillis, lastKnownPosition: lastKnownPosition, lastUpdateTime: new Date().getTime(), nextBusStopArrivalTime: nextArr, nextBusStopDepartureTime: nextDep, routeStops: currentStops.map(s => ({ name: s.name, type: s.type, arrivalTime: s.arrivalTime, departureTime: s.departureTime })) }; } } try { localStorage.setItem('smartMoveProTrackingStatus', JSON.stringify(statusPayload)); } catch (e) { console.error("SmartMovePro: Error saving tracking status", e); }
}

// --- UTILIDADES DE TIEMPO ---
function timeToMinutes(timeInput) { /* ... */ }
function formatMinutesToTimeDiff(totalMinutesWithFraction) { /* ... */ }

// --- BINDINGS INICIALES ---
function bindEventListeners() {
    document.getElementById('cancel-stop-btn').addEventListener('click', closeStopModal);
    document.getElementById('start-new-route-btn').addEventListener('click', startNewRouteAction);
    document.getElementById('set-start-point-btn').addEventListener('click', () => { settingPointType = 'start'; alert("Toca mapa para Inicio."); });
    document.getElementById('set-end-point-btn').addEventListener('click', () => { if (!currentTempRoute.startPoint) { alert("Fija Inicio primero."); return; } settingPointType = 'end'; alert("Toca mapa para Fin."); });
    document.querySelectorAll('.link-button[data-point-type]').forEach(b => { /* ... (listener renombrar) ... */ });
    document.getElementById('start-time-input').addEventListener('change', (e) => { /* ... (listener tiempo inicio) ... */ });
    document.getElementById('end-time-input').addEventListener('change', (e) => { /* ... (listener tiempo fin) ... */ });
    document.getElementById('auto-time-intermediate-checkbox').addEventListener('change', () => { /* ... (listener checkbox auto) ... */ });
    document.getElementById('current-stops-list').addEventListener('click', (e) => { /* ... (listener lista paradas) ... */ });
    document.getElementById('save-stop-btn').addEventListener('click', saveStopModalAction);
    document.getElementById('save-route-btn').addEventListener('click', saveRouteAction);
    document.getElementById('load-route-for-editing-btn').addEventListener('click', loadRouteForEditingAction);
    document.getElementById('delete-selected-route-btn').addEventListener('click', deleteSelectedRouteAction);
    document.getElementById('add-to-tracking-queue-btn').addEventListener('click', addToTrackingQueueAction);
    document.getElementById('clear-tracking-queue-btn').addEventListener('click', clearTrackingQueueAction);
    document.getElementById('start-tracking-btn').addEventListener('click', startTrackingAction);
    document.getElementById('stop-tracking-btn').addEventListener('click', stopTrackingAction);
    // Asignar listener de cambio de modo manual UNA VEZ
    document.getElementById('manual-mode-checkbox').addEventListener('change', (event) => {
        updateManualControlsState(); // Actualiza estado de botones
        if (isTracking && !event.target.checked) { // Si se DESACTIVA mientras trackea
            console.log("SmartMovePro: Modo manual desactivado via listener. Re-sincronizando...");
            findAndSetCurrentLeg();      // Intentar encontrar la parada correcta
            calculateTimeDifference(); // Calcular tiempo inmediatamente
        }
    });
    document.getElementById('prev-stop-btn').addEventListener('click', () => manualAdvanceStop(-1));
    document.getElementById('next-stop-btn').addEventListener('click', () => manualAdvanceStop(1));
}
window.addEventListener('beforeunload', () => { /* ... */ });
