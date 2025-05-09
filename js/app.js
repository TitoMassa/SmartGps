document.addEventListener('DOMContentLoaded', () => {
    // --- Constantes y Variables Globales ---
    const PROXIMITY_THRESHOLD_METERS = 50; // Metros para considerar llegada a parada intermedia
    const GEOFENCE_RADIUS_METERS = 100; // Metros para geofence de inicio/fin
    const LOCALSTORAGE_ROUTES_KEY = 'smartMoveProRoutes';
    const LOCALSTORAGE_TRACKING_KEY = 'smartMoveProTrackingStatus';

    let map;
    let currentRoute = {
        name: '',
        startPoint: null, // { lat, lng, name, time }
        intermediateStops: [], // [{ lat, lng, name (opcional), time }]
        endPoint: null, // { lat, lng, name, time }
    };
    let savedRoutes = JSON.parse(localStorage.getItem(LOCALSTORAGE_ROUTES_KEY)) || [];
    let trackingQueue = []; // Array de nombres de rutas
    
    let isTracking = false;
    let currentTrackingRouteIndex = -1; // Índice de la ruta actual en trackingQueue
    let currentTrackingStopIndex = -1; // -1: en inicio, 0: hacia parada 1, ... n: hacia fin
    let watchId = null;
    let currentPositionMarker = null;
    let routePolyline = null;
    let stopMarkers = [];
    let geofenceCircles = [];
    let lastKnownPosition = null;
    let trackingUpdateInterval = null;

    // --- DOM Elements ---
    const startLatInput = document.getElementById('startLat');
    const startLngInput = document.getElementById('startLng');
    const startNameInput = document.getElementById('startName');
    const startTimeInput = document.getElementById('startTime');
    const endLatInput = document.getElementById('endLat');
    const endLngInput = document.getElementById('endLng');
    const endNameInput = document.getElementById('endName');
    const endTimeInput = document.getElementById('endTime');
    const autoCalcTimesCheckbox = document.getElementById('autoCalcTimes');
    const intermediateStopManualTimeDiv = document.getElementById('intermediateStopManualTime');
    const intermediateTimeInput = document.getElementById('intermediateTime');
    
    const stopsListUI = document.getElementById('stopsList');
    const routeNameInput = document.getElementById('routeName');
    const saveRouteBtn = document.getElementById('saveRouteBtn');
    const loadRouteSelect = document.getElementById('loadRouteSelect');
    const loadRouteBtn = document.getElementById('loadRouteBtn');
    const deleteRouteBtn = document.getElementById('deleteRouteBtn');

    const addToQueueBtn = document.getElementById('addToQueueBtn');
    const trackingQueueDisplay = document.getElementById('trackingQueueDisplay');
    const clearQueueBtn = document.getElementById('clearQueueBtn');

    const startTrackingBtn = document.getElementById('startTrackingBtn');
    const stopTrackingBtn = document.getElementById('stopTrackingBtn');
    const manualControlCheckbox = document.getElementById('manualControlCheckbox');
    const prevStopBtn = document.getElementById('prevStopBtn');
    const nextStopBtn = document.getElementById('nextStopBtn');
    
    const nextStopInfoUI = document.getElementById('nextStopInfo');
    const timeDiffInfoUI = document.getElementById('timeDiffInfo');
    const gpsStatusUI = document.getElementById('gpsStatus');

    // --- Inicialización ---
    function initApp() {
        initMap();
        loadRoutesFromStorage();
        updateLoadRouteSelect();
        updateTrackingQueueDisplay();
        updateButtonsState();
        registerServiceWorker();

        // Event Listeners
        map.on('click', handleMapClick);
        autoCalcTimesCheckbox.addEventListener('change', () => {
            intermediateStopManualTimeDiv.style.display = autoCalcTimesCheckbox.checked ? 'none' : 'block';
        });
        saveRouteBtn.addEventListener('click', saveCurrentRoute);
        loadRouteBtn.addEventListener('click', loadSelectedRoute);
        deleteRouteBtn.addEventListener('click', deleteSelectedRoute);
        
        addToQueueBtn.addEventListener('click', addCurrentRouteToQueue);
        clearQueueBtn.addEventListener('click', clearTrackingQueue);

        startTrackingBtn.addEventListener('click', startTracking);
        stopTrackingBtn.addEventListener('click', stopTracking);
        manualControlCheckbox.addEventListener('change', handleManualControlToggle);
        prevStopBtn.addEventListener('click', () => manualChangeStop(-1));
        nextStopBtn.addEventListener('click', () => manualChangeStop(1));

        // Default location if geolocation is not available or denied
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(position => {
                map.setView([position.coords.latitude, position.coords.longitude], 13);
            }, () => {
                map.setView([-34.6037, -58.3816], 12); // Buenos Aires fallback
            });
        } else {
            map.setView([-34.6037, -58.3816], 12); // Buenos Aires fallback
        }
    }

    function initMap() {
        map = L.map('map').setView([-34.6037, -58.3816], 12); // Default to Buenos Aires
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
    }

    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .then(registration => console.log('Service Worker registered with scope:', registration.scope))
                .catch(error => console.log('Service Worker registration failed:', error));
        }
    }

    // --- Lógica de Creación/Edición de Rutas ---
    function handleMapClick(e) {
        if (!currentRoute.startPoint || !currentRoute.endPoint) {
            alert('Define primero el Punto de Inicio y Fin.');
            return;
        }
        const { lat, lng } = e.latlng;
        const stopName = `Parada ${currentRoute.intermediateStops.length + 1}`;
        let stopTime = null;

        if (!autoCalcTimesCheckbox.checked) {
            if (!intermediateTimeInput.value) {
                alert("Por favor, ingrese la hora para la parada intermedia manual.");
                return;
            }
            stopTime = intermediateTimeInput.value;
        }

        currentRoute.intermediateStops.push({ lat, lng, name: stopName, time: stopTime });
        
        if (autoCalcTimesCheckbox.checked) {
            calculateAndAssignIntermediateTimes();
        }
        renderCurrentRouteOnMap(true); // true for editing mode
        updateStopsListUI();
    }

    function updateRoutePoint(type, value, field) {
        // Helper to update start/end points and re-render if necessary
        let pointChanged = false;
        if (type === 'start') {
            if (!currentRoute.startPoint) currentRoute.startPoint = {};
            if (currentRoute.startPoint[field] !== value) {
                currentRoute.startPoint[field] = value;
                pointChanged = true;
            }
        } else if (type === 'end') {
            if (!currentRoute.endPoint) currentRoute.endPoint = {};
            if (currentRoute.endPoint[field] !== value) {
                currentRoute.endPoint[field] = value;
                pointChanged = true;
            }
        }
        if (pointChanged && (field === 'lat' || field === 'lng')) {
            if (autoCalcTimesCheckbox.checked) calculateAndAssignIntermediateTimes();
            renderCurrentRouteOnMap(true);
        } else if (pointChanged && field === 'time') {
             if (autoCalcTimesCheckbox.checked) calculateAndAssignIntermediateTimes();
             updateStopsListUI();
        } else if (pointChanged && field === 'name') {
            updateStopsListUI();
        }
    }
    
    // Bind input changes to updateRoutePoint
    startLatInput.addEventListener('change', (e) => updateRoutePoint('start', parseFloat(e.target.value), 'lat'));
    startLngInput.addEventListener('change', (e) => updateRoutePoint('start', parseFloat(e.target.value), 'lng'));
    startNameInput.addEventListener('change', (e) => updateRoutePoint('start', e.target.value, 'name'));
    startTimeInput.addEventListener('change', (e) => updateRoutePoint('start', e.target.value, 'time'));
    endLatInput.addEventListener('change', (e) => updateRoutePoint('end', parseFloat(e.target.value), 'lat'));
    endLngInput.addEventListener('change', (e) => updateRoutePoint('end', parseFloat(e.target.value), 'lng'));
    endNameInput.addEventListener('change', (e) => updateRoutePoint('end', e.target.value, 'name'));
    endTimeInput.addEventListener('change', (e) => updateRoutePoint('end', e.target.value, 'time'));


    function calculateAndAssignIntermediateTimes() {
        if (!currentRoute.startPoint || !currentRoute.endPoint || !currentRoute.startPoint.time || !currentRoute.endPoint.time || currentRoute.intermediateStops.length === 0) {
            return;
        }

        const startDate = parseTimeToDate(currentRoute.startPoint.time);
        const endDate = parseTimeToDate(currentRoute.endPoint.time);
        if (!startDate || !endDate || startDate >= endDate) {
            console.warn("Tiempos de inicio/fin inválidos para cálculo automático.");
            currentRoute.intermediateStops.forEach(s => s.time = null); // Clear times if calculation fails
            updateStopsListUI();
            return;
        }

        const totalDurationMillis = endDate.getTime() - startDate.getTime();
        const allPoints = [currentRoute.startPoint, ...currentRoute.intermediateStops, currentRoute.endPoint];
        let totalDistance = 0;
        const segmentDistances = [];

        for (let i = 0; i < allPoints.length - 1; i++) {
            const dist = getDistance(allPoints[i].lat, allPoints[i].lng, allPoints[i+1].lat, allPoints[i+1].lng);
            segmentDistances.push(dist);
            totalDistance += dist;
        }

        if (totalDistance === 0) { // Avoid division by zero
            currentRoute.intermediateStops.forEach(s => s.time = null);
            updateStopsListUI();
            return;
        }
        
        let accumulatedMillis = 0;
        for (let i = 0; i < currentRoute.intermediateStops.length; i++) {
            // Distance from start to this intermediate stop i
            let distToCurrentIntermediate = 0;
            for (let j = 0; j <= i; j++) { // Sum distances of segments leading to this stop
                distToCurrentIntermediate += segmentDistances[j];
            }
            
            const timeRatio = distToCurrentIntermediate / totalDistance;
            accumulatedMillis = totalDurationMillis * timeRatio;
            const intermediateStopTime = new Date(startDate.getTime() + accumulatedMillis);
            currentRoute.intermediateStops[i].time = formatTime(intermediateStopTime);
        }
        updateStopsListUI();
    }

    function updateStopsListUI() {
        stopsListUI.innerHTML = '';
        if (!currentRoute.startPoint) return;

        const items = [];
        items.push({ ...currentRoute.startPoint, type: 'Inicio', originalIndex: -1 });
        currentRoute.intermediateStops.forEach((stop, index) => {
            items.push({ ...stop, type: `Parada ${index + 1}`, originalIndex: index });
        });
        if (currentRoute.endPoint) {
            items.push({ ...currentRoute.endPoint, type: 'Fin', originalIndex: -2 });
        }

        items.forEach(item => {
            const li = document.createElement('li');
            let timeDisplay = item.time ? ` (${item.time})` : ' (Sin hora)';
            li.textContent = `${item.type}: ${item.name || 'Sin nombre'} ${timeDisplay}`;
            
            if (item.type.startsWith('Parada')) { // Intermediate stop
                const renameBtn = document.createElement('button');
                renameBtn.textContent = 'Renombrar';
                renameBtn.onclick = ()_ => renameIntermediateStop(item.originalIndex);
                
                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'X';
                deleteBtn.className = 'danger';
                deleteBtn.onclick = () => deleteIntermediateStop(item.originalIndex);
                
                const divButtons = document.createElement('div');
                divButtons.appendChild(renameBtn);
                divButtons.appendChild(deleteBtn);
                li.appendChild(divButtons);
            }
            stopsListUI.appendChild(li);
        });
    }
    
    function renameIntermediateStop(index) {
        const stop = currentRoute.intermediateStops[index];
        const newName = prompt(`Nuevo nombre para "${stop.name || `Parada ${index+1}`}" (dejar vacío para nombre por defecto):`, stop.name || '');
        if (newName !== null) { // prompt returns null if cancel is pressed
            currentRoute.intermediateStops[index].name = newName.trim() === '' ? `Parada ${index + 1}` : newName.trim();
            updateStopsListUI();
            renderCurrentRouteOnMap(true); // Update marker title
        }
    }

    function deleteIntermediateStop(index) {
        if (confirm(`¿Eliminar ${currentRoute.intermediateStops[index].name || `Parada ${index+1}`}?`)) {
            currentRoute.intermediateStops.splice(index, 1);
            // Re-assign default names if needed and re-calculate times
            currentRoute.intermediateStops.forEach((stop, i) => {
                if (!stop.name || stop.name.startsWith("Parada ")) { // only re-name default ones
                    stop.name = `Parada ${i + 1}`;
                }
            });
            if (autoCalcTimesCheckbox.checked) {
                calculateAndAssignIntermediateTimes();
            }
            updateStopsListUI();
            renderCurrentRouteOnMap(true);
        }
    }

    function renderCurrentRouteOnMap(isEditing) {
        clearMapLayers(false); // false: don't clear currentPositionMarker or geofences if tracking

        const points = [];
        if (currentRoute.startPoint && currentRoute.startPoint.lat && currentRoute.startPoint.lng) {
            points.push(currentRoute.startPoint);
            addStopMarker(currentRoute.startPoint, 'I', 'Inicio', isEditing);
        }
        currentRoute.intermediateStops.forEach((stop, index) => {
            if (stop.lat && stop.lng) {
                points.push(stop);
                addStopMarker(stop, (index + 1).toString(), stop.name || `Parada ${index+1}`, isEditing);
            }
        });
        if (currentRoute.endPoint && currentRoute.endPoint.lat && currentRoute.endPoint.lng) {
            points.push(currentRoute.endPoint);
            addStopMarker(currentRoute.endPoint, 'F', 'Fin', isEditing);
        }

        if (points.length > 1) {
            const latLngs = points.map(p => [p.lat, p.lng]);
            routePolyline = L.polyline(latLngs, { color: isEditing ? 'blue' : 'green' }).addTo(map);
            if (isEditing && latLngs.length > 0) map.fitBounds(routePolyline.getBounds());
        }
    }

    function addStopMarker(point, label, type, isEditing) {
        const iconHtml = `<div style="background-color: ${isEditing ? 'dodgerblue' : 'darkgreen'}; color: white; border-radius: 50%; width: 25px; height: 25px; text-align: center; line-height: 25px; font-weight: bold;">${label}</div>`;
        const customIcon = L.divIcon({
            html: iconHtml,
            className: 'custom-div-icon',
            iconSize: [25, 25],
            iconAnchor: [12, 12]
        });
        const marker = L.marker([point.lat, point.lng], { icon: customIcon })
            .addTo(map)
            .bindPopup(`${type}: ${point.name || 'Sin Nombre'} ${point.time ? '('+point.time+')' : ''}`);
        stopMarkers.push(marker);
    }

    function clearMapLayers(clearAll = true) {
        stopMarkers.forEach(marker => map.removeLayer(marker));
        stopMarkers = [];
        if (routePolyline) map.removeLayer(routePolyline);
        routePolyline = null;
        
        if (clearAll) { // Typically when stopping tracking or loading a new route for editing
            if (currentPositionMarker) map.removeLayer(currentPositionMarker);
            currentPositionMarker = null;
            geofenceCircles.forEach(circle => map.removeLayer(circle));
            geofenceCircles = [];
        }
    }

    // --- Lógica de Gestión de Rutas (localStorage) ---
    function saveCurrentRoute() {
        const name = routeNameInput.value.trim();
        if (!name) {
            alert('Por favor, ingresa un nombre para la ruta.');
            return;
        }
        if (!currentRoute.startPoint || !currentRoute.endPoint || !currentRoute.startPoint.time || !currentRoute.endPoint.time) {
            alert('Completa los puntos de Inicio y Fin, incluyendo sus horarios.');
            return;
        }
        currentRoute.name = name;

        const existingRouteIndex = savedRoutes.findIndex(r => r.name === name);
        if (existingRouteIndex !== -1) {
            if (!confirm(`La ruta "${name}" ya existe. ¿Deseas sobrescribirla?`)) {
                return;
            }
            savedRoutes[existingRouteIndex] = JSON.parse(JSON.stringify(currentRoute)); // Deep copy
        } else {
            savedRoutes.push(JSON.parse(JSON.stringify(currentRoute)));
        }
        
        localStorage.setItem(LOCALSTORAGE_ROUTES_KEY, JSON.stringify(savedRoutes));
        updateLoadRouteSelect();
        alert(`Ruta "${name}" guardada.`);
    }

    function loadRoutesFromStorage() {
        const data = localStorage.getItem(LOCALSTORAGE_ROUTES_KEY);
        if (data) {
            savedRoutes = JSON.parse(data);
        }
    }

    function updateLoadRouteSelect() {
        loadRouteSelect.innerHTML = '<option value="">-- Selecciona una ruta --</option>';
        savedRoutes.forEach(route => {
            const option = document.createElement('option');
            option.value = route.name;
            option.textContent = route.name;
            loadRouteSelect.appendChild(option);
        });
    }

    function loadSelectedRoute() {
        const routeName = loadRouteSelect.value;
        if (!routeName) {
            alert("Selecciona una ruta para cargar.");
            return;
        }
        const routeToLoad = savedRoutes.find(r => r.name === routeName);
        if (routeToLoad) {
            currentRoute = JSON.parse(JSON.stringify(routeToLoad)); // Deep copy
            
            // Populate UI fields
            routeNameInput.value = currentRoute.name;
            if (currentRoute.startPoint) {
                startLatInput.value = currentRoute.startPoint.lat || '';
                startLngInput.value = currentRoute.startPoint.lng || '';
                startNameInput.value = currentRoute.startPoint.name || 'Inicio';
                startTimeInput.value = currentRoute.startPoint.time || '';
            }
            if (currentRoute.endPoint) {
                endLatInput.value = currentRoute.endPoint.lat || '';
                endLngInput.value = currentRoute.endPoint.lng || '';
                endNameInput.value = currentRoute.endPoint.name || 'Fin';
                endTimeInput.value = currentRoute.endPoint.time || '';
            }
            // Assuming autoCalcTimes was used or times are stored.
            // If not, user might need to re-trigger calculation or set checkbox.
            // For simplicity, we don't try to guess if autoCalc was checked when saved.

            clearMapLayers(true); // Clear everything including tracking artifacts
            renderCurrentRouteOnMap(true); // true for editing mode
            updateStopsListUI();
            alert(`Ruta "${routeName}" cargada.`);
        }
    }

    function deleteSelectedRoute() {
        const routeName = loadRouteSelect.value;
        if (!routeName) {
            alert("Selecciona una ruta para eliminar.");
            return;
        }
        if (confirm(`¿Estás seguro de que quieres eliminar la ruta "${routeName}"?`)) {
            savedRoutes = savedRoutes.filter(r => r.name !== routeName);
            localStorage.setItem(LOCALSTORAGE_ROUTES_KEY, JSON.stringify(savedRoutes));
            updateLoadRouteSelect();
            // If the deleted route was the one being edited, clear the editor
            if (currentRoute.name === routeName) {
                resetCurrentRoute();
                clearMapLayers(true);
                updateStopsListUI();
            }
            alert(`Ruta "${routeName}" eliminada.`);
        }
    }
    
    function resetCurrentRoute() {
        currentRoute = { name: '', startPoint: null, intermediateStops: [], endPoint: null };
        routeNameInput.value = '';
        startLatInput.value = ''; startLngInput.value = ''; startNameInput.value = 'Inicio'; startTimeInput.value = '';
        endLatInput.value = ''; endLngInput.value = ''; endNameInput.value = 'Fin'; endTimeInput.value = '';
        updateStopsListUI();
    }

    // --- Lógica de Cola de Seguimiento ---
    function addCurrentRouteToQueue() {
        const routeName = routeNameInput.value; // Use the name from the input field (loaded route)
        if (!routeName) {
            alert("Carga o guarda una ruta con nombre primero.");
            return;
        }
        const routeExists = savedRoutes.some(r => r.name === routeName);
        if (!routeExists) {
            alert(`La ruta "${routeName}" no se encuentra en las rutas guardadas. Guarda la ruta actual si es la que deseas añadir.`);
            return;
        }
        if (trackingQueue.includes(routeName)) {
            alert(`La ruta "${routeName}" ya está en la cola.`);
            return;
        }
        trackingQueue.push(routeName);
        updateTrackingQueueDisplay();
    }

    function updateTrackingQueueDisplay() {
        trackingQueueDisplay.innerHTML = '';
        if (trackingQueue.length === 0) {
            trackingQueueDisplay.innerHTML = '<li>Cola vacía</li>';
            return;
        }
        trackingQueue.forEach((routeName, index) => {
            const li = document.createElement('li');
            li.textContent = `${index + 1}. ${routeName}`;
            trackingQueueDisplay.appendChild(li);
        });
    }

    function clearTrackingQueue() {
        if (isTracking) {
            alert("No puedes limpiar la cola mientras el seguimiento está activo.");
            return;
        }
        trackingQueue = [];
        updateTrackingQueueDisplay();
    }

    // --- Lógica de Seguimiento en Tiempo Real ---
    function startTracking() {
        if (isTracking) return;
        if (trackingQueue.length === 0) {
            alert("Añade rutas a la cola de seguimiento primero.");
            return;
        }

        if (!navigator.geolocation) {
            gpsStatusUI.textContent = "Geolocalización no soportada.";
            alert("Tu navegador no soporta geolocalización.");
            return;
        }
        
        isTracking = true;
        currentTrackingRouteIndex = 0;
        currentTrackingStopIndex = -1; // At start point initially
        loadRouteForTracking(trackingQueue[currentTrackingRouteIndex]);
        
        gpsStatusUI.textContent = "Activando GPS...";
        watchId = navigator.geolocation.watchPosition(
            handlePositionUpdate,
            handlePositionError,
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
        
        trackingUpdateInterval = setInterval(updateTrackingStatusInLocalStorage, 3000); // Update localStorage every 3s

        updateButtonsState();
        updateNextStopDisplay();
        updateTimeDiffDisplay(0); // Initial display
        console.log("Seguimiento iniciado.");
    }

    function stopTracking(informUser = true) {
        if (!isTracking) return;

        isTracking = false;
        if (watchId) navigator.geolocation.clearWatch(watchId);
        watchId = null;
        if (trackingUpdateInterval) clearInterval(trackingUpdateInterval);
        trackingUpdateInterval = null;
        
        gpsStatusUI.textContent = "Inactivo";
        nextStopInfoUI.textContent = "---";
        timeDiffInfoUI.textContent = "---";
        
        // Clear tracking specific map elements but keep route definition if user wants to see it
        if (currentPositionMarker) map.removeLayer(currentPositionMarker);
        currentPositionMarker = null;
        geofenceCircles.forEach(circle => map.removeLayer(circle));
        geofenceCircles = [];
        
        // Update localStorage to indicate tracking stopped
        const status = {
            isTracking: false,
            lastUpdateTime: Date.now()
        };
        localStorage.setItem(LOCALSTORAGE_TRACKING_KEY, JSON.stringify(status));

        updateButtonsState();
        if (informUser) alert("Seguimiento detenido.");
        console.log("Seguimiento detenido.");
        // Optionally, clear the current route from view or revert to editing mode
        // For now, let's leave the last tracked route visible
    }

    function loadRouteForTracking(routeName) {
        const routeData = savedRoutes.find(r => r.name === routeName);
        if (!routeData) {
            console.error(`Ruta ${routeName} no encontrada para seguimiento.`);
            stopTracking(); // Stop if route is missing
            alert(`Error: Ruta ${routeName} no encontrada. Deteniendo seguimiento.`);
            return;
        }
        currentRoute = JSON.parse(JSON.stringify(routeData)); // Use a copy for tracking
        
        clearMapLayers(true); // Clear all previous map layers
        renderCurrentRouteOnMap(false); // false for tracking mode (green lines)
        
        if (currentRoute.startPoint && currentRoute.endPoint) {
            drawGeofences(currentRoute.startPoint, currentRoute.endPoint);
        }
        map.fitBounds(L.polyline(getAllStopsLatLngs(currentRoute)).getBounds());
        updateNextStopDisplay();
    }

    function handlePositionUpdate(position) {
        const { latitude, longitude, accuracy } = position.coords;
        lastKnownPosition = { lat: latitude, lng: longitude };
        gpsStatusUI.textContent = `Activo (Precisión: ${accuracy.toFixed(0)}m)`;

        if (!currentPositionMarker) {
            currentPositionMarker = L.circleMarker([latitude, longitude], {
                radius: 8,
                fillColor: "#2196f3", // Blue
                color: "#fff",
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(map).bindPopup("Tu Ubicación");
        } else {
            currentPositionMarker.setLatLng([latitude, longitude]);
        }
        map.panTo([latitude, longitude], { animate: true });

        if (!manualControlCheckbox.checked) {
            checkGeofencesAndProximity();
        }
        calculateTimeDifference(); // This will also update the display
        // updateTrackingStatusInLocalStorage(); // Called by interval now
    }

    function handlePositionError(error) {
        let message = "Error de GPS: ";
        switch (error.code) {
            case error.PERMISSION_DENIED: message += "Permiso denegado."; break;
            case error.POSITION_UNAVAILABLE: message += "Posición no disponible."; break;
            case error.TIMEOUT: message += "Timeout."; break;
            default: message += "Error desconocido."; break;
        }
        gpsStatusUI.textContent = message;
        console.error(message, error);
        // Consider stopping tracking or notifying user more prominently
        updateTrackingStatusInLocalStorage(true, message); // Update with error
    }

    function drawGeofences(startPoint, endPoint) {
        geofenceCircles.forEach(circle => map.removeLayer(circle));
        geofenceCircles = [];
        if (startPoint && startPoint.lat && startPoint.lng) {
            const startGeofence = L.circle([startPoint.lat, startPoint.lng], {
                radius: GEOFENCE_RADIUS_METERS,
                color: 'orange',
                fillOpacity: 0.1
            }).addTo(map);
            geofenceCircles.push(startGeofence);
        }
        if (endPoint && endPoint.lat && endPoint.lng) {
            const endGeofence = L.circle([endPoint.lat, endPoint.lng], {
                radius: GEOFENCE_RADIUS_METERS,
                color: 'red',
                fillOpacity: 0.1
            }).addTo(map);
            geofenceCircles.push(endGeofence);
        }
    }
    
    function calculateTimeDifference() {
        if (!isTracking || !currentRoute || !currentRoute.startPoint || !currentRoute.startPoint.time) {
            updateTimeDiffDisplay(0, true); // No data
            return 0;
        }
    
        const now = new Date();
        let scheduledTimeForCurrentState;
        let delayOrAheadMillis = 0;
    
        const allStops = [currentRoute.startPoint, ...currentRoute.intermediateStops, currentRoute.endPoint];
    
        if (currentTrackingStopIndex === -1) { // At start point, waiting for departure
            scheduledTimeForCurrentState = parseTimeToDate(currentRoute.startPoint.time);
            if (!scheduledTimeForCurrentState) {
                updateTimeDiffDisplay(0, true); return 0;
            }
            delayOrAheadMillis = scheduledTimeForCurrentState.getTime() - now.getTime(); // Positive if ahead of schedule (early)
        } else { // En route to a stop or at the final stop
            const fromStopIndex = currentTrackingStopIndex;
            const toStopIndex = currentTrackingStopIndex + 1;
    
            if (fromStopIndex >= allStops.length -1) { // Already at or past the last stop
                 const finalStopScheduledTime = parseTimeToDate(allStops[allStops.length-1].time);
                 if (!finalStopScheduledTime) { updateTimeDiffDisplay(0, true); return 0; }
                 delayOrAheadMillis = finalStopScheduledTime.getTime() - now.getTime();
            } else {
                const fromStop = allStops[fromStopIndex];
                const toStop = allStops[toStopIndex];
    
                const scheduledDepartureFrom = parseTimeToDate(fromStop.time); // For intermediate, arrival = departure
                const scheduledArrivalAtTo = parseTimeToDate(toStop.time);
    
                if (!scheduledDepartureFrom || !scheduledArrivalAtTo || !lastKnownPosition) {
                    updateTimeDiffDisplay(0, true); return 0;
                }
    
                const legScheduledDuration = scheduledArrivalAtTo.getTime() - scheduledDepartureFrom.getTime();
                if (legScheduledDuration <= 0) { // Invalid schedule for leg
                     updateTimeDiffDisplay(0, true); return 0;
                }
    
                const distanceTotalLeg = getDistance(fromStop.lat, fromStop.lng, toStop.lat, toStop.lng);
                const distanceFromStartOfLeg = getDistance(fromStop.lat, fromStop.lng, lastKnownPosition.lat, lastKnownPosition.lng);
                
                let progressRatio = 0;
                if (distanceTotalLeg > 0) {
                    progressRatio = Math.min(1, distanceFromStartOfLeg / distanceTotalLeg); // Cap at 1
                } else if (distanceFromStartOfLeg === 0) { // At the start of leg, and leg has 0 distance
                    progressRatio = 0; 
                } else { // Not at start of leg, but leg has 0 distance (e.g. same point)
                    progressRatio = 1; // Consider it completed
                }

                const scheduledTimeAtCurrentPosition = scheduledDepartureFrom.getTime() + (legScheduledDuration * progressRatio);
                delayOrAheadMillis = scheduledTimeAtCurrentPosition - now.getTime(); // Positive if ahead
            }
        }
        updateTimeDiffDisplay(delayOrAheadMillis);
        return delayOrAheadMillis;
    }

    function updateTimeDiffDisplay(millis, noData = false) {
        if (noData) {
            timeDiffInfoUI.textContent = "---";
            return;
        }
        const absMillis = Math.abs(millis);
        const minutes = Math.floor(absMillis / 60000);
        const seconds = Math.floor((absMillis % 60000) / 1000);
        const sign = millis >= 0 ? '+' : '-';
        timeDiffInfoUI.textContent = `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function updateNextStopDisplay() {
        if (!isTracking || !currentRoute) {
            nextStopInfoUI.textContent = "---";
            return;
        }
        const allStops = [currentRoute.startPoint, ...currentRoute.intermediateStops, currentRoute.endPoint];
        let info = "";

        if (currentTrackingStopIndex === -1) { // At start
            info = `Salida de ${currentRoute.startPoint.name} a las ${currentRoute.startPoint.time}`;
        } else if (currentTrackingStopIndex < allStops.length - 1) {
            const nextStop = allStops[currentTrackingStopIndex + 1];
            info = `Hacia ${nextStop.name} (Prog: ${nextStop.time})`;
        } else { // Arrived at final stop or beyond
            info = `En ${currentRoute.endPoint.name} (Destino Final)`;
        }
        nextStopInfoUI.textContent = info;
    }

    function checkGeofencesAndProximity() {
        if (!isTracking || manualControlCheckbox.checked || !lastKnownPosition || !currentRoute) return;

        const allStops = [currentRoute.startPoint, ...currentRoute.intermediateStops, currentRoute.endPoint];

        if (currentTrackingStopIndex === -1) { // At start point
            const distFromStart = getDistance(lastKnownPosition.lat, lastKnownPosition.lng, currentRoute.startPoint.lat, currentRoute.startPoint.lng);
            if (distFromStart > GEOFENCE_RADIUS_METERS) {
                console.log("Salió del geofence de inicio. En ruta hacia parada 1.");
                currentTrackingStopIndex = 0; // Departed from start, heading to first intermediate (or end if no intermediates)
                updateNextStopDisplay();
                updateTrackingStatusInLocalStorage();
            }
        } else {
            // Check proximity to next stop (intermediate or end)
            const nextStopTargetIndex = currentTrackingStopIndex + 1;
            if (nextStopTargetIndex < allStops.length) { // There is a next stop
                const nextStopCoords = allStops[nextStopTargetIndex];
                const distToNextStop = getDistance(lastKnownPosition.lat, lastKnownPosition.lng, nextStopCoords.lat, nextStopCoords.lng);

                if (nextStopTargetIndex === allStops.length - 1) { // Next stop is the final destination
                    if (distToNextStop <= GEOFENCE_RADIUS_METERS) {
                        console.log("Entró al geofence de fin de ruta.");
                        advanceToNextRouteInQueue(); // This will handle stopping if it's the last route
                    }
                } else { // Next stop is an intermediate stop
                    if (distToNextStop <= PROXIMITY_THRESHOLD_METERS) {
                        console.log(`Llegó a la proximidad de ${nextStopCoords.name}. Avanzando.`);
                        currentTrackingStopIndex = nextStopTargetIndex; // Arrived at this intermediate, now heading to next
                        updateNextStopDisplay();
                        updateTrackingStatusInLocalStorage();
                    }
                }
            }
        }
    }
    
    function advanceToNextRouteInQueue() {
        currentTrackingRouteIndex++;
        if (currentTrackingRouteIndex < trackingQueue.length) {
            const nextRouteName = trackingQueue[currentTrackingRouteIndex];
            alert(`Transición automática a la siguiente ruta: ${nextRouteName}`);
            loadRouteForTracking(nextRouteName);
            currentTrackingStopIndex = -1; // Reset to start of new route
            updateNextStopDisplay();
            updateTrackingStatusInLocalStorage();
        } else {
            alert("Fin de todas las rutas en la cola. Deteniendo seguimiento.");
            stopTracking(false); // false: don't show generic "stopped" alert
        }
    }

    function handleManualControlToggle() {
        const isManual = manualControlCheckbox.checked;
        prevStopBtn.disabled = !isManual || !isTracking;
        nextStopBtn.disabled = !isManual || !isTracking;

        if (!isManual && isTracking) { // Switched from Manual to Auto
            findAndSetCurrentLeg();
        }
        updateTrackingStatusInLocalStorage(); // Reflect manual mode change
    }

    function manualChangeStop(direction) { // direction: 1 for next, -1 for prev
        if (!isTracking || !manualControlCheckbox.checked) return;

        const allStops = [currentRoute.startPoint, ...currentRoute.intermediateStops, currentRoute.endPoint];
        
        if (direction === 1) { // Next Stop
            if (currentTrackingStopIndex < allStops.length - 2) { // Not yet at the stop before final
                currentTrackingStopIndex++;
            } else if (currentTrackingStopIndex === allStops.length - 2) { // At the stop before final, next is final
                currentTrackingStopIndex++; // Now at final stop
                 // User must press "Next" again at final stop to advance route
            } else if (currentTrackingStopIndex === allStops.length -1) { // At final stop
                alert("En la parada final. Presiona 'Siguiente' de nuevo para pasar a la próxima ruta si existe.");
                advanceToNextRouteInQueue(); // This will handle logic if no more routes
                return; // advanceToNextRouteInQueue handles display updates
            }
        } else if (direction === -1) { // Prev Stop
            if (currentTrackingStopIndex > -1) {
                currentTrackingStopIndex--;
            } else {
                alert("Ya estás en el punto de inicio.");
            }
        }
        updateNextStopDisplay();
        calculateTimeDifference();
        updateTrackingStatusInLocalStorage();
    }

    function findAndSetCurrentLeg() {
        if (!isTracking || !lastKnownPosition || !currentRoute || currentRoute.intermediateStops.length === 0) {
            // If no intermediates, or not tracking, simple logic applies (either at start or towards end)
            // This function is more for routes with multiple intermediate stops.
            // For simplicity, if switching to auto and unsure, default to current index or start.
            // A more robust implementation would check distances to all segments.
            console.log("findAndSetCurrentLeg: Re-sincronización básica. Verificando estado actual.");
            checkGeofencesAndProximity(); // Let the standard check run
            return;
        }
    
        const allStops = [currentRoute.startPoint, ...currentRoute.intermediateStops, currentRoute.endPoint];
        let closestUpcomingStopIndex = -1;
        let minDistance = Infinity;
    
        // Iterate through all possible "next stops" (from index 0 up to final stop)
        for (let i = 0; i < allStops.length; i++) {
            const stopPoint = allStops[i];
            const distance = getDistance(lastKnownPosition.lat, lastKnownPosition.lng, stopPoint.lat, stopPoint.lng);
    
            // We are looking for the *next* stop. If we are very close to a stop,
            // it's likely we are heading *towards* it or have just passed it.
            // This logic prioritizes the stop we are heading towards.
            // A more complex logic would check if we are between stop A and B.
            
            // For now, a simpler approach: find the closest stop that is *not yet passed*
            // according to currentTrackingStopIndex.
            if (i > currentTrackingStopIndex) { // Only consider stops ahead of current leg
                if (distance < minDistance) {
                    minDistance = distance;
                    closestUpcomingStopIndex = i;
                }
            }
        }
        
        if (closestUpcomingStopIndex !== -1) {
            // The target is allStops[closestUpcomingStopIndex].
            // So, currentTrackingStopIndex should be closestUpcomingStopIndex - 1.
            const newCurrentStopIndex = closestUpcomingStopIndex - 1;
            if (newCurrentStopIndex !== currentTrackingStopIndex) {
                 console.log(`Re-sincronizado: Bus parece dirigirse hacia ${allStops[closestUpcomingStopIndex].name}. Índice de salida ajustado a ${newCurrentStopIndex}.`);
                 currentTrackingStopIndex = newCurrentStopIndex;
            }
        } else {
            // Could not determine a clear upcoming stop, might be past the last intermediate or near end.
            // Fallback to standard geofence/proximity check.
            console.log("findAndSetCurrentLeg: No se pudo determinar un tramo claro, usando lógica estándar.");
        }
        checkGeofencesAndProximity(); // Re-evaluate based on potentially new index
        updateNextStopDisplay();
        calculateTimeDifference();
        updateTrackingStatusInLocalStorage();
    }


    function updateButtonsState() {
        startTrackingBtn.disabled = isTracking || trackingQueue.length === 0;
        stopTrackingBtn.disabled = !isTracking;
        
        // Route editing/management buttons should be disabled during tracking
        const editingControls = [saveRouteBtn, loadRouteBtn, deleteRouteBtn, addToQueueBtn, clearQueueBtn,
                                 startLatInput, startLngInput, startNameInput, startTimeInput,
                                 endLatInput, endLngInput, endNameInput, endTimeInput, autoCalcTimesCheckbox];
        editingControls.forEach(control => control.disabled = isTracking);
        document.querySelectorAll('#stopsList button').forEach(btn => btn.disabled = isTracking);


        const isManual = manualControlCheckbox.checked;
        manualControlCheckbox.disabled = !isTracking;
        prevStopBtn.disabled = !isTracking || !isManual;
        nextStopBtn.disabled = !isTracking || !isManual;
    }

    // --- Comunicación (localStorage) ---
    function updateTrackingStatusInLocalStorage(hasError = false, errorReason = '') {
        if (!isTracking && !hasError) { // If tracking stopped normally
            localStorage.setItem(LOCALSTORAGE_TRACKING_KEY, JSON.stringify({ isTracking: false, lastUpdateTime: Date.now() }));
            return;
        }
        if (!currentRoute || !currentRoute.name) { // Not fully initialized for tracking
            // This might happen if stopTracking is called before a route is loaded for tracking
            // or if there's an error during initialization.
            if (isTracking || hasError) { // Only write if there's an active issue or was tracking
                 localStorage.setItem(LOCALSTORAGE_TRACKING_KEY, JSON.stringify({
                    isTracking: isTracking, // Could be true if error occurred while trying to track
                    hasError: true,
                    errorReason: errorReason || "Datos de ruta activa no disponibles.",
                    lastUpdateTime: Date.now()
                }));
            }
            return;
        }

        const delayOrAheadMillis = calculateTimeDifference(); // Ensure this is up-to-date

        const status = {
            isTracking: isTracking,
            hasError: hasError,
            errorReason: errorReason,
            routeName: currentRoute.name,
            currentRouteIndexInQueue: currentTrackingRouteIndex,
            trackingQueueNames: [...trackingQueue],
            currentStopIndexFromWhichDeparted: currentTrackingStopIndex, // This is the index of the stop *departed from*
            nextStopIndexTowardsWhichHeading: currentTrackingStopIndex + 1, // Index of the stop *heading to*
            currentBusDelayOrAheadMillis: delayOrAheadMillis,
            lastKnownPosition: lastKnownPosition ? { lat: lastKnownPosition.lat, lng: lastKnownPosition.lng } : null,
            lastUpdateTime: Date.now(),
            routeStops: flattenRouteStops(currentRoute)
        };
        localStorage.setItem(LOCALSTORAGE_TRACKING_KEY, JSON.stringify(status));
    }
    
    function flattenRouteStops(route) {
        if (!route || !route.startPoint) return [];
        const flatStops = [];

        flatStops.push({
            name: route.startPoint.name,
            type: 'start', // 'start', 'intermediate', 'end'
            originalName: route.startPoint.name, // Keep original name for display
            arrivalTime: null, // No arrival for start
            departureTime: route.startPoint.time 
        });

        route.intermediateStops.forEach((stop, index) => {
            flatStops.push({
                name: stop.name || `Parada ${index + 1}`,
                type: 'intermediate',
                originalName: stop.name || `Parada ${index + 1}`,
                arrivalTime: stop.time, // For intermediate, arrival and departure are the same 'passing' time
                departureTime: stop.time 
            });
        });

        if (route.endPoint) {
            flatStops.push({
                name: route.endPoint.name,
                type: 'end',
                originalName: route.endPoint.name,
                arrivalTime: route.endPoint.time,
                departureTime: null // No departure from end
            });
        }
        return flatStops;
    }


    // --- Helper Functions ---
    function getDistance(lat1, lon1, lat2, lon2) { // Haversine formula
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

    function parseTimeToDate(timeStr, baseDate = new Date()) { // HH:MM format
        if (!timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) return null;
        const [hours, minutes] = timeStr.split(':').map(Number);
        const date = new Date(baseDate);
        date.setHours(hours, minutes, 0, 0);
        return date;
    }
    
    function formatTime(dateObj) {
        if (!dateObj) return '';
        const hours = String(dateObj.getHours()).padStart(2, '0');
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    function getAllStopsLatLngs(route) {
        const latLngs = [];
        if (route.startPoint) latLngs.push([route.startPoint.lat, route.startPoint.lng]);
        route.intermediateStops.forEach(s => latLngs.push([s.lat, s.lng]));
        if (route.endPoint) latLngs.push([route.endPoint.lat, route.endPoint.lng]);
        return latLngs;
    }

    // --- Start the app ---
    initApp();
});
