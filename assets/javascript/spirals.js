/**
 * Spirals - EmotionArt theme controller + p5 sketch.
 *
 * Adapts the standalone spiral sketch to EmotionArt's shared shell:
 * microphone/text input, backend emotion analysis, transcript display,
 * and gallery save support.
 */

const SPIRALS_DEFAULT_EMOTIONS = {
    anger: 0,
    disgust: 0,
    fear: 0,
    joy: 0,
    neutral: 1,
    sadness: 0,
    surprise: 0,
};

const SPIRALS_PALETTES = {
    anger: ['#ff5a36', '#ff8663', '#ffbea8'],
    disgust: ['#8cbf4d', '#577d2d', '#bedf7b'],
    fear: ['#7a6bff', '#42247c', '#c2a7ff'],
    joy: ['#ffd24d', '#ff8f3f', '#ffe8a3'],
    neutral: ['#d8def7', '#a1b2d8', '#f4f7ff'],
    sadness: ['#7fb0ff', '#395f9e', '#c3d8ff'],
    surprise: ['#ff93e1', '#92f5ff', '#ffe0ff'],
};

let spiralsVisualDNA = buildSpiralsDNA(SPIRALS_DEFAULT_EMOTIONS, '');
let spiralAgents = [];
let lastEmotions = [];
let lastTranscriptText = '';
let isListening = false;
let recognition = null;
let committedTranscript = '';
let liveTranscript = '';
let shouldAnalyseOnStop = false;

const statusEl = document.getElementById('status');
const outputEl = document.getElementById('output');
const transcriptEl = document.getElementById('transcript');
const saveButton = document.getElementById('save-output');
const micButton = document.getElementById('mic-toggle');
const textInput = document.getElementById('text-input');
const textSubmit = document.getElementById('text-submit');
const centerTextEl = document.getElementById('centerText');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function getAppSettings() {
    return window.getEmotionArtSettings ? window.getEmotionArtSettings() : {
        audio_microphone_access: 'enabled',
        audio_default_mic: 'manual',
        audio_transcript_persistence: 'keep',
        model_classifier: 'base',
    };
}

function isMicrophoneDisabled() {
    return getAppSettings().audio_microphone_access === 'disabled';
}

function updateStatus(text) {
    if (statusEl) statusEl.textContent = text;
}

function updateTranscript(text) {
    if (transcriptEl) {
        transcriptEl.textContent = text || 'Waiting for speech or text...';
    }
}

function renderEmotionScores(emotions) {
    if (!outputEl) return;
    if (!emotions || !emotions.length) {
        outputEl.textContent = 'Waiting for input...';
        return;
    }

    outputEl.innerHTML = emotions.slice(0, 5).map((emotion) => `
        <div class="score-row">
            <span class="score-label">${emotion.label.toUpperCase()}</span>
            <span class="score-value">${Math.round(emotion.score * 100)}%</span>
        </div>
    `).join('');
}

function normalizeEmotionPayload(emotions) {
    const map = { ...SPIRALS_DEFAULT_EMOTIONS };
    (emotions || []).forEach((emotion) => {
        const label = String(emotion.label || '').toLowerCase();
        if (label in map) {
            map[label] = Number(emotion.score || 0);
        }
    });
    return map;
}

function hexToRgb(hex) {
    const cleaned = String(hex || '').replace('#', '');
    const safe = cleaned.length === 3
        ? cleaned.split('').map((ch) => ch + ch).join('')
        : cleaned.padEnd(6, '0').slice(0, 6);

    return {
        r: parseInt(safe.slice(0, 2), 16),
        g: parseInt(safe.slice(2, 4), 16),
        b: parseInt(safe.slice(4, 6), 16),
    };
}

function brighten(hex, amount) {
    const rgb = hexToRgb(hex);
    return [
        Math.min(255, rgb.r + amount),
        Math.min(255, rgb.g + amount),
        Math.min(255, rgb.b + amount),
    ];
}

function pickDominantEmotion(emotionMap) {
    return Object.entries(emotionMap)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';
}

function buildPaletteFromEmotionMap(emotionMap) {
    const palette = [];

    Object.entries(emotionMap).forEach(([emotion, score]) => {
        if (score > 0.12 && SPIRALS_PALETTES[emotion]) {
            palette.push(...SPIRALS_PALETTES[emotion]);
        }
    });

    return palette.length ? palette : [...SPIRALS_PALETTES.neutral];
}

function buildBackgroundFromEmotionMap(emotionMap) {
    const dominant = pickDominantEmotion(emotionMap);
    const baseByEmotion = {
        anger: '#1e0909',
        disgust: '#16200d',
        fear: '#140c26',
        joy: '#2a1808',
        sadness: '#0f1d31',
        surprise: '#1a1129',
        neutral: '#10131a',
    };

    return brighten(baseByEmotion[dominant] || baseByEmotion.neutral, 18);
}

