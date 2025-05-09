// js/app.js

// --- Constants ---
const LOCALSTORAGE_ROUTES_KEY = 'smartMoveProRoutes';
const LOCALSTORAGE_TRACKING_STATUS_KEY = 'smartMoveProTrackingStatus';
const PROXIMITY_THRESHOLD_METERS = 50;
const GEOFENCE_RADIUS_METERS = 100;
const TRACKING_UPDATE_INTERVAL = 3000; // ms, for localStorage publishing

// --- Global Variables ---
let map;
let currentRoute = {
    name: '',
    startPoint: null, // { lat, lng, name, time (HH:MM string) }
    endPoint: null,   // { lat, lng, name, time (HH:MM string) }
    intermediateStops: [] // { lat, lng, name, arrivalTime (HH:MM), departureTime (HH:MM) }
};
let editingMode = null; // 'start', 'end', 'intermediate', or null
let editMarkersLayer = L.featureGroup();
let editRouteLinesLayer = L.featureGroup();

let trackingLayer = L.featureGroup();
let currentPositionMarker = null;
let startGeofenceCircle = null;
let endGeofenceCircle = null;

let savedRoutes = [];
let trackingQueue = []; // Array of route names
let currentTrackingRoute = null; // Full route object being tracked
let currentTrackingRouteIndexInQueue = -1;
let currentTrackingStopIndex = -1; // -1: at start, 0: en route to first intermediate (index 1 of allStops), etc.
let isTracking = false;
let watchId = null;
let lastKnownPosition = null;
let timeDifferenceInterval = null;
let trackingStatusUpdateInterval = null;

// --- DOM Elements ---
const DOMElements = {
    routeNameInput: document.getElementById('routeName'),
    startPointCoords: document.getElementById('startPointCoords'),
    startPointNameInput: document.getElementById('startPointName'),
    startPointTimeInput: document.getElementById('startPointTime'),
    setStartPointBtn: document.getElementById('setStartPointBtn'),
    endPointCoords: document.getElementById('endPointCoords'),
    endPointNameInput: document.getElementById('endPointName'),
    endPointTimeInput: document.getElementById('endPointTime'),
    setEndPointBtn: document.getElementById('setEndPointBtn'),
    autoCalcTimesCheckbox: document.getElementById('autoCalcTimes'),
    intermediateStopInstruction: document.getElementById('intermediateStopInstruction'),
    stopsListDiv: document.getElementById('stopsList'),
    saveRouteBtn: document.getElementById('saveRouteBtn'),
    resetEditorBtn: document.getElementById('resetEditorBtn'),
    savedRoutesDropdown: document.getElementById('savedRoutesDropdown'),
    loadRouteBtn: document.getElementById('loadRouteBtn'),
    deleteRouteBtn: document.getElementById('deleteRouteBtn'),
    addSelectedRouteToQueueBtn: document.getElementById('addSelectedRouteToQueueBtn'),
    trackingQueueList: document.getElementById('trackingQueueList'),
    clearQueueBtn: document.getElementById('clearQueueBtn'),
    startTrackingBtn: document.getElementById('startTrackingBtn'),
    stopTrackingBtn: document.getElementById('stopTrackingBtn'),
    manualControlCheckbox: document.getElementById('manualControlCheckbox'),
    prevStopBtn: document.getElementById('prevStopBtn'),
    nextStopBtn: document.getElementById('nextStopBtn'),
    activeRouteNameSpan: document.getElementById('activeRouteName'),
    nextStopInfoSpan: document.getElementById('nextStopInfo'),
    timeDifferenceSpan: document.getElementById('timeDifference'),
    gpsStatusSpan: document.getElementById('gpsStatus'),
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
    initMap();
    loadRoutesFromStorage(); // Load existing routes
    updateSavedRoutesDropdown(); // Populate dropdown
    setupEventListeners();
    registerServiceWorker();
    resetRouteEditor(); // Initialize editor state
    DOMElements.gpsStatusSpan.textContent = 'Inactivo';
    updateIntermediateInstruction();
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => console.log('Service Worker registered with scope:', registration.scope))
            .catch(error => console.error('Service Worker registration failed:', error));
    }
}

// --- Map Functions ---
function initMap() {
    map = L.map('map').setView([-34.6037, -58.3816], 13); // Buenos Aires default

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
    }).addTo(map);

    editMarkersLayer.addTo(map);
    editRouteLinesLayer.addTo(map);
    trackingLayer.addTo(map);

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            map.setView([position.coords.latitude, position.coords.longitude], 15);
        }, () => {
            console.warn('No se pudo obtener la ubicación para centrar el mapa inicialmente.');
            alert('No se pudo obtener la ubicación para centrar el mapa. Asegúrese de tener los permisos activados.');
        }, { timeout: 10000 });
    }

    map.on('click', handleMapClickForEditing);
}

function createStopIcon(type, text = '') {
    let className = 'leaflet-marker-icon ';
    let htmlContent = '';
    let iconSize = [28, 28]; 
    let iconAnchor = [14, 28]; 

    if (type === 'start') {
        className += 'start-icon'; htmlContent = 'I';
    } else if (type === 'end') {
        className += 'end-icon'; htmlContent = 'F';
    } else if (type === 'intermediate') {
        className += 'intermediate-icon'; htmlContent = text;
        iconSize = [24, 24]; iconAnchor = [12, 24];
    } else { // Should not happen for route points
        return L.divIcon({ className: 'unknown-icon', html: '?', iconSize: [20,20], iconAnchor: [10,20]});
    }

    return L.divIcon({
        className: className.trim(), // Ensure no leading/trailing space
        html: `<div>${htmlContent}</div>`,
        iconSize: L.point(iconSize[0], iconSize[1]),
        iconAnchor: L.point(iconAnchor[0], iconAnchor[1]),
        popupAnchor: L.point(0, -iconSize[1]/2)
    });
}

function addMarkerToLayer(layer, latlng, type, text = '', popupContent = '') {
    const icon = createStopIcon(type, text);
    const marker = L.marker(latlng, { icon: icon, draggable: false });
    if (popupContent) {
        marker.bindPopup(popupContent);
    }
    layer.addLayer(marker);
    return marker;
}

function drawRouteOnMap(routePoints, targetLayer, color = 'blue', isEditing = false) {
    targetLayer.clearLayers(); // Clear only the specific layer
    if (!routePoints || routePoints.length < 1) return;

    if (routePoints.length > 1) {
        const latlngs = routePoints.map(p => [p.lat, p.lng]);
        L.polyline(latlngs, { 
            color: color, 
            weight: isEditing ? 3 : 5, 
            dashArray: isEditing ? '5, 5' : null 
        }).addTo(targetLayer);
    }

    routePoints.forEach((point, index) => {
        let type, text;
        if (index === 0 && point.type === 'start') { // Ensure it's marked as start
            type = 'start'; text = 'I';
        } else if (index === routePoints.length - 1 && point.type === 'end') { // Ensure it's marked as end
            type = 'end'; text = 'F';
        } else { // Intermediate
            type = 'intermediate'; 
            // Find original index for numbering (if points array is a mix)
            const originalIndex = currentRoute.intermediateStops.findIndex(s => s.lat === point.lat && s.lng === point.lng);
            text = (originalIndex !== -1) ? (originalIndex + 1).toString() : (index).toString(); // Fallback to simple index
        }
        const popupName = point.name || (type === 'start' ? 'Inicio' : type === 'end' ? 'Fin' : `Parada ${text}`);
        addMarkerToLayer(targetLayer, [point.lat, point.lng], type, text, popupName);
    });
}


