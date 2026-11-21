(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = 420, H = 700, groundH = 92;
  const $ = (id) => document.getElementById(id);

  const ui = {
    home: $("homeScreen"), pause: $("pauseScreen"), over: $("gameOverScreen"),
    settings: $("settingsScreen"), achievements: $("achievementsScreen"),
    confirm: $("confirmReset"), hud: $("topHud"), score: $("score"),
    homeBest: $("homeBest"), finalScore: $("finalScore"), finalBest: $("finalBest"),
    newBest: $("newBest"), toast: $("toast")
  };

  const defaults = {
    sound: true, music: false, vibration: true, mode: "classic",
    best: 0, achievements: {}, stats: { games: 0, pipes: 0, best: 0 }
  };

  function load(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
    catch { return fallback; }
  }
  const settings = load("flappySettings", defaults);
  settings.achievements = settings.achievements || {};
  settings.stats = { ...defaults.stats, ...(settings.stats || {}) };

  let state = "HOME", previousState = "HOME";
  let score = 0, runBest = settings.best, newRecord = false;
  let pipes = [], particles = [], clouds = [], confetti = [];
  let elapsed = 0, spawnTimer = 0, shake = 0, flash = 0;
  let lastTime = performance.now(), accumulator = 0;
  let audioCtx = null;
  let musicNodes = null;
  const bird = { x: 126, y: 326, vy: 0, r: 0, wing: 0, alive: true };

  const modes = {
    easy: { gravity: 1250, flap: -390, pipeSpeed: 145, baseGap: 176, minGap: 158 },
    classic: { gravity: 1320, flap: -420, pipeSpeed: 160, baseGap: 168, minGap: 145 },
    hard: { gravity: 1420, flap: -440, pipeSpeed: 178, baseGap: 158, minGap: 132 }
  };

  const achievements = [
    ["first", "First Flight", "Score 1", 1],
    ["starter", "Getting Started", "Score 5", 5],
    ["skilled", "Skilled Pilot", "Score 10", 10],
    ["pro", "Pro Flyer", "Score 25", 25],
    ["legendary", "Legendary", "Score 50", 50],
    ["impossible", "Impossible?", "Score 100", 100]
  ];

  function saveSettings() {
    localStorage.setItem("flappySettings", JSON.stringify(settings));
  }

  function initClouds() {
    clouds = [
      { x: 20, y: 115, s: .8, p: .22 },
      { x: 230, y: 72, s: 1.15, p: .16 },
      { x: 155, y: 205, s: .62, p: .12 },
      { x: 340, y: 160, s: .86, p: .18 }
    ];
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }

  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function tone(freq, duration, type = "sine", gainValue = .06, slide = 0) {
    if (!settings.sound) return;
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq + slide, audioCtx.currentTime + duration);
    gain.gain.setValueAtTime(gainValue, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  }

  function playSound(name) {
    if (name === "flap") tone(620, .08, "triangle", .05, 180);
    if (name === "score") { tone(880, .09, "sine", .055, 220); setTimeout(() => tone(1200, .08, "sine", .04, 80), 55); }
    if (name === "hit") { tone(155, .18, "square", .055, -70); tone(95, .28, "sawtooth", .025, -30); }
    if (name === "button") tone(430, .06, "sine", .04, 80);
  }

  function vibrate(ms) {
    if (settings.vibration && navigator.vibrate) navigator.vibrate(ms);
  }

  function resetRun() {
    const cfg = modes[settings.mode];
    score = 0;
    newRecord = false;
    pipes = [];
    particles = [];
    confetti = [];
    spawnTimer = 1.1;
    elapsed = 0;
    shake = 0;
    flash = 0;
    bird.x = 126;
    bird.y = 326;
    bird.vy = cfg.flap * .12;
    bird.r = 0;
    bird.wing = 0;
    bird.alive = true;
    ui.score.textContent = "0";
  }

  function startGame() {
    resetRun();
    settings.stats.games++;
    saveSettings();
    state = "PLAYING";
    ui.home.classList.add("hidden");
    ui.pause.classList.add("hidden");
    ui.over.classList.add("hidden");
    ui.settings.classList.add("hidden");
    ui.achievements.classList.add("hidden");
    ui.confirm.classList.add("hidden");
    ui.hud.classList.remove("hidden");
    flap();
  }

  function goHome() {
    state = "HOME";
    ui.hud.classList.add("hidden");
    ui.over.classList.add("hidden");
    ui.pause.classList.add("hidden");
    ui.settings.classList.add("hidden");
    ui.achievements.classList.add("hidden");
    ui.confirm.classList.add("hidden");
    ui.home.classList.remove("hidden");
    ui.homeBest.textContent = settings.best;
  }

  function flap() {
    if (state !== "PLAYING" && state !== "READY") return;
    ensureAudio();
    bird.vy = modes[settings.mode].flap;
    bird.wing = 1;
    playSound("flap");
    for (let i = 0; i < 5; i++) {
      particles.push({
        x: bird.x - 16, y: bird.y + 5,
        vx: -55 - Math.random() * 45, vy: (Math.random() - .5) * 55,
        life: .35 + Math.random() * .25, max: .6, color: i % 2 ? "#fff1a0" : "#e6be46", size: 3 + Math.random() * 4
      });
    }
  }

  function spawnPipe() {
    const cfg = modes[settings.mode];
    const progress = Math.min(score / 60, 1);
    const gap = Math.max(cfg.minGap, cfg.baseGap - progress * 18);
    const margin = 110;
    const minCenter = 112 + gap / 2;
    const maxCenter = H - groundH - 55 - gap / 2;
    const center = minCenter + Math.random() * (maxCenter - minCenter);
    pipes.push({ x: W + 30, width: 68, gap, center, passed: false });
  }

  function getPipeSpeed() {
    const cfg = modes[settings.mode];
    return cfg.pipeSpeed + Math.min(score * 2.2, 58);
  }

  function update(dt) {
    elapsed += dt;
    shake = Math.max(0, shake - dt * 22);
    flash = Math.max(0, flash - dt * 3);

    if (state === "HOME" || state === "READY") {
      bird.y = 326 + Math.sin(elapsed * 3) * 9;
      bird.r = Math.sin(elapsed * 2) * .06;
      bird.wing = (Math.sin(elapsed * 12) + 1) / 2;
    }

    clouds.forEach((cloud) => {
      cloud.x -= cloud.p * 12 * dt;
      if (cloud.x < -100) cloud.x = W + 40;
    });

    particles.forEach((p) => { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 100 * dt; });
    particles = particles.filter((p) => p.life > 0);
    confetti.forEach((p) => { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; p.r += p.vr * dt; });
    confetti = confetti.filter((p) => p.life > 0);

    if (state !== "PLAYING") return;

    const cfg = modes[settings.mode];
    bird.vy += cfg.gravity * dt;
    bird.y += bird.vy * dt;
    bird.r += ((bird.vy > 0 ? Math.min(bird.vy / 620, 1.25) : -.28) - bird.r) * Math.min(1, dt * 8);
    bird.wing = Math.max(0, bird.wing - dt * 5);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnPipe();
      spawnTimer = Math.max(.92, 1.42 - score * .006);
    }

    const speed = getPipeSpeed();
    pipes.forEach((pipe) => {
      pipe.x -= speed * dt;
      if (!pipe.passed && pipe.x + pipe.width < bird.x - 12) {
        pipe.passed = true;
        score++;
        settings.stats.pipes++;
        ui.score.textContent = score;
        ui.score.classList.remove("pop");
        void ui.score.offsetWidth;
        ui.score.classList.add("pop");
        playSound("score");
        vibrate(18);
        addScoreParticles(pipe.x + pipe.width, pipe.center);
        checkAchievements();
      }
    });
    pipes = pipes.filter((pipe) => pipe.x + pipe.width > -20);

    if (bird.y < 0) {
      bird.y = 0;
      bird.vy = 40;
    }
    if (collides()) endGame();
  }

  function birdHitbox() {
    return { x: bird.x - 13, y: bird.y - 11, w: 26, h: 23 };
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function collides() {
    const b = birdHitbox();
    if (b.y + b.h >= H - groundH) return true;
    for (const pipe of pipes) {
      const top = { x: pipe.x - 4, y: -10, w: pipe.width + 8, h: pipe.center - pipe.gap / 2 };
      const bottom = { x: pipe.x - 4, y: pipe.center + pipe.gap / 2, w: pipe.width + 8, h: H - groundH - (pipe.center + pipe.gap / 2) };
      if (rectsOverlap(b, top) || rectsOverlap(b, bottom)) return true;
    }
    return false;
  }

  function addScoreParticles(x, y) {
    for (let i = 0; i < 10; i++) {
      particles.push({ x, y, vx: -30 + Math.random() * 100, vy: -100 + Math.random() * 200,
        life: .45 + Math.random() * .25, max: .7, color: i % 2 ? "#fff89d" : "#fff", size: 3 + Math.random() * 5 });
    }
  }

  function endGame() {
    if (state !== "PLAYING") return;
    state = "GAME_OVER";
    bird.alive = false;
    shake = 8;
    flash = .7;
    playSound("hit");
    vibrate([60, 40, 80]);
    for (let i = 0; i < 20; i++) {
      particles.push({ x: bird.x, y: bird.y, vx: -120 + Math.random() * 240, vy: -170 + Math.random() * 220,
        life: .7 + Math.random() * .5, max: 1.2, color: i % 3 ? "#ffd64b" : "#fff5b0", size: 3 + Math.random() * 5 });
    }
    if (score > settings.best) {
      settings.best = score;
      newRecord = true;
      createConfetti();
    }
    settings.stats.best = Math.max(settings.stats.best, score);
    saveSettings();
    setTimeout(showGameOver, 520);
  }

  function showGameOver() {
    if (state !== "GAME_OVER") return;
    ui.hud.classList.add("hidden");
    ui.finalScore.textContent = score;
    ui.finalBest.textContent = settings.best;
    ui.newBest.classList.toggle("hidden", !newRecord);
    ui.over.classList.remove("hidden");
  }

  function createConfetti() {
    const colors = ["#ffd84d", "#ed6d55", "#66c75b", "#75bfe8", "#fff"];
    for (let i = 0; i < 55; i++) {
      confetti.push({ x: W / 2 + (Math.random() - .5) * 80, y: 190 + Math.random() * 60,
        vx: (Math.random() - .5) * 280, vy: -170 - Math.random() * 210,
        life: 1.8 + Math.random(), max: 2.8, r: Math.random() * 6.28, vr: (Math.random() - .5) * 8,
        color: colors[i % colors.length], size: 5 + Math.random() * 5 });
    }
  }

  function checkAchievements() {
    let unlocked = null;
    achievements.forEach(([id, name, description, target]) => {
      if (score >= target && !settings.achievements[id]) {
        settings.achievements[id] = true;
        unlocked = name;
      }
    });
    if (unlocked) {
      saveSettings();
      showToast(`Achievement unlocked: ${unlocked}!`);
      tone(650, .12, "triangle", .04, 300);
      setTimeout(() => tone(980, .16, "triangle", .04, 220), 120);
    }
  }

  function showToast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => ui.toast.classList.add("hidden"), 2200);
  }

  function pauseGame() {
    if (state !== "PLAYING") return;
    previousState = state;
    state = "PAUSED";
    ui.pause.classList.remove("hidden");
  }

  function resumeGame() {
    if (state !== "PAUSED") return;
    state = "PLAYING";
    ui.pause.classList.add("hidden");
    accumulator = 0;
  }

  function openSettings() {
    previousState = state;
    state = "PAUSED";
    ui.settings.classList.remove("hidden");
  }

  function closeSettings() {
    ui.settings.classList.add("hidden");
    state = previousState === "PLAYING" ? "PLAYING" : "HOME";
  }

  function openAchievements() {
    renderAchievements();
    ui.home.classList.add("hidden");
    ui.achievements.classList.remove("hidden");
  }

  function renderAchievements() {
    $("achievementList").innerHTML = achievements.map(([id, name, desc]) =>
      `<div class="achievement ${settings.achievements[id] ? "unlocked" : ""}">
        <div class="badge">${settings.achievements[id] ? "★" : "?"}</div>
        <div><strong>${name}</strong><span>${desc}</span></div>
      </div>`
    ).join("");
  }

  function syncSettingsUI() {
    [["soundToggle", "sound"], ["musicToggle", "music"], ["vibrationToggle", "vibration"]].forEach(([id, key]) => {
      const el = $(id);
      el.classList.toggle("on", !!settings[key]);
      el.setAttribute("aria-checked", !!settings[key]);
    });
    document.querySelectorAll("[data-mode]").forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === settings.mode));
  }

  function toggleSetting(key) {
    settings[key] = !settings[key];
    saveSettings();
    syncSettingsUI();
    playSound("button");
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);

    const sky = ctx.createLinearGradient(0, 0, 0, H - groundH);
    sky.addColorStop(0, "#62bbe4");
    sky.addColorStop(.75, "#9edfed");
    sky.addColorStop(1, "#d8f2df");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(315, 70, 5, 315, 70, 100);
    glow.addColorStop(0, "rgba(255,244,176,.75)");
    glow.addColorStop(1, "rgba(255,244,176,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(215, 0, 205, 170);

    clouds.forEach(drawCloud);
    drawHills();
    pipes.forEach(drawPipe);
    drawParticles();
    drawGround();
    if (state !== "GAME_OVER" || bird.alive) drawBird();
    if (state === "GAME_OVER" && !bird.alive) drawBird();

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * .55})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  function drawCloud(c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(c.s, c.s);
    ctx.fillStyle = "rgba(255,255,255,.72)";
    ctx.beginPath();
    ctx.arc(22, 18, 18, 0, Math.PI * 2);
    ctx.arc(43, 12, 24, 0, Math.PI * 2);
    ctx.arc(66, 20, 16, 0, Math.PI * 2);
    ctx.rect(22, 18, 44, 18);
    ctx.fill();
    ctx.restore();
  }

  function drawHills() {
    ctx.fillStyle = "rgba(112,176,116,.34)";
    ctx.beginPath();
    ctx.moveTo(0, H - groundH);
    ctx.quadraticCurveTo(55, 510, 120, H - groundH);
    ctx.quadraticCurveTo(190, 530, 260, H - groundH);
    ctx.quadraticCurveTo(335, 505, 420, H - groundH);
    ctx.closePath();
    ctx.fill();
  }

  function drawPipe(pipe) {
    const topBottom = pipe.center - pipe.gap / 2;
    const bottomTop = pipe.center + pipe.gap / 2;
    drawPipeSection(pipe.x, -5, pipe.width, topBottom + 5, true);
    drawPipeSection(pipe.x, bottomTop, pipe.width, H - groundH - bottomTop, false);
  }

  function drawPipeSection(x, y, w, h, top) {
    ctx.save();
    ctx.shadowColor = "rgba(48,91,63,.18)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 3;
    const bodyGradient = ctx.createLinearGradient(x, 0, x + w, 0);
    bodyGradient.addColorStop(0, "#52a73c");
    bodyGradient.addColorStop(.18, "#78cf50");
    bodyGradient.addColorStop(.55, "#63ba43");
    bodyGradient.addColorStop(.82, "#459b35");
    bodyGradient.addColorStop(1, "#3a7e30");
    ctx.fillStyle = bodyGradient;
    ctx.strokeStyle = "#3f6e36";
    ctx.lineWidth = 4;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "rgba(218,255,174,.55)";
    ctx.fillRect(x + 9, y + 3, 7, Math.max(0, h - 6));
    ctx.shadowColor = "transparent";
    const capH = 28;
    const capY = top ? y + h - capH : y;
    const capGradient = ctx.createLinearGradient(x - 8, 0, x + w + 8, 0);
    capGradient.addColorStop(0, "#57a83e");
    capGradient.addColorStop(.25, "#91dc5d");
    capGradient.addColorStop(.6, "#65bd43");
    capGradient.addColorStop(1, "#3f8134");
    ctx.fillStyle = capGradient;
    ctx.fillRect(x - 8, capY, w + 16, capH);
    ctx.strokeRect(x - 8, capY, w + 16, capH);
    ctx.fillStyle = "rgba(225,255,183,.6)";
    ctx.fillRect(x + 1, capY + 4, 8, capH - 8);
    ctx.restore();
  }

  function drawGround() {
    ctx.fillStyle = "#68b84d";
    ctx.fillRect(0, H - groundH, W, 18);
    ctx.fillStyle = "#91d85d";
    ctx.fillRect(0, H - groundH, W, 7);
    ctx.fillStyle = "#dce67a";
    ctx.fillRect(0, H - groundH + 18, W, groundH - 18);
    ctx.fillStyle = "#b9c85d";
    for (let x = -20 + (elapsed * 70 % 32); x < W; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, H - groundH + 18);
      ctx.lineTo(x + 12, H - groundH + 18);
      ctx.lineTo(x + 22, H);
      ctx.lineTo(x + 10, H);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.r);
    ctx.shadowColor = "rgba(67,91,68,.18)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 3;

    ctx.fillStyle = "#efb43c";
    ctx.strokeStyle = "#7d6838";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffe66d";
    ctx.beginPath();
    ctx.ellipse(-6, 3, 16, 10, -.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(-10, 4);
    ctx.rotate(-bird.wing * .8);
    ctx.fillStyle = "#f4d54b";
    ctx.strokeStyle = "#816637";
    ctx.beginPath();
    ctx.ellipse(-3, 5, 13, 7, .25, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "white";
    ctx.strokeStyle = "#6c6547";
    ctx.beginPath();
    ctx.arc(10, -7, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#3d4239";
    ctx.beginPath();
    ctx.arc(13, -7, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f28b39";
    ctx.strokeStyle = "#9d6637";
    ctx.beginPath();
    ctx.moveTo(20, -1);
    ctx.lineTo(34, 4);
    ctx.lineTo(19, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    confetti.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * .55);
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    const frameTime = Math.min((now - lastTime) / 1000, .05);
    lastTime = now;
    accumulator += frameTime;
    const fixed = 1 / 120;
    while (accumulator >= fixed) {
      update(fixed);
      accumulator -= fixed;
    }
    draw();
    requestAnimationFrame(frame);
  }

  function handleAction(event) {
    if (event) event.preventDefault();
    if (state === "HOME") startGame();
    else if (state === "PLAYING") flap();
  }

  canvas.addEventListener("pointerdown", handleAction);
  $("playBtn").addEventListener("click", (e) => { e.stopPropagation(); playSound("button"); startGame(); });
  $("pauseBtn").addEventListener("click", (e) => { e.stopPropagation(); playSound("button"); pauseGame(); });
  $("resumeBtn").addEventListener("click", (e) => { e.stopPropagation(); playSound("button"); resumeGame(); });
  $("pauseRestartBtn").addEventListener("click", (e) => { e.stopPropagation(); playSound("button"); startGame(); });
  $("pauseHomeBtn").addEventListener("click", (e) => { e.stopPropagation(); playSound("button"); goHome(); });
  $("restartBtn").addEventListener("click", (e) => { e.stopPropagation(); playSound("button"); startGame(); });
  $("gameOverHomeBtn").addEventListener("click", (e) => { e.stopPropagation(); playSound("button"); goHome(); });
  $("settingsBtn").addEventListener("click", (e) => { e.stopPropagation(); playSound("button"); openSettings(); });
  $("settingsBackBtn").addEventListener("click", (e) => { e.stopPropagation(); playSound("button"); closeSettings(); });
  $("achievementsBtn").addEventListener("click", (e) => { e.stopPropagation(); playSound("button"); openAchievements(); });
  $("achievementsBackBtn").addEventListener("click", (e) => { e.stopPropagation(); playSound("button"); ui.achievements.classList.add("hidden"); ui.home.classList.remove("hidden"); });
  $("homeSoundBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleSetting("sound"); });
  $("soundToggle").addEventListener("click", () => toggleSetting("sound"));
  $("musicToggle").addEventListener("click", () => toggleSetting("music"));
  $("vibrationToggle").addEventListener("click", () => toggleSetting("vibration"));
  document.querySelectorAll("[data-mode]").forEach((btn) => btn.addEventListener("click", () => {
    settings.mode = btn.dataset.mode;
    saveSettings();
    syncSettingsUI();
    playSound("button");
  }));
  $("resetScoreBtn").addEventListener("click", () => ui.confirm.classList.remove("hidden"));
  $("confirmResetBtn").addEventListener("click", () => {
    settings.best = 0;
    settings.stats.best = 0;
    saveSettings();
    ui.confirm.classList.add("hidden");
    ui.homeBest.textContent = "0";
  });
  $("cancelResetBtn").addEventListener("click", () => ui.confirm.classList.add("hidden"));

  window.addEventListener("keydown", (event) => {
    if (["Space", "ArrowUp"].includes(event.code)) {
      event.preventDefault();
      if (!event.repeat) handleAction();
    }
    if ((event.code === "Escape" || event.code === "KeyP") && state === "PLAYING") pauseGame();
    else if ((event.code === "Escape" || event.code === "KeyP") && state === "PAUSED") resumeGame();
  });

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "PLAYING") pauseGame();
  });

  initClouds();
  resize();
  syncSettingsUI();
  goHome();
  requestAnimationFrame(frame);
})();
