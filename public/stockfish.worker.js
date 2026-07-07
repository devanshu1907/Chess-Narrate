// public/stockfish.worker.js

// By importing the CDNJS stockfish.js inside a local worker,
// we bypass CORS limitations. The Stockfish engine automatically
// hooks into the worker's message loop when imported.
importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
