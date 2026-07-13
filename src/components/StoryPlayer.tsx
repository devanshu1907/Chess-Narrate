import React, { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type { StoryGame, MoveQuality } from '../data/stories';

// ── Move quality helpers ──────────────────────────────────────────────────────

const QUALITY_LABEL: Record<MoveQuality, string> = {
  brilliant: 'Brilliant!!',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book',
  interesting: 'Interesting',
  unclear: 'Unclear',
  dubious: 'Dubious',
  mistake: 'Mistake',
  blunder: 'Blunder',
  only_move: 'Only Move',
};

const QUALITY_SYMBOL: Record<MoveQuality, string> = {
  brilliant: '!!',
  best: '',
  excellent: '!',
  good: '',
  book: '',
  interesting: '!?',
  unclear: '∞',
  dubious: '?!',
  mistake: '?',
  blunder: '??',
  only_move: '□',
};

const QUALITY_COLOR: Record<MoveQuality, string> = {
  brilliant: '#26c6da',   // cyan (matches ChessInterface.tsx)
  best: '#22c55e',        // green
  excellent: '#4ade80',   // light green
  good: '#86efac',        // pale green
  book: '#8b5a2b',        // brown/ochre (matches ChessInterface.tsx)
  interesting: '#fb923c', // orange
  unclear: '#94a3b8',     // slate
  dubious: '#f97316',     // orange
  mistake: '#f87171',     // red-ish
  blunder: '#ef4444',     // red
  only_move: '#60a5fa',   // blue
};

const QUALITY_BG: Record<MoveQuality, string> = {
  brilliant: 'rgba(38, 198, 218, 0.15)',
  best: 'rgba(34,197,94,0.12)',
  excellent: 'rgba(74,222,128,0.12)',
  good: 'transparent',
  book: 'rgba(139, 90, 43, 0.15)',
  interesting: 'rgba(251,146,60,0.12)',
  unclear: 'rgba(148,163,184,0.10)',
  dubious: 'rgba(249,115,22,0.12)',
  mistake: 'rgba(248,113,113,0.12)',
  blunder: 'rgba(239,68,68,0.15)',
  only_move: 'rgba(96,165,250,0.12)',
};

const QUALITY_ICON: Record<MoveQuality, string> = {
  brilliant: '!!',
  best: '✓',
  excellent: '★',
  good: '✓',
  book: '📖',
  interesting: '!?',
  unclear: '∞',
  dubious: '?!',
  mistake: '?',
  blunder: '??',
  only_move: '□',
};

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




function MoveQualityBadge({ quality }: { quality: MoveQuality }) {
  const symbol = QUALITY_SYMBOL[quality];
  if (!symbol && quality !== 'best' && quality !== 'good') return null;
  if (!symbol) return null;
  return (
    <span
      title={QUALITY_LABEL[quality]}
      style={{ color: QUALITY_COLOR[quality], fontSize: '0.7em', fontWeight: 700, letterSpacing: '-0.02em' }}
    >{symbol}</span>
  );
}

function QualityDot({ quality }: { quality: MoveQuality }) {
  return (
    <span
      title={QUALITY_LABEL[quality]}
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        backgroundColor: QUALITY_COLOR[quality],
        flexShrink: 0,
        marginTop: 1,
      }}
    />
  );
}

interface MoveItem {
  san: string;
  from: string;
  to: string;
  piece: string;
  fen: string;
}

// Badge progress stored in localStorage
const BADGES_KEY = 'chess_narrator_story_badges';

