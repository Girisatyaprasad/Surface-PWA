import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonicalDirectory = resolve(projectDirectory, '..', 'Surface');
const destination = resolve(projectDirectory, 'emulator-rules');
await mkdir(destination, { recursive: true });
await Promise.all(['firestore.rules', 'storage.rules'].map((name) => copyFile(resolve(canonicalDirectory, name), resolve(destination, name))));
