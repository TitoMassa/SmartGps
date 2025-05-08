// js/app.js (Para Smart Move Pro - App del Chofer)

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => console.log('SmartMovePro: SW registered:', registration.scope))
            .catch(error => console.log('SmartMovePro: SW registration failed:', error));
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
let currentTrackingStopIndex = -1; // Índice de la parada DESDE la que se partió (-1 = aún en inicio o antes)
let trackingInterval;
let lastKnownPosition = null;
let lastCalculatedDiffMillis = 0; // Diferencia vs HORARIO del TRAMO/SALIDA

// Constantes
const GEOFENCE_RADIUS_METERS = 100;
const PROXIMITY_THRESHOLD_METERS = 70;
const MAX_DISTANCE_TO_EXPECTED_NEXT_STOP_METERS = 5000;

let settingPointType = null;

// --- Iconos Leaflet ---
const currentLocationIcon = L.divIcon({ className: 'current-location-icon', html: '', iconSize: [12, 12], iconAnchor: [6, 6] });
function createStopIcon(number, type = 'intermediate') { /* ... (sin cambios) ... */ }

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadRoutesFromLocalStorage();
    populateSavedRoutesSelect();
    bindEventListeners();
    updateTrackingButtonsState();
    updateManualControlsState(); // Llama a esto para estado inicial correcto
    updatePassengerTrackingStatus(false);
    resetRouteCreationState();
});

function initMap() { /* ... (sin cambios) ... */ }
function startGeolocation() { /* ... (sin cambios) ... */ }
function updateCurrentPosition(position) { /* ... (sin cambios) ... */ }
function handleLocationError(error) { /* ... (sin cambios) ... */ }

// --- LÓGICA DE CREACIÓN/EDICIÓN DE RUTA ---
// ... (Sin cambios: resetRouteCreationState, onMapClick, modales, saveStopModalAction, startNewRouteAction, recalculateIntermediateStopTimes, getCombinedStopsForDisplayAndMap, renderCurrentStopsList, drawRouteOnMap, clearMapElements) ...
function resetRouteCreationState() { /* ... */ }
function onMapClick(e) { /* ... */ }
function openStopModal(stopData, index) { /* ... */ }
function closeStopModal() { /* ... */ }
function saveStopModalAction() { /* ... */ }
function startNewRouteAction() { /* ... */ }
function recalculateIntermediateStopTimes() { /* ... */ }
function getCombinedStopsForDisplayAndMap() { /* ... */ }
function renderCurrentStopsList() { /* ... */ }
function drawRouteOnMap(stops) { /* ... */ }
function clearMapElements() { /* ... (limpia marcadores, polilínea y geofences) ... */ }

// --- GUARDAR/CARGAR/BORRAR RUTAS ---
// ... (Sin cambios: saveRouteAction, saveRoutesToLocalStorage, loadRoutesFromLocalStorage, populateSavedRoutesSelect, loadRouteForEditingAction, deleteSelectedRouteAction) ...
function saveRouteAction() { /* ... */ }
function saveRoutesToLocalStorage() { /* ... */ }
function loadRoutesFromLocalStorage() { /* ... */ }
function populateSavedRoutesSelect() { /* ... */ }
function loadRouteForEditingAction() { /* ... */ }
function deleteSelectedRouteAction() { /* ... */ }

// --- GESTIÓN DE COLA DE SEGUIMIENTO ---
// ... (Sin cambios: addToTrackingQueueAction, clearTrackingQueueAction, renderTrackingQueue) ...
function addToTrackingQueueAction() { /* ... */ }
function clearTrackingQueueAction() { /* ... */ }
function renderTrackingQueue() { /* ... */ }


