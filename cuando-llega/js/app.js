document.addEventListener('DOMContentLoaded', () => {
    const routeSelect = document.getElementById('route-select');
    const stopSelect = document.getElementById('stop-select');
    const arrivalTimeDisplay = document.getElementById('arrival-time-display');
    const busStatusNote = document.getElementById('bus-status-note');
    const lastDataUpdateDisplay = document.getElementById('last-data-update');

    let allRoutesDataFromStorage = []; // Estructura de edición del chofer
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

    function populateRouteSelect() {
        if (!loadAllRoutesDefinitionsFromStorage()) {
            arrivalTimeDisplay.textContent = "No hay rutas de chofer disponibles.";
            return;
        }
        const trackingStatus = getTrackingStatus();
        const previousRouteValue = routeSelect.value; // Guardar selección actual
        routeSelect.innerHTML = '<option value="">-- Elige una ruta --</option>';
        let availableRouteNames = new Set();

        if (trackingStatus && trackingStatus.isTracking && trackingStatus.trackingQueueNames) {
            trackingStatus.trackingQueueNames.forEach((routeName, index) => {
                if (!availableRouteNames.has(routeName)) {
                    const option = document.createElement('option');
                    option.value = routeName;
                    let suffix = " (En Cola)";
                    if (index === trackingStatus.currentRouteIndexInQueue) {
                        suffix = " (En Curso)";
                    }
                    option.textContent = routeName + suffix;
                    routeSelect.appendChild(option);
                    availableRouteNames.add(routeName);
                }
            });
        }

        allRoutesDataFromStorage.forEach((routeDef) => {
            if (routeDef.name && routeDef.startPoint && routeDef.endPoint && !availableRouteNames.has(routeDef.name)) {
                const option = document.createElement('option');
                option.value = routeDef.name;
                option.textContent = routeDef.name + " (Programada)";
                routeSelect.appendChild(option);
                availableRouteNames.add(routeDef.name);
            }
        });
        
        if (previousRouteValue && availableRouteNames.has(previousRouteValue)) {
            routeSelect.value = previousRouteValue;
        } else {
            routeSelect.value = ""; // Si la ruta previa ya no está o no había, deseleccionar
        }
    }

    function populateStopSelect(selectedRouteName) {
        stopSelect.innerHTML = '<option value="">-- Elige una parada --</option>';
        stopSelect.disabled = true;
        currentDisplayedRouteName = selectedRouteName;
        
        if (!selectedRouteName) return;

        const trackingStatus = getTrackingStatus();
        let stopsToDisplayForSelect = [];

        // Priorizar datos de la ruta activa si es la seleccionada
        if (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName && trackingStatus.routeStops) {
            stopsToDisplayForSelect = trackingStatus.routeStops;
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
            });
            stopSelect.disabled = false;
        }
    }

    routeSelect.addEventListener('change', () => {
        const selectedRouteName = routeSelect.value;
        const previousStopValue = stopSelect.value;
        populateStopSelect(selectedRouteName);
        // Intentar restaurar selección de parada si la opción todavía existe
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
        const date = new Date(referenceDate);
        date.setHours(hours, minutes, 0, 0);
        return date;
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


    function formatRemainingTime(milliseconds) { /* ... (sin cambios) ... */
        if (milliseconds < 0) milliseconds = 0; const totalSeconds = Math.round(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        if (minutes === 0 && totalSeconds > 0 && totalSeconds < 60) return "ARRIBANDO";
        if (minutes < 1 && totalSeconds <= 0) return "ARRIBANDO";
        return `${minutes} min.`;
    }

    function updateArrivalTime() {
        const selectedRouteNameByPassenger = routeSelect.value;
        const selectedStopOptionIndex = stopSelect.value;

        if (selectedRouteNameByPassenger === "" || selectedStopOptionIndex === "") {
            arrivalTimeDisplay.textContent = "Selecciona una ruta y parada.";
            busStatusNote.textContent = "";
            return;
        }
        
        const passengerSelectedStopListIndex = parseInt(selectedStopOptionIndex);
        const trackingStatus = getTrackingStatus();
        const currentTimeMillis = new Date().getTime();

        if (trackingStatus && trackingStatus.lastUpdateTime) {
            lastDataUpdateDisplay.textContent = new Date(trackingStatus.lastUpdateTime).toLocaleTimeString();
        } else {
            lastDataUpdateDisplay.textContent = 'Desconocida';
        }
        
        // Determinar si la ruta seleccionada es la activa, una en cola, o solo programada
        let mode = "offline_or_other_route"; // Default
        let indexOfSelectedRouteInQueue = -1;

        if (trackingStatus && trackingStatus.isTracking) {
            if (trackingStatus.routeName === selectedRouteNameByPassenger) {
                mode = "active_route";
            } else if (trackingStatus.trackingQueueNames && trackingStatus.trackingQueueNames.includes(selectedRouteNameByPassenger)) {
                indexOfSelectedRouteInQueue = trackingStatus.trackingQueueNames.indexOf(selectedRouteNameByPassenger);
                if (indexOfSelectedRouteInQueue > trackingStatus.currentRouteIndexInQueue) {
                    mode = "queued_route";
                }
                // Si es una ruta en cola ANTERIOR a la activa, se trata como "otra ruta" (ya pasó o error)
            }
        }


        // --- MODO OFFLINE / OTRA RUTA / ERROR DEL CHOFER ---
        if (mode === "offline_or_other_route" || (trackingStatus && trackingStatus.hasError)) {
            busStatusNote.textContent = "";
            if (trackingStatus?.hasError) busStatusNote.textContent += `Error en datos del chofer: ${trackingStatus.errorReason || ''}. `;
            
            if (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName !== selectedRouteNameByPassenger) {
                 busStatusNote.textContent += `El chofer está en ruta "${trackingStatus.routeName}". `;
            } else if (!trackingStatus || !trackingStatus.isTracking) {
                busStatusNote.textContent += "El chofer está fuera de línea. ";
            }
            busStatusNote.textContent += "Se muestra horario programado.";
            
            const routeDefinition = allRoutesDataFromStorage.find(r => r.name === selectedRouteNameByPassenger);
            if (routeDefinition) {
                let stopsForOffline = [];
                if (routeDefinition.startPoint) stopsForOffline.push(routeDefinition.startPoint);
                stopsForOffline = stopsForOffline.concat(routeDefinition.intermediateStops || []);
                if (routeDefinition.endPoint) stopsForOffline.push(routeDefinition.endPoint);

                const passengerSelectedStopData = stopsForOffline[passengerSelectedStopListIndex];
                if (passengerSelectedStopData) {
                    const timeToShow = (passengerSelectedStopData.type === 'start') ? 
                                       passengerSelectedStopData.departureTime : 
                                       passengerSelectedStopData.arrivalTime;
                    arrivalTimeDisplay.textContent = `${timeToShow || '--:--'} (hor prog.)`;
                } else { arrivalTimeDisplay.textContent = "Error datos parada (offline)"; }
            } else { arrivalTimeDisplay.textContent = "Ruta no encontrada (offline)"; }
            return;
        }

        // --- MODO RUTA ACTIVA DEL CHOFER ---
        if (mode === "active_route") {
            busStatusNote.textContent = "El chofer está en línea en esta ruta.";
            if (!trackingStatus.routeStops || trackingStatus.routeStops.length === 0) {
                arrivalTimeDisplay.textContent = "Error: Ruta activa sin paradas."; return;
            }
            const busRouteStops = trackingStatus.routeStops;
            const passengerSelectedStopDataOnline = busRouteStops[passengerSelectedStopListIndex];
            if (!passengerSelectedStopDataOnline) { arrivalTimeDisplay.textContent = "Error: Parada no encontrada."; return; }

            const busCurrentStopIndexFrom = trackingStatus.currentStopIndexFromWhichDeparted;
            let busDelayOrAheadMillis = trackingStatus.currentBusDelayOrAheadMillis;
            const choferEnPuntoDeInicioAunSinSalir = (busCurrentStopIndexFrom === -1);

            if (choferEnPuntoDeInicioAunSinSalir && busDelayOrAheadMillis > 0) {
                busDelayOrAheadMillis = 0;
                busStatusNote.textContent = "El chofer está en el punto de inicio (a tiempo o esperando).";
            }

            if (passengerSelectedStopListIndex <= busCurrentStopIndexFrom) {
                arrivalTimeDisplay.textContent = "Bus ya pasó"; return;
            }

            let estimatedTotalMillisToPassengerStop = 0;
            const scheduledTimeAtBusCurrentPosition = currentTimeMillis + busDelayOrAheadMillis;

            if (choferEnPuntoDeInicioAunSinSalir) {
                const startPointDepartureTimeStr = busRouteStops[0].departureTime;
                const scheduledDepartureFromStartPointDate = timeStringToDateTime(startPointDepartureTimeStr);
                if (!scheduledDepartureFromStartPointDate) { arrivalTimeDisplay.textContent = "Error Horario Inicio"; return; }
                
                let timeUntilTrueDeparture = Math.max(0, scheduledDepartureFromStartPointDate.getTime() - currentTimeMillis);
                estimatedTotalMillisToPassengerStop = timeUntilTrueDeparture;

                if (passengerSelectedStopListIndex > 0) { // Si no es la primera parada
                    for (let i = 0; i < passengerSelectedStopListIndex; i++) {
                         const legDuration = getLegDurationMillis(busRouteStops[i], busRouteStops[i + 1]);
                         if (legDuration === null) { console.warn("Horario inválido tramo (inicio)"); estimatedTotalMillisToPassengerStop += 180000; continue; } // Añadir 3 min
                         estimatedTotalMillisToPassengerStop += legDuration;
                    }
                     // La 'timeUntilTrueDeparture' ya cuenta hasta la SALIDA de la parada 0.
                    // Si el pasajero va a la parada 0, solo es 'timeUntilTrueDeparture'.
                    // Si va a la parada 1, es 'timeUntilTrueDeparture' + duración(0->1).
                    // El bucle anterior sumó todas las duraciones. Si el pasajero va a la parada 0, el bucle no corre.
                    // Si el bucle corrió (pasajero va a parada > 0), la duración del primer tramo (0->1) ya está.
                    // La variable 'estimatedTotalMillisToPassengerStop' ya tiene el tiempo hasta la *salida* de la parada 0.
                    // El bucle suma las duraciones de los tramos *posteriores* a la salida de la parada 0.
                    // Esto parece correcto.
                }
            } else { // Chofer ya en movimiento
                const busNextStopIndexTo = trackingStatus.nextStopIndexTowardsWhichHeading;
                if (busNextStopIndexTo >= busRouteStops.length || busNextStopIndexTo < 0) {
                    arrivalTimeDisplay.textContent = "Error Datos Chofer"; return;
                }
                let arrivalTimeAtBusNextStopForCalc = timeStringToDateTime(busRouteStops[busNextStopIndexTo].arrivalTime);
                if (!arrivalTimeAtBusNextStopForCalc) { arrivalTimeDisplay.textContent = "Error Horario"; return; }
                
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
                    if (legDuration === null) { console.warn("Horario inválido tramo"); estimatedTotalMillisToPassengerStop += 180000; continue; }
                    estimatedTotalMillisToPassengerStop += legDuration;
                }
            }
            arrivalTimeDisplay.textContent = formatRemainingTime(estimatedTotalMillisToPassengerStop);
            return;
        }

        // --- MODO RUTA EN COLA ---
        if (mode === "queued_route") {
            busStatusNote.textContent = `El bus está en ruta "${trackingStatus.routeName}". Esta ruta está en cola.`;

            // 1. Calcular tiempo restante para que el chofer termine SU RUTA ACTIVA
            const activeRouteStops = trackingStatus.routeStops; // Paradas de la ruta activa del chofer
            if (!activeRouteStops || activeRouteStops.length === 0) { arrivalTimeDisplay.textContent = "Error datos ruta activa"; return; }
            
            let timeToFinishActiveRouteMillis = 0;
            const activeRouteLastStopIndex = activeRouteStops.length - 1;
            const busCurrentStopFromIdxActive = trackingStatus.currentStopIndexFromWhichDeparted;
            let busDelayOrAheadActiveRoute = trackingStatus.currentBusDelayOrAheadMillis;
            const choferEnInicioRutaActiva = (busCurrentStopFromIdxActive === -1);

            if (choferEnInicioRutaActiva && busDelayOrAheadActiveRoute > 0) {
                busDelayOrAheadActiveRoute = 0; // No considerar adelanto para salida de ruta activa
            }
            const scheduledTimeAtBusCurrentPosActive = currentTimeMillis + busDelayOrAheadActiveRoute;

            if (choferEnInicioRutaActiva) {
                const startPointDepartureActive = timeStringToDateTime(activeRouteStops[0].departureTime);
                if (!startPointDepartureActive) { arrivalTimeDisplay.textContent = "Error Hor. Activa"; return; }
                timeToFinishActiveRouteMillis = Math.max(0, startPointDepartureActive.getTime() - currentTimeMillis);
                for (let i = 0; i < activeRouteLastStopIndex; i++) { // Sumar todos los tramos de la ruta activa
                    const legDur = getLegDurationMillis(activeRouteStops[i], activeRouteStops[i+1]);
                    if(legDur === null) { timeToFinishActiveRouteMillis += 180000; continue; } // Penalización
                    timeToFinishActiveRouteMillis += legDur;
                }
            } else { // Chofer en movimiento en ruta activa
                const busNextStopToIdxActive = trackingStatus.nextStopIndexTowardsWhichHeading;
                if (busNextStopToIdxActive >= activeRouteStops.length || busNextStopToIdxActive < 0) { arrivalTimeDisplay.textContent = "Error datos Activa"; return;}

                let arrivalAtNextInActive = timeStringToDateTime(activeRouteStops[busNextStopToIdxActive].arrivalTime);
                if(!arrivalAtNextInActive) { arrivalTimeDisplay.textContent = "Error Hor. Activa"; return;}

                let tempDateForNextStopActive = new Date(scheduledTimeAtBusCurrentPosActive);
                const [arrH, arrM] = activeRouteStops[busNextStopToIdxActive].arrivalTime.split(':').map(Number);
                tempDateForNextStopActive.setHours(arrH, arrM, 0, 0);
                if (tempDateForNextStopActive.getTime() < scheduledTimeAtBusCurrentPosActive && (scheduledTimeAtBusCurrentPosActive - tempDateForNextStopActive.getTime() > 12 * 3600000 )) {
                    tempDateForNextStopActive.setDate(tempDateForNextStopActive.getDate() + 1);
                }
                arrivalAtNextInActive = tempDateForNextStopActive;
                
                let timePendingCurrentLegActive = arrivalAtNextInActive.getTime() - scheduledTimeAtBusCurrentPosActive;
                if (timePendingCurrentLegActive < 0) timePendingCurrentLegActive = 0;
                timeToFinishActiveRouteMillis = timePendingCurrentLegActive;

                for (let i = busNextStopToIdxActive; i < activeRouteLastStopIndex; i++) {
                    const legDur = getLegDurationMillis(activeRouteStops[i], activeRouteStops[i+1]);
                    if(legDur === null) { timeToFinishActiveRouteMillis += 180000; continue; }
                    timeToFinishActiveRouteMillis += legDur;
                }
            }

            // 2. Obtener la definición de la ruta en cola seleccionada por el pasajero
            const selectedQueuedRouteDefinition = allRoutesDataFromStorage.find(r => r.name === selectedRouteNameByPassenger);
            if (!selectedQueuedRouteDefinition || !selectedQueuedRouteDefinition.startPoint || !selectedQueuedRouteDefinition.endPoint) {
                arrivalTimeDisplay.textContent = "Error datos ruta en cola"; return;
            }

            // 3. Calcular tiempo desde el inicio de la ruta en cola hasta la parada del pasajero
            let timeWithinQueuedRouteMillis = 0;
            let stopsOfQueuedRoute = [];
            if (selectedQueuedRouteDefinition.startPoint) stopsOfQueuedRoute.push(selectedQueuedRouteDefinition.startPoint);
            stopsOfQueuedRoute = stopsOfQueuedRoute.concat(selectedQueuedRouteDefinition.intermediateStops || []);
            if (selectedQueuedRouteDefinition.endPoint) stopsOfQueuedRoute.push(selectedQueuedRouteDefinition.endPoint);
            
            // passengerSelectedStopListIndex es el índice en `stopsOfQueuedRoute`
            const passengerTargetStopInQueued = stopsOfQueuedRoute[passengerSelectedStopListIndex];
            if (!passengerTargetStopInQueued) { arrivalTimeDisplay.textContent = "Parada no existe en ruta en cola"; return;}

            for (let i = 0; i < passengerSelectedStopListIndex; i++) {
                const legDur = getLegDurationMillis(stopsOfQueuedRoute[i], stopsOfQueuedRoute[i+1]);
                 if(legDur === null) { timeWithinQueuedRouteMillis += 180000; continue; }
                timeWithinQueuedRouteMillis += legDur;
            }
            // Si la parada seleccionada es la primera de la ruta en cola (índice 0), timeWithinQueuedRouteMillis será 0.

            // 4. Considerar el "gap"
            const estimatedArrivalAtEndOfActiveRouteMillis = currentTimeMillis + timeToFinishActiveRouteMillis;
            const scheduledStartOfQueuedRouteDate = timeStringToDateTime(selectedQueuedRouteDefinition.startPoint.departureTime);
            if(!scheduledStartOfQueuedRouteDate) { arrivalTimeDisplay.textContent = "Error Hor. Cola"; return; }

            let totalProjectedTimeMillis;
            if (estimatedArrivalAtEndOfActiveRouteMillis < scheduledStartOfQueuedRouteDate.getTime()) {
                // El bus llegará antes de que la ruta en cola deba empezar. Esperará.
                // El tiempo total es (hora inicio prog. ruta cola - hora actual) + tiempo DENTRO de ruta cola
                totalProjectedTimeMillis = (scheduledStartOfQueuedRouteDate.getTime() - currentTimeMillis) + timeWithinQueuedRouteMillis;
            } else {
                // El bus llegará tarde para el inicio programado de la ruta en cola.
                // El tiempo total es (tiempo para terminar ruta activa) + tiempo DENTRO de ruta cola
                totalProjectedTimeMillis = timeToFinishActiveRouteMillis + timeWithinQueuedRouteMillis;
            }
            
            arrivalTimeDisplay.textContent = formatRemainingTime(totalProjectedTimeMillis);
            return;
        }
    }

    populateRouteSelect();
    updateArrivalTime();

    if (passengerUpdateInterval) clearInterval(passengerUpdateInterval);
    passengerUpdateInterval = setInterval(() => {
        populateRouteSelect(); // Repoblar rutas para actualizar sufijos (En Curso, En Cola)
        // La selección de ruta se intenta mantener en populateRouteSelect
        
        const selectedRouteName = routeSelect.value;
        if (selectedRouteName) {
            const previousStopValue = stopSelect.value;
            // Solo repoblar paradas si la ruta seleccionada cambió o si el estado de "fuente de datos" para esa ruta cambió
            if (currentDisplayedRouteName !== selectedRouteName) {
                populateStopSelect(selectedRouteName);
            } else { // Misma ruta, verificar si cambió de online a offline o viceversa para esa ruta
                const trackingStatus = getTrackingStatus();
                const isNowOnlineForThisRoute = (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName);
                const wasStopSelectShowingOnlineData = stopSelect.dataset.source === 'tracking'; 
                // (Necesitaríamos añadir data-source al stopSelect al poblarlo)
                // Simplificación: repoblar si la ruta no cambió pero el estado general del tracking sí
                if ( (stopSelect.dataset.isTrackingLastPopulate !== String(trackingStatus?.isTracking)) || 
                     (stopSelect.dataset.activeRouteNameLastPopulate !== trackingStatus?.routeName) ) {
                    populateStopSelect(selectedRouteName);
                }
            }
             // Guardar el estado actual para la próxima comparación
            stopSelect.dataset.isTrackingLastPopulate = String(getTrackingStatus()?.isTracking);
            stopSelect.dataset.activeRouteNameLastPopulate = getTrackingStatus()?.routeName;


            if (previousStopValue && Array.from(stopSelect.options).some(opt => opt.value === previousStopValue)) {
                stopSelect.value = previousStopValue;
            } else if(stopSelect.options.length > 1) { // Si hay opciones pero la previa no, no seleccionar nada
                 stopSelect.value = "";
            }
        } else {
            populateStopSelect(""); // Limpiar paradas si no hay ruta seleccionada
        }
        updateArrivalTime();
    }, 7000); 
});
