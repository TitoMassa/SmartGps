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

let currentTempRoute = {
    name: "",
    startPoint: null, 
    endPoint: null,  
    intermediateStops: [] 
};

let allSavedRoutes = [];
let trackingQueue = []; // Array de { name: "...", stops: [array plano de paradas] }

let isTracking = false;
let currentTrackingRouteIndex = -1; // Índice de la ruta activa en trackingQueue
let currentTrackingStopIndex = -1;  // Índice de la parada DESDE la que se partió en la ruta activa
let trackingInterval;
let lastKnownPosition = null;
let lastCalculatedDiffMillis = 0;

const PROXIMITY_THRESHOLD_METERS = 70; // Ligeramente aumentado para más flexibilidad
const MAX_DISTANCE_TO_EXPECTED_NEXT_STOP_METERS = 5000; // Si está a más de 5km de la prox. parada, reevaluar

let settingPointType = null;

const currentLocationIcon = L.divIcon({ /* ... */ className: 'current-location-icon', html: '', iconSize: [12, 12], iconAnchor: [6, 6] });
function createStopIcon(number, type = 'intermediate') { /* ... */ 
    let className = 'stop-marker-icon-content';
    let content = number;
    if (type === 'start') { className = 'start-marker-icon-content'; content = 'I'; }
    else if (type === 'end') { className = 'end-marker-icon-content'; content = 'F'; }
    return L.divIcon({
        className: 'custom-marker-icon',
        html: `<div class="${className}">${content}</div>`,
        iconSize: type === 'intermediate' ? [20, 20] : [24, 24],
        iconAnchor: type === 'intermediate' ? [10, 10] : [12, 12]
    });
}

document.addEventListener('DOMContentLoaded', () => { /* ... (sin cambios en listeners de DOMContentLoaded) ... */
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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    map.on('click', onMapClick);
    startGeolocation();
}
function startGeolocation() { /* ... (sin cambios) ... */ 
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(updateCurrentPosition, handleLocationError, {
            enableHighAccuracy: true, timeout: 10000, maximumAge: 0
        });
    } else { alert("Geolocalización no es soportada por este navegador."); }
}
function updateCurrentPosition(position) { /* ... (sin cambios) ... */ 
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    lastKnownPosition = { lat, lng };
    if (!currentPositionMarker) {
        currentPositionMarker = L.marker([lat, lng], { icon: currentLocationIcon }).addTo(map);
        map.setView([lat, lng], 16);
    } else { currentPositionMarker.setLatLng([lat, lng]); }
    if (isTracking && !trackingInterval) { calculateTimeDifference(); }
}
function handleLocationError(error) { /* ... (sin cambios) ... */ console.warn(`SmartMovePro: ERROR(${error.code}): ${error.message}`); }

