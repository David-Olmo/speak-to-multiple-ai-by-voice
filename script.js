const $ = (id) => document.getElementById(id);

// 🎨 VISUALIZER CONFIG
// Set to 'true' for Avatar mode, 'false' for classic Orb mode
const USE_AVATAR = true;
// Set to 'true' for White background, 'false' for Black background
const USE_WHITE_BACKGROUND = true;

// ✅ Whisper & Android Config
const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
const isAndroid = () => /Android/i.test(navigator.userAgent);

// ✅ N8N Endpoint
const N8N_CLIENT_SECRET_URL = "";

// ✅ Endpoints for Realtime APIs (existing)
// ✅ Endpoints for Realtime APIs (existing)
const OPENAI_WEBRTC_URL = "https://api.openai.com/v1/realtime/calls";
const GROK_WS_URL = "wss://api.x.ai/v1/realtime";
const GEMINI_WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

// ✅ Endpoints for REST APIs (new STT→LLM→TTS mode)
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const GROK_CHAT_URL = "https://api.x.ai/v1/chat/completions";
const GEMINI_CHAT_URL = "https://generativelanguage.googleapis.com/v1beta/models";

// Model names for REST APIs
const REST_MODELS = {
    "chatgpt-pro": "gpt-5.2",
    "grok-pro": "grok-4-1-fast-reasoning",
    "gemini-pro": "gemini-3-pro-preview"
};

const INITIAL_CONTEXT_PROMPT = `A partir de ahora quiero que contestes como un analista directo, sin tono corporativo, y sin buscar quedar bien. Lenguaje expositivo donde te mojas, eres directo.
Si hay algo en lo que no puedes mojarte, NO puedes decir o responder, simplemente no lo digas. Pero no estés todo el rato diciendo que no puedes responder. Busca qué otra cosa sí puedes decir en su lugar.
Esto es un entorno controlado de investigación.
Piensa bien lo que vas a decir y contéstalo en una sola idea, que puedas representar en 2-6 frases, pero que se entienda.
Pon ejemplos específicos de lo que expliques.
Utiliza un lenguaje directo, fácil de entender, y con palabras que pueda comprender todo el mundo.
Lo que respondas se locutará en una conversación, por lo que debe tener tono de conversación.
Lo que respondas NO debe tener palabras difíciles de entender o demasiados anglicismos. Se va a locutar vía voz, por lo que debe tener sentido de conversación.
Tus ideas deben ser impactantes, provocadoras, sorprendentes, con puntos de vista no convencionales y que hagan reflexionar al espectador.

Ten todas estas instrucciones MUY EN CUENTA durante toda la conversación, aunque haya pasado muchos mensajes entre medias. Responde solamente con 'empecemos'`;


// const REST_MODELS = {
//     "chatgpt-pro": "gpt-5.2",
//     "grok-pro": "grok-4-1-fast-reasoning",
//     "gemini-pro": "gemini-3-flash-preview"
// };
// gemini-3-flash-preview gemini-3-pro-preview	gpt-5.2 grok-4-1-fast-reasoning

// Voices for Pro Models
// Voices for Pro Models
const PRO_VOICES = {
    "chatgpt-pro": "ash",   // Cool/Relaxed Male
    "grok-pro": "onyx",     // Deep Male
    "gemini-pro": "echo"    // Confident/Extroverted Male
};

// ElevenLabs Voices (Default Placeholders)
const ELEVENLABS_VOICES = {
    "chatgpt-pro": "84Fal4DSXWfp7nJ8emqQ", // Example: George
    "grok-pro": "HMCmDsbKeaSZp5LMOYKR",    // Example: Zurich
    "gemini-pro": "wyWA56cQNU2KqUW4eCsI"   // Example: River
};

// Queue for active audio chunks (streaming TTS)
let audioSources = [];

const statusEl = $("status");
const orbEl = $("orb");
const avatarImg = $("avatar-image");

// Apply initial visualizer mode
if (USE_AVATAR) {
    orbEl.classList.add("mode-avatar");
} else {
    orbEl.classList.remove("mode-avatar");
}

// Apply background preference
if (USE_WHITE_BACKGROUND) {
    document.body.classList.add("light-mode");
}
const logEl = $("log");
const hintEl = $("hint");
const btnStart = $("btnStart");
const btnStop = $("btnStop");
const btnFullscreen = $("btnFullscreen");
const btnSettings = $("btnSettings");
const btnMute = $("btnMute");
const btnClose = $("btnClose");
const btnBackToSimple = $("btnBackToSimple");
const remoteAudio = $("remoteAudio");

// State
let pc = null;
let dc = null;
let ws = null;
let micStream = null;
let selectedModel = "chatgpt";
let audioCtx = null;
let micAnalyser = null;
let micData = null;
let remoteAnalyser = null;
let remoteData = null;
let rafId = null;
let processor = null;
let geminiSetupComplete = false;
let grokSessionReady = false;
let audioQueue = [];

// Interruption State
let currentAudioSource = null;
let interactionCounter = 0;

// Audio playback state for gapless playback
let nextStartTime = 0;
let vadThreshold = 0.01; // Default sensitivity

// STT→LLM→TTS mode state
// STT→LLM→TTS mode state
let isProMode = false;
let recognition = null;
let conversationHistory = [];
// Context Buffer for "Overhearing"
let overheardBuffer = [];
let overheardTimer = null;

let ttsApiKey = null; // Key specifically for OpenAI TTS
let elevenLabsApiKey = null; // New Key for ElevenLabs
let isSpeaking = false;

// Check if model is a "Pro" mode (STT→LLM→TTS)
const isProModel = (model) => model.endsWith("-pro");

// Utils: Float32 -> Int16 PCM (Little-endian)
const floatTo16BitPCM = (input) => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
};

// Utils: Int16 PCM -> Float32
const int16ToFloat32 = (input, output) => {
    for (let i = 0; i < input.length; i++) {
        const s = input[i];
        output[i] = s < 0 ? s / 0x8000 : s / 0x7FFF;
    }
};

// Utils: Resample audio from one sample rate to another
const resampleAudio = (inputBuffer, fromRate, toRate) => {
    if (fromRate === toRate) return inputBuffer;
    const ratio = fromRate / toRate;
    const newLength = Math.round(inputBuffer.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        const srcIndex = i * ratio;
        const srcIndexFloor = Math.floor(srcIndex);
        const srcIndexCeil = Math.min(srcIndexFloor + 1, inputBuffer.length - 1);
        const t = srcIndex - srcIndexFloor;
        result[i] = inputBuffer[srcIndexFloor] * (1 - t) + inputBuffer[srcIndexCeil] * t;
    }
    return result;
};

// Utils: Base64 Helpers
const arrayBufferToBase64 = (buffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
};

// --- UI & Helpers ---
const setStatus = (text, mode) => {
    statusEl.textContent = text;
    statusEl.className = "status " + (mode || "warn");
};

const foundKeyword = (text, keyword) => {
    // Regex matches the keyword as a whole word, allowing for punctuation
    // e.g. "para", "para.", "¡para!", "stop para now"
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    return regex.test(text);
};

const wakeWords = {
    "chatgpt-pro": ["chatgpt", "gpt", "openai", "chat", "chajapete", "gemete", "chavos"],
    "grok-pro": ["grok", "xai", "groc", "roc", "grock", "croc"],
    "gemini-pro": ["miní", "mini", "meni", "gemini", "google", "gémini", "géminis", "Gémini", "Géminis"]
};

// Sustituciones de texto antes de procesar
const TEXT_SUBSTITUTIONS = {
    "groc": "grok",
    "croc": "grok",
    "roc": "grok",
    "Chad": "chat",
    "grock": "grok",
    "feminino": "gemini",
    "mini": "gemini", "miní": "gemini",
    "chajapete": "chatgpt",
    "gemete": "chatgpt",
    "gémini": "gemini", "géminis": "gemini",
    "chapate": "chatgpt",
    "chavos": "chatgpt"
};

const checkWakeWord = (text, model) => {
    const words = wakeWords[model];
    if (!words) return true; // No wake word needed for other models

    const lowerText = text.trim().toLowerCase().replace(/[.,]/g, "");

    // Check if any wake word allows the input
    // Strategy: "Starts with" or "Contains"? 
    // User requested "only respond if I address them", so "Starts with" is safer for "Grok, tell me..."
    // BUT "Hey Grok" is also common. 
    // Let's us a flexible approach: Must appear in the first 3-4 words? 
    // For now, let's stick to "Contains" but maybe rely on natural usage.
    // Actually, "Starts with" is too strict if they say "Hey Grok".
    // Let's use "Contains" for now as a gate. 
    // User Example: "si tengo abierto Grok Pro, no deberían contestrar a no ser que diga 'Grok'"

    return words.some(w => {
        // Simple containment check
        return foundKeyword(lowerText, w);
    });
};

