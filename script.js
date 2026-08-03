/* =========================================================================
   VERITY — Futuristic Bilingual AI Assistant
   Powered by the FREE Groq API (https://console.groq.com)
   Pure HTML / CSS / JS — no frameworks, no backend.
   ========================================================================= */

/* ============================ CONFIGURATION ============================ */
/* 🔑 PASTE YOUR FREE GROQ API KEY BELOW (or use the in-app Settings modal) */
const CONFIG = {
  GROQ_API_KEY: "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", // <-- Replace this with your key (starts with gsk_...)
  GROQ_API_URL: "https://api.groq.com/openai/v1/chat/completions",
  DEFAULT_MODEL: "llama-3.3-70b-versatile",
  MAX_HISTORY_MESSAGES: 24,      // how many past turns to keep for memory/context
  TEMPERATURE: 0.75,
  MAX_TOKENS: 1024,
  SYSTEM_PROMPT_EN:
    "You are Verity, a warm, sharp, futuristic AI assistant. Reply in clear, concise, well-formatted English unless the user writes in Arabic. Be helpful, friendly, and a little witty. Keep answers focused.",
  SYSTEM_PROMPT_AR:
    "أنت فيريتي، مساعد ذكاء اصطناعي مستقبلي ودود وذكي. أجب باللغة العربية الفصحى الواضحة والموجزة، ما لم يكتب المستخدم بالإنجليزية. كن مفيدًا وودودًا ومختصرًا في إجاباتك."
};

/* ============================ STATE ============================ */
const state = {
  history: [],            // [{role, content, lang, time}]
  isStreaming: false,
  isListening: false,
  ttsEnabled: true,
  voicesReady: false,
  voices: [],
  currentModel: CONFIG.DEFAULT_MODEL,
  recognition: null,
  audioCtx: null,
  voiceLangMode: "auto",   // "auto" | "ar" | "en"  -> controls speech RECOGNITION language
  arabicVoiceWarned: false,
  ttsKeepAliveTimer: null,
};

/* ============================ DOM REFS ============================ */
const $ = (id) => document.getElementById(id);

const chatWindow = $("chatWindow");
const userInput = $("userInput");
const inputForm = $("inputForm");
const sendBtn = $("sendBtn");
const micBtn = $("micBtn");
const voiceLangBtn = $("voiceLangBtn");
const voiceLangBadge = $("voiceLangBadge");
const typingIndicator = $("typingIndicator");
const clearBtn = $("clearBtn");
const downloadBtn = $("downloadBtn");
const ttsToggleBtn = $("ttsToggleBtn");
const langToggleBtn = $("langToggleBtn");
const modelSelect = $("modelSelect");
const settingsBtn = $("settingsBtn");
const settingsModal = $("settingsModal");
const closeSettings = $("closeSettings");
const apiKeyInput = $("apiKeyInput");
const saveApiKeyBtn = $("saveApiKeyBtn");
const removeApiKeyBtn = $("removeApiKeyBtn");
const toast = $("toast");
const avatarCore = $("avatarCore");
const avatarWave = $("avatarWave");
const statusDot = $("statusDot");
const statusText = $("statusText");
const avatarHint = $("avatarHint");
const ringEls = document.querySelectorAll(".avatar-ring");

/* ============================ UTILITIES ============================ */

