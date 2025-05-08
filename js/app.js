// js/app.js (Para Smart Move Pro - App del Chofer)
// Versión Revisada y Comentada

// Service Worker Registration (Asegúrate que la ruta a sw.js sea correcta desde tu HTML)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => console.log('SmartMovePro: SW registered:', registration.scope))
            .catch(error => console.log('SmartMovePro: SW registration failed:', error));
    });
}

// --- Variables Globales ---
let map;                            // Instancia del mapa Leaflet
let currentPositionMarker;          // Marcador azul de posición actual
let routePolyline;                  // Línea de la ruta activa
let stopMarkers = [];               // Array de marcadores de parada (I, 1, 2.., F)
let startPointGeofenceCircle = null;// Círculo visual Geofence Inicio
let endPointGeofenceCircle = null;  // Círculo visual Geofence Fin

// Ruta en edición/creación
let currentTempRoute = { name: "", startPoint: null, endPoint: null, intermediateStops: [] };
// Almacenamiento local
let allSavedRoutes = [];
// Cola para seguimiento
let trackingQueue = []; // { name: "...", stops: [paradaPlana1, paradaPlana2,...] }

// Estado del Seguimiento
let isTracking = false;             // ¿Está el seguimiento activo?
let currentTrackingRouteIndex = -1; // Índice de la ruta actual en trackingQueue
let currentTrackingStopIndex = -1;  // Índice de la parada DESDE la que partió (-1 = antes/en inicio)
let trackingInterval;               // ID del setInterval
let lastKnownPosition = null;       // Última {lat, lng} válida
let lastCalculatedDiffMillis = 0;   // Última diferencia calculada (Sched - Actual) en ms

// --- Constantes de Configuración ---
const GEOFENCE_RADIUS_METERS = 100; // Radio geocercas Inicio/Fin
const PROXIMITY_THRESHOLD_METERS = 70; // Radio para paradas intermedias
const MAX_DISTANCE_TO_EXPECTED_NEXT_STOP_METERS = 5000; // Umbral para re-sincronizar si se desvía
const UPDATE_INTERVAL_MS = 1000;    // Frecuencia de actualización del intervalo principal

// Estado auxiliar para creación
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
    bindEventListeners(); // Asignar todos los listeners una vez
    updateTrackingButtonsState();
    updateManualControlsState();
    updatePassengerTrackingStatus(false); // Estado inicial offline para pasajeros
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
    // El intervalo se encarga de llamar a calculateTimeDifference
}
function handleLocationError(error) { console.warn(`SmartMovePro: Geo Error(${error.code}): ${error.message}`); }

// --- LÓGICA DE CREACIÓN/EDICIÓN DE RUTA ---
function resetRouteCreationState() { /* ... */ } // Limpia UI y variable currentTempRoute
function onMapClick(e) { /* ... */ } // Maneja clicks para fijar/añadir paradas
function openStopModal(stopData, index) { /* ... */ } // Abre modal para parada intermedia
function closeStopModal() { /* ... */ } // Cierra modal
function saveStopModalAction() { /* ... */ } // Guarda cambios de parada intermedia
function startNewRouteAction() { /* ... */ } // Inicia una nueva ruta en blanco
function recalculateIntermediateStopTimes() { /* ... */ } // Calcula tiempos automáticos
function getCombinedStopsForDisplayAndMap() { /* ... */ } // Une start, intermediate, end para mostrar
function renderCurrentStopsList() { /* ... */ } // Actualiza la lista de paradas en la UI
function drawRouteOnMap(stops) { /* ... */ } // Dibuja polilínea y marcadores en modo edición
function clearMapElements() { /* ... */ } // Limpia marcadores, polilínea y geofences

// --- GUARDAR/CARGAR/BORRAR RUTAS ---
function saveRouteAction() { /* ... */ } // Guarda la ruta actual (currentTempRoute)
function saveRoutesToLocalStorage() { /* ... */ } // Persiste allSavedRoutes
function loadRoutesFromLocalStorage() { /* ... */ } // Carga allSavedRoutes al iniciar
function populateSavedRoutesSelect() { /* ... */ } // Rellena el dropdown de rutas guardadas
function loadRouteForEditingAction() { /* ... */ } // Carga una ruta guardada en currentTempRoute para editar
function deleteSelectedRouteAction() { /* ... */ } // Elimina la ruta seleccionada