function clearEditMap() {
    editMarkersLayer.clearLayers();
    editRouteLinesLayer.clearLayers();
}

function redrawEditMap() {
    clearEditMap();
    const pointsForDrawing = [];
    if (currentRoute.startPoint) {
        pointsForDrawing.push({ ...currentRoute.startPoint, type: 'start' });
    }
    currentRoute.intermediateStops.forEach(stop => {
        pointsForDrawing.push({ ...stop, type: 'intermediate' });
    });
    if (currentRoute.endPoint) {
        pointsForDrawing.push({ ...currentRoute.endPoint, type: 'end' });
    }
    
    drawRouteOnMap(pointsForDrawing, editMarkersLayer, 'dodgerblue', true); // Using editMarkersLayer for both markers and lines in edit mode
}


function updateCurrentPositionMarker(lat, lng) {
    if (!currentPositionMarker) {
        currentPositionMarker = L.circleMarker([lat, lng], { 
            radius: 8, color: 'white', weight:2, fillColor: '#007bff', fillOpacity: 1, interactive:false 
        }).addTo(trackingLayer).bindPopup("Posición Actual");
    } else {
        currentPositionMarker.setLatLng([lat, lng]);
    }
    // Optional: map.panTo([lat, lng]); if you want map to follow, but can be annoying
}

function drawGeofences(startPoint, endPoint) {
    clearGeofences(); // Clear existing before drawing new ones
    if (startPoint && startPoint.lat && startPoint.lng) {
        startGeofenceCircle = L.circle([startPoint.lat, startPoint.lng], {
            radius: GEOFENCE_RADIUS_METERS, color: '#28a745', fillColor: '#28a745', fillOpacity: 0.1, interactive:false
        }).addTo(trackingLayer);
    }
    if (endPoint && endPoint.lat && endPoint.lng) {
        endGeofenceCircle = L.circle([endPoint.lat, endPoint.lng], {
            radius: GEOFENCE_RADIUS_METERS, color: '#dc3545', fillColor: '#dc3545', fillOpacity: 0.1, interactive:false
        }).addTo(trackingLayer);
    }
}

function clearGeofences() {
    if (startGeofenceCircle && trackingLayer.hasLayer(startGeofenceCircle)) trackingLayer.removeLayer(startGeofenceCircle);
    if (endGeofenceCircle && trackingLayer.hasLayer(endGeofenceCircle)) trackingLayer.removeLayer(endGeofenceCircle);
    startGeofenceCircle = null;
    endGeofenceCircle = null;
}

function clearTrackingMapElements() {
    trackingLayer.clearLayers(); // Clears current pos marker, route lines, stop markers, geofences
    currentPositionMarker = null;
    startGeofenceCircle = null;
    endGeofenceCircle = null;
}

// --- Route Editing Functions ---
function handleMapClickForEditing(e) {
    if (!editingMode) return;
    const { lat, lng } = e.latlng;

    if (editingMode === 'start') {
        currentRoute.startPoint = { lat, lng, name: DOMElements.startPointNameInput.value.trim(), time: DOMElements.startPointTimeInput.value };
        DOMElements.startPointCoords.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        DOMElements.setStartPointBtn.textContent = "Modificar Inicio";
        DOMElements.setEndPointBtn.disabled = false;
        editingMode = null; // Exit map click mode for start/end after one click
    } else if (editingMode === 'end') {
        currentRoute.endPoint = { lat, lng, name: DOMElements.endPointNameInput.value.trim(), time: DOMElements.endPointTimeInput.value };
        DOMElements.endPointCoords.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        DOMElements.setEndPointBtn.textContent = "Modificar Fin";
        editingMode = null; // Exit map click mode
    } else if (editingMode === 'intermediate' && currentRoute.startPoint && currentRoute.endPoint) {
        const stopName = prompt("Nombre de la parada intermedia (opcional):");
        let arrivalTime = null, departureTime = null;
        if (!DOMElements.autoCalcTimesCheckbox.checked) {
            const timeStr = prompt("Hora de llegada/paso para esta parada (HH:MM):");
            if (timeStr && /^\d{2}:\d{2}$/.test(timeStr)) {
                arrivalTime = timeStr;
                departureTime = timeStr; // Assume pass-through
            } else if (timeStr) { // User entered something, but it's invalid
                alert("Formato de hora inválido. La parada se agregará sin hora manual.");
            }
        }
        currentRoute.intermediateStops.push({ lat, lng, name: stopName ? stopName.trim() : '', arrivalTime, departureTime });
        if (DOMElements.autoCalcTimesCheckbox.checked) {
            calculateIntermediateTimes(); // This will also update UI
        }
    }
    updateStopsListUI();
    redrawEditMap();
    checkCanSaveRoute();
    updateIntermediateInstruction();
}

function setStartPointMode() {
    editingMode = 'start';
    DOMElements.setStartPointBtn.classList.add('editing-active'); // Visual feedback
    DOMElements.setEndPointBtn.classList.remove('editing-active');
    alert("Toque el mapa para definir el Punto de Inicio.");
}

function setEndPointMode() {
    if (!currentRoute.startPoint) {
        alert("Defina primero el Punto de Inicio.");
        return;
    }
    editingMode = 'end';
    DOMElements.setEndPointBtn.classList.add('editing-active');
    DOMElements.setStartPointBtn.classList.remove('editing-active');
    alert("Toque el mapa para definir el Punto Final.");
}

function updateIntermediateInstruction() {
    if (currentRoute.startPoint && currentRoute.endPoint) {
        DOMElements.intermediateStopInstruction.textContent = "Modo 'Añadir Paradas Intermedias' ACTIVO. Toque el mapa.";
        DOMElements.intermediateStopInstruction.style.color = 'green';
        editingMode = 'intermediate'; // Automatically enable intermediate mode
    } else {
        DOMElements.intermediateStopInstruction.textContent = "Defina Inicio y Fin para habilitar la adición de paradas intermedias.";
        DOMElements.intermediateStopInstruction.style.color = 'red';
        if (editingMode === 'intermediate') editingMode = null;
    }
     // Remove active class from start/end buttons if intermediate mode is now primary
    if (editingMode === 'intermediate') {
        DOMElements.setStartPointBtn.classList.remove('editing-active');
        DOMElements.setEndPointBtn.classList.remove('editing-active');
    }
}