// --- LÓGICA DE CREACIÓN DE RUTA ---
function resetRouteCreationState() { /* ... (sin cambios) ... */
    currentTempRoute = { name: "", startPoint: null, endPoint: null, intermediateStops: [] };
    document.getElementById('route-name-input').value = "";
    document.getElementById('start-point-info').style.display = 'none';
    document.getElementById('start-time-input').value = "";
    document.getElementById('start-point-name-display').textContent = "Inicio Ruta";
    document.getElementById('end-point-info').style.display = 'none';
    document.getElementById('end-time-input').value = "";
    document.getElementById('end-point-name-display').textContent = "Fin Ruta";
    document.getElementById('set-start-point-btn').disabled = false;
    document.getElementById('set-end-point-btn').disabled = true;
    settingPointType = null;
    renderCurrentStopsList(); 
    clearMapStopMarkersAndPolyline();
}
// ... (resto de funciones de creación de ruta: onMapClick, openStopModal, closeStopModal, saveStopModalAction, etc. SIN CAMBIOS)
// ... (startNewRouteAction, set-start-point-btn listener, set-end-point-btn listener, onMapClick para creación, renombrar puntos, actualizar tiempos inicio/fin, openStopModal, saveStopModalAction para intermedios)
// ... (recalculateIntermediateStopTimes, getCombinedStopsForDisplayAndMap, renderCurrentStopsList, listener de lista de paradas, drawRouteOnMap, clearMapStopMarkersAndPolyline)
// ... (saveRouteAction, saveRoutesToLocalStorage, loadRoutesFromLocalStorage, populateSavedRoutesSelect, loadRouteForEditingAction, deleteSelectedRouteAction)
// ... (addToTrackingQueueAction, clearTrackingQueueAction, renderTrackingQueue)
// Copio las funciones que permanecen sin cambios desde la respuesta anterior para que este bloque sea completo
function onMapClick(e) {
    if (isTracking) return; 

    if (settingPointType) { 
        const { lat, lng } = e.latlng;
        if (settingPointType === 'start') {
            currentTempRoute.startPoint = { lat, lng, name: "Inicio Ruta", departureTime: document.getElementById('start-time-input').value || "", type: 'start' };
            document.getElementById('start-point-info').style.display = 'block';
            document.getElementById('start-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`;
            document.getElementById('set-start-point-btn').disabled = true; 
            document.getElementById('set-end-point-btn').disabled = false; 
            settingPointType = null; 
            renderCurrentStopsList();
        } else if (settingPointType === 'end') {
            if (!currentTempRoute.startPoint) { alert("Error: Punto de inicio no definido."); settingPointType = null; return; }
            currentTempRoute.endPoint = { lat, lng, name: "Fin Ruta", arrivalTime: document.getElementById('end-time-input').value || "", type: 'end' };
            document.getElementById('end-point-info').style.display = 'block';
            document.getElementById('end-point-coords').textContent = `(${lat.toFixed(4)}, ${lng.toFixed(4)})`;
            document.getElementById('set-end-point-btn').disabled = true; 
            settingPointType = null; 
            renderCurrentStopsList();
            recalculateIntermediateStopTimes();
        }
        settingPointType = null;
    } else if (currentTempRoute.startPoint && currentTempRoute.endPoint) {
        const { lat, lng } = e.latlng;
        const newIntermediateStop = { lat, lng, name: "", type: 'intermediate', arrivalTime: "" };
        let insertAtIndex = currentTempRoute.intermediateStops.length;
        currentTempRoute.intermediateStops.splice(insertAtIndex, 0, newIntermediateStop);
        
        if (document.getElementById('auto-time-intermediate-checkbox').checked) {
            recalculateIntermediateStopTimes(); 
            renderCurrentStopsList();
        } else {
            openStopModal(newIntermediateStop, insertAtIndex);
        }
    } else {
        alert("Define primero el Punto de Inicio y el Punto Final antes de añadir paradas intermedias.");
    }
}
function openStopModal(stopData, index) { /* ... */ 
    document.getElementById('stop-lat-input').value = stopData.lat;
    document.getElementById('stop-lng-input').value = stopData.lng;
    document.getElementById('stop-index-input').value = index;
    document.getElementById('stop-name-input').value = stopData.name || "";
    const autoTime = document.getElementById('auto-time-intermediate-checkbox').checked;
    document.getElementById('manual-time-fields').style.display = autoTime ? 'none' : 'block';
    document.getElementById('auto-time-info').style.display = autoTime ? 'block' : 'none';
    if (!autoTime) { document.getElementById('arrival-time-input').value = stopData.arrivalTime || ""; }
    document.getElementById('modal-title').textContent = `Parada Intermedia ${index + 1}`;
    document.getElementById('stop-modal').style.display = 'block';
}
function closeStopModal() { document.getElementById('stop-modal').style.display = 'none'; }
function saveStopModalAction() { /* ... */ 
    const index = parseInt(document.getElementById('stop-index-input').value);
    const stopToEdit = currentTempRoute.intermediateStops[index];
    stopToEdit.name = document.getElementById('stop-name-input').value.trim();
    if (!document.getElementById('auto-time-intermediate-checkbox').checked) {
        const arrivalTime = document.getElementById('arrival-time-input').value;
        if (!arrivalTime) { alert("Por favor, ingresa la hora de paso/llegada para la parada intermedia."); return; }
        stopToEdit.arrivalTime = arrivalTime;
        stopToEdit.departureTime = arrivalTime; 
    }
    if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); }
    renderCurrentStopsList();
    closeStopModal();
}
function startNewRouteAction() { /* ... */ 
    if (isTracking) { alert("Detén el seguimiento para iniciar una nueva ruta."); return; }
    const routeName = document.getElementById('route-name-input').value.trim();
    resetRouteCreationState();
    currentTempRoute.name = routeName || "Ruta Sin Nombre";
    document.getElementById('route-name-input').value = currentTempRoute.name;
    alert("Nueva ruta iniciada. Fija el punto de inicio.");
}
function recalculateIntermediateStopTimes() { /* ... (sin cambios) ... */ 
    if (!currentTempRoute.startPoint || !currentTempRoute.endPoint || !currentTempRoute.startPoint.departureTime || !currentTempRoute.endPoint.arrivalTime || currentTempRoute.intermediateStops.length === 0) { renderCurrentStopsList(); return; }
    const startTimeStr = currentTempRoute.startPoint.departureTime;
    const endTimeStr = currentTempRoute.endPoint.arrivalTime;
    let startDate = new Date(); startDate.setHours(parseInt(startTimeStr.split(':')[0]), parseInt(startTimeStr.split(':')[1]), 0, 0);
    let endDate = new Date(); endDate.setHours(parseInt(endTimeStr.split(':')[0]), parseInt(endTimeStr.split(':')[1]), 0, 0);
    if (endDate.getTime() < startDate.getTime()) { endDate.setDate(endDate.getDate() + 1); }
    const totalDurationMillis = endDate.getTime() - startDate.getTime();
    if (totalDurationMillis <= 0) { console.warn("Duración total de la ruta es cero o negativa."); currentTempRoute.intermediateStops.forEach(stop => { stop.arrivalTime = "Error"; stop.departureTime = "Error"; }); renderCurrentStopsList(); return; }
    const startLatLng = L.latLng(currentTempRoute.startPoint.lat, currentTempRoute.startPoint.lng);
    let fullPathCoords = [startLatLng];
    currentTempRoute.intermediateStops.forEach(stop => fullPathCoords.push(L.latLng(stop.lat, stop.lng)));
    fullPathCoords.push(L.latLng(currentTempRoute.endPoint.lat, currentTempRoute.endPoint.lng));
    let totalPathDistance = 0;
    for (let i = 0; i < fullPathCoords.length - 1; i++) { totalPathDistance += fullPathCoords[i].distanceTo(fullPathCoords[i+1]); }
    if (totalPathDistance === 0) { console.warn("Distancia total de la ruta es cero."); currentTempRoute.intermediateStops.forEach(stop => { stop.arrivalTime = "Dist.0"; stop.departureTime = "Dist.0"; }); renderCurrentStopsList(); return; }
    let accumulatedDistance = 0;
    for (let i = 0; i < currentTempRoute.intermediateStops.length; i++) {
        const prevPointLatLng = (i === 0) ? startLatLng : L.latLng(currentTempRoute.intermediateStops[i-1].lat, currentTempRoute.intermediateStops[i-1].lng);
        const currentIntermediateStopLatLng = L.latLng(currentTempRoute.intermediateStops[i].lat, currentTempRoute.intermediateStops[i].lng);
        accumulatedDistance += prevPointLatLng.distanceTo(currentIntermediateStopLatLng);
        const proportionOfDistance = accumulatedDistance / totalPathDistance;
        const timeOffsetMillis = Math.round(totalDurationMillis * proportionOfDistance);
        let intermediateTime = new Date(startDate.getTime() + timeOffsetMillis);
        const calculatedTime = `${String(intermediateTime.getHours()).padStart(2, '0')}:${String(intermediateTime.getMinutes()).padStart(2, '0')}`;
        currentTempRoute.intermediateStops[i].arrivalTime = calculatedTime;
        currentTempRoute.intermediateStops[i].departureTime = calculatedTime;
    }
    renderCurrentStopsList();
}
function getCombinedStopsForDisplayAndMap() { /* ... (sin cambios) ... */ 
    let combinedStops = [];
    if (currentTempRoute.startPoint) combinedStops.push(currentTempRoute.startPoint);
    combinedStops = combinedStops.concat(currentTempRoute.intermediateStops);
    if (currentTempRoute.endPoint) combinedStops.push(currentTempRoute.endPoint);
    return combinedStops;
}
function renderCurrentStopsList() { /* ... (sin cambios) ... */ 
    const listElement = document.getElementById('current-stops-list');
    listElement.innerHTML = '';
    const stopsToDisplay = getCombinedStopsForDisplayAndMap();
    stopsToDisplay.forEach((stop) => {
        const listItem = document.createElement('li');
        let stopLabel = "", timeInfo = "";
        if (stop.type === 'start') { stopLabel = `<strong>Inicio: ${stop.name || 'Punto de Inicio'}</strong>`; timeInfo = `Salida: ${stop.departureTime || '--:--'}`; }
        else if (stop.type === 'end') { stopLabel = `<strong>Fin: ${stop.name || 'Punto Final'}</strong>`; timeInfo = `Llegada: ${stop.arrivalTime || '--:--'}`; }
        else { const intermediateIndex = currentTempRoute.intermediateStops.indexOf(stop); stopLabel = `Parada ${intermediateIndex + 1}: ${stop.name || ''}`; timeInfo = `Paso: ${stop.arrivalTime || '--:--'}`; }
        listItem.innerHTML = `<div class="stop-info">${stopLabel}<br><small>${timeInfo} (${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)})</small></div>
            ${ (stop.type === 'intermediate') ? `<div class="stop-actions"><button data-action="edit-intermediate" data-index="${currentTempRoute.intermediateStops.indexOf(stop)}">Editar</button><button data-action="remove-intermediate" data-index="${currentTempRoute.intermediateStops.indexOf(stop)}" class="danger">Eliminar</button></div>` : ''}`;
        listElement.appendChild(listItem);
    });
    drawRouteOnMap(stopsToDisplay);
}
function drawRouteOnMap(stops) { /* ... (sin cambios) ... */ 
    clearMapStopMarkersAndPolyline();
    const latLngs = [];
    stops.forEach((stop, index) => {
        let icon, popupContent = `<b>${stop.name || `Punto ${index + 1}`}</b> (${stop.type})<br>`;
        if (stop.type === 'start') { icon = createStopIcon('I', 'start'); popupContent += `Salida: ${stop.departureTime || '--:--'}`; }
        else if (stop.type === 'end') { icon = createStopIcon('F', 'end'); popupContent += `Llegada: ${stop.arrivalTime || '--:--'}`; }
        else { const intermediateDisplayIndex = currentTempRoute.intermediateStops.indexOf(stop) + 1; icon = createStopIcon(intermediateDisplayIndex, 'intermediate'); popupContent += `Paso: ${stop.arrivalTime || '--:--'}`; }
        const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map);
        marker.bindPopup(popupContent); stopMarkers.push(marker); latLngs.push([stop.lat, stop.lng]);
    });
    if (latLngs.length > 1) { routePolyline = L.polyline(latLngs, { color: 'blue' }).addTo(map); }
}
function clearMapStopMarkersAndPolyline() { /* ... (sin cambios) ... */ 
    stopMarkers.forEach(marker => map.removeLayer(marker)); stopMarkers = [];
    if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; }
}
function saveRouteAction() { /* ... (sin cambios, usa la estructura de currentTempRoute) ... */ 
    if (isTracking) { alert("Detén el seguimiento para guardar la ruta."); return; }
    if (!currentTempRoute.startPoint || !currentTempRoute.endPoint || !currentTempRoute.startPoint.departureTime || !currentTempRoute.endPoint.arrivalTime) { alert("La ruta debe tener un punto de inicio y fin con horarios definidos."); return; }
    if (!currentTempRoute.name || currentTempRoute.name === "Ruta Sin Nombre") { const newName = prompt("Ingresa un nombre descriptivo para esta ruta:", currentTempRoute.name === "Ruta Sin Nombre" ? "" : currentTempRoute.name); if (!newName || newName.trim() === "") { alert("Se requiere un nombre para guardar la ruta."); return; } currentTempRoute.name = newName.trim(); document.getElementById('route-name-input').value = currentTempRoute.name; }
    if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); }
    for (const stop of currentTempRoute.intermediateStops) { if (!stop.arrivalTime || stop.arrivalTime.includes("Error") || stop.arrivalTime.includes("Dist.0")) { alert(`Hay un problema con el horario de la parada intermedia "${stop.name || 'Intermedia'}".`); return; } }
    const routeToSave = JSON.parse(JSON.stringify(currentTempRoute));
    const existingRouteIndex = allSavedRoutes.findIndex(r => r.name === routeToSave.name);
    if (existingRouteIndex > -1) { if (confirm(`Ya existe una ruta llamada "${routeToSave.name}". ¿Deseas sobrescribirla?`)) { allSavedRoutes[existingRouteIndex] = routeToSave; } else { return; } }
    else { allSavedRoutes.push(routeToSave); }
    saveRoutesToLocalStorage(); populateSavedRoutesSelect(); alert(`Ruta "${routeToSave.name}" guardada.`);
}
function saveRoutesToLocalStorage() { /* ... (sin cambios) ... */ localStorage.setItem('smartMoveProRoutes', JSON.stringify(allSavedRoutes)); }
function loadRoutesFromLocalStorage() { /* ... (sin cambios) ... */ const saved = localStorage.getItem('smartMoveProRoutes'); if (saved) { allSavedRoutes = JSON.parse(saved); } }
function populateSavedRoutesSelect() { /* ... (sin cambios) ... */ 
    const select = document.getElementById('saved-routes-select'); const currentVal = select.value; select.innerHTML = '<option value="">-- Selecciona una ruta --</option>';
    allSavedRoutes.forEach((route, index) => { const option = document.createElement('option'); option.value = index; option.textContent = route.name; select.appendChild(option); });
    if (allSavedRoutes[parseInt(currentVal)]) { select.value = currentVal; } else { select.value = ""; }
}
function loadRouteForEditingAction() { /* ... (sin cambios, restaura UI desde currentTempRoute) ... */ 
    if (isTracking) { alert("Detén el seguimiento para cargar una ruta para edición."); return; }
    const selectedIndex = document.getElementById('saved-routes-select').value; if (selectedIndex === "") { alert("Por favor, selecciona una ruta para cargar."); return; }
    resetRouteCreationState(); currentTempRoute = JSON.parse(JSON.stringify(allSavedRoutes[parseInt(selectedIndex)]));
    document.getElementById('route-name-input').value = currentTempRoute.name;
    if (currentTempRoute.startPoint) { document.getElementById('start-point-info').style.display = 'block'; document.getElementById('start-point-name-display').textContent = currentTempRoute.startPoint.name; document.getElementById('start-time-input').value = currentTempRoute.startPoint.departureTime; document.getElementById('start-point-coords').textContent = `(${currentTempRoute.startPoint.lat.toFixed(4)}, ${currentTempRoute.startPoint.lng.toFixed(4)})`; document.getElementById('set-start-point-btn').disabled = true; document.getElementById('set-end-point-btn').disabled = !currentTempRoute.endPoint; }
    if (currentTempRoute.endPoint) { document.getElementById('end-point-info').style.display = 'block'; document.getElementById('end-point-name-display').textContent = currentTempRoute.endPoint.name; document.getElementById('end-time-input').value = currentTempRoute.endPoint.arrivalTime; document.getElementById('end-point-coords').textContent = `(${currentTempRoute.endPoint.lat.toFixed(4)}, ${currentTempRoute.endPoint.lng.toFixed(4)})`; document.getElementById('set-end-point-btn').disabled = true; }
    renderCurrentStopsList(); alert(`Ruta "${currentTempRoute.name}" cargada para edición.`);
}
function deleteSelectedRouteAction() { /* ... (sin cambios) ... */ 
    if (isTracking) { alert("Detén el seguimiento para eliminar rutas."); return; }
    const selectElement = document.getElementById('saved-routes-select'); const selectedIndex = selectElement.value; if (selectedIndex === "") { alert("Por favor, selecciona una ruta para eliminar."); return; }
    const routeNameToDelete = allSavedRoutes[parseInt(selectedIndex)].name;
    if (confirm(`¿Estás seguro de que deseas eliminar la ruta "${routeNameToDelete}"?`)) { allSavedRoutes.splice(parseInt(selectedIndex), 1); saveRoutesToLocalStorage(); populateSavedRoutesSelect(); if (currentTempRoute.name === routeNameToDelete) { resetRouteCreationState(); } alert(`Ruta "${routeNameToDelete}" eliminada.`); }
}
function addToTrackingQueueAction() { /* ... (usa la estructura plana de paradas, sin cambios funcionales grandes aquí) ... */
    const selectedIndex = document.getElementById('saved-routes-select').value; if (selectedIndex === "") { alert("Por favor, selecciona una ruta para añadir a la cola."); return; }
    const routeData = allSavedRoutes[parseInt(selectedIndex)];
    if (!routeData.startPoint || !routeData.endPoint || !routeData.startPoint.departureTime || !routeData.endPoint.arrivalTime) { alert("La ruta seleccionada no está completa. No se puede añadir al seguimiento."); return; }
    let flatStops = [];
    flatStops.push({ lat: routeData.startPoint.lat, lng: routeData.startPoint.lng, name: routeData.startPoint.name, arrivalTime: routeData.startPoint.departureTime, departureTime: routeData.startPoint.departureTime, type: 'start' });
    routeData.intermediateStops.forEach(stop => { flatStops.push({ lat: stop.lat, lng: stop.lng, name: stop.name || "Parada", arrivalTime: stop.arrivalTime, departureTime: stop.departureTime, type: 'intermediate' }); });
    flatStops.push({ lat: routeData.endPoint.lat, lng: routeData.endPoint.lng, name: routeData.endPoint.name, arrivalTime: routeData.endPoint.arrivalTime, departureTime: routeData.endPoint.arrivalTime, type: 'end' });
    const routeForTracking = { name: routeData.name, stops: flatStops };
    trackingQueue.push(JSON.parse(JSON.stringify(routeForTracking))); renderTrackingQueue();
}
function clearTrackingQueueAction() { /* ... (sin cambios) ... */ trackingQueue = []; renderTrackingQueue(); }
function renderTrackingQueue() { /* ... (sin cambios) ... */ 
    const listElement = document.getElementById('tracking-queue-list'); listElement.innerHTML = '';
    trackingQueue.forEach((route, index) => { const listItem = document.createElement('li'); listItem.textContent = `${index + 1}. ${route.name} (${route.stops.length} paradas)`; listElement.appendChild(listItem); });
}