// --- GESTIÓN DE COLA DE SEGUIMIENTO ---
function addToTrackingQueueAction() { /* ... */ } // Añade ruta seleccionada (y la aplana) a trackingQueue
function clearTrackingQueueAction() { /* ... */ } // Limpia trackingQueue
function renderTrackingQueue() { /* ... */ } // Muestra la cola en la UI

// --- LÓGICA DE SEGUIMIENTO ---

/** Inicia el modo de seguimiento con las rutas en cola. */
function startTrackingAction() {
    if (isTracking) { alert("Seguimiento activo."); return; }
    if (trackingQueue.length === 0) { alert("Añade rutas a la cola."); return; }
    if (!lastKnownPosition) { alert("Esperando GPS..."); return; }

    isTracking = true;
    currentTrackingRouteIndex = 0;
    currentTrackingStopIndex = -1; // Estado inicial: ANTES de salir de la primera parada

    const currentRoute = trackingQueue[currentTrackingRouteIndex];
    document.getElementById('current-route-info').textContent = currentRoute.name;
    clearMapElements(); // Limpiar mapa antes de dibujar la ruta activa
    drawTrackingRouteOnMap(currentRoute.stops); // Dibuja ruta activa Y geofences

    // Sincronización inicial y display: calculateTimeDifference lo hará en el primer ciclo
    updateNextStopDisplay(); // Mostrar "Salida de..."

    updateTrackingButtonsState(); // Deshabilitar/habilitar botones correspondientes
    updateManualControlsState(); // Deshabilitar botones manuales si aplica

    if (trackingInterval) clearInterval(trackingInterval);
    // Intervalo principal que llama a la lógica central
    trackingInterval = setInterval(calculateTimeDifference, UPDATE_INTERVAL_MS);

    updatePassengerTrackingStatus(true); // Informar a pasajeros que se inició
    alert("Seguimiento iniciado.");
}

/** Dibuja la ruta activa, marcadores y geofences en modo seguimiento. */
function drawTrackingRouteOnMap(stops) {
    clearMapElements(); const lls = []; if (stops.length === 0) return;
    stops.forEach((s, i) => { let icon, pop = `<b>${s.name || `Punto ${i + 1}`}</b><br>`; if (s.type === 'start') { icon = createStopIcon('I', 'start'); pop += `Salida: ${s.departureTime || '--:--'}`; } else if (s.type === 'end') { icon = createStopIcon('F', 'end'); pop += `Llegada: ${s.arrivalTime || '--:--'}`; } else { icon = createStopIcon(i, 'intermediate'); pop += `Paso: ${s.arrivalTime || '--:--'}`; } const m = L.marker([s.lat, s.lng], { icon }).addTo(map); m.bindPopup(pop); stopMarkers.push(m); lls.push([s.lat, s.lng]); });
    if (lls.length > 1) { routePolyline = L.polyline(lls, { color: 'green', weight: 5 }).addTo(map); try {const startLL = L.latLng(stops[0].lat, stops[0].lng); startPointGeofenceCircle = L.circle(startLL, { radius: GEOFENCE_RADIUS_METERS, color: 'blue', fillOpacity: 0.1, weight: 1 }).addTo(map); const endLL = L.latLng(stops[stops.length - 1].lat, stops[stops.length - 1].lng); endPointGeofenceCircle = L.circle(endLL, { radius: GEOFENCE_RADIUS_METERS, color: 'red', fillOpacity: 0.1, weight: 1 }).addTo(map);} catch (e) { console.error("Error drawing geofences:", e)}}
}

/** Detiene el modo de seguimiento. */
function stopTrackingAction() {
    if (!isTracking) return; isTracking = false; if (trackingInterval) clearInterval(trackingInterval); trackingInterval = null;
    currentTrackingRouteIndex = -1; currentTrackingStopIndex = -1; lastCalculatedDiffMillis = 0;
    document.getElementById('time-difference-display').textContent = "--:--"; document.getElementById('time-difference-display').className = "";
    document.getElementById('next-stop-info').textContent = "Ninguna"; document.getElementById('current-route-info').textContent = "Ninguna";
    updateTrackingButtonsState(); updateManualControlsState(); updatePassengerTrackingStatus(false);
    clearMapElements(); // Limpiar mapa
    renderCurrentStopsList(); // Volver a mostrar ruta en edición (si había)
    alert("Seguimiento detenido.");
}

