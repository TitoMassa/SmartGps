document.addEventListener('DOMContentLoaded', () => {
    const routeSelect = document.getElementById('route-select');
    const stopSelect = document.getElementById('stop-select');
    const arrivalTimeDisplay = document.getElementById('arrival-time-display');
    const busStatusNote = document.getElementById('bus-status-note');
    const lastDataUpdateDisplay = document.getElementById('last-data-update');

    let allRoutesDataFromStorage = [];
    let passengerUpdateInterval;
    let currentDisplayedRouteName = null; // Para saber qué ruta está mostrando el selector de paradas

    function getTrackingStatus() { /* ... (sin cambios) ... */ 
        const trackingStatusJSON = localStorage.getItem('smartMoveProTrackingStatus');
        if (trackingStatusJSON) { try { return JSON.parse(trackingStatusJSON); } catch (e) { console.error("CuandoLlega: Error parsing trackingStatus", e); return null; } }
        return null;
    }
    function loadAllRoutesDefinitionsFromStorage() { /* ... (sin cambios) ... */
        const routesJSON = localStorage.getItem('smartMoveProRoutes');
        if (routesJSON) { try { allRoutesDataFromStorage = JSON.parse(routesJSON); return true; } catch (e) { console.error("CuandoLlega: Error parsing allRoutesData", e); allRoutesDataFromStorage = []; return false; } }
        allRoutesDataFromStorage = []; return false;
    }

    function populateRouteSelect() { // Ahora considera la cola del chofer
        if (!loadAllRoutesDefinitionsFromStorage()) {
            arrivalTimeDisplay.textContent = "No hay rutas de chofer disponibles.";
            return;
        }

        const trackingStatus = getTrackingStatus();
        routeSelect.innerHTML = '<option value="">-- Elige una ruta --</option>';
        let availableRouteNames = new Set();

        // 1. Añadir rutas de la cola del chofer (si está online)
        if (trackingStatus && trackingStatus.isTracking && trackingStatus.trackingQueueNames) {
            trackingStatus.trackingQueueNames.forEach(routeName => {
                if (!availableRouteNames.has(routeName)) {
                    const option = document.createElement('option');
                    option.value = routeName;
                    option.textContent = routeName + (trackingStatus.routeName === routeName ? " (En Curso)" : " (En Cola)");
                    routeSelect.appendChild(option);
                    availableRouteNames.add(routeName);
                }
            });
        }

        // 2. Añadir el resto de las rutas definidas (que no estén ya en la cola)
        allRoutesDataFromStorage.forEach((routeDef) => {
            if (routeDef.name && routeDef.startPoint && routeDef.endPoint && !availableRouteNames.has(routeDef.name)) {
                const option = document.createElement('option');
                option.value = routeDef.name;
                option.textContent = routeDef.name + " (Programada)";
                routeSelect.appendChild(option);
                availableRouteNames.add(routeDef.name);
            }
        });
        
        // Restaurar selección si es posible
        if (currentDisplayedRouteName && availableRouteNames.has(currentDisplayedRouteName)) {
            routeSelect.value = currentDisplayedRouteName;
        } else if (routeSelect.options.length > 1) { // Si hay rutas, pero la anterior no está, seleccionar la primera
            // No seleccionar automáticamente, dejar que el usuario elija
        }
    }


    function populateStopSelect(selectedRouteName) {
        stopSelect.innerHTML = '<option value="">-- Elige una parada --</option>';
        stopSelect.disabled = true;
        currentDisplayedRouteName = selectedRouteName; // Guardar la ruta para la que se muestran las paradas
        
        if (!selectedRouteName) return;

        const trackingStatus = getTrackingStatus();
        let stopsToDisplayForSelect = [];
        let sourceIsTrackingData = false;

        if (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName && trackingStatus.routeStops) {
            stopsToDisplayForSelect = trackingStatus.routeStops;
            sourceIsTrackingData = true;
        } else {
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
                    for(let i=0; i<=index; i++){ // Contar intermedios hasta esta parada
                        if(stopsToDisplayForSelect[i].type === 'intermediate') intermediateCount++;
                    }
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
        populateStopSelect(selectedRouteName);
        updateArrivalTime();
    });

    stopSelect.addEventListener('change', () => {
        updateArrivalTime();
    });

    function timeStringToDateTime(timeString, referenceDate = new Date()) { /* ... (sin cambios) ... */
        if (!timeString || !timeString.includes(':')) return null;
        const [hours, minutes] = timeString.split(':').map(Number);
        const date = new Date(referenceDate); date.setHours(hours, minutes, 0, 0); return date;
    }
    function formatRemainingTime(milliseconds) { /* ... (sin cambios) ... */
        if (milliseconds < 0) milliseconds = 0; const totalSeconds = Math.round(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        if (minutes === 0 && totalSeconds > 0 && totalSeconds < 60) return "ARRIBANDO";
        if (minutes < 1 && totalSeconds <= 0) return "ARRIBANDO";
        return `${minutes} min.`;
    }

    function updateArrivalTime() {
        const selectedRouteName = routeSelect.value;
        const selectedStopOptionIndex = stopSelect.value;

        if (selectedRouteName === "" || selectedStopOptionIndex === "") {
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
        
        // Es la ruta seleccionada por el pasajero la que está actualmente EN CURSO por el chofer?
        const isSelectedRouteCurrentlyActive = (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName);

        if (!isSelectedRouteCurrentlyActive || trackingStatus.hasError) {
            busStatusNote.textContent = "";
            if (trackingStatus?.hasError) busStatusNote.textContent += `Error en datos del chofer: ${trackingStatus.errorReason || ''}. `;
            
            if (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName !== selectedRouteName) {
                 busStatusNote.textContent += `El chofer está en ruta "${trackingStatus.routeName}". `;
            } else if (!trackingStatus || !trackingStatus.isTracking) {
                busStatusNote.textContent += "El chofer está fuera de línea. ";
            }
            busStatusNote.textContent += "Se muestra horario programado.";
            
            const routeDefinition = allRoutesDataFromStorage.find(r => r.name === selectedRouteName);
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

        // --- CHOFER ONLINE Y EN LA RUTA SELECCIONADA ---
        busStatusNote.textContent = "El chofer está en línea en esta ruta.";
        
        if (!trackingStatus.routeStops || trackingStatus.routeStops.length === 0) {
            arrivalTimeDisplay.textContent = "Error: Ruta activa sin paradas."; return;
        }

        const busRouteStops = trackingStatus.routeStops;
        const passengerSelectedStopDataOnline = busRouteStops[passengerSelectedStopListIndex];

        if (!passengerSelectedStopDataOnline) { arrivalTimeDisplay.textContent = "Error: Parada no encontrada."; return; }

        const busCurrentStopIndexFrom = trackingStatus.currentStopIndexFromWhichDeparted;
        const busNextStopIndexTo = trackingStatus.nextStopIndexTowardsWhichHeading;
        let busDelayOrAheadMillis = trackingStatus.currentBusDelayOrAheadMillis;

        const choferEnPuntoDeInicioAunSinSalir = (busCurrentStopIndexFrom === -1);

        if (choferEnPuntoDeInicioAunSinSalir && busDelayOrAheadMillis > 0) {
            busDelayOrAheadMillis = 0; // No considerar adelanto si está esperando en inicio
            busStatusNote.textContent = "El chofer está en el punto de inicio (a tiempo o esperando).";
        }

        if (passengerSelectedStopListIndex <= busCurrentStopIndexFrom) {
            arrivalTimeDisplay.textContent = "Bus ya pasó"; return;
        }

        let estimatedTotalMillisToPassengerStop = 0;
        const scheduledTimeAtBusCurrentPosition = currentTimeMillis + busDelayOrAheadMillis;

        if (choferEnPuntoDeInicioAunSinSalir) {
            const startPointDepartureTimeStr = busRouteStops[0].departureTime; // Hora de salida de la primera parada de la ruta activa
            const scheduledDepartureFromStartPointDate = timeStringToDateTime(startPointDepartureTimeStr);

            if (!scheduledDepartureFromStartPointDate) { arrivalTimeDisplay.textContent = "Error Horario Inicio"; return; }

            // Tiempo hasta la salida programada desde el punto de inicio
            // El bus no saldrá antes, incluso si `scheduledTimeAtBusCurrentPosition` es anterior debido a `busDelayOrAheadMillis = 0`
            let timeUntilTrueDeparture = Math.max(0, scheduledDepartureFromStartPointDate.getTime() - currentTimeMillis);
            
            estimatedTotalMillisToPassengerStop = timeUntilTrueDeparture;

            // Sumar duraciones programadas de tramos desde inicio hasta parada del pasajero
            for (let i = 0; i < passengerSelectedStopListIndex; i++) {
                const legFromStopData = busRouteStops[i];
                const legToStopData = busRouteStops[i + 1];
                const legDepartureDate = timeStringToDateTime(legFromStopData.departureTime);
                const legArrivalDate = timeStringToDateTime(legToStopData.arrivalTime);
                if (!legDepartureDate || !legArrivalDate) { console.warn("Horario inválido tramo (inicio)"); continue; }
                let tempLegArrivalDate = new Date(legArrivalDate);
                if (tempLegArrivalDate.getTime() < legDepartureDate.getTime()) {
                    tempLegArrivalDate.setDate(tempLegArrivalDate.getDate() + 1);
                }
                // Si es el primer tramo (i=0), la duración ya está implícita en timeUntilTrueDeparture + duración_primer_tramo
                // Si la parada del pasajero es la primera (idx 0), el tiempo es solo timeUntilTrueDeparture
                if (passengerSelectedStopListIndex === 0) { // Pasajero espera en la primera parada
                     // No sumar nada más, el tiempo es hasta la salida.
                } else if (i === 0) { // Primer tramo hacia una parada posterior
                    estimatedTotalMillisToPassengerStop += (tempLegArrivalDate.getTime() - legDepartureDate.getTime());
                } else if (i > 0) { // Tramos subsiguientes
                    estimatedTotalMillisToPassengerStop += (tempLegArrivalDate.getTime() - legDepartureDate.getTime());
                }
            }
             if (passengerSelectedStopListIndex === 0) { // Reafirmar para la primera parada
                estimatedTotalMillisToPassengerStop = timeUntilTrueDeparture;
            }


        } else { // Chofer ya en movimiento
            if (busNextStopIndexTo >= busRouteStops.length || busNextStopIndexTo < 0) {
                arrivalTimeDisplay.textContent = "Error Datos Chofer"; return;
            }

            let arrivalTimeAtBusNextStopForCalc = timeStringToDateTime(busRouteStops[busNextStopIndexTo].arrivalTime);
            if (!arrivalTimeAtBusNextStopForCalc) { arrivalTimeDisplay.textContent = "Error Horario"; return; }
            
            let tempDateForNextStop = new Date(scheduledTimeAtBusCurrentPosition);
            const [arrH, arrM] = busRouteStops[busNextStopIndexTo].arrivalTime.split(':').map(Number);
            tempDateForNextStop.setHours(arrH, arrM, 0, 0);
            if (tempDateForNextStop.getTime() < scheduledTimeAtBusCurrentPosition && (scheduledTimeAtBusCurrentPosition - tempDateForNextStop.getTime() > 12 * 60 * 60 * 1000 )) {
                 tempDateForNextStop.setDate(tempDateForNextStop.getDate() + 1);
            }
            arrivalTimeAtBusNextStopForCalc = tempDateForNextStop;

            let timeToBusImmediateNextStopMillis = arrivalTimeAtBusNextStopForCalc.getTime() - scheduledTimeAtBusCurrentPosition;
            if (timeToBusImmediateNextStopMillis < 0) timeToBusImmediateNextStopMillis = 0;
            
            estimatedTotalMillisToPassengerStop = timeToBusImmediateNextStopMillis;
            
            for (let i = busNextStopIndexTo; i < passengerSelectedStopListIndex; i++) {
                const legFromStopData = busRouteStops[i];
                const legToStopData = busRouteStops[i + 1];
                const legDepartureDate = timeStringToDateTime(legFromStopData.departureTime);
                const legArrivalDate = timeStringToDateTime(legToStopData.arrivalTime);
                if (!legDepartureDate || !legArrivalDate) { console.warn("Horario inválido tramo"); continue; }
                let tempLegArrivalDate = new Date(legArrivalDate);
                if (tempLegArrivalDate.getTime() < legDepartureDate.getTime()) {
                    tempLegArrivalDate.setDate(tempLegArrivalDate.getDate() + 1);
                }
                estimatedTotalMillisToPassengerStop += (tempLegArrivalDate.getTime() - legDepartureDate.getTime());
            }
        }
        
        arrivalTimeDisplay.textContent = formatRemainingTime(estimatedTotalMillisToPassengerStop);
    }

    populateRouteSelect();
    updateArrivalTime();

    if (passengerUpdateInterval) clearInterval(passengerUpdateInterval);
    passengerUpdateInterval = setInterval(() => {
        const currentSelectedRouteName = routeSelect.value;
        // Siempre repoblar el selector de rutas para reflejar el estado "En Curso" / "En Cola"
        const previousRouteValue = routeSelect.value;
        const previousStopValue = stopSelect.value;

        populateRouteSelect(); // Esto puede cambiar el orden o los sufijos
        if (Array.from(routeSelect.options).some(opt => opt.value === previousRouteValue)) {
            routeSelect.value = previousRouteValue; // Restaurar selección de ruta
            if (currentDisplayedRouteName === previousRouteValue) { // Si la ruta para la que se mostraban las paradas no cambió
                 // No es necesario repoblar paradas A MENOS que el estado del chofer haya cambiado para ESA ruta
                const trackingStatus = getTrackingStatus();
                const isPreviouslyOnlineForThisRoute = (stopSelect.options.length > 0 && stopSelect.options[0].value !== "" && trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === previousRouteValue);
                const isNowOnlineForThisRoute = (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === previousRouteValue);

                if(isPreviouslyOnlineForThisRoute !== isNowOnlineForThisRoute){ // Si cambió el estado online/offline para esta ruta
                    populateStopSelect(previousRouteValue);
                }
            } else { // La ruta seleccionada es diferente, repoblar paradas
                populateStopSelect(previousRouteValue);
            }
        } else { // La ruta seleccionada anteriormente ya no está (raro), limpiar
            populateStopSelect("");
        }
        
        // Intentar restaurar la selección de la parada
        if (previousStopValue && Array.from(stopSelect.options).some(opt => opt.value === previousStopValue)) {
            stopSelect.value = previousStopValue;
        } else {
            stopSelect.value = ""; // Si no se puede restaurar, limpiar
        }

        updateArrivalTime();
    }, 7000); 
});
