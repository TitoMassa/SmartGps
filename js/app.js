// smart-move-pro/js/app.js
class SmartMovePro {
  constructor() {
    this.map = L.map('map').setView([-34.6037, -58.3816], 13); // Buenos Aires por defecto
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    this.routes = JSON.parse(localStorage.getItem('smartMoveProRoutes') || '{}');
    this.currentRoute = null;
    this.trackingQueue = [];
    this.isTracking = false;
    this.currentTrackingRouteIndex = 0;
    this.currentTrackingStopIndex = -1;
    this.watchId = null;
    this.lastKnownPosition = null;
    this.autoSchedule = false;
    
    this.initUI();
    this.loadSavedRoutes();
  }

  initUI() {
    // Inicializar elementos UI y eventos
    this.routeNameInput = document.getElementById('route-name');
    this.startPointBtn = document.getElementById('start-point');
    this.endPointBtn = document.getElementById('end-point');
    this.addStopBtn = document.getElementById('add-stop');
    this.autoScheduleCheckbox = document.getElementById('auto-schedule');
    this.routeList = document.getElementById('route-list');
    this.saveBtn = document.getElementById('save-route');
    this.loadBtn = document.getElementById('load-route');
    this.deleteBtn = document.getElementById('delete-route');
    this.addToQueueBtn = document.getElementById('add-to-queue');
    this.queueList = document.getElementById('queue-list');
    this.clearQueueBtn = document.getElementById('clear-queue');
    this.startTrackingBtn = document.getElementById('start-tracking');
    this.stopTrackingBtn = document.getElementById('stop-tracking');
    this.manualControlCheckbox = document.getElementById('manual-control');
    this.prevStopBtn = document.getElementById('prev-stop');
    this.nextStopBtn = document.getElementById('next-stop');

    // Event listeners
    this.startPointBtn.addEventListener('click', () => this.setStartPoint());
    this.endPointBtn.addEventListener('click', () => this.setEndPoint());
    this.addStopBtn.addEventListener('click', () => this.addIntermediateStop());
    this.autoScheduleCheckbox.addEventListener('change', (e) => {
      this.autoSchedule = e.target.checked;
    });
    this.saveBtn.addEventListener('click', () => this.saveRoute());
    this.loadBtn.addEventListener('click', () => this.loadRoute());
    this.deleteBtn.addEventListener('click', () => this.deleteRoute());
    this.addToQueueBtn.addEventListener('click', () => this.addToQueue());
    this.clearQueueBtn.addEventListener('click', () => this.clearQueue());
    this.startTrackingBtn.addEventListener('click', () => this.startTracking());
    this.stopTrackingBtn.addEventListener('click', () => this.stopTracking());
    this.manualControlCheckbox.addEventListener('change', (e) => {
      this.enableManualControls(e.target.checked);
    });
    this.prevStopBtn.addEventListener('click', () => this.previousStop());
    this.nextStopBtn.addEventListener('click', () => this.nextStop());

    // Map click listener
    this.map.on('click', (e) => this.handleMapClick(e));
  }

  setStartPoint() {
    // Implementar lógica para establecer punto de inicio
  }

  setEndPoint() {
    // Implementar lógica para establecer punto final
  }

  addIntermediateStop() {
    // Implementar lógica para añadir paradas intermedias
  }

  calculateIntermediateTimes() {
    // Calcular horarios intermedios automáticamente
  }

  saveRoute() {
    // Guardar ruta en localStorage
  }

  loadRoute() {
    // Cargar ruta desde localStorage
  }

  deleteRoute() {
    // Eliminar ruta de localStorage
  }

  addToQueue() {
    // Añadir ruta a la cola de seguimiento
  }

  clearQueue() {
    // Limpiar cola de seguimiento
  }

  startTracking() {
    // Iniciar seguimiento GPS
    if (!navigator.geolocation) {
      this.showTrackingError('Geolocalización no disponible');
      return;
    }

    this.isTracking = true;
    this.currentTrackingRouteIndex = 0;
    this.currentTrackingStopIndex = -1;
    
    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.handlePositionUpdate(position),
      (error) => this.handlePositionError(error),
      {
        enableHighAccuracy: true,
        maximumAge: 1000
      }
    );

    this.updateTrackingStatus();
  }

  stopTracking() {
    // Detener seguimiento GPS
    this.isTracking = false;
    if (this.watchId) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.saveTrackingStatus();
  }

  handlePositionUpdate(position) {
    this.lastKnownPosition = {
      lat: position.coords.latitude,
      lng: position.coords.longitude
    };
    
    // Actualizar mapa con posición actual
    this.updateTrackingStatus();
    
    // Manejar transiciones automáticas según geofences
    if (!this.manualControlCheckbox.checked) {
      this.checkGeofenceTransitions();
    }
  }

  checkGeofenceTransitions() {
    // Verificar si el conductor ha entrado/salido de zonas geográficas
  }

  updateTrackingStatus() {
    const status = {
      isTracking: this.isTracking,
      hasError: false,
      routeName: this.currentRoute?.name || '',
      currentRouteIndexInQueue: this.currentTrackingRouteIndex,
      trackingQueueNames: this.trackingQueue.map(r => r.name),
      currentStopIndexFromWhichDeparted: this.currentTrackingStopIndex,
      nextStopIndexTowardsWhichHeading: this.currentTrackingStopIndex + 1,
      currentBusDelayOrAheadMillis: this.calculateDelay(),
      lastKnownPosition: this.lastKnownPosition,
      lastUpdateTime: Date.now(),
      routeStops: this.getCurrentRouteStops()
    };
    
    localStorage.setItem('smartMoveProTrackingStatus', JSON.stringify(status));
  }

  calculateDelay() {
    // Calcular diferencia entre horario programado y real
    return 0; // Placeholder
  }

  getCurrentRouteStops() {
    // Devolver lista de paradas de la ruta actual
    return [];
  }

  enableManualControls(enabled) {
    // Activar/desactivar controles manuales
    this.prevStopBtn.disabled = !enabled;
    this.nextStopBtn.disabled = !enabled;
    
    if (!enabled && this.isTracking) {
      this.findAndSetCurrentLeg();
    }
  }

  findAndSetCurrentLeg() {
    // Re-sincronizar con la parada más cercana
  }

  previousStop() {
    // Navegar a parada anterior
  }

  nextStop() {
    // Navegar a parada siguiente
  }

  loadSavedRoutes() {
    // Cargar rutas guardadas al dropdown
  }

  showTrackingError(message) {
    // Mostrar errores de seguimiento
    localStorage.setItem('smartMoveProTrackingStatus', JSON.stringify({
      isTracking: false,
      hasError: true,
      errorReason: message
    }));
  }
}

// Inicializar aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  new SmartMovePro();
});
