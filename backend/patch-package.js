const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'node_modules', 'whatsapp-rust-bridge', 'package.json');

if (fs.existsSync(targetPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    if (pkg.exports && pkg.exports['.'] && !pkg.exports['.'].require) {
      pkg.exports['.'].require = './dist/index.js';
      fs.writeFileSync(targetPath, JSON.stringify(pkg, null, 4), 'utf8');
      console.log('✅ Successfully patched whatsapp-rust-bridge/package.json for CommonJS compatibility.');
    } else {
      console.log('ℹ️ whatsapp-rust-bridge/package.json is already compatible.');
    }
  } catch (err) {
    console.error('❌ Failed to patch whatsapp-rust-bridge:', err);
  }
} else {
  console.log('ℹ️ whatsapp-rust-bridge was not found in node_modules.');
}