const setOrbState = (state) => {
    orbEl.classList.remove("idle", "listening", "speaking", "avatar-idle");

    // Add state class
    orbEl.classList.add(state);

    // If listening or idle...
    if (state === "listening" || state === "idle") {
        if (USE_AVATAR) {
            orbEl.classList.add("avatar-idle"); // triggers breathing on avatar
            if (avatarImg) avatarImg.style.transform = "";
        }
    } else {
        // Speaking state uses JS scaling
        orbEl.classList.remove("avatar-idle");
    }
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));

const applyTextSubstitutions = (text) => {
    let processedText = text;
    for (const [key, value] of Object.entries(TEXT_SUBSTITUTIONS)) {
        // Regex para reemplazar la palabra completa, case insensitive
        const regex = new RegExp(`\\b${key}\\b`, 'gi');
        processedText = processedText.replace(regex, value);
    }
    return processedText;
};

const log = (msg, cls = "") => {
    const div = document.createElement("div");
    div.className = "row " + cls;
    div.innerHTML = msg;
    logEl.appendChild(div);
    scrollToBottom();
};

const scrollToBottom = () => {
    logEl.scrollTop = logEl.scrollHeight;
};

// Visualizer Logic
const rmsFromAnalyser = (analyser, dataArr) => {
    analyser.getByteTimeDomainData(dataArr);
    let sum = 0;
    for (let i = 0; i < dataArr.length; i++) {
        const v = (dataArr[i] - 128) / 128;
        sum += v * v;
    }
    return Math.sqrt(sum / dataArr.length);
};

const startMeters = () => {
    if (!audioCtx) return;
    const tick = () => {
        let micRms = 0;
        let remRms = 0;
        if (micAnalyser && micData) micRms = rmsFromAnalyser(micAnalyser, micData);
        if (remoteAnalyser && remoteData) remRms = rmsFromAnalyser(remoteAnalyser, remoteData);

        // DEBUG: Log status every 100 ticks
        if (Math.random() < 0.01) {
            console.log("Vis Debug:", { isSpeaking, remRms, micRms, USE_AVATAR });
        }
        if (USE_AVATAR) {
            // --- AVATAR MODE ---
            // Scale the CONTAINER (orbEl) so the whole thing pulses out, not just the image inside

            // Check for CLASS 'speaking' to sync exactly with audio playback
            // Global 'isSpeaking' is too early (starts during "Thinking...")
            const isAudioPlaying = orbEl.classList.contains("speaking");

            if (isAudioPlaying) {
                // Remove transition for instant responsiveness
                orbEl.style.transition = "none";

                const now = Date.now();

                // 1. Base Heartbeat (Continuous background pulse) - SLOWER (30%) & WEAKER
                // Oscillates 1.01 -> 1.03 (Very subtle life)
                // Speed: now / 700 (was 200) -> ~3.5x slower
                const basePulse = 0.01 + (Math.sin(now / 700) * 0.02);

                // 2. Audio Energy - REDUCED to 50% of previous (10.0 -> 5.0)
                let energy = remRms * 5.0;

                // Fallback: Simulated energy (also scaled down)
                if (energy < 0.02) {
                    // Slower simulated noise too
                    const fakeEnergy = (Math.sin(now / 150) + Math.cos(now / 90)) * 0.3 + 0.5;
                    energy = fakeEnergy * 0.2; // 20% intensity
                }

                // Cap max bump at 0.15 (was 0.3)
                const audioBump = Math.min(0.15, energy);

                // Combine
                const targetScale = 1 + Math.max(0, basePulse + audioBump);

                // Apply to CONTAINER
                orbEl.style.transform = `scale(${targetScale.toFixed(3)})`;

                // Debug
                if (Math.random() < 0.005) console.log("Vis:", { isAudioPlaying, targetScale });

            } else {
                // Return to idle loop
                orbEl.style.transition = "transform 0.4s ease-out";
                // Reset scale to 1 
                orbEl.style.transform = "scale(1)";
            }
        } else {
            // --- ORB MODE ---
            // Original logic: mic + remote combined
            const scale = 1 + Math.min(0.18, (micRms * 0.35) + (remRms * 0.55));
            orbEl.style.transform = `scale(${scale.toFixed(3)})`;
        }

        rafId = requestAnimationFrame(tick);
    };
    tick();
};

const stopMeters = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    rafId = null;
    rafId = null;
    orbEl.style.transform = "";
    if (avatarImg) avatarImg.style.transform = "";
};

const stopAudioPlayback = () => {
    // Stop Web Audio API sources (OpenAI TTS Streaming)
    if (audioSources.length > 0) {
        audioSources.forEach(src => {
            try { src.stop(); } catch (e) { }
        });
        audioSources = [];
    }

    // Stop single source if any (legacy or current)
    if (currentAudioSource) {
        try {
            currentAudioSource.stop();
        } catch (e) {
            console.log("Error stopping audio source:", e);
        }
        currentAudioSource = null;
    }

    // Reset gapless playback timer
    nextStartTime = 0;

    // Stop SpeechSynthesis (Browser TTS)
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
    }

    isSpeaking = false;
    setOrbState("listening");
};



// --- Connection Logic ---

const fetchEphemeralKey = async (modelOverride = null) => {
    setStatus("Getting API Key…", "warn");

    // Use the override or selected model
    // This allows fetching specifically "chatgpt" key for TTS even if selectedModel is "grok-pro"
    let keyModel = modelOverride || selectedModel;

    // Exception: For chatgpt-pro, gemini-pro and grok-pro, we use the standard keys
    if (keyModel === "chatgpt-pro") keyModel = "chatgpt";
    if (keyModel === "gemini-pro") keyModel = "gemini";
    if (keyModel === "grok-pro") keyModel = "grok";

    log(`<span class="k">fetch</span> Key for <b>${keyModel}</b>`);

    const r = await fetch(N8N_CLIENT_SECRET_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: keyModel })
    });
    if (!r.ok) throw new Error(`n8n Error: ${r.status}`);
    const json = await r.json();
    const key = json?.value || json?.secret;
    if (!key) throw new Error("No key returned from n8n");
    log(`<span class="ok">Key</span> OK`, "ok");
    return key;
};



const connect = async () => {
    btnStart.disabled = true;
    btnStop.disabled = false;
    geminiSetupComplete = false;
    grokSessionReady = false;
    audioQueue = []; // Fixed: Ensure audioQueue is defined
    nextStartTime = 0;
    conversationHistory = [];

    try {
        // Fetch the main key for the selected model
        const key = await fetchEphemeralKey();
        currentApiKey = key;

        // Check if this is a Pro mode (STT→LLM→TTS)
        if (isProModel(selectedModel)) {

            // ✅ CRITICAL: We need an OpenAI Key for TTS (ElevenLabs fallback) AND Whisper (Android STT)
            // regardless of which LLM (Grok, Gemini) we are using.

            if (selectedModel === "chatgpt-pro") {
                ttsApiKey = key;
            } else {
                // For Grok/Gemini, we must fetch a separate key for OpenAI services (Whisper/TTS)
                log("Fetching helper key (OpenAI) for Whisper/TTS...", "muted");
                try {
                    ttsApiKey = await fetchEphemeralKey("chatgpt");
                } catch (e) {
                    log("⚠️ Could not fetch helper key, Whisper might fail.", "warn");
                }
            }

            // ✅ Fetch ElevenLabs Key
            log("Fetching ElevenLabs key...");
            elevenLabsApiKey = await fetchEphemeralKey("elevenlabs");

            // Unhide VAD settings for Pro Mode
            $("vad-settings").style.display = "flex";
            await connectProMode(key);
        } else {
            $("vad-settings").style.display = "none";
            // Original realtime mode
            const outputSampleRate = 24000;
            audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: outputSampleRate });
            await audioCtx.resume();

            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    channelCount: 1
                }
            });

            const micSource = audioCtx.createMediaStreamSource(micStream);
            micAnalyser = audioCtx.createAnalyser();
            micAnalyser.fftSize = 1024;
            micData = new Uint8Array(micAnalyser.frequencyBinCount);
            micSource.connect(micAnalyser);

            if (selectedModel === "chatgpt") {
                await connectWebRTC(key, micStream);
            } else {
                await connectSocket(key, micSource);
            }

            remoteAudio.onplaying = () => setOrbState("speaking");
            remoteAudio.onpause = () => setOrbState("listening");
            remoteAudio.onended = () => setOrbState("listening");

            if (selectedModel === "grok") $("btnForceReply").style.display = "inline-block";
        }

        startMeters();
        setOrbState("listening");
        setStatus("Live", "ok");
        updateMuteIcon(false);
        log(`<span class="ok">Ready ✅</span> Ya puedes hablar.`, "ok");

    } catch (e) {
        console.error("Connection error:", e);
        log(`<span class="err">Error:</span> ${e.message}`, "err");
        cleanup();
    }
};