// --- LÓGICA DE SEGUIMIENTO ---
function startTrackingAction() {
    if (isTracking) { alert("El seguimiento ya está activo."); return; }
    if (trackingQueue.length === 0) { alert("Añade al menos una ruta a la cola de seguimiento."); return; }
    if (!lastKnownPosition) { alert("Esperando ubicación GPS..."); return; }

    isTracking = true;
    currentTrackingRouteIndex = 0;
    currentTrackingStopIndex = -1; 

    document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
    clearMapStopMarkersAndPolyline();
    drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops); 

    // Inicializar/re-sincronizar con la parada más cercana al iniciar
    findAndSetCurrentLeg(); // << NUEVA LLAMADA INICIAL
    
    updateTrackingButtonsState();
    updateManualControlsState();

    if (trackingInterval) clearInterval(trackingInterval);
    trackingInterval = setInterval(() => {
        calculateTimeDifference(); 
    }, 1000);

    updatePassengerTrackingStatus(true);
    alert("Seguimiento iniciado.");
}

function drawTrackingRouteOnMap(stops) { /* ... (sin cambios) ... */ 
    clearMapStopMarkersAndPolyline(); const latLngs = [];
    stops.forEach((stop, index) => {
        let icon, popupContent = `<b>${stop.name || `Punto ${index + 1}`}</b><br>`;
        if (stop.type === 'start') { icon = createStopIcon('I', 'start'); popupContent += `Salida: ${stop.departureTime || '--:--'}`; }
        else if (stop.type === 'end') { icon = createStopIcon('F', 'end'); popupContent += `Llegada: ${stop.arrivalTime || '--:--'}`; }
        else { icon = createStopIcon(index, 'intermediate'); popupContent += `Paso: ${stop.arrivalTime || '--:--'}`; }
        const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map); marker.bindPopup(popupContent); stopMarkers.push(marker); latLngs.push([stop.lat, stop.lng]);
    });
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
    const startBtn = document.getElementById('start-tracking-btn'); const stopBtn = document.getElementById('stop-tracking-btn');
    const routeCreationElements = document.querySelectorAll('#route-name-input, #start-new-route-btn, #set-start-point-btn, #set-end-point-btn, #start-time-input, #end-time-input, #auto-time-intermediate-checkbox, #save-route-btn, .link-button[data-point-type]');
    const stopsListActions = document.querySelectorAll('#stops-list-container button');
    const loadRouteControls = document.querySelectorAll('#load-route-for-editing-btn, #delete-selected-route-btn, #add-to-tracking-queue-btn, #saved-routes-select, #clear-tracking-queue-btn');
    if (isTracking) {
        startBtn.disabled = true; stopBtn.disabled = false; routeCreationElements.forEach(el => el.disabled = true);
        stopsListActions.forEach(el => el.disabled = true); loadRouteControls.forEach(el => el.disabled = true);
    } else {
        startBtn.disabled = false; stopBtn.disabled = true; routeCreationElements.forEach(el => el.disabled = false);
        stopsListActions.forEach(el => el.disabled = false); loadRouteControls.forEach(el => el.disabled = false);
        document.getElementById('set-start-point-btn').disabled = !!currentTempRoute.startPoint;
        document.getElementById('set-end-point-btn').disabled = !currentTempRoute.startPoint || !!currentTempRoute.endPoint;
    }
}
function updateManualControlsState() { /* ... (sin cambios) ... */ 
    const manualCheckbox = document.getElementById('manual-mode-checkbox'); const prevBtn = document.getElementById('prev-stop-btn'); const nextBtn = document.getElementById('next-stop-btn');
    if (isTracking && manualCheckbox.checked) { prevBtn.disabled = false; nextBtn.disabled = false; } else { prevBtn.disabled = true; nextBtn.disabled = true; }
}

