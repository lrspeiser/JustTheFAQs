import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'public/data/faqs');

if (!fs.existsSync(dir)) {
  console.log('[Prebuild] Creating missing directory:', dir);
  fs.mkdirSync(dir, { recursive: true });
} else {
  console.log('[Prebuild] Directory already exists:', dir);
}
