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
  "esri/layers/FeatureLayer",
  "esri/widgets/Sketch",
  "esri/geometry/geometryEngine",
  "esri/Graphic",
  "esri/geometry/support/webMercatorUtils",
  "esri/widgets/Measurement",
  "esri/widgets/ScaleBar",
  "esri/widgets/Home",
  "esri/widgets/Locate" 
  
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
  FeatureLayer,
  Sketch,
  geometryEngine,
  Graphic,
  webMercatorUtils,
  Measurement,
  ScaleBar,
  Home,
  Locate
) {
  const cfg = window.SORA_CONFIG;
  
  // ---------- helpers ----------
function clampNonNegative(v) {
  // Handles: empty string, comma decimals ("17,2"), undefined
  const s = String(v ?? "").trim().replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

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

    // --- Scalebar (metric)
    const scaleBar = new ScaleBar({
      view: view,
      unit: "metric"
    });

    view.ui.add(scaleBar, {
      position: "bottom-left"
    });

    // --- Home (zoom to initial extent)
    const home = new Home({ view: view });
    view.ui.add(home, { position: "top-left" });

    // --- Locate (GPS)
    const locate = new Locate({
      view: view,
      useHeadingEnabled: false,
      goToOverride: (view, options) => {
        options.target.scale = 2000; // adjust if you want closer/farther
        return view.goTo(options.target);
      }
    });
    view.ui.add(locate, { position: "top-left" });

    // -------------------------------
    // MISSION LAYER + STATE
    // -------------------------------
    const drawLayer = new GraphicsLayer({ title: "Mission drawing layer" });
    view.map.add(drawLayer);

    const missionLayer = new GraphicsLayer({ title: "Mission planning" });
    view.map.add(missionLayer);
    
    let missionGeom = null;
    let lastCvGeom = null;
    let lastGrbGeom = null;
    let lastCvMeters = null;
    let lastGrbMeters = null;
    let currentOperationId = null;
    function getOperationId() {
      if (!currentOperationId) {
        const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
        currentOperationId = `OP_${stamp}`;
      }
      return currentOperationId;
    } 
    
    function setAOIStatus(msg) {
      const el = document.getElementById("aoiStatus");
      if (el) el.textContent = msg || "";
    }

    function setBufferStatus(msg) {
      const el = document.getElementById("bufferStatus");
      if (el) el.textContent = msg || "";
    }

    function setRPStatus(msg) {
      const el = document.getElementById("rpStatus");
      if (el) el.textContent = msg || "";
    }

    // Requested colors (AOI/CV/GRB)
    const aoiSymbol = {
      type: "simple-fill",
      color: [0, 180, 0, 0.14],
      outline: { color: [0, 140, 0, 0.95], width: 2 }
    };

    const cvSymbol = {
      type: "simple-fill",
      color: [255, 215, 0, 0.18],
      outline: { color: [200, 150, 0, 0.95], width: 2 }
    };

    const grbSymbol = {
      type: "simple-fill",
      color: [255, 0, 0, 0.05],
      outline: { color: [255, 0, 0, 0.95], width: 2 }
    };

    // Sketch for drawing mission polygon
    const sketchMission = new Sketch({
      view: view,
      layer: drawLayer,
      creationMode: "single",
      availableCreateTools: ["polygon"],
      updateOnGraphicClick: false,
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
      setAOIStatus("Drawing mission polygon… double-click to finish.");
      sketchMission.create("polygon");
    };

    // Sketch complete
    sketchMission.on("create", (evt) => {
      if (evt.state === "complete") {

        missionGeom = evt.graphic.geometry;

        drawLayer.removeAll();

        missionLayer.add(
          new Graphic({
            geometry: missionGeom,
            symbol: aoiSymbol
          })
        );

        sketchMission.cancel();
        sketchMission.visible = false;

        setAOIStatus("Mission area set.");
        view.goTo(missionGeom, { padding: 40 });
      }
    });
    
    // Button: Clear mission
    document.getElementById("btnClearMission").onclick = () => {
      drawLayer.removeAll();
      missionLayer.removeAll();
      labelLayer.removeAll();
      missionGeom = null;
      lastCvGeom = null;
      lastGrbGeom = null;
      lastCvMeters = null;
      lastGrbMeters = null;
      currentOperationId = null;
      clearOutputs();
      setAOIStatus("Mission cleared.");
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
          setAOIStatus("GeoJSON geometry missing.");
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
            setAOIStatus("MultiPolygon has no coordinates.");
            return;
          }
          const rings = firstPoly.map(ring => ring.map(([x, y]) => [x, y]));
          polygon4326 = {
            type: "polygon",
            rings: rings,
            spatialReference: { wkid: 4326 }
          };
        } else {
          setAOIStatus("GeoJSON must contain Polygon or MultiPolygon.");
          return;
        }   

        const polyForView = webMercatorUtils.canProject(polygon4326, view.spatialReference)
          ? webMercatorUtils.project(polygon4326, view.spatialReference)
          : polygon4326;

        missionLayer.removeAll();
        missionLayer.add(new Graphic({
          geometry: polyForView,
          symbol: aoiSymbol
        }));

        missionGeom = polyForView;
        sketchMission.cancel();
        sketchMission.visible = false;
        setAOIStatus("Mission area imported.");

        // Zoom to imported mission
        const target = missionLayer.graphics.getItemAt(0);
        if (target) {
          view.goTo(target.geometry.extent.expand(1.2), { padding: 60 });
        }
        
      } catch (e) {
        console.error(e);
        setAOIStatus("Import failed. Check file is valid GeoJSON.");
      } finally {
        fileInput.value = ""; // allow re-importing same file
      }
    });

    // -------------------------------
    // DRONE + BUFFER ENGINE (CV + GRB)
    // -------------------------------

    // Add a label layer for text labels
    const labelLayer = new GraphicsLayer({ title: "SORA labels" });
    view.map.add(labelLayer);

    // -------------------------------
    // REMOTE PILOTS (RP + CGA + VLOS)
    // -------------------------------
    const rpLayer = new GraphicsLayer({ title: "Remote pilots (RP)" });
    view.map.add(rpLayer);

    // Hosted Feature Layers for saving to ArcGIS Online
    const buffersFeatureLayer = new FeatureLayer({
      url: cfg.buffersLayerUrl
    });

    const remotePilotsFeatureLayer = new FeatureLayer({
      url: cfg.remotePilotsLayerUrl
    });

    // Keep a list so we can remove last / clear all
    const rpItems = []; // each item: { pointG, cgaG, vlosG, labelG }
    let placingRp = false;
    let rpClickHandle = null;

    // Symbols
    const rpPointSymbol = {
      type: "simple-marker",
      style: "circle",
      size: 10,
      color: [255, 0, 255, 0.9],
      outline: { color: [255, 255, 255, 1], width: 1.5 }
    };

    const cgaSymbol = {
      type: "simple-fill",
      color: [255, 0, 255, 0.10], // magenta
      outline: { color: [200, 0, 200, 0.95], width: 2 }
    };

    const vlosSymbol = {
      type: "simple-fill",
      color: [0, 180, 255, 0.06], // cyan fill
      outline: { color: [0, 140, 200, 0.95], width: 2, style: "dash" }
    };

    // Helper: create a text label graphic at a point
    function makeRpLabel(point, text) {
      return new Graphic({
        geometry: point,
        symbol: {
          type: "text",
          text,
          color: "black",
          haloColor: "white",
          haloSize: 2,
          font: { size: 12, family: "Arial", weight: "bold" },
          xoffset: 12,
          yoffset: 12
        }
      });
    }

    // Start placing mode
    function startPlaceRp() {
      if (placingRp) return;
      if (!droneSelect.value) {
        setRPStatus("Select a drone before placing remote pilots.");
        return;
      }

      placingRp = true;
      document.getElementById("btnAddRP").textContent = "Stop placing Remote Pilot";
      setRPStatus("Click on the map to place a Remote Pilot point (RP).");

      rpClickHandle = view.on("click", (evt) => {
        const d = drones[droneSelect.value];
        if (!d) return;

        const pt = evt.mapPoint;
        const rpIndex = rpItems.length + 1;

        // CGA + VLOS buffers around RP
        const cgaGeom = geometryEngine.geodesicBuffer(pt, d.cgaRadius, "meters");
        const vlosGeom = geometryEngine.geodesicBuffer(pt, d.vlosRadius, "meters");

        const pointG = new Graphic({ geometry: pt, symbol: rpPointSymbol, attributes: { rp_id: rpIndex } });
        const cgaG = new Graphic({ geometry: cgaGeom, symbol: cgaSymbol, attributes: { rp_id: rpIndex, type: "CGA", radius_m: d.cgaRadius } });
        const vlosG = new Graphic({ geometry: vlosGeom, symbol: vlosSymbol, attributes: { rp_id: rpIndex, type: "VLOS", radius_m: d.vlosRadius } });
        const labelG = makeRpLabel(pt, `RP${rpIndex}`);

        rpLayer.addMany([vlosG, cgaG, pointG, labelG]);
        rpItems.push({ pointG, cgaG, vlosG, labelG });

        // zoom gently to include new vlos (optional)
        view.goTo(vlosGeom.extent.expand(1.1), { padding: 60 });
      });
    }

    // Stop placing mode
    function stopPlaceRp() {
      placingRp = false;
      document.getElementById("btnAddRP").textContent = "Add Remote Pilot";
      if (rpClickHandle) {
        rpClickHandle.remove();
        rpClickHandle = null;
      }
      setRPStatus("Remote pilot placing stopped.");
    }

    // Buttons (these IDs must exist in HTML)
    document.getElementById("btnAddRP").onclick = () => {
      // toggle placing mode
      if (placingRp) stopPlaceRp();
      else startPlaceRp();
    };

    document.getElementById("btnRemoveLastRP").onclick = () => {
      const last = rpItems.pop();
      if (!last) {
        setRPStatus("No remote pilots to remove.");
        return;
      }
      rpLayer.removeMany([last.vlosG, last.cgaG, last.pointG, last.labelG]);
      setRPStatus("Removed last remote pilot.");
    };

    document.getElementById("btnClearAllRP").onclick = () => {
      rpItems.length = 0;
      rpLayer.removeAll();
      setRPStatus("Cleared all remote pilots.");
    };

    document.getElementById("btnSaveRP").onclick = async () => {
      const droneKey = droneSelect.value;
      if (!droneKey) {
        setRPStatus("Select a drone first.");
        return;
      }

      if (rpItems.length === 0) {
        setRPStatus("No remote pilots to save.");
        return;
      }

      const d = drones[droneKey];
      const operationId = getOperationId();
      const now = Date.now();

      // 1) Save RP points to point layer
      const rpPointFeatures = rpItems.map((item, idx) => ({
        geometry: item.pointG.geometry,
        attributes: {
          operation_id: operationId,
          drone_model: d.name,
          vlos_m: d.vlosRadius,
          cga_m: d.cgaRadius,
          notes: `RP${idx + 1}`,
          created_at: now
        }
      }));

      // 2) Save CGA + VLOS polygons to polygon layer
      const rpPolygonFeatures = [];
      rpItems.forEach((item, idx) => {
        rpPolygonFeatures.push({
          geometry: item.cgaG.geometry,
          attributes: {
            operation_id: operationId,
            drone_model: d.name,
            feature_type: "CGA",
            scv_m: null,
            grb_m: null,
            vlos_m: d.vlosRadius,
            cga_m: d.cgaRadius,
            planned_speed_ms: null,
            planned_altitude_m: null,
            parachute_min_agl_m: d.parachuteMinHeight,
            notes: `RP${idx + 1}`,
            created_at: now
          }
        });

        rpPolygonFeatures.push({
          geometry: item.vlosG.geometry,
          attributes: {
            operation_id: operationId,
            drone_model: d.name,
            feature_type: "VLOS",
            scv_m: null,
            grb_m: null,
            vlos_m: d.vlosRadius,
            cga_m: d.cgaRadius,
            planned_speed_ms: null,
            planned_altitude_m: null,
            parachute_min_agl_m: d.parachuteMinHeight,
            notes: `RP${idx + 1}`,
            created_at: now
          }
        });
      });

      try {
        const pointResult = await remotePilotsFeatureLayer.applyEdits({
          addFeatures: rpPointFeatures
        });

        const polyResult = await buffersFeatureLayer.applyEdits({
          addFeatures: rpPolygonFeatures
        });

        const addedPts = pointResult.addFeatureResults?.filter(r => !r.error).length || 0;
        const addedPolys = polyResult.addFeatureResults?.filter(r => !r.error).length || 0;

        setRPStatus(`Saved ${addedPts} RP points and ${addedPolys} RP polygons to ArcGIS Online.`);
      } catch (err) {
        console.error(err);
        setRPStatus("Saving remote pilots failed. Check permissions and layer schema.");
      }
    };
    
    function clearBuffersKeepMission() {
      // Keep the mission polygon if it exists; rebuild all buffers/labels
      const missionGraphic = missionGeom
        ? new Graphic({ geometry: missionGeom, symbol: aoiSymbol })
        : null;

      missionLayer.removeAll();
      labelLayer.removeAll();

      if (missionGraphic) missionLayer.add(missionGraphic);
    }

    function setOut(id, val) {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    }
    
    function clearOutputs() {
      setOut("outAoiHa", "—");
      setOut("outCvHa", "—");
      setOut("outGrbHa", "—");
      setOut("outCvM", "—");
      setOut("outGrbM", "—");
    }

    function redrawMissionOnly() {
      // Clears CV/GRB + labels, but keeps AOI if present
      labelLayer.removeAll();
      missionLayer.removeAll();
      if (missionGeom) {
        missionLayer.add(new Graphic({ geometry: missionGeom, symbol: aoiSymbol }));
      }
    }

    function haFromGeom(geom) {
      const sqm = Math.abs(geometryEngine.geodesicArea(geom, "square-meters"));
      return sqm / 10000;
    }

    function addLabel(text, geom, where = "center") {
      const ex = geom?.extent;
      if (!ex) return;

      let pt;
      if (where === "tl") pt = ex.clone().expand(1).xmin !== undefined ? ex : ex; // keep simple
      // simplest reliable approach:
      const xmid = (ex.xmin + ex.xmax) / 2;
      const ymid = (ex.ymin + ex.ymax) / 2;

      if (where === "tl") pt = { type:"point", x: ex.xmin, y: ex.ymax, spatialReference: ex.spatialReference };
      else if (where === "tr") pt = { type:"point", x: ex.xmax, y: ex.ymax, spatialReference: ex.spatialReference };
      else if (where === "br") pt = { type:"point", x: ex.xmax, y: ex.ymin, spatialReference: ex.spatialReference };
      else pt = { type:"point", x: xmid, y: ymid, spatialReference: ex.spatialReference };

      labelLayer.add(new Graphic({
        geometry: pt,
        symbol: {
          type: "text",
          text,
          color: "black",
          haloColor: "white",
          haloSize: 2,
          font: { size: 12, family: "Arial", weight: "bold" },
          horizontalAlignment: "left",
          verticalAlignment: "top"
        }
      }));
    }

    // Drone definitions with default GRB + references + MOC defaults
    const drones = {
      m350: {
        name: "DJI M350 RTK",
        wingspan: 1.4,
        mtow: 9.2,
        parachuteMinHeight: 39,
        cgaRadius: 39,
        vlosRadius: 497,
        defaultGRB: 245,
        grbRef: "as defined in PRS Kronos M350 User's Manual and Instructions, page 101",
        grbCalcDefaults: { V: 17, Vwind: 9.34, HT: 120, Sp: 5.1, LH: 1.0, LS: 1.41 },
        cvDefaults: { sgnss: 3, spos: 3, sk: 1, trStop: 3, theta: 30, TR: 1.41, TP: 1.32 }
      },
      tundra2: {
        name: "Hexadrone Tundra 2 Endurance",
        wingspan: 1.84,
        mtow: 12.9,
        parachuteMinHeight: 47,
        cgaRadius: 47,
        vlosRadius: 622,
        defaultGRB: 179,
        grbRef: "as defined in Hexadrone Containment Flight Manual for Tundra 2.1, page 16",
        grbCalcDefaults: { V: 17, Vwind: 7.2, HT: 120, Sp: 6.9, LH: 1.0, LS: 1.41 },
        cvDefaults: { sgnss: 3, spos: 3, sk: 1, trStop: 3, theta: 30, TR: 1.41, TP: 1.32 }
      }
    };

    const droneSelect = document.getElementById("droneSelect");
    const droneInfo = document.getElementById("droneInfo");
    const grbDefaultsEl = document.getElementById("grbDefaults");

    // CV toggles
    const chkCvParachute = document.getElementById("chkCvParachute");
    const cvNoParaBlock = document.getElementById("cvNoParaBlock");
    const cvParaBlock = document.getElementById("cvParaBlock");

    chkCvParachute.onchange = () => {
      const usePara = chkCvParachute.checked;
      if (cvNoParaBlock) cvNoParaBlock.style.display = usePara ? "none" : "block";
      if (cvParaBlock) cvParaBlock.style.display = usePara ? "block" : "none";
    };

    // GRB toggles
    const chkCustomGRB = document.getElementById("chkCustomGRB");
    const grbCustomBlock = document.getElementById("grbCustomBlock");

    chkCustomGRB.onchange = () => {
      if (grbCustomBlock) grbCustomBlock.style.display = chkCustomGRB.checked ? "block" : "none";
    };

    // Keep GRB T synced to LH + LS
    function updateGrbT() {
      const LH = clampNonNegative(document.getElementById("grbLH")?.value);
      const LS = clampNonNegative(document.getElementById("grbLS")?.value);
      const T = (LH + LS);
      const tEl = document.getElementById("grbT");
      if (tEl) tEl.value = T.toFixed(2);
    }
    document.getElementById("grbLH")?.addEventListener("input", updateGrbT);
    document.getElementById("grbLS")?.addEventListener("input", updateGrbT);

    function populateDefaults(droneKey) {
      const d = drones[droneKey];
      if (!d) return;

      // Shared
      document.getElementById("inputV0").value = d.grbCalcDefaults.V;
      document.getElementById("inputHT").value = d.grbCalcDefaults.HT;

      // CV params
      document.getElementById("cvSgnss").value = d.cvDefaults.sgnss;
      document.getElementById("cvSpos").value = d.cvDefaults.spos;
      document.getElementById("cvSk").value = d.cvDefaults.sk;
      document.getElementById("cvTrStop").value = d.cvDefaults.trStop;
      document.getElementById("cvTheta").value = d.cvDefaults.theta;
      document.getElementById("cvTR").value = d.cvDefaults.TR;
      document.getElementById("cvTP").value = d.cvDefaults.TP;

      // GRB custom defaults
      document.getElementById("grbLH").value = d.grbCalcDefaults.LH;
      document.getElementById("grbLS").value = d.grbCalcDefaults.LS;
      document.getElementById("grbVwind").value = d.grbCalcDefaults.Vwind;
      document.getElementById("grbSp").value = d.grbCalcDefaults.Sp;
      updateGrbT();

      // Drone info panel
     droneInfo.innerHTML = `
        <b>${d.name}</b><br>
        Wingspan: ${d.wingspan} m<br>
        MTOW: ${d.mtow} kg<br>
        Parachute min height: ${d.parachuteMinHeight} m AGL<br>
        VLOS max: ${d.vlosRadius} m
      `;

      if (grbDefaultsEl) {
        grbDefaultsEl.textContent = `Default GRB: ${d.defaultGRB} m (${d.grbRef})`;
      }
    }

    droneSelect.onchange = () => {
      const key = droneSelect.value;
      if (!key) {
        droneInfo.innerHTML = "";
        if (grbDefaultsEl) grbDefaultsEl.textContent = "";
        return;
      }
      populateDefaults(key);
    };

    document.getElementById("btnResetBuffers").onclick = () => {
      // Remove buffers + labels + stats
      redrawMissionOnly();
      clearOutputs();

      // Restore defaults for the selected drone (if any)
      const key = droneSelect.value;
      if (key) populateDefaults(key);

      setBufferStatus("Reset done. AOI kept. Buffers/labels cleared.");
    };  

    document.getElementById("btnSaveBuffers").onclick = async () => {
      if (!missionGeom || !lastCvGeom || !lastGrbGeom) {
        setBufferStatus("Calculate buffers before saving.");
        return;
      }

      const droneKey = droneSelect.value;
      if (!droneKey) {
        setBufferStatus("Select a drone first.");
        return;
      }

      const d = drones[droneKey];
      const operationId = getOperationId();
      const v0 = clampNonNegative(document.getElementById("inputV0").value);
      const HT = clampNonNegative(document.getElementById("inputHT").value);
      const now = Date.now();

      const cvMethod = chkCvParachute.checked ? "parachute" : "stop_ua";
      const grbMethod = chkCustomGRB.checked ? "custom_moc" : "default";

      const features = [
        {
          geometry: missionGeom,
          attributes: {
            operation_id: operationId,
            drone_model: d.name,
            feature_type: "AOI",
            scv_m: lastCvMeters,
            grb_m: lastGrbMeters,
            vlos_m: null,
            cga_m: null,
            planned_speed_ms: v0,
            planned_altitude_m: HT,
            parachute_min_agl_m: d.parachuteMinHeight,
            notes: `cv_method=${cvMethod}; grb_method=${grbMethod}`,
            created_at: now
          }
        },
        {
          geometry: lastCvGeom,
          attributes: {
            operation_id: operationId,
            drone_model: d.name,
            feature_type: "CV",
            scv_m: lastCvMeters,
            grb_m: lastGrbMeters,
            vlos_m: null,
            cga_m: null,
            planned_speed_ms: v0,
            planned_altitude_m: HT,
            parachute_min_agl_m: d.parachuteMinHeight,
            notes: `cv_method=${cvMethod}; grb_method=${grbMethod}`,
            created_at: now
          }
        },
        {
          geometry: lastGrbGeom,
          attributes: {
            operation_id: operationId,
            drone_model: d.name,
            feature_type: "GRB",
            scv_m: lastCvMeters,
            grb_m: lastGrbMeters,
            vlos_m: null,
            cga_m: null,
            planned_speed_ms: v0,
            planned_altitude_m: HT,
            parachute_min_agl_m: d.parachuteMinHeight,
            notes: `cv_method=${cvMethod}; grb_method=${grbMethod}`,
            created_at: now
          }
        }
      ];

      try {
        const result = await buffersFeatureLayer.applyEdits({
          addFeatures: features
        });

        const added = result.addFeatureResults?.filter(r => !r.error).length || 0;
        setBufferStatus(`Saved ${added} polygon features to ArcGIS Online.`);
      } catch (err) {
        console.error(err);
        setBufferStatus("Saving buffers failed. Check permissions and layer schema.");
      }
    };
    
    // ----- CV formulas (from SORA) -----
    function degToRad(deg) {
      return (deg * Math.PI) / 180;
    }

    /**
     * Stop-UA (no parachute)
     * S_CV = S_GNSS + S_POS + S_K + V0*tR + S_CM
     * S_CM = 0.5 * V0^2 / (g * tan(theta))
     */
    function calcCvStopUA({ sgnss, spos, sk, v0, tR, thetaDeg }) {
      const g = 9.81;
      const theta = Math.max(0.1, thetaDeg);
      const sCM = 0.5 * (v0 * v0) / (g * Math.tan(degToRad(theta)));
      const sRZ = v0 * tR;
      return sgnss + spos + sk + sRZ + sCM;
    }

    /**
     * Parachute CV
     * S_CV = S_GNSS + S_POS + S_K + (V0*TR) + (V0*TP)
     */
    function calcCvParachute({ sgnss, spos, sk, v0, TR, TP }) {
      return sgnss + spos + sk + (v0 * TR) + (v0 * TP);
    }

    // ----- GRB MOC Light-UAS.2511-01 -----
    function calcGrbMoc({ v0, LH, LS, vwind, HT, Sp }) {
      const T = LH + LS;
      const D1 = v0 * T;
      const D2p = ((vwind * HT) / Math.max(0.1, Sp)) * 1.1;
      return { T, D1, D2p, grb: D1 + D2p };
    }

    // Calculate buffers
    document.getElementById("btnCalcBuffers").onclick = () => {
      if (!missionGeom) {
        setBufferStatus("No mission area. Draw or import a mission first.");
        return;
      }

      const droneKey = droneSelect.value;
      if (!droneKey) {
        setBufferStatus("Select a drone first.");
        return;
      }

      sketchMission.cancel();
      sketchMission.visible = false;

      const d = drones[droneKey];

      const v0 = clampNonNegative(document.getElementById("inputV0").value);
      const HT = clampNonNegative(document.getElementById("inputHT").value);

      // CV inputs
      const sgnss = clampNonNegative(document.getElementById("cvSgnss").value);
      const spos = clampNonNegative(document.getElementById("cvSpos").value);
      const sk = clampNonNegative(document.getElementById("cvSk").value);

      let cvMeters = 0;
      if (chkCvParachute.checked) {
        const TR = clampNonNegative(document.getElementById("cvTR").value);
        const TP = clampNonNegative(document.getElementById("cvTP").value);
        cvMeters = calcCvParachute({ sgnss, spos, sk, v0, TR, TP });
      } else {
        const tR = clampNonNegative(document.getElementById("cvTrStop").value);
        const thetaDeg = clampNonNegative(document.getElementById("cvTheta").value);
        cvMeters = calcCvStopUA({ sgnss, spos, sk, v0, tR, thetaDeg });
      }

      // GRB distance
      let grbMeters = d.defaultGRB;
      if (chkCustomGRB.checked) {
        const LH = clampNonNegative(document.getElementById("grbLH").value);
        const LS = clampNonNegative(document.getElementById("grbLS").value);
        const vwind = clampNonNegative(document.getElementById("grbVwind").value);
        const Sp = clampNonNegative(document.getElementById("grbSp").value);

        const res = calcGrbMoc({ v0, LH, LS, vwind, HT, Sp });
        grbMeters = res.grb;

        // Update T display
        const tEl = document.getElementById("grbT");
        if (tEl) tEl.value = res.T.toFixed(2);
      }

      // Redraw with requested symbology
      missionLayer.removeAll();
      labelLayer.removeAll();

      missionLayer.add(new Graphic({ geometry: missionGeom, symbol: aoiSymbol }));

      const cvGeom = geometryEngine.geodesicBuffer(missionGeom, cvMeters, "meters");
      const grbGeom = geometryEngine.geodesicBuffer(cvGeom, grbMeters, "meters");

      lastCvGeom = cvGeom;
      lastGrbGeom = grbGeom;
      lastCvMeters = cvMeters;
      lastGrbMeters = grbMeters;
      getOperationId();

      missionLayer.add(new Graphic({ geometry: cvGeom, symbol: cvSymbol }));
      missionLayer.add(new Graphic({ geometry: grbGeom, symbol: grbSymbol }));

      // Areas in ha
      const aoiHa = haFromGeom(missionGeom);
      const cvHa = haFromGeom(cvGeom);
      const grbHa = haFromGeom(grbGeom);

      setOut("outAoiHa", aoiHa.toFixed(2));
      setOut("outCvHa", cvHa.toFixed(2));
      setOut("outGrbHa", grbHa.toFixed(2));
      setOut("outCvM", cvMeters.toFixed(1));
      setOut("outGrbM", grbMeters.toFixed(1));
      
      // Labels (simple)
      addLabel(`AOI: ${aoiHa.toFixed(2)} ha`, missionGeom, "tl");
      addLabel(`CV: ${cvMeters.toFixed(1)} m\n${cvHa.toFixed(2)} ha`, cvGeom, "tr");
      addLabel(`GRB: ${grbMeters.toFixed(1)} m\n${grbHa.toFixed(2)} ha`, grbGeom, "br");
      
      setBufferStatus(`Buffers generated. CV=${cvMeters.toFixed(1)}m | GRB=${grbMeters.toFixed(1)}m`);

      // Zoom to GRB
      view.goTo(grbGeom.extent.expand(1.15), { padding: 60 });
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