function loadBadges(): Record<string, { completed: boolean; accuracy: number }> {
  try {
    const raw = localStorage.getItem(BADGES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveBadge(slug: string, accuracy: number) {
  const badges = loadBadges();
  badges[slug] = { completed: true, accuracy };
  localStorage.setItem(BADGES_KEY, JSON.stringify(badges));
}

// Personality type
type Personality = 'sarcastic' | 'supportive' | 'grandmaster' | 'pirate';

export default function StoryPlayer({ story }: { story: StoryGame }) {
  // Parse PGN into moves
  const [moves, setMoves] = useState<MoveItem[]>([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  const [positionFen, setPositionFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

  // Challenge state
  const [isChallengeActive, setIsChallengeActive] = useState(false);
  const [challengeResult, setChallengeResult] = useState<'pending' | 'correct' | 'incorrect'>('pending');
  const [totalChallenges, setTotalChallenges] = useState(0);
  const [correctGuesses, setCorrectGuesses] = useState(0);

  // Story completion
  const [isCompleted, setIsCompleted] = useState(false);

  // UI state
  const [narratorText, setNarratorText] = useState('');
  const [displayedNarration, setDisplayedNarration] = useState('');
  const [personality, setPersonality] = useState<Personality>('sarcastic');
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white');
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const autoplayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevMoveIndexRef = useRef(-1);

  // TTS State
  const [autoSpeak, setAutoSpeak] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chess-auto-speak');
      return saved === 'true';
    }
    return false;
  });
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // Sync autoSpeak to localStorage
  useEffect(() => {
    localStorage.setItem('chess-auto-speak', String(autoSpeak));
  }, [autoSpeak]);

  // Cancel speech on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Speak narrator commentary (TTS)
  const speakText = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    window.speechSynthesis.cancel();
    
    const cleanText = text.replace(/\[.*?\]/g, '').replace(/Challenge!/g, ''); // strip brackets and Challenge exclamation
    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Choose voice based on personality
    const voices = window.speechSynthesis.getVoices();
    let selectedVoice = null;
    
    if (personality === 'pirate') {
      selectedVoice = voices.find(v => v.lang.startsWith('en-GB')) || voices.find(v => v.lang.startsWith('en-'));
      utterance.pitch = 0.75;
      utterance.rate = 0.95;
    } else if (personality === 'grandmaster') {
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

  // Automatically speak when text changes if autoSpeak is enabled
  useEffect(() => {
    if (autoSpeak && narratorText) {
      speakText(narratorText);
    }
  }, [narratorText, autoSpeak]);

  // Parse PGN on mount
  useEffect(() => {
    try {
      const chess = new Chess();
      chess.loadPgn(story.pgn);
      const history = chess.history({ verbose: true });
      const replay = new Chess();
      const parsed: MoveItem[] = [];

      for (const m of history) {
        replay.move(m.san);
        parsed.push({
          san: m.san,
          from: m.from,
          to: m.to,
          piece: m.piece,
          fen: replay.fen(),
        });
      }

      setMoves(parsed);
      setNarratorText(story.description);
    } catch (e) {
      console.error('Failed to parse story PGN:', e);
      setNarratorText('Error loading this story. The PGN could not be parsed.');
    }
  }, [story]);

  // Typing animation for narrator
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
    }, 12);
    return () => clearInterval(interval);
  }, [narratorText]);

  // Autoplay
  useEffect(() => {
    if (isAutoPlaying && !isChallengeActive) {
      autoplayRef.current = setInterval(() => {
        setCurrentMoveIndex((prev) => {
          const next = prev + 1;
          if (next >= moves.length) {
            setIsAutoPlaying(false);
            return prev;
          }
          // Check if next move is a challenge
          if (story.challengeMoves.includes(next)) {
            setIsAutoPlaying(false);
            return prev;
          }
          setPositionFen(moves[next].fen);
          return next;
        });
      }, 2500);
    } else if (autoplayRef.current) {
      clearInterval(autoplayRef.current);
      autoplayRef.current = null;
    }
    return () => {
      if (autoplayRef.current) clearInterval(autoplayRef.current);
    };
  }, [isAutoPlaying, isChallengeActive, moves, story]);

  // Trigger synthesized sound effects on move changes
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

  // Check for challenge activation when move index changes
  useEffect(() => {
    if (currentMoveIndex >= 0 && currentMoveIndex < moves.length - 1) {
      const nextMove = currentMoveIndex + 1;
      if (story.challengeMoves.includes(nextMove) && !isChallengeActive && challengeResult === 'pending') {
        // Activate challenge for the NEXT move
        setIsChallengeActive(true);
        const hint = story.challengeHints[nextMove] || 'Can you find the best move here?';
        setNarratorText(`Challenge! ${hint}`);
      }
    }
  }, [currentMoveIndex, story, isChallengeActive, challengeResult]);

  // Re-generate commentary when move index or personality changes
  useEffect(() => {
    // If a challenge is active for the NEXT move, we show the challenge hint, not the narration for current move.
    const nextMove = currentMoveIndex + 1;
    if (currentMoveIndex >= 0 && nextMove < moves.length && story.challengeMoves.includes(nextMove) && isChallengeActive) {
      return;
    }

    if (currentMoveIndex === -1) {
      setNarratorText(story.description);
    } else {
      generateMoveNarration(currentMoveIndex);
    }
  }, [currentMoveIndex, personality, story, isChallengeActive]);

  // Generate narrator text for a move
  const generateMoveNarration = (index: number) => {
    if (index < 0 || index >= moves.length) return;
    const move = moves[index];
    const isWhite = index % 2 === 0;
    const moveNum = Math.floor(index / 2) + 1;
    const player = isWhite ? 'White' : 'Black';
    const pieceName: Record<string, string> = {
      p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King',
    };
    const piece = pieceName[move.piece] || 'piece';
    const isCapture = move.san.includes('x');
    const isCheck = move.san.includes('+') || move.san.includes('#');
    const isCheckmate = move.san.includes('#');

    if (isCheckmate) {
      const comments: Record<Personality, string> = {
        sarcastic: `Checkmate. ${moveNum}.${move.san} — and just like that, the curtain falls. What a show.`,
        supportive: `Checkmate! ${moveNum}.${move.san} — What a spectacular finish! The game is won!`,
        grandmaster: `${moveNum}.${move.san} — Checkmate. The mating pattern was forced. A textbook conclusion.`,
        pirate: `Checkmate, ye landlubbers! ${moveNum}.${move.san} — The enemy fleet is sunk to the bottom!`,
      };
      setNarratorText(comments[personality]);
      return;
    }

    if (isCapture && isCheck) {
      const comments: Record<Personality, string> = {
        sarcastic: `${moveNum}.${isWhite ? '' : '..'}${move.san} — ${player} captures with check. Efficient and ruthless.`,
        supportive: `${moveNum}.${isWhite ? '' : '..'}${move.san} — Great ${piece} capture with check! The pressure is building!`,
        grandmaster: `${moveNum}.${isWhite ? '' : '..'}${move.san} — A forcing capture-check sequence. The initiative is firmly held.`,
        pirate: `${moveNum}.${isWhite ? '' : '..'}${move.san} — ${player} plunders a piece AND fires a cannon! Arrr!`,
      };
      setNarratorText(comments[personality]);
    } else if (isCapture) {
      const comments: Record<Personality, string> = {
        sarcastic: `${moveNum}.${isWhite ? '' : '..'}${move.san} — ${player}'s ${piece} takes no prisoners. Material advantage shifts.`,
        supportive: `${moveNum}.${isWhite ? '' : '..'}${move.san} — Nice capture! ${player} picks up material with the ${piece}.`,
        grandmaster: `${moveNum}.${isWhite ? '' : '..'}${move.san} — An exchange. The material imbalance here favors the side with the initiative.`,
        pirate: `${moveNum}.${isWhite ? '' : '..'}${move.san} — Loot seized! ${player}'s ${piece} plunders the booty!`,
      };
      setNarratorText(comments[personality]);
    } else if (isCheck) {
      const comments: Record<Personality, string> = {
        sarcastic: `${moveNum}.${isWhite ? '' : '..'}${move.san} — Check. The king better start running.`,
        supportive: `${moveNum}.${isWhite ? '' : '..'}${move.san} — Check! ${player} keeps the pressure on the enemy king!`,
        grandmaster: `${moveNum}.${isWhite ? '' : '..'}${move.san} — Check. The king is displaced and the initiative continues.`,
        pirate: `${moveNum}.${isWhite ? '' : '..'}${move.san} — Fire in the hole! The captain is under attack!`,
      };
      setNarratorText(comments[personality]);
    } else if (move.san === 'O-O' || move.san === 'O-O-O') {
      const comments: Record<Personality, string> = {
        sarcastic: `${moveNum}.${isWhite ? '' : '..'}${move.san} — ${player} castles. How conventional.`,
        supportive: `${moveNum}.${isWhite ? '' : '..'}${move.san} — Smart castling! King safety first.`,
        grandmaster: `${moveNum}.${isWhite ? '' : '..'}${move.san} — Castling. King safety is secured, and the rook is connected.`,
        pirate: `${moveNum}.${isWhite ? '' : '..'}${move.san} — The captain retreats to the fortress! A wise move, matey!`,
      };
      setNarratorText(comments[personality]);
    } else {
      const comments: Record<Personality, string[]> = {
        sarcastic: [
          `${moveNum}.${isWhite ? '' : '..'}${move.san} — ${player} develops the ${piece}. Let's see where this goes.`,
          `${moveNum}.${isWhite ? '' : '..'}${move.san} — A quiet ${piece} move. The calm before the storm, perhaps.`,
          `${moveNum}.${isWhite ? '' : '..'}${move.san} — ${player} positions the ${piece}. Interesting choice.`,
        ],
        supportive: [
          `${moveNum}.${isWhite ? '' : '..'}${move.san} — Good development! The ${piece} finds a nice square.`,
          `${moveNum}.${isWhite ? '' : '..'}${move.san} — ${player} improves the position of the ${piece}. Solid play!`,
          `${moveNum}.${isWhite ? '' : '..'}${move.san} — Nice! The ${piece} is well placed here.`,
        ],
        grandmaster: [
          `${moveNum}.${isWhite ? '' : '..'}${move.san} — The ${piece} is repositioned. Evaluating the structural implications.`,
          `${moveNum}.${isWhite ? '' : '..'}${move.san} — A prophylactic ${piece} move. Controlling key squares.`,
          `${moveNum}.${isWhite ? '' : '..'}${move.san} — Standard positional play. The ${piece} gains influence.`,
        ],
        pirate: [
          `${moveNum}.${isWhite ? '' : '..'}${move.san} — The ${piece} sets sail to a new port! Onwards!`,
          `${moveNum}.${isWhite ? '' : '..'}${move.san} — ${player} moves the ${piece} across the deck! Steady as she goes!`,
          `${moveNum}.${isWhite ? '' : '..'}${move.san} — Arrr! The ${piece} takes position on the bow!`,
        ],
      };
      const list = comments[personality];
      const hash = move.san.charCodeAt(0) + (move.san.charCodeAt(move.san.length - 1) || 0) + index;
      setNarratorText(list[hash % list.length]);
    }
  };

  // Step forward
  const stepForward = () => {
    if (isChallengeActive) return;
    if (currentMoveIndex >= moves.length - 1) {
      // Game completed
      if (!isCompleted) {
        handleCompletion();
      }
      return;
    }
    const next = currentMoveIndex + 1;
    setCurrentMoveIndex(next);
    setPositionFen(moves[next].fen);
  };

  // Step backward
  const stepBackward = () => {
    if (isChallengeActive) return;
    if (currentMoveIndex <= -1) return;
    const prev = currentMoveIndex - 1;
    setCurrentMoveIndex(prev);
    setPositionFen(prev === -1 ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' : moves[prev].fen);
  };

  // Handle piece drop during challenge
  const onDrop = (sourceSquare: string, targetSquare: string) => {
    if (!isChallengeActive || challengeResult !== 'pending') return false;

    const challengeIndex = currentMoveIndex + 1;
    if (challengeIndex >= moves.length) return false;

    const correctMove = moves[challengeIndex];

    // Check if the user's move matches
    if (sourceSquare === correctMove.from && targetSquare === correctMove.to) {
      // Correct guess!
      setChallengeResult('correct');
      setCorrectGuesses((p) => p + 1);
      setTotalChallenges((p) => p + 1);

      // Play sound immediately on correct drop
      if (correctMove.san.includes('#') || correctMove.san.includes('+')) {
        playChessSound('check');
      } else if (correctMove.san.includes('x')) {
        playChessSound('capture');
      } else {
        playChessSound('move');
      }
      prevMoveIndexRef.current = challengeIndex;

      const praise: Record<Personality, string> = {
        sarcastic: `Well, well. You actually found it. ${correctMove.san}. I'm almost impressed.`,
        supportive: `Brilliant! You found ${correctMove.san}! That's exactly what was played. Amazing intuition!`,
        grandmaster: `Correct. ${correctMove.san} is the precise continuation. Your calculation is sound.`,
        pirate: `Shiver me timbers! Ye found ${correctMove.san}! A true navigator of the seas!`,
      };
      setNarratorText(praise[personality]);

      // Advance after a brief pause
      setTimeout(() => {
        setCurrentMoveIndex(challengeIndex);
        setPositionFen(correctMove.fen);
        setIsChallengeActive(false);
        setChallengeResult('pending');
      }, 2000);

      return true;
    } else {
      // Incorrect guess
      setChallengeResult('incorrect');
      setTotalChallenges((p) => p + 1);

      const correction: Record<Personality, string> = {
        sarcastic: `Nope. The actual move was ${correctMove.san}. Don't worry, only grandmasters find these. Oh wait...`,
        supportive: `Good try! The actual move played was ${correctMove.san}. It's a tricky one — now you'll remember it!`,
        grandmaster: `Incorrect. The game continuation was ${correctMove.san}. Study the tactical motif here carefully.`,
        pirate: `Arrr, wrong heading! The captain played ${correctMove.san}. Back to navigation school, matey!`,
      };
      setNarratorText(correction[personality]);

      // Show correct move and advance
      setTimeout(() => {
        setCurrentMoveIndex(challengeIndex);
        setPositionFen(correctMove.fen);
        setIsChallengeActive(false);
        setChallengeResult('pending');
      }, 3000);

      return false;
    }
  };

  // Handle game completion
  const handleCompletion = () => {
    setIsCompleted(true);
    const accuracy = totalChallenges > 0 ? Math.round((correctGuesses / totalChallenges) * 100) : 100;
    saveBadge(story.slug, accuracy);

    const completionMsg: Record<Personality, string> = {
      sarcastic: `Story complete. You guessed ${correctGuesses}/${totalChallenges} challenges correctly (${accuracy}%). Badge earned: ${story.badge.icon} ${story.badge.name}. Try not to let it go to your head.`,
      supportive: `Congratulations! You've completed "${story.title}"! Score: ${correctGuesses}/${totalChallenges} (${accuracy}%). You earned the ${story.badge.icon} ${story.badge.name} badge! Amazing work!`,
      grandmaster: `Analysis complete. Challenge accuracy: ${accuracy}% (${correctGuesses}/${totalChallenges}). Badge awarded: ${story.badge.icon} ${story.badge.name}. Continue to the next study.`,
      pirate: `The voyage is done! Ye scored ${correctGuesses} out of ${totalChallenges} (${accuracy}%)! Ye've earned the ${story.badge.icon} ${story.badge.name} badge! Now set sail for more adventures!`,
    };
    setNarratorText(completionMsg[personality]);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') stepForward();
      else if (e.key === 'ArrowLeft') stepBackward();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentMoveIndex, isChallengeActive, moves, isCompleted]);

  // Move list highlighting
  const lastMove = currentMoveIndex >= 0 ? moves[currentMoveIndex] : null;
  const customSquareStyles: Record<string, React.CSSProperties> = {};
  if (lastMove) {
    customSquareStyles[lastMove.from] = { backgroundColor: 'rgba(0, 112, 243, 0.12)' };
    const quality = story.moveClassifications[currentMoveIndex] as MoveQuality | undefined;
    if (quality) {
      const highlightColors: Record<MoveQuality, string> = {
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
      customSquareStyles[lastMove.to] = { backgroundColor: highlightColors[quality] ?? 'rgba(0, 112, 243, 0.25)' };
    } else {
      customSquareStyles[lastMove.to] = { backgroundColor: 'rgba(0, 112, 243, 0.25)' };
    }
  }

  // Custom square renderer to show move quality emoticons on the board
  const CustomSquareRenderer = React.useCallback(({ square, children }: any) => {
    const currentMove = (currentMoveIndex >= 0 && currentMoveIndex < moves.length) ? moves[currentMoveIndex] : null;
    const isDestination = currentMove && currentMove.to === square;

    let badge = null;
    if (isDestination) {
      const quality = story.moveClassifications[currentMoveIndex] as MoveQuality | undefined;
      if (quality) {
        const icon = QUALITY_ICON[quality];
        if (icon) {
          badge = (
            <div
              className="absolute top-0.5 right-0.5 z-10 w-4 h-4 md:w-5 md:h-5 rounded-full flex items-center justify-center text-[8px] md:text-[10px] font-bold text-white shadow-md select-none pointer-events-none"
              style={{ backgroundColor: QUALITY_COLOR[quality] }}
              title={QUALITY_LABEL[quality]}
            >
              {icon}
            </div>
          );
        }
      }
    }

    const highlightStyle = customSquareStyles[square] || {};

    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', ...highlightStyle }}>
        {children}
        {badge}
      </div>
    );
  }, [currentMoveIndex, moves, customSquareStyles, story.moveClassifications]);

  // Progress percentage
  const progress = moves.length > 0 ? Math.round(((currentMoveIndex + 1) / moves.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Story Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{story.badge.icon}</span>
          <div>
            <h1 className="text-2xl md:text-3xl font-sans font-semibold tracking-tight text-brand-ink">
              {story.title}
            </h1>
            <p className="text-xs font-mono text-brand-mute">{story.subtitle} ({story.year})</p>
          </div>
        </div>
      </div>

      {/* Main Layout */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* LEFT: Chessboard */}
        <div className="flex flex-col gap-3 lg:w-[400px] shrink-0 w-full">
          <div className="border border-brand-hairline rounded-md overflow-hidden shadow-lvl3 w-full max-w-[400px] aspect-square mx-auto">
            <Chessboard
              key={story.slug + boardOrientation + positionFen}
              options={{
                id: 'story-board',
                position: positionFen,
                boardOrientation: boardOrientation,
                onPieceDrop: ({ sourceSquare, targetSquare }) => onDrop(sourceSquare as string, targetSquare as string),
                allowDragging: isChallengeActive && challengeResult === 'pending',
                squareRenderer: CustomSquareRenderer,
                squareStyles: customSquareStyles,
                darkSquareStyle: { backgroundColor: 'var(--color-board-dark)' },
                lightSquareStyle: { backgroundColor: 'var(--color-board-light)' },
                animationDurationInMs: 200,
              }}
            />
          </div>

          {/* Progress Bar */}
          <div className="flex items-center gap-2">
            <div className="flex-grow bg-brand-canvas-soft2 h-1.5 rounded-full overflow-hidden border border-brand-hairline">
              <div
                className="bg-brand-accent h-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <span className="text-[10px] font-mono text-brand-mute shrink-0">
              {currentMoveIndex + 1}/{moves.length}
            </span>
          </div>

          {/* Navigation Controls */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  if (!isChallengeActive) {
                    setCurrentMoveIndex(-1);
                    setPositionFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
                    setNarratorText(story.description);
                  }
                }}
                disabled={isChallengeActive}
                className="p-2 rounded-sm border border-brand-hairline bg-brand-canvas hover:bg-brand-canvas-soft2 text-brand-body disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
                title="Jump to start"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M18.5 18l-7-6 7-6M6 6v12"></path></svg>
              </button>
              <button
                onClick={stepBackward}
                disabled={currentMoveIndex <= -1 || isChallengeActive}
                className="p-2 rounded-sm border border-brand-hairline bg-brand-canvas hover:bg-brand-canvas-soft2 text-brand-body disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
                title="Previous move"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6"></path></svg>
              </button>
              <button
                onClick={stepForward}
                disabled={currentMoveIndex >= moves.length - 1 && isCompleted}
                className="p-2 rounded-sm border border-brand-hairline bg-brand-canvas hover:bg-brand-canvas-soft2 text-brand-body disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
                title="Next move"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6"></path></svg>
              </button>
              <button
                onClick={() => {
                  if (!isChallengeActive && currentMoveIndex < moves.length - 1) {
                    setIsAutoPlaying(!isAutoPlaying);
                  }
                }}
                disabled={isChallengeActive || currentMoveIndex >= moves.length - 1}
                className={`p-2 rounded-sm border transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                  isAutoPlaying
                    ? 'border-brand-accent bg-brand-accent/10 text-brand-accent'
                    : 'border-brand-hairline bg-brand-canvas hover:bg-brand-canvas-soft2 text-brand-body'
                }`}
                title={isAutoPlaying ? 'Pause autoplay' : 'Start autoplay'}
              >
                {isAutoPlaying ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6"></path></svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z"></path></svg>
                )}
              </button>
            </div>
            <button
              onClick={() => setBoardOrientation(o => o === 'white' ? 'black' : 'white')}
              className="p-2 rounded-sm border border-brand-hairline bg-brand-canvas hover:bg-brand-canvas-soft2 text-brand-body transition-colors cursor-pointer"
              title="Flip board"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path></svg>
            </button>
          </div>
        </div>

        {/* RIGHT: Narrator + Info Panel */}
        <div className="flex flex-col gap-4 flex-grow min-w-0">
          {/* Challenge Banner */}
          {isChallengeActive && challengeResult === 'pending' && (
            <div className="bg-brand-accent/10 border border-brand-accent/30 rounded-md p-4 flex items-start gap-3 animate-fadeIn">
              <span className="text-xl mt-0.5">🧩</span>
              <div>
                <h3 className="text-sm font-sans font-semibold text-brand-ink">Guess the Move!</h3>
                <p className="text-xs font-sans text-brand-body mt-1">
                  Drag a piece on the board to make your guess. Can you find the move that was actually played?
                </p>
              </div>
            </div>
          )}

          {/* Completion Banner */}
          {isCompleted && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-md p-5 text-center flex flex-col gap-2 animate-fadeIn">
              <span className="text-4xl">{story.badge.icon}</span>
              <h3 className="text-lg font-sans font-semibold text-brand-ink">Story Complete!</h3>
              <p className="text-sm font-mono text-brand-body">
                Badge earned: <strong>{story.badge.name}</strong>
              </p>
              <p className="text-xs font-mono text-brand-mute">
                Challenge accuracy: {totalChallenges > 0 ? `${correctGuesses}/${totalChallenges} (${Math.round((correctGuesses / totalChallenges) * 100)}%)` : 'No challenges attempted'}
              </p>
              <a
                href="/stories"
                className="mt-2 inline-block px-6 py-2 rounded-pill text-sm font-semibold bg-brand-primary text-brand-on-primary hover:opacity-90 transition-opacity mx-auto"
              >
                Back to Stories
              </a>
            </div>
          )}

          {/* Narrator Card */}
          <div className="bg-brand-canvas border border-brand-hairline rounded-md p-5 shadow-lvl2 flex flex-col gap-3">
            <div className="flex justify-between items-center select-none gap-2">
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-brand-ink">
                {isChallengeActive ? 'Challenge' : 'Narrator'}
              </h2>
              <div className="flex items-center gap-1.5">
                <select
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value as Personality)}
                  className="text-[10px] font-mono bg-brand-canvas-soft2 border border-brand-hairline rounded-sm px-2 py-1 text-brand-body cursor-pointer focus-visible:ring-1 focus-visible:ring-brand-accent focus-visible:outline-hidden"
                >
                  <option value="sarcastic">Sarcastic</option>
                  <option value="supportive">Supportive</option>
                  <option value="grandmaster">Grandmaster</option>
                  <option value="pirate">Pirate</option>
                </select>

                <label className="text-[10px] font-mono text-brand-body cursor-pointer flex items-center gap-0.5 select-none hover:text-brand-accent transition-colors">
                  <input
                    type="checkbox"
                    checked={autoSpeak}
                    onChange={(e) => setAutoSpeak(e.target.checked)}
                    className="rounded-xs border-brand-hairline accent-brand-primary w-3 h-3 cursor-pointer"
                  />
                  <span>Auto-Speak</span>
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
                  className={`p-1 rounded-sm border transition-colors focus-visible:ring-1 focus-visible:ring-brand-accent cursor-pointer ${
                    isPlayingAudio
                      ? 'border-emerald-500/30 text-emerald-500 bg-emerald-500/10'
                      : 'border-brand-hairline text-brand-ink hover:bg-brand-canvas-soft2'
                  }`}
                  title="Speak Narration"
                  aria-label="Toggle narration speech"
                >
                  {isPlayingAudio ? (
                    <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path>
                    </svg>
                  ) : (
                    <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <p className="text-sm font-sans text-brand-body leading-relaxed min-h-[48px]">
              {displayedNarration}<span className="animate-pulse text-brand-accent">|</span>
            </p>
          </div>

          {/* Moves History */}
          <div className="bg-brand-canvas border border-brand-hairline rounded-md p-4 shadow-lvl2 flex-grow">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-brand-ink mb-3 select-none">
              Move Ledger
            </h3>
            <div className="max-h-[240px] overflow-y-auto pr-1">
              <div className="grid gap-x-2 gap-y-0.5 text-xs font-mono" style={{ gridTemplateColumns: 'auto 1fr 1fr' }}>
                {Array.from({ length: Math.ceil(moves.length / 2) }).map((_, i) => {
                  const whiteIdx = i * 2;
                  const blackIdx = i * 2 + 1;
                  const whiteMove = moves[whiteIdx];
                  const blackMove = blackIdx < moves.length ? moves[blackIdx] : null;
                  const whiteQ = story.moveClassifications[whiteIdx] as MoveQuality | undefined;
                  const blackQ = blackIdx < moves.length ? story.moveClassifications[blackIdx] as MoveQuality | undefined : undefined;
                  return (
                    <React.Fragment key={i}>
                      <span className="text-brand-mute text-right pr-1 py-0.5">{i + 1}.</span>
                      <button
                        onClick={() => {
                          if (!isChallengeActive) {
                            setCurrentMoveIndex(whiteIdx);
                            setPositionFen(whiteMove.fen);
                          }
                        }}
                        className={`text-left px-1.5 py-0.5 rounded-xs transition-colors cursor-pointer flex items-center gap-1 ${
                          currentMoveIndex === whiteIdx
                            ? 'font-semibold'
                            : 'text-brand-ink hover:bg-brand-canvas-soft2'
                        }`}
                        style={currentMoveIndex === whiteIdx ? { backgroundColor: whiteQ ? QUALITY_BG[whiteQ] : 'rgba(0,112,243,0.08)', color: whiteQ ? QUALITY_COLOR[whiteQ] : 'var(--color-brand-accent)' } : (whiteQ && whiteQ !== 'good' && whiteQ !== 'best' ? { backgroundColor: QUALITY_BG[whiteQ] } : {})}
                      >
                        {whiteQ && <QualityDot quality={whiteQ} />}
                        <span>{whiteMove.san}</span>
                        {whiteQ && <MoveQualityBadge quality={whiteQ} />}
                      </button>
                      {blackMove && blackQ ? (
                        <button
                          onClick={() => {
                            if (!isChallengeActive) {
                              setCurrentMoveIndex(blackIdx);
                              setPositionFen(blackMove.fen);
                            }
                          }}
                          className={`text-left px-1.5 py-0.5 rounded-xs transition-colors cursor-pointer flex items-center gap-1 ${
                            currentMoveIndex === blackIdx
                              ? 'font-semibold'
                              : 'text-brand-ink hover:bg-brand-canvas-soft2'
                          }`}
                          style={currentMoveIndex === blackIdx ? { backgroundColor: blackQ ? QUALITY_BG[blackQ] : 'rgba(0,112,243,0.08)', color: blackQ ? QUALITY_COLOR[blackQ] : 'var(--color-brand-accent)' } : (blackQ && blackQ !== 'good' && blackQ !== 'best' ? { backgroundColor: QUALITY_BG[blackQ] } : {})}
                        >
                          {blackQ && <QualityDot quality={blackQ} />}
                          <span>{blackMove.san}</span>
                          {blackQ && <MoveQualityBadge quality={blackQ} />}
                        </button>
                      ) : blackMove ? (
                        <button
                          onClick={() => {
                            if (!isChallengeActive) {
                              setCurrentMoveIndex(blackIdx);
                              setPositionFen(blackMove.fen);
                            }
                          }}
                          className={`text-left px-1.5 py-0.5 rounded-xs transition-colors cursor-pointer ${
                            currentMoveIndex === blackIdx
                              ? 'bg-brand-accent/10 text-brand-accent font-semibold'
                              : 'text-brand-ink hover:bg-brand-canvas-soft2'
                          }`}
                        >
                          {blackMove.san}
                        </button>
                      ) : (
                        <span />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Accuracy & Stats Panel */}
          <div className="bg-brand-canvas border border-brand-hairline rounded-md p-4 shadow-lvl2">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-brand-ink mb-3 select-none">
              Game Accuracy
            </h3>
            {/* Accuracy bars */}
            <div className="flex flex-col gap-3 mb-4">
              {/* White */}
              <div className="flex items-center gap-3">
                <div className="w-16 shrink-0">
                  <span className="text-[10px] font-mono text-brand-mute block">White</span>
                  <span className="text-xl font-bold" style={{ color: '#f8fafc', textShadow: '0 0 8px rgba(255,255,255,0.3)' }}>
                    {story.whiteAccuracy}%
                  </span>
                </div>
                <div className="flex-grow">
                  <div className="h-2 bg-brand-canvas-soft2 rounded-full overflow-hidden border border-brand-hairline">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${story.whiteAccuracy}%`,
                        background: `linear-gradient(90deg, #22c55e, #4ade80)`,
                      }}
                    />
                  </div>
                </div>
              </div>
              {/* Black */}
              <div className="flex items-center gap-3">
                <div className="w-16 shrink-0">
                  <span className="text-[10px] font-mono text-brand-mute block">Black</span>
                  <span className="text-xl font-bold" style={{ color: '#94a3b8' }}>
                    {story.blackAccuracy}%
                  </span>
                </div>
                <div className="flex-grow">
                  <div className="h-2 bg-brand-canvas-soft2 rounded-full overflow-hidden border border-brand-hairline">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${story.blackAccuracy}%`,
                        background: `linear-gradient(90deg, #3b82f6, #60a5fa)`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Move breakdown */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {([
                ['brilliant', '!!', story.whiteStats.brilliant, story.blackStats.brilliant],
                ['best', '✓', story.whiteStats.best + story.whiteStats.excellent, story.blackStats.best + story.blackStats.excellent],
                ['book', '📖', story.whiteStats.book, story.blackStats.book],
                ['mistake', '?', story.whiteStats.mistake, story.blackStats.mistake],
                ['blunder', '??', story.whiteStats.blunder, story.blackStats.blunder],
                ['dubious', '?!', story.whiteStats.dubious, story.blackStats.dubious],
              ] as [MoveQuality | string, string, number, number][]).map(([q, symbol, w, b]) => (
                <React.Fragment key={String(q)}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono" style={{ color: QUALITY_COLOR[q as MoveQuality] ?? '#94a3b8' }}>
                      {symbol} {QUALITY_LABEL[q as MoveQuality] ?? q}
                    </span>
                    <div className="flex gap-2 font-mono text-[10px]">
                      <span style={{ color: '#f8fafc' }}>{w}</span>
                      <span className="text-brand-mute">/</span>
                      <span style={{ color: '#94a3b8' }}>{b}</span>
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
            <p className="text-[9px] font-mono text-brand-mute mt-2 text-right">White / Black</p>
          </div>
        </div>
      </div>
    </div>
  );
}
