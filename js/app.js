// js/app.js (Para Smart Move Pro - App del Chofer)

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js') // Ruta relativa a la raíz del sitio
            .then(registration => console.log('SmartMovePro: SW registered: ', registration.scope))
            .catch(error => console.log('SmartMovePro: SW registration failed: ', error));
    });
}

// --- Variables Globales ---
let map;
let currentPositionMarker;
let routePolyline;
let stopMarkers = [];
let startPointGeofenceCircle = null; // Círculo para geofence de inicio
let endPointGeofenceCircle = null;   // Círculo para geofence de fin

// Estructura para la ruta en edición/creación
let currentTempRoute = { name: "", startPoint: null, endPoint: null, intermediateStops: [] };
// Almacenamiento de rutas guardadas
let allSavedRoutes = [];
// Cola de rutas para seguimiento (con estructura de paradas 'plana')
let trackingQueue = [];

// Estado del seguimiento
let isTracking = false;
let currentTrackingRouteIndex = -1; // Índice de la ruta activa en trackingQueue
let currentTrackingStopIndex = -1;  // Índice de la parada DESDE la que se partió (-1 = antes del inicio)
let trackingInterval;
let lastKnownPosition = null;
let lastCalculatedDiffMillis = 0; // Diferencia de tiempo calculada (usada por pasajeros)

// Constantes de configuración
const GEOFENCE_RADIUS_METERS = 100; // Radio para geofence de inicio/fin
const PROXIMITY_THRESHOLD_METERS = 70; // Proximidad para avance en paradas intermedias
const MAX_DISTANCE_TO_EXPECTED_NEXT_STOP_METERS = 5000; // Umbral para intentar re-sincronizar

// Estado auxiliar para creación de ruta
let settingPointType = null; // 'start', 'end', 'intermediate'

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
    loadRoutesFromLocalStorage(); // Carga definiciones guardadas
    populateSavedRoutesSelect();  // Rellena el dropdown
    bindEventListeners();         // Asigna listeners a botones, etc.
    updateTrackingButtonsState(); // Ajusta botones según si isTracking es true/false
    updateManualControlsState();  // Ajusta botones de control manual
    updatePassengerTrackingStatus(false); // Informa estado inicial a pasajeros
    resetRouteCreationState();    // Prepara UI para crear/editar ruta
});

function initMap() {
    map = L.map('map').setView([-34.6037, -58.3816], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    map.on('click', onMapClick); // Listener para clicks en el mapa
    startGeolocation();          // Iniciar seguimiento GPS
}
function startGeolocation() {
    if (navigator.geolocation) { navigator.geolocation.watchPosition(updateCurrentPosition, handleLocationError, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }); }
    else { alert("Geolocalización no soportada."); }
}
function updateCurrentPosition(position) {
    const lat = position.coords.latitude; const lng = position.coords.longitude; lastKnownPosition = { lat, lng };
    if (!currentPositionMarker) { currentPositionMarker = L.marker([lat, lng], { icon: currentLocationIcon }).addTo(map); map.setView([lat, lng], 16); }
    else { currentPositionMarker.setLatLng([lat, lng]); }
    // El intervalo se encarga de llamar a calculateTimeDifference
}
function handleLocationError(error) { console.warn(`SmartMovePro: Geo Error(${error.code}): ${error.message}`); }

