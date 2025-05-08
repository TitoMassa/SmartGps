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
let stopMarkers = []; // Array para todos los marcadores de la ruta (inicio, fin, intermedios)

// Estructura de currentTempRoute ahora será más explícita:
let currentTempRoute = {
    name: "",
    startPoint: null, // { lat, lng, name, departureTime, type: 'start' }
    endPoint: null,   // { lat, lng, name, arrivalTime, type: 'end' }
    intermediateStops: [] // [{ lat, lng, name (opcional), arrivalTime (calculado o manual), type: 'intermediate' }]
};

let allSavedRoutes = []; // Array de objetos currentTempRoute guardados
let trackingQueue = [];

let isTracking = false;
let currentTrackingRouteIndex = -1;
let currentTrackingStopIndex = -1;
let trackingInterval;
let lastKnownPosition = null;
let lastCalculatedDiffMillis = 0;

const PROXIMITY_THRESHOLD_METERS = 50;

// Estado para el proceso de creación de ruta
let settingPointType = null; // 'start', 'end', 'intermediate'

// Iconos Leaflet
const currentLocationIcon = L.divIcon({
    className: 'current-location-icon',
    html: '',
    iconSize: [12, 12],
    iconAnchor: [6, 6]
});

function createStopIcon(number, type = 'intermediate') {
    let className = 'stop-marker-icon-content';
    let content = number;
    if (type === 'start') {
        className = 'start-marker-icon-content';
        content = 'I'; // Inicio
    } else if (type === 'end') {
        className = 'end-marker-icon-content';
        content = 'F'; // Fin
    }
    return L.divIcon({
        className: 'custom-marker-icon', // Clase genérica para el contenedor del icono
        html: `<div class="${className}">${content}</div>`,
        iconSize: type === 'intermediate' ? [20, 20] : [24, 24],
        iconAnchor: type === 'intermediate' ? [10, 10] : [12, 12]
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
    updatePassengerTrackingStatus(false);
    resetRouteCreationState(); // Para asegurar que la UI de creación esté limpia
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

// --- LÓGICA DE CREACIÓN DE RUTA ---
function resetRouteCreationState() {
    currentTempRoute = { name: "", startPoint: null, endPoint: null, intermediateStops: [] };
    document.getElementById('route-name-input').value = "";
    
    document.getElementById('start-point-info').style.display = 'none';
    document.getElementById('start-time-input').value = "";
    document.getElementById('start-point-name-display').textContent = "Inicio Ruta";

    document.getElementById('end-point-info').style.display = 'none';
    document.getElementById('end-time-input').value = "";
    document.getElementById('end-point-name-display').textContent = "Fin Ruta";
    
    document.getElementById('set-start-point-btn').disabled = false;
    document.getElementById('set-end-point-btn').disabled = true; // Se activa después de fijar inicio
    
    settingPointType = null;
    renderCurrentStopsList(); // Limpia la lista visual de paradas
    clearMapStopMarkersAndPolyline();
}

document.getElementById('start-new-route-btn').addEventListener('click', () => {
    if (isTracking) {
        alert("Detén el seguimiento para iniciar una nueva ruta.");
        return;
    }
    const routeName = document.getElementById('route-name-input').value.trim();
    resetRouteCreationState();
    currentTempRoute.name = routeName || "Ruta Sin Nombre";
    document.getElementById('route-name-input').value = currentTempRoute.name; // Mostrar el nombre actual
    alert("Nueva ruta iniciada. Fija el punto de inicio.");
});

document.getElementById('set-start-point-btn').addEventListener('click', () => {
    settingPointType = 'start';
    alert("Toca el mapa para fijar el Punto de Inicio.");
});

document.getElementById('set-end-point-btn').addEventListener('click', () => {
    if (!currentTempRoute.startPoint) {
        alert("Primero debes fijar el Punto de Inicio.");
        return;
    }
    settingPointType = 'end';
    alert("Toca el mapa para fijar el Punto Final.");
});

function onMapClick(e) {
    if (isTracking) return; // No modificar ruta durante seguimiento

    if (settingPointType) { // Estamos en modo "fijar punto"
        const { lat, lng } = e.latlng;
        if (settingPointType === 'start') {
            currentTempRoute.startPoint = { 
                lat, lng, 
                name: "Inicio Ruta", 
                departureTime: document.getElementById('start-time-input').value || "", // Obtener si ya hay uno
                type: 'start' 
            };
            document.getElementById('start-point-info').style.display = 'block';
            document.getElementById('start-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`;
            document.getElementById('set-start-point-btn').disabled = true; // Ya se fijó
            document.getElementById('set-end-point-btn').disabled = false; // Activar fijar fin
            settingPointType = null; // Salir de modo fijar
            renderCurrentStopsList();
        } else if (settingPointType === 'end') {
            if (!currentTempRoute.startPoint) { // Doble check
                alert("Error: Punto de inicio no definido.");
                settingPointType = null;
                return;
            }
            currentTempRoute.endPoint = { 
                lat, lng, 
                name: "Fin Ruta", 
                arrivalTime: document.getElementById('end-time-input').value || "", // Obtener si ya hay uno
                type: 'end' 
            };
            document.getElementById('end-point-info').style.display = 'block';
            document.getElementById('end-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`;
            document.getElementById('set-end-point-btn').disabled = true; // Ya se fijó
            settingPointType = null; // Salir de modo fijar
            renderCurrentStopsList();
            recalculateIntermediateStopTimes(); // Si ya hay intermedios y se cambia el fin
        }
        settingPointType = null; // Importante resetear
    } else if (currentTempRoute.startPoint && currentTempRoute.endPoint) {
        // Añadir parada intermedia
        const { lat, lng } = e.latlng;
        const newIntermediateStop = { lat, lng, name: "", type: 'intermediate', arrivalTime: "" };
        
        // Calcular posición de inserción basada en la proximidad al segmento de ruta existente
        let insertAtIndex = currentTempRoute.intermediateStops.length; // Por defecto al final de intermedios
        if (currentTempRoute.intermediateStops.length > 0) {
            // Lógica simple: encontrar el segmento más cercano al punto clickeado e insertar allí
            // (Esto puede ser más complejo para una mejor UX de inserción)
            // Por ahora, simplemente añadimos al final de los intermedios.
        }
        currentTempRoute.intermediateStops.splice(insertAtIndex, 0, newIntermediateStop);
        
        if (document.getElementById('auto-time-intermediate-checkbox').checked) {
            recalculateIntermediateStopTimes(); // Recalcular todos los intermedios
            renderCurrentStopsList();
        } else {
            // Abrir modal para que el usuario ingrese el tiempo manualmente para esta nueva parada
            openStopModal(newIntermediateStop, insertAtIndex);
        }
    } else {
        alert("Define primero el Punto de Inicio y el Punto Final antes de añadir paradas intermedias.");
    }
}

// Renombrar puntos de inicio y fin
document.querySelectorAll('.link-button[data-point-type]').forEach(button => {
    button.addEventListener('click', (event) => {
        const pointType = event.target.dataset.pointType;
        let currentPoint = (pointType === 'start') ? currentTempRoute.startPoint : currentTempRoute.endPoint;
        if (!currentPoint) {
            alert(`El punto de ${pointType === 'start' ? 'inicio' : 'fin'} aún no ha sido fijado.`);
            return;
        }
        const newName = prompt(`Nuevo nombre para el Punto de ${pointType === 'start' ? 'Inicio' : 'Fin'}:`, currentPoint.name);
        if (newName && newName.trim() !== "") {
            currentPoint.name = newName.trim();
            document.getElementById(`${pointType}-point-name-display`).textContent = currentPoint.name;
            renderCurrentStopsList(); // Actualizar la lista si muestra estos nombres
        }
    });
});

// Actualizar tiempos de inicio/fin cuando cambian en los inputs
document.getElementById('start-time-input').addEventListener('change', (event) => {
    if (currentTempRoute.startPoint) {
        currentTempRoute.startPoint.departureTime = event.target.value;
        if (document.getElementById('auto-time-intermediate-checkbox').checked) {
            recalculateIntermediateStopTimes();
        }
        renderCurrentStopsList();
    }
});
document.getElementById('end-time-input').addEventListener('change', (event) => {
    if (currentTempRoute.endPoint) {
        currentTempRoute.endPoint.arrivalTime = event.target.value;
        if (document.getElementById('auto-time-intermediate-checkbox').checked) {
            recalculateIntermediateStopTimes();
        }
        renderCurrentStopsList();
    }
});
document.getElementById('auto-time-intermediate-checkbox').addEventListener('change', () => {
    if (document.getElementById('auto-time-intermediate-checkbox').checked) {
        recalculateIntermediateStopTimes(); // Recalcular si se activa el modo automático
    }
    // Si se desactiva, los tiempos actuales se mantienen hasta edición manual
    renderCurrentStopsList(); // Para refrescar el estado del modal si está abierto
});


function openStopModal(stopData, index) { // Para paradas intermedias
    document.getElementById('stop-lat-input').value = stopData.lat;
    document.getElementById('stop-lng-input').value = stopData.lng;
    document.getElementById('stop-index-input').value = index; // Índice dentro de intermediateStops
    document.getElementById('stop-name-input').value = stopData.name || "";
    
    const autoTime = document.getElementById('auto-time-intermediate-checkbox').checked;
    document.getElementById('manual-time-fields').style.display = autoTime ? 'none' : 'block';
    document.getElementById('auto-time-info').style.display = autoTime ? 'block' : 'none';
    
    if (!autoTime) {
        document.getElementById('arrival-time-input').value = stopData.arrivalTime || "";
    }
    document.getElementById('modal-title').textContent = `Parada Intermedia ${index + 1}`;
    document.getElementById('stop-modal').style.display = 'block';
}

function closeStopModal() {
    document.getElementById('stop-modal').style.display = 'none';
}

document.getElementById('save-stop-btn').addEventListener('click', () => { // Para paradas intermedias
    const index = parseInt(document.getElementById('stop-index-input').value);
    const stopToEdit = currentTempRoute.intermediateStops[index];

    stopToEdit.name = document.getElementById('stop-name-input').value.trim();
    
    if (!document.getElementById('auto-time-intermediate-checkbox').checked) {
        const arrivalTime = document.getElementById('arrival-time-input').value;
        if (!arrivalTime) {
            alert("Por favor, ingresa la hora de paso/llegada para la parada intermedia.");
            return;
        }
        stopToEdit.arrivalTime = arrivalTime;
        // En paradas intermedias, departureTime es igual a arrivalTime para el cálculo de diferencia
        stopToEdit.departureTime = arrivalTime; 
    } else {
        // El tiempo se recalculará, no es necesario setearlo aquí.
        // Pero si se quiere, se puede forzar recalculateIntermediateStopTimes()
    }
    // Si es auto, los tiempos se actualizarán con recalculateIntermediateStopTimes, 
    // que se llama al dibujar la ruta o al cambiar inicio/fin.
    // Opcionalmente: forzar recálculo si el modo es automático
    if (document.getElementById('auto-time-intermediate-checkbox').checked) {
        recalculateIntermediateStopTimes();
    }

    renderCurrentStopsList();
    closeStopModal();
});


// --- LÓGICA DE PARADAS INTERMEDIAS Y TIEMPOS AUTOMÁTICOS ---
function recalculateIntermediateStopTimes() {
    if (!currentTempRoute.startPoint || !currentTempRoute.endPoint || 
        !currentTempRoute.startPoint.departureTime || !currentTempRoute.endPoint.arrivalTime ||
        currentTempRoute.intermediateStops.length === 0) {
        renderCurrentStopsList(); // Renderizar sin cambios de tiempo si faltan datos
        return;
    }

    const startTimeStr = currentTempRoute.startPoint.departureTime;
    const endTimeStr = currentTempRoute.endPoint.arrivalTime;

    let startDate = new Date();
    startDate.setHours(parseInt(startTimeStr.split(':')[0]), parseInt(startTimeStr.split(':')[1]), 0, 0);
    let endDate = new Date();
    endDate.setHours(parseInt(endTimeStr.split(':')[0]), parseInt(endTimeStr.split(':')[1]), 0, 0);

    if (endDate.getTime() < startDate.getTime()) { // Cruce de medianoche
        endDate.setDate(endDate.getDate() + 1);
    }
    const totalDurationMillis = endDate.getTime() - startDate.getTime();
    if (totalDurationMillis <= 0) {
        console.warn("Duración total de la ruta es cero o negativa. No se pueden calcular tiempos intermedios.");
        currentTempRoute.intermediateStops.forEach(stop => {
            stop.arrivalTime = "Error";
            stop.departureTime = "Error";
        });
        renderCurrentStopsList();
        return;
    }

    const startLatLng = L.latLng(currentTempRoute.startPoint.lat, currentTempRoute.startPoint.lng);
    const endLatLng = L.latLng(currentTempRoute.endPoint.lat, currentTempRoute.endPoint.lng);
    
    // Crear una "polilínea virtual" para medir distancias acumuladas
    let fullPathCoords = [startLatLng];
    currentTempRoute.intermediateStops.forEach(stop => fullPathCoords.push(L.latLng(stop.lat, stop.lng)));
    fullPathCoords.push(endLatLng);

    let totalPathDistance = 0;
    for (let i = 0; i < fullPathCoords.length - 1; i++) {
        totalPathDistance += fullPathCoords[i].distanceTo(fullPathCoords[i+1]);
    }
    
    if (totalPathDistance === 0) {
        console.warn("Distancia total de la ruta es cero. No se pueden calcular tiempos intermedios proporcionalmente.");
         currentTempRoute.intermediateStops.forEach(stop => {
            stop.arrivalTime = "Dist.0";
            stop.departureTime = "Dist.0";
        });
        renderCurrentStopsList();
        return;
    }

    let accumulatedDistance = 0;
    for (let i = 0; i < currentTempRoute.intermediateStops.length; i++) {
        const prevPointLatLng = (i === 0) ? startLatLng : L.latLng(currentTempRoute.intermediateStops[i-1].lat, currentTempRoute.intermediateStops[i-1].lng);
        const currentIntermediateStopLatLng = L.latLng(currentTempRoute.intermediateStops[i].lat, currentTempRoute.intermediateStops[i].lng);
        
        accumulatedDistance += prevPointLatLng.distanceTo(currentIntermediateStopLatLng);
        
        const proportionOfDistance = accumulatedDistance / totalPathDistance;
        const timeOffsetMillis = Math.round(totalDurationMillis * proportionOfDistance);
        
        let intermediateTime = new Date(startDate.getTime() + timeOffsetMillis);
        const hours = String(intermediateTime.getHours()).padStart(2, '0');
        const minutes = String(intermediateTime.getMinutes()).padStart(2, '0');
        const calculatedTime = `${hours}:${minutes}`;
        
        currentTempRoute.intermediateStops[i].arrivalTime = calculatedTime;
        currentTempRoute.intermediateStops[i].departureTime = calculatedTime; // Salida igual a llegada para intermedios
    }
    renderCurrentStopsList();
}


// --- RENDERIZADO DE LA LISTA DE PARADAS Y MAPA ---
function getCombinedStopsForDisplayAndMap() {
    let combinedStops = [];
    if (currentTempRoute.startPoint) combinedStops.push(currentTempRoute.startPoint);
    combinedStops = combinedStops.concat(currentTempRoute.intermediateStops);
    if (currentTempRoute.endPoint) combinedStops.push(currentTempRoute.endPoint);
    return combinedStops;
}

function renderCurrentStopsList() {
    const listElement = document.getElementById('current-stops-list');
    listElement.innerHTML = '';
    const stopsToDisplay = getCombinedStopsForDisplayAndMap();

    stopsToDisplay.forEach((stop, globalIndex) => {
        const listItem = document.createElement('li');
        let stopLabel = "";
        let timeInfo = "";

        if (stop.type === 'start') {
            stopLabel = `<strong>Inicio: ${stop.name || 'Punto de Inicio'}</strong>`;
            timeInfo = `Salida: ${stop.departureTime || '--:--'}`;
        } else if (stop.type === 'end') {
            stopLabel = `<strong>Fin: ${stop.name || 'Punto Final'}</strong>`;
            timeInfo = `Llegada: ${stop.arrivalTime || '--:--'}`;
        } else { // intermediate
            // El índice para paradas intermedias debe ser relativo a su propio array
            const intermediateIndex = currentTempRoute.intermediateStops.indexOf(stop);
            stopLabel = `Parada ${intermediateIndex + 1}: ${stop.name || ''}`;
            timeInfo = `Paso: ${stop.arrivalTime || '--:--'}`;
        }

        listItem.innerHTML = `
            <div class="stop-info">
                ${stopLabel}<br>
                <small>${timeInfo} (${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)})</small>
            </div>
            ${ (stop.type === 'intermediate') ? 
            `<div class="stop-actions">
                <button data-action="edit-intermediate" data-index="${currentTempRoute.intermediateStops.indexOf(stop)}">Editar</button>
                <button data-action="remove-intermediate" data-index="${currentTempRoute.intermediateStops.indexOf(stop)}" class="danger">Eliminar</button>
                <!-- Funciones de mover paradas intermedias se podrían añadir aquí -->
            </div>` : ''}
        `;
        listElement.appendChild(listItem);
    });
    drawRouteOnMap(stopsToDisplay);
}

document.getElementById('current-stops-list').addEventListener('click', (event) => {
    const target = event.target;
    if (target.tagName === 'BUTTON' && target.dataset.action) {
        const action = target.dataset.action;
        const index = parseInt(target.dataset.index); // Este índice es para el array intermediateStops

        if (action === 'edit-intermediate') {
            openStopModal(currentTempRoute.intermediateStops[index], index);
        } else if (action === 'remove-intermediate') {
            if (isTracking) {
                alert("Detén el seguimiento para eliminar paradas.");
                return;
            }
            currentTempRoute.intermediateStops.splice(index, 1);
            if (document.getElementById('auto-time-intermediate-checkbox').checked) {
                recalculateIntermediateStopTimes();
            }
            renderCurrentStopsList();
        }
    }
});


function drawRouteOnMap(stops) { // Recibe el array combinado
    clearMapStopMarkersAndPolyline();
    const latLngs = [];
    stops.forEach((stop, index) => {
        let icon;
        let popupContent = `<b>${stop.name || `Punto ${index + 1}`}</b> (${stop.type})<br>`;
        if (stop.type === 'start') {
            icon = createStopIcon('I', 'start');
            popupContent += `Salida: ${stop.departureTime || '--:--'}`;
        } else if (stop.type === 'end') {
            icon = createStopIcon('F', 'end');
            popupContent += `Llegada: ${stop.arrivalTime || '--:--'}`;
        } else { // intermediate
            const intermediateDisplayIndex = currentTempRoute.intermediateStops.indexOf(stop) + 1;
            icon = createStopIcon(intermediateDisplayIndex, 'intermediate');
            popupContent += `Paso: ${stop.arrivalTime || '--:--'}`;
        }

        const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map);
        marker.bindPopup(popupContent);
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
    if (!currentTempRoute.startPoint || !currentTempRoute.endPoint) {
        alert("La ruta debe tener un punto de inicio y un punto final definidos.");
        return;
    }
    if (!currentTempRoute.startPoint.departureTime || !currentTempRoute.endPoint.arrivalTime) {
        alert("Define los horarios de salida (inicio) y llegada (fin).");
        return;
    }
    if (!currentTempRoute.name || currentTempRoute.name === "Ruta Sin Nombre") {
        const newName = prompt("Ingresa un nombre descriptivo para esta ruta:", currentTempRoute.name === "Ruta Sin Nombre" ? "" : currentTempRoute.name);
        if (!newName || newName.trim() === "") {
            alert("Se requiere un nombre para guardar la ruta.");
            return;
        }
        currentTempRoute.name = newName.trim();
        document.getElementById('route-name-input').value = currentTempRoute.name;
    }

    // Validar que todos los tiempos intermedios (si hay) estén calculados o sean válidos
    if (document.getElementById('auto-time-intermediate-checkbox').checked) {
        recalculateIntermediateStopTimes(); // Asegurar que estén actualizados antes de guardar
    }
    for (const stop of currentTempRoute.intermediateStops) {
        if (!stop.arrivalTime || stop.arrivalTime.includes("Error") || stop.arrivalTime.includes("Dist.0")) {
            alert(`Hay un problema con el horario de la parada intermedia "${stop.name || 'Intermedia'}". Revisa los horarios de inicio/fin o la configuración de tiempos automáticos.`);
            return;
        }
    }


    const routeToSave = JSON.parse(JSON.stringify(currentTempRoute)); // Deep copy

    const existingRouteIndex = allSavedRoutes.findIndex(r => r.name === routeToSave.name);
    if (existingRouteIndex > -1) {
        if (confirm(`Ya existe una ruta llamada "${routeToSave.name}". ¿Deseas sobrescribirla?`)) {
            allSavedRoutes[existingRouteIndex] = routeToSave;
        } else {
            return;
        }
    } else {
        allSavedRoutes.push(routeToSave);
    }

    saveRoutesToLocalStorage();
    populateSavedRoutesSelect();
    alert(`Ruta "${routeToSave.name}" guardada.`);
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
    
    resetRouteCreationState(); // Limpiar antes de cargar
    currentTempRoute = JSON.parse(JSON.stringify(allSavedRoutes[parseInt(selectedIndex)]));
    
    document.getElementById('route-name-input').value = currentTempRoute.name;
    if (currentTempRoute.startPoint) {
        document.getElementById('start-point-info').style.display = 'block';
        document.getElementById('start-point-name-display').textContent = currentTempRoute.startPoint.name;
        document.getElementById('start-time-input').value = currentTempRoute.startPoint.departureTime;
        document.getElementById('start-point-coords').textContent = `(${currentTempRoute.startPoint.lat.toFixed(4)}, ${currentTempRoute.startPoint.lng.toFixed(4)})`;
        document.getElementById('set-start-point-btn').disabled = true;
        document.getElementById('set-end-point-btn').disabled = !currentTempRoute.endPoint; // Se activa si ya hay fin, o se puede fijar
    }
    if (currentTempRoute.endPoint) {
        document.getElementById('end-point-info').style.display = 'block';
        document.getElementById('end-point-name-display').textContent = currentTempRoute.endPoint.name;
        document.getElementById('end-time-input').value = currentTempRoute.endPoint.arrivalTime;
        document.getElementById('end-point-coords').textContent = `(${currentTempRoute.endPoint.lat.toFixed(4)}, ${currentTempRoute.endPoint.lng.toFixed(4)})`;
        document.getElementById('set-end-point-btn').disabled = true;
    }
    // Asumimos que si se guarda con auto-tiempos, se carga con esa misma opción.
    // El checkbox 'auto-time-intermediate-checkbox' no se guarda en la ruta, es una preferencia de UI.
    // Si se quiere persistir, habría que añadirlo a la estructura de la ruta.
    
    renderCurrentStopsList(); // Esto también llamará a drawRouteOnMap
    alert(`Ruta "${currentTempRoute.name}" cargada para edición.`);
}

function deleteSelectedRouteAction() {
    // ... (Misma lógica que antes)
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
            resetRouteCreationState(); // Limpiar la ruta actual si era la eliminada
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
    // Al añadir a la cola, necesitamos convertir la estructura de ruta guardada
    // a la estructura plana de 'stops' que espera la lógica de seguimiento.
    const routeData = allSavedRoutes[parseInt(selectedIndex)];
    if (!routeData.startPoint || !routeData.endPoint || !routeData.startPoint.departureTime || !routeData.endPoint.arrivalTime) {
        alert("La ruta seleccionada no está completa (falta inicio/fin o sus horarios). No se puede añadir al seguimiento.");
        return;
    }

    let flatStops = [];
    // Inicio
    flatStops.push({
        lat: routeData.startPoint.lat,
        lng: routeData.startPoint.lng,
        name: routeData.startPoint.name,
        // Para la primera parada en la lógica de seguimiento, 'arrivalTime' es conceptualmente igual a 'departureTime'
        // O, mejor dicho, el seguimiento REAL empieza con la SALIDA de la primera parada.
        // Pero para la estructura de datos, necesitamos ambos.
        arrivalTime: routeData.startPoint.departureTime, 
        departureTime: routeData.startPoint.departureTime,
        type: 'start' // Mantener el tipo para la app de pasajeros
    });
    // Intermedias
    routeData.intermediateStops.forEach(stop => {
        flatStops.push({
            lat: stop.lat,
            lng: stop.lng,
            name: stop.name || "Parada", // Dar un nombre default si no tiene
            arrivalTime: stop.arrivalTime,
            departureTime: stop.departureTime, // Igual a arrival para intermedios
            type: 'intermediate'
        });
    });
    // Fin
    flatStops.push({
        lat: routeData.endPoint.lat,
        lng: routeData.endPoint.lng,
        name: routeData.endPoint.name,
        arrivalTime: routeData.endPoint.arrivalTime,
        // La 'departureTime' del punto final no es relevante para el seguimiento, pero la estructura lo espera.
        // Podemos ponerla igual a la llegada o un poco después si hubiera un tiempo de espera en terminal.
        departureTime: routeData.endPoint.arrivalTime, 
        type: 'end'
    });
    
    const routeForTracking = {
        name: routeData.name,
        stops: flatStops // Este es el array que usa la lógica de seguimiento
    };

    trackingQueue.push(JSON.parse(JSON.stringify(routeForTracking)));
    renderTrackingQueue();
}

function clearTrackingQueueAction() {
    trackingQueue = [];
    renderTrackingQueue();
}

function renderTrackingQueue() {
    // ... (Misma lógica que antes)
    const listElement = document.getElementById('tracking-queue-list');
    listElement.innerHTML = '';
    trackingQueue.forEach((route, index) => {
        const listItem = document.createElement('li');
        listItem.textContent = `${index + 1}. ${route.name} (${route.stops.length} paradas)`;
        listElement.appendChild(listItem);
    });
}


// --- LÓGICA DE SEGUIMIENTO (ADAPTADA PARA LA ESTRUCTURA PLANA DE STOPS EN trackingQueue) ---
function startTrackingAction() {
    // ... (Misma lógica que antes, ya que trackingQueue.stops es plano)
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
    currentTrackingStopIndex = -1; // Inicia "antes" de la primera parada (índice 0 de trackingQueue[X].stops)

    document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;

    clearMapStopMarkersAndPolyline(); // Limpiar marcadores de edición
    // Dibujar la ruta activa del trackingQueue (que tiene la estructura plana)
    // Adaptar drawRouteOnMap si es necesario, o usar una función específica para el seguimiento
    // Por ahora, asumimos que drawRouteOnMap puede manejar el array plano de stops.
    // Pero necesitamos distinguir los íconos de inicio/fin en el modo seguimiento también.
    drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops); 


    advanceToNextLogicalStop();
    updateTrackingButtonsState();
    updateManualControlsState();

    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(() => {
        calculateTimeDifference();
    }, 1000);

    updatePassengerTrackingStatus(true);
    alert("Seguimiento iniciado.");
}

// Función específica para dibujar la ruta en modo seguimiento (podría ser similar a drawRouteOnMap)
function drawTrackingRouteOnMap(stops) {
    clearMapStopMarkersAndPolyline();
    const latLngs = [];
    stops.forEach((stop, index) => {
        let icon;
        let popupContent = `<b>${stop.name || `Punto ${index + 1}`}</b><br>`;
        // Usar el 'type' guardado en la parada plana
        if (stop.type === 'start') {
            icon = createStopIcon('I', 'start');
            popupContent += `Salida: ${stop.departureTime || '--:--'}`;
        } else if (stop.type === 'end') {
            icon = createStopIcon('F', 'end');
            popupContent += `Llegada: ${stop.arrivalTime || '--:--'}`;
        } else { // intermediate
            icon = createStopIcon(index, 'intermediate'); // Usar índice global para paradas intermedias en seguimiento
            popupContent += `Paso: ${stop.arrivalTime || '--:--'}`;
        }

        const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map);
        marker.bindPopup(popupContent);
        stopMarkers.push(marker);
        latLngs.push([stop.lat, stop.lng]);
    });

    if (latLngs.length > 1) {
        routePolyline = L.polyline(latLngs, { color: 'green', weight: 5 }).addTo(map); // Color diferente para seguimiento
    }
}


function stopTrackingAction() {
    // ... (Misma lógica que antes)
    if (!isTracking) return;
    isTracking = false;
    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = null;
    currentTrackingRouteIndex = -1;
    currentTrackingStopIndex = -1;
    lastCalculatedDiffMillis = 0;
    document.getElementById('time-difference-display').textContent = "--:--";
    document.getElementById('time-difference-display').className = "";
    document.getElementById('next-stop-info').textContent = "Ninguna";
    document.getElementById('current-route-info').textContent = "Ninguna";
    updateTrackingButtonsState();
    updateManualControlsState();
    updatePassengerTrackingStatus(false);
    // Opcional: volver a dibujar la ruta en edición si había una
    renderCurrentStopsList();
    alert("Seguimiento detenido.");
}

function updateTrackingButtonsState() {
    // ... (Misma lógica que antes)
    const startBtn = document.getElementById('start-tracking-btn');
    const stopBtn = document.getElementById('stop-tracking-btn');
    const routeCreationElements = document.querySelectorAll(
        '#route-name-input, #start-new-route-btn, #set-start-point-btn, #set-end-point-btn, #start-time-input, #end-time-input, #auto-time-intermediate-checkbox, #save-route-btn, .link-button[data-point-type]'
    );
    const stopsListActions = document.querySelectorAll('#stops-list-container button'); // Botones de editar/eliminar intermedios

    const loadRouteControls = document.querySelectorAll(
        '#load-route-for-editing-btn, #delete-selected-route-btn, #add-to-tracking-queue-btn, #saved-routes-select, #clear-tracking-queue-btn'
    );

    if (isTracking) {
        startBtn.disabled = true;
        stopBtn.disabled = false;
        routeCreationElements.forEach(el => el.disabled = true);
        stopsListActions.forEach(el => el.disabled = true);
        loadRouteControls.forEach(el => el.disabled = true);
    } else {
        startBtn.disabled = false;
        stopBtn.disabled = true;
        routeCreationElements.forEach(el => el.disabled = false);
        stopsListActions.forEach(el => el.disabled = false);
        loadRouteControls.forEach(el => el.disabled = false);
        // Restaurar estado de botones de fijar punto
        document.getElementById('set-start-point-btn').disabled = !!currentTempRoute.startPoint;
        document.getElementById('set-end-point-btn').disabled = !currentTempRoute.startPoint || !!currentTempRoute.endPoint;
    }
}

function updateManualControlsState() {
    // ... (Misma lógica que antes)
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
    // ... (Lógica adaptada para la estructura plana de trackingQueue.stops)
    if (!isTracking) return;

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    let tempProspectiveStopIndex = currentTrackingStopIndex + direction;

    if (direction > 0) {
        if (tempProspectiveStopIndex + 1 < currentRouteStops.length) {
            currentTrackingStopIndex = tempProspectiveStopIndex;
        } else {
            currentTrackingRouteIndex++;
            if (currentTrackingRouteIndex < trackingQueue.length) {
                currentTrackingStopIndex = -1;
                document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
                drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
                advanceToNextLogicalStop(true);
                return;
            } else {
                alert("Has llegado al final de todas las rutas.");
                stopTrackingAction();
                return;
            }
        }
    } else { // Retrocediendo
        if (tempProspectiveStopIndex >= -1) {
            currentTrackingStopIndex = tempProspectiveStopIndex;
        } else {
            currentTrackingRouteIndex--;
            if (currentTrackingRouteIndex >= 0) {
                const prevRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
                currentTrackingStopIndex = prevRouteStops.length - 2; // Apuntar al penúltimo tramo
                document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
                drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
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
    calculateTimeDifference();
}

function advanceToNextLogicalStop(forceManualAdvance = false) {
    // ... (Lógica adaptada para la estructura plana de trackingQueue.stops)
    if (!isTracking) return;

    const manualMode = document.getElementById('manual-mode-checkbox').checked;
    if (!forceManualAdvance && manualMode) {
        updateNextStopDisplayAndCalculateTime();
        return;
    }

    currentTrackingStopIndex++;
    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;

    if (currentTrackingStopIndex + 1 >= currentRouteStops.length) { // Llegó al final del último tramo
        currentTrackingRouteIndex++;
        if (currentTrackingRouteIndex < trackingQueue.length) {
            currentTrackingStopIndex = -1;
            alert(`Ruta "${trackingQueue[currentTrackingRouteIndex-1].name}" completada. Iniciando ruta "${trackingQueue[currentTrackingRouteIndex].name}".`);
            document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
            drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
            advanceToNextLogicalStop(forceManualAdvance);
        } else {
            alert("¡Todas las rutas completadas!");
            stopTrackingAction();
        }
        return;
    }
    updateNextStopDisplayAndCalculateTime();
    calculateTimeDifference();
}

function updateNextStopDisplayAndCalculateTime() {
    // ... (Lógica adaptada para la estructura plana de trackingQueue.stops)
    if (!isTracking || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        document.getElementById('next-stop-info').textContent = "Ninguna";
        document.getElementById('time-difference-display').textContent = "--:--";
        return;
    }

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    const nextStopTargetIndex = currentTrackingStopIndex + 1;

    if (nextStopTargetIndex < currentRouteStops.length) {
        const nextStop = currentRouteStops[nextStopTargetIndex];
        document.getElementById('next-stop-info').textContent = `${nextStop.name || `Parada ${nextStopTargetIndex +1 }`} (Lleg. ${nextStop.arrivalTime})`;
    } else {
        document.getElementById('next-stop-info').textContent = "Fin de ruta";
    }
}


// --- CÁLCULO DE DIFERENCIA DE TIEMPO (USA trackingQueue.stops) ---
function calculateTimeDifference() {
    // ... (La lógica interna de cálculo de tiempo basada en fromStop y toStop es la misma,
    // solo que ahora los obtiene de trackingQueue[...].stops)
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        updatePassengerTrackingStatus(isTracking);
        return;
    }

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    const fromStopIndex = currentTrackingStopIndex;
    const toStopIndex = currentTrackingStopIndex + 1;

    if (fromStopIndex < 0 || toStopIndex >= currentRouteStops.length) {
        if (!document.getElementById('manual-mode-checkbox').checked && fromStopIndex >= 0 && toStopIndex >= currentRouteStops.length) {
           advanceToNextLogicalStop();
        } else if (toStopIndex >= currentRouteStops.length) {
            document.getElementById('time-difference-display').textContent = "FIN";
            document.getElementById('time-difference-display').className = "";
        } else {
            document.getElementById('time-difference-display').textContent = "--:--";
        }
        updatePassengerTrackingStatus(true);
        return;
    }

    const fromStop = currentRouteStops[fromStopIndex];
    const toStop = currentRouteStops[toStopIndex];
    // ... resto de la lógica de cálculo igual que antes, usando fromStop y toStop ...
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
    if (totalLegScheduledTimeMillis < 0 ) { // <= 0 puede ser problemático si no es parada de espera
        console.warn("SmartMovePro: Tiempo de tramo inválido o cero.", fromStop, toStop);
        document.getElementById('time-difference-display').textContent = "Error Horario";
        updatePassengerTrackingStatus(true, true);
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
    lastCalculatedDiffMillis = scheduledTimeAtCurrentPositionMillis - currentTimeMillis;

    const diffInTotalMinutes = lastCalculatedDiffMillis / (1000 * 60);

    document.getElementById('time-difference-display').textContent = formatMinutesToTimeDiff(diffInTotalMinutes);
    const displayElement = document.getElementById('time-difference-display');

    if (diffInTotalMinutes < -0.1) displayElement.className = 'late';
    else if (diffInTotalMinutes > 0.1) displayElement.className = 'early';
    else displayElement.className = 'on-time';

    updatePassengerTrackingStatus(true);

    const distanceToNextStopTarget = currentPositionLatLng.distanceTo(coordB);
    if (!document.getElementById('manual-mode-checkbox').checked && distanceToNextStopTarget < PROXIMITY_THRESHOLD_METERS) {
        const isLastStopOfLastRoute = (currentTrackingRouteIndex === trackingQueue.length - 1) &&
                                      (toStopIndex === currentRouteStops.length - 1);
        if (!isLastStopOfLastRoute) advanceToNextLogicalStop();
        else if (distanceToNextStopTarget < PROXIMITY_THRESHOLD_METERS / 2) {
            document.getElementById('time-difference-display').textContent = "FIN";
            document.getElementById('time-difference-display').className = "";
        }
    }
}


// --- FUNCIÓN PARA ACTUALIZAR DATOS PARA PASAJEROS ---
function updatePassengerTrackingStatus(isCurrentlyTracking, hasError = false) {
    let statusPayload;
    if (!isCurrentlyTracking || hasError) {
        statusPayload = { isTracking: false, hasError: hasError, lastUpdateTime: new Date().getTime() };
    } else {
        if (currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length ||
            currentTrackingStopIndex < -1 ) { // No debería ser < -1
            statusPayload = { isTracking: false, lastUpdateTime: new Date().getTime(), reason: "Invalid tracking indices for passenger update" };
        } else {
            const currentRouteForPassenger = trackingQueue[currentTrackingRouteIndex]; // Esta es la ruta plana
            const currentRouteStopsForPassenger = currentRouteForPassenger.stops;
            
            let nextStopDataForPassengerObj = null;
            let nextBusStopArrivalTime = null;
            let nextBusStopDepartureTime = null;

            // currentTrackingStopIndex es la parada DESDE la que se partió.
            // La próxima parada es currentTrackingStopIndex + 1
            if (currentTrackingStopIndex + 1 < currentRouteStopsForPassenger.length) {
                 nextStopDataForPassengerObj = currentRouteStopsForPassenger[currentTrackingStopIndex + 1];
                 nextBusStopArrivalTime = nextStopDataForPassengerObj.arrivalTime;
                 nextBusStopDepartureTime = nextStopDataForPassengerObj.departureTime; // Que es igual a arrival para intermedios y fin
            }

            statusPayload = {
                isTracking: true,
                hasError: false,
                routeName: currentRouteForPassenger.name,
                currentStopIndexFromWhichDeparted: currentTrackingStopIndex,
                nextStopIndexTowardsWhichHeading: currentTrackingStopIndex + 1,
                currentBusDelayOrAheadMillis: lastCalculatedDiffMillis,
                lastKnownPosition: lastKnownPosition,
                lastUpdateTime: new Date().getTime(),
                nextBusStopArrivalTime: nextBusStopArrivalTime,
                nextBusStopDepartureTime: nextBusStopDepartureTime,
                // Incluir todos los stops de la ruta actual para que "Cuando Llega" pueda mostrar nombres y horarios programados
                routeStops: currentRouteStopsForPassenger.map(s => ({
                    name: s.name,
                    type: s.type,
                    arrivalTime: s.arrivalTime, // Horario programado de llegada/paso
                    departureTime: s.departureTime // Horario programado de salida (importante para inicio)
                }))
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
function timeToMinutes(timeInput) { /* ... sin cambios ... */ 
    let hours, minutes;
    if (typeof timeInput === 'string') {
        [hours, minutes] = timeInput.split(':').map(Number);
    } else if (timeInput instanceof Date) {
        hours = timeInput.getHours();
        minutes = timeInput.getMinutes();
    } else { return 0; }
    return hours * 60 + minutes;
}
function formatMinutesToTimeDiff(totalMinutesWithFraction) { /* ... sin cambios ... */ 
    const sign = totalMinutesWithFraction < 0 ? "-" : "+";
    const absTotalMinutes = Math.abs(totalMinutesWithFraction);
    let mm = Math.floor(absTotalMinutes);
    let ss = Math.round((absTotalMinutes - mm) * 60);
    if (ss === 60) { mm += 1; ss = 0; }
    return `${sign}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// --- BINDINGS INICIALES ---
function bindEventListeners() {
    document.getElementById('cancel-stop-btn').addEventListener('click', closeStopModal);
    // Los demás ya están asignados directamente o con delegación
    document.getElementById('start-new-route-btn').addEventListener('click', () => { /* Ya implementado arriba */ });
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

window.addEventListener('beforeunload', () => {
    // No hay mucho que podamos garantizar aquí si la pestaña se cierra.
    // La app de pasajeros debe confiar en 'lastUpdateTime'.
});
