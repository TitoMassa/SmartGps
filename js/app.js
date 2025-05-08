// js/app.js (Para Smart Move Pro - App del Chofer)

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js') // Asumiendo que sw.js está en la raíz del sitio
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

let currentTempRoute = { name: "", stops: [] };
let allSavedRoutes = [];
let trackingQueue = [];

let isTracking = false;
let currentTrackingRouteIndex = -1;
let currentTrackingStopIndex = -1; // Índice de la parada DESDE la que se partió
let trackingInterval;
let lastKnownPosition = null;
let lastCalculatedDiffMillis = 0; // Para almacenar la última diferencia calculada

const PROXIMITY_THRESHOLD_METERS = 50;

// Iconos Leaflet
const currentLocationIcon = L.divIcon({
    className: 'current-location-icon',
    html: '',
    iconSize: [12, 12],
    iconAnchor: [6, 6]
});

function createStopIcon(number) {
    return L.divIcon({
        className: 'stop-marker-icon',
        html: `<div class="stop-marker-icon-content">${number}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
}

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadRoutesFromLocalStorage();
    populateSavedRoutesSelect();
    bindEventListeners();
    updateTrackingButtonsState();
    updateManualControlsState();
    // Inicializar el estado de seguimiento para pasajeros como "no rastreando"
    updatePassengerTrackingStatus(false);
});

function initMap() {
    map = L.map('map').setView([-34.6037, -58.3816], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    map.on('click', onMapClick);
    startGeolocation();
}

function startGeolocation() {
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(updateCurrentPosition, handleLocationError, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        });
    } else {
        alert("Geolocalización no es soportada por este navegador.");
    }
}

// --- MANEJO DE POSICIÓN ---
function updateCurrentPosition(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    lastKnownPosition = { lat, lng };

    if (!currentPositionMarker) {
        currentPositionMarker = L.marker([lat, lng], { icon: currentLocationIcon }).addTo(map);
        map.setView([lat, lng], 16);
    } else {
        currentPositionMarker.setLatLng([lat, lng]);
    }

    if (isTracking && !trackingInterval) {
        calculateTimeDifference();
    }
}

function handleLocationError(error) {
    console.warn(`SmartMovePro: ERROR(${error.code}): ${error.message}`);
}

// --- LÓGICA DE RUTAS Y PARADAS ---
function onMapClick(e) {
    if (isTracking) {
        alert("Detén el seguimiento para modificar la ruta.");
        return;
    }
    document.getElementById('stop-lat-input').value = e.latlng.lat;
    document.getElementById('stop-lng-input').value = e.latlng.lng;
    document.getElementById('stop-index-input').value = "";
    document.getElementById('modal-title').textContent = "Añadir Parada";
    document.getElementById('arrival-time-input').value = "";
    document.getElementById('departure-time-input').value = "";
    openStopModal();
}

function openStopModal() {
    document.getElementById('stop-modal').style.display = 'block';
}

function closeStopModal() {
    document.getElementById('stop-modal').style.display = 'none';
}

function saveStopModalAction() {
    const lat = parseFloat(document.getElementById('stop-lat-input').value);
    const lng = parseFloat(document.getElementById('stop-lng-input').value);
    const arrivalTime = document.getElementById('arrival-time-input').value;
    const departureTime = document.getElementById('departure-time-input').value;
    const stopIndex = document.getElementById('stop-index-input').value;

    if (!arrivalTime || !departureTime) {
        alert("Por favor, ingresa hora de llegada y salida.");
        return;
    }

    const arrivalMinutes = timeToMinutes(arrivalTime);
    const departureMinutes = timeToMinutes(departureTime);

    if (departureMinutes < arrivalMinutes) {
        alert("La hora de salida de una parada no puede ser anterior a su hora de llegada.");
        return;
    }

    const stopData = { lat, lng, arrivalTime, departureTime };

    if (stopIndex === "") {
        currentTempRoute.stops.push(stopData);
    } else {
        currentTempRoute.stops[parseInt(stopIndex)] = stopData;
    }
    renderCurrentStopsList();
    drawRouteOnMap(currentTempRoute.stops);
    closeStopModal();
}

function startNewRouteAction() {
    if (isTracking) {
        alert("Detén el seguimiento para iniciar una nueva ruta.");
        return;
    }
    const routeNameInput = document.getElementById('route-name-input');
    currentTempRoute = { name: routeNameInput.value.trim() || "Ruta Sin Nombre", stops: [] };
    renderCurrentStopsList();
    clearMapStopMarkersAndPolyline();
    alert("Nueva ruta iniciada. Añade paradas tocando el mapa o edita una existente.");
}

function renderCurrentStopsList() {
    const listElement = document.getElementById('current-stops-list');
    listElement.innerHTML = '';
    currentTempRoute.stops.forEach((stop, index) => {
        const listItem = document.createElement('li');
        listItem.innerHTML = `
            <div class="stop-info">
                <strong>Parada ${index + 1}:</strong> 
                Lleg: ${stop.arrivalTime}, Sal: ${stop.departureTime} <br>
                <small>(${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)})</small>
            </div>
            <div class="stop-actions">
                <button data-action="edit" data-index="${index}">Editar</button>
                <button data-action="remove" data-index="${index}" class="danger">Eliminar</button>
                ${index > 0 ? `<button data-action="move-up" data-index="${index}">Subir</button>` : ''}
                ${index < currentTempRoute.stops.length - 1 ? `<button data-action="move-down" data-index="${index}">Bajar</button>` : ''}
            </div>
        `;
        listElement.appendChild(listItem);
    });
    drawRouteOnMap(currentTempRoute.stops);
}

document.getElementById('current-stops-list').addEventListener('click', (event) => {
    const target = event.target;
    if (target.tagName === 'BUTTON') {
        const action = target.dataset.action;
        const index = parseInt(target.dataset.index);
        if (action === 'edit') editStop(index);
        else if (action === 'remove') removeStop(index);
        else if (action === 'move-up') moveStopUp(index);
        else if (action === 'move-down') moveStopDown(index);
    }
});

function editStop(index) {
    if (isTracking) {
        alert("Detén el seguimiento para editar paradas.");
        return;
    }
    const stop = currentTempRoute.stops[index];
    document.getElementById('stop-lat-input').value = stop.lat;
    document.getElementById('stop-lng-input').value = stop.lng;
    document.getElementById('arrival-time-input').value = stop.arrivalTime;
    document.getElementById('departure-time-input').value = stop.departureTime;
    document.getElementById('stop-index-input').value = index;
    document.getElementById('modal-title').textContent = `Editar Parada ${index + 1}`;
    openStopModal();
}

function removeStop(index) {
    if (isTracking) {
        alert("Detén el seguimiento para eliminar paradas.");
        return;
    }
    currentTempRoute.stops.splice(index, 1);
    renderCurrentStopsList();
}

function moveStopUp(index) {
    if (isTracking || index === 0) return;
    [currentTempRoute.stops[index], currentTempRoute.stops[index - 1]] = [currentTempRoute.stops[index - 1], currentTempRoute.stops[index]];
    renderCurrentStopsList();
}

function moveStopDown(index) {
    if (isTracking || index === currentTempRoute.stops.length - 1) return;
    [currentTempRoute.stops[index], currentTempRoute.stops[index + 1]] = [currentTempRoute.stops[index + 1], currentTempRoute.stops[index]];
    renderCurrentStopsList();
}

function drawRouteOnMap(stops) {
    clearMapStopMarkersAndPolyline();
    const latLngs = [];
    stops.forEach((stop, index) => {
        const marker = L.marker([stop.lat, stop.lng], { icon: createStopIcon(index + 1) }).addTo(map);
        marker.bindPopup(`<b>Parada ${index + 1}</b><br>Llegada: ${stop.arrivalTime}<br>Salida: ${stop.departureTime}`);
        stopMarkers.push(marker);
        latLngs.push([stop.lat, stop.lng]);
    });

    if (latLngs.length > 1) {
        routePolyline = L.polyline(latLngs, { color: 'blue' }).addTo(map);
    }
}

function clearMapStopMarkersAndPolyline() {
    stopMarkers.forEach(marker => map.removeLayer(marker));
    stopMarkers = [];
    if (routePolyline) {
        map.removeLayer(routePolyline);
        routePolyline = null;
    }
}

// --- GUARDAR Y CARGAR RUTAS ---
function saveRouteAction() {
    if (isTracking) {
        alert("Detén el seguimiento para guardar la ruta.");
        return;
    }
    if (!currentTempRoute.name && currentTempRoute.stops.length >= 2) {
        let routeNameFromInput = document.getElementById('route-name-input').value.trim();
        if (!routeNameFromInput) {
            const newName = prompt("Ingresa un nombre para esta ruta:", "Ruta Guardada");
            if (!newName) return;
            currentTempRoute.name = newName;
            document.getElementById('route-name-input').value = newName;
        } else {
            currentTempRoute.name = routeNameFromInput;
        }
    } else if (!currentTempRoute.name && currentTempRoute.stops.length < 2) {
        alert("La ruta debe tener un nombre y al menos 2 paradas.");
        return;
    } else if (!currentTempRoute.name) {
        let routeNameFromInput = document.getElementById('route-name-input').value.trim();
        if (!routeNameFromInput) {
            alert("Por favor, asigna un nombre a la ruta.");
            return;
        }
        currentTempRoute.name = routeNameFromInput;
    }

    if (currentTempRoute.stops.length < 2) {
        alert("La ruta debe tener al menos 2 paradas para ser guardada.");
        return;
    }

    const existingRouteIndex = allSavedRoutes.findIndex(r => r.name === currentTempRoute.name);
    if (existingRouteIndex > -1) {
        if (confirm(`Ya existe una ruta llamada "${currentTempRoute.name}". ¿Deseas sobrescribirla?`)) {
            allSavedRoutes[existingRouteIndex] = JSON.parse(JSON.stringify(currentTempRoute));
        } else {
            return;
        }
    } else {
        allSavedRoutes.push(JSON.parse(JSON.stringify(currentTempRoute)));
    }

    saveRoutesToLocalStorage();
    populateSavedRoutesSelect();
    alert(`Ruta "${currentTempRoute.name}" guardada.`);
}

function saveRoutesToLocalStorage() {
    localStorage.setItem('smartMoveProRoutes', JSON.stringify(allSavedRoutes));
}

function loadRoutesFromLocalStorage() {
    const saved = localStorage.getItem('smartMoveProRoutes');
    if (saved) {
        allSavedRoutes = JSON.parse(saved);
    }
}

function populateSavedRoutesSelect() {
    const select = document.getElementById('saved-routes-select');
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Selecciona una ruta --</option>';
    allSavedRoutes.forEach((route, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = route.name;
        select.appendChild(option);
    });
    if (allSavedRoutes[parseInt(currentVal)]) {
        select.value = currentVal;
    } else {
        select.value = "";
    }
}

function loadRouteForEditingAction() {
    if (isTracking) {
        alert("Detén el seguimiento para cargar una ruta para edición.");
        return;
    }
    const selectedIndex = document.getElementById('saved-routes-select').value;
    if (selectedIndex === "") {
        alert("Por favor, selecciona una ruta para cargar.");
        return;
    }
    currentTempRoute = JSON.parse(JSON.stringify(allSavedRoutes[parseInt(selectedIndex)]));
    document.getElementById('route-name-input').value = currentTempRoute.name;
    renderCurrentStopsList();
    alert(`Ruta "${currentTempRoute.name}" cargada para edición.`);
}

function deleteSelectedRouteAction() {
    if (isTracking) {
        alert("Detén el seguimiento para eliminar rutas.");
        return;
    }
    const selectElement = document.getElementById('saved-routes-select');
    const selectedIndex = selectElement.value;

    if (selectedIndex === "") {
        alert("Por favor, selecciona una ruta para eliminar.");
        return;
    }

    const routeNameToDelete = allSavedRoutes[parseInt(selectedIndex)].name;
    if (confirm(`¿Estás seguro de que deseas eliminar la ruta "${routeNameToDelete}"? Esta acción no se puede deshacer.`)) {
        allSavedRoutes.splice(parseInt(selectedIndex), 1);
        saveRoutesToLocalStorage();
        populateSavedRoutesSelect();

        if (currentTempRoute.name === routeNameToDelete) {
            document.getElementById('route-name-input').value = "";
            currentTempRoute = { name: "", stops: [] };
            renderCurrentStopsList();
        }
        alert(`Ruta "${routeNameToDelete}" eliminada.`);
    }
}

// --- GESTIÓN DE COLA DE SEGUIMIENTO ---
function addToTrackingQueueAction() {
    const selectedIndex = document.getElementById('saved-routes-select').value;
    if (selectedIndex === "") {
        alert("Por favor, selecciona una ruta para añadir a la cola.");
        return;
    }
    const routeToAdd = JSON.parse(JSON.stringify(allSavedRoutes[parseInt(selectedIndex)]));
    trackingQueue.push(routeToAdd);
    renderTrackingQueue();
}

function clearTrackingQueueAction() {
    trackingQueue = [];
    renderTrackingQueue();
}

function renderTrackingQueue() {
    const listElement = document.getElementById('tracking-queue-list');
    listElement.innerHTML = '';
    trackingQueue.forEach((route, index) => {
        const listItem = document.createElement('li');
        listItem.textContent = `${index + 1}. ${route.name} (${route.stops.length} paradas)`;
        listElement.appendChild(listItem);
    });
}

// --- LÓGICA DE SEGUIMIENTO ---
function startTrackingAction() {
    if (isTracking) {
        alert("El seguimiento ya está activo.");
        return;
    }
    if (trackingQueue.length === 0) {
        alert("Añade al menos una ruta a la cola de seguimiento.");
        return;
    }
    if (!lastKnownPosition) {
        alert("Esperando ubicación GPS...");
        return;
    }

    isTracking = true;
    currentTrackingRouteIndex = 0;
    currentTrackingStopIndex = -1;

    document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;

    clearMapStopMarkersAndPolyline();
    drawRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);

    advanceToNextLogicalStop();
    updateTrackingButtonsState();
    updateManualControlsState();

    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(() => {
        calculateTimeDifference(); // Esto ahora también llamará a updatePassengerTrackingStatus
    }, 1000);

    updatePassengerTrackingStatus(true); // Marcar como rastreando para pasajeros
    alert("Seguimiento iniciado.");
}

function stopTrackingAction() {
    if (!isTracking) return;
    isTracking = false;
    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = null;
    currentTrackingRouteIndex = -1;
    currentTrackingStopIndex = -1;
    lastCalculatedDiffMillis = 0; // Resetear
    document.getElementById('time-difference-display').textContent = "--:--";
    document.getElementById('time-difference-display').className = "";
    document.getElementById('next-stop-info').textContent = "Ninguna";
    document.getElementById('current-route-info').textContent = "Ninguna";
    updateTrackingButtonsState();
    updateManualControlsState();
    updatePassengerTrackingStatus(false); // Marcar como NO rastreando para pasajeros
    alert("Seguimiento detenido.");
}

function updateTrackingButtonsState() {
    const startBtn = document.getElementById('start-tracking-btn');
    const stopBtn = document.getElementById('stop-tracking-btn');
    const routeMgmtInputsAndButtons = document.querySelectorAll(
        '#controls-panel .control-group:nth-child(2) button, #route-name-input'
    );
    const loadRouteControls = document.querySelectorAll(
        '#load-route-for-editing-btn, #delete-selected-route-btn, #add-to-tracking-queue-btn, #saved-routes-select, #clear-tracking-queue-btn'
    );

    if (isTracking) {
        startBtn.disabled = true;
        stopBtn.disabled = false;
        routeMgmtInputsAndButtons.forEach(el => el.disabled = true);
        loadRouteControls.forEach(el => el.disabled = true);
    } else {
        startBtn.disabled = false;
        stopBtn.disabled = true;
        routeMgmtInputsAndButtons.forEach(el => el.disabled = false);
        loadRouteControls.forEach(el => el.disabled = false);
    }
}

function updateManualControlsState() {
    const manualCheckbox = document.getElementById('manual-mode-checkbox');
    const prevBtn = document.getElementById('prev-stop-btn');
    const nextBtn = document.getElementById('next-stop-btn');

    if (isTracking && manualCheckbox.checked) {
        prevBtn.disabled = false;
        nextBtn.disabled = false;
    } else {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
    }
}

function manualAdvanceStop(direction) {
    if (!isTracking) return;

    const currentRoute = trackingQueue[currentTrackingRouteIndex];
    let tempProspectiveStopIndex = currentTrackingStopIndex + direction;

    if (direction > 0) {
        if (tempProspectiveStopIndex + 1 < currentRoute.stops.length) {
            currentTrackingStopIndex = tempProspectiveStopIndex;
        } else {
            currentTrackingRouteIndex++;
            if (currentTrackingRouteIndex < trackingQueue.length) {
                currentTrackingStopIndex = -1;
                document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
                drawRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
                advanceToNextLogicalStop(true);
                return;
            } else {
                alert("Has llegado al final de todas las rutas.");
                stopTrackingAction();
                return;
            }
        }
    } else {
        if (tempProspectiveStopIndex >= -1) {
            currentTrackingStopIndex = tempProspectiveStopIndex;
        } else {
            currentTrackingRouteIndex--;
            if (currentTrackingRouteIndex >= 0) {
                const prevRoute = trackingQueue[currentTrackingRouteIndex];
                currentTrackingStopIndex = prevRoute.stops.length - 2;
                document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
                drawRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
            } else {
                alert("Ya estás al inicio de la primera ruta.");
                currentTrackingRouteIndex = 0;
                currentTrackingStopIndex = -1;
                updateNextStopDisplayAndCalculateTime();
                return;
            }
        }
    }
    updateNextStopDisplayAndCalculateTime();
    calculateTimeDifference(); // Forzar recálculo y actualización para pasajeros
}

function advanceToNextLogicalStop(forceManualAdvance = false) {
    if (!isTracking) return;

    const manualMode = document.getElementById('manual-mode-checkbox').checked;
    if (!forceManualAdvance && manualMode) {
        updateNextStopDisplayAndCalculateTime();
        return;
    }

    currentTrackingStopIndex++;
    const currentRoute = trackingQueue[currentTrackingRouteIndex];

    if (currentTrackingStopIndex + 1 >= currentRoute.stops.length) {
        currentTrackingRouteIndex++;
        if (currentTrackingRouteIndex < trackingQueue.length) {
            currentTrackingStopIndex = -1;
            alert(`Ruta "${currentRoute.name}" completada. Iniciando ruta "${trackingQueue[currentTrackingRouteIndex].name}".`);
            document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
            drawRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
            advanceToNextLogicalStop(forceManualAdvance);
        } else {
            alert("¡Todas las rutas completadas!");
            stopTrackingAction(); // Esto actualizará el estado para pasajeros
        }
        return;
    }
    updateNextStopDisplayAndCalculateTime();
    calculateTimeDifference(); // Actualizar info para pasajeros al cambiar de parada
}

function updateNextStopDisplayAndCalculateTime() {
    if (!isTracking || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        document.getElementById('next-stop-info').textContent = "Ninguna";
        document.getElementById('time-difference-display').textContent = "--:--";
        return;
    }

    const currentRoute = trackingQueue[currentTrackingRouteIndex];
    const nextStopTargetIndex = currentTrackingStopIndex + 1;

    if (nextStopTargetIndex < currentRoute.stops.length) {
        const nextStop = currentRoute.stops[nextStopTargetIndex];
        document.getElementById('next-stop-info').textContent = `Parada ${nextStopTargetIndex + 1} (Lleg. ${nextStop.arrivalTime})`;
    } else {
        document.getElementById('next-stop-info').textContent = "Fin de ruta";
    }
    // calculateTimeDifference se llama en el intervalo o al cambiar de parada explícitamente
}

// --- CÁLCULO DE DIFERENCIA DE TIEMPO Y ACTUALIZACIÓN PARA PASAJEROS ---
function calculateTimeDifference() {
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        updatePassengerTrackingStatus(isTracking); // Actualizar si está offline o con datos inválidos
        return;
    }

    const currentRoute = trackingQueue[currentTrackingRouteIndex];
    const fromStopIndex = currentTrackingStopIndex;
    const toStopIndex = currentTrackingStopIndex + 1;

    if (fromStopIndex < 0 || toStopIndex >= currentRoute.stops.length) {
        if (!document.getElementById('manual-mode-checkbox').checked && fromStopIndex >= 0 && toStopIndex >= currentRoute.stops.length) {
           advanceToNextLogicalStop();
        } else if (toStopIndex >= currentRoute.stops.length) {
            document.getElementById('time-difference-display').textContent = "FIN";
            document.getElementById('time-difference-display').className = "";
        } else {
            document.getElementById('time-difference-display').textContent = "--:--";
        }
        updatePassengerTrackingStatus(true); // Podría ser fin de ruta, pero aún "tracking"
        return;
    }

    const fromStop = currentRoute.stops[fromStopIndex];
    const toStop = currentRoute.stops[toStopIndex];
    const currentPositionLatLng = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);

    const [depH, depM] = fromStop.departureTime.split(':').map(Number);
    let departureDateTime = new Date();
    departureDateTime.setHours(depH, depM, 0, 0);

    const [arrH, arrM] = toStop.arrivalTime.split(':').map(Number);
    let scheduledArrivalDateTimeAtNextStop = new Date();
    scheduledArrivalDateTimeAtNextStop.setHours(arrH, arrM, 0, 0);

    if (scheduledArrivalDateTimeAtNextStop.getTime() < departureDateTime.getTime()) {
        scheduledArrivalDateTimeAtNextStop.setDate(scheduledArrivalDateTimeAtNextStop.getDate() + 1);
    }

    const totalLegScheduledTimeMillis = scheduledArrivalDateTimeAtNextStop.getTime() - departureDateTime.getTime();
    if (totalLegScheduledTimeMillis <= 0 && !(depH === arrH && depM === arrM)) {
        console.warn("SmartMovePro: Tiempo de tramo inválido o cero.", fromStop, toStop);
        document.getElementById('time-difference-display').textContent = "Error Horario";
        updatePassengerTrackingStatus(true, true); // Marcar error para pasajeros
        return;
    }

    const coordA = L.latLng(fromStop.lat, fromStop.lng);
    const coordB = L.latLng(toStop.lat, toStop.lng);
    const totalLegDistance = coordA.distanceTo(coordB);
    const distanceFromStartOfLeg = coordA.distanceTo(currentPositionLatLng);

    let proportionOfDistanceCovered = 0;
    if (totalLegDistance > 1) {
        proportionOfDistanceCovered = distanceFromStartOfLeg / totalLegDistance;
        proportionOfDistanceCovered = Math.max(0, Math.min(1, proportionOfDistanceCovered));
    } else if (distanceFromStartOfLeg > 1) {
        proportionOfDistanceCovered = 1;
    }

    const scheduledTimeAtCurrentPositionMillis = departureDateTime.getTime() + (proportionOfDistanceCovered * totalLegScheduledTimeMillis);
    const currentTimeMillis = new Date().getTime();
    lastCalculatedDiffMillis = scheduledTimeAtCurrentPositionMillis - currentTimeMillis; // Guardar para pasajeros

    const diffInTotalMinutes = lastCalculatedDiffMillis / (1000 * 60);

    document.getElementById('time-difference-display').textContent = formatMinutesToTimeDiff(diffInTotalMinutes);
    const displayElement = document.getElementById('time-difference-display');

    if (diffInTotalMinutes < -0.1) {
        displayElement.className = 'late';
    } else if (diffInTotalMinutes > 0.1) {
        displayElement.className = 'early';
    } else {
        displayElement.className = 'on-time';
    }

    updatePassengerTrackingStatus(true); // Actualizar estado para pasajeros con los nuevos datos

    const distanceToNextStopTarget = currentPositionLatLng.distanceTo(coordB);
    if (!document.getElementById('manual-mode-checkbox').checked && distanceToNextStopTarget < PROXIMITY_THRESHOLD_METERS) {
        const isLastStopOfLastRoute = (currentTrackingRouteIndex === trackingQueue.length - 1) &&
                                      (toStopIndex === currentRoute.stops.length - 1);
        if (!isLastStopOfLastRoute) {
            advanceToNextLogicalStop(); // Esto también llamará a calculateTimeDifference y updatePassengerTrackingStatus
        } else if (distanceToNextStopTarget < PROXIMITY_THRESHOLD_METERS / 2) {
            document.getElementById('time-difference-display').textContent = "FIN";
            document.getElementById('time-difference-display').className = "";
            // El estado para pasajeros se actualizará en la próxima llamada o si se detiene el seguimiento.
        }
    }
}

// --- FUNCIÓN PARA ACTUALIZAR DATOS PARA PASAJEROS ---
function updatePassengerTrackingStatus(isCurrentlyTracking, hasError = false) {
    let statusPayload;

    if (!isCurrentlyTracking || hasError) {
        statusPayload = {
            isTracking: false,
            hasError: hasError,
            lastUpdateTime: new Date().getTime()
        };
    } else {
        // Asegurarse de que tenemos datos válidos para enviar
        if (currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length ||
            currentTrackingStopIndex < -1) { // currentTrackingStopIndex puede ser -1 (antes de la primera parada)
            statusPayload = { isTracking: false, lastUpdateTime: new Date().getTime(), reason: "Invalid tracking indices" };
        } else {
            const currentRoute = trackingQueue[currentTrackingRouteIndex];
            let nextStopDataForPassenger = null;
            let nextBusStopArrivalTime = null;
            let nextBusStopDepartureTime = null;

            if (currentTrackingStopIndex + 1 < currentRoute.stops.length) {
                 nextStopDataForPassenger = currentRoute.stops[currentTrackingStopIndex + 1];
                 nextBusStopArrivalTime = nextStopDataForPassenger.arrivalTime;
                 nextBusStopDepartureTime = nextStopDataForPassenger.departureTime;
            }

            statusPayload = {
                isTracking: true,
                hasError: false,
                routeName: currentRoute.name,
                currentStopIndexFromWhichDeparted: currentTrackingStopIndex, // Parada de la que salió el chofer
                nextStopIndexTowardsWhichHeading: currentTrackingStopIndex + 1, // Parada a la que se dirige
                currentBusDelayOrAheadMillis: lastCalculatedDiffMillis, // La diferencia de tiempo actual del chofer
                lastKnownPosition: lastKnownPosition, // {lat, lng} - Aunque "Cuando Llega" no lo use en mapa, podría ser útil para otros cálculos
                lastUpdateTime: new Date().getTime(),
                // Info de la próxima parada del bus para referencia
                nextBusStopArrivalTime: nextBusStopArrivalTime,
                nextBusStopDepartureTime: nextBusStopDepartureTime,
            };
        }
    }
    try {
        localStorage.setItem('smartMoveProTrackingStatus', JSON.stringify(statusPayload));
    } catch (e) {
        console.error("SmartMovePro: Error saving tracking status to localStorage", e);
    }
}


// --- UTILIDADES DE TIEMPO ---
function timeToMinutes(timeInput) {
    let hours, minutes;
    if (typeof timeInput === 'string') {
        [hours, minutes] = timeInput.split(':').map(Number);
    } else if (timeInput instanceof Date) {
        hours = timeInput.getHours();
        minutes = timeInput.getMinutes();
    } else {
        return 0;
    }
    return hours * 60 + minutes;
}

function formatMinutesToTimeDiff(totalMinutesWithFraction) {
    const sign = totalMinutesWithFraction < 0 ? "-" : "+";
    const absTotalMinutes = Math.abs(totalMinutesWithFraction);
    let mm = Math.floor(absTotalMinutes);
    let ss = Math.round((absTotalMinutes - mm) * 60);

    if (ss === 60) {
        mm += 1;
        ss = 0;
    }
    return `${sign}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// --- BINDINGS INICIALES ---
function bindEventListeners() {
    document.getElementById('save-stop-btn').addEventListener('click', saveStopModalAction);
    document.getElementById('cancel-stop-btn').addEventListener('click', closeStopModal);
    document.getElementById('start-new-route-btn').addEventListener('click', startNewRouteAction);
    document.getElementById('save-route-btn').addEventListener('click', saveRouteAction);
    document.getElementById('load-route-for-editing-btn').addEventListener('click', loadRouteForEditingAction);
    document.getElementById('delete-selected-route-btn').addEventListener('click', deleteSelectedRouteAction);
    document.getElementById('add-to-tracking-queue-btn').addEventListener('click', addToTrackingQueueAction);
    document.getElementById('clear-tracking-queue-btn').addEventListener('click', clearTrackingQueueAction);
    document.getElementById('start-tracking-btn').addEventListener('click', startTrackingAction);
    document.getElementById('stop-tracking-btn').addEventListener('click', stopTrackingAction);
    document.getElementById('manual-mode-checkbox').addEventListener('change', updateManualControlsState);
    document.getElementById('prev-stop-btn').addEventListener('click', () => manualAdvanceStop(-1));
    document.getElementById('next-stop-btn').addEventListener('click', () => manualAdvanceStop(1));
}

// Asegurarse de que el estado de los pasajeros se limpie si el chofer cierra la pestaña bruscamente
window.addEventListener('beforeunload', () => {
    // Esta es una "mejor intento", no garantizado que se ejecute completamente
    // Especialmente si es un cierre forzado.
    if (isTracking) {
         console.log("SmartMovePro: Attempting to set offline status for passengers before unload.");
         // No podemos hacer mucho aquí si el navegador cierra la app del chofer.
         // La app de pasajeros dependerá del 'lastUpdateTime' para determinar si los datos son frescos.
    }
});