function buildSpiralsDNA(emotionMap, rawText) {
    const intensity = emotionMap.anger + emotionMap.disgust + emotionMap.fear +
        emotionMap.joy + emotionMap.sadness + emotionMap.surprise;

    return {
        evenAngle: 0.18 + emotionMap.anger * 0.22 + emotionMap.joy * 0.06,
        oddAngle: -0.36 - emotionMap.fear * 0.24 - emotionMap.sadness * 0.1,
        length: 1.7 + intensity * 1.25 + emotionMap.neutral * 0.2,
        velocity: Math.max(8, Math.floor(10 + intensity * 18 + emotionMap.surprise * 6)),
        palette: buildPaletteFromEmotionMap(emotionMap),
        bgColor: buildBackgroundFromEmotionMap(emotionMap),
        rawText: rawText || '',
        density: Math.max(8, Math.floor(8 + intensity * 7 + emotionMap.neutral * 2)),
        scaleMin: 1.2 + emotionMap.neutral * 0.5,
        scaleMax: 2.7 + emotionMap.joy * 0.8 + emotionMap.surprise * 0.4,
        strokeWeight: 0.8 + intensity * 1.4,
        glowMix: 0.15 + emotionMap.joy * 0.2 + emotionMap.surprise * 0.1,
    };
}

function getStageSize() {
    const holder = document.getElementById('p5-holder');
    return {
        width: Math.max(holder?.clientWidth || 0, 320),
        height: Math.max(holder?.clientHeight || 0, 320),
    };
}

function generateSpiralAgents() {
    spiralAgents = [];

    for (let index = 0; index < spiralsVisualDNA.density; index += 1) {
        const seed = int(random(80, 220 + spiralsVisualDNA.velocity * 2));
        spiralAgents.push({
            hailA: seed,
            hailB: seed,
            angleA: random(TWO_PI),
            angleB: random(TWO_PI),
            posX: random(width),
            posY: random(height),
            start: true,
            scale: random(spiralsVisualDNA.scaleMin, spiralsVisualDNA.scaleMax),
            color: random(spiralsVisualDNA.palette),
        });
    }
}

function respawnAgent(agent) {
    const seed = int(random(80, 220 + spiralsVisualDNA.velocity * 2));
    agent.hailA = seed;
    agent.hailB = seed;
    agent.angleA = random(TWO_PI);
    agent.angleB = random(TWO_PI);
    agent.posX = random(width);
    agent.posY = random(height);
    agent.scale = random(spiralsVisualDNA.scaleMin, spiralsVisualDNA.scaleMax);
    agent.color = random(spiralsVisualDNA.palette);
    agent.start = false;
}

function applyEmotionScores(emotions, rawText) {
    const emotionMap = normalizeEmotionPayload(emotions);
    spiralsVisualDNA = buildSpiralsDNA(emotionMap, rawText);
    if (centerTextEl) {
        centerTextEl.textContent = rawText || 'Waiting For Input';
    }
    if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
        generateSpiralAgents();
    }
}

function setup() {
    const stageSize = getStageSize();
    const canvas = createCanvas(stageSize.width, stageSize.height);
    canvas.parent('p5-holder');
    noFill();
    background(...spiralsVisualDNA.bgColor);
    generateSpiralAgents();
}

function draw() {
    background(...spiralsVisualDNA.bgColor);

    for (const agent of spiralAgents) {
        for (let step = 0; step < spiralsVisualDNA.velocity; step += 1) {
            if (agent.start) {
                respawnAgent(agent);
            }

            let deltaX = 0;
            let deltaY = 0;

            if (agent.hailA > 1) {
                if (agent.hailA % 2 === 0) {
                    agent.hailA *= 0.5;
                    agent.angleA += spiralsVisualDNA.evenAngle;
                } else {
                    agent.hailA = 3 * agent.hailA + 1;
                    agent.angleA += spiralsVisualDNA.oddAngle;
                }

                deltaX = cos(agent.angleA) * spiralsVisualDNA.length * agent.scale;
                deltaY = sin(agent.angleA) * spiralsVisualDNA.length * agent.scale;
            } else if (agent.hailB > 1) {
                if (agent.hailB % 2 === 0) {
                    agent.hailB *= 0.5;
                    agent.angleB -= spiralsVisualDNA.evenAngle;
                } else {
                    agent.hailB = 3 * agent.hailB + 1;
                    agent.angleB -= spiralsVisualDNA.oddAngle;
                }

                deltaX = -cos(agent.angleB) * spiralsVisualDNA.length * agent.scale;
                deltaY = -sin(agent.angleB) * spiralsVisualDNA.length * agent.scale;
            } else {
                agent.start = true;
                continue;
            }

            const strokeColour = lerpColor(
                color(agent.color),
                color(255),
                spiralsVisualDNA.glowMix
            );
            stroke(strokeColour);
            strokeWeight(spiralsVisualDNA.strokeWeight * agent.scale * 0.55);
            line(agent.posX, agent.posY, agent.posX + deltaX, agent.posY + deltaY);

            agent.posX += deltaX;
            agent.posY += deltaY;
        }
    }

    if (centerTextEl && spiralsVisualDNA.palette.length) {
        centerTextEl.style.color = random(spiralsVisualDNA.palette);
    }
}