function updateStopsListUI() {
    DOMElements.stopsListDiv.innerHTML = '';
    const ul = document.createElement('ul');

    if (currentRoute.startPoint) {
        const startLi = document.createElement('li');
        let startName = DOMElements.startPointNameInput.value.trim() || currentRoute.startPoint.name || 'Punto de Inicio';
        let startTime = DOMElements.startPointTimeInput.value || currentRoute.startPoint.time;
        startLi.innerHTML = `<span class="stop-details"><strong>Inicio:</strong> ${startName} (Sale: ${startTime || 'HH:MM'})</span>`;
        ul.appendChild(startLi);
    }

    currentRoute.intermediateStops.forEach((stop, index) => {
        const li = document.createElement('li');
        const stopLabel = stop.name || `Parada Intermedia ${index + 1}`;
        const arrival = stop.arrivalTime || 'HH:MM';
        // const departure = stop.departureTime || 'HH:MM'; // Usually same as arrival for intermediate
        li.innerHTML = `
            <span class="stop-details"><strong>${index + 1}:</strong> ${stopLabel} (Pasa: ${arrival})</span>
            <button data-index="${index}" class="delete-stop-btn">Eliminar</button>
        `;
        ul.appendChild(li);
    });

    if (currentRoute.endPoint) {
        const endLi = document.createElement('li');
        let endName = DOMElements.endPointNameInput.value.trim() || currentRoute.endPoint.name || 'Punto Final';
        let endTime = DOMElements.endPointTimeInput.value || currentRoute.endPoint.time;
        endLi.innerHTML = `<span class="stop-details"><strong>Fin:</strong> ${endName} (Llega: ${endTime || 'HH:MM'})</span>`;
        ul.appendChild(endLi);
    }
    DOMElements.stopsListDiv.appendChild(ul);

    DOMElements.stopsListDiv.querySelectorAll('.delete-stop-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            deleteIntermediateStop(parseInt(e.target.dataset.index));
        });
    });
}


function deleteIntermediateStop(index) {
    currentRoute.intermediateStops.splice(index, 1);
    if (DOMElements.autoCalcTimesCheckbox.checked) {
        calculateIntermediateTimes(); // This also calls updateStopsListUI
    } else {
        updateStopsListUI(); // Manual update if not auto-calculating
    }
    redrawEditMap();
    checkCanSaveRoute();
}

function calculateIntermediateTimes() {
    if (!DOMElements.autoCalcTimesCheckbox.checked) {
        updateStopsListUI(); // Just refresh UI if auto-calc is off
        return;
    }
    if (!currentRoute.startPoint || !currentRoute.endPoint || !currentRoute.startPoint.time || !currentRoute.endPoint.time) {
        currentRoute.intermediateStops.forEach(stop => {
            stop.arrivalTime = null; stop.departureTime = null;
        });
        updateStopsListUI();
        return;
    }

    const startDate = parseTime(currentRoute.startPoint.time);
    const endDate = parseTime(currentRoute.endPoint.time);

    if (!startDate || !endDate || endDate <= startDate) {
        console.warn("Tiempos de inicio/fin inválidos para cálculo automático. Horas intermedias no calculadas.");
        currentRoute.intermediateStops.forEach(stop => {
            stop.arrivalTime = null; stop.departureTime = null;
        });
        updateStopsListUI();
        return;
    }

    const totalDurationMillis = endDate.getTime() - startDate.getTime();
    const allPointsForDistCalc = [currentRoute.startPoint, ...currentRoute.intermediateStops, currentRoute.endPoint];
    let totalDistance = 0;
    const segmentDistances = [];

    for (let i = 0; i < allPointsForDistCalc.length - 1; i++) {
        const dist = calculateDistance(allPointsForDistCalc[i].lat, allPointsForDistCalc[i].lng, allPointsForDistCalc[i+1].lat, allPointsForDistCalc[i+1].lng);
        segmentDistances.push(dist);
        totalDistance += dist;
    }

    if (totalDistance === 0 && currentRoute.intermediateStops.length > 0) {
        console.warn("Distancia total es 0. Asignando hora de inicio a paradas intermedias.");
        currentRoute.intermediateStops.forEach(stop => {
            stop.arrivalTime = currentRoute.startPoint.time;
            stop.departureTime = currentRoute.startPoint.time;
        });
        updateStopsListUI();
        return;
    }
    
    if (totalDistance > 0) {
        let accumulatedDistance = 0;
        for (let i = 0; i < currentRoute.intermediateStops.length; i++) {
            // segmentDistances[i] is distance from previous point (start or prev intermediate) to current intermediate one.
            // We need distance from startPoint to intermediateStops[i]
            // For intermediateStops[0], this is segmentDistances[0]
            // For intermediateStops[1], this is segmentDistances[0] + segmentDistances[1]
            accumulatedDistance += segmentDistances[i];
            
            const proportionOfDistance = accumulatedDistance / totalDistance;
            const timeOffsetMillis = totalDurationMillis * proportionOfDistance;
            
            const arrivalTimeDate = new Date(startDate.getTime() + timeOffsetMillis);
            
            currentRoute.intermediateStops[i].arrivalTime = formatTime(arrivalTimeDate);
            currentRoute.intermediateStops[i].departureTime = formatTime(arrivalTimeDate); // Assuming pass-through
        }
    }
    updateStopsListUI();
}

function checkCanSaveRoute() {
    const canSave = DOMElements.routeNameInput.value.trim() !== '' &&
                    currentRoute.startPoint && currentRoute.startPoint.time &&
                    currentRoute.endPoint && currentRoute.endPoint.time;
    DOMElements.saveRouteBtn.disabled = !canSave;
    return canSave;
}

function resetRouteEditor() {
    currentRoute = { name: '', startPoint: null, endPoint: null, intermediateStops: [] };
    DOMElements.routeNameInput.value = '';
    DOMElements.startPointCoords.textContent = 'No definido';
    DOMElements.startPointNameInput.value = '';
    DOMElements.startPointTimeInput.value = '';
    DOMElements.endPointCoords.textContent = 'No definido';
    DOMElements.endPointNameInput.value = '';
    DOMElements.endPointTimeInput.value = '';
    DOMElements.autoCalcTimesCheckbox.checked = true;
    
    DOMElements.setStartPointBtn.textContent = "Definir Inicio (Mapa)";
    DOMElements.setEndPointBtn.textContent = "Definir Fin (Mapa)";
    DOMElements.setStartPointBtn.classList.remove('editing-active');
    DOMElements.setEndPointBtn.classList.remove('editing-active');
    DOMElements.setEndPointBtn.disabled = true;
    
    editingMode = null;
    clearEditMap();
    updateStopsListUI();
    checkCanSaveRoute();
    updateIntermediateInstruction();
}


// --- Route Management (localStorage) ---
function saveRoute() {
    if (!checkCanSaveRoute()) {
        alert("Complete todos los campos requeridos para la ruta (Nombre, Inicio con hora, Fin con hora).");
        return;
    }
    
    const routeName = DOMElements.routeNameInput.value.trim();
    currentRoute.name = routeName; // Ensure route name is up-to-date
    currentRoute.startPoint.name = DOMElements.startPointNameInput.value.trim() || "Inicio";
    currentRoute.startPoint.time = DOMElements.startPointTimeInput.value;
    currentRoute.endPoint.name = DOMElements.endPointNameInput.value.trim() || "Fin";
    currentRoute.endPoint.time = DOMElements.endPointTimeInput.value;

    if (DOMElements.autoCalcTimesCheckbox.checked) {
        calculateIntermediateTimes(); // Ensure times are fresh if auto-calc is on
    } // If not checked, manually entered/existing times for intermediate stops are preserved.

    const existingRouteIndex = savedRoutes.findIndex(r => r.name === routeName);
    if (existingRouteIndex !== -1) {
        if (!confirm(`La ruta "${routeName}" ya existe. ¿Desea sobrescribirla?`)) {
            return;
        }
        savedRoutes[existingRouteIndex] = JSON.parse(JSON.stringify(currentRoute)); // Deep copy
    } else {
        savedRoutes.push(JSON.parse(JSON.stringify(currentRoute)));
    }

    try {
        localStorage.setItem(LOCALSTORAGE_ROUTES_KEY, JSON.stringify(savedRoutes));
        alert(`Ruta "${routeName}" guardada.`);
        updateSavedRoutesDropdown();
        resetRouteEditor();
    } catch (e) {
        alert("Error al guardar la ruta. Es posible que el almacenamiento esté lleno.");
        console.error("Error saving to localStorage:", e);
    }
}

