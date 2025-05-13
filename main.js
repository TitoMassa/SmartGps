document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadSavedRoutes();
    renderRouteQueueList();
    updateRouteSelectorForQueue();
    
    // Default to first tab
    showTab('createRouteTab');
});

let map;
let currentRoute = []; // { lat, lng, name, type: 'start'|'intermediate'|'end', time: 'HH:MM', scheduledTimeDate: Date }
let routeCreationState = 'idle'; // 'addingStart', 'addingEnd', 'addingIntermediate'
let tempMarker; // Para mostrar dónde se va a agregar la parada
let routePolyline;
let stopMarkers = [];

let savedRoutes = []; // Array de objetos de ruta
let currentTrackingWatchId = null;
let driverMarker = null;
let trackingInterval = null;
let nextStopIndex = -1;
let isManualAdvanceMode = false;

let routeQueue = []; // Array de nombres de rutas guardadas
let currentRouteInQueueIndex = -1; // Índice de la ruta activa en la cola

const INSTRUCTION_TEXTS = {
    idle: "Toca el mapa para agregar el INICIO de la ruta.",
    addingStart: "Toca el mapa para definir la ubicación de INICIO.",
    addingEnd: "Toca el mapa para definir la ubicación FINAL.",
    addingIntermediate: "Toca el mapa para agregar una PARADA INTERMEDIA. Presiona 'Finalizar Creación' cuando termines.",
};

// --- Map Initialization ---
function initMap() {
    map = L.map('map').setView([-34.6037, -58.3816], 12); // Centro en Buenos Aires
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    map.on('click', onMapClick);
    updateInstructionText('idle');
}

function updateInstructionText(stateKey) {
    document.getElementById('instructionText').textContent = INSTRUCTION_TEXTS[stateKey] || INSTRUCTION_TEXTS.idle;
}

// --- Tab Management ---
function showTab(tabId) {
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => content.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');

    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => button.classList.remove('active'));
    const activeButton = document.querySelector(`.tab-button[onclick="showTab('${tabId}')"]`);
    if (activeButton) activeButton.classList.add('active');
}


// --- Route Creation ---
function onMapClick(e) {
    const { lat, lng } = e.latlng;
    const stopNameInput = document.getElementById('stopName');
    const stopTimeInput = document.getElementById('stopTime');
    const addStopButton = document.getElementById('addStopButton');
    const completeStopDefButton = document.getElementById('completeStopDefinitionButton');

    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = L.marker([lat, lng]).addTo(map).bindPopup("Nueva parada aquí").openPopup();
    
    document.getElementById('addStopButton')._latlng = e.latlng; // Store latlng on the button

    if (routeCreationState === 'idle' || routeCreationState === 'addingStart') {
        stopNameInput.value = 'Inicio';
        stopTimeInput.required = true;
        addStopButton.disabled = false;
        completeStopDefButton.style.display = 'none';
        updateInstructionText('addingStart');
    } else if (routeCreationState === 'addingEnd') {
        stopNameInput.value = 'Final';
        stopTimeInput.required = true;
        addStopButton.disabled = false;
        completeStopDefButton.style.display = 'none';
        updateInstructionText('addingEnd');
    } else if (routeCreationState === 'addingIntermediate') {
        stopNameInput.value = `Parada ${currentRoute.filter(s => s.type === 'intermediate').length + 1}`;
        stopTimeInput.required = false; // Intermediates can be w/o time if auto-calc
        addStopButton.disabled = false;
        completeStopDefButton.style.display = 'none'; // Keep hidden until a stop is added
        updateInstructionText('addingIntermediate');
    }
}