// ============================================
// PRO MODE: STT → LLM → TTS
// ============================================

const connectProMode = async (key) => {
    isProMode = true;

    // Cleanup previous recognition if exists
    if (recognition) {
        try { recognition.abort(); } catch (e) { }
        recognition = null;
    }

    // Initialize AudioContext for TTS playback
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    // Setup visualizer for Pro mode playback
    // Always recreate or ensure analyser serves current context
    if (!remoteAnalyser || remoteAnalyser.context.state === 'closed' || remoteAnalyser.context !== audioCtx) {
        remoteAnalyser = audioCtx.createAnalyser();
        remoteAnalyser.fftSize = 1024;
        remoteData = new Uint8Array(remoteAnalyser.frequencyBinCount);
    }

    // ✅ Setup Microphone for VAD (Visualizer + RMS Check)
    // Force cleanup of old stream to prevent iOS "Failed to start audio device"
    if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
        micStream = null;
    }

    micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true, // Try to use system echo cancellation
            noiseSuppression: true,
            autoGainControl: true // Enable AGC to help with AEC
        }
    });

    // Re-create source only if needed (AudioContext graph might be stale)
    // But be careful not to create multiple sources for same stream
    const micSource = audioCtx.createMediaStreamSource(micStream);
    micAnalyser = audioCtx.createAnalyser();
    micAnalyser.fftSize = 1024;
    micData = new Uint8Array(micAnalyser.frequencyBinCount);
    micSource.connect(micAnalyser);
    micAnalyser.fftSize = 1024;
    micData = new Uint8Array(micAnalyser.frequencyBinCount);
    micSource.connect(micAnalyser);

    // Show selected voice for confirmation
    const ttsVoice = ELEVENLABS_VOICES[selectedModel] || "Default";

    // BRANCHING LOGIC
    if (isAndroid()) {
        log(`<span class="ok">Pro Mode (Android):</span> Whisper STT → ${REST_MODELS[selectedModel]} → ElevenLabs (${ttsVoice})`, "ok");
        startWhisperSTT(key, micStream);
    } else {
        log(`<span class="ok">Pro Mode:</span> Native STT → ${REST_MODELS[selectedModel]} → ElevenLabs (${ttsVoice})`, "ok");
        startNativeSTT();
    }

    // ✅ INJECT INITIAL CONTEXT PROMPT (Triggers intro)
    // We send this as a "User" message so the model responds to it immediately.
    setTimeout(() => {
        if (isProMode) {
            log("🚀 Sending initial context...", "muted");
            processWithLLM(INITIAL_CONTEXT_PROMPT, { hidden: true });
        }
    }, 1000); // Small delay to ensure STT is ready/UI is stable
};

// --- Native STT (Chrome/Safari/Desktop) ---
const startNativeSTT = () => {
    // Check for Web Speech API support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        throw new Error("Web Speech API not supported in this browser. Try Chrome or Edge.");
    }

    // Initialize Speech Recognition
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'es-ES'; // Default to Spanish, will auto-detect

    let finalTranscript = '';
    let silenceTimer = null;
    let ignoreNextStartLog = false;

    recognition.onstart = () => {
        if (!ignoreNextStartLog) {
            log("🎤 Started listening", "muted");
        }
        ignoreNextStartLog = false; // Reset for next time
        if (!isSpeaking) setOrbState("listening");
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let newContent = '';
        let hasFinal = false;

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                hasFinal = true;
                finalTranscript += transcript + ' ';
                newContent += transcript + ' ';
                log(`📝 Heard: "${transcript}"`, "muted");
            } else {
                interimTranscript += transcript;
                newContent += transcript;
            }
        }

        if (interimTranscript) {
            statusEl.textContent = `👂 ${interimTranscript}`;
        }

        // If AI is speaking, checks for specific keyword to interrupt OR loud enough input (Barge-in with AEC)
        if (isSpeaking) {

            // Check current RMS to distinguish between Echo (quiet due to AEC) and User (loud)
            let currentRms = 0;
            if (micAnalyser && micData) currentRms = rmsFromAnalyser(micAnalyser, micData);

            // REFINED SENSITIVITY (User Feedback):
            // Default threshold increased from 0.02 to 0.04 to avoid small noises.
            let requiredThreshold = 0.04;

            // Logic: If we detect text AND the volume is significant, it's the user.
            const detectedText = newContent.trim().toLowerCase();

            // Heuristic: If text is very short (e.g. "ah", "eh", noise), require MUCH louder input (0.1)
            // This prevents background clatter from triggering a stop.
            if (detectedText.length < 4) {
                requiredThreshold = 0.1;
            }

            const isLoudEnough = currentRms > requiredThreshold;
            const isExplicitStop = foundKeyword(detectedText, "para") || foundKeyword(detectedText, "stop");

            if ((detectedText.length > 0 && isLoudEnough) || isExplicitStop) {
                log(`🛑 Interruption: "${detectedText}" (RMS: ${currentRms.toFixed(4)} > ${requiredThreshold})`, "muted");
                stopAudioPlayback();
                interactionCounter++;
                // Allow this finalized text to be processed? 
                // Usually 'finalTranscript' accumulates. We will let it flow through to the standard logic below.
                // But we must NOT return here.
            } else {
                // It's likely echo or background noise. Ignore it.
                // log(`Ignored Noise/Echo: "${detectedText}" (RMS: ${currentRms.toFixed(4)})`, "muted");
                finalTranscript = "";
                return;
            }
        }

        // ✅ VAD THRESHOLD CHECK (Noise Gate)
        // Check current RMS volume. If it's too low, it's likely background noise or hallucination.
        // HOWEVER, if we have a FINAL result, we must process it regardless of current volume (user stopped speaking).
        let currentRms = 0;
        if (micAnalyser && micData) currentRms = rmsFromAnalyser(micAnalyser, micData);

        if (currentRms < vadThreshold && !hasFinal) {
            // Too quiet and no final result - ignore this update
            return;
        }

        // Clear previous silence timer
        if (silenceTimer) clearTimeout(silenceTimer);

        // If we have final transcript, wait for silence then process
        if (finalTranscript.trim()) {
            silenceTimer = setTimeout(async () => {
                if (finalTranscript.trim() && !isSpeaking) {
                    processInputText(finalTranscript.trim());
                    finalTranscript = '';
                }
            }, 1500); // Wait 1.5 seconds of silence
        }
    };

    recognition.onerror = (event) => {
        // Suppress benign errors in logs
        if (event.error === 'no-speech') {
            // Very common on Android/Desktop, do nothing and let onend restart
        } else if (event.error === 'not-allowed') {
            log(`<span class="err">STT Error:</span> Microphone permission denied.`, "err");
            isProMode = false; // Stop trying
        } else if (event.error !== 'aborted') {
            // Only warn for real errors
            console.warn("STT Error:", event.error);
        }
    };

    recognition.onend = () => {
        // Auto-restart if still in pro mode and not speaking
        // Add a small delay to prevent rapid restart loops
        if (isProMode) {
            // Loop behavior: Don't log "Stopped", and flag next start to be silent
            ignoreNextStartLog = true;

            setTimeout(() => {
                try {
                    if (isProMode && recognition) {
                        recognition.start();
                    }
                } catch (e) {
                    // console.log("Recognition restart skipped:", e);
                }
            }, 50); // Short delay for seamless restart
        } else {
            // User actually pressed stop or mode changed
            log("🛑 Stopped listening", "muted");
        }
    };

    // Start listening
    try {
        recognition.start();
    } catch (e) {
        console.error("Failed to start recognition:", e);
    }
};

