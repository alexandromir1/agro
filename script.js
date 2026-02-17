/* AgroAI demo — полностью статично, без бэкенда, подходит для GitHub Pages */
(() => {
  "use strict";

  // -----------------------------
  // Small helpers
  // -----------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const round = (n, digits = 0) => {
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  };
  const formatMoney = (n) => {
    const whole = Math.round(n);
    return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };
  const formatLatLng = (latlng) => `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;

  // Stable seeded randomness for believable variation (deterministic per inputs)
  const hash32 = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  const mulberry32 = (seed) => {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  };

  // -----------------------------
  // DOM references
  // -----------------------------
  const jumpToInputsBtn = $("#jumpToInputs");
  const fillSampleBtn = $("#fillSample");
  const clearFieldBtn = $("#clearField");
  const startBtn = $("#startAnalysis");
  const runAgainBtn = $("#runAgain");
  const shareBtn = $("#shareSnapshot");

  const soilForm = $("#soilForm");
  const inputStatus = $("#inputStatus");
  const readyBadge = $("#readyBadge");
  const readyText = $("#readyText");

  const fieldSelectionLabel = $("#fieldSelectionLabel");
  const fieldCenterLabel = $("#fieldCenterLabel");
  const fieldAreaLabel = $("#fieldAreaLabel");

  const resultsWrap = $("#resultsWrap");
  const loading = $("#loading");
  const loadingBar = $("#loadingBar");
  const loadingSub = $("#loadingSub");
  const dashboard = $("#dashboard");
  const toast = $("#toast");

  const kpiYield = $("#kpiYield");
  const kpiProfit = $("#kpiProfit");
  const kpiArea = $("#kpiArea");

  const kpiYieldFoot = $("#kpiYieldFoot");
  const kpiProfitFoot = $("#kpiProfitFoot");
  const kpiAreaFoot = $("#kpiAreaFoot");

  const resultCropTag = $("#resultCropTag");
  const fertilizerText = $("#fertilizerText");
  const fertilizerChips = $("#fertilizerChips");
  const careChecklist = $("#careChecklist");

  const sumPh = $("#sumPh");
  const sumNpk = $("#sumNpk");
  const sumMoisture = $("#sumMoisture");
  const sumOm = $("#sumOm");
  const sumCenter = $("#sumCenter");
  const sumSelection = $("#sumSelection");

  const cropCards = $$(".crop-card");

  // -----------------------------
  // State
  // -----------------------------
  let selectedCrop = null;
  let selectedShape = null; // Leaflet layer (polygon/rectangle)
  let selectionType = null; // "Polygon" | "Rectangle"
  let selectionCenter = null; // L.LatLng
  let selectionAreaM2 = null;
  let clickMarker = null; // optional marker for "clickable map" feedback
  let analysisInFlight = false;

  // -----------------------------
  // Map setup (Leaflet + Draw)
  // -----------------------------
  const initMap = () => {
    const map = L.map("map", {
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: false, // скрываем блок "Leaflet | © OpenStreetMap" (без логотипов)
    });

    // Стартовая точка демо: Якутск (РФ). Пользователь может свободно панорамировать/масштабировать.
    const defaultCenter = [62.0272, 129.7321]; // Якутск
    map.setView(defaultCenter, 11);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    // Нейтральная стартовая метка “Якутск” (без флагов/символики).
    L.circleMarker(defaultCenter, {
      radius: 7,
      color: "#2fe082",
      weight: 2,
      fillColor: "#2fe082",
      fillOpacity: 0.85,
    })
      .addTo(map)
      .bindPopup(
        `<div style="font-weight:900;letter-spacing:-0.02em">Якутск</div>
         <div style="margin-top:6px;opacity:0.78">Выделите участок (полигон/прямоугольник) вокруг поля для анализа.</div>`
      );

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
      position: "topright",
      draw: {
        polyline: false,
        circle: false,
        circlemarker: false,
        marker: false,
        polygon: {
          allowIntersection: false,
          showArea: false, // we show our own metrics
          shapeOptions: {
            color: "#2fe082",
            weight: 3,
            fillColor: "#2fe082",
            fillOpacity: 0.18,
          },
        },
        rectangle: {
          shapeOptions: {
            color: "#2fe082",
            weight: 3,
            fillColor: "#2fe082",
            fillOpacity: 0.18,
          },
        },
      },
      edit: {
        featureGroup: drawnItems,
        edit: true,
        remove: true,
      },
    });
    map.addControl(drawControl);

    const setShapeSelected = (layer, typeLabel) => {
      // Keep only one active selection for clarity
      drawnItems.eachLayer((l) => drawnItems.removeLayer(l));
      drawnItems.addLayer(layer);

      selectedShape = layer;
      selectionType = typeLabel;
      selectionCenter = computeLayerCenter(layer);
      selectionAreaM2 = computeLayerAreaM2(layer);

      // Bring selection into view
      try {
        const b = layer.getBounds?.();
        if (b) map.fitBounds(b.pad(0.2), { animate: true });
      } catch {
        // ignore
      }

      updateFieldMeta();
      updateReadiness();
    };

    map.on(L.Draw.Event.CREATED, (e) => {
      const { layerType, layer } = e;
      if (layerType === "polygon") setShapeSelected(layer, "Полигон");
      else if (layerType === "rectangle") setShapeSelected(layer, "Прямоугольник");
    });

    map.on(L.Draw.Event.EDITED, (e) => {
      // If user edits, keep whichever is present as the active selection
      const layers = e.layers;
      let first = null;
      layers.eachLayer((layer) => {
        if (!first) first = layer;
      });
      if (first) {
        const typeLabel = inferTypeLabel(first);
        selectedShape = first;
        selectionType = typeLabel;
        selectionCenter = computeLayerCenter(first);
        selectionAreaM2 = computeLayerAreaM2(first);
        updateFieldMeta();
        updateReadiness();
      }
    });

    map.on(L.Draw.Event.DELETED, () => {
      selectedShape = null;
      selectionType = null;
      selectionCenter = null;
      selectionAreaM2 = null;
      updateFieldMeta();
      updateReadiness();
    });

    // Требование: карта должна быть кликабельной
    map.on("click", (e) => {
      const ll = e.latlng;
      if (!clickMarker) {
        clickMarker = L.circleMarker(ll, {
          radius: 6,
          color: "#d7c7a1",
          weight: 2,
          fillColor: "#d7c7a1",
          fillOpacity: 0.9,
        }).addTo(map);
      } else {
        clickMarker.setLatLng(ll);
      }

      clickMarker
        .bindPopup(
          `<div style="font-weight:800;letter-spacing:-0.02em">Метка поля</div>
           <div style="margin-top:6px;opacity:0.85">Координаты: ${formatLatLng(ll)}</div>
           <div style="margin-top:6px;opacity:0.72">Нарисуйте полигон/прямоугольник, чтобы выделить весь участок.</div>`
        )
        .openPopup();
    });

    // Clear selection button
    clearFieldBtn.addEventListener("click", () => {
      drawnItems.eachLayer((l) => drawnItems.removeLayer(l));
      selectedShape = null;
      selectionType = null;
      selectionCenter = null;
      selectionAreaM2 = null;
      updateFieldMeta();
      updateReadiness();
    });

    // Initial meta
    updateFieldMeta();

    // Make map responsive in case of font load / layout shift
    setTimeout(() => map.invalidateSize(), 350);
    window.addEventListener("resize", () => map.invalidateSize());
  };

  const inferTypeLabel = (layer) => {
    // Leaflet-draw rectangle is a Polygon with 4 points + bounds; safest: use bounds check.
    try {
      const ll = layer.getLatLngs?.();
      const flat = Array.isArray(ll) ? (Array.isArray(ll[0]) ? ll[0] : ll) : [];
      if (flat.length === 4) return "Прямоугольник";
    } catch {
      // ignore
    }
    return "Полигон";
  };

  const computeLayerCenter = (layer) => {
    try {
      if (layer.getBounds) return layer.getBounds().getCenter();
    } catch {
      // ignore
    }
    return null;
  };

  const computeLayerAreaM2 = (layer) => {
    // Prefer Leaflet.GeometryUtil if present (used by Leaflet.Draw in many setups)
    const getLatLngs = () => {
      const ll = layer.getLatLngs?.();
      if (!ll) return null;
      // polygon/rectangle returns [ [LatLng...] ]
      if (Array.isArray(ll) && Array.isArray(ll[0])) return ll[0];
      // some cases might return flat
      if (Array.isArray(ll)) return ll;
      return null;
    };

    const points = getLatLngs();
    if (!points || points.length < 3) return null;

    if (L.GeometryUtil && typeof L.GeometryUtil.geodesicArea === "function") {
      return L.GeometryUtil.geodesicArea(points);
    }

    // Fallback: approximate area on Earth using equirectangular projection + shoelace
    const R = 6371008.8; // meters
    const toRad = (d) => (d * Math.PI) / 180;
    const lat0 = toRad(points.reduce((a, p) => a + p.lat, 0) / points.length);
    const coords = points.map((p) => {
      const x = R * toRad(p.lng) * Math.cos(lat0);
      const y = R * toRad(p.lat);
      return { x, y };
    });
    let area2 = 0;
    for (let i = 0; i < coords.length; i++) {
      const j = (i + 1) % coords.length;
      area2 += coords[i].x * coords[j].y - coords[j].x * coords[i].y;
    }
    return Math.abs(area2) / 2;
  };

  const formatArea = (m2) => {
    if (!Number.isFinite(m2)) return "—";
    const ha = m2 / 10000;
    if (ha < 1) {
      const acres = ha * 2.47105;
      return `${ha.toFixed(2)} га (${acres.toFixed(2)} ac)`;
    }
    const acres = ha * 2.47105;
    return `${ha.toFixed(2)} га (${acres.toFixed(1)} ac)`;
  };

  const updateFieldMeta = () => {
    if (!selectedShape || !selectionCenter || !Number.isFinite(selectionAreaM2)) {
      fieldSelectionLabel.textContent = "Нет";
      fieldCenterLabel.textContent = "—";
      fieldAreaLabel.textContent = "—";
      return;
    }

    fieldSelectionLabel.textContent = selectionType || "Участок";
    fieldCenterLabel.textContent = formatLatLng(selectionCenter);
    fieldAreaLabel.textContent = formatArea(selectionAreaM2);
  };

  // -----------------------------
  // Crop selection
  // -----------------------------
  const setCrop = (cropKey) => {
    selectedCrop = cropKey;
    cropCards.forEach((btn) => {
      const isActive = btn.dataset.crop === cropKey;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    updateReadiness();
  };

  cropCards.forEach((btn) => {
    btn.addEventListener("click", () => setCrop(btn.dataset.crop));
  });

  // -----------------------------
  // Form & readiness gating
  // -----------------------------
  const getSoilValues = () => {
    const getNum = (id) => {
      const el = document.getElementById(id);
      const v = el.value.trim();
      if (v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      ph: getNum("ph"),
      n: getNum("n"),
      p: getNum("p"),
      k: getNum("k"),
      moisture: getNum("moisture"),
      om: getNum("om"),
    };
  };

  const hasRequiredSoil = (s) =>
    s &&
    [s.ph, s.n, s.p, s.k, s.moisture, s.om].every((v) => v !== null && Number.isFinite(v));

  const hasFieldArea = () =>
    !!selectedShape && !!selectionCenter && Number.isFinite(selectionAreaM2) && selectionAreaM2 > 5;

  const updateReadiness = () => {
    const soil = getSoilValues();
    const soilOk = hasRequiredSoil(soil);
    const fieldOk = hasFieldArea();
    const cropOk = !!selectedCrop;

    const ready = soilOk && fieldOk && cropOk && !analysisInFlight;
    startBtn.disabled = !ready;

    const missing = [];
    if (!soilOk) missing.push("данные почвы");
    if (!fieldOk) missing.push("участок на карте");
    if (!cropOk) missing.push("культура");

    if (analysisInFlight) {
      inputStatus.textContent = "Анализ выполняется… после результатов можно менять входные данные и запускать снова.";
      readyBadge.textContent = "В работе";
      readyBadge.classList.remove("is-ready");
      readyText.textContent = "Имитируем ИИ-анализ и формируем рекомендации.";
      return;
    }

    if (missing.length === 0) {
      inputStatus.textContent = "Готово. Нажмите «Запустить ИИ‑анализ», чтобы получить рекомендации.";
      readyBadge.textContent = "Готово";
      readyBadge.classList.add("is-ready");
      readyText.textContent = "Все шаги выполнены. Нажмите «Запустить ИИ‑анализ».";
    } else {
      inputStatus.textContent = `Не хватает: ${missing.join(", ")}.`;
      readyBadge.textContent = "Не готово";
      readyBadge.classList.remove("is-ready");
      readyText.textContent = "Завершите все шаги, чтобы запустить анализ.";
    }
  };

  const attachFormListeners = () => {
    const inputs = $$('input[type="number"]', soilForm);
    inputs.forEach((input) => {
      input.addEventListener("input", () => updateReadiness());
      input.addEventListener("blur", () => updateReadiness());
    });

    fillSampleBtn.addEventListener("click", () => {
      const sample = {
        ph: "6.4",
        n: "48",
        p: "16",
        k: "64",
        moisture: "23.5",
        om: "2.9",
      };
      Object.entries(sample).forEach(([key, value]) => {
        const el = document.getElementById(key);
        if (el) el.value = value;
      });
      updateReadiness();
      $("#ph")?.focus();
    });
  };

  // -----------------------------
  // AI simulation & results
  // -----------------------------
  const CROP_PROFILES = {
    potato: {
      label: "Картофель",
      phRange: [5.5, 7.0],
      baseRevenuePerHa: 1800,
      nutrientDemand: { n: 1.1, p: 1.05, k: 1.2 },
      moistureOpt: [20, 35],
      omOptMin: 2.8,
    },
    oats: {
      label: "Овёс",
      phRange: [5.5, 7.2],
      baseRevenuePerHa: 1200,
      nutrientDemand: { n: 1.0, p: 0.95, k: 0.9 },
      moistureOpt: [18, 30],
      omOptMin: 2.5,
    },
    cabbage: {
      label: "Капуста",
      phRange: [6.0, 7.2],
      baseRevenuePerHa: 2200,
      nutrientDemand: { n: 1.05, p: 1.1, k: 1.1 },
      moistureOpt: [22, 38],
      omOptMin: 3.2,
    },
  };

  const scoreSoil = (soil, profile) => {
    // Scoring returns (0..100) with breakdown for messaging.
    const notes = [];

    // pH score
    const [phMin, phMax] = profile.phRange;
    const phMid = (phMin + phMax) / 2;
    const phDelta = Math.abs(soil.ph - phMid);
    const phScore = clamp(100 - phDelta * 22, 40, 100);
    if (soil.ph < phMin) notes.push("pH почвы немного ниже оптимума для выбранной культуры.");
    else if (soil.ph > phMax) notes.push("pH почвы немного выше оптимума для выбранной культуры.");
    else notes.push("pH почвы в здоровом диапазоне для культуры.");

    // NPK score — using simple thresholds (ppm-ish demo)
    const targets = { n: 55, p: 20, k: 70 };
    const weights = profile.nutrientDemand;
    const nutrientScore = (val, t, w) => {
      const ratio = val / t;
      const s = ratio >= 1 ? 100 - (ratio - 1) * 20 : 60 + ratio * 40;
      return clamp(s * (1 / w) + (w - 1) * 10, 45, 100);
    };
    const nScore = nutrientScore(soil.n, targets.n, weights.n);
    const pScore = nutrientScore(soil.p, targets.p, weights.p);
    const kScore = nutrientScore(soil.k, targets.k, weights.k);
    const npkScore = (nScore + pScore + kScore) / 3;

    const low = [];
    if (soil.n < targets.n * 0.85) low.push("N");
    if (soil.p < targets.p * 0.85) low.push("P");
    if (soil.k < targets.k * 0.85) low.push("K");
    if (low.length) notes.push(`Ограничивающий фактор: ${low.join(", ")} ниже целевого уровня.`);
    else notes.push("Уровни NPK сбалансированы для стабильного роста.");

    // Moisture score
    const [mMin, mMax] = profile.moistureOpt;
    let mScore = 100;
    if (soil.moisture < mMin) mScore = clamp(70 - (mMin - soil.moisture) * 2.2, 40, 90);
    else if (soil.moisture > mMax) mScore = clamp(78 - (soil.moisture - mMax) * 2.0, 40, 90);
    else mScore = 92 + (Math.min(soil.moisture - mMin, mMax - soil.moisture) / (mMax - mMin)) * 8;
    notes.push(
      soil.moisture < mMin
        ? "Влажность ниже оптимума — важна точность графика полива."
        : soil.moisture > mMax
          ? "Влажность высокая — проверьте дренаж и аэрацию корней."
          : "Влажность в оптимальном диапазоне для эффективного усвоения."
    );

    // Organic matter score
    const omScore = clamp(55 + (soil.om / profile.omOptMin) * 45, 45, 100);
    notes.push(
      soil.om < profile.omOptMin
        ? "Органического вещества мало — добавьте компост/сидераты для улучшения структуры."
        : "Органическое вещество помогает удерживать влагу и улучшает цикл питания."
    );

    // Weighted overall
    const overall = 0.26 * phScore + 0.34 * npkScore + 0.22 * mScore + 0.18 * omScore;
    return {
      overall: clamp(overall, 40, 100),
      phScore,
      npkScore,
      nScore,
      pScore,
      kScore,
      mScore,
      omScore,
      notes,
    };
  };

  const buildFertilizerPlan = (soil, profile, rng) => {
    // Mock kg/ha based on nutrient gaps (demo), split into 2-3 applications
    const targets = { n: 55, p: 20, k: 70 };
    const demand = profile.nutrientDemand;
    const gap = {
      n: clamp((targets.n - soil.n) / targets.n, -0.25, 1.0) * demand.n,
      p: clamp((targets.p - soil.p) / targets.p, -0.25, 1.0) * demand.p,
      k: clamp((targets.k - soil.k) / targets.k, -0.25, 1.0) * demand.k,
    };

    const base = {
      n: 80 * demand.n,
      p: 45 * demand.p,
      k: 55 * demand.k,
    };

    const kgHa = {
      n: clamp(base.n * (1 + gap.n) * (0.92 + rng() * 0.16), 45, 165),
      p: clamp(base.p * (1 + gap.p) * (0.92 + rng() * 0.16), 22, 95),
      k: clamp(base.k * (1 + gap.k) * (0.92 + rng() * 0.16), 28, 120),
    };

    const split = {
      basal: { n: 0.45, p: 0.75, k: 0.55 },
      mid: { n: 0.35, p: 0.15, k: 0.30 },
      late: { n: 0.20, p: 0.10, k: 0.15 },
    };

    const toKg = (x) => Math.round(x);
    const chips = [
      { text: `N: ${toKg(kgHa.n)} кг/га`, tone: "green" },
      { text: `P: ${toKg(kgHa.p)} кг/га`, tone: "earth" },
      { text: `K: ${toKg(kgHa.k)} кг/га`, tone: "earth" },
    ];

    const basal = {
      n: toKg(kgHa.n * split.basal.n),
      p: toKg(kgHa.p * split.basal.p),
      k: toKg(kgHa.k * split.basal.k),
    };
    const mid = {
      n: toKg(kgHa.n * split.mid.n),
      p: toKg(kgHa.p * split.mid.p),
      k: toKg(kgHa.k * split.mid.k),
    };
    const late = {
      n: toKg(kgHa.n * split.late.n),
      p: toKg(kgHa.p * split.late.p),
      k: toKg(kgHa.k * split.late.k),
    };

    const qualityNudge =
      profile.label === "Картофель"
        ? "Упор на калий для клубнеобразования и лёжкости; избегайте избытка азота в конце сезона."
        : profile.label === "Овёс"
          ? "Кормовая ценность выше при сбалансированном NPK и достаточной влаге в фазу выхода в трубку."
          : profile.label === "Капуста"
            ? "Влага и калий важны для плотности кочана и хранения."
            : "Держите сбалансированное внесение по фазам развития.";

    const text =
      `Рекомендованное внесение (на гектар): ` +
      `${toKg(kgHa.n)} кг N, ${toKg(kgHa.p)} кг P, ${toKg(kgHa.k)} кг K. ` +
      `Вносить дробно: Старт ${basal.n}/${basal.p}/${basal.k}, Середина сезона ${mid.n}/${mid.p}/${mid.k}, Позднее ${late.n}/${late.p}/${late.k} (N/P/K). ` +
      qualityNudge;

    return { text, chips, basal, mid, late, totals: { n: toKg(kgHa.n), p: toKg(kgHa.p), k: toKg(kgHa.k) } };
  };

  const buildCarePlan = (soil, profile, score, rng) => {
    const tasks = [];
    const [phMin, phMax] = profile.phRange;
    if (soil.ph < phMin) tasks.push("Внесите известь локально (по зонам), чтобы постепенно поднять pH и улучшить доступность питания.");
    if (soil.ph > phMax) tasks.push("Используйте элементарную серу малыми дозами (по этапам), чтобы мягко скорректировать высокий pH.");
    if (soil.om < profile.omOptMin) tasks.push("Добавьте компост или высейте сидераты, чтобы повысить органику и улучшить структуру почвы.");

    const [mMin, mMax] = profile.moistureOpt;
    if (soil.moisture < mMin) tasks.push("Планируйте полив по утренним замерам влажности; избегайте потерь в жаркие часы.");
    if (soil.moisture > mMax) tasks.push("Улучшите дренаж в низинах; избегайте уплотнения, чтобы сохранить аэрацию корней.");

    if (soil.n < 50) tasks.push("Делите внесение азота, чтобы снизить вымывание и повысить эффективность усвоения.");
    if (soil.p < 18) tasks.push("Вносите фосфор лентой ближе к корням для лучшего старта.");
    if (soil.k < 65) tasks.push("Увеличьте калий в фазе интенсивного роста для стрессоустойчивости.");

    tasks.push("Проводите еженедельный осмотр на симптомы дефицита и корректируйте внесение в середине сезона на 10–15% при необходимости.");
    tasks.push("По возможности оставляйте растительные остатки на поверхности — это снижает испарение и стабилизирует температуру почвы.");

    // Make it look curated: pick 6 items, keep variety
    const uniq = Array.from(new Set(tasks));
    const shuffled = uniq
      .map((t) => ({ t, r: rng() }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.t);
    return shuffled.slice(0, 6);
  };

  const estimateOutcomes = (soil, profile, areaHa, score, rng) => {
    // Yield increase depends on how much room for improvement exists.
    const improvementRoom = clamp((100 - score.overall) / 60, 0.05, 1.0);
    const base = 6.5 + improvementRoom * 11.5; // 6.5%..18%
    const cropAdj =
      profile.label === "Капуста" ? 1.05 : profile.label === "Картофель" ? 1.0 : profile.label === "Овёс" ? 0.95 : 0.95;
    const jitter = (rng() - 0.5) * 2.2; // +/- 2.2
    const yieldPct = clamp(base * cropAdj + jitter, 5.5, 19.5);

    // Profit: revenue lift minus optimized input costs
    const revenueLift = areaHa * profile.baseRevenuePerHa * (yieldPct / 100);
    const inputSavings = areaHa * (38 + rng() * 42); // $/ha savings
    const riskReduction = areaHa * (20 + rng() * 35); // $/ha (less loss, better timing)

    const profit = clamp(revenueLift * 0.78 + inputSavings + riskReduction, 180, 250000);

    const yieldFoot =
      yieldPct > 14
        ? "Высокий эффект за счёт устранения главного ограничивающего фактора."
        : yieldPct > 10
          ? "Умеренный эффект от точечной настройки NPK и управления влагой."
          : "Стабильный прирост от небольших корректировок и лучшего усвоения.";

    const profitFoot =
      profit > 60000
        ? "Эффект масштабируется за счёт большой площади и высокого потенциала отклика."
        : "Сбалансированная экономия от оптимизации внесения и снижения потерь.";

    return { yieldPct, profit, yieldFoot, profitFoot };
  };

  const setLoadingState = (on) => {
    resultsWrap.classList.toggle("results--hidden", !on);
    loading.classList.toggle("loading--hidden", !on);
    loading.setAttribute("aria-hidden", on ? "false" : "true");
    dashboard.classList.toggle("dashboard--hidden", true);
    dashboard.setAttribute("aria-hidden", "true");
  };

  const setDashboardState = (on) => {
    loading.classList.toggle("loading--hidden", true);
    loading.setAttribute("aria-hidden", "true");
    dashboard.classList.toggle("dashboard--hidden", !on);
    dashboard.setAttribute("aria-hidden", on ? "false" : "true");
  };

  const showToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add("is-show");
    toast.setAttribute("aria-hidden", "false");
    window.setTimeout(() => {
      toast.classList.remove("is-show");
      toast.setAttribute("aria-hidden", "true");
    }, 2400);
  };

  const buildShareSummary = (payload) => {
    const lines = [];
    lines.push(`AgroAI — демо · ${payload.cropLabel}`);
    lines.push(`Поле: ${payload.selectionType} · ${payload.areaHa.toFixed(2)} га · Центр ${payload.center}`);
    lines.push(`Почва: pH ${payload.soil.ph.toFixed(1)} · N/P/K ${Math.round(payload.soil.n)}/${Math.round(payload.soil.p)}/${Math.round(payload.soil.k)} · Влажность ${payload.soil.moisture.toFixed(1)}% · Органика ${payload.soil.om.toFixed(1)}%`);
    lines.push(`Эффект: +${payload.yieldPct.toFixed(1)}% к урожайности · ~$${formatMoney(payload.profit)} прибыль/экономия`);
    lines.push(`Рекомендация: ${payload.fertTotals.n}N ${payload.fertTotals.p}P ${payload.fertTotals.k}K кг/га (дробное внесение)`);
    return lines.join("\n");
  };

  const setText = (el, text) => { if (el) el.textContent = text; };

  const renderResults = ({ profile, soil, areaHa, centerLabel, selectionTypeLabel, score, fert, carePlan, outcomes }) => {
    try {
      setText(kpiYield, outcomes.yieldPct.toFixed(1));
      setText(kpiProfit, formatMoney(outcomes.profit));
      setText(kpiArea, areaHa.toFixed(2));
      setText(kpiYieldFoot, outcomes.yieldFoot);
      setText(kpiProfitFoot, outcomes.profitFoot);
      setText(kpiAreaFoot, `По вашему выделению (${String(selectionTypeLabel).toLowerCase()})`);
      setText(resultCropTag, `Культура: ${profile.label}`);
      setText(fertilizerText, fert.text);

      if (fertilizerChips) {
        fertilizerChips.innerHTML = "";
        (fert.chips || []).forEach((c) => {
          const span = document.createElement("span");
          span.className = `split-chip${c.tone === "earth" ? " is-earth" : ""}`;
          span.textContent = c.text;
          fertilizerChips.appendChild(span);
        });
      }
      if (careChecklist) {
        careChecklist.innerHTML = "";
        (carePlan || []).forEach((t) => {
          const li = document.createElement("li");
          li.className = "check";
          li.innerHTML = `<div class="check__box" aria-hidden="true">✓</div><div class="check__text">${String(t)}</div>`;
          careChecklist.appendChild(li);
        });
      }
      setText(sumPh, soil.ph.toFixed(1));
      setText(sumNpk, `${Math.round(soil.n)} / ${Math.round(soil.p)} / ${Math.round(soil.k)}`);
      setText(sumMoisture, `${soil.moisture.toFixed(1)}%`);
      setText(sumOm, `${soil.om.toFixed(1)}%`);
      setText(sumCenter, centerLabel);
      setText(sumSelection, selectionTypeLabel);
    } finally {
      setDashboardState(true);
    }

    shareBtn.onclick = async () => {
      const payload = {
        cropLabel: profile.label,
        selectionType: selectionTypeLabel,
        areaHa,
        center: centerLabel,
        soil,
        yieldPct: outcomes.yieldPct,
        profit: outcomes.profit,
        fertTotals: fert.totals,
      };
      const txt = buildShareSummary(payload);
      try {
        await navigator.clipboard.writeText(txt);
        showToast("Сводка скопирована в буфер обмена.");
      } catch {
        // Fallback: select via prompt-like UX
        window.prompt("Скопируйте сводку:", txt);
      }
    };

    runAgainBtn.onclick = () => {
      const el = $("#inputs");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      showToast("Измените входные данные и запустите анализ снова.");
    };
  };

  const runAnalysis = async () => {
    if (analysisInFlight) return;
    updateReadiness();

    const soil = getSoilValues();
    if (!hasRequiredSoil(soil)) return;
    if (!hasFieldArea()) return;
    if (!selectedCrop) return;

    analysisInFlight = true;
    startBtn.disabled = true;
    startBtn.textContent = "Анализируем…";
    updateReadiness();

    try {
      // Reveal results section and run a short, premium-feeling loading sequence
      resultsWrap.classList.remove("results--hidden");
      setLoadingState(true);
      $("#results")?.scrollIntoView({ behavior: "smooth", block: "start" });

      const profile = CROP_PROFILES[selectedCrop];
      if (!profile) {
        throw new Error("Неизвестная культура. Выберите доступную культуру из списка.");
      }
      const areaHa = selectionAreaM2 / 10000;
      const centerLabel = selectionCenter ? formatLatLng(selectionCenter) : "—";
      const selectionTypeLabel = selectionType || "Area";

      const seedStr = JSON.stringify({
        crop: selectedCrop,
        soil,
        area: round(areaHa, 3),
        center: centerLabel,
      });
      const rng = mulberry32(hash32(seedStr));

      const steps = [
        "Калибруем модель отклика почвы и культуры",
        "Оцениваем эффективность усвоения питания",
        "Симулируем сценарии дробного внесения",
        "Формируем рекомендации и прогноз эффекта",
      ];
      if (loadingBar) loadingBar.style.width = "0%";
      if (loadingSub) loadingSub.textContent = steps[0];

      // Короткая задержка загрузки (надёжно работает везде), затем расчёт и показ результата
      const loadMs = 1800;
      await new Promise((resolve) => window.setTimeout(resolve, loadMs));
      if (loadingBar) loadingBar.style.width = "100%";
      if (loadingSub && steps[2]) loadingSub.textContent = steps[2];

     // --- Вызов AI backend ---
     console.log("Отправка запроса к AI backend...", { soil, crop: selectedCrop, area: areaHa });
     const response = await fetch("https://agro-ai-backend.alexandromir3.workers.dev", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        soil,
        crop: selectedCrop,
        area: areaHa,
        center: centerLabel
      })
    });
    
    console.log("Ответ получен:", response.status, response.statusText);
    
    if (!response.ok) {
      let errorMsg = `Ошибка сервера (${response.status})`;
      try {
        const errorData = await response.json();
        console.error("Детали ошибки:", errorData);
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        const text = await response.text();
        console.error("Текст ошибки:", text);
      }
      throw new Error(errorMsg);
    }
    
    const ai = await response.json();
    console.log("AI ответ:", ai);
    
    // Проверка наличия обязательных полей
    if (!ai.fertilizerPlan || typeof ai.yieldIncrease !== "number" || typeof ai.profit !== "number") {
      console.error("Неверная структура ответа:", ai);
      throw new Error("Неверный формат ответа от AI. Проверьте консоль для деталей.");
    }
    
    // AI возвращает:
    const score = scoreSoil(soil, profile); // можно оставить локально
    const fert = {
      text: ai.fertilizerPlan,
      chips: [],
      totals: { n: 0, p: 0, k: 0 }
    };

    const carePlan = ai.carePlan ? ai.carePlan.split("\n").filter(line => line.trim()) : [];
    const outcomes = {
      yieldPct: Number(ai.yieldIncrease) || 0,
      profit: Number(ai.profit) || 0,
      yieldFoot: "AI-модель рассчитала потенциал отклика почвы.",
      profitFoot: "Экономический эффект рассчитан на основе модели отклика."
    };

    console.log("Рендеринг результатов...", { outcomes, fert, carePlan });
    renderResults({
      profile,
      soil,
      areaHa,
      centerLabel,
      selectionTypeLabel,
      score,
      fert,
      carePlan,
      outcomes,
    });
    console.log("Результаты отрендерены, dashboard должен быть виден");
    } catch (err) {
      console.error("Ошибка анализа:", err);
      console.error("Стек ошибки:", err.stack);
      setLoadingState(false);
      setDashboardState(false);
      const errorMsg = err.message || "Произошла ошибка";
      showToast(`Ошибка: ${errorMsg}. Проверьте консоль браузера (F12) для деталей.`);
    } finally {
      analysisInFlight = false;
      startBtn.disabled = false;
      startBtn.textContent = "Запустить ИИ‑анализ";
      updateReadiness();
    }
  };

  // -----------------------------
  // Header CTA scroll
  // -----------------------------
  jumpToInputsBtn.addEventListener("click", () => {
    $("#inputs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // -----------------------------
  // Button handler
  // -----------------------------
  startBtn.addEventListener("click", runAnalysis);

  // -----------------------------
  // Init
  // -----------------------------
  attachFormListeners();
  initMap();
  updateReadiness();
})();