// --- LÓGICA DE SEGUIMIENTO (MODIFICADA) ---
function startTrackingAction() {
    if (isTracking) { alert("Seguimiento activo."); return; }
    if (trackingQueue.length === 0) { alert("Añade rutas a la cola."); return; }
    if (!lastKnownPosition) { alert("Esperando GPS..."); return; }

    isTracking = true;
    currentTrackingRouteIndex = 0;
    currentTrackingStopIndex = -1; // Siempre inicia ANTES de la primera parada

    document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
    clearMapElements();
    drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops); // Dibuja ruta activa Y geofences

    // No llamar a findAndSetCurrentLeg aquí, la lógica inicial se maneja en calculateTimeDifference
    updateNextStopDisplay(); // Mostrar info inicial ("Salida de...")

    updateTrackingButtonsState();
    updateManualControlsState(); // Asegurar estado inicial correcto

    if (trackingInterval) clearInterval(trackingInterval);
    // El intervalo llama a calculateTimeDifference, que ahora contiene la lógica de avance/transición
    trackingInterval = setInterval(calculateTimeDifference, 1000);

    updatePassengerTrackingStatus(true); // Informar estado inicial a pasajeros
    alert("Seguimiento iniciado.");
}

function drawTrackingRouteOnMap(stops) { /* ... (Dibuja ruta y geofences - sin cambios) ... */ }

function stopTrackingAction() { /* ... (Limpia todo, incluyendo geofences - sin cambios) ... */ }

function updateTrackingButtonsState() { /* ... (sin cambios) ... */ }

// Actualiza estado de botones Prev/Next y asigna listener de cambio de modo
function updateManualControlsState() {
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
        currentTrackingStopIndex = -1; // Reiniciar índice para la nueva ruta
        const newRouteName = trackingQueue[currentTrackingRouteIndex].name;
        const newRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
        alert(`Ruta "${oldRouteName}" completada. Iniciando "${newRouteName}".`);
        document.getElementById('current-route-info').textContent = newRouteName;
        clearMapElements();
        drawTrackingRouteOnMap(newRouteStops); // Dibujar nueva ruta y geofences
        // No es necesario llamar a findAndSetCurrentLeg aquí, el estado -1 se maneja en calculateTimeDifference
        updateNextStopDisplay();
        updatePassengerTrackingStatus(true);
        return true;
    } else {
        alert("¡Todas las rutas completadas!");
        stopTrackingAction(); // Detener si no hay más rutas
        return false;
    }
}

// Avance manual entre paradas/rutas
function manualAdvanceStop(direction) {
    if (!isTracking || !document.getElementById('manual-mode-checkbox').checked) return;
    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    if (direction > 0) { // Avanzando
        const isNextStopTheLastOne = (currentTrackingStopIndex + 1 === currentRouteStops.length - 1);
        if (isNextStopTheLastOne) { currentTrackingStopIndex++; } // Avanzar al índice de la última parada
        else if (currentTrackingStopIndex + 1 < currentRouteStops.length - 1) { currentTrackingStopIndex++; } // Avance normal
        else { transitionToNextRoute(); } // Ya está en la última, transicionar
    } else { // Retrocediendo
        let newIdx = currentTrackingStopIndex - 1; if (newIdx >= -1) { currentTrackingStopIndex = newIdx; } else { if (currentTrackingRouteIndex > 0) { currentTrackingRouteIndex--; const prevStops = trackingQueue[currentTrackingRouteIndex].stops; currentTrackingStopIndex = prevStops.length - 2; document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name; drawTrackingRouteOnMap(prevStops); } else { alert("Inicio de la primera ruta."); } }
    }
    updateNextStopDisplay(); // Actualizar UI de próxima parada
    calculateTimeDifference(); // Recalcular tiempo para el nuevo estado
}

// Actualiza la información de la próxima parada en la UI
function updateNextStopDisplay() {
    if (!isTracking || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) { document.getElementById('next-stop-info').textContent = "Ninguna"; document.getElementById('time-difference-display').textContent = "--:--"; return; }
    const stops = trackingQueue[currentTrackingRouteIndex].stops; const nextIdx = currentTrackingStopIndex + 1;
    if (currentTrackingStopIndex === -1 && stops.length > 0) { const start = stops[0]; document.getElementById('next-stop-info').textContent = `Salida de ${start.name || 'Inicio'} a las ${start.departureTime || '--:--'}`; }
    else if (nextIdx < stops.length) { const next = stops[nextIdx]; document.getElementById('next-stop-info').textContent = `${next.name || `Parada ${nextIdx}`} (Lleg. ${next.arrivalTime})`; } // Ojo: El número de parada podría ser +1 si se quiere empezar desde 1
    else { document.getElementById('next-stop-info').textContent = "Fin de ruta actual"; }
}