function confirmAddStop() {
    const latlng = document.getElementById('addStopButton')._latlng;
    if (!latlng) {
        alert("Por favor, selecciona una ubicación en el mapa primero.");
        return;
    }

    const name = document.getElementById('stopName').value.trim();
    const time = document.getElementById('stopTime').value;

    if (!name) {
        alert("Por favor, ingresa un nombre para la parada.");
        return;
    }

    let type;
    if (routeCreationState === 'idle' || routeCreationState === 'addingStart') {
        if (!time) { alert("El horario de inicio es obligatorio."); return; }
        type = 'start';
    } else if (routeCreationState === 'addingEnd') {
        if (!time) { alert("El horario final es obligatorio."); return; }
        type = 'end';
    } else if (routeCreationState === 'addingIntermediate') {
        type = 'intermediate';
    } else {
        return; // Should not happen
    }
    
    addStopToRoute(latlng.lat, latlng.lng, name, type, time);

    document.getElementById('stopName').value = '';
    document.getElementById('stopTime').value = '';
    document.getElementById('addStopButton').disabled = true;
    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = null;

    // Update route creation flow
    const completeStopDefButton = document.getElementById('completeStopDefinitionButton');
    const finishRouteBtn = document.getElementById('finishRouteButton');

    if (type === 'start') {
        routeCreationState = 'addingEnd';
        completeStopDefButton.style.display = 'block';
        completeStopDefButton.textContent = "Confirmar Inicio y Agregar Final";
        updateInstructionText('addingEnd');
    } else if (type === 'end') {
        routeCreationState = 'addingIntermediate';
        completeStopDefButton.style.display = 'block';
        completeStopDefButton.textContent = "Confirmar Final y Agregar Intermedias";
        updateInstructionText('addingIntermediate');
        finishRouteBtn.style.display = 'inline-block';
    } else if (type === 'intermediate') {
        // Allow adding more intermediates or finishing
        completeStopDefButton.style.display = 'block';
        completeStopDefButton.textContent = "Agregar otra Intermedia";
        updateInstructionText('addingIntermediate');
        finishRouteBtn.style.display = 'inline-block';
    }
}

function completeStopDefinition() {
    // This function primarily just advances the UI state message
    const addStopButton = document.getElementById('addStopButton');
    addStopButton.disabled = true; // Require new map click

    if (routeCreationState === 'addingEnd') { // Was adding start, now ready for end
        updateInstructionText('addingEnd');
         document.getElementById('instructionText').textContent = "Toca el mapa para definir la ubicación FINAL.";
    } else if (routeCreationState === 'addingIntermediate') { // Was adding end, now ready for intermediates
        updateInstructionText('addingIntermediate');
        document.getElementById('instructionText').textContent = "Toca el mapa para agregar PARADAS INTERMEDIAS. O presiona 'Finalizar Creación'.";
        document.getElementById('finishRouteButton').style.display = 'inline-block';
    }
    // If state is already addingIntermediate, this button might be "Add another intermediate"
    // In that case, just ensure instruction is set and button is ready for next map click
    if (document.getElementById('completeStopDefinitionButton').textContent.includes("Intermedia")) {
        updateInstructionText('addingIntermediate');
    }
}


function addStopToRoute(lat, lng, name, type, time) {
    const scheduledTimeDate = time ? parseTimeToDate(time) : null;
    currentRoute.push({ lat, lng, name, type, time, scheduledTimeDate });
    renderCurrentRouteStops();
    renderRouteOnMap();
}

function parseTimeToDate(timeStr) {
    if (!timeStr) return null;
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
}

function finishCreatingRoute() {
    if (currentRoute.length < 2) {
        alert("Una ruta debe tener al menos un inicio y un final.");
        return;
    }
    const startStop = currentRoute.find(s => s.type === 'start');
    const endStop = currentRoute.find(s => s.type === 'end');

    if (!startStop || !endStop) {
        alert("La ruta debe tener una parada de INICIO y una parada FINAL definidas.");
        return;
    }

    if (document.getElementById('autoCalcTimes').checked) {
        calculateAutomaticTimes();
    }
    
    // Re-sort: start, intermediates by original add order, end
    const intermediates = currentRoute.filter(s => s.type === 'intermediate');
    currentRoute = [startStop, ...intermediates, endStop];

    renderCurrentRouteStops(); // Update list with potentially new times
    renderRouteOnMap(); // Update map markers if times changed numbering
    alert("Creación de ruta finalizada. Puedes guardarla en la pestaña 'Rutas Guardadas'.");
    routeCreationState = 'idle';
    updateInstructionText('idle');
    document.getElementById('finishRouteButton').style.display = 'none';
    document.getElementById('completeStopDefinitionButton').style.display = 'none';
    document.getElementById('addStopButton').disabled = true;

    // Suggest going to save tab
    showTab('savedRoutesTab');
    document.getElementById('routeName').value = `Ruta ${new Date().toLocaleTimeString()}`;
}