function loadRoutesFromStorage() {
    try {
        const routesJSON = localStorage.getItem(LOCALSTORAGE_ROUTES_KEY);
        savedRoutes = routesJSON ? JSON.parse(routesJSON) : [];
    } catch (e) {
        console.error("Error loading routes from localStorage:", e);
        savedRoutes = [];
        alert("Error al cargar rutas guardadas. Podrían estar corruptas.");
    }
}

function updateSavedRoutesDropdown() {
    DOMElements.savedRoutesDropdown.innerHTML = ''; // Clear existing options
    if (savedRoutes.length === 0) {
        DOMElements.savedRoutesDropdown.innerHTML = '<option value="">-- Sin rutas guardadas --</option>';
    } else {
        DOMElements.savedRoutesDropdown.innerHTML = '<option value="">Seleccione una ruta...</option>';
        savedRoutes.forEach(route => {
            const option = document.createElement('option');
            option.value = route.name;
            option.textContent = route.name;
            DOMElements.savedRoutesDropdown.appendChild(option);
        });
    }
    const hasRoutes = savedRoutes.length > 0;
    DOMElements.loadRouteBtn.disabled = !hasRoutes;
    DOMElements.deleteRouteBtn.disabled = !hasRoutes;
    DOMElements.addSelectedRouteToQueueBtn.disabled = !hasRoutes;
}

function loadSelectedRoute() {
    const routeName = DOMElements.savedRoutesDropdown.value;
    if (!routeName) {
        alert("Seleccione una ruta para cargar.");
        return;
    }
    const routeToLoad = savedRoutes.find(r => r.name === routeName);
    if (routeToLoad) {
        currentRoute = JSON.parse(JSON.stringify(routeToLoad)); // Deep copy

        DOMElements.routeNameInput.value = currentRoute.name;
        if (currentRoute.startPoint) {
            DOMElements.startPointNameInput.value = currentRoute.startPoint.name || '';
            DOMElements.startPointTimeInput.value = currentRoute.startPoint.time || '';
            DOMElements.startPointCoords.textContent = `${currentRoute.startPoint.lat.toFixed(5)}, ${currentRoute.startPoint.lng.toFixed(5)}`;
        }
        if (currentRoute.endPoint) {
            DOMElements.endPointNameInput.value = currentRoute.endPoint.name || '';
            DOMElements.endPointTimeInput.value = currentRoute.endPoint.time || '';
            DOMElements.endPointCoords.textContent = `${currentRoute.endPoint.lat.toFixed(5)}, ${currentRoute.endPoint.lng.toFixed(5)}`;
        }
        
        // Infer autoCalcTimes state (heuristic: if all intermediate stops have times, and start/end have times)
        const wasLikelyAutoCalculated = currentRoute.intermediateStops.every(stop => !!stop.arrivalTime && !!stop.departureTime) &&
                                       currentRoute.startPoint && !!currentRoute.startPoint.time &&
                                       currentRoute.endPoint && !!currentRoute.endPoint.time &&
                                       currentRoute.intermediateStops.length > 0;
        DOMElements.autoCalcTimesCheckbox.checked = wasLikelyAutoCalculated || currentRoute.intermediateStops.length === 0;


        updateStopsListUI();
        redrawEditMap();
        
        DOMElements.setStartPointBtn.textContent = "Modificar Inicio";
        DOMElements.setEndPointBtn.textContent = "Modificar Fin";
        DOMElements.setEndPointBtn.disabled = !currentRoute.startPoint;
        checkCanSaveRoute(); 
        editingMode = null; 
        updateIntermediateInstruction();

        if (currentRoute.startPoint) {
            map.setView([currentRoute.startPoint.lat, currentRoute.startPoint.lng], 15);
        }
    }
}

function deleteSelectedRoute() {
    const routeName = DOMElements.savedRoutesDropdown.value;
    if (!routeName) {
        alert("Seleccione una ruta para eliminar.");
        return;
    }
    if (confirm(`¿Está seguro de que desea eliminar la ruta "${routeName}"? Esta acción no se puede deshacer.`)) {
        savedRoutes = savedRoutes.filter(r => r.name !== routeName);
        try {
            localStorage.setItem(LOCALSTORAGE_ROUTES_KEY, JSON.stringify(savedRoutes));
            alert(`Ruta "${routeName}" eliminada.`);
            updateSavedRoutesDropdown();
            if (DOMElements.routeNameInput.value === routeName) { // If deleted route was in editor
                resetRouteEditor();
            }
        } catch (e) {
            alert("Error al eliminar la ruta del almacenamiento.");
            console.error("Error deleting from localStorage:", e);
        }
    }
}


// --- Tracking Queue Functions ---
function addRouteToTrackingQueue() {
    const routeName = DOMElements.savedRoutesDropdown.value;
    if (!routeName) {
        alert("Seleccione una ruta guardada para añadir a la cola.");
        return;
    }
    const routeExists = savedRoutes.find(r => r.name === routeName);
    if (!routeExists) { // Should not happen if dropdown is synced
        alert("La ruta seleccionada ya no existe. Por favor, recargue.");
        return;
    }
    trackingQueue.push(routeName);
    updateTrackingQueueUI();
    DOMElements.startTrackingBtn.disabled = trackingQueue.length === 0 || isTracking;
}

function updateTrackingQueueUI() {
    DOMElements.trackingQueueList.innerHTML = '';
    trackingQueue.forEach((routeName, index) => {
        const li = document.createElement('li');
        li.textContent = routeName;
        if (index === currentTrackingRouteIndexInQueue && isTracking) {
            li.classList.add('active-tracking-route');
            li.textContent += " (En curso)";
        }
        DOMElements.trackingQueueList.appendChild(li);
    });
    DOMElements.clearQueueBtn.disabled = trackingQueue.length === 0 || isTracking;
}

function clearTrackingQueue() {
    if (isTracking) {
        alert("No se puede limpiar la cola mientras el seguimiento está activo.");
        return;
    }
    trackingQueue = [];
    currentTrackingRouteIndexInQueue = -1;
    updateTrackingQueueUI();
    DOMElements.startTrackingBtn.disabled = true;
}