// --- RE-SINCRONIZACIÓN (cuando se pierde o vuelve a modo auto) ---
function findAndSetCurrentLeg() {
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0) return false;
    const stops = trackingQueue[currentTrackingRouteIndex].stops; if (stops.length < 2) return false;
    const driverLL = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng); let bestNextIdx = -1; let minDist = Infinity;
    // Buscar parada más cercana DESDE la actual + 1 en adelante
    for (let i = currentTrackingStopIndex + 1; i < stops.length; i++) { const stopLL = L.latLng(stops[i].lat, stops[i].lng); const dist = driverLL.distanceTo(stopLL); if (dist < minDist) { minDist = dist; bestNextIdx = i; } }
    // Si no encontró adelante O está muy lejos, buscar la más cercana en general
    if (bestNextIdx === -1 || minDist > MAX_DISTANCE_TO_EXPECTED_NEXT_STOP_METERS) {
        minDist = Infinity; // Resetear para buscar la más cercana en general
        for (let i = 0; i < stops.length; i++) { const stopLL = L.latLng(stops[i].lat, stops[i].lng); const dist = driverLL.distanceTo(stopLL); if (dist < minDist) { minDist = dist; bestNextIdx = i; } }
    }
    if (bestNextIdx !== -1) { const newFromIdx = bestNextIdx - 1; if (newFromIdx !== currentTrackingStopIndex) { console.log(`SmartMovePro: Re-sincronizando. Próxima más cercana ${bestNextIdx}. Estableciendo 'desde' a ${newFromIdx}.`); currentTrackingStopIndex = newFromIdx; } updateNextStopDisplay(); return true; }
    console.warn("SmartMovePro: No se pudo sincronizar."); updateNextStopDisplay(); return false;
}

