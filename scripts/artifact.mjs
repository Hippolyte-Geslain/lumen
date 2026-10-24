// Turn Vite's dist/ into a claude.ai Artifact: the page body (the publisher
// supplies <!doctype>, <html>, <head>, charset and viewport) + its assets.
//   npm run build:artifact  →  dist/artifact.html + dist/assets/*
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/i)[1]
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];

// <title> must sit in the first 8 KB, so it goes first.
const title = head.match(/<title>[\s\S]*?<\/title>/i)[0];
const rest = head.replace(title, '');
writeFileSync('dist/artifact.html', `${title}\n${rest.trim()}\n${body.trim()}\n`);

const assets = readdirSync('dist/assets');
console.log(`dist/artifact.html written; ${assets.length} assets in dist/assets`);