function detectLanguage(text) {
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F]/;
  return arabicPattern.test(text) ? "ar" : "en";
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function showToast(message, icon = "fa-circle-check") {
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> ${message}`;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2200);
}

function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* Minimal markdown-ish formatting: bold, italics, code, line breaks */
function formatContent(text) {
  let safe = escapeHTML(text);
  safe = safe.replace(/```([\s\S]*?)```/g, (m, code) => `<pre><code>${code.trim()}</code></pre>`);
  safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  safe = safe.replace(/\n/g, "<br>");
  return safe;
}

/* ============================ SOUND EFFECTS (WebAudio, no files) ============================ */

function getAudioCtx() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return state.audioCtx;
}

function playTone(freq = 440, duration = 0.12, type = "sine", vol = 0.06, delay = 0) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration + 0.05);
  } catch (e) { /* audio not available */ }
}

const sfx = {
  send: () => { playTone(880, 0.08, "sine", 0.05); playTone(1320, 0.08, "sine", 0.04, 0.05); },
  receive: () => { playTone(520, 0.09, "triangle", 0.05); playTone(780, 0.12, "sine", 0.04, 0.06); },
  micOn: () => { playTone(660, 0.1, "square", 0.03); playTone(990, 0.1, "square", 0.03, 0.08); },
  micOff: () => { playTone(440, 0.1, "square", 0.03); },
  error: () => { playTone(180, 0.25, "sawtooth", 0.05); },
  click: () => { playTone(1000, 0.04, "sine", 0.02); },
};

/* ============================ AVATAR STATE ============================ */

function setAvatarState(mode) {
  avatarCore.classList.remove("listening", "thinking");
  ringEls.forEach((r) => r.classList.remove("listen-active"));
  avatarWave.classList.remove("active");
  statusDot.classList.remove("busy", "listening");

  if (mode === "listening") {
    avatarCore.classList.add("listening");
    ringEls.forEach((r) => r.classList.add("listen-active"));
    statusDot.classList.add("listening");
    statusText.textContent = "Listening…";
    avatarHint.textContent = "Speak now — I'm listening";
  } else if (mode === "thinking") {
    avatarCore.classList.add("thinking");
    statusDot.classList.add("busy");
    statusText.textContent = "Thinking…";
    avatarHint.textContent = "Processing your request";
  } else if (mode === "speaking") {
    avatarCore.classList.add("thinking");
    avatarWave.classList.add("active");
    statusText.textContent = "Speaking…";
    avatarHint.textContent = "Verity is responding";
  } else {
    statusText.textContent = "Online — Ready";
    avatarHint.textContent = "Tap the mic or type a message to begin";
  }
}

/* ============================ MEMORY / STORAGE ============================ */

function loadHistory() {
  try {
    const raw = localStorage.getItem("verity_history");
    state.history = raw ? JSON.parse(raw) : [];
  } catch (e) { state.history = []; }
}

function saveHistory() {
  localStorage.setItem("verity_history", JSON.stringify(state.history));
}

function loadSettings() {
  const savedKey = localStorage.getItem("verity_api_key");
  if (savedKey) CONFIG.GROQ_API_KEY = savedKey;

  const savedModel = localStorage.getItem("verity_model");
  if (savedModel) {
    state.currentModel = savedModel;
    modelSelect.value = savedModel;
  }

  const savedTTS = localStorage.getItem("verity_tts");
  if (savedTTS !== null) state.ttsEnabled = savedTTS === "true";
  updateTTSButton();
}

/* ============================ RENDER MESSAGES ============================ */

function clearWelcome() {
  const welcome = chatWindow.querySelector(".welcome-msg");
  if (welcome) welcome.remove();
}

function renderWelcome() {
  chatWindow.innerHTML = `
    <div class="welcome-msg">
      <i class="fa-solid fa-atom"></i>
      <h3>VERITY ONLINE</h3>
      <p>مرحبًا! أنا فيريتي، مساعدك الذكي. اسألني أي شيء بالعربية أو الإنجليزية.<br>
      Hello! I'm Verity, your AI assistant. Ask me anything in Arabic or English.</p>
    </div>`;
}

function renderMessage(role, content, lang, save = true) {
  clearWelcome();
  const msgEl = document.createElement("div");
  msgEl.className = `msg ${role}`;
  msgEl.dir = lang === "ar" ? "rtl" : "ltr";

  const avatarIcon = role === "user" ? "fa-user" : "fa-atom";
  msgEl.innerHTML = `
    <div class="msg-avatar"><i class="fa-solid ${avatarIcon}"></i></div>
    <div class="msg-content">
      <div class="msg-bubble">${formatContent(content)}</div>
      <div class="msg-meta">
        <span class="msg-time">${nowTime()}</span>
        <div class="msg-actions">
          <button class="msg-action-btn copy-btn" title="Copy"><i class="fa-solid fa-copy"></i></button>
          ${role === "ai" ? '<button class="msg-action-btn speak-btn" title="Read aloud"><i class="fa-solid fa-volume-high"></i></button>' : ""}
        </div>
      </div>
    </div>`;

  chatWindow.appendChild(msgEl);
  scrollToBottom();

  msgEl.querySelector(".copy-btn").addEventListener("click", () => copyMessage(content));
  const speakBtn = msgEl.querySelector(".speak-btn");
  if (speakBtn) speakBtn.addEventListener("click", () => speakText(content, lang));

  if (save) {
    state.history.push({ role, content, lang, time: Date.now() });
    saveHistory();
  }

  return msgEl;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatWindow.scrollTop = chatWindow.scrollHeight;
  });
}

function copyMessage(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast("Message copied", "fa-copy");
    sfx.click();
  }).catch(() => showToast("Copy failed", "fa-triangle-exclamation"));
}

/* ============================ CHAT / GROQ STREAMING ============================ */

function buildApiMessages(userLang) {
  const systemPrompt = userLang === "ar" ? CONFIG.SYSTEM_PROMPT_AR : CONFIG.SYSTEM_PROMPT_EN;
  const recent = state.history.slice(-CONFIG.MAX_HISTORY_MESSAGES);
  const messages = [{ role: "system", content: systemPrompt }];
  recent.forEach((m) => {
    messages.push({ role: m.role === "ai" ? "assistant" : "user", content: m.content });
  });
  return messages;
}

async function sendToGroq(userText, userLang) {
  if (!CONFIG.GROQ_API_KEY || CONFIG.GROQ_API_KEY === "YOUR_GROQ_API_KEY_HERE") {
    openSettings();
    showToast("Please add your Groq API key first", "fa-key");
    sfx.error();
    return;
  }

  state.isStreaming = true;
  sendBtn.disabled = true;
  setAvatarState("thinking");
  typingIndicator.hidden = false;
  scrollToBottom();

  const messages = buildApiMessages(userLang);

  let assistantMsgEl = null;
  let bubbleEl = null;
  let fullText = "";

  try {
    const response = await fetch(CONFIG.GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: state.currentModel,
        messages,
        temperature: CONFIG.TEMPERATURE,
        max_tokens: CONFIG.MAX_TOKENS,
        top_p: 1,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line for next round

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.replace(/^data:\s*/, "");
        if (payload === "[DONE]") continue;

        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content || "";
          if (delta) {
            if (!assistantMsgEl) {
              typingIndicator.hidden = true;
              assistantMsgEl = renderMessage("ai", "", userLang, false);
              bubbleEl = assistantMsgEl.querySelector(".msg-bubble");
            }
            fullText += delta;
            bubbleEl.innerHTML = formatContent(fullText) + '<span class="cursor-blink">▌</span>';
            scrollToBottom();
          }
        } catch (e) { /* ignore malformed chunk */ }
      }
    }

    if (bubbleEl) bubbleEl.innerHTML = formatContent(fullText);

    if (fullText) {
      state.history.push({ role: "ai", content: fullText, lang: userLang, time: Date.now() });
      saveHistory();
      sfx.receive();
      if (state.ttsEnabled) speakText(fullText, userLang);
    } else {
      renderMessage("ai", userLang === "ar" ? "عذرًا، لم أتلقَّ ردًا. حاول مرة أخرى." : "Sorry, I didn't receive a response. Please try again.", userLang);
    }
  } catch (err) {
    console.error(err);
    typingIndicator.hidden = true;
    sfx.error();
    const errMsg = userLang === "ar"
      ? `حدث خطأ: ${err.message || "تعذر الاتصال بواجهة Groq"}`
      : `Error: ${err.message || "Could not reach the Groq API"}`;
    renderMessage("ai", errMsg, userLang);
  } finally {
    typingIndicator.hidden = true;
    state.isStreaming = false;
    sendBtn.disabled = false;
    setAvatarState("idle");
  }
}

/* ============================ SEND / INPUT HANDLING ============================ */

function autoResizeTextarea() {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 130) + "px";
}

async function handleSend(e) {
  if (e) e.preventDefault();
  const text = userInput.value.trim();
  if (!text || state.isStreaming) return;

  const lang = detectLanguage(text);
  document.documentElement.lang = lang === "ar" ? "ar" : "en";

  renderMessage("user", text, lang);
  sfx.send();
  userInput.value = "";
  autoResizeTextarea();

  await sendToGroq(text, lang);
}

inputForm.addEventListener("submit", handleSend);

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

userInput.addEventListener("input", autoResizeTextarea);

/* ============================ SPEECH RECOGNITION (Mic Input) ============================ */

/* Resolve the actual BCP-47 recognition language from the current mode.
   "auto" follows whichever interface language is active (toggled via the
   language button), so Arabic speech is recognized with the Arabic
   acoustic/language model instead of being forced through English. */
function resolveRecognitionLang() {
  if (state.voiceLangMode === "ar") return "ar-SA";
  if (state.voiceLangMode === "en") return "en-US";
  // auto -> follow current UI language
  return uiLang === "ar" ? "ar-SA" : "en-US";
}

function updateVoiceLangUI() {
  const labels = { auto: "AUTO", ar: "AR", en: "EN" };
  const titles = {
    auto: "Voice input language: Auto (follows interface language)",
    ar: "Voice input language: Arabic (العربية)",
    en: "Voice input language: English",
  };
  voiceLangBadge.textContent = labels[state.voiceLangMode];
  voiceLangBtn.title = titles[state.voiceLangMode];
  voiceLangBtn.classList.toggle("active-hint", true);

  // If recognition exists, keep it in sync immediately (only applies to next start)
  if (state.recognition) {
    state.recognition.lang = resolveRecognitionLang();
  }
}

function cycleVoiceLangMode() {
  const order = ["auto", "en", "ar"];
  const idx = order.indexOf(state.voiceLangMode);
  state.voiceLangMode = order[(idx + 1) % order.length];
  localStorage.setItem("verity_voice_lang_mode", state.voiceLangMode);
  updateVoiceLangUI();
  sfx.click();
  const msg = {
    auto: "Mic set to Auto-detect",
    en: "Mic set to English",
    ar: "تم ضبط المايك على العربية",
  }[state.voiceLangMode];
  showToast(msg, "fa-globe");
}

voiceLangBtn.addEventListener("click", cycleVoiceLangMode);

function initSpeechRecognition() {
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionAPI) {
    micBtn.title = "Speech recognition not supported in this browser";
    micBtn.style.opacity = "0.4";
    voiceLangBtn.style.opacity = "0.3";
    voiceLangBtn.disabled = true;
    return;
  }

  const savedMode = localStorage.getItem("verity_voice_lang_mode");
  if (savedMode && ["auto", "ar", "en"].includes(savedMode)) {
    state.voiceLangMode = savedMode;
  }

  const recognition = new SpeechRecognitionAPI();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.isListening = true;
    micBtn.classList.add("recording");
    setAvatarState("listening");
    sfx.micOn();
  };

  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    userInput.value = transcript;
    userInput.setAttribute("dir", "auto");
    autoResizeTextarea();

    if (event.results[event.results.length - 1].isFinal) {
      recognition.stop();
    }
  };

  recognition.onerror = (event) => {
    console.warn("Speech recognition error:", event.error);
    sfx.error();
    if (event.error === "language-not-supported") {
      showToast("This browser doesn't support that voice language", "fa-triangle-exclamation");
    } else if (event.error === "no-speech") {
      showToast("No speech detected — try again", "fa-microphone-slash");
    } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      showToast("Microphone access denied", "fa-microphone-slash");
    }
  };

  recognition.onend = () => {
    state.isListening = false;
    micBtn.classList.remove("recording");
    setAvatarState("idle");
    sfx.micOff();
    if (userInput.value.trim()) {
      handleSend();
    }
  };

  state.recognition = recognition;
  updateVoiceLangUI();
}

function toggleMic() {
  if (!state.recognition) {
    showToast("Speech recognition unsupported here", "fa-triangle-exclamation");
    return;
  }
  if (state.isListening) {
    state.recognition.stop();
  } else {
    // Set the recognition language right before starting so it uses the
    // correct acoustic model from the very first spoken word.
    state.recognition.lang = resolveRecognitionLang();
    try {
      state.recognition.start();
    } catch (e) { /* already started */ }
  }
}

micBtn.addEventListener("click", toggleMic);

/* ============================ TEXT TO SPEECH ============================ */

function loadVoices() {
  state.voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  state.voicesReady = state.voices.length > 0;
}

if ("speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

/* Voices load asynchronously in most browsers (esp. Chrome) — the very
   first call to getVoices() can return an empty array. This waits (with a
   short retry loop + the onvoiceschanged event) until voices are actually
   available before we try to pick one, which is what usually breaks
   Arabic playback (it silently falls back to a default English voice). */
function ensureVoicesLoaded(timeoutMs = 2500) {
  return new Promise((resolve) => {
    loadVoices();
    if (state.voices.length) return resolve(state.voices);

    let settled = false;
    const onChange = () => {
      loadVoices();
      if (state.voices.length && !settled) {
        settled = true;
        window.speechSynthesis.removeEventListener("voiceschanged", onChange);
        resolve(state.voices);
      }
    };
    window.speechSynthesis.addEventListener("voiceschanged", onChange);

    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      loadVoices();
      if (state.voices.length || attempts > timeoutMs / 150) {
        clearInterval(poll);
        if (!settled) {
          settled = true;
          window.speechSynthesis.removeEventListener("voiceschanged", onChange);
          resolve(state.voices);
        }
      }
    }, 150);
  });
}

/* Common Arabic voice names shipped by Windows/Edge, macOS/iOS Safari,
   Android/Chrome and Google TTS engines — used as a name-based fallback
   whenever a browser mislabels the voice's lang code. */
const ARABIC_VOICE_NAME_HINTS = /arab|maged|majed|tarik|laila|hoda|salma|zeina|hamed|naayf|nayef|mehdi|amira|hala|fatima|yasmine|ghazi/i;

function pickVoice(lang) {
  if (!state.voices.length) loadVoices();
  const list = state.voices;
  if (!list.length) return null;

  if (lang === "ar") {
    // 1) Exact/regional Arabic locales, common "good" voices first
    const preferredLocales = ["ar-sa", "ar-eg", "ar-ae", "ar-xa", "ar-001", "ar-jo", "ar-bh"];
    let match = list.find((v) => preferredLocales.includes(v.lang.toLowerCase()) && /google|microsoft|natural|premium/i.test(v.name));
    // 2) Any voice whose lang starts with "ar"
    if (!match) match = list.find((v) => v.lang.toLowerCase().startsWith("ar"));
    // 3) Name-based fallback (some browsers mislabel lang as en but name reveals Arabic voice)
    if (!match) match = list.find((v) => ARABIC_VOICE_NAME_HINTS.test(v.name));
    return match || null;
  }

  // English: prefer a natural-sounding/female voice when available
  let match = list.find((v) => v.lang.toLowerCase().startsWith("en") && /female|zira|samantha|jenny|aria|natural/i.test(v.name));
  if (!match) match = list.find((v) => v.lang.toLowerCase().startsWith("en"));
  return match || null;
}

/* Chrome has a long-standing bug where speechSynthesis stops firing audio
   for utterances longer than ~15s. Pausing/resuming periodically while
   speaking works around it — this matters a lot for longer Arabic replies. */
function startTTSKeepAlive() {
  stopTTSKeepAlive();
  state.ttsKeepAliveTimer = setInterval(() => {
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }
  }, 4000);
}
function stopTTSKeepAlive() {
  if (state.ttsKeepAliveTimer) {
    clearInterval(state.ttsKeepAliveTimer);
    state.ttsKeepAliveTimer = null;
  }
}

async function speakText(text, lang) {
  if (!("speechSynthesis" in window)) {
    showToast("Text-to-speech isn't supported in this browser", "fa-triangle-exclamation");
    return;
  }
  window.speechSynthesis.cancel();
  stopTTSKeepAlive();

  await ensureVoicesLoaded();

  const cleanText = text.replace(/[*`_#]/g, "").replace(/<[^>]+>/g, "").trim();
  if (!cleanText) return;

  const utterance = new SpeechSynthesisUtterance(cleanText);
  const voice = pickVoice(lang);

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = lang === "ar" ? "ar-SA" : "en-US";
    if (lang === "ar" && !state.arabicVoiceWarned) {
      state.arabicVoiceWarned = true;
      showToast("No Arabic voice found on this device/browser — try Chrome or Edge for full Arabic TTS support", "fa-triangle-exclamation");
    }
  }

  utterance.rate = lang === "ar" ? 0.98 : 1.02;
  utterance.pitch = 1.05;
  utterance.volume = 1;

  utterance.onstart = () => {
    setAvatarState("speaking");
    startTTSKeepAlive();
  };
  utterance.onend = () => {
    stopTTSKeepAlive();
    setAvatarState("idle");
  };
  utterance.onerror = () => {
    stopTTSKeepAlive();
    setAvatarState("idle");
  };

  window.speechSynthesis.speak(utterance);
}

