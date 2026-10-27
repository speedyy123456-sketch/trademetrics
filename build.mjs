import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'dist');
const publicFiles = [
  'index.html',
  'app.js',
  'styles.css',
  'logo sin fondo dorado.png',
  'logo dorado icono.ico',
  'logoverde.png',
  'sitemap.xml',
];

await mkdir(output, { recursive: true });
await Promise.all(publicFiles.map((file) => copyFile(path.join(root, file), path.join(output, file))));
