import React, { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { speakTextWithGemini, stopGeminiAudio, getBestLocalVoice } from '../utils/geminiTts';
import { motion, AnimatePresence } from 'framer-motion';
import { animate } from 'animejs';

// Sample PGN game (Fried Liver Attack)
const SAMPLE_PGN = `[Event "Casual Game"]
[Site "Chess Narrator"]
[Date "2026.07.06"]
[White "Mentor"]
[Black "Student"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7 Kxf7 7. Qf3+ Ke6 8. Nc3 Nce7 9. d4 c6 10. Bg5 h6 11. Bxe7 Bxe7 12. O-O-O Rf8 13. Qe4 Bg5+ 14. Kb1 Rf4 15. Qxe5+ Kf7 16. Nxd5 cxd5 17. Bxd5+ Kf8 *`;

const SAMPLE_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface MoveItem {
  san: string;
  from: string;
  to: string;
  piece: string;
  fen: string;
  isOnlyMove?: boolean;
}

// Client-side Web Audio synthesized sound effects
let audioCtx: AudioContext | null = null;
const playChessSound = (type: 'move' | 'capture' | 'check') => {
  if (typeof window === 'undefined') return;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;
  
  try {
    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    const ctx = audioCtx;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    if (type === 'move') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === 'capture') {
      const osc2 = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.1);
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(580, ctx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc2.start();
      osc.stop(ctx.currentTime + 0.1);
      osc2.stop(ctx.currentTime + 0.1);
    } else if (type === 'check') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.setValueAtTime(680, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    }
  } catch (e) {
    console.warn('Failed to play synthesized sound:', e);
  }
};


