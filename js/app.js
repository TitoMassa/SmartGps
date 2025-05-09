// js/app.js
document.addEventListener('DOMContentLoaded', () => {
    // --- Leaflet Map Initialization ---
    const map = L.map('map').setView([-34.6037, -58.3816], 13); // Buenos Aires
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Ajuste para asegurar que el mapa se renderice correctamente después de que el DOM y CSS se asienten.
    setTimeout(() => {
        map.invalidateSize();
    }, 100);


    // --- Constants ---
    const PROXIMITY_THRESHOLD_METERS = 50;
    const GEOFENCE_RADIUS_METERS = 100;
    const LOCALSTORAGE_ROUTES_KEY = 'smartMoveProRoutes';
    const LOCALSTORAGE_QUEUE_KEY = 'smartMoveProTrackingQueue';
    const LOCALSTORAGE_STATUS_KEY = 'smartMoveProTrackingStatus';

    // --- App State Variables ---
    let currentEditMode = null; // 'start', 'end', 'intermediate'
    let currentRoute = {
        name: '',
        startPoint: null,
        endPoint: null,
        intermediateStops: [],
        autoCalcTimes: true,
    };
    let savedRoutes = {};
    let trackingQueue = []; // Array of route names

    // Markers & Layers
    let startMarker = null;
    let endMarker = null;
    let intermediateMarkers = [];
    let editorRoutePolyline = null;

    // Tracking State
    let isTracking = false;
    let currentGpsWatchId = null;
    let currentPositionMarker = null;
    let activeRoutePolyline = null;
    let activeRouteStopMarkers = [];
    let startGeofenceCircle = null;
    let endGeofenceCircle = null;
    let currentRouteIndexInQueue = -1;
    let currentTrackingStopIndex = -1; // -1: at start, 0: departed start, heading to stops[1], etc.
    let currentBusDelayOrAheadMillis = 0;
    let trackingUpdateIntervalId = null;
    let timeDiffIntervalId = null;
    let lastKnownPosition = null;
    let activeRouteFlatStops = []; // For the currently tracked route

    // --- DOM Elements ---
    const routeNameInput = document.getElementById('routeName');
    const setStartPointModeButton = document.getElementById('setStartPointMode');
    const startPointNameInput = document.getElementById('startPointName');
    const startPointTimeInput = document.getElementById('startPointTime');
    const setEndPointModeButton = document.getElementById('setEndPointMode');
    const endPointNameInput = document.getElementById('endPointName');
    const endPointTimeInput = document.getElementById('endPointTime');
    const addIntermediateStopModeButton = document.getElementById('addIntermediateStopMode');
    const autoCalcTimesCheckbox = document.getElementById('autoCalcTimes');
    const currentRouteStopsUl = document.getElementById('current-route-stops-ul');
    const saveRouteButton = document.getElementById('saveRoute');
    const clearRouteEditorButton = document.getElementById('clearRouteEditor');
    const savedRoutesDropdown = document.getElementById('savedRoutesDropdown');
    const loadRouteButton = document.getElementById('loadRoute');
    const deleteRouteButton = document.getElementById('deleteRoute');
    const routesForQueueDropdown = document.getElementById('routesForQueueDropdown');
    const addToTrackingQueueButton = document.getElementById('addToTrackingQueue');
    const trackingQueueUl = document.getElementById('tracking-queue-ul');
    const clearTrackingQueueButton = document.getElementById('clearTrackingQueue');
    const startTrackingButton = document.getElementById('startTracking');
    const stopTrackingButton = document.getElementById('stopTracking');
    const activeRouteNameDisplay = document.getElementById('activeRouteName');
    const nextStopInfoDisplay = document.getElementById('nextStopInfo');
    const timeDifferenceInfoDisplay = document.getElementById('timeDifferenceInfo');
    const manualModeCheckbox = document.getElementById('manualModeCheckbox');
    const manualControlsDiv = document.getElementById('manual-controls');
    const prevStopButton = document.getElementById('prevStopButton');
    const nextStopButton = document.getElementById('nextStopButton');
    const appStatusDisplay = document.getElementById('app-status');


    // --- Helper Functions ---
    function updateAppStatus(message, isError = false) {
        appStatusDisplay.textContent = message;
        appStatusDisplay.style.color = isError ? 'red' : 'green';
        setTimeout(() => appStatusDisplay.textContent = '', 5000);
    }

    function createCustomIcon(text, className) {
        return L.divIcon({
            className: `leaflet-marker-icon ${className}`,
            html: `<div>${text}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 30]
        });
    }

    function calculateDistance(lat1, lon1, lat2, lon2) { // Haversine
        const R = 6371e3; // metres
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; // in metres
    }

    function parseTimeToDate(timeStr, baseDate = new Date()) {
        if (!timeStr) return null;
        const [hours, minutes] = timeStr.split(':').map(Number);
        const date = new Date(baseDate);
        date.setHours(hours, minutes, 0, 0);
        return date;
    }
    
    function parseTimeToTimestamp(timeStr, baseDate = new Date()) {
        const date = parseTimeToDate(timeStr, baseDate);
        return date ? date.getTime() : null;
    }

    function formatTimeFromTimestamp(timestamp) {
        if (!timestamp) return '--:--';
        const date = new Date(timestamp);
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }
    
    function formatTimeForInput(date) {
        if (!date) return "";
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    function formatDelayOrAhead(ms) {
        if (ms === null || isNaN(ms)) return '-';
        const prefix = ms >= 0 ? '+' : '-';
        const absMs = Math.abs(ms);
        const totalSeconds = Math.floor(absMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${prefix}${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    // --- Route Editor Logic ---
    function resetCurrentRoute() {
        currentRoute = {
            name: '',
            startPoint: null,
            endPoint: null,
            intermediateStops: [],
            autoCalcTimes: autoCalcTimesCheckbox.checked,
        };
        routeNameInput.value = '';
        startPointNameInput.value = '';
        startPointTimeInput.value = '';
        endPointNameInput.value = '';
        endPointTimeInput.value = '';
        addIntermediateStopModeButton.disabled = true;
        currentEditMode = null;
        renderRouteEditor();
    }

    function renderRouteEditor() {
        // Clear previous markers and polyline from editor map
        if (startMarker) map.removeLayer(startMarker);
        if (endMarker) map.removeLayer(endMarker);
        intermediateMarkers.forEach(m => map.removeLayer(m));
        intermediateMarkers = [];
        if (editorRoutePolyline) map.removeLayer(editorRoutePolyline);

        currentRouteStopsUl.innerHTML = '';
        const pointsForPolyline = [];

        if (currentRoute.startPoint) {
            const sp = currentRoute.startPoint;
            startMarker = L.marker([sp.lat, sp.lng], { icon: createCustomIcon('I', 'start-icon'), draggable: true })
                .addTo(map)
                .bindPopup(`Inicio: ${sp.name || 'Punto de Inicio'}<br>${sp.departureTime || ''}`);
            startMarker.on('dragend', (e) => {
                currentRoute.startPoint.lat = e.target.getLatLng().lat;
                currentRoute.startPoint.lng = e.target.getLatLng().lng;
                if (currentRoute.autoCalcTimes) recalculateIntermediateStopTimes();
                renderRouteEditor();
            });
            const li = document.createElement('li');
            li.textContent = `Inicio: ${sp.name || 'Punto de Inicio'} (${sp.departureTime || 'Sin hora'})`;
            currentRouteStopsUl.appendChild(li);
            pointsForPolyline.push([sp.lat, sp.lng]);
        }

        currentRoute.intermediateStops.forEach((stop, index) => {
            const marker = L.marker([stop.lat, stop.lng], { icon: createCustomIcon(index + 1, 'intermediate-icon'), draggable: true })
                .addTo(map)
                .bindPopup(`Parada ${index + 1}: ${stop.name || ''}<br>Llegada: ${stop.arrivalTime || ''}`);
            marker.on('dragend', (e) => {
                currentRoute.intermediateStops[index].lat = e.target.getLatLng().lat;
                currentRoute.intermediateStops[index].lng = e.target.getLatLng().lng;
                if (currentRoute.autoCalcTimes) recalculateIntermediateStopTimes();
                renderRouteEditor();
            });
            intermediateMarkers.push(marker);
            
            const li = document.createElement('li');
            li.innerHTML = `<span>Parada ${index + 1}: ${stop.name || `Intermedia ${index+1}`} (Lleg: ${stop.arrivalTime || '--:--'}, Sal: ${stop.departureTime || '--:--'})</span>`;
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'X';
            deleteBtn.onclick = () => deleteIntermediateStop(index);
            li.appendChild(deleteBtn);
            currentRouteStopsUl.appendChild(li);
            pointsForPolyline.push([stop.lat, stop.lng]);
        });

        if (currentRoute.endPoint) {
            const ep = currentRoute.endPoint;
            endMarker = L.marker([ep.lat, ep.lng], { icon: createCustomIcon('F', 'end-icon'), draggable: true })
                .addTo(map)
                .bindPopup(`Fin: ${ep.name || 'Punto Final'}<br>${ep.arrivalTime || ''}`);
            endMarker.on('dragend', (e) => {
                currentRoute.endPoint.lat = e.target.getLatLng().lat;
                currentRoute.endPoint.lng = e.target.getLatLng().lng;
                if (currentRoute.autoCalcTimes) recalculateIntermediateStopTimes();
                renderRouteEditor();
            });
            const li = document.createElement('li');
            li.textContent = `Fin: ${ep.name || 'Punto Final'} (${ep.arrivalTime || 'Sin hora'})`;
            currentRouteStopsUl.appendChild(li);
            pointsForPolyline.push([ep.lat, ep.lng]);
        }

        if (pointsForPolyline.length > 1) {
            editorRoutePolyline = L.polyline(pointsForPolyline, { color: 'blue' }).addTo(map);
        }
        
        addIntermediateStopModeButton.disabled = !(currentRoute.startPoint && currentRoute.endPoint);
    }

    function onMapClickForEditor(e) {
        const { lat, lng } = e.latlng;
        if (currentEditMode === 'start') {
            currentRoute.startPoint = { lat, lng, name: startPointNameInput.value, departureTime: startPointTimeInput.value };
            startPointNameInput.value = currentRoute.startPoint.name || ''; // Update if name was empty
            startPointTimeInput.value = currentRoute.startPoint.departureTime || '';
            currentEditMode = null;
            setStartPointModeButton.style.backgroundColor = '';
        } else if (currentEditMode === 'end') {
            currentRoute.endPoint = { lat, lng, name: endPointNameInput.value, arrivalTime: endPointTimeInput.value };
            endPointNameInput.value = currentRoute.endPoint.name || '';
            endPointTimeInput.value = currentRoute.endPoint.arrivalTime || '';
            currentEditMode = null;
            setEndPointModeButton.style.backgroundColor = '';
        } else if (currentEditMode === 'intermediate' && currentRoute.startPoint && currentRoute.endPoint) {
            let arrivalTime = '', departureTime = '';
            if (!currentRoute.autoCalcTimes) {
                arrivalTime = prompt("Hora de llegada a esta parada (HH:MM):", "12:00");
                departureTime = prompt("Hora de salida de esta parada (HH:MM) (dejar vacío si es igual a llegada):", arrivalTime) || arrivalTime;
            }
            currentRoute.intermediateStops.push({ lat, lng, name: `Parada ${currentRoute.intermediateStops.length + 1}`, arrivalTime, departureTime });
            // currentEditMode = null; // Keep intermediate mode active? For now, one click one stop
            addIntermediateStopModeButton.style.backgroundColor = ''; // Reset button color if it was highlighted
            currentEditMode = null; // Deactivate after one stop for now
        }
        if (currentRoute.autoCalcTimes) recalculateIntermediateStopTimes();
        renderRouteEditor();
    }
    
    map.on('click', onMapClickForEditor);

    setStartPointModeButton.addEventListener('click', () => {
        currentEditMode = 'start';
        updateAppStatus('Toca el mapa para definir el Punto de Inicio.');
        setStartPointModeButton.style.backgroundColor = 'orange';
        setEndPointModeButton.style.backgroundColor = '';
        addIntermediateStopModeButton.style.backgroundColor = '';
    });
    setEndPointModeButton.addEventListener('click', () => {
        currentEditMode = 'end';
        updateAppStatus('Toca el mapa para definir el Punto Final.');
        setEndPointModeButton.style.backgroundColor = 'orange';
        setStartPointModeButton.style.backgroundColor = '';
        addIntermediateStopModeButton.style.backgroundColor = '';
    });
    addIntermediateStopModeButton.addEventListener('click', () => {
        if (!currentRoute.startPoint || !currentRoute.endPoint) {
            updateAppStatus('Define Inicio y Fin primero.', true);
            return;
        }
        currentEditMode = 'intermediate';
        updateAppStatus('Toca el mapa para añadir una Parada Intermedia.');
        addIntermediateStopModeButton.style.backgroundColor = 'orange';
        setStartPointModeButton.style.backgroundColor = '';
        setEndPointModeButton.style.backgroundColor = '';
    });
    
    startPointNameInput.addEventListener('change', (e) => {
        if (currentRoute.startPoint) currentRoute.startPoint.name = e.target.value;
        else currentRoute.startPoint = {name: e.target.value}; // In case name set before coords
        renderRouteEditor();
    });
    startPointTimeInput.addEventListener('change', (e) => {
        if (currentRoute.startPoint) currentRoute.startPoint.departureTime = e.target.value;
        else currentRoute.startPoint = {departureTime: e.target.value};
        if (currentRoute.autoCalcTimes) recalculateIntermediateStopTimes();
        renderRouteEditor();
    });
    endPointNameInput.addEventListener('change', (e) => {
        if (currentRoute.endPoint) currentRoute.endPoint.name = e.target.value;
        else currentRoute.endPoint = {name: e.target.value};
        renderRouteEditor();
    });
    endPointTimeInput.addEventListener('change', (e) => {
        if (currentRoute.endPoint) currentRoute.endPoint.arrivalTime = e.target.value;
        else currentRoute.endPoint = {arrivalTime: e.target.value};
        if (currentRoute.autoCalcTimes) recalculateIntermediateStopTimes();
        renderRouteEditor();
    });

    autoCalcTimesCheckbox.addEventListener('change', (e) => {
        currentRoute.autoCalcTimes = e.target.checked;
        if (e.target.checked) {
            recalculateIntermediateStopTimes();
        } else {
            // User must now manually input times or existing auto-calculated times remain
            updateAppStatus('Cálculo automático desactivado. Edita paradas para tiempos manuales.');
        }
        renderRouteEditor();
    });

    function recalculateIntermediateStopTimes() {
        if (!currentRoute.autoCalcTimes || !currentRoute.startPoint || !currentRoute.endPoint || 
            !currentRoute.startPoint.departureTime || !currentRoute.endPoint.arrivalTime ||
            currentRoute.intermediateStops.length === 0) {
            if (currentRoute.autoCalcTimes) {
                 currentRoute.intermediateStops.forEach(stop => {
                    stop.arrivalTime = ''; 
                    stop.departureTime = '';
                });
            }
            renderRouteEditor(); 
            return;
        }

        const startDateTime = parseTimeToDate(currentRoute.startPoint.departureTime);
        const endDateTime = parseTimeToDate(currentRoute.endPoint.arrivalTime);

        if (!startDateTime || !endDateTime || endDateTime <= startDateTime) {
            updateAppStatus('Hora de inicio debe ser anterior a hora de fin para cálculo automático.', true);
            currentRoute.intermediateStops.forEach(stop => { 
                stop.arrivalTime = '';
                stop.departureTime = '';
            });
            renderRouteEditor();
            return;
        }
        
        const totalDurationMs = endDateTime.getTime() - startDateTime.getTime();
        
        let allStops = [currentRoute.startPoint, ...currentRoute.intermediateStops, currentRoute.endPoint];
        let totalPathDistance = 0;
        let segmentDistances = [];

        for (let i = 0; i < allStops.length - 1; i++) {
            if (!allStops[i] || !allStops[i+1] || !allStops[i].lat || !allStops[i+1].lat) { 
                updateAppStatus('Algunos puntos de la ruta no tienen coordenadas.', true);
                return;
            }
            const dist = calculateDistance(allStops[i].lat, allStops[i].lng, allStops[i+1].lat, allStops[i+1].lng);
            segmentDistances.push(dist);
            totalPathDistance += dist;
        }

        if (totalPathDistance === 0 && currentRoute.intermediateStops.length > 0) {
             updateAppStatus('Distancia total de ruta es cero, no se pueden calcular tiempos proporcionales.', true);
             currentRoute.intermediateStops.forEach(stop => { 
                stop.arrivalTime = '';
                stop.departureTime = '';
            });
            renderRouteEditor();
            return;
        }
        
        let cumulativeDistance = 0;
        currentRoute.intermediateStops.forEach((stop, index) => {
            cumulativeDistance += segmentDistances[index]; 
            
            const proportionOfDistance = totalPathDistance > 0 ? (cumulativeDistance / totalPathDistance) : 0;
            const timeOffsetMs = proportionOfDistance * totalDurationMs;
            const arrivalTimeAtStop = new Date(startDateTime.getTime() + timeOffsetMs);
            
            stop.arrivalTime = formatTimeForInput(arrivalTimeAtStop);
            stop.departureTime = stop.arrivalTime; 
        });
        renderRouteEditor();
    }

    function deleteIntermediateStop(index) {
        currentRoute.intermediateStops.splice(index, 1);
        if (currentRoute.autoCalcTimes) recalculateIntermediateStopTimes();
        renderRouteEditor();
    }
    
    // --- Route Management (Save/Load/Delete) ---
    function loadRoutesFromStorage() {
        const routesJSON = localStorage.getItem(LOCALSTORAGE_ROUTES_KEY);
        savedRoutes = routesJSON ? JSON.parse(routesJSON) : {};
        populateRouteDropdowns();
    }

    function saveRoutesToStorage() {
        localStorage.setItem(LOCALSTORAGE_ROUTES_KEY, JSON.stringify(savedRoutes));
    }

    function populateRouteDropdowns() {
        savedRoutesDropdown.innerHTML = '<option value="">Seleccionar ruta guardada</option>';
        routesForQueueDropdown.innerHTML = '<option value="">Seleccionar ruta para cola</option>';
        Object.keys(savedRoutes).forEach(routeName => {
            const option1 = document.createElement('option');
            option1.value = routeName;
            option1.textContent = routeName;
            savedRoutesDropdown.appendChild(option1);

            const option2 = document.createElement('option');
            option2.value = routeName;
            option2.textContent = routeName;
            routesForQueueDropdown.appendChild(option2);
        });
    }

    saveRouteButton.addEventListener('click', () => {
        const name = routeNameInput.value.trim();
        if (!name) {
            updateAppStatus('Por favor, ingresa un nombre para la ruta.', true);
            return;
        }
        if (!currentRoute.startPoint || !currentRoute.endPoint) {
            updateAppStatus('Define al menos un punto de inicio y fin.', true);
            return;
        }
        if (currentRoute.startPoint && !currentRoute.startPoint.departureTime) {
             updateAppStatus('Define la hora de salida del punto de inicio.', true);
            return;
        }
        if (currentRoute.endPoint && !currentRoute.endPoint.arrivalTime) {
             updateAppStatus('Define la hora de llegada al punto final.', true);
            return;
        }
        if (savedRoutes[name]) {
            if (!confirm(`La ruta "${name}" ya existe. ¿Deseas sobrescribirla?`)) {
                return;
            }
        }
        currentRoute.name = name;
        currentRoute.startPoint.name = startPointNameInput.value;
        currentRoute.startPoint.departureTime = startPointTimeInput.value;
        currentRoute.endPoint.name = endPointNameInput.value;
        currentRoute.endPoint.arrivalTime = endPointTimeInput.value;
        currentRoute.autoCalcTimes = autoCalcTimesCheckbox.checked;

        savedRoutes[name] = JSON.parse(JSON.stringify(currentRoute)); 
        saveRoutesToStorage();
        populateRouteDropdowns();
        updateAppStatus(`Ruta "${name}" guardada.`);
    });

    clearRouteEditorButton.addEventListener('click', () => {
        resetCurrentRoute();
        renderRouteEditor();
    });

    loadRouteButton.addEventListener('click', () => {
        const routeName = savedRoutesDropdown.value;
        if (!routeName || !savedRoutes[routeName]) {
            updateAppStatus('Selecciona una ruta válida para cargar.', true);
            return;
        }
        currentRoute = JSON.parse(JSON.stringify(savedRoutes[routeName])); 
        
        routeNameInput.value = currentRoute.name;
        startPointNameInput.value = currentRoute.startPoint.name || '';
        startPointTimeInput.value = currentRoute.startPoint.departureTime || '';
        endPointNameInput.value = currentRoute.endPoint.name || '';
        endPointTimeInput.value = currentRoute.endPoint.arrivalTime || '';
        autoCalcTimesCheckbox.checked = currentRoute.autoCalcTimes;
        
        renderRouteEditor();
        updateAppStatus(`Ruta "${routeName}" cargada en el editor.`);
    });

    deleteRouteButton.addEventListener('click', () => {
        const routeName = savedRoutesDropdown.value;
        if (!routeName || !savedRoutes[routeName]) {
            updateAppStatus('Selecciona una ruta válida para eliminar.', true);
            return;
        }
        if (confirm(`¿Estás seguro de que quieres eliminar la ruta "${routeName}"?`)) {
            delete savedRoutes[routeName];
            saveRoutesToStorage();
            populateRouteDropdowns();
            trackingQueue = trackingQueue.filter(rName => rName !== routeName);
            saveTrackingQueueToStorage();
            renderTrackingQueue();
            updateAppStatus(`Ruta "${routeName}" eliminada.`);
        }
    });

    // --- Tracking Queue Logic ---
    function loadTrackingQueueFromStorage() {
        const queueJSON = localStorage.getItem(LOCALSTORAGE_QUEUE_KEY);
        trackingQueue = queueJSON ? JSON.parse(queueJSON) : [];
        renderTrackingQueue();
    }

    function saveTrackingQueueToStorage() {
        localStorage.setItem(LOCALSTORAGE_QUEUE_KEY, JSON.stringify(trackingQueue));
    }

    function renderTrackingQueue() {
        trackingQueueUl.innerHTML = '';
        trackingQueue.forEach((routeName, index) => {
            const li = document.createElement('li');
            li.textContent = `${index + 1}. ${routeName}`;
            trackingQueueUl.appendChild(li);
        });
        startTrackingButton.disabled = trackingQueue.length === 0 || isTracking;
    }

    addToTrackingQueueButton.addEventListener('click', () => {
        const routeName = routesForQueueDropdown.value;
        if (!routeName || !savedRoutes[routeName]) {
            updateAppStatus('Selecciona una ruta válida para añadir a la cola.', true);
            return;
        }
        trackingQueue.push(routeName);
        saveTrackingQueueToStorage();
        renderTrackingQueue();
        updateAppStatus(`Ruta "${routeName}" añadida a la cola.`);
    });

    clearTrackingQueueButton.addEventListener('click', () => {
        if (isTracking) {
            updateAppStatus('No se puede limpiar la cola mientras el seguimiento está activo.', true);
            return;
        }
        trackingQueue = [];
        saveTrackingQueueToStorage();
        renderTrackingQueue();
        updateAppStatus('Cola de seguimiento limpiada.');
    });
    
    // --- Tracking Functionality ---
    function getFlatStopsForRoute(routeObject, routeDate = new Date()) {
        const stops = [];
        const today = routeDate; 

        if (!routeObject || !routeObject.startPoint || !routeObject.endPoint) return [];

        stops.push({
            name: routeObject.startPoint.name || 'Inicio',
            type: 'start',
            lat: routeObject.startPoint.lat,
            lng: routeObject.startPoint.lng,
            arrivalTime: parseTimeToTimestamp(routeObject.startPoint.departureTime, today), 
            departureTime: parseTimeToTimestamp(routeObject.startPoint.departureTime, today)
        });

        routeObject.intermediateStops.forEach((stop, index) => {
            stops.push({
                name: stop.name || `Parada ${index + 1}`,
                type: 'intermediate',
                lat: stop.lat,
                lng: stop.lng,
                arrivalTime: parseTimeToTimestamp(stop.arrivalTime, today),
                departureTime: parseTimeToTimestamp(stop.departureTime, today)
            });
        });

        stops.push({
            name: routeObject.endPoint.name || 'Fin',
            type: 'end',
            lat: routeObject.endPoint.lat,
            lng: routeObject.endPoint.lng,
            arrivalTime: parseTimeToTimestamp(routeObject.endPoint.arrivalTime, today),
            departureTime: parseTimeToTimestamp(routeObject.endPoint.arrivalTime, today) 
        });
        return stops.filter(s => s.arrivalTime && s.departureTime); 
    }
    
    function startTracking() {
        if (trackingQueue.length === 0) {
            updateAppStatus('La cola de seguimiento está vacía.', true);
            return;
        }
        if (!navigator.geolocation) {
            updateAppStatus('Geolocalización no soportada por este navegador.', true);
            stopTracking(true, 'Geolocalización no soportada');
            return;
        }

        isTracking = true;
        currentRouteIndexInQueue = 0;
        startTrackingButton.disabled = true;
        stopTrackingButton.disabled = false;
        manualModeCheckbox.disabled = false;
        
        processNextRouteInQueue();

        currentGpsWatchId = navigator.geolocation.watchPosition(
            handleGpsUpdate,
            handleGpsError,
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
        
        trackingUpdateIntervalId = setInterval(updateTrackingStatusInLocalStorage, 3000); 
        timeDiffIntervalId = setInterval(calculateTimeDifference, 1000); 
        updateAppStatus('Seguimiento iniciado.');
    }

    function stopTracking(hasError = false, errorReason = '') {
        isTracking = false;
        if (currentGpsWatchId) navigator.geolocation.clearWatch(currentGpsWatchId);
        if (trackingUpdateIntervalId) clearInterval(trackingUpdateIntervalId);
        if (timeDiffIntervalId) clearInterval(timeDiffIntervalId);
        
        currentGpsWatchId = null;
        trackingUpdateIntervalId = null;
        timeDiffIntervalId = null;
        lastKnownPosition = null;

        clearActiveRouteFromMap();
        
        startTrackingButton.disabled = trackingQueue.length === 0;
        stopTrackingButton.disabled = true;
        manualModeCheckbox.disabled = true;
        manualModeCheckbox.checked = false; 
        toggleManualControls(false);

        activeRouteNameDisplay.textContent = '-';
        nextStopInfoDisplay.textContent = '-';
        timeDifferenceInfoDisplay.textContent = '-';
        
        const status = {
            isTracking: false,
            hasError: hasError,
            errorReason: errorReason,
            lastUpdateTime: Date.now()
        };
        localStorage.setItem(LOCALSTORAGE_STATUS_KEY, JSON.stringify(status));
        if (!hasError) updateAppStatus('Seguimiento detenido.');
        else updateAppStatus(`Seguimiento detenido por error: ${errorReason}`, true);
    }
    
    function processNextRouteInQueue() {
        clearActiveRouteFromMap();
        
        if (currentRouteIndexInQueue >= trackingQueue.length) {
            updateAppStatus('Fin de la cola de seguimiento.');
            stopTracking();
            return;
        }

        const routeName = trackingQueue[currentRouteIndexInQueue];
        const routeData = savedRoutes[routeName];
        if (!routeData) {
            updateAppStatus(`Error: Ruta "${routeName}" no encontrada. Saltando a la siguiente.`, true);
            currentRouteIndexInQueue++;
            processNextRouteInQueue();
            return;
        }

        activeRouteFlatStops = getFlatStopsForRoute(routeData);
        if (activeRouteFlatStops.length < 2) { 
             updateAppStatus(`Error: Ruta "${routeName}" tiene datos inválidos (paradas/tiempos). Saltando.`, true);
             currentRouteIndexInQueue++;
             processNextRouteInQueue();
             return;
        }

        currentTrackingStopIndex = -1; 
        currentBusDelayOrAheadMillis = 0; 

        activeRouteNameDisplay.textContent = routeName;
        drawActiveRouteOnMap(activeRouteFlatStops);
        updateRealTimeInfoDisplay(); 
        updateAppStatus(`Iniciando seguimiento para ruta: ${routeName}`);
    }

    function drawActiveRouteOnMap(flatStops) {
        clearActiveRouteFromMap(); 
        
        const latlngs = flatStops.map(s => [s.lat, s.lng]);
        activeRoutePolyline = L.polyline(latlngs, { color: 'green', weight: 5 }).addTo(map);

        flatStops.forEach((stop, index) => {
            let icon;
            if (stop.type === 'start') icon = createCustomIcon('I', 'start-icon');
            else if (stop.type === 'end') icon = createCustomIcon('F', 'end-icon');
            else icon = createCustomIcon(index, 'intermediate-icon'); 
            
            const marker = L.marker([stop.lat, stop.lng], { icon })
                .bindPopup(`${stop.name} (${stop.type})<br>Prog: ${formatTimeFromTimestamp(stop.arrivalTime)}`)
                .addTo(map);
            activeRouteStopMarkers.push(marker);
        });
        
        const startPoint = flatStops[0];
        const endPoint = flatStops[flatStops.length - 1];
        startGeofenceCircle = L.circle([startPoint.lat, startPoint.lng], {
            radius: GEOFENCE_RADIUS_METERS,
            color: 'blue',
            fillColor: 'blue',
            fillOpacity: 0.1
        }).addTo(map);
        endGeofenceCircle = L.circle([endPoint.lat, endPoint.lng], {
            radius: GEOFENCE_RADIUS_METERS,
            color: 'red',
            fillColor: 'red',
            fillOpacity: 0.1
        }).addTo(map);

        if (latlngs.length > 0) map.fitBounds(latlngs, {padding: [50,50]});
    }
    
    function clearActiveRouteFromMap() {
        if (activeRoutePolyline) map.removeLayer(activeRoutePolyline);
        activeRouteStopMarkers.forEach(m => map.removeLayer(m));
        activeRouteStopMarkers = [];
        if (startGeofenceCircle) map.removeLayer(startGeofenceCircle);
        if (endGeofenceCircle) map.removeLayer(endGeofenceCircle);
        if (currentPositionMarker) map.removeLayer(currentPositionMarker);

        activeRoutePolyline = null;
        startGeofenceCircle = null;
        endGeofenceCircle = null;
        currentPositionMarker = null;
    }

    function handleGpsUpdate(position) {
        const { latitude, longitude } = position.coords;
        lastKnownPosition = { lat: latitude, lng: longitude };

        if (!currentPositionMarker) {
            currentPositionMarker = L.marker([latitude, longitude], {
                icon: L.divIcon({className: 'gps-marker'}),
                zIndexOffset: 1000
            }).addTo(map).bindPopup("Posición Actual");
        } else {
            currentPositionMarker.setLatLng([latitude, longitude]);
        }
        map.panTo([latitude, longitude], { animate: true });

        if (!manualModeCheckbox.checked) {
            handleAutomaticAdvancement(lastKnownPosition);
        }
        updateRealTimeInfoDisplay(); 
        updateTrackingStatusInLocalStorage(); 
    }

    function handleGpsError(error) {
        let reason = 'Error desconocido de GPS.';
        switch(error.code) {
            case error.PERMISSION_DENIED: reason = "Permiso de geolocalización denegado."; break;
            case error.POSITION_UNAVAILABLE: reason = "Información de posición no disponible."; break;
            case error.TIMEOUT: reason = "Timeout obteniendo posición GPS."; break;
        }
        updateAppStatus(`Error de GPS: ${reason}`, true);
        localStorage.setItem(LOCALSTORAGE_STATUS_KEY, JSON.stringify({
            isTracking: true, 
            hasError: true,
            errorReason: reason,
            lastUpdateTime: Date.now(),
            routeName: activeRouteNameDisplay.textContent,
            currentRouteIndexInQueue,
            trackingQueueNames: trackingQueue,
            currentStopIndexFromWhichDeparted: currentTrackingStopIndex,
            nextStopIndexTowardsWhichHeading: currentTrackingStopIndex + 1, 
            currentBusDelayOrAheadMillis,
            lastKnownPosition,
            routeStops: activeRouteFlatStops,
        }));
    }

    function calculateTimeDifference() {
        if (!isTracking || activeRouteFlatStops.length === 0 || !lastKnownPosition) {
            currentBusDelayOrAheadMillis = 0;
            timeDifferenceInfoDisplay.textContent = '-';
            return;
        }

        const now = Date.now();
        let scheduledTimeAtCurrentPoint;

        if (currentTrackingStopIndex === -1) { 
            const scheduledDepartureTime = activeRouteFlatStops[0].departureTime;
            scheduledTimeAtCurrentPoint = scheduledDepartureTime; 
        } else { 
            if (currentTrackingStopIndex >= activeRouteFlatStops.length - 1) { 
                currentBusDelayOrAheadMillis = 0; 
                timeDifferenceInfoDisplay.textContent = 'En Destino';
                return;
            }

            const prevStop = activeRouteFlatStops[currentTrackingStopIndex];
            const nextStop = activeRouteFlatStops[currentTrackingStopIndex + 1];

            const scheduledTimeAtPrevStop = prevStop.departureTime;
            const scheduledTimeAtNextStop = nextStop.arrivalTime;
            const scheduledLegDuration = scheduledTimeAtNextStop - scheduledTimeAtPrevStop;

            if (scheduledLegDuration <= 0) { 
                 currentBusDelayOrAheadMillis = 0; 
                 timeDifferenceInfoDisplay.textContent = 'Error Tiempos';
                 return;
            }
            
            const distPrevToNext = calculateDistance(prevStop.lat, prevStop.lng, nextStop.lat, nextStop.lng);
            const distPrevToCurrent = calculateDistance(prevStop.lat, prevStop.lng, lastKnownPosition.lat, lastKnownPosition.lng);
            
            let fractionOfLegCoveredByDistance = 0;
            if (distPrevToNext > 0) {
                fractionOfLegCoveredByDistance = Math.min(1, Math.max(0, distPrevToCurrent / distPrevToNext));
            } else if (distPrevToCurrent > 0) { 
                 fractionOfLegCoveredByDistance = 0; 
            }

            const scheduledTimeSpentOnLeg = fractionOfLegCoveredByDistance * scheduledLegDuration;
            scheduledTimeAtCurrentPoint = scheduledTimeAtPrevStop + scheduledTimeSpentOnLeg;
        }
        
        currentBusDelayOrAheadMillis = scheduledTimeAtCurrentPoint - now; 
        timeDifferenceInfoDisplay.textContent = formatDelayOrAhead(currentBusDelayOrAheadMillis);
    }
    
    function updateRealTimeInfoDisplay() {
        if (!isTracking || activeRouteFlatStops.length === 0) {
            nextStopInfoDisplay.textContent = '-';
            return;
        }

        let nextStopTargetIndex;
        if (currentTrackingStopIndex === -1) { 
            nextStopTargetIndex = 0; 
            const startPoint = activeRouteFlatStops[0];
            nextStopInfoDisplay.textContent = `Salida de ${startPoint.name} a las ${formatTimeFromTimestamp(startPoint.departureTime)}`;
        } else {
            nextStopTargetIndex = currentTrackingStopIndex + 1;
            if (nextStopTargetIndex < activeRouteFlatStops.length) {
                const nextStopData = activeRouteFlatStops[nextStopTargetIndex];
                nextStopInfoDisplay.textContent = `${nextStopData.name} (Prog: ${formatTimeFromTimestamp(nextStopData.arrivalTime)})`;
            } else {
                nextStopInfoDisplay.textContent = "Ruta Completada. Esperando siguiente...";
            }
        }
    }

    function advanceToNextStop(manual = false) {
        if (!isTracking) return;

        if (currentTrackingStopIndex < activeRouteFlatStops.length - 2) { 
            currentTrackingStopIndex++;
        } else if (currentTrackingStopIndex === activeRouteFlatStops.length - 2) { 
            currentTrackingStopIndex++; 
             if (manual) updateAppStatus('En la última parada. "Siguiente" pasará a la próxima ruta.');
        } else if (currentTrackingStopIndex === activeRouteFlatStops.length - 1 && manual) { 
            currentRouteIndexInQueue++;
            processNextRouteInQueue(); 
            return; 
        } else { 
            if (!manual) { 
                currentRouteIndexInQueue++;
                processNextRouteInQueue();
                return;
            }
            if (currentRouteIndexInQueue >= trackingQueue.length -1) {
                updateAppStatus('Fin de todas las rutas en cola.');
                return;
            }
        }
        updateRealTimeInfoDisplay();
        updateTrackingStatusInLocalStorage();
        if (manual) updateAppStatus(`Avance manual a parada (índice ${currentTrackingStopIndex}).`);
    }

    function advanceToPreviousStop() { 
        if (!isTracking || !manualModeCheckbox.checked) return;
        if (currentTrackingStopIndex > -1) {
            currentTrackingStopIndex--;
        } else {
            updateAppStatus('Ya en el inicio de la ruta actual.');
            return;
        }
        updateRealTimeInfoDisplay();
        updateTrackingStatusInLocalStorage();
        updateAppStatus(`Retroceso manual a parada (índice ${currentTrackingStopIndex}).`);
    }

    function handleAutomaticAdvancement(currentPos) {
        if (!isTracking || manualModeCheckbox.checked || activeRouteFlatStops.length === 0) return;

        const currentLat = currentPos.lat;
        const currentLng = currentPos.lng;

        if (currentTrackingStopIndex === -1) {
            const startPoint = activeRouteFlatStops[0];
            const distFromStart = calculateDistance(currentLat, currentLng, startPoint.lat, startPoint.lng);
            if (distFromStart > GEOFENCE_RADIUS_METERS) {
                updateAppStatus('Saliendo de geofence de inicio.');
                advanceToNextStop(); 
            }
            return; 
        }
        
        const endPoint = activeRouteFlatStops[activeRouteFlatStops.length - 1];
        
        if (currentTrackingStopIndex >= activeRouteFlatStops.length -1) { 
            if (calculateDistance(currentLat, currentLng, endPoint.lat, endPoint.lng) <= GEOFENCE_RADIUS_METERS) { 
                updateAppStatus('En geofence de fin de ruta. Transicionando...');
                currentRouteIndexInQueue++;
                processNextRouteInQueue(); 
            }
            return;
        }
        
        const nextStopTargetIndex = currentTrackingStopIndex + 1;
        if (nextStopTargetIndex >= activeRouteFlatStops.length) { 
             updateAppStatus('Índice de próxima parada fuera de rango.', true);
             return;
        }

        const nextStopData = activeRouteFlatStops[nextStopTargetIndex];
        const distToNextStop = calculateDistance(currentLat, currentLng, nextStopData.lat, nextStopData.lng);

        if (distToNextStop <= PROXIMITY_THRESHOLD_METERS) {
            if (nextStopTargetIndex === activeRouteFlatStops.length - 1) { 
                updateAppStatus(`Llegando a parada final: ${nextStopData.name}.`);
                advanceToNextStop(); 
                 if (calculateDistance(currentLat, currentLng, endPoint.lat, endPoint.lng) <= GEOFENCE_RADIUS_METERS) {
                    updateAppStatus('Dentro de geofence de fin de ruta. Transicionando...');
                    currentRouteIndexInQueue++;
                    processNextRouteInQueue();
                 }

            } else { 
                updateAppStatus(`Llegando a parada intermedia: ${nextStopData.name}`);
                advanceToNextStop(); 
            }
        }
    }

    function findAndSetCurrentLeg() {
        if (!isTracking || !lastKnownPosition || activeRouteFlatStops.length < 2) return;
    
        const currentPos = lastKnownPosition;
        
        for (let i = 0; i < activeRouteFlatStops.length; i++) {
            const stop = activeRouteFlatStops[i];
            if (calculateDistance(currentPos.lat, currentPos.lng, stop.lat, stop.lng) <= PROXIMITY_THRESHOLD_METERS) {
                currentTrackingStopIndex = i; 
                 updateAppStatus(`Re-sincronizado: Cerca de parada ${activeRouteFlatStops[i].name}. Índice actual: ${currentTrackingStopIndex}`);
                updateRealTimeInfoDisplay();
                updateTrackingStatusInLocalStorage();
                return;
            }
        }
    
        let closestStopIndex = -1;
        let minDistToStop = Infinity;
        activeRouteFlatStops.forEach((stop, index) => {
            const d = calculateDistance(currentPos.lat, currentPos.lng, stop.lat, stop.lng);
            if (d < minDistToStop) {
                minDistToStop = d;
                closestStopIndex = index;
            }
        });
        
        if (closestStopIndex !== -1) {
             if (closestStopIndex < activeRouteFlatStops.length -1) {
                currentTrackingStopIndex = closestStopIndex;
             } else { 
                currentTrackingStopIndex = activeRouteFlatStops.length -1; 
             }
             updateAppStatus(`Re-sincronizado (heurística): Índice ${currentTrackingStopIndex} (${activeRouteFlatStops[currentTrackingStopIndex].name}).`);
        } else {
            updateAppStatus('No se pudo re-sincronizar la posición en la ruta.', true);
        }
        updateRealTimeInfoDisplay();
        updateTrackingStatusInLocalStorage();
    }
    

    manualModeCheckbox.addEventListener('change', (e) => {
        const isManual = e.target.checked;
        toggleManualControls(isManual);
        if (!isManual && isTracking) { 
            updateAppStatus('Cambiado a modo automático. Re-sincronizando...');
            findAndSetCurrentLeg();
        } else if (isManual) {
            updateAppStatus('Modo manual activado.');
        }
    });

    function toggleManualControls(show) {
        manualControlsDiv.style.display = show ? 'block' : 'none';
    }

    prevStopButton.addEventListener('click', advanceToPreviousStop);
    nextStopButton.addEventListener('click', ()_=> advanceToNextStop(true)); 


    // --- localStorage Communication ---
    function updateTrackingStatusInLocalStorage() {
        if (!isTracking && !localStorage.getItem(LOCALSTORAGE_STATUS_KEY)) { 
            const initialStatus = { isTracking: false, hasError: false, errorReason: '', lastUpdateTime: Date.now() };
            localStorage.setItem(LOCALSTORAGE_STATUS_KEY, JSON.stringify(initialStatus));
            return;
        }
        if (!isTracking) { 
            return;
        }
        
        if (activeRouteFlatStops.length === 0 || currentRouteIndexInQueue < 0) {
            const waitingStatus = {
                isTracking: true,
                hasError: false, 
                errorReason: '',
                routeName: 'Cargando...',
                currentRouteIndexInQueue,
                trackingQueueNames: trackingQueue,
                currentStopIndexFromWhichDeparted: -1,
                nextStopIndexTowardsWhichHeading: 0,
                currentBusDelayOrAheadMillis: 0,
                lastKnownPosition: lastKnownPosition || null,
                lastUpdateTime: Date.now(),
                routeStops: [],
            };
            localStorage.setItem(LOCALSTORAGE_STATUS_KEY, JSON.stringify(waitingStatus));
            return;
        }

        const routeName = trackingQueue[currentRouteIndexInQueue];
        const nextStopIdx = currentTrackingStopIndex + 1;
        
        const status = {
            isTracking: true,
            hasError: false, 
            errorReason: '',
            routeName: routeName,
            currentRouteIndexInQueue: currentRouteIndexInQueue,
            trackingQueueNames: trackingQueue,
            currentStopIndexFromWhichDeparted: currentTrackingStopIndex,
            nextStopIndexTowardsWhichHeading: nextStopIdx < activeRouteFlatStops.length ? nextStopIdx : -1, 
            currentBusDelayOrAheadMillis: currentBusDelayOrAheadMillis,
            lastKnownPosition: lastKnownPosition,
            lastUpdateTime: Date.now(),
            routeStops: activeRouteFlatStops, 
        };
        localStorage.setItem(LOCALSTORAGE_STATUS_KEY, JSON.stringify(status));
    }
    

    // --- PWA Service Worker ---
    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .then(registration => {
                    console.log('Service Worker registrado con éxito:', registration);
                    updateAppStatus('Service Worker registrado.');
                })
                .catch(error => {
                    console.error('Error al registrar Service Worker:', error);
                    updateAppStatus('Error registrando Service Worker.', true);
                });
        } else {
            updateAppStatus('Service Workers no soportados.', true);
        }
    }

    // --- Init ---
    function initApp() {
        loadRoutesFromStorage();
        loadTrackingQueueFromStorage();
        resetCurrentRoute(); 
        renderRouteEditor(); 
        registerServiceWorker();
        updateTrackingStatusInLocalStorage(); 
        
        startTrackingButton.addEventListener('click', startTracking);
        stopTrackingButton.addEventListener('click', () => stopTracking(false,''));
        updateAppStatus('Aplicación Smart Move Pro lista.');
    }

    initApp();
});