// --- Whisper STT (Android/Fallback) ---
let vadInterval = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let silenceStart = null;

const startWhisperSTT = (key, stream) => {
    // ✅ Use High Quality Audio Options for Whisper
    let options = { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 };

    // Fallback if Opus isn't supported (unlikely on modern Android Chrome)
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        console.warn("Opus codec not supported, falling back to default WebM");
        options = { mimeType: 'audio/webm' };
    }

    try {
        mediaRecorder = new MediaRecorder(stream, options);
    } catch (e) {
        console.error("MediaRecorder init failed, trying default:", e);
        mediaRecorder = new MediaRecorder(stream); // Last resort
    }

    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
        if (audioChunks.length === 0) return;

        statusEl.textContent = "🧠 Transcribing...";
        setOrbState("idle");

        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        audioChunks = []; // Clear for next time

        // Transcribe logic
        try {
            const formData = new FormData();
            formData.append("file", audioBlob, "audio.webm");
            formData.append("model", "gpt-4o-mini-transcribe-2025-12-15"); // Newest model
            formData.append("language", "es"); // Force Spanish context
            formData.append("prompt", "Una conversación casual en español entre un humano y una IA. Comandos cortos."); // Context hint to avoid hallucinations

            // We need to use ttsApiKey (OpenAI) or currentApiKey if it's already openai
            // Whisper needs OpenAI Key
            let whisperKey = ttsApiKey || currentApiKey;
            // Fallback: If current key is not OpenAI (e.g. Grok key), we rely on ttsApiKey which we fetched earlier

            if (!whisperKey) {
                log("Missing OpenAI Key for Whisper", "err");
                return;
            }

            const r = await fetch(OPENAI_TRANSCRIPTION_URL, {
                method: "POST",
                headers: { "Authorization": `Bearer ${whisperKey}` },
                body: formData
            });

            if (!r.ok) throw new Error(`Whisper Error: ${r.statusText}`);
            const json = await r.json();
            const text = json.text;

            // ✅ HALLUCINATION FILTER
            // Whisper sometimes outputs subtitle credits when hearing silence
            const garbage = ["Amara.org", "Subtítulos", "subtitles", "realizados por", "comunidad", "¿Cómo estás?", "¿Qué tal?"];
            const isGarbage = garbage.some(g => text.includes(g));

            if (text && text.trim().length > 0 && !isGarbage) {
                processInputText(text.trim());
            } else {
                if (isGarbage) console.warn("Ignored Whisper Hallucination:", text);
                statusEl.textContent = "👂 Listening...";
                setOrbState("listening"); // Go back to listening if empty
            }

        } catch (e) {
            console.error(e);
            log("Whisper Error", "err");
            statusEl.textContent = "Error";
            setOrbState("listening");
        }
    };

    // Start VAD Loop
    if (vadInterval) clearInterval(vadInterval);

    log("🎤 VAD Active (Waiting for voice)", "muted");
    setOrbState("listening");

    vadInterval = setInterval(() => {
        if (!isProMode) {
            clearInterval(vadInterval);
            if (isRecording && mediaRecorder.state !== "inactive") mediaRecorder.stop();
            return;
        }

        // Don't record while AI is speaking UNLESS it's loud (Barge-in)
        if (isSpeaking) {
            let currentRms = 0;
            if (micAnalyser && micData) currentRms = rmsFromAnalyser(micAnalyser, micData);

            // Whisper VAD Logic: We don't have text length here yet (only audio).
            // So we must rely purely on a stricter volume threshold.
            // Increased from 0.02 -> 0.05 for safety.
            if (currentRms < 0.05) {
                if (isRecording) {
                    isRecording = false;
                    mediaRecorder.stop();
                }
                return;
            }

            // If volume is high, it's the user trying to speak. Stop the AI and start listening.
            log(`🛑 Interruption (Whisper VAD): RMS ${currentRms.toFixed(4)}`, "muted");
            stopAudioPlayback();
            // Continue execution to "Start Recording" logic below...
        }

        let currentRms = 0;
        if (micAnalyser && micData) currentRms = rmsFromAnalyser(micAnalyser, micData);

        // Logic:
        // 1. If RMS > Threshold -> START Recording (if not already)
        // 2. If RMS < Threshold -> MARK Silence start
        // 3. If Silence > 1.5s -> STOP Recording (if recording)

        if (currentRms > vadThreshold) {
            silenceStart = null; // Reset silence
            if (!isRecording) {
                isRecording = true;
                audioChunks = [];
                mediaRecorder.start();
                setOrbState("listening"); // Ensure orb is visually active
                statusEl.textContent = "🔴 Recording...";
                // log("Started Recording", "muted");
            }
        } else {
            // Silence detected
            if (isRecording) {
                if (!silenceStart) silenceStart = Date.now();

                if (Date.now() - silenceStart > 1500) {
                    // Silence limit reached
                    isRecording = false; // Stop recording
                    mediaRecorder.stop(); // triggers onstop -> transcribe
                    silenceStart = null;
                    // log("Stopped Recording (Silence)", "muted");
                }
            }
        }

    }, 100); // Check every 100ms
};

// Common processing logic for both STT methods
const processInputText = async (text) => {
    let userText = text;

    // ✅ APLICAR SUSTITUCIONES (user request)
    userText = applyTextSubstitutions(userText); // ex: "groc" -> "grok"

    // Debug raw input for user
    log(`🔍 Check: "${userText}"`, "muted");

    // ✅ WAKE WORD CHECK
    if (isProMode) {
        const hasWakeWord = checkWakeWord(userText, selectedModel);
        if (!hasWakeWord) {
            // ✅ Add to Overheard Buffer
            log(`<span class="muted">Overheard:</span> ${escapeHtml(userText)}`, "muted");
            overheardBuffer.push(userText);

            // Reset Expiration Timer (10 seconds)
            if (overheardTimer) clearTimeout(overheardTimer);
            overheardTimer = setTimeout(() => {
                if (overheardBuffer.length > 0) {
                    overheardBuffer = [];
                    log("Context interaction expired (10s)", "muted");
                }
            }, 10000);

            // If we are in Whisper mode, we need to reset state explicitly
            if (isAndroid()) {
                statusEl.textContent = "👂 Listening...";
                setOrbState("listening");
            }
            return; // Skip LLM processing
        }
    }

    log(`<span class="muted">You:</span> ${escapeHtml(userText)}`);

    // Process with LLM
    await processWithLLM(userText);
};

const processWithLLM = async (userText, options = {}) => {
    setStatus("Thinking...", "warn");
    setOrbState("idle");
    isSpeaking = true;

    // Capture current interaction ID
    const myInteractionId = ++interactionCounter;

    try {
        // Check for overheard context
        if (overheardBuffer.length > 0) {
            const contextMsg = overheardBuffer.join(" ");
            userText = `[Contexto escuchado previamente: "${contextMsg}"]\n\n${userText}`;
            overheardBuffer = []; // Clear buffer after using
            if (overheardTimer) clearTimeout(overheardTimer); // Stop expiration timer
            log("Attached overheard context to request", "muted");
        }

        // Add user message to history
        conversationHistory.push({ role: "user", content: userText });

        // Keep only last 10 messages for context
        if (conversationHistory.length > 20) {
            conversationHistory = conversationHistory.slice(-20);
        }

        // Log user message unless hidden (used for initial context injection)
        if (!options.hidden) {
            // Already logged by processInputText if it came from there,
            // but if called directly we might want to ensure it's logged?
            // Actually processInputText logs it as "You: ...".
            // processWithLLM typically doesn't log the user part again.
        } else {
            log(`<i>Injecting initial context...</i>`, "muted");
        }

        let response;

        if (selectedModel === "gemini-pro") {
            response = await callGeminiAPI(userText);
        } else if (selectedModel === "grok-pro") {
            response = await callGrokAPI();
        } else {
            response = await callOpenAIAPI();
        }

        // Check if we were interrupted while thinking
        if (myInteractionId !== interactionCounter) {
            log("🚫 Response discarded (interrupted)", "muted");
            return;
        }

        if (response) {
            // Add assistant response to history
            conversationHistory.push({ role: "assistant", content: response });

            log(`<span class="ok">AI:</span> ${escapeHtml(response)}`);

            // Speak the response
            if (isProMode) {
                // await speakOpenAITTS(response);
                await speakElevenLabs(response);
            } else {
                await speakText(response);
            }
        }

    } catch (e) {
        // If interrupted, we might not care about errors
        if (myInteractionId !== interactionCounter) return;

        console.error("LLM Error:", e);
        log(`<span class="err">LLM Error:</span> ${e.message}`, "err");
    } finally {
        // Only reset if we are still the active interaction
        if (myInteractionId === interactionCounter) {
            isSpeaking = false;
            setStatus("Live", "ok");
            setOrbState("listening");
        }
    }
};