function manualAdvanceStop(direction) { // Se mantiene la lógica de avance manual, pero findAndSetCurrentLeg se encargará de la resincronización si es necesario.
    if (!isTracking) return;
    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    let newProposedStopIndex = currentTrackingStopIndex + direction;

    if (direction > 0) { // Avanzando
        if (newProposedStopIndex + 1 < currentRouteStops.length) {
            currentTrackingStopIndex = newProposedStopIndex;
        } else { // Fin de ruta actual
            currentTrackingRouteIndex++;
            if (currentTrackingRouteIndex < trackingQueue.length) {
                currentTrackingStopIndex = -1; // Preparar para la primera parada de la nueva ruta
                document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
                drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
                findAndSetCurrentLeg(); // Re-sincronizar con la nueva ruta
                return; 
            } else {
                alert("Has llegado al final de todas las rutas.");
                stopTrackingAction();
                return;
            }
        }
    } else { // Retrocediendo
        if (newProposedStopIndex >= -1) {
            currentTrackingStopIndex = newProposedStopIndex;
        } else { // Principio de ruta actual, intentar ir a ruta anterior
            currentTrackingRouteIndex--;
            if (currentTrackingRouteIndex >= 0) {
                const prevRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
                currentTrackingStopIndex = prevRouteStops.length - 2; // Apuntar al penúltimo tramo de la ruta anterior
                document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
                drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
            } else {
                alert("Ya estás al inicio de la primera ruta.");
                currentTrackingRouteIndex = 0;
                currentTrackingStopIndex = -1; // Mantener antes de la primera parada
            }
        }
    }
    updateNextStopDisplay(); // Actualizar display de próxima parada
    calculateTimeDifference();    // Calcular y actualizar para pasajeros
}

