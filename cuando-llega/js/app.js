document.addEventListener('DOMContentLoaded', () => {
    const routeSelect = document.getElementById('route-select');
    const stopSelect = document.getElementById('stop-select');
    const arrivalTimeDisplay = document.getElementById('arrival-time-display');
    const busStatusNote = document.getElementById('bus-status-note');
    const lastDataUpdateDisplay = document.getElementById('last-data-update');

    let allRoutesDataFromStorage = []; // Para almacenar las rutas completas (estructura de edición)
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
    
    function loadAllRoutesFromStorage() {
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
        if (!loadAllRoutesFromStorage()) { // Cargar las rutas base
            arrivalTimeDisplay.textContent = "No hay rutas de chofer disponibles.";
            console.warn("CuandoLlega: No se encontraron rutas en localStorage ('smartMoveProRoutes').");
            return;
        }

        routeSelect.innerHTML = '<option value="">-- Elige una ruta --</option>';
        allRoutesDataFromStorage.forEach((route) => { // Iterar sobre la estructura de edición
            if (route.name && route.startPoint && route.endPoint) { // Asegurar que la ruta sea mínimamente válida
                const option = document.createElement('option');
                option.value = route.name; // Usar el nombre de la ruta como valor
                option.textContent = route.name;
                routeSelect.appendChild(option);
            }
        });
    }

    routeSelect.addEventListener('change', () => {
        const selectedRouteName = routeSelect.value;
        stopSelect.innerHTML = '<option value="">-- Elige una parada --</option>';
        stopSelect.disabled = true;
        arrivalTimeDisplay.textContent = "Selecciona una parada.";
        busStatusNote.textContent = "";

        if (selectedRouteName) {
            const trackingStatus = getTrackingStatus();
            let stopsToDisplay = [];

            // Caso 1: Chofer online y en la ruta seleccionada por el pasajero
            if (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName && trackingStatus.routeStops) {
                stopsToDisplay = trackingStatus.routeStops;
            } 
            // Caso 2: Chofer offline o en otra ruta, o datos de tracking incompletos
            else {
                const routeFromStorage = allRoutesDataFromStorage.find(r => r.name === selectedRouteName);
                if (routeFromStorage) {
                    if (routeFromStorage.startPoint) stopsToDisplay.push(routeFromStorage.startPoint);
                    stopsToDisplay = stopsToDisplay.concat(routeFromStorage.intermediateStops || []);
                    if (routeFromStorage.endPoint) stopsToDisplay.push(routeFromStorage.endPoint);
                }
            }

            if (stopsToDisplay.length > 0) {
                stopsToDisplay.forEach((stop, index) => {
                    const option = document.createElement('option');
                    option.value = index; // Índice en el array `stopsToDisplay`
                    let displayName = stop.name || `Parada ${index + 1}`;
                    if (stop.type === 'start') displayName = `${stop.name || 'Inicio'} (Inicio)`;
                    else if (stop.type === 'end') displayName = `${stop.name || 'Fin'} (Fin)`;
                    else if (stop.name) displayName = stop.name; // Nombre personalizado de parada intermedia
                    // else displayName sigue siendo Parada X+1

                    option.textContent = displayName;
                    stopSelect.appendChild(option);
                });
                stopSelect.disabled = false;
            }
        }
        updateArrivalTime(); // Llamar para actualizar la info de llegada
    });

    stopSelect.addEventListener('change', () => {
        updateArrivalTime();
    });

    function timeStringToDate(timeString, baseDate = new Date()) {
        if (!timeString || !timeString.includes(':')) return null; // Manejar tiempo inválido
        const [hours, minutes] = timeString.split(':').map(Number);
        const newDate = new Date(baseDate);
        newDate.setHours(hours, minutes, 0, 0);
        return newDate;
    }

    function formatRemainingTime(milliseconds) {
        if (milliseconds < 0) milliseconds = 0;

        const totalSeconds = Math.round(milliseconds / 1000); // Redondear segundos
        const minutes = Math.floor(totalSeconds / 60);

        if (minutes === 0 && totalSeconds > 0 && totalSeconds < 60) {
            return "ARRIBANDO";
        }
        if (minutes < 1 && totalSeconds <= 0) { // Si es 0 o negativo, también ARRIBANDO
            return "ARRIBANDO";
        }
        return `${minutes} min.`;
    }

    function updateArrivalTime() {
        const selectedRouteName = routeSelect.value;
        const selectedStopIndexInDisplay = stopSelect.value; // Este es el índice de la opción en el select

        if (selectedRouteName === "" || selectedStopIndexInDisplay === "") {
            arrivalTimeDisplay.textContent = "Selecciona una ruta y parada.";
            busStatusNote.textContent = "";
            return;
        }
        
        const passengerSelectedStopListIndex = parseInt(selectedStopIndexInDisplay);
        const trackingStatus = getTrackingStatus();

        if (trackingStatus && trackingStatus.lastUpdateTime) {
            lastDataUpdateDisplay.textContent = new Date(trackingStatus.lastUpdateTime).toLocaleTimeString();
        } else {
            lastDataUpdateDisplay.textContent = 'Desconocida';
        }
        
        // Escenario 1: Chofer fuera de línea o datos de seguimiento inválidos o error del chofer
        if (!trackingStatus || !trackingStatus.isTracking || trackingStatus.hasError) {
            busStatusNote.textContent = trackingStatus?.hasError ? "Error en datos del chofer." : "El chofer está fuera de línea. Se muestra horario programado.";
            
            const routeFromStorage = allRoutesDataFromStorage.find(r => r.name === selectedRouteName);
            if (routeFromStorage) {
                let stopsForOffline = [];
                if(routeFromStorage.startPoint) stopsForOffline.push(routeFromStorage.startPoint);
                stopsForOffline = stopsForOffline.concat(routeFromStorage.intermediateStops || []);
                if(routeFromStorage.endPoint) stopsForOffline.push(routeFromStorage.endPoint);

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
            return;
        }
        
        if (!trackingStatus.routeStops || trackingStatus.routeStops.length === 0) {
            arrivalTimeDisplay.textContent = "Error: Ruta sin paradas.";
            busStatusNote.textContent = "La ruta del chofer no tiene paradas definidas.";
            return;
        }

        // A partir de aquí, usamos trackingStatus.routeStops
        const busRouteStops = trackingStatus.routeStops;
        const passengerSelectedStopDataOnline = busRouteStops[passengerSelectedStopListIndex]; // Datos de la parada que seleccionó el pasajero

        if (!passengerSelectedStopDataOnline) {
            arrivalTimeDisplay.textContent = "Error: Parada no encontrada en ruta activa.";
            return;
        }

        // El índice que nos importa de `trackingStatus` es `currentStopIndexFromWhichDeparted`
        // y `nextStopIndexTowardsWhichHeading`
        const busCurrentStopIndexFrom = trackingStatus.currentStopIndexFromWhichDeparted; // Parada (índice) de la que partió el bus
        const busNextStopIndexTo = trackingStatus.nextStopIndexTowardsWhichHeading; // Próxima parada (índice) a la que va el bus

        // Para comparar, necesitamos el índice "real" de la parada seleccionada por el pasajero en la ruta activa.
        // El `passengerSelectedStopListIndex` YA ES el índice correcto dentro de `busRouteStops`.

        if (passengerSelectedStopListIndex <= busCurrentStopIndexFrom) {
            arrivalTimeDisplay.textContent = "Bus ya pasó";
            busStatusNote.textContent = `El bus ya partió de o pasó esta parada.`;
            return;
        }

        // Calcular tiempo restante
        let estimatedTotalMillisToPassengerStop = 0;
        const currentTimeMillis = new Date().getTime();

        // 1. Tiempo hasta la próxima parada INMEDIATA del bus (busNextStopIndexTo)
        if (busCurrentStopIndexFrom < 0 || busNextStopIndexTo >= busRouteStops.length) {
             arrivalTimeDisplay.textContent = "Error datos del chofer";
             busStatusNote.textContent = "Datos inconsistentes sobre la posición del chofer.";
             return;
        }
        
        // Hora programada en la que el bus *debería* estar en su posición actual:
        // Si chofer está adelantado, currentBusDelayOrAheadMillis es positivo.
        // Si chofer está atrasado, currentBusDelayOrAheadMillis es negativo.
        // scheduledTimeAtBusCurrentPosition = currentTimeMillis + currentBusDelayOrAheadMillis
        const scheduledTimeAtBusCurrentPosition = currentTimeMillis + trackingStatus.currentBusDelayOrAheadMillis;

        // Hora de llegada programada a la próxima parada inmediata del bus
        const arrivalTimeAtBusImmediateNextStopDate = timeStringToDate(busRouteStops[busNextStopIndexTo].arrivalTime);
        if (!arrivalTimeAtBusImmediateNextStopDate) {
            arrivalTimeDisplay.textContent = "Error horario parada bus"; return;
        }
        
        // Si la llegada programada es "anterior" al tiempo programado actual (ej. cruzó medianoche entre paradas)
        // Esto es más complejo de ajustar solo con la hora, necesitaríamos la fecha completa del horario.
        // Simplificación: si la hora de llegada es menor que la de salida del tramo anterior, sumar un día.
        // Este ajuste debería hacerse al generar los `Date` objects.
        // Asumimos que los tiempos en `busRouteStops` son HH:MM y necesitamos construir fechas.
        
        // Para manejar cruces de medianoche entre la posición actual del bus y su siguiente parada:
        let arrivalTimeAtBusNextStopForCalc = new Date(scheduledTimeAtBusCurrentPosition); // Usar como base
        const [arrH, arrM] = busRouteStops[busNextStopIndexTo].arrivalTime.split(':').map(Number);
        arrivalTimeAtBusNextStopForCalc.setHours(arrH, arrM, 0, 0);
        if (arrivalTimeAtBusNextStopForCalc.getTime() < scheduledTimeAtBusCurrentPosition && 
            (scheduledTimeAtBusCurrentPosition - arrivalTimeAtBusNextStopForCalc.getTime() > 12 * 60 * 60 * 1000 )) { // Si la diferencia es muy grande, probablemente cruzó
             arrivalTimeAtBusNextStopForCalc.setDate(arrivalTimeAtBusNextStopForCalc.getDate() + 1);
        }


        let timeToBusImmediateNextStopMillis = arrivalTimeAtBusNextStopForCalc.getTime() - scheduledTimeAtBusCurrentPosition;
        if (timeToBusImmediateNextStopMillis < 0) timeToBusImmediateNextStopMillis = 0;
        
        estimatedTotalMillisToPassengerStop = timeToBusImmediateNextStopMillis;
        
        // 2. Si la parada del pasajero es posterior a la próxima parada del bus, sumar tiempos de tramos intermedios
        //    Estos tramos se calculan con sus duraciones programadas.
        for (let i = busNextStopIndexTo; i < passengerSelectedStopListIndex; i++) {
            const legFromStopData = busRouteStops[i];
            const legToStopData = busRouteStops[i + 1];

            const legDepartureDate = timeStringToDate(legFromStopData.departureTime); // Usar departureTime de la parada anterior del tramo
            const legArrivalDate = timeStringToDate(legToStopData.arrivalTime);

            if (!legDepartureDate || !legArrivalDate) {
                console.warn("CuandoLlega: Horario inválido en tramo intermedio", legFromStopData, legToStopData);
                estimatedTotalMillisToPassengerStop += 3 * 60 * 1000; // Añadir un tiempo por defecto si hay error
                continue;
            }
            
            // Ajustar cruce de medianoche para la duración del tramo
            let tempLegArrivalDate = new Date(legArrivalDate);
            if (tempLegArrivalDate.getTime() < legDepartureDate.getTime()) {
                tempLegArrivalDate.setDate(tempLegArrivalDate.getDate() + 1);
            }
            estimatedTotalMillisToPassengerStop += (tempLegArrivalDate.getTime() - legDepartureDate.getTime());
        }
        
        arrivalTimeDisplay.textContent = formatRemainingTime(estimatedTotalMillisToPassengerStop);
    }

    // Carga inicial
    populateRouteSelect();
    updateArrivalTime();

    // Actualizar periódicamente
    if (passengerUpdateInterval) clearInterval(passengerUpdateInterval);
    passengerUpdateInterval = setInterval(() => {
        // Solo necesitamos actualizar la hora de llegada, no repoblar selects a menos que las rutas cambien
        // lo cual es menos frecuente. Podríamos tener un chequeo más ligero aquí.
        updateArrivalTime();
    }, 5000); // Actualizar cada 5 segundos para una respuesta más rápida al pasajero
});
