// evaluate-stories.mjs
// Run: node scripts/evaluate-stories.mjs > stories-data.json
'use strict';

const { Chess } = await import('chess.js');
const stockfish = (await import('../node_modules/stockfish/index.js')).default;

// ──────────────────────────────────────────────────────
// Story Data
// ──────────────────────────────────────────────────────
const STORIES = [
  {
    slug: 'immortal-game',
    title: 'The Immortal Game',
    subtitle: 'Adolf Anderssen vs Lionel Kieseritzky',
    year: 1851,
    description: 'Played at the London Chess Tournament of 1851, this legendary game showcases one of the most audacious attacking displays in chess history. Anderssen sacrificed both rooks, a bishop, and his queen — then delivered checkmate with just three minor pieces. It earned the title "Immortal" because its brilliance transcends time.',
    pgn: '1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6 7. d3 Nh5 8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5 14. Qf3 Ng8 15. Bxf4 Qf6 16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 Bxg1 19. e5 Qxa1+ 20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7#',
    challengeMoves: [16, 19, 22],
    challengeHints: { 16: 'White needs to centralize a powerful piece. Which knight can leap to a dominant outpost?', 19: 'The rook is gone, but what spectacular check opens the floodgates?', 22: 'All the sacrifices lead to this. How does White deliver the killing blow?' },
    badge: { name: 'Immortal Survivor', icon: '⚔️' },
  },
  {
    slug: 'evergreen-game',
    title: 'The Evergreen Game',
    subtitle: 'Adolf Anderssen vs Jean Dufresne',
    year: 1852,
    description: 'Another masterpiece by Anderssen, this game earned the title "Evergreen" because its beauty remains forever fresh. Featuring a stunning queen sacrifice followed by a devastating discovered double check, this game is a textbook example of Romantic-era attacking chess at its finest.',
    pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. b4 Bxb4 5. c3 Ba5 6. d4 exd4 7. O-O d3 8. Qb3 Qf6 9. e5 Qg6 10. Re1 Nge7 11. Ba3 b5 12. Qxb5 Rb8 13. Qa4 Bb6 14. Nbd2 Bb7 15. Ne4 Qf5 16. Bxd3 Qh5 17. Nf6+ gxf6 18. exf6 Rg8 19. Rad1 Qxf3 20. Rxe7+ Nxe7 21. Qxd7+ Kxd7 22. Bf5+ Ke8 23. Bd7+ Kf8 24. Bxe7#',
    challengeMoves: [16, 19, 20],
    challengeHints: { 16: 'A knight can create havoc with a forcing check. Where does it strike?', 19: 'Time for the most powerful piece to make its exit. What stunning sacrifice clears the way?', 20: 'The queen is captured but the attack rages on. Which discovered attack finishes the job?' },
    badge: { name: 'Evergreen Scholar', icon: '🌿' },
  },
  {
    slug: 'opera-game',
    title: 'The Opera Game',
    subtitle: 'Paul Morphy vs Duke of Brunswick & Count Isouard',
    year: 1858,
    description: 'Played during an opera performance in Paris, this game by the legendary Paul Morphy is a masterclass in rapid piece development and open-file tactics. While his opponents moved the same pieces repeatedly, Morphy developed every piece with purpose and finished the game in just 17 moves with an elegant queen sacrifice.',
    pgn: '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#',
    challengeMoves: [12, 14, 15],
    challengeHints: { 12: 'White has castled queenside and has total development advantage. Which rook sacrifice tears open the position?', 14: 'A bishop move creates an absolute pin and sets up the final combination.', 15: 'The most beautiful move of the game. What stunning queen sacrifice leads to checkmate?' },
    badge: { name: 'Opera Virtuoso', icon: '🎭' },
  },
  {
    slug: 'game-of-the-century',
    title: 'The Game of the Century',
    subtitle: 'Donald Byrne vs Bobby Fischer',
    year: 1956,
    description: "A 13-year-old Bobby Fischer played this jaw-dropping game against one of America's top players. Fischer sacrificed his queen on move 17, then proceeded to methodically dismantle his opponent's position with a brilliant combination that chess critics dubbed \"The Game of the Century.\" It announced Fischer as a chess prodigy of extraordinary talent.",
    pgn: '1. Nf3 Nf6 2. c4 g6 3. Nc3 Bg7 4. d4 O-O 5. Bf4 d5 6. Qb3 dxc4 7. Qxc4 c6 8. e4 Nbd7 9. Rd1 Nb6 10. Qc5 Bg4 11. Bg5 Na4 12. Qa3 Nxc3 13. bxc3 Nxe4 14. Bxe7 Qb6 15. Bc4 Nxc3 16. Bc5 Rfe8+ 17. Kf1 Be6 18. Bxb6 Bxc4+ 19. Kg1 Ne2+ 20. Kf1 Nxd4+ 21. Kg1 Ne2+ 22. Kf1 Nc3+ 23. Kg1 axb6 24. Qb4 Ra4 25. Qxb6 Nxd1 26. h3 Rxa2 27. Kh2 Nxf2 28. Re1 Rxe1 29. Qd8+ Bf8 30. Nxe1 Bd5 31. Nf3 Ne4 32. Qb8 b5 33. h4 h5 34. Ne5 Kg7 35. Kg1 Bc5+ 36. Kf1 Ng3+ 37. Ke1 Bb4+ 38. Kd1 Bb3+ 39. Kc1 Ne2+ 40. Kb1 Nc3+ 41. Kc1 Rc2#',
    challengeMoves: [12, 16, 17],
    challengeHints: { 12: "Fischer's knight can make a devastating capture. Which pawn falls to open the position?", 16: "The rook enters with check, forcing White's king to flee. Where does the rook go?", 17: "Fischer allows his queen to be captured! What quiet bishop move sets up the windmill?" },
    badge: { name: 'Century Legend', icon: '👑' },
  },
  {
    slug: 'kasparovs-immortal',
    title: "Kasparov's Immortal",
    subtitle: 'Garry Kasparov vs Veselin Topalov',
    year: 1999,
    description: 'Played at the Wijk aan Zee super-tournament, this game features one of the most incredible king walks in chess history. Kasparov sacrificed a rook and then marched his own king from g8 across the entire board to escape danger while simultaneously setting up a mating attack. Widely regarded as one of the greatest games ever played.',
    pgn: '1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7 8. Bh6 Bxh6 9. Qxh6 Bb7 10. a3 e5 11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O 14. Nb3 exd4 15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5 20. Qf4+ Ka7 21. Rhe1 d4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+ Kb6 26. Qxd4+ Kxa5 27. b4+ Ka4 28. Qc3 Qxd5 29. Ra7 Bb7 30. Rxb7 Qc4 31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+ Kxc3 34. Qa1+ Kd2 35. Qb2+ Kd1 36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8 Rd3 40. Qa8 c3 41. Qa4+ Ke1 42. f4 f5 43. Kc1 Rd2 44. Qa7 1-0',
    challengeMoves: [23, 25, 26],
    challengeHints: { 23: "White's rook is hanging but there's a stronger move. What exchange sacrifice keeps the initiative alive?", 25: 'The black king has fled to b6. What piece checks to keep the hunt going?', 26: 'An audacious pawn move puts the king in the open. What gives check and maintains the mating net?' },
    badge: { name: 'Immortal Tactician', icon: '🔥' },
  },
  {
    slug: 'deep-blue-vs-kasparov',
    title: 'Deep Blue vs Kasparov',
    subtitle: 'Deep Blue vs Garry Kasparov, Game 6',
    year: 1997,
    description: "The decisive game that ended the historic rematch between IBM's Deep Blue and world champion Garry Kasparov. For the first time in history, a computer defeated a reigning world chess champion in a full match. Kasparov, shaken by earlier games, collapsed in just 19 moves in this final encounter — a moment that changed the relationship between humans and machines forever.",
    pgn: '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nd7 5. Ng5 Ngf6 6. Bd3 e6 7. N1f3 h6 8. Nxe6 Qe7 9. O-O fxe6 10. Bg6+ Kd8 11. Bf4 b5 12. a4 Bb7 13. Re1 Nd5 14. Bg3 Kc8 15. axb5 cxb5 16. Qd3 Bc6 17. Bf5 exf5 18. Rxe7 Bxe7 19. c4 1-0',
    challengeMoves: [7, 9, 18],
    challengeHints: { 7: "Deep Blue's knight makes a shocking sacrifice. Which square does it attack to tear open the king's defenses?", 9: 'The bishop delivers a stunning check that displaces the king permanently. Where does it go?', 18: "A quiet pawn push that seals Black's fate. What move ends all resistance?" },
    badge: { name: 'Machine Witness', icon: '🤖' },
  },
];