function updateTTSButton() {
  ttsToggleBtn.classList.toggle("active", state.ttsEnabled);
  ttsToggleBtn.innerHTML = state.ttsEnabled
    ? '<i class="fa-solid fa-volume-high"></i>'
    : '<i class="fa-solid fa-volume-xmark"></i>';
}

ttsToggleBtn.addEventListener("click", () => {
  state.ttsEnabled = !state.ttsEnabled;
  localStorage.setItem("verity_tts", state.ttsEnabled);
  updateTTSButton();
  sfx.click();
  if (!state.ttsEnabled) window.speechSynthesis.cancel();
  showToast(state.ttsEnabled ? "Voice output enabled" : "Voice output muted", "fa-volume-high");
});

/* ============================ INTERFACE LANGUAGE TOGGLE ============================ */

let uiLang = "en";
function toggleUILanguage() {
  uiLang = uiLang === "en" ? "ar" : "en";
  document.body.classList.toggle("lang-ar", uiLang === "ar");
  document.documentElement.dir = uiLang === "ar" ? "rtl" : "ltr";
  userInput.placeholder = uiLang === "ar" ? "اكتب رسالتك هنا…" : "Type your message… اكتب رسالتك";
  sfx.click();
  showToast(uiLang === "ar" ? "تم التبديل إلى العربية" : "Switched to English", "fa-language");
}
langToggleBtn.addEventListener("click", toggleUILanguage);

