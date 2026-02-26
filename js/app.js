require([
  "esri/config",
  "esri/identity/OAuthInfo",
  "esri/identity/IdentityManager",
  "esri/WebMap",
  "esri/views/MapView",
  "esri/widgets/LayerList",
  "esri/widgets/BasemapGallery",
  "esri/widgets/Bookmarks",
  "esri/widgets/Measurement"
], function (
  esriConfig,
  OAuthInfo,
  esriId,
  WebMap,
  MapView,
  LayerList,
  BasemapGallery,
  Bookmarks,
  Measurement
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

  view.when(updateAuthStatus);
  // -------------------------------
  // WIDGETS
  // -------------------------------

  view.when(function () {

    // Layer List
    const layerList = new LayerList({
      view: view,
      container: "widgetLayerList"
    });

    // Basemap Gallery
    const basemapGallery = new BasemapGallery({
      view: view,
      container: "widgetBasemap"
    });

    // Bookmarks
    const bookmarks = new Bookmarks({
      view: view,
      container: "widgetBookmarks"
    });

    // Measurement
    const measurement = new Measurement({
      view: view,
      container: "widgetMeasure"
    });

  });