// --- Real-Time Tracking Functions ---
function startTracking() {
    if (isTracking) return;
    if (trackingQueue.length === 0) {
        alert("Añada al menos una ruta a la cola de seguimiento.");
        return;
    }
    if (!navigator.geolocation) {
        alert("Geolocalización no es soportada por su navegador.");
        publishTrackingStatusToLocalStorage(false, true, "Geolocalización no soportada");
        return;
    }

    isTracking = true;
    DOMElements.startTrackingBtn.disabled = true;
    DOMElements.stopTrackingBtn.disabled = false;
    DOMElements.manualControlCheckbox.disabled = false;
    DOMElements.prevStopBtn.disabled = !DOMElements.manualControlCheckbox.checked;
    DOMElements.nextStopBtn.disabled = !DOMElements.manualControlCheckbox.checked;
    
    // Disable route editing/management while tracking
    DOMElements.addSelectedRouteToQueueBtn.disabled = true;
    DOMElements.clearQueueBtn.disabled = true;
    DOMElements.loadRouteBtn.disabled = true;
    DOMElements.deleteRouteBtn.disabled = true;
    DOMElements.saveRouteBtn.disabled = true;
    DOMElements.resetEditorBtn.disabled = true;

    DOMElements.gpsStatusSpan.textContent = 'Activando GPS...';

    currentTrackingRouteIndexInQueue = 0;
    loadNextRouteForTracking(); // This also publishes initial status

    watchId = navigator.geolocation.watchPosition(handleGeoSuccess, handleGeoError, {
        enableHighAccuracy: true, timeout: 20000, maximumAge: 0
    });

    if (timeDifferenceInterval) clearInterval(timeDifferenceInterval);
    timeDifferenceInterval = setInterval(updateTrackingStatusDisplay, 1000);

    if (trackingStatusUpdateInterval) clearInterval(trackingStatusUpdateInterval);
    trackingStatusUpdateInterval = setInterval(() => publishTrackingStatusToLocalStorage(), TRACKING_UPDATE_INTERVAL);
}

function stopTracking(normalStop = true, errorReason = null) {
    if (!isTracking && normalStop) return; // Avoid multiple calls if already stopped normally

    isTracking = false; // Set this first
    if (watchId) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (timeDifferenceInterval) clearInterval(timeDifferenceInterval);
    timeDifferenceInterval = null;
    if (trackingStatusUpdateInterval) clearInterval(trackingStatusUpdateInterval);
    trackingStatusUpdateInterval = null;

    DOMElements.startTrackingBtn.disabled = trackingQueue.length === 0;
    DOMElements.stopTrackingBtn.disabled = true;
    DOMElements.manualControlCheckbox.disabled = true;
    DOMElements.prevStopBtn.disabled = true;
    DOMElements.nextStopBtn.disabled = true;

    // Re-enable route editing/management
    DOMElements.addSelectedRouteToQueueBtn.disabled = savedRoutes.length === 0;
    DOMElements.clearQueueBtn.disabled = trackingQueue.length === 0;
    DOMElements.loadRouteBtn.disabled = savedRoutes.length === 0;
    DOMElements.deleteRouteBtn.disabled = savedRoutes.length === 0;
    checkCanSaveRoute(); // saveRouteBtn might be re-enabled if editor has valid route
    DOMElements.resetEditorBtn.disabled = false;


    DOMElements.gpsStatusSpan.textContent = 'Inactivo';
    if (normalStop) { // Only clear these if it's a normal stop, not an error that might be temporary
      DOMElements.activeRouteNameSpan.textContent = '-';
      DOMElements.nextStopInfoSpan.textContent = '-';
      DOMElements.timeDifferenceSpan.textContent = '-';
      clearTrackingMapElements();
    }
    updateTrackingQueueUI(); // Remove "(En curso)"

    publishTrackingStatusToLocalStorage(false, !normalStop, errorReason); // Final status: isTracking=false
    console.log(normalStop ? "Seguimiento detenido." : `Seguimiento detenido por error: ${errorReason}`);
    
    // Don't reset currentTrackingRoute or indices here, they are part of the last published status
}

function loadNextRouteForTracking() {
    clearTrackingMapElements(); // Clear previous route's map elements first

    if (currentTrackingRouteIndexInQueue >= trackingQueue.length) {
        alert("Fin de todas las rutas en la cola.");
        stopTracking();
        return;
    }

    const routeName = trackingQueue[currentTrackingRouteIndexInQueue];
    const routeToTrack = savedRoutes.find(r => r.name === routeName);

    if (!routeToTrack) {
        const errorMsg = `Ruta "${routeName}" no encontrada para seguimiento. Saltando a la siguiente.`;
        alert(errorMsg);
        console.error(errorMsg);
        publishTrackingStatusToLocalStorage(true, true, errorMsg); // isTracking, hasError, errorReason
        currentTrackingRouteIndexInQueue++;
        loadNextRouteForTracking();
        return;
    }

    currentTrackingRoute = JSON.parse(JSON.stringify(routeToTrack));
    currentTrackingStopIndex = -1; // Reset to start of new route
    
    DOMElements.activeRouteNameSpan.textContent = currentTrackingRoute.name;
    updateTrackingQueueUI();
    
    const allStopsForMap = [
        {...currentTrackingRoute.startPoint, type:'start'},
        ...currentTrackingRoute.intermediateStops.map(s => ({...s, type:'intermediate'})),
        {...currentTrackingRoute.endPoint, type:'end'}
    ];
    drawRouteOnMap(allStopsForMap, trackingLayer, '#28a745', false); // Green for tracking
    drawGeofences(currentTrackingRoute.startPoint, currentTrackingRoute.endPoint);

    updateTrackingStatusDisplay(); // Update next stop info, time diff etc.
    publishTrackingStatusToLocalStorage(); // Publish initial status for this new route
    
    if (lastKnownPosition && !DOMElements.manualControlCheckbox.checked) {
         findAndSetCurrentLeg(); // Attempt re-sync if GPS was active
    }
    console.log(`Seguimiento iniciado para ruta: ${currentTrackingRoute.name}`);
}


function handleGeoSuccess(position) {
    lastKnownPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp
    };
    DOMElements.gpsStatusSpan.textContent = `Activo (Precisión: ${position.coords.accuracy.toFixed(0)}m)`;
    updateCurrentPositionMarker(lastKnownPosition.lat, lastKnownPosition.lng);

    if (!isTracking || !currentTrackingRoute) return;

    if (!DOMElements.manualControlCheckbox.checked) {
        checkProximityAndAdvance();
    }
    // updateTrackingStatusDisplay is called by its own interval
    // publishTrackingStatusToLocalStorage is called by its own interval
}

function handleGeoError(error) {
    let message = 'Error GPS: ';
    switch (error.code) {
        case error.PERMISSION_DENIED: message += "Permiso denegado."; break;
        case error.POSITION_UNAVAILABLE: message += "Posición no disponible."; break;
        case error.TIMEOUT: message += "Timeout al obtener posición."; break;
        default: message += "Error desconocido."; break;
    }
    DOMElements.gpsStatusSpan.textContent = message;
    console.error(message, error);
    // Do not stop tracking for transient errors, but publish the error state
    if (isTracking) {
        publishTrackingStatusToLocalStorage(true, true, message); // isTracking, hasError, errorReason
    }
}