/* ============================ MODEL SELECT ============================ */

modelSelect.addEventListener("change", () => {
  state.currentModel = modelSelect.value;
  localStorage.setItem("verity_model", state.currentModel);
  showToast(`Model set to ${modelSelect.options[modelSelect.selectedIndex].text}`, "fa-microchip");
  sfx.click();
});

/* ============================ CLEAR CHAT ============================ */

clearBtn.addEventListener("click", () => {
  if (!state.history.length) {
    showToast("Chat is already empty", "fa-circle-info");
    return;
  }
  if (confirm("Clear the entire conversation? This cannot be undone.")) {
    state.history = [];
    saveHistory();
    renderWelcome();
    sfx.click();
    showToast("Conversation cleared", "fa-trash");
  }
});

/* ============================ DOWNLOAD CHAT ============================ */

downloadBtn.addEventListener("click", () => {
  if (!state.history.length) {
    showToast("Nothing to download yet", "fa-circle-info");
    return;
  }
  const lines = state.history.map((m) => {
    const speaker = m.role === "ai" ? "Verity" : "You";
    const time = new Date(m.time).toLocaleString();
    return `[${time}] ${speaker}: ${m.content}`;
  });
  const blob = new Blob([lines.join("\n\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `verity-chat-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Chat downloaded", "fa-download");
  sfx.click();
});

/* ============================ SETTINGS MODAL ============================ */

function openSettings() {
  settingsModal.classList.add("open");
  apiKeyInput.value = (CONFIG.GROQ_API_KEY && CONFIG.GROQ_API_KEY !== "YOUR_GROQ_API_KEY_HERE") ? CONFIG.GROQ_API_KEY : "";
}
function closeSettingsModal() {
  settingsModal.classList.remove("open");
}

settingsBtn.addEventListener("click", openSettings);
closeSettings.addEventListener("click", closeSettingsModal);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettingsModal();
});

saveApiKeyBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showToast("Please enter a valid API key", "fa-triangle-exclamation");
    return;
  }
  CONFIG.GROQ_API_KEY = key;
  localStorage.setItem("verity_api_key", key);
  showToast("API key saved", "fa-circle-check");
  closeSettingsModal();
});

removeApiKeyBtn.addEventListener("click", () => {
  localStorage.removeItem("verity_api_key");
  CONFIG.GROQ_API_KEY = "YOUR_GROQ_API_KEY_HERE";
  apiKeyInput.value = "";
  showToast("API key removed", "fa-trash");
});

/* ============================ PARTICLE BACKGROUND ============================ */

function initParticles() {
  const canvas = $("particles");
  const ctx = canvas.getContext("2d");
  let particles = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  const colors = ["#00e5ff", "#b026ff", "#ff2bd6"];
  const COUNT = Math.min(70, Math.floor((window.innerWidth * window.innerHeight) / 18000));

  for (let i = 0; i < COUNT; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.8 + 0.4,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      c: colors[Math.floor(Math.random() * colors.length)],
      a: Math.random() * 0.6 + 0.2,
    });
  }

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = p.a;
      ctx.shadowBlur = 8;
      ctx.shadowColor = p.c;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(tick);
  }
  tick();
}

/* ============================ INIT ============================ */

function renderExistingHistory() {
  if (!state.history.length) {
    renderWelcome();
    return;
  }
  chatWindow.innerHTML = "";
  state.history.forEach((m) => renderMessage(m.role, m.content, m.lang || "en", false));
}

function init() {
  loadHistory();
  loadSettings();
  renderExistingHistory();
  initSpeechRecognition();
  initParticles();
  setAvatarState("idle");
  autoResizeTextarea();

  // Pre-warm the voice list so Arabic/English voices are ready before the
  // first message is spoken (fixes "first reply plays in wrong/no voice").
  if ("speechSynthesis" in window) {
    ensureVoicesLoaded();
    // Some browsers only populate voices after a silent utterance kick.
    try {
      const warm = new SpeechSynthesisUtterance("");
      window.speechSynthesis.speak(warm);
    } catch (e) { /* ignore */ }
  }

  // Unlock audio context on first interaction (autoplay policies)
  document.body.addEventListener("click", () => {
    if (state.audioCtx && state.audioCtx.state === "suspended") state.audioCtx.resume();
  }, { once: true });
}

document.addEventListener("DOMContentLoaded", init);