function advanceToNextLogicalStop() { // Avance por proximidad
    if (!isTracking || document.getElementById('manual-mode-checkbox').checked) {
        if (isTracking) updateNextStopDisplay(); // Solo actualizar display si está en modo manual
        return;
    }

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    // currentTrackingStopIndex es la parada DESDE la que se partió.
    // Avanzamos currentTrackingStopIndex para que ahora sea la parada que acabamos de alcanzar.
    currentTrackingStopIndex++; 

    if (currentTrackingStopIndex + 1 >= currentRouteStops.length) { // Si la *nueva* parada de partida es la última, o más allá
        currentTrackingRouteIndex++;
        if (currentTrackingRouteIndex < trackingQueue.length) {
            currentTrackingStopIndex = -1; // Antes de la primera parada de la nueva ruta
            alert(`Ruta "${trackingQueue[currentTrackingRouteIndex-1].name}" completada. Iniciando ruta "${trackingQueue[currentTrackingRouteIndex].name}".`);
            document.getElementById('current-route-info').textContent = trackingQueue[currentTrackingRouteIndex].name;
            drawTrackingRouteOnMap(trackingQueue[currentTrackingRouteIndex].stops);
            findAndSetCurrentLeg(); // Re-sincronizar con la nueva ruta
        } else {
            alert("¡Todas las rutas completadas!");
            stopTrackingAction();
        }
        return;
    }
    // Si no se cambió de ruta, simplemente actualizamos la próxima parada.
    updateNextStopDisplay();
    calculateTimeDifference(); 
}

