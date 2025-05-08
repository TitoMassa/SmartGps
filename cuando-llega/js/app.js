document.addEventListener('DOMContentLoaded', () => {
    const routeSelect = document.getElementById('route-select');
    const stopSelect = document.getElementById('stop-select');
    const arrivalTimeDisplay = document.getElementById('arrival-time-display');
    const busStatusNote = document.getElementById('bus-status-note');
    const lastDataUpdateDisplay = document.getElementById('last-data-update');

    let allRoutesData = []; // Para almacenar las rutas del chofer
    let passengerUpdateInterval;

    function loadRoutesForPassenger() {
        const routesJSON = localStorage.getItem('smartMoveProRoutes');
        if (routesJSON) {
            allRoutesData = JSON.parse(routesJSON);
            routeSelect.innerHTML = '<option value="">-- Elige una ruta --</option>'; // Reset
            allRoutesData.forEach((route, index) => {
                const option = document.createElement('option');
                option.value = index; // Usar índice para referenciar en allRoutesData
                option.textContent = route.name;
                routeSelect.appendChild(option);
            });
        } else {
            arrivalTimeDisplay.textContent = "No hay rutas de chofer disponibles.";
            console.warn("No se encontraron rutas en localStorage ('smartMoveProRoutes').");
        }
    }

    routeSelect.addEventListener('change', () => {
        const selectedRouteIndex = routeSelect.value;
        stopSelect.innerHTML = '<option value="">-- Elige una parada --</option>'; // Reset
        stopSelect.disabled = true;
        arrivalTimeDisplay.textContent = "Selecciona una parada.";
        busStatusNote.textContent = "";


        if (selectedRouteIndex !== "" && allRoutesData[selectedRouteIndex]) {
            const selectedRoute = allRoutesData[selectedRouteIndex];
            selectedRoute.stops.forEach((stop, stopIndex) => {
                const option = document.createElement('option');
                option.value = stopIndex;
                option.textContent = `Parada ${stopIndex + 1}`; // Podrías añadir más info si la tuvieras (ej. nombre de la parada)
                stopSelect.appendChild(option);
            });
            stopSelect.disabled = false;
        }
        updateArrivalTime(); // Actualizar inmediatamente si ya hay una parada seleccionada (poco probable aquí)
    });

    stopSelect.addEventListener('change', () => {
        updateArrivalTime();
    });

    function timeStringToDate(timeString, baseDate = new Date()) {
        const [hours, minutes] = timeString.split(':').map(Number);
        const newDate = new Date(baseDate);
        newDate.setHours(hours, minutes, 0, 0);
        return newDate;
    }

    function formatRemainingTime(milliseconds) {
        if (milliseconds < 0) milliseconds = 0; // No mostrar tiempo negativo

        const totalSeconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);

        if (minutes === 0 && totalSeconds < 60 && totalSeconds > 0) { // Entre 1 y 59 segundos
            return "ARRIBANDO";
        }
        if (minutes < 1 && totalSeconds === 0) { // Exactamente 0 o ya pasó y se redondeó a 0
            return "ARRIBANDO"; // O "Llegó" si prefieres
        }
        return `${minutes} min.`;
    }


    function updateArrivalTime() {
        const selectedRouteIndex = routeSelect.value;
        const selectedStopIndex = stopSelect.value;

        if (selectedRouteIndex === "" || selectedStopIndex === "") {
            arrivalTimeDisplay.textContent = "Selecciona una ruta y parada.";
            busStatusNote.textContent = "";
            return;
        }

        const passengerSelectedRoute = allRoutesData[parseInt(selectedRouteIndex)];
        const passengerSelectedStop = passengerSelectedRoute.stops[parseInt(selectedStopIndex)];

        const trackingStatusJSON = localStorage.getItem('smartMoveProTrackingStatus');
        let trackingStatus = null;
        if (trackingStatusJSON) {
            trackingStatus = JSON.parse(trackingStatusJSON);
             lastDataUpdateDisplay.textContent = trackingStatus.lastUpdateTime ? new Date(trackingStatus.lastUpdateTime).toLocaleTimeString() : 'Desconocida';
        }


        // Escenario 1: Chofer fuera de línea o sin datos de seguimiento
        if (!trackingStatus || !trackingStatus.isTracking) {
            arrivalTimeDisplay.textContent = `${passengerSelectedStop.departureTime} (hor prog.)`;
            busStatusNote.textContent = "El chofer está fuera de línea o no ha iniciado seguimiento. Se muestra horario programado de SALIDA de la parada.";
            return;
        }

        // Escenario 2: Chofer en línea
        busStatusNote.textContent = "El chofer está en línea.";

        // Verificar si el chofer está en la misma ruta que seleccionó el pasajero
        if (trackingStatus.routeName !== passengerSelectedRoute.name) {
            arrivalTimeDisplay.textContent = "N/A";
            busStatusNote.textContent = `El chofer está actualmente en la ruta "${trackingStatus.routeName}". No en la seleccionada.`;
            return;
        }

        const busRoute = passengerSelectedRoute; // Es la misma ruta
        const busCurrentStopIndexFrom = trackingStatus.currentStopIndexFromWhichDeparted; // Parada de la que partió el bus
        const busNextStopIndexTo = trackingStatus.nextStopIndexTowardsWhichHeading; // Próxima parada del bus
        const passengerSelectedStopActualIndex = parseInt(selectedStopIndex);

        // Verificar si el bus ya pasó la parada del pasajero
        if (passengerSelectedStopActualIndex <= busCurrentStopIndexFrom) {
            arrivalTimeDisplay.textContent = "Bus ya pasó";
            busStatusNote.textContent = `El bus ya partió de la parada ${busCurrentStopIndexFrom + 1} o una posterior.`;
            return;
        }

        // Calcular tiempo restante
        let estimatedTimeMillis = 0;
        let busPosition = trackingStatus.lastKnownPosition; // {lat, lng}
                                                            // Esto no lo usamos porque no tenemos Leaflet aquí.
                                                            // Usaremos los datos de tiempo y retraso del chofer.

        // Hora de referencia para cálculos de tiempo del chofer
        // El chofer partió de `busRoute.stops[busCurrentStopIndexFrom]`
        // Se dirige a `busRoute.stops[busNextStopIndexTo]`

        // 1. Calcular tiempo restante hasta la *próxima parada del bus* (busNextStopIndexTo)
        if (busCurrentStopIndexFrom < 0 || busNextStopIndexTo >= busRoute.stops.length) {
             arrivalTimeDisplay.textContent = "Error datos del chofer";
             busStatusNote.textContent = "Datos inconsistentes sobre la posición del chofer.";
             return;
        }

        const fromStopChofer = busRoute.stops[busCurrentStopIndexFrom];
        const toStopChoferImmediateNext = busRoute.stops[busNextStopIndexTo];

        let departureTimeFromChoferPrevStop = timeStringToDate(fromStopChofer.departureTime);
        let arrivalTimeAtChoferImmediateNextStop = timeStringToDate(toStopChoferImmediateNext.arrivalTime);

        if (arrivalTimeAtChoferImmediateNextStop.getTime() < departureTimeFromChoferPrevStop.getTime()) {
            arrivalTimeAtChoferImmediateNextStop.setDate(arrivalTimeAtChoferImmediateNextStop.getDate() + 1);
        }

        // Tiempo programado restante para el bus hasta SU PRÓXIMA PARADA.
        // Esto se puede calcular usando la proporción de distancia restante o, más simple,
        // Hora de llegada prog. a su prox. parada - Hora actual (ya ajustada por el retraso/adelanto)
        // Hora actual real del sistema:
        const currentTimeMillis = new Date().getTime();

        // Hora programada en la que el bus *debería* estar en su posición actual:
        // currentTimeMillis + trackingStatus.currentBusDelayOrAheadMillis
        // (Si está adelantado, delay > 0, así que progTime = realTime + delay)
        // (Si está atrasado, delay < 0, así que progTime = realTime - abs(delay))
        const scheduledTimeAtBusCurrentPosition = currentTimeMillis + trackingStatus.currentBusDelayOrAheadMillis;

        // Tiempo programado restante para el bus hasta SU PRÓXIMA PARADA (toStopChoferImmediateNext)
        let scheduledTimeRemainingForBusCurrentLegMillis = arrivalTimeAtChoferImmediateNextStop.getTime() - scheduledTimeAtBusCurrentPosition;
        if (scheduledTimeRemainingForBusCurrentLegMillis < 0) scheduledTimeRemainingForBusCurrentLegMillis = 0; // Ya debería haber llegado

        estimatedTimeMillis = scheduledTimeRemainingForBusCurrentLegMillis;


        // 2. Si la parada del pasajero es posterior a la próxima parada del bus, sumar tiempos de tramos intermedios
        if (passengerSelectedStopActualIndex > busNextStopIndexTo) {
            for (let i = busNextStopIndexTo; i < passengerSelectedStopActualIndex; i++) {
                const legFromStop = busRoute.stops[i];
                const legToStop = busRoute.stops[i + 1];

                let legDepartureTime = timeStringToDate(legFromStop.departureTime);
                let legArrivalTime = timeStringToDate(legToStop.arrivalTime);

                // Asumimos que el primer tramo (salida) se basa en el horario de la parada anterior
                // o si es el primer tramo del bucle, en la llegada estimada a esa parada.
                // Para simplificar, tomamos los tiempos programados entre paradas.
                const baseDateForThisLeg = (i === busNextStopIndexTo) ? arrivalTimeAtChoferImmediateNextStop : timeStringToDate(busRoute.stops[i-1].arrivalTime);


                legDepartureTime = timeStringToDate(legFromStop.departureTime, baseDateForThisLeg);
                legArrivalTime = timeStringToDate(legToStop.arrivalTime, baseDateForThisLeg);


                if (legArrivalTime.getTime() < legDepartureTime.getTime()) {
                    legArrivalTime.setDate(legArrivalTime.getDate() + 1);
                }
                // Si es el primer tramo después de la parada actual del bus, y el bus está llegando tarde/temprano
                // a su próxima parada, esa hora de llegada estimada debería ser la base para la salida del siguiente tramo.
                // Esta parte es compleja sin simular todo el recorrido.
                // Por ahora, sumaremos duraciones programadas de tramos.
                estimatedTimeMillis += (legArrivalTime.getTime() - legDepartureTime.getTime());
            }
        }
        
        arrivalTimeDisplay.textContent = formatRemainingTime(estimatedTimeMillis);
    }


    // Carga inicial
    loadRoutesForPassenger();
    updateArrivalTime(); // Para el caso de que haya algo preseleccionado o para mostrar mensaje inicial

    // Actualizar periódicamente
    if (passengerUpdateInterval) clearInterval(passengerUpdateInterval);
    passengerUpdateInterval = setInterval(() => {
        // No recargar rutas completas cada vez, solo el estado del bus y recalcular.
        // loadRoutesForPassenger(); // Podría ser útil si el chofer añade/elimina rutas en caliente, pero es costoso.
        updateArrivalTime();
    }, 15000); // Actualizar cada 15 segundos
});