function calculateAutomaticTimes() {
    const startStop = currentRoute.find(s => s.type === 'start');
    const endStop = currentRoute.find(s => s.type === 'end');
    const intermediateStops = currentRoute.filter(s => s.type === 'intermediate');

    if (!startStop || !endStop || !startStop.time || !endStop.time || intermediateStops.length === 0) {
        return; // Not enough info or no intermediates
    }

    const startTime = startStop.scheduledTimeDate.getTime();
    const endTime = endStop.scheduledTimeDate.getTime();
    const totalDurationMillis = endTime - startTime;

    if (totalDurationMillis <= 0) {
        alert("La hora de finalización debe ser posterior a la hora de inicio.");
        return;
    }

    // Calculate total distance
    let totalDistance = 0;
    const tempRoutePoints = [startStop, ...intermediateStops, endStop].map(s => L.latLng(s.lat, s.lng));
    for (let i = 0; i < tempRoutePoints.length - 1; i++) {
        totalDistance += tempRoutePoints[i].distanceTo(tempRoutePoints[i+1]);
    }
    if (totalDistance === 0) return; // Avoid division by zero

    let cumulativeDistance = 0;
    let lastPoint = L.latLng(startStop.lat, startStop.lng);

    intermediateStops.forEach(stop => {
        const currentPoint = L.latLng(stop.lat, stop.lng);
        cumulativeDistance += lastPoint.distanceTo(currentPoint);
        const timeOffset = (cumulativeDistance / totalDistance) * totalDurationMillis;
        const scheduledTime = new Date(startTime + timeOffset);
        stop.scheduledTimeDate = scheduledTime;
        stop.time = `${String(scheduledTime.getHours()).padStart(2, '0')}:${String(scheduledTime.getMinutes()).padStart(2, '0')}`;
        lastPoint = currentPoint;
    });
}

function clearCurrentRoute() {
    currentRoute = [];
    routeCreationState = 'idle';
    updateInstructionText('idle');
    renderCurrentRouteStops();
    clearMapLayers();
    document.getElementById('stopName').value = '';
    document.getElementById('stopTime').value = '';
    document.getElementById('addStopButton').disabled = true;
    document.getElementById('completeStopDefinitionButton').style.display = 'none';
    document.getElementById('finishRouteButton').style.display = 'none';
    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = null;
}

function clearMapLayers() {
    stopMarkers.forEach(marker => map.removeLayer(marker));
    stopMarkers = [];
    if (routePolyline) map.removeLayer(routePolyline);
    routePolyline = null;
    if (driverMarker) map.removeLayer(driverMarker);
    driverMarker = null;
}

// --- Rendering ---
function renderCurrentRouteStops() {
    const ul = document.getElementById('currentRouteStops');
    ul.innerHTML = '';
    // Ensure defined order for display: Start, Intermediates, End
    const sortedRoute = [];
    const start = currentRoute.find(s => s.type === 'start');
    const end = currentRoute.find(s => s.type === 'end');
    const intermediates = currentRoute.filter(s => s.type === 'intermediate');
    if (start) sortedRoute.push(start);
    sortedRoute.push(...intermediates);
    if (end) sortedRoute.push(end);

    sortedRoute.forEach((stop, index) => {
        const li = document.createElement('li');
        let typeText = '';
        switch(stop.type) {
            case 'start': typeText = 'INICIO'; break;
            case 'end': typeText = 'FINAL'; break;
            case 'intermediate': typeText = `Intermedia ${intermediates.indexOf(stop) + 1}`; break;
        }
        li.textContent = `${stop.name} (${typeText}) - ${stop.time || 'Sin hora'}`;
        ul.appendChild(li);
    });
}

function renderRouteOnMap() {
    clearMapLayers(); // Clear existing markers and polyline first

    if (currentRoute.length === 0) return;

    const latLngs = [];
    let intermediateCounter = 1;

    // Ensure proper sorting for icons and polyline
    const displayRoute = [];
    const startStop = currentRoute.find(s => s.type === 'start');
    const endStop = currentRoute.find(s => s.type === 'end');
    const intermediateStops = currentRoute.filter(s => s.type === 'intermediate');

    if (startStop) displayRoute.push(startStop);
    displayRoute.push(...intermediateStops); // Add in their current order
    if (endStop) displayRoute.push(endStop);


    displayRoute.forEach(stop => {
        latLngs.push([stop.lat, stop.lng]);
        let icon;
        const randomColor = `hsl(${Math.random() * 360}, 70%, 50%)`;

        if (stop.type === 'start') {
            icon = L.divIcon({
                className: 'custom-icon-start',
                html: `<div style="background-color: ${randomColor}; border-radius: 50%; width: 25px; height: 25px; line-height: 25px; text-align: center; font-weight: bold; border: 1px solid white;">I</div>`,
                iconSize: [25, 25],
                iconAnchor: [12, 12]
            });
        } else if (stop.type === 'end') {
            icon = L.divIcon({
                className: 'custom-icon-end',
                html: `<div style="background-color: ${randomColor}; border-radius: 50%; width: 25px; height: 25px; line-height: 25px; text-align: center; font-weight: bold; border: 1px solid white;">F</div>`,
                iconSize: [25, 25],
                iconAnchor: [12, 12]
            });
        } else { // intermediate
            icon = L.divIcon({
                className: 'custom-icon-intermediate',
                html: `<div style="background-color: #777; border-radius: 50%; width: 25px; height: 25px; line-height: 25px; text-align: center; font-weight: bold; border: 1px solid white;">${intermediateCounter++}</div>`,
                iconSize: [25, 25],
                iconAnchor: [12, 12]
            });
        }
        const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map)
            .bindPopup(`${stop.name} (${stop.type}) - ${stop.time || 'N/A'}`);
        stopMarkers.push(marker);
    });

    if (latLngs.length > 1) {
        routePolyline = L.polyline(latLngs, { color: '#00BCD4', weight: 3 }).addTo(map);
        // map.fitBounds(routePolyline.getBounds()); // Optional: zoom to fit route
    } else if (latLngs.length === 1) {
        map.setView(latLngs[0], 15); // Zoom to the single point
    }
}

