'use strict';

// --- VARIABLES GLOBALES ---
let map;
let routePoints = [];
let routeLineEdit;
let trackingRouteLine;
let userMarker;
let trackingIntervalId;
let isTracking = false;
let currentSegmentStartIndex = 0;
let lastKnownPosition = null;
let currentStopRadius = 50;
let currentRouteNameForTracking = "";
let waypointsVisible = false;

// NUEVAS VARIABLES PARA SEGUIMIENTO MEJORADO Y UI
let deviationDisplayIntervalId = null;
let latestDeviationMillis = null;
let isEtaDebugVisible = false;
let lastDeviationCalculation = {};
let isMapVisibleInLandscape = false; // Estado de la UI para modo horizontal
const CACHE_PREFIX = 'smartMovePro_unidir_simple_route_';
const ROUTE_QUEUE_CACHE_KEY = 'smartMovePro_unidir_simple_routeQueue';
let trackingState = { activeLegPoints: [] };


// --- INICIALIZACIÓN Y LÓGICA DE PWA ---
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadSavedRoutesLists();
    updateStopsList();
    updateManualNavButtons();

    // Registrar Service Worker para PWA/Offline
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                console.log('Service Worker registrado con éxito:', registration);
            })
            .catch(error => {
                console.log('Error al registrar el Service Worker:', error);
            });
    }

    // Listeners para cambio de orientación y tamaño
    window.addEventListener('resize', handleOrientationChange);
    window.addEventListener('orientationchange', handleOrientationChange);
});


// --- GESTIÓN DE LA INTERFAZ (MODO HORIZONTAL) ---

function handleOrientationChange() {
    if (!isTracking) return;

    const isLandscape = window.matchMedia("(orientation: landscape)").matches;
    const body = document.body;
    const toggleMapBtn = document.getElementById('toggleMapBtn');

    if (isLandscape) {
        body.classList.add('landscape-tracking-active');
        toggleMapBtn.style.display = 'block';
        // Asegurarse de que el estado visual coincide con el estado lógico
        if (isMapVisibleInLandscape) {
            body.classList.add('map-visible');
            toggleMapBtn.textContent = 'Ocultar Mapa';
        } else {
            body.classList.remove('map-visible');
            toggleMapBtn.textContent = 'Ver Mapa';
        }
    } else {
        // Si vuelve a vertical, limpiar todas las clases de estado horizontal
        body.classList.remove('landscape-tracking-active', 'map-visible');
        toggleMapBtn.style.display = 'none';
    }
    
    // Invalidar el tamaño del mapa para que se redibuje correctamente
    setTimeout(() => map.invalidateSize(), 200);
}

function toggleMapView() {
    isMapVisibleInLandscape = !isMapVisibleInLandscape;
    // Llamar a handleOrientationChange para que actualice la UI según el nuevo estado
    handleOrientationChange();
}


// --- FUNCIONES DE INICIALIZACIÓN Y UTILIDADES ---

function generateUniqueId() { return Date.now().toString(36) + Math.random().toString(36).substring(2); }

function createDivIcon(text, pointCategory = '', isStartPoint = false) {
    let htmlContent = '';
    let iconSize = [30, 30]; let iconAnchor = [15, 15]; let className = 'leaflet-div-icon';

    if (pointCategory === 'waypoint') {
        className += ' waypoint-marker-icon'; iconSize = [12, 12]; iconAnchor = [6, 6];
    } else if (pointCategory === 'lineEndpoint') {
        const bgColor = isStartPoint ? '#FF8C00' : '#DA70D6';
        const P_char = text ? text.substring(0, 2).toUpperCase() : (isStartPoint ? 'PI' : 'PF');
        htmlContent = `<div style="background-color:${bgColor}; width: 28px; height:28px; display:flex; justify-content:center; align-items:center; border-radius: 50%; color: white; font-size:14px; font-weight:bold; border: 2px solid white;">${P_char}</div>`;
        iconSize = [32, 32]; iconAnchor = [16, 16];
    } else {
        className += ' intermediate-stop-icon'; const displayText = text || '?'; htmlContent = displayText;
        const tempSpan = document.createElement('span'); tempSpan.style.fontSize = '12px'; tempSpan.style.fontWeight = 'bold'; tempSpan.style.visibility = 'hidden'; tempSpan.style.position = 'absolute'; tempSpan.textContent = displayText; document.body.appendChild(tempSpan);
        const textWidth = tempSpan.offsetWidth; document.body.removeChild(tempSpan);
        iconSize = [Math.max(15, textWidth) + 16, 20 + 10]; iconAnchor = [iconSize[0] / 2, iconSize[1] / 2];
    }
    return L.divIcon({ className: className, html: htmlContent, iconSize: iconSize, iconAnchor: iconAnchor });
}

function createUserLocationIcon() { return L.divIcon({ className: 'user-location-icon', iconSize: [16, 16], iconAnchor: [8, 8] }); }

function initMap() {
    map = L.map('map').setView([-34.6037, -58.3816], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    
    map.on('click', onMapClick);
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => map.setView([pos.coords.latitude, pos.coords.longitude], 13));
    }

    document.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            header.classList.toggle('active');
            content.classList.toggle('active');
        });
    });

    redrawRouteLine();
    updateStopsList();
}


// --- LÓGICA DE EDICIÓN DE RUTA ---

function onMapClick(e) {
    if (isTracking) return;
    if (map.dragging && map.dragging.moved()) return;

    const content = `
        <div style="text-align:center;">
            <p style="margin:0 0 10px 0; font-weight:bold;">Añadir punto aquí:</p>
            <button class="btn-secondary btn-sm" onclick="addPointFromPopup('lineEndpoint', ${e.latlng.lat}, ${e.latlng.lng})">Inicio/Final</button>
            <button class="btn-info btn-sm" onclick="addPointFromPopup('intermediateStop', ${e.latlng.lat}, ${e.latlng.lng})">Parada</button>
            <button class="btn-sm" style="background-color:#888" onclick="addPointFromPopup('waypoint', ${e.latlng.lat}, ${e.latlng.lng})">Paso</button>
        </div>
    `;
    L.popup().setLatLng(e.latlng).setContent(content).openOn(map);
}

function addPointFromPopup(pointCategory, lat, lng) {
    map.closePopup();
    const latlng = L.latLng(lat, lng);
    let newPointData = {
        id: generateUniqueId(), lat: latlng.lat, lng: latlng.lng,
        originalIndex: routePoints.length,
        pointCategory: pointCategory
    };

    switch (pointCategory) {
        case 'waypoint':
            newPointData.name = `Paso ${routePoints.filter(p => p.pointCategory === 'waypoint').length + 1}`;
            break;
        case 'intermediateStop':
            newPointData.name = `Parada ${routePoints.filter(p => p.pointCategory === 'intermediateStop').length + 1}`;
            newPointData.scheduledTime = null;
            break;
        case 'lineEndpoint':
            const currentLineEndpoints = routePoints.filter(p => p.pointCategory === 'lineEndpoint');
            if (currentLineEndpoints.length >= 2) {
                alert("Ya existen un Punto de Inicio y un Punto Final. Elimine uno para añadir otro.");
                return;
            }
            const hasStartPoint = currentLineEndpoints.some(p => p.isStartPoint);
            newPointData.isStartPoint = !hasStartPoint;
            newPointData.name = newPointData.isStartPoint ? "Punto de Inicio" : "Punto Final";
            newPointData.schedule = { scheduledTime: null };
            break;
    }
    createAndAddMarker(newPointData);
}