// --- CÁLCULO PRINCIPAL Y LÓGICA DE AVANCE ---
function calculateTimeDifference() {
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        updatePassengerTrackingStatus(isTracking); return;
    }

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    if (currentRouteStops.length < 2) { updatePassengerTrackingStatus(true, true, "Ruta inválida"); return; }
    const currentDriverLatLng = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);
    const manualMode = document.getElementById('manual-mode-checkbox').checked;

    // --- Lógica de Avance/Transición Automática ---
    if (!manualMode) {
        const endStopIndex = currentRouteStops.length - 1;
        const endStop = currentRouteStops[endStopIndex];
        const endStopLatLng = L.latLng(endStop.lat, endStop.lng);

        // 1. Check de llegada al FINAL de la ruta -> Transición
        // Solo transicionar si *aún no estamos* conceptualmente en la última parada
        if (currentTrackingStopIndex < endStopIndex && currentDriverLatLng.distanceTo(endStopLatLng) < GEOFENCE_RADIUS_METERS) {
            console.log("SmartMovePro: Dentro de geofence final. Transicionando...");
            if (transitionToNextRoute()) return; // Salir si hubo transición exitosa
            else { document.getElementById('time-difference-display').textContent = "FIN"; return; } // Salir si el seguimiento se detuvo
        }

        // 2. Check salida geofence INICIO (solo si currentTrackingStopIndex es -1)
        else if (currentTrackingStopIndex === -1) {
            const startStopLatLng = L.latLng(currentRouteStops[0].lat, currentRouteStops[0].lng);
            if (currentDriverLatLng.distanceTo(startStopLatLng) > GEOFENCE_RADIUS_METERS) {
                console.log("SmartMovePro: Salió de geofence de inicio.");
                currentTrackingStopIndex = 0; // Marcar inicio del primer tramo
                updateNextStopDisplay();
                // No salir, continuar para calcular tiempo del tramo 0 -> 1
            }
            // Si sigue dentro, el cálculo especial se hace más abajo. No avanza índice.
        }

        // 3. Check llegada a parada INTERMEDIA (si no aplica lo anterior)
        // Solo si no estamos ya en la penúltima parada (el último tramo)
        else if (currentTrackingStopIndex < endStopIndex - 1) {
             const nextStopIndex = currentTrackingStopIndex + 1;
             const nextStopTarget = currentRouteStops[nextStopIndex];
             const distanceToNext = currentDriverLatLng.distanceTo(L.latLng(nextStopTarget.lat, nextStopTarget.lng));
             if (distanceToNext < PROXIMITY_THRESHOLD_METERS) {
                 currentTrackingStopIndex++; // Avanzar al siguiente tramo
                 console.log(`SmartMovePro: Avance automático a parada índice ${currentTrackingStopIndex}`);
                 updateNextStopDisplay();
                 updatePassengerTrackingStatus(true); // Notificar cambio
                 return; // Salir, cálculo en el próximo ciclo
             }
        }
    } // Fin Avance Automático


    // --- Cálculo de Tiempo ---
    const fromStopIndex = currentTrackingStopIndex;

    // Calcular y mostrar diferencia en el Punto de Inicio (estado -1)
    if (fromStopIndex === -1) {
        const startStop = currentRouteStops[0];
        const departureTimeStr = startStop.departureTime;
        if (departureTimeStr) {
            let departureDateTime = new Date(); const [h, m] = departureTimeStr.split(':').map(Number); departureDateTime.setHours(h, m, 0, 0);
            const nowMillis = new Date().getTime();
            // Asegurarse que la fecha de salida es hoy o mañana si ya pasó hoy
            if (departureDateTime.getTime() < nowMillis - (1 * 60 * 60 * 1000)) { // Si es más de 1h en el pasado
                // Podríamos asumir que es del día siguiente, pero mantenerlo simple por ahora.
                 let potentialNextDayDeparture = new Date(departureDateTime);
                 potentialNextDayDeparture.setDate(potentialNextDayDeparture.getDate() + 1);
                 // Si la hora futura es más cercana que la pasada, usarla? No, calcular vs la hora programada.
            }
            const diffMillis = departureDateTime.getTime() - nowMillis; // Negativo si ya pasó la hora
            lastCalculatedDiffMillis = diffMillis; // Diferencia vs SALIDA prog.
            const diffMins = diffMillis / 60000;
            document.getElementById('time-difference-display').textContent = formatMinutesToTimeDiff(diffMins);
            const dispEl = document.getElementById('time-difference-display'); if (diffMins < -0.1) dispEl.className = 'late'; else if (diffMins > 0.1) dispEl.className = 'early'; else dispEl.className = 'on-time';
        } else { document.getElementById('time-difference-display').textContent = "Falta Hora"; }
        updatePassengerTrackingStatus(true); return;
    }

    // Cálculo para tramos normales (fromStopIndex >= 0)
    const toStopIndex = fromStopIndex + 1;
    if (toStopIndex >= currentRouteStops.length) { // Ya pasó (o está en) la última parada
        document.getElementById('time-difference-display').textContent = "FIN"; document.getElementById('time-difference-display').className = ""; updatePassengerTrackingStatus(true); return;
    }

    const fromStop = currentRouteStops[fromStopIndex];
    const toStop = currentRouteStops[toStopIndex];
    const depTime = fromStop.departureTime; const arrTime = toStop.arrivalTime; if (!depTime || !arrTime) { document.getElementById('time-difference-display').textContent = "Error Hor."; updatePassengerTrackingStatus(true, true, "Falta Horario"); return; } const [depH, depM] = depTime.split(':').map(Number); let depDT = new Date(); depDT.setHours(depH, depM, 0, 0); const [arrH, arrM] = arrTime.split(':').map(Number); let arrDT = new Date(); arrDT.setHours(arrH, arrM, 0, 0); if (arrDT < depDT) { arrDT.setDate(arrDT.getDate() + 1); } const legMillis = arrDT - depDT; if (legMillis < 0 ) { document.getElementById('time-difference-display').textContent = "Error Hor."; updatePassengerTrackingStatus(true, true, "Error Hor. Tramo"); return; } const coordA = L.latLng(fromStop.lat, fromStop.lng); const coordB = L.latLng(toStop.lat, toStop.lng); const legDist = coordA.distanceTo(coordB); const distCovered = currentDriverLatLng.distanceTo(coordA); let prop = 0; if (legDist > 1) { prop = distCovered / legDist; } else if (distCovered > 1 && legDist <= 1) { prop = 1; } const schedMillis = depDT.getTime() + (prop * legMillis); const currentMillis = new Date().getTime(); lastCalculatedDiffMillis = schedMillis - currentMillis; const diffMins = lastCalculatedDiffMillis / 60000; document.getElementById('time-difference-display').textContent = formatMinutesToTimeDiff(diffMins); const dispEl = document.getElementById('time-difference-display'); if (diffMins < -0.1) dispEl.className = 'late'; else if (diffMins > 0.1) dispEl.className = 'early'; else dispEl.className = 'on-time';
    // --- Fin cálculo ---

    updatePassengerTrackingStatus(true); // Actualizar pasajeros
}


