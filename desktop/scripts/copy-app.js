// Copies the web app (../dist) into ./app so the desktop build bundles it.
const fs = require("fs");
const path = require("path");

const source = path.join(__dirname, "..", "..", "dist");
const target = path.join(__dirname, "..", "app");

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log("Copied " + source + " -> " + target);
