import { spawn } from 'child_process';
import * as readline from 'readline';
// set the env var
process.env.FILE_DRIVER = 'local';

// run existing npm script
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npmBin, ['run', 'seed:run:endpoint'], { shell: true });

let err = '';

// Create line readers so we get full lines
const outRl = readline.createInterface({ input: child.stdout });
outRl.on('line', (line) => {
  console.log(`[seed:run:endpoint] ${line}`);
});

const errRl = readline.createInterface({ input: child.stderr });
errRl.on('line', (line) => {
  console.error(`[seed:run:endpoint] ${line}`);
  err += line + '\n';
});

child.on('close', (code) => {
  outRl.close();
  errRl.close();

  if (code !== 0) {
    console.error(`❌ seed:run:endpoint failed with exit code ${code}`);
    console.error(err);
  }

  process.exit(code === null ? 1 : code);
});
