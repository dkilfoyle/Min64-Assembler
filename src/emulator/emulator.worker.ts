import { cpu } from "./cpu";
import { scancodes } from "./io";

// Define worker self context for TypeScript
const ctxWorker: Worker = self as any;

let ctx: OffscreenCanvasRenderingContext2D | null = null;

// Track active key states
const keyPressedState: Record<string, boolean> = {};
const keyPressedTime: Record<string, number> = {};

// Game state variables
let boxX = 100;
let boxY = 100;
const SPEED = 300; // Movement speed in pixels per second

// Delta time tracking variables
let lastTime = 0;
let isRunning = true;

ctxWorker.onmessage = async (e: MessageEvent) => {
  const data = e.data;

  if (data.type === "INIT") {
    console.log("Emulator worker init...");
    const canvas = data.canvas as OffscreenCanvas;
    ctx = canvas.getContext("2d");

    // Initialize timing and kick off the loop
    await cpu.reset();
    console.log(" - cpu initialised");
    lastTime = performance.now();
    requestAnimationFrame(renderLoop);
  }

  if (data.type === "KEY_DOWN") {
    const tnow = performance.now();
    if (keyPressedState[data.key]) {
      // already pushed
      if (tnow - keyPressedTime[data.key] > 260) {
        keyPressedTime[data.key] = tnow;
        if (data.key in scancodes) cpu.ps2.receive(scancodes[data.key]);
      }
    } else {
      // initial key down
      keyPressedState[data.key] = true;
      keyPressedTime[data.key] = tnow;
      if (data.key in scancodes) cpu.ps2.receive(scancodes[data.key]);
    }
  }

  if (data.type === "KEY_UP") {
    keyPressedState[data.key] = false; // reset key press
  }

  if (data.type === "HEX") {
    // const hex = new TextEncoder().encode(data.hex);
    // hex.forEach((x) => cpu.uart.receive(x));
    cpu.memory.loadIntelHex(data.hex);
  }
};

function renderLoop(currentTime: number): void {
  if (!ctx) return;

  // 1. Calculate delta time (ms elapsed since last frame)
  const deltaTime = currentTime - lastTime;
  lastTime = currentTime;

  // Prevent giant jumps if the user leaves the tab and comes back
  const dt = Math.min(deltaTime, 100);

  let t = dt;
  while (t > 0 && isRunning) {
    t -= cpu.step() * 0.000125; // 8mhz clock
  }

  const cpuState = cpu.getState();
  const imageData = new ImageData(cpuState.pixelData, 512, 256);
  ctx.putImageData(imageData, -96, -12, 96, 12, 400, 240);

  // Request next frame
  requestAnimationFrame(renderLoop);
}
