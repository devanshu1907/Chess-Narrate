import { Chess } from 'chess.js';

try {
  const chess = new Chess();
  // Test starting fen load
  const result = chess.load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  console.log('Result of loading starting FEN:', result);
} catch (e) {
  console.log('Error loading starting FEN:', e.message);
}

try {
  const chess = new Chess();
  const result = chess.load('invalid FEN');
  console.log('Result of loading invalid FEN:', result);
} catch (e) {
  console.log('Error loading invalid FEN:', e.message);
}
