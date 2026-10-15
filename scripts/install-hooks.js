import { execFileSync } from 'node:child_process';
execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
console.log('✔ pre-commit secret scan installed (core.hooksPath=.githooks)');