export default function ChessInterface() {
  const [activeTab, setActiveTab] = useState<'pgn' | 'fen'>('pgn');
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);

  // Play vs AI state
  const [gameMode, setGameMode] = useState<'analysis' | 'play'>('analysis');
  const [playerColor, setPlayerColor] = useState<'white' | 'black' | 'random'>('white');
  const [actualPlayerColor, setActualPlayerColor] = useState<'white' | 'black'>('white');
  const [aiDifficulty, setAiDifficulty] = useState<'easy' | 'medium' | 'hard' | 'master'>('medium');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [gameStatus, setGameStatus] = useState<'active' | 'checkmate' | 'draw' | 'stalemate' | 'resigned'>('active');
  const [aiEngineStatus, setAiEngineStatus] = useState<'idle' | 'loading' | 'ready' | 'thinking'>('idle');

  // Chess board/moves state
  const [positionFen, setPositionFen] = useState(SAMPLE_FEN);
  const [loadedFenStart, setLoadedFenStart] = useState(SAMPLE_FEN);
  const [moves, setMoves] = useState<MoveItem[]>([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white');
  const [copiedText, setCopiedText] = useState<'fen' | 'pgn' | null>(null);

  // Engine state
  const [engineStatus, setEngineStatus] = useState<'loading' | 'ready' | 'evaluating' | 'idle'>('idle');
  const [evalCache, setEvalCache] = useState<Record<string, number>>({});
  const [bestMovesCache, setBestMovesCache] = useState<Record<string, string>>({});
  const [evalQueue, setEvalQueue] = useState<string[]>([]);
  
  // Settings & Narration State
  const [narratorPersonality, setNarratorPersonality] = useState<'sarcastic' | 'supportive' | 'grandmaster' | 'pirate'>('sarcastic');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [useGemini, setUseGemini] = useState(false);
  const [narratorText, setNarratorText] = useState("Greetings, commander. Make a move on the board or load a game, and I'll analyze the strategic narrative.");
  const [displayedNarration, setDisplayedNarration] = useState('');
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [ttsStatus, setTtsStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [ttsErrorMessage, setTtsErrorMessage] = useState('');
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Post-Game Review State
  const [showGameReview, setShowGameReview] = useState(false);
  const [gameReviewText, setGameReviewText] = useState('');
  const [isGeneratingReview, setIsGeneratingReview] = useState(false);

  // Refs
  const autoplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const aiWorkerRef = useRef<Worker | null>(null);
  const chartPathRef = useRef<SVGPathElement>(null);
  const prevChartPathRef = useRef('');
  const evaluatingFenRef = useRef<string | null>(null);
  const tempScoreRef = useRef<number>(0);
  const tempIsMateRef = useRef<boolean>(false);
  const evalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNarratedFenRef = useRef<string | null>(null);
  const lastSettingsRef = useRef({ personality: '', useGemini: false });
  const handleAiBestMoveRef = useRef<(bestMove: string) => void>(() => {});

  // Initialize AI Stockfish Web Worker
  useEffect(() => {
    const aiWorker = new Worker('/stockfish.worker.js');
    aiWorkerRef.current = aiWorker;
    setAiEngineStatus('loading');

    aiWorker.onmessage = (e: MessageEvent) => {
      const line = e.data;
      if (line === 'readyok') {
        setAiEngineStatus('ready');
      }

      // Parse bestmove from AI worker
      const bestmoveMatch = line.match(/^bestmove\s+(\S+)/);
      if (bestmoveMatch) {
        const bestMove = bestmoveMatch[1];
        handleAiBestMoveRef.current(bestMove);
      }
    };

    aiWorker.postMessage('uci');
    aiWorker.postMessage('isready');

    return () => {
      aiWorker.terminate();
      stopGeminiAudio();
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Load API key from local storage on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('chess_narrator_gemini_key');
    if (savedKey) {
      setGeminiApiKey(savedKey);
      setUseGemini(true);
    }
  }, []);

  // Save key to local storage
  const handleSaveApiKey = (key: string) => {
    setGeminiApiKey(key);
    if (key.trim()) {
      localStorage.setItem('chess_narrator_gemini_key', key.trim());
      setUseGemini(true);
    } else {
      localStorage.removeItem('chess_narrator_gemini_key');
      setUseGemini(false);
    }
  };

  // Initialize Stockfish Web Worker
  useEffect(() => {
    // Create worker
    const worker = new Worker('/stockfish.worker.js');
    workerRef.current = worker;
    setEngineStatus('loading');

    worker.onmessage = (e: MessageEvent) => {
      const line = e.data;
      
      // Parse Stockfish logs
      if (line === 'readyok') {
        setEngineStatus(prev => prev === 'loading' ? 'ready' : prev);
      }

      // Parse score updates
      const cpMatch = line.match(/score cp (-?\d+)/);
      const mateMatch = line.match(/score mate (-?\d+)/);
      if (cpMatch && evaluatingFenRef.current) {
        tempScoreRef.current = parseInt(cpMatch[1]);
        tempIsMateRef.current = false;
      } else if (mateMatch && evaluatingFenRef.current) {
        const mateIn = parseInt(mateMatch[1]);
        tempScoreRef.current = mateIn > 0 ? (10000 - mateIn * 100) : (-10000 - mateIn * 100);
        tempIsMateRef.current = true;
      }

      // Parse bestmove completion
      const bestmoveMatch = line.match(/^bestmove\s+(\S+)/);
      if (bestmoveMatch && evaluatingFenRef.current) {
        if (evalTimeoutRef.current) clearTimeout(evalTimeoutRef.current);
        const finishedFen = evaluatingFenRef.current;
        const bestMove = bestmoveMatch[1];
        const rawScore = tempScoreRef.current;
        
        // Normalize score to White's perspective
        const activeColor = finishedFen.split(' ')[1] || 'w';
        const normalizedScore = activeColor === 'w' ? rawScore : -rawScore;

        setEvalCache(prev => ({ ...prev, [finishedFen]: normalizedScore }));
        setBestMovesCache(prev => ({ ...prev, [finishedFen]: bestMove }));
        
        evaluatingFenRef.current = null;
        setEngineStatus('ready');
      }
    };

    // Initialize UCI protocol
    worker.postMessage('uci');
    worker.postMessage('isready');

    return () => {
      worker.terminate();
      if (evalTimeoutRef.current) clearTimeout(evalTimeoutRef.current);
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Populate evaluation queue when moves list or start FEN changes
  useEffect(() => {
    const fensToEval: string[] = [];
    
    // Include starting position if not evaluated
    if (evalCache[loadedFenStart] === undefined) {
      fensToEval.push(loadedFenStart);
    }
    
    // Include all moves FENs if not evaluated
    for (const m of moves) {
      if (evalCache[m.fen] === undefined) {
        fensToEval.push(m.fen);
      }
    }
    
    if (fensToEval.length > 0) {
      setEvalQueue(prev => {
        // Filter out items already in queue
        const newItems = fensToEval.filter(f => !prev.includes(f));
        return [...prev, ...newItems];
      });
    }
  }, [moves, loadedFenStart, evalCache]);

  // Process evaluation queue
  useEffect(() => {
    if (engineStatus === 'ready' && evalQueue.length > 0 && workerRef.current) {
      const nextFen = evalQueue[0];
      setEvalQueue(prev => prev.slice(1));
      
      setEngineStatus('evaluating');
      evaluatingFenRef.current = nextFen;
      tempScoreRef.current = 0;
      tempIsMateRef.current = false;
      
      workerRef.current.postMessage(`position fen ${nextFen}`);
      workerRef.current.postMessage('go depth 10');

      if (evalTimeoutRef.current) clearTimeout(evalTimeoutRef.current);
      evalTimeoutRef.current = setTimeout(() => {
        if (evaluatingFenRef.current === nextFen) {
          console.warn("Evaluation timed out for FEN:", nextFen);
          if (workerRef.current) {
            workerRef.current.postMessage('stop');
          }
          setEvalCache(prev => ({ ...prev, [nextFen]: 0 }));
          setBestMovesCache(prev => ({ ...prev, [nextFen]: '(none)' }));
          evaluatingFenRef.current = null;
          setEngineStatus('ready');
        }
      }, 3000);
    }
  }, [evalQueue, engineStatus]);

  // Prioritize active FENs to evaluate immediately
  const prioritizeEvaluation = (fen: string) => {
    if (evalCache[fen] !== undefined) return;
    
    // Move this FEN to the front of the queue
    setEvalQueue(prev => [fen, ...prev.filter(f => f !== fen)]);

    // Interrupt current evaluation if it is running and is NOT this fen
    if (engineStatus === 'evaluating' && evaluatingFenRef.current !== fen && workerRef.current) {
      if (evalTimeoutRef.current) clearTimeout(evalTimeoutRef.current);
      workerRef.current.postMessage('stop');
      evaluatingFenRef.current = null;
      setEngineStatus('ready');
    }
  };

  // Helper to check if it is the player's turn
  const getIsPlayersTurn = () => {
    if (gameMode !== 'play') return true;
    if (gameStatus !== 'active') return false;
    const tempChess = new Chess(loadedFenStart);
    for (let i = 0; i <= currentMoveIndex; i++) {
      tempChess.move(moves[i].san);
    }
    const activeColor = tempChess.turn();
    return (actualPlayerColor === 'white' && activeColor === 'w') || 
           (actualPlayerColor === 'black' && activeColor === 'b');
  };
  const isPlayersTurn = getIsPlayersTurn();

  // Apply AI move on the board
  const applyAiMove = (bestMove: string) => {
    if (bestMove === '(none)' || bestMove === 'none') {
      // AI has no moves, probably checkmate or stalemate
      return;
    }

    try {
      const from = bestMove.slice(0, 2);
      const to = bestMove.slice(2, 4);
      const promotion = bestMove.slice(4, 5) || undefined;

      const tempChess = new Chess(loadedFenStart);
      for (let i = 0; i <= currentMoveIndex; i++) {
        tempChess.move(moves[i].san);
      }

      const isOnlyMove = tempChess.moves().length === 1;

      const move = tempChess.move({ from, to, promotion });
      if (!move) {
        console.error("AI tried to make invalid move:", bestMove);
        setIsAiThinking(false);
        return;
      }

      const newMove: MoveItem = {
        san: move.san,
        from: move.from,
        to: move.to,
        piece: move.piece,
        fen: tempChess.fen(),
        isOnlyMove,
      };

      const updatedMoves = [...moves.slice(0, currentMoveIndex + 1), newMove];
      setMoves(updatedMoves);
      
      // Trigger evaluation for this new FEN immediately
      prioritizeEvaluation(newMove.fen);

      setCurrentMoveIndex(updatedMoves.length - 1);
      setPositionFen(newMove.fen);
      setIsAiThinking(false);

      // Check if game is over
      if (tempChess.isGameOver()) {
        if (tempChess.isCheckmate()) {
          setGameStatus('checkmate');
        } else if (tempChess.isDraw() || tempChess.isStalemate() || tempChess.isThreefoldRepetition() || tempChess.isInsufficientMaterial()) {
          setGameStatus('draw');
        }
      }
    } catch (e) {
      console.error("Error applying AI move:", e);
      setIsAiThinking(false);
    }
  };

  // Keep callback ref updated
  useEffect(() => {
    handleAiBestMoveRef.current = (bestMove: string) => {
      applyAiMove(bestMove);
    };
  });

  // Trigger AI move search
  const triggerAiMove = (currentMoves: MoveItem[], currentIndex: number) => {
    if (!aiWorkerRef.current || isAiThinking || gameStatus !== 'active') return;

    const tempChess = new Chess(loadedFenStart);
    for (let i = 0; i <= currentIndex; i++) {
      tempChess.move(currentMoves[i].san);
    }

    if (tempChess.isGameOver()) return;

    setIsAiThinking(true);
    setAiEngineStatus('thinking');

    let skillLevel = 6;
    let depth = 6;
    switch (aiDifficulty) {
      case 'easy':
        skillLevel = 0;
        depth = 2;
        break;
      case 'medium':
        skillLevel = 6;
        depth = 6;
        break;
      case 'hard':
        skillLevel = 12;
        depth = 10;
        break;
      case 'master':
        skillLevel = 20;
        depth = 15;
        break;
    }

    aiWorkerRef.current.postMessage(`setoption name Skill Level value ${skillLevel}`);
    aiWorkerRef.current.postMessage(`position fen ${tempChess.fen()}`);
    
    // Add artificial delay for human-like speed
    const delay = aiDifficulty === 'easy' ? 400 : (aiDifficulty === 'medium' ? 800 : 0);
    
    setTimeout(() => {
      if (aiWorkerRef.current) {
        aiWorkerRef.current.postMessage(`go depth ${depth}`);
      }
    }, delay);
  };

  // Listen for turn shifts to trigger AI player
  useEffect(() => {
    if (gameMode !== 'play' || gameStatus !== 'active' || isAiThinking) return;

    const tempChess = new Chess(loadedFenStart);
    for (let i = 0; i <= currentMoveIndex; i++) {
      tempChess.move(moves[i].san);
    }

    const activeColor = tempChess.turn();
    const isPlayersTurn = (actualPlayerColor === 'white' && activeColor === 'w') || 
                          (actualPlayerColor === 'black' && activeColor === 'b');

    if (!isPlayersTurn && !tempChess.isGameOver()) {
      triggerAiMove(moves, currentMoveIndex);
    }
  }, [currentMoveIndex, moves, gameMode, gameStatus, actualPlayerColor, aiDifficulty]);


  // Clear autoplay on unmount
  useEffect(() => {
    return () => {
      if (autoplayTimerRef.current) clearInterval(autoplayTimerRef.current);
    };
  }, []);

  // Handle autoplay stepping (waits for audio narration to finish)
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const step = () => {
      if (!isPlaying) return;

      // If audio is currently playing, check again in 500ms
      if (isPlayingAudio) {
        timeoutId = setTimeout(step, 500);
        return;
      }

      setCurrentMoveIndex((prevIndex) => {
        if (prevIndex < moves.length - 1) {
          const nextIndex = prevIndex + 1;
          setPositionFen(moves[nextIndex].fen);
          
          // Schedule next step in 3500ms
          timeoutId = setTimeout(step, 3500);
          return nextIndex;
        } else {
          setIsPlaying(false);
          return prevIndex;
        }
      });
    };

    if (isPlaying) {
      // Start the autoplay timer
      timeoutId = setTimeout(step, 3500);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isPlaying, isPlayingAudio, moves]);

  // Trigger synthesized sound effects on move changes
  const prevMoveIndexRef = useRef(currentMoveIndex);
  useEffect(() => {
    if (currentMoveIndex !== prevMoveIndexRef.current) {
      const prev = prevMoveIndexRef.current;
      prevMoveIndexRef.current = currentMoveIndex;
      
      // Play sound on stepping forward or backward
      if (currentMoveIndex > -1) {
        const move = moves[currentMoveIndex];
        if (move) {
          if (move.san.includes('#') || move.san.includes('+')) {
            playChessSound('check');
          } else if (move.san.includes('x')) {
            playChessSound('capture');
          } else {
            playChessSound('move');
          }
        }
      } else if (currentMoveIndex === -1 && prev > -1) {
        playChessSound('move'); // Board reset sound
      }
    }
  }, [currentMoveIndex, moves]);

  // Handle narration typing animation
  useEffect(() => {
    if (!narratorText) {
      setDisplayedNarration('');
      return;
    }

    setDisplayedNarration('');
    let index = 0;
    const interval = setInterval(() => {
      setDisplayedNarration((prev) => {
        if (index < narratorText.length) {
          const nextChar = narratorText.charAt(index);
          index++;
          return prev + nextChar;
        } else {
          clearInterval(interval);
          return prev;
        }
      });
    }, 15); // Fast, readable typewriter animation

    return () => clearInterval(interval);
  }, [narratorText]);

  // Compute chart path for Anime.js animation
  const getChartPathD = () => {
    if (moves.length === 0) return '';
    const width = 500;
    const height = 120;
    const padding = 15;
    const points: { x: number; y: number }[] = [];
    
    const startScoreVal = evalCache[loadedFenStart];
    const startScore = startScoreVal !== undefined ? Math.max(-800, Math.min(800, startScoreVal)) / 100 : 0;
    points.push({
      x: padding,
      y: height / 2 - (startScore / 8) * (height / 2 - padding)
    });
    
    moves.forEach((move, idx) => {
      const scoreVal = evalCache[move.fen];
      const score = scoreVal !== undefined ? Math.max(-800, Math.min(800, scoreVal)) / 100 : 0;
      const x = padding + (idx + 1) * ((width - padding * 2) / moves.length);
      const y = height / 2 - (score / 8) * (height / 2 - padding);
      points.push({ x, y });
    });
    
    let pathD = '';
    points.forEach((pt, i) => {
      if (i === 0) pathD += `M ${pt.x} ${pt.y}`;
      else pathD += ` L ${pt.x} ${pt.y}`;
    });
    return pathD;
  };

  const chartPathD = getChartPathD();

  useEffect(() => {
    if (!chartPathD) {
      prevChartPathRef.current = '';
      return;
    }
    if (chartPathRef.current) {
      if (!prevChartPathRef.current) {
        chartPathRef.current.setAttribute('d', chartPathD);
        prevChartPathRef.current = chartPathD;
      } else {
        animate(chartPathRef.current, {
          d: [
            { value: prevChartPathRef.current },
            { value: chartPathD }
          ],
          easing: 'easeOutQuad',
          duration: 350,
          onComplete: () => {
            prevChartPathRef.current = chartPathD;
          }
        });
      }
    }
  }, [chartPathD]);

  // Speak narrator commentary (TTS)
  const speakText = (text: string) => {
    // 1. Always stop any ongoing Gemini audio
    stopGeminiAudio();
    
    // 2. Always cancel any ongoing browser speech
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    const cleanText = text
      .replace(/\[.*?\]/g, '') // strip brackets
      .replace(/Challenge!/g, '') // strip challenge exclamation
      .replace(/\b\d+\.\s*(\.+\s*)?/g, '') // strip move numbers like "1." or "12. ..."
      .replace(/[+#]/g, '') // strip check (+) and checkmate (#) symbols
      .trim();
    
    if (!cleanText) return;

    // 3. If Gemini is enabled and key is available, use Gemini TTS
    if (useGemini && geminiApiKey.trim()) {
      setIsPlayingAudio(true);
      speakTextWithGemini(cleanText, narratorPersonality, geminiApiKey)
        .then(() => {
          setIsPlayingAudio(false);
          setTtsStatus('success');
          setTtsErrorMessage('');
        })
        .catch((err) => {
          console.error("Gemini TTS playback failed, falling back to Web Speech:", err);
          setTtsStatus('error');
          setTtsErrorMessage(err.message || String(err));
          fallbackSpeak(cleanText);
        });
    } else {
      // 4. Otherwise use fallback local browser speech synthesis
      fallbackSpeak(cleanText);
    }
  };

  const fallbackSpeak = (cleanText: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = getBestLocalVoice(voices, narratorPersonality);
    
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    
    // Choose pitch and rate based on personality
    if (narratorPersonality === 'pirate') {
      utterance.pitch = 0.7;
      utterance.rate = 0.9;
    } else if (narratorPersonality === 'grandmaster') {
      utterance.pitch = 0.85;
      utterance.rate = 0.95;
    } else if (narratorPersonality === 'supportive') {
      utterance.pitch = 1.05;
      utterance.rate = 1.0;
    } else {
      utterance.pitch = 1.0;
      utterance.rate = 1.05;
    }
    
    utterance.onend = () => setIsPlayingAudio(false);
    utterance.onerror = () => setIsPlayingAudio(false);
    
    setIsPlayingAudio(true);
    window.speechSynthesis.speak(utterance);
  };

  // Trigger narration logic when current position changes
  useEffect(() => {
    const activeFen = currentMoveIndex === -1 ? loadedFenStart : moves[currentMoveIndex]?.fen;
    if (!activeFen) return;

    // Check if settings or FEN changed to prevent redundant commentary triggers
    const settingsChanged = lastSettingsRef.current.personality !== narratorPersonality || lastSettingsRef.current.useGemini !== useGemini;
    if (lastNarratedFenRef.current === activeFen && !settingsChanged) {
      return;
    }

    if (currentMoveIndex === -1) {
      setNarratorText("Ready to analyze. Make a move or choose a historical game to step through the moves.");
      lastNarratedFenRef.current = activeFen;
      lastSettingsRef.current = { personality: narratorPersonality, useGemini };
      return;
    }

    const move = moves[currentMoveIndex];
    if (!move) return;
    const fen_curr = move.fen;
    const fen_prev = currentMoveIndex === 0 ? loadedFenStart : (moves[currentMoveIndex - 1]?.fen || loadedFenStart);
    
    prioritizeEvaluation(fen_curr);
    prioritizeEvaluation(fen_prev);

    const score_curr = evalCache[fen_curr];
    const score_prev = evalCache[fen_prev];

    if (score_curr === undefined || score_prev === undefined) {
      setNarratorText("Calculating evaluation of this junction... Hang on.");
      return;
    }

    // Mark as narrated (or in progress) so we don't trigger it again
    lastNarratedFenRef.current = activeFen;
    lastSettingsRef.current = { personality: narratorPersonality, useGemini };

    const isWhite = currentMoveIndex % 2 === 0;
    const change = isWhite ? (score_curr - score_prev) : (score_prev - score_curr);
    const isBook = isMoveBook(currentMoveIndex, moves);
    const prevFen = currentMoveIndex === 0 ? loadedFenStart : moves[currentMoveIndex - 1]?.fen;
    const bestMove = bestMovesCache[prevFen] || '';
    
    const qualityInfo = getMoveQualityInfo(currentMoveIndex);
    const baseQuality = qualityInfo ? qualityInfo.quality : 'good';

    // Map book moves to 'best' or 'good' based on engine evaluation for narration
    const narrationQuality = isBook 
      ? (baseQuality === 'excellent' || baseQuality === 'best' ? 'best' : 'good') 
      : baseQuality;

    let isCurrent = true;

    const tempChessForEnd = new Chess(loadedFenStart);
    for (let i = 0; i <= currentMoveIndex; i++) {
      tempChessForEnd.move(moves[i].san);
    }
    const isCheckmate = tempChessForEnd.isCheckmate();
    const isDraw = tempChessForEnd.isDraw();

    const generateCommentary = async () => {
      let response = '';
      if (useGemini && geminiApiKey.trim()) {
        setNarratorText("Consulting Gemini AI's chess wits...");
        response = await generateGeminiCommentary(
          move, 
          narrationQuality, 
          change / 100, 
          bestMove, 
          narratorPersonality, 
          geminiApiKey,
          isCheckmate,
          isDraw
        );
      } else {
        response = getWittyCritique(move, narrationQuality as any, change, narratorPersonality);
        if (isDraw) {
          const drawComments = {
            sarcastic: " And it's a draw. Neither of you could find a way to win. Fascinating.",
            supportive: " The game ended in a draw! A very hard-fought battle by both sides.",
            grandmaster: " Draw. The position is completely simplified or drawn by rule. Standard resolution.",
            pirate: " Shiver me timbers, it's a draw! No loot for either of us today!"
          };
          response += drawComments[narratorPersonality] || drawComments.sarcastic;
        }
      }

      if (isCurrent) {
        setNarratorText(response);
        if (autoSpeak) speakText(response);
      }
    };

    generateCommentary();

    return () => {
      isCurrent = false;
    };
  }, [currentMoveIndex, moves, loadedFenStart, evalCache, bestMovesCache, narratorPersonality, useGemini, geminiApiKey, autoSpeak]);

  // Load PGN
  const handleLoadPgn = (pgnStr: string) => {
    setError('');
    setIsPlaying(false);
    try {
      const cleanPgn = pgnStr.trim();
      if (!cleanPgn) {
        setError('Please enter a PGN string.');
        return;
      }

      const tempChess = new Chess();
      tempChess.loadPgn(cleanPgn);
      
      const history = tempChess.history({ verbose: true });
      const replayChess = new Chess();
      const movesWithFen: MoveItem[] = [];

      for (const m of history) {
        const isOnlyMove = replayChess.moves().length === 1;
        replayChess.move(m.san);
        movesWithFen.push({
          san: m.san,
          from: m.from,
          to: m.to,
          piece: m.piece,
          fen: replayChess.fen(),
          isOnlyMove,
        });
      }

      // Interrupt any current evaluation
      if (workerRef.current) {
        if (evalTimeoutRef.current) clearTimeout(evalTimeoutRef.current);
        workerRef.current.postMessage('stop');
        evaluatingFenRef.current = null;
      }

      setMoves(movesWithFen);
      setLoadedFenStart(SAMPLE_FEN);
      
      // Reset caches for the new game but preserve starting position
      setEvalCache({ [SAMPLE_FEN]: 35 });
      setBestMovesCache({});
      setEvalQueue([SAMPLE_FEN, ...movesWithFen.map(m => m.fen)]);

      setCurrentMoveIndex(-1);
      setPositionFen(SAMPLE_FEN);

      // Reset narration tracking
      lastNarratedFenRef.current = null;
      setShowGameReview(false);
      setGameReviewText('');
      setIsGeneratingReview(false);
    } catch (err: any) {
      setError('Invalid PGN format. Please verify the move syntax.');
    }
  };

  // Load FEN
  const handleLoadFen = (fenStr: string) => {
    setError('');
    setIsPlaying(false);
    try {
      const cleanFen = fenStr.trim();
      if (!cleanFen) {
        setError('Please enter a FEN string.');
        return;
      }

      const tempChess = new Chess();
      tempChess.load(cleanFen); // Throws if invalid

      // Interrupt any current evaluation
      if (workerRef.current) {
        if (evalTimeoutRef.current) clearTimeout(evalTimeoutRef.current);
        workerRef.current.postMessage('stop');
        evaluatingFenRef.current = null;
      }

      setMoves([]);
      setLoadedFenStart(cleanFen);
      setEvalCache({});
      setBestMovesCache({});
      setEvalQueue([cleanFen]);
      
      setCurrentMoveIndex(-1);
      setPositionFen(cleanFen);

      // Reset narration tracking
      lastNarratedFenRef.current = null;
      setShowGameReview(false);
      setGameReviewText('');
      setIsGeneratingReview(false);
    } catch (err: any) {
      setError('Invalid FEN format. Verify the configuration values and piece placement.');
    }
  };

  const handleStartPlayGame = () => {
    setError('');
    setIsPlaying(false);
    
    let chosenColor: 'white' | 'black' = 'white';
    if (playerColor === 'random') {
      chosenColor = Math.random() < 0.5 ? 'white' : 'black';
    } else {
      chosenColor = playerColor;
    }
    
    setActualPlayerColor(chosenColor);
    setBoardOrientation(chosenColor);
    
    setMoves([]);
    const startFen = loadedFenStart || SAMPLE_FEN;
    setLoadedFenStart(startFen);
    
    setEvalCache({});
    setBestMovesCache({});
    setEvalQueue([startFen]);
    
    setCurrentMoveIndex(-1);
    setPositionFen(startFen);
    
    setGameStatus('active');
    setIsAiThinking(false);
    
    lastNarratedFenRef.current = null;
    setShowGameReview(false);
    setGameReviewText('');
    setIsGeneratingReview(false);
  };

  const handleResign = () => {
    setGameStatus('resigned');
    setIsPlaying(false);
    
    const resignationComments = {
      sarcastic: "Folding the tent already? I suppose saving yourself the embarrassment is a strategy.",
      supportive: "It was a tough game, but resigning shows great respect and sportsmanship. Let's analyze and improve!",
      grandmaster: "A standard decision. The position was lost positional chess. Resignation is the proper etiquette here.",
      pirate: "Arrr! Ye raised the white flag! Safe voyage back to land, matey!"
    };
    
    const comment = resignationComments[narratorPersonality] || resignationComments.sarcastic;
    setNarratorText(comment);
    if (autoSpeak) speakText(comment);
  };

  // Jump to specific index in moves history
  const jumpToMove = (index: number) => {
    setIsPlaying(false);
    if (index < -1 || index >= moves.length) return;
    setCurrentMoveIndex(index);
    if (index === -1) {
      setPositionFen(loadedFenStart);
    } else {
      setPositionFen(moves[index].fen);
    }
  };


  // Handle piece drop on board
  const onDrop = (sourceSquare: string, targetSquare: string) => {
    // Play mode checks
    if (gameMode === 'play') {
      if (gameStatus !== 'active') return false;
      if (isAiThinking) return false;
      if (!isPlayersTurn) return false;
    }

    try {
      const tempChess = new Chess(loadedFenStart);
      
      // Replay moves up to current index
      for (let i = 0; i <= currentMoveIndex; i++) {
        tempChess.move(moves[i].san);
      }

      const isOnlyMove = tempChess.moves().length === 1;

      const move = tempChess.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q', // auto-promote to Queen for simplicity
      });

      if (!move) return false;

      const newMove: MoveItem = {
        san: move.san,
        from: move.from,
        to: move.to,
        piece: move.piece,
        fen: tempChess.fen(),
        isOnlyMove,
      };

      const updatedMoves = [...moves.slice(0, currentMoveIndex + 1), newMove];
      setMoves(updatedMoves);
      
      // Trigger evaluation for this new FEN immediately
      prioritizeEvaluation(newMove.fen);

      setCurrentMoveIndex(updatedMoves.length - 1);
      setPositionFen(newMove.fen);

      // Check if game is over
      if (gameMode === 'play') {
        if (tempChess.isGameOver()) {
          if (tempChess.isCheckmate()) {
            setGameStatus('checkmate');
          } else if (tempChess.isDraw() || tempChess.isStalemate() || tempChess.isThreefoldRepetition() || tempChess.isInsufficientMaterial()) {
            setGameStatus('draw');
          }
        }
      }

      return true;
    } catch (e) {
      return false;
    }
  };

  // Calculate move quality details helper
  const getMoveQualityInfo = (index: number) => {
    if (index < 0 || index >= moves.length) return null;
    const move = moves[index];
    const fen_curr = move.fen;
    const fen_prev = index === 0 ? loadedFenStart : moves[index - 1].fen;
    
    if (isMoveBook(index, moves)) {
      return { 
        quality: 'book' as const, 
        label: 'Book Move', 
        colorClass: 'text-[#8b5a2b] font-semibold', 
        badgeColor: 'bg-[#8b5a2b]', 
        icon: '📖',
        change: 0 
      };
    }
    
    const score_curr = evalCache[fen_curr];
    const score_prev = evalCache[fen_prev];
    
    if (score_curr === undefined || score_prev === undefined) return null;
    
    const isWhite = index % 2 === 0;
    const change = isWhite ? (score_curr - score_prev) : (score_prev - score_curr);
    
    const bestMove = bestMovesCache[fen_prev];
    const isBestMove = bestMove === (move.from + move.to);
    const isCapture = move.san.includes('x');
    const isCheck = move.san.includes('+') || move.san.includes('#');
    
    let quality: 'only_move' | 'brilliant' | 'blunder' | 'mistake' | 'dubious' | 'interesting' | 'unclear' | 'excellent' | 'best' | 'good' = 'good';
    let label = 'Good Move';
    let colorClass = 'text-emerald-600 font-medium';
    let badgeColor = 'bg-emerald-600/80';
    let icon = '!';
    
    if (move.isOnlyMove) {
      quality = 'only_move';
      label = 'Only Move';
      colorClass = 'text-slate-400 font-semibold';
      badgeColor = 'bg-slate-400';
      icon = '□';
    } else if (isBestMove && (change >= 100 || (isCapture && change >= 50))) {
      // Brilliant move: top recommendation + substantial improvement or capture sacrifice
      quality = 'brilliant';
      label = 'Brilliant';
      colorClass = 'text-[#26c6da] font-extrabold';
      badgeColor = 'bg-[#26c6da]';
      icon = '!!';
    } else if (change <= -200) {
      quality = 'blunder';
      label = 'Blunder';
      colorClass = 'text-red-500 font-semibold';
      badgeColor = 'bg-red-500';
      icon = '??';
    } else if (change <= -80) {
      quality = 'mistake';
      label = 'Mistake';
      colorClass = 'text-amber-500 font-semibold';
      badgeColor = 'bg-amber-500';
      icon = '?';
    } else if (change <= -50) {
      // Dubious: drop of 50-80 centipawns
      quality = 'dubious';
      label = 'Dubious';
      colorClass = 'text-[#ab47bc] font-semibold';
      badgeColor = 'bg-[#ab47bc]';
      icon = '?!';
    } else if (!isBestMove && (isCheck || isCapture) && change <= -35) {
      // Interesting: speculative move (check or capture) with some drop but complex
      quality = 'interesting';
      label = 'Interesting';
      colorClass = 'text-[#ec407a] font-semibold';
      badgeColor = 'bg-[#ec407a]';
      icon = '!?';
    } else if (Math.abs(score_curr) <= 100 && !isBestMove && change >= -15 && change <= 15) {
      quality = 'unclear';
      label = 'Unclear Position';
      colorClass = 'text-[#78909c] font-semibold';
      badgeColor = 'bg-[#78909c]';
      icon = '∞';
    } else if (!isBestMove && change >= -15 && change < 0) {
      quality = 'excellent';
      label = 'Excellent';
      colorClass = 'text-[#66bb6a] font-semibold';
      badgeColor = 'bg-[#66bb6a]';
      icon = '★';
    } else if (isBestMove || change >= 0) {
      quality = 'best';
      label = 'Best Move';
      colorClass = 'text-emerald-500 font-semibold';
      badgeColor = 'bg-emerald-500';
      icon = '!';
    } else {
      // Good Move fallback: not best move, evaluation change is between -35 and -15
      quality = 'good';
      label = 'Good Move';
      colorClass = 'text-emerald-600 font-medium';
      badgeColor = 'bg-emerald-600/80';
      icon = '!';
    }
    
    return { quality, label, colorClass, badgeColor, icon, change: change / 100 };
  };

  // Helper to calculate summary statistics for white and black
  const calculateStats = () => {
    const whiteStats = { brilliant: 0, best: 0, excellent: 0, good: 0, book: 0, interesting: 0, dubious: 0, mistake: 0, blunder: 0, only_move: 0, unclear: 0 };
    const blackStats = { brilliant: 0, best: 0, excellent: 0, good: 0, book: 0, interesting: 0, dubious: 0, mistake: 0, blunder: 0, only_move: 0, unclear: 0 };
    
    moves.forEach((move, idx) => {
      const isWhite = idx % 2 === 0;
      const stats = isWhite ? whiteStats : blackStats;
      
      if (isMoveBook(idx, moves)) {
        stats.book++;
        return;
      }
      
      const qualityInfo = getMoveQualityInfo(idx);
      if (qualityInfo) {
        const q = qualityInfo.quality;
        if (q in stats) {
          stats[q as keyof typeof stats]++;
        } else {
          stats.good++;
        }
      } else {
        stats.good++;
      }
    });
    
    return { whiteStats, blackStats };
  };

  // Check if all moves in the game have been evaluated
  const isGameFullyEvaluated = () => {
    if (moves.length === 0) return false;
    if (evalCache[loadedFenStart] === undefined) return false;
    for (const m of moves) {
      if (evalCache[m.fen] === undefined) return false;
    }
    return true;
  };

  // Get count of evaluated positions
  const getEvaluatedCount = () => {
    let count = 0;
    if (evalCache[loadedFenStart] !== undefined) count++;
    moves.forEach(m => {
      if (evalCache[m.fen] !== undefined) count++;
    });
    return count;
  };

  // Move Quality Weights for Accuracy Calculations
  const QUALITY_WEIGHTS: Record<string, number> = {
    brilliant: 100,
    best: 100,
    only_move: 100,
    book: 100,
    excellent: 95,
    good: 80,
    interesting: 75,
    unclear: 70,
    dubious: 50,
    mistake: 30,
    blunder: 0
  };

  // Calculate Accuracy percentage for White or Black
  const calculateAccuracy = (color: 'white' | 'black') => {
    let totalWeight = 0;
    let count = 0;

    moves.forEach((_, idx) => {
      const isWhite = idx % 2 === 0;
      if ((color === 'white' && !isWhite) || (color === 'black' && isWhite)) return;

      const qualityInfo = getMoveQualityInfo(idx);
      const quality = qualityInfo ? qualityInfo.quality : 'good';
      totalWeight += QUALITY_WEIGHTS[quality] !== undefined ? QUALITY_WEIGHTS[quality] : 80;
      count++;
    });

    return count > 0 ? Math.round(totalWeight / count) : 100;
  };

  // Estimate Elo based on Accuracy
  const estimateElo = (accuracy: number) => {
    return Math.round(400 + Math.pow(accuracy / 100, 2) * 2100);
  };

  // Find the turning point of the game (largest evaluation drop)
  const getTurningPoint = () => {
    let maxDrop = 0;
    let turningMoveIdx = -1;
    let turningPlayer = '';
    
    moves.forEach((_, idx) => {
      if (isMoveBook(idx, moves)) return;
      const qualityInfo = getMoveQualityInfo(idx);
      if (!qualityInfo) return;
      
      if (qualityInfo.change < 0) {
        const drop = Math.abs(qualityInfo.change);
        if (drop > maxDrop) {
          maxDrop = drop;
          turningMoveIdx = idx;
          turningPlayer = idx % 2 === 0 ? 'White' : 'Black';
        }
      }
    });
    
    return { idx: turningMoveIdx, player: turningPlayer, drop: maxDrop };
  };

  // Offline local fallback report card summary builder
  const generateLocalReportCard = (
    whiteAccuracy: number,
    blackAccuracy: number,
    whiteElo: number,
    blackElo: number,
    whiteStats: any,
    blackStats: any,
    personality: string
  ) => {
    const turningPoint = getTurningPoint();
    let turningText = '';
    if (turningPoint.idx !== -1) {
      const moveNum = Math.floor(turningPoint.idx / 2) + 1;
      const isWhite = turningPoint.idx % 2 === 0;
      const moveStr = `${moveNum}.${isWhite ? '' : '..'}${moves[turningPoint.idx].san}`;
      turningText = `The critical turning point was on move ${moveStr}, where ${turningPoint.player} dropped ${turningPoint.drop.toFixed(2)} pawns.`;
    }

    let intro = '';
    let comparison = '';
    let advice = '';

    if (personality === 'pirate') {
      intro = `Ahoy! A fine battle on the high seas! White fought with an accuracy of ${whiteAccuracy}% (Estimated Rating: ${whiteElo}), while Black sailed with ${blackAccuracy}% (Estimated Rating: ${blackElo}).`;
      if (turningText) {
        comparison = ` Shiver me timbers! ${turningText} This is where the crew walked the plank!`;
      }
      advice = ` Keep yer eyes on the horizon and guard yer treasure next time, ye scallywags!`;
    } else if (personality === 'sarcastic') {
      intro = `Well, that was certainly a game of chess. White played with ${whiteAccuracy}% accuracy (Elo: ${whiteElo}), and Black managed ${blackAccuracy}% (Elo: ${blackElo}).`;
      if (turningText) {
        comparison = ` ${turningText} Stockfish wept. A truly historic donation of material.`;
      } else {
        comparison = ` Surprisingly, neither side blundered into oblivion. A miracle.`;
      }
      advice = ` Perhaps both of you should practice against a brick wall. It might make fewer mistakes.`;
    } else if (personality === 'grandmaster') {
      intro = `The match concluded with White showing an accuracy rating of ${whiteAccuracy}% (Est. Elo: ${whiteElo}), compared to Black's ${blackAccuracy}% (Est. Elo: ${blackElo}).`;
      if (turningText) {
        comparison = ` Positional balance collapsed under pressure. ${turningText} This tactical error determined the outcome.`;
      }
      advice = ` Refine your opening setups and focus on calculating forcing lines.`;
    } else {
      intro = `What a fantastic game! White played with a wonderful ${whiteAccuracy}% accuracy (Estimated Elo: ${whiteElo}), and Black showed great effort at ${blackAccuracy}% (Estimated Elo: ${blackElo}).`;
      if (turningText) {
        comparison = ` ${turningText} Don't worry, mistakes are the best way to learn!`;
      }
      advice = ` Focus on keeping your pieces defended and look out for forks. Keep practicing!`;
    }

    return `${intro}${comparison}${advice}`;
  };

  // Render the post-game review panel
  const renderGameReview = () => {
    const { whiteStats, blackStats } = calculateStats();
    const whiteAccuracy = calculateAccuracy('white');
    const blackAccuracy = calculateAccuracy('black');
    const whiteElo = estimateElo(whiteAccuracy);
    const blackElo = estimateElo(blackAccuracy);

    // Filter key moments (Brilliants, Blunders, Mistakes)
    const keyMoments: { idx: number; move: MoveItem; qualityInfo: any; isWhite: boolean }[] = [];
    moves.forEach((move, idx) => {
      const qualityInfo = getMoveQualityInfo(idx);
      if (qualityInfo && (qualityInfo.quality === 'brilliant' || qualityInfo.quality === 'blunder' || qualityInfo.quality === 'mistake')) {
        keyMoments.push({ idx, move, qualityInfo, isWhite: idx % 2 === 0 });
      }
    });

    const handleGenerateReview = async () => {
      setIsGeneratingReview(true);
      try {
        let review = '';
        if (useGemini && geminiApiKey.trim()) {
          const turningPoint = getTurningPoint();
          let turningPointText = '';
          if (turningPoint.idx !== -1) {
            const moveNum = Math.floor(turningPoint.idx / 2) + 1;
            const isWhite = turningPoint.idx % 2 === 0;
            const moveStr = `${moveNum}.${isWhite ? '' : '..'}${moves[turningPoint.idx].san}`;
            turningPointText = `The critical turning point occurred on move ${moveStr} when ${turningPoint.player} made a mistake/blunder that dropped the evaluation by ${turningPoint.drop.toFixed(2)} pawns.`;
          }

          const pgnString = moves.map((m, i) => `${i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}${m.san}`).join(' ');

          const prompt = `You are a professional, witty chess coach and analyst. Write a post-game "report card" summary for this chess match in the voice of a ${narratorPersonality} chess commentator.
Here are the game details:
Moves played: ${pgnString}
White Accuracy: ${whiteAccuracy}% (Estimated Elo: ${whiteElo})
Black Accuracy: ${blackAccuracy}% (Estimated Elo: ${blackElo})
White Move Breakdown: Brilliants: ${whiteStats.brilliant}, Bests: ${whiteStats.best}, Excellents: ${whiteStats.excellent}, Goods: ${whiteStats.good}, Books: ${whiteStats.book}, Mistakes: ${whiteStats.mistake}, Blunders: ${whiteStats.blunder}
Black Move Breakdown: Brilliants: ${blackStats.brilliant}, Bests: ${blackStats.best}, Excellents: ${blackStats.excellent}, Goods: ${blackStats.good}, Books: ${blackStats.book}, Mistakes: ${blackStats.mistake}, Blunders: ${blackStats.blunder}
${turningPointText}

Please write a cohesive, engaging summary paragraph of about 80-120 words. Focus on the overall narrative of the game, how the players started, the critical turning point, and what they need to work on. Speak directly to the players or the reader. Keep the tone highly customized to your ${narratorPersonality} personality (e.g. dry sarcastic jabs for sarcastic, pirate lingo for pirate, supportive advice for supportive, and strict academic positional analysis for grandmaster). Do not include FEN coordinates or raw score change numbers.`;

          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey.trim()}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  maxOutputTokens: 250,
                  temperature: 0.85
                }
              })
            }
          );

          if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error?.message || 'API request failed');
          }

          const data = await res.json();
          review = data.contents?.[0]?.parts?.[0]?.text || '';
          review = review.trim().replace(/^"|"$/g, '');
        } else {
          review = generateLocalReportCard(whiteAccuracy, blackAccuracy, whiteElo, blackElo, whiteStats, blackStats, narratorPersonality);
        }
        setGameReviewText(review);
      } catch (err: any) {
        console.error("Game Review API Error:", err);
        const fallback = generateLocalReportCard(whiteAccuracy, blackAccuracy, whiteElo, blackElo, whiteStats, blackStats, narratorPersonality);
        setGameReviewText(`[Gemini Error: ${err.message}]. Fallback:\n\n${fallback}`);
      } finally {
        setIsGeneratingReview(false);
      }
    };

    return (
      <div className="flex flex-col gap-5 flex-grow animate-fadeIn">
        {/* 1. Accuracy & Estimated Elo Panels */}
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-brand-hairline rounded-md p-4 bg-brand-canvas shadow-lvl2 text-center flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase text-brand-body">White Accuracy</span>
            <span className="text-3xl font-sans font-semibold text-brand-ink">{whiteAccuracy}%</span>
            <span className="text-xs font-mono text-brand-mute">Est. Rating: {whiteElo}</span>
          </div>

          <div className="border border-brand-hairline rounded-md p-4 bg-brand-canvas shadow-lvl2 text-center flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase text-brand-body">Black Accuracy</span>
            <span className="text-3xl font-sans font-semibold text-brand-ink">{blackAccuracy}%</span>
            <span className="text-xs font-mono text-brand-mute">Est. Rating: {blackElo}</span>
          </div>
        </div>

        {/* 2. AI Coach Review Summary */}
        <div className="border border-brand-hairline rounded-md p-4 bg-brand-canvas-soft2 flex flex-col gap-3">
          <div className="flex justify-between items-center select-none">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-brand-ink">
              AI Coach Report Card
            </h3>
            {gameReviewText && (
              <button
                onClick={() => speakText(gameReviewText)}
                className="p-1.5 rounded-sm border border-brand-hairline bg-brand-canvas hover:bg-brand-canvas-soft2 text-brand-body hover:text-brand-ink transition-colors cursor-pointer"
                title="Listen to summary"
                aria-label="Listen to report card summary"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"></path>
                </svg>
              </button>
            )}
          </div>

          {gameReviewText ? (
            <p className="text-xs font-sans text-brand-body leading-relaxed whitespace-pre-line animate-fadeIn">
              {gameReviewText}
            </p>
          ) : (
            <div className="py-4 text-center">
              <p className="text-xs text-brand-body mb-3">
                Get a personalized tactical breakdown of your match.
              </p>
              <button
                onClick={handleGenerateReview}
                disabled={isGeneratingReview}
                className="px-4 py-2 rounded-pill text-xs font-semibold bg-brand-primary text-brand-on-primary hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer shadow-lvl2"
              >
                {isGeneratingReview ? 'Analyzing Game Narrative...' : 'Generate Game Review'}
              </button>
            </div>
          )}
        </div>

        {/* 3. Key Moments Navigation */}
        <div className="flex-grow">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-brand-ink mb-3 select-none">
            Key Moments ({keyMoments.length})
          </h3>
          {keyMoments.length > 0 ? (
            <div className="flex flex-wrap gap-2 max-h-[160px] overflow-y-auto pr-1">
              {keyMoments.map(({ idx, move, qualityInfo, isWhite }) => {
                const moveNum = Math.floor(idx / 2) + 1;
                const isSelected = idx === currentMoveIndex;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setCurrentMoveIndex(idx);
                      setPositionFen(move.fen);
                    }}
                    className={`px-2.5 py-1.5 rounded-sm text-xs font-mono transition-all border flex items-center gap-1.5 cursor-pointer shadow-lvl1 hover:shadow-lvl2 ${
                      isSelected
                        ? 'border-brand-accent bg-brand-accent/5 text-brand-ink ring-1 ring-brand-accent'
                        : 'border-brand-hairline bg-brand-canvas text-brand-body hover:text-brand-ink'
                    }`}
                  >
                    <span>{qualityInfo.icon}</span>
                    <span className="font-semibold text-brand-ink">
                      {moveNum}{isWhite ? '.' : '..'}{move.san}
                    </span>
                    <span className={`text-[10px] lowercase ${qualityInfo.colorClass}`}>
                      ({qualityInfo.label})
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs font-mono text-brand-mute italic py-2">
              No major blunders or mistakes detected. An exceptionally clean game!
            </p>
          )}
        </div>
      </div>
    );
  };

  // Helper to copy FEN or PGN to clipboard
  const handleCopyText = (type: 'fen' | 'pgn') => {
    const textToCopy = type === 'fen' ? positionFen : (
      moves.map((m, i) => `${i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}${m.san}`).join(' ')
    );
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(textToCopy);
      setCopiedText(type);
      setTimeout(() => setCopiedText(null), 2000);
    }
  };

  // Highlight squares from the last move based on move quality
  const getCustomSquareStyles = () => {
    if (currentMoveIndex === -1 || !moves[currentMoveIndex]) return {};
    const lastMove = moves[currentMoveIndex];
    
    const styles: Record<string, any> = {
      [lastMove.from]: {
        backgroundColor: 'rgba(0, 112, 243, 0.12)',
      }
    };
    
    const qualityInfo = getMoveQualityInfo(currentMoveIndex);
    if (qualityInfo) {
      const highlightColors: Record<string, string> = {
        book: 'rgba(139, 90, 43, 0.25)',
        brilliant: 'rgba(38, 198, 218, 0.25)',
        best: 'rgba(16, 185, 129, 0.25)',
        excellent: 'rgba(102, 187, 106, 0.25)',
        only_move: 'rgba(148, 163, 184, 0.25)',
        unclear: 'rgba(120, 144, 156, 0.25)',
        interesting: 'rgba(236, 64, 122, 0.25)',
        dubious: 'rgba(171, 71, 188, 0.25)',
        mistake: 'rgba(249, 115, 22, 0.25)',
        blunder: 'rgba(239, 68, 68, 0.25)',
        good: 'rgba(0, 112, 243, 0.15)',
      };
      
      const bgColor = highlightColors[qualityInfo.quality] || 'rgba(0, 112, 243, 0.25)';
      styles[lastMove.to] = { backgroundColor: bgColor };
    } else {
      styles[lastMove.to] = { backgroundColor: 'rgba(0, 112, 243, 0.25)' };
    }
    
    return styles;
  };

  // Render SVG Evaluation Line Chart
  const renderEvalChart = () => {
    if (moves.length === 0) return null;
    
    const width = 500;
    const height = 120;
    const padding = 15;
    
    const points: { x: number; y: number; index: number; score: number }[] = [];
    
    // Start position
    const startScoreVal = evalCache[loadedFenStart];
    const startScore = startScoreVal !== undefined ? Math.max(-800, Math.min(800, startScoreVal)) / 100 : 0;
    
    points.push({
      x: padding,
      y: height / 2 - (startScore / 8) * (height / 2 - padding),
      index: -1,
      score: startScore
    });
    
    moves.forEach((move, idx) => {
      const scoreVal = evalCache[move.fen];
      const score = scoreVal !== undefined ? Math.max(-800, Math.min(800, scoreVal)) / 100 : 0;
      
      const x = padding + (idx + 1) * ((width - padding * 2) / moves.length);
      const y = height / 2 - (score / 8) * (height / 2 - padding);
      
      points.push({ x, y, index: idx, score });
    });
    
    let pathD = '';
    points.forEach((pt, i) => {
      if (i === 0) pathD += `M ${pt.x} ${pt.y}`;
      else pathD += ` L ${pt.x} ${pt.y}`;
    });
    
    return (
      <div className="mt-4 bg-brand-canvas border border-brand-hairline rounded-md p-4 shadow-lvl2 w-full max-w-[500px]">
        <div className="text-xs font-mono font-bold text-brand-ink mb-3 flex justify-between items-center select-none">
          <span>Game Evaluation Chart</span>
          <span className="text-[10px] text-brand-body font-normal">Click point to jump to move</span>
        </div>
        <div className="relative w-full h-[120px]">
          <svg className="w-full h-full overflow-visible" viewBox={`0 0 ${width} ${height}`}>
            {/* Midline (Equal evaluation) */}
            <line 
              x1={padding} 
              y1={height / 2} 
              x2={width - padding} 
              y2={height / 2} 
              stroke="var(--color-brand-hairline-strong)" 
              strokeDasharray="2 3"
              strokeWidth="1"
              opacity="0.4"
            />
            
            {/* Advantage labels */}
            <text x={padding + 5} y={padding + 8} className="text-[8px] font-mono fill-brand-body" opacity="0.6">White +8.0</text>
            <text x={padding + 5} y={height - padding + 5} className="text-[8px] font-mono fill-brand-body" opacity="0.6">Black +8.0</text>
            
            {/* Main Line path (Animated via Anime.js) */}
            {pathD && (
              <path 
                ref={chartPathRef}
                d={prevChartPathRef.current || pathD}
                fill="none" 
                stroke="var(--color-brand-accent)" 
                strokeWidth="2.5" 
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            
            {/* Clickable node points */}
            {points.map((pt, i) => {
              const isActive = currentMoveIndex === pt.index;
              return (
                <g key={i} className="group cursor-pointer" onClick={() => jumpToMove(pt.index)}>
                  {isActive ? (
                    <motion.circle 
                      cx={pt.x} 
                      cy={pt.y} 
                      initial={{ r: 3.5 }}
                      animate={{ r: [3.5, 6.5, 5.5] }}
                      transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                      fill="var(--color-brand-accent)" 
                      stroke="var(--color-brand-accent)" 
                      strokeWidth={2}
                    />
                  ) : (
                    <circle 
                      cx={pt.x} 
                      cy={pt.y} 
                      r={3.5} 
                      fill="var(--color-brand-canvas)" 
                      stroke="var(--color-brand-accent)" 
                      strokeWidth={1.5}
                      className="transition-all hover:scale-150 duration-150"
                    />
                  )}
                  <title>
                    {pt.index === -1 ? 'Start' : `Move ${Math.floor(pt.index / 2) + 1} ${pt.index % 2 === 0 ? 'White' : 'Black'}`} ({pt.score > 0 ? '+' : ''}{pt.score.toFixed(1)})
                  </title>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  };

  // Render moves statistics summary dashboard
  const renderStatsSummary = () => {
    if (moves.length === 0) return null;
    const { whiteStats, blackStats } = calculateStats();
    
    const categories = [
      { key: 'brilliant', label: 'Brilliant (!!)', colorClass: 'text-[#26c6da] font-extrabold' },
      { key: 'best', label: 'Best Move (!)', colorClass: 'text-emerald-500 font-bold' },
      { key: 'excellent', label: 'Excellent (★)', colorClass: 'text-[#66bb6a] font-bold' },
      { key: 'good', label: 'Good Move (!)', colorClass: 'text-emerald-600 font-medium' },
      { key: 'book', label: 'Book Move (📖)', colorClass: 'text-[#8b5a2b]' },
      { key: 'only_move', label: 'Only Move (□)', colorClass: 'text-slate-400 font-semibold' },
      { key: 'unclear', label: 'Unclear Position (∞)', colorClass: 'text-[#78909c]' },
      { key: 'interesting', label: 'Interesting (!?)', colorClass: 'text-[#ec407a]' },
      { key: 'dubious', label: 'Dubious (?!)', colorClass: 'text-[#ab47bc]' },
      { key: 'mistake', label: 'Mistake (?)', colorClass: 'text-amber-500' },
      { key: 'blunder', label: 'Blunder (??)', colorClass: 'text-red-500 font-bold' },
    ];
    
    return (
      <div className="mt-4 pt-4 border-t border-brand-hairline">
        <h3 className="text-xs font-mono font-bold text-brand-ink mb-3 uppercase tracking-wider select-none">
          Game Statistics
        </h3>
        <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono items-center">
          <div className="text-left font-semibold text-brand-ink pl-1">White</div>
          <div className="text-brand-body text-[10px] uppercase">Category</div>
          <div className="text-right font-semibold text-brand-ink pr-1">Black</div>
          
          {categories.map(({ key, label, colorClass }) => (
            <React.Fragment key={key}>
              <div className={`text-left pl-1 ${colorClass}`}>
                {whiteStats[key as keyof typeof whiteStats]}
              </div>
              <div className="text-brand-body text-[10px]">{label}</div>
              <div className={`text-right pr-1 ${colorClass}`}>
                {blackStats[key as keyof typeof blackStats]}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  // Format move list in rows of 2 (White, Black) with badges
  const renderMoveList = () => {
    const rows = [];
    for (let i = 0; i < moves.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const whiteMove = moves[i];
      const blackMove = moves[i + 1];

      const whiteQuality = getMoveQualityInfo(i);
      const blackQuality = getMoveQualityInfo(i + 1);

      rows.push(
        <div key={moveNum} className="grid grid-cols-12 gap-2 py-1.5 px-3 border-b border-brand-hairline hover:bg-brand-canvas-soft2/50 text-sm font-mono items-center">
          <span className="col-span-2 text-brand-body text-xs">{moveNum}.</span>
          
          <button
            onClick={() => jumpToMove(i)}
            className={`col-span-5 text-left py-0.5 px-2 rounded-sm transition-colors flex items-center justify-between gap-1.5 focus-visible:ring-1 focus-visible:ring-brand-accent ${
              currentMoveIndex === i 
                ? 'bg-brand-accent/10 text-brand-accent font-semibold border border-brand-accent/30' 
                : 'text-brand-ink hover:bg-brand-canvas-soft2'
            }`}
            aria-label={`Jump to move ${moveNum} white ${whiteMove.san}`}
          >
            <span>{whiteMove.san}</span>
            {whiteQuality && (
              <span 
                className={`w-2 h-2 rounded-full shrink-0 ${whiteQuality.badgeColor}`} 
                title={whiteQuality.label}
              />
            )}
          </button>

          {blackMove ? (
            <button
              onClick={() => jumpToMove(i + 1)}
              className={`col-span-5 text-left py-0.5 px-2 rounded-sm transition-colors flex items-center justify-between gap-1.5 focus-visible:ring-1 focus-visible:ring-brand-accent ${
                currentMoveIndex === i + 1 
                  ? 'bg-brand-accent/10 text-brand-accent font-semibold border border-brand-accent/30' 
                  : 'text-brand-ink hover:bg-brand-canvas-soft2'
              }`}
              aria-label={`Jump to move ${moveNum} black ${blackMove.san}`}
            >
              <span>{blackMove.san}</span>
              {blackQuality && (
                <span 
                  className={`w-2 h-2 rounded-full shrink-0 ${blackQuality.badgeColor}`} 
                  title={blackQuality.label}
                />
              )}
            </button>
          ) : (
            <span className="col-span-5"></span>
          )}
        </div>
      );
    }

    if (moves.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center select-none">
          <p className="text-brand-body font-sans text-sm mb-1.5">No moves to display.</p>
          <p className="text-[11px] text-brand-mute font-mono">Paste PGN to analyze a full game, or move pieces manually.</p>
        </div>
      );
    }

    return <div className="divide-y divide-brand-hairline overflow-y-auto max-h-[340px] pr-1">{rows}</div>;
  };

  // Calculate height and stats for the vertical evaluation bar
  const getEvaluationBarStats = () => {
    const activeFen = currentMoveIndex === -1 ? loadedFenStart : (moves[currentMoveIndex]?.fen || loadedFenStart);
    const scoreVal = evalCache[activeFen];
    
    if (scoreVal === undefined) {
      return {
        percent: 50,
        displayEval: '...'
      };
    }

    // Centipawn to pawns. Cap at +/- 8 pawns
    let pawnScore = scoreVal / 100;
    
    // Check if score represents mate
    const isMateVal = Math.abs(scoreVal) >= 8000;
    let displayEval = '';
    
    if (isMateVal) {
      const movesToMate = Math.round((10000 - Math.abs(scoreVal)) / 100);
      displayEval = `M${movesToMate}`;
      pawnScore = scoreVal > 0 ? 8 : -8;
    } else {
      displayEval = pawnScore > 0 ? `+${pawnScore.toFixed(1)}` : pawnScore.toFixed(1);
    }

    // Map -8 to +8 pawns onto 5% to 95% evaluation bar height
    let percent = 50 + (pawnScore / 8) * 45;
    percent = Math.max(5, Math.min(95, percent));

    return {
      percent,
      displayEval
    };
  };

  // Define CustomSquareRenderer to render evaluation badges/icons directly on the board
  const CustomSquareRenderer = React.useCallback(({ piece, square, children }: any) => {
    const currentMove = (currentMoveIndex !== -1 && moves[currentMoveIndex]) ? moves[currentMoveIndex] : null;
    const isDestination = currentMove && currentMove.to === square;
    
    let badge = null;
    if (isDestination) {
      const qualityInfo = getMoveQualityInfo(currentMoveIndex);
      if (qualityInfo && qualityInfo.icon && qualityInfo.badgeColor) {
        badge = (
          <div 
            className={`absolute top-0.5 right-0.5 z-10 w-4 h-4 md:w-5 md:h-5 rounded-full flex items-center justify-center text-[8px] md:text-[10px] font-bold text-white shadow-md select-none pointer-events-none ${qualityInfo.badgeColor}`}
            title={qualityInfo.label}
          >
            {qualityInfo.icon}
          </div>
        );
      }
    }

    const highlightStyle = getCustomSquareStyles()[square] || {};

    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', ...highlightStyle }}>
        {children}
        {badge}
      </div>
    );
  }, [currentMoveIndex, moves, evalCache, bestMovesCache]);

  // Calculate evaluation progress for loaded PGN games
  const getEvaluationProgress = () => {
    if (moves.length === 0) return { percent: 100, evaluated: 0, total: 0 };
    const allFens = [loadedFenStart, ...moves.map(m => m.fen)];
    const evaluatedCount = allFens.filter(f => evalCache[f] !== undefined).length;
    const total = allFens.length;
    const percent = Math.min(100, Math.round((evaluatedCount / total) * 100));
    return { percent, evaluated: evaluatedCount, total };
  };
  const { percent: pgnEvalPercent, evaluated: pgnEvalEvaluated, total: pgnEvalTotal } = getEvaluationProgress();

  const { percent: evalPercent, displayEval } = getEvaluationBarStats();

  // Helper to render the Narrator Box in a responsive layout
  const renderNarratorBox = (displayClass: string) => {
    return (
      <div className={`bg-brand-canvas border border-brand-hairline rounded-md p-5 sm:p-6 shadow-lvl3 relative overflow-hidden flex flex-col gap-4 w-full ${displayClass}`}>
        {/* Header */}
        <div className="flex justify-between items-center border-b border-brand-hairline pb-3 select-none">
          <div className="flex items-center gap-2">
            <div className="relative flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${isPlayingAudio ? 'animate-ping bg-emerald-400' : 'bg-brand-accent'}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isPlayingAudio ? 'bg-emerald-500' : 'bg-brand-accent'}`}></span>
            </div>
            <h2 className="text-xs font-mono tracking-wider uppercase text-brand-ink font-bold">
              Narrator Panel
            </h2>
          </div>
          
          {/* Audio narration toggle */}
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-mono text-brand-body cursor-pointer flex items-center gap-1 select-none">
              <input 
                type="checkbox" 
                checked={autoSpeak} 
                onChange={(e) => setAutoSpeak(e.target.checked)} 
                className="rounded-xs border-brand-hairline accent-brand-primary w-3.5 h-3.5"
              />
              Auto-Speak
            </label>

            <button
              onClick={() => {
                if (isPlayingAudio) {
                  window.speechSynthesis.cancel();
                  setIsPlayingAudio(false);
                } else {
                  speakText(narratorText);
                }
              }}
              className={`p-1.5 rounded-sm border transition-colors focus-visible:ring-1 focus-visible:ring-brand-accent ${
                isPlayingAudio 
                  ? 'border-emerald-500/30 text-emerald-500 bg-emerald-500/10' 
                  : 'border-brand-hairline text-brand-ink hover:bg-brand-canvas-soft2'
              }`}
              title="Speak Narration"
              aria-label="Toggle narration speech"
            >
              {isPlayingAudio ? (
                <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path>
                </svg>
              ) : (
                <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Narration critique display */}
        <div className="min-h-[120px] sm:min-h-[96px] flex items-start gap-3">
          {/* Avatar icon */}
          <div className="w-10 h-10 rounded-sm bg-brand-primary border border-brand-hairline flex items-center justify-center shrink-0 text-brand-on-primary shadow-inner select-none font-bold uppercase">
            {narratorPersonality.charAt(0)}
          </div>

          {/* Typewritten comment text */}
          <div className="flex-grow">
            <AnimatePresence mode="wait">
              <motion.div
                key={narratorText}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <p className="text-sm text-brand-ink leading-relaxed font-sans min-h-[80px] sm:min-h-[56px]">
                  {displayedNarration}
                  <span className="inline-block w-1.5 h-3 bg-brand-accent ml-0.5 animate-pulse" />
                </p>
              </motion.div>
            </AnimatePresence>
            
            {/* Dynamic move rating sub-label */}
            {currentMoveIndex !== -1 && getMoveQualityInfo(currentMoveIndex) && (
              <div className="mt-2 text-xs font-mono flex items-center gap-1.5 select-none">
                <span className={getMoveQualityInfo(currentMoveIndex)!.colorClass}>
                  {getMoveQualityInfo(currentMoveIndex)!.label}
                </span>
                <span className="text-brand-body">
                  (Eval change: {getMoveQualityInfo(currentMoveIndex)!.change > 0 ? '+' : ''}
                  {getMoveQualityInfo(currentMoveIndex)!.change.toFixed(2)})
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Soundwave animation when playing audio */}
        {isPlayingAudio && (
          <div className="flex justify-center items-end gap-[3px] h-6 bg-emerald-500/10 border border-emerald-500/20 rounded-sm p-1">
            <span className="w-[3px] h-3 bg-emerald-500 rounded-pill animate-bounce" style={{ animationDelay: '0.1s' }} />
            <span className="w-[3px] h-5 bg-emerald-400 rounded-pill animate-bounce" style={{ animationDelay: '0.2s' }} />
            <span className="w-[3px] h-2 bg-emerald-500 rounded-pill animate-bounce" style={{ animationDelay: '0.3s' }} />
            <span className="w-[3px] h-4 bg-emerald-400 rounded-pill animate-bounce" style={{ animationDelay: '0.4s' }} />
            <span className="w-[3px] h-1 bg-emerald-500 rounded-pill animate-bounce" style={{ animationDelay: '0.5s' }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full flex flex-col gap-6">
      {/* Mode Selection Tabs */}
      <div className="flex gap-2 border-b border-brand-hairline pb-4 select-none">
        <button
          onClick={() => {
            setGameMode('analysis');
            setGameStatus('active');
            setIsAiThinking(false);
          }}
          className={`px-5 py-2 rounded-pill text-sm font-semibold transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden cursor-pointer ${
            gameMode === 'analysis'
              ? 'bg-brand-primary text-brand-on-primary shadow-sm'
              : 'text-brand-body hover:bg-brand-canvas-soft2 border border-transparent'
          }`}
        >
          Analysis Board
        </button>
        <button
          onClick={() => {
            setGameMode('play');
            handleStartPlayGame();
          }}
          className={`px-5 py-2 rounded-pill text-sm font-semibold transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden cursor-pointer ${
            gameMode === 'play'
              ? 'bg-brand-primary text-brand-on-primary shadow-sm'
              : 'text-brand-body hover:bg-brand-canvas-soft2 border border-transparent'
          }`}
        >
          Play Against AI
        </button>
      </div>

      {/* Game Analysis Progress Bar */}
      {pgnEvalPercent < 100 && (
        <div className="w-full bg-brand-canvas border border-brand-hairline rounded-md p-4 mb-6 shadow-lvl2 select-none animate-pulse">
          <div className="flex justify-between items-center text-xs font-mono mb-2">
            <span className="text-brand-ink font-bold flex items-center gap-1.5">
              <svg className="animate-spin h-3.5 w-3.5 text-brand-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Analyzing Game...
            </span>
            <span className="text-brand-body">{pgnEvalPercent}% ({pgnEvalEvaluated}/{pgnEvalTotal} positions)</span>
          </div>
          <div className="w-full bg-brand-canvas-soft2 rounded-full h-2 overflow-hidden border border-brand-hairline">
            <div 
              className="bg-brand-accent h-full transition-all duration-300 ease-out" 
              style={{ width: `${pgnEvalPercent}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start w-full min-w-0">
        
        {/* LEFT COLUMN: Chessboard, Navigation, Evaluation Bar and Evaluation Line Chart */}
        <div className="lg:col-span-7 flex flex-col items-center w-full min-w-0">
          
          {/* Chessboard & Eval Bar Container */}
          <div className="flex gap-2 sm:gap-4 items-stretch w-full max-w-[500px] h-auto">
            
            {/* Vertical Evaluation Bar */}
            <div className="w-5 md:w-6 shrink-0 flex flex-col justify-between py-2 relative rounded-md bg-brand-primary border border-brand-hairline overflow-hidden select-none shadow-lvl1">
              {/* White advantage fill (animating height from bottom via Framer Motion) */}
              <motion.div 
                className="absolute bottom-0 left-0 right-0 bg-brand-on-primary" 
                animate={{ height: `${evalPercent}%` }}
                transition={{ type: 'spring', stiffness: 85, damping: 16 }}
              />
              {/* Numeric Evaluation text overlay (vertical) */}
              <div className="absolute inset-x-0 top-3 text-center text-[9px] font-mono font-bold z-10 mix-blend-difference text-brand-on-primary select-none">
                {displayEval}
              </div>
              
              {/* Soft division lines */}
              <div className="absolute inset-x-0 top-1/2 h-[1px] bg-brand-hairline-strong/40 z-5" />
            </div>
   
            {/* Chessboard container */}
            <div 
              className="flex-grow rounded-md overflow-hidden border border-brand-hairline bg-brand-canvas shadow-lvl2 p-2 flex items-center justify-center relative"
            >
              <div className="w-full aspect-square max-h-[460px]">
                <Chessboard 
                  key={loadedFenStart + boardOrientation}
                  options={{
                    position: positionFen,
                    onPieceDrop: ({ sourceSquare, targetSquare }) => targetSquare ? onDrop(sourceSquare, targetSquare) : false,
                    boardOrientation: boardOrientation,
                    squareRenderer: CustomSquareRenderer,
                    squareStyles: getCustomSquareStyles(),
                    darkSquareStyle: { backgroundColor: 'var(--color-board-dark)' },
                    lightSquareStyle: { backgroundColor: 'var(--color-board-light)' },
                    allowDragging: gameMode === 'play' ? (gameStatus === 'active' && !isAiThinking && isPlayersTurn) : true
                  }}
                />
              </div>

              {/* Game Over Banner Overlay */}
              {gameMode === 'play' && gameStatus !== 'active' && (
                <div className="absolute inset-0 bg-brand-canvas/80 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center select-none animate-fadeIn z-20">
                  <div className="bg-brand-canvas border border-brand-hairline rounded-md p-6 shadow-lvl5 max-w-xs flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-mono uppercase tracking-wider text-brand-mute">Game Over</span>
                      <h3 className="text-xl font-sans font-bold tracking-tight text-brand-ink">
                        {gameStatus === 'checkmate' && (
                          (moves.length % 2 === 1) 
                            ? (actualPlayerColor === 'white' ? 'Victory! You Won' : 'Defeat! AI Won')
                            : (actualPlayerColor === 'black' ? 'Victory! You Won' : 'Defeat! AI Won')
                        )}
                        {gameStatus === 'draw' && 'Draw Game'}
                        {gameStatus === 'resigned' && 'You Resigned'}
                      </h3>
                      <p className="text-xs text-brand-body font-sans mt-1">
                        {gameStatus === 'checkmate' && 'Checkmate has been delivered on the board.'}
                        {gameStatus === 'draw' && 'The game ended in a draw (stalemate, repetition, or material).'}
                        {gameStatus === 'resigned' && 'You surrendered the match.'}
                      </p>
                    </div>
                    
                    <button
                      onClick={handleStartPlayGame}
                      className="w-full py-2 rounded-pill text-xs font-semibold bg-brand-primary text-brand-on-primary hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:outline-hidden cursor-pointer"
                    >
                      Play Again
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

 
        {/* Move Step Controls */}
        <div className="flex items-center gap-1 sm:gap-2 mt-4 w-full max-w-[500px] bg-brand-canvas border border-brand-hairline rounded-md p-1.5 sm:p-2 justify-center shadow-lvl2">
          <button
            onClick={() => jumpToMove(-1)}
            disabled={currentMoveIndex === -1}
            className="p-1.5 sm:p-2 rounded-sm text-brand-ink hover:bg-brand-canvas-soft2 border border-transparent hover:border-brand-hairline disabled:opacity-30 disabled:hover:bg-transparent transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden"
            aria-label="Go to starting position"
          >
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"></path>
            </svg>
          </button>
          
          <button
            onClick={() => jumpToMove(currentMoveIndex - 1)}
            disabled={currentMoveIndex === -1}
            className="p-1.5 sm:p-2 rounded-sm text-brand-ink hover:bg-brand-canvas-soft2 border border-transparent hover:border-brand-hairline disabled:opacity-30 disabled:hover:bg-transparent transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden"
            aria-label="Go to previous move"
          >
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path>
            </svg>
          </button>
 
          {/* Autoplay Play/Pause Button */}
          {moves.length > 0 && (
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="px-2.5 sm:px-4 py-1.5 rounded-pill text-xs font-semibold bg-brand-primary text-brand-on-primary hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:outline-hidden flex items-center gap-1.5"
              aria-label={isPlaying ? "Pause autoplay" : "Play autoplay"}
            >
              {isPlaying ? (
                <>
                  <svg aria-hidden="true" className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <rect x="4" y="4" width="6" height="16" rx="1"></rect>
                    <rect x="14" y="4" width="6" height="16" rx="1"></rect>
                  </svg>
                  <span className="hidden sm:inline">Pause</span>
                </>
              ) : (
                <>
                  <svg aria-hidden="true" className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 5v14l11-7z"></path>
                  </svg>
                  <span className="hidden sm:inline">Autoplay</span>
                </>
              )}
            </button>
          )}

          {/* Flip Board Button */}
          <button
            onClick={() => setBoardOrientation(prev => prev === 'white' ? 'black' : 'white')}
            className="p-2 rounded-sm text-brand-ink hover:bg-brand-canvas-soft2 border border-transparent hover:border-brand-hairline transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden"
            title="Flip Board"
            aria-label="Flip board orientation"
          >
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 6H16"></path>
            </svg>
          </button>
 
          <button
            onClick={() => jumpToMove(currentMoveIndex + 1)}
            disabled={moves.length === 0 || currentMoveIndex === moves.length - 1}
            className="p-2 rounded-sm text-brand-ink hover:bg-brand-canvas-soft2 border border-transparent hover:border-brand-hairline disabled:opacity-30 disabled:hover:bg-transparent transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden"
            aria-label="Go to next move"
          >
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
            </svg>
          </button>
 
          <button
            onClick={() => jumpToMove(moves.length - 1)}
            disabled={moves.length === 0 || currentMoveIndex === moves.length - 1}
            className="p-2 rounded-sm text-brand-ink hover:bg-brand-canvas-soft2 border border-transparent hover:border-brand-hairline disabled:opacity-30 disabled:hover:bg-transparent transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden"
            aria-label="Go to end of game"
          >
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7"></path>
            </svg>
          </button>
        </div>
        
        {/* Engine Status Bar */}
        <div className="flex justify-between w-full max-w-[500px] mt-2 px-1 text-[11px] font-mono text-brand-body select-none">
          {gameMode === 'play' ? (
            <>
              <span>Mode: <span className="text-brand-ink">Play vs AI</span></span>
              {isAiThinking ? (
                <span className="animate-pulse text-brand-accent font-semibold flex items-center gap-1">
                  <svg className="animate-spin h-3 w-3 text-brand-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  AI is thinking...
                </span>
              ) : (
                <span className="text-emerald-500 font-semibold">{isPlayersTurn ? 'Your Turn' : "AI's Turn"}</span>
              )}
            </>
          ) : (
            <>
              <span>Status: <span className="text-brand-ink capitalize">{engineStatus}</span></span>
              {evalQueue.length > 0 && <span className="animate-pulse text-brand-accent font-semibold">Analyzing queue: {evalQueue.length} positions left</span>}
            </>
          )}
        </div>

        {/* AI Narrator Box for Mobile Viewports */}
        {renderNarratorBox('flex lg:hidden mt-4')}
 
        {/* Evaluation Line Chart */}
        {renderEvalChart()}
      </div>
 
      {/* RIGHT COLUMN: AI Narrator, Inputs & Move history */}
      <div className="lg:col-span-5 flex flex-col gap-6 w-full min-w-0">
        
        {/* AI NARRATOR BOX (Desktop) */}
        {renderNarratorBox('hidden lg:flex')}
 
        {/* INPUT POSITION / PGN CARD */}
        <div className="bg-brand-canvas border border-brand-hairline rounded-md p-6 shadow-lvl2 relative">
          
          {/* Settings Drawer Button */}
          <button
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className="absolute top-4 right-4 p-1.5 rounded-sm border border-brand-hairline hover:bg-brand-canvas-soft2 transition-colors text-brand-body hover:text-brand-ink focus-visible:ring-2 focus-visible:ring-brand-accent"
            title="AI Config & Personalities"
            aria-label="Open AI configuration settings"
          >
            <svg aria-hidden="true" className={`w-4 h-4 transition-transform duration-300 ${isSettingsOpen ? 'rotate-90 text-brand-accent' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
            </svg>
          </button>
 
          {/* Settings Drawer Content */}
          {isSettingsOpen && (
            <div className="border border-brand-hairline bg-brand-canvas-soft2 rounded-md p-4 mb-4 flex flex-col gap-4 animate-fadeIn">
              <h3 className="text-xs font-mono font-bold text-brand-ink border-b border-brand-hairline pb-1.5 select-none">
                AI Config & Voice Personalities
              </h3>
              
              {/* Personality selection */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-mono text-brand-body select-none">Narrator Personality</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['sarcastic', 'supportive', 'grandmaster', 'pirate'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setNarratorPersonality(p)}
                      className={`relative px-3 py-1.5 rounded-sm text-xs font-mono capitalize border transition-colors duration-200 select-none ${
                        narratorPersonality === p
                          ? 'border-brand-accent text-brand-accent font-semibold shadow-xs'
                          : 'border-brand-hairline hover:bg-brand-canvas hover:border-brand-hairline-strong text-brand-body'
                      }`}
                    >
                      {narratorPersonality === p && (
                        <motion.div
                          layoutId="active-personality-pill"
                          className="absolute inset-0 bg-brand-accent/5 rounded-sm pointer-events-none"
                          transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                        />
                      )}
                      <span className="relative z-10">{p}</span>
                    </button>
                  ))}
                </div>
              </div>
 
              {/* Gemini Key Config */}
              <div className="flex flex-col gap-2 pt-2 border-t border-brand-hairline">
                <div className="flex justify-between items-center select-none">
                  <span className="text-[11px] font-mono text-brand-body">Use Gemini Live API</span>
                  <input 
                    type="checkbox"
                    checked={useGemini}
                    onChange={(e) => setUseGemini(e.target.checked)}
                    disabled={!geminiApiKey.trim()}
                    className="rounded-xs border-brand-hairline accent-brand-accent w-3.5 h-3.5 disabled:opacity-40"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="gemini-key" className="text-[9px] font-mono text-brand-body select-none">
                    Insert Gemini API Key (saves locally in browser)
                  </label>
                  <input
                    id="gemini-key"
                    type="password"
                    value={geminiApiKey}
                    onChange={(e) => handleSaveApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-brand-canvas border border-brand-hairline rounded-sm px-2.5 py-1 text-xs font-mono text-brand-ink focus-visible:ring-1 focus-visible:ring-brand-accent focus-visible:outline-hidden"
                  />
                  {ttsStatus === 'error' && (
                    <span className="text-[9px] text-rose-400 font-mono mt-1 leading-normal select-none">
                      ⚠️ Gemini TTS failed: {ttsErrorMessage} (Fell back to browser voice).
                    </span>
                  )}
                  {ttsStatus === 'success' && (
                    <span className="text-[9px] text-emerald-400 font-mono mt-1 select-none">
                      ✨ Gemini TTS Active
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
 
          {/* Tabs for PGN/FEN or Play vs AI Panel */}
          {gameMode === 'play' ? (
            <div className="flex flex-col gap-5">
              <h3 className="text-xs font-mono font-bold text-brand-ink uppercase tracking-wider select-none">
                Play vs AI Setup
              </h3>
              
              {/* Play As selection */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-mono text-brand-body select-none">Play As</span>
                <div className="flex gap-2">
                  {(['white', 'black', 'random'] as const).map((color) => (
                    <button
                      key={color}
                      onClick={() => setPlayerColor(color)}
                      className={`flex-grow px-3 py-1.5 rounded-sm text-xs font-mono capitalize border transition-all cursor-pointer ${
                        playerColor === color
                          ? 'border-brand-accent bg-brand-accent/5 text-brand-accent font-semibold shadow-xs'
                          : 'border-brand-hairline hover:bg-brand-canvas hover:border-brand-hairline-strong text-brand-body'
                      }`}
                    >
                      {color === 'white' ? '⚪ White' : color === 'black' ? '⚫ Black' : '🔀 Random'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Difficulty selection */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-mono text-brand-body select-none">AI Difficulty</span>
                <div className="grid grid-cols-2 gap-2">
                  {(['easy', 'medium', 'hard', 'master'] as const).map((diff) => (
                    <button
                      key={diff}
                      onClick={() => setAiDifficulty(diff)}
                      className={`px-3 py-1.5 rounded-sm text-xs font-mono capitalize border transition-all cursor-pointer ${
                        aiDifficulty === diff
                          ? 'border-brand-accent bg-brand-accent/5 text-brand-accent font-semibold shadow-xs'
                          : 'border-brand-hairline hover:bg-brand-canvas hover:border-brand-hairline-strong text-brand-body'
                      }`}
                    >
                      {diff}
                    </button>
                  ))}
                </div>
              </div>

              {/* Controls */}
              <div className="flex gap-2 pt-2 border-t border-brand-hairline mt-2">
                <button
                  onClick={handleStartPlayGame}
                  className="flex-grow px-4 py-2 rounded-pill text-sm font-semibold bg-brand-primary text-brand-on-primary hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:outline-hidden cursor-pointer"
                >
                  {gameStatus === 'active' && moves.length > 0 ? 'Restart Game' : 'Start Match'}
                </button>
                {gameStatus === 'active' && moves.length > 0 && (
                  <button
                    onClick={handleResign}
                    className="px-4 py-2 rounded-pill text-sm font-semibold bg-brand-canvas text-brand-danger border border-brand-danger/20 hover:bg-brand-danger/5 transition-all focus-visible:ring-2 focus-visible:ring-brand-danger/50 focus-visible:outline-hidden cursor-pointer"
                  >
                    Resign
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Tabs for PGN/FEN */}
              <div className="flex gap-2 border-b border-brand-hairline pb-4 mb-4 select-none">
                <button
                  onClick={() => {
                    setActiveTab('pgn');
                    setInputText('');
                    setError('');
                  }}
                  className={`px-4 py-1.5 rounded-pill text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden ${
                    activeTab === 'pgn'
                      ? 'bg-brand-primary text-brand-on-primary shadow-xs'
                      : 'text-brand-body hover:bg-brand-canvas-soft2'
                  }`}
                >
                  PGN Game
                </button>
                <button
                  onClick={() => {
                    setActiveTab('fen');
                    setInputText('');
                    setError('');
                  }}
                  className={`px-4 py-1.5 rounded-pill text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden ${
                    activeTab === 'fen'
                      ? 'bg-brand-primary text-brand-on-primary shadow-xs'
                      : 'text-brand-body hover:bg-brand-canvas-soft2'
                  }`}
                >
                  FEN Position
                </button>
              </div>
     
              {/* Form Area */}
              <div className="flex flex-col gap-3">
                <label htmlFor="chess-input" className="text-xs font-mono text-brand-body select-none">
                  Enter {activeTab === 'pgn' ? 'PGN string' : 'FEN string'}…
                </label>
                <textarea
                  id="chess-input"
                  rows={4}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={
                    activeTab === 'pgn'
                      ? '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6…'
                      : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1…'
                  }
                  className="w-full bg-brand-canvas border border-brand-hairline rounded-sm p-3 font-mono text-sm text-brand-ink focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden transition-all placeholder:text-brand-mute/60"
                  spellCheck={false}
                  autoComplete="off"
                />
     
                {/* Inline Error Alert */}
                {error && (
                  <div 
                    aria-live="polite" 
                    className="flex items-start gap-2 text-xs text-brand-danger bg-brand-danger/5 border border-brand-danger/20 rounded-sm p-3 font-mono animate-fadeIn"
                  >
                    <svg aria-hidden="true" className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <span>{error}</span>
                  </div>
                )}
     
                {/* Buttons Row */}
                <div className="flex flex-wrap gap-2 items-center mt-2">
                  <button
                    onClick={() => {
                      if (activeTab === 'pgn') handleLoadPgn(inputText);
                      else handleLoadFen(inputText);
                    }}
                    className="px-6 py-2 rounded-pill text-sm font-semibold bg-brand-primary text-brand-on-primary hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:outline-hidden cursor-pointer"
                  >
                    Load {activeTab === 'pgn' ? 'PGN' : 'FEN'}
                  </button>
     
                  <button
                    onClick={() => {
                      if (activeTab === 'pgn') {
                        setInputText(SAMPLE_PGN);
                        handleLoadPgn(SAMPLE_PGN);
                      } else {
                        setInputText(SAMPLE_FEN);
                        handleLoadFen(SAMPLE_FEN);
                      }
                    }}
                    className="px-4 py-2 rounded-pill text-sm font-semibold bg-brand-canvas text-brand-ink border border-brand-hairline hover:bg-brand-canvas-soft2 transition-colors focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:outline-hidden cursor-pointer"
                  >
                    Load Sample
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
 
        {/* Moves History Card Container */}
        <div className="bg-brand-canvas border border-brand-hairline rounded-md p-6 shadow-lvl2 flex flex-col flex-grow min-h-[300px]">
          <div className="flex justify-between items-center border-b border-brand-hairline pb-3 mb-3 select-none">
            <div className="flex gap-2">
              <button
                onClick={() => setShowGameReview(false)}
                className={`text-xs font-mono font-bold uppercase tracking-wider px-3 py-1.5 rounded-sm transition-all cursor-pointer ${
                  !showGameReview 
                    ? 'bg-brand-canvas-soft2 text-brand-ink border border-brand-hairline shadow-sm' 
                    : 'text-brand-body hover:text-brand-ink hover:bg-brand-canvas-soft2/50 border border-transparent'
                }`}
              >
                Moves List
              </button>
              <button
                onClick={() => {
                  if (moves.length > 0 && isGameFullyEvaluated()) {
                    setShowGameReview(true);
                  }
                }}
                disabled={moves.length === 0}
                className={`text-xs font-mono font-bold uppercase tracking-wider px-3 py-1.5 rounded-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  showGameReview 
                    ? 'bg-brand-canvas-soft2 text-brand-ink border border-brand-hairline shadow-sm' 
                    : 'text-brand-body hover:text-brand-ink hover:bg-brand-canvas-soft2/50 border border-transparent'
                }`}
                title={moves.length === 0 ? 'Play some moves first' : (!isGameFullyEvaluated() ? 'Engine is still evaluating...' : 'View post-game report card')}
              >
                Game Review
              </button>
            </div>
            
            {/* Show evaluation progress if queue is running */}
            {moves.length > 0 && !isGameFullyEvaluated() && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-brand-accent animate-pulse">
                  Analyzing ({getEvaluatedCount()}/{moves.length + 1})
                </span>
                <div className="w-16 sm:w-24 bg-brand-canvas-soft2 h-1 rounded-full overflow-hidden border border-brand-hairline">
                  <div 
                    className="bg-brand-accent h-full transition-all duration-300"
                    style={{ width: `${(getEvaluatedCount() / (moves.length + 1)) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>

          {showGameReview ? (
            renderGameReview()
          ) : (
            <>
              {renderMoveList()}

              {/* Move quality statistics */}
              {renderStatsSummary()}

              {/* Copy Buttons */}
              {moves.length > 0 && (
                <div className="flex gap-2 mt-4 pt-4 border-t border-brand-hairline justify-end">
                  <button
                    onClick={() => handleCopyText('pgn')}
                    className="px-3 py-1.5 rounded-sm text-xs font-mono border border-brand-hairline bg-brand-canvas hover:bg-brand-canvas-soft2 text-brand-ink transition-colors flex items-center gap-1.5 cursor-pointer shadow-lvl1 hover:shadow-lvl2"
                  >
                    {copiedText === 'pgn' ? 'Copied PGN!' : 'Copy PGN'}
                  </button>
                  <button
                    onClick={() => handleCopyText('fen')}
                    className="px-3 py-1.5 rounded-sm text-xs font-mono border border-brand-hairline bg-brand-canvas hover:bg-brand-canvas-soft2 text-brand-ink transition-colors flex items-center gap-1.5 cursor-pointer shadow-lvl1 hover:shadow-lvl2"
                  >
                    {copiedText === 'fen' ? 'Copied FEN!' : 'Copy FEN'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
 
      </div>
 
    </div>
  </div>
  );
}

// ==========================================
// WITTY NARRATOR COMMENTS LOCAL ENGINE
// ==========================================
function getWittyCritique(
  move: MoveItem, 
  quality: 'only_move' | 'brilliant' | 'blunder' | 'mistake' | 'dubious' | 'interesting' | 'unclear' | 'excellent' | 'best' | 'good', 
  change: number,
  personality: 'sarcastic' | 'supportive' | 'grandmaster' | 'pirate'
) {
  if (move.san.includes('#')) {
    const checkmateComments = {
      sarcastic: [
        `And that's checkmate. Game over. Go read a book or something.`,
        `Checkmate. The king is dead, long live the king. Or in this case, just go to the next game.`
      ],
      supportive: [
        `Checkmate! What a beautifully played game. Well done!`,
        `And there is checkmate! A brilliant finish to a wonderful game.`
      ],
      grandmaster: [
        `Checkmate. A well-executed mating net. The game is concluded.`,
        `Checkmate. The defense collapsed under precise calculation.`
      ],
      pirate: [
        `Checkmate, matey! The ship has sunk to the bottom of the sea!`,
        `Ahoy! Checkmate! The enemy captain has surrendered his sword!`
      ]
    };
    const list = checkmateComments[personality] || checkmateComments.sarcastic;
    const hash = (move.san.charCodeAt(0) || 0) + (move.san.charCodeAt(move.san.length - 1) || 0) + quality.length;
    return list[hash % list.length];
  }

  const pieceName = {
    p: 'Pawn',
    n: 'Knight',
    b: 'Bishop',
    r: 'Rook',
    q: 'Queen',
    k: 'King'
  }[move.piece] || 'piece';

  const isCapture = move.san.includes('x');
  const isCheck = move.san.includes('+');

  const sarcasticComments = {
    blunder: [
      `Wait, did you move your ${pieceName} there as a donation, or is this charity work?`,
      `Ah, the rare 'surrender the ${pieceName}' gambit. Let's see how that pays off.`,
      `Oh! The ${pieceName} decided to visit the shadow realm. Bon voyage!`,
      `Stockfish is currently compiling a report on how that move was mathematically a disaster.`,
      `Is this a new style of chess where the goal is to lose all your pieces? Because you're winning at it.`,
      `Walking a ${pieceName} straight into the guillotine. How noble.`,
      `I've seen random number generators play more sensible moves than that.`
    ],
    mistake: [
      `Not quite a disaster, but the engine is definitely shaking its virtual head.`,
      `That ${pieceName} move is a bit questionable. You might want to double-check your calculations.`,
      `You had better options, but I suppose this one keeps the game... interesting.`,
      `Giving your opponent a free pass. How generous of you!`
    ],
    dubious: [
      `Questionable. Very questionable. Are you setting a trap or just hoping for a miracle?`,
      `The engine is squinting at this move. It smells like a blunder, but feels like hope.`,
      `A bit sketchy. If your opponent has eyes, you might be in trouble.`
    ],
    interesting: [
      `Ambitious! It's not objectively correct, but it definitely makes things messy.`,
      `Speculative play. You're throwing gas on the fire, let's see who gets burned.`,
      `Bold choice. You've complicated the position. I hope you have a plan.`
    ],
    unclear: [
      `A complete mess. The engine says it's equal, but nobody has any idea what's going on.`,
      `Dynamically balanced chaos. Good luck navigating this minefield.`,
      `Equal evaluation, but the tension on this board is off the charts.`
    ],
    excellent: [
      `A very strong alternative. Not the engine's favorite, but highly respectable.`,
      `Excellent choice. You're keeping the pressure on with high-level positional play.`,
      `Very nice. The engine nods in approval of your strategic alternative.`
    ],
    best: [
      `Exactly what the doctor ordered. The absolute best move in the position.`,
      `Spot on! You found the top engine recommendation.`,
      `Perfect precision. The engine has nothing to complain about.`
    ],
    good: [
      `Solid move. Keeps the pressure on.`,
      `Good positional play. No complaints from the engine.`,
      `Keeping it simple and effective. A sensible choice.`
    ],
    only_move: [
      `Well, it's not like you had a choice. Literally.`,
      `Congratulations on finding the single legal move on the board. Groundbreaking.`,
      `A forced move. Even a random number generator would have got this one right.`
    ],
    brilliant: [
      `Wait, did your mouse slip, or are you actually a genius?`,
      `A sacrifice? The engine is calculating if you're a madman or a mastermind.`,
      `Oh! A move so brilliant even I didn't see it coming. Don't let it go to your head.`,
      `Stockfish is crying tears of joy in binary. Exceptional find!`
    ]
  };

  const grandmasterComments = {
    blunder: [
      `In my seventy years of chess, I have rarely seen a ${pieceName} misplaced so spectacularly.`,
      `This is a severe tactical oversight. You completely missed the opponent's counter-attack.`,
      `A rookie mistake. Grandmasters would resign on the spot after that blunder.`,
      `You've completely compromised your king safety. A direct path to checkmate.`
    ],
    mistake: [
      `A strategic error. You've given up control of the center.`,
      `This creates a long-term weakness in your pawn structure.`,
      `A passive choice. In this position, you must play dynamically.`
    ],
    dubious: [
      `A questionable decision. A disciplined opponent will easily exploit this opening.`,
      `A speculative choice. Against a strong defender, this will only lead to weakness.`
    ],
    interesting: [
      `An ambitious attempt to complicate the game. Speculative, but highly testing.`,
      `A bold choice. It creates tactical imbalances that require precise calculation.`
    ],
    unclear: [
      `The position remains highly complex and equal. Neither side has established a clear path.`,
      `A double-edged position. The evaluation is balanced, but the play is extremely delicate.`
    ],
    excellent: [
      `A highly favorable alternative. Positional accuracy is very high here.`,
      `Excellent positional squeeze. Maintaining a strong grip on the key squares.`
    ],
    best: [
      `The most precise continuation. The engine's top choice, maintaining absolute control.`,
      `Superb accuracy. Finding the required move to press the advantage.`
    ],
    good: [
      `A standard, correct developmental move.`,
      `A sensible trade. Maintains positional equilibrium.`
    ],
    only_move: [
      `A forced response. There was no escape route to avoid the threat.`,
      `When the king is under check, the path is narrow. This was the only legal option.`
    ],
    brilliant: [
      `A profound, highly intuitive sacrifice. This reminds me of Tal's finest combinations.`,
      `Extraordinary vision! This move completely disrupts the opponent's defensive structure.`,
      `Brilliant tactical execution. The sacrifice is fully justified by the dynamic compensation.`
    ]
  };

  const pirateComments = {
    blunder: [
      `Shiver me timbers! Ye just threw yer own ${pieceName} straight to the sharks!`,
      `Arrr! The captain is weeping! Ye walked yer own crewmate off the plank!`,
      `Ahoy! That move was absolute mutiny! The engine is ready to abandon ship!`,
      `Blimey! You've left yer treasures wide open for the takin'!`
    ],
    mistake: [
      `Avast! Ye lost yer bearings with that ${pieceName} move!`,
      `Ye had a treasure map and ye chose to dig in the mud instead!`
    ],
    dubious: [
      `A sketchy course ye're sailing. Ye might be heading straight for a sandbar!`,
      `Avast! That move looks like trouble. Are ye trying to bluff the navy?`
    ],
    interesting: [
      `A bold maneuver! Complications ahead! Prepare the cannons!`,
      `Speculative sailing, matey! It's risky, but it makes for a grand battle!`
    ],
    unclear: [
      `Stormy waters ahead! The map is blank and the compass is spinning!`,
      `Balanced on the edge of the blade! A wild sea fight!`
    ],
    excellent: [
      `A fine alternative course! Squeezing them hard!`,
      `Excellent sailing. Ye're keeping the pressure on their hull!`
    ],
    best: [
      `The captain's choice! The absolute best line to plunder their loot!`,
      `A bullseye shot! Exactly what was needed!`
    ],
    good: [
      `Solid sailing, matey. Keep yer eyes on the horizon.`,
      `Ye've secured the deck. A fine crewman's move.`
    ],
    only_move: [
      `Ye had yer back to the mast! There was only one escape route!`,
      `Only one plank to walk, matey! No other choice!`
    ],
    brilliant: [
      `Shiver me timbers! A legendary strike of genius! The crew is cheering!`,
      `Arrr! A brilliant sacrifice! Ye've out-navigated them completely!`
    ]
  };

  const supportiveComments = {
    blunder: [
      `Oh no! That was a tricky position. It's okay, we learn from our blunders!`,
      `Oops! Don't worry, even grandmasters overlook things. Let's see how we can defend now!`,
      `A tough break. Let's try to focus on piece coordination and keep fighting!`
    ],
    mistake: [
      `A small slip. Let's take a deep breath and look for ways to protect your pieces next turn.`,
      `Not the easiest move to find. You've got this, just stay focused!`
    ],
    dubious: [
      `A little risky, but we can work with this! Let's stay focused on defense.`,
      `A questionable path, but don't worry. Let's see how we can defend together.`
    ],
    interesting: [
      `That's a very creative idea! It makes the game interesting, let's see how it goes!`,
      `A bold and ambitious move. I love the creativity you're showing!`
    ],
    unclear: [
      `A very complex and balanced position. Take your time, you're doing great!`,
      `The game is equal but very dynamic. Trust your instincts!`
    ],
    excellent: [
      `Excellent alternative! You're playing really solid chess.`,
      `A wonderful choice. That keeps your position very strong.`
    ],
    best: [
      `Perfect! You found the absolute best move in the position. Excellent job!`,
      `Spot on! That was the engine's top choice. Keep up the great work!`
    ],
    good: [
      `Great job, very solid move.`,
      `Nice and steady. You're doing great!`
    ],
    only_move: [
      `A forced move, but you played it correctly. Good job staying calm!`,
      `That was the only legal move. Well done finding it under pressure!`
    ],
    brilliant: [
      `Oh my! That is an absolutely brilliant move! What incredible vision!`,
      `Wow! You found a beautiful piece sacrifice. That was amazing!`
    ]
  };

  let list = (sarcasticComments[quality] || sarcasticComments.good) as string[];
  if (personality === 'grandmaster') list = (grandmasterComments[quality] || grandmasterComments.good) as string[];
  else if (personality === 'pirate') list = (pirateComments[quality] || pirateComments.good) as string[];
  else if (personality === 'supportive') list = (supportiveComments[quality] || supportiveComments.good) as string[];

  // Pick pseudo-random comment based on move details to keep it deterministic but varied
  const hash = (move.san.charCodeAt(0) || 0) + (move.san.charCodeAt(move.san.length - 1) || 0) + quality.length;
  const index = hash % list.length;
  let comment = list[index];

  // Post-processing for specific events
  if (quality === 'blunder' && isCapture) {
    comment += ` And doing it while capturing? Double the confusion.`;
  }
  if (isCheck && (quality === 'excellent' || quality === 'best' || quality === 'good')) {
    comment += ` Check is always nice to see!`;
  }

  return comment;
}

// ==========================================
// GEMINI API NARRATOR CALLER
// ==========================================
async function generateGeminiCommentary(
  move: MoveItem,
  quality: string,
  change: number,
  bestMove: string,
  personality: 'sarcastic' | 'supportive' | 'grandmaster' | 'pirate',
  apiKey: string,
  isCheckmate = false,
  isDraw = false
) {
  const pieceName = {
    p: 'Pawn',
    n: 'Knight',
    b: 'Bishop',
    r: 'Rook',
    q: 'Queen',
    k: 'King'
  }[move.piece] || 'piece';

  let endNote = '';
  if (isCheckmate) {
    endNote = ' This move results in CHECKMATE, ending the game. Comment on the final victory or defeat.';
  } else if (isDraw) {
    endNote = ' This move results in a DRAW, ending the game. Comment on the split outcome.';
  } else if (move.san.includes('+')) {
    endNote = ' This move delivers CHECK to the enemy king.';
  }

  const prompt = `You are a witty chess commentator. Critique the following chess move:
Move played: ${move.san} (using ${pieceName})
Move evaluation classification: ${quality.toUpperCase()}
Evaluation change: ${change > 0 ? '+' : ''}${change.toFixed(2)} pawns
Stockfish recommended best move was: ${bestMove}
${endNote}

Please write a witty, strategic, single-sentence critique in the voice of a ${personality} chess commentator.
Keep it under 25 words. Do not use FEN, centipawns, or technical coordinates in the output. Just comment on the chess move itself in a highly engaging, immersive voice. Make it funny or tactical.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            maxOutputTokens: 80,
            temperature: 0.85
          }
        })
      }
    );

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error?.message || 'API request failed');
    }

    const data = await res.json();
    const text = data.contents?.[0]?.parts?.[0]?.text || '';
    return text.trim().replace(/^"|"$/g, ''); // strip any quotes around response
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    // Fall back to local witty commentary engine on failure
    return `[Gemini Error: ${error.message}]. Fallback: ` + getWittyCritique(move, quality as any, change * 100, personality);
  }
}

// ==========================================
// OPENING BOOK MOVE RECOGNITION HELPER
// ==========================================
function isMoveBook(index: number, moves: MoveItem[]) {
  if (index < 0 || index >= moves.length) return false;
  const move = moves[index];
  const standardOpeningMoves = [
    'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd4', 'exd5', 'Nxd4', 'd5', 'exd5', 'Nxd5',
    'O-O', 'Be7', 'Nc3', 'Nxc3', 'bxc3', 'd6', 'Nf6', 'c5', 'c6', 'g6', 'Bg7', 'Bg2',
    'd4', 'd5', 'c4', 'e6', 'g3', 'Nf6', 'Bg2', 'Be7', 'Nf3', 'O-O', 'b3', 'Bb7',
    'c4', 'c5', 'Nc3', 'Nf6', 'g3', 'g6', 'Bg2', 'Bg7', 'e4', 'd6', 'd3', 'e5',
    'f4', 'exf4', 'Bxf4', 'Be7', 'Nf3', 'Nc6', 'Be2', 'Bg4', 'O-O', 'Bxf3', 'Bxf3',
    'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3', 'h6', 'Bxf6', 'Bxf6'
  ];
  return index < 10 && standardOpeningMoves.includes(move.san);
}

