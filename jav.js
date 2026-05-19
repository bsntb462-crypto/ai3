const videoElement = document.querySelector('.input_video');
const canvasElement = document.querySelector('.output_canvas');
const drawingCanvasElement = document.querySelector('.drawing_canvas');
const stageElement = document.querySelector('.stage');
const toggleButton = document.querySelector('#toggleDrawing');
const clearButton = document.querySelector('#clearDrawing');
const undoButton = document.querySelector('#undoStroke');
const clearEmojisButton = document.querySelector('#clearEmojis');
const emojiButtons = [...document.querySelectorAll('.emoji-button')];
const statusElement = document.querySelector('#trackingStatus');
const cursorElement = document.querySelector('#airCursor');
const emojiCursorElement = document.querySelector('#emojiCursor');
const brandElement = document.querySelector('#appBrand');
const brandLogoElement = document.querySelector('#brandLogo');
const brandMarkElement = document.querySelector('#brandMark');
const brandNameElement = document.querySelector('#brandName');
const toggleButtonLabel = toggleButton.querySelector('.button-label');
const canvasCtx = canvasElement.getContext('2d');
const drawingCtx = drawingCanvasElement.getContext('2d');
const styles = getComputedStyle(document.documentElement);

const HAND_LABELS = ['Left', 'Right'];
const CONTROL_SELECTOR = '.control-button';
const DRAWING_TIP_LANDMARK = 8;
const CURSOR_TIP_LANDMARK = 8;
const whiteLabelDefaults = {
    brand: {
        visible: true,
        name: 'Hand Studio',
        logoSrc: '',
        showLogoPlaceholder: true
    },
    theme: {
        primary: '',
        drawingLine: '',
        handLine: '',
        handPoint: '',
        page: '',
        surface: ''
    }
};
const whiteLabelOverrides = window.WHITE_LABEL_CONFIG || {};

const config = {
    brand: {
        ...whiteLabelDefaults.brand,
        ...(whiteLabelOverrides.brand || {})
    },
    theme: {
        ...whiteLabelDefaults.theme,
        ...(whiteLabelOverrides.theme || {})
    },
    cameraWidth: 480,
    cameraHeight: 270,
    targetFps: 18,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.55,
    minHandScore: 0.65,
    landmarkBoundsPadding: 0.08,
    maxLandmarkJump: 0.36,
    lineWidth: 6.4,
    lineGlowBlur: 3,
    handConnectorWidth: 2,
    handPointWidth: 2,
    handPointRadius: 2.4,
    oneFingerStartFrames: 1,
    oneFingerEndFrames: 4,
    fingerExtensionMargin: 0.16,
    pointerJitterRadius: 0.7,
    pointerSnapDistance: 220,
    pointerSmoothing: 0.5,
    pointerFastSmoothing: 0.82,
    interactionSmoothing: 0.62,
    interactionFastSmoothing: 0.94,
    interactionJitterRadius: 0.0009,
    handGuideSmoothing: 0.22,
    handGuideFastSmoothing: 0.82,
    handGuideJitterRadius: 0.014,
    handGuideFastDistance: 0.06,
    handGuideHoldFrames: 2,
    drawingSmoothing: 1,
    drawingFastSmoothing: 1,
    drawingJitterRadius: 0,
    drawingFastDistance: 1,
    drawingPrediction: 0,
    jitterRadius: 1.6,
    minPointDistance: 0.45,
    interpolationStep: 1.15,
    maxStrokeReconnectDistance: 260,
    minStrokeDistance: 0.8,
    minStrokePoints: 2,
    strokeStartDistance: 0,
    strokeWarmupFrames: 0,
    maxMissingDrawingFrames: 10,
    controlHitPadding: 36,
    controlLeavePadding: 52,
    controlRectCacheMs: 350,
    airClickHoldFrames: 2,
    airClickCooldownMs: 520,
    emojiPlaceCooldownMs: 140,
    emojiDoubleTapMs: 460,
    emojiStableMoveRadius: 24,
    emojiStableHoldMs: 750
};

const appState = {
    drawingEnabled: true,
    savedLines: [],
    activeLines: createHandMap(() => []),
    strokeRendered: createHandMap(() => false),
    drawingPoints: createHandMap(() => null),
    interactionFilters: createHandMap(() => ({
        point: null,
        velocity: { x: 0, y: 0, z: 0 }
    })),
    drawingFilters: createHandMap(() => ({
        rawPoint: null,
        stablePoint: null,
        velocity: { x: 0, y: 0 },
        warmupFrames: 0,
        hasCommittedPoint: false,
        missingFrames: 0
    })),
    handGuideFilters: createHandMap(() => ({
        landmarks: null,
        missingFrames: 0
    })),
    gestures: createHandMap(() => ({
        isDrawingGesture: false,
        shouldDrawPoint: false,
        oneFingerFrames: 0,
        lostFrames: 0,
        justEnded: false
    })),
    interaction: {
        cursor: null,
        cursorHandLabel: null,
        hoveredControl: null,
        holdFrames: 0,
        clickedDuringGesture: false,
        lastClickAt: 0,
        controlRects: [],
        controlRectUpdatedAt: 0
    },
    emojis: [],
    selectedEmoji: emojiButtons[0]?.dataset.emoji || '😀',
    emojiDrag: {
        isDragging: false,
        lastPointer: null,
        stablePointer: null,
        stableStartedAt: 0,
        wasPointerGesture: false,
        lostFrames: 0,
        lastToggleAt: 0,
        lastTapAt: 0
    },
    handsVisible: 0,
    activeDrawingGestures: 0,
    drawingDirty: true,
    fullRedrawNeeded: true,
    drawQueue: [],
    drawScheduled: false,
    inferenceBusy: false,
    lastInferenceAt: 0,
    lastResultAt: 0
};