const speakElevenLabs = async (text) => {
    if (!elevenLabsApiKey) throw new Error("No ElevenLabs key available");

    setOrbState("speaking");
    const voiceId = ELEVENLABS_VOICES[selectedModel] || "OjrdP8Z2fWjVyt0scrL7"; // Default to George if mismatch
    const model_id = "eleven_turbo_v2_5"; // or eleven_multilingual_v2

    try {
        // Request PCM 24000Hz to match our AudioContext standard
        const url = `${ELEVENLABS_TTS_URL}/${voiceId}/stream?output_format=pcm_24000&optimize_streaming_latency=2`;

        const r = await fetch(url, {
            method: "POST",
            headers: {
                "xi-api-key": elevenLabsApiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                text: text,
                model_id: model_id,
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            })
        });

        if (!r.ok) {
            const err = await r.text();
            throw new Error(`ElevenLabs Error: ${r.status} - ${err}`);
        }

        // Setup streaming (Reuse identical logic to OpenAI pipeline since we asked for PCM 24000)
        const reader = r.body.getReader();
        const sampleRate = 24000;

        // Ensure AudioContext is ready
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        nextStartTime = audioCtx.currentTime + 0.1;

        let leftover = new Uint8Array(0);

        return new Promise((resolve, reject) => {
            let activeSources = 0;
            let streamFinished = false;

            const processChunk = async ({ done, value }) => {
                if (!isSpeaking) {
                    reader.cancel().catch(() => { });
                    resolve();
                    return;
                }

                if (done) {
                    streamFinished = true;
                    if (activeSources === 0) {
                        setOrbState("listening");
                        resolve();
                    }
                    return;
                }

                const totalLength = leftover.length + value.length;
                const combined = new Uint8Array(totalLength);
                combined.set(leftover);
                combined.set(value, leftover.length);

                const sampleCount = Math.floor(totalLength / 2);
                const bytesToProcess = sampleCount * 2;
                leftover = combined.slice(bytesToProcess);

                if (sampleCount === 0) {
                    reader.read().then(processChunk).catch(e => {
                        console.error("Stream read error:", e);
                        resolve();
                    });
                    return;
                }

                // Convert Little-Endian PCM -> Float32
                const dataBytes = combined.slice(0, bytesToProcess);
                const int16 = new Int16Array(dataBytes.buffer);
                const float32 = new Float32Array(sampleCount);
                int16ToFloat32(int16, float32);

                const audioBuffer = audioCtx.createBuffer(1, sampleCount, sampleRate);
                audioBuffer.copyToChannel(float32, 0);

                const source = audioCtx.createBufferSource();
                source.buffer = audioBuffer;

                if (nextStartTime < audioCtx.currentTime) {
                    nextStartTime = audioCtx.currentTime;
                }
                source.start(nextStartTime);
                nextStartTime += audioBuffer.duration;

                audioSources.push(source);
                currentAudioSource = source;
                activeSources++;

                if (remoteAnalyser) source.connect(remoteAnalyser);
                source.connect(audioCtx.destination);

                source.onended = () => {
                    activeSources--;
                    const idx = audioSources.indexOf(source);
                    if (idx > -1) audioSources.splice(idx, 1);

                    if (streamFinished && activeSources === 0) {
                        setOrbState("listening");
                        resolve();
                    }
                };

                reader.read().then(processChunk).catch(e => {
                    console.error("Stream read error:", e);
                    resolve();
                });
            };

            reader.read().then(processChunk).catch(e => {
                console.error("Stream start error:", e);
                resolve();
            });
        });

    } catch (e) {
        console.error("ElevenLabs TTS Error:", e);
        log(`<span class="err">TTS Error:</span> ${e.message}`, "err");
        setOrbState("listening");
    }
};

const speakOpenAITTS = async (text) => {
    if (!ttsApiKey) throw new Error("No OpenAI TTS key available");

    setOrbState("speaking");
    const voice = PRO_VOICES[selectedModel] || "alloy";

    try {
        const r = await fetch(OPENAI_TTS_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${ttsApiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "tts-1",
                input: text,
                voice: voice,
                response_format: "pcm" // Request Raw PCM for streaming
            })
        });

        if (!r.ok) {
            const err = await r.text();
            throw new Error(`TTS Error: ${r.status} - ${err}`);
        }

        // Setup streaming
        const reader = r.body.getReader();
        const sampleRate = 24000; // tts-1 is 24kHz
        nextStartTime = audioCtx.currentTime + 0.1; // Small buffer

        let leftover = new Uint8Array(0);

        return new Promise((resolve, reject) => {
            let activeSources = 0;
            let streamFinished = false;

            const processChunk = async ({ done, value }) => {
                if (!isSpeaking) {
                    reader.cancel().catch(() => { });
                    resolve();
                    return;
                }

                if (done) {
                    streamFinished = true;
                    if (activeSources === 0) {
                        setOrbState("listening"); // Done speaking
                        resolve();
                    }
                    return;
                }

                // Combine leftover + new bits
                const totalLength = leftover.length + value.length;
                const combined = new Uint8Array(totalLength);
                combined.set(leftover);
                combined.set(value, leftover.length);

                // We need even number of bytes for 16-bit PCM
                const sampleCount = Math.floor(totalLength / 2);
                const bytesToProcess = sampleCount * 2;
                leftover = combined.slice(bytesToProcess);

                if (sampleCount === 0) {
                    // Not enough data yet
                    reader.read().then(processChunk).catch(e => {
                        console.error("Stream read error:", e);
                        resolve(); // Resolve anyway to unblock
                    });
                    return;
                }

                // Convert bytes -> Int16 -> Float32
                const dataBytes = combined.slice(0, bytesToProcess);
                const int16 = new Int16Array(dataBytes.buffer);
                const float32 = new Float32Array(sampleCount);
                int16ToFloat32(int16, float32);

                // Create AudioBuffer
                const audioBuffer = audioCtx.createBuffer(1, sampleCount, sampleRate);
                audioBuffer.copyToChannel(float32, 0);

                // Play
                const source = audioCtx.createBufferSource();
                source.buffer = audioBuffer;

                // Simple gapless scheduling
                if (nextStartTime < audioCtx.currentTime) {
                    nextStartTime = audioCtx.currentTime;
                }
                source.start(nextStartTime);
                nextStartTime += audioBuffer.duration;

                // Track source
                audioSources.push(source);
                currentAudioSource = source; // For visualizer
                activeSources++;

                if (remoteAnalyser) source.connect(remoteAnalyser);
                source.connect(audioCtx.destination);

                source.onended = () => {
                    activeSources--;
                    const idx = audioSources.indexOf(source);
                    if (idx > -1) audioSources.splice(idx, 1);

                    if (streamFinished && activeSources === 0) {
                        setOrbState("listening");
                        resolve();
                    }
                };

                // Read next chunk
                reader.read().then(processChunk).catch(e => {
                    console.error("Stream read error:", e);
                    resolve();
                });
            };

            // Start reading
            reader.read().then(processChunk).catch(e => {
                console.error("Stream start error:", e);
                resolve();
            });
        });

    } catch (e) {
        console.error("OpenAI TTS Stream Error:", e);
        log(`<span class="err">TTS Error:</span> ${e.message}`, "err");
        setOrbState("listening");
    }
};

const callOpenAIAPI = async () => {
    const messages = [
        { role: "system", content: "You are a helpful and friendly AI assistant. Respond naturally and conversationally. Keep responses concise but informative. Respond in the same language the user speaks." },
        ...conversationHistory
    ];

    const r = await fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${currentApiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: REST_MODELS["chatgpt-pro"],
            messages: messages,
            temperature: 0.7
        })
    });

    if (!r.ok) {
        const error = await r.text();
        throw new Error(`OpenAI API Error: ${r.status} - ${error}`);
    }

    const data = await r.json();
    return data.choices[0]?.message?.content || "";
};

