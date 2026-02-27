require([
  "esri/config",
  "esri/identity/OAuthInfo",
  "esri/identity/IdentityManager",
  "esri/WebMap",
  "esri/views/MapView",
  "esri/widgets/LayerList",
  "esri/widgets/BasemapGallery",
  "esri/widgets/Bookmarks",
  "esri/layers/GraphicsLayer",
  "esri/widgets/Sketch",
  "esri/geometry/geometryEngine",
  "esri/Graphic",
  "esri/geometry/support/webMercatorUtils",
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
  GraphicsLayer,
  Sketch,
  geometryEngine,
  Graphic,
  webMercatorUtils,
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

  // Run auth status update once the view is ready
  view.when(updateAuthStatus);

  // -------------------------------
  // WIDGETS
  // -------------------------------
  view.when(function () {

    // Layer List
    new LayerList({
      view: view,
      container: "widgetLayerList"
    });

    // Basemap Gallery
    new BasemapGallery({
      view: view,
      container: "widgetBasemap"
    });

    // Bookmarks
    new Bookmarks({
      view: view,
      container: "widgetBookmarks"
    });

    // -------------------------------
    // MISSION LAYER + STATE
    // -------------------------------
    const missionLayer = new GraphicsLayer({ title: "Mission planning" });
    view.map.add(missionLayer);

    let missionGeom = null;

    function setMissionStatus(msg) {
      const el = document.getElementById("missionStatus");
      if (el) el.textContent = msg || "";
    }

    const missionSymbol = {
      type: "simple-fill",
      color: [0, 0, 0, 0.05],
      outline: { color: [0, 0, 0, 0.9], width: 2 }
    };

    const bufferSymbol = {
      type: "simple-fill",
      color: [0, 120, 255, 0.15],
      outline: { color: [0, 120, 255, 0.9], width: 2 }
    };

    // Sketch for drawing mission polygon
    const sketchMission = new Sketch({
      view: view,
      layer: missionLayer,
      creationMode: "single",
      availableCreateTools: ["polygon"],
      visibleElements: {
        selectionTools: false,
        settingsMenu: false,
        undoRedoMenu: true
      }
    });

    sketchMission.visible = false;
    view.ui.add(sketchMission, "top-left");

    // Button: Draw mission
    document.getElementById("btnDrawMission").onclick = () => {
      missionLayer.removeAll();
      missionGeom = null;
      sketchMission.visible = true;
      setMissionStatus("Drawing mission polygon… double-click to finish.");
      sketchMission.create("polygon");
    };

    // Sketch complete
    sketchMission.on("create", (evt) => {
      if (evt.state === "complete") {
        evt.graphic.symbol = missionSymbol;
        missionGeom = evt.graphic.geometry;
        sketchMission.visible = false;
        setMissionStatus("Mission area set.");

        view.goTo(missionGeom, { padding: 40 });
      }
    });

    // Button: Clear mission
    document.getElementById("btnClearMission").onclick = () => {
      missionLayer.removeAll();
      missionGeom = null;
      setMissionStatus("Mission cleared.");
    };

    // -------------------------------
    // IMPORT GEOJSON (Polygon)
    // -------------------------------
    const btnImport = document.getElementById("btnImportGeoJSON");
    const fileInput = document.getElementById("fileGeoJSON");

    btnImport.onclick = () => fileInput.click();

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const gj = JSON.parse(text);

        let geom = null;
        if (gj.type === "FeatureCollection" && gj.features?.length) {
          geom = gj.features[0]?.geometry;
        } else if (gj.type === "Feature" && gj.geometry) {
          geom = gj.geometry;
        } else if (gj.type && gj.coordinates) {
          geom = gj;
        }

        if (!geom || !geom.type || !geom.coordinates) {
          setMissionStatus("GeoJSON geometry missing.");
          return;
        }

        let polygon4326 = null;

        if (geom.type === "Polygon") {
          // GeoJSON Polygon: coordinates = [ [ [x,y], ... ] , ... ]
          const rings = geom.coordinates.map(ring => ring.map(([x, y]) => [x, y]));
          polygon4326 = {
            type: "polygon",
            rings: rings,
            spatialReference: { wkid: 4326 }
          };
        } else if (geom.type === "MultiPolygon") {
          // GeoJSON MultiPolygon: coordinates = [ Polygon1, Polygon2, ... ]
          // We'll use the first polygon for now (most QGIS exports only have one anyway).
          const firstPoly = geom.coordinates[0];
          if (!firstPoly) {
            setMissionStatus("MultiPolygon has no coordinates.");
            return;
          }
          const rings = firstPoly.map(ring => ring.map(([x, y]) => [x, y]));
          polygon4326 = {
            type: "polygon",
            rings: rings,
            spatialReference: { wkid: 4326 }
          };
        } else {
          setMissionStatus("GeoJSON must contain Polygon or MultiPolygon.");
          return;
        }   

        const polyForView = webMercatorUtils.canProject(polygon4326, view.spatialReference)
          ? webMercatorUtils.project(polygon4326, view.spatialReference)
          : polygon4326;

        missionLayer.removeAll();
        missionLayer.add(new Graphic({
          geometry: polyForView,
          symbol: missionSymbol
        }));

        missionGeom = polyForView;
        setMissionStatus("Mission area imported.");

        // Zoom to imported mission
        const target = missionLayer.graphics.getItemAt(0);
        if (target) {
          view.goTo(target.geometry.extent.expand(1.2), { padding: 60 });
        }
        
      } catch (e) {
        console.error(e);
        setMissionStatus("Import failed. Check file is valid GeoJSON.");
      } finally {
        fileInput.value = ""; // allow re-importing same file
      }
    });

    // -------------------------------
    // DRONE DEFINITIONS
    // -------------------------------
    const drones = {
      m350: {
        name: "DJI M350",
        wingspan: 1.4,
        mtow: 12.9,
        parachuteMinHeight: 39,
        grb: 50   // static test value (we adjust later)
      },
      tundra2: {
        name: "Tundra 2 Endurance",
        wingspan: 1.84,
        mtow: 12.9,
        parachuteMinHeight: 47,
        grb: 80   // static test value
      }
    };

    const droneSelect = document.getElementById("droneSelect");
    const droneInfo = document.getElementById("droneInfo");

    droneSelect.onchange = () => {
      const key = droneSelect.value;
      if (!key || !drones[key]) {
        droneInfo.innerHTML = "";
        return;
      }

      const d = drones[key];

      droneInfo.innerHTML = `
        Wingspan: ${d.wingspan} m<br>
        MTOW: ${d.mtow} kg<br>
        Parachute min height: ${d.parachuteMinHeight} m<br>
        Static GRB: ${d.grb} m
      `;
    };
    document.getElementById("btnCalculateCV").onclick = () => {
      if (!missionGeom) {
        setMissionStatus("No mission area.");
        return;
      }

      const droneKey = droneSelect.value;
      if (!droneKey) {
        setMissionStatus("Select a drone.");
        return;
      }

      const drone = drones[droneKey];

      const speed = Number(document.getElementById("inputSpeed").value) || 0;
      const altitude = Number(document.getElementById("inputAltitude").value) || 0;
      const useParachute = document.getElementById("chkParachute").checked;

      // --- Simplified CV logic (placeholder for now)
      let cvDistance = speed * 3;   // 3-second reaction model

      if (useParachute && altitude > drone.parachuteMinHeight) {
        cvDistance = speed * 1.5;  // reduced horizontal drift (placeholder logic)
      }

      const grbDistance = drone.grb;

      missionLayer.removeAll();
      missionLayer.add(new Graphic({ geometry: missionGeom, symbol: missionSymbol }));

      const cvBuffer = geometryEngine.geodesicBuffer(missionGeom, cvDistance, "meters");
      const grbBuffer = geometryEngine.geodesicBuffer(cvBuffer, grbDistance, "meters");

      missionLayer.add(new Graphic({
        geometry: cvBuffer,
        symbol: {
          type: "simple-fill",
          color: [255, 165, 0, 0.15],
          outline: { color: [255, 140, 0], width: 2 }
        }
      }));

      missionLayer.add(new Graphic({
        geometry: grbBuffer,
        symbol: {
          type: "simple-fill",
          color: [255, 0, 0, 0.15],
          outline: { color: [200, 0, 0], width: 2 }
        }
      }));

      setMissionStatus(`CV: ${cvDistance.toFixed(1)} m | GRB: ${grbDistance} m`);
    };
    
    // -------------------------------
    // MEASUREMENT (stable iterative)
    // -------------------------------
    const measureButtons = document.getElementById("measureButtons");
    const measureWidgetDiv = document.getElementById("measureWidget");

    // Create ONE measurement widget and keep it
    const measurement = new Measurement({
      view: view,
      container: measureWidgetDiv
    });

    // Buttons
    const btnDist = document.createElement("button");
    btnDist.textContent = "Measure distance";
    btnDist.className = "measure-btn";

    const btnArea = document.createElement("button");
    btnArea.textContent = "Measure area";
    btnArea.className = "measure-btn";

    const btnClear = document.createElement("button");
    btnClear.textContent = "Clear";
    btnClear.className = "measure-btn";

    measureButtons.appendChild(btnDist);
    measureButtons.appendChild(btnArea);
    measureButtons.appendChild(btnClear);

    // Widget Behavior
    btnDist.onclick = () => {
      measurement.clear();              // remove any old measurement
      measurement.activeTool = "distance";
    };

    btnArea.onclick = () => {
      measurement.clear();
      measurement.activeTool = "area";
    };

    btnClear.onclick = () => {
      measurement.clear();              // clears drawn measurement
      // keep the current tool active so you can immediately measure again
    };

  });
});