function createHandMap(factory) {
    return HAND_LABELS.reduce((map, label) => {
        map[label] = factory();
        return map;
    }, {});
}

function getCssColor(variableName) {
    return styles.getPropertyValue(variableName).trim();
}

const colorCache = {
    handLine: '',
    handPoint: '',
    drawingLine: '',
    cursor: ''
};

function refreshColorCache() {
    colorCache.handLine = getCssColor('--color-hand-line');
    colorCache.handPoint = getCssColor('--color-hand-point');
    colorCache.drawingLine = getCssColor('--color-drawing-line');
    colorCache.cursor = getCssColor('--color-cursor');
}

function applyTheme() {
    const root = document.documentElement;
    const mappings = {
        primary: '--color-primary',
        drawingLine: '--color-drawing-line',
        handLine: '--color-hand-line',
        handPoint: '--color-hand-point',
        page: '--color-page',
        surface: '--color-surface'
    };
    Object.entries(mappings).forEach(([key, cssVar]) => {
        const value = config.theme[key];
        if (typeof value === 'string' && value.trim()) {
            root.style.setProperty(cssVar, value.trim());
        }
    });
    refreshColorCache();
    markDrawingDirty({ fullRedraw: true });
}

function applyBranding() {
    brandElement.classList.toggle('is-hidden', !config.brand.visible);
    brandNameElement.textContent = config.brand.name;
    brandNameElement.classList.toggle('is-hidden', !config.brand.name);
    brandMarkElement.classList.toggle('is-hidden', !config.brand.logoSrc && !config.brand.showLogoPlaceholder);

    if (config.brand.logoSrc) {
        brandLogoElement.src = config.brand.logoSrc;
        brandLogoElement.hidden = false;
    } else {
        brandLogoElement.removeAttribute('src');
        brandLogoElement.hidden = true;
    }
}

window.setWhiteLabelBrand = (brandConfig = {}) => {
    config.brand = {
        ...config.brand,
        ...brandConfig
    };
    applyBranding();
};

window.setWhiteLabelTheme = (themeConfig = {}) => {
    config.theme = {
        ...config.theme,
        ...themeConfig
    };
    applyTheme();
};

function refreshControlRects() {
    appState.interaction.controlRectUpdatedAt = 0;
}

function setStatus(message) {
    if (statusElement.textContent === message) return;
    statusElement.textContent = message;
}

function markDrawingDirty({ fullRedraw = false } = {}) {
    appState.drawingDirty = true;
    appState.fullRedrawNeeded = appState.fullRedrawNeeded || fullRedraw;
    if (appState.drawScheduled) return;

    appState.drawScheduled = true;
    requestAnimationFrame(() => {
        appState.drawScheduled = false;
        drawStoredLines();
    });
}

function queueDot(point) {
    appState.drawQueue.push({ type: 'dot', point });
    markDrawingDirty();
}

function queueSegment(from, to) {
    appState.drawQueue.push({ type: 'segment', from, to });
    markDrawingDirty();
}

function updateToggleButton() {
    toggleButton.classList.toggle('is-active', appState.drawingEnabled);
    toggleButton.setAttribute('aria-pressed', String(appState.drawingEnabled));
    toggleButtonLabel.textContent = appState.drawingEnabled ? 'Drawing On' : 'Drawing Off';
}

function mapLandmarkToViewport(landmark) {
    const rect = canvasElement.getBoundingClientRect();
    return {
        x: rect.left + (1 - landmark.x) * rect.width,
        y: rect.top + landmark.y * rect.height
    };
}

function mapViewportPointToStage(point) {
    const stageRect = stageElement.getBoundingClientRect();
    return {
        x: point.x - stageRect.left,
        y: point.y - stageRect.top
    };
}