// --- Save, Load, Delete Routes (localStorage) ---
function saveCurrentRoute() {
    const routeName = document.getElementById('routeName').value.trim();
    if (!routeName) {
        alert("Por favor, ingresa un nombre para la ruta.");
        return;
    }
    if (currentRoute.length < 2) {
        alert("La ruta actual está incompleta. Debe tener al menos inicio y fin.");
        return;
    }
    if (savedRoutes.find(r => r.name === routeName)) {
        if (!confirm(`Ya existe una ruta con el nombre "${routeName}". ¿Deseas sobrescribirla?`)) {
            return;
        }
        savedRoutes = savedRoutes.filter(r => r.name !== routeName);
    }

    // Deep copy currentRoute to avoid issues if currentRoute is modified later
    const routeToSave = JSON.parse(JSON.stringify(currentRoute));
    // Convert time strings back to Date objects after parsing from JSON
    routeToSave.forEach(stop => {
        if (stop.time) stop.scheduledTimeDate = parseTimeToDate(stop.time);
    });

    savedRoutes.push({ name: routeName, stops: routeToSave });
    localStorage.setItem('smartMoveProRoutes', JSON.stringify(savedRoutes));
    renderSavedRoutesList();
    updateRouteSelectorForQueue();
    alert(`Ruta "${routeName}" guardada.`);
}

function loadSavedRoutes() {
    const routesFromStorage = localStorage.getItem('smartMoveProRoutes');
    if (routesFromStorage) {
        savedRoutes = JSON.parse(routesFromStorage);
        // Convert time strings back to Date objects
        savedRoutes.forEach(route => {
            route.stops.forEach(stop => {
                if (stop.time) stop.scheduledTimeDate = parseTimeToDate(stop.time);
            });
        });
        renderSavedRoutesList();
        updateRouteSelectorForQueue();
    }
}

function renderSavedRoutesList() {
    const ul = document.getElementById('savedRoutesList');
    ul.innerHTML = '';
    savedRoutes.forEach(route => {
        const li = document.createElement('li');
        li.textContent = route.name;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Borrar';
        deleteBtn.onclick = (e) => { e.stopPropagation(); deleteRoute(route.name); };
        
        const loadBtn = document.createElement('button');
        loadBtn.textContent = 'Cargar';
        loadBtn.className = 'load-btn';
        loadBtn.onclick = (e) => { e.stopPropagation(); loadRoute(route.name); };
        
        const buttonsDiv = document.createElement('div');
        buttonsDiv.appendChild(loadBtn);
        buttonsDiv.appendChild(deleteBtn);
        li.appendChild(buttonsDiv);

        ul.appendChild(li);
    });
}

function loadRoute(routeName) {
    const route = savedRoutes.find(r => r.name === routeName);
    if (route) {
        // Deep copy to avoid modifying the savedRoutes version
        currentRoute = JSON.parse(JSON.stringify(route.stops));
        // Ensure Date objects are present
        currentRoute.forEach(stop => {
            if (stop.time) stop.scheduledTimeDate = parseTimeToDate(stop.time);
        });

        renderCurrentRouteStops();
        renderRouteOnMap();
        if (routePolyline) map.fitBounds(routePolyline.getBounds());
        alert(`Ruta "${routeName}" cargada. Puedes iniciar el seguimiento desde la pestaña 'Seguimiento'.`);
        showTab('trackingTab'); // Switch to tracking tab
    }
}