const DEPTH = 12;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const QUALITY_WEIGHTS = {
  brilliant: 100, best: 100, only_move: 100, book: 100,
  excellent: 95, good: 80, interesting: 75, unclear: 70,
  dubious: 50, mistake: 30, blunder: 0,
};

const OPENING_MOVES = new Set([
  'e4','e5','Nf3','Nc6','Bc4','Nf6','d4','exd5','Nxd4','d5','exd5','Nxd5',
  'O-O','Be7','Nc3','Nxc3','bxc3','d6','c5','c6','g6','Bg7','Bg2',
  'c4','e6','g3','b3','Bb7','f4','exf4','Bxf4','Be2','Bg4','Bxf3',
]);

function isMoveBook(index, moves) {
  return index < 10 && OPENING_MOVES.has(moves[index].san);
}

function classifyMove(idx, moves, evalCache, bestMovesCache) {
  if (isMoveBook(idx, moves)) return 'book';
  const move = moves[idx];
  const fenCurr = move.fen;
  const fenPrev = idx === 0 ? START_FEN : moves[idx - 1].fen;
  const scoreCurr = evalCache[fenCurr];
  const scorePrev = evalCache[fenPrev];
  if (scoreCurr === undefined || scorePrev === undefined) return 'good';
  const isWhite = idx % 2 === 0;
  const change = isWhite ? (scoreCurr - scorePrev) : (scorePrev - scoreCurr);
  const bestMove = bestMovesCache[fenPrev];
  const isBestMove = bestMove === (move.from + move.to);
  const isCapture = move.san.includes('x');
  const isCheck = move.san.includes('+') || move.san.includes('#');
  if (move.isOnlyMove) return 'only_move';
  if (isBestMove && (change >= 100 || (isCapture && change >= 50))) return 'brilliant';
  if (change <= -200) return 'blunder';
  if (change <= -80) return 'mistake';
  if (change <= -50) return 'dubious';
  if (!isBestMove && (isCheck || isCapture) && change <= -35) return 'interesting';
  if (Math.abs(scoreCurr) <= 100 && !isBestMove && change >= -15 && change <= 15) return 'unclear';
  if (!isBestMove && change >= -15 && change < 0) return 'excellent';
  if (isBestMove || change >= 0) return 'best';
  return 'good';
}