function getDistance(pointA, pointB) {
    return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

function getAdaptiveSmoothing(distance, jitterRadius, fastDistance, slowSmoothing, fastSmoothing) {
    if (distance <= jitterRadius) return 0;
    if (distance >= fastDistance) return fastSmoothing;

    const range = Math.max(0.0001, fastDistance - jitterRadius);
    const t = Math.min(1, Math.max(0, (distance - jitterRadius) / range));
    const eased = t * t * (3 - 2 * t);
    return slowSmoothing + (fastSmoothing - slowSmoothing) * eased;
}

function smoothPoint(previousPoint, nextPoint, options) {
    if (!previousPoint) {
        return { ...nextPoint };
    }

    const dx = nextPoint.x - previousPoint.x;
    const dy = nextPoint.y - previousPoint.y;
    const dz = (nextPoint.z || 0) - (previousPoint.z || 0);
    const distance = options.useDepth ? Math.hypot(dx, dy, dz) : Math.hypot(dx, dy);
    const smoothing = getAdaptiveSmoothing(
        distance,
        options.jitterRadius,
        options.fastDistance,
        options.smoothing,
        options.fastSmoothing
    );

    if (smoothing === 0) {
        return previousPoint;
    }

    return {
        ...nextPoint,
        x: previousPoint.x + dx * smoothing,
        y: previousPoint.y + dy * smoothing,
        z: (previousPoint.z || 0) + dz * smoothing
    };
}

function getNormalizedDistance(pointA, pointB) {
    return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

function getHandScale(landmarks) {
    return Math.max(0.001, getNormalizedDistance(landmarks[0], landmarks[9]));
}

function areLandmarksInsideFrame(landmarks) {
    return landmarks.every((point) => {
        return (
            point.x >= -config.landmarkBoundsPadding &&
            point.x <= 1 + config.landmarkBoundsPadding &&
            point.y >= -config.landmarkBoundsPadding &&
            point.y <= 1 + config.landmarkBoundsPadding
        );
    });
}

function getMaxLandmarkJump(previousLandmarks, nextLandmarks) {
    if (!previousLandmarks || !nextLandmarks) return 0;

    return nextLandmarks.reduce((maxJump, point, index) => {
        const previousPoint = previousLandmarks[index];
        if (!previousPoint) return maxJump;
        return Math.max(maxJump, getNormalizedDistance(previousPoint, point));
    }, 0);
}

function isReliableHand(label, landmarks, handedness) {
    const score = handedness?.score ?? 0;
    if (score < config.minHandScore || !areLandmarksInsideFrame(landmarks)) {
        return false;
    }

    const previousLandmarks = appState.handGuideFilters[label]?.landmarks;
    const maxJump = getMaxLandmarkJump(previousLandmarks, landmarks);
    return maxJump <= config.maxLandmarkJump;
}

function isFingerExtended(landmarks, tipIndex, pipIndex) {
    const tip = landmarks[tipIndex];
    const pip = landmarks[pipIndex];
    const wrist = landmarks[0];
    const mcp = landmarks[pipIndex - 1];
    const handScale = getHandScale(landmarks);
    const margin = handScale * config.fingerExtensionMargin;

    return (
        getNormalizedDistance(tip, wrist) > getNormalizedDistance(pip, wrist) + margin &&
        getNormalizedDistance(tip, mcp) > getNormalizedDistance(pip, mcp) + margin * 0.35
    );
}

function getOtherExtendedFingerCount(landmarks) {
    return [
        [12, 10],
        [16, 14],
        [20, 18]
    ].reduce((count, [tipIndex, pipIndex]) => {
        return count + (isFingerExtended(landmarks, tipIndex, pipIndex) ? 1 : 0);
    }, 0);
}

function hasDrawingGesture(landmarks) {
    return isFingerExtended(landmarks, 8, 6) && getOtherExtendedFingerCount(landmarks) === 0;
}

function updateGestureState(label, landmarks) {
    const gesture = appState.gestures[label];
    const isIndexExtended = isFingerExtended(landmarks, 8, 6);
    const hasOtherExtendedFingers = getOtherExtendedFingerCount(landmarks) > 0;
    const isIndexActive = isIndexExtended && !hasOtherExtendedFingers;
    gesture.justEnded = false;
    gesture.shouldDrawPoint = false;

    if (isIndexActive) {
        gesture.oneFingerFrames += 1;
        gesture.lostFrames = 0;
        if (appState.activeLines[label].length > 0) {
            gesture.oneFingerFrames = config.oneFingerStartFrames;
        }
        gesture.shouldDrawPoint = true;
    } else if (hasOtherExtendedFingers) {
        gesture.oneFingerFrames = 0;
        gesture.lostFrames = 0;
        if (gesture.isDrawingGesture) {
            gesture.isDrawingGesture = false;
            gesture.justEnded = true;
        }
    } else {
        gesture.oneFingerFrames = 0;
        if (gesture.isDrawingGesture) {
            gesture.lostFrames += 1;
            if (gesture.lostFrames > config.oneFingerEndFrames) {
                gesture.isDrawingGesture = false;
                gesture.justEnded = true;
                gesture.lostFrames = 0;
            }
        } else {
            gesture.lostFrames = 0;
        }
    }

    if (!gesture.isDrawingGesture && gesture.oneFingerFrames >= config.oneFingerStartFrames) {
        gesture.isDrawingGesture = true;
        gesture.lostFrames = 0;
        startActiveLine(label);
    }

    return gesture.isDrawingGesture;
}

function startActiveLine(label) {
    if (appState.activeLines[label].length > 0) {
        appState.drawingFilters[label].missingFrames = 0;
        return;
    }

    appState.activeLines[label] = [];
    appState.strokeRendered[label] = false;
    appState.drawingPoints[label] = null;
    resetDrawingFilter(label);
}

function resetGesture(label) {
    appState.gestures[label].isDrawingGesture = false;
    appState.gestures[label].shouldDrawPoint = false;
    appState.gestures[label].oneFingerFrames = 0;
    appState.gestures[label].lostFrames = 0;
    appState.gestures[label].justEnded = false;
}

function resetDrawingFilter(label) {
    appState.drawingFilters[label] = {
        rawPoint: null,
        stablePoint: null,
        velocity: { x: 0, y: 0 },
        warmupFrames: 0,
        hasCommittedPoint: false,
        missingFrames: 0
    };
}

function resetInteractionFilter(label) {
    appState.interactionFilters[label] = {
        point: null,
        velocity: { x: 0, y: 0, z: 0 }
    };
}

function resetHandGuideFilter(label) {
    appState.handGuideFilters[label] = {
        landmarks: null,
        missingFrames: 0
    };
}

function flushActiveLine(label) {
    const activeLine = appState.activeLines[label];
    const keepStroke = shouldKeepStroke(activeLine);
    const shouldEraseTransientStroke = !keepStroke && appState.strokeRendered[label];
    if (keepStroke) {
        appState.savedLines.push({
            type: 'stroke',
            points: [...activeLine],
            createdAt: Date.now()
        });
    }
    appState.activeLines[label] = [];
    appState.strokeRendered[label] = false;
    appState.drawingPoints[label] = null;
    resetDrawingFilter(label);

    if (shouldEraseTransientStroke) {
        appState.drawQueue = [];
        markDrawingDirty({ fullRedraw: true });
    }
}

function flushAllActiveLines() {
    HAND_LABELS.forEach(flushActiveLine);
}

function holdActiveLineThroughGap(label) {
    if (appState.activeLines[label].length === 0) {
        return false;
    }

    const filter = appState.drawingFilters[label];
    filter.missingFrames += 1;

    if (filter.missingFrames <= config.maxMissingDrawingFrames) {
        return true;
    }

    flushActiveLine(label);
    resetGesture(label);
    return false;
}

function clearDrawing() {
    appState.savedLines = [];
    appState.drawQueue = [];
    HAND_LABELS.forEach((label) => {
        appState.activeLines[label] = [];
        appState.strokeRendered[label] = false;
        appState.drawingPoints[label] = null;
        resetDrawingFilter(label);
        resetInteractionFilter(label);
        resetHandGuideFilter(label);
        resetGesture(label);
    });
    markDrawingDirty({ fullRedraw: true });
    setStatus(appState.drawingEnabled ? 'Drawing cleared. Show one finger to draw.' : 'Drawing cleared. Drawing is off.');
}

function clearEmojis() {
    appState.emojis = [];
    markDrawingDirty({ fullRedraw: true });
}

function pointerToCanvasPoint(pointer) {
    const rect = drawingCanvasElement.getBoundingClientRect();
    const x = ((pointer.x - rect.left) / rect.width) * drawingCanvasElement.width;
    const y = ((pointer.y - rect.top) / rect.height) * drawingCanvasElement.height;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
}

function updateEmojiCursor(pointer) {
    if (!pointer) {
        emojiCursorElement.classList.remove('is-visible');
        emojiCursorElement.style.removeProperty('--cursor-x');
        emojiCursorElement.style.removeProperty('--cursor-y');
        emojiCursorElement.textContent = '';
        return;
    }

    const stagePoint = mapViewportPointToStage(pointer);
    emojiCursorElement.style.setProperty('--cursor-x', `${stagePoint.x}px`);
    emojiCursorElement.style.setProperty('--cursor-y', `${stagePoint.y}px`);
    emojiCursorElement.textContent = appState.selectedEmoji;
    emojiCursorElement.classList.add('is-visible');
}

function resetEmojiDrag({ hideCursor = true } = {}) {
    const drag = appState.emojiDrag;
    drag.isDragging = false;
    drag.lastPointer = null;
    drag.stablePointer = null;
    drag.stableStartedAt = 0;
    drag.wasPointerGesture = false;
    drag.lostFrames = 0;
    drag.lastToggleAt = 0;
    drag.lastTapAt = 0;
    if (hideCursor) updateEmojiCursor(null);
}

function placeEmojiAtPointer(pointer) {
    const drag = appState.emojiDrag;
    const now = Date.now();
    if (now - drag.lastToggleAt < config.emojiPlaceCooldownMs) return false;

    const canvasPoint = pointerToCanvasPoint(pointer);
    if (!canvasPoint) return false;

    appState.emojis.push({
        emoji: appState.selectedEmoji,
        x: canvasPoint.x,
        y: canvasPoint.y,
        createdAt: now
    });
    drag.lastToggleAt = now;
    markDrawingDirty({ fullRedraw: true });
    return true;
}

function updateEmojiDrag(pointer, isPointerGesture, hoveredControl) {
    const drag = appState.emojiDrag;
    const now = Date.now();

    if (appState.drawingEnabled || hoveredControl) {
        resetEmojiDrag();
        return;
    }

    if (!pointer || !isPointerGesture) {
        drag.lostFrames += 1;
        if (drag.lostFrames > 8) resetEmojiDrag();
        else if (drag.isDragging && drag.lastPointer) updateEmojiCursor(drag.lastPointer);
        drag.wasPointerGesture = isPointerGesture;
        return;
    }

    drag.isDragging = true;
    drag.lastPointer = pointer;
    drag.lostFrames = 0;

    if (!drag.stablePointer || getDistance(pointer, drag.stablePointer) > config.emojiStableMoveRadius) {
        drag.stablePointer = pointer;
        drag.stableStartedAt = now;
    }

    updateEmojiCursor(pointer);

    const isGestureStart = isPointerGesture && !drag.wasPointerGesture;
    if (isGestureStart) {
        const isDoubleTap = now - drag.lastTapAt <= config.emojiDoubleTapMs;
        if (isDoubleTap) {
            if (placeEmojiAtPointer(pointer)) {
                resetEmojiDrag();
                appState.emojiDrag.lastToggleAt = now;
                drag.wasPointerGesture = isPointerGesture;
                return;
            }
        }
        drag.lastTapAt = now;
    }

    if (drag.stableStartedAt && now - drag.stableStartedAt >= config.emojiStableHoldMs) {
        if (placeEmojiAtPointer(pointer)) {
            resetEmojiDrag();
            appState.emojiDrag.lastToggleAt = now;
            drag.wasPointerGesture = isPointerGesture;
            return;
        }
    }

    drag.wasPointerGesture = isPointerGesture;
}

function undoLastMark() {
    flushAllActiveLines();

    if (appState.savedLines.length === 0) {
        setStatus('Nothing to undo.');
        return;
    }

    appState.savedLines.pop();
    appState.drawQueue = [];
    markDrawingDirty({ fullRedraw: true });
    setStatus('Last stroke removed.');
}

function getCanvasPoint(landmark) {
    const videoRect = canvasElement.getBoundingClientRect();
    const drawingRect = drawingCanvasElement.getBoundingClientRect();
    if (!videoRect.width || !videoRect.height || !drawingRect.width || !drawingRect.height) {
        return {
            x: (1 - landmark.x) * drawingCanvasElement.width,
            y: landmark.y * drawingCanvasElement.height
        };
    }

    const viewportX = videoRect.left + (1 - landmark.x) * videoRect.width;
    const viewportY = videoRect.top + landmark.y * videoRect.height;

    return {
        x: ((viewportX - drawingRect.left) / drawingRect.width) * drawingCanvasElement.width,
        y: ((viewportY - drawingRect.top) / drawingRect.height) * drawingCanvasElement.height
    };
}

function getCanvasPointFromNormalized(point) {
    return {
        x: (1 - point.x) * drawingCanvasElement.width,
        y: point.y * drawingCanvasElement.height
    };
}

function getDrawingTipLandmark(landmarks) {
    return landmarks[DRAWING_TIP_LANDMARK];
}

function getCursorTipLandmark(landmarks) {
    return landmarks[CURSOR_TIP_LANDMARK];
}

function getStableInteractionTip(label, landmarks) {
    const rawPoint = getCursorTipLandmark(landmarks);
    const filter = appState.interactionFilters[label];

    if (!filter.point) {
        filter.point = { ...rawPoint };
        return filter.point;
    }

    const dx = rawPoint.x - filter.point.x;
    const dy = rawPoint.y - filter.point.y;
    const dz = (rawPoint.z || 0) - (filter.point.z || 0);
    const distance = Math.hypot(dx, dy, dz);

    if (distance <= config.interactionJitterRadius) {
        return filter.point;
    }

    const smoothing = distance < config.interactionJitterRadius * 5
        ? config.interactionSmoothing
        : config.interactionFastSmoothing;

    filter.velocity = {
        x: filter.velocity.x * 0.7 + dx * 0.3,
        y: filter.velocity.y * 0.7 + dy * 0.3,
        z: filter.velocity.z * 0.7 + dz * 0.3
    };

    filter.point = {
        ...rawPoint,
        x: filter.point.x + dx * smoothing,
        y: filter.point.y + dy * smoothing,
        z: (filter.point.z || 0) + dz * smoothing
    };

    return filter.point;
}

function canvasPointToViewport(point) {
    const rect = drawingCanvasElement.getBoundingClientRect();
    const width = drawingCanvasElement.width || 1;
    const height = drawingCanvasElement.height || 1;
    const nx = point.x / width;
    const ny = point.y / height;
    return {
        x: rect.left + nx * rect.width,
        y: rect.top + ny * rect.height
    };
}

function getStableDrawingPoint(label, landmarks) {
    const rawPoint = getCanvasPoint(getDrawingTipLandmark(landmarks));
    const filter = appState.drawingFilters[label];
    filter.missingFrames = 0;

    const previousRawPoint = filter.rawPoint;
    filter.rawPoint = rawPoint;
    if (previousRawPoint) {
        filter.velocity = {
            x: filter.velocity.x * 0.65 + (rawPoint.x - previousRawPoint.x) * 0.35,
            y: filter.velocity.y * 0.65 + (rawPoint.y - previousRawPoint.y) * 0.35
        };
    }

    filter.stablePoint = rawPoint;

    appState.drawingPoints[label] = filter.stablePoint;
    return filter.stablePoint;
}

function addDrawingPoint(label, landmarks) {
    const filter = appState.drawingFilters[label];
    const nextPoint = getStableDrawingPoint(label, landmarks);
    const points = appState.activeLines[label];
    const previousPoint = points[points.length - 1];

    if (!previousPoint) {
        points.push(nextPoint);
        return;
    }

    const distance = getDistance(previousPoint, nextPoint);

    if (distance < config.minPointDistance) {
        return;
    }

    if (distance > config.maxStrokeReconnectDistance) {
        flushActiveLine(label);
        startActiveLine(label);
        appState.activeLines[label].push(nextPoint);
        return;
    }

    filter.hasCommittedPoint = true;

    const steps = Math.max(1, Math.ceil(distance / config.interpolationStep));
    const newSegments = [];
    let lastPoint = previousPoint;
    for (let step = 1; step <= steps; step += 1) {
        const point = {
            x: previousPoint.x + ((nextPoint.x - previousPoint.x) * step) / steps,
            y: previousPoint.y + ((nextPoint.y - previousPoint.y) * step) / steps
        };
        points.push(point);
        newSegments.push({ from: lastPoint, to: point });
        lastPoint = point;
    }

    renderStrokeProgress(label, newSegments);
}

function getStrokeDistance(points) {
    if (!points || points.length < 2) return 0;

    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
        total += getDistance(points[i - 1], points[i]);
    }
    return total;
}

function shouldKeepStroke(points) {
    if (!points || points.length < config.minStrokePoints) {
        return false;
    }
    return getStrokeDistance(points) >= config.minStrokeDistance;
}

function queueFullStroke(points) {
    if (!points || points.length < 2) return;
    for (let i = 1; i < points.length; i += 1) {
        queueSegment(points[i - 1], points[i]);
    }
}

function renderStrokeProgress(label, newSegments) {
    if (!newSegments || newSegments.length === 0) return;

    if (!appState.strokeRendered[label]) {
        const points = appState.activeLines[label];
        if (!points || points.length < 2) {
            return;
        }
        appState.strokeRendered[label] = true;
        queueFullStroke(points);
        return;
    }

    newSegments.forEach(({ from, to }) => queueSegment(from, to));
}

function drawSmoothPath(points) {
    if (points.length === 0) return;

    if (points.length === 1) {
        drawingCtx.beginPath();
        drawingCtx.arc(points[0].x, points[0].y, config.lineWidth / 2, 0, Math.PI * 2);
        drawingCtx.fill();
        return;
    }

    drawingCtx.beginPath();
    drawingCtx.moveTo(points[0].x, points[0].y);

    for (let i = 0; i < points.length - 1; i += 1) {
        const pointBefore = points[Math.max(0, i - 1)];
        const currentPoint = points[i];
        const nextPoint = points[i + 1];
        const pointAfter = points[Math.min(points.length - 1, i + 2)];
        const controlPointA = {
            x: currentPoint.x + (nextPoint.x - pointBefore.x) / 6,
            y: currentPoint.y + (nextPoint.y - pointBefore.y) / 6
        };
        const controlPointB = {
            x: nextPoint.x - (pointAfter.x - currentPoint.x) / 6,
            y: nextPoint.y - (pointAfter.y - currentPoint.y) / 6
        };

        drawingCtx.bezierCurveTo(
            controlPointA.x,
            controlPointA.y,
            controlPointB.x,
            controlPointB.y,
            nextPoint.x,
            nextPoint.y
        );
    }

    drawingCtx.stroke();
}

function prepareDrawingContext() {
    drawingCtx.strokeStyle = colorCache.drawingLine;
    drawingCtx.fillStyle = colorCache.drawingLine;
    drawingCtx.lineWidth = config.lineWidth;
    drawingCtx.lineJoin = 'round';
    drawingCtx.lineCap = 'round';
    drawingCtx.imageSmoothingEnabled = true;
    drawingCtx.imageSmoothingQuality = 'high';
    drawingCtx.shadowBlur = config.lineGlowBlur;
    drawingCtx.shadowColor = colorCache.drawingLine;
}

function drawQueuedItems(items) {
    if (!items || items.length === 0) return;

    drawingCtx.beginPath();
    let hasSegments = false;
    items.forEach((item) => {
        if (item.type !== 'segment') return;
        drawingCtx.moveTo(item.from.x, item.from.y);
        drawingCtx.lineTo(item.to.x, item.to.y);
        hasSegments = true;
    });
    if (hasSegments) {
        drawingCtx.stroke();
    }

    drawingCtx.beginPath();
    let hasDots = false;
    items.forEach((item) => {
        if (item.type !== 'dot') return;
        drawingCtx.moveTo(item.point.x + config.lineWidth / 2, item.point.y);
        drawingCtx.arc(item.point.x, item.point.y, config.lineWidth / 2, 0, Math.PI * 2);
        hasDots = true;
    });
    if (hasDots) {
        drawingCtx.fill();
    }
}

function drawStoredLines() {
    if (!appState.drawingDirty) return;

    prepareDrawingContext();

    if (appState.fullRedrawNeeded) {
        drawingCtx.clearRect(0, 0, drawingCanvasElement.width, drawingCanvasElement.height);
        appState.savedLines.forEach((line) => drawSmoothPath(line.points));
        HAND_LABELS.forEach((label) => {
            if (appState.strokeRendered[label]) {
                drawSmoothPath(appState.activeLines[label]);
            }
        });
        appState.drawQueue = [];
        appState.fullRedrawNeeded = false;
    } else {
        drawQueuedItems(appState.drawQueue);
        appState.drawQueue = [];
    }

    drawEmojis();

    drawingCtx.shadowBlur = 0;
    appState.drawingDirty = false;
}

function drawEmojis() {
    if (appState.emojis.length === 0) return;
    drawingCtx.save();
    drawingCtx.shadowBlur = 0;
    drawingCtx.textAlign = 'center';
    drawingCtx.textBaseline = 'middle';
    drawingCtx.font = `${Math.max(14, Math.round(config.lineWidth * 4.3))}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    appState.emojis.forEach((item) => {
        drawingCtx.fillText(item.emoji, item.x, item.y);
    });
    drawingCtx.restore();
}

window.addEventListener('resize', refreshControlRects);
window.addEventListener('scroll', refreshControlRects, true);

function resizeCanvasToVideo() {
    const width = videoElement.videoWidth || config.cameraWidth;
    const height = videoElement.videoHeight || config.cameraHeight;

    const canvasNeedsResize = canvasElement.width !== width || canvasElement.height !== height;
    const drawingCanvasNeedsResize = drawingCanvasElement.width !== width || drawingCanvasElement.height !== height;

    if (canvasNeedsResize || drawingCanvasNeedsResize) {
        canvasElement.width = width;
        canvasElement.height = height;
        drawingCanvasElement.width = width;
        drawingCanvasElement.height = height;
        appState.drawQueue = [];
        markDrawingDirty({ fullRedraw: true });
    }
}

function drawCameraFrameOnly() {
    if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    resizeCanvasToVideo();
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.translate(canvasElement.width, 0);
    canvasCtx.scale(-1, 1);
    canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.restore();
}

function drawHandGuide(landmarks) {
    const canvasWidth = canvasElement.width;
    const canvasHeight = canvasElement.height;

    canvasCtx.save();
    canvasCtx.strokeStyle = colorCache.handLine;
    canvasCtx.lineWidth = config.handConnectorWidth;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';
    canvasCtx.beginPath();
    HAND_CONNECTIONS.forEach(([startIndex, endIndex]) => {
        const start = landmarks[startIndex];
        const end = landmarks[endIndex];
        canvasCtx.moveTo((1 - start.x) * canvasWidth, start.y * canvasHeight);
        canvasCtx.lineTo((1 - end.x) * canvasWidth, end.y * canvasHeight);
    });
    canvasCtx.stroke();

    canvasCtx.fillStyle = colorCache.handPoint;
    canvasCtx.beginPath();
    landmarks.forEach((point) => {
        const x = (1 - point.x) * canvasWidth;
        const y = point.y * canvasHeight;
        canvasCtx.moveTo(x + config.handPointRadius, y);
        canvasCtx.arc(
            x,
            y,
            config.handPointRadius,
            0,
            Math.PI * 2
        );
    });
    canvasCtx.fill();
    canvasCtx.restore();
}

function getSmoothedHandGuide(label, landmarks) {
    const filter = appState.handGuideFilters[label];
    filter.missingFrames = 0;

    if (!filter.landmarks) {
        filter.landmarks = landmarks.map((point) => ({ ...point }));
        return filter.landmarks;
    }

    landmarks.forEach((point, index) => {
        const previousPoint = filter.landmarks[index] || point;
        filter.landmarks[index] = smoothPoint(previousPoint, point, {
            jitterRadius: config.handGuideJitterRadius,
            fastDistance: config.handGuideFastDistance,
            smoothing: config.handGuideSmoothing,
            fastSmoothing: config.handGuideFastSmoothing
        });
    });

    return filter.landmarks;
}

function getViewportPointer(landmarks, handLabel, isDrawingGesture) {
    const stablePoint = appState.drawingPoints[handLabel];

    if (isDrawingGesture && stablePoint) {
        // Use the same filtered point as drawing, then map to viewport.
        return canvasPointToViewport(stablePoint);
    }

    // Fallback: map raw fingertip landmark through the same canvas → viewport pipeline.
    const indexFinger = landmarks[8];
    const canvasPoint = getCanvasPoint(indexFinger);
    return canvasPointToViewport(canvasPoint);
}

function getLockedViewportPointer(landmarks, handLabel) {
    appState.interaction.cursorHandLabel = handLabel;
    return mapLandmarkToViewport(getStableInteractionTip(handLabel, landmarks));
}

function getViewportPointerFromTip(interactionTip, handLabel) {
    appState.interaction.cursorHandLabel = handLabel;
    return mapLandmarkToViewport(interactionTip);
}

function getHoveredControl(pointer) {
    if (!pointer) return null;

    const now = performance.now();
    if (now - appState.interaction.controlRectUpdatedAt > config.controlRectCacheMs) {
        appState.interaction.controlRects = [...document.querySelectorAll(CONTROL_SELECTOR)].map((control) => ({
            control,
            rect: control.getBoundingClientRect()
        }));
        appState.interaction.controlRectUpdatedAt = now;
    }

    let closestControl = null;
    let closestDistance = Infinity;
    const padding = appState.interaction.hoveredControl
        ? config.controlLeavePadding
        : config.controlHitPadding;

    appState.interaction.controlRects.forEach(({ control, rect }) => {
        const expandedRect = {
            left: rect.left - padding,
            right: rect.right + padding,
            top: rect.top - padding,
            bottom: rect.bottom + padding
        };

        if (
            pointer.x < expandedRect.left ||
            pointer.x > expandedRect.right ||
            pointer.y < expandedRect.top ||
            pointer.y > expandedRect.bottom
        ) {
            return;
        }

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(pointer.x - centerX, pointer.y - centerY);

        if (distance < closestDistance) {
            closestDistance = distance;
            closestControl = control;
        }
    });

    return closestControl;
}

function clearHoverStyles() {
    document.querySelectorAll(`${CONTROL_SELECTOR}.is-air-hovered, ${CONTROL_SELECTOR}.is-air-pressed`).forEach((button) => {
        button.classList.remove('is-air-hovered', 'is-air-pressed');
    });
}

function updateAirCursor(pointer, isDrawingGesture) {
    cursorElement.classList.remove('is-visible', 'is-drawing');
    cursorElement.style.removeProperty('--cursor-x');
    cursorElement.style.removeProperty('--cursor-y');
}

function resetAirInteraction() {
    appState.interaction.cursor = null;
    appState.interaction.cursorHandLabel = null;
    appState.interaction.hoveredControl = null;
    appState.interaction.holdFrames = 0;
    appState.interaction.clickedDuringGesture = false;
    appState.emojiDrag.isDragging = false;
    appState.emojiDrag.lastPointer = null;
    appState.emojiDrag.stablePointer = null;
    appState.emojiDrag.stableStartedAt = 0;
    appState.emojiDrag.wasPointerGesture = false;
    appState.emojiDrag.lostFrames = 0;
    appState.emojiDrag.lastToggleAt = 0;
    appState.emojiDrag.lastTapAt = 0;
    emojiCursorElement.classList.remove('is-visible');
    emojiCursorElement.textContent = '';
    clearHoverStyles();
    updateAirCursor(null, false);
}

function drawGestureFeedback() {
    // Intentionally no-op: we rely on a single air cursor for feedback.
}

function activateControl(control) {
    control.click();
    control.classList.add('is-air-pressed');
    window.setTimeout(() => {
        control.classList.remove('is-air-pressed');
    }, 140);
}

function updateAirInteraction(pointer, isDrawingGesture) {
    const hoveredControl = getHoveredControl(pointer);
    const interaction = appState.interaction;

    if (hoveredControl !== interaction.hoveredControl) {
        clearHoverStyles();
        interaction.hoveredControl = hoveredControl;
        interaction.holdFrames = 0;
        interaction.clickedDuringGesture = false;
    }

    if (hoveredControl) {
        hoveredControl.classList.add('is-air-hovered');
    } else {
        clearHoverStyles();
    }

    if (!hoveredControl || !isDrawingGesture) {
        interaction.holdFrames = 0;
        if (hoveredControl) {
            hoveredControl.classList.remove('is-air-pressed');
        }
        if (!isDrawingGesture) {
            interaction.clickedDuringGesture = false;
        }
        return hoveredControl;
    }

    interaction.holdFrames += 1;
    hoveredControl.classList.add('is-air-pressed');

    const canClickAgain = Date.now() - interaction.lastClickAt >= config.airClickCooldownMs;
    if (interaction.holdFrames >= config.airClickHoldFrames && !interaction.clickedDuringGesture && canClickAgain) {
        activateControl(hoveredControl);
        interaction.clickedDuringGesture = true;
        interaction.lastClickAt = Date.now();
        interaction.holdFrames = 0;
    }

    return hoveredControl;
}

function updateMissingHands(visibleHands) {
    HAND_LABELS.forEach((label) => {
        if (visibleHands.includes(label)) {
            return;
        }

        resetInteractionFilter(label);
        const guideFilter = appState.handGuideFilters[label];
        guideFilter.missingFrames += 1;
        if (!guideFilter.landmarks || guideFilter.missingFrames > config.handGuideHoldFrames) {
            resetHandGuideFilter(label);
        }

        if (holdActiveLineThroughGap(label)) {
            return;
        }

        flushActiveLine(label);
        resetGesture(label);
    });
}

function updateStatus() {
    if (appState.interaction.hoveredControl && appState.activeDrawingGestures > 0) {
        setStatus('Air click ready. Hold your finger on the button.');
    } else if (appState.interaction.hoveredControl) {
        setStatus('Hovering button. Point to click.');
    } else if (!appState.drawingEnabled) {
        setStatus('Emoji mode. Select an emoji, drag with finger, release to drop.');
    } else if (appState.activeDrawingGestures > 0) {
        setStatus('Drawing. Show more fingers to stop.');
    } else if (appState.handsVisible > 0) {
        setStatus('Show only your index finger to draw.');
    } else {
        setStatus('Show your hand to start.');
    }
}

function processHand(landmarks, handLabel, isCursorHand) {
    const stabilizedLandmarks = getSmoothedHandGuide(handLabel, landmarks);
    const interactionTip = getStableInteractionTip(handLabel, stabilizedLandmarks);

    const isDrawingGesture = updateGestureState(handLabel, stabilizedLandmarks);
    const isPointerGesture = hasDrawingGesture(stabilizedLandmarks);
    drawGestureFeedback(stabilizedLandmarks, isDrawingGesture);
    const gestureState = appState.gestures[handLabel];
    let hoveredControl = null;
    let pointer = null;

    if (isCursorHand) {
        pointer = getViewportPointerFromTip(interactionTip, handLabel);
        appState.interaction.cursor = pointer;
        updateAirCursor(pointer, isPointerGesture);
        hoveredControl = updateAirInteraction(pointer, isPointerGesture);
        updateEmojiDrag(pointer, isPointerGesture, hoveredControl);
    }

    if (appState.drawingEnabled && isDrawingGesture && gestureState.shouldDrawPoint && !hoveredControl) {
        addDrawingPoint(handLabel, landmarks);
    } else if (!appState.drawingEnabled) {
        flushActiveLine(handLabel);
    } else if (gestureState.justEnded) {
        flushActiveLine(handLabel);
    } else if (!isDrawingGesture && !holdActiveLineThroughGap(handLabel)) {
        flushActiveLine(handLabel);
    }

    return isDrawingGesture;
}

function onResults(results) {
    appState.lastResultAt = performance.now();
    resizeCanvasToVideo();

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.save();
    canvasCtx.translate(canvasElement.width, 0);
    canvasCtx.scale(-1, 1);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.restore();

    const visibleHands = [];
    let activeDrawingGestures = 0;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        results.multiHandLandmarks.forEach((landmarks, index) => {
            const handedness = results.multiHandedness[index];
            const handLabel = handedness?.label;
            if (!appState.activeLines[handLabel]) return;
            if (!isReliableHand(handLabel, landmarks, handedness)) return;

            visibleHands.push(handLabel);
            const isCursorHand = visibleHands.length === 1;
            if (processHand(landmarks, handLabel, isCursorHand)) {
                activeDrawingGestures += 1;
            }
        });
    }

    if (visibleHands.length === 0) {
        resetAirInteraction();
    }

    updateMissingHands(visibleHands);
    canvasCtx.restore();

    appState.handsVisible = visibleHands.length;
    appState.activeDrawingGestures = activeDrawingGestures;
    updateStatus();
}

async function processCameraFrame() {
    const now = performance.now();
    const minFrameMs = 1000 / config.targetFps;

    if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
    }

    if (appState.inferenceBusy || now - appState.lastInferenceAt < minFrameMs) {
        if (!appState.lastResultAt || now - appState.lastResultAt > 500) {
            drawCameraFrameOnly();
        }
        return;
    }

    appState.inferenceBusy = true;
    appState.lastInferenceAt = now;

    try {
        await hands.send({ image: videoElement });
        if (!appState.lastResultAt || performance.now() - appState.lastResultAt > 500) {
            drawCameraFrameOnly();
        }
    } finally {
        appState.inferenceBusy = false;
    }
}

toggleButton.addEventListener('click', () => {
    appState.drawingEnabled = !appState.drawingEnabled;
    flushAllActiveLines();
    updateToggleButton();
    updateStatus();
});

clearButton.addEventListener('click', clearDrawing);
undoButton.addEventListener('click', undoLastMark);
clearEmojisButton.addEventListener('click', () => {
    clearEmojis();
    setStatus('Emojis cleared.');
});
emojiButtons.forEach((button) => {
    button.addEventListener('click', () => {
        appState.selectedEmoji = button.dataset.emoji || appState.selectedEmoji;
        emojiButtons.forEach((emojiButton) => {
            const isSelected = emojiButton === button;
            emojiButton.classList.toggle('is-active', isSelected);
            emojiButton.setAttribute('aria-pressed', String(isSelected));
        });
    });
});

refreshColorCache();
applyTheme();
applyBranding();
updateToggleButton();

const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 0,
    minDetectionConfidence: config.minDetectionConfidence,
    minTrackingConfidence: config.minTrackingConfidence
});

hands.onResults(onResults);

const camera = new Camera(videoElement, {
    onFrame: processCameraFrame,
    width: config.cameraWidth,
    height: config.cameraHeight
});

function startCameraWithRetry(retryCount = 0) {
    camera.start().then(() => {
        setStatus('Camera ready. Show one finger to draw.');
    }).catch(() => {
        if (retryCount < 2) {
            window.setTimeout(() => startCameraWithRetry(retryCount + 1), 700);
            setStatus('Retrying camera...');
            return;
        }

        setStatus('Camera could not start. Check browser permissions.');
    });
}

startCameraWithRetry();
