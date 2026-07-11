# Chess Narrate 🎙️♟️

An interactive, AI-driven chess analysis platform built with **Astro**, **React**, and **Tailwind CSS**. The application bridges the **"Explanation Gap"** in chess by combining real-time local engine evaluations (Stockfish) with engaging, personality-driven AI commentary (Google Gemini API).

---

## 🤖 Built in Collaboration with AI
This project was developed using a modern **Human-AI Collaborative Programming** workflow:
* **The Human Developer**: Architected the features, verified the Chess logic/Stockfish integration, reviewed code syntax and styling, and made final design & configuration decisions.
* **The AI Coding Assistant (Antigravity)**: Assisted in generating Tailwind components, optimizing React hooks, configuring the Astro build setup (including the SEO sitemap), and generating fallback commentary datasets.

This workflow serves as a demonstration of high-productivity modern software engineering, showcasing how developers can leverage agentic AI tools to accelerate development speed while maintaining code quality and robust architecture.

---

## 🎨 Design & Aesthetic
Inspired by **Vercel's clean, developer-focused design language**:
* **Stark Contrast System**: Stark black-and-ink canvas paired with subtle gray borders and divider scales.
* **Mesh Gradients**: A fluid, multi-color mesh gradient backdrop providing ambient lighting behind the main board.
* **Subtle Elevation**: Stacked shadows and hairline borders for clean, modern cards and layout containers.
* **Responsive Typography**: Clean geometric typography using *Inter* for interface narratives and *JetBrains Mono* for technical chess notation and statistics.
* **Responsive Layout**: Fully adaptive grids that stack on mobile viewports and lay out columns optimally on desktop screen sizes.

---

## ✨ Implemented Features

### 1. Interactive Chessboard UI
* **`react-chessboard` & `chess.js` Integration**: Smooth drag-and-drop piece movement, auto-promotion to Queens, and game state validation.
* **Move History Highlights**: Highlight markers for the starting and ending squares of the most recent move to easily track game state changes.
* **Board Flipping**: One-click toggle to invert the board orientation between White and Black.

### 2. Browser-Side Stockfish Engine
* **Local Web Worker**: Stockfish is executed in the browser background via a dedicated Web Worker (`stockfish.worker.js`), ensuring no CORS issues and a smooth UI thread.
* **Asynchronous Position Queue**: Positions are queued and evaluated in the background, updating values dynamically as calculations finish.
* **Vertical Evaluation Bar**: A real-time visual indicator showing centipawn advantage or upcoming forced mates (e.g., M4).

### 3. AI Narrator & Speech Synthesis
* **Gemini API Integration**: Leverages `gemini-1.5-flash` to construct witty, single-sentence commentaries (under 25 words) that explain move quality, tactical impact, and recommended lines.
* **Voice Personalities**: Select between four distinct commentary styles:
    * `Sarcastic`: Dry, biting humor regarding blunders and mistakes.
    * `Supportive`: Encouraging commentary, helpful hints, and gentle corrections.
    * `Grandmaster`: Deep, analytical, and highly critical commentary on positional play.
    * `Pirate`: Immersion-building seafaring comments ("Shiver me timbers! Ye just threw yer own piece to the sharks!").
* **Offline Fallback Commentary Engine**: A built-in rule-based critique engine to provide quality commentary when the Gemini API key is missing or offline.
* **Text-to-Speech (TTS)**: Leverages browser `SpeechSynthesis` to narrate comments. Voice rates and pitches are tailored to fit the narrator's personality (e.g., a pirate voice is deeper and slower). Supports an `Auto-Speak` toggle on move changes.

### 4. Game Analytics & Visualizations
* **Interactive Evaluation Chart**: An SVG line chart plotting the engine's evaluation score throughout the match. Clicking any point on the chart lets the user jump to that specific position on the board.
* **Game Statistics Dashboard**: Live metrics counting the number of *Excellent/Best*, *Good*, *Inaccuracy*, *Mistake*, and *Blunder* moves played by each side.

### 5. Utility & Navigation Controls
* **Playback Navigation**: Step-by-step navigation buttons (Jump to Start, Previous Move, Next Move, Jump to End).
* **Autoplay**: Play through games automatically with a 3.5-second delay to give users time to read and listen to the AI commentary.
* **PGN and FEN Loaders**: Panels to paste and validate full PGN game notation or a FEN string for custom setups.
* **Copy Buttons**: One-click shortcuts to copy the current game PGN or board FEN straight to the clipboard.
* **Local Storage Key Persistence**: Safely saves the user's Gemini API key locally inside the browser's storage, ensuring it is preserved across page reloads.

---

## 🚀 Running the Project

### Development
Start the development server with the Astro CLI:
```sh
npm install
npm run dev
```

### Build & Production Server
Create a production build and run the Node server:
```sh
npm run build
node server.js
```
The server will start at `http://localhost:4321` and serve static files with COOP/COEP headers enabled.

---

## 🌐 Hosting & Hosting Costs

Because the website runs entirely client-side, it costs **$0** to host. You can deploy it directly to free hosting platforms such as:
* **Cloudflare Pages**
* **Vercel**
* **Netlify**
* **GitHub Pages**

> [!IMPORTANT]
> **Cross-Origin Isolation Headers**: Because the Stockfish WASM engine uses multi-threaded `SharedArrayBuffer` memory, your hosting provider **must** serve the website with these HTTP headers:
> ```text
> Cross-Origin-Opener-Policy: same-origin
> Cross-Origin-Embedder-Policy: require-corp
> ```