function windowResized() {
    const stageSize = getStageSize();
    resizeCanvas(stageSize.width, stageSize.height);
    generateSpiralAgents();
}

async function analyseText(text) {
    const cleanedText = (text || '').trim();
    if (!cleanedText) return;

    lastTranscriptText = cleanedText;
    updateTranscript(cleanedText);
    updateStatus('ANALYSING');

    try {
        const settings = getAppSettings();
        const response = await fetch('/analyse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: cleanedText,
                model: settings.model_classifier || 'base',
            }),
        });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.details || payload.error || 'Analysis failed.');
        }

        lastEmotions = payload.emotions || [];
        renderEmotionScores(lastEmotions);
        applyEmotionScores(lastEmotions, cleanedText);

        updateStatus(isListening ? 'LISTENING' : 'READY');
        if (saveButton) saveButton.disabled = false;

        if (settings.audio_transcript_persistence === 'clear') {
            updateTranscript('');
        }
    } catch (error) {
        console.error(error);
        if (outputEl) outputEl.textContent = error.message || 'Analysis failed.';
        updateStatus('MODEL ERROR');
    }
}

function resetMicButton() {
    if (!micButton) return;
    micButton.textContent = 'START LISTENING';
    micButton.classList.remove('secondary');
    micButton.classList.add('passive');
}

function applyBlockedMicState() {
    isListening = false;
    shouldAnalyseOnStop = false;
    if (!micButton) return;
    micButton.disabled = true;
    micButton.textContent = 'MIC DISABLED';
    micButton.classList.remove('secondary', 'active');
    micButton.classList.add('passive');
    updateStatus('MIC DISABLED');
}

if (isMicrophoneDisabled()) {
    applyBlockedMicState();
} else if (SpeechRecognition && micButton) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.addEventListener('result', (event) => {
        const finalChunks = [];
        const interimChunks = [];

        for (let index = 0; index < event.results.length; index += 1) {
            const result = event.results[index];
            const text = result[0].transcript.trim();
            if (!text) continue;
            if (result.isFinal) finalChunks.push(text);
            else interimChunks.push(text);
        }

        committedTranscript = finalChunks.join(' ').trim();
        liveTranscript = `${committedTranscript} ${interimChunks.join(' ').trim()}`.trim();
        updateTranscript(liveTranscript);
    });

    recognition.addEventListener('end', () => {
        if (isListening) {
            recognition.start();
            return;
        }

        if (shouldAnalyseOnStop) {
            shouldAnalyseOnStop = false;
            const finalTranscript = (liveTranscript || committedTranscript).trim();
            committedTranscript = '';
            liveTranscript = '';
            updateTranscript(finalTranscript);
            if (finalTranscript) analyseText(finalTranscript);
            else updateStatus('READY');
        }
    });

    recognition.addEventListener('error', (event) => {
        if (event.error !== 'no-speech') {
            isListening = false;
            resetMicButton();
            updateStatus('MIC ERROR');
        }
    });

    micButton.addEventListener('click', () => {
        if (isListening) {
            isListening = false;
            shouldAnalyseOnStop = true;
            recognition.stop();
            resetMicButton();
            updateStatus('ANALYSING');
            return;
        }

        committedTranscript = '';
        liveTranscript = '';
        shouldAnalyseOnStop = false;
        isListening = true;
        updateTranscript('');
        micButton.textContent = 'END LISTENING';
        micButton.classList.remove('passive');
        micButton.classList.add('secondary');
        updateStatus('LISTENING');
        recognition.start();
    });

    if (!isMicrophoneDisabled() && getAppSettings().audio_default_mic === 'auto') {
        micButton.click();
    }
} else if (micButton) {
    micButton.textContent = 'NO MIC API';
    micButton.disabled = true;
    micButton.classList.add('passive');
    updateStatus('MIC UNAVAILABLE');
}

async function submitText() {
    const text = textInput?.value.trim() || '';
    if (!text) return;
    textInput.value = '';
    await analyseText(text);
}

if (textSubmit) {
    textSubmit.addEventListener('click', submitText);
}

if (textInput) {
    textInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            submitText();
        }
    });
}

if (window.saveArtwork) {
    window.saveArtwork({
        pageName: 'spirals',
        captureImage: () => {
            const canvas = document.querySelector('#p5-holder canvas');
            return canvas ? canvas.toDataURL('image/png') : '';
        },
        getEmotions: () => lastEmotions,
        getTranscript: () => lastTranscriptText,
    });
}