function calculateAccuracy(color, moves, classifications) {
  let total = 0, count = 0;
  moves.forEach((_, idx) => {
    const isWhite = idx % 2 === 0;
    if (color === 'white' && !isWhite) return;
    if (color === 'black' && isWhite) return;
    total += QUALITY_WEIGHTS[classifications[idx]] ?? 80;
    count++;
  });
  return count > 0 ? Math.round(total / count) : 100;
}

function evaluateFen(engine, fen) {
  return new Promise((resolve) => {
    let rawScore = 0;
    let bestMove = '';
    engine.listener = (line) => {
      if (typeof line !== 'string') return;
      const cpMatch = line.match(/score cp (-?\d+)/);
      const mateMatch = line.match(/score mate (-?\d+)/);
      if (cpMatch) rawScore = parseInt(cpMatch[1]);
      else if (mateMatch) {
        const m = parseInt(mateMatch[1]);
        rawScore = m > 0 ? (10000 - m * 100) : (-10000 - m * 100);
      }
      const bm = line.match(/^bestmove\s+(\S+)/);
      if (bm) {
        bestMove = bm[1];
        const color = fen.split(' ')[1] || 'w';
        const score = color === 'w' ? rawScore : -rawScore;
        resolve({ score, bestMove });
      }
    };
    engine.sendCommand(`position fen ${fen}`);
    engine.sendCommand(`go depth ${DEPTH}`);
  });
}

