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
  fen: string;
}

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
        const finishedFen = evaluatingFenRef.current;
        const bestMove = bestmoveMatch[1];
        const rawScore = tempScoreRef.current;
        
        // Normalize score to White's perspective
        const activeColor = finishedFen.split(' ')[1];
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
    }
  }, [evalQueue, engineStatus]);

  // Prioritize active FENs to evaluate immediately
  const prioritizeEvaluation = (fen: string) => {
    if (evalCache[fen] !== undefined) return;
    
    // Move this FEN to the front of the queue
    setEvalQueue(prev => [fen, ...prev.filter(f => f !== fen)]);
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
    if (currentMoveIndex === -1) {
      setNarratorText("Ready to analyze. Make a move or choose a historical game to step through the moves.");
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
      setNarratorText("Calculating evaluation of this tactical junction... Hang on.");
      return;
    }

    const isWhite = currentMoveIndex % 2 === 0;
    const change = isWhite ? (score_curr - score_prev) : (score_prev - score_curr);
    
    // Classify move quality
    const bestMove = bestMovesCache[fen_prev] || '';
    const isBestMove = bestMove === (move.from + move.to);
    
    let quality: 'blunder' | 'mistake' | 'inaccuracy' | 'good' | 'excellent' = 'good';
    if (change <= -200) quality = 'blunder';
    else if (change <= -80) quality = 'mistake';
    else if (change <= -30) quality = 'inaccuracy';
    else if (isBestMove || change >= 10) quality = 'excellent';

    const generateCommentary = async () => {
      if (useGemini && geminiApiKey.trim()) {
        setNarratorText("Consulting Gemini AI's chess wits...");
        const response = await generateGeminiCommentary(
          move, 
          quality, 
          change / 100, 
          bestMove, 
          narratorPersonality, 
          geminiApiKey
        );
        setNarratorText(response);
        if (autoSpeak) speakText(response);
      } else {
        const response = getWittyCritique(move, quality, change, narratorPersonality);
        setNarratorText(response);
        if (autoSpeak) speakText(response);
      }
    };

    generateCommentary();
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
          fen: replayChess.fen(),
        });
      }

      setMoves(movesWithFen);
      setLoadedFenStart(SAMPLE_FEN);
      
      // Reset caches for the new game but preserve starting position
      setEvalCache({ [SAMPLE_FEN]: 35 });
      setBestMovesCache({});
      setEvalQueue([SAMPLE_FEN, ...movesWithFen.map(m => m.fen)]);

      setCurrentMoveIndex(0);
      setPositionFen(movesWithFen.length > 0 ? movesWithFen[0].fen : SAMPLE_FEN);
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

      setMoves([]);
      setLoadedFenStart(cleanFen);
      setEvalCache({});
      setBestMovesCache({});
      setEvalQueue([cleanFen]);
      
      setCurrentMoveIndex(-1);
      setPositionFen(cleanFen);
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
    
    const score_curr = evalCache[fen_curr];
    const score_prev = evalCache[fen_prev];
    
    if (score_curr === undefined || score_prev === undefined) return null;
    
    const isWhite = index % 2 === 0;
    const change = isWhite ? (score_curr - score_prev) : (score_prev - score_curr);
    
    const bestMove = bestMovesCache[fen_prev];
    const isBestMove = bestMove === (move.from + move.to);
    
    let quality: 'blunder' | 'mistake' | 'inaccuracy' | 'good' | 'excellent' = 'good';
    let label = 'Good Move';
    let colorClass = 'text-brand-text/50';
    let badgeColor = 'bg-brand-muted';
    
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
        <div key={moveNum} className="grid grid-cols-12 gap-2 py-1.5 px-3 border-b border-brand-muted/10 hover:bg-brand-card/30 text-sm font-mono items-center">
          <span className="col-span-2 text-brand-muted text-xs">{moveNum}.</span>
          
          <button
            onClick={() => jumpToMove(i)}
            className={`col-span-5 text-left py-0.5 px-2 rounded-sm transition-colors flex items-center justify-between gap-1.5 focus-visible:ring-1 focus-visible:ring-brand-accent ${
              currentMoveIndex === i 
                ? 'bg-brand-accent/20 text-brand-accent font-semibold border border-brand-accent/25' 
                : 'text-brand-text hover:bg-brand-card/80'
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
                  ? 'bg-brand-accent/20 text-brand-accent font-semibold border border-brand-accent/25' 
                  : 'text-brand-text hover:bg-brand-card/80'
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
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
          <p className="text-brand-muted font-sans text-sm mb-2">No moves to display.</p>
          <p className="text-xs text-brand-muted/70 font-mono">Paste PGN to analyze a full game, or move pieces manually.</p>
        </div>
      );
    }

    return <div className="divide-y divide-brand-muted/10 overflow-y-auto max-h-[340px] pr-1">{rows}</div>;
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

  const { percent: evalPercent, displayEval } = getEvaluationBarStats();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start w-full min-w-0">
      
      {/* LEFT COLUMN: Chessboard, Navigation and Evaluation Bar */}
      <div className="lg:col-span-7 flex flex-col items-center w-full min-w-0">
        
        {/* Chessboard & Eval Bar Container */}
        <div className="flex gap-4 items-stretch w-full max-w-[500px] h-[340px] sm:h-[460px] md:h-[480px]">
          
          {/* Vertical Evaluation Bar */}
          <div className="w-5 md:w-6 shrink-0 flex flex-col justify-between py-2 relative rounded-md bg-neutral-900 border border-brand-muted/20 overflow-hidden select-none">
            {/* White advantage fill (animating height from bottom) */}
            <div 
              className="absolute bottom-0 left-0 right-0 bg-white/95 transition-all duration-500 ease-out shadow-inner" 
              style={{ height: `${evalPercent}%` }}
            />
            {/* Numeric Evaluation text overlay (vertical) */}
            <div className="absolute inset-x-0 top-3 text-center text-[9px] font-mono font-bold z-10 mix-blend-difference text-white select-none">
              {displayEval}
            </div>
            
            {/* Soft division lines */}
            <div className="absolute inset-x-0 top-1/2 h-[1px] bg-brand-muted/30 z-5" />
          </div>

          {/* Chessboard container */}
          <div 
            className="flex-grow rounded-md overflow-hidden border border-brand-muted/20 bg-brand-card shadow-lg p-2 flex items-center justify-center"
          >
            <div className="w-full aspect-square max-h-[460px]">
              <Chessboard 
                position={positionFen} 
                onPieceDrop={onDrop}
                customDarkSquareStyle={{ backgroundColor: 'oklch(0.25 0.01 0)' }}
                customLightSquareStyle={{ backgroundColor: 'oklch(0.92 0.01 0)' }}
              />
            </div>
          </div>
        </div>

        {/* Move Step Controls */}
        <div className="flex items-center gap-2 mt-4 w-full max-w-[500px] bg-brand-card border border-brand-muted/20 rounded-md p-2 justify-center shadow-md">
          <button
            onClick={() => jumpToMove(-1)}
            disabled={currentMoveIndex === -1}
            className="p-2 rounded-sm text-brand-text hover:bg-brand-bg/85 disabled:opacity-30 disabled:hover:bg-transparent transition-colors focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden"
            aria-label="Go to starting position"
          >
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"></path>
            </svg>
          </button>
          
          <button
            onClick={() => jumpToMove(currentMoveIndex - 1)}
            disabled={currentMoveIndex === -1}
            className="p-2 rounded-sm text-brand-text hover:bg-brand-bg/85 disabled:opacity-30 disabled:hover:bg-transparent transition-colors focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden"
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
              className="px-4 py-1.5 rounded-pill text-xs font-semibold bg-brand-accent text-brand-bg hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:outline-hidden flex items-center gap-1.5"
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

          <button
            onClick={() => jumpToMove(currentMoveIndex + 1)}
            disabled={moves.length === 0 || currentMoveIndex === moves.length - 1}
            className="p-2 rounded-sm text-brand-text hover:bg-brand-bg/85 disabled:opacity-30 disabled:hover:bg-transparent transition-colors focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden"
            aria-label="Go to next move"
          >
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path>
            </svg>
          </button>

          <button
            onClick={() => jumpToMove(moves.length - 1)}
            disabled={moves.length === 0 || currentMoveIndex === moves.length - 1}
            className="p-2 rounded-sm text-brand-text hover:bg-brand-bg/85 disabled:opacity-30 disabled:hover:bg-transparent transition-colors focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden"
            aria-label="Go to end of game"
          >
            <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7"></path>
            </svg>
          </button>
        </div>
        
        {/* Engine Status Bar */}
        <div className="flex justify-between w-full max-w-[500px] mt-2 px-1 text-[11px] font-mono text-brand-muted">
          <span>Status: <span className="text-brand-text capitalize">{engineStatus}</span></span>
          {evalQueue.length > 0 && <span className="animate-pulse text-brand-accent">Analyzing queue: {evalQueue.length} positions left</span>}
        </div>
      </div>

      {/* RIGHT COLUMN: AI Narrator, Inputs & Move history */}
      <div className="lg:col-span-5 flex flex-col gap-6 w-full min-w-0">
        
        {/* AI NARRATOR BOX */}
        <div className="bg-brand-card/65 backdrop-blur-md border border-brand-muted/20 rounded-md p-6 shadow-lg relative overflow-hidden flex flex-col gap-4">
          {/* Header */}
          <div className="flex justify-between items-center border-b border-brand-muted/10 pb-3">
            <div className="flex items-center gap-2">
              <div className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isPlayingAudio ? 'bg-emerald-400' : 'bg-brand-accent'}`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${isPlayingAudio ? 'bg-emerald-500' : 'bg-brand-accent'}`}></span>
              </div>
              <h2 className="text-xs font-mono tracking-wider uppercase text-brand-text/90">
                Narrator Panel
              </h2>
            </div>
            
            {/* Audio narration toggle */}
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-mono text-brand-muted cursor-pointer flex items-center gap-1 select-none">
                <input 
                  type="checkbox" 
                  checked={autoSpeak} 
                  onChange={(e) => setAutoSpeak(e.target.checked)} 
                  className="rounded-sm border-brand-muted/20 accent-brand-accent text-brand-bg w-3.5 h-3.5"
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
                className={`p-1.5 rounded-sm border transition-colors ${
                  isPlayingAudio 
                    ? 'border-emerald-500/35 text-emerald-400 bg-emerald-500/10' 
                    : 'border-brand-muted/20 text-brand-text hover:bg-brand-bg/50'
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
            <div className="w-10 h-10 rounded-sm bg-neutral-900 border border-brand-muted/20 flex items-center justify-center shrink-0 text-brand-accent shadow-inner select-none font-bold">
              {narratorPersonality.charAt(0).toUpperCase()}
            </div>

            {/* Typewritten comment text */}
            <div className="flex-grow">
              <p className="text-sm text-brand-text leading-relaxed font-sans min-h-[40px]">
                {displayedNarration}
                <span className="inline-block w-1.5 h-3 bg-brand-accent ml-0.5 animate-pulse" />
              </p>
              
              {/* Dynamic move rating sub-label */}
              {currentMoveIndex !== -1 && getMoveQualityInfo(currentMoveIndex) && (
                <div className="mt-2 text-xs font-mono flex items-center gap-1.5">
                  <span className={getMoveQualityInfo(currentMoveIndex)!.colorClass}>
                    {getMoveQualityInfo(currentMoveIndex)!.label}
                  </span>
                  <span className="text-brand-muted">
                    (Eval change: {getMoveQualityInfo(currentMoveIndex)!.change > 0 ? '+' : ''}
                    {getMoveQualityInfo(currentMoveIndex)!.change.toFixed(2)})
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Soundwave animation when playing audio */}
          {isPlayingAudio && (
            <div className="flex justify-center items-end gap-[3px] h-6 bg-brand-bg/50 border border-brand-muted/10 rounded-sm p-1">
              <span className="w-[3px] h-3 bg-emerald-500 rounded-pill animate-bounce" style={{ animationDelay: '0.1s' }} />
              <span className="w-[3px] h-5 bg-emerald-400 rounded-pill animate-bounce" style={{ animationDelay: '0.2s' }} />
              <span className="w-[3px] h-2 bg-emerald-500 rounded-pill animate-bounce" style={{ animationDelay: '0.3s' }} />
              <span className="w-[3px] h-4 bg-emerald-400 rounded-pill animate-bounce" style={{ animationDelay: '0.4s' }} />
              <span className="w-[3px] h-1 bg-emerald-500 rounded-pill animate-bounce" style={{ animationDelay: '0.5s' }} />
            </div>
          )}
        </div>

        {/* INPUT POSITION / PGN CARD */}
        <div className="bg-brand-card border border-brand-muted/20 rounded-md p-6 shadow-md relative">
          
          {/* Settings Drawer Button */}
          <button
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className="absolute top-4 right-4 p-1.5 rounded-sm border border-brand-muted/20 hover:bg-brand-bg/50 transition-colors text-brand-muted hover:text-brand-text focus-visible:ring-2 focus-visible:ring-brand-accent"
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
            <div className="border border-brand-muted/20 bg-brand-bg/75 rounded-md p-4 mb-4 flex flex-col gap-4 animate-fadeIn">
              <h3 className="text-xs font-mono font-bold text-brand-text border-b border-brand-muted/10 pb-1.5">
                AI Config & Voice Personalities
              </h3>
              
              {/* Personality selection */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-mono text-brand-muted">Narrator Personality</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['sarcastic', 'supportive', 'grandmaster', 'pirate'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setNarratorPersonality(p)}
                      className={`px-3 py-1 rounded-sm text-xs font-mono capitalize border transition-all ${
                        narratorPersonality === p
                          ? 'border-brand-accent/50 bg-brand-accent/10 text-brand-accent font-semibold'
                          : 'border-brand-muted/10 hover:bg-brand-card/85 text-brand-text/80'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Gemini Key Config */}
              <div className="flex flex-col gap-2 pt-2 border-t border-brand-muted/10">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-mono text-brand-muted">Use Gemini Live API</span>
                  <input 
                    type="checkbox"
                    checked={useGemini}
                    onChange={(e) => setUseGemini(e.target.checked)}
                    disabled={!geminiApiKey.trim()}
                    className="rounded-sm border-brand-muted/20 accent-brand-accent text-brand-bg w-3.5 h-3.5 disabled:opacity-40"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="gemini-key" className="text-[9px] font-mono text-brand-muted/70">
                    Insert Gemini API Key (saves locally in browser)
                  </label>
                  <input
                    id="gemini-key"
                    type="password"
                    value={geminiApiKey}
                    onChange={(e) => handleSaveApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-brand-card border border-brand-muted/20 rounded-sm px-2.5 py-1 text-xs font-mono text-brand-text focus-visible:ring-1 focus-visible:ring-brand-accent focus-visible:outline-hidden"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Tabs for PGN/FEN */}
          <div className="flex gap-2 border-b border-brand-muted/10 pb-4 mb-4">
            <button
              onClick={() => {
                setActiveTab('pgn');
                setInputText('');
                setError('');
              }}
              className={`px-4 py-1.5 rounded-pill text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden ${
                activeTab === 'pgn'
                  ? 'bg-brand-accent text-brand-bg'
                  : 'text-brand-text/70 hover:bg-brand-bg/50'
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
                  ? 'bg-brand-accent text-brand-bg'
                  : 'text-brand-text/70 hover:bg-brand-bg/50'
              }`}
            >
              FEN Position
            </button>
          </div>

          {/* Form Area */}
          <div className="flex flex-col gap-3">
            <label htmlFor="chess-input" className="text-xs font-mono text-brand-muted">
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
              className="w-full bg-brand-bg border border-brand-muted/20 rounded-sm p-3 font-mono text-sm text-brand-text focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:outline-hidden transition-all placeholder:text-brand-muted/50"
              spellCheck={false}
              autoComplete="off"
            />

            {/* Inline Error Alert */}
            {error && (
              <div 
                aria-live="polite" 
                className="flex items-start gap-2 text-xs text-danger bg-danger/10 border border-danger/20 rounded-sm p-3 font-mono animate-fadeIn"
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
                className="px-6 py-2 rounded-pill text-sm font-semibold bg-brand-accent text-brand-bg hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:outline-hidden"
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
                className="px-4 py-2 rounded-pill text-sm font-semibold bg-brand-bg text-brand-text border border-brand-muted/20 hover:bg-brand-bg/50 transition-colors focus-visible:ring-2 focus-visible:ring-brand-accent/50 focus-visible:outline-hidden"
              >
                Load Sample
              </button>
            </div>
          </div>
        </div>

        {/* Moves History Card Container */}
        <div className="bg-brand-card border border-brand-muted/20 rounded-md p-6 shadow-md flex flex-col flex-grow min-h-[300px]">
          <h2 className="text-sm font-mono text-brand-muted border-b border-brand-muted/10 pb-3 mb-3">
            Moves List
          </h2>
          {renderMoveList()}
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