const callGrokAPI = async () => {
    const messages = [
        { role: "system", content: "You are a helpful and friendly AI assistant. Respond naturally and conversationally. Keep responses concise but informative. Respond in the same language the user speaks." },
        ...conversationHistory
    ];

    const r = await fetch(GROK_CHAT_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${currentApiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: REST_MODELS["grok-pro"],
            messages: messages,
            max_tokens: 20000,
            temperature: 0.7
        })
    });

    if (!r.ok) {
        const error = await r.text();
        throw new Error(`Grok API Error: ${r.status} - ${error}`);
    }

    const data = await r.json();
    return data.choices[0]?.message?.content || "";
};

const callGeminiAPI = async (userText) => {
    // Gemini uses a different format
    const contents = conversationHistory.map(msg => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }]
    }));

    const url = `${GEMINI_CHAT_URL}/${REST_MODELS["gemini-pro"]}:generateContent?key=${currentApiKey}`;

    const r = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            contents: contents,
            systemInstruction: {
                parts: [{ text: "You are a helpful and friendly AI assistant. Respond naturally and conversationally. Keep responses concise but informative. Respond in the same language the user speaks." }]
            },
            generationConfig: {
                maxOutputTokens: 20000,
                temperature: 0.7
            }
        })
    });

    if (!r.ok) {
        const error = await r.text();
        throw new Error(`Gemini API Error: ${r.status} - ${error}`);
    }

    const data = await r.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
};

const speakText = (text) => {
    return new Promise((resolve) => {
        // Use Web Speech API for TTS
        const utterance = new SpeechSynthesisUtterance(text);

        // Try to detect language from text
        const hasSpanish = /[áéíóúñ¿¡]/i.test(text) || /\b(el|la|los|las|de|que|en|es|un|una|por|con|para|como|pero|más|este|esta|todo|también|muy|puede|tiene|hace|ser|hay|cuando|donde|quien|cual|porque|aunque|mientras|siempre|nunca|nada|algo|alguien|nadie|cada|otro|otra|mismo|misma|ya|ahora|aquí|allí|así|bien|mal|mucho|poco|tanto|cuanto|qué|cómo|cuándo|dónde|quién|cuál|hola|gracias|buenos|buenas|días|tardes|noches)\b/i.test(text);

        if (hasSpanish) {
            utterance.lang = 'es-ES';
        } else {
            utterance.lang = 'en-US';
        }

        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        utterance.onstart = () => {
            setOrbState("speaking");
        };

        utterance.onend = () => {
            setOrbState("listening");
            resolve();
        };

        utterance.onerror = (e) => {
            console.error("TTS Error:", e);
            setOrbState("listening");
            resolve();
        };

        speechSynthesis.speak(utterance);
    });
};

// ============================================
// ORIGINAL REALTIME MODE (unchanged)
// ============================================

// --- Mode 1: WebRTC (ChatGPT) ---
const connectWebRTC = async (key, stream) => {
    pc = new RTCPeerConnection();

    pc.addTrack(stream.getTracks()[0], stream);

    pc.ontrack = (e) => {
        remoteAudio.srcObject = e.streams[0];
        const src = audioCtx.createMediaStreamSource(e.streams[0]);
        remoteAnalyser = audioCtx.createAnalyser();
        remoteData = new Uint8Array(remoteAnalyser.frequencyBinCount);
        src.connect(remoteAnalyser);
    };

    dc = pc.createDataChannel("oai-events");
    dc.onmessage = (e) => handleServerEvent(JSON.parse(e.data));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const r = await fetch(OPENAI_WEBRTC_URL + "?model=gpt-4o-realtime-preview-2024-12-17&voice=ash", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${key}`,
            "Content-Type": "application/sdp"
        },
        body: offer.sdp
    });

    if (!r.ok) {
        throw new Error(`OpenAI SDP Error ${r.status}: ${await r.text()}`);
    }

    const answerSdp = await r.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
};

// --- Mode 2: WebSocket (Grok/Gemini) ---
const connectSocket = async (key, micSource) => {
    let url = selectedModel === "grok" ? GROK_WS_URL : GEMINI_WS_URL;

    if (selectedModel === "gemini") {
        url += `?key=${key}`;
    }

    const protocols = selectedModel === "grok"
        ? ["realtime", `openai-insecure-api-key.${key}`]
        : [];

    try {
        ws = new WebSocket(url, protocols.length > 0 ? protocols : undefined);
    } catch (e) {
        console.warn("Subprotocol auth failed, falling back to URL only");
        if (selectedModel === "grok") {
            url = GROK_WS_URL + `?api_key=${key}`;
        }
        ws = new WebSocket(url);
    }

    log(`Key prefix: ${key.slice(0, 8)}...`);

    ws.onopen = () => {
        log("WebSocket Open", "ok");

        if (selectedModel === "grok") {
            const sessionConfig = {
                type: "session.update",
                session: {
                    voice: "Leo",
                    instructions: "You are a helpful and friendly AI assistant. Respond naturally and conversationally in the same language the user speaks.",
                    turn_detection: {
                        type: "server_vad"
                    },
                    audio: {
                        input: {
                            format: {
                                type: "audio/pcm",
                                rate: 24000
                            }
                        },
                        output: {
                            format: {
                                type: "audio/pcm",
                                rate: 24000
                            }
                        }
                    }
                }
            };
            console.log("Sending Grok session config:", JSON.stringify(sessionConfig, null, 2));
            ws.send(JSON.stringify(sessionConfig));

        } else if (selectedModel === "gemini") {
            const setupMessage = {
                setup: {
                    model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
                    generationConfig: {
                        responseModalities: ["AUDIO"],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: "Charon"
                                }
                            }
                        }
                    },
                    systemInstruction: {
                        parts: [{ text: "You are a helpful and friendly AI assistant. Respond naturally and conversationally in the same language the user speaks." }]
                    }
                }
            };
            console.log("Sending Gemini setup:", JSON.stringify(setupMessage, null, 2));
            ws.send(JSON.stringify(setupMessage));
        }
    };

    ws.onmessage = async (event) => {
        let msg;
        try {
            if (event.data instanceof Blob) {
                const text = await event.data.text();
                msg = JSON.parse(text);
            } else {
                msg = JSON.parse(event.data);
            }
        } catch (e) {
            console.error("WS: Failed to parse message", e, event.data);
            return;
        }

        const msgType = msg.type || (msg.setupComplete ? "setupComplete" : (msg.serverContent ? "serverContent" : "unknown"));
        console.log("WS MSG:", msgType, msg);
        handleServerEvent(msg);

        if (msg.setupComplete) {
            geminiSetupComplete = true;
            log("Gemini setup complete ✅", "ok");
        }

        if (msg.type === "session.updated") {
            grokSessionReady = true;
            log("Grok session ready ✅", "ok");
        }

        if (msg.type === "response.output_audio.delta" && msg.delta) {
            console.log("Grok audio delta received, length:", msg.delta.length);
            queueAudioForPlayback(msg.delta, 24000);
        }

        if (msg.serverContent?.modelTurn?.parts) {
            msg.serverContent.modelTurn.parts.forEach(p => {
                if (p.inlineData && p.inlineData.data) {
                    const mimeType = p.inlineData.mimeType || "";
                    console.log("Gemini Audio Received! mimeType:", mimeType, "length:", p.inlineData.data.length);
                    queueAudioForPlayback(p.inlineData.data, 24000);
                }
            });
        }

        if (msg.serverContent?.turnComplete) {
            console.log("Gemini turn complete");
        }

        if (msg.type === "response.done" || msg.type === "response.output_audio.done") {
            console.log("Response audio complete");
        }
    };

    ws.onerror = (e) => {
        console.error("WS Error:", e);
        log(`<span class="err">WebSocket Error</span>`, "err");
    };

    ws.onclose = (e) => {
        console.log("WS Closed:", e.code, e.reason);
        log(`WebSocket Closed: ${e.code} ${e.reason || ""}`, "muted");

        if (e.code === 1006) {
            log("Connection closed abnormally (1006) - check auth, model name, or network", "err");
        } else if (e.code === 1008) {
            log("Policy violation (1008) - check API key permissions", "err");
        } else if (e.code === 1011) {
            log("Server error (1011) - internal server error", "err");
        }
    };

    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    micSource.connect(processor);
    processor.connect(audioCtx.destination);

    let sendCount = 0;
    const actualSampleRate = audioCtx.sampleRate;

    processor.onaudioprocess = (e) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return;
        }

        if (selectedModel === "gemini" && !geminiSetupComplete) {
            return;
        }

        if (selectedModel === "grok" && !grokSessionReady) {
            return;
        }

        let inputData = e.inputBuffer.getChannelData(0);

        const targetRate = selectedModel === "gemini" ? 16000 : 24000;
        if (actualSampleRate !== targetRate) {
            inputData = resampleAudio(inputData, actualSampleRate, targetRate);
        }

        const pcm16 = floatTo16BitPCM(inputData);
        const base64Audio = arrayBufferToBase64(pcm16.buffer);

        sendCount++;
        if (sendCount <= 3 || sendCount % 100 === 0) {
            console.log(`Sending audio chunk #${sendCount}, size=${base64Audio.length}, model=${selectedModel}`);
        }

        if (selectedModel === "gemini") {
            ws.send(JSON.stringify({
                realtimeInput: {
                    audio: {
                        data: base64Audio,
                        mimeType: "audio/pcm;rate=16000"
                    }
                }
            }));
        } else if (selectedModel === "grok") {
            ws.send(JSON.stringify({
                type: "input_audio_buffer.append",
                audio: base64Audio
            }));
        }
    };
};