function createAndAddMarker(pointData) {
    const newPoint = { ...pointData };

    newPoint.marker = L.marker([newPoint.lat, newPoint.lng], {
        icon: createDivIcon(newPoint.name, newPoint.pointCategory, newPoint.isStartPoint),
        draggable: true
    }).addTo(map);

    if (newPoint.pointCategory !== 'waypoint') {
        const circleColor = (newPoint.pointCategory === 'lineEndpoint') ? (newPoint.isStartPoint ? '#FF8C00' : '#DA70D6') : '#2196F3';
        newPoint.radiusCircle = L.circle([newPoint.lat, newPoint.lng], {
            radius: currentStopRadius, color: circleColor, weight: 1, opacity: 0.5,
            fillColor: circleColor, fillOpacity: 0.2
        }).addTo(map);
    }

    newPoint.marker.on('dragend', (event) => {
        if (isTracking) { event.target.setLatLng(L.latLng(newPoint.lat, newPoint.lng)); return; }
        const pos = event.target.getLatLng(); newPoint.lat = pos.lat; newPoint.lng = pos.lng;
        if (newPoint.radiusCircle) newPoint.radiusCircle.setLatLng(pos);
        redrawRouteLine();
        if (document.getElementById('autoCalcTimes').checked) calculateAndApplyAllIntermediateTimes();
    });

    newPoint.marker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        if (isTracking) return;
        openEditPopup(newPoint);
    });

    routePoints.push(newPoint);
    routePoints.sort((a, b) => a.originalIndex - b.originalIndex);
    routePoints.forEach((p, idx) => p.originalIndex = idx);

    updateAllMarkerIconsAndLabels();
    redrawRouteLine();
    updateStopsList();
    if (document.getElementById('autoCalcTimes').checked) calculateAndApplyAllIntermediateTimes();

    if (newPoint.pointCategory !== 'waypoint') {
        openEditPopup(newPoint);
    }
}

