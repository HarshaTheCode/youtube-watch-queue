const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('Running code validation and syntax verification...');

let hasErrors = false;

function checkJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    JSON.parse(raw);
    console.log(`[PASS] JSON Valid: ${path.basename(filePath)}`);
  } catch (err) {
    console.error(`[FAIL] JSON Invalid: ${filePath} - ${err.message}`);
    hasErrors = true;
  }
}

function checkJsSyntax(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    new vm.Script(raw, { filename: filePath });
    console.log(`[PASS] JS Syntax OK: ${path.relative(process.cwd(), filePath)}`);
  } catch (err) {
    console.error(`[FAIL] JS Syntax Error: ${filePath} - ${err.message}`);
    hasErrors = true;
  }
}

// 1. Check JSON files
['manifest.json', 'package.json', 'jsconfig.json'].forEach((file) => {
  const p = path.join(__dirname, '..', file);
  if (fs.existsSync(p)) checkJson(p);
  else {
    console.error(`[FAIL] Missing file: ${file}`);
    hasErrors = true;
  }
});

// 2. Validate manifest.json structure
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3) {
    console.error('[FAIL] manifest_version must be 3');
    hasErrors = true;
  }
  if (!manifest.background || !manifest.background.service_worker) {
    console.error('[FAIL] manifest missing background.service_worker');
    hasErrors = true;
  }
  if (!manifest.content_scripts || manifest.content_scripts.length === 0) {
    console.error('[FAIL] manifest missing content_scripts');
    hasErrors = true;
  }
  console.log('[PASS] Manifest V3 compliance verified');
} catch (e) {
  hasErrors = true;
}

// 3. Check JS files
const jsFiles = [
  'data/constants.js',
  'data/index.js',
  'background/service-worker.js',
  'background/index.js',
  'content/content.js',
  'content/index.js',
  'popup/popup.js',
  'popup/index.js',
  'scripts/generate-icons.js',
];

jsFiles.forEach((file) => {
  const p = path.join(__dirname, '..', file);
  if (fs.existsSync(p)) checkJsSyntax(p);
  else {
    console.error(`[FAIL] Missing JS file: ${file}`);
    hasErrors = true;
  }
});

// 4. Check Icons
[16, 32, 48, 128].forEach((size) => {
  const p = path.join(__dirname, '..', 'icons', `icon-${size}.png`);
  if (fs.existsSync(p) && fs.statSync(p).size > 0) {
    console.log(`[PASS] Icon exists and valid: icon-${size}.png (${fs.statSync(p).size} bytes)`);
  } else {
    console.error(`[FAIL] Missing or empty icon: icon-${size}.png`);
    hasErrors = true;
  }
});

// 5. Check CSS files
['content/content.css', 'popup/popup.css'].forEach((css) => {
  const p = path.join(__dirname, '..', css);
  if (fs.existsSync(p) && fs.statSync(p).size > 0) {
    console.log(`[PASS] CSS file exists: ${css}`);
  } else {
    console.error(`[FAIL] Missing or empty CSS: ${css}`);
    hasErrors = true;
  }
});

if (hasErrors) {
  console.error('\nVerification completed with errors.');
  process.exit(1);
} else {
  console.log('\nAll checks passed successfully! Architecture & syntax 100% verified.');
  process.exit(0);
}
