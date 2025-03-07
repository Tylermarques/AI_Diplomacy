import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div className="container">
        <div className="top-controls">
          <div>
            <button id="load-btn">Load Game</button>
            <button id="prev-btn" disabled>← Prev</button>
            <button id="next-btn" disabled>Next →</button>
            <button id="play-btn" disabled>▶ Play</button>
            <select id="speed-selector" disabled>
              <option value="1000">Slow</option>
              <option value="500" selected>Medium</option>
              <option value="200">Fast</option>
            </select>
            <span id="phase-display">No game loaded</span>
          </div>
        </div>
        <div id="map-view" className="map-view"></div>
        <input type="file" id="file-input" accept=".json" />
        <div id="info-panel"></div>
        <div id="leaderboard"></div>
        <div id="chat-container"></div>
      </div>
    </>
  )
}

export default App