function updateNextStopDisplay() {
    if (!isTracking || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        document.getElementById('next-stop-info').textContent = "Ninguna";
        document.getElementById('time-difference-display').textContent = "--:--";
        return;
    }
    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    const nextStopTargetIndex = currentTrackingStopIndex + 1; // La parada a la que nos dirigimos

    if (nextStopTargetIndex < currentRouteStops.length) {
        const nextStop = currentRouteStops[nextStopTargetIndex];
        document.getElementById('next-stop-info').textContent = `${nextStop.name || `Parada ${nextStopTargetIndex + 1}`} (Lleg. ${nextStop.arrivalTime})`;
    } else {
        document.getElementById('next-stop-info').textContent = "Fin de ruta";
    }
}


// --- NUEVA LÓGICA DE RE-SINCRONIZACIÓN Y CÁLCULO DE TIEMPO ---
function findAndSetCurrentLeg() {
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0) return false;

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    if (currentRouteStops.length < 2) return false; // Ruta no válida

    const currentDriverLatLng = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);
    let closestLeg = { fromIndex: -1, toIndex: -1, distanceToLine: Infinity, distanceToStart: Infinity };

    // Iterar sobre todos los segmentos de la ruta actual
    for (let i = 0; i < currentRouteStops.length - 1; i++) {
        const p1 = L.latLng(currentRouteStops[i].lat, currentRouteStops[i].lng);
        const p2 = L.latLng(currentRouteStops[i+1].lat, currentRouteStops[i+1].lng);

        // Distancia del conductor al punto de inicio del segmento
        const distToStartNode = currentDriverLatLng.distanceTo(p1);
        // Distancia del conductor al punto final del segmento
        const distToEndNode = currentDriverLatLng.distanceTo(p2);
        // Distancia total del segmento
        const legLength = p1.distanceTo(p2);

        // Lógica simplificada: encontrar el segmento cuya parada de inicio (p1) esté más cerca
        // y el conductor esté razonablemente cerca de ese segmento o ya lo haya pasado.
        // O encontrar la parada más cercana que aún no se haya pasado.

        // Si el conductor está antes de la parada 'i' o muy cerca de ella
        if (distToStartNode < PROXIMITY_THRESHOLD_METERS * 3) { // Umbral más grande para "cerca de un nodo"
            if (distToStartNode < closestLeg.distanceToLine) { // Mejorar criterio de "cercanía"
                closestLeg = { fromIndex: i - 1, toIndex: i, distanceToLine: distToStartNode, isAtNode: true, nodeIndex: i };
            }
        }
        // Si está más cerca del final del segmento actual
        if (distToEndNode < PROXIMITY_THRESHOLD_METERS * 3 && i < currentRouteStops.length -1) {
             if (distToEndNode < closestLeg.distanceToLine) {
                closestLeg = { fromIndex: i, toIndex: i+1, distanceToLine: distToEndNode, isAtNode: true, nodeIndex: i+1 };
            }
        }
    }
    
    // Si no se encontró un nodo cercano, buscar el segmento más cercano
    // (Esta parte requiere "distance to line segment", que Leaflet no da directamente)
    // Simplificación: encontrar la próxima parada no pasada más cercana.
    if (closestLeg.fromIndex === -1 && closestLeg.toIndex === -1) {
        let bestCandidateNextStopIndex = -1;
        let minDistance = Infinity;
        for (let i = 0; i < currentRouteStops.length; i++) {
            // Considerar solo paradas que no se hayan "confirmado" como pasadas.
            // Si currentTrackingStopIndex es la última parada "desde la que se partió",
            // entonces las candidatas son desde currentTrackingStopIndex + 1 en adelante.
            if (i > currentTrackingStopIndex) {
                const stopLatLng = L.latLng(currentRouteStops[i].lat, currentRouteStops[i].lng);
                const dist = currentDriverLatLng.distanceTo(stopLatLng);
                if (dist < minDistance) {
                    minDistance = dist;
                    bestCandidateNextStopIndex = i;
                }
            }
        }
        if (bestCandidateNextStopIndex !== -1) {
            closestLeg.fromIndex = bestCandidateNextStopIndex -1; // La parada "desde" es la anterior a la más cercana "hacia"
            closestLeg.toIndex = bestCandidateNextStopIndex;
            closestLeg.distanceToLine = minDistance; // Distancia al nodo
        }
    }


    if (closestLeg.toIndex !== -1 && closestLeg.toIndex < currentRouteStops.length) {
        // Si la nueva parada "desde" es diferente de la actual, o si es el inicio.
        if (closestLeg.fromIndex !== currentTrackingStopIndex || currentTrackingStopIndex === -1) {
             console.log(`SmartMovePro: Re-sincronizando. De ${currentTrackingStopIndex} a ${closestLeg.fromIndex}. Próxima: ${closestLeg.toIndex}`);
             currentTrackingStopIndex = closestLeg.fromIndex;
        }
        updateNextStopDisplay(); // Actualizar la UI con la nueva próxima parada
        return true;
    }
    
    // Si no se pudo re-sincronizar bien, mantener el estado actual si es válido
    if (currentTrackingStopIndex + 1 < currentRouteStops.length) {
        updateNextStopDisplay();
        return true;
    }

    console.warn("SmartMovePro: No se pudo determinar el tramo actual de la ruta.");
    return false; // No se pudo determinar un tramo válido
}