async function main() {
  process.stderr.write('Initializing Stockfish (lite-single)...\n');
  const engine = await new Promise((resolve, reject) => {
    stockfish('lite-single', (err, eng) => {
      if (err) reject(err);
      else resolve(eng);
    });
  });

  engine.sendCommand('uci');
  await new Promise(resolve => {
    engine.listener = (line) => { if (line === 'readyok') resolve(); };
    engine.sendCommand('isready');
  });
  process.stderr.write('Engine ready!\n');

  const results = [];

  for (let sIdx = 0; sIdx < STORIES.length; sIdx++) {
    const story = STORIES[sIdx];
    process.stderr.write(`\n[${sIdx+1}/${STORIES.length}] ${story.title}\n`);

    const chess = new Chess();
    chess.loadPgn(story.pgn);
    const history = chess.history({ verbose: true });
    const replay = new Chess();
    const moves = [];

    for (const m of history) {
      const isOnlyMove = replay.moves().length === 1;
      replay.move(m.san);
      moves.push({ san: m.san, from: m.from, to: m.to, piece: m.piece, fen: replay.fen(), isOnlyMove });
    }

    const evalCache = {};
    const bestMovesCache = {};

    process.stderr.write(`  pos 0/${moves.length+1}`);
    const r0 = await evaluateFen(engine, START_FEN);
    evalCache[START_FEN] = r0.score;
    bestMovesCache[START_FEN] = r0.bestMove;

    for (let i = 0; i < moves.length; i++) {
      process.stderr.write(`\r  pos ${i+1}/${moves.length+1}`);
      const r = await evaluateFen(engine, moves[i].fen);
      evalCache[moves[i].fen] = r.score;
      bestMovesCache[moves[i].fen] = r.bestMove;
    }
    process.stderr.write('\n');

    const moveClassifications = moves.map((_, idx) =>
      classifyMove(idx, moves, evalCache, bestMovesCache)
    );

    const whiteStats = { brilliant: 0, best: 0, excellent: 0, good: 0, book: 0, interesting: 0, dubious: 0, mistake: 0, blunder: 0, only_move: 0, unclear: 0 };
    const blackStats = { brilliant: 0, best: 0, excellent: 0, good: 0, book: 0, interesting: 0, dubious: 0, mistake: 0, blunder: 0, only_move: 0, unclear: 0 };
    moves.forEach((_, idx) => {
      const q = moveClassifications[idx];
      (idx % 2 === 0 ? whiteStats : blackStats)[q]++;
    });

    const whiteAccuracy = calculateAccuracy('white', moves, moveClassifications);
    const blackAccuracy = calculateAccuracy('black', moves, moveClassifications);

    process.stderr.write(`  ✓ White ${whiteAccuracy}% | Black ${blackAccuracy}%\n`);
    results.push({ ...story, moveClassifications, whiteAccuracy, blackAccuracy, whiteStats, blackStats });
  }

  engine.sendCommand('quit');
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  process.exit(0);
}

main().catch(err => { process.stderr.write('Fatal: ' + err + '\n'); process.exit(1); });
