// cuando-llega/js/app.js (SIN CAMBIOS respecto a la versión anterior)

document.addEventListener('DOMContentLoaded', () => {
    const routeSelect = document.getElementById('route-select');
    const stopSelect = document.getElementById('stop-select');
    const arrivalTimeDisplay = document.getElementById('arrival-time-display');
    const busStatusNote = document.getElementById('bus-status-note');
    const lastDataUpdateDisplay = document.getElementById('last-data-update');

    let allRoutesDataFromStorage = [];
    let passengerUpdateInterval;
    let currentDisplayedRouteName = null;

    function getTrackingStatus() {
        const trackingStatusJSON = localStorage.getItem('smartMoveProTrackingStatus');
        if (trackingStatusJSON) { try { return JSON.parse(trackingStatusJSON); } catch (e) { console.error("CuandoLlega: Error parsing trackingStatus", e); return null; } } return null;
    }
    function loadAllRoutesDefinitionsFromStorage() {
        const routesJSON = localStorage.getItem('smartMoveProRoutes');
        if (routesJSON) { try { allRoutesDataFromStorage = JSON.parse(routesJSON); return true; } catch (e) { console.error("CuandoLlega: Error parsing allRoutesData", e); allRoutesDataFromStorage = []; return false; } } allRoutesDataFromStorage = []; return false;
    }
    function populateRouteSelect() {
        if (!loadAllRoutesDefinitionsFromStorage()) { arrivalTimeDisplay.textContent = "No hay rutas disponibles."; return; }
        const trackingStatus = getTrackingStatus(); const previousRouteValue = routeSelect.value; routeSelect.innerHTML = '<option value="">-- Elige una ruta --</option>'; let availableRouteNames = new Set();
        if (trackingStatus && trackingStatus.isTracking && trackingStatus.trackingQueueNames) { trackingStatus.trackingQueueNames.forEach(rn => { if (!availableRouteNames.has(rn)) { const o = document.createElement('option'); o.value = rn; o.textContent = rn; routeSelect.appendChild(o); availableRouteNames.add(rn); } }); }
        allRoutesDataFromStorage.forEach((rd) => { if (rd.name && rd.startPoint && rd.endPoint && !availableRouteNames.has(rd.name)) { const o = document.createElement('option'); o.value = rd.name; o.textContent = rd.name; routeSelect.appendChild(o); availableRouteNames.add(rd.name); } });
        if (previousRouteValue && availableRouteNames.has(previousRouteValue)) { routeSelect.value = previousRouteValue; } else { routeSelect.value = ""; }
    }
    function populateStopSelect(selectedRouteName) {
        stopSelect.innerHTML = '<option value="">-- Elige una parada --</option>'; stopSelect.disabled = true; currentDisplayedRouteName = selectedRouteName; if (!selectedRouteName) return; const trackingStatus = getTrackingStatus(); let stopsToDisplay = []; let sourceIsTracking = false;
        if (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName && trackingStatus.routeStops) { stopsToDisplay = trackingStatus.routeStops; sourceIsTracking = true; } else { const routeDef = allRoutesDataFromStorage.find(r => r.name === selectedRouteName); if (routeDef) { if (routeDef.startPoint) stopsToDisplay.push(routeDef.startPoint); stopsToDisplay = stopsToDisplay.concat(routeDef.intermediateStops || []); if (routeDef.endPoint) stopsToDisplay.push(routeDef.endPoint); } }
        if (stopsToDisplay.length > 0) { stopsToDisplay.forEach((s, i) => { const o = document.createElement('option'); o.value = i; let dn = s.name || `Parada ${i + 1}`; if (s.type === 'start') dn = `${s.name || 'Inicio'} (Inicio)`; else if (s.type === 'end') dn = `${s.name || 'Fin'} (Fin)`; else if (s.type === 'intermediate' && !s.name) { let ic = 0; for(let k=0; k<=i; k++){ if(stopsToDisplay[k].type === 'intermediate') ic++; } dn = `Parada Intermedia ${ic}`; } o.textContent = dn; stopSelect.appendChild(o); }); stopSelect.disabled = false; stopSelect.dataset.source = sourceIsTracking ? 'tracking' : 'definition'; }
    }
    routeSelect.addEventListener('change', () => { const name = routeSelect.value; const prevStop = stopSelect.value; populateStopSelect(name); if (prevStop && Array.from(stopSelect.options).some(o => o.value === prevStop)) { stopSelect.value = prevStop; } else { stopSelect.value = ""; } updateArrivalTime(); });
    stopSelect.addEventListener('change', () => { updateArrivalTime(); });
    function timeStringToDateTime(timeString, referenceDate = new Date()) { if (!timeString || !timeString.includes(':')) return null; const [h, m] = timeString.split(':').map(Number); const d = new Date(referenceDate); d.setHours(h, m, 0, 0); return d; }
    function getLegDurationMillis(fromStop, toStop) { const d1 = timeStringToDateTime(fromStop.departureTime); const d2 = timeStringToDateTime(toStop.arrivalTime); if (!d1 || !d2) return null; let t2 = new Date(d2); if (t2 < d1) t2.setDate(t2.getDate() + 1); return t2 - d1; }
    function formatRemainingTime(milliseconds) { if (milliseconds === Infinity || isNaN(milliseconds)) return "Calculando..."; if (milliseconds < 0) milliseconds = 0; const s = Math.round(milliseconds / 1000); const m = Math.floor(s / 60); if (m === 0 && s > 0 && s < 60) return "ARRIBANDO"; if (m < 1 && s <= 0) return "ARRIBANDO"; return `${m} min.`; }

    function updateArrivalTime() {
        const selectedRouteNameByPassenger = routeSelect.value; const selectedStopOptionIndex = stopSelect.value;
        if (selectedRouteNameByPassenger === "" || selectedStopOptionIndex === "") { arrivalTimeDisplay.textContent = "Selecciona ruta y parada"; busStatusNote.textContent = ""; lastDataUpdateDisplay.textContent = 'N/A'; return; }
        const passengerSelectedStopListIndex = parseInt(selectedStopOptionIndex); const trackingStatus = getTrackingStatus(); const currentTimeMillis = new Date().getTime();

        if (trackingStatus && trackingStatus.lastUpdateTime) { lastDataUpdateDisplay.textContent = new Date(trackingStatus.lastUpdateTime).toLocaleTimeString(); if (currentTimeMillis - trackingStatus.lastUpdateTime > 90000) { busStatusNote.textContent = "Datos chofer desactualizados. "; } } else { lastDataUpdateDisplay.textContent = 'N/A'; }

        let mode = "offline_or_error"; let indexOfSelectedRouteInQueue = -1;
        if (trackingStatus && !trackingStatus.hasError) { if (trackingStatus.isTracking) { if (trackingStatus.routeName === selectedRouteNameByPassenger) { mode = "active_route"; } else if (trackingStatus.trackingQueueNames && trackingStatus.trackingQueueNames.includes(selectedRouteNameByPassenger)) { indexOfSelectedRouteInQueue = trackingStatus.trackingQueueNames.indexOf(selectedRouteNameByPassenger); if (indexOfSelectedRouteInQueue > trackingStatus.currentRouteIndexInQueue) { mode = "queued_route"; } else { mode = "offline_or_error"; } } else { mode = "offline_or_error"; } } else { mode = "offline_or_error"; } } else if (trackingStatus && trackingStatus.hasError) { mode = "offline_or_error"; busStatusNote.textContent += `Error chofer: ${trackingStatus.errorReason || 'Desconocido'}. `; }

        // --- MODO OFFLINE / ERROR ---
        if (mode === "offline_or_error") {
            arrivalTimeDisplay.textContent = "Sin Servicio"; if (!trackingStatus || !trackingStatus.isTracking) { busStatusNote.textContent += "Chofer fuera de línea."; } else if (!trackingStatus.hasError) { busStatusNote.textContent += ` Chofer en ruta "${trackingStatus?.routeName}".`; } return;
        }

        // --- MODO RUTA ACTIVA ---
        if (mode === "active_route") {
            busStatusNote.textContent = ``; // Limpiar nota para modo activo
            if (!trackingStatus.routeStops || trackingStatus.routeStops.length === 0) { arrivalTimeDisplay.textContent = "Error Ruta"; return; }
            const busRouteStops = trackingStatus.routeStops; const passengerSelectedStopDataOnline = busRouteStops[passengerSelectedStopListIndex]; if (!passengerSelectedStopDataOnline) { arrivalTimeDisplay.textContent = "Error Parada"; return; }
            const busCurrentStopIndexFrom = trackingStatus.currentStopIndexFromWhichDeparted;
            let busDelayOrAheadMillis = trackingStatus.currentBusDelayOrAheadMillis;
            const choferEnPuntoDeInicioAunSinSalir = (busCurrentStopIndexFrom === -1);

            // *** Chequeo BUS YA PASÓ ***
            if (busCurrentStopIndexFrom >= passengerSelectedStopListIndex) { arrivalTimeDisplay.textContent = "Bus ya pasó"; return; }

            // *** Ajuste por "Haciendo Hora" en Inicio ***
            if (choferEnPuntoDeInicioAunSinSalir && busDelayOrAheadMillis > 0) {
                busDelayOrAheadMillis = 0;
            }

            let estimatedTotalMillisToPassengerStop = 0; const scheduledTimeAtBusCurrentPosition = currentTimeMillis + busDelayOrAheadMillis;

            if (choferEnPuntoDeInicioAunSinSalir) {
                const startDepTimeStr = busRouteStops[0].departureTime; const startDepDate = timeStringToDateTime(startDepTimeStr); if (!startDepDate) { arrivalTimeDisplay.textContent = "Error Hor."; return; }
                let timeUntilDep = Math.max(0, startDepDate.getTime() - currentTimeMillis); estimatedTotalMillisToPassengerStop = timeUntilDep;
                if (passengerSelectedStopListIndex > 0) { for (let i = 0; i < passengerSelectedStopListIndex; i++) { const dur = getLegDurationMillis(busRouteStops[i], busRouteStops[i + 1]); if (dur === null) { estimatedTotalMillisToPassengerStop = Infinity; break; } estimatedTotalMillisToPassengerStop += dur; } }
            } else { // Chofer en movimiento
                const busNextIdx = trackingStatus.nextStopIndexTowardsWhichHeading; if (busNextIdx >= busRouteStops.length || busNextIdx < 0) { arrivalTimeDisplay.textContent = "Error Datos"; return; }
                let nextArrivalDT = timeStringToDateTime(busRouteStops[busNextIdx].arrivalTime); if (!nextArrivalDT) { arrivalTimeDisplay.textContent = "Error Hor."; return; }
                let tempNextDT = new Date(scheduledTimeAtBusCurrentPosition); const [h, m] = busRouteStops[busNextIdx].arrivalTime.split(':').map(Number); tempNextDT.setHours(h, m, 0, 0); if (tempNextDT < scheduledTimeAtBusCurrentPosition && (scheduledTimeAtBusCurrentPosition - tempNextDT > 12 * 3600000 )) { tempNextDT.setDate(tempNextDT.getDate() + 1); } nextArrivalDT = tempNextDT;
                let timeToNext = nextArrivalDT - scheduledTimeAtBusCurrentPosition; if (timeToNext < 0) timeToNext = 0; estimatedTotalMillisToPassengerStop = timeToNext;
                for (let i = busNextIdx; i < passengerSelectedStopListIndex; i++) { const dur = getLegDurationMillis(busRouteStops[i], busRouteStops[i + 1]); if (dur === null) { estimatedTotalMillisToPassengerStop = Infinity; break; } estimatedTotalMillisToPassengerStop += dur; }
            }
            arrivalTimeDisplay.textContent = formatRemainingTime(estimatedTotalMillisToPassengerStop); return;
        }

        // --- MODO RUTA EN COLA ---
        if (mode === "queued_route") {
            busStatusNote.textContent = `Bus en ruta anterior. Calculando para ${selectedRouteNameByPassenger}...`;
            const activeStops = trackingStatus.routeStops; if (!activeStops || activeStops.length === 0) { arrivalTimeDisplay.textContent = "Error Activa"; return; }
            let timeToFinishActive = 0; const activeLastIdx = activeStops.length - 1; const activeFromIdx = trackingStatus.currentStopIndexFromWhichDeparted; let activeDelay = trackingStatus.currentBusDelayOrAheadMillis; const activeAtStart = (activeFromIdx === -1);
            if (activeAtStart && activeDelay > 0) activeDelay = 0; const schedTimeActive = currentTimeMillis + activeDelay;
            if (activeAtStart) { const startDepActive = timeStringToDateTime(activeStops[0].departureTime); if (!startDepActive) { arrivalTimeDisplay.textContent = "Error H.Act"; return; } timeToFinishActive = Math.max(0, startDepActive.getTime() - currentTimeMillis); for (let i = 0; i < activeLastIdx; i++) { const dur = getLegDurationMillis(activeStops[i], activeStops[i+1]); if(dur === null) { timeToFinishActive = Infinity; break; } timeToFinishActive += dur; } }
            else { const activeNextIdx = trackingStatus.nextStopIndexTowardsWhichHeading; if (activeNextIdx > activeLastIdx || activeNextIdx < 0) { arrivalTimeDisplay.textContent = "Error D.Act"; return;} let nextArrActive = timeStringToDateTime(activeStops[activeNextIdx].arrivalTime); if(!nextArrActive) { arrivalTimeDisplay.textContent = "Error H.Act"; return;} let tempNextActive = new Date(schedTimeActive); const [h, m] = activeStops[activeNextIdx].arrivalTime.split(':').map(Number); tempNextActive.setHours(h, m, 0, 0); if (tempNextActive < schedTimeActive && (schedTimeActive - tempNextActive > 12*3600000)) { tempNextActive.setDate(tempNextActive.getDate() + 1); } nextArrActive = tempNextActive; let timeCurrentLegActive = nextArrActive - schedTimeActive; if (timeCurrentLegActive < 0) timeCurrentLegActive = 0; timeToFinishActive = timeCurrentLegActive; for (let i = activeNextIdx; i < activeLastIdx; i++) { const dur = getLegDurationMillis(activeStops[i], activeStops[i+1]); if(dur === null) { timeToFinishActive = Infinity; break; } timeToFinishActive += dur; } }
            if (timeToFinishActive === Infinity) { arrivalTimeDisplay.textContent = "Calculando..."; return; }

            const queuedRouteDef = allRoutesDataFromStorage.find(r => r.name === selectedRouteNameByPassenger); if (!queuedRouteDef || !queuedRouteDef.startPoint || !queuedRouteDef.endPoint) { arrivalTimeDisplay.textContent = "Error R.Cola"; return; }
            let timeInQueued = 0; let queuedStops = []; if (queuedRouteDef.startPoint) queuedStops.push(queuedRouteDef.startPoint); queuedStops = queuedStops.concat(queuedRouteDef.intermediateStops || []); if (queuedRouteDef.endPoint) queuedStops.push(queuedRouteDef.endPoint);
            const targetStopQueued = queuedStops[passengerSelectedStopListIndex]; if (!targetStopQueued) { arrivalTimeDisplay.textContent = "Error P.Cola"; return;}
            for (let i = 0; i < passengerSelectedStopListIndex; i++) { const dur = getLegDurationMillis(queuedStops[i], queuedStops[i+1]); if(dur === null) { timeInQueued = Infinity; break; } timeInQueued += dur; }
            if (timeInQueued === Infinity) { arrivalTimeDisplay.textContent = "Calculando..."; return; }

            const estArrivalEndActive = currentTimeMillis + timeToFinishActive;
            const schedStartQueued = timeStringToDateTime(queuedRouteDef.startPoint.departureTime); if(!schedStartQueued) { arrivalTimeDisplay.textContent = "Error H.Cola"; return; }
            let totalProjTime; if (estArrivalEndActive <= schedStartQueued.getTime()) { totalProjTime = (schedStartQueued.getTime() - currentTimeMillis) + timeInQueued; } else { totalProjTime = timeToFinishActive + timeInQueued; }
            arrivalTimeDisplay.textContent = formatRemainingTime(totalProjTime); return;
        }
    }

    // --- INICIALIZACIÓN Y ACTUALIZACIÓN PERIÓDICA ---
    populateRouteSelect();
    updateArrivalTime();

    if (passengerUpdateInterval) clearInterval(passengerUpdateInterval);
    passengerUpdateInterval = setInterval(() => {
        const previousRouteValue = routeSelect.value; const previousStopValue = stopSelect.value;
        populateRouteSelect();
        if (Array.from(routeSelect.options).some(o => o.value === previousRouteValue)) { routeSelect.value = previousRouteValue; } else { routeSelect.value = ""; }
        const selectedRouteName = routeSelect.value;
        const trackingStatus = getTrackingStatus(); const isNowOnlineForThis = (trackingStatus && trackingStatus.isTracking && trackingStatus.routeName === selectedRouteName); const srcChanged = (stopSelect.dataset.source === 'tracking') !== isNowOnlineForThis;
        if (currentDisplayedRouteName !== selectedRouteName || srcChanged) { populateStopSelect(selectedRouteName); }
        if (previousStopValue && Array.from(stopSelect.options).some(o => o.value === previousStopValue)) { stopSelect.value = previousStopValue; } else { stopSelect.value = ""; }
        updateArrivalTime();
    }, 7000);
});