function calculateTimeDifference() {
    if (!isTracking || !lastKnownPosition || currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
        updatePassengerTrackingStatus(isTracking);
        return;
    }

    const currentRouteStops = trackingQueue[currentTrackingRouteIndex].stops;
    const currentDriverLatLng = L.latLng(lastKnownPosition.lat, lastKnownPosition.lng);

    // Lógica de avance por proximidad y re-sincronización
    const nextStopIndexIfTracking = currentTrackingStopIndex + 1;
    if (nextStopIndexIfTracking < currentRouteStops.length) {
        const nextStopTarget = currentRouteStops[nextStopIndexIfTracking];
        const distanceToNextStopTarget = currentDriverLatLng.distanceTo(L.latLng(nextStopTarget.lat, nextStopTarget.lng));

        if (!document.getElementById('manual-mode-checkbox').checked) {
            if (distanceToNextStopTarget < PROXIMITY_THRESHOLD_METERS) {
                advanceToNextLogicalStop(); // Avanza y llama a calculateTimeDifference de nuevo
                return; // Salir porque advanceToNextLogicalStop se encargará
            } else if (distanceToNextStopTarget > MAX_DISTANCE_TO_EXPECTED_NEXT_STOP_METERS) {
                // Chofer muy lejos de la parada esperada, intentar re-sincronizar
                console.log("SmartMovePro: Chofer lejos de parada esperada. Intentando re-sincronizar...");
                if (!findAndSetCurrentLeg()) { // Si no puede re-sincronizar, mostrar error y no calcular
                    document.getElementById('time-difference-display').textContent = "Fuera de Ruta";
                    updatePassengerTrackingStatus(true, true, "Fuera de Ruta"); // Informar error
                    return;
                }
                // Si findAndSetCurrentLeg tuvo éxito, currentTrackingStopIndex se actualizó.
                // Continuar con el cálculo de tiempo para el nuevo tramo.
            }
        }
    } else if (currentTrackingStopIndex >= 0 && nextStopIndexIfTracking >= currentRouteStops.length) {
        // Ya pasó la última parada o está en ella, verificar si debe avanzar a la siguiente ruta
        if (!document.getElementById('manual-mode-checkbox').checked) {
             advanceToNextLogicalStop();
             return;
        }
    }


    // --- Comienza el cálculo de tiempo para el tramo actual (currentTrackingStopIndex -> currentTrackingStopIndex + 1) ---
    const fromStopIndex = currentTrackingStopIndex;
    const toStopIndex = currentTrackingStopIndex + 1;

    if (fromStopIndex < 0 || toStopIndex >= currentRouteStops.length) { // Aún antes de la primera o ya pasó la última
        document.getElementById('time-difference-display').textContent = (fromStopIndex < 0) ? "Iniciando..." : "FIN";
        document.getElementById('time-difference-display').className = "";
        updatePassengerTrackingStatus(true); // Actualizar estado general
        return;
    }

    const fromStop = currentRouteStops[fromStopIndex];
    const toStop = currentRouteStops[toStopIndex];
    
    const [depH, depM] = fromStop.departureTime.split(':').map(Number);
    let departureDateTime = new Date(); departureDateTime.setHours(depH, depM, 0, 0);
    const [arrH, arrM] = toStop.arrivalTime.split(':').map(Number);
    let scheduledArrivalDateTimeAtNextStop = new Date(); scheduledArrivalDateTimeAtNextStop.setHours(arrH, arrM, 0, 0);

    if (scheduledArrivalDateTimeAtNextStop.getTime() < departureDateTime.getTime()) {
        scheduledArrivalDateTimeAtNextStop.setDate(scheduledArrivalDateTimeAtNextStop.getDate() + 1);
    }

    const totalLegScheduledTimeMillis = scheduledArrivalDateTimeAtNextStop.getTime() - departureDateTime.getTime();
    if (totalLegScheduledTimeMillis < 0 ) { 
        console.warn("SmartMovePro: Tiempo de tramo inválido.", fromStop, toStop);
        document.getElementById('time-difference-display').textContent = "Error Horario";
        updatePassengerTrackingStatus(true, true, "Error Horario Tramo");
        return;
    }

    const coordA = L.latLng(fromStop.lat, fromStop.lng);
    const coordB = L.latLng(toStop.lat, toStop.lng);
    const totalLegDistance = coordA.distanceTo(coordB);
    const distanceFromStartOfLeg = currentDriverLatLng.distanceTo(coordA); // Distancia desde el inicio del tramo actual

    let proportionOfDistanceCovered = 0;
    if (totalLegDistance > 1) {
        proportionOfDistanceCovered = distanceFromStartOfLeg / totalLegDistance;
        // Clamp: el conductor puede estar antes del inicio del tramo (negativo) o después del fin (mayor a 1)
        // Esto es importante para el cálculo de tiempo "ideal"
        // proportionOfDistanceCovered = Math.max(0, Math.min(1, proportionOfDistanceCovered));
        // No clampear aquí permite que el cálculo refleje si está "antes" o "después" del tramo.
    } else if (distanceFromStartOfLeg > 1 && totalLegDistance <=1) { // Paradas en mismo sitio, pero se movió
        proportionOfDistanceCovered = 1; // Considerar cubierto
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
}


// --- FUNCIÓN PARA ACTUALIZAR DATOS PARA PASAJEROS ---
function updatePassengerTrackingStatus(isCurrentlyTracking, hasError = false, errorReason = "") {
    let statusPayload;
    if (!isCurrentlyTracking || hasError) {
        statusPayload = { 
            isTracking: isCurrentlyTracking, // Podría estar "rastreando" pero con error
            hasError: hasError, 
            errorReason: errorReason,
            lastUpdateTime: new Date().getTime() 
        };
    } else {
        if (currentTrackingRouteIndex < 0 || currentTrackingRouteIndex >= trackingQueue.length) {
            statusPayload = { isTracking: false, lastUpdateTime: new Date().getTime(), reason: "Invalid tracking route index" };
        } else {
            const currentRouteForPassenger = trackingQueue[currentTrackingRouteIndex];
            const currentRouteStopsForPassenger = currentRouteForPassenger.stops;
            
            let nextStopDataForPassengerObj = null;
            let nextBusStopArrivalTime = null;
            let nextBusStopDepartureTime = null;

            if (currentTrackingStopIndex + 1 < currentRouteStopsForPassenger.length) {
                 nextStopDataForPassengerObj = currentRouteStopsForPassenger[currentTrackingStopIndex + 1];
                 nextBusStopArrivalTime = nextStopDataForPassengerObj.arrivalTime;
                 nextBusStopDepartureTime = nextStopDataForPassengerObj.departureTime;
            }

            statusPayload = {
                isTracking: true,
                hasError: false,
                routeName: currentRouteForPassenger.name,
                currentRouteIndexInQueue: currentTrackingRouteIndex, 
                trackingQueueNames: trackingQueue.map(route => route.name),
                currentStopIndexFromWhichDeparted: currentTrackingStopIndex,
                nextStopIndexTowardsWhichHeading: currentTrackingStopIndex + 1,
                currentBusDelayOrAheadMillis: lastCalculatedDiffMillis,
                lastKnownPosition: lastKnownPosition,
                lastUpdateTime: new Date().getTime(),
                nextBusStopArrivalTime: nextBusStopArrivalTime,
                nextBusStopDepartureTime: nextBusStopDepartureTime,
                routeStops: currentRouteStopsForPassenger.map(s => ({
                    name: s.name,
                    type: s.type,
                    arrivalTime: s.arrivalTime,
                    departureTime: s.departureTime
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
function timeToMinutes(timeInput) { /* ... (sin cambios) ... */  let hours, minutes; if (typeof timeInput === 'string') { [hours, minutes] = timeInput.split(':').map(Number); } else if (timeInput instanceof Date) { hours = timeInput.getHours(); minutes = timeInput.getMinutes(); } else { return 0; } return hours * 60 + minutes; }
function formatMinutesToTimeDiff(totalMinutesWithFraction) { /* ... (sin cambios) ... */  const sign = totalMinutesWithFraction < 0 ? "-" : "+"; const absTotalMinutes = Math.abs(totalMinutesWithFraction); let mm = Math.floor(absTotalMinutes); let ss = Math.round((absTotalMinutes - mm) * 60); if (ss === 60) { mm += 1; ss = 0; } return `${sign}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; }

// --- BINDINGS INICIALES ---
function bindEventListeners() { /* ... (sin cambios) ... */
    document.getElementById('cancel-stop-btn').addEventListener('click', closeStopModal);
    document.getElementById('start-new-route-btn').addEventListener('click', startNewRouteAction);
    document.getElementById('set-start-point-btn').addEventListener('click', () => { settingPointType = 'start'; alert("Toca el mapa para fijar el Punto de Inicio."); });
    document.getElementById('set-end-point-btn').addEventListener('click', () => { if (!currentTempRoute.startPoint) { alert("Primero debes fijar el Punto de Inicio."); return; } settingPointType = 'end'; alert("Toca el mapa para fijar el Punto Final."); });
    document.querySelectorAll('.link-button[data-point-type]').forEach(button => { button.addEventListener('click', (event) => { const pointType = event.target.dataset.pointType; let currentPoint = (pointType === 'start') ? currentTempRoute.startPoint : currentTempRoute.endPoint; if (!currentPoint) { alert(`El punto de ${pointType === 'start' ? 'inicio' : 'fin'} aún no ha sido fijado.`); return; } const newName = prompt(`Nuevo nombre para el Punto de ${pointType === 'start' ? 'Inicio' : 'Fin'}:`, currentPoint.name); if (newName && newName.trim() !== "") { currentPoint.name = newName.trim(); document.getElementById(`${pointType}-point-name-display`).textContent = currentPoint.name; renderCurrentStopsList(); } }); });
    document.getElementById('start-time-input').addEventListener('change', (event) => { if (currentTempRoute.startPoint) { currentTempRoute.startPoint.departureTime = event.target.value; if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } });
    document.getElementById('end-time-input').addEventListener('change', (event) => { if (currentTempRoute.endPoint) { currentTempRoute.endPoint.arrivalTime = event.target.value; if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } });
    document.getElementById('auto-time-intermediate-checkbox').addEventListener('change', () => { if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); });
    document.getElementById('current-stops-list').addEventListener('click', (event) => { const target = event.target; if (target.tagName === 'BUTTON' && target.dataset.action) { const action = target.dataset.action; const index = parseInt(target.dataset.index); if (action === 'edit-intermediate') { openStopModal(currentTempRoute.intermediateStops[index], index); } else if (action === 'remove-intermediate') { if (isTracking) { alert("Detén el seguimiento para eliminar paradas."); return; } currentTempRoute.intermediateStops.splice(index, 1); if (document.getElementById('auto-time-intermediate-checkbox').checked) { recalculateIntermediateStopTimes(); } renderCurrentStopsList(); } } });
    document.getElementById('save-stop-btn').addEventListener('click', saveStopModalAction);
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
window.addEventListener('beforeunload', () => { /* ... */ });