/** Actualiza el estado habilitado/deshabilitado de los botones principales. */
function updateTrackingButtonsState() { /* ... (sin cambios) ... */ }

/** Actualiza el estado de los botones de control manual (Prev/Next). */
function updateManualControlsState() {
    const manualCheckbox = document.getElementById('manual-mode-checkbox');
    const prevBtn = document.getElementById('prev-stop-btn');
    const nextBtn = document.getElementById('next-stop-btn');
    const isManual = manualCheckbox.checked;
    prevBtn.disabled = !(isTracking && isManual);
    nextBtn.disabled = !(isTracking && isManual);
}

/** Maneja la transición a la siguiente ruta en la cola. */
function transitionToNextRoute() {
    if (!isTracking) return false;
    console.log(`SmartMovePro: Transicionando desde ruta índice ${currentTrackingRouteIndex}`);
    if (currentTrackingRouteIndex + 1 < trackingQueue.length) {
        const oldRouteName = trackingQueue[currentTrackingRouteIndex].name;
        currentTrackingRouteIndex++;
        currentTrackingStopIndex = -1; // ANTES de la primera parada de la nueva ruta
        const newRouteName = trackingQueue[currentTrackingRouteIndex].name;
        const newRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
        alert(`Ruta "${oldRouteName}" completada. Iniciando "${newRouteName}".`);
        document.getElementById('current-route-info').textContent = newRouteName;
        clearMapElements();
        drawTrackingRouteOnMap(newRouteStops); // Dibuja nueva ruta y geofences
        // No llamar a findAndSetCurrentLeg, el estado -1 se maneja en calculateTimeDifference
        updateNextStopDisplay();       // Mostrar "Salida de..."
        updatePassengerTrackingStatus(true); // Informar nueva ruta a pasajeros
        // El intervalo se encargará del cálculo inicial para el estado -1
        return true; // Transición exitosa
    } else {
        alert("¡Todas las rutas completadas!");
        stopTrackingAction(); // Detener si no hay más rutas
        return false; // No hubo transición
    }
}

/** Maneja el avance manual de parada o ruta. */
function manualAdvanceStop(direction) {
    if (!isTracking || !document.getElementById('manual-mode-checkbox').checked) return;
    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    if (direction > 0) { // Avanzando
        const nextStopIndex = currentTrackingStopIndex + 1;
        if (nextStopIndex < currentRouteStops.length) { // Si hay una siguiente parada en esta ruta
            currentTrackingStopIndex++; // Avanzar el índice "desde"
        } else { // Si no hay más paradas (estaba en la última o más allá), transicionar
            if (!transitionToNextRoute()) {
                 // Si no hubo transición (última ruta), el estado ya se manejó en transitionToNextRoute/stopTrackingAction
                 return;
            };
        }
    } else { // Retrocediendo
        let newIdx = currentTrackingStopIndex - 1;
        if (newIdx >= -1) { currentTrackingStopIndex = newIdx; }
        else { if (currentTrackingRouteIndex > 0) { currentTrackingRouteIndex--; const prevStops = trackingQueue[currentTrackingRouteIndex].stops; currentTrackingStopIndex = prevStops.length - 2; document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name; drawTrackingRouteOnMap(prevStops); } else { alert("Inicio de la primera ruta."); } }
    }
    updateNextStopDisplay();    // Actualizar UI
    calculateTimeDifference(); // Recalcular tiempo para el nuevo estado INMEDIATAMENTE
}