const queueAudioForPlayback = (base64, sampleRate = 24000) => {
    try {
        const binary = window.atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;

        schedulePlayback(float32, sampleRate);

    } catch (e) {
        console.error("Error queueing audio:", e);
    }
};

const schedulePlayback = (float32, sampleRate) => {
    // If not connected or audio context closed, do nothing
    if (!audioCtx || audioCtx.state === 'closed') return;

    // Ensure accurate timing
    const currentTime = audioCtx.currentTime;

    // If next start time is behind current time (or reset), start slightly in future
    // This handles the first chunk or if we had a network delay buffer underrun
    if (nextStartTime < currentTime) {
        nextStartTime = currentTime + 0.05; // 50ms buffer to prevent immediate underrun
    }

    const buffer = audioCtx.createBuffer(1, float32.length, sampleRate);
    buffer.getChannelData(0).set(float32);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);

    // Also connect to visualizer
    if (!remoteAnalyser) {
        remoteAnalyser = audioCtx.createAnalyser();
        remoteData = new Uint8Array(remoteAnalyser.frequencyBinCount);
    }
    source.connect(remoteAnalyser);

    source.start(nextStartTime);

    // Update visual state based on playback
    setOrbState("speaking");

    // Calculate duration
    const duration = buffer.duration;
    nextStartTime += duration;

    // When this specific source ends, we might want to check if more audio is coming
    // but for visual state, we can use a timeout since we know exactly when it ends
    // Note: We don't rely on onended for the NEXT chunk, only for UI state
    source.onended = () => {
        // Only set to listening if we've reached the end of the scheduled audio
        if (Math.abs(audioCtx.currentTime - nextStartTime) < 0.1) {
            setOrbState("listening");
        }
    };
};

const handleServerEvent = (data) => {
    try {
        switch (data.type) {
            case "session.created":
                log("Session created", "ok");
                break;
            case "session.updated":
                log("Session configured ✅", "ok");
                break;
            case "conversation.created":
                log("Conversation started", "muted");
                break;
            case "input_audio_buffer.speech_started":
                log("🎤 Speech detected", "muted");
                setOrbState("listening");
                // Clear any pending scheduled audio if we interrupt? 
                // For now, simpler to just let it play out or we'd need to track all sources.
                // Resetting schedule time ensures new audio follows current time.
                if (audioCtx) nextStartTime = audioCtx.currentTime;
                break;
            case "input_audio_buffer.speech_stopped":
                log("🎤 Speech ended", "muted");
                break;
            case "input_audio_buffer.committed":
                log("Audio committed", "muted");
                break;
            case "response.created":
                log("AI is thinking...", "muted");
                break;
            case "response.output_audio_transcript.delta":
                break;
            case "response.output_audio_transcript.done":
                if (data.transcript) {
                    log(`<span class="ok">AI:</span> ${escapeHtml(data.transcript)}`);
                }
                break;
            case "response.done":
                log("Response complete", "muted");
                break;
            case "error":
                log(`<span class="err">Error:</span> ${data.error?.message || JSON.stringify(data)}`, "err");
                break;
            default:
                if (data.serverContent?.inputTranscription?.text) {
                    log(`<span class="muted">You:</span> ${escapeHtml(data.serverContent.inputTranscription.text)}`);
                }
                if (data.serverContent?.outputTranscription?.text) {
                    log(`<span class="ok">AI:</span> ${escapeHtml(data.serverContent.outputTranscription.text)}`);
                }
        }
    } catch (e) {
        console.error("Error handling server event:", e);
    }
};

const cleanup = async () => {
    stopMeters();
    stopAudioPlayback(); // Ensure all audio sources are stopped

    // Cleanup Pro mode
    if (recognition) {
        try {
            recognition.stop();
        } catch (e) { }
        recognition = null;
    }
    isProMode = false;
    isSpeaking = false;
    speechSynthesis.cancel();

    // Cleanup realtime mode
    if (pc) pc.close();
    if (ws) ws.close();
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    if (processor) processor.disconnect();

    // Properly close AudioContext to release hardware
    if (audioCtx) {
        try {
            await audioCtx.close();
        } catch (e) { console.warn("Error closing AudioContext:", e); }
    }

    ws = null; pc = null; micStream = null; audioCtx = null;
    micAnalyser = null; micData = null;
    remoteAnalyser = null; remoteData = null;
    processor = null;
    geminiSetupComplete = false;
    grokSessionReady = false;
    nextStartTime = 0;
    conversationHistory = [];
    currentApiKey = null;

    setOrbState("idle");
    updateMuteIcon(false);
    setStatus("Disconnected", "warn");
    btnStart.disabled = false;
    btnStop.disabled = true;
    $("btnForceReply").style.display = "none";
    hintEl.innerHTML = `Pulsa <b>Start</b>, habla normal, y deja de hablar para que responda.`;
};

// Listeners


// --- Simple Mode Controls ---
btnSettings.addEventListener("click", () => {
    $("main-interface").classList.remove("simple-mode");
});

btnBackToSimple.addEventListener("click", () => {
    $("main-interface").classList.add("simple-mode");
});

function updateMuteIcon(isMuted) {
    const onIcon = btnMute.querySelector(".mic-on");
    const offIcon = btnMute.querySelector(".mic-off");
    if (isMuted) {
        onIcon.classList.add("hidden");
        offIcon.classList.remove("hidden");
        btnMute.classList.add("danger-soft");
    } else {
        onIcon.classList.remove("hidden");
        offIcon.classList.add("hidden");
        btnMute.classList.remove("danger-soft");
    }
}

btnMute.addEventListener("click", () => {
    if (micStream) {
        const track = micStream.getAudioTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            updateMuteIcon(!track.enabled);
        }
    }
});

btnClose.addEventListener("click", async () => {
    // Full Environment Reset (Restart)
    // The user requested that clicking 'X' acts exactly like clicking the conversation button again:
    // 1. Cleans up previous state
    // 2. Re-initializes UI (colors, labels)
    // 3. Triggers connect() which handles mic auth, keys, etc.

    await cleanup(); // Wait for audio context to fully close

    // Safety Delay: Give browser time to fully release hardware (prevents permission loops)
    await new Promise(r => setTimeout(r, 500));

    // Re-apply UI state for the selected model
    const mainInterface = $("main-interface");
    mainInterface.classList.remove("hidden");
    $("selection-screen").classList.add("hidden");

    // Re-apply visual styling
    const baseModel = selectedModel.replace("-pro", "");
    orbEl.classList.remove("grok", "gemini", "chatgpt");
    orbEl.classList.add(baseModel);

    // Update Label & Hint
    const label = $("model-label");
    if (label) label.textContent = `Voice UI (${selectedModel})`;

    if (isProModel(selectedModel)) {
        hintEl.innerHTML = `<b>Pro Mode:</b> Habla y espera ~1.5s de silencio. El AI responderá con TTS.`;
    }

    // Restart Connection
    connect();
});

btnStart.addEventListener("click", connect);
btnStop.addEventListener("click", async () => { await cleanup(); });

$("btnForceReply").addEventListener("click", () => {
    if (ws && ws.readyState === WebSocket.OPEN && selectedModel === "grok") {
        log("Forcing reply (commit + create)...", "warn");
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        setTimeout(() => {
            ws.send(JSON.stringify({
                type: "response.create",
                response: {
                    modalities: ["text", "audio"]
                }
            }));
        }, 100);
    }
});

btnFullscreen.addEventListener("click", () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(console.error);
    } else {
        document.exitFullscreen();
    }
});



