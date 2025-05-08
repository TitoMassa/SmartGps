// cuando-llega/js/app.js
class CuandoLlega {
  constructor() {
    this.routes = {};
    this.trackingStatus = {
      isTracking: false,
      routeName: '',
      currentStopIndexFromWhichDeparted: -1,
      currentBusDelayOrAheadMillis: 0
    };
    
    this.initUI();
    this.loadAllRoutes();
    this.setupLocalStorageListener();
    this.updateInterval = setInterval(() => this.updateETA(), 7000);
  }

  initUI() {
    this.routeSelect = document.getElementById('route-select');
    this.stopSelect = document.getElementById('stop-select');
    this.etaDisplay = document.getElementById('eta-display');
    this.lastUpdateDisplay = document.getElementById('last-update');
    
    this.routeSelect.addEventListener('change', () => this.loadStops());
    this.stopSelect.addEventListener('change', () => this.updateETA());
  }

  loadAllRoutes() {
    // Cargar todas las rutas desde localStorage
    const savedRoutes = localStorage.getItem('smartMoveProRoutes');
    if (savedRoutes) {
      this.routes = JSON.parse(savedRoutes);
    }
    
    // Cargar también las rutas en cola
    const trackingStatus = localStorage.getItem('smartMoveProTrackingStatus');
    if (trackingStatus) {
      const status = JSON.parse(trackingStatus);
      status.trackingQueueNames.forEach(routeName => {
        if (!this.routes[routeName]) {
          // Si no está en rutas guardadas, buscar en cola
          // (Aquí se necesitaría una API o almacenamiento adicional)
        }
      });
    }
    
    this.populateRouteSelect();
  }

  populateRouteSelect() {
    this.routeSelect.innerHTML = '<option value="">Seleccionar ruta</option>';
    
    Object.keys(this.routes).forEach(routeName => {
      const option = document.createElement('option');
      option.value = routeName;
      option.textContent = routeName;
      this.routeSelect.appendChild(option);
    });
  }

  loadStops() {
    const selectedRoute = this.routeSelect.value;
    if (!selectedRoute) return;
    
    this.stopSelect.innerHTML = '<option value="">Seleccionar parada</option>';
    
    // Verificar si el chofer está en esta ruta
    const isDriverOnRoute = this.trackingStatus.isTracking && 
                          this.trackingStatus.routeName === selectedRoute;
    
    let stops = [];
    
    if (isDriverOnRoute) {
      // Usar datos del chofer en tiempo real
      stops = this.trackingStatus.routeStops || [];
    } else {
      // Usar datos programados
      const routeData = this.routes[selectedRoute];
      if (routeData) {
        stops = [routeData.startPoint, ...routeData.intermediateStops, routeData.endPoint];
      }
    }
    
    // Rellenar dropdown con paradas
    stops.forEach((stop, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = `${stop.name || `Parada ${index}`}`;
      this.stopSelect.appendChild(option);
    });
    
    this.updateETA();
  }

  setupLocalStorageListener() {
    window.addEventListener('storage', (e) => {
      if (e.key === 'smartMoveProTrackingStatus') {
        this.updateTrackingStatus();
        if (this.routeSelect.value) {
          this.loadStops(); // Recargar paradas si hay cambios en tracking
        }
      }
      
      if (e.key === 'smartMoveProRoutes') {
        this.loadAllRoutes(); // Recargar rutas si hay cambios
      }
    });
    
    this.updateTrackingStatus(); // Cargar estado inicial
  }

  updateTrackingStatus() {
    const statusJson = localStorage.getItem('smartMoveProTrackingStatus');
    if (statusJson) {
      try {
        this.trackingStatus = JSON.parse(statusJson);
        this.lastUpdateDisplay.textContent = `Última actualización: ${new Date().toLocaleTimeString()}`;
      } catch (e) {
        console.error('Error parsing tracking status:', e);
      }
    }
  }

  updateETA() {
    if (!this.routeSelect.value || !this.stopSelect.value) return;
    
    const routeName = this.routeSelect.value;
    const stopIndex = parseInt(this.stopSelect.value);
    
    // Verificar si el chofer está en esta ruta
    const isDriverOnRoute = this.trackingStatus.isTracking && 
                          this.trackingStatus.routeName === routeName;
    
    const routeData = this.routes[routeName];
    if (!routeData) return;
    
    if (!isDriverOnRoute) {
      // Modo offline: mostrar horario programado
      this.showScheduledTime(routeData, stopIndex);
      return;
    }
    
    // Verificar si el bus ya pasó esta parada
    if (stopIndex <= this.trackingStatus.currentStopIndexFromWhichDeparted) {
      this.etaDisplay.textContent = 'Bus ya pasó';
      return;
    }
    
    // Calcular ETA basado en posición actual y demora
    this.calculateETA(routeData, stopIndex);
  }

  showScheduledTime(routeData, stopIndex) {
    // Mostrar horario programado
    let scheduledTime;
    
    if (stopIndex === 0) { // Punto de inicio
      scheduledTime = routeData.startPoint.departureTime;
    } else if (stopIndex === routeData.intermediateStops.length + 1) { // Punto final
      scheduledTime = routeData.endPoint.arrivalTime;
    } else { // Parada intermedia
      scheduledTime = routeData.intermediateStops[stopIndex - 1].arrivalTime;
    }
    
    this.etaDisplay.textContent = `Horario programado: ${scheduledTime}`;
  }

  calculateETA(routeData, stopIndex) {
    // Calcular ETA considerando la demora actual del bus
    const stops = [routeData.startPoint, ...routeData.intermediateStops, routeData.endPoint];
    
    // Índice de la parada actual (de donde salió) y la próxima
    const currentStopIndex = this.trackingStatus.currentStopIndexFromWhichDeparted;
    const nextStopIndex = currentStopIndex + 1;
    
    // Si está en el punto de inicio
    if (currentStopIndex === -1) {
      // Si está adelantado, ignorar el adelanto (esperará hasta hora programada)
      if (this.trackingStatus.currentBusDelayOrAheadMillis > 0) {
        // Usar horario programado
        this.useScheduledTime(routeData, stopIndex);
      } else {
        // Aplicar el retraso
        this.applyDelayToSchedule(routeData, stopIndex, this.trackingStatus.currentBusDelayOrAheadMillis);
      }
    } else {
      // Calcular basado en la posición actual entre currentStopIndex y nextStopIndex
      this.calculateBasedOnCurrentLeg(routeData, stopIndex, currentStopIndex, nextStopIndex);
    }
  }

  useScheduledTime(routeData, stopIndex) {
    // Usar horario programado sin ajustes
  }

  applyDelayToSchedule(routeData, stopIndex, delayMillis) {
    // Aplicar demora al horario programado
  }

  calculateBasedOnCurrentLeg(routeData, stopIndex, currentStopIndex, nextStopIndex) {
    // Calcular ETA basado en la proporción de distancia recorrida
  }

  showETA(minutes) {
    if (minutes < 1) {
      this.etaDisplay.textContent = 'ARRIBANDO';
    } else {
      this.etaDisplay.textContent = `${Math.ceil(minutes)} min.`;
    }
  }
}

// Inicializar aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  new CuandoLlega();
});
