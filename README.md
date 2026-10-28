# SKYLAB — Flight Test

A light-mode, browser-based quadcopter attitude simulator built with HTML, CSS, JavaScript and Three.js.

## Run locally

The project uses JavaScript modules, so serve the folder over HTTP instead of opening `index.html` directly.

### Windows

1. Extract the project folder.
2. Open Command Prompt or the VS Code terminal inside `stm32_drone_simulator`.
3. Run:

```powershell
py -m http.server 8000
```

4. Open http://localhost:8000 in Chrome or Edge.

If `py` is unavailable, use VS Code's Live Server extension.

## Controls

- **Pitch / Roll / Yaw sliders** — directly set the desired attitude.
- **W / S** — pitch down / up.
- **A / D** — roll left / right.
- **Q / E** — yaw left / right.
- **Shift + key** — larger keyboard increments.
- **R** — reset attitude.
- **Drag** — orbit the camera.
- **Scroll** — zoom.
- **Orbit / Pilot / Top** — camera presets.

## Notes

- Three.js is loaded from jsDelivr and Google Fonts are loaded remotely, so the first run requires internet access.
- This is a visual simulator only. The attitude controls directly change the 3D model; no PID, sensor fusion, or physical flight outputs are implemented yet.
- The next integration stage can replace slider-generated attitude commands with serial telemetry forwarded from STM32 by a local Python bridge.