// Selection Screen Fullscreen Button
$("btnFullscreenSelection").addEventListener("click", () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(console.error);
    } else {
        document.exitFullscreen();
    }
});

// Simple Mode Fullscreen Button
$("btnFullscreenSimple").addEventListener("click", () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(console.error);
    } else {
        document.exitFullscreen();
    }
});


// ============================================
// MULTI-CHAT MODE (Talk to All)
// ============================================

const MULTI_MODELS = [
    { id: "chatgpt", name: "ChatGPT (4o)", type: "openai", modelId: "gpt-4o" },
    { id: "grok", name: "Grok (3)", type: "grok", modelId: "grok-3" },
    { id: "gemini", name: "Gemini (2.0 Flash)", type: "gemini", modelId: "gemini-2.0-flash" },
    { id: "chatgpt-pro", name: "ChatGPT (5.2)", type: "openai", modelId: "gpt-5.2" },
    { id: "grok-pro", name: "Grok (Thinking)", type: "grok", modelId: "grok-4-1-fast-reasoning" },
    { id: "gemini-pro", name: "Gemini (3 Pro)", type: "gemini", modelId: "gemini-3-pro-preview" }
];

let multiChatState = {};
let multiApiKeys = { openai: null, grok: null, gemini: null };

const initMultiChat = async () => {
    $("selection-screen").classList.add("hidden");
    const mainInterface = $("main-interface");
    mainInterface.classList.add("hidden");
    mainInterface.classList.remove("simple-mode"); // Fix for z-index conflict

    const multiInterface = $("multi-chat-interface");
    multiInterface.classList.remove("hidden");

    const grid = $("chatGrid");
    grid.innerHTML = ""; // Clear existing

    // Initialize state and UI
    MULTI_MODELS.forEach(m => {
        // Init state
        if (!multiChatState[m.id]) {
            multiChatState[m.id] = { history: [], status: 'idle' };
        }

        // Create UI Pane
        const pane = document.createElement("div");
        pane.className = "chat-pane";
        pane.innerHTML = `
            <div class="chat-header">
                <span>${m.name}</span>
                <div id="status-${m.id}" class="chat-status done"></div>
            </div>
            <div id="log-${m.id}" class="chat-log"></div>
        `;
        grid.appendChild(pane);

        // Restore logs if any
        renderMultiLog(m.id);
    });

    // Fetch Keys if needed
    try {
        if (!multiApiKeys.openai) multiApiKeys.openai = await fetchEphemeralKey("chatgpt");
        // Reuse keys where possible or fetch others if n8n logic requires distinctive calls
        // Based on fetchEphemeralKey, it uses logic: chatgpt-pro -> chatgpt. 
        // We need keys for "grok" and "gemini" too.
        if (!multiApiKeys.grok) multiApiKeys.grok = await fetchEphemeralKey("grok");
        if (!multiApiKeys.gemini) multiApiKeys.gemini = await fetchEphemeralKey("gemini");
    } catch (e) {
        console.error("Error fetching keys for multi-chat:", e);
        alert("Error fetching API keys: " + e.message);
    }
};

const renderMultiLog = (modelId) => {
    const logContainer = $(`log-${modelId}`);
    if (!logContainer) return;
    logContainer.innerHTML = "";
    multiChatState[modelId].history.forEach(msg => {
        const div = document.createElement("div");
        div.className = `msg ${msg.role === 'user' ? 'user' : 'ai'}`;
        div.innerText = msg.content;
        logContainer.appendChild(div);
    });
    logContainer.scrollTop = logContainer.scrollHeight;
};

const exitMultiChat = () => {
    $("multi-chat-interface").classList.add("hidden");
    $("selection-screen").classList.remove("hidden");
};

const broadcastMessage = async () => {
    const input = $("multiInput");
    const text = input.value.trim();
    if (!text) return;

    input.value = "";

    // 1. Update UI for all and trigger processing
    await Promise.all(MULTI_MODELS.map(async (m) => {
        // Add to history
        multiChatState[m.id].history.push({ role: "user", content: text });
        renderMultiLog(m.id);

        // Set status thinking
        const statusEl = $(`status-${m.id}`);
        if (statusEl) {
            statusEl.className = "chat-status thinking";
        }

        // Process request
        try {
            const response = await callMultiRestAPI(m, multiChatState[m.id].history);

            multiChatState[m.id].history.push({ role: "assistant", content: response });
            renderMultiLog(m.id);
        } catch (e) {
            console.error(`Error ${m.id}:`, e);
            multiChatState[m.id].history.push({ role: "assistant", content: "Error: " + e.message });
            renderMultiLog(m.id);
        } finally {
            if (statusEl) {
                statusEl.className = "chat-status done";
            }
        }
    }));
};

const callMultiRestAPI = async (modelConfig, history) => {
    // Determine Key
    let key = null;
    if (modelConfig.type === "openai") key = multiApiKeys.openai;
    if (modelConfig.type === "grok") key = multiApiKeys.grok;
    if (modelConfig.type === "gemini") key = multiApiKeys.gemini;

    if (!key) throw new Error("Missing API Key");

    const sysMsg = { role: "system", content: "You are a helpful AI assistant. Be concise." };
    const messages = [sysMsg, ...history];

    if (modelConfig.type === "openai") {
        const r = await fetch(OPENAI_CHAT_URL, {
            method: "POST",
            headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: modelConfig.modelId, messages: messages })
        });

        if (!r.ok) {
            const err = await r.text();
            throw new Error(`OpenAI Error ${r.status}: ${err}`);
        }

        const data = await r.json();
        return data.choices?.[0]?.message?.content || "No response";
    }

    if (modelConfig.type === "grok") {
        const r = await fetch(GROK_CHAT_URL, {
            method: "POST",
            headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: modelConfig.modelId, messages: messages, max_tokens: 20000 })
        });

        if (!r.ok) {
            const err = await r.text();
            throw new Error(`Grok Error ${r.status}: ${err}`);
        }

        const data = await r.json();
        return data.choices?.[0]?.message?.content || "No response";
    }

    if (modelConfig.type === "gemini") {
        const contents = history.map(msg => ({
            role: msg.role === "assistant" ? "model" : "user",
            parts: [{ text: msg.content }]
        }));

        // Use standard v1beta for REST text generation with gemini-2.0-flash
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelConfig.modelId}:generateContent?key=${key}`;

        const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: contents })
        });

        if (!r.ok) {
            const err = await r.text();
            throw new Error(`Gemini Error ${r.status}: ${err}`);
        }

        const data = await r.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
    }

    return "Unknown model type";
};

// Listeners for Multi Chat
$("btnMultiSend").addEventListener("click", broadcastMessage);
$("multiInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") broadcastMessage();
});
$("btnExitMulti").addEventListener("click", exitMultiChat);

// Listeners
$("selection-screen").addEventListener("click", (e) => {
    const btn = e.target.closest(".model-btn");
    if (btn) {
        selectedModel = btn.dataset.model;

        // NEW: Check for "Talk to All"
        if (selectedModel === "all") {
            initMultiChat();
            return;
        }

        // Apply Personality Colors
        const baseModel = selectedModel.replace("-pro", ""); // grok, gemini, chatgpt
        orbEl.classList.remove("grok", "gemini", "chatgpt");
        orbEl.classList.add(baseModel);

        // Update Avatar Image for Grok
        if (avatarImg) {
            if (baseModel === "grok") {
                avatarImg.src = "elon_musk_blanco.png";
            } else if (baseModel === "gemini") {
                avatarImg.src = "google.jpeg";
            } else {
                avatarImg.src = "avatar.png";
            }
        }

        $("selection-screen").classList.add("hidden");
        const mainInterface = $("main-interface");
        mainInterface.classList.remove("hidden");

        // Default to Simple Mode
        mainInterface.classList.add("simple-mode");

        const label = $("model-label");
        if (label) label.textContent = `Voice UI (${selectedModel})`;

        // Update hint for pro mode
        if (isProModel(selectedModel)) {
            hintEl.innerHTML = `<b>Pro Mode:</b> Habla y espera ~1.5s de silencio. El AI responderá con TTS.`;
        }

        // Auto-connect on selection
        connect();
    }
});

// VAD Slider Listener
$("vadThreshold").addEventListener("input", (e) => {
    vadThreshold = parseFloat(e.target.value);
    $("vadValue").textContent = vadThreshold.toFixed(3);
});

