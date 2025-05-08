document.addEventListener('DOMContentLoaded', () => {
    const routeSelect = document.getElementById('route-select');
    const stopSelect = document.getElementById('stop-select');
    const arrivalTimeDisplay = document.getElementById('arrival-time-display');
    const busStatusNote = document.getElementById('bus-status-note'); // Lo mantenemos para debug o info interna
    const lastDataUpdateDisplay = document.getElementById('last-data-update');

    let allRoutesDataFromStorage = [];
    let passengerUpdateInterval;
    let currentDisplayedRouteName = null;

    function getTrackingStatus() {
        const trackingStatusJSON = localStorage.getItem('smartMoveProTrackingStatus');
        if (trackingStatusJSON) {
            try { return JSON.parse(trackingStatusJSON); }
            catch (e) { console.error("CuandoLlega: Error parsing trackingStatus", e); return null; }
        }
        return null;
    }

    function loadAllRoutesDefinitionsFromStorage() {
        const routesJSON = localStorage.getItem('smartMoveProRoutes');
        if (routesJSON) {
            try { allRoutesDataFromStorage = JSON.parse(routesJSON); return true; }
            catch (e) { console.error("CuandoLlega: Error parsing allRoutesData", e); allRoutesDataFromStorage = []; return false; }
        }
        allRoutesDataFromStorage = []; return false;
    }

    function populateRouteSelect() { // Sin sufijos de estado
        if (!loadAllRoutesDefinitionsFromStorage()) {
            arrivalTimeDisplay.textContent = "No hay rutas disponibles.";
            return;
        }
        const trackingStatus = getTrackingStatus();
        const previousRouteValue = routeSelect.value;
        routeSelect.innerHTML = '<option value="">-- Elige una ruta --</option>';
        let availableRouteNames = new Set();

        // Añadir rutas de la cola primero (si existe y está online)
        if (trackingStatus && trackingStatus.isTracking && trackingStatus.trackingQueueNames) {
            trackingStatus.trackingQueueNames.forEach(routeName => {
                if (!availableRouteNames.has(routeName)) {
                    const option = document.createElement('option');
                    option.value = routeName;
                    option.textContent = routeName; // Sin sufijo
                    routeSelect.appendChild(option);
                    availableRouteNames.add(routeName);
                }
            });
        }

        // Añadir el resto de las rutas definidas
        allRoutesDataFromStorage.forEach((routeDef) => {
            if (routeDef.name && routeDef.startPoint && routeDef.endPoint && !availableRouteNames.has(routeDef.name)) {
                const option = document.createElement('option');
                option.value = routeDef.name;
                option.textContent = routeDef.name; // Sin sufijo
                routeSelect.appendChild(option);
                availableRouteNames.add(routeDef.name);
            }
        });

        if (previousRouteValue && availableRouteNames.has(previousRouteValue)) {
            routeSelect.value = previousRouteValue;
        } else {
            routeSelect.value = "";
        }
    }

    function populateStopSelect(selectedRouteName) {
        stopSelect.innerHTML = '<option value="">-- Elige una parada --</option>';
        stopSelect.disabled = true;
        currentDisplayedRouteName = selectedRouteName;

        if (!selectedRouteName) return;

        const trackingStatus = getTrackingStatus();
        let stopsToDisplayForSelect = [];
        let sourceIsTrackingData = false;

        // Priorizar datos de la ruta activa si es la seleccionada
        if (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName && trackingStatus.routeStops) {
            stopsToDisplayForSelect = trackingStatus.routeStops;
            sourceIsTrackingData = true;
        } else { // Para rutas en cola o modo offline, usar las definiciones de ruta
            const routeDefinition = allRoutesDataFromStorage.find(r => r.name === selectedRouteName);
            if (routeDefinition) {
                if (routeDefinition.startPoint) stopsToDisplayForSelect.push(routeDefinition.startPoint);
                stopsToDisplayForSelect = stopsToDisplayForSelect.concat(routeDefinition.intermediateStops || []);
                if (routeDefinition.endPoint) stopsToDisplayForSelect.push(routeDefinition.endPoint);
            }
        }

        if (stopsToDisplayForSelect.length > 0) {
            stopsToDisplayForSelect.forEach((stop, index) => {
                const option = document.createElement('option');
                option.value = index;
                let displayName = stop.name || `Parada ${index + 1}`;
                if (stop.type === 'start') displayName = `${stop.name || 'Inicio'} (Inicio)`;
                else if (stop.type === 'end') displayName = `${stop.name || 'Fin'} (Fin)`;
                else if (stop.type === 'intermediate' && !stop.name) {
                    let intermediateCount = 0;
                    for(let i=0; i<=index; i++){ if(stopsToDisplayForSelect[i].type === 'intermediate') intermediateCount++; }
                    displayName = `Parada Intermedia ${intermediateCount}`;
                }
                option.textContent = displayName;
                stopSelect.appendChild(option);
                // Guardar si la fuente fue tracking para referencia en el intervalo
                stopSelect.dataset.source = sourceIsTrackingData ? 'tracking' : 'definition';
            });
            stopSelect.disabled = false;
        } else {
            console.warn(`CuandoLlega: No se encontraron paradas para la ruta ${selectedRouteName}`);
        }
    }


    routeSelect.addEventListener('change', () => {
        const selectedRouteName = routeSelect.value;
        const previousStopValue = stopSelect.value;
        populateStopSelect(selectedRouteName);
        // Intentar restaurar parada
        if (previousStopValue && Array.from(stopSelect.options).some(opt => opt.value === previousStopValue)) {
            stopSelect.value = previousStopValue;
        } else {
            stopSelect.value = "";
        }
        updateArrivalTime();
    });

    stopSelect.addEventListener('change', () => {
        updateArrivalTime();
    });

    function timeStringToDateTime(timeString, referenceDate = new Date()) {
         if (!timeString || !timeString.includes(':')) return null;
         const [hours, minutes] = timeString.split(':').map(Number);
         const date = new Date(referenceDate); date.setHours(hours, minutes, 0, 0); return date;
    }

    function getLegDurationMillis(fromStop, toStop) {
        const legDepartureDate = timeStringToDateTime(fromStop.departureTime);
        const legArrivalDate = timeStringToDateTime(toStop.arrivalTime);
        if (!legDepartureDate || !legArrivalDate) return null;
        let tempLegArrivalDate = new Date(legArrivalDate);
        if (tempLegArrivalDate.getTime() < legDepartureDate.getTime()) {
            tempLegArrivalDate.setDate(tempLegArrivalDate.getDate() + 1);
        }
        return tempLegArrivalDate.getTime() - legDepartureDate.getTime();
    }

    function formatRemainingTime(milliseconds) {
        if (milliseconds === Infinity || isNaN(milliseconds)) return "Calculando..."; // Caso para tiempos inválidos
        if (milliseconds < 0) milliseconds = 0;
        const totalSeconds = Math.round(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);

        if (minutes === 0 && totalSeconds > 0 && totalSeconds < 60) return "ARRIBANDO";
        if (minutes < 1 && totalSeconds <= 0) return "ARRIBANDO"; // Considerar 0 como ARRIBANDO
        return `${minutes} min.`;
    }

    function updateArrivalTime() {
        const selectedRouteNameByPassenger = routeSelect.value;
        const selectedStopOptionIndex = stopSelect.value;

        // Limpiar estado inicial o si no hay selección
        if (selectedRouteNameByPassenger === "" || selectedStopOptionIndex === "") {
            arrivalTimeDisplay.textContent = "Selecciona ruta y parada";
            busStatusNote.textContent = ""; // Limpiar nota interna
            lastDataUpdateDisplay.textContent = 'N/A';
            return;
        }

        const passengerSelectedStopListIndex = parseInt(selectedStopOptionIndex);
        const trackingStatus = getTrackingStatus();
        const currentTimeMillis = new Date().getTime();

        // Actualizar hora de última actualización de datos del chofer
        if (trackingStatus && trackingStatus.lastUpdateTime) {
            lastDataUpdateDisplay.textContent = new Date(trackingStatus.lastUpdateTime).toLocaleTimeString();
             // Considerar datos viejos como offline
            if (currentTimeMillis - trackingStatus.lastUpdateTime > 60000) { // Más de 1 minuto sin actualizar
                busStatusNote.textContent = "Datos del chofer desactualizados. ";
                // Forzar modo offline si los datos son muy viejos
                 // trackingStatus = null; // Descomentar si se quiere forzar offline
            }
        } else {
            lastDataUpdateDisplay.textContent = 'N/A';
        }

        // Determinar modo
        let mode = "offline_or_error";
        let indexOfSelectedRouteInQueue = -1;

        if (trackingStatus && !trackingStatus.hasError) {
            if (trackingStatus.isTracking) {
                if (trackingStatus.routeName === selectedRouteNameByPassenger) {
                    mode = "active_route";
                } else if (trackingStatus.trackingQueueNames && trackingStatus.trackingQueueNames.includes(selectedRouteNameByPassenger)) {
                    indexOfSelectedRouteInQueue = trackingStatus.trackingQueueNames.indexOf(selectedRouteNameByPassenger);
                    if (indexOfSelectedRouteInQueue > trackingStatus.currentRouteIndexInQueue) {
                        mode = "queued_route";
                    } else {
                        mode = "offline_or_error"; // Ruta en cola ya pasada o la activa (que ya se manejó)
                    }
                } else {
                     mode = "offline_or_error"; // En línea pero en una ruta totalmente diferente
                }
            } else {
                mode = "offline_or_error"; // Chofer envió estado "no tracking"
            }
        } else if (trackingStatus && trackingStatus.hasError) {
             mode = "offline_or_error"; // Chofer reportó un error
             busStatusNote.textContent = `Error del chofer: ${trackingStatus.errorReason || 'Desconocido'}`;
        }
        // Si trackingStatus es null, mode se queda como "offline_or_error"

        // --- MODO OFFLINE / ERROR ---
        if (mode === "offline_or_error") {
            arrivalTimeDisplay.textContent = "Sin Servicio"; // Mensaje consistente
            // Añadir nota interna si se desea
            if (!trackingStatus || !trackingStatus.isTracking) {
                 busStatusNote.textContent += "Chofer fuera de línea o sin datos.";
            } else if (trackingStatus.hasError){
                 busStatusNote.textContent += " Error reportado por chofer.";
            } else {
                 busStatusNote.textContent += ` Chofer en ruta "${trackingStatus?.routeName}".`;
            }
            return;
        }


        // --- MODO RUTA ACTIVA DEL CHOFER ---
        if (mode === "active_route") {
            busStatusNote.textContent = `Modo: Ruta activa (${selectedRouteNameByPassenger})`; // Nota interna
            if (!trackingStatus.routeStops || trackingStatus.routeStops.length === 0) {
                arrivalTimeDisplay.textContent = "Error Ruta"; return;
            }
            const busRouteStops = trackingStatus.routeStops;
            const passengerSelectedStopDataOnline = busRouteStops[passengerSelectedStopListIndex];
            if (!passengerSelectedStopDataOnline) { arrivalTimeDisplay.textContent = "Error Parada"; return; }

            const busCurrentStopIndexFrom = trackingStatus.currentStopIndexFromWhichDeparted;
            let busDelayOrAheadMillis = trackingStatus.currentBusDelayOrAheadMillis;
            const choferEnPuntoDeInicioAunSinSalir = (busCurrentStopIndexFrom === -1);

            // *** NUEVO CHEQUEO: BUS YA PASÓ ***
            // Si el índice de la parada "desde la que salió" el bus es >= al índice de la parada seleccionada, ya pasó.
            if (busCurrentStopIndexFrom >= passengerSelectedStopListIndex) {
                 arrivalTimeDisplay.textContent = "Bus ya pasó";
                 busStatusNote.textContent += " - Bus ya pasó esta parada.";
                 return;
            }


            if (choferEnPuntoDeInicioAunSinSalir && busDelayOrAheadMillis > 0) {
                busDelayOrAheadMillis = 0;
            }

            let estimatedTotalMillisToPassengerStop = 0;
            const scheduledTimeAtBusCurrentPosition = currentTimeMillis + busDelayOrAheadMillis;

            if (choferEnPuntoDeInicioAunSinSalir) {
                const startPointDepartureTimeStr = busRouteStops[0].departureTime;
                const scheduledDepartureFromStartPointDate = timeStringToDateTime(startPointDepartureTimeStr);
                if (!scheduledDepartureFromStartPointDate) { arrivalTimeDisplay.textContent = "Error Hor."; return; }
                
                let timeUntilTrueDeparture = Math.max(0, scheduledDepartureFromStartPointDate.getTime() - currentTimeMillis);
                estimatedTotalMillisToPassengerStop = timeUntilTrueDeparture;

                if (passengerSelectedStopListIndex > 0) {
                    for (let i = 0; i < passengerSelectedStopListIndex; i++) {
                         const legDuration = getLegDurationMillis(busRouteStops[i], busRouteStops[i + 1]);
                         if (legDuration === null) { estimatedTotalMillisToPassengerStop = Infinity; break; }
                         estimatedTotalMillisToPassengerStop += legDuration;
                    }
                }
            } else { // Chofer en movimiento
                const busNextStopIndexTo = trackingStatus.nextStopIndexTowardsWhichHeading;
                if (busNextStopIndexTo >= busRouteStops.length || busNextStopIndexTo < 0) {
                    arrivalTimeDisplay.textContent = "Error Datos"; return;
                }
                let arrivalTimeAtBusNextStopForCalc = timeStringToDateTime(busRouteStops[busNextStopIndexTo].arrivalTime);
                if (!arrivalTimeAtBusNextStopForCalc) { arrivalTimeDisplay.textContent = "Error Hor."; return; }
                
                let tempDateForNextStop = new Date(scheduledTimeAtBusCurrentPosition);
                const [arrH, arrM] = busRouteStops[busNextStopIndexTo].arrivalTime.split(':').map(Number);
                tempDateForNextStop.setHours(arrH, arrM, 0, 0);
                if (tempDateForNextStop.getTime() < scheduledTimeAtBusCurrentPosition && (scheduledTimeAtBusCurrentPosition - tempDateForNextStop.getTime() > 12 * 3600000 )) {
                     tempDateForNextStop.setDate(tempDateForNextStop.getDate() + 1);
                }
                arrivalTimeAtBusNextStopForCalc = tempDateForNextStop;

                let timeToBusImmediateNextStopMillis = arrivalTimeAtBusNextStopForCalc.getTime() - scheduledTimeAtBusCurrentPosition;
                if (timeToBusImmediateNextStopMillis < 0) timeToBusImmediateNextStopMillis = 0;
                
                estimatedTotalMillisToPassengerStop = timeToBusImmediateNextStopMillis;
                
                for (let i = busNextStopIndexTo; i < passengerSelectedStopListIndex; i++) {
                    const legDuration = getLegDurationMillis(busRouteStops[i], busRouteStops[i + 1]);
                    if (legDuration === null) { estimatedTotalMillisToPassengerStop = Infinity; break; }
                    estimatedTotalMillisToPassengerStop += legDuration;
                }
            }
            arrivalTimeDisplay.textContent = formatRemainingTime(estimatedTotalMillisToPassengerStop);
            return;
        }

        // --- MODO RUTA EN COLA ---
        if (mode === "queued_route") {
            busStatusNote.textContent = `Modo: Ruta en cola (${selectedRouteNameByPassenger})`; // Nota interna

            // 1. Calcular tiempo restante para que el chofer termine SU RUTA ACTIVA
            const activeRouteStops = trackingStatus.routeStops;
            if (!activeRouteStops || activeRouteStops.length === 0) { arrivalTimeDisplay.textContent = "Error Activa"; return; }
            
            let timeToFinishActiveRouteMillis = 0;
            const activeRouteLastStopIndex = activeRouteStops.length - 1;
            const busCurrentStopFromIdxActive = trackingStatus.currentStopIndexFromWhichDeparted;
            let busDelayOrAheadActiveRoute = trackingStatus.currentBusDelayOrAheadMillis;
            const choferEnInicioRutaActiva = (busCurrentStopFromIdxActive === -1);

            if (choferEnInicioRutaActiva && busDelayOrAheadActiveRoute > 0) {
                busDelayOrAheadActiveRoute = 0;
            }
            const scheduledTimeAtBusCurrentPosActive = currentTimeMillis + busDelayOrAheadActiveRoute;

            if (choferEnInicioRutaActiva) {
                const startPointDepartureActive = timeStringToDateTime(activeRouteStops[0].departureTime);
                if (!startPointDepartureActive) { arrivalTimeDisplay.textContent = "Error H.Act"; return; }
                timeToFinishActiveRouteMillis = Math.max(0, startPointDepartureActive.getTime() - currentTimeMillis);
                for (let i = 0; i < activeRouteLastStopIndex; i++) {
                    const legDur = getLegDurationMillis(activeRouteStops[i], activeRouteStops[i+1]);
                    if(legDur === null) { timeToFinishActiveRouteMillis = Infinity; break; }
                    timeToFinishActiveRouteMillis += legDur;
                }
            } else { // Chofer en movimiento en ruta activa
                const busNextStopToIdxActive = trackingStatus.nextStopIndexTowardsWhichHeading;
                 if (busNextStopToIdxActive > activeRouteLastStopIndex || busNextStopToIdxActive < 0) { arrivalTimeDisplay.textContent = "Error D.Act"; return;} // Mayor estricto, si es igual es la última parada

                let arrivalAtNextInActive = timeStringToDateTime(activeRouteStops[busNextStopToIdxActive].arrivalTime);
                 if(!arrivalAtNextInActive) { arrivalTimeDisplay.textContent = "Error H.Act"; return;}
                
                let tempDateForNextStopActive = new Date(scheduledTimeAtBusCurrentPosActive);
                const [arrH, arrM] = activeRouteStops[busNextStopToIdxActive].arrivalTime.split(':').map(Number);
                tempDateForNextStopActive.setHours(arrH, arrM, 0, 0);
                if (tempDateForNextStopActive.getTime() < scheduledTimeAtBusCurrentPosActive && (scheduledTimeAtBusCurrentPosActive - tempDateForNextStopActive.getTime() > 12*3600000)) {
                    tempDateForNextStopActive.setDate(tempDateForNextStopActive.getDate() + 1);
                }
                 arrivalAtNextInActive = tempDateForNextStopActive;

                let timePendingCurrentLegActive = arrivalAtNextInActive.getTime() - scheduledTimeAtBusCurrentPosActive;
                if (timePendingCurrentLegActive < 0) timePendingCurrentLegActive = 0;
                timeToFinishActiveRouteMillis = timePendingCurrentLegActive;

                for (let i = busNextStopToIdxActive; i < activeRouteLastStopIndex; i++) {
                    const legDur = getLegDurationMillis(activeRouteStops[i], activeRouteStops[i+1]);
                    if(legDur === null) { timeToFinishActiveRouteMillis = Infinity; break; }
                    timeToFinishActiveRouteMillis += legDur;
                }
            }

            if (timeToFinishActiveRouteMillis === Infinity) { arrivalTimeDisplay.textContent = "Calculando..."; return; }


            // 2. Obtener la definición de la ruta en cola seleccionada por el pasajero
            const selectedQueuedRouteDefinition = allRoutesDataFromStorage.find(r => r.name === selectedRouteNameByPassenger);
            if (!selectedQueuedRouteDefinition || !selectedQueuedRouteDefinition.startPoint || !selectedQueuedRouteDefinition.endPoint) {
                arrivalTimeDisplay.textContent = "Error R.Cola"; return;
            }

            // 3. Calcular tiempo desde el inicio de la ruta en cola hasta la parada del pasajero
            let timeWithinQueuedRouteMillis = 0;
            let stopsOfQueuedRoute = [];
            if (selectedQueuedRouteDefinition.startPoint) stopsOfQueuedRoute.push(selectedQueuedRouteDefinition.startPoint);
            stopsOfQueuedRoute = stopsOfQueuedRoute.concat(selectedQueuedRouteDefinition.intermediateStops || []);
            if (selectedQueuedRouteDefinition.endPoint) stopsOfQueuedRoute.push(selectedQueuedRouteDefinition.endPoint);
            
            const passengerTargetStopInQueued = stopsOfQueuedRoute[passengerSelectedStopListIndex]; // El índice es correcto aquí
            if (!passengerTargetStopInQueued) { arrivalTimeDisplay.textContent = "Error P.Cola"; return;}

            for (let i = 0; i < passengerSelectedStopListIndex; i++) {
                const legDur = getLegDurationMillis(stopsOfQueuedRoute[i], stopsOfQueuedRoute[i+1]);
                 if(legDur === null) { timeWithinQueuedRouteMillis = Infinity; break; }
                timeWithinQueuedRouteMillis += legDur;
            }
             if (timeWithinQueuedRouteMillis === Infinity) { arrivalTimeDisplay.textContent = "Calculando..."; return; }

            // 4. Considerar el "gap"
            const estimatedArrivalAtEndOfActiveRouteMillis = currentTimeMillis + timeToFinishActiveRouteMillis;
            const scheduledStartOfQueuedRouteDate = timeStringToDateTime(selectedQueuedRouteDefinition.startPoint.departureTime);
            if(!scheduledStartOfQueuedRouteDate) { arrivalTimeDisplay.textContent = "Error H.Cola"; return; }

            let totalProjectedTimeMillis;
            if (estimatedArrivalAtEndOfActiveRouteMillis <= scheduledStartOfQueuedRouteDate.getTime()) {
                // Esperará. Tiempo = (Tiempo hasta inicio prog. cola) + (Tiempo dentro de cola)
                totalProjectedTimeMillis = (scheduledStartOfQueuedRouteDate.getTime() - currentTimeMillis) + timeWithinQueuedRouteMillis;
            } else {
                // Empezará tarde. Tiempo = (Tiempo hasta fin ruta activa) + (Tiempo dentro de cola)
                totalProjectedTimeMillis = timeToFinishActiveRouteMillis + timeWithinQueuedRouteMillis;
            }
            
            arrivalTimeDisplay.textContent = formatRemainingTime(totalProjectedTimeMillis);
            return;
        }
    }

    // --- INICIALIZACIÓN Y ACTUALIZACIÓN PERIÓDICA ---
    populateRouteSelect();
    updateArrivalTime();

    if (passengerUpdateInterval) clearInterval(passengerUpdateInterval);
    passengerUpdateInterval = setInterval(() => {
        const previousRouteValue = routeSelect.value;
        const previousStopValue = stopSelect.value;
        
        populateRouteSelect(); // Actualizar lista de rutas (por si cambian estados)
        
        // Restaurar selección de ruta si aún existe
        if (Array.from(routeSelect.options).some(opt => opt.value === previousRouteValue)) {
            routeSelect.value = previousRouteValue;
        } else {
            routeSelect.value = ""; // Deseleccionar si ya no está
        }

        const selectedRouteName = routeSelect.value;

        // Repoblar paradas si la ruta seleccionada cambió, o si el estado tracking cambió de fuente
        const trackingStatus = getTrackingStatus();
        const isNowOnlineForThisRoute = (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName);
        const dataSourceChanged = (stopSelect.dataset.source === 'tracking') !== isNowOnlineForThisRoute;

        if (currentDisplayedRouteName !== selectedRouteName || dataSourceChanged) {
            populateStopSelect(selectedRouteName);
            // Intentar restaurar selección de parada si aún existe
            if (previousStopValue && Array.from(stopSelect.options).some(opt => opt.value === previousStopValue)) {
                stopSelect.value = previousStopValue;
            } else {
                stopSelect.value = "";
            }
        } else {
             // Si la ruta no cambió y la fuente de datos tampoco, no repoblar paradas,
             // solo intentar mantener la selección.
             if (previousStopValue && Array.from(stopSelect.options).some(opt => opt.value === previousStopValue)) {
                stopSelect.value = previousStopValue;
            } else {
                 stopSelect.value = "";
            }
        }

        updateArrivalTime();
    }, 7000); 
});
