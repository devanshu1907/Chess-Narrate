import React, { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';

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
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Refs
  const autoplayTimerRef = useRef<NodeJS.Timeout | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const evaluatingFenRef = useRef<string | null>(null);
  const tempScoreRef = useRef<number>(0);
  const tempIsMateRef = useRef<boolean>(false);
  const evalTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastNarratedFenRef = useRef<string | null>(null);
  const lastSettingsRef = useRef({ personality: '', useGemini: false });

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
        setEngineStatus('ready');
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
    if ((engineStatus === 'ready' || engineStatus === 'idle') && evalQueue.length > 0 && workerRef.current) {
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


  // Clear autoplay on unmount
  useEffect(() => {
    return () => {
      if (autoplayTimerRef.current) clearInterval(autoplayTimerRef.current);
    };
  }, []);

  // Handle autoplay stepping
  useEffect(() => {
    if (isPlaying) {
      autoplayTimerRef.current = setInterval(() => {
        setCurrentMoveIndex((prevIndex) => {
          if (prevIndex < moves.length - 1) {
            const nextIndex = prevIndex + 1;
            setPositionFen(moves[nextIndex].fen);
            return nextIndex;
          } else {
            setIsPlaying(false);
            if (autoplayTimerRef.current) clearInterval(autoplayTimerRef.current);
            return prevIndex;
          }
        });
      }, 3500); // Slower for autoplay so users have time to read/listen to narration
    } else {
      if (autoplayTimerRef.current) {
        clearInterval(autoplayTimerRef.current);
        autoplayTimerRef.current = null;
      }
    }
    return () => {
      if (autoplayTimerRef.current) clearInterval(autoplayTimerRef.current);
    };
  }, [isPlaying, moves]);

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

  // Speak narrator commentary (TTS)
  const speakText = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    window.speechSynthesis.cancel();
    
    const cleanText = text.replace(/\[.*?\]/g, ''); // strip any brackets
    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Choose voice based on personality
    const voices = window.speechSynthesis.getVoices();
    let selectedVoice = null;
    
    if (narratorPersonality === 'pirate') {
      // Pirate sounds better with a deeper British voice if available
      selectedVoice = voices.find(v => v.lang.startsWith('en-GB')) || voices.find(v => v.lang.startsWith('en-'));
      utterance.pitch = 0.75;
      utterance.rate = 0.95;
    } else if (narratorPersonality === 'grandmaster') {
      selectedVoice = voices.find(v => v.lang.startsWith('en-GB')) || voices.find(v => v.lang.startsWith('en-'));
      utterance.pitch = 0.9;
      utterance.rate = 0.9;
    } else {
      selectedVoice = voices.find(v => v.lang.startsWith('en-US')) || voices.find(v => v.lang.startsWith('en-'));
      utterance.pitch = 1.0;
      utterance.rate = 1.05;
    }
    
    if (selectedVoice) {
      utterance.voice = selectedVoice;
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
    const fen_curr = move.fen;
    const fen_prev = currentMoveIndex === 0 ? loadedFenStart : moves[currentMoveIndex - 1].fen;
    
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
    
    // Classify move quality
    const prevFen = currentMoveIndex === 0 ? loadedFenStart : moves[currentMoveIndex - 1]?.fen;
    const bestMove = bestMovesCache[prevFen] || '';
    
    let quality: 'blunder' | 'mistake' | 'inaccuracy' | 'good' | 'excellent' = 'good';
    if (change <= -200) quality = 'blunder';
    else if (change <= -80) quality = 'mistake';
    else if (change <= -30) quality = 'inaccuracy';
    else {
      const isBestMove = bestMove === (move.from + move.to);
      if (isBestMove || change >= 10) quality = 'excellent';
    }

    let isCurrent = true;

    const generateCommentary = async () => {
      let response = '';
      if (useGemini && geminiApiKey.trim()) {
        setNarratorText("Consulting Gemini AI's chess wits...");
        response = await generateGeminiCommentary(
          move, 
          isMoveBook(currentMoveIndex, moves) ? 'book' : quality, 
          change / 100, 
          bestMove, 
          narratorPersonality, 
          geminiApiKey
        );
      } else {
        response = isMoveBook(currentMoveIndex, moves) 
          ? `A standard opening book move, developing pieces and preparing for early-game strategy.`
          : getWittyCritique(move, quality, change, narratorPersonality);
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
        replayChess.move(m.san);
        movesWithFen.push({
          san: m.san,
          from: m.from,
          to: m.to,
          piece: m.piece,
          fen: replayChess.fen(),
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
    } catch (err: any) {
      setError('Invalid FEN format. Verify the configuration values and piece placement.');
    }
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
    try {
      const tempChess = new Chess(loadedFenStart);
      
      // Replay moves up to current index
      for (let i = 0; i <= currentMoveIndex; i++) {
        tempChess.move(moves[i].san);
      }

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
      };

      const updatedMoves = [...moves.slice(0, currentMoveIndex + 1), newMove];
      setMoves(updatedMoves);
      
      // Trigger evaluation for this new FEN immediately
      prioritizeEvaluation(newMove.fen);

      setCurrentMoveIndex(updatedMoves.length - 1);
      setPositionFen(newMove.fen);
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
        quality: 'book' as any, 
        label: 'Book Move', 
        colorClass: 'text-[#8b5a2b] font-semibold', 
        badgeColor: 'bg-[#8b5a2b]', 
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
    
    let quality: 'blunder' | 'mistake' | 'inaccuracy' | 'good' | 'excellent' = 'good';
    let label = 'Good Move';
    let colorClass = 'text-brand-body';
    let badgeColor = 'bg-brand-mute';
    
    if (change <= -200) {
      quality = 'blunder';
      label = 'Blunder';
      colorClass = 'text-red-500 font-semibold';
      badgeColor = 'bg-red-500';
    } else if (change <= -80) {
      quality = 'mistake';
      label = 'Mistake';
      colorClass = 'text-amber-500 font-semibold';
      badgeColor = 'bg-amber-500';
    } else if (change <= -30) {
      quality = 'inaccuracy';
      label = 'Inaccuracy';
      colorClass = 'text-yellow-500/90';
      badgeColor = 'bg-yellow-500';
    } else if (isBestMove || change >= 10) {
      quality = 'excellent';
      label = isBestMove ? 'Best Move' : 'Excellent';
      colorClass = 'text-emerald-500 font-semibold';
      badgeColor = 'bg-emerald-500';
    }
    
    return { quality, label, colorClass, badgeColor, change: change / 100 };
  };

  // Helper to calculate summary statistics for white and black
  const calculateStats = () => {
    const whiteStats = { excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    const blackStats = { excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    
    moves.forEach((move, idx) => {
      const isWhite = idx % 2 === 0;
      const stats = isWhite ? whiteStats : blackStats;
      
      if (isMoveBook(idx, moves)) {
        stats.good++;
        return;
      }
      
      const fen_curr = move.fen;
      const fen_prev = idx === 0 ? loadedFenStart : moves[idx - 1].fen;
      
      const score_curr = evalCache[fen_curr];
      const score_prev = evalCache[fen_prev];
      
      if (score_curr !== undefined && score_prev !== undefined) {
        const change = isWhite ? (score_curr - score_prev) : (score_prev - score_curr);
        const bestMove = bestMovesCache[fen_prev];
        const isBestMove = bestMove === (move.from + move.to);
        
        if (change <= -200) stats.blunder++;
        else if (change <= -80) stats.mistake++;
        else if (change <= -30) stats.inaccuracy++;
        else if (isBestMove || change >= 10) stats.excellent++;
        else stats.good++;
      }
    });
    
    return { whiteStats, blackStats };
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
      if (qualityInfo.quality === 'book') {
        styles[lastMove.to] = { backgroundColor: 'rgba(139, 90, 43, 0.25)' };
      } else if (qualityInfo.quality === 'excellent') {
        styles[lastMove.to] = { backgroundColor: 'rgba(16, 185, 129, 0.25)' };
      } else if (qualityInfo.quality === 'inaccuracy') {
        styles[lastMove.to] = { backgroundColor: 'rgba(234, 179, 8, 0.25)' };
      } else if (qualityInfo.quality === 'mistake') {
        styles[lastMove.to] = { backgroundColor: 'rgba(249, 115, 22, 0.25)' };
      } else if (qualityInfo.quality === 'blunder') {
        styles[lastMove.to] = { backgroundColor: 'rgba(239, 68, 68, 0.25)' };
      } else {
        styles[lastMove.to] = { backgroundColor: 'rgba(0, 112, 243, 0.25)' };
      }
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
            
            {/* Main Line path */}
            {pathD && (
              <path 
                d={pathD} 
                fill="none" 
                stroke="var(--color-brand-accent)" 
                strokeWidth="2.5" 
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-all duration-300"
              />
            )}
            
            {/* Clickable node points */}
            {points.map((pt, i) => (
              <g key={i} className="group cursor-pointer" onClick={() => jumpToMove(pt.index)}>
                <circle 
                  cx={pt.x} 
                  cy={pt.y} 
                  r={currentMoveIndex === pt.index ? 5.5 : 3.5} 
                  fill={currentMoveIndex === pt.index ? 'var(--color-brand-accent)' : 'var(--color-brand-canvas)'} 
                  stroke="var(--color-brand-accent)" 
                  strokeWidth={currentMoveIndex === pt.index ? 2 : 1.5}
                  className="transition-all hover:scale-150 duration-150"
                />
                <title>
                  {pt.index === -1 ? 'Start' : `Move ${Math.floor(pt.index / 2) + 1} ${pt.index % 2 === 0 ? 'White' : 'Black'}`} ({pt.score > 0 ? '+' : ''}{pt.score.toFixed(1)})
                </title>
              </g>
            ))}
          </svg>
        </div>
      </div>
    );
  };

  // Render moves statistics summary dashboard
  const renderStatsSummary = () => {
    if (moves.length === 0) return null;
    const { whiteStats, blackStats } = calculateStats();
    
    return (
      <div className="mt-4 pt-4 border-t border-brand-hairline">
        <h3 className="text-xs font-mono font-bold text-brand-ink mb-3 uppercase tracking-wider select-none">
          Game Statistics
        </h3>
        <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono items-center">
          <div className="text-left font-semibold text-brand-ink pl-1">White</div>
          <div className="text-brand-body text-[10px] uppercase">Category</div>
          <div className="text-right font-semibold text-brand-ink pr-1">Black</div>
          
          {/* Excellent */}
          <div className="text-left text-emerald-500 font-bold pl-1">{whiteStats.excellent}</div>
          <div className="text-brand-body text-[10px]">Excellent / Best</div>
          <div className="text-right text-emerald-500 font-bold pr-1">{blackStats.excellent}</div>

          {/* Good */}
          <div className="text-left text-brand-ink pl-1">{whiteStats.good}</div>
          <div className="text-brand-body text-[10px]">Good</div>
          <div className="text-right text-brand-ink pr-1">{blackStats.good}</div>

          {/* Inaccuracy */}
          <div className="text-left text-yellow-500 pl-1">{whiteStats.inaccuracy}</div>
          <div className="text-brand-body text-[10px]">Inaccuracy</div>
          <div className="text-right text-yellow-500 pr-1">{blackStats.inaccuracy}</div>

          {/* Mistake */}
          <div className="text-left text-amber-500 pl-1">{whiteStats.mistake}</div>
          <div className="text-brand-body text-[10px]">Mistake</div>
          <div className="text-right text-amber-500 pr-1">{blackStats.mistake}</div>

          {/* Blunder */}
          <div className="text-left text-red-500 font-bold pl-1">{whiteStats.blunder}</div>
          <div className="text-brand-body text-[10px] font-semibold text-red-500/80">Blunder</div>
          <div className="text-right text-red-500 font-bold pr-1">{blackStats.blunder}</div>
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
    const activeFen = currentMoveIndex === -1 ? loadedFenStart : moves[currentMoveIndex].fen;
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

  // Define CustomSquare to render evaluation favicons/badges directly on the board
  const CustomSquare = React.useMemo(() => {
    const Component = React.forwardRef<HTMLDivElement, any>(
      ({ children, square, squareColor, style }, ref) => {
        const currentMove = currentMoveIndex !== -1 ? moves[currentMoveIndex] : null;
        const isDestination = currentMove && currentMove.to === square;
        
        let badge = null;
        if (isDestination) {
          const qualityInfo = getMoveQualityInfo(currentMoveIndex);
          if (qualityInfo) {
            let icon = '';
            let bgColor = '';
            
            if (qualityInfo.quality === 'book') {
              icon = '📖';
              bgColor = 'bg-[#8b5a2b]';
            } else if (qualityInfo.quality === 'excellent') {
              icon = '★';
              bgColor = 'bg-emerald-500';
            } else if (qualityInfo.quality === 'inaccuracy') {
              icon = '?!';
              bgColor = 'bg-yellow-500';
            } else if (qualityInfo.quality === 'mistake') {
              icon = '?';
              bgColor = 'bg-orange-500';
            } else if (qualityInfo.quality === 'blunder') {
              icon = '??';
              bgColor = 'bg-red-500';
            }
            
            if (icon && bgColor) {
              badge = (
                <div 
                  className={`absolute top-0.5 right-0.5 z-10 w-4 h-4 md:w-5 md:h-5 rounded-full flex items-center justify-center text-[8px] md:text-[10px] font-bold text-white shadow-md select-none pointer-events-none ${bgColor}`}
                  title={qualityInfo.label}
                >
                  {icon}
                </div>
              );
            }
          }
        }

        return (
          <div ref={ref} style={{ ...style, position: 'relative' }}>
            {children}
            {badge}
          </div>
        );
      }
    );
    Component.displayName = 'CustomSquare';
    return Component;
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

  return (
    <div className="w-full flex flex-col">
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
          <div className="flex gap-4 items-stretch w-full max-w-[500px] h-[340px] sm:h-[460px] md:h-[480px]">
            
            {/* Vertical Evaluation Bar */}
            <div className="w-5 md:w-6 shrink-0 flex flex-col justify-between py-2 relative rounded-md bg-brand-primary border border-brand-hairline overflow-hidden select-none shadow-lvl1">
              {/* White advantage fill (animating height from bottom) */}
              <div 
                className="absolute bottom-0 left-0 right-0 bg-brand-on-primary transition-all duration-500 ease-out" 
                style={{ height: `${evalPercent}%` }}
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
              className="flex-grow rounded-md overflow-hidden border border-brand-hairline bg-brand-canvas shadow-lvl2 p-2 flex items-center justify-center"
            >
              <div className="w-full aspect-square max-h-[460px]">
                <Chessboard 
                  key={loadedFenStart + boardOrientation}
                  position={positionFen} 
                  onPieceDrop={onDrop}
                  boardOrientation={boardOrientation}
                  customSquare={CustomSquare}
                  customSquareStyles={getCustomSquareStyles()}
                  customDarkSquareStyle={{ backgroundColor: 'var(--color-brand-hairline-strong)' }}
                  customLightSquareStyle={{ backgroundColor: 'var(--color-brand-canvas)' }}
                />
              </div>
            </div>
          </div>

 
        {/* Move Step Controls */}
        <div className="flex items-center gap-2 mt-4 w-full max-w-[500px] bg-brand-canvas border border-brand-hairline rounded-md p-2 justify-center shadow-lvl2">
          <button
            onClick={() => jumpToMove(-1)}
            disabled={currentMoveIndex === -1}
            className="p-2 rounded-sm text-brand-ink hover:bg-brand-canvas-soft2 border border-transparent hover:border-brand-hairline disabled:opacity-30 disabled:hover:bg-transparent transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden"
            aria-label="Go to starting position"
          >
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"></path>
            </svg>
          </button>
          
          <button
            onClick={() => jumpToMove(currentMoveIndex - 1)}
            disabled={currentMoveIndex === -1}
            className="p-2 rounded-sm text-brand-ink hover:bg-brand-canvas-soft2 border border-transparent hover:border-brand-hairline disabled:opacity-30 disabled:hover:bg-transparent transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden"
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
              className="px-4 py-1.5 rounded-pill text-xs font-semibold bg-brand-primary text-brand-on-primary hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:outline-hidden flex items-center gap-1.5"
              aria-label={isPlaying ? "Pause autoplay" : "Play autoplay"}
            >
              {isPlaying ? (
                <>
                  <svg aria-hidden="true" className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <rect x="4" y="4" width="6" height="16" rx="1"></rect>
                    <rect x="14" y="4" width="6" height="16" rx="1"></rect>
                  </svg>
                  Pause
                </>
              ) : (
                <>
                  <svg aria-hidden="true" className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 5v14l11-7z"></path>
                  </svg>
                  Autoplay
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
          <span>Status: <span className="text-brand-ink capitalize">{engineStatus}</span></span>
          {evalQueue.length > 0 && <span className="animate-pulse text-brand-accent font-semibold">Analyzing queue: {evalQueue.length} positions left</span>}
        </div>

        {/* Evaluation Line Chart */}
        {renderEvalChart()}
      </div>
 
      {/* RIGHT COLUMN: AI Narrator, Inputs & Move history */}
      <div className="lg:col-span-5 flex flex-col gap-6 w-full min-w-0">
        
        {/* AI NARRATOR BOX */}
        <div className="bg-brand-canvas border border-brand-hairline rounded-md p-6 shadow-lvl3 relative overflow-hidden flex flex-col gap-4">
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
          <div className="min-h-[90px] flex items-start gap-3">
            {/* Avatar icon */}
            <div className="w-10 h-10 rounded-sm bg-brand-primary border border-brand-hairline flex items-center justify-center shrink-0 text-brand-on-primary shadow-inner select-none font-bold uppercase">
              {narratorPersonality.charAt(0)}
            </div>
 
            {/* Typewritten comment text */}
            <div className="flex-grow">
              <p className="text-sm text-brand-ink leading-relaxed font-sans min-h-[40px]">
                {displayedNarration}
                <span className="inline-block w-1.5 h-3 bg-brand-accent ml-0.5 animate-pulse" />
              </p>
              
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
                      className={`px-3 py-1.5 rounded-sm text-xs font-mono capitalize border transition-all ${
                        narratorPersonality === p
                          ? 'border-brand-accent bg-brand-accent/5 text-brand-accent font-semibold shadow-xs'
                          : 'border-brand-hairline hover:bg-brand-canvas hover:border-brand-hairline-strong text-brand-body'
                      }`}
                    >
                      {p}
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
                </div>
              </div>
            </div>
          )}
 
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
        </div>
 
        {/* Moves History Card Container */}
        <div className="bg-brand-canvas border border-brand-hairline rounded-md p-6 shadow-lvl2 flex flex-col flex-grow min-h-[300px]">
          <h2 className="text-sm font-mono text-brand-body border-b border-brand-hairline pb-3 mb-3 select-none">
            Moves List
          </h2>
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
  quality: 'blunder' | 'mistake' | 'inaccuracy' | 'good' | 'excellent', 
  change: number,
  personality: string
) {
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
    inaccuracy: [
      `A bit passive. The board is screaming for action, and you're just shifting pawns.`,
      `It's a move, certainly. It occupies space. But did it actually do anything?`,
      `A minor slip. Your position is fine, but you're letting the advantage slip away.`,
      `The engine is yawning. You could have pressed the attack more.`
    ],
    excellent: [
      `Magnus? Is that you? That was a masterclass move!`,
      `An absolute beauty of a move. You saw that line from miles away!`,
      `The engine is nodding in binary approval. Beautifully played.`,
      `Perfect tactical execution. That's how we win games!`
    ],
    good: [
      `Solid move. Keeps the pressure on.`,
      `Good positional play. No complaints from the engine.`,
      `Keeping it simple and effective. A sensible choice.`
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
    inaccuracy: [
      `Slightly off-target. The bishop pair would have been more active.`,
      `Not the most precise move. It allows the opponent to consolidate.`
    ],
    excellent: [
      `A superb positional squeeze. Very high-level chess!`,
      `Excellent calculation. You've successfully converted the advantage.`,
      `Brilliant tactical play. You're squeezing the board beautifully.`
    ],
    good: [
      `A standard, correct developmental move.`,
      `A sensible trade. Maintains positional equilibrium.`
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
    inaccuracy: [
      `A bit slow, ye scallywag! Wind is in yer sails, but ye're not movin'!`,
      `Not the worst, but ye could've plundered more booty with a better strike!`
    ],
    excellent: [
      `Arrr! A legendary strike! Ye've shattered their hull!`,
      `Ahoy! That's how a true pirate plunders! Excellent find!`
    ],
    good: [
      `Solid sailing, matey. Keep yer eyes on the horizon.`,
      `Ye've secured the deck. A fine crewman's move.`
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
    inaccuracy: [
      `Almost there! A slightly different plan might have been stronger, but your game is still solid.`,
      `Keep going! You're building good habits, just watch out for opponent's active pieces.`
    ],
    excellent: [
      `Wow, fantastic vision! You're really seeing the board well.`,
      `Incredible move! That shows great tactical awareness. Keep it up!`
    ],
    good: [
      `Great job, very solid move.`,
      `Nice and steady. You're doing great!`
    ]
  };

  let list = sarcasticComments[quality];
  if (personality === 'grandmaster') list = grandmasterComments[quality];
  else if (personality === 'pirate') list = pirateComments[quality];
  else if (personality === 'supportive') list = supportiveComments[quality];

  // Pick pseudo-random comment based on move details to keep it deterministic but varied
  const hash = (move.san.charCodeAt(0) || 0) + (move.san.charCodeAt(move.san.length - 1) || 0) + quality.length;
  const index = hash % list.length;
  let comment = list[index];

  // Post-processing for specific events
  if (quality === 'blunder' && isCapture) {
    comment += ` And doing it while capturing? Double the confusion.`;
  }
  if (isCheck && (quality === 'excellent' || quality === 'good')) {
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
  personality: string,
  apiKey: string
) {
  const pieceName = {
    p: 'Pawn',
    n: 'Knight',
    b: 'Bishop',
    r: 'Rook',
    q: 'Queen',
    k: 'King'
  }[move.piece] || 'piece';

  const prompt = `You are a witty chess commentator. Critique the following chess move:
Move played: ${move.san} (using ${pieceName})
Move evaluation classification: ${quality.toUpperCase()}
Evaluation change: ${change > 0 ? '+' : ''}${change.toFixed(2)} pawns
Stockfish recommended best move was: ${bestMove}

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