function formatDateTimeForInput(date) {
    if (!date || isNaN(new Date(date).getTime())) return "";
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

function openEditPopup(point) {
    let formContent = `
        <div class="popup-form-field">
          <label for="popup_pointName">Nombre:</label>
          <input type="text" id="popup_pointName" value="${point.name || ''}" ${point.pointCategory === 'waypoint' ? 'readonly' : ''}>
        </div>`;

    if (point.pointCategory === 'lineEndpoint' || point.pointCategory === 'intermediateStop') {
        const timeValue = point.pointCategory === 'lineEndpoint' ? (point.schedule ? point.schedule.scheduledTime : null) : point.scheduledTime;
        const dateObj = timeValue ? new Date(timeValue) : null;
        const secondsValue = dateObj ? dateObj.getSeconds() : 0;
        let label = '';
        if (point.pointCategory === 'lineEndpoint') {
            label = point.isStartPoint ? 'Salida Programada (HH:MM:SS):' : 'Llegada Programada (HH:MM:SS):';
        } else {
            label = 'Horario Programado (HH:MM:SS):';
        }
        formContent += `
            <div class="popup-form-field">
                <label for="popup_scheduledTime">${label}</label>
                <div class="popup-form-field-group">
                   <div>
                        <input type="datetime-local" id="popup_scheduledTime" value="${formatDateTimeForInput(timeValue)}">
                   </div>
                   <div>
                        <input type="number" id="popup_scheduledSeconds" min="0" max="59" value="${secondsValue}" title="Segundos">
                   </div>
                </div>
            </div>`;
    }
    
    formContent += `
        <div class="popup-actions">
          <button class="btn-danger btn-sm" onclick="deletePoint('${point.id}')">Borrar</button>
          <button class="btn-primary btn-sm" onclick="updatePointFromPopup('${point.id}')">Guardar</button>
        </div>
    `;
    
    L.popup({ minWidth: 300, closeButton: true })
        .setLatLng([point.lat, point.lng])
        .setContent(formContent)
        .openOn(map);
}

function updatePointFromPopup(pointId) {
    const point = routePoints.find(p => p.id === pointId);
    if (!point) return;

    const newName = document.getElementById('popup_pointName').value.trim();
    if (newName) point.name = newName;

    const timeInput = document.getElementById('popup_scheduledTime');
    if (timeInput) {
        const timeValue = timeInput.value;
        const secondsValue = parseInt(document.getElementById('popup_scheduledSeconds').value, 10) || 0;
        
        const dateVal = timeValue ? new Date(timeValue) : null;
        if (timeValue && isNaN(dateVal?.getTime())) {
            alert("Formato de fecha/hora inválido."); return;
        }

        if (dateVal) {
            dateVal.setSeconds(secondsValue, 0); // Establecer segundos y resetear milisegundos
        }
        
        if (point.pointCategory === 'lineEndpoint') {
            if (!point.schedule) point.schedule = {};
            point.schedule.scheduledTime = dateVal;
        } else {
            point.scheduledTime = dateVal;
        }
    }

    map.closePopup();
    updateAllMarkerIconsAndLabels();
    updateStopsList();
    if (document.getElementById('autoCalcTimes').checked) {
        calculateAndApplyAllIntermediateTimes();
    }
}

function deletePoint(pointId) {
    const point = routePoints.find(p => p.id === pointId);
    if (!point) return;

    if (confirm(`¿Seguro que quieres borrar el punto "${point.name}"?`)) {
        map.closePopup();
        map.removeLayer(point.marker);
        if (point.radiusCircle) map.removeLayer(point.radiusCircle);
        
        routePoints = routePoints.filter(p => p.id !== pointId);

        updateAllMarkerIconsAndLabels();
        redrawRouteLine();
        updateStopsList();
        if (document.getElementById('autoCalcTimes').checked) calculateAndApplyAllIntermediateTimes();
    }
}

function toggleWaypointVisibility() {
    waypointsVisible = !waypointsVisible;
    routePoints.forEach(p => {
        if (p.pointCategory === 'waypoint' && p.marker) {
            if (waypointsVisible) {
                if (!map.hasLayer(p.marker)) map.addLayer(p.marker);
            } else {
                if (map.hasLayer(p.marker)) map.removeLayer(p.marker);
            }
        }
    });
}

function updateAllMarkerIconsAndLabels() {
    const displayOrderedPoints = getSortedRoutePointsForDisplay();
    routePoints.forEach(p => {
        if (p.marker) {
            let text = '';
            if (p.pointCategory === 'lineEndpoint') { text = p.name; } 
            else if (p.pointCategory === 'intermediateStop') {
                const displayIdx = displayOrderedPoints.filter(dp => dp.pointCategory === 'intermediateStop').findIndex(dp => dp.id === p.id);
                text = (displayIdx !== -1) ? String(displayIdx + 1) : '?';
            }
            p.marker.setIcon(createDivIcon(text, p.pointCategory, p.isStartPoint));
        }
    });
}


// --- LÓGICA DE LA LISTA DE PUNTOS ---

function updateStopsList() {
    const listDiv = document.getElementById('stopsList');
    const displayPoints = getSortedRoutePointsForDisplay();

    if (displayPoints.length === 0) {
        listDiv.innerHTML = "<p style='color:#8b949e; text-align:center;'>No hay paradas o puntos de inicio/final definidos.</p>";
        return;
    }

    let html = "";
    let intermediateVisualCounter = 1;

    displayPoints.forEach((p) => {
        let typeText = "", timeStr = "N/A";
        let itemClass = "stop-item";

        if (p.pointCategory === 'lineEndpoint') {
            itemClass += " line-endpoint-highlight";
            typeText = p.isStartPoint ? "P. Inicio" : "P. Final";
            if (p.schedule && p.schedule.scheduledTime) {
                timeStr = `${p.isStartPoint ? 'Sale' : 'Llega'}: ${formatTime(p.schedule.scheduledTime, true)}`;
            } else {
                timeStr = "Horario no definido";
            }
        } else if (p.pointCategory === 'intermediateStop') {
            typeText = `Parada ${intermediateVisualCounter++}`;
            timeStr = `Prog: ${formatTime(p.scheduledTime, true)}`;
        }

        html += `
            <div class="${itemClass}" id="stop-list-item-${p.id}">
                <div class="stop-item-info">
                    <p class="stop-name">${p.name}</p>
                    <p>${typeText} - ${timeStr}</p>
                </div>
                <div class="stop-item-actions">
                    <button class="btn-secondary btn-sm" onclick="focusAndEditPoint('${p.id}')">✏️</button>
                    <button class="btn-danger btn-sm" onclick="deletePoint('${p.id}')">🗑️</button>
                </div>
            </div>`;
    });
    listDiv.innerHTML = html;
    highlightNextStopInList();
}

function focusAndEditPoint(pointId) {
    const point = routePoints.find(p => p.id === pointId);
    if (point) {
        map.setView([point.lat, point.lng], Math.max(map.getZoom(), 17));
        setTimeout(() => openEditPopup(point), 200);
    }
}

function highlightNextStopInList() {
    document.querySelectorAll('.stop-item').forEach(item => item.classList.remove('next-stop-highlight'));
    let nextStopName = "N/A";

    if (isTracking && trackingState.activeLegPoints && trackingState.activeLegPoints.length > 0) {
        const nextStopInfo = getNextDisplayableStop();
        if (nextStopInfo.point) {
            nextStopName = nextStopInfo.point.name;
            const itemInList = document.getElementById(`stop-list-item-${nextStopInfo.point.id}`);
            if (itemInList) { itemInList.classList.add('next-stop-highlight'); }
        } else {
            nextStopName = "Fin de Ruta";
        }
    } else if (!isTracking) {
        const displayPoints = getSortedRoutePointsForDisplay();
        if (displayPoints.length > 0) { nextStopName = displayPoints[0].name; }
    }
    document.getElementById('nextStopDisplay').textContent = `Próxima: ${nextStopName}`;
}


// --- LÓGICA DE SEGUIMIENTO ---

function startTracking() {
    const startPoint = routePoints.find(p => p.pointCategory === 'lineEndpoint' && p.isStartPoint);
    const endPoint = routePoints.find(p => p.pointCategory === 'lineEndpoint' && !p.isStartPoint);
    if (!startPoint || !endPoint) { alert("La ruta debe tener un Punto de Inicio y un Punto Final."); return; }
    
    if (!getEndpointScheduledTime(startPoint) || !getEndpointScheduledTime(endPoint)) {
        alert(`Horarios incompletos para Punto Inicio/Final. No se puede iniciar seguimiento.`); return;
    }
    if (document.getElementById('autoCalcTimes').checked) { calculateAndApplyAllIntermediateTimes(); }

    isTracking = true;
    currentRouteNameForTracking = document.getElementById('routeName').value || "Ruta Actual";

    if (!setupCurrentLegForTracking()) {
        stopTracking(false, "Error configurando ruta inicial.");
        return;
    }
    
    document.getElementById('mainControlsContainer').style.display = 'none';
    document.getElementById('trackingDashboard').style.display = 'block';

    redrawRouteLine();
    if(waypointsVisible) toggleWaypointVisibility();

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            initialPosition => {
                lastKnownPosition = initialPosition;
                const { latitude, longitude } = initialPosition.coords;
                if (userMarker) userMarker.setLatLng([latitude, longitude]);
                else userMarker = L.marker([latitude, longitude], { icon: createUserLocationIcon() }).addTo(map);
                map.setView([latitude, longitude], 16);

                if (trackingState.activeLegPoints && trackingState.activeLegPoints.length > 0) {
                    let closestPointIndex = 0; let minDistance = Infinity;
                    trackingState.activeLegPoints.forEach((point, index) => {
                        const distance = L.latLng(latitude, longitude).distanceTo(L.latLng(point.lat, point.lng));
                        if (distance < minDistance) { minDistance = distance; closestPointIndex = index; }
                    });
                     currentSegmentStartIndex = closestPointIndex;
                     if (currentSegmentStartIndex >= trackingState.activeLegPoints.length -1 && trackingState.activeLegPoints.length > 1) {
                         currentSegmentStartIndex = trackingState.activeLegPoints.length - 2;
                     }
                } else currentSegmentStartIndex = 0;

                trackingIntervalId = navigator.geolocation.watchPosition(
                    handlePositionUpdate, handleGeolocationError,
                    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
                );
                finalizeTrackingStart();
            },
            initialPositionError => {
                console.warn("No se pudo obtener la posición inicial:", initialPositionError.message);
                currentSegmentStartIndex = 0;
                if (trackingState.activeLegPoints.length > 0 && trackingState.activeLegPoints[0]) {
                    map.setView([trackingState.activeLegPoints[0].lat, trackingState.activeLegPoints[0].lng], 16);
                }
                trackingIntervalId = navigator.geolocation.watchPosition(
                    handlePositionUpdate, handleGeolocationError,
                    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
                );
                finalizeTrackingStart();
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    } else {
        alert("Geolocalización no disponible.");
        stopTracking(false, "Geolocalización no disponible");
    }
}

function finalizeTrackingStart() {
    if (!isTracking) return;
    document.getElementById('trackingInfoDisplay').textContent = `En ruta: ${currentRouteNameForTracking}`;

    latestDeviationMillis = null;
    if (deviationDisplayIntervalId) clearInterval(deviationDisplayIntervalId);
    deviationDisplayIntervalId = setInterval(updateDeviationDisplay, 5000);

    if (lastKnownPosition) calculateTimeDeviation(lastKnownPosition);
    updateDeviationDisplay(); // Primera actualización inmediata

    highlightNextStopInList();
    updateManualNavButtons();
    updateTrackingStopsList();
    if (isEtaDebugVisible) {
        updateEtaDebugInfo();
    }
    
    // Aplicar estado de UI al iniciar
    handleOrientationChange(); 
}

function stopTracking(completedNaturally = false, reason = "") {
    if (trackingIntervalId) navigator.geolocation.clearWatch(trackingIntervalId);
    if (deviationDisplayIntervalId) clearInterval(deviationDisplayIntervalId);
    trackingIntervalId = null; deviationDisplayIntervalId = null; isTracking = false; lastKnownPosition = null;
    
    document.getElementById('mainControlsContainer').style.display = 'block';
    document.getElementById('trackingDashboard').style.display = 'none';
    document.getElementById('trackingStopsList').innerHTML = '';

    if (isEtaDebugVisible) {
        const debugPanel = document.getElementById('etaDebugPanel');
        const debugBtn = document.getElementById('toggleEtaDebugBtn');
        isEtaDebugVisible = false;
        if(debugPanel) debugPanel.style.display = 'none';
        if(debugPanel) debugPanel.innerHTML = '';
        if(debugBtn) debugBtn.textContent = '🐛 Debug ETA';
    }

    if (userMarker) { map.removeLayer(userMarker); userMarker = null; }

    redrawRouteLine();
    updateStopsList();
    currentSegmentStartIndex = 0;
    updateManualNavButtons();
    currentRouteNameForTracking = "";
    
    // Limpiar clases de estado de la UI
    document.body.classList.remove('landscape-tracking-active', 'map-visible');
    document.getElementById('toggleMapBtn').style.display = 'none';
    isMapVisibleInLandscape = false; // Resetear estado lógico
    // Forzar un resize del mapa para que vuelva a su tamaño original en el layout
    setTimeout(() => map.invalidateSize(), 100);

    if (completedNaturally) {
        alert("Ruta completada!"); checkRouteQueue();
    } else {
        const msg = "Seguimiento detenido." + (reason ? " Razón: " + reason : "");
        console.log(msg); if (reason && reason.startsWith("Error")) alert(msg);
    }
}

function handlePositionUpdate(position) {
    lastKnownPosition = position;
    const { latitude, longitude, speed } = position.coords;
    if (!userMarker) userMarker = L.marker([latitude, longitude], { icon: createUserLocationIcon() }).addTo(map);
    else userMarker.setLatLng([latitude, longitude]);
    document.getElementById('speedDisplay').textContent = `Velocidad: ${(speed ? (speed * 3.6) : 0).toFixed(1)} KM/H`;
    if (!isTracking || !trackingState.activeLegPoints || trackingState.activeLegPoints.length === 0) return;
    const manualNav = document.getElementById('manualStopNav').checked;
    if (!manualNav) {
        if (currentSegmentStartIndex >= trackingState.activeLegPoints.length - 1) { handleEndOfRoute(); if (!isTracking) return; }
        else {
            const nextStopInfo = getNextDisplayableStop();
            if (nextStopInfo.point) {
                const distanceToTarget = L.latLng(latitude, longitude).distanceTo(L.latLng(nextStopInfo.point.lat, nextStopInfo.point.lng));
                if (distanceToTarget < currentStopRadius) {
                    currentSegmentStartIndex = nextStopInfo.index;
                    if (currentSegmentStartIndex >= trackingState.activeLegPoints.length - 1) { handleEndOfRoute(); if (!isTracking) return; }
                }
            }
        }
    }
    if (isTracking) { 
        calculateTimeDeviation(position); 
        highlightNextStopInList(); 
        updateManualNavButtons();
        updateTrackingStopsList();
        if (isEtaDebugVisible) {
            updateEtaDebugInfo();
        }
    }
}


// --- LÓGICA DE NAVEGACIÓN MANUAL ---

function updateManualNavButtons() {
    const manualNav = document.getElementById('manualStopNav').checked;
    const prevBtn = document.getElementById('prevStopBtn'); const nextBtn = document.getElementById('nextStopBtn');
    if (isTracking && manualNav && trackingState.activeLegPoints && trackingState.activeLegPoints.length > 0) {
        prevBtn.style.display = 'inline-block'; nextBtn.style.display = 'inline-block';
        prevBtn.disabled = currentSegmentStartIndex === 0;
        nextBtn.disabled = currentSegmentStartIndex >= trackingState.activeLegPoints.length - 1;
    } else { prevBtn.style.display = 'none'; nextBtn.style.display = 'none'; }
}

function advanceToNextActivePoint() {
    const nextStopInfo = getNextDisplayableStop();
    if (nextStopInfo.point) {
        currentSegmentStartIndex = nextStopInfo.index;
    } else if (currentSegmentStartIndex < trackingState.activeLegPoints.length - 1) {
        currentSegmentStartIndex = trackingState.activeLegPoints.length - 1;
    }
    if (currentSegmentStartIndex >= trackingState.activeLegPoints.length - 1 ) { handleEndOfRoute(); }
}

function handleEndOfRoute() { if (!isTracking) return; stopTracking(true); }

function goToPreviousActivePoint() {
    if (!isTracking || currentSegmentStartIndex === 0) return;
    let prevStopIndex = -1;
    for (let i = currentSegmentStartIndex - 1; i >= 0; i--) {
        if (trackingState.activeLegPoints[i].pointCategory !== 'waypoint') {
            let targetIndex = -1;
            for (let j = i - 1; j >= 0; j--) {
                if (trackingState.activeLegPoints[j].pointCategory !== 'waypoint') {
                    targetIndex = j; break;
                }
            }
            prevStopIndex = (targetIndex !== -1) ? targetIndex : 0;
            break;
        }
    }
    if(prevStopIndex === -1 && currentSegmentStartIndex > 0) prevStopIndex = 0;
    
    if(prevStopIndex !== -1) currentSegmentStartIndex = prevStopIndex;

    if (lastKnownPosition) calculateTimeDeviation(lastKnownPosition);
    highlightNextStopInList(); updateManualNavButtons(); updateTrackingStopsList();
    if (isEtaDebugVisible) updateEtaDebugInfo();
}

function goToNextActivePoint() {
    if (!isTracking || !trackingState.activeLegPoints || currentSegmentStartIndex >= trackingState.activeLegPoints.length -1 ) return;
    advanceToNextActivePoint();
    if (isTracking) { 
        if (lastKnownPosition) calculateTimeDeviation(lastKnownPosition); 
        highlightNextStopInList(); 
        updateManualNavButtons(); 
        updateTrackingStopsList();
        if (isEtaDebugVisible) updateEtaDebugInfo();
    }
}


// --- LÓGICA DE CÁLCULO (HORARIOS, DESVÍO, ETC.) ---

function calculateTimeDeviation(currentUserGeoPosition) {
    lastDeviationCalculation = {}; // Reset debug info

    if (!isTracking || !trackingState.activeLegPoints || trackingState.activeLegPoints.length === 0 || !currentUserGeoPosition) {
        latestDeviationMillis = null;
        lastDeviationCalculation.reason = "Seguimiento inactivo o sin datos.";
        return;
    }

    const currentTime = new Date().getTime();
    const legPoints = trackingState.activeLegPoints;
    let pointA = null, pointB = null;

    for (let i = currentSegmentStartIndex; i >= 0; i--) {
        if (legPoints[i].pointCategory !== 'waypoint' && legPoints[i].effectiveScheduledTime) { pointA = legPoints[i]; break; }
    }
    if (!pointA && legPoints[0] && legPoints[0].pointCategory !== 'waypoint' && legPoints[0].effectiveScheduledTime) { pointA = legPoints[0]; }
    
    for (let i = currentSegmentStartIndex + 1; i < legPoints.length; i++) {
        if (legPoints[i].pointCategory !== 'waypoint' && legPoints[i].effectiveScheduledTime) { pointB = legPoints[i]; break; }
    }
    if (!pointB && legPoints[legPoints.length - 1] && legPoints[legPoints.length - 1].pointCategory !== 'waypoint' && legPoints[legPoints.length - 1].effectiveScheduledTime) {
        if (!pointA || pointA.id !== legPoints[legPoints.length - 1].id) { pointB = legPoints[legPoints.length - 1]; }
    }

    if (!pointA || !pointB) {
        let reason = "No se pudo determinar un segmento A->B válido.";
        if (pointA && pointA.effectiveScheduledTime) {
            latestDeviationMillis = new Date(pointA.effectiveScheduledTime).getTime() - currentTime;
            reason = `Solo se encontró el punto A (${pointA.name}). Desvío respecto a su hora.`;
        } else if (pointB && pointB.effectiveScheduledTime) {
            latestDeviationMillis = new Date(pointB.effectiveScheduledTime).getTime() - currentTime;
            reason = `Solo se encontró el punto B (${pointB.name}). Desvío respecto a su hora.`;
        } else { latestDeviationMillis = null; }
        lastDeviationCalculation = { deviation: latestDeviationMillis, reason: reason, pointA: pointA?.name, pointB: pointB?.name };
        return;
    }
    
    if (pointA.id === pointB.id) {
        latestDeviationMillis = new Date(pointA.effectiveScheduledTime).getTime() - currentTime;
        lastDeviationCalculation = { deviation: latestDeviationMillis, reason: "Punto A y B son el mismo.", pointA: pointA.name, pointB: pointB.name };
        return;
    }
    
    lastDeviationCalculation.pointA = pointA.name;
    lastDeviationCalculation.pointB = pointB.name;
    
    const timeA = new Date(pointA.effectiveScheduledTime).getTime();
    const timeB = new Date(pointB.effectiveScheduledTime).getTime();
    const segmentTotalScheduledMillis = timeB - timeA;

    if (segmentTotalScheduledMillis < 0) {
        latestDeviationMillis = timeB - currentTime;
        lastDeviationCalculation = { deviation: latestDeviationMillis, reason: "El segmento tiene duración negativa. Usando hora de B.", ...lastDeviationCalculation };
        return;
    }
    if (segmentTotalScheduledMillis === 0) {
        latestDeviationMillis = timeA - currentTime;
        lastDeviationCalculation = { deviation: latestDeviationMillis, reason: "El segmento tiene duración cero. Usando hora de A.", ...lastDeviationCalculation };
        return;
    }

    const startIndex = legPoints.findIndex(p => p.id === pointA.id);
    const endIndex = legPoints.findIndex(p => p.id === pointB.id);
    const segmentPathPoints = legPoints.slice(startIndex, endIndex + 1);

    let totalSegmentDistanceAlongTrace = 0;
    const subSegmentLengths = [];
    for (let i = 0; i < segmentPathPoints.length - 1; i++) {
        const dist = L.latLng(segmentPathPoints[i].lat, segmentPathPoints[i].lng).distanceTo(L.latLng(segmentPathPoints[i+1].lat, segmentPathPoints[i+1].lng));
        totalSegmentDistanceAlongTrace += dist;
        subSegmentLengths.push(dist);
    }
    
    let progressPercentage;

    if (totalSegmentDistanceAlongTrace < 1.0) {
        progressPercentage = 0.0;
        lastDeviationCalculation.reason = "Distancia del segmento en la traza es casi cero.";
    } else {
        const currentUserLatLng = L.latLng(currentUserGeoPosition.coords.latitude, currentUserGeoPosition.coords.longitude);
        let minDistanceOffTrace = Infinity;
        let finalProgressAlongTrace = 0;
        let distanceAccumulatedOnTrace = 0;

        for (let i = 0; i < segmentPathPoints.length - 1; i++) {
            const p1 = L.latLng(segmentPathPoints[i].lat, segmentPathPoints[i].lng);
            const p2 = L.latLng(segmentPathPoints[i+1].lat, segmentPathPoints[i+1].lng);
            const segmentLength = subSegmentLengths[i];
            
            let currentDistanceOffTrace;
            let currentProgressOnSegment = 0;

            if (segmentLength >= 1.0) {
                const distUserToP1 = currentUserLatLng.distanceTo(p1);
                const distUserToP2 = currentUserLatLng.distanceTo(p2);
                currentProgressOnSegment = (Math.pow(segmentLength, 2) + Math.pow(distUserToP1, 2) - Math.pow(distUserToP2, 2)) / (2 * segmentLength);

                if (currentProgressOnSegment < 0) {
                    currentDistanceOffTrace = distUserToP1;
                } else if (currentProgressOnSegment > segmentLength) {
                    currentDistanceOffTrace = distUserToP2;
                } else {
                    currentDistanceOffTrace = Math.sqrt(Math.max(0, Math.pow(distUserToP1, 2) - Math.pow(currentProgressOnSegment, 2)));
                }
            } else {
                currentDistanceOffTrace = currentUserLatLng.distanceTo(p1);
            }
            
            if (currentDistanceOffTrace < minDistanceOffTrace) {
                minDistanceOffTrace = currentDistanceOffTrace;
                finalProgressAlongTrace = distanceAccumulatedOnTrace + Math.max(0, Math.min(currentProgressOnSegment, segmentLength));
            }
            distanceAccumulatedOnTrace += segmentLength;
        }

        progressPercentage = finalProgressAlongTrace / totalSegmentDistanceAlongTrace;
        progressPercentage = Math.max(0, Math.min(progressPercentage, 1)); // Clamp

        lastDeviationCalculation.totalSegmentDistance = totalSegmentDistanceAlongTrace;
        lastDeviationCalculation.progressDistance = finalProgressAlongTrace;
    }
    
    lastDeviationCalculation.progressPercentage = progressPercentage;
    const expectedTimeAtCurrentPosition = timeA + (segmentTotalScheduledMillis * progressPercentage);
    latestDeviationMillis = expectedTimeAtCurrentPosition - currentTime;
    lastDeviationCalculation.deviation = latestDeviationMillis;
}

function updateDeviationDisplay() {
    if (!isTracking) {
        document.getElementById('timeDeviation').textContent = "00:00";
        document.getElementById('timeDeviation').style.color = "#c9d1d9";
        return;
    }
    if (latestDeviationMillis === null) {
        document.getElementById('timeDeviation').textContent = "Calculando...";
        document.getElementById('timeDeviation').style.color = "#c9d1d9";
        return;
    }
    displayDeviation(latestDeviationMillis);
}

function displayDeviation(deviationMillis) {
    const absMillis = Math.abs(deviationMillis); const totalSecondsValue = Math.floor(absMillis / 1000);
    const displaySeconds = totalSecondsValue % 60; const totalMinutesValue = Math.floor(totalSecondsValue / 60);
    const sign = deviationMillis >= 0 ? "+" : "-";
    const formattedDeviation = `${sign}${String(totalMinutesValue).padStart(2, '0')}:${String(displaySeconds).padStart(2, '0')}`;
    const deviationDiv = document.getElementById('timeDeviation');
    deviationDiv.textContent = formattedDeviation;
    if (deviationMillis > 59999) deviationDiv.style.color = "#3fb950"; // Adelantado (verde)
    else if (deviationMillis < -59999) deviationDiv.style.color = "#f85149"; // Atrasado (rojo)
    else deviationDiv.style.color = "#c9d1d9"; // En tiempo
}

function updateTrackingStopsList() {
    if (!isTracking) return;
    const listDiv = document.getElementById('trackingStopsList');
    const displayPoints = trackingState.activeLegPoints.filter(p => p.pointCategory !== 'waypoint');
    if (displayPoints.length === 0) { listDiv.innerHTML = ""; return; }
    
    const nowMillis = new Date().getTime();
    const nextStopInfo = getNextDisplayableStop();

    const startPoint = trackingState.activeLegPoints.find(p => p.pointCategory === 'lineEndpoint' && p.isStartPoint);
    let isWaitingAtStartPoint = false;
    if (startPoint && lastKnownPosition && currentSegmentStartIndex === 0 && (latestDeviationMillis || 0) > 0) {
        const userLatLng = L.latLng(lastKnownPosition.coords.latitude, lastKnownPosition.coords.longitude);
        const startPointLatLng = L.latLng(startPoint.lat, startPoint.lng);
        if (userLatLng.distanceTo(startPointLatLng) < currentStopRadius) {
            isWaitingAtStartPoint = true;
        }
    }
    
    let html = "";
    displayPoints.forEach(point => {
        const pointIndexInFullPath = trackingState.activeLegPoints.findIndex(p => p.id === point.id);
        const isPassed = pointIndexInFullPath <= currentSegmentStartIndex;
        
        let etaString = "—";

        if (!isPassed && point.effectiveScheduledTime) {
            const scheduledMillis = new Date(point.effectiveScheduledTime).getTime();
            const deviationMillis = latestDeviationMillis || 0;
            const timeRemainingMillis = scheduledMillis - nowMillis;
            
            let etaMillis;

            if (isWaitingAtStartPoint && deviationMillis > 0) {
                etaMillis = timeRemainingMillis;
            } else {
                etaMillis = timeRemainingMillis - deviationMillis;
            }

            if (etaMillis < 0) {
                etaMillis = 0; 
            }
            
            if (etaMillis < 60000) {
                etaString = "ARRIBANDO";
            } else {
                const etaMinutes = Math.floor(etaMillis / (1000 * 60));
                etaString = `${etaMinutes} min.`;
            }
        }
        
        let rowClass = "tracking-stop-row";
        if(nextStopInfo.point && nextStopInfo.point.id === point.id) {
            rowClass += " is-next-stop";
        }

        html += `
            <div class="${rowClass}">
                <span class="tracking-stop-name">${point.name}</span>
                <span class="tracking-stop-time">${formatTime(point.effectiveScheduledTime, false)}</span>
                <span class="tracking-stop-eta">${etaString}</span>
            </div>
        `;
    });
    listDiv.innerHTML = html;
}

function calculateAndApplyAllIntermediateTimes() {
    const autoCalc = document.getElementById('autoCalcTimes').checked;
    if (!autoCalc) return;

    const startPoint = routePoints.find(p => p.pointCategory === 'lineEndpoint' && p.isStartPoint);
    const endPoint = routePoints.find(p => p.pointCategory === 'lineEndpoint' && !p.isStartPoint);

    if (!startPoint || !endPoint || !startPoint.schedule || !endPoint.schedule || !startPoint.schedule.scheduledTime || !endPoint.schedule.scheduledTime) {
        routePoints.filter(p => p.pointCategory === 'intermediateStop').forEach(stop => stop.scheduledTime = null);
        updateStopsList(); return;
    }
    const legStartTime = new Date(startPoint.schedule.scheduledTime);
    const legEndTime = new Date(endPoint.schedule.scheduledTime);

    const pathForCalc = getPathPointsForPolyline();
    distributeTimesProportionally(pathForCalc, legStartTime, legEndTime);
    updateStopsList();
}

function distributeTimesProportionally(legPathPoints, legStartTimeDate, legEndTimeDate) {
    if (!legStartTimeDate || !legEndTimeDate || legPathPoints.length < 2) return;
    const legStartMillis = legStartTimeDate.getTime();
    const legEndMillis = legEndTimeDate.getTime();
    const totalDurationMillis = legEndMillis - legStartMillis;
    const intermediateStopsInLeg = legPathPoints.slice(1, -1).filter(p => p.pointCategory === 'intermediateStop');

    if (totalDurationMillis <= 0) {
        intermediateStopsInLeg.forEach(p_leg => {
            const pointInMainRoute = routePoints.find(rp => rp.id === p_leg.id);
            if(pointInMainRoute) pointInMainRoute.scheduledTime = new Date(legStartMillis);
        });
        return;
    }
    let totalDistance = 0; const segmentDistances = [];
    for (let i = 0; i < legPathPoints.length - 1; i++) {
        const dist = L.latLng(legPathPoints[i].lat, legPathPoints[i].lng).distanceTo(L.latLng(legPathPoints[i+1].lat, legPathPoints[i+1].lng));
        segmentDistances.push(dist); totalDistance += dist;
    }
    if (totalDistance < 1.0) {
        const numTimeSegments = intermediateStopsInLeg.length + 1;
        if (numTimeSegments <= 0) return;
        const timePerSegment = totalDurationMillis / numTimeSegments;
        let currentTime = legStartMillis;
        for (let i = 0; i < intermediateStopsInLeg.length; i++) {
            currentTime += timePerSegment;
            const pointInMainRoute = routePoints.find(rp => rp.id === intermediateStopsInLeg[i].id);
            if (pointInMainRoute) pointInMainRoute.scheduledTime = new Date(currentTime);
        }
    } else {
        let accumulatedDistance = 0;
        for (let i = 0; i < legPathPoints.length - 1; i++) {
            accumulatedDistance += segmentDistances[i];
            const nextPointInPath = legPathPoints[i+1];
            if (nextPointInPath.pointCategory === 'intermediateStop') {
                const proportionOfRoute = accumulatedDistance / totalDistance;
                const timeOffsetMillis = totalDurationMillis * proportionOfRoute;
                const pointInMainRoute = routePoints.find(rp => rp.id === nextPointInPath.id);
                if(pointInMainRoute) pointInMainRoute.scheduledTime = new Date(legStartMillis + timeOffsetMillis);
            }
        }
    }
}


// --- PANEL DE DEBUG ETA ---

function formatMillisToMMSS(millis) {
    if (millis === null || typeof millis === 'undefined' || isNaN(millis)) return "N/A";
    const totalSeconds = Math.floor(Math.abs(millis) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const sign = millis < 0 ? "-" : "";
    return `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function toggleEtaDebug() {
    isEtaDebugVisible = !isEtaDebugVisible;
    const debugPanel = document.getElementById('etaDebugPanel');
    const debugBtn = document.getElementById('toggleEtaDebugBtn');
    if (isEtaDebugVisible) {
        debugPanel.style.display = 'block';
        debugBtn.textContent = '🐛 Ocultar Debug ETA';
        debugBtn.classList.remove('btn-info');
        debugBtn.classList.add('btn-secondary');
        updateEtaDebugInfo(); 
    } else {
        debugPanel.style.display = 'none';
        debugBtn.textContent = '🐛 Debug ETA';
        debugBtn.classList.remove('btn-secondary');
        debugBtn.classList.add('btn-info');
        debugPanel.innerHTML = ''; 
    }
}

function updateEtaDebugInfo() {
    if (!isEtaDebugVisible || !isTracking) {
        const debugPanel = document.getElementById('etaDebugPanel');
        if(debugPanel) debugPanel.innerHTML = '<p>El seguimiento no está activo o el debug está oculto.</p>';
        return;
    }

    const debugPanel = document.getElementById('etaDebugPanel');
    let debugHtml = `<h4>Detalles Cálculo ETA</h4>`;
    const nowMillis = new Date().getTime();
    const deviationMillisForCalc = latestDeviationMillis === null ? 0 : latestDeviationMillis;

    debugHtml += `<p><strong>Hora Actual (ms):</strong> ${nowMillis}</p>`;
    debugHtml += `<p><strong>Desvío Actual (ms):</strong> ${latestDeviationMillis === null ? 'N/A (calculando)' : latestDeviationMillis} (${formatMillisToMMSS(latestDeviationMillis)})</p>`;
    debugHtml += `<p><strong>Índice Punto Actual:</strong> ${currentSegmentStartIndex}</p>`;
    
    debugHtml += `<hr><h4>Cálculo de Progreso</h4>`;
    if (lastDeviationCalculation && lastDeviationCalculation.progressPercentage !== undefined) {
        debugHtml += `<p><strong>Segmento Lógico:</strong> ${lastDeviationCalculation.pointA || 'N/A'} → ${lastDeviationCalculation.pointB || 'N/A'}</p>`;
        debugHtml += `<p><strong>Distancia Total (traza):</strong> ${lastDeviationCalculation.totalSegmentDistance?.toFixed(0) || 'N/A'} m</p>`;
        debugHtml += `<p><strong>Progreso en Traza:</strong> ${lastDeviationCalculation.progressDistance?.toFixed(0) || 'N/A'} m</p>`;
        debugHtml += `<p style="font-weight: bold;">Porcentaje Recorrido: ${(lastDeviationCalculation.progressPercentage * 100).toFixed(1)} %</p>`;
    } else {
        debugHtml += `<p><em>${lastDeviationCalculation.reason || 'Esperando datos de cálculo de progreso...'}</em></p>`;
    }
    debugHtml += `<hr>`;

    const startPointDebug = trackingState.activeLegPoints.find(p => p.pointCategory === 'lineEndpoint' && p.isStartPoint);
    let isWaitingAtStartPointDebug = false;
    if (startPointDebug && lastKnownPosition && currentSegmentStartIndex === 0 && (latestDeviationMillis || 0) > 0) {
        const userLatLng = L.latLng(lastKnownPosition.coords.latitude, lastKnownPosition.coords.longitude);
        const startPointLatLng = L.latLng(startPointDebug.lat, startPointDebug.lng);
        if (userLatLng.distanceTo(startPointLatLng) < currentStopRadius) {
            isWaitingAtStartPointDebug = true;
        }
    }
    debugHtml += `<h4>Detalles por Parada</h4>`
    debugHtml += `<p><strong>Esperando en P. Inicio (lógica):</strong> ${isWaitingAtStartPointDebug}</p>`;
    
    const displayPoints = trackingState.activeLegPoints.filter(p => p.pointCategory !== 'waypoint');
    if (displayPoints.length === 0) {
        debugHtml += "<p>No hay puntos de parada para mostrar detalles.</p>";
        debugPanel.innerHTML = debugHtml;
        return;
    }

    displayPoints.forEach(point => {
        const pointIndexInFullPath = trackingState.activeLegPoints.findIndex(p => p.id === point.id);
        const isPassed = pointIndexInFullPath <= currentSegmentStartIndex;

        debugHtml += `<h5>Punto: ${point.name} (Pasado: ${isPassed})</h5>`;
        
        if (point.effectiveScheduledTime) {
            const scheduledMillis = new Date(point.effectiveScheduledTime).getTime();
            debugHtml += `<p style="margin-left: 10px;">Hora Prog.: ${formatTime(point.effectiveScheduledTime, false)}</p>`;

            if (!isPassed) {
                const timeRemainingMillis = scheduledMillis - nowMillis;
                debugHtml += `<p style="margin-left: 10px;">T. Rest. Prog.: ${formatMillisToMMSS(timeRemainingMillis)}</p>`;
                
                let etaMillisDebug;
                let reason = "";

                if (isWaitingAtStartPointDebug && deviationMillisForCalc > 0) {
                     etaMillisDebug = timeRemainingMillis;
                     reason = `<em>Caso: Esperando en P.Inicio (adelantado). ETA = T. Rest. Prog.</em>`;
                } else {
                    etaMillisDebug = timeRemainingMillis - deviationMillisForCalc;
                    reason = `<em>Caso: Normal. ETA = T. Rest. Prog. - Desvío</em>`;
                }
                debugHtml += `<p style="margin-left: 10px;">${reason}</p>`;

                if (etaMillisDebug < 0) etaMillisDebug = 0;
                debugHtml += `<p style="margin-left: 10px; font-weight: bold;">ETA Calculado: ${formatMillisToMMSS(etaMillisDebug)}</p>`;
            }
        } else {
            debugHtml += `<p style="margin-left: 10px;">Sin Hora Prog. Efectiva</p>`;
        }
    });

    debugPanel.innerHTML = debugHtml;
}


// --- FUNCIONES DE PERSISTENCIA Y COLA (LocalStorage) ---

function clearCurrentRoute() {
    if(isTracking) stopTracking();
    routePoints.forEach(p => {
        if (p.marker) map.removeLayer(p.marker);
        if (p.radiusCircle) map.removeLayer(p.radiusCircle);
    });
    routePoints = [];
    if (routeLineEdit) map.removeLayer(routeLineEdit); routeLineEdit = null;
    if (trackingRouteLine) map.removeLayer(trackingRouteLine); trackingRouteLine = null;
    updateStopsList(); redrawRouteLine();
}

function saveRoute() {
    const routeNameInput = document.getElementById('routeName');
    if (!routeNameInput.value) { alert("Por favor, ingresa un nombre para la ruta."); return; }
    const startPoint = routePoints.find(p => p.pointCategory === 'lineEndpoint' && p.isStartPoint);
    const endPoint = routePoints.find(p => p.pointCategory === 'lineEndpoint' && !p.isStartPoint);
    if (!startPoint || !endPoint) { alert("Una ruta debe tener un Punto de Inicio y un Punto Final."); return; }
    if (!startPoint.schedule || !startPoint.schedule.scheduledTime || !endPoint.schedule || !endPoint.schedule.scheduledTime) {
        alert("Punto de Inicio y Punto Final deben tener horarios definidos."); return;
    }
    const savablePoints = routePoints.map(p => {
        const pointData = { id: p.id, lat: p.lat, lng: p.lng, name: p.name, pointCategory: p.pointCategory, originalIndex: p.originalIndex };
        if (p.pointCategory === 'lineEndpoint') { pointData.isStartPoint = p.isStartPoint; pointData.schedule = { scheduledTime: p.schedule && p.schedule.scheduledTime ? new Date(p.schedule.scheduledTime).toISOString() : null }; }
        else if (p.pointCategory === 'intermediateStop') { pointData.scheduledTime = p.scheduledTime ? new Date(p.scheduledTime).toISOString() : null; }
        return pointData;
    });
    const routeDataToSave = { points: savablePoints };
    localStorage.setItem(CACHE_PREFIX + routeNameInput.value, JSON.stringify(routeDataToSave));
    alert(`Ruta "${routeNameInput.value}" guardada.`);
    loadSavedRoutesLists();
}

function loadRoute() {
    const selectedRouteName = document.getElementById('savedRoutes').value;
    if (!selectedRouteName) { alert("Selecciona una ruta para cargar."); return; }
    const savedDataRaw = localStorage.getItem(CACHE_PREFIX + selectedRouteName);
    if (!savedDataRaw) { alert("Error al cargar la ruta."); return; }
    clearCurrentRoute();
    const loadedRouteData = JSON.parse(savedDataRaw);
    currentRouteNameForTracking = selectedRouteName;
    loadedRouteData.points.forEach(p_data => {
        const newPointData = { ...p_data };
        if (p_data.pointCategory === 'lineEndpoint') newPointData.schedule = { scheduledTime: p_data.schedule && p_data.schedule.scheduledTime ? new Date(p_data.schedule.scheduledTime) : null };
        else if (p_data.pointCategory === 'intermediateStop') newPointData.scheduledTime = p_data.scheduledTime ? new Date(p_data.scheduledTime) : null;
        createAndAddMarker(newPointData);
    });
    map.closePopup();
    updateAllMarkerIconsAndLabels();
    redrawRouteLine();
    updateStopsList();
    const boundsPoints = routePoints.filter(p => p.pointCategory !== 'waypoint');
    if (boundsPoints.length > 0) { const bounds = L.latLngBounds(boundsPoints.map(p => [p.lat, p.lng])); if (bounds.isValid()) map.fitBounds(bounds); }
    document.getElementById('routeName').value = selectedRouteName;
}

function deleteRoute() {
    const selectedRouteName = document.getElementById('savedRoutes').value;
    if (!selectedRouteName) { alert("Selecciona una ruta para borrar."); return; }
    if (confirm(`¿Estás seguro de que quieres borrar la ruta "${selectedRouteName}"?`)) {
        localStorage.removeItem(CACHE_PREFIX + selectedRouteName);
        let queue = getRouteQueue(); queue = queue.filter(name => name !== selectedRouteName);
        saveRouteQueue(queue); loadSavedRoutesLists();
        alert(`Ruta "${selectedRouteName}" borrada.`);
    }
}

function loadSavedRoutesLists() {
    const savedRoutesSelect = document.getElementById('savedRoutes');
    const routeToQueueSelect = document.getElementById('routeToQueue');
    savedRoutesSelect.innerHTML = ""; routeToQueueSelect.innerHTML = "";
    let hasRoutes = false; const routeNames = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(CACHE_PREFIX)) routeNames.push(key.substring(CACHE_PREFIX.length));
    }
    routeNames.sort();
    routeNames.forEach(routeName => {
        const option = document.createElement('option');
        option.value = routeName; option.textContent = routeName;
        savedRoutesSelect.appendChild(option.cloneNode(true));
        routeToQueueSelect.appendChild(option.cloneNode(true));
        hasRoutes = true;
    });
    if (!hasRoutes) {
         const option = document.createElement('option'); option.textContent = "No hay rutas guardadas"; option.disabled = true;
         savedRoutesSelect.appendChild(option.cloneNode(true)); routeToQueueSelect.appendChild(option);
    }
    updateRouteQueueDisplay();
}

function getRouteQueue() { const q = localStorage.getItem(ROUTE_QUEUE_CACHE_KEY); return q ? JSON.parse(q) : [];}

function saveRouteQueue(queue) { localStorage.setItem(ROUTE_QUEUE_CACHE_KEY, JSON.stringify(queue)); updateRouteQueueDisplay();}

function addRouteToQueue() {
    const selectedRouteName = document.getElementById('routeToQueue').value;
    if (!selectedRouteName || document.getElementById('routeToQueue').options[0]?.disabled) { alert("Selecciona una ruta válida para añadir."); return; }
    const queue = getRouteQueue(); if (queue.includes(selectedRouteName)) { alert("Ruta ya en cola."); return; }
    queue.push(selectedRouteName); saveRouteQueue(queue); alert(`Ruta "${selectedRouteName}" añadida.`);
}

function updateRouteQueueDisplay() {
    const queueDiv = document.getElementById('routeQueueDisplay'); const queue = getRouteQueue();
    if (queue.length === 0) { queueDiv.innerHTML = "<p style='color:#8b949e;'>Vacía.</p>"; }
    else { let html = "<ol style='padding-left: 20px; margin-top: 5px;'>"; queue.forEach(rn => { html += `<li>${rn}</li>`; }); html += "</ol>"; queueDiv.innerHTML = html; }
}

function clearRouteQueue() { if (confirm("¿Limpiar toda la cola?")) saveRouteQueue([]);}

function checkRouteQueue() {
    let queue = getRouteQueue();
    if (queue.length > 0) {
        const nextRouteName = queue.shift(); saveRouteQueue(queue);
        if (confirm(`Ruta finalizada. ¿Iniciar siguiente ruta de la cola: "${nextRouteName}"?`)) {
            document.getElementById('savedRoutes').value = nextRouteName; 
            loadRoute();
            setTimeout(() => {
                const startPoint = routePoints.find(p => p.pointCategory === 'lineEndpoint' && p.isStartPoint);
                const endPoint = routePoints.find(p => p.pointCategory === 'lineEndpoint' && !p.isStartPoint);
                if (startPoint && endPoint && getEndpointScheduledTime(startPoint) && getEndpointScheduledTime(endPoint)) {
                    startTracking();
                } else {
                    alert(`Error al cargar la ruta "${nextRouteName}" de la cola o sus horarios son inválidos.`);
                }
            }, 500);
        }
    }
}


// --- FUNCIONES UTILITARIAS Y DE DATOS ---

function redrawRouteLine() {
    if (routeLineEdit) map.removeLayer(routeLineEdit); routeLineEdit = null;
    if (trackingRouteLine) map.removeLayer(trackingRouteLine); trackingRouteLine = null;
    const polylinePathPoints = getPathPointsForPolyline();
    if (polylinePathPoints.length > 1) {
        const latlngs = polylinePathPoints.map(p => [p.lat, p.lng]);
        if (isTracking) {
            trackingRouteLine = L.polyline(latlngs, {color: 'green', weight: 7, opacity: 0.8}).addTo(map);
        } else {
            routeLineEdit = L.polyline(latlngs, {color: 'purple', weight: 5, dashArray: '5, 5'}).addTo(map);
        }
    }
}

function getPathPointsForPolyline() {
    const allPointsSorted = [...routePoints].sort((a, b) => a.originalIndex - b.originalIndex);
    if (allPointsSorted.length < 1) return [];
    const startPoint = allPointsSorted.find(p => p.pointCategory === 'lineEndpoint' && p.isStartPoint);
    const endPoint = allPointsSorted.find(p => p.pointCategory === 'lineEndpoint' && !p.isStartPoint);
    if (!startPoint || !endPoint) {
         return allPointsSorted.filter(p => p.pointCategory !== 'intermediateStop').map(p => ({...p}));
    }
    const startIndexInSorted = allPointsSorted.findIndex(p => p.id === startPoint.id);
    const endIndexInSorted = allPointsSorted.findIndex(p => p.id === endPoint.id);
    let segmentPoints;
    if (startIndexInSorted <= endIndexInSorted) {
        segmentPoints = allPointsSorted.slice(startIndexInSorted, endIndexInSorted + 1);
    } else {
        segmentPoints = [
            ...allPointsSorted.slice(startIndexInSorted),
            ...allPointsSorted.slice(0, endIndexInSorted + 1)
        ];
    }
    return segmentPoints.filter(p =>
        p.pointCategory === 'lineEndpoint' ||
        p.pointCategory === 'waypoint' ||
        p.pointCategory === 'intermediateStop'
    ).map(p => ({...p}));
}

function getSortedRoutePointsForDisplay() { return [...routePoints].sort((a, b) => a.originalIndex - b.originalIndex).filter(p => p.pointCategory !== 'waypoint'); }

function getNextDisplayableStop() {
    if (!isTracking || !trackingState.activeLegPoints) return { point: null, index: -1 };
    for (let i = currentSegmentStartIndex + 1; i < trackingState.activeLegPoints.length; i++) {
        if (trackingState.activeLegPoints[i].pointCategory !== 'waypoint') {
            return { point: trackingState.activeLegPoints[i], index: i };
        }
    }
    if (currentSegmentStartIndex < trackingState.activeLegPoints.length - 1) {
        return { point: trackingState.activeLegPoints[trackingState.activeLegPoints.length - 1], index: trackingState.activeLegPoints.length - 1 };
    }
    return { point: null, index: -1 };
}

function setupCurrentLegForTracking() {
    trackingState.activeLegPoints = [];
    const legPathPointsSource = getPathPointsForPolyline();
    if(legPathPointsSource.length === 0) { console.error("No points found for current leg in tracking."); return false; }
    const startPoint = routePoints.find(p => p.pointCategory === 'lineEndpoint' && p.isStartPoint);
    const endPoint = routePoints.find(p => p.pointCategory === 'lineEndpoint' && !p.isStartPoint);
    if (!startPoint || !endPoint) { alert("Punto de Inicio o Final no encontrado para la ruta."); return false; }
    const routeStartTime = getEndpointScheduledTime(startPoint);
    const routeEndTime = getEndpointScheduledTime(endPoint);
    if (!routeStartTime || !routeEndTime) { alert(`Horarios de Punto Inicio/Final incompletos para la ruta.`); return false; }
    trackingState.activeLegPoints = legPathPointsSource.map(legPoint => {
        const originalPoint = routePoints.find(rp => rp.id === legPoint.id);
        if (!originalPoint) return { ...legPoint, effectiveScheduledTime: null };
        let effTime = null;
        if (originalPoint.pointCategory === 'lineEndpoint') { if (originalPoint.isStartPoint) effTime = routeStartTime; else effTime = routeEndTime; }
        else if (originalPoint.pointCategory === 'intermediateStop') { effTime = originalPoint.scheduledTime ? new Date(originalPoint.scheduledTime) : null; }
        return { ...originalPoint, effectiveScheduledTime: effTime };
    });
     if (trackingState.activeLegPoints.length > 0 && (!trackingState.activeLegPoints[0].effectiveScheduledTime || !trackingState.activeLegPoints[trackingState.activeLegPoints.length -1].effectiveScheduledTime)) {
         console.error("Effective times for leg start/end points are missing after setup.", trackingState.activeLegPoints);
         alert(`Horarios incompletos para los extremos de la ruta tras la configuración.`); return false;
    }
    return true;
}

function formatTime(dateObj, includeDate = false) {
    if (!dateObj || isNaN(new Date(dateObj).getTime())) return "N/A";
    let timeStr = new Date(dateObj).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (includeDate) { timeStr += ` (${new Date(dateObj).toLocaleDateString('es-ES', {day:'2-digit', month:'2-digit'})})`; }
    return timeStr;
}

function getEndpointScheduledTime(point) {
    if (!point || point.pointCategory !== 'lineEndpoint' || !point.schedule || !point.schedule.scheduledTime) return null;
    return new Date(point.schedule.scheduledTime);
}

function handleGeolocationError(error) {
    console.error("Error de geolocalización: ", error); alert(`Error de geolocalización: ${error.message}.`);
    if (isTracking) stopTracking(false, "Error de geolocalización");
}
