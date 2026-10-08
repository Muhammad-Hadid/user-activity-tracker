// Simple script to generate icon PNGs at required sizes
// Run with: node scripts/generate-icons.js

const fs = require('fs');
const path = require('path');

// Create icons directory
const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// SVG icon template
function createIconSVG(size) {
  const stroke = Math.max(2, Math.round(size * 0.1));
  const dotR = Math.round(size * 0.18);
  const cx = size / 2;
  const cy = size / 2;
  const outerR = cx - stroke;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="white"/>
  <circle cx="${cx}" cy="${cy}" r="${outerR}" stroke="#34DED3" stroke-width="${stroke}" fill="none"/>
  <circle cx="${cx}" cy="${cy}" r="${dotR}" fill="#34DED3"/>
</svg>`;
}

const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const svg = createIconSVG(size);
  const svgPath = path.join(iconsDir, `icon${size}.svg`);
  fs.writeFileSync(svgPath, svg);
  console.log(`Created ${svgPath}`);
}

console.log('\nSVG icons created. To convert to PNG, open each SVG in a browser and save as PNG,');
console.log('or use Inkscape/ImageMagick:');
console.log('  magick icon16.svg icon16.png');
console.log('  magick icon32.svg icon32.png');
console.log('  magick icon48.svg icon48.png');
console.log('  magick icon128.svg icon128.png');
