// cuando-llega/js/app.js (Corregido)

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const routeSelect = document.getElementById('route-select');
    const stopSelect = document.getElementById('stop-select');
    const arrivalTimeDisplay = document.getElementById('arrival-time-display');
    const busStatusNote = document.getElementById('bus-status-note'); // Para notas adicionales (opcional mostrar al usuario)
    const lastDataUpdateDisplay = document.getElementById('last-data-update');

    // --- State Variables ---
    let allRoutesDataFromStorage = []; // Definiciones completas de rutas [{name, startPoint, endPoint, intermediateStops[]}]
    let passengerUpdateInterval;       // Referencia al intervalo de actualización
    let currentDisplayedRouteName = null; // Nombre de la ruta cuyas paradas se muestran actualmente
    let lastDisplayedStopsSource = null; // 'tracking' o 'definition' (para optimizar repoblado de paradas)

    // --- Helper Functions ---

    /**
     * Obtiene y parsea el estado actual del seguimiento del chofer desde localStorage.
     * @returns {object|null} Objeto con el estado del tracking o null si no existe o hay error.
     */
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

    /**
     * Carga las definiciones completas de todas las rutas guardadas por el chofer.
     * @returns {boolean} true si se cargaron rutas, false si no hay o hubo error.
     */
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

    /**
     * Rellena el <select> de rutas disponibles.
     */
    function populateRouteSelect() {
        if (!loadAllRoutesDefinitionsFromStorage()) {
            arrivalTimeDisplay.textContent = "No hay rutas disponibles.";
            return;
        }
        const trackingStatus = getTrackingStatus();
        const previousRouteValue = routeSelect.value; // Guardar selección actual
        routeSelect.innerHTML = '<option value="">-- Elige una ruta --</option>';
        let availableRouteNames = new Set();

        // Añadir rutas de la cola del chofer primero (si existe y está online)
        if (trackingStatus && trackingStatus.isTracking && trackingStatus.trackingQueueNames) {
            trackingStatus.trackingQueueNames.forEach(routeName => {
                if (!availableRouteNames.has(routeName)) {
                    const option = document.createElement('option');
                    option.value = routeName;
                    option.textContent = routeName; // Sin sufijos
                    routeSelect.appendChild(option);
                    availableRouteNames.add(routeName);
                }
            });
        }

        // Añadir el resto de las rutas definidas que no estén en la cola
        allRoutesDataFromStorage.forEach((routeDef) => {
            if (routeDef.name && routeDef.startPoint && routeDef.endPoint && !availableRouteNames.has(routeDef.name)) {
                const option = document.createElement('option');
                option.value = routeDef.name;
                option.textContent = routeDef.name; // Sin sufijos
                routeSelect.appendChild(option);
                availableRouteNames.add(routeDef.name);
            }
        });

        // Restaurar selección si es posible
        if (previousRouteValue && availableRouteNames.has(previousRouteValue)) {
            routeSelect.value = previousRouteValue;
        } else {
            routeSelect.value = ""; // Deseleccionar si ya no está
        }
    }

    /**
     * Rellena el <select> de paradas para la ruta dada.
     * Usa datos del tracking si el chofer está online en esa ruta, sino usa las definiciones guardadas.
     * @param {string} selectedRouteName - El nombre de la ruta seleccionada.
     */
    function populateStopSelect(selectedRouteName) {
        stopSelect.innerHTML = '<option value="">-- Elige una parada --</option>';
        stopSelect.disabled = true;
        currentDisplayedRouteName = selectedRouteName; // Actualizar la ruta que se está mostrando

        if (!selectedRouteName) {
            lastDisplayedStopsSource = null; // Resetear fuente
            return;
        }

        const trackingStatus = getTrackingStatus();
        let stopsToDisplayForSelect = [];
        let currentSource = 'definition'; // Fuente por defecto es la definición guardada

        // Determinar la fuente de los datos de las paradas
        if (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName && trackingStatus.routeStops) {
            stopsToDisplayForSelect = trackingStatus.routeStops;
            currentSource = 'tracking'; // Fuente es el tracking en tiempo real
        } else {
            const routeDefinition = allRoutesDataFromStorage.find(r => r.name === selectedRouteName);
            if (routeDefinition) {
                if (routeDefinition.startPoint) stopsToDisplayForSelect.push(routeDefinition.startPoint);
                stopsToDisplayForSelect = stopsToDisplayForSelect.concat(routeDefinition.intermediateStops || []);
                if (routeDefinition.endPoint) stopsToDisplayForSelect.push(routeDefinition.endPoint);
            }
            currentSource = 'definition'; // Fuente es la definición guardada
        }
        lastDisplayedStopsSource = currentSource; // Guardar qué fuente se usó

        // Poblar el select
        if (stopsToDisplayForSelect.length > 0) {
            stopsToDisplayForSelect.forEach((stop, index) => {
                const option = document.createElement('option');
                option.value = index; // Índice en el array `stopsToDisplayForSelect`
                let displayName = stop.name || `Parada ${index + 1}`; // Nombre por defecto
                if (stop.type === 'start') displayName = `${stop.name || 'Inicio'} (Inicio)`;
                else if (stop.type === 'end') displayName = `${stop.name || 'Fin'} (Fin)`;
                else if (stop.type === 'intermediate' && !stop.name) {
                    // Contar solo paradas intermedias HASTA este punto para numerar
                    let intermediateCount = 0;
                    for(let k=0; k<=index; k++){ if(stopsToDisplayForSelect[k].type === 'intermediate') intermediateCount++; }
                    displayName = `Parada Intermedia ${intermediateCount}`;
                }
                option.textContent = displayName;
                stopSelect.appendChild(option);
            });
            stopSelect.disabled = false;
        } else {
            console.warn(`CuandoLlega: No se encontraron paradas para la ruta ${selectedRouteName} (fuente: ${currentSource})`);
        }
    }

    /**
     * Convierte "HH:MM" a un objeto Date, usando una fecha base para el día/mes/año.
     * @param {string} timeString - El tiempo en formato "HH:MM".
     * @param {Date} [referenceDate=new Date()] - La fecha base.
     * @returns {Date|null} Objeto Date o null si el formato es inválido.
     */
    function timeStringToDateTime(timeString, referenceDate = new Date()) {
         if (!timeString || typeof timeString !== 'string' || !timeString.includes(':')) return null;
         const parts = timeString.split(':');
         if (parts.length !== 2) return null;
         const hours = parseInt(parts[0], 10);
         const minutes = parseInt(parts[1], 10);
         if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
         const date = new Date(referenceDate); // Clonar
         date.setHours(hours, minutes, 0, 0);
         return date;
    }

    /**
     * Calcula la duración programada en milisegundos entre dos paradas.
     * @param {object} fromStop - Objeto de la parada de salida.
     * @param {object} toStop - Objeto de la parada de llegada.
     * @returns {number|null} Duración en ms o null si hay error de horario.
     */
    function getLegDurationMillis(fromStop, toStop) {
        if (!fromStop || !toStop) return null;
        const legDepartureDate = timeStringToDateTime(fromStop.departureTime);
        const legArrivalDate = timeStringToDateTime(toStop.arrivalTime);
        if (!legDepartureDate || !legArrivalDate) {
            console.warn("getLegDurationMillis: Horario inválido", fromStop, toStop);
            return null;
        }
        // Ajustar por cruce de medianoche para la duración del tramo
        let tempLegArrivalDate = new Date(legArrivalDate);
        if (tempLegArrivalDate.getTime() < legDepartureDate.getTime()) {
            tempLegArrivalDate.setDate(tempLegArrivalDate.getDate() + 1);
        }
        const duration = tempLegArrivalDate.getTime() - legDepartureDate.getTime();
        return duration >= 0 ? duration : null; // No permitir duración negativa
    }

    /**
     * Formatea milisegundos restantes a "X min." o "ARRIBANDO".
     * @param {number} milliseconds - Tiempo restante en milisegundos.
     * @returns {string} Tiempo formateado.
     */
    function formatRemainingTime(milliseconds) {
        if (milliseconds === Infinity || isNaN(milliseconds) || milliseconds === null) return "Calculando...";
        if (milliseconds < 0) milliseconds = 0; // Considerar tiempo pasado como 0 para "ARRIBANDO"
        const totalSeconds = Math.round(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);

        // Si faltan menos de 60 segundos (y más de 0), o si es exactamente 0 o negativo
        if (minutes === 0 && totalSeconds < 60) return "ARRIBANDO";
        // Si son más minutos
        return `${minutes} min.`;
    }

    /**
     * Función principal que calcula y muestra el tiempo de llegada o estado.
     */
    function updateArrivalTime() {
        const selectedRouteNameByPassenger = routeSelect.value;
        const selectedStopOptionIndex = stopSelect.value;

        // --- Validaciones iniciales ---
        if (selectedRouteNameByPassenger === "" || selectedStopOptionIndex === "") {
            arrivalTimeDisplay.textContent = "Selecciona ruta y parada";
            busStatusNote.textContent = "";
            lastDataUpdateDisplay.textContent = 'N/A';
            return;
        }

        const passengerSelectedStopListIndex = parseInt(selectedStopOptionIndex);
        const trackingStatus = getTrackingStatus();
        const currentTimeMillis = new Date().getTime();

        // Actualizar hora de última data
        if (trackingStatus && trackingStatus.lastUpdateTime) {
            lastDataUpdateDisplay.textContent = new Date(trackingStatus.lastUpdateTime).toLocaleTimeString();
            // Considerar datos viejos como offline (ej. > 90 segundos)
            if (currentTimeMillis - trackingStatus.lastUpdateTime > 90000) {
                busStatusNote.textContent = "Datos del chofer desactualizados. ";
                // Forzar modo offline si los datos son muy viejos
                // Comentar la línea siguiente si prefieres que intente usar los datos viejos
                // trackingStatus = { ...trackingStatus, isTracking: false }; // Simular offline
            }
        } else {
            lastDataUpdateDisplay.textContent = 'N/A';
        }

        // --- Determinar Modo de Operación ---
        let mode = "offline_or_error";
        let indexOfSelectedRouteInQueue = -1;

        if (trackingStatus && !trackingStatus.hasError && trackingStatus.isTracking) {
            if (trackingStatus.routeName === selectedRouteNameByPassenger) {
                mode = "active_route";
            } else if (trackingStatus.trackingQueueNames && trackingStatus.trackingQueueNames.includes(selectedRouteNameByPassenger)) {
                indexOfSelectedRouteInQueue = trackingStatus.trackingQueueNames.indexOf(selectedRouteNameByPassenger);
                if (indexOfSelectedRouteInQueue > trackingStatus.currentRouteIndexInQueue) {
                    mode = "queued_route";
                }
                // Si no, se trata como 'offline_or_error' (ruta ya pasó o error lógico)
            }
        } else if (trackingStatus && trackingStatus.hasError) {
             busStatusNote.textContent = `Error del chofer: ${trackingStatus.errorReason || 'Desconocido'}. `;
             // mode se queda como 'offline_or_error'
        }
        // Si trackingStatus es null o !isTracking, mode es 'offline_or_error'

        // --- Lógica por Modo ---

        // ** MODO OFFLINE / OTRA RUTA / ERROR **
        if (mode === "offline_or_error") {
            arrivalTimeDisplay.textContent = "HH:MM (hor prog.)"; // Placeholder
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
                    arrivalTimeDisplay.textContent = `${timeToShow || '--:--'} (hor prog.)`; // Mostrar Horario Programado
                } else { arrivalTimeDisplay.textContent = "Error Parada"; }
            } else { arrivalTimeDisplay.textContent = "Error Ruta"; }

            // Actualizar nota de estado
            if (!trackingStatus || !trackingStatus.isTracking) { busStatusNote.textContent += "Chofer fuera de línea."; }
            else if (trackingStatus.isTracking && trackingStatus.routeName !== selectedRouteNameByPassenger) { busStatusNote.textContent += `Chofer en ruta "${trackingStatus.routeName}".`; }
            return; // Terminar
        }

        // ** MODO RUTA ACTIVA **
        if (mode === "active_route") {
            busStatusNote.textContent = ``; // Limpiar nota para modo activo
            if (!trackingStatus.routeStops || trackingStatus.routeStops.length === 0) { arrivalTimeDisplay.textContent = "Error Ruta"; return; }
            const busRouteStops = trackingStatus.routeStops; const passengerSelectedStopDataOnline = busRouteStops[passengerSelectedStopListIndex]; if (!passengerSelectedStopDataOnline) { arrivalTimeDisplay.textContent = "Error Parada"; return; }
            const busCurrentStopIndexFrom = trackingStatus.currentStopIndexFromWhichDeparted;

            // *** Chequeo BUS YA PASÓ ***
            if (busCurrentStopIndexFrom >= passengerSelectedStopListIndex) {
                arrivalTimeDisplay.textContent = "Bus ya pasó"; return;
            }

            let busDelayOrAheadMillis = trackingStatus.currentBusDelayOrAheadMillis;
            const choferEnPuntoDeInicioAunSinSalir = (busCurrentStopIndexFrom === -1);

            // Ajuste por "Haciendo Hora" en Inicio (ignorar adelanto para cálculo ETA)
            if (choferEnPuntoDeInicioAunSinSalir && busDelayOrAheadMillis > 0) {
                busDelayOrAheadMillis = 0; // Tratar como a tiempo si está adelantado esperando
            }

            let estimatedTotalMillisToPassengerStop = 0;
            const scheduledTimeAtBusCurrentPosition = currentTimeMillis + busDelayOrAheadMillis; // Tiempo "efectivo" del bus en su horario

            if (choferEnPuntoDeInicioAunSinSalir) {
                const startDepTimeStr = busRouteStops[0].departureTime; const startDepDate = timeStringToDateTime(startDepTimeStr); if (!startDepDate) { arrivalTimeDisplay.textContent = "Error Hor."; return; }
                // Tiempo hasta la SALIDA programada real. No saldrá antes.
                let timeUntilTrueDeparture = Math.max(0, startDepDate.getTime() - currentTimeMillis);
                estimatedTotalMillisToPassengerStop = timeUntilTrueDeparture;
                // Sumar duraciones programadas de tramos desde inicio hasta parada del pasajero
                if (passengerSelectedStopListIndex > 0) { for (let i = 0; i < passengerSelectedStopListIndex; i++) { const dur = getLegDurationMillis(busRouteStops[i], busRouteStops[i + 1]); if (dur === null) { estimatedTotalMillisToPassengerStop = Infinity; break; } estimatedTotalMillisToPassengerStop += dur; } }
            } else { // Chofer en movimiento
                const busNextIdx = trackingStatus.nextStopIndexTowardsWhichHeading; if (busNextIdx >= busRouteStops.length || busNextIdx < 0) { arrivalTimeDisplay.textContent = "Error Datos"; return; }
                let nextArrivalDT = timeStringToDateTime(busRouteStops[busNextIdx].arrivalTime); if (!nextArrivalDT) { arrivalTimeDisplay.textContent = "Error Hor."; return; }
                // Ajustar fecha de llegada a la próxima parada relativa al tiempo "efectivo" del bus
                let tempNextDT = new Date(scheduledTimeAtBusCurrentPosition); const [h, m] = busRouteStops[busNextIdx].arrivalTime.split(':').map(Number); tempNextDT.setHours(h, m, 0, 0); if (tempNextDT < scheduledTimeAtBusCurrentPosition && (scheduledTimeAtBusCurrentPosition - tempNextDT > 12 * 3600000 )) { tempNextDT.setDate(tempNextDT.getDate() + 1); } nextArrivalDT = tempNextDT;
                // Tiempo restante hasta la próxima parada del bus, desde su tiempo efectivo
                let timeToNext = nextArrivalDT - scheduledTimeAtBusCurrentPosition; if (timeToNext < 0) timeToNext = 0; estimatedTotalMillisToPassengerStop = timeToNext;
                // Sumar duraciones programadas de tramos posteriores
                for (let i = busNextIdx; i < passengerSelectedStopListIndex; i++) { const dur = getLegDurationMillis(busRouteStops[i], busRouteStops[i + 1]); if (dur === null) { estimatedTotalMillisToPassengerStop = Infinity; break; } estimatedTotalMillisToPassengerStop += dur; }
            }
            // Mostrar el resultado formateado
            arrivalTimeDisplay.textContent = formatRemainingTime(estimatedTotalMillisToPassengerStop); return;
        }

        // ** MODO RUTA EN COLA **
        if (mode === "queued_route") {
            busStatusNote.textContent = `Calculando para ruta en cola...`; // Nota interna
            // --- Calcular tiempo hasta fin de ruta activa ---
            const activeStops = trackingStatus.routeStops; if (!activeStops || activeStops.length === 0) { arrivalTimeDisplay.textContent = "Error Activa"; return; }
            let timeToFinishActive = 0; const activeLastIdx = activeStops.length - 1; const activeFromIdx = trackingStatus.currentStopIndexFromWhichDeparted; let activeDelay = trackingStatus.currentBusDelayOrAheadMillis; const activeAtStart = (activeFromIdx === -1);
            if (activeAtStart && activeDelay > 0) activeDelay = 0; const schedTimeActive = currentTimeMillis + activeDelay;
            if (activeAtStart) { const startDepActive = timeStringToDateTime(activeStops[0].departureTime); if (!startDepActive) { arrivalTimeDisplay.textContent = "Error H.Act"; return; } timeToFinishActive = Math.max(0, startDepActive.getTime() - currentTimeMillis); for (let i = 0; i < activeLastIdx; i++) { const dur = getLegDurationMillis(activeStops[i], activeStops[i+1]); if(dur === null) { timeToFinishActive = Infinity; break; } timeToFinishActive += dur; } }
            else { const activeNextIdx = trackingStatus.nextStopIndexTowardsWhichHeading; if (activeNextIdx > activeLastIdx || activeNextIdx < 0) { arrivalTimeDisplay.textContent = "Error D.Act"; return;} let nextArrActive = timeStringToDateTime(activeStops[activeNextIdx].arrivalTime); if(!nextArrActive) { arrivalTimeDisplay.textContent = "Error H.Act"; return;} let tempNextActive = new Date(schedTimeActive); const [h, m] = activeStops[activeNextIdx].arrivalTime.split(':').map(Number); tempNextActive.setHours(h, m, 0, 0); if (tempNextActive < schedTimeActive && (schedTimeActive - tempNextActive > 12*3600000)) { tempNextActive.setDate(tempNextActive.getDate() + 1); } nextArrActive = tempNextActive; let timeCurrentLegActive = nextArrActive - schedTimeActive; if (timeCurrentLegActive < 0) timeCurrentLegActive = 0; timeToFinishActive = timeCurrentLegActive; for (let i = activeNextIdx; i < activeLastIdx; i++) { const dur = getLegDurationMillis(activeStops[i], activeStops[i+1]); if(dur === null) { timeToFinishActive = Infinity; break; } timeToFinishActive += dur; } }
            if (timeToFinishActive === Infinity) { arrivalTimeDisplay.textContent = "Calculando..."; return; }

            // --- Calcular tiempo dentro de la ruta en cola ---
            const queuedRouteDef = allRoutesDataFromStorage.find(r => r.name === selectedRouteNameByPassenger); if (!queuedRouteDef || !queuedRouteDef.startPoint || !queuedRouteDef.endPoint) { arrivalTimeDisplay.textContent = "Error R.Cola"; return; }
            let timeInQueued = 0; let queuedStops = []; if (queuedRouteDef.startPoint) queuedStops.push(queuedRouteDef.startPoint); queuedStops = queuedStops.concat(queuedRouteDef.intermediateStops || []); if (queuedRouteDef.endPoint) queuedStops.push(queuedRouteDef.endPoint);
            const targetStopQueued = queuedStops[passengerSelectedStopListIndex]; if (!targetStopQueued) { arrivalTimeDisplay.textContent = "Error P.Cola"; return;}
            for (let i = 0; i < passengerSelectedStopListIndex; i++) { const dur = getLegDurationMillis(queuedStops[i], queuedStops[i+1]); if(dur === null) { timeInQueued = Infinity; break; } timeInQueued += dur; }
            if (timeInQueued === Infinity) { arrivalTimeDisplay.textContent = "Calculando..."; return; }

            // --- Calcular tiempo total proyectado ---
            const estArrivalEndActive = currentTimeMillis + timeToFinishActive;
            const schedStartQueued = timeStringToDateTime(queuedRouteDef.startPoint.departureTime); if(!schedStartQueued) { arrivalTimeDisplay.textContent = "Error H.Cola"; return; }
            let totalProjectedTimeMillis; if (estArrivalEndActive <= schedStartQueued.getTime()) { totalProjTime = (schedStartQueued.getTime() - currentTimeMillis) + timeInQueued; } else { totalProjTime = timeToFinishActive + timeInQueued; }

            // Mostrar resultado formateado
            arrivalTimeDisplay.textContent = formatRemainingTime(totalProjTime); return;
        }
    } // Fin updateArrivalTime

    // --- INICIALIZACIÓN Y ACTUALIZACIÓN PERIÓDICA ---
    populateRouteSelect();
    updateArrivalTime();

    if (passengerUpdateInterval) clearInterval(passengerUpdateInterval);
    passengerUpdateInterval = setInterval(() => {
        const previousRouteValue = routeSelect.value; const previousStopValue = stopSelect.value;
        populateRouteSelect(); // Actualizar rutas disponibles
        if (Array.from(routeSelect.options).some(o => o.value === previousRouteValue)) { routeSelect.value = previousRouteValue; } else { routeSelect.value = ""; } // Restaurar ruta
        const selectedRouteName = routeSelect.value;
        
        // Decidir si repoblar paradas: si cambió la ruta O si cambió la fuente de datos para esa ruta
        const trackingStatus = getTrackingStatus();
        const isNowOnlineForThis = (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName);
        const sourceChanged = (lastDisplayedStopsSource === 'tracking') !== isNowOnlineForThis;

        if (currentDisplayedRouteName !== selectedRouteName || sourceChanged) {
            populateStopSelect(selectedRouteName);
            // Intentar restaurar parada
            if (previousStopValue && Array.from(stopSelect.options).some(o => o.value === previousStopValue)) { stopSelect.value = previousStopValue; }
            else { stopSelect.value = ""; } // Limpiar si no se puede restaurar
        } else {
            // Mantener selección si la fuente no cambió y la opción existe
             if (previousStopValue && Array.from(stopSelect.options).some(o => o.value === previousStopValue)) { stopSelect.value = previousStopValue; }
             else { stopSelect.value = ""; }
        }
        updateArrivalTime(); // Calcular y mostrar
    }, 7000); // Intervalo de actualización
});
