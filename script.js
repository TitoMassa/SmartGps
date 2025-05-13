document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENTOS DEL DOM ---
    const mapElement = document.getElementById('map');
    const routeNameInput = document.getElementById('routeName');
    const stopNameInput = document.getElementById('stopName');
    const stopTimeInput = document.getElementById('stopTime');
    const autoCalcTimesCheckbox = document.getElementById('autoCalcTimes');
    const setStartBtn = document.getElementById('setStartBtn');
    const setEndBtn = document.getElementById('setEndBtn');
    const setIntermediateBtn = document.getElementById('setIntermediateBtn');
    const saveRouteBtn = document.getElementById('saveRouteBtn');
    const clearCurrentRouteBtn = document.getElementById('clearCurrentRouteBtn');
    const currentStopsListUI = document.getElementById('currentStopsList');
    
    const savedRoutesSelect = document.getElementById('savedRoutesSelect');
    const loadRouteBtn = document.getElementById('loadRouteBtn');
    const deleteRouteBtn = document.getElementById('deleteRouteBtn');
    const viewRouteBtn = document.getElementById('viewRouteBtn');

    const startTrackingBtn = document.getElementById('startTrackingBtn');
    const stopTrackingBtn = document.getElementById('stopTrackingBtn');
    const trackingInfoDiv = document.getElementById('tracking-info');
    const speedSpan = document.getElementById('speed');
    const nextStopNameSpan = document.getElementById('nextStopName');
    const nextStopTimeSpan = document.getElementById('nextStopTime');
    const timeDeviationSpan = document.getElementById('timeDeviation');
    const manualAdvanceCheckbox = document.getElementById('manualAdvanceCheck');
    const prevStopBtn = document.getElementById('prevStopBtn');
    const nextStopBtn = document.getElementById('nextStopBtn');

    const routeToQueueSelect = document.getElementById('routeToQueueSelect');
    const addToQueueBtn = document.getElementById('addToQueueBtn');
    const startQueueBtn = document.getElementById('startQueueBtn');
    const clearQueueBtn = document.getElementById('clearQueueBtn');
    const queuedRoutesListUI = document.getElementById('queuedRoutesList');
    const autoStartNextInQueueCheckbox = document.getElementById('autoStartNextInQueue');

    // --- ESTADO DE LA APLICACIÓN ---
    let map;
    let currentRouteStops = []; // { name, lat, lng, type, scheduledTime (Date obj), marker }
    let currentPolyline = null;
    let tempStopCoords = null; // Para guardar coordenadas del clic en mapa
    let stopCreationMode = null; // 'start', 'end', 'intermediate'
    let driverMarker = null;
    let watchId = null;
    let activeRouteForTracking = null;
    let currentStopIndexInTracking = 0;
    let intermediateStopCounter = 1;

    let routeQueue = []; // Array de nombres de rutas
    let isQueueActive = false;


    // --- INICIALIZACIÓN DEL MAPA ---
    function initMap() {
        map = L.map(mapElement).setView([ -34.6037, -58.3816], 13); // Buenos Aires como ejemplo
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        map.on('click', onMapClick);
    }

    // --- LÓGICA DE CREACIÓN DE RUTA ---
    function onMapClick(e) {
        tempStopCoords = e.latlng;
        if (stopCreationMode) {
            const stopName = stopNameInput.value.trim() || `Parada ${currentRouteStops.length + 1}`;
            let stopTime = stopTimeInput.value;

            if (stopCreationMode === 'start' || stopCreationMode === 'end') {
                if (!stopTime) {
                    alert('Debe ingresar un horario para el inicio y el fin.');
                    return;
                }
            }
            
            const newStop = {
                name: stopName,
                lat: tempStopCoords.lat,
                lng: tempStopCoords.lng,
                type: stopCreationMode,
                scheduledTime: stopTime ? parseTimeString(stopTime) : null,
                originalTimeInput: stopTime // Guardamos el input original para recálculos
            };

            addStopToCurrentRoute(newStop);
            updateStopCreationButtonsState();
            stopNameInput.value = ''; // Limpiar para la próxima parada
            // No limpiamos stopTimeInput por si el usuario quiere añadir varias con el mismo tiempo (aunque no es común)
        } else {
            alert('Seleccione un tipo de parada (Inicio, Fin, Intermedia) antes de hacer clic en el mapa.');
        }
    }

    function setStopCreationMode(mode) {
        stopCreationMode = mode;
        // Visual feedback (opcional) - por ahora, botones se habilitan/deshabilitan
        alert(`Modo ${mode} activado. Haz clic en el mapa para añadir la parada.`);
    }

    setStartBtn.addEventListener('click', () => {
        if (currentRouteStops.find(s => s.type === 'start')) {
            alert("Ya existe una parada de Inicio. Bórrela para añadir una nueva o edítela.");
            return;
        }
        setStopCreationMode('start');
        stopTimeInput.required = true;
    });

    setEndBtn.addEventListener('click', () => {
        if (currentRouteStops.find(s => s.type === 'end')) {
            alert("Ya existe una parada de Fin. Bórrela para añadir una nueva o edítela.");
            return;
        }
        setStopCreationMode('end');
        stopTimeInput.required = true;
    });

    setIntermediateBtn.addEventListener('click', () => {
        setStopCreationMode('intermediate');
        stopTimeInput.required = false; // Horario opcional para intermedias
    });
    
    function addStopToCurrentRoute(stop) {
        // Lógica de orden: Inicio -> Fin -> Intermedias
        let insertIndex = -1;

        if (stop.type === 'start') {
            const existingStart = currentRouteStops.find(s => s.type === 'start');
            if (existingStart) {
                alert('Ya existe una parada de inicio.'); return;
            }
            currentRouteStops.unshift(stop); // Inicio siempre al principio
        } else if (stop.type === 'end') {
            const existingEnd = currentRouteStops.find(s => s.type === 'end');
            if (existingEnd) {
                alert('Ya existe una parada de fin.'); return;
            }
            // Fin va después del inicio, o al final si no hay intermedias aún
            const startIndex = currentRouteStops.findIndex(s => s.type === 'start');
            if (startIndex !== -1 && currentRouteStops.length > startIndex + 1) {
                // Si hay intermedias, el fin va después de todas ellas (o antes de la última si ya había un fin)
                // Esta lógica es compleja si se permite editar el orden.
                // Simplificación: Se añade y luego se reordena o se pide al usuario que las añada en orden.
                // Para este ejercicio, asumimos que el usuario las añade en el orden deseado: Inicio, Fin, luego Intermedias
                // Esto significa que el Fin se insertará después del Inicio y antes de cualquier Intermedia que pudiera estar mal puesta
                // O al final si no hay inicio. Mejor, si hay un inicio, fin va después de él. Si hay intermedias, fin va después de ellas.
                
                let lastNonEndIndex = currentRouteStops.length;
                // Buscamos el último índice que no sea 'end' para insertar el 'end' ahí si es necesario.
                // Sin embargo, lo más simple es que el usuario DEBE añadir Inicio, luego Fin, y LUEGO intermedias.
                // El UI de botones guía esto.
                currentRouteStops.push(stop); // Por ahora, añadir al final y luego reordenar/validar

            } else {
                currentRouteStops.push(stop);
            }
        } else { // 'intermediate'
            const endIndex = currentRouteStops.findIndex(s => s.type === 'end');
            if (endIndex !== -1) {
                currentRouteStops.splice(endIndex, 0, stop); // Insertar antes del final
            } else {
                currentRouteStops.push(stop); // Si no hay fin, añadir al final (luego se requerirá un fin)
            }
        }
        
        // Re-validar y dibujar
        validateAndDrawCurrentRoute();
        updateStopCreationButtonsState();
        updateCurrentStopsUI();
    }

    function validateAndDrawCurrentRoute() {
        // Asegurar que Inicio está primero, Fin último (si existen)
        const start = currentRouteStops.find(s => s.type === 'start');
        const end = currentRouteStops.find(s => s.type === 'end');
        const intermediates = currentRouteStops.filter(s => s.type === 'intermediate');

        let orderedStops = [];
        if (start) orderedStops.push(start);
        orderedStops.push(...intermediates);
        if (end) orderedStops.push(end);
        
        currentRouteStops = orderedStops;
        intermediateStopCounter = 1; // Reset for re-drawing icons

        // Limpiar marcadores y polilínea anteriores
        currentRouteStops.forEach(stop => {
            if (stop.marker && map.hasLayer(stop.marker)) {
                map.removeLayer(stop.marker);
            }
        });
        if (currentPolyline && map.hasLayer(currentPolyline)) {
            map.removeLayer(currentPolyline);
        }

        // Dibujar nuevos marcadores y polilínea
        const latLngs = [];
        currentRouteStops.forEach((stop, index) => {
            const icon = createStopIcon(stop.type, stop.name);
            stop.marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map)
                .bindPopup(`<b>${stop.name}</b><br>${stop.type}${stop.scheduledTime ? '<br>Hora: ' + formatTime(stop.scheduledTime) : ''}`);
            latLngs.push([stop.lat, stop.lng]);
        });

        if (latLngs.length > 1) {
            currentPolyline = L.polyline(latLngs, { color: 'blue' }).addTo(map);
            // map.fitBounds(currentPolyline.getBounds()); // Opcional: auto-zoom
        }
        
        if (autoCalcTimesCheckbox.checked) {
            calculateIntermediateTimes();
        }
        updateCurrentStopsUI();
        updateSaveRouteButtonState();
    }

    function createStopIcon(type, name) {
        let label = '';
        let bgColor = getRandomColor();
        let className = 'custom-div-icon';

        if (type === 'start') {
            label = 'I';
        } else if (type === 'end') {
            label = 'F';
        } else { // intermediate
            label = intermediateStopCounter.toString();
            intermediateStopCounter++;
        }
        
        return L.divIcon({
            html: `<div style="background-color: ${bgColor};">${label}</div>`,
            className: className,
            iconSize: [30, 30],
            iconAnchor: [15, 30] // point of the icon which will correspond to marker's location
        });
    }
    
    function getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    function calculateIntermediateTimes() {
        const startStop = currentRouteStops.find(s => s.type === 'start');
        const endStop = currentRouteStops.find(s => s.type === 'end');

        if (!startStop || !endStop || !startStop.scheduledTime || !endStop.scheduledTime) {
            // No se puede calcular sin inicio/fin con horarios
            return;
        }

        const intermediates = currentRouteStops.filter(s => s.type === 'intermediate');
        if (intermediates.length === 0) return;

        const totalDurationMillis = endStop.scheduledTime.getTime() - startStop.scheduledTime.getTime();
        if (totalDurationMillis <= 0) {
            alert("La hora de fin debe ser posterior a la hora de inicio.");
            return;
        }

        let totalDistance = 0;
        const segmentDistances = [];

        // Calcular distancias entre paradas consecutivas (incluyendo inicio e fin con intermedias)
        let prevStopForDist = startStop;
        const allStopsForCalc = [startStop, ...intermediates, endStop];

        for (let i = 1; i < allStopsForCalc.length; i++) {
            const dist = haversineDistance(
                { lat: prevStopForDist.lat, lng: prevStopForDist.lng },
                { lat: allStopsForCalc[i].lat, lng: allStopsForCalc[i].lng }
            );
            segmentDistances.push(dist);
            totalDistance += dist;
            prevStopForDist = allStopsForCalc[i];
        }
        
        if (totalDistance === 0) { // Evitar división por cero si todas las paradas están en el mismo lugar
            intermediates.forEach(stop => stop.scheduledTime = new Date(startStop.scheduledTime.getTime()));
            updateCurrentStopsUI();
            return;
        }

        let cumulativeDistance = 0;
        let timeElapsedMillis = 0;
        let lastCalcTime = startStop.scheduledTime.getTime();

        // Calcular tiempos para intermedias
        // La primera "segmentDistance" es entre start e intermediate1
        // La segunda es entre intermediate1 e intermediate2, etc.
        for (let i = 0; i < intermediates.length; i++) {
            cumulativeDistance += segmentDistances[i]; // Distancia desde el inicio hasta ESTA parada intermedia
            const proportionOfDistance = cumulativeDistance / totalDistance;
            // El tiempo debe ser proporcional a la distancia del *segmento anterior*
            // Corregido: debe ser el tiempo acumulado proporcional a la distancia acumulada
            const timeForThisStopMillis = startStop.scheduledTime.getTime() + (totalDurationMillis * proportionOfDistance);
            
            intermediates[i].scheduledTime = new Date(Math.round(timeForThisStopMillis));
        }
        
        // Recalcular los tiempos para asegurar consistencia si las paradas intermedias no tenían tiempo original
        // O si se recalcula y el usuario no puso tiempo manual.
        // Esto es más simple: distribuir el tiempo total según las distancias de los segmentos.
        let currentTime = startStop.scheduledTime.getTime();
        let distAcc = 0;

        for (let i = 0; i < intermediates.length; i++) {
            // Distancia del segmento: start -> interm1, o interm(N) -> interm(N+1)
            const segmentDist = segmentDistances[i]; // Distancia del segmento que TERMINA en esta parada (o la anterior si es start)
            distAcc += segmentDist;
            const timeOffset = (distAcc / totalDistance) * totalDurationMillis;
            intermediates[i].scheduledTime = new Date(startStop.scheduledTime.getTime() + Math.round(timeOffset));
        }


        updateCurrentStopsUI();
    }
    
    autoCalcTimesCheckbox.addEventListener('change', () => {
        if (autoCalcTimesCheckbox.checked) {
            calculateIntermediateTimes();
        } else {
            // Permitir edición manual (ya es así si no está chequeado)
            // Podríamos limpiar los tiempos calculados si el usuario lo desmarca.
            currentRouteStops.forEach(s => {
                if (s.type === 'intermediate') {
                    // Restaurar tiempo original si existía, o dejar nulo
                    s.scheduledTime = s.originalTimeInput ? parseTimeString(s.originalTimeInput) : null;
                }
            });
            updateCurrentStopsUI();
        }
    });


    function updateStopCreationButtonsState() {
        const hasStart = currentRouteStops.some(s => s.type === 'start');
        const hasEnd = currentRouteStops.some(s => s.type === 'end');

        setStartBtn.disabled = hasStart;
        setEndBtn.disabled = !hasStart || hasEnd; // Necesita inicio, no puede haber ya un fin
        setIntermediateBtn.disabled = !hasStart || !hasEnd; // Necesita inicio y fin para añadir intermedias entre ellos
    }

    function updateSaveRouteButtonState() {
        const hasStart = currentRouteStops.some(s => s.type === 'start');
        const hasEnd = currentRouteStops.some(s => s.type === 'end');
        saveRouteBtn.disabled = !(routeNameInput.value.trim() && hasStart && hasEnd && currentRouteStops.length >= 2);
        startTrackingBtn.disabled = saveRouteBtn.disabled; // Solo se puede trackear una ruta válida
    }
    routeNameInput.addEventListener('input', updateSaveRouteButtonState);


    function updateCurrentStopsUI() {
        currentStopsListUI.innerHTML = '';
        intermediateStopCounter = 1; // Reset for UI display
        currentRouteStops.forEach((stop, index) => {
            const li = document.createElement('li');
            let stopLabel = stop.name;
            if (stop.type === 'start') stopLabel = `INICIO: ${stop.name}`;
            else if (stop.type === 'end') stopLabel = `FIN: ${stop.name}`;
            else stopLabel = `INT ${intermediateStopCounter++}: ${stop.name}`;
            
            li.textContent = `${stopLabel} ${stop.scheduledTime ? '(' + formatTime(stop.scheduledTime) + ')' : '(Sin hora)'}`;
            
            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'X';
            removeBtn.style.marginLeft = '10px';
            removeBtn.style.padding = '2px 5px';
            removeBtn.onclick = () => removeStopFromCurrentRoute(index);
            li.appendChild(removeBtn);

            currentStopsListUI.appendChild(li);
        });
    }
    
    function removeStopFromCurrentRoute(index) {
        const removedStop = currentRouteStops.splice(index, 1)[0];
        if (removedStop && removedStop.marker && map.hasLayer(removedStop.marker)) {
            map.removeLayer(removedStop.marker);
        }
        validateAndDrawCurrentRoute(); // Redibuja, recalcula iconos, etc.
        updateStopCreationButtonsState();
    }

    clearCurrentRouteBtn.addEventListener('click', () => {
        currentRouteStops.forEach(stop => {
            if (stop.marker && map.hasLayer(stop.marker)) {
                map.removeLayer(stop.marker);
            }
        });
        if (currentPolyline && map.hasLayer(currentPolyline)) {
            map.removeLayer(currentPolyline);
        }
        currentRouteStops = [];
        currentPolyline = null;
        routeNameInput.value = '';
        stopNameInput.value = '';
        stopTimeInput.value = '';
        intermediateStopCounter = 1;
        updateCurrentStopsUI();
        updateStopCreationButtonsState();
        updateSaveRouteButtonState();
        stopCreationMode = null; // Resetear modo
        tempStopCoords = null;
        map.setView([-34.6037, -58.3816], 13); // Reset view
    });

    // --- PERSISTENCIA (localStorage) ---
    function getSavedRoutes() {
        const routesJson = localStorage.getItem('smartMoveProRoutes');
        if (!routesJson) return [];
        const routes = JSON.parse(routesJson);
        // Convertir strings de tiempo a objetos Date
        routes.forEach(route => {
            route.stops.forEach(stop => {
                if (stop.scheduledTime) {
                    stop.scheduledTime = new Date(stop.scheduledTime);
                }
            });
        });
        return routes;
    }

    function saveRoutesToStorage(routes) {
        // Antes de guardar, convertir Date a string ISO para JSON
        const routesToStore = JSON.parse(JSON.stringify(routes)); // Clon profundo
        routesToStore.forEach(route => {
            route.stops.forEach(stop => {
                if (stop.scheduledTime && stop.scheduledTime instanceof Date) {
                     // No es necesario, JSON.stringify maneja Date a ISOString
                }
            });
        });
        localStorage.setItem('smartMoveProRoutes', JSON.stringify(routesToStore));
    }

    saveRouteBtn.addEventListener('click', () => {
        const routeName = routeNameInput.value.trim();
        if (!routeName) {
            alert('Por favor, ingrese un nombre para la ruta.');
            return;
        }
        if (currentRouteStops.length < 2 || !currentRouteStops.find(s => s.type === 'start') || !currentRouteStops.find(s => s.type === 'end')) {
            alert('La ruta debe tener al menos un inicio y un fin.');
            return;
        }

        const newRoute = {
            name: routeName,
            stops: JSON.parse(JSON.stringify(currentRouteStops.map(s => ({...s, marker: undefined })))) // Quitar marcadores
        };

        const savedRoutes = getSavedRoutes();
        const existingRouteIndex = savedRoutes.findIndex(r => r.name === routeName);
        if (existingRouteIndex !== -1) {
            if (confirm(`Ya existe una ruta llamada "${routeName}". ¿Desea sobrescribirla?`)) {
                savedRoutes[existingRouteIndex] = newRoute;
            } else {
                return;
            }
        } else {
            savedRoutes.push(newRoute);
        }
        
        saveRoutesToStorage(savedRoutes);
        alert(`Ruta "${routeName}" guardada.`);
        populateSavedRoutesSelect();
        clearCurrentRouteBtn.click(); // Limpiar para nueva ruta
    });

    function populateSavedRoutesSelect() {
        const routes = getSavedRoutes();
        savedRoutesSelect.innerHTML = '';
        routeToQueueSelect.innerHTML = '<option value="">Seleccione ruta para cola</option>';

        if (routes.length === 0) {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "No hay rutas guardadas";
            savedRoutesSelect.appendChild(option);
        } else {
            routes.forEach(route => {
                const option = document.createElement('option');
                option.value = route.name;
                option.textContent = route.name;
                savedRoutesSelect.appendChild(option.cloneNode(true));
                routeToQueueSelect.appendChild(option);
            });
        }
        loadRouteBtn.disabled = routes.length === 0;
        deleteRouteBtn.disabled = routes.length === 0;
        viewRouteBtn.disabled = routes.length === 0;
        addToQueueBtn.disabled = routes.length === 0;
    }

    loadRouteBtn.addEventListener('click', () => {
        const routeName = savedRoutesSelect.value;
        if (!routeName) return;
        loadRouteByName(routeName, true); // true para cargarla como editable
    });
    
    viewRouteBtn.addEventListener('click', () => {
        const routeName = savedRoutesSelect.value;
        if (!routeName) return;
        loadRouteByName(routeName, false); // false para solo visualizarla
    });

    function loadRouteByName(routeName, makeEditable) {
        const routes = getSavedRoutes();
        const routeToLoad = routes.find(r => r.name === routeName);
        if (routeToLoad) {
            clearCurrentRouteBtn.click(); // Limpiar estado actual
            
            routeNameInput.value = routeToLoad.name;
            currentRouteStops = JSON.parse(JSON.stringify(routeToLoad.stops)); // Clonar profundo
            // Convertir strings de tiempo a objetos Date de nuevo (aunque getSavedRoutes ya lo hace)
            currentRouteStops.forEach(stop => {
                if (stop.scheduledTime && typeof stop.scheduledTime === 'string') {
                    stop.scheduledTime = new Date(stop.scheduledTime);
                }
            });

            validateAndDrawCurrentRoute(); // Esto dibuja marcadores, etc.
            if (currentPolyline) map.fitBounds(currentPolyline.getBounds());

            if (makeEditable) {
                updateStopCreationButtonsState();
                updateSaveRouteButtonState();
            } else {
                // Si solo es para ver, deshabilitar edición
                saveRouteBtn.disabled = true;
                setStartBtn.disabled = true;
                setEndBtn.disabled = true;
                setIntermediateBtn.disabled = true;
                // Quitar botones de "X" de las paradas
                currentStopsListUI.querySelectorAll('button').forEach(btn => btn.remove());
            }
            activeRouteForTracking = JSON.parse(JSON.stringify(routeToLoad)); // Preparar para seguimiento
            startTrackingBtn.disabled = false;
        }
    }

    deleteRouteBtn.addEventListener('click', () => {
        const routeName = savedRoutesSelect.value;
        if (!routeName) return;
        if (confirm(`¿Está seguro de que desea eliminar la ruta "${routeName}"?`)) {
            let routes = getSavedRoutes();
            routes = routes.filter(r => r.name !== routeName);
            saveRoutesToStorage(routes);
            populateSavedRoutesSelect();
            alert(`Ruta "${routeName}" eliminada.`);
            if (routeNameInput.value === routeName) { // Si la ruta borrada era la actual
                clearCurrentRouteBtn.click();
            }
        }
    });

    // --- SEGUIMIENTO EN TIEMPO REAL ---
    startTrackingBtn.addEventListener('click', () => {
        if (!activeRouteForTracking && currentRouteStops.length > 1) {
             // Si no se cargó una ruta pero hay una en edición válida, usarla.
             const routeNameToTrack = routeNameInput.value.trim();
             if (!routeNameToTrack || !currentRouteStops.find(s => s.type === 'start') || !currentRouteStops.find(s => s.type === 'end')) {
                alert("La ruta actual no es válida para seguimiento. Cargue o guarde una ruta completa.");
                return;
             }
             activeRouteForTracking = {
                name: routeNameToTrack,
                stops: JSON.parse(JSON.stringify(currentRouteStops.map(s => ({...s, marker: undefined }))))
             };
             // Asegurar que los tiempos están como Date objects
             activeRouteForTracking.stops.forEach(stop => {
                if (stop.scheduledTime && typeof stop.scheduledTime === 'string') {
                    stop.scheduledTime = new Date(stop.scheduledTime);
                } else if (stop.scheduledTime && stop.scheduledTime.originalTimeInput && !stop.scheduledTime instanceof Date){
                    // Caso borde de autoCalc y luego carga.
                    stop.scheduledTime = parseTimeString(stop.originalTimeInput) || stop.scheduledTime;
                }
             });

        } else if (!activeRouteForTracking) {
            alert("No hay una ruta activa para el seguimiento. Cree o cargue una ruta.");
            return;
        }


        if (navigator.geolocation) {
            trackingInfoDiv.style.display = 'block';
            stopTrackingBtn.disabled = false;
            startTrackingBtn.disabled = true; // Ya está en seguimiento
            currentStopIndexInTracking = 0; // Empezar desde la primera parada
            updateNextStopUI();
            highlightNextStopOnMap();

            watchId = navigator.geolocation.watchPosition(
                handlePositionUpdate,
                handleGeolocationError,
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
            alert("Seguimiento iniciado. Se usará su ubicación actual.");
        } else {
            alert("La geolocalización no es soportada por este navegador.");
        }
    });

    stopTrackingBtn.addEventListener('click', () => {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        if (driverMarker && map.hasLayer(driverMarker)) {
            map.removeLayer(driverMarker);
            driverMarker = null;
        }
        trackingInfoDiv.style.display = 'none';
        stopTrackingBtn.disabled = true;
        startTrackingBtn.disabled = (activeRouteForTracking && activeRouteForTracking.stops.length > 1) ? false : true; // Habilitar si hay ruta
        
        timeDeviationSpan.textContent = "00:00";
        timeDeviationSpan.className = "on-time";
        speedSpan.textContent = "0";

        // Si la cola estaba activa y se detiene manualmente, detener la cola.
        if (isQueueActive) {
            isQueueActive = false;
            startQueueBtn.textContent = "Iniciar Cola";
            startQueueBtn.disabled = routeQueue.length === 0;
            alert("Cola de rutas detenida.");
        }
        // No limpiar activeRouteForTracking aquí, para poder reanudar o verla.
        // Se limpia cuando se carga otra ruta o se limpia explícitamente.
        unhighlightAllStops();
    });

    function handlePositionUpdate(position) {
        const { latitude, longitude, speed } = position.coords;
        const userLatLng = L.latLng(latitude, longitude);

        if (!driverMarker) {
            driverMarker = L.marker(userLatLng, {
                icon: L.divIcon({ className: 'driver-icon', iconSize: [20,20], iconAnchor: [10,10] })
            }).addTo(map);
        } else {
            driverMarker.setLatLng(userLatLng);
        }
        map.panTo(userLatLng); // Opcional: centrar mapa en el conductor

        speedSpan.textContent = speed ? (speed * 3.6).toFixed(1) : "N/A"; // m/s a km/h

        if (activeRouteForTracking && activeRouteForTracking.stops.length > currentStopIndexInTracking + 1) {
            calculateAndDisplayDeviation(userLatLng);
            
            if (!manualAdvanceCheckbox.checked) {
                checkAutomaticStopAdvance(userLatLng);
            }
        } else if (activeRouteForTracking && currentStopIndexInTracking >= activeRouteForTracking.stops.length -1) {
            // Llegó al final de la ruta
            handleRouteCompletion();
        }
    }
    
    function handleRouteCompletion() {
        alert(`Ruta "${activeRouteForTracking.name}" completada.`);
        stopTrackingBtn.click(); // Limpia seguimiento actual

        if (isQueueActive && routeQueue.length > 0) {
            const nextRouteNameInQueue = routeQueue.shift(); // Saca la primera
            updateQueuedRoutesUI();
            
            if (nextRouteNameInQueue) {
                loadRouteByName(nextRouteNameInQueue, false); // Cargar para visualización y seguimiento
                 if (autoStartNextInQueueCheckbox.checked) {
                    setTimeout(() => { // Pequeño delay para que el usuario vea el cambio
                        if (activeRouteForTracking) { // Asegurarse que se cargó bien
                            startTrackingBtn.click(); // Iniciar seguimiento de la nueva ruta
                            alert(`Iniciando automáticamente la siguiente ruta de la cola: "${activeRouteForTracking.name}"`);
                        } else {
                            isQueueActive = false; // Algo falló al cargar
                            startQueueBtn.textContent = "Iniciar Cola";
                            startQueueBtn.disabled = routeQueue.length === 0;
                        }
                    }, 2000);
                } else {
                    alert(`Siguiente ruta en cola: "${nextRouteNameInQueue}". Inicie manualmente.`);
                    startTrackingBtn.disabled = false; // Permitir inicio manual
                    isQueueActive = false; // Espera acción manual para continuar la cola
                    startQueueBtn.textContent = "Continuar Cola";
                    startQueueBtn.disabled = false;
                }
            } else { // Cola vacía
                isQueueActive = false;
                startQueueBtn.textContent = "Iniciar Cola";
                startQueueBtn.disabled = true;
                alert("Cola de rutas finalizada.");
            }
        } else { // No hay cola activa o está vacía
            isQueueActive = false;
            startQueueBtn.textContent = "Iniciar Cola";
            startQueueBtn.disabled = routeQueue.length === 0;
        }
    }


    function handleGeolocationError(error) {
        console.error("Error de Geolocalización:", error);
        alert(`Error de Geolocalización: ${error.message}. El seguimiento puede no funcionar.`);
        // Podríamos detener el seguimiento si el error es persistente.
        // stopTrackingBtn.click();
    }

    function calculateAndDisplayDeviation(userLatLng) {
        if (!activeRouteForTracking || currentStopIndexInTracking >= activeRouteForTracking.stops.length - 1) {
            timeDeviationSpan.textContent = "00:00";
            timeDeviationSpan.className = "on-time";
            return;
        }

        const stopA = activeRouteForTracking.stops[currentStopIndexInTracking];
        const stopB = activeRouteForTracking.stops[currentStopIndexInTracking + 1];

        if (!stopA.scheduledTime || !stopB.scheduledTime) {
            timeDeviationSpan.textContent = "N/A (faltan horarios)";
            timeDeviationSpan.className = "on-time";
            return;
        }
        
        const timeA = stopA.scheduledTime.getTime();
        const timeB = stopB.scheduledTime.getTime();
        const totalSegmentScheduledDurationMs = timeB - timeA;

        if (totalSegmentScheduledDurationMs <= 0 && stopA !== stopB) { // Si A y B son la misma parada, no es un error.
            timeDeviationSpan.textContent = "Error (horarios segmento)";
            timeDeviationSpan.className = "on-time";
            return;
        }
        
        const coordsA = { lat: stopA.lat, lng: stopA.lng };
        const coordsB = { lat: stopB.lat, lng: stopB.lng };
        
        const totalSegmentDistanceKm = haversineDistance(coordsA, coordsB);
        // Distancia recorrida desde stopA hacia stopB (proyección sobre la línea A-B)
        // Esto es una simplificación. Una mejor aproximación sería la distancia a lo largo de la polilínea.
        // Para la lógica pedida, es "distancia recorrida" en el tramo.
        // La "posición relativa" como porcentaje se calcula mejor con la proyección.
        // Sin embargo, una forma más simple para este ejercicio es usar la distancia directa a A y a B.
        
        const distUserToA = haversineDistance(userLatLng, coordsA);
        const distUserToB = haversineDistance(userLatLng, coordsB);

        let percentageCovered;
        if (totalSegmentDistanceKm < 0.001) { // Si las paradas A y B están (casi) en el mismo lugar
            percentageCovered = 1.0; // Considerar el segmento como completado instantáneamente
        } else {
            // Proyección de la posición del usuario sobre el segmento AB
            // Para simplificar, usamos la proporción de distancias: distUserToA / (distUserToA + distUserToB)
            // Esto no es una proyección lineal perfecta, pero es una aproximación.
            // Una mejor aproximación para "distancia recorrida" sería:
            // Si el usuario está "entre" A y B, la distancia desde A.
            // Pero "entre" es difícil de definir sin un corredor.
            // Usemos la distancia desde A como "recorrido", pero capado por totalSegmentDistanceKm.
            // Esto asume que el conductor va más o menos en línea recta.
            
            // Lógica del ejemplo: "Si ya recorrió 5 km (50%)". Esto implica conocer la distancia recorrida EN EL TRAMO.
            // La distancia desde stopA es una aproximación.
            let distanceCoveredInSegmentKm = distUserToA; 
            
            // La posición relativa se puede estimar. Si está más cerca de B que de A, ya pasó la mitad.
            // Una forma de calcular el progreso en el segmento AB:
            // Si d(A,User) + d(User,B) es aprox d(A,B), el usuario está en la línea.
            // percentageCovered = d(A,User) / d(A,B)
            // Pero si el usuario se desvía, esto no funciona bien.
            // Para el "cálculo crítico":
            // 1. Distancia total (A-B) y tiempo total programado (A-B).
            // 2. Obtener distancia recorrida (desde A).
            // 3. Calcular posición relativa como porcentaje = (distancia recorrida / distancia total).
            // 4. Horario esperado = Hora Salida A + (porcentaje * tiempo total A-B).
            // 5. Comparar con hora actual.

            // Usaremos distUserToA como "distancia recorrida", pero puede ser mayor que totalSegmentDistanceKm si se pasó.
            distanceCoveredInSegmentKm = Math.min(distUserToA, totalSegmentDistanceKm);
             // Esto no es ideal. Si se desvió mucho, distUserToA no representa avance en el segmento.
             // Para una mejor aproximación del "progreso en el segmento", podríamos proyectar el punto del usuario
             // sobre la línea definida por A y B.
             // Por ahora, usemos una heurística más simple basada en la distancia restante a B:
            percentageCovered = (totalSegmentDistanceKm - distUserToB) / totalSegmentDistanceKm;
            percentageCovered = Math.max(0, Math.min(1, percentageCovered)); // Asegurar entre 0 y 1

        }

        const expectedTimeAtCurrentPositionMs = timeA + (percentageCovered * totalSegmentScheduledDurationMs);
        const currentTimeMs = new Date().getTime();
        const deviationMs = currentTimeMs - expectedTimeAtCurrentPositionMs; // Positivo = tarde, Negativo = temprano

        displayDeviation(deviationMs);
    }
    
    function displayDeviation(deviationMs) {
        const isLate = deviationMs > 0;
        const absDeviationMs = Math.abs(deviationMs);

        const minutes = Math.floor(absDeviationMs / (1000 * 60));
        const seconds = Math.floor((absDeviationMs % (1000 * 60)) / 1000);

        const sign = isLate ? "-" : "+"; // Si es tarde, muestra negativo (atrasado)
        if (minutes === 0 && seconds === 0) {
            timeDeviationSpan.textContent = "00:00";
            timeDeviationSpan.className = "on-time";
        } else {
            timeDeviationSpan.textContent = `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            if (isLate) { // Atrasado (deviationMs es positivo)
                timeDeviationSpan.className = "negative"; // Rojo
            } else { // Adelantado (deviationMs es negativo)
                timeDeviationSpan.className = "positive"; // Verde
            }
        }
    }

    // Avance de parada automático y manual
    const STOP_PROXIMITY_THRESHOLD_METERS = 50; // 50 metros para considerar parada alcanzada

    manualAdvanceCheckbox.addEventListener('change', (e) => {
        prevStopBtn.disabled = !e.target.checked;
        nextStopBtn.disabled = !e.target.checked;
        if (e.target.checked) {
            // Habilitar botones según el índice actual
            prevStopBtn.disabled = currentStopIndexInTracking <= 0;
            nextStopBtn.disabled = currentStopIndexInTracking >= activeRouteForTracking.stops.length - 1;
        }
    });

    prevStopBtn.addEventListener('click', () => {
        if (currentStopIndexInTracking > 0) {
            currentStopIndexInTracking--;
            updateNextStopUI();
            highlightNextStopOnMap();
            // Actualizar botones de avance manual
            prevStopBtn.disabled = currentStopIndexInTracking <= 0;
            nextStopBtn.disabled = false; // Si retrocedió, el siguiente siempre está habilitado
        }
    });

    nextStopBtn.addEventListener('click', () => {
        if (activeRouteForTracking && currentStopIndexInTracking < activeRouteForTracking.stops.length - 1) {
            currentStopIndexInTracking++;
            updateNextStopUI();
            highlightNextStopOnMap();
            // Actualizar botones de avance manual
            nextStopBtn.disabled = currentStopIndexInTracking >= activeRouteForTracking.stops.length - 1;
            prevStopBtn.disabled = false; // Si avanzó, el anterior siempre está habilitado

            if (currentStopIndexInTracking >= activeRouteForTracking.stops.length - 1) { // Llegó al final
                handleRouteCompletion();
            }
        }
    });
    
    function checkAutomaticStopAdvance(userLatLng) {
        if (!activeRouteForTracking || currentStopIndexInTracking >= activeRouteForTracking.stops.length - 1) {
            return; // No hay más paradas o ruta terminada
        }

        const nextScheduledStop = activeRouteForTracking.stops[currentStopIndexInTracking + 1];
        const distToNextScheduledStop = haversineDistance(userLatLng, { lat: nextScheduledStop.lat, lng: nextScheduledStop.lng }) * 1000; // en metros

        if (distToNextScheduledStop <= STOP_PROXIMITY_THRESHOLD_METERS) {
            // Alcanzó la siguiente parada programada
            currentStopIndexInTracking++;
            alert(`Llegando a: ${nextScheduledStop.name}`);
            updateNextStopUI();
            highlightNextStopOnMap();
            if (currentStopIndexInTracking >= activeRouteForTracking.stops.length - 1) {
                handleRouteCompletion();
            }
            return;
        }

        // Lógica para saltar paradas si el conductor se aleja de la actual/siguiente y se acerca más a una posterior
        let closestUpcomingStopIndex = -1;
        let minDistanceToUpcomingStop = Infinity;

        for (let i = currentStopIndexInTracking + 1; i < activeRouteForTracking.stops.length; i++) {
            const upcomingStop = activeRouteForTracking.stops[i];
            const distToUpcoming = haversineDistance(userLatLng, { lat: upcomingStop.lat, lng: upcomingStop.lng }) * 1000;
            
            if (distToUpcoming < minDistanceToUpcomingStop) {
                minDistanceToUpcomingStop = distToUpcoming;
                closestUpcomingStopIndex = i;
            }
        }
        
        // Si la parada más cercana entre las *siguientes* no es la inmediatamente siguiente,
        // y estamos lo suficientemente cerca de ella, considerar un salto.
        if (closestUpcomingStopIndex > currentStopIndexInTracking + 1 && minDistanceToUpcomingStop <= STOP_PROXIMITY_THRESHOLD_METERS * 1.5) { // Umbral un poco mayor para saltos
             const skippedStop = activeRouteForTracking.stops[currentStopIndexInTracking + 1];
             const newNextStop = activeRouteForTracking.stops[closestUpcomingStopIndex];
             alert(`Se saltó ${skippedStop.name}. Próxima parada detectada: ${newNextStop.name}`);
             currentStopIndexInTracking = closestUpcomingStopIndex -1; // El avance normal incrementará a closestUpcomingStopIndex
             // Disparar el avance para que actualice UI y todo
             currentStopIndexInTracking++; // Simula llegar a la parada anterior a la saltada
             updateNextStopUI(); // Actualiza para la parada que fue "saltada"
             highlightNextStopOnMap();
             // Esto es un poco forzado. Mejor:
             // currentStopIndexInTracking = closestUpcomingStopIndex;
             // updateNextStopUI();
             // highlightNextStopOnMap();
             // if (currentStopIndexInTracking >= activeRouteForTracking.stops.length - 1) {
             //    handleRouteCompletion();
             // }
             // return;
             // La lógica de arriba es más simple:
        }
        // Si el conductor está más cerca de una parada futura (que no sea la siguiente inmediata)
        // Y está "pasando" la siguiente parada actual (distUserToA > distAtoB)
        const currentTargetStop = activeRouteForTracking.stops[currentStopIndexInTracking + 1]; // La que se supone es la siguiente
        const distToCurrentTargetStop = haversineDistance(userLatLng, {lat: currentTargetStop.lat, lng: currentTargetStop.lng}) * 1000;

        // Encontrar la parada más cercana de TODAS las restantes
        let overallClosestFutureStopIndex = currentStopIndexInTracking + 1;
        let overallMinDistToFutureStop = distToCurrentTargetStop;

        for (let i = currentStopIndexInTracking + 2; i < activeRouteForTracking.stops.length; i++) {
            const futureStop = activeRouteForTracking.stops[i];
            const dist = haversineDistance(userLatLng, {lat: futureStop.lat, lng: futureStop.lng}) * 1000;
            if (dist < overallMinDistToFutureStop) {
                overallMinDistToFutureStop = dist;
                overallClosestFutureStopIndex = i;
            }
        }
        
        // Si la parada más cercana de las futuras no es la siguiente inmediata, y estamos cerca de ella
        if (overallClosestFutureStopIndex > currentStopIndexInTracking + 1 && overallMinDistToFutureStop < STOP_PROXIMITY_THRESHOLD_METERS * 2) { // Un umbral más grande para saltos
            const oldNextStop = activeRouteForTracking.stops[currentStopIndexInTracking + 1].name;
            currentStopIndexInTracking = overallClosestFutureStopIndex -1; // Se incrementará en el próximo ciclo o manualmente
            // Forzar el avance a la nueva parada detectada
             currentStopIndexInTracking++; // Esto es para que la lógica de "llegada" se active en el siguiente ciclo o al actualizar UI
            alert(`Parece que se omitió ${oldNextStop}. Nueva próxima parada: ${activeRouteForTracking.stops[currentStopIndexInTracking].name}`);
            updateNextStopUI();
            highlightNextStopOnMap();
            if (currentStopIndexInTracking >= activeRouteForTracking.stops.length - 1) {
                 handleRouteCompletion();
            }
        }
    }

    function updateNextStopUI() {
        unhighlightAllStops(); // Limpiar resaltado anterior
        if (activeRouteForTracking && currentStopIndexInTracking < activeRouteForTracking.stops.length) {
            let textNextStopName = "-";
            let textNextStopTime = "-";

            if (currentStopIndexInTracking < activeRouteForTracking.stops.length -1) { // Si no es la última parada
                const nextStop = activeRouteForTracking.stops[currentStopIndexInTracking + 1];
                textNextStopName = nextStop.name;
                textNextStopTime = nextStop.scheduledTime ? formatTime(nextStop.scheduledTime) : "N/A";
            } else { // Es la última parada, ya llegó o está por llegar
                 const finalStop = activeRouteForTracking.stops[currentStopIndexInTracking];
                 textNextStopName = `Destino final: ${finalStop.name}`;
                 textNextStopTime = finalStop.scheduledTime ? formatTime(finalStop.scheduledTime) : "N/A";
            }
            nextStopNameSpan.textContent = textNextStopName;
            nextStopTimeSpan.textContent = textNextStopTime;
        } else {
            nextStopNameSpan.textContent = "-";
            nextStopTimeSpan.textContent = "-";
        }
    }
    
    function highlightNextStopOnMap() {
        // Primero, quitar resaltado de todas las paradas en el mapa actual (las de currentRouteStops)
        currentRouteStops.forEach(stop => {
            if (stop.marker && stop.marker._icon) {
                 stop.marker._icon.style.border = 'none'; // Asumiendo que el ícono es un DivIcon
                 // Para L.Icon, tendrías que cambiar la clase o el icono completo.
            }
        });

        // Resaltar la próxima parada de activeRouteForTracking
        if (activeRouteForTracking && currentStopIndexInTracking < activeRouteForTracking.stops.length -1) {
            const nextStopToHighlight = activeRouteForTracking.stops[currentStopIndexInTracking + 1];
            // Encontrar el marcador correspondiente en currentRouteStops (si la ruta en seguimiento es la actual)
            // Esto es un poco complicado si se cargó una ruta diferente a la que está en edición.
            // Idealmente, al iniciar seguimiento, los marcadores en el mapa deberían ser los de activeRouteForTracking.
            // Por ahora, asumimos que los marcadores en `currentRouteStops` son los relevantes si coinciden en lat/lng.
            
            const markerToHighlight = currentRouteStops.find(
                s => s.lat === nextStopToHighlight.lat && s.lng === nextStopToHighlight.lng
            );

            if (markerToHighlight && markerToHighlight.marker && markerToHighlight.marker._icon) {
                markerToHighlight.marker._icon.style.border = '3px solid yellow';
                markerToHighlight.marker._icon.style.borderRadius = '50%'; // Asegurar que el borde sigue la forma
            }
        }
    }
    
    function unhighlightAllStops() {
         currentRouteStops.forEach(stop => {
            if (stop.marker && stop.marker._icon) {
                 stop.marker._icon.style.border = 'none';
            }
        });
    }


    // --- COLA DE RUTAS ---
    addToQueueBtn.addEventListener('click', () => {
        const routeName = routeToQueueSelect.value;
        if (!routeName) {
            alert("Seleccione una ruta para añadir a la cola.");
            return;
        }
        const routes = getSavedRoutes();
        const routeExists = routes.some(r => r.name === routeName);
        if (!routeExists) {
            alert("La ruta seleccionada ya no existe. Refresque la lista de rutas.");
            return;
        }

        routeQueue.push(routeName);
        updateQueuedRoutesUI();
        startQueueBtn.disabled = false;
    });

    clearQueueBtn.addEventListener('click', () => {
        routeQueue = [];
        updateQueuedRoutesUI();
        startQueueBtn.disabled = true;
        startQueueBtn.textContent = "Iniciar Cola";
        isQueueActive = false;
    });

    startQueueBtn.addEventListener('click', () => {
        if (routeQueue.length === 0) {
            alert("La cola está vacía. Añada rutas primero.");
            return;
        }

        if (isQueueActive) { // Si ya está activa, el botón sirve para detener
            isQueueActive = false;
            startQueueBtn.textContent = "Continuar Cola";
            // No detenemos el seguimiento actual, solo la progresión automática de la cola
            alert("La progresión automática de la cola ha sido pausada.");
        } else { // Iniciar o continuar la cola
            isQueueActive = true;
            startQueueBtn.textContent = "Pausar Cola";
            
            // Si no hay un seguimiento activo, iniciar el primero de la cola
            if (watchId === null || !activeRouteForTracking) {
                const nextRouteName = routeQueue.shift();
                updateQueuedRoutesUI();
                if (nextRouteName) {
                    loadRouteByName(nextRouteName, false); // Cargar para visualización y seguimiento
                    if (activeRouteForTracking) {
                        startTrackingBtn.click(); // Iniciar seguimiento
                        alert(`Iniciando cola con ruta: "${activeRouteForTracking.name}"`);
                    } else {
                        isQueueActive = false; // Falló la carga
                        startQueueBtn.textContent = "Iniciar Cola";
                    }
                } else { // No debería pasar si el botón estaba habilitado
                    isQueueActive = false;
                    startQueueBtn.textContent = "Iniciar Cola";
                }
            } else {
                 alert("Cola activada. La siguiente ruta comenzará al finalizar la actual.");
            }
        }
    });
    
    function updateQueuedRoutesUI() {
        queuedRoutesListUI.innerHTML = '';
        routeQueue.forEach((routeName, index) => {
            const li = document.createElement('li');
            li.textContent = `${index + 1}. ${routeName}`;
            queuedRoutesListUI.appendChild(li);
        });
        startQueueBtn.disabled = routeQueue.length === 0 && !isQueueActive;
    }


    // --- UTILIDADES ---
    function parseTimeString(timeStr) { // HH:MM
        if (!timeStr) return null;
        const [hours, minutes] = timeStr.split(':').map(Number);
        const date = new Date();
        date.setHours(hours, minutes, 0, 0); // Hoy, con esa hora
        return date;
    }

    function formatTime(dateObj) {
        if (!(dateObj instanceof Date) || isNaN(dateObj)) return "N/A";
        return `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
    }

    function haversineDistance(coords1, coords2) { // devuelve km
        function toRad(x) {
            return x * Math.PI / 180;
        }
        const R = 6371; // km
        const dLat = toRad(coords2.lat - coords1.lat);
        const dLon = toRad(coords2.lng - coords1.lng);
        const lat1 = toRad(coords1.lat);
        const lat2 = toRad(coords2.lat);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // --- INICIALIZACIÓN GENERAL ---
    initMap();
    populateSavedRoutesSelect();
    updateStopCreationButtonsState(); // Estado inicial de botones
    updateSaveRouteButtonState();
});