function getCalculatedTimeDifferenceMillis() {
    if (!isTracking || !currentTrackingRoute || !currentTrackingRoute.startPoint.time) return 0;

    const now = new Date();
    let scheduledTimeMillisForCurrentState;
    let delayOrAheadMillis = 0;

    if (currentTrackingStopIndex === -1) { // At start point
        const scheduledDepartureDate = parseTime(currentTrackingRoute.startPoint.time);
        if (!scheduledDepartureDate) return 0;
        // Positive if bus is early (scheduled time is in future), negative if late (scheduled time is in past)
        delayOrAheadMillis = scheduledDepartureDate.getTime() - now.getTime(); 
    } else { // En route or at/past an intermediate stop
        const allStops = [currentTrackingRoute.startPoint, ...currentTrackingRoute.intermediateStops, currentTrackingRoute.endPoint];
        
        if (currentTrackingStopIndex >= allStops.length -1 ) { // Arrived at final destination or beyond
             const finalArrivalDate = parseTime(allStops[allStops.length-1].time); // End point time is arrival
             if (!finalArrivalDate) return 0;
             delayOrAheadMillis = finalArrivalDate.getTime() - now.getTime(); 
        } else { // En route between stops
            const fromStop = allStops[currentTrackingStopIndex];
            const toStop = allStops[currentTrackingStopIndex + 1];

            // For startPoint, departureTime is 'time'. For intermediate, it's 'departureTime'.
            const scheduledDepartureFromDate = parseTime(fromStop.departureTime || fromStop.time); 
            // For endPoint, arrivalTime is 'time'. For intermediate, it's 'arrivalTime'.
            const scheduledArrivalAtToDate = parseTime(toStop.arrivalTime || toStop.time);

            if (!scheduledDepartureFromDate || !scheduledArrivalAtToDate || !lastKnownPosition) return 0;

            const legScheduledDurationMillis = scheduledArrivalAtToDate.getTime() - scheduledDepartureFromDate.getTime();
            if (legScheduledDurationMillis <= 0 && !(fromStop.lat === toStop.lat && fromStop.lng === toStop.lng)) {
                 console.warn("Duración del tramo programada es <= 0. No se puede calcular diferencia de tiempo proporcional.");
                 return 0; // Or some indicator of error
            }

            const totalLegDistanceMeters = calculateDistance(fromStop.lat, fromStop.lng, toStop.lat, toStop.lng);
            let proportionOfLegCovered = 0;

            if (totalLegDistanceMeters > 1) { // Use a small threshold to avoid division by zero if stops are very close
                const distToNextStopMeters = calculateDistance(lastKnownPosition.lat, lastKnownPosition.lng, toStop.lat, toStop.lng);
                let distCoveredOnLegMeters = totalLegDistanceMeters - distToNextStopMeters;
                distCoveredOnLegMeters = Math.max(0, Math.min(distCoveredOnLegMeters, totalLegDistanceMeters)); // Clamp
                proportionOfLegCovered = distCoveredOnLegMeters / totalLegDistanceMeters;
            } else { // Stops are virtually at the same place or very close
                proportionOfLegCovered = 1; // Assume leg is completed
            }
            
            const scheduledTimeAtCurrentPositionMillis = scheduledDepartureFromDate.getTime() + (legScheduledDurationMillis * proportionOfLegCovered);
            delayOrAheadMillis = scheduledTimeAtCurrentPositionMillis - now.getTime();
        }
    }
    return delayOrAheadMillis;
}


function updateTrackingStatusDisplay() {
    if (!isTracking || !currentTrackingRoute) {
        DOMElements.nextStopInfoSpan.textContent = '-';
        DOMElements.timeDifferenceSpan.textContent = '-';
        return;
    }

    const allStops = [currentTrackingRoute.startPoint, ...currentTrackingRoute.intermediateStops, currentTrackingRoute.endPoint];
    let nextStopText = "";

    if (currentTrackingStopIndex === -1) { // At start
        nextStopText = `Salida de ${currentTrackingRoute.startPoint.name || 'Inicio'} a las ${currentTrackingRoute.startPoint.time}`;
    } else if (currentTrackingStopIndex < allStops.length - 1) { // En route to next stop (intermediate or final)
        const nextStopData = allStops[currentTrackingStopIndex + 1];
        // For endpoint, name is currentTrackingRoute.endPoint.name and time is currentTrackingRoute.endPoint.time
        // For intermediate, name is nextStopData.name and time is nextStopData.arrivalTime
        const stopName = nextStopData.name || ((currentTrackingStopIndex + 1 === allStops.length - 1) ? (currentTrackingRoute.endPoint.name || 'Fin') : `Parada ${currentTrackingStopIndex + 1}`);
        const stopTime = nextStopData.arrivalTime || nextStopData.time; // .time for endPoint
        nextStopText = `Hacia ${stopName} (Prog: ${stopTime})`;
    } else { // Arrived at final stop of current route
        nextStopText = "Ruta completada. Esperando siguiente ruta o fin.";
    }
    DOMElements.nextStopInfoSpan.textContent = nextStopText;
    DOMElements.timeDifferenceSpan.textContent = formatDelay(getCalculatedTimeDifferenceMillis());
}


function checkProximityAndAdvance() {
    if (!isTracking || !currentTrackingRoute || !lastKnownPosition || DOMElements.manualControlCheckbox.checked) return;

    const allStops = [currentTrackingRoute.startPoint, ...currentTrackingRoute.intermediateStops, currentTrackingRoute.endPoint];

    // 1. Exiting Start Geofence (Transition from -1 to 0)
    if (currentTrackingStopIndex === -1) {
        const distFromStart = calculateDistance(lastKnownPosition.lat, lastKnownPosition.lng, currentTrackingRoute.startPoint.lat, currentTrackingRoute.startPoint.lng);
        if (distFromStart > GEOFENCE_RADIUS_METERS) {
            console.log("Salió de geofence de inicio. Avanzando al primer tramo.");
            advanceToNextStop(); // Will move currentTrackingStopIndex to 0
        }
        return; // Process one state change at a time
    }

    // At this point, currentTrackingStopIndex >= 0

    // 2. Arriving at End Geofence of current route (Transition to next route)
    // This means we are on the leg TOWARDS the final stop.
    // currentTrackingStopIndex would be allStops.length - 2. The target is allStops[allStops.length - 1] (endPoint)
    if (currentTrackingStopIndex === allStops.length - 2) { 
        const distToEnd = calculateDistance(lastKnownPosition.lat, lastKnownPosition.lng, currentTrackingRoute.endPoint.lat, currentTrackingRoute.endPoint.lng);
        if (distToEnd <= GEOFENCE_RADIUS_METERS) {
            console.log("Entró en geofence de fin de ruta. Avanzando a la siguiente ruta.");
            // Mark as arrived at final stop for this route's status, then transition
            currentTrackingStopIndex++; // Now currentTrackingStopIndex = allStops.length - 1
            updateTrackingStatusDisplay();
            publishTrackingStatusToLocalStorage(); // Publish final state for this route
            advanceToNextRouteInQueue(); 
            return;
        }
    }

    // 3. Arriving at Proximity of an Intermediate Stop (Advance to next leg)
    // currentTrackingStopIndex is the stop departed FROM. Target is currentTrackingStopIndex + 1.
    // This should not apply if the next stop is the *final* stop (handled by geofence above).
    // So, only for intermediate stops: target index < allStops.length - 1
    if (currentTrackingStopIndex < allStops.length - 2) { 
        const nextIntermediateStopTarget = allStops[currentTrackingStopIndex + 1];
        const distToNextIntermediate = calculateDistance(lastKnownPosition.lat, lastKnownPosition.lng, nextIntermediateStopTarget.lat, nextIntermediateStopTarget.lng);

        if (distToNextIntermediate <= PROXIMITY_THRESHOLD_METERS) {
            console.log(`Alcanzó proximidad de parada intermedia: ${nextIntermediateStopTarget.name || 'Parada ' + (currentTrackingStopIndex + 1)}`);
            advanceToNextStop(); // Will increment currentTrackingStopIndex
        }
    }
}