/** Actualiza la información de la próxima parada en la UI. */
function updateNextStopDisplay() {
    const nextStopInfoElement = document.getElementById('next-stop-info');
    const timeDisplayElement = document.getElementById('time-difference-display');

    if (!isTracking || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        nextStopInfoElement.textContent = "Ninguna";
        if (!isTracking) { timeDisplayElement.textContent = "--:--"; timeDisplayElement.className = ""; }
        return;
    }
    const stops = trackingQueue[currentTrackingRouteIndex].stops;
    const nextIdx = currentTrackingStopIndex + 1; // Índice de la parada objetivo

    if (currentTrackingStopIndex === -1 && stops.length > 0) { // Estado Inicial
        const start = stops[0];
        nextStopInfoElement.textContent = `Salida de ${start.name || 'Inicio'} a las ${start.departureTime || '--:--'}`;
    } else if (nextIdx < stops.length) { // En ruta, hacia parada intermedia o final
        const next = stops[nextIdx];
        // Mostrar el número correcto de parada (asumiendo que el índice 0 es "Inicio")
        const displayStopNumber = (next.type === 'intermediate') ? `Parada ${nextIdx}` : (next.name || 'Destino');
        nextStopInfoElement.textContent = `${displayStopNumber} (Lleg. ${next.arrivalTime})`;
    } else { // Ya pasó la última parada teóricamente
        nextStopInfoElement.textContent = "Fin de ruta actual";
    }
}


/**
 * Intenta encontrar el tramo de ruta más relevante basado en la posición actual.
 * Ajusta `currentTrackingStopIndex`.
 * @returns {boolean} True si pudo encontrar un tramo razonable, false si no.
 */
function findAndSetCurrentLeg() {
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0) return false;
    const stops = trackingQueue[currentTrackingRouteIndex].stops; if (stops.length < 2) return false;
    const driverLL = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);

    // Check prioritario: ¿Está dentro del geofence de inicio?
    const startLL = L.latLng(stops[0].lat, stops[0].lng);
    if (driverLL.distanceTo(startLL) <= GEOFENCE_RADIUS_METERS) {
        if (currentTrackingStopIndex !== -1) {
            console.log("SmartMovePro: Re-sincronizando. Detectado dentro de geofence inicio. Estableciendo 'desde' a -1.");
            currentTrackingStopIndex = -1; // Forzar estado inicial
        }
        updateNextStopDisplay();
        return true; // Encontró estado válido (inicio)
    }

    // Si no está en geofence de inicio, buscar la parada más cercana adelante
    let bestNextIdx = -1; let minDist = Infinity;
    for (let i = 0; i < stops.length; i++) { // Buscar en TODAS las paradas
        const stopLL = L.latLng(stops[i].lat, stops[i].lng);
        const dist = driverLL.distanceTo(stopLL);
        if (dist < minDist) {
            minDist = dist;
            bestNextIdx = i; // Índice de la parada más cercana
        }
    }

    if (bestNextIdx !== -1) {
        // Si la parada más cercana es la 0, estamos antes o justo al inicio (ya manejado por geofence).
        // Forzar índice -1 si bestNextIdx es 0 y no se detectó antes estar fuera del geofence.
        const newFromIdx = (bestNextIdx === 0) ? -1 : bestNextIdx - 1;

        if (newFromIdx !== currentTrackingStopIndex) {
            console.log(`SmartMovePro: Re-sincronizando. Parada más cercana ${bestNextIdx}. Estableciendo 'desde' a ${newFromIdx}.`);
            currentTrackingStopIndex = newFromIdx;
        }
        updateNextStopDisplay();
        return true;
    }

    console.warn("SmartMovePro: No se pudo encontrar parada para sincronizar.");
    updateNextStopDisplay(); // Actualizar con el estado actual (puede ser incorrecto)
    return false;
}

/**
 * Función principal llamada por el intervalo. Maneja avance automático y cálculo de tiempo.
 */