function deleteRoute(routeName) {
    if (confirm(`¿Estás seguro de que quieres borrar la ruta "${routeName}"?`)) {
        savedRoutes = savedRoutes.filter(r => r.name !== routeName);
        localStorage.setItem('smartMoveProRoutes', JSON.stringify(savedRoutes));
        renderSavedRoutesList();
        updateRouteSelectorForQueue();
        // If the deleted route was the current one, clear it
        if (document.getElementById('routeName').value === routeName) {
            clearCurrentRoute();
            document.getElementById('routeName').value = '';
        }
    }
}

// --- Real-Time Tracking ---
function startTracking() {
    if (currentRoute.length < 2) {
        alert("Carga o crea una ruta con al menos inicio y fin para comenzar el seguimiento.");
        return;
    }
    // Validate that all stops that need times have them as Date objects
    let validTimes = true;
    currentRoute.forEach(stop => {
        if ((stop.type === 'start' || stop.type === 'end' || stop.time) && !stop.scheduledTimeDate) {
            console.error("Error: Falta scheduledTimeDate para la parada:", stop);
            validTimes = false;
        }
    });
    if (!validTimes) {
        alert("Error en los datos de la ruta. Algunas paradas no tienen horarios válidos procesados. Intenta recargar la ruta o crearla de nuevo.");
        return;
    }


    document.getElementById('startTrackingButton').disabled = true;
    document.getElementById('stopTrackingButton').disabled = false;

    nextStopIndex = 0; // Start by heading towards the first stop (index 0)
    // Or, if we consider "Start" as already passed when tracking begins:
    // nextStopIndex = 1; (This is more typical for "next stop")
    // Let's find the first stop that isn't the start, or the end if only 2 stops
    const firstActualStopIndex = currentRoute.findIndex(s => s.type !== 'start');
    nextStopIndex = (firstActualStopIndex !== -1 && firstActualStopIndex < currentRoute.length) ? firstActualStopIndex : currentRoute.length -1;


    if (nextStopIndex >= currentRoute.length) {
        alert("No hay una próxima parada válida para iniciar el seguimiento.");
        stopTracking();
        return;
    }
    
    updateNextStopDisplay();

    if (navigator.geolocation) {
        currentTrackingWatchId = navigator.geolocation.watchPosition(
            handlePositionUpdate,
            handleGeolocationError,
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
        // Tracking interval for UI updates (like time deviation even if position doesn't change)
        trackingInterval = setInterval(updateTrackingInfo, 1000);
    } else {
        alert("La geolocalización no es compatible con este navegador.");
        stopTracking();
    }
}

function stopTracking() {
    if (currentTrackingWatchId !== null) {
        navigator.geolocation.clearWatch(currentTrackingWatchId);
        currentTrackingWatchId = null;
    }
    if (trackingInterval !== null) {
        clearInterval(trackingInterval);
        trackingInterval = null;
    }
    if (driverMarker) {
        map.removeLayer(driverMarker);
        driverMarker = null;
    }
    document.getElementById('startTrackingButton').disabled = false;
    document.getElementById('stopTrackingButton').disabled = true;
    document.getElementById('speed').textContent = '--';
    document.getElementById('timeDeviation').textContent = '00:00';
    document.getElementById('timeDeviation').className = 'atiempo';
    document.getElementById('nextStopInfo').textContent = '--';
    // Check for route queue
    handleEndOfRouteInQueue();
}

function handlePositionUpdate(position) {
    const { latitude, longitude, speed } = position.coords;
    const currentPos = L.latLng(latitude, longitude);

    if (!driverMarker) {
        const icon = L.divIcon({
            className: 'custom-icon-driver',
            html: 'CHOFER',
            iconSize: [50, 20], // Wider to fit text
            iconAnchor: [25, 10]
        });
        driverMarker = L.marker(currentPos, { icon: icon, zIndexOffset: 1000 }).addTo(map);
    } else {
        driverMarker.setLatLng(currentPos);
    }
    map.panTo(currentPos); // Optionally keep driver centered

    const speedKmh = speed ? (speed * 3.6).toFixed(1) : '0.0';
    document.getElementById('speed').textContent = speedKmh;

    if (!isManualAdvanceMode) {
        checkAutomaticStopAdvance(currentPos);
    }
    updateTrackingInfo(currentPos);
}


function updateTrackingInfo(currentPos = null) { // currentPos can be null if called by interval
    if (!driverMarker && !currentPos) return; // No position data yet
    const posToUse = currentPos || (driverMarker ? driverMarker.getLatLng() : null);
    if (!posToUse) return;

    if (nextStopIndex < 0 || nextStopIndex >= currentRoute.length) {
        document.getElementById('timeDeviation').textContent = 'Ruta Finalizada';
        document.getElementById('timeDeviation').className = 'atiempo';
        return;
    }
    
    // Deviation calculation
    // currentSegmentStartStop is the stop *before* nextStopIndex.
    // If nextStopIndex is 0 (first stop), use that as the start of the segment.
    const currentSegmentStartStopIndex = Math.max(0, nextStopIndex - 1);
    const segmentStartStop = currentRoute[currentSegmentStartStopIndex];
    const segmentEndStop = currentRoute[nextStopIndex];

    if (!segmentStartStop || !segmentEndStop || !segmentStartStop.scheduledTimeDate || !segmentEndStop.scheduledTimeDate) {
        // console.warn("Datos insuficientes para calcular desvío para el segmento:", segmentStartStop, segmentEndStop);
        document.getElementById('timeDeviation').textContent = '--:--';
        document.getElementById('timeDeviation').className = '';
        return;
    }
    
    const segmentStartTime = segmentStartStop.scheduledTimeDate.getTime();
    const segmentEndTime = segmentEndStop.scheduledTimeDate.getTime();
    const segmentTotalScheduledMillis = segmentEndTime - segmentStartTime;

    if (segmentTotalScheduledMillis <= 0 && segmentStartStop !== segmentEndStop) { // Allow 0 if start=end (first stop)
        // console.warn("Duración de segmento no positiva.");
        document.getElementById('timeDeviation').textContent = 'Error Horario';
         document.getElementById('timeDeviation').className = '';
        return;
    }

    const startLatLng = L.latLng(segmentStartStop.lat, segmentStartStop.lng);
    const endLatLng = L.latLng(segmentEndStop.lat, segmentEndStop.lng);
    const segmentTotalDistance = startLatLng.distanceTo(endLatLng);

    let percentageCovered;
    if (segmentTotalDistance === 0) { // If start and end of segment are same point (e.g. at the very first stop)
        percentageCovered = 0; // Or 1 if we are AT the stop
    } else {
        // Distance from current position to the END of the segment
        const distanceToEndOfSegment = posToUse.distanceTo(endLatLng);
        // Percentage covered is 1 - (remaining distance / total segment distance)
        percentageCovered = 1 - (distanceToEndOfSegment / segmentTotalDistance);
        percentageCovered = Math.max(0, Math.min(1, percentageCovered)); // Clamp between 0 and 1
    }
    
    // If this is the first stop, the "segment" is just arriving at it.
    // The calculation is slightly different: we are either before or at the first stop.
    // If nextStopIndex is 0, segmentStartStop and segmentEndStop might be the same.
    // In this case, percentageCovered might be tricky.
    // Let's refine for the first stop (nextStopIndex === 0, or more generally, when segmentStartStop === segmentEndStop)
    if (segmentStartStop === segmentEndStop) { // We are AT the very first stop of the route to calculate against.
      // If current time is before scheduled time, we are early. If after, late.
      // No concept of "percentage covered" for a single point in time.
      // This case will be handled if we shift nextStopIndex to 1 initially
      // Assuming nextStopIndex is always > 0 during tracking (points to an *upcoming* stop)
    }


    const expectedTimeAtCurrentPositionMillis = segmentStartTime + (percentageCovered * segmentTotalScheduledMillis);
    const currentTimeMillis = new Date().getTime();
    const deviationMillis = currentTimeMillis - expectedTimeAtCurrentPositionMillis; // Positive: late, Negative: early

    const deviationSeconds = Math.round(deviationMillis / 1000);
    const absDeviationSeconds = Math.abs(deviationSeconds);
    const minutes = Math.floor(absDeviationSeconds / 60);
    const seconds = absDeviationSeconds % 60;
    
    const sign = deviationSeconds < 0 ? '+' : (deviationSeconds > 0 ? '-' : ''); // + for early, - for late
    const deviationText = `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    const deviationEl = document.getElementById('timeDeviation');
    deviationEl.textContent = deviationText;
    if (deviationSeconds < -10) { // More than 10s early
        deviationEl.className = 'adelantado';
    } else if (deviationSeconds > 10) { // More than 10s late
        deviationEl.className = 'atrasado';
    } else {
        deviationEl.className = 'atiempo';
    }
}

function handleGeolocationError(error) {
    console.error("Error de Geolocalización: ", error);
    let message = "Error obteniendo ubicación: ";
    switch (error.code) {
        case error.PERMISSION_DENIED: message += "Permiso denegado."; break;
        case error.POSITION_UNAVAILABLE: message += "Información de posición no disponible."; break;
        case error.TIMEOUT: message += "Timeout obteniendo posición."; break;
        default: message += "Error desconocido."; break;
    }
    alert(message);
    stopTracking();
}

function updateNextStopDisplay() {
    const nextStopDisplay = document.getElementById('nextStopInfo');
    if (nextStopIndex >= 0 && nextStopIndex < currentRoute.length) {
        const stop = currentRoute[nextStopIndex];
        let typeText = '';
        switch(stop.type) {
            case 'start': typeText = 'Inicio'; break;
            case 'end': typeText = 'Final'; break;
            case 'intermediate': 
                const intermediateStops = currentRoute.filter(s => s.type === 'intermediate');
                const originalIndex = intermediateStops.indexOf(stop);
                typeText = `Intermedia ${originalIndex + 1}`;
                break;
        }
        nextStopDisplay.textContent = `${stop.name} (${typeText}) - Prog: ${stop.time || 'N/A'}`;
        // Highlight next stop marker (optional)
        stopMarkers.forEach((marker, idx) => {
            // Need to map displayRoute index to original currentRoute index if they differ
            // For simplicity, assume stopMarkers are in same order as currentRoute for now
            if (idx === nextStopIndex) {
                marker.setOpacity(1.0);
                 // marker.setIcon( L.icon({ ... marker.options.icon.options, iconUrl: 'new_highlight_icon.png' }) );
            } else {
                marker.setOpacity(0.6);
            }
        });

    } else {
        nextStopDisplay.textContent = "Ruta completada o sin paradas.";
        if (nextStopIndex >= currentRoute.length && currentRoute.length > 0) { // Completed
             stopTracking(); // This will also handle queue
        }
    }
}


function checkAutomaticStopAdvance(currentPos) {
    if (isManualAdvanceMode || nextStopIndex < 0 || nextStopIndex >= currentRoute.length) return;

    const DETECTION_RADIUS = 50; // meters
    const nextStopLatLng = L.latLng(currentRoute[nextStopIndex].lat, currentRoute[nextStopIndex].lng);
    
    if (currentPos.distanceTo(nextStopLatLng) < DETECTION_RADIUS) {
        advanceToNextStopLogic();
    } else {
        // "Skipped stop" logic: if we are much closer to a stop *after* the current nextStop.
        // This is more complex. For now, simple proximity to current nextStop.
        // Basic skip: if past current nextStop and closer to a subsequent one.
        if (nextStopIndex + 1 < currentRoute.length) {
            const stopAfterNextLatLng = L.latLng(currentRoute[nextStopIndex + 1].lat, currentRoute[nextStopIndex + 1].lng);
            if (currentPos.distanceTo(stopAfterNextLatLng) < currentPos.distanceTo(nextStopLatLng) && 
                currentPos.distanceTo(stopAfterNextLatLng) < DETECTION_RADIUS * 3) { // If significantly closer to the one after next
                // This simple logic might jump too eagerly. A more robust solution
                // would involve checking if the driver is on the path segment *beyond* the current next stop.
                // For now, let's keep it simple: advance if very close to current next stop.
            }
        }
    }
}

function advanceToNextStopLogic() {
    if (nextStopIndex < currentRoute.length - 1) {
        nextStopIndex++;
        updateNextStopDisplay();
        // Play a sound or vibrate (not implemented here due to restrictions)
        // console.log("Avanzado a la parada:", currentRoute[nextStopIndex].name);
    } else if (nextStopIndex === currentRoute.length - 1) { // Reached final stop
        nextStopIndex++; // To indicate completion
        updateNextStopDisplay(); // Will show "Ruta completada"
        // stopTracking(); // Handled by updateNextStopDisplay when index is out of bounds
    }
}

function toggleManualAdvance(isManual) {
    isManualAdvanceMode = isManual;
    document.getElementById('prevStopButton').disabled = !isManual;
    document.getElementById('nextStopButton').disabled = !isManual;
}

function manualNextStop() {
    if (!isManualAdvanceMode || !currentTrackingWatchId) return; // Only if tracking and in manual
    advanceToNextStopLogic();
}

function manualPreviousStop() {
    if (!isManualAdvanceMode || !currentTrackingWatchId) return;
    if (nextStopIndex > 0) { // Can't go before the first stop (index 0)
        nextStopIndex--;
        updateNextStopDisplay();
    }
}


// --- Route Queue ---
function updateRouteSelectorForQueue() {
    const selector = document.getElementById('routeSelectorForQueue');
    selector.innerHTML = '<option value="">Seleccionar ruta...</option>';
    savedRoutes.forEach(route => {
        const option = document.createElement('option');
        option.value = route.name;
        option.textContent = route.name;
        selector.appendChild(option);
    });
}

function addSelectedRouteToQueue() {
    const selector = document.getElementById('routeSelectorForQueue');
    const routeName = selector.value;
    if (routeName && !routeQueue.includes(routeName)) {
        routeQueue.push(routeName);
        renderRouteQueueList();
    } else if (routeQueue.includes(routeName)){
        alert("Esa ruta ya está en la cola.");
    }
    selector.value = ""; // Reset selector
}

function renderRouteQueueList() {
    const ul = document.getElementById('routeQueueList');
    ul.innerHTML = '';
    routeQueue.forEach((routeName, index) => {
        const li = document.createElement('li');
        li.textContent = `${index + 1}. ${routeName}`;
        if (index === currentRouteInQueueIndex) {
            li.style.fontWeight = 'bold';
            li.style.color = '#00BCD4'; // Highlight active route in queue
        }

        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Quitar';
        removeBtn.style.marginLeft = '10px';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeRouteFromQueue(index);
        };
        li.appendChild(removeBtn);
        ul.appendChild(li);
    });
}

function removeRouteFromQueue(indexToRemove) {
    routeQueue.splice(indexToRemove, 1);
    if (currentRouteInQueueIndex > indexToRemove) {
        currentRouteInQueueIndex--;
    } else if (currentRouteInQueueIndex === indexToRemove) {
        // If removing the currently active route from queue (if tracking stops on it for example)
        currentRouteInQueueIndex = -1; // No active route in queue
    }
    renderRouteQueueList();
}

function clearRouteQueue() {
    routeQueue = [];
    currentRouteInQueueIndex = -1;
    renderRouteQueueList();
}

function handleEndOfRouteInQueue() {
    // Called by stopTracking or when a route is naturally completed
    if (currentRouteInQueueIndex !== -1 && currentRouteInQueueIndex < routeQueue.length) {
        // Current route in queue finished
        if (document.getElementById('autoStartNextInQueue').checked) {
            currentRouteInQueueIndex++;
            if (currentRouteInQueueIndex < routeQueue.length) {
                const nextRouteName = routeQueue[currentRouteInQueueIndex];
                alert(`Iniciando automáticamente la siguiente ruta en cola: ${nextRouteName}`);
                loadRoute(nextRouteName); // This loads it into currentRoute
                // Ensure UI reflects the new active route in queue
                renderRouteQueueList();
                // Small delay to allow loadRoute alert to clear, then start tracking
                setTimeout(() => {
                     if(currentRoute.length > 0) startTracking();
                }, 500);
            } else {
                alert("Cola de rutas completada.");
                currentRouteInQueueIndex = -1; // Reset queue index
                renderRouteQueueList();
            }
        } else {
             alert(`Ruta ${routeQueue[currentRouteInQueueIndex]} completada. Avance automático desactivado.`);
             currentRouteInQueueIndex = -1; // Reset, user must manually start next.
             renderRouteQueueList();
        }
    } else if (routeQueue.length > 0 && currentRouteInQueueIndex === -1 && document.getElementById('startTrackingButton').disabled === false) {
        // No route was active from queue, but there are routes in queue and tracking is stopped.
        // Offer to start the first one if autoStart is on (or user can manually select)
        if (document.getElementById('autoStartNextInQueue').checked) {
            currentRouteInQueueIndex = 0;
            if (currentRouteInQueueIndex < routeQueue.length) {
                 const nextRouteName = routeQueue[currentRouteInQueueIndex];
                alert(`Iniciando automáticamente la primera ruta en cola: ${nextRouteName}`);
                loadRoute(nextRouteName);
                renderRouteQueueList();
                setTimeout(() => {
                     if(currentRoute.length > 0) startTracking();
                }, 500);
            } else {
                 currentRouteInQueueIndex = -1; // Should not happen if queue has items
            }
        }
    }
}

// Helper to start the first route in queue if nothing is active and tracking is not running
// This can be called, for instance, after loading the app, or after clearing a route.
function checkAndStartFirstInQueue() {
    if (currentTrackingWatchId === null && routeQueue.length > 0 && currentRouteInQueueIndex === -1) {
        if (document.getElementById('autoStartNextInQueue').checked) {
            currentRouteInQueueIndex = 0; // Set as active
            const routeName = routeQueue[currentRouteInQueueIndex];
            loadRoute(routeName); // This makes it currentRoute
            // Switch to tracking tab maybe
            showTab('trackingTab');
            renderRouteQueueList(); // Highlight it
            // Don't auto-start tracking here, let user press "Start Tracking"
            // Or, if desired:
            // setTimeout(() => { startTracking(); }, 500);
            alert(`Ruta "${routeName}" cargada desde la cola. Presiona "Iniciar Seguimiento".`);
        }
    }
}