function advanceToNextStop(manualOverride = false) {
    if (!isTracking && !manualOverride) return; 
    if (!currentTrackingRoute) return;

    const allStops = [currentTrackingRoute.startPoint, ...currentTrackingRoute.intermediateStops, currentTrackingRoute.endPoint];

    if (currentTrackingStopIndex < allStops.length - 1) {
        currentTrackingStopIndex++;
        console.log(`Avanzado al tramo/parada índice: ${currentTrackingStopIndex}`);
        
        // If manually advanced TO the final stop (index allStops.length - 1)
        if (manualOverride && DOMElements.manualControlCheckbox.checked && currentTrackingStopIndex === allStops.length - 1) {
            updateTrackingStatusDisplay(); // Update display to show "Ruta completada"
            publishTrackingStatusToLocalStorage(); // Publish that we arrived
            // The user needs to click "Next Stop" *again* to attempt to move to the next route
            alert("Llegó al final de la ruta. Presione 'Parada Siguiente' de nuevo para intentar pasar a la siguiente ruta en cola.");
        } else {
            updateTrackingStatusDisplay();
            publishTrackingStatusToLocalStorage();
        }

    } else if (manualOverride && DOMElements.manualControlCheckbox.checked && currentTrackingStopIndex === allStops.length - 1) {
        // Already at the final stop, and "Next Stop" is pressed again in manual mode
        console.log("Avance manual en la parada final, intentando pasar a la siguiente ruta.");
        advanceToNextRouteInQueue();
    } else if (!manualOverride) {
        // Auto mode should not call this if already at last stop, geofence handles it.
        console.warn("advanceToNextStop llamado en modo auto cuando ya está en la última parada.");
    }
}

function advanceToPrevStop() { // Only for manual mode
    if (!isTracking || !DOMElements.manualControlCheckbox.checked || !currentTrackingRoute) return;
    if (currentTrackingStopIndex > -1) {
        currentTrackingStopIndex--;
        console.log(`Movido manualmente a tramo/parada anterior: ${currentTrackingStopIndex}`);
        updateTrackingStatusDisplay();
        publishTrackingStatusToLocalStorage();
    } else {
        alert("Ya está en el punto de inicio de la ruta actual.");
    }
}


function advanceToNextRouteInQueue() {
    console.log("Avanzando a la siguiente ruta en la cola...");
    currentTrackingRouteIndexInQueue++;
    loadNextRouteForTracking(); // This handles logic if queue is empty or route not found
}

function findAndSetCurrentLeg() {
    if (!isTracking || !currentTrackingRoute || !lastKnownPosition || !currentTrackingRoute.startPoint) return;

    const allStops = [currentTrackingRoute.startPoint, ...currentTrackingRoute.intermediateStops, currentTrackingRoute.endPoint];
    if (allStops.length < 2) return; 

    const currentLat = lastKnownPosition.lat;
    const currentLng = lastKnownPosition.lng;

    // Check if inside start geofence
    const distToStart = calculateDistance(currentLat, currentLng, allStops[0].lat, allStops[0].lng);
    if (distToStart <= GEOFENCE_RADIUS_METERS) {
        if (currentTrackingStopIndex !== -1) {
            console.log("Resync: Detectado en geofence de inicio. Estableciendo a -1.");
            currentTrackingStopIndex = -1;
            updateTrackingStatusDisplay();
            publishTrackingStatusToLocalStorage();
        }
        return;
    }
    // Check if inside end geofence (of the *current* route)
    const distToEnd = calculateDistance(currentLat, currentLng, allStops[allStops.length-1].lat, allStops[allStops.length-1].lng);
    if (distToEnd <= GEOFENCE_RADIUS_METERS) {
        if (currentTrackingStopIndex !== allStops.length -1) {
             console.log("Resync: Detectado en geofence de fin. Estableciendo a parada final.");
             currentTrackingStopIndex = allStops.length - 1; // Mark as arrived at final stop
             updateTrackingStatusDisplay();
             publishTrackingStatusToLocalStorage();
             // Note: This doesn't automatically advance to the next ROUTE, just syncs within current.
        }
        return;
    }


    let bestMatchIndex = -1; // Will be the index of the stop WE DEPARTED FROM
    let minDistanceToUpcomingStop = Infinity;

    // Iterate from current stop index onwards, or from start if unsure
    // Prioritize finding the closest *upcoming* stop based on route order
    const searchStartIndex = (currentTrackingStopIndex >=0 && currentTrackingStopIndex < allStops.length -1) ? currentTrackingStopIndex : 0;

    for (let i = searchStartIndex; i < allStops.length - 1; i++) {
        const stopA = allStops[i]; // Potential departure stop
        const stopB = allStops[i+1]; // Potential arrival stop (our target)

        const distToStopB = calculateDistance(currentLat, currentLng, stopB.lat, stopB.lng);

        // Is this the closest "next stop" we've found so far?
        if (distToStopB < minDistanceToUpcomingStop) {
            // Additional check: are we roughly "between" A and B, or past A towards B?
            // This is a simple check using distances. A proper projection might be better.
            const distToStopA = calculateDistance(currentLat, currentLng, stopA.lat, stopA.lng);
            const legLength = calculateDistance(stopA.lat, stopA.lng, stopB.lat, stopB.lng);

            // If we are closer to B than A, OR if we are very near A (beginning of leg)
            // AND the distance to B is not excessively larger than the leg itself (we are not way off)
            if ((distToStopB < distToStopA || distToStopA < legLength * 0.2) && distToStopB < legLength * 1.5) {
                 minDistanceToUpcomingStop = distToStopB;
                 bestMatchIndex = i; // 'i' is the index of stopA (departed from)
            }
        }
    }
    
    if (bestMatchIndex !== -1) {
        // If we are within proximity of the matched "next stop" (stopB),
        // it means we have effectively "arrived" there, so we should be on the leg *after* it.
        const matchedNextStop = allStops[bestMatchIndex + 1];
        if (calculateDistance(currentLat, currentLng, matchedNextStop.lat, matchedNextStop.lng) <= PROXIMITY_THRESHOLD_METERS) {
            // If this "arrived" stop is not the final stop of the route
            if (bestMatchIndex + 1 < allStops.length - 1) {
                currentTrackingStopIndex = bestMatchIndex + 1; // We've now departed from this `matchedNextStop`
            } else { // We are effectively at the final stop
                currentTrackingStopIndex = bestMatchIndex + 1; // which is allStops.length - 1
            }
        } else {
            // We are on the leg from stopA (index `bestMatchIndex`) to stopB
            currentTrackingStopIndex = bestMatchIndex;
        }
        console.log(`Resync: Índice de tramo actual re-sincronizado a ${currentTrackingStopIndex}.`);
    } else {
        // Fallback: if no good match, and not at start/end geofence, assume still on previous leg or at start if lost.
        // This part can be tricky. A simple fallback is to not change it, or set to -1 if completely unsure.
        if (currentTrackingStopIndex < 0 || currentTrackingStopIndex >= allStops.length -1) {
             currentTrackingStopIndex = -1; // Default to start if really lost
        }
        console.warn("Resync: No se pudo determinar el tramo actual de forma fiable. Se mantiene el actual o se reinicia a -1.");
    }
    updateTrackingStatusDisplay();
    publishTrackingStatusToLocalStorage();
}


