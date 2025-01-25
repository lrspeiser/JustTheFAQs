// pages/api/scripts/prebuild.js

import fs from 'fs';
import path from 'path';

// Update the directory to the new path
const dir = path.join(process.cwd(), 'data/faqs'); // Adjusted path

if (!fs.existsSync(dir)) {
  console.log('[Prebuild] Creating missing directory:', dir);
  fs.mkdirSync(dir, { recursive: true });
} else {
  console.log('[Prebuild] Directory already exists:', dir);
}