// --- LÓGICA DE CREACIÓN/EDICIÓN DE RUTA ---
function resetRouteCreationState() { currentTempRoute = { name: "", startPoint: null, endPoint: null, intermediateStops: [] }; document.getElementById('route-name-input').value = ""; document.getElementById('start-point-info').style.display = 'none'; document.getElementById('start-time-input').value = ""; document.getElementById('start-point-name-display').textContent = "Inicio Ruta"; document.getElementById('end-point-info').style.display = 'none'; document.getElementById('end-time-input').value = ""; document.getElementById('end-point-name-display').textContent = "Fin Ruta"; document.getElementById('set-start-point-btn').disabled = false; document.getElementById('set-end-point-btn').disabled = true; settingPointType = null; renderCurrentStopsList(); clearMapElements(); }
function onMapClick(e) { if (isTracking) return; if (settingPointType) { const { lat, lng } = e.latlng; if (settingPointType === 'start') { currentTempRoute.startPoint = { lat, lng, name: "Inicio Ruta", departureTime: document.getElementById('start-time-input').value || "", type: 'start' }; document.getElementById('start-point-info').style.display = 'block'; document.getElementById('start-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`; document.getElementById('set-start-point-btn').disabled = true; document.getElementById('set-end-point-btn').disabled = false; settingPointType = null; renderCurrentStopsList(); } else if (settingPointType === 'end') { if (!currentTempRoute.startPoint) { alert("Define Inicio."); settingPointType = null; return; } currentTempRoute.endPoint = { lat, lng, name: "Fin Ruta", arrivalTime: document.getElementById('end-time-input').value || "", type: 'end' }; document.getElementById('end-point-info').style.display = 'block'; document.getElementById('end-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`; document.getElementById('set-end-point-btn').disabled = true; settingPointType = null; renderCurrentStopsList(); recalculateIntermediateStopTimes(); } settingPointType = null; } else if (currentTempRoute.startPoint && currentTempRoute.endPoint) { const { lat, lng } = e.latlng; const newIS = { lat, lng, name: "", type: 'intermediate', arrivalTime: "" }; let idx = currentTempRoute.intermediateStops.length; currentTempRoute.intermediateStops.splice(idx, 0, newIS); if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); renderCurrentStopsList(); } else { openStopModal(newIS, idx); } } else { alert("Define Inicio y Fin primero."); } }
function openStopModal(stopData, index) { document.getElementById('stop-lat-input').value = stopData.lat; document.getElementById('stop-lng-input').value = stopData.lng; document.getElementById('stop-index-input').value = index; document.getElementById('stop-name-input').value = stopData.name || ""; const auto = document.getElementById('auto-time-intermediate-checkbox').checked; document.getElementById('manual-time-fields').style.display = auto ? 'none' : 'block'; document.getElementById('auto-time-info').style.display = auto ? 'block' : 'none'; if (!auto) { document.getElementById('arrival-time-input').value = stopData.arrivalTime || ""; } document.getElementById('modal-title').textContent = `Parada Intermedia ${index + 1}`; document.getElementById('stop-modal').style.display = 'block'; }
function closeStopModal() { document.getElementById('stop-modal').style.display = 'none'; }
function saveStopModalAction() { const idx = parseInt(document.getElementById('stop-index-input').value); const stop = currentTempRoute.intermediateStops[idx]; stop.name = document.getElementById('stop-name-input').value.trim(); if (!document.getElementById('auto-time-intermediate-checkbox').checked) { const arrival = document.getElementById('arrival-time-input').value; if (!arrival) { alert("Ingresa hora."); return; } stop.arrivalTime = arrival; stop.departureTime = arrival; } if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); closeStopModal(); }
function startNewRouteAction() { if (isTracking) { alert("Detén seguimiento."); return; } const name = document.getElementById('route-name-input').value.trim(); resetRouteCreationState(); currentTempRoute.name = name || "Ruta Sin Nombre"; document.getElementById('route-name-input').value = currentTempRoute.name; alert("Nueva ruta iniciada."); }
function recalculateIntermediateStopTimes() { /* ... (sin cambios) ... */ }
function getCombinedStopsForDisplayAndMap() { let c = []; if (currentTempRoute.startPoint) c.push(currentTempRoute.startPoint); c = c.concat(currentTempRoute.intermediateStops); if (currentTempRoute.endPoint) c.push(currentTempRoute.endPoint); return c; }
function renderCurrentStopsList() { /* ... (sin cambios, llama a drawRouteOnMap al final) ... */ const list = document.getElementById('current-stops-list'); list.innerHTML = ''; const stops = getCombinedStopsForDisplayAndMap(); stops.forEach(s => { const li = document.createElement('li'); let lbl = "", time = ""; if (s.type === 'start') { lbl = `<strong>Inicio: ${s.name || ''}</strong>`; time = `Salida: ${s.departureTime || '--:--'}`; } else if (s.type === 'end') { lbl = `<strong>Fin: ${s.name || ''}</strong>`; time = `Llegada: ${s.arrivalTime || '--:--'}`; } else { const i = currentTempRoute.intermediateStops.indexOf(s); lbl = `Parada ${i + 1}: ${s.name || ''}`; time = `Paso: ${s.arrivalTime || '--:--'}`; } li.innerHTML = `<div class="stop-info">${lbl}<br><small>${time} (${s.lat.toFixed(4)}, ${s.lng.toFixed(4)})</small></div> ${ (s.type === 'intermediate') ? `<div class="stop-actions"><button data-action="edit-intermediate" data-index="${currentTempRoute.intermediateStops.indexOf(s)}">Editar</button><button data-action="remove-intermediate" data-index="${currentTempRoute.intermediateStops.indexOf(s)}" class="danger">Eliminar</button></div>` : ''}`; list.appendChild(li); }); drawRouteOnMap(stops); }
function drawRouteOnMap(stops) { // Dibuja ruta en modo EDICIÓN (sin geofences)
    clearMapElements(); const lls = [];
    stops.forEach((s, i) => { let icon, pop = `<b>${s.name || `Punto ${i + 1}`}</b> (${s.type})<br>`; if (s.type === 'start') { icon = createStopIcon('I', 'start'); pop += `Salida: ${s.departureTime || '--:--'}`; } else if (s.type === 'end') { icon = createStopIcon('F', 'end'); pop += `Llegada: ${s.arrivalTime || '--:--'}`; } else { const iIdx = currentTempRoute.intermediateStops.indexOf(s) + 1; icon = createStopIcon(iIdx, 'intermediate'); pop += `Paso: ${s.arrivalTime || '--:--'}`; } const m = L.marker([s.lat, s.lng], { icon }).addTo(map); m.bindPopup(pop); stopMarkers.push(m); lls.push([s.lat, s.lng]); });
    if (lls.length > 1) { routePolyline = L.polyline(lls, { color: 'blue' }).addTo(map); }
}
function clearMapElements() { // Limpia marcadores, polilínea y geofences
    stopMarkers.forEach(marker => map.removeLayer(marker)); stopMarkers = [];
    if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; }
    if (startPointGeofenceCircle) { map.removeLayer(startPointGeofenceCircle); startPointGeofenceCircle = null; }
    if (endPointGeofenceCircle) { map.removeLayer(endPointGeofenceCircle); endPointGeofenceCircle = null; }
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
    currentTrackingStopIndex = -1; // Inicia antes de la primera parada

    document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
    clearMapElements(); // Limpiar todo, incluyendo geofences antiguos
    drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops); // Dibuja ruta activa Y geofences

    findAndSetCurrentLeg(); // Sincronizar inicial
    updateNextStopDisplay(); // Mostrar info inicial de parada/salida

    updateTrackingButtonsState();
    updateManualControlsState();

    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(calculateTimeDifference, 1000);

    updatePassengerTrackingStatus(true);
    alert("Seguimiento iniciado.");
}

function drawTrackingRouteOnMap(stops) { // Dibuja ruta y geofences en modo SEGUIMIENTO
    clearMapElements(); // Limpiar elementos previos
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
        // Dibujar Geofences de Inicio y Fin
        const startLatLng = L.latLng(stops[0].lat, stops[0].lng);
        startPointGeofenceCircle = L.circle(startLatLng, { radius: GEOFENCE_RADIUS_METERS, color: 'blue', fillOpacity: 0.1, weight: 1 }).addTo(map);
        const endLatLng = L.latLng(stops[stops.length - 1].lat, stops[stops.length - 1].lng);
        endPointGeofenceCircle = L.circle(endLatLng, { radius: GEOFENCE_RADIUS_METERS, color: 'red', fillOpacity: 0.1, weight: 1 }).addTo(map);
    }
}


function stopTrackingAction() {
    if (!isTracking) return; isTracking = false; if (trackingInterval) clearInterval(trackingInterval); trackingInterval = null;
    currentTrackingRouteIndex = -1; currentTrackingStopIndex = -1; lastCalculatedDiffMillis = 0;
    document.getElementById('time-difference-display').textContent = "--:--"; document.getElementById('time-difference-display').className = "";
    document.getElementById('next-stop-info').textContent = "Ninguna"; document.getElementById('current-route-info').textContent = "Ninguna";
    updateTrackingButtonsState(); updateManualControlsState(); updatePassengerTrackingStatus(false);
    clearMapElements(); // Limpiar marcadores, polilínea y geofences
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

// Función para cambiar a la siguiente ruta en la cola
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
        clearMapElements(); // Limpiar anterior
        drawTrackingRouteOnMap(newRouteStops); // Dibujar nueva y geofences
        findAndSetCurrentLeg(); // Sincronizar al inicio de la nueva
        updateNextStopDisplay();
        updatePassengerTrackingStatus(true);
        return true; // Transición ok
    } else {
        alert("¡Todas las rutas completadas!");
        stopTrackingAction();
        return false; // No hay más rutas
    }
}

function manualAdvanceStop(direction) { /* ... (sin cambios respecto a versión anterior) ... */ }

function updateNextStopDisplay() { // Muestra próxima parada O salida de inicio
    if (!isTracking || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        document.getElementById('next-stop-info').textContent = "Ninguna"; document.getElementById('time-difference-display').textContent = "--:--"; return;
    }
    const stops = trackingQueue[currentTrackingRouteIndex].stops;
    const nextIdx = currentTrackingStopIndex + 1;
    if (currentTrackingStopIndex === -1 && stops.length > 0) { // En inicio
        const start = stops[0]; document.getElementById('next-stop-info').textContent = `Salida de ${start.name || 'Inicio'} a las ${start.departureTime || '--:--'}`;
    } else if (nextIdx < stops.length) { // En tramo intermedio o final
        const next = stops[nextIdx]; document.getElementById('next-stop-info').textContent = `${next.name || `Parada ${nextIdx + 1}`} (Lleg. ${next.arrivalTime})`;
    } else { // Ya pasó la última
        document.getElementById('next-stop-info').textContent = "Fin de ruta actual";
    }
}

// --- RE-SINCRONIZACIÓN Y CÁLCULO DE TIEMPO (Refinado) ---
function findAndSetCurrentLeg() { /* ... (sin cambios respecto a versión anterior) ... */
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0) return false; const stops = trackingQueue[currentTrackingRouteIndex].stops; if (stops.length < 2) return false; const driverLL = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng); let bestNextIdx = -1; let minDist = Infinity; const currentTargetIdx = currentTrackingStopIndex + 1;
    for (let i = currentTargetIdx; i < stops.length; i++) { const stopLL = L.latLng(stops[i].lat, stops[i].lng); const dist = driverLL.distanceTo(stopLL); if (dist < minDist) { minDist = dist; bestNextIdx = i; } }
    if (bestNextIdx === -1 && currentTargetIdx > 0) { for (let i = 0; i < currentTargetIdx; i++) { const stopLL = L.latLng(stops[i].lat, stops[i].lng); const dist = driverLL.distanceTo(stopLL); if (dist < minDist) { minDist = dist; bestNextIdx = i; } } }
    if (bestNextIdx !== -1) { const newFromIdx = bestNextIdx - 1; if (newFromIdx !== currentTrackingStopIndex) { console.log(`SmartMovePro: Re-sinc. Próxima ${bestNextIdx}. Desde ${newFromIdx}.`); currentTrackingStopIndex = newFromIdx; } updateNextStopDisplay(); return true; }
    console.warn("SmartMovePro: No se pudo sincronizar."); updateNextStopDisplay(); return false;
}

function calculateTimeDifference() {
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        updatePassengerTrackingStatus(isTracking); return;
    }

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    const currentDriverLatLng = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);
    const manualMode = document.getElementById('manual-mode-checkbox').checked;

    // --- Lógica de Avance/Transición Automática ---
    if (!manualMode && currentRouteStops.length > 1) {
        const endStop = currentRouteStops[currentRouteStops.length - 1];
        const endStopLatLng = L.latLng(endStop.lat, endStop.lng);

        // 1. Check de llegada al FINAL de la ruta actual
        if (currentDriverLatLng.distanceTo(endStopLatLng) < GEOFENCE_RADIUS_METERS) {
             // Asegurarse de que no esté ya en la última parada conceptualmente
             // Evita transiciones múltiples si permanece cerca del final.
             // Se necesita un estado adicional o chequear si ya se llamó a transitionToNextRoute recientemente.
             // Simplificación: Si está cerca del final Y no es la primera comprobación así, transicionar.
             // O más simple: transitionToNextRoute maneja el index, así que llamarla de nuevo no debería romper nada grave.
             console.log("SmartMovePro: Dentro de geofence final. Intentando transición...");
             if (transitionToNextRoute()) {
                 return; // Salir si hubo transición exitosa
             } else {
                 // Si no hubo transición (era la última ruta), el seguimiento se detuvo.
                 // Mostrar FIN y salir.
                 document.getElementById('time-difference-display').textContent = "FIN";
                 document.getElementById('time-difference-display').className = "";
                 updatePassengerTrackingStatus(false); // El seguimiento se detuvo
                 return;
             }
        }

        // 2. Check de salida del geofence de INICIO (si aún está en -1)
        if (currentTrackingStopIndex === -1) {
            const startStopLatLng = L.latLng(currentRouteStops[0].lat, currentRouteStops[0].lng);
            if (currentDriverLatLng.distanceTo(startStopLatLng) > GEOFENCE_RADIUS_METERS) {
                console.log("SmartMovePro: Salió del geofence de inicio.");
                currentTrackingStopIndex = 0; // Marcar como que inició el primer tramo
                updateNextStopDisplay();
                updatePassengerTrackingStatus(true);
                // Continuar para calcular tiempo del primer tramo...
            }
            // Si sigue dentro, NO avanza el índice automáticamente. El cálculo de tiempo se hará más abajo.
        }
        // 3. Check de llegada a parada INTERMEDIA (si no está en inicio ni en final)
        else if (currentTrackingStopIndex < currentRouteStops.length - 2) { // Si hay parada intermedia siguiente
             const nextStopIndex = currentTrackingStopIndex + 1;
             const nextStopTarget = currentRouteStops[nextStopIndex];
             const distanceToNext = currentDriverLatLng.distanceTo(L.latLng(nextStopTarget.lat, nextStopTarget.lng));
             if (distanceToNext < PROXIMITY_THRESHOLD_METERS) {
                 currentTrackingStopIndex++; // Avanzar al siguiente tramo
                 console.log(`SmartMovePro: Avance automático a parada índice ${currentTrackingStopIndex}`);
                 updateNextStopDisplay();
                 updatePassengerTrackingStatus(true);
                 // Salir, el cálculo lo hará el próximo intervalo
                 return;
             }
        }
    } // Fin Lógica Avance Automático


    // --- Cálculo de Tiempo (Adaptado para Inicio) ---
    const fromStopIndex = currentTrackingStopIndex;
    const toStopIndex = currentTrackingStopIndex + 1;

    // Calcular y mostrar diferencia en el Punto de Inicio
    if (fromStopIndex === -1) {
        if (currentRouteStops.length > 0) {
            const startStop = currentRouteStops[0];
            const departureTimeStr = startStop.departureTime;
            if (departureTimeStr) {
                let departureDateTime = new Date();
                const [depH, depM] = departureTimeStr.split(':').map(Number);
                departureDateTime.setHours(depH, depM, 0, 0);
                // Ajustar fecha si la hora de salida ya pasó hoy (asumir que es para mañana)
                // Esto puede ser complejo. Una heurística simple: si es más de X horas en el pasado, sumar un día.
                const nowMillis = new Date().getTime();
                if (departureDateTime.getTime() < nowMillis - (2 * 3600 * 1000)) { // Si es más de 2h en el pasado
                     // Podría ser un error o del día siguiente. Asumir que es del día siguiente si es muy temprano ahora.
                     // Mejor: calcular diferencia directa y que el usuario interprete.
                }
                const diffMillis = departureDateTime.getTime() - nowMillis;
                lastCalculatedDiffMillis = diffMillis; // Diferencia vs salida prog.
                const diffMins = diffMillis / 60000;
                document.getElementById('time-difference-display').textContent = formatMinutesToTimeDiff(diffMins);
                const dispEl = document.getElementById('time-difference-display');
                if (diffMins < -0.1) dispEl.className = 'late'; else if (diffMins > 0.1) dispEl.className = 'early'; else dispEl.className = 'on-time';
            } else { document.getElementById('time-difference-display').textContent = "Falta Hora"; }
        } else { document.getElementById('time-difference-display').textContent = "Error Ruta"; }
        updatePassengerTrackingStatus(true); // Estado en inicio
        return; // Salir, no hay cálculo de tramo
    }

    // Cálculo normal para tramos o si ya se pasó la última parada
    if (toStopIndex >= currentRouteStops.length) {
        document.getElementById('time-difference-display').textContent = "FIN"; document.getElementById('time-difference-display').className = ""; updatePassengerTrackingStatus(true); return;
    }

    const fromStop = currentRouteStops[fromStopIndex];
    const toStop = currentRouteStops[toStopIndex];
    // ... (Cálculo proporcional igual que antes) ...
    const depTime = fromStop.departureTime; const arrTime = toStop.arrivalTime; if (!depTime || !arrTime) { document.getElementById('time-difference-display').textContent = "Error Hor."; updatePassengerTrackingStatus(true, true, "Falta Horario"); return; } const [depH, depM] = depTime.split(':').map(Number); let depDT = new Date(); depDT.setHours(depH, depM, 0, 0); const [arrH, arrM] = arrTime.split(':').map(Number); let arrDT = new Date(); arrDT.setHours(arrH, arrM, 0, 0); if (arrDT < depDT) { arrDT.setDate(arrDT.getDate() + 1); } const legMillis = arrDT - depDT; if (legMillis < 0 ) { document.getElementById('time-difference-display').textContent = "Error Hor."; updatePassengerTrackingStatus(true, true, "Error Hor. Tramo"); return; } const coordA = L.latLng(fromStop.lat, fromStop.lng); const coordB = L.latLng(toStop.lat, toStop.lng); const legDist = coordA.distanceTo(coordB); const distCovered = currentDriverLatLng.distanceTo(coordA); let prop = 0; if (legDist > 1) { prop = distCovered / legDist; } else if (distCovered > 1 && legDist <= 1) { prop = 1; } const schedMillis = depDT.getTime() + (prop * legMillis); const currentMillis = new Date().getTime(); lastCalculatedDiffMillis = schedMillis - currentMillis; const diffMins = lastCalculatedDiffMillis / 60000; document.getElementById('time-difference-display').textContent = formatMinutesToTimeDiff(diffMins); const dispEl = document.getElementById('time-difference-display'); if (diffMins < -0.1) dispEl.className = 'late'; else if (diffMins > 0.1) dispEl.className = 'early'; else dispEl.className = 'on-time';
    // --- Fin cálculo ---

    updatePassengerTrackingStatus(true);
}

// --- FUNCIÓN PARA ACTUALIZAR DATOS PARA PASAJEROS ---
function updatePassengerTrackingStatus(isCurrentlyTracking, hasError = false, errorReason = "") { /* ... (Sin cambios) ... */ }

// --- UTILIDADES DE TIEMPO ---
function timeToMinutes(timeInput) { /* ... */ }
function formatMinutesToTimeDiff(totalMinutesWithFraction) { /* ... */ }

// --- BINDINGS INICIALES ---
function bindEventListeners() { // Asegurar que el listener de change se añade una sola vez
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
    document.getElementById('manual-mode-checkbox').addEventListener('change', (event) => {
        updateManualControlsState(); // Actualiza botones prev/next
        if (isTracking && !event.target.checked) { // Si se DESACTIVA modo manual
            console.log("SmartMovePro: Modo manual desactivado via listener. Re-sincronizando...");
            findAndSetCurrentLeg();
            // El intervalo se encargará de llamar a calculateTimeDifference
        }
    });
    document.getElementById('prev-stop-btn').addEventListener('click', () => manualAdvanceStop(-1));
    document.getElementById('next-stop-btn').addEventListener('click', () => manualAdvanceStop(1));
}
window.addEventListener('beforeunload', () => { /* ... */ });
