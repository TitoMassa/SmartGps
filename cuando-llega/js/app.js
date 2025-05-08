document.addEventListener('DOMContentLoaded', () => {
    const routeSelect = document.getElementById('route-select');
    const stopSelect = document.getElementById('stop-select');
    const arrivalTimeDisplay = document.getElementById('arrival-time-display');
    const busStatusNote = document.getElementById('bus-status-note');
    const lastDataUpdateDisplay = document.getElementById('last-data-update');

    let allRoutesDataFromStorage = [];
    let passengerUpdateInterval;

    function getTrackingStatus() {
        const trackingStatusJSON = localStorage.getItem('smartMoveProTrackingStatus');
        if (trackingStatusJSON) {
            try {
                return JSON.parse(trackingStatusJSON);
            } catch (e) {
                console.error("CuandoLlega: Error parsing trackingStatus from localStorage", e);
                return null;
            }
        }
        return null;
    }
    
    function loadAllRoutesDefinitionsFromStorage() {
        const routesJSON = localStorage.getItem('smartMoveProRoutes');
        if (routesJSON) {
            try {
                allRoutesDataFromStorage = JSON.parse(routesJSON);
                return true;
            } catch (e) {
                console.error("CuandoLlega: Error parsing allRoutesDataFromStorage from localStorage", e);
                allRoutesDataFromStorage = [];
                return false;
            }
        }
        allRoutesDataFromStorage = [];
        return false;
    }

    function populateRouteSelect() {
        if (!loadAllRoutesDefinitionsFromStorage()) {
            arrivalTimeDisplay.textContent = "No hay rutas de chofer disponibles.";
            return;
        }
        routeSelect.innerHTML = '<option value="">-- Elige una ruta --</option>';
        allRoutesDataFromStorage.forEach((route) => {
            if (route.name && route.startPoint && route.endPoint) {
                const option = document.createElement('option');
                option.value = route.name;
                option.textContent = route.name;
                routeSelect.appendChild(option);
            }
        });
    }

    function populateStopSelect(selectedRouteName) {
        stopSelect.innerHTML = '<option value="">-- Elige una parada --</option>';
        stopSelect.disabled = true;
        
        if (!selectedRouteName) return;

        const trackingStatus = getTrackingStatus();
        let stopsToDisplayForSelect = [];

        if (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName && trackingStatus.routeStops) {
            stopsToDisplayForSelect = trackingStatus.routeStops;
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
                
                let displayName = stop.name || `Parada ${index + 1}`; // Nombre generalizado si no hay
                if (stop.type === 'start') {
                    displayName = `${stop.name || 'Inicio'} (Inicio)`;
                } else if (stop.type === 'end') {
                    displayName = `${stop.name || 'Fin'} (Fin)`;
                } else if (stop.type === 'intermediate' && !stop.name) { // Intermedia sin nombre propio
                     // Para obtener un número secuencial de parada intermedia consistente
                    let intermediateCount = 0;
                    for(let i=0; i<=index; i++){
                        if(stopsToDisplayForSelect[i].type === 'intermediate') intermediateCount++;
                    }
                    displayName = `Parada Intermedia ${intermediateCount}`;
                }
                // Si es intermedia y tiene nombre, `stop.name` ya se usó.
                
                option.textContent = displayName;
                stopSelect.appendChild(option);
            });
            stopSelect.disabled = false;
        } else {
            console.warn(`CuandoLlega: No se encontraron paradas para la ruta ${selectedRouteName}`);
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

    function timeStringToDateTime(timeString, referenceDate = new Date()) {
        if (!timeString || !timeString.includes(':')) return null;
        const [hours, minutes] = timeString.split(':').map(Number);
        const date = new Date(referenceDate); // Clonar para no modificar la referencia
        date.setHours(hours, minutes, 0, 0);
        return date;
    }

    function formatRemainingTime(milliseconds) {
        if (milliseconds < 0) milliseconds = 0;
        const totalSeconds = Math.round(milliseconds / 1000);
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
        
        // Escenario 1: Chofer fuera de línea, datos de seguimiento inválidos, o error del chofer
        if (!trackingStatus || !trackingStatus.isTracking || trackingStatus.hasError) {
            busStatusNote.textContent = trackingStatus?.hasError ? "Error en datos del chofer." : "El chofer está fuera de línea. Se muestra horario programado.";
            
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
                } else {
                    arrivalTimeDisplay.textContent = "Error datos parada (offline)";
                }
            } else {
                arrivalTimeDisplay.textContent = "Ruta no encontrada (offline)";
            }
            return;
        }

        // Escenario 2: Chofer en línea
        busStatusNote.textContent = "El chofer está en línea.";

        if (trackingStatus.routeName !== selectedRouteName) {
            arrivalTimeDisplay.textContent = "N/A";
            busStatusNote.textContent = `El chofer está actualmente en la ruta "${trackingStatus.routeName}".`;
            populateStopSelect(selectedRouteName);
            return;
        }
        
        if (!trackingStatus.routeStops || trackingStatus.routeStops.length === 0) {
            arrivalTimeDisplay.textContent = "Error: Ruta sin paradas.";
            return;
        }

        const busRouteStops = trackingStatus.routeStops;
        const passengerSelectedStopDataOnline = busRouteStops[passengerSelectedStopListIndex];

        if (!passengerSelectedStopDataOnline) {
            arrivalTimeDisplay.textContent = "Error: Parada no encontrada.";
            return;
        }

        const busCurrentStopIndexFrom = trackingStatus.currentStopIndexFromWhichDeparted;
        const busNextStopIndexTo = trackingStatus.nextStopIndexTowardsWhichHeading;
        let busDelayOrAheadMillis = trackingStatus.currentBusDelayOrAheadMillis;

        // **LÓGICA REFINADA PARA EL INICIO DEL RECORRIDO**
        const choferEnPuntoDeInicioAunSinSalir = (busCurrentStopIndexFrom === -1);

        if (choferEnPuntoDeInicioAunSinSalir && busDelayOrAheadMillis > 0) {
            // Chofer adelantado en el punto de inicio, NO restar el adelanto.
            // El bus esperará hasta su hora de salida programada.
            busDelayOrAheadMillis = 0; // Tratar como si estuviera a tiempo para el cálculo de salida.
            busStatusNote.textContent = "El chofer está en el punto de inicio (a tiempo o esperando).";
        }


        if (passengerSelectedStopListIndex <= busCurrentStopIndexFrom) {
            arrivalTimeDisplay.textContent = "Bus ya pasó";
            return;
        }

        let estimatedTotalMillisToPassengerStop = 0;
        const scheduledTimeAtBusCurrentPosition = currentTimeMillis + busDelayOrAheadMillis;


        if (choferEnPuntoDeInicioAunSinSalir) {
            // El bus aún no ha salido del punto de inicio.
            // El tiempo de salida programado del punto de inicio es la referencia.
            const startPointDepartureTimeStr = busRouteStops[0].departureTime;
            const scheduledDepartureFromStartPointDate = timeStringToDateTime(startPointDepartureTimeStr);

            if (!scheduledDepartureFromStartPointDate) { arrivalTimeDisplay.textContent = "Error Horario Inicio"; return; }

            let timeUntilScheduledDeparture = scheduledDepartureFromStartPointDate.getTime() - currentTimeMillis;
            if (timeUntilScheduledDeparture < 0 && busDelayOrAheadMillis <= 0) { // Ya debería haber salido y está atrasado
                timeUntilScheduledDeparture = 0; // Se considera que ya salió (o debería)
            } else if (timeUntilScheduledDeparture < 0 && busDelayOrAheadMillis > 0) { // Ya pasó la hora, pero estaba adelantado
                timeUntilScheduledDeparture = 0; // Se considera que sale a horario
            }


            estimatedTotalMillisToPassengerStop = timeUntilScheduledDeparture;

            // Sumar duraciones de tramos desde el inicio hasta la parada del pasajero
            for (let i = 0; i < passengerSelectedStopListIndex; i++) {
                const legFromStopData = busRouteStops[i];
                const legToStopData = busRouteStops[i + 1];

                // Para el primer tramo (i=0), la "salida" es departureTime de la parada 0.
                // Para los siguientes, la "salida" es departureTime de la parada i.
                const legDepartureDate = timeStringToDateTime(legFromStopData.departureTime);
                const legArrivalDate = timeStringToDateTime(legToStopData.arrivalTime);

                if (!legDepartureDate || !legArrivalDate) { console.warn("Horario inválido tramo (inicio)"); continue; }
                
                let tempLegArrivalDate = new Date(legArrivalDate);
                if (tempLegArrivalDate.getTime() < legDepartureDate.getTime()) {
                    tempLegArrivalDate.setDate(tempLegArrivalDate.getDate() + 1);
                }
                
                if (i > 0) { // Solo sumar la duración del tramo si no es el tramo de salida (ya cubierto por timeUntilScheduledDeparture)
                    estimatedTotalMillisToPassengerStop += (tempLegArrivalDate.getTime() - legDepartureDate.getTime());
                } else if (i === 0 && passengerSelectedStopListIndex > 0) { // Si la parada del pasajero no es la primera
                    // Sumar duración del primer tramo (Inicio -> Parada 1)
                     estimatedTotalMillisToPassengerStop += (tempLegArrivalDate.getTime() - legDepartureDate.getTime());
                }
            }
             // Si el pasajero seleccionó la primera parada (índice 0)
            if (passengerSelectedStopListIndex === 0) {
                estimatedTotalMillisToPassengerStop = timeUntilScheduledDeparture;
            }


        } else { // Chofer ya en movimiento (busCurrentStopIndexFrom >= 0)
            if (busNextStopIndexTo >= busRouteStops.length || busNextStopIndexTo < 0) {
                arrivalTimeDisplay.textContent = "Error Datos Chofer"; return;
            }

            let arrivalTimeAtBusNextStopForCalc = timeStringToDateTime(busRouteStops[busNextStopIndexTo].arrivalTime);
             if (!arrivalTimeAtBusNextStopForCalc) { arrivalTimeDisplay.textContent = "Error Horario"; return; }

            // Ajuste de fecha si la llegada es "antes" (cruzó medianoche respecto a la pos. actual del bus)
            // Esto es complejo. Una forma es basar la fecha de arrivalTimeAtBusNextStopForCalc en la fecha de scheduledTimeAtBusCurrentPosition
            let tempDateForNextStop = new Date(scheduledTimeAtBusCurrentPosition);
            const [arrH, arrM] = busRouteStops[busNextStopIndexTo].arrivalTime.split(':').map(Number);
            tempDateForNextStop.setHours(arrH, arrM, 0, 0);

            if (tempDateForNextStop.getTime() < scheduledTimeAtBusCurrentPosition && 
                (scheduledTimeAtBusCurrentPosition - tempDateForNextStop.getTime() > 12 * 60 * 60 * 1000 )) {
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
        const currentSelectedRoute = routeSelect.value;
        if (currentSelectedRoute) {
            const previousStopValue = stopSelect.value;
            populateStopSelect(currentSelectedRoute); // Repoblar para reflejar cambios si el chofer cambia de ruta o estado
            
            // Intentar restaurar la selección del stop si la opción aún existe
            let found = false;
            for(let i=0; i < stopSelect.options.length; i++){
                if(stopSelect.options[i].value === previousStopValue){
                    stopSelect.value = previousStopValue;
                    found = true;
                    break;
                }
            }
            if(!found) stopSelect.value = ""; // Si la opción ya no existe, limpiar

        }
        updateArrivalTime();
    }, 7000); 
});
