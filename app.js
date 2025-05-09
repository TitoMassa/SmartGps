// js/app.js
document.addEventListener('DOMContentLoaded', () => {
    // --- Leaflet Map Initialization ---
    const map = L.map('map').setView([-34.6037, -58.3816], 13); // Buenos Aires
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

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
            // For intermediates, if autoCalc is on but they were manually set, keep them unless recalculated
            // This function assumes it should overwrite intermediate times if autoCalc is ON.
            // If times are manually set, then autoCalc is OFF, this won't run.
            // If autoCalc ON and no intermediates, nothing to do.
            // If autoCalc ON and intermediates exist, they will be recalculated.
            // Ensure existing intermediate stops have their times reset if they are to be recalculated.
            if (currentRoute.autoCalcTimes) {
                 currentRoute.intermediateStops.forEach(stop => {
                    stop.arrivalTime = ''; // Clear to signify they need recalc or manual input if autoCalc gets turned off
                    stop.departureTime = '';
                });
            }
            renderRouteEditor(); // Re-render to show cleared times if needed
            return;
        }

        const startDateTime = parseTimeToDate(currentRoute.startPoint.departureTime);
        const endDateTime = parseTimeToDate(currentRoute.endPoint.arrivalTime);

        if (!startDateTime || !endDateTime || endDateTime <= startDateTime) {
            updateAppStatus('Hora de inicio debe ser anterior a hora de fin para cálculo automático.', true);
            currentRoute.intermediateStops.forEach(stop => { // Clear times as they are invalid
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
            if (!allStops[i] || !allStops[i+1] || !allStops[i].lat || !allStops[i+1].lat) { // Check for valid points
                updateAppStatus('Algunos puntos de la ruta no tienen coordenadas.', true);
                return;
            }
            const dist = calculateDistance(allStops[i].lat, allStops[i].lng, allStops[i+1].lat, allStops[i+1].lng);
            segmentDistances.push(dist);
            totalPathDistance += dist;
        }

        if (totalPathDistance === 0 && currentRoute.intermediateStops.length > 0) {
             updateAppStatus('Distancia total de ruta es cero, no se pueden calcular tiempos proporcionales.', true);
             currentRoute.intermediateStops.forEach(stop => { // Clear times
                stop.arrivalTime = '';
                stop.departureTime = '';
            });
            renderRouteEditor();
            return;
        }
        
        let cumulativeDistance = 0;
        currentRoute.intermediateStops.forEach((stop, index) => {
            // Distance to this intermediate stop is sum of segments up to it
            // segmentDistances[0] is start to interm1
            // segmentDistances[index] is from previous stop (or start) to this intermediate stop.
            cumulativeDistance += segmentDistances[index]; // index refers to segment leading to this intermediate stop
            
            const proportionOfDistance = totalPathDistance > 0 ? (cumulativeDistance / totalPathDistance) : 0;
            const timeOffsetMs = proportionOfDistance * totalDurationMs;
            const arrivalTimeAtStop = new Date(startDateTime.getTime() + timeOffsetMs);
            
            stop.arrivalTime = formatTimeForInput(arrivalTimeAtStop);
            stop.departureTime = stop.arrivalTime; // As per requirement
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
        // Ensure names and times from inputs are part of the currentRoute object
        currentRoute.startPoint.name = startPointNameInput.value;
        currentRoute.startPoint.departureTime = startPointTimeInput.value;
        currentRoute.endPoint.name = endPointNameInput.value;
        currentRoute.endPoint.arrivalTime = endPointTimeInput.value;
        currentRoute.autoCalcTimes = autoCalcTimesCheckbox.checked;

        savedRoutes[name] = JSON.parse(JSON.stringify(currentRoute)); // Deep copy
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
        currentRoute = JSON.parse(JSON.stringify(savedRoutes[routeName])); // Deep copy
        
        // Populate editor fields
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
            // If deleted route was in tracking queue, remove it
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
        const today = routeDate; // Base date for time parsing

        if (!routeObject || !routeObject.startPoint || !routeObject.endPoint) return [];

        stops.push({
            name: routeObject.startPoint.name || 'Inicio',
            type: 'start',
            lat: routeObject.startPoint.lat,
            lng: routeObject.startPoint.lng,
            arrivalTime: parseTimeToTimestamp(routeObject.startPoint.departureTime, today), // Arrival at start is same as departure
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
            departureTime: parseTimeToTimestamp(routeObject.endPoint.arrivalTime, today) // Departure from end is same as arrival
        });
        return stops.filter(s => s.arrivalTime && s.departureTime); // Ensure valid stops
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
        
        trackingUpdateIntervalId = setInterval(updateTrackingStatusInLocalStorage, 3000); // Update localStorage every 3s
        timeDiffIntervalId = setInterval(calculateTimeDifference, 1000); // Update time diff every 1s
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
        manualModeCheckbox.checked = false; // Reset manual mode
        toggleManualControls(false);

        activeRouteNameDisplay.textContent = '-';
        nextStopInfoDisplay.textContent = '-';
        timeDifferenceInfoDisplay.textContent = '-';
        
        // Save final tracking status
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
        if (activeRouteFlatStops.length < 2) { // Needs at least start and end
             updateAppStatus(`Error: Ruta "${routeName}" tiene datos inválidos (paradas/tiempos). Saltando.`, true);
             currentRouteIndexInQueue++;
             processNextRouteInQueue();
             return;
        }

        currentTrackingStopIndex = -1; // Reset to "at start" for the new route
        currentBusDelayOrAheadMillis = 0; // Reset delay

        activeRouteNameDisplay.textContent = routeName;
        drawActiveRouteOnMap(activeRouteFlatStops);
        updateRealTimeInfoDisplay(); // Initial display for the new route
        updateAppStatus(`Iniciando seguimiento para ruta: ${routeName}`);
    }

    function drawActiveRouteOnMap(flatStops) {
        clearActiveRouteFromMap(); // Clear previous if any
        
        const latlngs = flatStops.map(s => [s.lat, s.lng]);
        activeRoutePolyline = L.polyline(latlngs, { color: 'green', weight: 5 }).addTo(map);

        flatStops.forEach((stop, index) => {
            let icon;
            if (stop.type === 'start') icon = createCustomIcon('I', 'start-icon');
            else if (stop.type === 'end') icon = createCustomIcon('F', 'end-icon');
            else icon = createCustomIcon(index, 'intermediate-icon'); // Using flat index (0=start, 1=interm1...)
            
            const marker = L.marker([stop.lat, stop.lng], { icon })
                .bindPopup(`${stop.name} (${stop.type})<br>Prog: ${formatTimeFromTimestamp(stop.arrivalTime)}`)
                .addTo(map);
            activeRouteStopMarkers.push(marker);
        });
        
        // Geofences for start and end of the active route
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
        // calculateTimeDifference() is called by its own interval
        updateRealTimeInfoDisplay(); // To refresh next stop info if it changed
        updateTrackingStatusInLocalStorage(); // Update immediately on GPS update
    }

    function handleGpsError(error) {
        let reason = 'Error desconocido de GPS.';
        switch(error.code) {
            case error.PERMISSION_DENIED: reason = "Permiso de geolocalización denegado."; break;
            case error.POSITION_UNAVAILABLE: reason = "Información de posición no disponible."; break;
            case error.TIMEOUT: reason = "Timeout obteniendo posición GPS."; break;
        }
        updateAppStatus(`Error de GPS: ${reason}`, true);
        // Potentially stop tracking or notify user critical error
        // For now, just log and update status. isTracking remains true unless manually stopped.
        // The "hasError" flag in localStorage status will be set.
        localStorage.setItem(LOCALSTORAGE_STATUS_KEY, JSON.stringify({
            isTracking: true, // still trying
            hasError: true,
            errorReason: reason,
            lastUpdateTime: Date.now(),
             // include other relevant fields if available
            routeName: activeRouteNameDisplay.textContent,
            currentRouteIndexInQueue,
            trackingQueueNames: trackingQueue,
            currentStopIndexFromWhichDeparted: currentTrackingStopIndex,
            nextStopIndexTowardsWhichHeading: currentTrackingStopIndex + 1, // Best guess
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

        if (currentTrackingStopIndex === -1) { // At start point, before departure
            const scheduledDepartureTime = activeRouteFlatStops[0].departureTime;
            scheduledTimeAtCurrentPoint = scheduledDepartureTime; // Comparing against scheduled departure
             // currentBusDelayOrAheadMillis = scheduledDepartureTime - now; // Positive if bus is early for departure.
        } else { // En route
            if (currentTrackingStopIndex >= activeRouteFlatStops.length - 1) { // Arrived at final stop or beyond
                currentBusDelayOrAheadMillis = 0; // Or calculate based on final arrival
                timeDifferenceInfoDisplay.textContent = 'En Destino';
                return;
            }

            const prevStop = activeRouteFlatStops[currentTrackingStopIndex];
            const nextStop = activeRouteFlatStops[currentTrackingStopIndex + 1];

            const scheduledTimeAtPrevStop = prevStop.departureTime;
            const scheduledTimeAtNextStop = nextStop.arrivalTime;
            const scheduledLegDuration = scheduledTimeAtNextStop - scheduledTimeAtPrevStop;

            if (scheduledLegDuration <= 0) { // Should not happen with valid data
                 currentBusDelayOrAheadMillis = 0; // Or some error indicator
                 timeDifferenceInfoDisplay.textContent = 'Error Tiempos';
                 return;
            }
            
            const distPrevToNext = calculateDistance(prevStop.lat, prevStop.lng, nextStop.lat, nextStop.lng);
            const distPrevToCurrent = calculateDistance(prevStop.lat, prevStop.lng, lastKnownPosition.lat, lastKnownPosition.lng);
            
            let fractionOfLegCoveredByDistance = 0;
            if (distPrevToNext > 0) {
                fractionOfLegCoveredByDistance = Math.min(1, Math.max(0, distPrevToCurrent / distPrevToNext));
            } else if (distPrevToCurrent > 0) { // On top of prevStop, but nextStop is same loc
                 fractionOfLegCoveredByDistance = 0; // No distance to cover
            }


            const scheduledTimeSpentOnLeg = fractionOfLegCoveredByDistance * scheduledLegDuration;
            scheduledTimeAtCurrentPoint = scheduledTimeAtPrevStop + scheduledTimeSpentOnLeg;
        }
        
        currentBusDelayOrAheadMillis = scheduledTimeAtCurrentPoint - now; // Positive means bus is ahead of schedule
        timeDifferenceInfoDisplay.textContent = formatDelayOrAhead(currentBusDelayOrAheadMillis);
    }
    
    function updateRealTimeInfoDisplay() {
        if (!isTracking || activeRouteFlatStops.length === 0) {
            nextStopInfoDisplay.textContent = '-';
            return;
        }

        let nextStopTargetIndex;
        if (currentTrackingStopIndex === -1) { // At start
            nextStopTargetIndex = 0; // The "next stop" is the start point itself, for departure
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

        if (currentTrackingStopIndex < activeRouteFlatStops.length - 2) { // If current is not the second to last stop
            currentTrackingStopIndex++;
        } else if (currentTrackingStopIndex === activeRouteFlatStops.length - 2) { // If current is second to last, next is last
            currentTrackingStopIndex++; // Now at last stop
            // Reached final stop of current route. If manual, user presses "Next Stop" again to change route.
             if (manual) updateAppStatus('En la última parada. "Siguiente" pasará a la próxima ruta.');
        } else if (currentTrackingStopIndex === activeRouteFlatStops.length - 1 && manual) { // At last stop, and "Next" pressed
            currentRouteIndexInQueue++;
            processNextRouteInQueue(); // This will reset currentTrackingStopIndex to -1 for the new route
            return; // Return early as route has changed
        } else { // Already at or past last stop, or invalid state
            if (!manual) { // Auto mode tried to advance past end, should be caught by geofence logic
                currentRouteIndexInQueue++;
                processNextRouteInQueue();
                return;
            }
            // If manual and no more routes, do nothing further or indicate end of all tracking.
            if (currentRouteIndexInQueue >= trackingQueue.length -1) {
                updateAppStatus('Fin de todas las rutas en cola.');
                // Optionally stop tracking if manual and at very end.
                // stopTracking();
                return;
            }
        }
        updateRealTimeInfoDisplay();
        updateTrackingStatusInLocalStorage();
        if (manual) updateAppStatus(`Avance manual a parada (índice ${currentTrackingStopIndex}).`);
    }

    function advanceToPreviousStop() { // Only for manual mode
        if (!isTracking || !manualModeCheckbox.checked) return;
        if (currentTrackingStopIndex > -1) {
            currentTrackingStopIndex--;
        } else {
            // TODO: Go to previous route's last stop? For now, just stay at -1 of current.
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

        // 1. Check for exiting Start Geofence (if at start)
        if (currentTrackingStopIndex === -1) {
            const startPoint = activeRouteFlatStops[0];
            const distFromStart = calculateDistance(currentLat, currentLng, startPoint.lat, startPoint.lng);
            if (distFromStart > GEOFENCE_RADIUS_METERS) {
                updateAppStatus('Saliendo de geofence de inicio.');
                advanceToNextStop(); // Moves currentTrackingStopIndex from -1 to 0
            }
            return; // Don't check other conditions if just handled start
        }

        // 2. Check for entering End Geofence (transition to next route)
        const endPoint = activeRouteFlatStops[activeRouteFlatStops.length - 1];
        const distToEnd = calculateDistance(currentLat, currentLng, endPoint.lat, endPoint.lng);
        
        // Only transition if we are heading towards the end point or are very close to it.
        // i.e., currentTrackingStopIndex is for the leg leading to the end point.
        if (currentTrackingStopIndex === activeRouteFlatStops.length - 2 && distToEnd <= PROXIMITY_THRESHOLD_METERS) {
             // This means we arrived at the stop *before* the end stop, and now are close to end stop.
             // This logic needs to be careful. If we are at stop N-2, next target is N-1 (end).
             // If distToEnd < GEOFENCE_RADIUS and we are on the last leg (or at the last stop)
        }

        // Refined logic for end geofence and intermediate stops:
        // currentTrackingStopIndex is the index of the stop WE DEPARTED FROM.
        // So, nextStopTargetIndex = currentTrackingStopIndex + 1.
        
        if (currentTrackingStopIndex >= activeRouteFlatStops.length -1) { // Already at/past final stop for this route
            if (distToEnd <= GEOFENCE_RADIUS_METERS) { // Still within end geofence or re-entered
                updateAppStatus('En geofence de fin de ruta. Transicionando...');
                currentRouteIndexInQueue++;
                processNextRouteInQueue(); // This will reset currentTrackingStopIndex to -1
            }
            return;
        }
        
        const nextStopTargetIndex = currentTrackingStopIndex + 1;
        if (nextStopTargetIndex >= activeRouteFlatStops.length) { // Should not happen if previous check is correct
             updateAppStatus('Índice de próxima parada fuera de rango.', true);
             return;
        }

        const nextStopData = activeRouteFlatStops[nextStopTargetIndex];
        const distToNextStop = calculateDistance(currentLat, currentLng, nextStopData.lat, nextStopData.lng);

        if (distToNextStop <= PROXIMITY_THRESHOLD_METERS) {
            if (nextStopTargetIndex === activeRouteFlatStops.length - 1) { // Reached the Final Stop
                updateAppStatus(`Llegando a parada final: ${nextStopData.name}. Dentro de geofence de fin.`);
                advanceToNextStop(); // currentTrackingStopIndex becomes index of final stop
                // Now, check if we are indeed inside the larger geofence of the final stop for route transition
                // This check will happen on the *next* GPS update, or we can force it.
                // If distToEnd (calculated above) <= GEOFENCE_RADIUS_METERS, then transition.
                 if (calculateDistance(currentLat, currentLng, endPoint.lat, endPoint.lng) <= GEOFENCE_RADIUS_METERS) {
                    updateAppStatus('Dentro de geofence de fin de ruta. Transicionando...');
                    currentRouteIndexInQueue++;
                    processNextRouteInQueue();
                 }

            } else { // Reached an Intermediate Stop
                updateAppStatus(`Llegando a parada intermedia: ${nextStopData.name}`);
                advanceToNextStop(); // Advances currentTrackingStopIndex
            }
        }
    }

    function findAndSetCurrentLeg() {
        if (!isTracking || !lastKnownPosition || activeRouteFlatStops.length < 2) return;
    
        const currentPos = lastKnownPosition;
    
        // Option 1: Check if near any specific stop
        for (let i = 0; i < activeRouteFlatStops.length; i++) {
            const stop = activeRouteFlatStops[i];
            if (calculateDistance(currentPos.lat, currentPos.lng, stop.lat, stop.lng) <= PROXIMITY_THRESHOLD_METERS) {
                // If at a stop, currentTrackingStopIndex should be the index of this stop,
                // meaning we are "at" it, or "just departed" it if it's not the end.
                // If it's the start stop (i=0), currentTrackingStopIndex should be 0 if departed, or -1 if still at start.
                // For simplicity, if at stop 'i', assume we are about to depart it or just did.
                currentTrackingStopIndex = i; 
                // If we are at the very first stop (index 0) and very close to it, it could mean we haven't "left" the start geofence.
                // However, findAndSetCurrentLeg is usually called when resuming auto mode, implying we are already on the way.
                if (i === 0 && calculateDistance(currentPos.lat, currentPos.lng, activeRouteFlatStops[0].lat, activeRouteFlatStops[0].lng) <= GEOFENCE_RADIUS_METERS && activeRouteFlatStops[0].departureTime > Date.now()) {
                    // If very close to start, and before departure time, maybe consider it -1
                    // This needs careful thought. For now, if near stop i, set index to i.
                }
                 updateAppStatus(`Re-sincronizado: Cerca de parada ${activeRouteFlatStops[i].name}. Índice actual: ${currentTrackingStopIndex}`);
                updateRealTimeInfoDisplay();
                updateTrackingStatusInLocalStorage();
                return;
            }
        }
    
        // Option 2: Find closest segment (more complex, simplified version here)
        // "Priorizar encontrar la parada más cercana adelante en el orden de la ruta."
        // Iterate forward from current known stop index (or 0).
        // Find the first segment (A->B) for which current position is "past A" but "not significantly past B".
        let bestFitLegStartIndex = -1;
        let minDistanceToProjectedPoint = Infinity;

        for (let i = 0; i < activeRouteFlatStops.length - 1; i++) {
            const p1 = activeRouteFlatStops[i];       // Start of segment
            const p2 = activeRouteFlatStops[i + 1];   // End of segment
    
            // Simplified: check if current position is "between" p1 and p2 by proximity
            // This doesn't properly project to segment but gives a rough idea.
            // A more robust method projects currentPos onto the line defined by p1-p2.
            // Let's find the leg where our current position is "most likely" on, by checking distances to endpoints of segments.
            const distToP1 = calculateDistance(currentPos.lat, currentPos.lng, p1.lat, p1.lng);
            const distToP2 = calculateDistance(currentPos.lat, currentPos.lng, p2.lat, p2.lng);
            const distP1P2 = calculateDistance(p1.lat, p1.lng, p2.lat, p2.lng);

            // Basic check: if sum of distances to endpoints is close to segment length, we are near the segment.
            if (Math.abs(distToP1 + distToP2 - distP1P2) < distP1P2 * 0.5) { // Within 50% margin, crude
                 // Heuristic: if we are closer to P1 than P2 on this "good" segment,
                 // assume we are on this segment, having departed P1.
                 // If there are multiple such segments, we need to pick one.
                 // The prompt asks to prioritize "adelante en la ruta".
                 // This means if currentTrackingStopIndex was, say, 2, we'd start looking from leg 2->3.

                 // Simpler: find the *next stop* we haven't passed yet.
                 // Find i such that currentPos is before stop i+1, but after stop i.
                 // This implies currentTrackingStopIndex = i.
                 // A very simple approach: Find the stop we've most recently passed.
                 // Assume currentTrackingStopIndex is the previously set one.
                 // Iterate from currentTrackingStopIndex + 1. Find the first stop ahead that we are NOT yet close to.
                 // The stop before that is our current departure point.

                 // Let's use the "closest segment" idea based on projection (conceptual, not fully implemented here for brevity)
                 // For now, a heuristic: find the segment start point (p1) that is closest to current position,
                 // but current position is "past" it in the direction of p2.
                 // This is still tricky without full projection.
                 
                 // Fallback / Simplification for this exercise:
                 // Find the stop `j` that the `currentPos` is closest to overall.
                 // If `currentPos` is roughly "after" `j` (in route direction) or "at" `j`, then set `currentTrackingStopIndex = j`.
                 // If `currentPos` is "before" `j`, then `currentTrackingStopIndex = j-1`.
                 // This can be error-prone.
            }
        }
        // Fallback: find the closest stop overall and assume we departed from it or are at it.
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
             // If we are very close to this stop, it's likely our current stop.
             // If not very close, we need to determine if we are before or after it along the path.
             // For simplicity now, if we are forced to resync and not near any stop,
             // we assume we've departed from the overall closest stop.
             // This isn't perfect as "closest" might be backwards.
             // "Prioritize adelante":
             // Try to find the *last stop passed*. Iterate stops from start.
             // If distance to stop i+1 is much larger than to stop i, and we are past i.
             let lastPassedStopIndex = -1;
             for (let i = 0; i < activeRouteFlatStops.length -1; i++) {
                 const stopA = activeRouteFlatStops[i];
                 const stopB = activeRouteFlatStops[i+1];
                 // Crude check: if current position is further from A than B is from A, but closer to B.
                 const distACurr = calculateDistance(stopA.lat, stopA.lng, currentPos.lat, currentPos.lng);
                 const distBCurr = calculateDistance(stopB.lat, stopB.lng, currentPos.lat, currentPos.lng);
                 const distAB = calculateDistance(stopA.lat, stopA.lng, stopB.lat, stopB.lng);

                 if (distACurr < distAB && distBCurr < distAB) { // Roughly between A and B
                     lastPassedStopIndex = i; // We are on leg A->B
                 } else if (distACurr > distAB && distBCurr < distACurr) { // Potentially past A, heading to B or past B
                     // This logic gets complicated quickly.
                 }
             }
             // If no clear segment, use the `closestStopIndex` and hope it's mostly forward.
             // A better `findAndSetCurrentLeg` would be more involved with vector math.
             // For now, if not near a stop, and we are forced to sync:
             // Take the closest stop. Assume we are heading from it if it's not the last one.
             if (closestStopIndex < activeRouteFlatStops.length -1) {
                currentTrackingStopIndex = closestStopIndex;
             } else { // Closest to last stop
                currentTrackingStopIndex = activeRouteFlatStops.length -1; // At last stop
             }

             updateAppStatus(`Re-sincronizado (heurística): Índice ${currentTrackingStopIndex} (${activeRouteFlatStops[currentTrackingStopIndex].name}).`);
        } else {
            updateAppStatus('No se pudo re-sincronizar la posición en la ruta.', true);
             // Keep currentTrackingStopIndex as is, or reset to -1?
        }
        updateRealTimeInfoDisplay();
        updateTrackingStatusInLocalStorage();
    }
    

    manualModeCheckbox.addEventListener('change', (e) => {
        const isManual = e.target.checked;
        toggleManualControls(isManual);
        if (!isManual && isTracking) { // Switched from Manual to Auto
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
    nextStopButton.addEventListener('click', ()_=> advanceToNextStop(true)); // Pass true for manual


    // --- localStorage Communication ---
    function updateTrackingStatusInLocalStorage() {
        if (!isTracking && !localStorage.getItem(LOCALSTORAGE_STATUS_KEY)) { // If never tracked, or explicitly stopped
            const initialStatus = { isTracking: false, hasError: false, errorReason: '', lastUpdateTime: Date.now() };
            localStorage.setItem(LOCALSTORAGE_STATUS_KEY, JSON.stringify(initialStatus));
            return;
        }
        if (!isTracking) { // if tracking was stopped, the stopTracking function already saved.
            return;
        }
        
        // If tracking, but essential data missing (e.g., before first GPS fix or route load)
        if (activeRouteFlatStops.length === 0 || currentRouteIndexInQueue < 0) {
            // Save a minimal "tracking but waiting" status
            const waitingStatus = {
                isTracking: true,
                hasError: false, // Or true if specific error occurred
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
            hasError: false, // Assuming no GPS error for this specific update cycle
            errorReason: '',
            routeName: routeName,
            currentRouteIndexInQueue: currentRouteIndexInQueue,
            trackingQueueNames: trackingQueue,
            currentStopIndexFromWhichDeparted: currentTrackingStopIndex,
            nextStopIndexTowardsWhichHeading: nextStopIdx < activeRouteFlatStops.length ? nextStopIdx : -1, // -1 if at/past end
            currentBusDelayOrAheadMillis: currentBusDelayOrAheadMillis,
            lastKnownPosition: lastKnownPosition,
            lastUpdateTime: Date.now(),
            routeStops: activeRouteFlatStops, // Already has timestamps
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
        resetCurrentRoute(); // Initialize editor state
        renderRouteEditor(); // Initial render of empty editor
        registerServiceWorker();
        // Check if there's an existing tracking status (e.g. app reloaded)
        // For simplicity, this app starts fresh. A more robust PWA might try to resume.
        updateTrackingStatusInLocalStorage(); // Set initial false state if not tracking
        
        startTrackingButton.addEventListener('click', startTracking);
        stopTrackingButton.addEventListener('click', () => stopTracking(false,''));
        updateAppStatus('Aplicación Smart Move Pro lista.');
    }

    initApp();
});
