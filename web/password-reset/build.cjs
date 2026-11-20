const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Copies a self-contained static site using the existing compiler and installed Supabase SDK.
function build() {
  const output = path.resolve(process.argv[2] || path.join(__dirname, 'dist'));
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  let connect = "'self'";
  if (config.supabaseUrl || config.supabasePublishableKey) {
    const url = new URL(config.supabaseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the HTTPS Supabase project URL.');
    const key = config.supabasePublishableKey;
    let publicKey = typeof key === 'string' && key.startsWith('sb_publishable_');
    if (typeof key === 'string' && key.split('.').length === 3) {
      publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon';
    }
    if (!publicKey) throw new Error('Use only a publishable/anon key; never a service-role or secret key.');
    connect += ` ${url.origin}`;
  }
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', path.join(__dirname, 'tsconfig.json'), '--outDir', output], { stdio: 'inherit' });
  fs.mkdirSync(output, { recursive: true });
  const csp = `default-src 'none'; script-src 'self'; style-src 'self'; connect-src ${connect}; base-uri 'none'; form-action 'none'; object-src 'none'`;
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replace('__CSP__', csp);
  fs.writeFileSync(path.join(output, 'index.html'), html);
  for (const file of ['style.css', 'config.json']) fs.copyFileSync(path.join(__dirname, file), path.join(output, file));
  const sdkDirectory = path.dirname(require.resolve('@supabase/supabase-js/package.json'));
  const sdk = fs.readFileSync(path.join(sdkDirectory, 'dist/umd/supabase.js'), 'utf8');
  fs.writeFileSync(path.join(output, 'vendor.js'), sdk + '\nexport const createClient = supabase.createClient;\n');
  fs.copyFileSync(path.join(sdkDirectory, 'LICENSE'), path.join(output, 'SUPABASE-LICENSE.txt'));
  fs.writeFileSync(path.join(output, '_headers'), `/*\n  Content-Security-Policy: ${csp}; frame-ancestors 'none'\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow\n`);
  fs.writeFileSync(path.join(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  console.log('Static password-reset site built. Configure public values and HTTPS hosting before live testing.');
}

try { build(); } catch { console.error('Reset page build failed. Check TypeScript and config.json; use only public Supabase values.'); process.exitCode = 1; }