function calculateTimeDifference() {
    const timeDisplayElement = document.getElementById('time-difference-display');
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        timeDisplayElement.textContent = "--:--"; timeDisplayElement.className = ""; updatePassengerTrackingStatus(isTracking); return;
    }

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    if (currentRouteStops.length < 2) { timeDisplayElement.textContent = "Error Ruta"; updatePassengerTrackingStatus(true, true, "Ruta inválida"); return; }
    const currentDriverLatLng = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);
    const manualMode = document.getElementById('manual-mode-checkbox').checked;
    const endStopIndex = currentRouteStops.length - 1;

    // --- Lógica de Avance/Transición Automática ---
    if (!manualMode) {
        // 1. Check Llegada a FIN -> Transición
        // Solo transicionar si no estamos ya en el estado final (-1 de la siguiente ruta o más allá)
        // y si estamos cerca del geofence final de la ruta *actual*.
        if (currentTrackingStopIndex < endStopIndex) { // Asegura que no transicione múltiples veces
            const endStopLatLng = L.latLng(currentRouteStops[endStopIndex].lat, currentRouteStops[endStopIndex].lng);
            if (currentDriverLatLng.distanceTo(endStopLatLng) < GEOFENCE_RADIUS_METERS) {
                console.log("SmartMovePro: Dentro de geofence final. Transicionando...");
                if (transitionToNextRoute()) return; // Salir si hubo transición
                else { timeDisplayElement.textContent = "FIN"; return; } // Salir si se detuvo
            }
        }

        // 2. Check Salida Geofence INICIO (si índice es -1)
        if (currentTrackingStopIndex === -1) {
            const startStopLatLng = L.latLng(currentRouteStops[0].lat, currentRouteStops[0].lng);
            if (currentDriverLatLng.distanceTo(startStopLatLng) > GEOFENCE_RADIUS_METERS) {
                console.log("SmartMovePro: Salió de geofence de inicio.");
                currentTrackingStopIndex = 0; // Marcar inicio del primer tramo
                updateNextStopDisplay();
                updatePassengerTrackingStatus(true); // Notificar cambio de estado
                // Continuar abajo para calcular tiempo del tramo 0 -> 1...
            }
            // Si sigue dentro, NO avanza índice. El cálculo especial se hace abajo.
        }
        // 3. Check Llegada a parada INTERMEDIA (si no estamos en el último tramo)
        else if (currentTrackingStopIndex < endStopIndex - 1) {
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
            let depDT = new Date(); const [h, m] = departureTimeStr.split(':').map(Number); depDT.setHours(h, m, 0, 0); const nowMillis = new Date().getTime();
            const diffMillis = depDT.getTime() - nowMillis; lastCalculatedDiffMillis = diffMillis; const diffMins = diffMillis / 60000;
            timeDisplayElement.textContent = formatMinutesToTimeDiff(diffMins); // Actualizar display
            if (diffMins < -0.1) timeDisplayElement.className = 'late'; else if (diffMins > 0.1) timeDisplayElement.className = 'early'; else timeDisplayElement.className = 'on-time'; // Actualizar clase
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
function updatePassengerTrackingStatus(isCurrentlyTracking, hasError = false, errorReason = "") { /* ... (Sin cambios, ya incluye info de cola) ... */ }

// --- UTILIDADES DE TIEMPO ---
function timeToMinutes(timeInput) { let h, m; if (typeof timeInput === 'string') { [h, m] = timeInput.split(':').map(Number); } else if (timeInput instanceof Date) { h = timeInput.getHours(); m = timeInput.getMinutes(); } else { return 0; } return h * 60 + m; }
function formatMinutesToTimeDiff(totalMinutesWithFraction) { const sign = totalMinutesWithFraction < 0 ? "-" : "+"; const absM = Math.abs(totalMinutesWithFraction); let mm = Math.floor(absM); let ss = Math.round((absM - mm) * 60); if (ss === 60) { mm += 1; ss = 0; } return `${sign}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; }

// --- BINDINGS INICIALES ---
function bindEventListeners() {
    // Asigna TODOS los event listeners necesarios a los elementos del DOM
    // (Modal, Creación ruta, Guardar/Cargar/Borrar, Cola, Inicio/Fin Tracking, Control Manual)
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
        if (isTracking && !event.target.checked) { // Si se DESACTIVA modo manual mientras trackea
            console.log("SmartMovePro: Modo manual desactivado. Re-sincronizando...");
            findAndSetCurrentLeg();
            // El intervalo llamará a calculateTimeDifference
        }
    });
    document.getElementById('prev-stop-btn').addEventListener('click', () => manualAdvanceStop(-1));
    document.getElementById('next-stop-btn').addEventListener('click', () => manualAdvanceStop(1));
}
window.addEventListener('beforeunload', () => { /* Intento opcional de limpiar estado */ });