// --- Communication (localStorage) ---
function publishTrackingStatusToLocalStorage(currentlyTracking = isTracking, hasError = false, errorReason = null) {
    let status = {
        isTracking: currentlyTracking,
        hasError: hasError,
        errorReason: errorReason,
        routeName: null,
        currentRouteIndexInQueue: -1,
        trackingQueueNames: trackingQueue, 
        currentStopIndexFromWhichDeparted: -1, 
        nextStopIndexTowardsWhichHeading: -1,
        currentBusDelayOrAheadMillis: 0,
        lastKnownPosition: lastKnownPosition ? { lat: lastKnownPosition.lat, lng: lastKnownPosition.lng, accuracy: lastKnownPosition.accuracy, timestamp: lastKnownPosition.timestamp } : null,
        lastUpdateTime: Date.now(),
        routeStops: [] 
    };

    if (currentlyTracking && currentTrackingRoute) {
        status.routeName = currentTrackingRoute.name;
        status.currentRouteIndexInQueue = currentTrackingRouteIndexInQueue;
        status.currentStopIndexFromWhichDeparted = currentTrackingStopIndex; // This is the index of the stop departed FROM
        status.currentBusDelayOrAheadMillis = getCalculatedTimeDifferenceMillis();

        const allActualStops = [
            { ...currentTrackingRoute.startPoint, type: 'start', arrivalTime: null, departureTime: currentTrackingRoute.startPoint.time },
            ...currentTrackingRoute.intermediateStops.map(s => ({ ...s, type: 'intermediate' })), // arrivalTime/departureTime already set
            { ...currentTrackingRoute.endPoint, type: 'end', arrivalTime: currentTrackingRoute.endPoint.time, departureTime: null }
        ];
        status.routeStops = allActualStops.map(s => ({
            name: s.name,
            type: s.type,
            arrivalTime: s.arrivalTime, 
            departureTime: s.departureTime,
            lat: s.lat,
            lng: s.lng
        }));

        // nextStopIndexTowardsWhichHeading is the index in allActualStops array
        if (currentTrackingStopIndex < allActualStops.length - 1 && currentTrackingStopIndex >= -1) {
            status.nextStopIndexTowardsWhichHeading = currentTrackingStopIndex + 1;
        } else { // Arrived at final or invalid index
            status.nextStopIndexTowardsWhichHeading = -1; 
        }
    }
    // If !currentlyTracking, fields remain null/default as set initially

    try {
        localStorage.setItem(LOCALSTORAGE_TRACKING_STATUS_KEY, JSON.stringify(status));
    } catch (e) {
        console.error("Error escribiendo estado de seguimiento a localStorage:", e);
        // Consider alerting user if quota is exceeded
    }
}


// --- Utility Functions ---
function formatTime(date) { 
    if (!date || !(date instanceof Date) || isNaN(date)) return '';
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function parseTime(timeStr) { 
    if (!timeStr || typeof timeStr !== 'string' || !/^\d{2}:\d{2}$/.test(timeStr)) return null;
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
}

function calculateDistance(lat1, lon1, lat2, lon2) { 
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180; const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180; const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDelay(ms) {
    if (typeof ms !== 'number' || isNaN(ms)) return "N/D";
    const sign = ms >= 0 ? '+' : '-';
    const absTotalSeconds = Math.floor(Math.abs(ms) / 1000);
    const minutes = Math.floor(absTotalSeconds / 60);
    const seconds = absTotalSeconds % 60;
    return `${sign}${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    DOMElements.setStartPointBtn.addEventListener('click', setStartPointMode);
    DOMElements.setEndPointBtn.addEventListener('click', setEndPointMode);
    DOMElements.resetEditorBtn.addEventListener('click', resetRouteEditor);

    DOMElements.routeNameInput.addEventListener('input', checkCanSaveRoute);
    DOMElements.startPointNameInput.addEventListener('change', () => { if(currentRoute.startPoint) currentRoute.startPoint.name = DOMElements.startPointNameInput.value.trim(); updateStopsListUI(); redrawEditMap(); });
    DOMElements.endPointNameInput.addEventListener('change', () => { if(currentRoute.endPoint) currentRoute.endPoint.name = DOMElements.endPointNameInput.value.trim(); updateStopsListUI(); redrawEditMap(); });
    
    DOMElements.startPointTimeInput.addEventListener('change', () => { 
        if(currentRoute.startPoint) currentRoute.startPoint.time = DOMElements.startPointTimeInput.value;
        if (DOMElements.autoCalcTimesCheckbox.checked) calculateIntermediateTimes(); else updateStopsListUI();
        checkCanSaveRoute(); 
    });
    DOMElements.endPointTimeInput.addEventListener('change', () => { 
        if(currentRoute.endPoint) currentRoute.endPoint.time = DOMElements.endPointTimeInput.value;
        if (DOMElements.autoCalcTimesCheckbox.checked) calculateIntermediateTimes(); else updateStopsListUI();
        checkCanSaveRoute();
    });

    DOMElements.autoCalcTimesCheckbox.addEventListener('change', () => {
        if (DOMElements.autoCalcTimesCheckbox.checked) {
            calculateIntermediateTimes(); // This recalculates and updates UI
        } else {
            alert("Cálculo automático desactivado. Horarios intermedios no se actualizarán automáticamente.\nSi añade paradas, deberá ingresar sus horarios manualmente o se guardarán sin hora.");
            updateStopsListUI(); // Refresh UI to reflect current state
        }
    });

    DOMElements.saveRouteBtn.addEventListener('click', saveRoute);
    DOMElements.loadRouteBtn.addEventListener('click', loadSelectedRoute);
    DOMElements.deleteRouteBtn.addEventListener('click', deleteSelectedRoute);

    DOMElements.addSelectedRouteToQueueBtn.addEventListener('click', addRouteToTrackingQueue);
    DOMElements.clearQueueBtn.addEventListener('click', clearTrackingQueue);

    DOMElements.startTrackingBtn.addEventListener('click', startTracking);
    DOMElements.stopTrackingBtn.addEventListener('click', () => stopTracking(true)); // Normal stop

    DOMElements.manualControlCheckbox.addEventListener('change', (e) => {
        const isManual = e.target.checked;
        DOMElements.prevStopBtn.disabled = !isManual || !isTracking;
        DOMElements.nextStopBtn.disabled = !isManual || !isTracking;
        if (!isManual && isTracking && lastKnownPosition) { 
            findAndSetCurrentLeg();
        }
        if(isTracking) publishTrackingStatusToLocalStorage(); // Publish change in control mode
    });
    DOMElements.prevStopBtn.addEventListener('click', advanceToPrevStop);
    DOMElements.nextStopBtn.addEventListener('click', () => advanceToNextStop(true));
}