// --- FUNCIÓN PARA ACTUALIZAR DATOS PARA PASAJEROS ---
function updatePassengerTrackingStatus(isCurrentlyTracking, hasError = false, errorReason = "") {
    let statusPayload;
    if (!isCurrentlyTracking || hasError) { statusPayload = { isTracking: isCurrentlyTracking, hasError: hasError, errorReason: errorReason, lastUpdateTime: new Date().getTime() }; }
    else {
        if (currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
            statusPayload = { isTracking: false, lastUpdateTime: new Date().getTime(), reason: "Invalid tracking route index" };
        } else {
            const currentRoute = trackingQueue[currentTrackingRouteIndex]; const currentStops = currentRoute.stops; let nextStopData = null, nextArr = null, nextDep = null;
            const nextStopIdx = currentTrackingStopIndex + 1; // Próxima parada objetivo
            if (nextStopIdx < currentStops.length) { nextStopData = currentStops[nextStopIdx]; nextArr = nextStopData.arrivalTime; nextDep = nextStopData.departureTime; }
            statusPayload = {
                isTracking: true, hasError: false,
                routeName: currentRoute.name,
                currentRouteIndexInQueue: currentTrackingRouteIndex,
                trackingQueueNames: trackingQueue.map(r => r.name),
                currentStopIndexFromWhichDeparted: currentTrackingStopIndex, // -1 si está en inicio
                nextStopIndexTowardsWhichHeading: nextStopIdx,
                // Diferencia calculada real (puede ser positiva/adelantado incluso en inicio)
                currentBusDelayOrAheadMillis: lastCalculatedDiffMillis,
                lastKnownPosition: lastKnownPosition,
                lastUpdateTime: new Date().getTime(),
                nextBusStopArrivalTime: nextArr,
                nextBusStopDepartureTime: nextDep,
                routeStops: currentStops.map(s => ({ name: s.name, type: s.type, arrivalTime: s.arrivalTime, departureTime: s.departureTime }))
            };
        }
    }
    try { localStorage.setItem('smartMoveProTrackingStatus', JSON.stringify(statusPayload)); } catch (e) { console.error("SmartMovePro: Error saving tracking status", e); }
}

