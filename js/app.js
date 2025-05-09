document.addEventListener('DOMContentLoaded', () => {
    // --- CONSTANTES Y CONFIGURACIÓN ---
    const STORAGE_KEYS = {
        ROUTES: 'smartMoveProRoutes',
        TRACKING_STATUS: 'smartMoveProTrackingStatus',
        TRACKING_QUEUE: 'smartMoveProTrackingQueue' // Podríamos integrar esto en TRACKING_STATUS
    };
    const PROXIMITY_THRESHOLD_METERS = 50; // Proximidad para parada intermedia
    const GEOFENCE_RADIUS_METERS = 100; // Radio para geofence de inicio/fin

    // --- ESTADO DE LA APLICACIÓN ---
    let map;
    let currentRoute = {
        name: '',
        startPoint: null, // { lat, lng, name, departureTime (HH:MM string) }
        endPoint: null,   // { lat, lng, name, arrivalTime (HH:MM string) }
        intermediateStops: [] // Array of { lat, lng, name (opcional), arrivalTime, departureTime }
    };
    let savedRoutes = [];
    let trackingQueue = []; // Array de nombres de ruta

    let definingMode = null; // 'start', 'end', 'intermediate'
    
    let startMarker = null, endMarker = null;
    let intermediateMarkers = [];
    let routePolyline = null;
    let currentLocationMarker = null;
    let startGeofenceCircle = null, endGeofenceCircle = null;

    let isTracking = false;
    let currentTrackingRouteName = null; // Nombre de la ruta activa en seguimiento
    let currentTrackingRouteData = null; // Objeto de la ruta activa
    let currentTrackingStopIndex = -1; // -1: antes de inicio, 0: hacia parada 1 (o fin si no hay interm.), etc.
    let gpsWatchId = null;
    let lastKnownPosition = null;
    let trackingStatusUpdateInterval = null;
    let timeDifferenceUpdateInterval = null;

    // --- ELEMENTOS DEL DOM ---
    const routeNameInput = document.getElementById('routeName');
    const btnSetStartPoint = document.getElementById('btnSetStartPoint');
    const startPointNameInput = document.getElementById('startPointName');
    const startPointTimeInput = document.getElementById('startPointTime');
    const startPointCoordsSpan = document.getElementById('startPointCoords');
    const btnSetEndPoint = document.getElementById('btnSetEndPoint');
    const endPointNameInput = document.getElementById('endPointName');
    const endPointTimeInput = document.getElementById('endPointTime');
    const endPointCoordsSpan = document.getElementById('endPointCoords');
    const btnAddIntermediateStop = document.getElementById('btnAddIntermediateStop');
    const autoCalcTimesCheckbox = document.getElementById('autoCalcTimes');
    const currentRouteStopsList = document.getElementById('currentRouteStopsList');

    const btnSaveRoute = document.getElementById('btnSaveRoute');
    const savedRoutesSelect = document.getElementById('savedRoutesSelect');
    const btnLoadRoute = document.getElementById('btnLoadRoute');
    const btnDeleteRoute = document.getElementById('btnDeleteRoute');

    const btnAddSelectedToQueue = document.getElementById('btnAddSelectedToQueue');
    const trackingQueueList = document.getElementById('trackingQueueList');
    const btnClearQueue = document.getElementById('btnClearQueue');

    const btnStartTracking = document.getElementById('btnStartTracking');
    const btnStopTracking = document.getElementById('btnStopTracking');
    const trackingInfoDiv = document.getElementById('trackingInfo');
    const activeRouteNameSpan = document.getElementById('activeRouteName');
    const nextStopInfoSpan = document.getElementById('nextStopInfo');
    const timeDifferenceSpan = document.getElementById('timeDifference');
    const manualModeToggle = document.getElementById('manualModeToggle');
    const manualControlsDiv = document.getElementById('manualControls');
    const btnPreviousStop = document.getElementById('btnPreviousStop');
    const btnNextStop = document.getElementById('btnNextStop');

    // --- ICONOS LEAFLET ---
    const startIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
    const endIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
    const intermediateIcon = L.icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png', shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] });
    const busIcon = L.divIcon({ className: 'bus-icon', html: '🚌', iconSize: [30, 30], iconAnchor: [15, 15] });


    // --- INICIALIZACIÓN ---
    function init() {
        initMap();
        loadRoutesFromStorage();
        loadTrackingQueueFromStorage();
        populateSavedRoutesDropdown();
        renderTrackingQueueUI();
        setupEventListeners();
        registerServiceWorker();
        resetRouteDefinitionForm(); // Para asegurar estado limpio al inicio
    }

    function initMap() {
        map = L.map('map');
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        map.on('click', onMapClick);

        // Centrar mapa en ubicación actual (solo una vez al inicio)
        navigator.geolocation.getCurrentPosition(position => {
            map.setView([position.coords.latitude, position.coords.longitude], 13);
        }, () => {
            console.warn("No se pudo obtener la ubicación inicial. Usando vista por defecto.");
            map.setView([-34.6037, -58.3816], 12); // Buenos Aires por defecto
        });
    }

    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .then(registration => console.log('Service Worker registrado con éxito:', registration))
                .catch(error => console.error('Error al registrar Service Worker:', error));
        }
    }

    // --- MANEJO DE EVENTOS DEL DOM ---
    function setupEventListeners() {
        btnSetStartPoint.addEventListener('click', () => setDefiningMode('start'));
        btnSetEndPoint.addEventListener('click', () => setDefiningMode('end'));
        btnAddIntermediateStop.addEventListener('click', () => setDefiningMode('intermediate'));
        
        routeNameInput.addEventListener('change', (e) => currentRoute.name = e.target.value.trim());
        startPointNameInput.addEventListener('change', (e) => { if(currentRoute.startPoint) currentRoute.startPoint.name = e.target.value.trim(); renderCurrentRouteStopsUI(); });
        startPointTimeInput.addEventListener('change', (e) => { if(currentRoute.startPoint) currentRoute.startPoint.departureTime = e.target.value; recalculateAndRenderTimes(); });
        endPointNameInput.addEventListener('change', (e) => { if(currentRoute.endPoint) currentRoute.endPoint.name = e.target.value.trim(); renderCurrentRouteStopsUI(); });
        endPointTimeInput.addEventListener('change', (e) => { if(currentRoute.endPoint) currentRoute.endPoint.arrivalTime = e.target.value; recalculateAndRenderTimes(); });
        autoCalcTimesCheckbox.addEventListener('change', recalculateAndRenderTimes);

        btnSaveRoute.addEventListener('click', saveCurrentRoute);
        btnLoadRoute.addEventListener('click', loadSelectedRoute);
        btnDeleteRoute.addEventListener('click', deleteSelectedRoute);

        btnAddSelectedToQueue.addEventListener('click', addCurrentRouteToQueue);
        btnClearQueue.addEventListener('click', clearTrackingQueue);

        btnStartTracking.addEventListener('click', startTracking);
        btnStopTracking.addEventListener('click', stopTracking);
        manualModeToggle.addEventListener('change', handleManualModeToggle);
        btnPreviousStop.addEventListener('click', manualPreviousStop);
        btnNextStop.addEventListener('click', manualNextStop);
    }

    // --- LÓGICA DE DEFINICIÓN DE RUTA ---
    function setDefiningMode(mode) {
        definingMode = mode;
        console.log("Modo de definición:", mode);
        // Podrías añadir feedback visual aquí (ej. cambiar color de botones)
        if (mode === 'intermediate' && (!currentRoute.startPoint || !currentRoute.endPoint)) {
            alert("Define primero el Punto de Inicio y Fin para añadir paradas intermedias.");
            definingMode = null;
            return;
        }
        if (mode === 'intermediate') {
            btnAddIntermediateStop.textContent = "Tocando el mapa para añadir parada...";
        } else {
            btnAddIntermediateStop.textContent = "Añadir Parada Intermedia (toca el mapa)";
        }
    }

    function onMapClick(e) {
        if (!definingMode) return;

        const { lat, lng } = e.latlng;

        if (definingMode === 'start') {
            currentRoute.startPoint = { ...currentRoute.startPoint, lat, lng, name: startPointNameInput.value || "Inicio", type: 'start' };
            startPointCoordsSpan.textContent = `Lat/Lng: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            updateMapMarkers();
            definingMode = null;
        } else if (definingMode === 'end') {
            currentRoute.endPoint = { ...currentRoute.endPoint, lat, lng, name: endPointNameInput.value || "Fin", type: 'end' };
            endPointCoordsSpan.textContent = `Lat/Lng: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            updateMapMarkers();
            definingMode = null;
        } else if (definingMode === 'intermediate') {
            const stopName = `Parada ${currentRoute.intermediateStops.length + 1}`;
            currentRoute.intermediateStops.push({ lat, lng, name: stopName, type: 'intermediate', arrivalTime: '', departureTime: '' });
            // No resetear definingMode aquí para permitir añadir múltiples paradas intermedias.
            // El usuario debe cambiarlo manualmente o finalizar la adición.
            // btnAddIntermediateStop.textContent = "Añadir Parada Intermedia (toca el mapa)";
        }
        checkAddIntermediateButtonState();
        recalculateAndRenderTimes(); // Esto también llama a renderCurrentRouteStopsUI y updateMapMarkers
    }
    
    function checkAddIntermediateButtonState() {
        btnAddIntermediateStop.disabled = !(currentRoute.startPoint && currentRoute.endPoint);
    }

    function resetRouteDefinitionForm() {
        currentRoute = { name: '', startPoint: null, endPoint: null, intermediateStops: [] };
        routeNameInput.value = '';
        startPointNameInput.value = '';
        startPointTimeInput.value = '';
        startPointCoordsSpan.textContent = 'Lat/Lng: (selecciona en mapa)';
        endPointNameInput.value = '';
        endPointTimeInput.value = '';
        endPointCoordsSpan.textContent = 'Lat/Lng: (selecciona en mapa)';
        definingMode = null;
        btnAddIntermediateStop.disabled = true;
        btnAddIntermediateStop.textContent = "Añadir Parada Intermedia (toca el mapa)";
        clearMapFeatures(false); // No limpiar marcadores de GPS si el seguimiento está activo
        renderCurrentRouteStopsUI();
    }

    function parseTimeToMinutes(timeStr) { // "HH:MM" a minutos desde medianoche
        if (!timeStr) return null;
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
    }

    function formatMinutesToTime(totalMinutes) { // minutos desde medianoche a "HH:MM"
        if (totalMinutes === null || isNaN(totalMinutes)) return "";
        const hours = Math.floor(totalMinutes / 60) % 24;
        const minutes = Math.round(totalMinutes % 60); // Redondear para evitar segundos flotantes
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    
    function haversineDistance(coords1, coords2) {
        function toRad(x) { return x * Math.PI / 180; }
        const R = 6371; // km
        const dLat = toRad(coords2.lat - coords1.lat);
        const dLon = toRad(coords2.lng - coords1.lng);
        const lat1 = toRad(coords1.lat);
        const lat2 = toRad(coords2.lat);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c * 1000; // metros
    }

    function recalculateAndRenderTimes() {
        if (!currentRoute.startPoint || !currentRoute.endPoint || !autoCalcTimesCheckbox.checked) {
            renderCurrentRouteStopsUI();
            updateMapMarkers();
            return;
        }

        const startTimeStr = currentRoute.startPoint.departureTime;
        const endTimeStr = currentRoute.endPoint.arrivalTime;

        if (!startTimeStr || !endTimeStr) {
            // Si no hay tiempos de inicio/fin, no podemos calcular intermedios
            currentRoute.intermediateStops.forEach(stop => {
                stop.arrivalTime = '';
                stop.departureTime = '';
            });
            renderCurrentRouteStopsUI();
            updateMapMarkers();
            return;
        }
        
        const startMinutes = parseTimeToMinutes(startTimeStr);
        const endMinutes = parseTimeToMinutes(endTimeStr);

        if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
            console.warn("Tiempos de inicio/fin inválidos para cálculo automático.");
            currentRoute.intermediateStops.forEach(stop => {
                stop.arrivalTime = '';
                stop.departureTime = '';
            });
            renderCurrentRouteStopsUI();
            updateMapMarkers();
            return;
        }

        const totalDurationMinutes = endMinutes - startMinutes;
        const fullRouteCoords = [currentRoute.startPoint, ...currentRoute.intermediateStops, currentRoute.endPoint];
        
        let totalDistance = 0;
        const segmentDistances = [];
        for (let i = 0; i < fullRouteCoords.length - 1; i++) {
            const dist = haversineDistance(fullRouteCoords[i], fullRouteCoords[i+1]);
            segmentDistances.push(dist);
            totalDistance += dist;
        }

        if (totalDistance === 0) { // Evitar división por cero
            currentRoute.intermediateStops.forEach(stop => {
                stop.arrivalTime = startTimeStr; // O alguna lógica por defecto
                stop.departureTime = startTimeStr;
            });
            renderCurrentRouteStopsUI();
            updateMapMarkers();
            return;
        }

        let accumulatedDistance = 0;
        for (let i = 0; i < currentRoute.intermediateStops.length; i++) {
            // La distancia a esta parada intermedia es desde el inicio, pasando por las anteriores
            accumulatedDistance += segmentDistances[i]; // Distancia del segmento anterior al actual punto intermedio
            
            const proportionOfDistance = accumulatedDistance / totalDistance;
            const timeOffsetMinutes = proportionOfDistance * totalDurationMinutes;
            const arrivalAtIntermediateStopMinutes = startMinutes + timeOffsetMinutes;
            
            currentRoute.intermediateStops[i].arrivalTime = formatMinutesToTime(arrivalAtIntermediateStopMinutes);
            currentRoute.intermediateStops[i].departureTime = formatMinutesToTime(arrivalAtIntermediateStopMinutes); // Salida = Llegada
        }
        renderCurrentRouteStopsUI();
        updateMapMarkers();
    }

    function renderCurrentRouteStopsUI() {
        currentRouteStopsList.innerHTML = '';
        const stopsToRender = [];

        if (currentRoute.startPoint) {
            stopsToRender.push({ ...currentRoute.startPoint, typeDisplay: 'Inicio', timeDisplay: currentRoute.startPoint.departureTime || 'N/A' });
        }

        currentRoute.intermediateStops.forEach((stop, index) => {
            stopsToRender.push({ ...stop, originalIndex: index, typeDisplay: `Parada ${index + 1}`, timeDisplay: stop.arrivalTime || 'N/A' });
        });

        if (currentRoute.endPoint) {
            stopsToRender.push({ ...currentRoute.endPoint, typeDisplay: 'Fin', timeDisplay: currentRoute.endPoint.arrivalTime || 'N/A' });
        }
        
        stopsToRender.forEach((stop, displayIndex) => {
            const li = document.createElement('li');
            let stopHtml = `<span><strong>${stop.name || stop.typeDisplay}</strong> (${stop.typeDisplay}): ${stop.timeDisplay}</span>`;
            
            if (stop.type === 'intermediate') {
                stopHtml += `<div class="stop-actions">
                                <button class="rename-stop" data-index="${stop.originalIndex}">Renombrar</button>
                                <button class="delete-stop" data-index="${stop.originalIndex}">Eliminar</button>
                                <button class="move-stop-up" data-index="${stop.originalIndex}" ${stop.originalIndex === 0 ? 'disabled' : ''}>Subir</button>
                                <button class="move-stop-down" data-index="${stop.originalIndex}" ${stop.originalIndex === currentRoute.intermediateStops.length - 1 ? 'disabled' : ''}>Bajar</button>
                             </div>`;
                if (!autoCalcTimesCheckbox.checked) {
                    const timeInputId = `intermediateTime_${stop.originalIndex}`;
                    stopHtml += ` <input type="time" id="${timeInputId}" value="${stop.arrivalTime || ''}" data-index="${stop.originalIndex}" class="manual-intermediate-time" title="Hora de paso manual">`;
                }
            }
            li.innerHTML = stopHtml;
            currentRouteStopsList.appendChild(li);
        });

        // Add event listeners for new buttons/inputs
        currentRouteStopsList.querySelectorAll('.rename-stop').forEach(btn => btn.addEventListener('click', handleRenameStop));
        currentRouteStopsList.querySelectorAll('.delete-stop').forEach(btn => btn.addEventListener('click', handleDeleteStop));
        currentRouteStopsList.querySelectorAll('.move-stop-up').forEach(btn => btn.addEventListener('click', handleMoveStopUp));
        currentRouteStopsList.querySelectorAll('.move-stop-down').forEach(btn => btn.addEventListener('click', handleMoveStopDown));
        currentRouteStopsList.querySelectorAll('.manual-intermediate-time').forEach(input => input.addEventListener('change', handleManualIntermediateTimeChange));
    }

    function handleRenameStop(event) {
        const index = parseInt(event.target.dataset.index);
        const stop = currentRoute.intermediateStops[index];
        const newName = prompt(`Renombrar parada "${stop.name}":`, stop.name);
        if (newName !== null && newName.trim() !== "") {
            currentRoute.intermediateStops[index].name = newName.trim();
            recalculateAndRenderTimes();
        }
    }

    function handleDeleteStop(event) {
        const index = parseInt(event.target.dataset.index);
        if (confirm(`¿Seguro que quieres eliminar la parada "${currentRoute.intermediateStops[index].name}"?`)) {
            currentRoute.intermediateStops.splice(index, 1);
            // Renumerar nombres por defecto si es necesario
            currentRoute.intermediateStops.forEach((s, i) => {
                if (s.name.startsWith("Parada ")) s.name = `Parada ${i + 1}`;
            });
            recalculateAndRenderTimes();
        }
    }

    function handleMoveStopUp(event) {
        const index = parseInt(event.target.dataset.index);
        if (index > 0) {
            const temp = currentRoute.intermediateStops[index];
            currentRoute.intermediateStops[index] = currentRoute.intermediateStops[index - 1];
            currentRoute.intermediateStops[index - 1] = temp;
            // Renumerar nombres por defecto si es necesario
            currentRoute.intermediateStops.forEach((s, i) => {
                if (s.name.startsWith("Parada ")) s.name = `Parada ${i + 1}`;
            });
            recalculateAndRenderTimes();
        }
    }

    function handleMoveStopDown(event) {
        const index = parseInt(event.target.dataset.index);
        if (index < currentRoute.intermediateStops.length - 1) {
            const temp = currentRoute.intermediateStops[index];
            currentRoute.intermediateStops[index] = currentRoute.intermediateStops[index + 1];
            currentRoute.intermediateStops[index + 1] = temp;
            // Renumerar nombres por defecto si es necesario
            currentRoute.intermediateStops.forEach((s, i) => {
                if (s.name.startsWith("Parada ")) s.name = `Parada ${i + 1}`;
            });
            recalculateAndRenderTimes();
        }
    }
    
    function handleManualIntermediateTimeChange(event) {
        if (autoCalcTimesCheckbox.checked) return; // No debería ocurrir si UI está bien
        const index = parseInt(event.target.dataset.index);
        const newTime = event.target.value;
        currentRoute.intermediateStops[index].arrivalTime = newTime;
        currentRoute.intermediateStops[index].departureTime = newTime; // Salida = Llegada
        renderCurrentRouteStopsUI(); // Solo re-renderizar, no recalcular todo
        updateMapMarkers();
    }

    function updateMapMarkers() {
        clearMapFeatures(false); // No limpiar marcadores de GPS

        const pointsForPolyline = [];

        if (currentRoute.startPoint && currentRoute.startPoint.lat) {
            startMarker = L.marker([currentRoute.startPoint.lat, currentRoute.startPoint.lng], {icon: startIcon, draggable: true})
                .addTo(map)
                .bindPopup(`<b>Inicio:</b> ${currentRoute.startPoint.name || 'Punto de Inicio'}<br>Sale: ${currentRoute.startPoint.departureTime || 'N/A'}`);
            pointsForPolyline.push(currentRoute.startPoint);
            
            startMarker.on('dragend', function(event){
                const marker = event.target;
                const position = marker.getLatLng();
                currentRoute.startPoint.lat = position.lat;
                currentRoute.startPoint.lng = position.lng;
                startPointCoordsSpan.textContent = `Lat/Lng: ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`;
                recalculateAndRenderTimes(); // Recalcula distancias y tiempos
            });
        }

        intermediateMarkers = [];
        currentRoute.intermediateStops.forEach((stop, index) => {
            if (stop.lat) {
                const marker = L.marker([stop.lat, stop.lng], {icon: intermediateIcon, draggable: true})
                    .addTo(map)
                    .bindPopup(`<b>${stop.name || 'Parada ' + (index + 1)}</b><br>Llega: ${stop.arrivalTime || 'N/A'}`);
                intermediateMarkers.push(marker);
                pointsForPolyline.push(stop);

                marker.on('dragend', function(event){
                    const m = event.target;
                    const pos = m.getLatLng();
                    currentRoute.intermediateStops[index].lat = pos.lat;
                    currentRoute.intermediateStops[index].lng = pos.lng;
                    recalculateAndRenderTimes();
                });
            }
        });

        if (currentRoute.endPoint && currentRoute.endPoint.lat) {
            endMarker = L.marker([currentRoute.endPoint.lat, currentRoute.endPoint.lng], {icon: endIcon, draggable: true})
                .addTo(map)
                .bindPopup(`<b>Fin:</b> ${currentRoute.endPoint.name || 'Punto Final'}<br>Llega: ${currentRoute.endPoint.arrivalTime || 'N/A'}`);
            pointsForPolyline.push(currentRoute.endPoint);

            endMarker.on('dragend', function(event){
                const marker = event.target;
                const position = marker.getLatLng();
                currentRoute.endPoint.lat = position.lat;
                currentRoute.endPoint.lng = position.lng;
                endPointCoordsSpan.textContent = `Lat/Lng: ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`;
                recalculateAndRenderTimes();
            });
        }
        
        if (pointsForPolyline.length >= 2) {
            const latLngs = pointsForPolyline.map(p => [p.lat, p.lng]);
            routePolyline = L.polyline(latLngs, {color: 'blue'}).addTo(map);
            // map.fitBounds(routePolyline.getBounds()); // Opcional: ajustar zoom a la ruta
        }
    }

    function clearMapFeatures(clearAll = true) { // clearAll = true también quita GPS y geofences
        if (startMarker) map.removeLayer(startMarker);
        if (endMarker) map.removeLayer(endMarker);
        intermediateMarkers.forEach(marker => map.removeLayer(marker));
        intermediateMarkers = [];
        if (routePolyline) map.removeLayer(routePolyline);
        startMarker = endMarker = routePolyline = null;

        if (clearAll) {
            if (currentLocationMarker) map.removeLayer(currentLocationMarker);
            if (startGeofenceCircle) map.removeLayer(startGeofenceCircle);
            if (endGeofenceCircle) map.removeLayer(endGeofenceCircle);
            currentLocationMarker = startGeofenceCircle = endGeofenceCircle = null;
        }
    }

    // --- GESTIÓN DE RUTAS (LocalStorage) ---
    function saveCurrentRoute() {
        if (!currentRoute.name.trim()) {
            alert("Por favor, ingresa un nombre para la ruta.");
            routeNameInput.focus();
            return;
        }
        if (!currentRoute.startPoint || !currentRoute.endPoint) {
            alert("Define al menos un punto de inicio y fin para la ruta.");
            return;
        }

        const existingRouteIndex = savedRoutes.findIndex(r => r.name === currentRoute.name);
        if (existingRouteIndex > -1) {
            if (!confirm(`La ruta "${currentRoute.name}" ya existe. ¿Deseas sobrescribirla?`)) {
                return;
            }
            savedRoutes[existingRouteIndex] = JSON.parse(JSON.stringify(currentRoute)); // Deep copy
        } else {
            savedRoutes.push(JSON.parse(JSON.stringify(currentRoute)));
        }
        
        localStorage.setItem(STORAGE_KEYS.ROUTES, JSON.stringify(savedRoutes));
        populateSavedRoutesDropdown();
        alert(`Ruta "${currentRoute.name}" guardada.`);
    }

    function loadRoutesFromStorage() {
        const routesStr = localStorage.getItem(STORAGE_KEYS.ROUTES);
        if (routesStr) {
            savedRoutes = JSON.parse(routesStr);
        } else {
            savedRoutes = [];
        }
    }

    function populateSavedRoutesDropdown() {
        savedRoutesSelect.innerHTML = '<option value="">-- Selecciona una ruta --</option>';
        savedRoutes.forEach(route => {
            const option = document.createElement('option');
            option.value = route.name;
            option.textContent = route.name;
            savedRoutesSelect.appendChild(option);
        });
    }

    function loadSelectedRoute() {
        const routeName = savedRoutesSelect.value;
        if (!routeName) {
            alert("Selecciona una ruta para cargar.");
            return;
        }
        const routeToLoad = savedRoutes.find(r => r.name === routeName);
        if (routeToLoad) {
            currentRoute = JSON.parse(JSON.stringify(routeToLoad)); // Deep copy
            
            // Poblar formulario
            routeNameInput.value = currentRoute.name;
            if (currentRoute.startPoint) {
                startPointNameInput.value = currentRoute.startPoint.name || '';
                startPointTimeInput.value = currentRoute.startPoint.departureTime || '';
                startPointCoordsSpan.textContent = `Lat/Lng: ${currentRoute.startPoint.lat.toFixed(5)}, ${currentRoute.startPoint.lng.toFixed(5)}`;
            }
            if (currentRoute.endPoint) {
                endPointNameInput.value = currentRoute.endPoint.name || '';
                endPointTimeInput.value = currentRoute.endPoint.arrivalTime || '';
                endPointCoordsSpan.textContent = `Lat/Lng: ${currentRoute.endPoint.lat.toFixed(5)}, ${currentRoute.endPoint.lng.toFixed(5)}`;
            }
            currentRoute.intermediateStops = currentRoute.intermediateStops || [];

            checkAddIntermediateButtonState();
            recalculateAndRenderTimes(); // Esto actualiza UI y mapa
            alert(`Ruta "${routeName}" cargada.`);
        } else {
            alert("Error al cargar la ruta seleccionada.");
        }
    }

    function deleteSelectedRoute() {
        const routeName = savedRoutesSelect.value;
        if (!routeName) {
            alert("Selecciona una ruta para eliminar.");
            return;
        }
        if (confirm(`¿Seguro que quieres eliminar la ruta "${routeName}"? Esta acción no se puede deshacer.`)) {
            savedRoutes = savedRoutes.filter(r => r.name !== routeName);
            localStorage.setItem(STORAGE_KEYS.ROUTES, JSON.stringify(savedRoutes));
            populateSavedRoutesDropdown();
            
            if (currentRoute.name === routeName) { // Si la ruta eliminada era la actual
                resetRouteDefinitionForm();
            }
            alert(`Ruta "${routeName}" eliminada.`);
        }
    }

    // --- GESTIÓN DE COLA DE SEGUIMIENTO ---
    function addCurrentRouteToQueue() {
        const selectedRouteName = savedRoutesSelect.value;
        if (!selectedRouteName) {
            alert("Primero carga una ruta guardada para añadirla a la cola.");
            return;
        }
        const routeExistsInSaved = savedRoutes.find(r => r.name === selectedRouteName);
        if (!routeExistsInSaved) {
            alert("La ruta seleccionada no se encuentra en las rutas guardadas.");
            return;
        }

        if (trackingQueue.includes(selectedRouteName)) {
            alert(`La ruta "${selectedRouteName}" ya está en la cola.`);
            return;
        }
        trackingQueue.push(selectedRouteName);
        saveTrackingQueueToStorage();
        renderTrackingQueueUI();
    }

    function renderTrackingQueueUI() {
        trackingQueueList.innerHTML = '';
        if (trackingQueue.length === 0) {
            trackingQueueList.innerHTML = '<li>Cola vacía</li>';
            return;
        }
        trackingQueue.forEach((routeName, index) => {
            const li = document.createElement('li');
            li.textContent = `${index + 1}. ${routeName}`;
            // Podríamos añadir un botón para eliminar de la cola aquí
            trackingQueueList.appendChild(li);
        });
    }
    
    function loadTrackingQueueFromStorage() {
        const queueStr = localStorage.getItem(STORAGE_KEYS.TRACKING_QUEUE);
        if (queueStr) {
            trackingQueue = JSON.parse(queueStr);
        } else {
            trackingQueue = [];
        }
    }

    function saveTrackingQueueToStorage() {
        localStorage.setItem(STORAGE_KEYS.TRACKING_QUEUE, JSON.stringify(trackingQueue));
    }

    function clearTrackingQueue() {
        if (isTracking) {
            alert("No se puede limpiar la cola mientras el seguimiento está activo.");
            return;
        }
        if (confirm("¿Seguro que quieres limpiar toda la cola de seguimiento?")) {
            trackingQueue = [];
            saveTrackingQueueToStorage();
            renderTrackingQueueUI();
        }
    }


    // --- LÓGICA DE SEGUIMIENTO EN TIEMPO REAL ---
    function startTracking() {
        if (isTracking) {
            alert("El seguimiento ya está activo.");
            return;
        }
        if (trackingQueue.length === 0) {
            alert("Añade rutas a la cola de seguimiento primero.");
            return;
        }

        isTracking = true;
        currentTrackingStopIndex = -1; // Antes del inicio de la primera ruta
        // currentTrackingRouteIndex se maneja implícitamente al cargar la primera ruta de la cola.
        
        loadNextRouteFromQueueForTracking(); // Carga la primera ruta

        if (!currentTrackingRouteData) { // Si no se pudo cargar la primera ruta
            isTracking = false;
            alert("No se pudo iniciar el seguimiento. Verifica la cola de rutas.");
            return;
        }
        
        btnStartTracking.disabled = true;
        btnStopTracking.disabled = false;
        trackingInfoDiv.style.display = 'block';
        setRouteEditingAvailability(false);

        // Iniciar GPS
        if (navigator.geolocation) {
            gpsWatchId = navigator.geolocation.watchPosition(
                handlePositionUpdate, 
                handlePositionError, 
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        } else {
            alert("Geolocalización no soportada por este navegador.");
            stopTracking();
            return;
        }

        // Iniciar intervalo para actualizar localStorage
        trackingStatusUpdateInterval = setInterval(updateLocalStorageTrackingStatus, 3000); // Cada 3 segundos
        // Iniciar intervalo para actualizar diferencia de tiempo
        timeDifferenceUpdateInterval = setInterval(displayTimeDifference, 1000);

        updateNextStopDisplay();
        updateLocalStorageTrackingStatus(); // Actualización inicial
        alert("Seguimiento iniciado.");
    }

    function stopTracking() {
        if (!isTracking) return;

        isTracking = false;
        if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
        if (trackingStatusUpdateInterval) clearInterval(trackingStatusUpdateInterval);
        if (timeDifferenceUpdateInterval) clearInterval(timeDifferenceUpdateInterval);
        
        gpsWatchId = null;
        trackingStatusUpdateInterval = null;
        timeDifferenceUpdateInterval = null;
        lastKnownPosition = null;
        currentTrackingRouteName = null;
        currentTrackingRouteData = null;
        currentTrackingStopIndex = -1;

        btnStartTracking.disabled = false;
        btnStopTracking.disabled = true;
        trackingInfoDiv.style.display = 'none';
        manualModeToggle.checked = false;
        handleManualModeToggle(); // Para ocultar controles manuales
        setRouteEditingAvailability(true);

        clearMapFeatures(true); // Limpiar todo, incluyendo GPS y geofences
        updateMapMarkers(); // Redibujar la ruta actual en modo edición si hay una cargada

        // Actualizar localStorage a estado "no rastreando"
        const status = {
            isTracking: false,
            lastUpdateTime: Date.now()
        };
        localStorage.setItem(STORAGE_KEYS.TRACKING_STATUS, JSON.stringify(status));
        alert("Seguimiento detenido.");
    }

    function setRouteEditingAvailability(enabled) {
        routeNameInput.disabled = !enabled;
        btnSetStartPoint.disabled = !enabled;
        startPointNameInput.disabled = !enabled;
        startPointTimeInput.disabled = !enabled;
        btnSetEndPoint.disabled = !enabled;
        endPointNameInput.disabled = !enabled;
        endPointTimeInput.disabled = !enabled;
        btnAddIntermediateStop.disabled = !enabled || !(currentRoute.startPoint && currentRoute.endPoint);
        autoCalcTimesCheckbox.disabled = !enabled;
        btnSaveRoute.disabled = !enabled;
        savedRoutesSelect.disabled = !enabled;
        btnLoadRoute.disabled = !enabled;
        btnDeleteRoute.disabled = !enabled;
        btnAddSelectedToQueue.disabled = !enabled;
        btnClearQueue.disabled = !enabled;

        // Habilitar/deshabilitar drag de marcadores de ruta de edición
        [startMarker, endMarker, ...intermediateMarkers].forEach(marker => {
            if (marker) {
                if (enabled) marker.dragging.enable();
                else marker.dragging.disable();
            }
        });
    }


    function loadNextRouteFromQueueForTracking() {
        if (trackingQueue.length === 0) {
            console.log("Cola de seguimiento vacía. Deteniendo seguimiento.");
            stopTracking();
            return false;
        }
        
        currentTrackingRouteName = trackingQueue.shift(); // Toma y remueve la primera ruta de la cola
        saveTrackingQueueToStorage(); // Actualiza la cola en localStorage
        renderTrackingQueueUI(); // Actualiza la UI de la cola

        const routeData = savedRoutes.find(r => r.name === currentTrackingRouteName);
        if (!routeData) {
            console.error(`Ruta "${currentTrackingRouteName}" no encontrada en rutas guardadas.`);
            // Intentar con la siguiente si hay, o detener.
            return loadNextRouteFromQueueForTracking(); // Recursivo, pero cuidado con bucles infinitos si todas fallan
        }

        currentTrackingRouteData = JSON.parse(JSON.stringify(routeData)); // Deep copy
        currentTrackingStopIndex = -1; // Reiniciar para la nueva ruta (antes del inicio)
        
        console.log("Cargando nueva ruta para seguimiento:", currentTrackingRouteName);
        activeRouteNameSpan.textContent = currentTrackingRouteName;
        
        drawTrackingRouteOnMap();
        updateNextStopDisplay();
        return true;
    }

    function drawTrackingRouteOnMap() {
        clearMapFeatures(true); // Limpiar todo primero

        if (!currentTrackingRouteData) return;

        const route = currentTrackingRouteData;
        const pointsForPolyline = [];

        // Marcador de Inicio
        if (route.startPoint && route.startPoint.lat) {
            L.marker([route.startPoint.lat, route.startPoint.lng], {icon: startIcon})
                .addTo(map).bindPopup(`<b>Inicio:</b> ${route.startPoint.name}`);
            pointsForPolyline.push(route.startPoint);
            startGeofenceCircle = L.circle([route.startPoint.lat, route.startPoint.lng], {
                color: 'green', fillColor: '#0f0', fillOpacity: 0.2, radius: GEOFENCE_RADIUS_METERS
            }).addTo(map);
        }

        // Marcadores Intermedios
        route.intermediateStops.forEach((stop, index) => {
            if (stop.lat) {
                L.marker([stop.lat, stop.lng], {icon: intermediateIcon})
                    .addTo(map).bindPopup(`<b>${stop.name}</b>`);
                pointsForPolyline.push(stop);
            }
        });
        
        // Marcador de Fin
        if (route.endPoint && route.endPoint.lat) {
            L.marker([route.endPoint.lat, route.endPoint.lng], {icon: endIcon})
                .addTo(map).bindPopup(`<b>Fin:</b> ${route.endPoint.name}`);
            pointsForPolyline.push(route.endPoint);
            endGeofenceCircle = L.circle([route.endPoint.lat, route.endPoint.lng], {
                color: 'red', fillColor: '#f00', fillOpacity: 0.2, radius: GEOFENCE_RADIUS_METERS
            }).addTo(map);
        }

        // Polilínea de la ruta
        if (pointsForPolyline.length >= 2) {
            const latLngs = pointsForPolyline.map(p => [p.lat, p.lng]);
            L.polyline(latLngs, {color: 'green', weight: 5}).addTo(map);
            // map.fitBounds(L.polyline(latLngs).getBounds()); // Opcional
        }
    }

    function handlePositionUpdate(position) {
        lastKnownPosition = { lat: position.coords.latitude, lng: position.coords.longitude };
        console.log("Posición actualizada:", lastKnownPosition);

        if (!currentLocationMarker) {
            currentLocationMarker = L.marker([lastKnownPosition.lat, lastKnownPosition.lng], { icon: busIcon, zIndexOffset: 1000 }).addTo(map);
        } else {
            currentLocationMarker.setLatLng([lastKnownPosition.lat, lastKnownPosition.lng]);
        }
        map.panTo([lastKnownPosition.lat, lastKnownPosition.lng]); // Opcional: centrar mapa en el bus

        if (!manualModeToggle.checked && currentTrackingRouteData) {
            checkAutomaticTransitions();
        }
        // El cálculo de diferencia de tiempo y actualización de localStorage se hacen en sus propios intervalos.
    }

    function handlePositionError(error) {
        console.error("Error de Geolocalización:", error.message);
        let errorReason = `Error GPS: ${error.message} (código: ${error.code})`;
        
        updateLocalStorageTrackingStatus(true, errorReason); // Marcar error
        // Podrías mostrar un mensaje al usuario
        if (error.code === error.PERMISSION_DENIED) {
            alert("Permiso de geolocalización denegado. El seguimiento no puede continuar.");
            stopTracking();
        } else if (error.code === error.POSITION_UNAVAILABLE) {
            alert("Información de ubicación no disponible. Intenta moverte a un lugar con mejor señal.");
        } else if (error.code === error.TIMEOUT) {
            alert("Se agotó el tiempo para obtener la ubicación.");
        }
    }
    
    function getActiveRouteStopsFlat() {
        if (!currentTrackingRouteData) return [];
        const stops = [];
        if (currentTrackingRouteData.startPoint) {
            stops.push({
                name: currentTrackingRouteData.startPoint.name || 'Inicio',
                type: 'start',
                arrivalTime: null, // No tiene llegada, es salida
                departureTime: currentTrackingRouteData.startPoint.departureTime
            });
        }
        currentTrackingRouteData.intermediateStops.forEach((s, i) => {
            stops.push({
                name: s.name || `Parada ${i+1}`,
                type: 'intermediate',
                arrivalTime: s.arrivalTime,
                departureTime: s.departureTime
            });
        });
        if (currentTrackingRouteData.endPoint) {
            stops.push({
                name: currentTrackingRouteData.endPoint.name || 'Fin',
                type: 'end',
                arrivalTime: currentTrackingRouteData.endPoint.arrivalTime,
                departureTime: null // No tiene salida, es llegada
            });
        }
        return stops;
    }


    function updateLocalStorageTrackingStatus(hasError = false, errorReason = "") {
        if (!isTracking && !hasError) { // Si se detuvo el tracking sin error, mandar estado simple
             localStorage.setItem(STORAGE_KEYS.TRACKING_STATUS, JSON.stringify({ isTracking: false, lastUpdateTime: Date.now() }));
             return;
        }
        if (!currentTrackingRouteData && isTracking) { // Aún no se ha cargado una ruta pero el tracking está intentando iniciar
            const status = {
                isTracking: true,
                hasError: true,
                errorReason: "Cargando ruta inicial...",
                routeName: null,
                currentRouteIndexInQueue: trackingQueue.length > 0 ? (savedRoutes.findIndex(r => r.name === trackingQueue[0]) - trackingQueue.length) : -1, // Estimación
                trackingQueueNames: [...trackingQueue], // Copia de la cola restante
                currentStopIndexFromWhichDeparted: -1,
                nextStopIndexTowardsWhichHeading: 0,
                currentBusDelayOrAheadMillis: 0,
                lastKnownPosition: lastKnownPosition,
                lastUpdateTime: Date.now(),
                routeStops: []
            };
            localStorage.setItem(STORAGE_KEYS.TRACKING_STATUS, JSON.stringify(status));
            return;
        }

        if (!currentTrackingRouteData && !isTracking && hasError) { // Error antes de que currentTrackingRouteData se establezca
             const status = {
                isTracking: false, // O true si el error ocurrió durante un intento de rastreo
                hasError: true,
                errorReason: errorReason || "Error desconocido durante la inicialización del seguimiento.",
                lastUpdateTime: Date.now()
            };
            localStorage.setItem(STORAGE_KEYS.TRACKING_STATUS, JSON.stringify(status));
            return;
        }
        
        // Si no hay currentTrackingRouteData pero isTracking es true, algo está mal (ej. ruta no encontrada)
        // O si hasError es true pero currentTrackingRouteData está disponible, usarlo.
        let routeStopsForStatus = [];
        let routeNameForStatus = "";
        if (currentTrackingRouteData) {
            routeStopsForStatus = getActiveRouteStopsFlat();
            routeNameForStatus = currentTrackingRouteData.name;
        } else if (hasError && !currentTrackingRouteData) {
            // Si hay error y no hay datos de ruta, enviar lo que se pueda
            routeNameForStatus = "Ruta Desconocida (error)";
        }


        const delayOrAheadMillis = calculateCurrentDelayOrAheadMillis();

        const status = {
            isTracking: isTracking,
            hasError: hasError,
            errorReason: errorReason,
            routeName: routeNameForStatus,
            // currentRouteIndexInQueue: No es fácil de calcular aquí de forma precisa si se modifica la cola
            // Mejor sería que CuandoLlega reconstruya esto basado en trackingQueueNames y routeName
            trackingQueueNames: [currentTrackingRouteName, ...trackingQueue].filter(Boolean), // Ruta actual + las que quedan
            currentStopIndexFromWhichDeparted: currentTrackingStopIndex, // Índice de la parada de la que salió o -1 si en inicio
            nextStopIndexTowardsWhichHeading: currentTrackingStopIndex + 1, // Índice de la parada a la que va
            currentBusDelayOrAheadMillis: delayOrAheadMillis,
            lastKnownPosition: lastKnownPosition,
            lastUpdateTime: Date.now(),
            routeStops: routeStopsForStatus 
        };
        localStorage.setItem(STORAGE_KEYS.TRACKING_STATUS, JSON.stringify(status));
    }

    function calculateCurrentDelayOrAheadMillis() {
        if (!isTracking || !currentTrackingRouteData || (!lastKnownPosition && currentTrackingStopIndex > -1)) return 0;

        const now = new Date();
        const currentTimeMillis = now.getHours() * 3600000 + now.getMinutes() * 60000 + now.getSeconds() * 1000;
        
        const routeStops = getActiveRouteStopsFlat(); // Incluye inicio, intermedios, fin
        
        if (currentTrackingStopIndex === -1) { // Antes de salir del punto de inicio
            const scheduledDepartureTimeStr = currentTrackingRouteData.startPoint.departureTime;
            if (!scheduledDepartureTimeStr) return 0;
            const scheduledDepartureMillis = timeStringToMillisOfDay(scheduledDepartureTimeStr);
            return scheduledDepartureMillis - currentTimeMillis; // Positivo si está adelantado (llegó antes de la hora de salida), negativo si atrasado
        }

        if (currentTrackingStopIndex >= routeStops.length -1) { // Ya llegó al final o más allá
            return 0; 
        }

        // En ruta entre currentStopIndex y currentStopIndex + 1
        const departureStop = routeStops[currentTrackingStopIndex];
        const arrivalStop = routeStops[currentTrackingStopIndex + 1];

        const scheduledDepartureTimeFromCurrentStopStr = departureStop.departureTime; // Usar departureTime de la parada actual
        const scheduledArrivalTimeAtNextStopStr = arrivalStop.arrivalTime;

        if (!scheduledDepartureTimeFromCurrentStopStr || !scheduledArrivalTimeAtNextStopStr) return 0; // Tiempos no definidos

        const scheduledDepartureMillis = timeStringToMillisOfDay(scheduledDepartureTimeFromCurrentStopStr);
        const scheduledArrivalMillis = timeStringToMillisOfDay(scheduledArrivalTimeAtNextStopStr);
        
        const scheduledLegDurationMillis = scheduledArrivalMillis - scheduledDepartureMillis;
        if (scheduledLegDurationMillis <= 0) return 0; // Duración de tramo inválida

        // Distancias
        const departureStopCoords = currentTrackingStopIndex === 0 ? currentTrackingRouteData.startPoint : currentTrackingRouteData.intermediateStops[currentTrackingStopIndex -1]; // Ajuste de índice para intermediateStops
        const arrivalStopCoords = (currentTrackingStopIndex + 1) >= routeStops.length -1 ? currentTrackingRouteData.endPoint : currentTrackingRouteData.intermediateStops[currentTrackingStopIndex]; // Ajuste

        if (!departureStopCoords || !arrivalStopCoords || !departureStopCoords.lat || !arrivalStopCoords.lat || !lastKnownPosition) return 0;

        const totalLegDistance = haversineDistance(departureStopCoords, arrivalStopCoords);
        if (totalLegDistance === 0) return 0; // Evitar división por cero

        const distanceFromDepartureToCurrentPos = haversineDistance(departureStopCoords, lastKnownPosition);
        
        // Proporción de distancia recorrida en el tramo actual
        let fractionLegCovered = Math.min(1, Math.max(0, distanceFromDepartureToCurrentPos / totalLegDistance));
        
        // Tiempo que debería haber transcurrido en este tramo según lo programado para la distancia cubierta
        const expectedTimeElapsedOnLegMillis = fractionLegCovered * scheduledLegDurationMillis;
        
        // Hora programada a la que debería estar en la posición actual
        const scheduledTimeAtCurrentPositionMillis = scheduledDepartureMillis + expectedTimeElapsedOnLegMillis;
        
        // Diferencia: >0 si está adelantado, <0 si está atrasado
        const diffMillis = scheduledTimeAtCurrentPositionMillis - currentTimeMillis;
        
        return Math.round(diffMillis);
    }
    
    function timeStringToMillisOfDay(timeStr) { // "HH:MM"
        if (!timeStr) return 0;
        const [hours, minutes] = timeStr.split(':').map(Number);
        return (hours * 3600000) + (minutes * 60000);
    }

    function displayTimeDifference() {
        if (!isTracking) {
            timeDifferenceSpan.textContent = "---";
            return;
        }
        const diffMillis = calculateCurrentDelayOrAheadMillis();
        const sign = diffMillis >= 0 ? "+" : "-";
        const absDiffMillis = Math.abs(diffMillis);
        const minutes = Math.floor(absDiffMillis / 60000);
        const seconds = Math.floor((absDiffMillis % 60000) / 1000);
        timeDifferenceSpan.textContent = `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function updateNextStopDisplay() {
        if (!isTracking || !currentTrackingRouteData) {
            nextStopInfoSpan.textContent = "---";
            return;
        }
        
        const route = currentTrackingRouteData;
        let info = "";

        if (currentTrackingStopIndex === -1) { // Antes de salir del inicio
            info = `Salida de ${route.startPoint.name || 'Inicio'} a las ${route.startPoint.departureTime || 'N/A'}`;
        } else {
            const flatStops = getActiveRouteStopsFlat();
            const nextStopTargetIndex = currentTrackingStopIndex + 1;

            if (nextStopTargetIndex < flatStops.length) {
                const nextStopData = flatStops[nextStopTargetIndex];
                info = `Hacia ${nextStopData.name} (prog: ${nextStopData.arrivalTime || nextStopData.departureTime || 'N/A'})`;
            } else {
                info = "Ruta completada. Esperando siguiente ruta o fin.";
            }
        }
        nextStopInfoSpan.textContent = info;
    }


    function checkAutomaticTransitions() {
        if (!isTracking || !currentTrackingRouteData || !lastKnownPosition || manualModeToggle.checked) return;

        const route = currentTrackingRouteData;
        const flatStops = getActiveRouteStopsFlat();

        // 1. Salida del Geofence de Inicio
        if (currentTrackingStopIndex === -1 && route.startPoint && route.startPoint.lat) {
            const distToStart = haversineDistance(lastKnownPosition, route.startPoint);
            if (distToStart > GEOFENCE_RADIUS_METERS) {
                console.log("Salió del geofence de inicio. Avanzando a tramo 0.");
                currentTrackingStopIndex = 0; // Hacia la primera parada (o fin)
                updateNextStopDisplay();
                updateLocalStorageTrackingStatus();
                return; // Evitar múltiples transiciones en un ciclo
            }
        }

        // 2. Llegada a Parada Intermedia o Fin por Proximidad/Geofence
        if (currentTrackingStopIndex >= 0) {
            const nextStopTargetIndex = currentTrackingStopIndex + 1; // Este es el índice en flatStops
            if (nextStopTargetIndex >= flatStops.length) return; // Ya está en el último tramo o más allá

            let targetStopCoords;
            let isFinalStop = false;

            if (nextStopTargetIndex === flatStops.length - 1) { // Es la parada final de la ruta
                targetStopCoords = route.endPoint;
                isFinalStop = true;
            } else { // Es una parada intermedia
                // El índice en route.intermediateStops es `nextStopTargetIndex - 1` porque flatStops[0] es el inicio
                targetStopCoords = route.intermediateStops[nextStopTargetIndex - 1];
            }
            
            if (targetStopCoords && targetStopCoords.lat) {
                const distToTargetStop = haversineDistance(lastKnownPosition, targetStopCoords);
                const threshold = isFinalStop ? GEOFENCE_RADIUS_METERS : PROXIMITY_THRESHOLD_METERS;

                if (distToTargetStop <= threshold) {
                    if (isFinalStop) {
                        console.log("Entró en geofence de fin. Transicionando a siguiente ruta o deteniendo.");
                        // No incrementar currentTrackingStopIndex aquí, loadNextRoute lo reiniciará
                        if (!loadNextRouteFromQueueForTracking()) {
                            // Si no hay más rutas, stopTracking() ya fue llamado dentro de loadNext...
                            // pero podemos asegurarlo o hacer limpieza adicional
                            // stopTracking(); // Ya se llama si la cola está vacía
                        }
                    } else {
                        console.log(`Llegó a proximidad de parada intermedia ${flatStops[nextStopTargetIndex].name}. Avanzando.`);
                        currentTrackingStopIndex++;
                    }
                    updateNextStopDisplay();
                    updateLocalStorageTrackingStatus();
                    return;
                }
            }
        }
    }

    function handleManualModeToggle() {
        const isManual = manualModeToggle.checked;
        manualControlsDiv.style.display = isManual ? 'block' : 'none';
        if (isTracking && !isManual) {
            // Volviendo a modo automático, re-sincronizar
            findAndSetCurrentLeg();
        }
    }

    function manualPreviousStop() {
        if (!isTracking || !manualModeToggle.checked) return;
        if (currentTrackingStopIndex > -1) {
            currentTrackingStopIndex--;
            console.log("Manual: Parada Anterior. Nuevo índice de salida:", currentTrackingStopIndex);
            updateNextStopDisplay();
            updateLocalStorageTrackingStatus();
        } else {
            alert("Ya estás antes del punto de inicio.");
        }
    }

    function manualNextStop() {
        if (!isTracking || !manualModeToggle.checked || !currentTrackingRouteData) return;
        
        const flatStops = getActiveRouteStopsFlat();
        // Si está en la última parada (índice de salida es el penúltimo de flatStops) y presiona "Siguiente"
        if (currentTrackingStopIndex === flatStops.length - 2) { 
            console.log("Manual: Siguiente desde última parada. Intentando cambiar a siguiente ruta.");
            if (!loadNextRouteFromQueueForTracking()) {
                // stopTracking(); // Ya se llama si la cola está vacía
            }
        } else if (currentTrackingStopIndex < flatStops.length - 2) {
            currentTrackingStopIndex++;
            console.log("Manual: Parada Siguiente. Nuevo índice de salida:", currentTrackingStopIndex);
        } else {
            // Ya está más allá de la penúltima parada o no hay más paradas.
            // Si solo hay inicio y fin (flatStops.length = 2), currentTrackingStopIndex = 0 es "salió de inicio".
            // Si está en -1 (antes de inicio)
            if (currentTrackingStopIndex === -1 && flatStops.length > 0) {
                 currentTrackingStopIndex = 0; // Marcar como salido del inicio
                 console.log("Manual: Siguiente desde antes de inicio. Nuevo índice de salida:", currentTrackingStopIndex);
            } else {
                alert("No hay más paradas siguientes en esta ruta o ya estás al final.");
            }
        }
        updateNextStopDisplay();
        updateLocalStorageTrackingStatus();
    }

    function findAndSetCurrentLeg() {
        if (!isTracking || !currentTrackingRouteData || !lastKnownPosition) return;

        console.log("Intentando re-sincronizar tramo actual...");
        const route = currentTrackingRouteData;
        const flatStopsForResync = getActiveRouteStopsFlat(); // obtiene [inicio, interm1, interm2, ..., fin]
        
        if (flatStopsForResync.length < 2) {
            console.log("Ruta no tiene suficientes paradas para determinar tramo.");
            currentTrackingStopIndex = -1; // Default a antes del inicio
            updateNextStopDisplay();
            updateLocalStorageTrackingStatus();
            return;
        }

        let closestLegStartIndex = -1;
        let minDistanceToLegStart = Infinity;

        // Evaluar distancia al inicio de cada tramo
        // Un tramo es (stop_i, stop_i+1). El índice de salida es i.
        for (let i = 0; i < flatStopsForResync.length -1; i++) { // Iterar sobre posibles paradas de salida
            let stopCoords;
            if (i === 0) stopCoords = route.startPoint; // Salida del punto de inicio
            else stopCoords = route.intermediateStops[i-1]; // Salida de una parada intermedia (índice i-1 en array original)

            if (stopCoords && stopCoords.lat) {
                const dist = haversineDistance(lastKnownPosition, stopCoords);
                // Simple: tomar la parada de inicio de tramo más cercana hacia adelante
                // Podría mejorarse proyectando el punto a los segmentos de ruta.
                // Por ahora, si estamos "pasados" de una parada, no la consideramos como la *próxima* de salida.
                // Esta lógica es simplificada: se asume que el conductor sigue la ruta.
                
                // Si la parada actual (i) es la más cercana Y está "delante" o muy cerca
                // Para ser más robusto, necesitaríamos una proyección al segmento de ruta.
                // Aquí, una heurística: encontrar la parada de inicio de tramo más cercana.
                if (dist < minDistanceToLegStart) {
                    minDistanceToLegStart = dist;
                    closestLegStartIndex = i; 
                }
            }
        }

        // Considerar también la distancia al punto de inicio (para el estado -1)
        if (route.startPoint && route.startPoint.lat) {
            const distToRouteStart = haversineDistance(lastKnownPosition, route.startPoint);
            if (distToRouteStart < minDistanceToLegStart && distToRouteStart <= GEOFENCE_RADIUS_METERS * 1.5) { // Si está muy cerca del inicio
                closestLegStartIndex = -1; // Considerar que está en el inicio o antes
            }
        }
        
        // Si después de todas las paradas, sigue más cerca del final que de cualquier otra cosa
        if (route.endPoint && route.endPoint.lat && flatStopsForResync.length > 1) {
            const distToEnd = haversineDistance(lastKnownPosition, route.endPoint);
            const lastLegStartIndex = flatStopsForResync.length - 2; // Índice de salida de la penúltima parada
            let lastLegStartCoords;
            if (lastLegStartIndex === 0) lastLegStartCoords = route.startPoint;
            else lastLegStartCoords = route.intermediateStops[lastLegStartIndex-1];

            if (lastLegStartCoords && distToEnd < haversineDistance(lastKnownPosition, lastLegStartCoords) && distToEnd < GEOFENCE_RADIUS_METERS * 1.5) {
                 closestLegStartIndex = lastLegStartIndex; // Asumir que está en el último tramo
            }
        }


        currentTrackingStopIndex = closestLegStartIndex;
        console.log("Re-sincronización: índice de parada de salida ajustado a:", currentTrackingStopIndex);
        updateNextStopDisplay();
        updateLocalStorageTrackingStatus();
    }

    // --- INICIO DE LA APP ---
    init();
});
