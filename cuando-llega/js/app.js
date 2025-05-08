document.addEventListener('DOMContentLoaded', () => {
    const routeSelect = document.getElementById('route-select');
    const stopSelect = document.getElementById('stop-select');
    const arrivalTimeDisplay = document.getElementById('arrival-time-display');
    const busStatusNote = document.getElementById('bus-status-note');
    const lastDataUpdateDisplay = document.getElementById('last-data-update');

    let allRoutesDataFromStorage = []; // Estructura de edición del chofer [{name, startPoint, endPoint, intermediateStops[]}]
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
    
    function loadAllRoutesDefinitionsFromStorage() { // Carga las definiciones de ruta del chofer
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
            console.warn("CuandoLlega: No se encontraron rutas en localStorage ('smartMoveProRoutes').");
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

        // Intentar obtener paradas desde el estado de seguimiento (chofer online y en esta ruta)
        if (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName && trackingStatus.routeStops) {
            stopsToDisplayForSelect = trackingStatus.routeStops;
        } 
        // Si no, obtener de las definiciones de ruta guardadas (chofer offline o en otra ruta)
        else {
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
                option.value = index; // El índice en el array `stopsToDisplayForSelect`
                
                let displayName = stop.name || `Parada Desconocida ${index + 1}`; // Nombre por defecto
                if (stop.type === 'start') {
                    displayName = `${stop.name || 'Inicio'} (Inicio)`;
                } else if (stop.type === 'end') {
                    displayName = `${stop.name || 'Fin'} (Fin)`;
                } else if (stop.name) { // Parada intermedia con nombre
                    displayName = stop.name;
                } else { // Parada intermedia sin nombre, usar número
                    // En modo offline, el índice de intermediateStops es diferente al índice global
                    // Para consistencia, podríamos intentar reconstruir el índice global si estamos offline
                    // O, más simple, si es una parada intermedia, su "nombre" podría ser solo "Parada X"
                    // Por ahora, si no tiene nombre y es intermedia, se quedará con el `displayName` inicial.
                    // Si el `trackingStatus.routeStops` ya tiene nombres "Parada X", eso se usará.
                    // Si `allRoutesDataFromStorage` no tiene nombres para intermedios, `stop.name` será undefined.
                    let intermediateIndex = -1;
                    if (stop.type === 'intermediate' && !(trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName)) {
                        // Estamos offline, encontrar el índice real de intermediateStops
                        const routeDef = allRoutesDataFromStorage.find(r => r.name === selectedRouteName);
                        if (routeDef && routeDef.intermediateStops) {
                            intermediateIndex = routeDef.intermediateStops.findIndex(is => is.lat === stop.lat && is.lng === stop.lng);
                            if (intermediateIndex !== -1) {
                                displayName = stop.name || `Parada Intermedia ${intermediateIndex + 1}`;
                            }
                        }
                    } else if (stop.type === 'intermediate' && !stop.name) {
                         displayName = `Parada Intermedia ${index}`; // Asumiendo que index es el correcto de routeStops
                    }
                }
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
        populateStopSelect(selectedRouteName); // Repoblar paradas al cambiar ruta
        updateArrivalTime(); // Actualizar display de tiempo
    });

    stopSelect.addEventListener('change', () => {
        updateArrivalTime();
    });

    function timeStringToDate(timeString, baseDate = new Date()) {
        if (!timeString || !timeString.includes(':')) return null;
        const [hours, minutes] = timeString.split(':').map(Number);
        const newDate = new Date(baseDate);
        newDate.setHours(hours, minutes, 0, 0);
        return newDate;
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
        const selectedStopOptionIndex = stopSelect.value; // Índice de la opción en el <select>

        if (selectedRouteName === "" || selectedStopOptionIndex === "") {
            arrivalTimeDisplay.textContent = "Selecciona una ruta y parada.";
            busStatusNote.textContent = "";
            return;
        }
        
        const passengerSelectedStopListIndex = parseInt(selectedStopOptionIndex); // Este es el índice del array de paradas que se usó para poblar el select
        const trackingStatus = getTrackingStatus();

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

                const passengerSelectedStopData = stopsForOffline[passengerSelectedStopListIndex]; // Usar el índice del select
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
            populateStopSelect(selectedRouteName); // Repoblar paradas con datos offline si el chofer cambió de ruta
            return;
        }
        
        if (!trackingStatus.routeStops || trackingStatus.routeStops.length === 0) {
            arrivalTimeDisplay.textContent = "Error: Ruta sin paradas.";
            busStatusNote.textContent = "La ruta del chofer no tiene paradas definidas.";
            return;
        }

        const busRouteStops = trackingStatus.routeStops; // Array plano de paradas de la ruta activa del chofer
        // `passengerSelectedStopListIndex` es el índice de la parada seleccionada por el pasajero DENTRO de `busRouteStops`
        const passengerSelectedStopDataOnline = busRouteStops[passengerSelectedStopListIndex]; 

        if (!passengerSelectedStopDataOnline) {
            arrivalTimeDisplay.textContent = "Error: Parada no encontrada en ruta activa.";
            console.error("CuandoLlega: Discrepancia de índice o parada no encontrada en busRouteStops", passengerSelectedStopListIndex, busRouteStops);
            return;
        }

        const busCurrentStopIndexFrom = trackingStatus.currentStopIndexFromWhichDeparted; // Índice de la parada de la que partió el bus (en busRouteStops)
        const busNextStopIndexTo = trackingStatus.nextStopIndexTowardsWhichHeading; // Índice de la próxima parada a la que va el bus (en busRouteStops)

        if (passengerSelectedStopListIndex <= busCurrentStopIndexFrom) {
            arrivalTimeDisplay.textContent = "Bus ya pasó";
            busStatusNote.textContent = `El bus ya partió de o pasó esta parada.`;
            return;
        }

        // Calcular tiempo restante
        let estimatedTotalMillisToPassengerStop = 0;
        const currentTimeMillis = new Date().getTime();

        if (busCurrentStopIndexFrom < -1 || busNextStopIndexTo >= busRouteStops.length || busNextStopIndexTo < 0) { // busCurrentStopIndexFrom puede ser -1
             arrivalTimeDisplay.textContent = "Error datos del chofer";
             busStatusNote.textContent = "Datos inconsistentes sobre la posición del chofer.";
             console.error("CuandoLlega: Índices de seguimiento del chofer fuera de rango", trackingStatus);
             return;
        }
        
        const scheduledTimeAtBusCurrentPosition = currentTimeMillis + trackingStatus.currentBusDelayOrAheadMillis;
        
        // Calcular tiempo hasta la próxima parada INMEDIATA del bus (busNextStopIndexTo)
        // Si el bus está antes de la primera parada (currentStopIndexFromWhichDeparted === -1)
        let timeToBusImmediateNextStopMillis;
        if (busCurrentStopIndexFrom === -1) { // El bus se dirige a su primera parada (busRouteStops[0])
            const arrivalAtFirstStop = timeStringToDate(busRouteStops[0].arrivalTime);
            if (!arrivalAtFirstStop) { arrivalTimeDisplay.textContent = "Error Horario"; return; }
            
            // El tiempo restante es (llegada prog. a primera parada) - (tiempo prog. en pos. actual)
            // Asumimos que currentBusDelayOrAheadMillis es relativo al inicio teórico del recorrido
            // o un punto de referencia antes de la primera parada.
            // Si el bus está en el tramo hacia la primera parada, el cálculo del chofer ya lo considera.
            // El 'scheduledTimeAtBusCurrentPosition' es el tiempo "corregido" del bus.
            // La llegada a la primera parada es un tiempo fijo.
             timeToBusImmediateNextStopMillis = arrivalAtFirstStop.getTime() - scheduledTimeAtBusCurrentPosition;

        } else { // El bus está entre dos paradas (from busCurrentStopIndexFrom to busNextStopIndexTo)
            const arrivalTimeAtBusNextStopForCalc = timeStringToDate(busRouteStops[busNextStopIndexTo].arrivalTime);
             if (!arrivalTimeAtBusNextStopForCalc) { arrivalTimeDisplay.textContent = "Error Horario"; return; }

            // Ajuste de fecha si la llegada es "antes" (cruzó medianoche)
            // Comparamos con el tiempo de salida de la parada anterior del bus
            const departureTimeFromBusPrevStop = timeStringToDate(busRouteStops[busCurrentStopIndexFrom].departureTime);
            if (departureTimeFromBusPrevStop && arrivalTimeAtBusNextStopForCalc.getTime() < departureTimeFromBusPrevStop.getTime()) {
                 arrivalTimeAtBusNextStopForCalc.setDate(arrivalTimeAtBusNextStopForCalc.getDate() + 1);
            }
            timeToBusImmediateNextStopMillis = arrivalTimeAtBusNextStopForCalc.getTime() - scheduledTimeAtBusCurrentPosition;
        }

        if (timeToBusImmediateNextStopMillis < 0) timeToBusImmediateNextStopMillis = 0;
        estimatedTotalMillisToPassengerStop = timeToBusImmediateNextStopMillis;
        
        // Sumar tiempos de tramos intermedios si la parada del pasajero es posterior a la próxima del bus
        for (let i = busNextStopIndexTo; i < passengerSelectedStopListIndex; i++) {
            const legFromStopData = busRouteStops[i]; // Esta es la parada de la que se sale en este tramo
            const legToStopData = busRouteStops[i + 1]; // Esta es la parada a la que se llega en este tramo

            // Usar departureTime de legFromStopData y arrivalTime de legToStopData
            const legDepartureDate = timeStringToDate(legFromStopData.departureTime);
            const legArrivalDate = timeStringToDate(legToStopData.arrivalTime);

            if (!legDepartureDate || !legArrivalDate) {
                console.warn("CuandoLlega: Horario inválido en tramo intermedio", legFromStopData, legToStopData);
                // Podríamos añadir un tiempo de penalización o simplemente continuar
                estimatedTotalMillisToPassengerStop += 3 * 60 * 1000; // Añadir 3 min por defecto
                continue;
            }
            
            let tempLegArrivalDate = new Date(legArrivalDate);
            if (tempLegArrivalDate.getTime() < legDepartureDate.getTime()) {
                tempLegArrivalDate.setDate(tempLegArrivalDate.getDate() + 1);
            }
            estimatedTotalMillisToPassengerStop += (tempLegArrivalDate.getTime() - legDepartureDate.getTime());
        }
        
        arrivalTimeDisplay.textContent = formatRemainingTime(estimatedTotalMillisToPassengerStop);
    }

    // --- INICIALIZACIÓN Y ACTUALIZACIÓN PERIÓDICA ---
    populateRouteSelect(); // Cargar rutas al inicio
    updateArrivalTime();   // Actualizar display inicial

    if (passengerUpdateInterval) clearInterval(passengerUpdateInterval);
    passengerUpdateInterval = setInterval(() => {
        // No es necesario repoblar routeSelect a menos que se detecte un cambio en 'smartMoveProRoutes' (más complejo)
        // Sí es necesario repoblar stopSelect si el estado del chofer cambia (ej. cambia de ruta)
        const currentSelectedRoute = routeSelect.value;
        if (currentSelectedRoute) { // Solo repoblar paradas si hay una ruta seleccionada
            const previousStopValue = stopSelect.value; // Guardar selección actual
            populateStopSelect(currentSelectedRoute);
            stopSelect.value = previousStopValue; // Intentar restaurar selección si aún es válida
            if (stopSelect.value !== previousStopValue) { // Si no se pudo restaurar (ej. ruta cambió), limpiar
                stopSelect.value = "";
            }
        }
        updateArrivalTime();
    }, 7000); // Actualizar cada 7 segundos
});
