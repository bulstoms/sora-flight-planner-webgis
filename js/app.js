require([
  "esri/config",
  "esri/identity/OAuthInfo",
  "esri/identity/IdentityManager",
  "esri/WebMap",
  "esri/views/MapView",
  "esri/widgets/LayerList",
  "esri/widgets/BasemapGallery",
  "esri/widgets/Bookmarks",
  "esri/widgets/DistanceMeasurement2D",
  "esri/widgets/AreaMeasurement2D"
], function (
  esriConfig,
  OAuthInfo,
  esriId,
  WebMap,
  MapView,
  LayerList,
  BasemapGallery,
  Bookmarks,
  DistanceMeasurement2D,
  AreaMeasurement2D
) {
  const cfg = window.SORA_CONFIG;

  // Tell ArcGIS which portal we are using
  esriConfig.portalUrl = cfg.portalUrl;

  // Configure OAuth login
  const oauthInfo = new OAuthInfo({
    appId: cfg.oauthAppId,
    portalUrl: cfg.portalUrl,
    popup: false
  });

  esriId.registerOAuthInfos([oauthInfo]);

  // Load your web map
  const webmap = new WebMap({
    portalItem: { id: cfg.webmapId }
  });

  // Create the 2D map view
  const view = new MapView({
    container: "viewDiv",
    map: webmap
  });

  const authEl = document.getElementById("authStatus");

  async function updateAuthStatus() {
    try {
      await esriId.checkSignInStatus(cfg.portalUrl + "/sharing");
      authEl.textContent = "Signed in";
    } catch {
      authEl.textContent = "Not signed in";
    }
  }

  // Run auth status update once the view is ready
  view.when(updateAuthStatus);

  // -------------------------------
  // WIDGETS
  // -------------------------------
  view.when(function () {

    new LayerList({
      view: view,
      container: "widgetLayerList"
    });

    new BasemapGallery({
      view: view,
      container: "widgetBasemap"
    });

    new Bookmarks({
      view: view,
      container: "widgetBookmarks"
    });

    // --- Measurement (Distance / Area) ---
    const measureButtons = document.getElementById("measureButtons");
    const measureWidgetDiv = document.getElementById("measureWidget");

    const distanceBtn = document.createElement("button");
    distanceBtn.textContent = "Measure distance";
    distanceBtn.className = "measure-btn";

    const areaBtn = document.createElement("button");
    areaBtn.textContent = "Measure area";
    areaBtn.className = "measure-btn";

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear measurement";
    clearBtn.className = "measure-btn";

    measureButtons.appendChild(distanceBtn);
    measureButtons.appendChild(areaBtn);
    measureButtons.appendChild(clearBtn);

    // Create widgets ONCE (important)
    const distanceWidget = new DistanceMeasurement2D({ view });
    const areaWidget = new AreaMeasurement2D({ view });

    let activeWidget = null;

    function showWidget(widget) {
      // Detach previous widget safely
      if (activeWidget && activeWidget !== widget) {
        try { activeWidget.clear(); } catch (e) {}
        activeWidget.container = null;
      }

      // Attach selected widget into our div
      widget.container = measureWidgetDiv;
      activeWidget = widget;
    }

    distanceBtn.onclick = () => showWidget(distanceWidget);
    areaBtn.onclick = () => showWidget(areaWidget);

    clearBtn.onclick = () => {
      if (!activeWidget) return;

      // Clear measurement graphics/state
      try { activeWidget.clear(); } catch (e) {}

      // Keep widget attached so it doesn't leave weird overlays behind
      // (Optional) you can also detach it:
      // activeWidget.container = null;
      // activeWidget = null; 
    };

  });
});
