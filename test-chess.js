import { Chess } from 'chess.js';

const PGN = `1. e4 e5 2. Qh5 Nc6 3. Qxf7+ Kxf7`;

const chess = new Chess();
chess.loadPgn(PGN);

const history = chess.history({ verbose: true });
const temp = new Chess();

history.forEach((m, idx) => {
  const legalMoves = temp.moves();
  const isOnlyMove = legalMoves.length === 1;
  console.log(`Move ${idx + 1}: ${m.san} (Color: ${m.color}) | Legal moves before: ${legalMoves.length} ${isOnlyMove ? ' [ONLY MOVE!]' : ''}`);
  temp.move(m.san);
});