// --- UTILIDADES DE TIEMPO ---
function timeToMinutes(timeInput) { let h, m; if (typeof timeInput === 'string') { [h, m] = timeInput.split(':').map(Number); } else if (timeInput instanceof Date) { h = timeInput.getHours(); m = timeInput.getMinutes(); } else { return 0; } return h * 60 + m; }
function formatMinutesToTimeDiff(totalMinutesWithFraction) { const sign = totalMinutesWithFraction < 0 ? "-" : "+"; const absM = Math.abs(totalMinutesWithFraction); let mm = Math.floor(absM); let ss = Math.round((absM - mm) * 60); if (ss === 60) { mm += 1; ss = 0; } return `${sign}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; }

// --- BINDINGS INICIALES ---
function bindEventListeners() {
    // Botones del modal
    document.getElementById('save-stop-btn').addEventListener('click', saveStopModalAction);
    document.getElementById('cancel-stop-btn').addEventListener('click', closeStopModal);
    // Botones de creación/gestión de ruta
    document.getElementById('start-new-route-btn').addEventListener('click', startNewRouteAction);
    document.getElementById('set-start-point-btn').addEventListener('click', () => { settingPointType = 'start'; alert("Toca mapa para Inicio."); });
    document.getElementById('set-end-point-btn').addEventListener('click', () => { if (!currentTempRoute.startPoint) { alert("Fija Inicio primero."); return; } settingPointType = 'end'; alert("Toca mapa para Fin."); });
    document.querySelectorAll('.link-button[data-point-type]').forEach(b => { b.addEventListener('click', (e) => { const pt = e.target.dataset.pointType; let cp = (pt === 'start') ? currentTempRoute.startPoint : currentTempRoute.endPoint; if (!cp) { alert(`Punto ${pt} no fijado.`); return; } const nn = prompt(`Nuevo nombre para Punto ${pt}:`, cp.name); if (nn && nn.trim() !== "") { cp.name = nn.trim(); document.getElementById(`${pt}-point-name-display`).textContent = cp.name; renderCurrentStopsList(); } }); });
    document.getElementById('start-time-input').addEventListener('change', (e) => { if (currentTempRoute.startPoint) { currentTempRoute.startPoint.departureTime = e.target.value; if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } });
    document.getElementById('end-time-input').addEventListener('change', (e) => { if (currentTempRoute.endPoint) { currentTempRoute.endPoint.arrivalTime = e.target.value; if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } });
    document.getElementById('auto-time-intermediate-checkbox').addEventListener('change', () => { if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); });
    document.getElementById('save-route-btn').addEventListener('click', saveRouteAction);
    // Lista de paradas (delegación)
    document.getElementById('current-stops-list').addEventListener('click', (e) => { const t = e.target; if (t.tagName === 'BUTTON' && t.dataset.action) { const a = t.dataset.action; const i = parseInt(t.dataset.index); if (a === 'edit-intermediate') { openStopModal(currentTempRoute.intermediateStops[i], i); } else if (a === 'remove-intermediate') { if (isTracking) { alert("Detén seguimiento."); return; } currentTempRoute.intermediateStops.splice(i, 1); if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } } });
    // Carga/Cola/Ejecución
    document.getElementById('load-route-for-editing-btn').addEventListener('click', loadRouteForEditingAction);
    document.getElementById('delete-selected-route-btn').addEventListener('click', deleteSelectedRouteAction);
    document.getElementById('add-to-tracking-queue-btn').addEventListener('click', addToTrackingQueueAction);
    document.getElementById('clear-tracking-queue-btn').addEventListener('click', clearTrackingQueueAction);
    document.getElementById('start-tracking-btn').addEventListener('click', startTrackingAction);
    document.getElementById('stop-tracking-btn').addEventListener('click', stopTrackingAction);
    // Control Manual
    document.getElementById('manual-mode-checkbox').addEventListener('change', (event) => {
        updateManualControlsState(); // Actualiza botones prev/next
        if (isTracking && !event.target.checked) { // Si se DESACTIVA modo manual mientras trackea
            console.log("SmartMovePro: Modo manual desactivado. Re-sincronizando...");
            findAndSetCurrentLeg();
            // El intervalo se encargará de llamar a calculateTimeDifference
        }
    });
    document.getElementById('prev-stop-btn').addEventListener('click', () => manualAdvanceStop(-1));
    document.getElementById('next-stop-btn').addEventListener('click', () => manualAdvanceStop(1));
}
window.addEventListener('beforeunload', () => { /* ... */ }); // Intento de limpiar estado (poco fiable)
