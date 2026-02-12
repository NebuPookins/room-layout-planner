(function () {
  const STORAGE_KEY = "room-layout-planner-v1";

  const unitToMeters = {
    m: 1,
    cm: 0.01,
    ft: 0.3048,
    in: 0.0254,
  };

  const state = {
    floorplanDataUrl: null,
    image: null,
    scale: {
      pixelsPerMeter: null,
      referenceLength: null,
      referenceUnit: "m",
      p1: null,
      p2: null,
    },
    furniture: [],
    nextId: 1,
    interaction: {
      mode: "idle",
      draggingId: null,
      rotatingId: null,
      dragOffsetX: 0,
      dragOffsetY: 0,
    },
    selectedFurnitureId: null,
  };

  const canvas = document.getElementById("plannerCanvas");
  const ctx = canvas.getContext("2d");

  const floorplanInput = document.getElementById("floorplanInput");
  const clearFloorplanBtn = document.getElementById("clearFloorplanBtn");
  const startScaleBtn = document.getElementById("startScaleBtn");
  const cancelScaleBtn = document.getElementById("cancelScaleBtn");
  const scaleLengthInput = document.getElementById("scaleLengthInput");
  const scaleUnitSelect = document.getElementById("scaleUnitSelect");
  const applyScaleBtn = document.getElementById("applyScaleBtn");
  const scaleStatus = document.getElementById("scaleStatus");

  const furnitureName = document.getElementById("furnitureName");
  const furnitureWidth = document.getElementById("furnitureWidth");
  const furnitureDepth = document.getElementById("furnitureDepth");
  const furnitureUnit = document.getElementById("furnitureUnit");
  const addFurnitureBtn = document.getElementById("addFurnitureBtn");
  const furnitureList = document.getElementById("furnitureList");
  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importInput");

  function getSerializableState() {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      floorplanDataUrl: state.floorplanDataUrl,
      scale: state.scale,
      furniture: state.furniture,
      nextId: state.nextId,
      selectedFurnitureId: state.selectedFurnitureId,
    };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getSerializableState()));
  }

  function readStateObject(parsed) {
    state.floorplanDataUrl = parsed.floorplanDataUrl || null;
    state.scale = {
      pixelsPerMeter: parsed.scale?.pixelsPerMeter ?? null,
      referenceLength: parsed.scale?.referenceLength ?? null,
      referenceUnit: parsed.scale?.referenceUnit || "m",
      p1: parsed.scale?.p1 || null,
      p2: parsed.scale?.p2 || null,
    };
    state.furniture = Array.isArray(parsed.furniture) ? parsed.furniture : [];
    state.nextId = Number.isInteger(parsed.nextId) ? parsed.nextId : 1;
    state.selectedFurnitureId = parsed.selectedFurnitureId ?? null;
  }

  function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      readStateObject(parsed);
    } catch (_err) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function metersFrom(value, unit) {
    return value * unitToMeters[unit];
  }

  function formatScale() {
    if (!state.scale.pixelsPerMeter) return "Scale not set.";
    const ppm = state.scale.pixelsPerMeter;
    return `Scale set: ${ppm.toFixed(2)} px/m (reference ${state.scale.referenceLength} ${state.scale.referenceUnit}).`;
  }

  function loadFloorplanImage(dataUrl) {
    return new Promise((resolve, reject) => {
      if (!dataUrl) {
        state.image = null;
        canvas.width = 1200;
        canvas.height = 800;
        resolve();
        return;
      }

      const image = new Image();
      image.onload = () => {
        state.image = image;
        resizeCanvasToImage(image);
        resolve();
      };
      image.onerror = reject;
      image.src = dataUrl;
    });
  }

  function resizeCanvasToImage(image) {
    const maxWidth = 1400;
    const maxHeight = 950;
    let w = image.width;
    let h = image.height;

    const ratio = Math.min(maxWidth / w, maxHeight / h, 1);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);

    canvas.width = Math.max(400, w);
    canvas.height = Math.max(300, h);
  }

  function getPointerPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((evt.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  }

  function pointToLocal(point, item) {
    const dx = point.x - item.x;
    const dy = point.y - item.y;
    const c = Math.cos(-item.rotation);
    const s = Math.sin(-item.rotation);
    return {
      x: dx * c - dy * s,
      y: dx * s + dy * c,
    };
  }

  function isPointInFurniture(point, item) {
    const local = pointToLocal(point, item);
    return (
      Math.abs(local.x) <= item.widthPx / 2 &&
      Math.abs(local.y) <= item.depthPx / 2
    );
  }

  function getRotationHandle(item) {
    const offset = 34;
    const x = item.x + Math.cos(item.rotation) * (item.widthPx / 2 + offset);
    const y = item.y + Math.sin(item.rotation) * (item.widthPx / 2 + offset);
    return { x, y, r: 9 };
  }

  function hitTestRotationHandle(point, item) {
    const h = getRotationHandle(item);
    const dx = point.x - h.x;
    const dy = point.y - h.y;
    return Math.hypot(dx, dy) <= h.r + 2;
  }

  function updateFurniturePixels(item) {
    if (!state.scale.pixelsPerMeter) return false;
    const widthM = metersFrom(item.width, item.unit);
    const depthM = metersFrom(item.depth, item.unit);
    item.widthPx = Math.max(12, widthM * state.scale.pixelsPerMeter);
    item.depthPx = Math.max(12, depthM * state.scale.pixelsPerMeter);
    return true;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state.image) {
      ctx.drawImage(state.image, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#666";
      ctx.font = "20px sans-serif";
      ctx.fillText("Upload a floorplan image to begin", 24, 40);
    }

    drawScaleLine();
    drawFurniture();
  }

  function drawScaleLine() {
    if (!state.scale.p1) return;

    ctx.save();
    ctx.strokeStyle = "#1f7a8c";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.moveTo(state.scale.p1.x, state.scale.p1.y);
    const p2 = state.scale.p2 || state.scale.p1;
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const p of [state.scale.p1, p2]) {
      ctx.beginPath();
      ctx.fillStyle = "#1f7a8c";
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFurniture() {
    for (const item of state.furniture) {
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate(item.rotation);

      const selected = item.id === state.selectedFurnitureId;
      ctx.fillStyle = selected
        ? "rgba(0, 109, 119, 0.45)"
        : "rgba(202, 103, 2, 0.42)";
      ctx.strokeStyle = selected ? "#004f56" : "#854600";
      ctx.lineWidth = selected ? 3 : 2;
      ctx.fillRect(-item.widthPx / 2, -item.depthPx / 2, item.widthPx, item.depthPx);
      ctx.strokeRect(
        -item.widthPx / 2,
        -item.depthPx / 2,
        item.widthPx,
        item.depthPx
      );

      ctx.restore();

      ctx.save();
      ctx.fillStyle = "#1d1d1d";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(item.name, item.x, item.y);
      ctx.restore();

      if (selected) {
        const h = getRotationHandle(item);
        ctx.save();
        ctx.strokeStyle = "#004f56";
        ctx.beginPath();
        ctx.moveTo(item.x, item.y);
        ctx.lineTo(h.x, h.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = "#006d77";
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function refreshFurnitureList() {
    furnitureList.innerHTML = "";
    for (const item of state.furniture) {
      const li = document.createElement("li");
      const row = document.createElement("div");
      row.className = "itemRow";

      const text = document.createElement("div");
      text.innerHTML = `<strong>${item.name}</strong><div class="itemMeta">${item.width} ${item.unit} x ${item.depth} ${item.unit}</div>`;

      const removeBtn = document.createElement("button");
      removeBtn.className = "smallBtn";
      removeBtn.textContent = "Remove";
      removeBtn.type = "button";
      removeBtn.addEventListener("click", () => {
        state.furniture = state.furniture.filter((f) => f.id !== item.id);
        if (state.selectedFurnitureId === item.id) {
          state.selectedFurnitureId = null;
        }
        saveState();
        refreshFurnitureList();
        draw();
      });

      row.appendChild(text);
      row.appendChild(removeBtn);
      li.appendChild(row);
      furnitureList.appendChild(li);
    }
  }

  function applyScaleFromPoints() {
    if (!state.scale.p1 || !state.scale.p2) {
      alert("Define both points for the scale line first.");
      return false;
    }

    const length = parseFloat(scaleLengthInput.value);
    if (!Number.isFinite(length) || length <= 0) {
      alert("Enter a valid real-world length.");
      return false;
    }

    const unit = scaleUnitSelect.value;
    const dx = state.scale.p2.x - state.scale.p1.x;
    const dy = state.scale.p2.y - state.scale.p1.y;
    const pixelDistance = Math.hypot(dx, dy);
    if (pixelDistance < 1) {
      alert("Scale line is too short.");
      return false;
    }

    const meters = metersFrom(length, unit);
    state.scale.pixelsPerMeter = pixelDistance / meters;
    state.scale.referenceLength = length;
    state.scale.referenceUnit = unit;

    for (const item of state.furniture) {
      updateFurniturePixels(item);
    }

    state.interaction.mode = "idle";
    scaleStatus.textContent = formatScale();
    saveState();
    draw();
    return true;
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function validateImportedState(parsed) {
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid JSON format.");
    }
    if (parsed.scale && typeof parsed.scale !== "object") {
      throw new Error("Invalid scale object.");
    }
    if (parsed.furniture && !Array.isArray(parsed.furniture)) {
      throw new Error("Furniture must be an array.");
    }
    if (Array.isArray(parsed.furniture)) {
      for (const item of parsed.furniture) {
        if (!item || typeof item !== "object") {
          throw new Error("Furniture entry is invalid.");
        }
        if (!item.name || typeof item.name !== "string") {
          throw new Error("Furniture name is missing.");
        }
        if (!isFiniteNumber(item.x) || !isFiniteNumber(item.y)) {
          throw new Error(`Furniture "${item.name}" has invalid position.`);
        }
        if (!isFiniteNumber(item.rotation)) {
          throw new Error(`Furniture "${item.name}" has invalid rotation.`);
        }
        if (!isFiniteNumber(item.width) || item.width <= 0) {
          throw new Error(`Furniture "${item.name}" has invalid width.`);
        }
        if (!isFiniteNumber(item.depth) || item.depth <= 0) {
          throw new Error(`Furniture "${item.name}" has invalid depth.`);
        }
        if (!unitToMeters[item.unit]) {
          throw new Error(`Furniture "${item.name}" has invalid unit.`);
        }
      }
    }
  }

  async function applyImportedState(parsed) {
    validateImportedState(parsed);
    readStateObject(parsed);
    state.interaction.mode = "idle";
    state.interaction.draggingId = null;
    state.interaction.rotatingId = null;
    await loadFloorplanImage(state.floorplanDataUrl);

    if (state.scale.pixelsPerMeter) {
      for (const item of state.furniture) {
        updateFurniturePixels(item);
      }
    } else {
      for (const item of state.furniture) {
        item.widthPx = 80;
        item.depthPx = 50;
      }
    }

    if (
      state.selectedFurnitureId != null &&
      !state.furniture.some((f) => f.id === state.selectedFurnitureId)
    ) {
      state.selectedFurnitureId = null;
    }

    scaleUnitSelect.value = state.scale.referenceUnit || "m";
    scaleLengthInput.value = state.scale.referenceLength || "";
    scaleStatus.textContent = formatScale();
    refreshFurnitureList();
    saveState();
    draw();
  }

  function pickTopFurniture(pos) {
    for (let i = state.furniture.length - 1; i >= 0; i -= 1) {
      if (isPointInFurniture(pos, state.furniture[i])) {
        return state.furniture[i];
      }
    }
    return null;
  }

  floorplanInput.addEventListener("change", async (evt) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      state.floorplanDataUrl = reader.result;
      await loadFloorplanImage(state.floorplanDataUrl);
      saveState();
      draw();
    };
    reader.readAsDataURL(file);
  });

  clearFloorplanBtn.addEventListener("click", async () => {
    state.floorplanDataUrl = null;
    state.scale.p1 = null;
    state.scale.p2 = null;
    state.scale.pixelsPerMeter = null;
    scaleStatus.textContent = formatScale();
    await loadFloorplanImage(null);
    saveState();
    draw();
  });

  startScaleBtn.addEventListener("click", () => {
    state.interaction.mode = "settingScale";
    state.scale.p1 = null;
    state.scale.p2 = null;
    draw();
  });

  cancelScaleBtn.addEventListener("click", () => {
    state.interaction.mode = "idle";
    state.scale.p1 = null;
    state.scale.p2 = null;
    draw();
  });

  applyScaleBtn.addEventListener("click", applyScaleFromPoints);

  addFurnitureBtn.addEventListener("click", () => {
    if (!state.scale.pixelsPerMeter) {
      alert("Set the floorplan scale before adding furniture.");
      return;
    }

    const name = furnitureName.value.trim();
    const width = parseFloat(furnitureWidth.value);
    const depth = parseFloat(furnitureDepth.value);
    const unit = furnitureUnit.value;

    if (!name) {
      alert("Enter furniture name.");
      return;
    }
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(depth) || depth <= 0) {
      alert("Enter valid furniture dimensions.");
      return;
    }

    const item = {
      id: state.nextId++,
      name,
      width,
      depth,
      unit,
      widthPx: 0,
      depthPx: 0,
      x: canvas.width / 2,
      y: canvas.height / 2,
      rotation: 0,
    };
    updateFurniturePixels(item);
    state.furniture.push(item);
    state.selectedFurnitureId = item.id;
    saveState();
    refreshFurnitureList();
    draw();
  });

  exportBtn.addEventListener("click", () => {
    const payload = JSON.stringify(getSerializableState(), null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `room-layout-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  importInput.addEventListener("change", async (evt) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await applyImportedState(parsed);
      alert("Layout imported.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown import error.";
      alert(`Import failed: ${message}`);
    } finally {
      importInput.value = "";
    }
  });

  canvas.addEventListener("mousedown", (evt) => {
    const pos = getPointerPos(evt);

    if (state.interaction.mode === "settingScale") {
      if (!state.scale.p1) {
        state.scale.p1 = pos;
        state.scale.p2 = null;
      } else if (!state.scale.p2) {
        state.scale.p2 = pos;
      } else {
        state.scale.p1 = pos;
        state.scale.p2 = null;
      }
      draw();
      return;
    }

    const selected = state.furniture.find((f) => f.id === state.selectedFurnitureId);
    if (selected && hitTestRotationHandle(pos, selected)) {
      state.interaction.rotatingId = selected.id;
      return;
    }

    const picked = pickTopFurniture(pos);
    if (!picked) {
      state.selectedFurnitureId = null;
      draw();
      saveState();
      return;
    }

    state.selectedFurnitureId = picked.id;
    state.interaction.draggingId = picked.id;
    state.interaction.dragOffsetX = pos.x - picked.x;
    state.interaction.dragOffsetY = pos.y - picked.y;
    draw();
  });

  canvas.addEventListener("mousemove", (evt) => {
    const pos = getPointerPos(evt);

    if (state.interaction.mode === "settingScale" && state.scale.p1 && !state.scale.p2) {
      state.scale.p2 = pos;
      draw();
      state.scale.p2 = null;
      return;
    }

    if (state.interaction.draggingId != null) {
      const item = state.furniture.find((f) => f.id === state.interaction.draggingId);
      if (!item) return;
      item.x = pos.x - state.interaction.dragOffsetX;
      item.y = pos.y - state.interaction.dragOffsetY;
      draw();
      return;
    }

    if (state.interaction.rotatingId != null) {
      const item = state.furniture.find((f) => f.id === state.interaction.rotatingId);
      if (!item) return;
      item.rotation = Math.atan2(pos.y - item.y, pos.x - item.x);
      draw();
    }
  });

  window.addEventListener("mouseup", () => {
    if (state.interaction.draggingId != null || state.interaction.rotatingId != null) {
      saveState();
    }
    state.interaction.draggingId = null;
    state.interaction.rotatingId = null;
  });

  window.addEventListener("keydown", (evt) => {
    if (evt.key !== "Delete" && evt.key !== "Backspace") return;
    if (state.selectedFurnitureId == null) return;

    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;

    state.furniture = state.furniture.filter((f) => f.id !== state.selectedFurnitureId);
    state.selectedFurnitureId = null;
    saveState();
    refreshFurnitureList();
    draw();
  });

  async function initialize() {
    loadState();
    scaleUnitSelect.value = state.scale.referenceUnit || "m";
    if (state.scale.referenceLength) {
      scaleLengthInput.value = state.scale.referenceLength;
    }

    scaleStatus.textContent = formatScale();

    if (state.floorplanDataUrl) {
      try {
        await loadFloorplanImage(state.floorplanDataUrl);
      } catch (_err) {
        state.floorplanDataUrl = null;
        state.image = null;
      }
    }

    if (!state.scale.pixelsPerMeter) {
      for (const item of state.furniture) {
        item.widthPx = 80;
        item.depthPx = 50;
      }
    } else {
      for (const item of state.furniture) {
        updateFurniturePixels(item);
      }
    }

    refreshFurnitureList();
    draw();
  }

  initialize();
})();
