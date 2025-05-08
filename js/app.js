// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js') // Ruta al archivo sw.js
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(error => {
                console.log('ServiceWorker registration failed: ', error);
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
let currentTrackingStopIndex = -1;
let trackingInterval;
let lastKnownPosition = null;

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
});

function initMap() {
    map = L.map('map').setView([-34.6037, -58.3816], 13); // Buenos Aires como default
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

    if (isTracking && !trackingInterval) { // Si el intervalo se detuvo por alguna razón
        calculateTimeDifference();
    }
}

function handleLocationError(error) {
    console.warn(`ERROR(${error.code}): ${error.message}`);
    // Podrías mostrar un mensaje al usuario aquí
}

// --- LÓGICA DE RUTAS Y PARADAS ---
function onMapClick(e) {
    if (isTracking) {
        alert("Detén el seguimiento para modificar la ruta.");
        return;
    }
    document.getElementById('stop-lat-input').value = e.latlng.lat;
    document.getElementById('stop-lng-input').value = e.latlng.lng;
    document.getElementById('stop-index-input').value = ""; // Nueva parada
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

    if (stopIndex === "") { // Nueva parada
        currentTempRoute.stops.push(stopData);
    } else { // Editando parada
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
    // No limpiar routeNameInput.value aquí, el usuario podría querer usarlo
    renderCurrentStopsList();
    clearMapStopMarkersAndPolyline();
    alert("Nueva ruta iniciada. Añade paradas tocando el mapa o edita una existente.");
}

function renderCurrentStopsList() {
    const listElement = document.getElementById('current-stops-list');
    listElement.innerHTML = ''; // Limpiar lista
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

// Delegación de eventos para botones de la lista de paradas
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
    // Asignar nombre si está vacío pero hay paradas
    if (!currentTempRoute.name && currentTempRoute.stops.length >= 2) {
        let routeNameFromInput = document.getElementById('route-name-input').value.trim();
        if (!routeNameFromInput) {
            const newName = prompt("Ingresa un nombre para esta ruta:", "Ruta Guardada");
            if (!newName) return; // Usuario canceló o no ingresó nombre
            currentTempRoute.name = newName;
            document.getElementById('route-name-input').value = newName; // Actualizar en el input
        } else {
             currentTempRoute.name = routeNameFromInput;
        }
    } else if (!currentTempRoute.name && currentTempRoute.stops.length < 2) {
         alert("La ruta debe tener un nombre y al menos 2 paradas.");
         return;
    } else if (!currentTempRoute.name) { // No hay paradas y tampoco nombre en input
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
            allSavedRoutes[existingRouteIndex] = JSON.parse(JSON.stringify(currentTempRoute)); // Deep copy
        } else {
            return; // No sobrescribir
        }
    } else {
        allSavedRoutes.push(JSON.parse(JSON.stringify(currentTempRoute))); // Deep copy
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
    // Intentar restaurar la selección si aún existe el índice
    if (allSavedRoutes[parseInt(currentVal)]) {
        select.value = currentVal;
    } else {
        select.value = ""; // Si no existe, limpiar selección
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
    currentTempRoute = JSON.parse(JSON.stringify(allSavedRoutes[parseInt(selectedIndex)])); // Deep copy
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
        populateSavedRoutesSelect(); // Esto también limpiará la selección

        // Si la ruta eliminada era la que estaba en currentTempRoute
        if (currentTempRoute.name === routeNameToDelete) {
            document.getElementById('route-name-input').value = "";
            currentTempRoute = { name: "", stops: [] };
            renderCurrentStopsList(); // Limpia la lista de paradas
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
    currentTrackingStopIndex = -1; // Partimos *antes* de la primera parada de la ruta

    document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;

    clearMapStopMarkersAndPolyline(); // Limpiar marcadores de edición
    drawRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops); // Dibujar la ruta activa

    advanceToNextLogicalStop(); // Para configurar la primera parada y calcular tiempo
    updateTrackingButtonsState();
    updateManualControlsState();

    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(calculateTimeDifference, 1000); // Refresca cada segundo

    alert("Seguimiento iniciado.");
}

function stopTrackingAction() {
    if (!isTracking) return;
    isTracking = false;
    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = null;
    currentTrackingRouteIndex = -1;
    currentTrackingStopIndex = -1;
    document.getElementById('time-difference-display').textContent = "--:--";
    document.getElementById('time-difference-display').className = "";
    document.getElementById('next-stop-info').textContent = "Ninguna";
    document.getElementById('current-route-info').textContent = "Ninguna";
    updateTrackingButtonsState();
    updateManualControlsState();
    alert("Seguimiento detenido.");
}

function updateTrackingButtonsState() {
    const startBtn = document.getElementById('start-tracking-btn');
    const stopBtn = document.getElementById('stop-tracking-btn');
    // Afectar solo botones y el input de nombre de ruta, no los de tiempo en el modal
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
    let tempProspectiveStopIndex = currentTrackingStopIndex + direction; // A dónde iríamos

    if (direction > 0) { // Avanzando
        // tempProspectiveStopIndex es el índice de la parada *desde la que saldríamos*
        // tempProspectiveStopIndex + 1 es la parada *a la que llegaríamos*
        if (tempProspectiveStopIndex + 1 < currentRoute.stops.length) { // Hay una siguiente parada en esta ruta
            currentTrackingStopIndex = tempProspectiveStopIndex;
        } else { // Fin de la ruta actual, intentar pasar a la siguiente ruta
            currentTrackingRouteIndex++;
            if (currentTrackingRouteIndex < trackingQueue.length) { // Hay más rutas
                currentTrackingStopIndex = -1; // Para que apunte antes de la primera parada de la nueva ruta
                document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
                drawRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
                advanceToNextLogicalStop(true); // Forzar avance lógico para la nueva ruta
                return;
            } else { // Fin de todas las rutas
                alert("Has llegado al final de todas las rutas.");
                stopTrackingAction();
                return;
            }
        }
    } else { // Retrocediendo
        // tempProspectiveStopIndex es el índice de la parada desde la que saldríamos (al retroceder)
        if (tempProspectiveStopIndex >= -1) { // Aún dentro de la ruta actual o al inicio conceptual
            currentTrackingStopIndex = tempProspectiveStopIndex;
        } else { // Intentar retroceder a la ruta anterior
            currentTrackingRouteIndex--;
            if (currentTrackingRouteIndex >= 0) { // Hay ruta anterior
                const prevRoute = trackingQueue[currentTrackingRouteIndex];
                // Queremos que la *próxima* parada sea la última de la ruta anterior.
                // Entonces, la parada *desde la que salimos* debe ser la penúltima.
                currentTrackingStopIndex = prevRoute.stops.length - 2;
                document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
                drawRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
            } else { // Inicio de la primera ruta
                alert("Ya estás al inicio de la primera ruta.");
                currentTrackingRouteIndex = 0; // No ir a -1
                currentTrackingStopIndex = -1; // Mantener en el inicio conceptual
                // No hacer nada más, ya está en el límite
                updateNextStopDisplayAndCalculateTime(); // Para recalcular/limpiar display
                return;
            }
        }
    }
    updateNextStopDisplayAndCalculateTime();
}


function advanceToNextLogicalStop(forceManualAdvance = false) {
    if (!isTracking) return;

    const manualMode = document.getElementById('manual-mode-checkbox').checked;
    if (!forceManualAdvance && manualMode) {
        updateNextStopDisplayAndCalculateTime(); // Solo recalcular para la parada actual
        return;
    }

    currentTrackingStopIndex++; // Avanzamos "desde" la siguiente parada
    const currentRoute = trackingQueue[currentTrackingRouteIndex];

    // Si `currentTrackingStopIndex + 1` es la última parada o más, hemos completado el último tramo.
    if (currentTrackingStopIndex + 1 >= currentRoute.stops.length) {
        currentTrackingRouteIndex++; // Intentar pasar a la siguiente ruta
        if (currentTrackingRouteIndex < trackingQueue.length) { // Hay más rutas
            currentTrackingStopIndex = -1; // Reiniciar índice de parada para la nueva ruta
            alert(`Ruta "${currentRoute.name}" completada. Iniciando ruta "${trackingQueue[currentTrackingRouteIndex].name}".`);
            document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
            drawRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
            advanceToNextLogicalStop(forceManualAdvance); // Llamada recursiva para la nueva ruta
        } else {
            alert("¡Todas las rutas completadas!");
            stopTrackingAction();
        }
        return; // Salir porque ya se manejó el cambio de ruta o fin
    }
    // Si llegamos aquí, seguimos en la misma ruta, o es la primera parada de una nueva ruta
    updateNextStopDisplayAndCalculateTime();
}

function updateNextStopDisplayAndCalculateTime() {
    if (!isTracking || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        document.getElementById('next-stop-info').textContent = "Ninguna";
        document.getElementById('time-difference-display').textContent = "--:--";
        return;
    }

    const currentRoute = trackingQueue[currentTrackingRouteIndex];
    // La parada "desde" es currentTrackingStopIndex (si >=0), la parada "hacia" es currentTrackingStopIndex + 1
    const nextStopTargetIndex = currentTrackingStopIndex + 1;

    if (nextStopTargetIndex < currentRoute.stops.length) {
        const nextStop = currentRoute.stops[nextStopTargetIndex];
        document.getElementById('next-stop-info').textContent = `Parada ${nextStopTargetIndex + 1} (Lleg. ${nextStop.arrivalTime})`;
    } else {
        // Esto sucedería si estamos en la última parada y no hay "siguiente"
        document.getElementById('next-stop-info').textContent = "Fin de ruta";
    }
    calculateTimeDifference(); // Calcular inmediatamente
}


// --- CÁLCULO DE DIFERENCIA DE TIEMPO ---
function calculateTimeDifference() {
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        return;
    }

    const currentRoute = trackingQueue[currentTrackingRouteIndex];
    const fromStopIndex = currentTrackingStopIndex;
    const toStopIndex = currentTrackingStopIndex + 1;

    // Validar que tenemos un tramo válido
    if (fromStopIndex < 0 || toStopIndex >= currentRoute.stops.length) {
        // Si estamos antes de la primera parada (fromStopIndex = -1), no hay tramo "desde".
        // Si toStopIndex está fuera de rango, ya pasamos la última parada del tramo.
        if (!document.getElementById('manual-mode-checkbox').checked && fromStopIndex >= 0 && toStopIndex >= currentRoute.stops.length) {
            // Si hemos "llegado" a la última parada y no es modo manual, intentar avanzar.
           advanceToNextLogicalStop();
        } else if (toStopIndex >= currentRoute.stops.length) {
            document.getElementById('time-difference-display').textContent = "FIN";
            document.getElementById('time-difference-display').className = "";
        } else {
             // Caso: fromStopIndex = -1 (antes de la primera parada real)
             // Podríamos mostrar un ETA a la primera parada, pero no es el cálculo de +/-
            document.getElementById('time-difference-display').textContent = "--:--";
        }
        return;
    }

    const fromStop = currentRoute.stops[fromStopIndex];
    const toStop = currentRoute.stops[toStopIndex];
    const currentPositionLatLng = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);

    // 1. Convertir horarios de parada a objetos Date para cálculos con timestamps
    const [depH, depM] = fromStop.departureTime.split(':').map(Number);
    let departureDateTime = new Date(); // Usar fecha actual como base
    departureDateTime.setHours(depH, depM, 0, 0);

    const [arrH, arrM] = toStop.arrivalTime.split(':').map(Number);
    let scheduledArrivalDateTimeAtNextStop = new Date(); // Usar fecha actual como base
    scheduledArrivalDateTimeAtNextStop.setHours(arrH, arrM, 0, 0);

    // 2. Ajustar fecha de llegada si cruza medianoche
    if (scheduledArrivalDateTimeAtNextStop.getTime() < departureDateTime.getTime()) {
        scheduledArrivalDateTimeAtNextStop.setDate(scheduledArrivalDateTimeAtNextStop.getDate() + 1);
    }

    // 3. Calcular duración total programada del tramo en milisegundos
    const totalLegScheduledTimeMillis = scheduledArrivalDateTimeAtNextStop.getTime() - departureDateTime.getTime();
    if (totalLegScheduledTimeMillis <= 0 && !(depH === arrH && depM === arrM)) { // Si el tiempo es 0 o negativo y no es una parada de espera
        console.warn("Tiempo de tramo inválido o cero entre paradas. Revise horarios.", fromStop, toStop);
        document.getElementById('time-difference-display').textContent = "Error Horario";
        return;
    }


    // 4. Calcular proporción de distancia cubierta
    const coordA = L.latLng(fromStop.lat, fromStop.lng);
    const coordB = L.latLng(toStop.lat, toStop.lng);
    const totalLegDistance = coordA.distanceTo(coordB);
    const distanceFromStartOfLeg = coordA.distanceTo(currentPositionLatLng);

    let proportionOfDistanceCovered = 0;
    if (totalLegDistance > 1) { // Evitar división por cero si paradas están en el mismo sitio
        proportionOfDistanceCovered = distanceFromStartOfLeg / totalLegDistance;
        proportionOfDistanceCovered = Math.max(0, Math.min(1, proportionOfDistanceCovered)); // Clamp entre 0 y 1
    } else if (distanceFromStartOfLeg > 1) { // Estamos más allá del destino o las paradas coinciden pero nos movimos
        proportionOfDistanceCovered = 1; // Considerar cubierto
    } // Si totalLegDistance es 0 y distanceFromStartOfLeg es 0, proportion es 0, está bien.


    // 5. Calcular la hora programada (timestamp) en la posición actual del chófer
    const scheduledTimeAtCurrentPositionMillis = departureDateTime.getTime() + (proportionOfDistanceCovered * totalLegScheduledTimeMillis);

    // 6. Obtener hora actual (timestamp)
    const currentTimeMillis = new Date().getTime();

    // 7. Calcular diferencia en milisegundos y luego en minutos (decimal)
    const diffInMillis = scheduledTimeAtCurrentPositionMillis - currentTimeMillis;
    const diffInTotalMinutes = diffInMillis / (1000 * 60);

    // 8. Formatear y mostrar
    document.getElementById('time-difference-display').textContent = formatMinutesToTimeDiff(diffInTotalMinutes);
    const displayElement = document.getElementById('time-difference-display');

    if (diffInTotalMinutes < -0.1) { // Atrasado (más de 6s)
        displayElement.className = 'late';
    } else if (diffInTotalMinutes > 0.1) { // Adelantado (más de 6s)
        displayElement.className = 'early';
    } else {
        displayElement.className = 'on-time';
    }

    // Comprobar proximidad para avance automático
    const distanceToNextStopTarget = currentPositionLatLng.distanceTo(coordB);
    if (!document.getElementById('manual-mode-checkbox').checked && distanceToNextStopTarget < PROXIMITY_THRESHOLD_METERS) {
        // Asegurarse de que no está ya en la última parada de la última ruta antes de avanzar.
        const isLastStopOfLastRoute = (currentTrackingRouteIndex === trackingQueue.length - 1) &&
                                      (toStopIndex === currentRoute.stops.length - 1);
        if (!isLastStopOfLastRoute) {
            advanceToNextLogicalStop();
        } else if (distanceToNextStopTarget < PROXIMITY_THRESHOLD_METERS / 2) { 
             // Si está muy cerca de la última parada de todo, podría marcar como FIN
            document.getElementById('time-difference-display').textContent = "FIN";
            document.getElementById('time-difference-display').className = "";
            // Considerar detener el seguimiento aquí si se desea.
    }
}

// Al detener el seguimiento explícitamente:
function stopTrackingAction() {
    // ... (código existente) ...
    const offlineStatus = { isTracking: false, lastUpdateTime: new Date().getTime() };
    localStorage.setItem('smartMoveProTrackingStatus', JSON.stringify(offlineStatus));
    // ... (resto del código existente) ...
}

// Es buena idea también poner el estado offline si la página del chofer se cierra o recarga
window.addEventListener('beforeunload', () => {
    if (isTracking) { // Si estaba trackeando y se cierra, otros no lo sabrán
        // Es difícil garantizar esto, pero podemos intentarlo
        const offlineStatus = { isTracking: false, reason: "Chofer app closed/reloaded", lastUpdateTime: new Date().getTime() };
        // localStorage.setItem('smartMoveProTrackingStatus', JSON.stringify(offlineStatus)); // Puede no ejecutarse siempre
        }
    }
}

// --- UTILIDADES DE TIEMPO ---
function timeToMinutes(timeInput) { // timeInput puede ser "HH:MM" o un objeto Date
    let hours, minutes;
    if (typeof timeInput === 'string') {
        [hours, minutes] = timeInput.split(':').map(Number);
    } else if (timeInput instanceof Date) {
        hours = timeInput.getHours();
        minutes = timeInput.getMinutes();
    } else { //Fallback o error
        return 0;
    }
    return hours * 60 + minutes;
}

function formatMinutesToTimeDiff(totalMinutesWithFraction) {
    const sign = totalMinutesWithFraction < 0 ? "-" : "+";
    const absTotalMinutes = Math.abs(totalMinutesWithFraction);
    let mm = Math.floor(absTotalMinutes);
    let ss = Math.round((absTotalMinutes - mm) * 60);

    if (ss === 60) { // Corregir si los segundos redondean a 60
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
