const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.animations = [];
    this.id = "";
  }
  appendChild(child) { this.children.push(child); return child; }
  remove() { this.removed = true; }
  setAttribute(name, value) { this[name] = value; }
  animate(keyframes, options) { this.animations.push({ keyframes, options }); return {}; }
  querySelectorAll(selector) {
    const match = /data-burst-slot="([^"]+)"/.exec(selector);
    return match ? this.children.filter(child => child.dataset.burstSlot === match[1]) : [];
  }
}

const body = new Element("body");
const document = {
  body,
  createElement: (tag) => new Element(tag),
  getElementById: (id) => body.children.find(child => child.id === id) || null,
};
const source = fs.readFileSync(path.join(__dirname, "..", "Stream Project", "display.js"), "utf8");
const start = source.indexOf("function numberOrNull");
const end = source.indexOf("function setSizeAndPlacement", start);
if (start < 0 || end < 0) throw new Error("could not locate burst renderer");
let intervalTick = null;
const sandbox = {
  document,
  burstJobs: new Map(),
  setTimeout: () => 1,
  clearTimeout: () => {},
  setInterval: (fn) => { intervalTick = fn; return 1; },
  clearInterval: () => {},
};
vm.runInNewContext(source.slice(start, end), sandbox, { filename: "display-burst.js" });

sandbox.spawnBurst({ id: "slot-1", width: 25 }, { kind: "image", url: "https://example.test/image.png" });
const layer = document.getElementById("burst-layer");
assert(layer, "burst layer should be created when missing");
for (let i = 0; i < 9; i++) intervalTick();
assert.strictEqual(layer.children.length, 10, "burst should create ten image pieces");
assert(layer.children.every(piece => piece.animations.length === 1), "every burst piece should animate");

body.children.length = 0;
sandbox.burstJobs.clear();
intervalTick = null;
sandbox.spawnBurst({ id: "slot-2", width: 25 }, { kind: "text", text: "Hello chat" });
const textLayer = document.getElementById("burst-layer");
for (let i = 0; i < 9; i++) intervalTick();
assert.strictEqual(textLayer.children.length, 10, "burst should create ten text pieces");
assert(textLayer.children.every(piece => piece.children[0]?.textContent === "Hello chat"), "text burst pieces should carry the quote");

body.children.length = 0;
sandbox.burstJobs.clear();
intervalTick = null;
sandbox.spawnBurst({ id: "slot-3", width: 25, animation_speed: 0.5 }, { kind: "text", text: "Slow text" });
const slowLayer = document.getElementById("burst-layer");
assert.strictEqual(slowLayer.children[0].animations[0].options.duration, 2300, "slow burst should keep each text piece readable longer");

const renderStart = source.indexOf("function renderSlot");
const sharedBurst = source.indexOf('if (anim === "burst") {', renderStart);
const imageBranch = source.indexOf('if (resolved.kind === "image") {', renderStart);
assert(sharedBurst >= renderStart && sharedBurst < imageBranch, "burst must run before image/text rendering branches");
console.log("burst renderer smoke test passed");
